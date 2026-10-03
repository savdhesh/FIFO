import { db } from "@/lib/server/db";
import { route, json, HttpError } from "@/lib/server/api";
import { storage } from "@/lib/server/storage";

/** Private, authenticated download. Never a public URL. */
export const GET = route(async (_req, { user, params }) => {
  const f = await db.resumeFile.findFirst({ where: { id: params.id, userId: user.id } });
  if (!f) throw new HttpError(404, "Not found");
  const bytes = await storage().get(f.storageKey);
  return new Response(new Uint8Array(bytes), { headers: { "content-type": f.mime, "content-disposition": `attachment; filename="${f.filename.replace(/"/g, "")}"`, "cache-control": "private, no-store" } });
});

export const DELETE = route(async (_req, { user, params }) => {
  const f = await db.resumeFile.findFirst({ where: { id: params.id, userId: user.id } });
  if (!f) throw new HttpError(404, "Not found");
  await storage().delete(f.storageKey).catch(() => undefined);
  await db.resumeFile.delete({ where: { id: f.id } });
  return json({ ok: true });
});
