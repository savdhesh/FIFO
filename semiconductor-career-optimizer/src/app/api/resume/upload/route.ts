import { db } from "@/lib/server/db";
import { route, json, HttpError } from "@/lib/server/api";
import { detectKind, mimeFor, sanitizeFilename, MAX_UPLOAD } from "@/lib/server/security";
import { storage } from "@/lib/server/storage";
import { log } from "@/lib/server/log";

export const runtime = "nodejs";

/** Keeps a private copy of the original file. Parsing happens in the browser, so the server never reads the content. */
export const POST = route(async (req, { user }) => {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_UPLOAD + 100_000) throw new HttpError(413, "File too large");
  const file = (await req.formData()).get("file");
  if (!(file instanceof File)) throw new HttpError(400, "No file provided");
  const data = Buffer.from(await file.arrayBuffer());
  const filename = sanitizeFilename(file.name);
  const kind = detectKind(filename, data);
  const key = await storage().put(user.id, data, kind);
  const row = await db.resumeFile.create({ data: { userId: user.id, filename, mime: mimeFor(kind), size: data.length, storageKey: key } });
  log("info", "resume_stored", { userId: user.id, bytes: data.length, mime: mimeFor(kind) });
  return json({ id: row.id });
}, { limit: { max: 30, windowMs: 3600_000, name: "upload" } });
