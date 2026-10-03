import type { Profile } from "../types";
import type { PlannedQ } from "../interview/interview";
import { ontology } from "../ontology/ontology";
import { buildIndex } from "../profile-index";
import { auditProse } from "../truth/truth";
import { jaccard } from "../matching/bullets";
import { show } from "../outreach/shared";

export interface Dim { key: string; label: string; weight: number; score: number; note: string }
export interface CoachResult {
  score: number; band: "Strong" | "Solid" | "Needs work" | "Weak"; words: number;
  dims: Dim[]; covered: string[]; missed: string[];
  flags: { text: string; reasons: string[]; severity: "claim" | "detail" }[]; // sentences with content your profile does not show: 'claim' = hard (tool, protocol, metric, leadership…), 'detail' = elaboration to double-check
  strengths: string[]; improvements: string[];
  usedEvidence: boolean;
  llm?: { summary: string; strengths: string[]; improvements: string[] };
}

const STOP = new Set(["the", "and", "for", "with", "from", "that", "this", "into", "over", "using", "used", "was", "were", "are", "has", "have", "had", "you", "our", "all", "your", "can", "will", "how", "what", "when", "why", "who", "not", "but"]);
const stem = (w: string) => w.replace(/(?:ing|ed|es|s)$/, "");
const sig = (t: string) => t.toLowerCase().replace(/[^a-z0-9+\- ]/g, " ").split(/\s+/).filter((w) => (w.length > 3 || /\d/.test(w)) && !STOP.has(w)).map(stem);
const terms = (t: string) => new Set(ontology.findTerms(t).map((h) => h.canonical));

