import { ProfileSchema, type Profile, type Role, type SkillCategory } from "../types";
import { ontology } from "../ontology/ontology";
import { DATE_RANGE_RE } from "./dates";

const BULLET_RE = /^\s*(?:[•●▪■◦○·*\-–—>\uF000-\uF0FF]|\d+[.)]|o(?=\s+[A-Z]))\s+/;
const SECTION_PATTERNS: [string, RegExp][] = [
  ["summary", /^(?:professional\s+)?(?:summary|profile|(?:career\s+)?objective|about(?:\s+me)?|executive summary)$|^(?:profil|kurzprofil|profiel|profilo)$/i],
  ["ignore", /^(?:personal\s+(?:details|information|data)|declaration|references?|hobbies(?:\s*(?:&|and)\s*interests)?|interests|languages(?:\s+known)?|persönliche daten|referenzen|sprachen)$/i],
  ["experience", /^(?:professional\s+|work\s+|relevant\s+|industry\s+)?(?:experience|employment(?:\s+history)?|work history|career history|professional background)$|^(?:berufserfahrung|beruflicher werdegang|exp[ée]rience professionnelle|exp[ée]riences? professionnelles?|werkervaring|arbetslivserfarenhet|erfarenhet|experiencia (?:profesional|laboral))$/i],
  ["education", /^(?:education|educational\s+qualifications?|academic(?:s| background| qualifications)?|qualifications)$|^(?:ausbildung|bildungsweg|studium|formation|opleiding|utbildning|educaci[óo]n|formaci[óo]n)$/i],
  ["skills", /^(?:(?:technical|core|key)\s+)?(?:skills|competencies|expertise|proficiency|skills\s*(?:&|and)\s*tools|tools\s*(?:&|and)\s*technologies)(?:\s+summary)?$|^(?:kenntnisse|f[äa]higkeiten|it-kenntnisse|comp[ée]tences|vaardigheden|kompetenser|habilidades)$/i],
  ["projects", /^(?:(?:major|key|technical|selected)\s+)?projects$/i],
  ["certifications", /^(?:certifications?|licenses?(?:\s*&\s*certifications?)?|courses|training)$/i],
  ["achievements", /^(?:key\s+|major\s+|notable\s+)?(?:achievements?|accomplishments?|awards?(?:\s*(?:&|and)\s*(?:honou?rs|recognition))?|honou?rs|recognition)$/i],
  ["publications", /^(?:publications?|patents?|papers|patents?\s*(?:&|and)\s*publications?|publications?\s*(?:&|and)\s*patents?)$/i],
];
const TITLE_RE = /\b(engineer|architect|manager|lead|leader|director|consultant|intern|staff|principal|senior|developer|specialist|scientist|head|trainee|associate|analyst|member of technical staff|mts|designer|scrum master|product owner)\b/i;
const LOCATION_HINT = /\b(india|usa|u\.s\.a|united states|uk|united kingdom|germany|netherlands|ireland|france|belgium|austria|switzerland|sweden|singapore|malaysia|remote|bangalore|bengaluru|hyderabad|pune|chennai|noida|delhi|mumbai|austin|san jose|santa clara|san diego|cambridge|munich|dresden|eindhoven|dublin|london|penang|kuala lumpur|ca|tx|or|az|ma)\b/i;
const EMPLOYMENT_TYPE_RE = /\b(full[- ]time|part[- ]time|contract(?:or)?|consultant|freelance|intern(?:ship)?|permanent)\b/i;

