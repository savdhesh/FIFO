import type { Profile } from "../types";
import { jaccard } from "../matching/bullets";
import { normalizeText, splitSections } from "./resume-parser";

export interface ParseFlag { level: "warn" | "error"; message: string }
export interface ParseDiagnostics {
  coverage: number; // share of content lines the parser placed in a field
  unplaced: string[]; // lines it could not place (for manual assignment)
  flags: ParseFlag[];
  confidence: "High" | "Medium" | "Low";
  lines: number;
}

const BULLET = /^\s*(?:[•●▪■◦○·*\-–—>-]\s*|\d+[.)]\s+|o\s+(?=[A-Z]))/;
const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** How well did the parse account for the source text? Used to flag uploads that need a human look. */
export function diagnoseParse(raw: string, profile: Profile): ParseDiagnostics {
  const text = normalizeText(raw);
  const { sections } = splitSections(text);
  const ignorable = new Set<string>();
  // lines inside sections the parser deliberately drops are not "unplaced"
  const all = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const ignoredBlock = (() => {
    const out = new Set<string>(); let on = false;
    for (const l of text.split("\n")) {
      const t = l.trim();
      if (/^(?:personal\s+(?:details|information|data)|declaration|references?|hobbies.*|interests|languages(?:\s+known)?|persönliche daten|referenzen|sprachen)\s*:?$/i.test(t)) { on = true; continue; }
      if (on && /^[A-Z][A-Z &/]{3,}$/.test(t)) on = false;
      if (on && t) out.add(t);
    }
    return out;
  })();
  void sections; void ignorable;

  const fields: string[] = [];
  const id = profile.identity;
  fields.push(...Object.values(id), profile.summary, ...profile.certifications, ...profile.publications, ...profile.achievements);
  for (const e of profile.education) fields.push(e.degree, e.university, e.specialization, e.year, [e.degree, e.university, e.year].join(" "));
  for (const [, v] of Object.entries(profile.skills)) fields.push(...v, v.join(", "));
  for (const r of profile.roles) fields.push(r.title, r.employer, r.client, r.location, r.startDate, r.endDate, r.employmentType, ...r.responsibilities, ...r.achievements, [r.title, r.employer].join(" "));
  for (const p of profile.projects) fields.push(p.name, p.employer, p.period, p.summary, ...p.highlights);
  const hay = fields.filter(Boolean).map(key);
  const hayJoined = hay.join(" | ");

  const STOP = new Set(["the", "and", "for", "with", "from", "that", "this", "into", "over", "using", "used", "was", "were", "are", "has", "have", "had", "you", "our", "all"]);
  const tokens = (t: string) => t.split(" ").filter((w) => (w.length > 2 || /\d/.test(w)) && !STOP.has(w));
  const known = new Set([...hay.flatMap(tokens), "languages", "language", "verification", "formal", "processor", "protocols", "domains", "tools", "methodologies", "skills", "technologies", "technical", "software", "hardware", "email", "phone", "mobile", "address", "linkedin", "github", "name"]);
  const placed = (line: string): boolean => {
    const l = key(line.replace(BULLET, ""));
    if (!l) return true;
    if (hayJoined.includes(l)) return true;
    // composite lines ("Role | Employer | Dates", contact lines) and wrapped lines: their words all live in parsed fields
    const words = tokens(l);
    if (words.length && words.filter((w) => known.has(w)).length / words.length >= 0.85) return true;
    return hay.some((h) => jaccard(h, l) >= 0.8);
  };
  const isHeading = (l: string) => l.length < 60 && /^(?:[A-ZÄÖÜ][A-ZÄÖÜ &/\-]{3,}|[A-Z][a-z]+(?:\s+[A-Za-z&]+){0,3}):?$/.test(l) && splitSections(`${l}\nx`).sections && Object.keys(splitSections(`${l}\nx`).sections).length > 0;
  const content = all.filter((l) => !isHeading(l) && !ignoredBlock.has(l) && l.length > 2 && !/^[-–—_=*•·\s]+$/.test(l));
  const unplaced = content.filter((l) => !placed(l));
  const coverage = content.length ? Math.round(((content.length - unplaced.length) / content.length) * 100) / 100 : 0;

  const flags: ParseFlag[] = [];
  if (!profile.roles.length) flags.push({ level: "error", message: "No roles were found. The experience section may use an unusual heading or layout." });
  for (const r of profile.roles) {
    const nm = r.title || r.employer || "A role";
    if (!r.startDate) flags.push({ level: "warn", message: `${nm}: no start date recognised.` });
    if (!r.title) flags.push({ level: "warn", message: `A role at ${r.employer || "an unknown employer"} has no title.` });
    if (!r.employer) flags.push({ level: "warn", message: `${r.title || "A role"} has no employer.` });
    if (r.responsibilities.length + r.achievements.length === 0) flags.push({ level: "warn", message: `${nm}: no bullets found.` });
    for (const b of [...r.responsibilities, ...r.achievements]) if (b.length > 380) flags.push({ level: "warn", message: `${nm}: a bullet is ${b.length} characters long; wrapped lines may have been merged.` });
  }
  if (!Object.values(profile.skills).some((v) => v.length)) flags.push({ level: "warn", message: "No skills found." });
  if (!profile.identity.email) flags.push({ level: "warn", message: "No email address found." });
  if (!profile.identity.name) flags.push({ level: "warn", message: "No name found." });
  if (unplaced.length >= 6) flags.push({ level: "warn", message: `${unplaced.length} lines could not be placed. They are listed so you can assign them.` });
  if (coverage < 0.65) flags.push({ level: "error", message: `Only ${Math.round(coverage * 100)}% of the text was placed. Check the layout, or try the DOCX/TXT version.` });
  const errors = flags.some((f) => f.level === "error");
  const confidence: ParseDiagnostics["confidence"] = errors || coverage < 0.65 ? "Low" : coverage >= 0.9 && flags.length <= 2 ? "High" : "Medium";
  return { coverage, unplaced: unplaced.slice(0, 40), flags, confidence, lines: content.length };
}
