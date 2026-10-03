import type { Application } from "@prisma/client";
import { db } from "./db";
import { HttpError } from "./api";
import { getProvider } from "../ai";
import { ProfileSchema, SettingsSchema, type ChangeProposal, type MatchResult, type ParsedJD, type Profile, type Settings, type TailoredResume } from "../types";
import { applyDecisions, tailorResume } from "../tailoring/resume";
import { auditProse, auditResume, checkClaim, summarizeChecks, type TruthAudit } from "../truth/truth";
import { buildIndex } from "../profile-index";
import type { CoverLetter } from "../tailoring/cover-letter";

export async function loadProfile(userId: string): Promise<Profile> {
  const row = await db.careerProfile.findUnique({ where: { userId } });
  if (!row) throw new HttpError(409, "Create your career profile first (upload a resume on the Master Resume page).");
  const p = ProfileSchema.parse(row.data);
  if (!p.roles.length) throw new HttpError(409, "Your profile has no roles yet. Add experience first.");
  return p;
}

export async function ownApplication(userId: string, id: string): Promise<Application> {
  const app = await db.application.findFirst({ where: { id, userId } });
  if (!app) throw new HttpError(404, "Application not found");
  return app;
}

export interface AppView {
  settings: Settings; jd: ParsedJD; match: MatchResult;
  tailored: TailoredResume | null; changes: ChangeProposal[]; letter: CoverLetter | null;
}
export const view = (a: Application): AppView => ({
  settings: SettingsSchema.parse(a.settings), jd: a.parsedJd as unknown as ParsedJD, match: a.match as unknown as MatchResult,
  tailored: (a.tailored as unknown as TailoredResume) ?? null, changes: (a.changes as unknown as ChangeProposal[]) ?? [], letter: (a.coverLetter as unknown as CoverLetter) ?? null,
});

export async function createAnalysis(userId: string, input: { jdText: string; jobUrl?: string; company?: string; title?: string; settings: Settings }) {
  const profile = await loadProfile(userId);
  const provider = getProvider();
  const jd = await provider.analyzeJob(input.jdText, { company: input.company, title: input.title });
  if (input.company) jd.company = input.company;
  if (input.title) jd.roleTitle = input.title;
  if (!jd.requirements.some((r) => r.importance !== "administrative")) throw new HttpError(422, "No recognisable requirements found in the job description. Paste the full text.");
  const settings = { ...input.settings, targetRole: input.settings.targetRole || jd.roleTitle };
  const match = await provider.compareResumeToJob(profile, jd, settings);
  return db.application.create({
    data: { userId, company: jd.company, roleTitle: jd.roleTitle, jobUrl: input.jobUrl || null, jdText: input.jdText, settings: settings as object, parsedJd: jd as object, match: match as object, matchScore: match.overall, recommendation: match.recommendation.verdict, status: "ANALYZED" },
  });
}

export async function generatePack(userId: string, app: Application) {
  const profile = await loadProfile(userId);
  const { settings, jd, match } = view(app);
  const provider = getProvider();
  const rewrites = await provider.rewriteResume(profile, jd, match);
  const { tailored, changes } = tailorResume(profile, jd, match, settings, rewrites);
  const letter = await provider.generateCoverLetter(profile, jd, match, settings);
  const allowed = [jd.company, jd.roleTitle];
  const audit = {
    resume: auditResume(tailored, profile, allowed),
    letter: summarizeChecks(letter.checks),
    removedFromLetter: letter.removed.map((c) => ({ text: c.text, reasons: c.reasons })),
  };
  return db.application.update({ where: { id: app.id }, data: { tailored: tailored as object, changes: changes as object, coverLetter: letter as object, truthAudit: audit as object } });
}

/** Re-audit one change after the user edits its text. */
export function auditChangeText(c: ChangeProposal, text: string, profile: Profile, allowed: string[]) {
  const index = buildIndex(profile);
  const ctx = { index, roleId: c.roleId, allowedNames: allowed };
  const checks = c.section === "bullet" || c.section === "headline" || c.section === "competencies" ? [checkClaim(text, ctx)] : auditProse(text, ctx);
  const order = ["VERIFIED", "SUPPORTED", "INFERRED", "UNSUPPORTED"] as const;
  const status = checks.reduce((w, k) => (order.indexOf(k.status) > order.indexOf(w) ? k.status : w), "VERIFIED" as (typeof order)[number]);
  return { status, hallucination: checks.some((k) => k.hallucination), checks };
}

/** What would actually be exported right now, plus its audit. */
export function finalDocuments(a: Application, profile: Profile): { resume: TailoredResume; audit: TruthAudit } {
  const v = view(a);
  if (!v.tailored) throw new HttpError(409, "Generate the application pack first.");
  const resume = applyDecisions(v.tailored, v.changes, profile);
  return { resume, audit: auditResume(resume, profile, [v.jd.company, v.jd.roleTitle]) };
}