export function normalizeText(raw: string): string {
  const t = raw.replace(/\r/g, "").replace(/ /g, " ").replace(/[​⁠]/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  // Box-drawing bars act as separators; pictographs (stars, ticks, icons) carry no text and break PDF fonts.
  return repairHyphenation(t.replace(/[│┃¦]/g, "|").replace(/\p{Extended_Pictographic}\uFE0F?/gu, "").replace(/[ \t]+/g, " "));
}

// Second halves that make a real compound ("corner-case", "UVM-based", "sign-off"); anything else is a line-break split.
const COMPOUND_TAIL = new Set(["based", "level", "case", "off", "side", "aware", "driven", "up", "down", "end", "chip", "silicon", "specific", "free", "critical", "domain", "layer", "speed", "power", "rate", "ready", "grade", "bit", "cycle", "run", "safe", "time", "top", "class", "wide", "facing", "oriented", "centric", "compliant", "proof", "intensive"]);
/**
 * PDF text breaks words at line ends ("re-\ngression", which often arrives as "re- gression"). Rejoin them: a word found elsewhere in
 * this document wins ("validation"), a compound tail keeps its hyphen ("corner-case"), a suspended hyphen stays ("pre- and post-silicon").
 */
export function repairHyphenation(text: string): string {
  const vocab = new Set(text.toLowerCase().match(/\p{L}{4,}/gu) ?? []);
  return text.replace(/(\p{L}+)-(?:[ \t]+|[ \t]*\n[ \t]*)(\p{Ll}{2,})/gu, (m, a: string, b: string) => {
    if (/^(?:and|or|to|nor|vs)$/.test(b)) return m;
    const joined = a + b;
    if (vocab.has(joined.toLowerCase())) return joined;
    if (COMPOUND_TAIL.has(b) || /^[A-Z0-9]{2,}$/.test(a)) return `${a}-${b}`;
    return joined;
  });
}

/** Page furniture repeated by PDF exports: "Page 2 of 3", "P a g e | 2", and contact footers (address/phone/email) after the header. */
function dropPageFurniture(text: string): string {
  let seen = 0;
  return text.split("\n").filter((l) => {
    const t = l.trim();
    if (!t) return true;
    seen++;
    if (/^p\s*a\s*g\s*e\s*\|?\s*\d+(\s*(?:of|\/)\s*\d+)?$/i.test(t) || /^page\s+\d+(\s+of\s+\d+)?$/i.test(t)) return false;
    // After the header block, a short line made of contact details is a footer, not content.
    if (seen > 6 && t.length < 220 && /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(t) && /\+?\d[\d\s-]{7,}\d/.test(t)) return false;
    return true;
  }).join("\n");
}

// Table-style resumes put labels on their own line ("Designation" / value) or inline without a colon ("Designation X, Company Y").
const TABLE_LABEL = /^(designations?|company|employer|organi[sz]ation|duration|period|projects?\s+(?:and|&)\s+responsibilities|project|client)$/i;
const TABLE_INLINE_START = /^(designations?|company|employer|duration|period|projects?\s+(?:and|&)\s+responsibilities|client)\b[:\s]+\S/i;
const TABLE_INLINE = /\b(designations?|company|employer|duration|period|projects?\s+(?:and|&)\s+responsibilities|client)\b(?:[:\s]+|$)/gi;
const EMPTY_VALUE = /^(?:not mentioned|n\/?a|na|none|-+|–)$/i;
type TableField = "title" | "company" | "duration" | "project";
const fieldOf = (label: string): TableField => (/design/i.test(label) ? "title" : /compan|employ|organi/i.test(label) ? "company" : /durat|period/i.test(label) ? "duration" : "project");
/** Rebuild a role header ("Title | Company | dates" + "Project: …") from label/value blocks so the ordinary role parser can read them. */
function collapseTableLabels(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let block: Partial<Record<TableField, string>> | null = null;
  const flushBlock = () => {
    if (!block) return;
    const b = block; block = null;
    const head = [b.title, b.company].filter(Boolean).join(" | ");
    if (b.duration) out.push([head, b.duration].filter(Boolean).join(" | "));
    else if (head) out.push(head);
    if (b.project) out.push(`Project: ${b.project}`);
  };
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim().replace(/:$/, "");
    if (TABLE_LABEL.test(t)) {
      // Bare label: its value is the next non-empty line that is not itself a label or a bullet.
      let j = i + 1; while (j < lines.length && !lines[j].trim()) j++;
      const v = (lines[j] ?? "").trim();
      block ??= {};
      // Column-wise table extraction can put a bullet where a value belongs: only take values that fit the label.
      const f = fieldOf(t);
      const fits = f === "project" ? !STARTS_LIKE_BULLET.test(v) && !SENTENCE_END.test(v) : f === "title" ? TITLE_RE.test(v) || EMPTY_VALUE.test(v) : f === "duration" ? DATE_RANGE_RE.test(v) || EMPTY_VALUE.test(v) : !SENTENCE_END.test(v);
      if (v && fits && !TABLE_LABEL.test(v.replace(/:$/, "")) && !TABLE_INLINE_START.test(v) && !BULLET_RE.test(lines[j])) { if (!EMPTY_VALUE.test(v)) block[f] = v; i = j; }
      continue;
    }
    if (TABLE_INLINE_START.test(t)) {
      block ??= {};
      const marks = [...t.matchAll(TABLE_INLINE)];
      marks.forEach((m, k) => {
        const v = t.slice(m.index! + m[0].length, k + 1 < marks.length ? marks[k + 1].index : undefined).replace(/^[\s,|]+|[\s,|]+$/g, "");
        if (v && !EMPTY_VALUE.test(v)) block![fieldOf(m[1])] = v;
      });
      continue;
    }
    if (block) {
      // A date line right after a label block is the role's duration ("08/2016 – 10/2017 | India").
      if (!block.duration && DATE_RANGE_RE.test(t) && !BULLET_RE.test(lines[i])) { block.duration = t; continue; }
      flushBlock();
    }
    out.push(lines[i]);
  }
  flushBlock();
  return out.join("\n");
}

