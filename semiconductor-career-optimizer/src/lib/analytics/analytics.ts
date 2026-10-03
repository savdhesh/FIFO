import type { MatchResult, ParsedJD } from "../types";
import { show } from "../outreach/shared";

export interface AppLite {
  id: string; createdAt: string; status: string; appliedAt?: string | null; roleTitle: string; company: string;
  history?: { status: string; at: string }[]; match: MatchResult; jd: ParsedJD; settings: { country: string };
}
const ORDER = ["SAVED", "ANALYZED", "APPLYING", "APPLIED", "RECRUITER_CONTACTED", "SCREENING", "TECHNICAL_ROUND", "HIRING_MANAGER", "FINAL_ROUND", "OFFER"];
const IMP: Record<string, number> = { mandatory: 3, implied: 1.5, preferred: 0.8 };
const reached = (a: AppLite, stage: string) => {
  const i = ORDER.indexOf(stage);
  return ORDER.indexOf(a.status) >= i || (a.history ?? []).some((h) => ORDER.indexOf(h.status) >= i);
};
const day = 864e5;

export interface Analytics {
  total: number; thisWeek: number; avgScore: number | null;
  funnel: { stage: string; count: number; rate: number | null }[];
  responseRate: number | null; interviewRate: number | null; offerRate: number | null;
  scoreVsOutcome: { progressed: { n: number; avg: number | null }; stalled: { n: number; avg: number | null }; caution: string | null };
  daysToFirstResponse: { n: number; median: number | null };
  weekly: { weekStart: string; analyzed: number; applied: number }[];
  verdicts: Record<string, number>;
  demand: { term: string; jobs: number; weight: number; yours: "strong" | "partial" | "gap" }[];
  gapPriorities: { term: string; jobs: number; weight: number; kind: "real-skill-gap" | "presentation-gap"; advice: string }[];
  byCountry: { country: string; n: number; avg: number }[];
  notes: string[];
}

const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : null);

