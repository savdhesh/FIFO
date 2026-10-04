import type { ChangeProposal, MatchResult, ParsedJD, Profile, Settings, TailoredResume, ClaimStatus } from "../types";
import { ontology } from "../ontology/ontology";
import { latestRole, buildIndex, roleBullets, type ProfileIndex } from "../profile-index";
import { classifyBullet } from "../matching/bullets";
import { checkClaim, auditProse } from "../truth/truth";
import { formatRange } from "../parsing/dates";
import { countryStyle } from "../countries";

export interface BulletRewrite { roleId: string; original: string; proposed: string; reason: string; evidence?: string }

const BUDGET: Record<Settings["length"], number[]> = {
  "1": [4, 3, 2], "2": [6, 5, 4, 3], "3": [8, 7, 6, 5, 4, 3], "4": [10, 8, 8, 6, 5, 4], cv: [99],
};
const MAX_ROLES: Record<Settings["length"], number> = { "1": 3, "2": 4, "3": 6, "4": 8, cv: 99 };
const IMPORTANCE_W = { mandatory: 3, implied: 1.5, preferred: 1, administrative: 0, boilerplate: 0 } as const;
const rank: Record<ClaimStatus, number> = { VERIFIED: 0, SUPPORTED: 1, INFERRED: 2, UNSUPPORTED: 3 };
const worst = (a: ClaimStatus[]) => a.reduce((w, s) => (rank[s] > rank[w] ? s : w), "VERIFIED" as ClaimStatus);

/** Terms the candidate demonstrably has (exact/equivalent) that the JD asks for, ranked by JD weight × frequency. */
export function matchedJdTerms(jd: ParsedJD, match: MatchResult) {
  return match.requirements
    .filter((m) => m.matchedTerms.length && (m.matchType === "exact" || m.matchType === "equivalent"))
    .map((m) => ({ term: m.requirement, w: IMPORTANCE_W[m.importance] * (1 + (jd.keywordFrequency[m.requirement] ?? 0) * 0.3), type: m.type, demonstrated: m.score >= 0.9 }))
    .sort((a, b) => b.w - a.w);
}

function bulletRelevance(text: string, jdWeights: Map<string, number>): number {
  let s = 0;
  for (const t of new Set(ontology.findTerms(text).map((h) => h.canonical))) s += jdWeights.get(t) ?? 0.2;
  return s;
}

/** Deterministic, conservative bullet rewrites. Anything that attributes role-level facts to a bullet is INFERRED. */
export function deterministicRewrites(_profile: Profile, _jd: ParsedJD, match: MatchResult, _idx: ProfileIndex): BulletRewrite[] {
  const out: BulletRewrite[] = [];
  // Weak/generic bullets are surfaced for the user to rewrite (Overview tab); an LLM provider may propose rewrites.
  // Deterministic mode deliberately does not attach role-level tools to individual bullets: that would be guesswork.
  // Keyword presentation gaps: attach the phrase to the bullet that evidences the practice.
  for (const k of match.keywordAnalysis.filter((x) => x.suggestion)) {
    const req = match.requirements.find((r) => r.requirement === k.term);
    const ev = req?.evidence.find((e) => e.roleId !== "skills" && e.field === "bullet");
    if (!ev || out.some((o) => o.original === ev.text)) continue;
    out.push({
      roleId: ev.roleId, original: ev.text, proposed: `${ev.text.replace(/[.;]\s*$/, "")}, including ${k.term.toLowerCase()}.`,
      reason: k.why ?? `JD uses "${k.term}" but resume does not.`, evidence: ev.text,
    });
  }
  return out;
}

