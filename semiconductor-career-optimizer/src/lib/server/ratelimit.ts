const buckets = new Map<string, number[]>();

/** Sliding-window limiter (in-memory; swap for Redis/Upstash when running multiple instances). */
export function rateLimit(key: string, max: number, windowMs: number): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= max) { buckets.set(key, hits); return { ok: false, retryAfter: Math.ceil((windowMs - (now - hits[0])) / 1000) }; }
  hits.push(now); buckets.set(key, hits);
  if (buckets.size > 5000) for (const [k, v] of buckets) if (!v.some((t) => now - t < windowMs)) buckets.delete(k);
  return { ok: true, retryAfter: 0 };
}
