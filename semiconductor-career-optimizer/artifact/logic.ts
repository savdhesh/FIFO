/** Browser-side application logic: the same engines as the server app, with state kept by the page. */
import { LLMProvider } from "../src/lib/ai/llm";
import { MockProvider } from "../src/lib/ai/mock";
import type { AIProvider } from "../src/lib/ai/provider";
import { applyDecisions, tailorResume } from "../src/lib/tailoring/resume";
import { auditProse, auditResume, checkClaim, summarizeChecks } from "../src/lib/truth/truth";
import { buildIndex } from "../src/lib/profile-index";
import type { ChangeProposal, MatchResult, ParsedJD, Profile, Settings, TailoredResume } from "../src/lib/types";
import type { CoverLetter } from "../src/lib/tailoring/cover-letter";
import type { LinkedInPlan } from "../src/lib/outreach/linkedin";
import type { OutreachPack } from "../src/lib/outreach/recruiter";

export interface AppRecord {
  id: string; createdAt: string; company: string; roleTitle: string; jobUrl: string; jdText: string;
  settings: Settings; jd: ParsedJD; match: MatchResult;
  tailored: TailoredResume | null; changes: ChangeProposal[]; letter: CoverLetter | null;
  status: string; notes: string; recruiterName: string; recruiterContact: string; appliedAt: string;
  linkedin?: LinkedInPlan | null; outreach?: OutreachPack | null; history?: { status: string; at: string }[];
}

export type Transport = (system: string, user: string) => Promise<string>;
export const providerFor = (t: Transport | null): AIProvider => (t ? new LLMProvider("claude", t) : new MockProvider());

export async function analyze(profile: Profile, p: AIProvider, input: { jdText: string; jobUrl: string; company: string; title: string; settings: Settings }): Promise<AppRecord> {
  if (!profile.roles.length) throw new Error("Your profile has no roles yet. Add experience first.");
  const jd = await p.analyzeJob(input.jdText, { company: input.company || undefined, title: input.title || undefined });
  if (input.company) jd.company = input.company;
  if (input.title) jd.roleTitle = input.title;
  if (!jd.requirements.some((r) => r.importance !== "administrative")) throw new Error("No recognisable requirements found. Paste the full job description.");
  const settings = { ...input.settings, targetRole: input.settings.targetRole || jd.roleTitle };
  const match = await p.compareResumeToJob(profile, jd, settings);
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, createdAt: new Date().toISOString(), company: jd.company, roleTitle: jd.roleTitle, jobUrl: input.jobUrl, jdText: input.jdText,
    settings, jd, match, tailored: null, changes: [], letter: null, status: "ANALYZED", history: [{ status: "ANALYZED", at: new Date().toISOString() }], notes: "", recruiterName: "", recruiterContact: "", appliedAt: "",
  };
}

export async function generate(profile: Profile, p: AIProvider, a: AppRecord): Promise<AppRecord> {
  const rewrites = await p.rewriteResume(profile, a.jd, a.match);
  const { tailored, changes } = tailorResume(profile, a.jd, a.match, a.settings, rewrites);
  const letter = await p.generateCoverLetter(profile, a.jd, a.match, a.settings);
  return { ...a, tailored, changes, letter };
}

const order = ["VERIFIED", "SUPPORTED", "INFERRED", "UNSUPPORTED"] as const;
export function auditChangeText(c: ChangeProposal, text: string, profile: Profile, allowed: string[]) {
  const ctx = { index: buildIndex(profile), roleId: c.roleId, allowedNames: allowed };
  const checks = c.section === "bullet" || c.section === "headline" || c.section === "competencies" ? [checkClaim(text, ctx)] : auditProse(text, ctx);
  const status = checks.reduce((w, k) => (order.indexOf(k.status) > order.indexOf(w) ? k.status : w), "VERIFIED" as (typeof order)[number]);
  return { status, hallucination: checks.some((k) => k.hallucination), reasons: checks.flatMap((k) => k.reasons) };
}

export function decide(a: AppRecord, profile: Profile, id: string, decision: "accepted" | "rejected" | "pending" | "edited", finalText?: string): { app: AppRecord; warning?: string } {
  const changes = a.changes.map((c) => ({ ...c }));
  const c = changes.find((x) => x.id === id)!;
  const allowed = [a.jd.company, a.jd.roleTitle];
  let warning: string | undefined;
  if (decision === "accepted" && c.status === "UNSUPPORTED") throw new Error("This change contains unsupported claims and cannot be accepted. Edit it so it only uses facts from your profile.");
  if (decision === "edited" && finalText) {
    const r = auditChangeText(c, finalText, profile, allowed);
    c.finalText = finalText; c.status = r.status; c.hallucination = r.hallucination; c.decision = "edited";
    if (r.status === "UNSUPPORTED") warning = `POTENTIAL HALLUCINATION: ${r.reasons.join(" ")} This text is excluded from exports until fixed.`;
  } else c.decision = decision;
  return { app: { ...a, changes }, warning };
}
export const acceptAllSafe = (a: AppRecord): AppRecord => ({ ...a, changes: a.changes.map((c) => (c.decision === "pending" && (c.status === "VERIFIED" || c.status === "SUPPORTED") ? { ...c, decision: "accepted" as const } : c)) });

export function finalDocs(a: AppRecord, profile: Profile) {
  if (!a.tailored) throw new Error("Generate the application pack first.");
  const resume = applyDecisions(a.tailored, a.changes, profile);
  const allowed = [a.jd.company, a.jd.roleTitle];
  const audit = auditResume(resume, profile, allowed);
  const letterAudit = a.letter ? summarizeChecks(auditProse(a.letter.paragraphs.join("\n"), { index: buildIndex(profile), allowedNames: allowed })) : null;
  return { resume, audit, letterAudit };
}

export function saveLetter(a: AppRecord, profile: Profile, paragraphs: string[]): AppRecord {
  if (!a.letter) throw new Error("Generate the application pack first.");
  const checks = auditProse(paragraphs.join("\n"), { index: buildIndex(profile), allowedNames: [a.jd.company, a.jd.roleTitle] });
  const bad = checks.filter((c) => c.status === "UNSUPPORTED");
  if (bad.length) throw new Error("POTENTIAL HALLUCINATION: " + bad.map((b) => `“${b.text}” — ${b.reasons.join(" ")}`).join(" | "));
  return { ...a, letter: { ...a.letter, paragraphs, checks, removed: [], wordCount: paragraphs.join(" ").split(/\s+/).length } };
}
