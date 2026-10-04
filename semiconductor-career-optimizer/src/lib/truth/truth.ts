import type { ClaimCheck, ClaimStatus, Profile, TailoredResume } from "../types";
import { ontology } from "../ontology/ontology";
import { buildIndex, roleBullets, type ProfileIndex } from "../profile-index";
import { jaccard } from "../matching/bullets";
import { PRESENTATION_TYPES } from "../matching/matcher";

export interface TruthContext {
  index: ProfileIndex;
  roleId?: string; // restrict evidence checks to one role (for experience bullets)
  allowedNames?: string[]; // strings that may appear without being in the profile (JD company, JD role title)
}

const LEADERSHIP_VERB = /\b(led|leading|lead|managed|managing|supervised|headed|directed|mentored|mentoring|coached|spearheaded)\b/i;
const OWNERSHIP_VERB = /\b(owned|architected|defined|established|drove|spearheaded|pioneered|introduced)\b/i;
const CREDENTIAL = /\b(certified|certification|patents?|patented|awards?|awarded|published|publications?|ieee paper|pmp|best paper|fellowship)\b/i;
const TITLE_WORD = /\b(principal|staff|distinguished|architect|manager|director|lead|head of|vice president|vp)\b/i;
const ORG_RE = /\b([A-Z][\w&.-]+(?:\s+[A-Z][\w&.-]+)*\s+(?:Inc\.?|Ltd\.?|LLC|Corp\.?|Corporation|Technologies|Semiconductors?|Systems|Microelectronics|Labs|GmbH|Pvt\.?(?:\s+Ltd\.?)?))/g;
// "5 SoCs", "5 automotive SoCs", "team of 6 engineers": a count of things, up to two adjectives in between.
const COUNT_NOUN = "engineers?|members|people|developers|blocks?|ips?|projects?|tape-?outs?|chips?|socs?|asics?|products?|testcases|tests|designs|customers?|reports?|gates?";
const COUNT_RE = new RegExp(`\\b(?:team of\\s+)?\\d+\\+?\\s+(?:(?!(?:years?|yrs?|months?|in|of|at|on|with|for|and|or|to|across)\\b)[a-z][\\w-]*\\s+){0,2}?(?:${COUNT_NOUN})\\b`, "gi");
const METRIC_RES: RegExp[] = [
  /\b\d+(?:\.\d+)?\s?%/g,
  /\b\d+(?:\.\d+)?\s?x\b/gi,
  COUNT_RE,
  /\bteam of \d+\b/gi,
  /\b\d+(?:\.\d+)?\s?(?:k|m|million|billion)\+?\s+(?:gates?|tests?|lines|transactions)\b/gi,
];
// Degree claims must match a degree level in the profile's education ("PhD" is never backed by an M.Tech).
const DEGREE_LEVELS: [string, RegExp][] = [
  ["doctorate", /(?<![a-z])(?:ph\.?\s?d|doctorate|doctoral|d\.?\s?phil)(?![a-z])/i],
  ["master's degree", /(?<![a-z])(?:masters?|master's|m\.?\s?sc|m\.\s?s\.|ms(?=\s+(?:in|degree|from|\())|m\.?\s?tech|m\.\s?e\.|m\.?\s?eng)(?![a-z])/i],
  ["MBA", /(?<![a-z])m\.?\s?b\.?\s?a(?![a-z])/i],
  ["bachelor's degree", /(?<![a-z])(?:bachelors?|bachelor's|b\.?\s?sc|b\.\s?s\.|bs(?=\s+(?:in|degree|from|\())|b\.?\s?tech|b\.\s?e\.|be(?=\s+(?:in|degree)\b)|b\.?\s?eng)(?![a-z])/i],
]
const YEARS_RE = /\b(\d{1,2})\+?\s+years?\b/gi;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9%+.\s-]/g, " ").replace(/\s+/g, " ").trim();
const digits = (s: string) => (s.match(/\d+(?:\.\d+)?/g) ?? []).join(",");

function stripAllowed(text: string, allowed: string[]): string {
  let t = text;
  for (const a of allowed.filter((x) => x && x.length > 2)) t = t.split(a).join(" ");
  return t;
}

function roleTextOf(idx: ProfileIndex, roleId?: string) {
  if (!roleId) return idx.allText;
  const r = idx.profile.roles.find((x) => x.id === roleId);
  if (!r) return idx.allText;
  return [...roleBullets(r), r.technologies.join(" "), r.tools.join(" "), r.protocols.join(" "), r.methodologies.join(" "), r.leadership, r.technicalOwnership, r.architectureOwnership, r.customerFacing, r.title].join("\n");
}

export function checkClaim(text: string, ctx: TruthContext): ClaimCheck {
  const { index: idx } = ctx;
  const body = stripAllowed(text, ctx.allowedNames ?? []);
  const reasons: string[] = [];
  const unknownTerms: string[] = [], unknownMetrics: string[] = [], unknownEntities: string[] = [];
  let inferred = false, unsupported = false;

  const roleTerms = ctx.roleId ? new Set(ontology.findTerms(roleTextOf(idx, ctx.roleId)).map((h) => h.canonical)) : null;
  const claimTerms = [...new Set(ontology.findTerms(body).map((h) => h.canonical))];

  for (const term of claimTerms) {
    const rel = ontology.relate(term, idx.terms);
    if (rel.type === "exact" || rel.type === "equivalent") {
      if (roleTerms && !roleTerms.has(term) && rel.type === "exact") {
        inferred = true; reasons.push(`"${term}" is in your profile but not under this role — confirm it applies here.`);
      }
      continue;
    }
    const type = ontology.get(term)?.type ?? "other";
    if ((rel.type === "weak" || rel.type === "related") && PRESENTATION_TYPES.has(type)) {
      inferred = true; reasons.push(`"${term}" is plausible from ${rel.via} but not stated — needs your confirmation.`);
    } else {
      unsupported = true; unknownTerms.push(term);
      reasons.push(rel.type === "related" || rel.type === "weak" ? `"${term}" is not in your profile (only related background via ${rel.via}).` : `"${term}" is not in your profile.`);
    }
  }

  const allDigitsText = ` ${idx.allText} `;
  for (const re of METRIC_RES) for (const m of body.matchAll(re)) {
    const raw = m[0].trim();
    const num = digits(raw);
    if (!numberPresent(allDigitsText, num.split(",")[0]) || (re === COUNT_RE && !countPresent(allDigitsText, raw))) {
      if (!unknownMetrics.includes(raw)) { unknownMetrics.push(raw); unsupported = true; reasons.push(`Metric "${raw}" is not in your profile.`); }
    }
  }
  for (const m of body.matchAll(YEARS_RE)) {
    if (+m[1] > Math.floor(idx.years) + 0) { unknownMetrics.push(m[0]); unsupported = true; reasons.push(`"${m[0]}" exceeds the ${idx.years} years computed from your role dates.`); }
  }
  for (const m of body.matchAll(ORG_RE)) {
    const name = m[1];
    if (!normContains(idx.allText, name) && !(ctx.allowedNames ?? []).some((a) => norm(a).includes(norm(name)))) { unknownEntities.push(name); unsupported = true; reasons.push(`Organization "${name}" is not in your profile.`); }
  }
  const eduText = idx.profile.education.map((e) => `${e.degree} ${e.specialization}`).join("\n");
  for (const [level, re] of DEGREE_LEVELS) {
    if (re.test(body) && !re.test(eduText)) { unknownEntities.push(level); unsupported = true; reasons.push(`A ${level} is not in your education.`); }
  }
  const cred = body.match(CREDENTIAL);
  if (cred && !new RegExp(`\\b${cred[0]}`, "i").test(idx.allText)) { unknownEntities.push(cred[0]); unsupported = true; reasons.push(`"${cred[0]}" is not supported by your profile.`); }

  const scope = roleTextOf(idx, ctx.roleId);
  if (LEADERSHIP_VERB.test(body) && !LEADERSHIP_VERB.test(scope)) {
    unsupported = true; unknownEntities.push("leadership claim"); reasons.push("Leadership responsibility is not stated in your profile for this scope.");
  } else if (OWNERSHIP_VERB.test(body) && !OWNERSHIP_VERB.test(scope) && !/owner|architect|defin|establish|responsib/i.test(scope)) {
    inferred = true; reasons.push("Ownership wording (owned/defined/architected) is not in the source — confirm.");
  }
  const t = body.match(TITLE_WORD);
  if (t && !new RegExp(`\\b${t[0]}`, "i").test(idx.profile.roles.map((r) => r.title).join(" "))) {
    inferred = true; reasons.push(`Title wording "${t[0]}" has not been held in your profile — positioning only, needs approval.`);
  }

  const hasFactual = claimTerms.length > 0 || unknownMetrics.length > 0 || /\d/.test(body);
  let status: ClaimStatus, evidence: string | undefined;
  const pool = ctx.roleId ? roleBullets(idx.profile.roles.find((r) => r.id === ctx.roleId) ?? { responsibilities: [], achievements: [] } as any) : idx.items.filter((i) => i.kind === "bullet" || i.kind === "summary").map((i) => i.text);
  let best = 0;
  for (const p of pool) { const j = jaccard(p, text); if (j > best) { best = j; evidence = p; } }
  if (unsupported) status = "UNSUPPORTED";
  else if (inferred) status = "INFERRED";
  else if (best >= 0.85 || (evidence && norm(evidence) === norm(text))) status = "VERIFIED";
  else if (!hasFactual) { status = "SUPPORTED"; reasons.push("No factual career claim in this sentence."); }
  else { status = "SUPPORTED"; reasons.push("All terms are present in your profile."); }
  if (status === "VERIFIED") reasons.push("Matches your profile text directly.");

  return { text, status, reasons, hallucination: status === "UNSUPPORTED", unknownTerms, unknownMetrics, unknownEntities, evidence: best >= 0.3 ? evidence : undefined };
}

const normContains = (hay: string, needle: string) => norm(hay).includes(norm(needle));
/** A count must appear with the same noun in the profile ("5 SoCs" is not backed by an unrelated "5"). People counts also match "team of N". */
function countPresent(hay: string, claim: string): boolean {
  const n = claim.match(/\d+/)![0];
  const noun = claim.match(new RegExp(`(${COUNT_NOUN})\\b`, "i"))![1].toLowerCase().replace(/s$/, "").replace(/-/g, "-?");
  if (new RegExp(`(?<![\\d.])${n}\\+?\\s+(?:[\\w-]+\\s+){0,3}?${noun}`, "i").test(hay)) return true;
  return /^(?:engineer|member|people|developer)/.test(noun) && new RegExp(`team of\\s+${n}(?![\\d])`, "i").test(hay);
}
const numberPresent = (hay: string, num: string) => new RegExp(`(?<![\\d.])${num.replace(".", "\\.")}(?![\\d])`).test(hay);

export function splitSentences(text: string): string[] {
  return text.replace(/\n+/g, " \n ").split(/(?<=[.!?])\s+(?=[A-Z"“(])|\s*\n\s*/).map((s) => s.trim()).filter(Boolean);
}

/** Audit free prose (cover letter, summary): per-sentence claim checks. */
export function auditProse(text: string, ctx: TruthContext): ClaimCheck[] {
  return splitSentences(text).map((s) => checkClaim(s, ctx));
}

/** Remove UNSUPPORTED sentences from generated prose. INFERRED sentences are kept only when `keepInferred`. */
export function sanitizeProse(text: string, ctx: TruthContext, keepInferred = false): { clean: string; removed: ClaimCheck[] } {
  const removed: ClaimCheck[] = [];
  const kept: string[] = [];
  for (const c of auditProse(text, ctx)) {
    if (c.status === "UNSUPPORTED" || (!keepInferred && c.status === "INFERRED")) removed.push(c);
    else kept.push(c.text);
  }
  return { clean: kept.join(" "), removed };
}

export interface TruthAudit {
  checks: ClaimCheck[];
  counts: Record<ClaimStatus, number>;
  hallucinations: ClaimCheck[];
  passed: boolean; // no UNSUPPORTED
}

export function summarizeChecks(checks: ClaimCheck[]): TruthAudit {
  const counts: Record<ClaimStatus, number> = { VERIFIED: 0, SUPPORTED: 0, INFERRED: 0, UNSUPPORTED: 0 };
  for (const c of checks) counts[c.status]++;
  const hallucinations = checks.filter((c) => c.hallucination);
  return { checks, counts, hallucinations, passed: counts.UNSUPPORTED === 0 };
}

/** Full audit of a tailored resume structure. */
export function auditResume(r: TailoredResume, profile: Profile, allowedNames: string[] = []): TruthAudit {
  const index = buildIndex(profile);
  const checks: ClaimCheck[] = [];
  if (r.headline) checks.push(checkClaim(r.headline, { index, allowedNames }));
  if (r.summary) checks.push(...auditProse(r.summary, { index, allowedNames }));
  for (const c of r.competencies) checks.push(checkClaim(c, { index, allowedNames }));
  for (const s of r.skills) for (const i of s.items) checks.push(checkClaim(i, { index, allowedNames }));
  for (const e of r.experience) for (const b of e.bullets) checks.push(checkClaim(b.text, { index, roleId: e.roleId, allowedNames }));
  for (const p of r.projects ?? []) for (const b of p.bullets) checks.push(checkClaim(b, { index, allowedNames }));
  return summarizeChecks(checks);
}
