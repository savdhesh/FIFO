import { describe, it, expect } from "vitest";
import vocab from "@/lib/ontology/vocabulary.json";
import { BANK } from "@/lib/interview/bank";
import { ontology } from "@/lib/ontology/ontology";
import { REQ_TYPES } from "@/lib/types";

type E = { canonical: string; aliases: string[]; category: string; type: string; parent?: string; related?: string[]; weak?: string[] };
const entries = vocab as E[];
const key = (s: string) => s.toLowerCase().replace(/[-_\s]+/g, " ").trim();

describe("vocabulary integrity", () => {
  it("canonical names are unique", () => { expect(new Set(entries.map((e) => e.canonical)).size).toBe(entries.length); });
  it("no alias or canonical is claimed by two different entries (would silently shadow)", () => {
    const owner = new Map<string, string>(); const clashes: string[] = [];
    for (const e of entries) for (const a of new Set([e.canonical, ...e.aliases])) { const k = key(a); const o = owner.get(k); if (o && o !== e.canonical) clashes.push(`${a}: ${o} / ${e.canonical}`); else owner.set(k, e.canonical); }
    expect(clashes).toEqual([]);
  });
  it("related/weak/parent references point to real entries; parents are acyclic; types are valid", () => {
    const names = new Set(entries.map((e) => e.canonical));
    for (const e of entries) {
      for (const t of [...(e.related ?? []), ...(e.weak ?? []), ...(e.parent ? [e.parent] : [])]) expect(names.has(t), `${e.canonical} -> ${t}`).toBe(true);
      expect((REQ_TYPES as readonly string[]).includes(e.type), `${e.canonical} type ${e.type}`).toBe(true);
      const seen = new Set<string>(); let cur: E | undefined = e;
      while (cur?.parent) { expect(seen.has(cur.parent), `cycle at ${e.canonical}`).toBe(false); seen.add(cur.parent); cur = entries.find((x) => x.canonical === cur!.parent); }
    }
  });
  it("every canonical resolves to itself through the matcher", () => {
    for (const e of entries) expect(ontology.findTerms(e.canonical).map((h) => h.canonical), e.canonical).toContain(e.canonical);
  });
  it("every alias resolves to its own entry (not shadowed by a longer alias of another entry)", () => {
    const bad: string[] = [];
    for (const e of entries) for (const a of e.aliases) { const r = ontology.findTerms(a).map((h) => h.canonical); if (!r.includes(e.canonical)) bad.push(`${a} -> ${r.join(",")} (expected ${e.canonical})`); }
    expect(bad).toEqual([]);
  });
  it("interview bank topics exist", () => { for (const b of BANK) expect(ontology.get(b.topic), b.topic).toBeTruthy(); });
});
