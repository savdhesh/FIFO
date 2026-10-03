import { z } from "zod";
import { db } from "@/lib/server/db";
import { route, json } from "@/lib/server/api";
import { finalDocuments, loadProfile, ownApplication, view } from "@/lib/server/service";
import { auditProse, summarizeChecks } from "@/lib/truth/truth";
import { buildIndex } from "@/lib/profile-index";

export const GET = route(async (_req, { user, params }) => {
  const a = await ownApplication(user.id, params.id);
  const v = view(a);
  let final: unknown = null, letterAudit: unknown = null;
  if (v.tailored) {
    const profile = await loadProfile(user.id);
    final = finalDocuments(a, profile);
    if (v.letter) letterAudit = summarizeChecks(auditProse(v.letter.paragraphs.join("\n"), { index: buildIndex(profile), allowedNames: [v.jd.company, v.jd.roleTitle] }));
  }
  return json({ application: { final, letterAudit, id: a.id, company: a.company, roleTitle: a.roleTitle, jobUrl: a.jobUrl, status: a.status, notes: a.notes, recruiterName: a.recruiterName, recruiterContact: a.recruiterContact, appliedAt: a.appliedAt, matchScore: a.matchScore, recommendation: a.recommendation, createdAt: a.createdAt, truthAudit: a.truthAudit, ...view(a) } });
});

const Patch = z.object({
  status: z.enum(["SAVED", "ANALYZED", "APPLYING", "APPLIED", "RECRUITER_CONTACTED", "SCREENING", "TECHNICAL_ROUND", "HIRING_MANAGER", "FINAL_ROUND", "OFFER", "REJECTED", "WITHDRAWN"]).optional(),
  company: z.string().max(120).optional(), roleTitle: z.string().max(160).optional(), jobUrl: z.string().max(2000).nullable().optional(),
  notes: z.string().max(10_000).nullable().optional(), recruiterName: z.string().max(120).nullable().optional(), recruiterContact: z.string().max(200).nullable().optional(),
  appliedAt: z.string().datetime().nullable().optional(),
});
export const PATCH = route(async (req, { user, params }) => {
  await ownApplication(user.id, params.id);
  const b = Patch.parse(await req.json());
  const { appliedAt, ...rest } = b;
  const a = await db.application.update({ where: { id: params.id }, data: { ...rest, ...(appliedAt !== undefined ? { appliedAt: appliedAt ? new Date(appliedAt) : null } : {}) } });
  return json({ ok: true, status: a.status });
});

export const DELETE = route(async (_req, { user, params }) => {
  await ownApplication(user.id, params.id);
  await db.application.delete({ where: { id: params.id } });
  return json({ ok: true });
});
