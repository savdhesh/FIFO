import PDFDocument from "pdfkit";
import type { MatchResult, ParsedJD, TailoredResume } from "../types";
import type { CoverLetter } from "../tailoring/cover-letter";
import type { TruthAudit } from "../truth/truth";

const INK = "#111111", MUTED = "#444444";

function render(build: (d: PDFKit.PDFDocument) => void, meta: { title: string; author: string }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margins: { top: 48, bottom: 48, left: 54, right: 54 }, info: { Title: meta.title, Author: meta.author }, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    build(doc);
    doc.end();
  });
}

const contactLine = (id: TailoredResume["identity"]) => [id.location, id.email, id.phone, id.linkedin, id.github, id.portfolio].filter(Boolean).join("  |  ");

/** ATS-safe: single column, standard font, real text, no tables/images/icons. */
export function resumePdf(r: TailoredResume, density: "1" | "2" | "3" | "4" | "cv" = "3"): Promise<Buffer> {
  const base = density === "1" ? 9.5 : density === "2" ? 10 : 10.5;
  return render((d) => {
    const w = d.page.width - d.page.margins.left - d.page.margins.right;
    d.fillColor(INK).font("Helvetica-Bold").fontSize(18).text(r.identity.name || "Candidate", { width: w });
    d.font("Helvetica").fontSize(base - 0.5).fillColor(MUTED).text(contactLine(r.identity), { width: w });
    if (r.headline) { d.moveDown(0.5).font("Helvetica-Bold").fontSize(base + 0.5).fillColor(INK).text(r.headline, { width: w }); }
    const section = (title: string) => {
      d.moveDown(0.8).font("Helvetica-Bold").fontSize(base + 0.5).fillColor(INK).text(title.toUpperCase(), { width: w });
      const y = d.y + 1; d.moveTo(d.page.margins.left, y).lineTo(d.page.margins.left + w, y).lineWidth(0.5).strokeColor("#999999").stroke(); d.moveDown(0.3);
    };
    const para = (t: string) => d.font("Helvetica").fontSize(base).fillColor(INK).text(t, { width: w, lineGap: 1.5 });
    const bullet = (t: string) => {
      const x = d.page.margins.left;
      const y = d.y;
      d.font("Helvetica").fontSize(base).fillColor(INK).text("•", x + 2, y, { width: 10, lineBreak: false });
      d.text(t, x + 14, y, { width: w - 14, lineGap: 1.5 });
      d.x = x;
      d.moveDown(0.15);
    };
    if (r.summary) { section("Professional Summary"); para(r.summary); }
    if (r.competencies.length) { section("Core Competencies"); para(r.competencies.join("  •  ")); }
    if (r.skills.length) {
      section("Technical Skills");
      for (const s of r.skills) {
        d.font("Helvetica-Bold").fontSize(base).fillColor(INK).text(`${s.label}: `, { continued: true, width: w, lineGap: 1.5 });
        d.font("Helvetica").text(s.items.join(", "));
      }
    }
    if (r.experience.length) {
      section("Professional Experience");
      for (const e of r.experience) {
        d.moveDown(0.3).font("Helvetica-Bold").fontSize(base + 0.5).fillColor(INK).text([e.title, e.employer].filter(Boolean).join(", "), { width: w });
        d.font("Helvetica-Oblique").fontSize(base - 0.5).fillColor(MUTED).text([e.dates, e.location].filter(Boolean).join("  |  "), { width: w });
        d.moveDown(0.2);
        for (const b of e.bullets) bullet(b.text);
      }
    }
    if (r.education.length) { section("Education"); for (const e of r.education) para(e); }
    if (r.certifications.length) { section("Certifications"); for (const c of r.certifications) bullet(c); }
    if (r.publications.length) { section("Publications"); for (const c of r.publications) bullet(c); }
  }, { title: `${r.identity.name} Resume`, author: r.identity.name });
}

export function coverLetterPdf(l: CoverLetter, author: string, identity: TailoredResume["identity"]): Promise<Buffer> {
  return render((d) => {
    const w = d.page.width - d.page.margins.left - d.page.margins.right;
    d.fillColor(INK).font("Helvetica-Bold").fontSize(14).text(author, { width: w });
    d.font("Helvetica").fontSize(9.5).fillColor(MUTED).text(contactLine(identity), { width: w });
    d.moveDown(1.2).fontSize(10.5).fillColor(INK).text(l.date).moveDown(0.8).text(l.salutation).moveDown(0.6);
    for (const p of l.paragraphs) d.text(p, { width: w, lineGap: 2.5, align: "left" }).moveDown(0.6);
    d.text(l.closing).moveDown(1.2).font("Helvetica-Bold").text(l.signature);
  }, { title: `${author} Cover Letter`, author });
}

export function reportPdf(args: { candidate: string; company: string; role: string; jd: ParsedJD; match: MatchResult; audit?: TruthAudit | null }): Promise<Buffer> {
  const { match, jd, audit } = args;
  return render((d) => {
    const w = d.page.width - d.page.margins.left - d.page.margins.right;
    const h = (t: string) => d.moveDown(0.8).font("Helvetica-Bold").fontSize(12).fillColor(INK).text(t, { width: w }).moveDown(0.2);
    const p = (t: string, f = "Helvetica") => d.font(f).fontSize(9.5).fillColor(INK).text(t, { width: w, lineGap: 1.5 });
    d.font("Helvetica-Bold").fontSize(16).fillColor(INK).text("Application Match Report");
    p(`${args.candidate}  →  ${args.role || jd.roleTitle}${args.company ? ` @ ${args.company}` : ""}`);
    h(`Recommendation: ${match.recommendation.verdict}`);
    for (const r of match.recommendation.reasons) p(`• ${r}`);
    h("Scores (explainable)");
    for (const s of match.scores) { p(`${s.label}: ${s.value}`, "Helvetica-Bold"); for (const w2 of s.why.slice(0, 4)) p(`   ${w2}`); }
    h("Requirement matrix");
    for (const m of match.requirements) p(`[${m.importance}] ${m.requirement} — ${m.matchType} (${m.confidence}) → ${m.action}${m.gap !== "none" ? `  | gap: ${m.gap}, ${m.gapKind}` : ""}`);
    if (match.gaps.length) { h("Gap analysis"); for (const g of match.gaps) p(`• ${g.term} (${g.gap}): ${g.recommendation}`); }
    h(`Seniority: resume communicates ${match.seniority.detected}`);
    for (const s of match.seniority.signals.slice(0, 10)) p(`• ${s.signal}`);
    if (audit) { h("Truth audit"); p(`Verified ${audit.counts.VERIFIED} · Supported ${audit.counts.SUPPORTED} · Inferred ${audit.counts.INFERRED} · Unsupported ${audit.counts.UNSUPPORTED}`); }
  }, { title: "Match Report", author: args.candidate });
}
