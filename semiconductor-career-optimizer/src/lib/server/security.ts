import dns from "dns/promises";
import net from "net";
import { HttpError } from "./api";

export const MAX_UPLOAD = (Number(process.env.MAX_UPLOAD_MB) || 5) * 1024 * 1024;
const ALLOWED = { pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", txt: "text/plain" } as const;
export type FileKind = keyof typeof ALLOWED;

export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  const clean = base.normalize("NFKD").replace(/[^\w.\- ]+/g, "_").replace(/\.{2,}/g, ".").replace(/^\.+/, "").trim().slice(0, 100);
  return clean || "file";
}

/** Extension AND magic-byte validation; browser-supplied MIME types are not trusted. */
export function detectKind(filename: string, data: Buffer): FileKind {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (!ext || !(ext in ALLOWED)) throw new HttpError(415, "Only PDF, DOCX or TXT files are accepted");
  if (data.length === 0) throw new HttpError(400, "File is empty");
  if (data.length > MAX_UPLOAD) throw new HttpError(413, `File exceeds ${MAX_UPLOAD / 1024 / 1024} MB`);
  if (ext === "pdf" && data.subarray(0, 5).toString("latin1") !== "%PDF-") throw new HttpError(415, "File content is not a PDF");
  if (ext === "docx" && !(data[0] === 0x50 && data[1] === 0x4b)) throw new HttpError(415, "File content is not a DOCX");
  if (ext === "txt" && data.subarray(0, 4096).includes(0)) throw new HttpError(415, "File content is not plain text");
  return ext as FileKind;
}
export const mimeFor = (k: FileKind) => ALLOWED[k];

function isPrivateIp(ip: string): boolean {
  if (net.isIPv6(ip)) return /^(::1|fc|fd|fe80|::ffff:(10|127|169\.254|192\.168|172\.(1[6-9]|2\d|3[01]))\.)/i.test(ip) || ip === "::";
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

/** Fetch a job-posting URL with SSRF protection (no private/loopback targets, no redirects to them, size/time caps). */
export async function fetchJobPage(rawUrl: string): Promise<string> {
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new HttpError(400, "Invalid URL"); }
  for (let hop = 0; hop < 4; hop++) {
    if (!/^https?:$/.test(url.protocol)) throw new HttpError(400, "Only http(s) URLs are allowed");
    const addrs = net.isIP(url.hostname) ? [{ address: url.hostname }] : await dns.lookup(url.hostname, { all: true }).catch(() => { throw new HttpError(400, "Could not resolve host"); });
    if (addrs.some((a) => isPrivateIp(a.address))) throw new HttpError(400, "URL points to a private address");
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(15_000), headers: { "user-agent": "SemiconductorCareerOptimizer/0.1", accept: "text/html,text/plain" } });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) { url = new URL(res.headers.get("location")!, url); continue; }
    if (!res.ok) throw new HttpError(422, `Job page returned HTTP ${res.status}. Paste the description instead.`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 2_000_000) throw new HttpError(413, "Job page too large");
    return htmlToText(buf.toString("utf8"));
  }
  throw new HttpError(422, "Too many redirects");
}

export function htmlToText(html: string): string {
  const ld = html.match(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/i)?.[1];
  let jobLd = "";
  try { const o = ld ? JSON.parse(ld) : null; if (o?.description) jobLd = `${o.title ?? ""}\n${o.hiringOrganization?.name ?? ""}\n${String(o.description)}`; } catch { /* ignore */ }
  const src = jobLd || html;
  return src
    .replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|li|h\d|tr|br|ul|ol)>|<br\s*\/?>/gi, "\n").replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim().slice(0, 30_000);
}
