import type {
  GapClass, GapKind, MatchResult, MatchType, ParsedJD, Profile, Requirement, RequirementMatch, ScoreDetail, Settings,
} from "../types";
import { ontology } from "../ontology/ontology";
import { buildIndex, toEvidenceRef, type ProfileIndex } from "../profile-index";
import { detectSeniority } from "./seniority";

export interface ScoreWeights {
  mandatoryTechnical: number; coreDomain: number; seniority: number; architecture: number;
  leadership: number; preferred: number; tools: number; educationOther: number;
}
export const DEFAULT_WEIGHTS: ScoreWeights = {
  mandatoryTechnical: 0.30, coreDomain: 0.20, seniority: 0.15, architecture: 0.10,
  leadership: 0.10, preferred: 0.05, tools: 0.05, educationOther: 0.05,
};

const CREDIT: Record<MatchType, number> = { exact: 1, equivalent: 0.9, related: 0.4, weak: 0.15, missing: 0 };
const TECH_TYPES = new Set(["language", "methodology", "protocol", "processor", "domain", "simulator", "formal-tool", "scripting", "debugging", "planning", "coverage", "assertion", "tool"]);
const CORE_TYPES = new Set(["domain", "processor", "methodology", "coverage", "assertion", "planning", "debugging"]);
const SOFT_TYPES = new Set(["leadership", "management", "communication", "customer"]);
const TOOL_TYPES = new Set(["simulator", "formal-tool", "tool"]);
// For these the underlying *practice* is usually evidenced by related work; absence of the phrase is a presentation issue.
export const PRESENTATION_TYPES = new Set(["planning", "architecture", "leadership", "communication", "customer", "debugging", "coverage"]);
const SENIORITY_LEVEL: Record<string, number> = { Engineer: 1, Senior: 2, Staff: 3, Lead: 3, Principal: 4, Architect: 4, Manager: 4 };

const pct = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 100);

function matchTerm(term: string, idx: ProfileIndex, req: Requirement, mentions: number): RequirementMatch {
  const rel = ontology.relate(term, idx.terms);
  const entry = ontology.get(term);
  let evItems = idx.evidence.get(term) ?? [];
  if (rel.type !== "exact" && rel.via) evItems = idx.evidence.get(rel.via) ?? [];
  const bulletEv = evItems.filter((e) => e.kind === "bullet" || e.kind === "role-field");
  const skillOnly = rel.type === "exact" && bulletEv.length === 0;
  const evidence = (bulletEv.length ? bulletEv : evItems).slice(0, 3).map(toEvidenceRef);

  let credit = CREDIT[rel.type];
  if (skillOnly) credit = 0.8; // listed in skills but never demonstrated in a role
  const presentation = PRESENTATION_TYPES.has(req.type) && (rel.type === "weak" || rel.type === "related" || rel.type === "missing" && bulletEv.length > 0);
  const via = rel.via ? ontology.get(rel.via)?.canonical ?? rel.via : null;

  let gapKind: GapKind = "none";
  let gap: GapClass = "none";
  if (credit < 0.9) {
    const presentationGap = PRESENTATION_TYPES.has(req.type) && (rel.type === "weak" || rel.type === "related");
    gapKind = presentationGap ? "presentation-gap" : "real-skill-gap";
    if (presentationGap) gap = "keyword-only";
    else if (req.importance === "mandatory") gap = rel.type === "missing" ? "critical" : TOOL_TYPES.has(req.type) || rel.type === "related" ? "medium" : "medium";
    else if (req.importance === "implied") gap = rel.type === "missing" ? "medium" : "minor";
    else gap = "minor";
    if (req.importance === "mandatory" && rel.type === "missing" && TOOL_TYPES.has(req.type)) gap = "medium";
  }
  void presentation;

  const confidence: RequirementMatch["confidence"] =
    rel.type === "exact" ? (skillOnly ? "Medium" : "High") : rel.type === "equivalent" ? "High" : rel.type === "related" ? "Medium" : rel.type === "weak" ? "Low" : "High";

  let action: string, explanation: string;
  switch (rel.type) {
    case "exact":
      action = skillOnly ? "Add a supporting bullet (listed in skills only)" : req.importance === "mandatory" || mentions >= 2 ? "Highlight" : "Keep";
      explanation = skillOnly ? `${term} is listed in your skills but no role bullet demonstrates it.` : `${term} is demonstrated directly in your experience.`;
      break;
    case "equivalent":
      action = "Highlight"; explanation = `Your ${via} experience implies ${term}; this is an equivalent match, not a verbatim one.`; break;
    case "related":
      action = `Do not claim ${term}`;
      explanation = `Related experience only: ${via}. ${term} itself is not established in your profile — ${entry?.parent ? `domain background (${entry.parent}) is present` : "treat as a development area"}.`;
      break;
    case "weak":
      action = presentationGap(gapKind) ? `Add "${term}" to the relevant role only if you confirm ownership` : `Mention only if you confirm it`;
      explanation = `${via} makes ${term} plausible, but nothing in your profile states it.`; break;
    default:
      action = "Do not claim"; explanation = `No evidence of ${term} in your profile.`;
  }
  return {
    requirementId: req.id, requirement: term, importance: req.importance, type: req.type, matchType: rel.type, confidence, evidence,
    matchedTerms: [{ jdTerm: term, profileTerm: rel.type === "exact" ? term : via, matchType: rel.type, via: via ?? undefined }],
    action, gap, gapKind, explanation, score: credit,
  };
}
const presentationGap = (k: GapKind) => k === "presentation-gap";

