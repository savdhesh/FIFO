import type { ClaimCheck, MatchResult, ParsedJD, Profile, Settings } from "../types";
import { ontology } from "../ontology/ontology";
import { buildIndex } from "../profile-index";
import { checkClaim, sanitizeProse } from "../truth/truth";
import { gatherFacts, hasContract, list, rankedTerms, roleBullets, show, type Facts } from "./shared";
import { classifyBullet } from "../matching/bullets";
import { matchedJdTerms } from "../tailoring/resume";

export const HEADLINE_LIMIT = 220;
export type Cover = "present" | "related" | "missing";

export interface HeadlineVariant { kind: string; text: string; length: number; status: ClaimCheck["status"]; reasons: string[] }
export interface LinkedInPlan {
  keywordCoverage: { keyword: string; state: Cover; note: string }[];
  titleKeywords: { keyword: string; held: boolean; note: string }[];
  headlines: HeadlineVariant[];
  skippedHeadlines: { kind: string; why: string }[];
  about: { text: string; removed: ClaimCheck[] };
  skills: string[];
  featured: { item: string; why: string }[];
  experience: { roleLabel: string; lead: string[]; weak: string[] }[];
  missingKeywords: { keyword: string; why: string }[];
  notes: string[];
  current?: { headline?: { length: number; present: string[]; missing: string[] }; about?: { present: string[]; missing: string[] } };
}

const CORE = ["SystemVerilog", "UVM", "SoC Verification", "IP Verification", "Testbench Architecture", "RISC-V", "CPU Verification", "Functional Safety", "Gate-Level Simulation", "PCIe", "SerDes", "Formal Verification", "Functional Coverage", "SystemVerilog Assertions", "Constrained Random Verification", "Python", "Design Verification"];
const TITLE_KW: [string, RegExp][] = [["Principal Engineer", /principal/i], ["Staff Engineer", /\bstaff\b/i], ["Verification Architect", /architect/i], ["Verification Lead", /\blead\b/i], ["Verification Manager", /manager/i]];

function cover(f: Facts, term: string): { state: Cover; note: string } {
  const r = ontology.relate(term, f.idx.terms);
  if (r.type === "exact") return { state: "present", note: "In your profile" };
  if (r.type === "equivalent") return { state: "present", note: `Implied by ${r.via} (use the term only where accurate)` };
  if (r.type === "related" || r.type === "weak") return { state: "related", note: `Related background (${r.via}); add the phrase only if you confirm you did this work` };
  return { state: "missing", note: "Not in your profile; do not add" };
}