const CUES: Record<string, RegExp> = {
  situation: /\b(when|at (?:my|the)|on (?:a|the|my) (?:project|team|program)|we had|our team|context|the (?:project|chip|block|soc)|was (?:working|assigned)|during)\b/i,
  task: /\b(needed to|had to|goal|objective|responsible for|my job|the challenge|the problem|tasked|required to|asked to)\b/i,
  action: /\b(i (?:wrote|built|designed|defined|created|debugged|analy[sz]ed|proposed|implemented|reviewed|ran|set up|added|isolated|traced|decided|checked|chose)|my approach|i started|first,? i|then i|i used)\b/i,
  result: /\b(as a result|result(?:ed)?|outcome|ended up|which (?:found|caught|closed|reduced|fixed)|we (?:closed|found|caught|shipped|signed off)|signed off|taped out|fixed|caught|closed (?:the|coverage)|found (?:a|the|\d+))\b/i,
  reflection: /\b(learned|lesson|would (?:now |do|change|have)|next time|in hindsight|differently|since then|trade-?off)\b/i,
};
const HEDGE = /\b(kind of|sort of|maybe|i guess|i think|probably|basically|stuff|things like|etc\.?|or something)\b/gi;
const ACKNOWLEDGE = /\b(i (?:have not|haven['’]t|did not|didn['’]t|don['’]t have)|no direct|not (?:directly )?(?:used|worked)|closest|related|similar|ramp[- ]?up|would (?:learn|start)|not hands[- ]on|limited exposure|only (?:read|studied))\b/i;

const band = (s: number): CoachResult["band"] => (s >= 80 ? "Strong" : s >= 65 ? "Solid" : s >= 45 ? "Needs work" : "Weak");

/** Deterministic answer critique against the question's key points and the candidate's own profile. */
export function coachAnswer(q: PlannedQ, answer: string, profile: Profile, allowedNames: string[] = []): CoachResult {
  const text = answer.trim();
  const words = text ? text.split(/\s+/).length : 0;
  const idx = buildIndex(profile);
  const aTerms = terms(text), aTokens = new Set(sig(text));

  // 1. key-point coverage
  const covered: string[] = [], missed: string[] = [];
  for (const p of q.points) {
    const pt = sig(p), pTerms = terms(p);
    const overlap = pt.length ? pt.filter((w) => aTokens.has(w)).length / pt.length : 0;
    const termHit = [...pTerms].some((t) => aTerms.has(t));
    (overlap >= 0.34 || (termHit && overlap >= 0.2) ? covered : missed).push(p);
  }
  const coverage = q.points.length ? covered.length / q.points.length : 0;

  // 2. specificity: distinct technical terms and concrete numbers
  const nums = (text.match(/\b\d+(?:\.\d+)?\s?(?:%|x|ns|ps|mhz|ghz|cycles|blocks?|engineers?|weeks?|days?|hours?|bugs?|tests?)?\b/gi) ?? []).filter((n) => /\d/.test(n)).length;
  const spec = Math.min(1, (aTerms.size + Math.min(nums, 3)) / 6);

  // 3. structure
  const hit = Object.fromEntries(Object.entries(CUES).map(([k, re]) => [k, re.test(text)])) as Record<string, boolean>;
  const structure = (Object.values(hit).filter(Boolean).length) / 5;

  // 4. ownership and clarity
  const i = (text.match(/\bI\b/g) ?? []).length, we = (text.match(/\bwe\b/gi) ?? []).length;
  const ownership = i + we === 0 ? 0.3 : Math.min(1, (i / (i + we)) / 0.5);
  const hedges = (text.match(HEDGE) ?? []).length;
  const clarity = Math.max(0, Math.min(1, ownership * 0.7 + (hedges === 0 ? 0.3 : Math.max(0, 0.3 - hedges * 0.1))));

  // 5. honesty: unsupported claims in the answer; gap questions need an explicit acknowledgement
  const HARD = new Set(["tool", "simulator", "formal-tool", "protocol", "language", "scripting", "processor"]);
  const NEGATED = /\b(?:have not|haven['’]t|did not|didn['’]t|never|no direct|not (?:directly )?(?:used|worked)|don['’]t have)\b/i;
  const checks = text ? auditProse(text, { index: idx, allowedNames }) : [];
  // Saying "I have not used X" is honest, not a claim about X.
  const flags: CoachResult["flags"] = checks.filter((c) => c.status === "UNSUPPORTED" && !NEGATED.test(c.text)).map((c) => ({
    text: c.text, reasons: c.reasons,
    severity: c.unknownMetrics.length || c.unknownEntities.length || c.unknownTerms.some((t) => HARD.has(ontology.get(t)?.type ?? "")) ? "claim" as const : "detail" as const,
  }));
  const hard = flags.filter((f) => f.severity === "claim"), soft = flags.filter((f) => f.severity === "detail");
  let honesty = Math.max(0, 1 - hard.length * 0.4 - soft.length * 0.1);
  const topicTerm = ontology.get(q.topic) ? q.topic : null;
  const claimsTopic = !!topicTerm && aTerms.has(topicTerm);
  const improvements: string[] = [], strengths: string[] = [];
  if (q.stance === "gap" || q.stance === "related") {
    if (!ACKNOWLEDGE.test(text)) { honesty = Math.min(honesty, 0.4); improvements.push(`Say plainly that you have not used ${show(q.topic)} directly before bridging to related work; interviewers notice dodging.`); }
    else strengths.push("You acknowledged the gap honestly before bridging.");
    if (q.stance === "gap" && claimsTopic && !ACKNOWLEDGE.test(text)) honesty = 0;
  }
  for (const f of soft) improvements.push(`“${f.text.slice(0, 80)}…” adds detail your profile does not mention (${f.reasons[0]}). Fine if it is true; add it to your profile so your resume matches what you say.`);
  for (const f of hard) improvements.unshift(`“${f.text.slice(0, 90)}” claims something your profile does not show (${f.reasons[0]}). Remove it, or add it to your profile only if it is true.`);

  // evidence use
  const usedEvidence = q.evidence.some((e) => jaccard(sig(e.text).join(" "), sig(text).join(" ")) > 0.08 || sig(e.text).filter((w) => aTokens.has(w)).length >= 4);
  if (q.evidence.length && !usedEvidence && q.stance === "strength") improvements.push("Anchor the answer in a real example from your own work; your profile has one for this topic (shown under the question).");
  if (usedEvidence) strengths.push("You drew on your own documented experience.");

  // length
  if (words < 50) improvements.push(`Too short (${words} words). Aim for roughly 90 to 250 words: context, what you did, the result, what you learned.`);
  else if (words > 350) improvements.push(`Long (${words} words). Lead with the point and cut background; interviewers can ask follow-ups.`);
  else if (words >= 90 && words <= 250) strengths.push("Good length.");
  if (coverage < 0.5 && missed.length) improvements.push(`Key points not covered: ${missed.slice(0, 2).join("; ")}.`);
  if (coverage >= 0.67) strengths.push("Covers most of what a strong answer includes.");
  if (!hit.result) improvements.push("State the outcome (what changed, what you found, how it was verified).");
  if (!hit.reflection && q.level >= 3) improvements.push("At this level, add what you would do differently or the trade-off you accepted.");
  if (hedges >= 2) improvements.push(`Cut hedging words (${hedges} found): "kind of", "I think", "probably".`);
  if (spec < 0.4) improvements.push("Add concrete detail: the tool, protocol, block or number involved.");
  if (i === 0 && we > 0) improvements.push("Say what YOU did, not only what 'we' did.");

  const dims: Dim[] = [
    { key: "coverage", label: "Key points covered", weight: 0.35, score: coverage, note: `${covered.length}/${q.points.length} points` },
    { key: "specificity", label: "Technical specificity", weight: 0.2, score: spec, note: `${aTerms.size} technical terms, ${nums} figures` },
    { key: "structure", label: "Structure (situation, task, action, result, lesson)", weight: 0.15, score: structure, note: Object.entries(hit).filter(([, v]) => v).map(([k]) => k).join(", ") || "none detected" },
    { key: "ownership", label: "Ownership and clarity", weight: 0.1, score: clarity, note: `${i} “I”, ${we} “we”, ${hedges} hedges` },
    { key: "honesty", label: "Consistent with your profile", weight: 0.2, score: honesty, note: hard.length ? `${hard.length} unsupported claim(s)` : soft.length ? `${soft.length} detail(s) to double-check` : "no unsupported claims" },
  ];
  let score = Math.round(dims.reduce((a, d) => a + d.weight * d.score, 0) * 100);
  if (words < 25) score = Math.min(score, 35);
  if (hard.length) score = Math.min(score, 60); // an invented claim caps the grade
  return { score, band: band(score), words, dims, covered, missed, flags, strengths, improvements: improvements.slice(0, 7), usedEvidence };
}

export interface Attempt { at: string; score: number; words: number }
/** Topics where the candidate scores lowest across practice attempts. */
export function weakTopics(practice: Record<string, Attempt[]>, qs: { id: string; topic: string }[]): { topic: string; avg: number; attempts: number }[] {
  const by = new Map<string, number[]>();
  for (const q of qs) { const a = practice[q.id]; if (a?.length) by.set(q.topic, [...(by.get(q.topic) ?? []), a[a.length - 1].score]); }
  return [...by.entries()].map(([topic, xs]) => ({ topic, avg: Math.round(xs.reduce((a, b) => a + b, 0) / xs.length), attempts: xs.length })).sort((a, b) => a.avg - b.avg);
}
