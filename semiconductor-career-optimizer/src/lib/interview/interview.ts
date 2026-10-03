import type { MatchResult, ParsedJD, Profile, Settings } from "../types";
import { ontology } from "../ontology/ontology";
import { buildIndex, roleBullets, roleLabel as _rl } from "../profile-index";
import { BANK, LEVEL_NAMES, type BankQ, type Level } from "./bank";
import { classifyBullet } from "../matching/bullets";
import { show } from "../outreach/shared";

export type Stance = "strength" | "related" | "gap";
export interface PlannedQ {
  id: string; topic: string; level: Level; levelName: string; q: string; whyLikely: string; points: string[]; follow?: string;
  stance: Stance; evidence: { label: string; text: string }[]; honestyNote?: string; source: "bank" | "resume" | "gap"; outline?: string;
}
export interface TopicRank { topic: string; display: string; probability: "High" | "Medium" | "Low"; score: number; reasons: string[]; stance: Stance }
export interface InterviewPlan {
  targetLevel: Level; targetLevelName: string; topics: TopicRank[];
  questions: PlannedQ[]; // top 20 from the bank
  resumeDrills: PlannedQ[]; gapQuestions: PlannedQ[]; liveExercises: string[]; notes: string[];
}

const IMP = { mandatory: 3, implied: 1.5, preferred: 0.8, administrative: 0, boilerplate: 0 } as const;
const SENIOR: Record<string, Level> = { Engineer: 1, Senior: 2, Staff: 3, Lead: 3, Principal: 4, Architect: 4, Manager: 4 };

const hash = (s: string) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };

export function targetLevel(jd: ParsedJD, settings?: Partial<Settings>): Level {
  return (SENIOR[jd.seniority] ?? SENIOR[settings?.seniority ?? ""] ?? 3) as Level;
}

/** How strongly a JD term pulls a bank topic in (1 direct, less for child/related/implied topics). */
function pull(bankTopic: string, jdTerm: string): number {
  if (bankTopic === jdTerm) return 1;
  const b = ontology.get(bankTopic), j = ontology.get(jdTerm);
  if (!b || !j) return 0;
  if (b.parent && b.parent.toLowerCase() === jdTerm.toLowerCase()) return 0.6;
  if (j.parent && j.parent.toLowerCase() === bankTopic.toLowerCase()) return 0.5;
  if (j.weak?.includes(bankTopic)) return 0.5;
  if (j.related?.includes(bankTopic) || b.related?.includes(jdTerm)) return 0.4;
  if (b.family && b.family === j.family) return 0.3;
  return 0;
}

const SENIORITY_BOOST: Record<string, number> = { leadership: 1.2, management: 1.2, architecture: 1.2, planning: 1.15 };

