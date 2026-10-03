import { parseResumeHeuristic, splitSections, normalizeText } from "../parsing/resume-parser";
import { DATE_RANGE_RE } from "../parsing/dates";

export interface LayoutInfo { pages: number; columns: boolean; minFontPt: number | null; images: number | null }
export type CheckStatus = "pass" | "warn" | "fail";
export interface AtsCheck { id: string; label: string; status: CheckStatus; detail: string }
export interface AtsReport {
  risk: "Low" | "Medium" | "High";
  checks: AtsCheck[];
  extracted: {
    name: string; email: string; phone: string; linkedin: string; location: string;
    sections: string[]; roles: { title: string; employer: string; dates: string }[]; education: number; skills: number;
  };
  text: string; // exactly what a text-extracting parser sees, in order
}

const STANDARD: [string, RegExp][] = [
  ["Experience", /^(?:professional\s+|work\s+|relevant\s+)?(?:experience|employment(?:\s+history)?|work history|career history)$/i],
  ["Education", /^(?:education|academic(?:s| background| qualifications)?|qualifications)$/i],
  ["Skills", /^(?:(?:technical|core|key)\s+)?(?:skills|competencies|expertise)(?:\s+summary)?$/i],
  ["Summary", /^(?:professional\s+)?(?:summary|profile|objective|executive summary)$/i],
];
const NONSTANDARD = /^(?:my journey|what i do|where i['’]ve been|about me|my story|toolbox|career highlights|things i['’]ve built)$/i;

/** Simulates a text-extraction ATS: what comes out, what it can parse from it, and what would trip it up. */
export function atsParse(raw: string, layout?: LayoutInfo): AtsReport {
  const text = normalizeText(raw);
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const profile = parseResumeHeuristic(text);
  const { sections } = splitSections(text);
  const found = Object.keys(sections);
  const headingLines = lines.filter((l) => l.length < 40 && l === l.toUpperCase() && /[A-Z]{4}/.test(l));
  const checks: AtsCheck[] = [];
  const add = (id: string, label: string, status: CheckStatus, detail: string) => checks.push({ id, label, status, detail });

  add("text", "Machine-readable text", text.length >= 500 ? "pass" : "fail", text.length >= 500 ? `${text.length} characters extracted.` : "Almost no text extracted. The file may be an image or scanned PDF, which an ATS cannot read.");
  const id = profile.identity;
  add("name", "Name on first line", id.name ? "pass" : "fail", id.name ? `Parsed as "${id.name}".` : "No name found at the top. Put your name alone on the first line.");
  add("email", "Email parsed", id.email ? "pass" : "fail", id.email || "No email address found in extracted text.");
  add("phone", "Phone parsed", id.phone ? "pass" : "warn", id.phone || "No phone number parsed. Use a standard format such as +91 98000 00000.");
  const std = STANDARD.map(([n]) => n).filter((n) => found.includes(n.toLowerCase()));
  const missing = STANDARD.map(([n]) => n).filter((n) => !found.includes(n.toLowerCase()) && n !== "Summary");
  add("sections", "Standard section names", missing.length === 0 ? "pass" : missing.includes("Experience") ? "fail" : "warn", missing.length ? `Not recognised: ${missing.join(", ")}. Use plain headings such as Experience, Education, Skills.` : `Recognised: ${std.join(", ")}.`);
  const odd = lines.filter((l) => NONSTANDARD.test(l.replace(/[:\s]+$/, "")));
  if (odd.length) add("headings", "Creative headings", "warn", `Non-standard heading(s): ${odd.join(", ")}. Parsers may not file the content under the right section.`);
  const datedRoles = profile.roles.filter((r) => r.startDate);
  add("dates", "Dates parsed per role", profile.roles.length === 0 ? "fail" : datedRoles.length === profile.roles.length ? "pass" : "warn", profile.roles.length === 0 ? "No roles with dates were recognised." : `${datedRoles.length}/${profile.roles.length} roles have a recognised date range.`);
  const withEmployer = profile.roles.filter((r) => r.employer && r.title);
  add("roles", "Title and employer per role", profile.roles.length && withEmployer.length === profile.roles.length ? "pass" : "warn", `${withEmployer.length}/${profile.roles.length} roles have both a title and an employer.`);

  const glyphs = text.match(/[-☀-➿\u{1F300}-\u{1FAFF}]/gu) ?? [];
  add("glyphs", "Icons and special symbols", glyphs.length === 0 ? "pass" : "warn", glyphs.length ? `${glyphs.length} icon/private-use characters found; they extract as junk or squares.` : "No icon or private-use characters.");
  const pipeRows = lines.filter((l) => (l.match(/\|/g) ?? []).length >= 3 && !/@/.test(l)).length;
  const tabRows = lines.filter((l) => /\t/.test(l)).length;
  add("tables", "Tables", pipeRows + tabRows > 3 ? "warn" : "pass", pipeRows + tabRows > 3 ? "Several rows look like table cells. Tables are often read column by column or dropped." : "No table-like rows detected.");
  // Reading order: columns show up as many rows with a wide internal gap in position-aware extraction.
  if (layout) {
    add("columns", "Single-column reading order", layout.columns ? "fail" : "pass", layout.columns ? "Text is laid out in multiple columns. Many ATS read straight across rows and interleave unrelated lines." : "Single column; text extracts top to bottom.");
    add("font", "Font size", layout.minFontPt !== null && layout.minFontPt < 8.5 ? "warn" : "pass", layout.minFontPt === null ? "Font size unavailable." : `Smallest text ${layout.minFontPt.toFixed(1)} pt${layout.minFontPt < 8.5 ? ". Very small text can be skipped or hard to read for humans." : "."}`);
    add("pages", "Length", layout.pages > 4 ? "warn" : "pass", `${layout.pages} page(s)${layout.pages > 4 ? ". Most recruiters expect 4 or fewer; very long files can be truncated by some systems." : "."}`);
    if (layout.images !== null) add("images", "Images and graphics", layout.images > 0 ? "warn" : "pass", layout.images > 0 ? `${layout.images} image(s). Text inside images is invisible to an ATS.` : "No embedded images.");
  } else {
    const wide = lines.filter((l) => /\S {4,}\S/.test(l)).length;
    add("columns", "Single-column reading order", wide > lines.length * 0.25 ? "warn" : "pass", wide > lines.length * 0.25 ? "Many lines contain wide gaps, a sign of columns or tabbed layouts." : "No sign of column interleaving in the text.");
  }
  const bullets = lines.filter((l) => /^[•●▪■◦○·*\-–—]\s*\S/.test(l)).length;
  add("bullets", "Bullets", bullets > 0 ? "pass" : "warn", bullets > 0 ? `${bullets} standard bullet lines.` : "No standard bullets found; experience may be read as paragraphs.");
  void headingLines; void DATE_RANGE_RE;

  const fails = checks.filter((c) => c.status === "fail").length, warns = checks.filter((c) => c.status === "warn").length;
  const risk: AtsReport["risk"] = fails > 0 ? "High" : warns >= 2 ? "Medium" : "Low";
  return {
    risk, checks,
    extracted: { name: id.name, email: id.email, phone: id.phone, linkedin: id.linkedin, location: id.location, sections: found, roles: profile.roles.map((r) => ({ title: r.title, employer: r.employer, dates: [r.startDate, r.endDate].filter(Boolean).join(" – ") })), education: profile.education.length, skills: Object.values(profile.skills).flat().length },
    text,
  };
}
