import type { FileKind } from "../server/security";

/** File bytes -> plain text. Content is never logged. */
export async function extractText(kind: FileKind, data: Buffer): Promise<string> {
  if (kind === "txt") return data.toString("utf8");
  if (kind === "docx") {
    const mammoth = await import("mammoth");
    return (await mammoth.extractRawText({ buffer: data })).value;
  }
  // unpdf bundles a modern pdf.js; the old pdf-parse build rejected valid files ("bad XRef entry").
  // Lines are rebuilt from glyph positions; two-column pages are read column by column.
  const { getDocumentProxy } = await import("unpdf");
  const { pageToText } = await import("./pdf-text");
  const doc = await getDocumentProxy(new Uint8Array(data));
  const pages: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const width = (page.view?.[2] ?? 595) - (page.view?.[0] ?? 0);
    const items = (content.items as { str: string; transform: number[]; width: number }[]).filter((i) => i.str !== undefined && i.transform).map((i) => ({ str: i.str, x: i.transform[4], y: i.transform[5], w: i.width, size: Math.abs(i.transform[0]) }));
    pages.push(pageToText(items, width).text);
  }
  return pages.join("\n");
}
