import { jsPDF } from "jspdf";
import { Packer } from "docx";
import { resumeDoc, coverLetterDoc } from "../src/lib/export/docx";
import type { MatchResult, ParsedJD, TailoredResume } from "../src/lib/types";
import type { CoverLetter } from "../src/lib/tailoring/cover-letter";
import type { TruthAudit } from "../src/lib/truth/truth";
import { themeById } from "../src/lib/export/themes";
import type { Issue } from "../src/lib/credibility/credibility";
import type { Strategy } from "../src/lib/strategy/strategy";
import type { AtsReport } from "../src/lib/ats/ats";

const contact = (id: TailoredResume["identity"]) => [id.location, id.email, id.phone, id.linkedin, id.github, id.portfolio].filter(Boolean).join("  |  ");

/** Minimal flowing-text writer on jsPDF: single column, Helvetica, real text (ATS-safe). */
function writer(title: string, font: "helvetica" | "times" = "helvetica") {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  doc.setProperties({ title });
  const M = 54, W = doc.internal.pageSize.getWidth() - M * 2, H = doc.internal.pageSize.getHeight();
  let y = 52;
  const need = (h: number) => { if (y + h > H - 48) { doc.addPage(); y = 52; } };
  const text = (t: string, o: { size?: number; bold?: boolean; italic?: boolean; indent?: number; gap?: number; color?: number | [number, number, number] } = {}) => {
    const size = o.size ?? 10;
    doc.setFont(font, o.bold ? "bold" : o.italic ? "italic" : "normal").setFontSize(size); if (Array.isArray(o.color)) doc.setTextColor(...o.color); else doc.setTextColor(o.color ?? 17);
    const lines = doc.splitTextToSize(t, W - (o.indent ?? 0)) as string[];
    for (const l of lines) { need(size * 1.35); doc.text(l, M + (o.indent ?? 0), y + size); y += size * 1.35; }
    y += o.gap ?? 0;
  };
  const rule = (on = true) => { if (on) doc.setDrawColor(150).setLineWidth(0.5).line(M, y, M + W, y); y += 4; };
  const bullet = (t: string, size = 10) => { need(size * 1.35); doc.setFont(font, "normal").setFontSize(size).setTextColor(17).text("•", M + 2, y + size); text(t, { size, indent: 14, gap: 2 }); };
  return { doc, text, rule, bullet, gap: (n: number) => { y += n; }, pages: () => doc.getNumberOfPages(), out: () => doc.output("arraybuffer") as ArrayBuffer };
}

export interface PdfOut { data: ArrayBuffer; pages: number }
export function resumePdf(r: TailoredResume, length: string, themeId?: string): PdfOut {
  const th = themeById(themeId);
  const base = length === "1" ? 9.5 : length === "2" ? 10 : 10.5;
  const w = writer(`${r.identity.name} Resume`, th.pdfFont);
  w.text(r.identity.name || "Candidate", { size: 18, bold: true });
  w.text(contact(r.identity), { size: base - 0.5, color: 68 });
  if (r.headline) { w.gap(4); w.text(r.headline, { size: base + 0.5, bold: true }); }
  const section = (t: string) => { w.gap(8); w.text(t.toUpperCase(), { size: base + 0.5, bold: true, color: th.headingRgb }); w.rule(th.rule); };
  if (r.summary) { section("Professional Summary"); w.text(r.summary, { size: base }); }
  if (r.competencies.length) { section("Core Competencies"); w.text(r.competencies.join("  •  "), { size: base }); }
  if (r.skills.length) { section("Technical Skills"); for (const s of r.skills) w.text(`${s.label}: ${s.items.join(", ")}`, { size: base, gap: 1 }); }
  if (r.experience.length) {
    section("Professional Experience");
    for (const e of r.experience) {
      w.gap(4); w.text([e.title, e.employer].filter(Boolean).join(", "), { size: base + 0.5, bold: true });
      w.text([e.dates, e.location].filter(Boolean).join("  |  "), { size: base - 0.5, italic: true, color: 68, gap: 2 });
      for (const b of e.bullets) w.bullet(b.text, base);
    }
  }
  if ((r.projects ?? []).length) { section("Major Technical Projects"); for (const p of r.projects) { w.gap(3); w.text(p.name + (p.sub ? `  (${p.sub})` : ""), { size: base + 0.5, bold: true, gap: 2 }); p.bullets.forEach((b) => w.bullet(b, base)); } }
  if (r.education.length) { section("Education"); r.education.forEach((e) => w.text(e, { size: base })); }
  if (r.certifications.length) { section("Certifications"); r.certifications.forEach((c) => w.bullet(c, base)); }
  if (r.publications.length) { section("Publications"); r.publications.forEach((c) => w.bullet(c, base)); }
  return { pages: w.pages(), data: w.out() };
}

