import type { ClaimCheck, MatchResult, ParsedJD, Profile, Settings } from "../types";
import { buildIndex, recentTerms, type ProfileIndex } from "../profile-index";
import { auditProse, sanitizeProse } from "../truth/truth";
import { countryStyle } from "../countries";
import { matchedJdTerms } from "./resume";

export interface CoverLetter {
  date: string; salutation: string; paragraphs: string[]; closing: string; signature: string;
  wordCount: number; removed: ClaimCheck[]; checks: ClaimCheck[];
}

export const BANNED_PHRASES = [
  "extremely passionate", "perfect fit", "i am writing to express", "results-driven", "dynamic leader", "passionate technology enthusiast",
  "hardworking", "team player", "highly accomplished", "excited to apply", "thrilled",
];

const PAST_VERB = /^(owned|led|developed|built|created|verified|wrote|performed|designed|implemented|drove|defined|architected|managed|automated|debugged|delivered|established|mentored|integrated|executed|contributed|reviewed|analyzed|analysed|closed|enabled|improved|reduced|introduced|collaborated|coordinated|authored|maintained|ran|bootstrapped|migrated|deployed|supported|validated|developed)\b/i;
const UK_SPELL: [RegExp, string][] = [[/\borganization/gi, "organisation"], [/\bcenter(ed|s|ing)?\b/gi, "centre$1"], [/\banalyze/gi, "analyse"], [/\boptimiz/gi, "optimis"], [/\bprioritiz/gi, "prioritis"], [/\bsummariz/gi, "summaris"]];

function firstPerson(b: string): string | null {
  const t = b.trim().replace(/[.;]\s*$/, "");
  if (!PAST_VERB.test(t)) return null;
  return `I ${t.charAt(0).toLowerCase()}${t.slice(1)}`;
}
const clause = (s: string, max = 220) => (s.length <= max ? s : s.slice(0, s.lastIndexOf(",", max) > 80 ? s.lastIndexOf(",", max) : max).trim());