function sectionOf(line: string): string | null {
  const t = line.replace(/[:\s]+$/, "").replace(/^[#\s]+/, "").trim();
  if (t.length > 60 || t.length < 4) return null;
  // Bilingual headings such as "BERUFSERFAHRUNG / EXPERIENCE": any part may be the known name.
  const candidates = [t, ...t.split(/\s*[\/|]\s*/)].filter((x) => x.length >= 4 && x.length <= 40);
  for (const c of candidates) for (const [k, re] of SECTION_PATTERNS) if (re.test(c)) return k;
  return null;
}

const uid = () => Math.random().toString(36).slice(2, 10);

export function splitSections(text: string): { head: string[]; sections: Record<string, string[]> } {
  const head: string[] = [];
  const sections: Record<string, string[]> = {};
  let cur: string | null = null;
  for (const line of text.split("\n")) {
    const sec = sectionOf(line);
    if (sec && !BULLET_RE.test(line)) { cur = sec; sections[cur] ??= []; continue; }
    if (cur === "ignore") continue;
    (cur ? sections[cur] : head).push(line);
  }
  return { head, sections };
}

function parseIdentity(head: string[], whole: string): Profile["identity"] {
  const email = whole.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? "";
  const phone = whole.slice(0, 1500).match(/(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,5}\)?[\s.-]?){2,4}\d{3,4}/)?.[0]?.trim() ?? "";
  const linkedin = whole.match(/(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[\w\-%]+\/?/i)?.[0] ?? "";
  const github = whole.match(/(?:https?:\/\/)?github\.com\/[\w\-]+/i)?.[0] ?? "";
  const portfolio = whole.match(/https?:\/\/(?!(?:www\.)?(?:linkedin|github)\.)[^\s,;)]+/i)?.[0] ?? "";
  const lines = head.map((l) => l.trim()).filter(Boolean).slice(0, 8);
  const nameOk = (l: string) => !/@|https?:|linkedin|github|\d{3,}/i.test(l) && !/^(?:resume|curriculum vitae|cv|lebenslauf|bio-?data|profile)$/i.test(l.trim()) && l.split(/\s+/).length <= 5 && /^[\p{L}][\p{L}.'\- ]+$/u.test(l) && !TITLE_RE.test(l);
  let name = "";
  for (const l of lines) {
    // "Jordan Fictional — Verification Architect" / "Name | Title": the name is the first segment.
    const first = l.split(/\s+[|–—•·-]\s+|\s*[|•·]\s*/)[0].trim();
    if (nameOk(first)) { name = first; break; }
  }
  let location = "";
  for (const l of lines) {
    for (const part of l.split(/\s+[|•·]\s+|\s{2,}|[|•·]/)) {
      const raw = part.trim().replace(/\s+\d{4,6}(?:-\d{4})?$/, "");
      const segs = raw.split(",").map((x) => x.trim().replace(/^\d{4,6}\s+/, "")).filter(Boolean); // drop postcodes ("80331 Munich")
      for (const take of [3, 2]) {
        const win = segs.slice(-take);
        if (win.length === take && win.length >= 2 && win.every((x) => /^[\p{L} .'-]{2,30}$/u.test(x)) && (LOCATION_HINT.test(win.join(", ")) || take === 3) && !TITLE_RE.test(win.join(" ")) && !/@/.test(win.join(""))) { location = win.join(", "); break; }
      }
      if (location) break;
      if (!location && /^[\p{L} .'-]{3,30}$/u.test(raw) && LOCATION_HINT.test(raw) && !TITLE_RE.test(raw) && raw !== name) { location = raw; break; }
    }
    if (location) break;
  }
  return { name, location, email, phone: phone.length >= 8 ? phone : "", linkedin, github, portfolio };
}

function stripDate(line: string) {
  const m = line.match(DATE_RANGE_RE);
  if (!m) return { rest: line, start: "", end: "" };
  const rest = line.replace(m[0], " ").replace(/\(\s*\)|\[\s*\]/g, " ").replace(/[(|,–—\-\s]+$/g, "").replace(/^[|,–—\-\s]+/, "").replace(/\s+/g, " ").trim();
  return { rest, start: m[1].trim(), end: /^(?:present|current|currently|now|till date|to date|ongoing|heute|bis heute|aktuell|aujourd.hui|actuel|actuellement|heden|nu|nuvarande|pågående|presente|actualidad|hoy)$/i.test(m[2].trim()) ? "Present" : m[2].trim() };
}

function splitHeader(parts: string[]) {
  let title = "", employer = "", location = "", employmentType = "", department = "";
  const rest: string[] = [];
  for (const raw of parts) {
    let p = raw.replace(/^[\s,|–—-]+|[\s,|–—-]+$/g, "");
    if (!p || EMPTY_VALUE.test(p)) continue; // "Not mentioned", "N/A" 
    // Pure employment-type token ("Contract", "Full-time") or a parenthesised one inside a title ("DV Consultant (Contract)").
    const whole = p.match(/^\(?\s*(full[- ]time|part[- ]time|contract(?:or)?|freelance|intern(?:ship)?|permanent)\s*\)?$/i);
    if (whole) { employmentType = whole[1]; continue; }
    const paren = p.match(/\(\s*(full[- ]time|part[- ]time|contract(?:or)?|freelance|permanent)\s*\)/i);
    if (paren) { employmentType = paren[1]; p = p.replace(paren[0], "").replace(/\s+/g, " ").trim(); }
    p = p.replace(/\(\s*$/, "").trim();
    if (p) rest.push(p);
  }
  for (const p of rest) {
    const isInstitution = /universit|institut|college|school|fraunhofer|laborator/i.test(p);
    if (isInstitution && (!employer || DEPARTMENT.test(employer))) { if (employer) department = employer; employer = p.replace(/,\s*[\p{L} ]+$/u, (m) => (LOCATION_HINT.test(m) ? "" : m)).trim(); if (LOCATION_HINT.test(p) && /,/.test(p)) location = location || p.split(",").pop()!.trim(); continue; }
    if (title && TITLE_RE.test(p) && !COMPANY_SUFFIX.test(p) && !LOCATION_HINT.test(p) && p.length < 40) { title = `${title} / ${p}`; continue; } // "SoC Specialist, Scrum Master"
    if (!employer && DEPARTMENT.test(p)) { department = p; continue; } // "Design & Verification" is a team, not the employer
    const isLoc = LOCATION_HINT.test(p) && p.length < 40 && p.split(/\s+/).length <= 3 && !TITLE_RE.test(p);
    if (!title && TITLE_RE.test(p) && !/\b(ltd|inc|corp|gmbh|pvt|llc|sdn|bhd|technologies|semiconductors?|systems|microsystems|devices|electronics|chips|silicon)\b/i.test(p)) title = p;
    else if (isLoc) location = location ? `${location}, ${p}` : p;
    else if (!employer) employer = p;
    else if (title && /^[\p{Lu}][\p{L}.'-]+(?:\s+[\p{Lu}][\p{L}.'-]+){0,2}$/u.test(p) && p.length < 30) location = location ? `${location}, ${p}` : p; // city after employer
  }
  return { title, employer, location, employmentType, department };
}
const COMPANY_SUFFIX = /\b(ltd|inc|corp|gmbh|pvt|llc|sdn|bhd|oy|ab|bv|nv|ag|technologies|semiconductors?|systems|microsystems|devices|electronics|chips|silicon|solutions|services|labs)\b/i;
const DEPARTMENT = /^(?:design\s*(?:&|and)\s*verification|design verification|digital verification(?: group)?|verification(?: group| team)?|engineering|r\s*&\s*d|research(?: and development)?|hardware|silicon engineering)$/i;

// "Qualcomm India Pvt. Ltd." ends with a dot but is not a sentence.
const SENTENCE_END = /(?<!\b(?:Ltd|Inc|Corp|Co|Pvt|Bhd|LLC|Jr|Sr|St|Dr))[.;]$/;
const CONNECTOR_END = /(?:[,\-–(&/]|\b(?:and|or|of|the|to|for|with|in|on|including|across|from|a|an|by|via|using|into|as|at|while))$/i;
/** Is this unbulleted line the rest of the previous bullet? */
function continues(prev: string, t: string, glyphs: boolean): boolean {
  if (STARTS_LIKE_BULLET.test(t)) return false; // "Built and mentored…" is a new bullet even if the previous line was cut off
  if (CONNECTOR_END.test(prev)) return true; // "…protocol monitors," / "…including"
  if (/^[a-z(]/.test(t) && !/[.;!?]$/.test(prev)) return true;
  if (/^[a-z]/.test(t)) return true;
  // In a bulleted list, an unbulleted line under an unfinished bullet is its wrap, unless it reads as a project subtitle.
  return glyphs && !/[.;:!?]$/.test(prev) && !isSubtitle(t);
}
const joinWrapped = (prev: string, t: string) => (/\p{L}-$/u.test(prev) ? repairHyphenation(`${prev} ${t}`) : `${prev} ${t}`);
const STARTS_LIKE_BULLET = /^(?:[A-Z][a-z]+(?:ed|ing)|Led|Built|Own|Drove|Ran|Wrote|Set|Made|Lead|Leading|Owned|Impact|Achieved|Developed|Designed|Created|Verified|Implemented|Responsible|Worked|Helped|Supported|Managed|Mentored|Delivered|Defined|Architected)\b/;
/** A short, title-cased, unpunctuated line inside a role is a project/programme subtitle ("Automotive SerDes Link Verification IP"), not a bullet. */
function isSubtitle(t: string): boolean {
  if (/^project\s*:/i.test(t)) return true;
  if (t.length > 100 || /[.;:!?]$/.test(t) || STARTS_LIKE_BULLET.test(t) || /\d+\s*%/.test(t)) return false;
  const words = t.split(/\s+/).filter((w) => w.length > 3 && !/^(?:with|from|into|over|under|their|this|that|team)$/i.test(w));
  if (words.length < 2) return false;
  return words.filter((w) => /^[\p{Lu}0-9(]/u.test(w)).length / words.length >= 0.7;
}
/** Drop near-identical bullets within one role (the same line pasted twice, or a reworded copy). */
function dedupeInPlace(items: string[]) {
  const toks = (x: string) => new Set(x.toLowerCase().match(/[a-z0-9+#]{3,}/g) ?? []);
  const kept: { t: string; k: Set<string> }[] = [];
  for (const it of items) {
    const k = toks(it);
    const dup = kept.find((o) => { let inter = 0; for (const w of k) if (o.k.has(w)) inter++; return inter / Math.max(1, Math.min(k.size, o.k.size)) >= 0.8; });
    if (dup) { if (it.length > dup.t.length) { dup.t = it; dup.k = k; } continue; } // keep the fuller version
    kept.push({ t: it, k });
  }
  items.splice(0, items.length, ...kept.map((o) => o.t));
}

const ACHIEVEMENT_RE = /(\d+\s?%|\b\d+(?:\.\d+)?\s?x\b|\b(?:reduced|improved|achieved|delivered|saved|increased|accelerated|cut)\b)/i;
const LEAD_RE = /\b(led|lead|leading|managed|mentor(?:ed|ing)?|supervis(?:ed|ing)|team of \d+|guided|coached)\b/i;
const ARCH_RE = /\b(architect(?:ed|ure)?|methodology|framework|reusable)\b/i;
const CUST_RE = /\b(customers?|clients?|customer-facing|stakeholders?)\b/i;

function categorize(text: string, role: Pick<Role, "technologies" | "tools" | "protocols" | "methodologies">) {
  const METHOD = new Set(["Gate-Level Simulation", "Low-Power Verification", "CDC", "RDC", "Emulation", "Continuous Integration", "Fault Injection", "Equivalence Checking", "Formal Verification", "Functional Safety", "Constrained Random Verification", "UVM"]);
  const add = (arr: string[], v: string) => { if (!arr.includes(v)) arr.push(v); };
  for (const h of ontology.findTerms(text)) {
    const e = ontology.get(h.canonical)!;
    if (["Simulator", "Debug Tool", "Tool", "Formal Tool"].includes(e.category)) add(role.tools, e.canonical);
    else if (e.category === "Protocol" || e.category === "SerDes") add(role.protocols, e.canonical);
    else if (METHOD.has(e.canonical)) add(role.methodologies, e.canonical);
    else if (["HDL", "Language", "Scripting", "Processor", "Verification"].includes(e.category)) add(role.technologies, e.canonical);
  }
}

function parseRoles(lines: string[]): Role[] {
  const roles: Role[] = [];
  let cur: { header: string[]; start: string; end: string; body: string[] } | null = null;
  let prev: Role | null = null;
  const flush = () => {
    if (!cur) return;
    // Awards written into a role header ("Engineer, Co | Golden Chip Award Recipient") are achievements, not part of the employer.
    const awards = cur.header.filter((h) => /\b(award|recipient|winner|honou?r(?:ed)?)\b/i.test(h)).map((h) => h.trim());
    const hdr = splitHeader(cur.header.filter((h) => !awards.includes(h.trim())));
    // Header continuation: short non-bullet lines right after the date line (employer / client / location).
    let client = "";
    while (cur.body.length) {
      const t = cur.body[0].trim();
      if (!t) { cur.body.shift(); continue; }
      const cl = t.match(/^(?:client|customer|end customer|project)\s*[:\-–]\s*(.+)$/i);
      if (cl && !BULLET_RE.test(cur.body[0])) { client = cl[1].trim(); cur.body.shift(); continue; }
      if (!BULLET_RE.test(cur.body[0]) && t.length < 80 && !/[.;:]$/.test(t) && (!hdr.employer || !hdr.title || !hdr.location) && !/^[a-z]/.test(t) && t.split(/\s+/).length <= 9) {
        const more = splitHeader(t.split(/\s*[|•·]\s*|\s+[–—]\s+|,\s+(?=[A-Z])/));
        if (!hdr.title && more.title) hdr.title = more.title;
        else if (!hdr.employer && more.employer) hdr.employer = more.employer;
        else if (!more.location) break;
        if (!hdr.location && more.location) hdr.location = more.location;
        if (!hdr.employmentType && more.employmentType) hdr.employmentType = more.employmentType;
        cur.body.shift(); continue;
      }
      break;
    }
    // Promotions at one employer: a title-only header inherits employer/location from the previous role.
    if (!hdr.employer && hdr.title && prev) { hdr.employer = prev.employer; if (!hdr.location) hdr.location = prev.location; }
    const items: string[] = [];
    const subtitles: string[] = [hdr.department, client].filter(Boolean);
    const glyphs = cur.body.some((l) => BULLET_RE.test(l));
    for (const l of cur.body) {
      const t = l.trim();
      if (!t) continue;
      const prevItem = items[items.length - 1];
      if (BULLET_RE.test(l)) items.push(t.replace(BULLET_RE, ""));
      else if (prevItem !== undefined && continues(prevItem, t, glyphs)) items[items.length - 1] = joinWrapped(prevItem, t);
      else if (isSubtitle(t)) subtitles.push(t.replace(/^project\s*:\s*/i, ""));
      else items.push(t);
    }
    client = [...new Set(subtitles)].join(" · ");
    dedupeInPlace(items);
    const role: Role = {
      id: uid(), employer: hdr.employer, client, title: hdr.title, location: hdr.location,
      startDate: cur.start, endDate: cur.end, employmentType: hdr.employmentType,
      responsibilities: [], achievements: [], technologies: [], methodologies: [], protocols: [], tools: [],
      leadership: "", teamSize: "", technicalOwnership: "", architectureOwnership: "", customerFacing: "",
    };
    for (const it of items) (ACHIEVEMENT_RE.test(it) ? role.achievements : role.responsibilities).push(it);
    role.achievements.push(...awards);
    const all = items.join("\n");
    categorize(all, role);
    role.leadership = items.find((i) => LEAD_RE.test(i)) ?? "";
    role.teamSize = all.match(/team of (\d+)/i)?.[0] ?? "";
    role.architectureOwnership = items.find((i) => ARCH_RE.test(i)) ?? "";
    role.technicalOwnership = items.find((i) => /\b(owned|ownership|responsible for|end-to-end)\b/i.test(i)) ?? "";
    role.customerFacing = items.find((i) => CUST_RE.test(i)) ?? "";
    roles.push(role); prev = role;
  };
  const lead: string[] = []; // non-bullet lines seen before the first dated header
  const HDR_SPLIT = /\s*[|•·│]\s*|\s+[–—]\s+|\s+@\s+|\s+at\s+|,\s+(?=[A-Z])/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!cur && line.trim() && !DATE_RANGE_RE.test(line)) { lead.push(line.trim()); continue; }
    if (!line.trim()) { cur?.body.push(line); continue; }
    if (!BULLET_RE.test(line) && DATE_RANGE_RE.test(line)) {
      const { rest, start, end } = stripDate(line);
      // header = preceding unbullet lines that the previous role has not claimed (max 2) + remainder of this line
      const pre: string[] = [];
      if (!cur) pre.push(...lead.splice(0).slice(-2));
      else {
        while (cur.body.length) {
          const last = cur.body[cur.body.length - 1];
          if (!last.trim()) { cur.body.pop(); continue; }
          if (BULLET_RE.test(last) || pre.length >= 2 || last.trim().length > 90 || SENTENCE_END.test(last.trim())) break;
          pre.unshift(cur.body.pop()!.trim());
          if (rest.length > 3) break;
        }
      }
      flush();
      const headerParts = [...pre, rest].flatMap((p) => p.split(HDR_SPLIT));
      cur = { header: headerParts, start, end, body: [] };
    } else if (cur) cur.body.push(line);
  }
  flush();
  return roles;
}

const QUALIFIER = /\s*\((?:exposure|basic|beginner|familiar|familiarity|working knowledge|learning|academic|intermediate|expert|advanced)\)/i;
const LABEL_WORD = /^(?:debug(?:ging)?|formal|verification|simulation|tools?|languages?|methodolog(?:y|ies)|environment|programming)$/i;
const SOFT_CATEGORIES = new Set(["Leadership", "Management", "Soft", "Customer"]);
const JOB_TITLE = /\b(engineer|consultant|manager|specialist|director|intern|trainee|recipient|architect)\b\s*(?:[—–-].*)?$/i;

function parseSkills(lines: string[], whole: string): Profile["skills"] {
  const out: Profile["skills"] = { languages: [], verification: [], formal: [], processor: [], protocols: [], domains: [], tools: [], methodologies: [] };
  // Same skill in different spellings ("System Verilog", "SystemVerilog") is one entry.
  const key = (v: string) => v.replace(QUALIFIER, "").toLowerCase().replace(/[^a-z0-9+#]/g, "");
  const add = (cat: SkillCategory, v: string) => { const t = v.trim().replace(/[.;]$/, ""); if (t && t.length < 60 && !Object.values(out).some((xs) => xs.some((x) => key(x) === key(t)))) out[cat].push(t); };
  const catOf = (term: string): SkillCategory | null => {
    // A skill item must BE a term (e.g. "UVM", "constrained random"), not a sentence that happens to contain one.
    const hits = ontology.findTerms(term);
    if (!hits.length) return null;
    const covered = hits.reduce((n, h) => n + h.surface.length, 0) / Math.max(1, term.replace(QUALIFIER, "").trim().length);
    if (covered < 0.5) return null; // "C-221" (an address) is not the C language
    const e = ontology.get(hits[0].canonical);
    if (!e || SOFT_CATEGORIES.has(e.category)) return null; // leadership etc. is shown through bullets, not a skills list
    const c = e.category;
    if (["HDL", "Language", "Scripting"].includes(c)) return "languages";
    if (["Formal", "Formal Tool"].includes(c)) return "formal";
    if (c === "Processor") return "processor";
    if (["Protocol", "SerDes"].includes(c)) return "protocols";
    if (["Simulator", "Debug Tool", "Tool"].includes(c)) return "tools";
    if (["Domain", "Memory", "Automotive", "Safety", "AI"].includes(c)) return "domains";
    if (["Gate-Level Simulation", "Low-Power Verification", "CDC", "RDC", "Emulation", "Fault Injection", "Equivalence Checking"].includes(e.canonical)) return "methodologies";
    return "verification";
  };
  const text = lines.join("\n");
  if (text.trim()) {
    for (const raw of lines) {
      const l = raw.replace(BULLET_RE, "").trim();
      if (!l) continue;
      const body = l.includes(":") ? l.slice(l.indexOf(":") + 1) : l;
      for (const item of body.split(/[,;•|]|\s{2,}|\s\/\s/)) {
        const t = item.trim();
        if (!t || JOB_TITLE.test(t)) continue; // "Lead Verification Engineer" is a title, not a skill
        const qual = QUALIFIER.exec(t)?.[0] ?? "";
        const bare = t.replace(QUALIFIER, "").trim();
        const hits = ontology.findTerms(bare);
        if (!hits.length) continue;
        const covered = hits.reduce((n, h) => n + h.surface.length, 0) / Math.max(1, bare.length);
        if (hits.length === 1 && covered >= 0.85) { const c = catOf(t); if (c) add(c, t); continue; }
        // Table sub-labels ride along in DOCX/PDF text ("Languages System Verilog", "Simulation & Debug VCS"): keep the skills only,
        // and only when nothing but a word label precedes them and nothing follows ("C-221" is an address, not C).
        const lead = bare.slice(0, hits[0].index).trim(), last = hits[hits.length - 1];
        if (bare.slice(last.index + last.surface.length).trim() || !/^[\p{L}&/ ]*$/u.test(lead)) continue;
        const best = new Map<string, string>();
        for (const h of hits) if (!LABEL_WORD.test(h.surface) && (best.get(h.canonical)?.length ?? 0) < h.surface.length) best.set(h.canonical, h.surface);
        for (const surface of best.values()) { const c = catOf(surface); if (c) add(c, `${surface}${qual}`); }
      }
    }
  }
  if (!Object.values(out).some((a) => a.length)) {
    // No skills section: fall back to ontology terms found anywhere (stored with canonical names).
    const SOFT = new Set(["Leadership", "Management", "Soft", "Architecture", "Customer", "AI"]);
    for (const h of ontology.findTerms(whole)) { const e = ontology.get(h.canonical)!; if (SOFT.has(e.category) || e.type === "planning" || e.type === "debugging") continue; const c = catOf(h.canonical); if (c) add(c, h.canonical); }
  }
  return out;
}

function parseEducation(lines: string[]): { education: Profile["education"]; certifications: string[] } {
  const out: Profile["education"] = [];
  const certs: string[] = [];
  // "Master" alone is not a degree ("Scrum Master"); "Master of Science", "Master's", "M.Sc." are.
  const DEG = /\b(b\.?\s?e\.?|b\.?\s?eng|m\.?\s?eng|b\.?\s?tech|m\.?\s?tech|b\.?\s?sc|m\.?\s?sc|b\.?\s?s\.?|m\.?\s?s\.?|ph\.?d|bachelor(?:'?s)?|master(?:'?s|\s+of)|diploma|mba|doctorate)\b/i;
  const CERT = /\b(scrum|certified|certification|certificate|course|training|bootcamp|nanodegree|pmp|safe agilist)\b/i;
  const uniKey = (u: string) => u.toLowerCase().replace(/[^\p{L}0-9]/gu, "");
  for (const raw of lines) {
    let l = raw.replace(BULLET_RE, "").trim();
    if (!l) continue;
    // Commentary pasted into the section (several sentences, quotes, "X: explanation") is not an education entry.
    if (l.length > 140 || /[.!?]\s+\p{L}.*[.!?]/u.test(l) || /['"‘“].{6,}['"’”]/.test(l) || /^[^,]{3,60}:\s+\S/.test(l) && !DEG.test(l.split(":")[0])) continue;
    if (CERT.test(l) && !DEG.test(l)) { certs.push(l); continue; }
    const year = l.match(/(?:19|20)\d{2}(?!.*(?:19|20)\d{2})/)?.[0] ?? "";
    l = l.replace(DATE_RANGE_RE, " ").replace(/^\s*(?:19|20)\d{2}\s*[-–—]\s*(?:19|20)\d{2}\s+/, "").trim();
    if (DEG.test(l) || /universit|institute|college|school/i.test(l)) {
      const parts = l.split(/\s*[|,–—]\s*|\s+-\s+/).filter(Boolean);
      const degree = parts.find((p) => DEG.test(p)) ?? "";
      const university = (parts.find((p) => /universit|institute|college|school/i.test(p)) ?? "").replace(/\s*\(\s*(?:19|20)\d{2}\s*\)\s*$/, "").trim();
      const last = out[out.length - 1];
      if (last && !last.degree && degree && !university) { last.degree = degree; last.year ||= year; continue; }
      if (last && !last.university && university && !degree) { last.university = university; last.year ||= year; continue; }
      // A bare university line repeating one already listed (two-column layouts, page headers) adds nothing.
      if (!degree && university) { const same = out.find((e) => uniKey(e.university) === uniKey(university)); if (same) { same.year ||= year; continue; } if (!year) continue; }
      out.push({ degree, university, specialization: l.match(/\b(?:in|specializ\w+ in)\s+([A-Z][\w &]+?)(?:[,|(]|$)/)?.[1] ?? "", year });
    }
  }
  // A degree with neither institution nor year ("B.E. / B.Tech") is a template placeholder, not an entry.
  return { education: out.filter((e) => e.university || e.year), certifications: certs };
}

function parseProjects(lines: string[]): Profile["projects"] {
  const out: Profile["projects"] = [];
  let cur: Profile["projects"][number] | null = null;
  for (const raw of lines) {
    const t = raw.trim();
    if (!t) continue;
    if (BULLET_RE.test(raw)) {
      const b = t.replace(BULLET_RE, "");
      if (!cur) { cur = { id: uid(), name: "", employer: "", period: "", summary: "", highlights: [], technologies: [] }; out.push(cur); }
      if (/^[a-z(]/.test(b) && cur.highlights.length) cur.highlights[cur.highlights.length - 1] += " " + b; else cur.highlights.push(b);
    } else if (cur && cur.highlights.length && /^[a-z]/.test(t)) cur.highlights[cur.highlights.length - 1] += " " + t; // wrapped
    else if (t.length < 110 && !/[.;]$/.test(t)) {
      // Project title line: "Name | Employer | 2021 – 2022" / "Name (2021)" / "Name — Employer"
      const dr = t.match(DATE_RANGE_RE);
      const period = dr ? dr[0] : t.match(/\b(?:19|20)\d{2}\b/)?.[0] ?? "";
      const head = t.replace(DATE_RANGE_RE, " ").replace(/\(\s*\)/g, " ").replace(/\s+/g, " ").trim();
      const parts = head.split(/\s*[|–—]\s*|\s+-\s+/).map((x) => x.replace(/^[(\s]+|[)\s,]+$/g, "")).filter(Boolean);
      cur = { id: uid(), name: parts[0] ?? head, employer: parts[1] ?? "", period, summary: "", highlights: [], technologies: [] };
      out.push(cur);
    } else if (cur && !cur.summary && !cur.highlights.length) cur.summary = t;
    else if (cur) cur.highlights.push(t);
  }
  for (const p of out) {
    const tmp = { technologies: [] as string[], tools: [] as string[], protocols: [] as string[], methodologies: [] as string[] };
    categorize([p.summary, ...p.highlights].join("\n"), tmp);
    p.technologies = [...new Set([...tmp.tools, ...tmp.protocols, ...tmp.technologies, ...tmp.methodologies])];
  }
  return out.filter((p) => p.name || p.highlights.length);
}

/**
 * Plain-text two-column layouts ("SKILLS      EXPERIENCE"): split at a shared gutter and read the left column, then the right.
 * Only applied when most multi-segment lines share one gutter position, so ordinary right-aligned dates are untouched.
 */
export function deinterleaveColumns(raw: string): string {
  const lines = raw.replace(/\r/g, "").split("\n");
  const gap = /\S( {3,}|\t+)(?=\S)/g;
  const votes = new Map<number, number>();
  let content = 0;
  const gutters = (l: string) => [...l.matchAll(gap)].map((m) => ({ at: m.index! + 1, end: m.index! + 1 + m[1].length })).filter((g) => { const right = l.slice(g.end); return !DATE_RANGE_RE.test(right.slice(0, 20)) && !/^\(?(?:19|20)\d{2}/.test(right.trim()) && right.trim().length > 8; });
  for (const l of lines) {
    if (!l.trim()) continue;
    content++;
    for (const g of gutters(l)) votes.set(Math.round(g.end / 2), (votes.get(Math.round(g.end / 2)) ?? 0) + 1);
  }
  if (content < 8 || !votes.size) return raw;
  const [bucket, n] = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
  if (n < Math.max(5, content * 0.3)) return raw;
  const g = bucket * 2;
  const near = (idx: number) => Math.abs(idx - g) <= 4;
  const left: string[] = [], right: string[] = [];
  for (const l of lines) {
    const hit = gutters(l).find((x) => near(x.end));
    if (hit) { left.push(l.slice(0, hit.at).trimEnd()); right.push(l.slice(hit.end)); }
    else if (l.trim() && l.search(/\S/) >= g - 4) right.push(l.trim());
    else left.push(l);
  }
  return [...left, "", ...right].join("\n");
}

const LABELS = /^\s*(?:company|employer|organi[sz]ation|designation|position|role|job title|title|duration|period|tenure|location|responsibilities|roles? (?:and|&) responsibilities|name|mobile|phone|contact|email|e-mail|address)\s*[:–-]\s*/i;
/** "Company: X / Designation: Y / Duration: A to B" blocks become ordinary header lines. */
function normalizeLabels(text: string): string {
  const out: string[] = [];
  for (const l of text.split("\n")) {
    const lab = l.match(LABELS)?.[0].toLowerCase() ?? "";
    if (/responsibilities|roles?\s/.test(lab) && !l.replace(LABELS, "").trim()) continue; // bare "Responsibilities:" line
    out.push(lab && !/(?:mobile|phone|contact|email|e-mail|address|name)/.test(lab) ? l.replace(LABELS, "") : l.replace(/^\s*(?:name|mobile|phone|contact|email|e-mail|address)\s*[:–-]\s*/i, ""));
  }
  return out.join("\n");
}

export function parseResumeHeuristic(rawIn: string): Profile {
  const raw = deinterleaveColumns(rawIn);
  const text = normalizeLabels(collapseTableLabels(dropPageFurniture(normalizeText(raw))));
  const { head, sections } = splitSections(text);
  const roles = parseRoles(sections.experience ?? []);
  const edu = parseEducation(sections.education ?? []);
  const profile: Profile = {
    identity: parseIdentity(head, text),
    summary: (sections.summary ?? []).join(" ").replace(/\s+/g, " ").trim(),
    roles,
    education: edu.education,
    skills: parseSkills(sections.skills ?? [], text),
    certifications: [...new Set([...(sections.certifications ?? []).map((l) => l.replace(BULLET_RE, "").trim()).filter(Boolean), ...edu.certifications])],
    publications: (sections.publications ?? []).map((l) => l.replace(BULLET_RE, "").trim()).filter(Boolean),
    projects: parseProjects(sections.projects ?? []),
    achievements: (sections.achievements ?? []).map((l) => l.replace(BULLET_RE, "").trim()).filter(Boolean),
  };
  return ProfileSchema.parse(profile);
}
