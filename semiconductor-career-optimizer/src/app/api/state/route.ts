import { z } from "zod";
import { db } from "@/lib/server/db";
import { route, json, HttpError } from "@/lib/server/api";
import { ProfileSchema } from "@/lib/types";

const MAX_BYTES = 8 * 1024 * 1024;

/** The workspace document. Validated on the way in so a buggy client cannot store malformed profiles. */
const State = z.object({
  profile: ProfileSchema.nullable(),
  apps: z.array(z.record(z.unknown())).max(500),
  resumes: z.array(z.object({ id: z.string().max(64), name: z.string().max(200), profile: ProfileSchema }).passthrough()).max(40),
  prefs: z.object({ theme: z.string().max(40).optional(), weights: z.record(z.number()).optional(), vocab: z.array(z.record(z.unknown())).max(500).optional() }).passthrough(),
}).passthrough();

export const GET = route(async (_req, { user }) => {
  const row = await db.userState.findUnique({ where: { userId: user.id } });
  return json({ state: row?.data ?? null });
});

export const PUT = route(async (req, { user }) => {
  const raw = await req.text();
  if (raw.length > MAX_BYTES) throw new HttpError(413, "Workspace is too large to save (8 MB limit). Delete old applications or resumes.");
  const { state } = z.object({ state: State }).parse(JSON.parse(raw));
  await db.userState.upsert({ where: { userId: user.id }, create: { userId: user.id, data: state as object }, update: { data: state as object } });
  return json({ ok: true });
}, { limit: { max: 240, windowMs: 60_000, name: "state" } });
