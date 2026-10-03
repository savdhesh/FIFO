import { jsPDF } from "jspdf";
import { Packer } from "docx";
import { resumeDoc, coverLetterDoc } from "../src/lib/export/docx";
import type { MatchResult, ParsedJD, TailoredResume } from "../src/lib/types";
import type { CoverLetter } from "../src/lib/tailoring/cover-letter";
import type { TruthAudit } from "../src/lib/truth/truth";

const contact = (id: TailoredResume["identity"]) => [id.location, id.email, id.phone, id.linkedin, id.github, id.portfolio].filter(Boolean).join("  |  ");

/** Minimal flowing-text writer on jsPDF: single column, Helvetica, real text (ATS-safe). */
function writer(title: string) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  doc.setProperties({ title });
  const M = 54, W = doc.internal.pageSize.getWidth() - M * 2, H = doc.internal.pageSize.getHeight();
  let y = 52;
  const need = (h: number) => { if (y + h > H - 48) { doc.addPage(); y = 52; } };
  const text = (t: string, o: { size?: number; bold?: boolean; italic?: boolean; indent?: number; gap?: number; color?: number } = {}) => {
    const size = o.size ?? 10;
    doc.setFont("helvetica", o.bold ? "bold" : o.italic ? "italic" : "normal").setFontSize(size).setTextColor(o.color ?? 17);
    const lines = doc.splitTextToSize(t, W - (o.indent ?? 0)) as string[];
    for (const l of lines) { need(size * 1.35); doc.text(l, M + (o.indent ?? 0), y + size); y += size * 1.35; }
    y += o.gap ?? 0;
  };
  const rule = () => { doc.setDrawColor(150).setLineWidth(0.5).line(M, y, M + W, y); y += 4; };
  const bullet = (t: string, size = 10) => { need(size * 1.35); doc.setFont("helvetica", "normal").setFontSize(size).setTextColor(17).text("•", M + 2, y + size); text(t, { size, indent: 14, gap: 2 }); };
  return { doc, text, rule, bullet, gap: (n: number) => { y += n; }, out: () => doc.output("arraybuffer") as ArrayBuffer };
}

export function resumePdf(r: TailoredResume, length: string): ArrayBuffer {
  const base = length === "1" ? 9.5 : length === "2" ? 10 : 10.5;
  const w = writer(`${r.identity.name} Resume`);
  w.text(r.identity.name || "Candidate", { size: 18, bold: true });
  w.text(contact(r.identity), { size: base - 0.5, color: 68 });
  if (r.headline) { w.gap(4); w.text(r.headline, { size: base + 0.5, bold: true }); }
  const section = (t: string) => { w.gap(8); w.text(t.toUpperCase(), { size: base + 0.5, bold: true }); w.rule(); };
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
  if (r.education.length) { section("Education"); r.education.forEach((e) => w.text(e, { size: base })); }
  if (r.certifications.length) { section("Certifications"); r.certifications.forEach((c) => w.bullet(c, base)); }
  if (r.publications.length) { section("Publications"); r.publications.forEach((c) => w.bullet(c, base)); }
  return w.out();
}

export function coverLetterPdf(l: CoverLetter, id: TailoredResume["identity"]): ArrayBuffer {
  const w = writer(`${id.name} Cover Letter`);
  w.text(id.name, { size: 14, bold: true }); w.text(contact(id), { size: 9.5, color: 68, gap: 14 });
  w.text(l.date, { size: 10.5, gap: 10 }); w.text(l.salutation, { size: 10.5, gap: 8 });
  for (const p of l.paragraphs) w.text(p, { size: 10.5, gap: 8 });
  w.gap(4); w.text(l.closing, { size: 10.5, gap: 14 }); w.text(l.signature, { size: 10.5, bold: true });
  return w.out();
}

export function reportPdf(a: { candidate: string; company: string; role: string; jd: ParsedJD; match: MatchResult; audit?: TruthAudit | null }): ArrayBuffer {
  const w = writer("Match Report"); const m = a.match;
  const h = (t: string) => { w.gap(8); w.text(t, { size: 12, bold: true, gap: 2 }); };
  w.text("Application Match Report", { size: 16, bold: true });
  w.text(`${a.candidate}  →  ${a.role || a.jd.roleTitle}${a.company ? ` @ ${a.company}` : ""}`, { size: 9.5 });
  h(`Recommendation: ${m.recommendation.verdict}`); m.recommendation.reasons.forEach((r) => w.text(`• ${r}`, { size: 9.5 }));
  h("Scores"); for (const s of m.scores) { w.text(`${s.label}: ${s.value}`, { size: 9.5, bold: true }); s.why.slice(0, 4).forEach((x) => w.text(x, { size: 9, indent: 12 })); }
  h("Requirement matrix"); m.requirements.forEach((r) => w.text(`[${r.importance}] ${r.requirement} — ${r.matchType} (${r.confidence}) → ${r.action}${r.gap !== "none" ? `  | gap: ${r.gap}, ${r.gapKind}` : ""}`, { size: 9 }));
  if (m.gaps.length) { h("Gap analysis"); m.gaps.forEach((g) => w.text(`• ${g.term} (${g.gap}): ${g.recommendation}`, { size: 9 })); }
  h(`Seniority: resume communicates ${m.seniority.detected}`); m.seniority.signals.slice(0, 10).forEach((s) => w.text(`• ${s.signal}`, { size: 9 }));
  if (a.audit) { h("Truth audit"); w.text(`Verified ${a.audit.counts.VERIFIED} · Supported ${a.audit.counts.SUPPORTED} · Inferred ${a.audit.counts.INFERRED} · Unsupported ${a.audit.counts.UNSUPPORTED}`, { size: 9.5 }); }
  return w.out();
}

export const resumeDocxBlob = (r: TailoredResume) => Packer.toBlob(resumeDoc(r));
export const coverDocxBlob = (l: CoverLetter, id: TailoredResume["identity"]) => Packer.toBlob(coverLetterDoc(l, id));
