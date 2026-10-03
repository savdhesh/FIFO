/** Structured logging that can never carry resume/JD content: only whitelisted scalar metadata is emitted. */
const SAFE = new Set(["event", "userId", "route", "status", "ms", "provider", "bytes", "mime", "applicationId", "code"]);
export function log(level: "info" | "warn" | "error", event: string, meta: Record<string, string | number | boolean | undefined> = {}) {
  const safe: Record<string, unknown> = { level, event, t: new Date().toISOString() };
  for (const [k, v] of Object.entries(meta)) if (SAFE.has(k)) safe[k] = v;
  (level === "error" ? console.error : console.log)(JSON.stringify(safe));
}
