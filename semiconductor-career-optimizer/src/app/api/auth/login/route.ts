import { z } from "zod";
import { db } from "@/lib/server/db";
import { route, json, HttpError } from "@/lib/server/api";
import { createSession, verifyPassword } from "@/lib/server/session";

const Body = z.object({ email: z.string().email().transform((s) => s.toLowerCase()), password: z.string().min(1).max(200) });

export const POST = route(async (req) => {
  const b = Body.parse(await req.json());
  const user = await db.user.findUnique({ where: { email: b.email } });
  const ok = user && (await verifyPassword(b.password, user.passwordHash));
  if (!user || !ok) throw new HttpError(401, "Invalid email or password");
  await createSession(user.id);
  return json({ ok: true });
}, { auth: false, limit: { max: 10, windowMs: 15 * 60_000, name: "login" } });
