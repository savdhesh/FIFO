import { z } from "zod";
import { db } from "@/lib/server/db";
import { route, json, HttpError } from "@/lib/server/api";
import { storage } from "@/lib/server/storage";
import { destroySession, verifyPassword } from "@/lib/server/session";

/** Delete all data (scope=data) or the whole account (scope=account). Requires the password. Irreversible. */
export const DELETE = route(async (req, { user }) => {
  const b = z.object({ password: z.string().min(1), scope: z.enum(["data", "account"]) }).parse(await req.json());
  const u = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  if (!(await verifyPassword(b.password, u.passwordHash))) throw new HttpError(403, "Incorrect password");
  const files = await db.resumeFile.findMany({ where: { userId: user.id }, select: { storageKey: true } });
  await Promise.all(files.map((f) => storage().delete(f.storageKey).catch(() => undefined)));
  if (b.scope === "account") { await db.user.delete({ where: { id: user.id } }); await destroySession(); }
  else await db.$transaction([db.resumeFile.deleteMany({ where: { userId: user.id } }), db.userState.deleteMany({ where: { userId: user.id } })]);
  return json({ ok: true });
}, { limit: { max: 5, windowMs: 3600_000, name: "delete-account" } });