function matchYears(req: Requirement, idx: ProfileIndex): RequirementMatch {
  const need = parseInt(req.text, 10) || 0;
  const have = idx.years;
  const type: MatchType = have >= need ? "exact" : have >= need * 0.8 ? "related" : "missing";
  return {
    requirementId: req.id, requirement: req.text, importance: req.importance, type: "experience", matchType: type,
    confidence: "High", evidence: [], matchedTerms: [],
    action: type === "exact" ? "Keep" : "Do not overstate years",
    gap: type === "exact" ? "none" : type === "related" ? "minor" : "medium", gapKind: type === "exact" ? "none" : "real-skill-gap",
    explanation: `Computed ${have} years from role dates; JD asks ${need}+.`, score: type === "exact" ? 1 : type === "related" ? 0.6 : 0.2,
  };
}

function matchEducation(req: Requirement, idx: ProfileIndex): RequirementMatch {
  const edu = idx.profile.education;
  const wantsMaster = /master|\bms\b|m\.?tech|ph\.?d/i.test(req.text);
  const hasAdv = edu.some((e) => /master|\bms\b|m\.?\s?tech|m\.?\s?sc|ph\.?d/i.test(e.degree));
  const hasAny = edu.some((e) => e.degree || e.university);
  const type: MatchType = !hasAny ? "missing" : /bs\/ms|b\.?s\.? or|bachelor.*or.*master|bachelor/i.test(req.text) || !wantsMaster || hasAdv ? "exact" : "related";
  return {
    requirementId: req.id, requirement: req.text, importance: req.importance, type: "education", matchType: type, confidence: "Medium",
    evidence: edu.slice(0, 1).map((e) => ({ roleId: "education", roleLabel: "Education", field: "degree", text: `${e.degree}, ${e.university}` })),
    matchedTerms: [], action: type === "exact" ? "Keep" : "Verify degree level", gap: type === "exact" ? "none" : "minor",
    gapKind: type === "exact" ? "none" : "real-skill-gap", explanation: hasAny ? "Education recorded in profile." : "No education recorded.", score: type === "exact" ? 1 : type === "related" ? 0.5 : 0,
  };
}

const weighted = (ms: RequirementMatch[], reqs: Map<string, Requirement>) => {
  let num = 0, den = 0;
  for (const m of ms) { const w = reqs.get(m.requirementId)?.weight ?? 1; num += w * m.score; den += w; }
  return den ? { score: num / den, n: ms.length } : null;
};

function whyLines(ms: RequirementMatch[], max = 4): string[] {
  const hits = ms.filter((m) => m.score >= 0.9).slice(0, max).map((m) => `✓ ${m.requirement}: ${m.matchType}`);
  const miss = ms.filter((m) => m.score < 0.9).slice(0, max).map((m) => `✗ ${m.requirement}: ${m.matchType}${m.gap !== "none" ? ` (${m.gap})` : ""}`);
  return [...hits, ...miss];
}