function domainPhrase(idx: ProfileIndex): string {
  const order = ["SoC Verification", "IP Verification", "CPU Verification", "Subsystem Integration", "Design Verification"];
  const have = order.filter((t) => idx.terms.has(t));
  const names = have.map((t) => (t === "Subsystem Integration" ? "subsystem" : t.replace(" Verification", "")));
  if (!have.length) return "verification";
  const uniq = [...new Set(names)].slice(0, 3);
  return uniq.length === 1 && uniq[0] === "Design" ? "design verification" : `${uniq.filter((n) => n !== "Design").join(", ").replace(/, ([^,]*)$/, " and $1")} verification`;
}

export function tailorResume(
  profile: Profile, jd: ParsedJD, match: MatchResult, settings: Settings, rewrites?: BulletRewrite[],
): { tailored: TailoredResume; changes: ChangeProposal[] } {
  const idx = buildIndex(profile);
  const allowed = [jd.company, jd.roleTitle].filter(Boolean);
  const changes: ChangeProposal[] = [];
  let n = 0;
  const addChange = (c: Omit<ChangeProposal, "id" | "decision" | "status" | "hallucination"> & { status?: ClaimStatus }, status: ClaimStatus, hall = false): string => {
    const id = `c${++n}`;
    changes.push({ ...c, id, status, hallucination: hall, decision: "pending" });
    return id;
  };

  const jdWeights = new Map<string, number>();
  for (const m of match.requirements) for (const t of m.matchedTerms) if (m.matchType === "exact" || m.matchType === "equivalent") jdWeights.set(m.requirement, IMPORTANCE_W[m.importance] * 2 + (jd.keywordFrequency[m.requirement] ?? 0));
  const matched = matchedJdTerms(jd, match);
  const titleOfLatest = profile.roles[0]?.title ?? "";
  const headlineTerms = matched.filter((m) => !(m.term === "Design Verification" && /verification/i.test(titleOfLatest))).filter((m) => !["leadership", "management", "communication", "customer", "experience", "education"].includes(m.type)).slice(0, 5).map((m) => m.term);

  // Headline: real latest title + matched differentiators. Never adopts a title the candidate has not held.
  const latest = latestRole(profile);
  const latestTitle = latest?.title || profile.roles[0]?.title || "Verification Engineer";
  const headline = [latestTitle, ...headlineTerms].join(" | ");
  const hCheck = checkClaim(headline, { index: idx, allowedNames: allowed });
  const headlineId = addChange({ section: "headline", original: latestTitle, proposed: headline, reason: `Headline leads with your actual title and the JD terms you can evidence (${headlineTerms.join(", ")}).`, evidence: `Title: ${latestTitle}` }, hCheck.status, hCheck.hallucination);

  // Summary (assembled only from supported facts)
  const years = Math.floor(idx.years);
  const sentences: string[] = [];
  sentences.push(`${latestTitle.replace(/^(?:a|an)\s+/i, "")} with ${years ? `${years}+ years` : "experience"} in ${domainPhrase(idx)}.`);
  // "Hands-on" only for terms a role bullet demonstrates; skills-section-only terms stay in competencies.
  const techTerms = matched.filter((m) => m.demonstrated && ["language", "methodology", "protocol", "processor", "assertion", "coverage", "simulator", "formal-tool"].includes(m.type)).slice(0, 7).map((m) => m.term);
  if (techTerms.length) sentences.push(`Hands-on experience with ${list(techTerms)}.`);
  const practice = matched.filter((m) => ["architecture", "planning", "debugging", "leadership"].includes(m.type)).slice(0, 4).map((m) => m.term.toLowerCase());
  if (practice.length) sentences.push(`Background includes ${list(practice)}.`);
  const summary = sentences.join(" ");
  const sChecks = auditProse(summary, { index: idx, allowedNames: allowed });
  const summaryStatus = worst(sChecks.map((c) => c.status));
  const summaryId = addChange({ section: "summary", original: profile.summary, proposed: summary, reason: "Summary rebuilt from JD-relevant terms present in your profile; no metrics or titles added.", evidence: "Derived from profile skills and role bullets" }, summaryStatus, sChecks.some((c) => c.hallucination));

  const competencies = matched.slice(0, 12).map((m) => m.term);
  const compId = addChange({ section: "competencies", original: "", proposed: competencies.join(" · "), reason: "Core competencies = JD terms with exact/equivalent evidence in your experience.", evidence: competencies.map((t) => idx.evidence.get(t)?.[0]?.roleLabel ?? "").filter(Boolean).slice(0, 3).join("; ") }, "SUPPORTED");

  // Skills (profile content only; JD-relevant items first)
  const LABELS: Record<string, string> = { languages: "HDL / Languages", verification: "Verification", formal: "Formal Verification", processor: "Processor / ISA", protocols: "Interfaces / Protocols", domains: "Domains", tools: "Tools", methodologies: "Methodologies" };
  // One entry per skill however it was written across merged resumes ("AHB" / "AMBA AHB", "GLS" / "Gate-Level Simulation"):
  // same ontology concept = same skill, except tools, which are distinct products. A qualified entry ("formal verification (exposure)")
  // wins over a bare duplicate so the resume never drops an honest qualifier. Fragments too generic to be a skill are dropped.
  const GENERIC = /^(?:soc|ip|memory|subsystems?|formal|verification|design|silicon|chip|debug|automation|low[- ]?power)$/i;
  const conceptKey = (v: string) => {
    const bare = v.replace(/\s*\([^)]*\)/, "");
    const hits = ontology.findTerms(bare);
    const covered = hits.reduce((n, h) => n + h.surface.length, 0) / Math.max(1, bare.trim().length);
    const e = hits.length === 1 && covered >= 0.6 ? ontology.get(hits[0].canonical) : undefined;
    const spelling = `s:${bare.toLowerCase().replace(/[^a-z0-9+#]/g, "")}`;
    if (!e || ["Tool", "Simulator", "Debug Tool", "Formal Tool"].includes(e.category)) return spelling;
    // Protocol/ISA aliases can be distinct variants (QSPI vs SPI, I3C vs I2C): collapse only "AMBA AHB" into "AHB" (whole-word containment).
    if (["Protocol", "Processor", "SerDes", "HDL", "Language"].includes(e.category)) {
      const words = bare.toLowerCase().split(/[^a-z0-9+#-]+/), canon = e.canonical.toLowerCase();
      return words.includes(canon) || bare.toLowerCase() === canon ? `c:${e.canonical}` : spelling;
    }
    return `c:${e.canonical}`;
  };
  const chosen = new Map<string, { cat: string; text: string }>();
  for (const [k, v] of Object.entries(profile.skills)) for (const x of v) {
    if (GENERIC.test(x.trim())) continue;
    const key = conceptKey(x), prev = chosen.get(key);
    if (!prev) chosen.set(key, { cat: k, text: x });
    else if (/\(/.test(x) && !/\(/.test(prev.text)) prev.text = x;
  }
  const skills = Object.keys(profile.skills).map((k) => ({
    label: LABELS[k] ?? k,
    items: [...chosen.values()].filter((c) => c.cat === k).map((c) => c.text)
      .sort((a, b) => (bulletRelevance(b, jdWeights) > 0 ? 1 : 0) - (bulletRelevance(a, jdWeights) > 0 ? 1 : 0)).slice(0, 14),
  })).filter((g) => g.items.length);

  // Experience
  const rewriteMap = new Map<string, BulletRewrite>();
  for (const r of rewrites ?? deterministicRewrites(profile, jd, match, idx)) rewriteMap.set(`${r.roleId}::${r.original}`, r);
  const roles = profile.roles.slice(0, MAX_ROLES[settings.length]);
  const style = countryStyle(settings.country);
  const experience: TailoredResume["experience"] = roles.map((role, ri) => {
    const budget = BUDGET[settings.length][Math.min(ri, BUDGET[settings.length].length - 1)];
    const ranked = roleBullets(role).map((b, i) => ({ b, i, s: bulletRelevance(b, jdWeights) })).sort((x, y) => y.s - x.s || x.i - y.i);
    const seen: string[] = [];
    const picked: typeof ranked = [];
    for (const r of ranked) {
      if (picked.length >= budget) break;
      if (classifyBullet(r.b, seen).cls === "Duplicate") continue;
      seen.push(r.b); picked.push(r);
    }
    const bullets = picked.map(({ b }) => {
      const rw = rewriteMap.get(`${role.id}::${b}`);
      if (!rw) return { text: b };
      const c = checkClaim(rw.proposed, { index: idx, roleId: role.id, allowedNames: allowed });
      // Attributing role-level facts to a single bullet is an inference even if all terms exist in the role.
      const status: ClaimStatus = c.status === "VERIFIED" || c.status === "SUPPORTED" ? (rw.reason.includes("confirm") ? "INFERRED" : c.status) : c.status;
      const id = addChange({ section: "bullet", roleId: role.id, original: b, proposed: rw.proposed, reason: rw.reason, evidence: rw.evidence ?? b }, status, c.hallucination);
      return { text: rw.proposed, changeId: id };
    });
    return { roleId: role.id, title: role.title, employer: role.employer, location: role.location, dates: formatRange(role.startDate, role.endDate, style.dates), subtitle: role.client || undefined, bullets };
  });

  // Major technical projects: your own listed projects, verbatim, for longer resumes only.
  const PROJECT_LIMIT: Record<Settings["length"], number> = { "1": 0, "2": 0, "3": 2, "4": 4, cv: 99 };
  const projRank = profile.projects.map((p) => ({ p, s: [p.summary, ...p.highlights].reduce((a, b) => a + bulletRelevance(b, jdWeights), 0) })).sort((a, b) => b.s - a.s);
  const projects = projRank.slice(0, PROJECT_LIMIT[settings.length]).map(({ p }) => ({ name: p.name || "Project", sub: [p.employer, p.period].filter(Boolean).join(" · "), bullets: [p.summary, ...p.highlights].filter(Boolean).slice(0, settings.length === "cv" ? 8 : 4) }));
  const tailored: TailoredResume = {
    headline, summary, competencies, skills, experience,
    education: profile.education.map((e) => [e.degree, e.specialization && !e.degree.toLowerCase().includes(e.specialization.toLowerCase()) ? e.specialization : "", e.university, e.year].filter(Boolean).join(", ")),
    projects, certifications: profile.certifications, publications: profile.publications, identity: profile.identity,
  };
  void headlineId; void summaryId; void compId;
  return { tailored, changes };
}

function list(items: string[]) { return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`; }

/**
 * Produce the resume that will be exported: only accepted/edited changes are applied.
 * Pending/rejected proposals fall back to the original wording. UNSUPPORTED text is never applied.
 */
export function applyDecisions(t: TailoredResume, changes: ChangeProposal[], profile: Profile): TailoredResume {
  const byId = new Map(changes.map((c) => [c.id, c]));
  const applied = (c?: ChangeProposal) => !!c && (c.decision === "accepted" || c.decision === "edited") && c.status !== "UNSUPPORTED";
  const text = (c: ChangeProposal) => (c.decision === "edited" && c.finalText ? c.finalText : c.proposed);
  const find = (section: ChangeProposal["section"]) => changes.find((c) => c.section === section);
  const h = find("headline"), s = find("summary"), k = find("competencies");
  return {
    ...t,
    headline: applied(h) ? text(h!) : h?.original ?? "",
    summary: applied(s) ? text(s!) : s?.original ?? "",
    competencies: applied(k) ? text(k!).split(/\s·\s/).filter(Boolean) : [],
    experience: t.experience.map((e) => ({
      ...e,
      bullets: e.bullets.map((b) => {
        const c = b.changeId ? byId.get(b.changeId) : undefined;
        if (!c) return { text: b.text };
        return { text: applied(c) ? text(c) : c.original };
      }),
    })),
    projects: t.projects ?? [],
    identity: profile.identity,
  };
}
