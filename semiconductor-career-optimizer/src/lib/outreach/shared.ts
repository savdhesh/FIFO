import type { MatchResult, ParsedJD, Profile, Role } from "../types";
import { buildIndex, roleBullets, type ProfileIndex } from "../profile-index";
import { ontology } from "../ontology/ontology";
import { matchedJdTerms } from "../tailoring/resume";

export const DISPLAY: Record<string, string> = {
  "Testbench Architecture": "Verification Architecture", "Gate-Level Simulation": "GLS", "Constrained Random Verification": "Constrained-Random Verification",
  "SystemVerilog Assertions": "SVA", "Formal Verification": "Formal Verification", "Functional Safety": "Functional Safety", "Design Verification": "Design Verification",
  "CPU Verification": "CPU Verification", "Test Automation": "Verification Automation", "Subsystem Integration": "Subsystem Verification",
};
export const show = (t: string) => DISPLAY[t] ?? t;

export interface Facts {
  idx: ProfileIndex; years: number; latest: Role | undefined; title: string; employer: string;
  jdTerms: string[]; // JD terms the candidate can evidence (exact/equivalent), ranked
  domain: string; // "SoC & IP verification"
  company: string; role: string;
}

export function gatherFacts(profile: Profile, jd: ParsedJD, match: MatchResult): Facts {
  const idx = buildIndex(profile);
  const latest = profile.roles[0];
  const have = (t: string) => idx.terms.has(t);
  const parts: string[] = [];
  if (have("SoC Verification")) parts.push("SoC");
  if (have("IP Verification")) parts.push("IP");
  if (have("CPU Verification")) parts.push("CPU");
  const joined = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} & ${parts[parts.length - 1]}` : parts[0];
  const domain = parts.length ? `${joined} verification` : "design verification";
  return {
    idx, years: Math.floor(idx.years), latest, title: latest?.title || "Verification Engineer", employer: latest?.employer ?? "",
    jdTerms: matchedJdTerms(jd, match).map((m) => m.term), domain, company: jd.company, role: jd.roleTitle,
  };
}

export const list = (a: string[]) => (a.length <= 1 ? a.join("") : `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`);

/** Terms the candidate can evidence, JD-relevant first, then everything else in the profile, as display names. */
export function rankedTerms(f: Facts, kinds: string[]): string[] {
  const out: string[] = [];
  const push = (t: string) => { if (!out.includes(t)) out.push(t); };
  const ok = (t: string) => kinds.includes(ontology.get(t)?.type ?? "");
  f.jdTerms.filter(ok).forEach(push);
  [...f.idx.terms.keys()].filter(ok).forEach(push);
  return out;
}

export const hasContract = (p: Profile) => p.roles.find((r) => /contract|freelance|consult/i.test(`${r.employmentType} ${r.title}`));
export { roleBullets };