export function planLinkedIn(profile: Profile, jd: ParsedJD, match: MatchResult, settings: Settings, current?: { headline?: string; about?: string }): LinkedInPlan {
  const f = gatherFacts(profile, jd, match);
  const idx = f.idx;
  const allowed = [jd.company, jd.roleTitle, settings.targetRole].filter(Boolean);

  // Recruiter-search keyword coverage: fixed DV vocabulary + the JD's own terms.
  const kw = [...new Set([...CORE, ...jd.requirements.filter((r) => r.importance !== "administrative" && r.terms[0] && ["language", "methodology", "protocol", "processor", "domain", "simulator", "formal-tool", "assertion", "coverage"].includes(r.type)).flatMap((r) => r.terms)])];
  const keywordCoverage = kw.map((k) => ({ keyword: show(k), ...cover(f, k) }));
  const titles = profile.roles.map((r) => r.title).join(" | ");
  const titleKeywords = TITLE_KW.map(([k, re]) => ({ keyword: k, held: re.test(titles), note: re.test(titles) ? "A title you have held" : "Not a title you have held. Do not add it to your headline or roles; reach it through scope and keywords." }));

  // Headlines (all facts from the profile; title words are only the real ones).
  const tools = rankedTerms(f, ["simulator", "formal-tool"]).slice(0, 2).map(show);
  const langs = ["SystemVerilog", "UVM"].filter((t) => idx.terms.has(t));
  const proc = ["RISC-V", "ARM"].filter((t) => idx.terms.has(t)).slice(0, 2);
  const extras = ["Automotive", "Functional Safety", "Gate-Level Simulation", "PCIe", "SerDes"].filter((t) => idx.terms.has(t)).map(show);
  const arch = idx.terms.has("Testbench Architecture"); // only when the profile actually evidences architecture work
  const dom = f.domain === "verification" ? "" : f.domain.replace(/ verification$/, "");
  const heads: [string, string[], string?][] = [
    ["Recruiter-search optimised", [f.title, dom ? `${dom} Verification` : "", langs.join("/"), ...proc, ...extras.slice(0, 3), arch ? "Verification Architecture" : ""]],
    ["Principal / seniority-led", [f.title, f.years ? `${f.years}+ years` : "", dom ? `${dom} Verification` : "", langs.join("/"), ...proc, ...tools]],
  ];
  const skippedHeadlines: LinkedInPlan["skippedHeadlines"] = [];
  if (arch) heads.push(["Architect-focused", [f.title, "Verification Architecture & Methodology", langs.join("/"), idx.terms.has("Functional Coverage") ? "Coverage Strategy" : "", ...proc.slice(0, 1), idx.terms.has("Verification Planning") ? "Verification Planning" : ""]]);
  else skippedHeadlines.push({ kind: "Architect-focused", why: "No architecture-ownership evidence in your profile." });
  const contract = hasContract(profile);
  if (contract) heads.push(["Consulting-focused", [contract.title || "Design Verification Consultant", dom ? `${dom} Verification` : "", langs.join("/"), ...proc, ...extras.slice(0, 2)]]);
  else skippedHeadlines.push({ kind: "Consulting-focused", why: "No contract, freelance or consulting role in your profile." });
  if (idx.terms.has("AI for Verification")) heads.push(["AI + verification", [f.title, "AI-assisted Verification", dom ? `${dom} Verification` : "", langs.join("/")]]);
  else skippedHeadlines.push({ kind: "AI + verification", why: "No AI/ML evidence in your profile." });

  const headlines: HeadlineVariant[] = heads.map(([kind, parts]) => {
    let text = parts.filter(Boolean).join(" | ");
    while (text.length > HEADLINE_LIMIT && parts.length > 2) { parts.pop(); text = parts.filter(Boolean).join(" | "); }
    const c = checkClaim(text, { index: idx, allowedNames: allowed });
    return { kind, text, length: text.length, status: c.status, reasons: c.reasons };
  });

  // About: distinct from the resume summary: positioning, what you work on, toolbox, intent.
  const top = matchedJdTerms(jd, match).filter((m) => !["leadership", "management", "communication", "customer", "experience", "education"].includes(m.type)).slice(0, 6).map((m) => show(m.term));
  const bullets = profile.roles.flatMap((r) => roleBullets(r).map((b) => ({ r, b })));
  const rel = (b: string) => new Set(ontology.findTerms(b).map((h) => h.canonical)).size;
  const lead = bullets.filter(({ b }) => classifyBullet(b).cls === "Strong" || classifyBullet(b).cls === "Acceptable").sort((x, y) => rel(y.b) - rel(x.b)).slice(0, 3).map(({ b }) => `• ${b.split(/,\s+(?:including|using|with)\b|\s+using\b/)[0].replace(/[.;]\s*$/, "")}`);
  const toolList = [...new Set(profile.roles.flatMap((r) => r.tools))].slice(0, 6);
  const protoList = [...new Set(profile.roles.flatMap((r) => r.protocols))].slice(0, 6);
  const para = [
    `${f.title}${f.years ? ` with ${f.years}+ years` : ""} in ${f.domain}${top.length ? `, working across ${list(top)}` : ""}.`,
    lead.length ? `What I work on:\n${lead.join("\n")}` : "",
    toolList.length || protoList.length ? `Toolbox: ${[toolList.length ? `${list(toolList)}` : "", protoList.length ? `interfaces including ${list(protoList)}` : ""].filter(Boolean).join("; ")}.` : "",
    `Open to ${settings.targetRole || jd.roleTitle || "verification"} roles${profile.identity.location ? `; based in ${profile.identity.location}` : ""}.`,
  ].filter(Boolean);
  const removed: ClaimCheck[] = [];
  // Bullet block is trimmed profile text (kept line by line); prose paragraphs are sanitized sentence by sentence.
  const aboutText = para.map((p) => {
    if (p.startsWith("What I work on")) return p;
    const r = sanitizeProse(p, { index: idx, allowedNames: allowed }, false); removed.push(...r.removed); return r.clean;
  }).filter(Boolean).join("\n\n");

  // Skills order: profile skills only, JD-relevant first.
  const jdSet = new Set(jd.requirements.flatMap((r) => r.terms));
  const allSkills = Object.values(profile.skills).flat();
  const skills = [...new Set(allSkills)].sort((a, b) => Number(ontology.findTerms(b).some((h) => jdSet.has(h.canonical))) - Number(ontology.findTerms(a).some((h) => jdSet.has(h.canonical)))).slice(0, 50);

  const experience = profile.roles.slice(0, 4).map((r) => {
    const bs = roleBullets(r);
    const ranked = bs.map((b) => ({ b, s: rel(b) })).sort((x, y) => y.s - x.s);
    const weak = bs.filter((b) => ["Weak", "Generic"].includes(classifyBullet(b).cls));
    return { roleLabel: [r.title, r.employer].filter(Boolean).join(" @ "), lead: ranked.filter((x) => !weak.includes(x.b)).slice(0, 3).map((x) => x.b), weak };
  });

  const featured: LinkedInPlan["featured"] = [
    ...profile.projects.slice(0, 3).map((p) => ({ item: p.name || "Project", why: "A short write-up or slide for this project (the Presentation tab builds a projects deck you can upload)." })),
    ...profile.publications.slice(0, 2).map((p) => ({ item: p, why: "Publications and patents belong in Featured with a link." })),
    ...(profile.identity.github ? [{ item: profile.identity.github, why: "Link your public repositories if they show verification work you can discuss." }] : []),
    ...profile.certifications.slice(0, 2).map((c) => ({ item: c, why: "Certifications recruiters search for." })),
  ];
  if (!featured.length) featured.push({ item: "Nothing to feature yet", why: "Add projects, publications or certifications to your profile and they will be suggested here." });
  const missingKeywords = match.keywordAnalysis.filter((k) => k.suggestion).map((k) => ({ keyword: show(k.term), why: k.why ?? "" }));
  const notes: string[] = [];
  if (headlines[0] && headlines[0].length > HEADLINE_LIMIT) notes.push("Headline exceeds LinkedIn's limit.");
  const first300 = aboutText.slice(0, 300);
  const miss = top.filter((t) => !first300.toLowerCase().includes(t.toLowerCase()));
  if (miss.length) notes.push(`The first ~300 characters of About are what recruiters see before "see more"; they do not mention ${list(miss.slice(0, 3))}.`);
  notes.push("LinkedIn search weights headline, current title, skills and About. The resume is for ATS parsing; the profile is for discovery, so it leads with scope and keywords instead of reproducing resume bullets.");

  let cur: LinkedInPlan["current"];
  if (current?.headline || current?.about) {
    const keys = keywordCoverage.filter((k) => k.state !== "missing").map((k) => k.keyword);
    const scan = (t: string) => { const found = new Set(ontology.findTerms(t).map((h) => show(h.canonical))); return { present: keys.filter((k) => found.has(k)), missing: keys.filter((k) => !found.has(k)).slice(0, 10) }; };
    cur = { headline: current.headline ? { length: current.headline.length, ...scan(current.headline) } : undefined, about: current.about ? scan(current.about) : undefined };
  }
  return { keywordCoverage, titleKeywords, headlines, skippedHeadlines, about: { text: aboutText, removed }, skills, featured, experience, missingKeywords, notes, current: cur };
}
