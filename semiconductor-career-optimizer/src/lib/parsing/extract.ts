import type { FileKind } from "../server/security";

/** File bytes -> plain text. Content is never logged. */
export async function extractText(kind: FileKind, data: Buffer): Promise<string> {
  if (kind === "txt") return data.toString("utf8");
  if (kind === "docx") {
    const mammoth = await import("mammoth");
    return (await mammoth.extractRawText({ buffer: data })).value;
  }
  // unpdf bundles a modern pdf.js; the old pdf-parse build rejected valid files ("bad XRef entry").
  // Lines are rebuilt from glyph positions (same baseline = same line, left-to-right) so right-aligned dates stay on their line.
  const { getDocumentProxy } = await import("unpdf");
  const doc = await getDocumentProxy(new Uint8Array(data));
  const pages: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const content = await (await doc.getPage(n)).getTextContent();
    const items = (content.items as { str: string; transform: number[]; width: number }[]).filter((i) => i.str !== undefined && i.transform);
    const rows: { y: number; parts: { x: number; w: number; s: string }[] }[] = [];
    for (const it of items) {
      const y = it.transform[5], x = it.transform[4];
      let row = rows.find((r) => Math.abs(r.y - y) < 2.5);
      if (!row) { row = { y, parts: [] }; rows.push(row); }
      row.parts.push({ x, w: it.width, s: it.str });
    }
    rows.sort((a, b) => b.y - a.y);
    pages.push(rows.map((r) => {
      r.parts.sort((a, b) => a.x - b.x);
      let line = "", end = -Infinity;
      for (const p of r.parts) {
        if (line && p.x - end > 1.5 && !line.endsWith(" ") && !p.s.startsWith(" ")) line += p.x - end > 12 ? "   " : " ";
        line += p.s; end = p.x + p.w;
      }
      return line.trimEnd();
    }).filter((l) => l.trim()).join("\n"));
  }
  return pages.join("\n");
}
