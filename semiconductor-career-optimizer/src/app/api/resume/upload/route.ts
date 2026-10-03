import { db } from "@/lib/server/db";
import { route, json, HttpError } from "@/lib/server/api";
import { detectKind, mimeFor, sanitizeFilename, MAX_UPLOAD } from "@/lib/server/security";
import { storage } from "@/lib/server/storage";
import { extractText } from "@/lib/parsing/extract";
import { normalizeText } from "@/lib/parsing/resume-parser";
import { getProvider } from "@/lib/ai";
import { log } from "@/lib/server/log";

export const runtime = "nodejs";

export const POST = route(async (req, { user }) => {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_UPLOAD + 100_000) throw new HttpError(413, "File too large");
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "No file provided");
  const data = Buffer.from(await file.arrayBuffer());
  const filename = sanitizeFilename(file.name);
  const kind = detectKind(filename, data);
  let text: string;
  try { text = normalizeText(await extractText(kind, data)); } catch { throw new HttpError(422, "Could not read this file. Try exporting it again or upload a DOCX/TXT version."); }
  if (text.length < 200) throw new HttpError(422, "Almost no text could be extracted (scanned/image PDF?). Upload a text-based PDF, DOCX or TXT.");

  const key = await storage().put(user.id, data, kind);
  const row = await db.resumeFile.create({ data: { userId: user.id, filename, mime: mimeFor(kind), size: data.length, storageKey: key, rawText: text } });
  const provider = getProvider();
  const parsed = await provider.analyzeResume(text);
  const existing = await db.careerProfile.findUnique({ where: { userId: user.id } });
  let applied = false;
  if (!existing) { await db.careerProfile.create({ data: { userId: user.id, data: parsed as object } }); applied = true; }
  log("info", "resume_uploaded", { userId: user.id, bytes: data.length, mime: mimeFor(kind), provider: provider.name });
  return json({ resumeId: row.id, parsed, applied, provider: provider.name, externalProcessing: provider.sendsDataExternally });
}, { limit: { max: 15, windowMs: 3600_000, name: "upload" } });
