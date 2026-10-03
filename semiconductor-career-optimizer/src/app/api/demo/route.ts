import { db } from "@/lib/server/db";
import { route, json } from "@/lib/server/api";
import { parseResumeHeuristic } from "@/lib/parsing/resume-parser";
import { DEMO_JD_TEXT, DEMO_RESUME_TEXT } from "@/lib/demo";

/** Load the fictional demo profile into the signed-in account (replaces the current profile). */
export const POST = route(async (_req, { user }) => {
  const profile = parseResumeHeuristic(DEMO_RESUME_TEXT);
  await db.careerProfile.upsert({ where: { userId: user.id }, create: { userId: user.id, data: profile as object }, update: { data: profile as object } });
  return json({ ok: true, sampleJd: DEMO_JD_TEXT });
});
