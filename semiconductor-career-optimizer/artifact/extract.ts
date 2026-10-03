/** Browser text extraction for PDF / DOCX / TXT. Nothing leaves the page. */
export async function extractBrowser(file: File): Promise<string> {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (file.size > 5 * 1024 * 1024) throw new Error("File exceeds 5 MB");
  const buf = await file.arrayBuffer();
  const head = new Uint8Array(buf.slice(0, 5));
  if (ext === "txt") return new TextDecoder().decode(buf);
  if (ext === "docx") {
    if (head[0] !== 0x50 || head[1] !== 0x4b) throw new Error("File content is not a DOCX");
    const mammoth: any = await import("mammoth/mammoth.browser");
    return (await (mammoth.default ?? mammoth).extractRawText({ arrayBuffer: buf })).value;
  }
  if (ext === "pdf") {
    if (String.fromCharCode(...head) !== "%PDF-") throw new Error("File content is not a PDF");
    const { getDocumentProxy } = await import("unpdf");
    const doc = await getDocumentProxy(new Uint8Array(buf));
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
        for (const p of r.parts) { if (line && p.x - end > 1.5 && !line.endsWith(" ") && !p.s.startsWith(" ")) line += p.x - end > 12 ? "   " : " "; line += p.s; end = p.x + p.w; }
        return line.trimEnd();
      }).filter((l) => l.trim()).join("\n"));
    }
    return pages.join("\n");
  }
  throw new Error("Only PDF, DOCX or TXT files are accepted");
}