/** Trim to the requested page count by dropping the lowest-ranked content first (projects, then trailing bullets of the oldest roles). Nothing is reworded. */
export function fitResume(r: TailoredResume, length: string, themeId?: string): { resume: TailoredResume; pages: number; trimmed: number; target: number | null } {
  const target = length === "cv" ? null : Number(length);
  let cur: TailoredResume = structuredClone(r), trimmed = 0;
  let pages = resumePdf(cur, length, themeId).pages;
  while (target && pages > target) {
    if (cur.projects?.length) { trimmed += cur.projects.reduce((a, p) => a + p.bullets.length, 0); cur.projects = []; }
    else {
      // oldest role with more than 1 bullet loses its last (lowest-ranked) bullet
      const i = [...cur.experience].map((e, k) => ({ e, k })).reverse().find(({ e }) => e.bullets.length > 1)?.k;
      if (i === undefined) { if (cur.competencies.length) { cur.competencies = []; trimmed++; } else break; }
      else { cur.experience[i].bullets.pop(); trimmed++; }
    }
    pages = resumePdf(cur, length, themeId).pages;
  }
  return { resume: cur, pages, trimmed, target };
}

export function coverLetterPdf(l: CoverLetter, id: TailoredResume["identity"]): ArrayBuffer {
  const w = writer(`${id.name} Cover Letter`);
  w.text(id.name, { size: 14, bold: true }); w.text(contact(id), { size: 9.5, color: 68, gap: 14 });
  w.text(l.date, { size: 10.5, gap: 10 }); w.text(l.salutation, { size: 10.5, gap: 8 });
  for (const p of l.paragraphs) w.text(p, { size: 10.5, gap: 8 });
  w.gap(4); w.text(l.closing, { size: 10.5, gap: 14 }); w.text(l.signature, { size: 10.5, bold: true });
  return w.out();
}

export function reportPdf(a: { candidate: string; company: string; role: string; jd: ParsedJD; match: MatchResult; audit?: TruthAudit | null; strategy?: Strategy | null; credibility?: Issue[] | null; ats?: AtsReport | null }): ArrayBuffer {
  const w = writer("Match Report"); const m = a.match;
  const h = (t: string) => { w.gap(8); w.text(t, { size: 12, bold: true, gap: 2 }); };
  w.text("Application Match Report", { size: 16, bold: true });
  w.text(`${a.candidate}  →  ${a.role || a.jd.roleTitle}${a.company ? ` @ ${a.company}` : ""}`, { size: 9.5 });
  h(`Recommendation: ${m.recommendation.verdict}`); m.recommendation.reasons.forEach((r) => w.text(`• ${r}`, { size: 9.5 }));
  h("Scores"); for (const s of m.scores) { w.text(`${s.label}: ${s.value}`, { size: 9.5, bold: true }); s.why.slice(0, 4).forEach((x) => w.text(x, { size: 9, indent: 12 })); }
  h("Requirement matrix"); m.requirements.forEach((r) => w.text(`[${r.importance}] ${r.requirement} — ${r.matchType} (${r.confidence}) → ${r.action}${r.gap !== "none" ? `  | gap: ${r.gap}, ${r.gapKind}` : ""}`, { size: 9 }));
  if (m.gaps.length) { h("Gap analysis"); m.gaps.forEach((g) => w.text(`• ${g.term} (${g.gap}): ${g.recommendation}`, { size: 9 })); }
  h(`Seniority: resume communicates ${m.seniority.detected}`); m.seniority.signals.slice(0, 10).forEach((s) => w.text(`• ${s.signal}`, { size: 9 }));
  if (a.strategy) { h(`Application strategy: ${a.strategy.headline}`); for (const sec of a.strategy.sections) { w.text(sec.title, { size: 10, bold: true }); sec.items.forEach((x) => w.text(`• ${x}`, { size: 9, indent: 8 })); } }
  if (a.credibility?.length) { h("Technical credibility"); a.credibility.forEach((i) => w.text(`[${i.severity}] ${i.area}: ${i.message} Fix: ${i.fix}`, { size: 9 })); }
  if (a.ats) { h(`ATS parse risk: ${a.ats.risk}`); a.ats.checks.filter((c) => c.status !== "pass").forEach((c) => w.text(`• ${c.label}: ${c.detail}`, { size: 9 })); }
  if (a.audit) { h("Truth audit"); w.text(`Verified ${a.audit.counts.VERIFIED} · Supported ${a.audit.counts.SUPPORTED} · Inferred ${a.audit.counts.INFERRED} · Unsupported ${a.audit.counts.UNSUPPORTED}`, { size: 9.5 }); }
  return w.out();
}

export const resumeDocxBlob = (r: TailoredResume, themeId?: string) => Packer.toBlob(resumeDoc(r, themeId));
export const coverDocxBlob = (l: CoverLetter, id: TailoredResume["identity"]) => Packer.toBlob(coverLetterDoc(l, id));
