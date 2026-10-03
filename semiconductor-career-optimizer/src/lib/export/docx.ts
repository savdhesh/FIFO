import { AlignmentType, BorderStyle, Document, LevelFormat, Packer, Paragraph, TextRun } from "docx";
import type { TailoredResume } from "../types";
import { themeById } from "./themes";
import type { CoverLetter } from "../tailoring/cover-letter";

let FONT = "Calibri";
const run = (text: string, o: { bold?: boolean; italics?: boolean; size?: number; color?: string } = {}) => new TextRun({ text, font: FONT, size: o.size ?? 21, bold: o.bold, italics: o.italics, color: o.color ?? "111111" });
const contact = (id: TailoredResume["identity"]) => [id.location, id.email, id.phone, id.linkedin, id.github, id.portfolio].filter(Boolean).join("  |  ");

const numbering = { config: [{ reference: "bullets", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 240 } } } }] }] };

/** Plain paragraphs only (no tables, text boxes, headers/footers) so ATS parsers read it in order. */
export function resumeDoc(r: TailoredResume, themeId?: string): Document {
  const th = themeById(themeId); FONT = th.docxFont;
  const out: Paragraph[] = [];
  const heading = (t: string) => out.push(new Paragraph({ spacing: { before: 200, after: 80 }, border: th.rule ? { bottom: { style: BorderStyle.SINGLE, size: 4, color: "999999", space: 1 } } : undefined, children: [run(t.toUpperCase(), { bold: true, size: 22, color: th.heading })] }));
  const para = (t: string) => out.push(new Paragraph({ spacing: { after: 60 }, children: [run(t)] }));
  const bullet = (t: string) => out.push(new Paragraph({ numbering: { reference: "bullets", level: 0 }, spacing: { after: 40 }, children: [run(t)] }));
  out.push(new Paragraph({ children: [run(r.identity.name || "Candidate", { bold: true, size: 36 })] }));
  out.push(new Paragraph({ children: [run(contact(r.identity), { size: 19, color: "444444" })] }));
  if (r.headline) out.push(new Paragraph({ spacing: { before: 100 }, children: [run(r.headline, { bold: true, size: 22 })] }));
  if (r.summary) { heading("Professional Summary"); para(r.summary); }
  if (r.competencies.length) { heading("Core Competencies"); para(r.competencies.join("  •  ")); }
  if (r.skills.length) { heading("Technical Skills"); for (const s of r.skills) out.push(new Paragraph({ spacing: { after: 40 }, children: [run(`${s.label}: `, { bold: true }), run(s.items.join(", "))] })); }
  if (r.experience.length) {
    heading("Professional Experience");
    for (const e of r.experience) {
      out.push(new Paragraph({ spacing: { before: 120 }, keepNext: true, children: [run([e.title, e.employer].filter(Boolean).join(", "), { bold: true, size: 22 })] }));
      out.push(new Paragraph({ spacing: { after: 60 }, keepNext: true, children: [run([e.dates, e.location].filter(Boolean).join("  |  "), { italics: true, size: 19, color: "444444" })] }));
      for (const b of e.bullets) bullet(b.text);
    }
  }
  if ((r.projects ?? []).length) {
    heading("Major Technical Projects");
    for (const p of r.projects) { out.push(new Paragraph({ spacing: { before: 100 }, keepNext: true, children: [run(p.name, { bold: true, size: 22 }), ...(p.sub ? [run(`  ${p.sub}`, { italics: true, size: 19, color: "444444" })] : [])] })); for (const b of p.bullets) bullet(b); }
  }
  if (r.education.length) { heading("Education"); r.education.forEach(para); }
  if (r.certifications.length) { heading("Certifications"); r.certifications.forEach(bullet); }
  if (r.publications.length) { heading("Publications"); r.publications.forEach(bullet); }
  return new Document({ creator: r.identity.name, title: `${r.identity.name} Resume`, numbering, sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 850, bottom: 850, left: 1000, right: 1000 } } }, children: out }] });
}
export const resumeDocx = (r: TailoredResume, themeId?: string): Promise<Buffer> => Packer.toBuffer(resumeDoc(r, themeId));

export function coverLetterDoc(l: CoverLetter, identity: TailoredResume["identity"]): Document {
  const out: Paragraph[] = [
    new Paragraph({ children: [run(identity.name, { bold: true, size: 28 })] }),
    new Paragraph({ spacing: { after: 240 }, children: [run(contact(identity), { size: 19, color: "444444" })] }),
    new Paragraph({ spacing: { after: 200 }, children: [run(l.date)] }),
    new Paragraph({ spacing: { after: 160 }, children: [run(l.salutation)] }),
    ...l.paragraphs.map((p) => new Paragraph({ spacing: { after: 160, line: 276 }, children: [run(p)] })),
    new Paragraph({ spacing: { before: 120, after: 240 }, children: [run(l.closing)] }),
    new Paragraph({ children: [run(l.signature, { bold: true })] }),
  ];
  return new Document({ creator: identity.name, title: `${identity.name} Cover Letter`, sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1000, bottom: 1000, left: 1200, right: 1200 } } }, children: out }] });
}
export const coverLetterDocx = (l: CoverLetter, identity: TailoredResume["identity"]): Promise<Buffer> => Packer.toBuffer(coverLetterDoc(l, identity));