export function computeAnalytics(apps: AppLite[], now = Date.now()): Analytics {
  const n = apps.length;
  const applied = apps.filter((a) => reached(a, "APPLIED"));
  const stages: [string, string][] = [["Analyzed", "ANALYZED"], ["Applied", "APPLIED"], ["Screening", "SCREENING"], ["Technical round", "TECHNICAL_ROUND"], ["Hiring manager", "HIRING_MANAGER"], ["Final round", "FINAL_ROUND"], ["Offer", "OFFER"]];
  let prev = n;
  const funnel = stages.map(([label, st], i) => { const count = i === 0 ? n : apps.filter((a) => reached(a, st)).length; const rate = i === 0 ? null : pct(count, prev); if (i > 0) prev = count || prev; return { stage: label, count, rate }; });
  const responded = applied.filter((a) => reached(a, "RECRUITER_CONTACTED") || reached(a, "SCREENING"));
  const interviews = apps.filter((a) => reached(a, "SCREENING"));
  const offers = apps.filter((a) => a.status === "OFFER" || (a.history ?? []).some((h) => h.status === "OFFER"));

  // Does the match score predict progress? Report it, but never overclaim on small samples.
  const progressed = interviews, stalled = applied.filter((a) => !reached(a, "SCREENING") && ["REJECTED", "WITHDRAWN", "APPLIED"].includes(a.status));
  const caution = progressed.length < 5 || stalled.length < 5 ? "Too few outcomes to draw a conclusion; treat these averages as anecdotes." : null;

  const firstResp: number[] = [];
  for (const a of applied) {
    const h = [...(a.history ?? [])].sort((x, y) => +new Date(x.at) - +new Date(y.at));
    const ap = h.find((x) => x.status === "APPLIED"); const next = ap && h.find((x) => +new Date(x.at) > +new Date(ap.at) && !["WITHDRAWN"].includes(x.status));
    if (ap && next) firstResp.push(Math.max(0, Math.round((+new Date(next.at) - +new Date(ap.at)) / day)));
  }
  firstResp.sort((a, b) => a - b);

  const weekly: Analytics["weekly"] = [];
  for (let w = 7; w >= 0; w--) {
    const start = new Date(now - w * 7 * day); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    const end = +start + 7 * day;
    weekly.push({ weekStart: start.toISOString().slice(0, 10), analyzed: apps.filter((a) => +new Date(a.createdAt) >= +start && +new Date(a.createdAt) < end).length, applied: apps.filter((a) => { const t = a.appliedAt ? +new Date(a.appliedAt) : (a.history ?? []).find((h) => h.status === "APPLIED") ? +new Date((a.history ?? []).find((h) => h.status === "APPLIED")!.at) : NaN; return t >= +start && t < end; }).length });
  }

  const verdicts: Record<string, number> = {};
  for (const a of apps) verdicts[a.match.recommendation.verdict] = (verdicts[a.match.recommendation.verdict] ?? 0) + 1;

  // Market demand across analysed JDs vs your coverage; real gaps ranked by weighted frequency.
  const demandMap = new Map<string, { jobs: Set<string>; weight: number; strong: number; partial: number; gap: number }>();
  const gapMap = new Map<string, { jobs: Set<string>; weight: number; kind: "real-skill-gap" | "presentation-gap" }>();
  for (const a of apps) for (const r of a.match.requirements) {
    if (!r.matchedTerms.length || !IMP[r.importance]) continue;
    const d = demandMap.get(r.requirement) ?? { jobs: new Set(), weight: 0, strong: 0, partial: 0, gap: 0 };
    d.jobs.add(a.id); d.weight += IMP[r.importance];
    if (r.score >= 0.9) d.strong++; else if (r.score >= 0.3) d.partial++; else d.gap++;
    demandMap.set(r.requirement, d);
    if (r.gap !== "none") { const g = gapMap.get(r.requirement) ?? { jobs: new Set(), weight: 0, kind: r.gapKind === "presentation-gap" ? "presentation-gap" : "real-skill-gap" }; g.jobs.add(a.id); g.weight += IMP[r.importance]; if (r.gapKind === "real-skill-gap") g.kind = "real-skill-gap"; gapMap.set(r.requirement, g); }
  }
  const demand = [...demandMap.entries()].map(([t, d]) => ({ term: show(t), jobs: d.jobs.size, weight: Math.round(d.weight * 10) / 10, yours: (d.strong >= d.partial + d.gap ? "strong" : d.gap > d.strong ? "gap" : "partial") as "strong" | "partial" | "gap" })).sort((a, b) => b.weight - a.weight).slice(0, 15);
  const gapPriorities = [...gapMap.entries()].map(([t, g]) => ({ term: show(t), jobs: g.jobs.size, weight: Math.round(g.weight * 10) / 10, kind: g.kind, advice: g.kind === "presentation-gap" ? "Probably work you have done: confirm and add it to the master profile where true." : "A real gap: building genuine experience is the only fix. Do not claim it." })).sort((a, b) => b.weight - a.weight).slice(0, 25);

  const cm = new Map<string, number[]>();
  for (const a of apps) cm.set(a.settings.country, [...(cm.get(a.settings.country) ?? []), a.match.overall]);
  const notes: string[] = [];
  if (n < 5) notes.push("Fewer than 5 applications analysed: trends are not meaningful yet.");
  if (gapPriorities.length) notes.push("Gap priorities weight each requirement by importance across the jobs you analysed. They guide what to learn; they never change what your resume may claim.");
  return {
    total: n, thisWeek: apps.filter((a) => now - +new Date(a.createdAt) < 7 * day).length, avgScore: avg(apps.map((a) => a.match.overall)), funnel,
    responseRate: pct(responded.length, applied.length), interviewRate: pct(interviews.length, applied.length), offerRate: pct(offers.length, applied.length),
    scoreVsOutcome: { progressed: { n: progressed.length, avg: avg(progressed.map((a) => a.match.overall)) }, stalled: { n: stalled.length, avg: avg(stalled.map((a) => a.match.overall)) }, caution },
    daysToFirstResponse: { n: firstResp.length, median: firstResp.length ? firstResp[Math.floor(firstResp.length / 2)] : null },
    weekly, verdicts, demand, gapPriorities, byCountry: [...cm.entries()].map(([country, xs]) => ({ country, n: xs.length, avg: avg(xs)! })).sort((a, b) => b.n - a.n), notes,
  };
}
