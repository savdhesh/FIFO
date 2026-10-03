/** Position-aware PDF text reconstruction shared by the server and the browser extractors. */
export interface TextItem { str: string; x: number; y: number; w: number; size: number }
export interface PageText { text: string; columns: boolean; minFont: number | null }

const rowsOf = (items: TextItem[]) => {
  const rows: { y: number; parts: TextItem[] }[] = [];
  for (const it of items) {
    let row = rows.find((r) => Math.abs(r.y - it.y) < 2.5);
    if (!row) { row = { y: it.y, parts: [] }; rows.push(row); }
    row.parts.push(it);
  }
  return rows.sort((a, b) => b.y - a.y);
};
const lineOf = (parts: TextItem[]) => {
  const ps = [...parts].sort((a, b) => a.x - b.x);
  let line = "", end = -Infinity;
  for (const p of ps) { if (line && p.x - end > 1.5 && !line.endsWith(" ") && !p.str.startsWith(" ")) line += p.x - end > 12 ? "   " : " "; line += p.str; end = p.x + p.w; }
  return line.trimEnd();
};

/**
 * Detect a two-column page (a vertical gutter that almost no text crosses, with substantial text on both sides)
 * and read the left column then the right one. A full-width header above the columns is kept first.
 */
export function pageToText(raw: TextItem[], pageWidth: number): PageText {
  const items = raw.filter((i) => i.str.trim());
  const minFont = items.length ? Math.min(...items.map((i) => i.size).filter((s) => s > 0)) : null;
  const plain = (its: TextItem[]) => rowsOf(its).map((r) => lineOf(r.parts)).filter((l) => l.trim()).join("\n");
  if (items.length < 20 || !pageWidth) return { text: plain(items), columns: false, minFont };

  let best: { g: number; cross: number } | null = null;
  for (let g = pageWidth * 0.28; g <= pageWidth * 0.72; g += 3) {
    const cross = items.filter((i) => i.x < g && i.x + i.w > g).length;
    if (!best || cross < best.cross) best = { g, cross };
  }
  if (!best) return { text: plain(items), columns: false, minFont };
  const g = best.g;
  const left = items.filter((i) => i.x + i.w / 2 < g), right = items.filter((i) => i.x + i.w / 2 >= g);
  const rows = rowsOf(items);
  const bothSides = rows.filter((r) => r.parts.some((p) => p.x < g - 4) && r.parts.some((p) => p.x >= g + 2) && !r.parts.some((p) => p.x < g && p.x + p.w > g));
  const twoCol = best.cross <= items.length * 0.03 && left.length >= items.length * 0.2 && right.length >= items.length * 0.2 && bothSides.length >= 5;
  if (!twoCol) return { text: plain(items), columns: false, minFont };

  const firstSplit = rows.findIndex((r) => bothSides.includes(r));
  const headRows = rows.slice(0, firstSplit);
  const body = rows.slice(firstSplit).flatMap((r) => r.parts);
  const headLines = headRows.map((r) => lineOf(r.parts)).filter((l) => l.trim());
  const col = (its: TextItem[]) => rowsOf(its).map((r) => lineOf(r.parts)).filter((l) => l.trim());
  return { text: [...headLines, ...col(body.filter((i) => i.x + i.w / 2 < g)), ...col(body.filter((i) => i.x + i.w / 2 >= g))].join("\n"), columns: true, minFont };
}