export function planInterview(profile: Profile, jd: ParsedJD, match: MatchResult, settings?: Partial<Settings>): InterviewPlan {
  const idx = buildIndex(profile);
  const L = targetLevel(jd, settings);
  const topicsInBank = [...new Set(BANK.map((b) => b.topic))];
  const reqs = jd.requirements.filter((r) => r.terms[0] && r.importance !== "administrative" && r.importance !== "boilerplate");

  const ranks: TopicRank[] = topicsInBank.map((topic) => {
    let score = 0; const reasons: string[] = [];
    for (const r of reqs) {
      const p = pull(topic, r.terms[0]);
      if (!p) continue;
      const mentions = jd.keywordFrequency[r.terms[0]] ?? 1;
      const add = p * IMP[r.importance] * (1 + 0.3 * Math.max(0, mentions - 1));
      score += add;
      if (reasons.length < 3) reasons.push(p === 1 ? `JD lists ${show(r.terms[0])} as ${r.importance}${mentions > 1 ? ` (${mentions}×)` : ""}` : `JD ${r.importance} requirement ${show(r.terms[0])} leads into ${show(topic)}`);
    }
    const rel = ontology.relate(topic, idx.terms).type;
    const stance: Stance = rel === "exact" || rel === "equivalent" ? "strength" : rel === "missing" ? "gap" : "related";
    if (stance === "strength" && idx.evidence.get(topic)?.some((e) => e.kind === "bullet")) { score += score > 0 ? 0.8 : 0.35; reasons.push(`It is on your resume (${idx.evidence.get(topic)!.find((e) => e.kind === "bullet")!.roleLabel}); interviewers probe stated experience`); }
    score *= SENIORITY_BOOST[ontology.get(topic)?.type ?? ""] && L >= 3 ? SENIORITY_BOOST[ontology.get(topic)!.type] : 1;
    const probability = score >= 2.5 ? "High" : score >= 1 ? "Medium" : "Low";
    return { topic, display: show(topic), probability, score: Math.round(score * 100) / 100, reasons, stance } as TopicRank;
  }).filter((t) => t.score > 0).sort((a, b) => b.score - a.score);
  const rankOf = new Map(ranks.map((r) => [r.topic, r]));

  // Question selection: topic score × how well the level fits the target seniority.
  const fit = (l: number) => (l === L ? 1 : l === L - 1 ? 0.8 : l === L + 1 ? 0.5 : l === L - 2 ? 0.4 : 0.2);
  const evidenceFor = (topic: string) => (idx.evidence.get(topic) ?? []).filter((e) => e.kind === "bullet").slice(0, 2).map((e) => ({ label: e.roleLabel, text: e.text }));
  const mk = (b: BankQ, source: PlannedQ["source"] = "bank"): PlannedQ => {
    const rank = rankOf.get(b.topic);
    const rel = ontology.relate(b.topic, idx.terms);
    const stance: Stance = rel.type === "exact" || rel.type === "equivalent" ? "strength" : rel.type === "missing" ? "gap" : "related";
    const ev = stance === "strength" ? evidenceFor(b.topic) : rel.via ? evidenceFor(rel.via) : [];
    const q: PlannedQ = {
      id: `q-${hash(b.q)}`, topic: b.topic, level: b.level, levelName: LEVEL_NAMES[b.level], q: b.q, points: b.points, follow: b.follow, stance, evidence: ev, source,
      whyLikely: rank?.reasons.slice(0, 2).join("; ") || "Core topic for this kind of role",
    };
    if (stance !== "strength") q.honestyNote = stance === "gap"
      ? `Nothing in your profile shows ${show(b.topic)}. Say so plainly, then describe the closest work you have done and how you would ramp up. Do not claim it.`
      : `Your profile shows related work (${rel.via ? show(rel.via) : "adjacent"}), not ${show(b.topic)} itself. Be precise about the difference.`;
    return q;
  };
  const scored = BANK.map((b) => ({ b, s: (rankOf.get(b.topic)?.score ?? 0) * fit(b.level) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
  const perTopic = new Map<string, number>();
  const picked: BankQ[] = [];
  for (const { b } of scored) {
    if (picked.length >= 20) break;
    const n = perTopic.get(b.topic) ?? 0;
    if (n >= 2) continue;
    perTopic.set(b.topic, n + 1); picked.push(b);
  }
  // fill if the JD gave us fewer than 20 relevant topics
  for (const b of [...BANK].sort((x, y) => fit(y.level) - fit(x.level))) { if (picked.length >= 20) break; if (!picked.includes(b) && (perTopic.get(b.topic) ?? 0) < 1 && ontology.relate(b.topic, idx.terms).type !== "missing") { picked.push(b); perTopic.set(b.topic, 1); } }
  const questions = picked.map((b) => mk(b)).sort((a, b) => (rankOf.get(b.topic)?.score ?? 0) - (rankOf.get(a.topic)?.score ?? 0) || b.level - a.level);

  // Questions drawn from the candidate's own bullets.
  const jdTerms = new Set(reqs.flatMap((r) => r.terms));
  const cand = profile.roles.flatMap((r) => roleBullets(r).map((b) => ({ r, b })))
    .filter(({ b }) => !["Generic", "Duplicate", "Weak"].includes(classifyBullet(b).cls))
    .map(({ r, b }) => ({ r, b, s: [...new Set(ontology.findTerms(b).map((h) => h.canonical))].reduce((a, t) => a + (jdTerms.has(t) ? 2 : 0.3), 0) + (/\d/.test(b) ? 1 : 0) + (/^(owned|led|defined|architected|built|developed)/i.test(b) ? 0.7 : 0) }))
    .sort((a, b) => b.s - a.s).slice(0, 7);
  const resumeDrills: PlannedQ[] = cand.map(({ r, b }) => {
    const gist = b.replace(/[.;]\s*$/, "");
    const metric = b.match(/\b\d+(?:\.\d+)?\s?%|\b\d+(?:\.\d+)?\s?x\b/i)?.[0]; // team sizes are handled by the leadership branch
    const lead = /\b(led|managed|mentored)\b/i.test(b);
    const own = /^(owned|defined|architected|built|developed)/i.test(b);
    const [q, level, points]: [string, Level, string[]] = metric
      ? [`You wrote “${gist}”. How was “${metric}” measured, and what was your own contribution versus the team's?`, 3, ["State the baseline, how it was measured, and your specific actions", "Be exact: do not round up or claim team results as yours", "Know what you would measure differently now"]]
      : lead ? [`On “${gist}”: how did you organise the work, handle disagreement, and decide priorities?`, 3, ["Structure of the work and who owned what", "A concrete disagreement and how it was resolved", "What you would change"]]
      : own ? [`Walk me through the design decisions behind “${gist}”. What alternatives did you reject and what would you change today?`, 3, ["Constraints at the time and options considered", "Trade-offs: reuse, speed, debug visibility, effort", "Lessons and what you would change"]]
      : [`Tell me about the hardest problem you hit while working on “${gist}”.`, 2, ["Situation, symptom, how you isolated the root cause", "What you changed and how you proved it fixed", "What it taught you"]];
    return { id: `d-${hash(b)}`, topic: "Your resume", level, levelName: LEVEL_NAMES[level], q, points, stance: "strength", evidence: [{ label: roleLabel(r), text: b }], source: "resume", whyLikely: "Interviewers verify claims stated on your resume. Answer only from what you actually did." };
  });

  // Gap questions: be honest, bridge, and show a ramp-up path.
  const gapQuestions: PlannedQ[] = match.requirements
    .filter((m) => m.gap !== "none" && m.matchedTerms.length && m.importance !== "boilerplate")
    .sort((a, b) => IMP[b.importance] - IMP[a.importance]).slice(0, 6)
    .map((m) => {
      const via = m.matchedTerms[0]?.via;
      const level: Level = m.importance === "mandatory" ? Math.max(2, L - 1) as Level : 2;
      return {
        id: `g-${hash(m.requirement)}`, topic: m.requirement, level, levelName: LEVEL_NAMES[level],
        q: m.gapKind === "presentation-gap" ? `The job asks for ${show(m.requirement)}. Tell me about your experience with it.` : `Have you worked with ${show(m.requirement)}? How would you get productive on it?`,
        points: ["Answer the question asked: yes, partly, or no", via ? `Bridge with your real related work (${show(via)})` : "Bridge with the closest real work you have done", "Give a concrete 30/60/90-day ramp-up plan"],
        stance: m.gapKind === "presentation-gap" ? "related" : "gap", evidence: m.evidence.filter((e) => e.field === "bullet").slice(0, 2).map((e) => ({ label: e.roleLabel, text: e.text })), source: "gap",
        whyLikely: `JD ${m.importance} requirement with ${m.gapKind === "presentation-gap" ? "a presentation gap (the work may exist but the resume does not show it)" : "no direct evidence in your profile"}`,
        honestyNote: m.gapKind === "presentation-gap" ? `If you did this work, say so with a specific example; if you only did related work, say that.` : `Do not claim ${show(m.requirement)}. Say what you have done that is closest and how you would ramp up.`,
      } as PlannedQ;
    });

  const has = (t: string) => ranks.some((r) => r.topic === t && r.score >= 1);
  const liveExercises = [
    has("SystemVerilog Assertions") || has("Cover Property") ? "Write an SVA for a request/acknowledge handshake with a bounded response window, plus a cover property." : "",
    has("Constraint Solving") || has("Constrained Random Verification") ? "Write constraints for a packet with length/alignment rules and a weighted distribution." : "",
    has("UVM") ? "Sketch a UVM environment for a simple bus peripheral on a whiteboard (agents, scoreboard, coverage, config)." : "",
    has("Scoreboard") ? "Describe a scoreboard for a pipelined or out-of-order interface." : "",
    has("Functional Coverage") ? "Draft a covergroup with crosses for a protocol and say how you would close holes." : "",
    has("CPU Verification") || has("RISC-V") ? "Outline a verification strategy for a small RISC-V core: stimulus, reference model, checking, coverage." : "",
    has("Formal Verification") ? "Choose properties and assumptions for an arbiter, and explain how you would detect over-constraining." : "",
  ].filter(Boolean);
  const notes = [
    `Questions are weighted toward ${LEVEL_NAMES[L]} level (JD seniority: ${jd.seniority}).`,
    "Probability reflects how often the JD and your own resume point at a topic; it is a preparation aid, not a prediction of the actual interview.",
    "Answer from what you actually did. Evidence shown is your own profile text; the app never writes claims for you to repeat.",
  ];
  return { targetLevel: L, targetLevelName: LEVEL_NAMES[L], topics: ranks.slice(0, 18), questions, resumeDrills, gapQuestions, liveExercises, notes };
}
const roleLabel = (r: { title: string; employer: string }) => [r.title || "Role", r.employer].filter(Boolean).join(" @ ");
void _rl;
