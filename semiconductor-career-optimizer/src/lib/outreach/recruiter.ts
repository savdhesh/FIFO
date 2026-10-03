import type { ClaimCheck, MatchResult, ParsedJD, Profile, Settings } from "../types";
import { sanitizeProse } from "../truth/truth";
import { gatherFacts, list, show, type Facts } from "./shared";
import { ontology } from "../ontology/ontology";

export const CONNECT_LIMIT = 300;
export interface Message { kind: string; text: string; length: number; limit?: number; removed: ClaimCheck[] }
export interface OutreachPack { messages: Message[]; notes: string[] }

/** Short capability phrase from supported facts only (no "complex", no metrics). */
export function capabilityPhrases(f: Facts): string[] {
  const has = (t: string) => f.idx.terms.has(t);
  const out: string[] = [];
  if (has("SoC Verification") && has("IP Verification")) out.push("SoC/IP verification"); else if (has("SoC Verification")) out.push("SoC verification"); else if (has("IP Verification")) out.push("IP verification");
  if (has("UVM") && has("Testbench Architecture")) out.push("UVM architecture"); else if (has("UVM")) out.push("UVM");
  if (has("RISC-V") && has("CPU Verification")) out.push("RISC-V/processor verification"); else if (has("RISC-V")) out.push("RISC-V verification"); else if (has("CPU Verification")) out.push("processor verification");
  if (has("Formal Verification")) out.push("formal verification");
  if (has("Functional Safety")) out.push("functional safety");
  if (has("Debugging")) out.push("debug");
  if (!out.length) return ["design verification"];
  return out;
}

export function planOutreach(profile: Profile, jd: ParsedJD, match: MatchResult, settings: Settings, opts: { recruiterName?: string; hiringManagerName?: string } = {}): OutreachPack {
  const f = gatherFacts(profile, jd, match);
  const role = jd.roleTitle || settings.targetRole || "verification";
  const co = jd.company || "your company";
  const rn = opts.recruiterName?.trim() || "[Name]";
  const hm = opts.hiringManagerName?.trim() || "[Name]";
  const caps = capabilityPhrases(f);
  const yrs = f.years ? `${f.years}+ years` : "years";
  const allowed = [jd.company, jd.roleTitle, settings.targetRole].filter(Boolean);
  const ctx = { index: f.idx, allowedNames: allowed };

  // Connection request: must fit LinkedIn's 300-character note.
  let n = caps.length, connect = "";
  for (; n >= 1; n--) { connect = `Hi ${rn}, I applied for the ${role} role at ${co}. I have ${yrs} across ${list(caps.slice(0, n))}. Glad to connect.`; if (connect.length <= CONNECT_LIMIT) break; }
  if (connect.length > CONNECT_LIMIT) connect = `Hi ${rn}, I applied for the ${role} role at ${co} and would like to connect.`;

  const evidence = f.idx.items.filter((i) => i.kind === "bullet").find((i) => /^(owned|led|built|developed|defined|architected)/i.test(i.text) && ontology.findTerms(i.text).some((h) => f.jdTerms.includes(h.canonical)))?.text;
  const short = evidence?.split(/,\s+(?:including|using|with)\b|\s+using\b/)[0].replace(/[.;]\s*$/, "");
  const fp = short ? `I ${short.charAt(0).toLowerCase()}${short.slice(1)}.` : "";
  const focus = [...new Set(jd.requirements.filter((r) => r.importance === "mandatory" && ["domain", "processor", "methodology"].includes(r.type) && f.idx.terms.has(r.text)).map((r) => show(r.text)))].slice(0, 3);

  const drafts: [string, string, number?][] = [
    ["Connection request", connect, CONNECT_LIMIT],
    ["Message after applying", `Hi ${rn}, I applied for the ${role} role at ${co}. I have ${yrs} across ${list(caps.slice(0, 4))}. ${focus.length ? `The posting's focus on ${list(focus)} lines up with my current work. ` : ""}I'd be glad to share more detail on any of it. Thank you for your time.`],
    ["Reply to a recruiter who contacted you", `Hi ${rn}, thanks for reaching out about the ${role} role at ${co}. My background is ${list(caps.slice(0, 3))}, so the scope looks relevant. Could you share the team, location and work-model details? I'm available to talk on [day/time].`],
    ["Hiring manager outreach", `Hi ${hm}, I applied for the ${role} role on your team at ${co}. ${fp} ${focus.length ? `The posting centres on ${list(focus)}, which is where I've been working. ` : ""}Would a short conversation be useful?`.replace(/\s+/g, " ")],
  ];
  const messages: Message[] = drafts.map(([kind, text, limit]) => {
    const r = sanitizeProse(text, ctx, false);
    const clean = r.clean || text;
    return { kind, text: clean, length: clean.length, limit, removed: r.removed };
  });
  return { messages, notes: ["Bracketed items ([Name], [day/time]) are placeholders; the app does not know names, mutual contacts or anything about the company beyond the posting, and it does not invent any.", "Connection notes are capped at 300 characters by LinkedIn."] };
}
