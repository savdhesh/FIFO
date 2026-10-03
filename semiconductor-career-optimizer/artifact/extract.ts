/** Browser text extraction for PDF / DOCX / TXT, plus PDF layout metrics for the ATS check. Nothing leaves the page. */
import type { LayoutInfo } from "../src/lib/ats/ats";
import { DATE_RANGE_RE } from "../src/lib/parsing/dates";

export interface Extracted { text: string; layout?: LayoutInfo }

export async function extractPdfBytes(buf: ArrayBuffer): Promise<Extracted> {
  const { getDocumentProxy } = await import("unpdf");
  const doc = await getDocumentProxy(new Uint8Array(buf));
  const pages: string[] = [];
  let rowsTotal = 0, colRows = 0, minFont: number | null = null, images: number | null = 0;
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const items = (content.items as { str: string; transform: number[]; width: number; height?: number }[]).filter((i) => i.str !== undefined && i.transform);
    const rows: { y: number; parts: { x: number; w: number; s: string }[] }[] = [];
    for (const it of items) {
      if (it.str.trim()) { const size = Math.abs(it.transform[0]) || it.height || 0; if (size > 0 && (minFont === null || size < minFont)) minFont = size; }
      const y = it.transform[5], x = it.transform[4];
      let row = rows.find((r) => Math.abs(r.y - y) < 2.5);
      if (!row) { row = { y, parts: [] }; rows.push(row); }
      row.parts.push({ x, w: it.width, s: it.str });
    }
    rows.sort((a, b) => b.y - a.y);
    pages.push(rows.map((r) => {
      r.parts.sort((a, b) => a.x - b.x);
      let line = "", end = -Infinity, big = -1;
      r.parts.forEach((p, i) => { if (i > 0 && p.x - end > 30 && big < 0) big = i; if (line && p.x - end > 1.5 && !line.endsWith(" ") && !p.s.startsWith(" ")) line += p.x - end > 12 ? "   " : " "; line += p.s; end = p.x + p.w; });
      if (line.trim()) {
        rowsTotal++;
        // A wide internal gap is only a column sign when the right-hand text is not a right-aligned date.
        if (big > 0) { const right = r.parts.slice(big).map((p) => p.s).join(" "); if (!DATE_RANGE_RE.test(right) && !/^[\s(]*(?:19|20)\d{2}/.test(right) && right.trim().length > 12) colRows++; }
      }
      return line.trimEnd();
    }).filter((l) => l.trim()).join("\n"));
    try {
      const ops = await page.getOperatorList();
      const IMG = new Set([83, 85, 86, 87, 88, 89, 90]); // pdf.js paintImage* operators
      images = (images ?? 0) + ops.fnArray.filter((f: number) => IMG.has(f)).length;
    } catch { images = null; }
  }
  const layout: LayoutInfo = { pages: doc.numPages, columns: rowsTotal >= 12 && colRows >= 6 && colRows / rowsTotal >= 0.25, minFontPt: minFont === null ? null : Math.round(minFont * 10) / 10, images };
  return { text: pages.join("\n"), layout };
}

export async function extractWithLayout(file: File): Promise<Extracted> {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (file.size > 5 * 1024 * 1024) throw new Error("File exceeds 5 MB");
  const buf = await file.arrayBuffer();
  const head = new Uint8Array(buf.slice(0, 5));
  if (ext === "txt") return { text: new TextDecoder().decode(buf) };
  if (ext === "docx") {
    if (head[0] !== 0x50 || head[1] !== 0x4b) throw new Error("File content is not a DOCX");
    const mammoth: any = await import("mammoth/mammoth.browser");
    return { text: (await (mammoth.default ?? mammoth).extractRawText({ arrayBuffer: buf })).value };
  }
  if (ext === "pdf") {
    if (String.fromCharCode(...head) !== "%PDF-") throw new Error("File content is not a PDF");
    return extractPdfBytes(buf);
  }
  throw new Error("Only PDF, DOCX or TXT files are accepted");
}

export async function extractBrowser(file: File): Promise<string> { return (await extractWithLayout(file)).text; }
