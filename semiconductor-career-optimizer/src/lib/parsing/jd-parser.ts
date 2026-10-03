import { ParsedJDSchema, type ParsedJD, type ReqImportance, type ReqType, type Requirement } from "../types";
import { ontology } from "../ontology/ontology";
import { normalizeText } from "./resume-parser";

type Ctx = "required" | "preferred" | "responsibilities" | "boilerplate" | "administrative" | "none";

const HEADINGS: [Ctx, RegExp][] = [
  ["preferred", /^(?:preferred|nice[- ]to[- ]have|desirable|bonus|a plus|good to have|additional (?:skills|qualifications)|preferred (?:qualifications|skills|experience))\b/i],
  ["required", /^(?:requirements?|qualifications?|minimum (?:qualifications|requirements)|basic qualifications|must[- ]have|what you(?:'|’)ll need|what we(?:'|’)re looking for|skills|required (?:skills|qualifications|experience)|who you are|your profile|key requirements|you should have|you have|what you bring|what we need|your (?:skills|experience|qualifications)|the ideal candidate)\b/i],
  ["responsibilities", /^(?:responsibilities|what you(?:'|’)ll do|the role|role|key responsibilities|duties|job description|about the role|your role|in this role|you will)\b/i],
  ["boilerplate", /^(?:about (?:us|the company|[A-Z][\w ]+)|who we are|benefits|what we offer|why join|perks|equal opportunity|eeo|our (?:culture|values|mission)|compensation|salary|diversity)\b/i],
];
const BULLET_RE = /^\s*(?:[•●▪■◦○·*\-–—>]|\d+[.)])\s+/;
const PREFERRED_CUE = /\b(preferred|a plus|nice to have|bonus|desirable|ideally|advantage|good to have|is a plus|would be (?:an? )?(?:plus|asset|advantage)|familiarity)\b/i;
const MANDATORY_CUE = /\b(required|must|minimum|proficien\w+|strong|expert\w*|hands[- ]on|solid|deep|extensive|proven|demonstrated|in-depth|need to|should have|experience (?:in|with|of))\b/i;
const ADMIN_RE = /\b(citizen\w*|work authori[sz]ation|visa|sponsorship|security clearance|background check|eligible to work|right to work|relocat\w+|export control|ITAR|travel|on-?site|hybrid|remote work)\b/i;
const BOILER_RE = /\b(equal opportunity|we offer|competitive (?:salary|compensation)|health insurance|401\(?k\)?|paid time off|our mission|fast-paced|dynamic environment|apply now|about us|diversity|inclusive|benefits)\b/i;
const TITLE_WORDS = /\b(engineer|architect|manager|lead|director|consultant|specialist|scientist|head)\b/i;

function ctxOf(line: string): Ctx | null {
  const t = line.replace(/[:\s]+$/, "").replace(/^[#*\s]+/, "").trim();
  if (t.length > 60 || BULLET_RE.test(line)) return null;
  if (t.split(/\s+/).length > 7 && !line.trim().endsWith(":")) return null;
  for (const [c, re] of HEADINGS) if (re.test(t)) return c;
  return null;
}

const RANK: Record<ReqImportance, number> = { mandatory: 4, implied: 3, preferred: 2, administrative: 1, boilerplate: 0 };

function inferType(term: string): ReqType { return ontology.get(term)?.type ?? "other"; }

function detectSeniority(title: string): ParsedJD["seniority"] {
  if (/principal|distinguished|fellow/i.test(title)) return "Principal";
  if (/\bstaff\b/i.test(title)) return "Staff";
  if (/architect/i.test(title)) return "Architect";
  if (/manager|director|head of/i.test(title)) return "Manager";
  if (/\blead\b/i.test(title)) return "Lead";
  if (/\bsenior\b|\bsr\.?\b|\biii\b/i.test(title)) return "Senior";
  if (/engineer/i.test(title)) return "Engineer";
  return "Unspecified";
}

export function parseJobDescriptionHeuristic(raw: string, hints: { company?: string; title?: string } = {}): ParsedJD {
  const text = normalizeText(raw);
  const lines = text.split("\n");
  const first = lines.map((l) => l.trim()).filter(Boolean).slice(0, 6);

  const labelled = (re: RegExp) => text.match(re)?.[1]?.trim().replace(/[.;]$/, "") ?? "";
  let roleTitle = hints.title || labelled(/(?:job title|position|role|title)\s*[:\-–]\s*([^\n]{3,90})/i) ||
    first.find((l) => TITLE_WORDS.test(l) && l.length < 90 && !/\b(we|you|our|the)\b/i.test(l.split(/\s+/).slice(0, 2).join(" "))) || "";
  roleTitle = roleTitle.replace(/\s*[-–|]\s*(?:req|job)?\s*#?\w*\d{4,}\w*$/i, "").trim();
  roleTitle = roleTitle.replace(/\s*\((?:[mfwdx]\s*\/\s*){1,3}[mfwdx]\)|\s*\(all genders\)/gi, "").trim(); // German "(m/f/d)" markers
  let company = hints.company || labelled(/(?:company|employer|organi[sz]ation)\s*[:\-–]\s*([^\n]{2,60})/i);
  if (!company) company = text.match(/^\s*about\s+(?!us\b|the\b)([A-Z][A-Za-z0-9&.\-]+(?:\s+[A-Z][A-Za-z0-9&.\-]+){0,3})\s*$/m)?.[1] ?? "";
  if (!company && first[1] && !/^[A-Z][a-z]+(?: [A-Z][a-z]+)?,\s*[A-Z]{2}\b|^(?:remote|hybrid|on-?site)\b/i.test(first[1])) {
    // Line 2 is usually "Company — City" / "Company | City" / "Company, City" / "Company (Remote)": keep the head.
    const c = first[1].split(/\s+[—–|-]\s+|\s*\(|,\s+/)[0].trim();
    if (c.length > 1 && c.length < 50 && !/[:;]|\.\s/.test(c) && !TITLE_WORDS.test(c) && /^[A-Z]/.test(c)) company = c;
  }
  if (!company) company = text.match(/\b(?:join|about|at)\s+([A-Z][A-Za-z0-9&.\-]+(?:\s+[A-Z][A-Za-z0-9&.\-]+){0,3})(?=[\s,.:;!]|$)/)?.[1] ?? "";
  if (/^(?:the|our|us|this|a|an|you)$/i.test(company)) company = "";
  const location = labelled(/location\s*[:\-–]\s*([^\n]{2,80})/i);

  // Requirement collection
  let ctx: Ctx = "none";
  const sentences: { text: string; ctx: Ctx; bullet: boolean }[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const c = ctxOf(line);
    if (c) { ctx = c; continue; }
    const bullet = BULLET_RE.test(line);
    const body = line.replace(BULLET_RE, "").trim();
    const parts = bullet ? [body] : body.split(/(?<=[.;!?])\s+(?=[A-Z])/);
    for (const p of parts) if (p.trim().length > 2) sentences.push({ text: p.trim(), ctx, bullet });
  }

  const reqMap = new Map<string, Requirement>();
  const extra: Requirement[] = [];
  const freq: Record<string, number> = {};
  const leadership: string[] = [], architecture: string[] = [], domains = new Set<string>();
  let yearsRequired: number | null = null, education = "", workAuthorization = "";
  let n = 0;
  const titleTerms = new Set(ontology.findTerms(roleTitle).map((h) => h.canonical));

  for (const s of sentences) {
    let imp: ReqImportance;
    if (ADMIN_RE.test(s.text) && !ontology.findTerms(s.text).length) imp = "administrative";
    else if (s.ctx === "boilerplate" || (BOILER_RE.test(s.text) && !ontology.findTerms(s.text).length)) imp = "boilerplate";
    else if (PREFERRED_CUE.test(s.text) || s.ctx === "preferred") imp = "preferred";
    else if (s.ctx === "required" || MANDATORY_CUE.test(s.text)) imp = "mandatory";
    else if (s.ctx === "responsibilities") imp = "implied";
    else imp = "implied";

    if (imp === "administrative" && /citizen|authori|visa|sponsor|clearance|eligible|right to work/i.test(s.text)) workAuthorization ||= s.text;
    if (imp === "boilerplate" || imp === "administrative") {
      if (imp === "administrative") extra.push({ id: `r${++n}`, text: s.text, context: s.text, importance: imp, type: "other", terms: [], weight: 0 });
      continue;
    }

    const yrs = s.text.match(/(\d{1,2})\s*\+?\s*(?:-\s*\d{1,2}\s*)?(?:\+\s*)?(?:years?|yrs?)/i);
    if (yrs && /experience|years/i.test(s.text)) {
      const y = +yrs[1];
      if (y > 0 && y < 40) {
        if (imp !== "preferred") yearsRequired = yearsRequired === null ? y : Math.max(yearsRequired, y);
        extra.push({ id: `r${++n}`, text: `${y}+ years of experience`, context: s.text, importance: imp === "implied" ? "mandatory" : imp, type: "experience", terms: [], weight: 2 });
      }
    }
    const edu = s.text.match(/\b(bachelor\w*|master\w*|ph\.?d\.?|b\.?\s?tech|m\.?\s?tech|bs|ms|degree)\b[^.;]*/i);
    if (edu && /degree|bachelor|master|ph\.?d|b\.?tech|m\.?tech|\bBS\b|\bMS\b/i.test(edu[0]) && /electr|electron|computer|engineering|VLSI|science|degree|related/i.test(s.text)) {
      education ||= s.text.slice(0, 160);
      extra.push({ id: `r${++n}`, text: s.text.slice(0, 160), context: s.text, importance: imp === "implied" ? "mandatory" : imp, type: "education", terms: [], weight: 1 });
    }

    for (const h of ontology.findTerms(s.text)) {
      const entry = ontology.get(h.canonical)!;
      freq[h.canonical] = (freq[h.canonical] ?? 0) + 1;
      let termImp = imp;
      if (titleTerms.has(h.canonical)) termImp = "mandatory";
      const key = h.canonical;
      const prev = reqMap.get(key);
      if (!prev || RANK[termImp] > RANK[prev.importance]) {
        reqMap.set(key, { id: prev?.id ?? `r${++n}`, text: key, context: s.text, importance: termImp, type: inferType(key), terms: [key], weight: 1 });
      }
      if (entry.type === "leadership" || entry.type === "management") leadership.push(s.text);
      if (entry.type === "architecture" || entry.type === "planning") architecture.push(s.text);
      if (entry.type === "domain" || entry.type === "processor") domains.add(key);
    }
  }
  // Title terms always count even when absent from the body.
  for (const t of titleTerms) if (!reqMap.has(t)) reqMap.set(t, { id: `r${++n}`, text: t, context: roleTitle, importance: "mandatory", type: inferType(t), terms: [t], weight: 1 });

  const WEIGHT: Record<ReqImportance, number> = { mandatory: 3, implied: 1.5, preferred: 1, administrative: 0, boilerplate: 0 };
  const requirements = [...reqMap.values(), ...extra].map((r) => ({ ...r, weight: r.type === "experience" ? 2 : WEIGHT[r.importance] }));
  requirements.sort((a, b) => RANK[b.importance] - RANK[a.importance] || (freq[b.text] ?? 0) - (freq[a.text] ?? 0));

  return ParsedJDSchema.parse({
    roleTitle, company, location,
    seniority: detectSeniority(roleTitle || text.slice(0, 200)),
    yearsRequired, education, workAuthorization,
    requirements, keywordFrequency: freq,
    leadershipExpectations: [...new Set(leadership)].slice(0, 6),
    architectureExpectations: [...new Set(architecture)].slice(0, 6),
    domainExpectations: [...domains].slice(0, 12),
  });
}
