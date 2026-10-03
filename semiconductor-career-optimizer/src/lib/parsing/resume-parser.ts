import { ProfileSchema, type Profile, type Role, type SkillCategory } from "../types";
import { ontology } from "../ontology/ontology";
import { DATE_RANGE_RE } from "./dates";

const BULLET_RE = /^\s*(?:[•●▪■◦○·*\-–—>\uF000-\uF0FF]|\d+[.)]|o(?=\s+[A-Z]))\s+/;
const SECTION_PATTERNS: [string, RegExp][] = [
  ["summary", /^(?:professional\s+)?(?:summary|profile|objective|about(?:\s+me)?|executive summary)$/i],
  ["experience", /^(?:professional\s+|work\s+|relevant\s+|industry\s+)?(?:experience|employment(?:\s+history)?|work history|career history|professional background)$/i],
  ["education", /^(?:education|academic(?:s| background| qualifications)?|qualifications)$/i],
  ["skills", /^(?:(?:technical|core|key)\s+)?(?:skills|competencies|expertise|proficiency|skills\s*(?:&|and)\s*tools|tools\s*(?:&|and)\s*technologies)(?:\s+summary)?$/i],
  ["projects", /^(?:(?:major|key|technical|selected)\s+)?projects$/i],
  ["certifications", /^(?:certifications?|licenses?(?:\s*&\s*certifications?)?|courses|training)$/i],
  ["achievements", /^(?:key\s+|major\s+|notable\s+)?(?:achievements?|accomplishments?|awards?(?:\s*(?:&|and)\s*(?:honou?rs|recognition))?|honou?rs|recognition)$/i],
  ["publications", /^(?:publications?|patents?|papers|patents?\s*(?:&|and)\s*publications?)$/i],
];
const TITLE_RE = /\b(engineer|architect|manager|lead|director|consultant|intern|staff|principal|senior|developer|specialist|scientist|head|trainee|associate|analyst|member of technical staff|mts|designer)\b/i;
const LOCATION_HINT = /\b(india|usa|u\.s\.a|united states|uk|united kingdom|germany|netherlands|ireland|france|belgium|austria|switzerland|sweden|singapore|malaysia|remote|bangalore|bengaluru|hyderabad|pune|chennai|noida|delhi|mumbai|austin|san jose|santa clara|san diego|cambridge|munich|dresden|eindhoven|dublin|london|penang|kuala lumpur|ca|tx|or|az|ma)\b/i;
const EMPLOYMENT_TYPE_RE = /\b(full[- ]time|part[- ]time|contract(?:or)?|consultant|freelance|intern(?:ship)?|permanent)\b/i;

