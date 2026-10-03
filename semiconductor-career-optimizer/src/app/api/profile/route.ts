import { db } from "@/lib/server/db";
import { route, json } from "@/lib/server/api";
import { ProfileSchema } from "@/lib/types";

export const GET = route(async (_req, { user }) => {
  const row = await db.careerProfile.findUnique({ where: { userId: user.id } });
  return json({ profile: row?.data ?? null });
});

export const PUT = route(async (req, { user }) => {
  const profile = ProfileSchema.parse(await req.json());
  profile.roles.forEach((r, i) => { if (!r.id) r.id = `r${Date.now().toString(36)}${i}`; });
  await db.careerProfile.upsert({ where: { userId: user.id }, create: { userId: user.id, data: profile as object }, update: { data: profile as object } });
  return json({ profile });
}, { limit: { max: 60, windowMs: 60_000, name: "profile" } });
