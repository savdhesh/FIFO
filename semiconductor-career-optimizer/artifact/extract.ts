/** Browser text extraction for PDF / DOCX / TXT, plus PDF layout metrics for the ATS check. Nothing leaves the page. */
import type { LayoutInfo } from "../src/lib/ats/ats";
import { pageToText } from "../src/lib/parsing/pdf-text";

export interface Extracted { text: string; layout?: LayoutInfo }

export async function extractPdfBytes(buf: ArrayBuffer): Promise<Extracted> {
  const { getDocumentProxy } = await import("unpdf");
  const doc = await getDocumentProxy(new Uint8Array(buf));
  const pages: string[] = [];
  let columns = false, minFont: number | null = null, images: number | null = 0;
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const width = (page.view?.[2] ?? 595) - (page.view?.[0] ?? 0);
    const items = (content.items as { str: string; transform: number[]; width: number }[]).filter((i) => i.str !== undefined && i.transform).map((i) => ({ str: i.str, x: i.transform[4], y: i.transform[5], w: i.width, size: Math.abs(i.transform[0]) }));
    const pt = pageToText(items, width);
    pages.push(pt.text); columns = columns || pt.columns;
    if (pt.minFont !== null && (minFont === null || pt.minFont < minFont)) minFont = pt.minFont;
    try {
      const ops = await page.getOperatorList();
      const IMG = new Set([83, 85, 86, 87, 88, 89, 90]); // pdf.js paintImage* operators
      images = (images ?? 0) + ops.fnArray.filter((f: number) => IMG.has(f)).length;
    } catch { images = null; }
  }
  return { text: pages.join("\n"), layout: { pages: doc.numPages, columns, minFontPt: minFont === null ? null : Math.round(minFont * 10) / 10, images } };
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