export function normalizeText(raw: string): string {
  return raw.replace(/\r/g, "").replace(/ /g, " ").replace(/[​⁠]/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function sectionOf(line: string): string | null {
  const t = line.replace(/[:\s]+$/, "").replace(/^[#\s]+/, "").trim();
  if (t.length > 40 || t.length < 4) return null;
  for (const [k, re] of SECTION_PATTERNS) if (re.test(t)) return k;
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
  const nameOk = (l: string) => !/@|https?:|linkedin|github|\d{3,}/i.test(l) && l.split(/\s+/).length <= 5 && /^[\p{L}][\p{L}.'\- ]+$/u.test(l) && !TITLE_RE.test(l);
  let name = "";
  for (const l of lines) {
    // "Jordan Fictional — Verification Architect" / "Name | Title": the name is the first segment.
    const first = l.split(/\s+[|–—•·-]\s+|\s*[|•·]\s*/)[0].trim();
    if (nameOk(first)) { name = first; break; }
  }
  let location = "";
  for (const l of lines) {
    for (const part of l.split(/\s+[|•·]\s+|\s{2,}|[|•·]/)) {
      const p = part.trim().replace(/\s+\d{4,6}(?:-\d{4})?$/, ""); // drop ZIP / postcode
      const segs = p.split(",").map((x) => x.trim());
      if (segs.length >= 2 && segs.length <= 3 && segs.every((x) => /^[\p{L} .'-]{2,30}$/u.test(x)) && (LOCATION_HINT.test(p) || segs.length === 3) && !TITLE_RE.test(p) && !/@|\d/.test(p)) { location = p; break; }
      if (!location && /^[\p{L} .'-]{3,30}$/u.test(p) && LOCATION_HINT.test(p) && !TITLE_RE.test(p) && p !== name) { location = p; break; }
    }
    if (location) break;
  }
  return { name, location, email, phone: phone.length >= 8 ? phone : "", linkedin, github, portfolio };
}

function stripDate(line: string) {
  const m = line.match(DATE_RANGE_RE);
  if (!m) return { rest: line, start: "", end: "" };
  const rest = line.replace(m[0], " ").replace(/\(\s*\)|\[\s*\]/g, " ").replace(/[(|,–—\-\s]+$/g, "").replace(/^[|,–—\-\s]+/, "").replace(/\s+/g, " ").trim();
  return { rest, start: m[1].trim(), end: /present|current|now|till|to date|ongoing/i.test(m[2]) ? "Present" : m[2].trim() };
}

function splitHeader(parts: string[]) {
  let title = "", employer = "", location = "", employmentType = "";
  const rest: string[] = [];
  for (const raw of parts) {
    let p = raw.replace(/^[\s,|–—-]+|[\s,|–—-]+$/g, "");
    if (!p) continue;
    // Pure employment-type token ("Contract", "Full-time") or a parenthesised one inside a title ("DV Consultant (Contract)").
    const whole = p.match(/^\(?\s*(full[- ]time|part[- ]time|contract(?:or)?|freelance|intern(?:ship)?|permanent)\s*\)?$/i);
    if (whole) { employmentType = whole[1]; continue; }
    const paren = p.match(/\(\s*(full[- ]time|part[- ]time|contract(?:or)?|freelance|permanent)\s*\)/i);
    if (paren) { employmentType = paren[1]; p = p.replace(paren[0], "").replace(/\s+/g, " ").trim(); }
    p = p.replace(/\(\s*$/, "").trim();
    if (p) rest.push(p);
  }
  for (const p of rest) {
    const isLoc = LOCATION_HINT.test(p) && p.length < 40 && p.split(/\s+/).length <= 3 && !TITLE_RE.test(p);
    if (!title && TITLE_RE.test(p) && !/\b(ltd|inc|corp|gmbh|pvt|llc|sdn|bhd|technologies|semiconductors?|systems|microsystems|devices|electronics|chips|silicon)\b/i.test(p)) title = p;
    else if (isLoc) location = location ? `${location}, ${p}` : p;
    else if (!employer) employer = p;
  }
  return { title, employer, location, employmentType };
}

const ACHIEVEMENT_RE = /(\d+\s?%|\b\d+(?:\.\d+)?\s?x\b|\b(?:reduced|improved|achieved|delivered|saved|increased|accelerated|cut)\b)/i;
const LEAD_RE = /\b(led|lead|leading|managed|mentor(?:ed|ing)?|supervis(?:ed|ing)|team of \d+|guided|coached)\b/i;
const ARCH_RE = /\b(architect(?:ed|ure)?|defined|methodology|framework|reusable|infrastructure|strategy)\b/i;
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
    const hdr = splitHeader(cur.header);
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
    for (const l of cur.body) {
      const t = l.trim();
      if (!t) continue;
      if (BULLET_RE.test(l)) items.push(t.replace(BULLET_RE, ""));
      else if (items.length && !/[.;]$/.test(items[items.length - 1]) && /^[a-z(]/.test(t)) items[items.length - 1] += " " + t; // wrapped line
      else if (items.length && /^[a-z]/.test(t)) items[items.length - 1] += " " + t;
      else items.push(t);
    }
    const role: Role = {
      id: uid(), employer: hdr.employer, client, title: hdr.title, location: hdr.location,
      startDate: cur.start, endDate: cur.end, employmentType: hdr.employmentType,
      responsibilities: [], achievements: [], technologies: [], methodologies: [], protocols: [], tools: [],
      leadership: "", teamSize: "", technicalOwnership: "", architectureOwnership: "", customerFacing: "",
    };
    for (const it of items) (ACHIEVEMENT_RE.test(it) ? role.achievements : role.responsibilities).push(it);
    const all = items.join("\n");
    categorize(all, role);
    role.leadership = items.find((i) => LEAD_RE.test(i)) ?? "";
    role.teamSize = all.match(/team of (\d+)/i)?.[0] ?? "";
    role.architectureOwnership = items.find((i) => ARCH_RE.test(i) && /architect|methodology|framework|strategy|reusable/i.test(i)) ?? "";
    role.technicalOwnership = items.find((i) => /\b(owned|ownership|responsible for|end-to-end)\b/i.test(i)) ?? "";
    role.customerFacing = items.find((i) => CUST_RE.test(i)) ?? "";
    roles.push(role); prev = role;
  };
  const lead: string[] = []; // non-bullet lines seen before the first dated header
  const HDR_SPLIT = /\s*[|•·]\s*|\s+[–—]\s+|\s+@\s+|\s+at\s+|,\s+(?=[A-Z])/;
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
          if (BULLET_RE.test(last) || pre.length >= 2 || last.trim().length > 90 || /[.;]$/.test(last.trim())) break;
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

function parseSkills(lines: string[], whole: string): Profile["skills"] {
  const out: Profile["skills"] = { languages: [], verification: [], formal: [], processor: [], protocols: [], domains: [], tools: [], methodologies: [] };
  const add = (cat: SkillCategory, v: string) => { const t = v.trim().replace(/[.;]$/, ""); if (t && t.length < 60 && !out[cat].some((x) => x.toLowerCase() === t.toLowerCase())) out[cat].push(t); };
  const catOf = (term: string): SkillCategory | null => {
    const e = ontology.resolve(term);
    if (!e) return null;
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
        if (!t) continue;
        const c = catOf(t);
        if (c) add(c, t);
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

function parseEducation(lines: string[]) {
  const out: Profile["education"] = [];
  const DEG = /\b(b\.?\s?e\.?|b\.?\s?eng|m\.?\s?eng|b\.?\s?tech|m\.?\s?tech|b\.?\s?sc|m\.?\s?sc|b\.?\s?s\.?|m\.?\s?s\.?|ph\.?d|bachelor|master|diploma|mba)\b/i;
  for (const raw of lines) {
    const l = raw.replace(BULLET_RE, "").trim();
    if (!l) continue;
    const year = l.match(/(?:19|20)\d{2}(?!.*(?:19|20)\d{2})/)?.[0] ?? "";
    if (DEG.test(l) || /universit|institute|college|school/i.test(l)) {
      const parts = l.split(/\s*[|,–—]\s*|\s+-\s+/).filter(Boolean);
      const degree = parts.find((p) => DEG.test(p)) ?? "";
      const university = (parts.find((p) => /universit|institute|college|school/i.test(p)) ?? "").replace(/\s*\(\s*(?:19|20)\d{2}\s*\)\s*$/, "").trim();
      const last = out[out.length - 1];
      if (last && !last.degree && degree && !university) { last.degree = degree; last.year ||= year; continue; }
      if (last && !last.university && university && !degree) { last.university = university; last.year ||= year; continue; }
      out.push({ degree, university, specialization: l.match(/\b(?:in|specializ\w+ in)\s+([A-Z][\w &]+?)(?:[,|(]|$)/)?.[1] ?? "", year });
    }
  }
  return out;
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

export function parseResumeHeuristic(raw: string): Profile {
  const text = normalizeText(raw);
  const { head, sections } = splitSections(text);
  const roles = parseRoles(sections.experience ?? []);
  const profile: Profile = {
    identity: parseIdentity(head, text),
    summary: (sections.summary ?? []).join(" ").replace(/\s+/g, " ").trim(),
    roles,
    education: parseEducation(sections.education ?? []),
    skills: parseSkills(sections.skills ?? [], text),
    certifications: (sections.certifications ?? []).map((l) => l.replace(BULLET_RE, "").trim()).filter(Boolean),
    publications: (sections.publications ?? []).map((l) => l.replace(BULLET_RE, "").trim()).filter(Boolean),
    projects: parseProjects(sections.projects ?? []),
    achievements: (sections.achievements ?? []).map((l) => l.replace(BULLET_RE, "").trim()).filter(Boolean),
  };
  return ProfileSchema.parse(profile);
}