export function generateCoverLetter(profile: Profile, jd: ParsedJD, match: MatchResult, settings: Settings, opts: { today?: Date } = {}): CoverLetter {
  const idx: ProfileIndex = buildIndex(profile);
  const style = countryStyle(settings.country);
  const role = jd.roleTitle || settings.targetRole || "this role";
  const company = jd.company;
  const allowed = [jd.company, jd.roleTitle, settings.targetRole].filter(Boolean);
  const latest = profile.roles[0];
  const years = Math.floor(idx.years);
  const matched = matchedJdTerms(jd, match);
  const techTerms = matched.filter((m) => !["leadership", "management", "communication", "customer", "experience", "education"].includes(m.type)).slice(0, 4).map((m) => m.term);
  const list = (a: string[]) => (a.length <= 1 ? a.join("") : `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`);

  // P1: role + positioning
  const p1 = [
    `I am applying for the ${role} position${company ? ` at ${company}` : ""}.`,
    `${years ? `I bring ${years}+ years of` : "I bring"} verification experience${latest?.title ? `, most recently as ${latest.title}${latest.employer ? ` at ${latest.employer}` : ""}` : ""}, with hands-on work in ${list(techTerms.length ? techTerms : ["verification"])}.`,
  ].join(" ");

  // P2/P3: strongest direct evidence — distinct bullets that evidence mandatory/implied requirements.
  const strongest = match.requirements
    .filter((m) => (m.matchType === "exact" || m.matchType === "equivalent") && m.importance !== "preferred" && m.evidence.some((e) => e.field === "bullet"))
    .map((m) => ({ m, ev: m.evidence.find((e) => e.field === "bullet")! }));
  const used = new Set<string>();
  const pickFp = (pred: (b: string) => boolean = () => true) => {
    for (const { ev } of strongest) {
      if (used.has(ev.text) || !pred(ev.text)) continue;
      const fp = firstPerson(ev.text);
      if (fp) { used.add(ev.text); return clause(fp); }
    }
    return null;
  };
  const archEv = profile.roles.map((r) => r.architectureOwnership).find(Boolean);
  const leadEv = profile.roles.map((r) => r.leadership).find(Boolean);
  const take = (b?: string) => { if (!b || used.has(b)) return null; const fp = firstPerson(b); if (!fp) return null; used.add(b); return clause(fp); };
  const archFp = take(archEv), leadFp = take(leadEv);
  const tech: string[] = [];
  const nTech = 3;
  for (let i = 0; i < nTech; i++) { const f = pickFp(); if (f) tech.push(f); }
  const buildP2 = () => tech.length
    ? `The closest overlap with your requirements is hands-on verification work. ${tech.map((s, i) => `${i === 2 ? s.replace(/^I /, "I also ") : s}.`).join(" ")}`
    : `My background aligns with the posting on ${list(techTerms.slice(0, 3)) || "verification"}.`;
  let p2 = buildP2();
  const p3parts = [archFp, leadFp].filter(Boolean) as string[];
  const p3 = p3parts.length ? `Beyond block-level work, the scope has grown toward ownership. ${p3parts.map((s) => `${s}.`).join(" ")}` : "";

  // Tools and interfaces actually listed in the profile, JD-relevant first.
  const jdSet = new Set(jd.requirements.flatMap((r) => r.terms));
  const pick = (cat: string[], n: number) => [...cat].sort((a, b) => Number(jdSet.has(b)) - Number(jdSet.has(a))).slice(0, n);
  const tools = pick([...new Set(profile.roles.flatMap((r) => r.tools))], 4);
  const protos = pick([...new Set(profile.roles.flatMap((r) => r.protocols))], 4);
  const p3b = tools.length || protos.length
    ? `Day to day this has meant ${tools.length ? `working in ${list(tools)}` : ""}${tools.length && protos.length ? " and " : ""}${protos.length ? `verifying ${list(protos)} interfaces` : ""}.`
    : "";
  // P4: why this role (uses only JD text) + closing
  const recent = recentTerms(profile);
  const focus = [...jd.domainExpectations, ...jd.requirements.filter((r) => r.importance === "mandatory" && ["domain", "processor"].includes(r.type)).map((r) => r.text)].filter((t) => recent.has(t));
  const focusUniq = [...new Set(focus)].slice(0, 2);
  const respTerms = matched.filter((m) => ["architecture", "planning", "debugging", "coverage"].includes(m.type)).map((m) => m.term.toLowerCase()).slice(0, 4);
  const pResp = respTerms.length ? ` The responsibilities you describe, including ${list(respTerms)}, are areas I work in directly.` : "";
  const p4 = `${role === "this role" ? "This role" : `The ${role} role`}${company ? ` at ${company}` : ""} fits my background closely${focusUniq.length ? `: the posting focuses on ${list(focusUniq)}, which is where my current work sits` : ""}.${pResp} I would welcome a technical discussion on how my verification background fits your team's priorities.`;

  const prefHits = match.requirements.filter((m) => m.importance === "preferred" && (m.matchType === "exact" || m.matchType === "equivalent") && m.matchedTerms.length).map((m) => m.requirement).slice(0, 4);
  const pPref = prefHits.length ? ` My experience with ${list(prefHits)} also overlaps with the preferred qualifications in the posting.` : "";
  const wc = () => [p1, p2, p3, p3b, pPref, p4].join(" ").split(/\s+/).length;
  for (let f: string | null; wc() < 262 && tech.length < 5 && (f = pickFp());) { tech.push(f); p2 = buildP2(); }
  let paragraphs = [p1, p2, [p3, p3b].filter(Boolean).join(" ") + pPref, p4].filter(Boolean);
  const ctx = { index: idx, allowedNames: allowed };
  const removed: ClaimCheck[] = [];
  paragraphs = paragraphs.map((p) => { const r = sanitizeProse(p, ctx, false); removed.push(...r.removed); return r.clean; }).filter(Boolean);
  if (style.spelling === "UK") paragraphs = paragraphs.map((p) => UK_SPELL.reduce((s, [re, rep]) => s.replace(re, rep), p));

  const body = paragraphs.join(" ");
  const wordCount = body.split(/\s+/).filter(Boolean).length;
  const checks = auditProse(body, ctx);
  return {
    date: style.letterDate(opts.today ?? new Date()), salutation: style.salutation, paragraphs, closing: style.closing,
    signature: profile.identity.name, wordCount, removed, checks,
  };
}

export const letterToText = (l: CoverLetter) => [l.date, "", l.salutation, "", ...l.paragraphs.flatMap((p) => [p, ""]), l.closing, l.signature].join("\n");
