const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_RE = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const DATE_TOKEN = `(?:${MONTH_RE}\\.?\\s*,?\\s*(?:19|20)\\d{2}|\\d{1,2}[/.](?:19|20)\\d{2}|(?:19|20)\\d{2})`;
const PRESENT = "(?:present|current|currently|now|till date|to date|ongoing|heute|bis heute|aktuell|aujourd.hui|actuel|actuellement|heden|nu|nuvarande|pågående|presente|actualidad|hoy)";
export const DATE_RANGE_RE = new RegExp(`(${DATE_TOKEN})\\s*(?:-|–|—|to|until)\\s*(${DATE_TOKEN}|${PRESENT})`, "i");

export interface YM { y: number; m: number }

export function parseYM(s: string, endOfYear = false): YM | null {
  const t = s.trim().toLowerCase();
  if (new RegExp(`^${PRESENT}$`).test(t)) { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() + 1 }; }
  let r = t.match(new RegExp(`^(${MONTH_RE})\\.?\\s*,?\\s*((?:19|20)\\d{2})$`));
  if (r) return { y: +r[2], m: MONTHS.indexOf(r[1].slice(0, 3)) + 1 };
  r = t.match(/^(\d{1,2})[/.]((?:19|20)\d{2})$/);
  if (r) return { y: +r[2], m: Math.min(12, Math.max(1, +r[1])) };
  r = t.match(/^((?:19|20)\d{2})$/);
  if (r) return { y: +r[1], m: endOfYear ? 12 : 1 };
  return null;
}

export const monthIndex = (d: YM) => d.y * 12 + d.m;

/** Total career months with overlap merged. Returns years rounded down to 0.5. */
export function totalYears(ranges: { start: string; end: string }[]): number {
  const spans = ranges
    .map((r) => {
      const a = parseYM(r.start);
      const b = r.end && !/^$/.test(r.end) ? parseYM(r.end, true) : parseYM("Present");
      return a && b ? [monthIndex(a), monthIndex(b)] : null;
    })
    .filter((x): x is number[] => !!x && x[1] >= x[0])
    .sort((x, y) => x[0] - y[0]);
  let total = 0, curS = -1, curE = -1;
  for (const [s, e] of spans) {
    if (curS < 0) { curS = s; curE = e; }
    else if (s <= curE + 1) curE = Math.max(curE, e);
    else { total += curE - curS + 1; curS = s; curE = e; }
  }
  if (curS >= 0) total += curE - curS + 1;
  return Math.floor((total / 12) * 2) / 2;
}

export function formatRange(start: string, end: string, style: "US" | "EU" = "US") {
  const f = (s: string) => {
    const d = parseYM(s);
    if (!d || /present|current/i.test(s)) return /present|current|now/i.test(s) ? "Present" : s;
    const name = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.m - 1];
    return /^\d{4}$/.test(s.trim()) ? s.trim() : style === "EU" ? `${String(d.m).padStart(2, "0")}/${d.y}` : `${name} ${d.y}`;
  };
  return `${f(start)} – ${end ? f(end) : "Present"}`;
}