export function analyzeMatch(profile: Profile, jd: ParsedJD, settings?: Partial<Settings>, weightsArg?: ScoreWeights): MatchResult {
  const weights: ScoreWeights = weightsArg ?? { ...DEFAULT_WEIGHTS, ...(settings?.weights as Partial<ScoreWeights> | undefined) };
  const idx = buildIndex(profile);
  const reqMap = new Map(jd.requirements.map((r) => [r.id, r]));
  const rows: RequirementMatch[] = [];
  for (const r of jd.requirements) {
    if (r.importance === "boilerplate" || r.importance === "administrative") continue;
    if (r.type === "experience") rows.push(matchYears(r, idx));
    else if (r.type === "education") rows.push(matchEducation(r, idx));
    else if (r.terms[0]) rows.push(matchTerm(r.terms[0], idx, r, jd.keywordFrequency[r.terms[0]] ?? 1));
  }

  const seniority = detectSeniority(profile, idx);
  const targetLevel = SENIORITY_LEVEL[jd.seniority] ?? SENIORITY_LEVEL[settings?.seniority ?? ""] ?? 3;
  const diff = seniority.level - targetLevel;
  const seniorityScore = diff >= 0 ? Math.max(0.6, 1 - diff * 0.1) : Math.max(0, 1 - Math.abs(diff) * 0.3);
  const yearsReq = rows.find((m) => m.type === "experience");

  const by = (f: (r: Requirement, m: RequirementMatch) => boolean) => rows.filter((m) => f(reqMap.get(m.requirementId)!, m));
  const mandTech = by((r) => r.importance === "mandatory" && TECH_TYPES.has(r.type));
  const mandAll = by((r) => r.importance === "mandatory");
  const core = by((r) => CORE_TYPES.has(r.type));
  const arch = by((r) => r.type === "architecture");
  const lead = by((r) => SOFT_TYPES.has(r.type));
  const pref = by((r) => r.importance === "preferred");
  const tools = by((r) => TOOL_TYPES.has(r.type));
  const edu = by((r) => r.type === "education" || r.type === "experience");
  const tech = by((r) => TECH_TYPES.has(r.type));

  const stat = (ms: RequirementMatch[]) => weighted(ms, reqMap);
  const archBase = stat(arch);
  const buckets: { key: keyof ScoreWeights; label: string; s: number | null; why: string[] }[] = [
    { key: "mandatoryTechnical", label: "Mandatory technical", s: stat(mandTech)?.score ?? null, why: whyLines(mandTech) },
    { key: "coreDomain", label: "Core verification/domain fit", s: stat(core)?.score ?? null, why: whyLines(core) },
    { key: "seniority", label: "Role / seniority alignment", s: seniorityScore, why: [`Resume communicates ${seniority.detected} (level ${seniority.level}); JD targets level ${targetLevel}.`, `${seniority.signals.length} seniority signals found, ${seniority.weakBullets.length} weak bullets.`] },
    { key: "architecture", label: "Architecture / ownership", s: archBase ? archBase.score : jd.architectureExpectations.length ? null : null, why: whyLines(arch) },
    { key: "leadership", label: "Leadership", s: stat(lead)?.score ?? null, why: whyLines(lead) },
    { key: "preferred", label: "Preferred skills", s: stat(pref)?.score ?? null, why: whyLines(pref) },
    { key: "tools", label: "Tool alignment", s: stat(tools)?.score ?? null, why: whyLines(tools) },
    { key: "educationOther", label: "Education / other", s: stat(edu)?.score ?? null, why: whyLines(edu) },
  ];
  let num = 0, den = 0;
  for (const b of buckets) if (b.s !== null) { num += weights[b.key] * b.s; den += weights[b.key]; }
  const overall = den ? pct(num / den) : 0;

  // ATS literal keyword coverage: exact = 1, equivalent = 0.5 (different wording => parser may miss it).
  let kNum = 0, kDen = 0;
  for (const m of rows.filter((x) => x.matchedTerms.length)) {
    const f = jd.keywordFrequency[m.requirement] ?? 1;
    kDen += f; kNum += f * (m.matchType === "exact" ? 1 : m.matchType === "equivalent" ? 0.5 : 0);
  }

  const resumeCountry = profile.identity.location.split(",").pop()?.trim().toLowerCase() ?? "";
  const jdLoc = jd.location.toLowerCase();
  const locKnown = !!(resumeCountry && jdLoc);
  const locMatch = locKnown && (jdLoc.includes(resumeCountry) || (resumeCountry === "india" && /bangalore|bengaluru|hyderabad|pune|chennai|noida/.test(jdLoc)));

  const scoreOf = (key: string, label: string, v: number | null, why: string[], weight?: number): ScoreDetail | null =>
    v === null ? null : { key, label, value: pct(v), weight, why };
  const scores = ([
    { key: "overall", label: "Overall Match", value: overall, why: [`Weighted blend of ${buckets.filter((b) => b.s !== null).length} criteria; weights are configurable.`, ...buckets.filter((b) => b.s !== null).map((b) => `${b.label}: ${pct(b.s!)} × ${Math.round(weights[b.key] * 100)}%`)] },
    scoreOf("mandatory", "Mandatory Requirements", stat(mandAll)?.score ?? null, whyLines(mandAll, 6)),
    scoreOf("technical", "Technical Skills", stat(tech)?.score ?? null, whyLines(tech, 5)),
    scoreOf("domain", "Domain Match", stat(core)?.score ?? null, whyLines(core)),
    scoreOf("seniority", "Seniority Match", seniorityScore, buckets[2].why),
    scoreOf("architecture", "Architecture Match", archBase?.score ?? null, whyLines(arch)),
    scoreOf("leadership", "Leadership Match", stat(lead)?.score ?? null, whyLines(lead)),
    scoreOf("preferred", "Preferred Requirements", stat(pref)?.score ?? null, whyLines(pref)),
    scoreOf("ats", "ATS Keyword Coverage", kDen ? kNum / kDen : null, ["Literal keyword coverage: exact wording counts 1.0, equivalent wording 0.5, related/missing 0.", "Weighted by how often the JD repeats each term."]),
    scoreOf("tools", "Tools Match", stat(tools)?.score ?? null, whyLines(tools)),
    locKnown ? { key: "location", label: "Location / Eligibility", value: locMatch ? 100 : 40, why: [`JD location "${jd.location}" vs profile "${profile.identity.location}". Work authorization is never inferred.`] } : null,
  ] as (ScoreDetail | null)[]).filter((x): x is ScoreDetail => !!x);

  const matched = mandAll.filter((m) => m.score >= 0.9).length;
  const critical = rows.filter((m) => m.gap === "critical");
  const reasons: string[] = [];
  if (mandAll.length) reasons.push(`${matched}/${mandAll.length} mandatory requirements fully matched`);
  reasons.push(Math.abs(diff) <= 0 ? `Seniority aligned (${seniority.detected})` : diff > 0 ? `Resume seniority (${seniority.detected}) exceeds JD target` : `Seniority gap: resume reads ${seniority.detected}, JD targets level ${targetLevel}`);
  if (arch.length) reasons.push(`Architecture requirements: ${arch.filter((m) => m.score >= 0.9).length}/${arch.length} matched`);
  reasons.push(critical.length ? `Critical gaps: ${critical.map((c) => c.requirement).join(", ")}` : "No critical requirement missing");
  if (yearsReq && yearsReq.matchType !== "exact") reasons.push(`Years of experience: ${yearsReq.explanation}`);
  let verdict: MatchResult["recommendation"]["verdict"];
  if (overall >= 80 && critical.length === 0 && diff >= -1) verdict = "STRONG APPLY";
  else if (overall >= 68 && critical.length <= 1) verdict = "APPLY";
  else if (overall >= 50) verdict = "APPLY WITH GAPS";
  else if (overall >= 35) verdict = "LOW PRIORITY";
  else verdict = "DO NOT APPLY";
  if (diff <= -2 && verdict !== "DO NOT APPLY") verdict = "LOW PRIORITY";

  // Keyword analysis with explainability
  const keywordAnalysis = Object.entries(jd.keywordFrequency).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([term, jdMentions]) => {
    const m = rows.find((r) => r.requirement === term);
    const inResume = idx.terms.has(term);
    let suggestion: string | undefined, why: string | undefined;
    if (m && !inResume && (m.matchType === "weak" || m.matchType === "related") && m.gapKind === "presentation-gap") {
      suggestion = term;
      why = `The JD uses "${term}" ${jdMentions}×; your resume shows related work (${m.matchedTerms[0]?.via ?? "related experience"}) but never uses the phrase. Add it only if you confirm you did this work.`;
    }
    return { term, jdMentions, inResume, matchType: (m?.matchType ?? "missing") as MatchType, suggestion, why };
  });

  const gaps = rows.filter((m) => m.gap !== "none").map((m) => ({
    term: m.requirement, gap: m.gap, kind: m.gapKind,
    recommendation: m.gapKind === "presentation-gap"
      ? `Presentation gap. Add "${m.requirement}" to the relevant role only if you confirm ownership.`
      : m.matchType === "related" ? `Development area. Related background (${m.matchedTerms[0]?.via}) exists, but ${m.requirement} is not established — never claim it.`
      : `Real skill gap. ${m.requirement} is not evidenced; do not claim it.`,
  }));
  const strengths = rows.filter((m) => m.score >= 0.9 && m.importance === "mandatory").map((m) => m.requirement).slice(0, 10);

  return { overall, scores, requirements: rows, seniority, recommendation: { verdict, reasons }, keywordAnalysis, strengths, gaps };
}
