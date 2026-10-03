import { ontology } from "../ontology/ontology";

export type BulletClass = "Strong" | "Acceptable" | "Weak" | "Generic" | "Duplicate" | "Unsupported";

const GENERIC_START = /^(?:worked (?:on|with)|responsible for|involved in|helped|assisted|participated|exposure to|part of|handled|dealt with|supported)\b/i;
const OWNERSHIP = /\b(owned|led|architected|defined|drove|established|built|developed|designed|created|delivered|implemented|introduced|spearheaded|mentored|managed|signed[- ]off|closed|automated|developed)\b/i;
const SCOPE = /\b(subsystem|soc|ip|block|multi-?block|environment|framework|infrastructure|reusable|end-to-end|cpu|core|chip|full[- ]chip|regression|strategy|architecture|methodology|plan)\b/i;
const METRIC = /(\d+\s?%|\b\d+(?:\.\d+)?\s?x\b|\b\d+\s+(?:engineers?|members|blocks?|projects?|tapeouts?)\b)/i;

const tokens = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9+\s-]/g, " ").split(/\s+/).filter((w) => w.length > 2));
export function jaccard(a: string, b: string) {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  let i = 0;
  for (const x of A) if (B.has(x)) i++;
  return i / (A.size + B.size - i);
}

export function classifyBullet(text: string, previous: string[] = []): { cls: BulletClass; reason: string } {
  const words = text.trim().split(/\s+/).length;
  const nTerms = new Set(ontology.findTerms(text).map((h) => h.canonical)).size;
  if (previous.some((p) => jaccard(p, text) >= 0.8)) return { cls: "Duplicate", reason: "Near-identical to another bullet" };
  if (GENERIC_START.test(text) && nTerms < 3) return { cls: "Generic", reason: "Vague opener ('worked on / responsible for') without technical scope" };
  if (nTerms === 0) return { cls: "Generic", reason: "No technical content recognised" };
  if (words < 8 || (nTerms <= 1 && !SCOPE.test(text))) return { cls: "Weak", reason: "Little technical scope or ownership stated" };
  const own = OWNERSHIP.test(text), scope = SCOPE.test(text), metric = METRIC.test(text);
  if (own && nTerms >= 3 && (scope || metric)) return { cls: "Strong", reason: "Action + technical scope + ownership" };
  return { cls: "Acceptable", reason: own ? "Clear action but limited scope/impact detail" : "Technical but no ownership verb" };
}
