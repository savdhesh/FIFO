import type { FileKind } from "../server/security";

/** File bytes -> plain text. Content is never logged. */
export async function extractText(kind: FileKind, data: Buffer): Promise<string> {
  if (kind === "txt") return data.toString("utf8");
  if (kind === "docx") {
    const mammoth = await import("mammoth");
    return (await mammoth.extractRawText({ buffer: data })).value;
  }
  const pdf = (await import("pdf-parse/lib/pdf-parse.js" as string)).default as (b: Buffer) => Promise<{ text: string }>;
  return (await pdf(data)).text;
}
