import { z } from "zod";
import { db } from "@/lib/server/db";
import { route, json, HttpError } from "@/lib/server/api";
import { createSession, hashPassword } from "@/lib/server/session";

const Body = z.object({ email: z.string().email().max(200).transform((s) => s.toLowerCase()), password: z.string().min(10).max(200), name: z.string().max(100).optional() });

export const POST = route(async (req) => {
  const b = Body.parse(await req.json());
  if (await db.user.findUnique({ where: { email: b.email } })) throw new HttpError(409, "An account with this email already exists");
  const user = await db.user.create({ data: { email: b.email, name: b.name, passwordHash: await hashPassword(b.password) } });
  await createSession(user.id);
  return json({ ok: true });
}, { auth: false, limit: { max: 10, windowMs: 3600_000, name: "register" } });
