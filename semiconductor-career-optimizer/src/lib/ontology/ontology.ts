import vocabulary from "./vocabulary.json";
import type { MatchType, ReqType } from "../types";

export interface VocabEntry {
  canonical: string;
  aliases: string[];
  category: string;
  type: ReqType;
  parent?: string; // broader domain this term implies (JasperGold -> Formal Verification)
  family?: string; // sibling group (formal tools, simulators, AMBA...)
  related?: string[]; // symmetric: closely related terms
  weak?: string[]; // directional: owning this term makes the listed terms plausible, not proven
}

export interface TermHit { canonical: string; surface: string; index: number; count?: number }

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const NOT_TERMS = [/electronics?\s*(?:&|and)\s*(?:tele)?communications?(?:\s+engineering)?/gi, /information\s*(?:&|and)\s*communications?\s+technology/gi];

export class Ontology {
  readonly entries!: VocabEntry[];
  private byCanonical = new Map<string, VocabEntry>();
  private matchers: { entry: VocabEntry; alias: string; re: RegExp; len: number }[] = [];

  private base: VocabEntry[];
  constructor(entries: VocabEntry[] = vocabulary as VocabEntry[]) {
    this.base = entries;
    this.entries = [];
    this.rebuild([]);
  }

  /** Replace the user-defined vocabulary (additions to the built-in list; built-in canonicals cannot be overridden). */
  setCustom(custom: VocabEntry[]) { this.rebuild(custom); }

  private rebuild(custom: VocabEntry[]) {
    const have = new Set(this.base.map((e) => e.canonical.toLowerCase()));
    const entries = [...this.base, ...custom.filter((c) => c.canonical && !have.has(c.canonical.toLowerCase()))];
    (this as { entries: VocabEntry[] }).entries = entries;
    this.byCanonical.clear(); this.matchers = [];
    for (const e of entries) this.byCanonical.set(e.canonical.toLowerCase(), e);
    for (const e of entries) {
      for (const alias of new Set([e.canonical, ...e.aliases])) {
        this.matchers.push({ entry: e, alias, re: this.buildRegex(alias), len: alias.length });
      }
    }
    this.matchers.sort((a, b) => b.len - a.len); // longest alias claims its span first
  }

  private buildRegex(alias: string): RegExp {
    const caseSensitive = /^[A-Z0-9+#.\-]{1,4}$/.test(alias) || alias === "C"; // short acronyms: SV, DV, UVM, AI
    const body = alias.split(/[\s\-_]+/).map(escapeRe).join("[\\s\\-_]*");
    const plural = alias.length > 4 && !caseSensitive && /[a-z]$/i.test(alias) ? "s?" : "";
    const left = "(?<![A-Za-z0-9+#])";
    const right = alias === "C" ? "(?![A-Za-z0-9+#])" : "(?![A-Za-z0-9#]|\\+\\+(?!\\+))";
    // 'C++' must not be swallowed by 'C'; C only matches when not followed by + or word char.
    return new RegExp(`${left}${body}${plural}${right}`, caseSensitive ? "g" : "gi");
  }

  get(canonical: string): VocabEntry | undefined { return this.byCanonical.get(canonical.toLowerCase()); }

  /** Resolve free text (alias or canonical) to its canonical entry. */
  resolve(term: string): VocabEntry | undefined {
    const hits = this.findTerms(term);
    return hits.length ? this.get(hits[0].canonical) : undefined;
  }

  /** Find all ontology terms in text. Longer aliases claim their span so "Questa Formal" is not also "Questa". */
  findTerms(text: string): TermHit[] {
    const claimed: [number, number][] = [];
    // Phrases that contain a term but are not that skill: degree names ("Electronics & Communication Engineering").
    for (const re of NOT_TERMS) { re.lastIndex = 0; for (const m of text.matchAll(re)) claimed.push([m.index!, m.index! + m[0].length]); }
    const hits: TermHit[] = [];
    for (const m of this.matchers) {
      m.re.lastIndex = 0;
      let r: RegExpExecArray | null;
      while ((r = m.re.exec(text))) {
        const s = r.index, e = s + r[0].length;
        if (r[0].length === 0) { m.re.lastIndex++; continue; }
        if (claimed.some(([a, b]) => s < b && e > a)) continue;
        claimed.push([s, e]);
        hits.push({ canonical: m.entry.canonical, surface: r[0], index: s });
      }
    }
    return hits.sort((a, b) => a.index - b.index);
  }

  /** Distinct canonical terms with mention counts. */
  termCounts(text: string): Map<string, number> {
    const out = new Map<string, number>();
    for (const h of this.findTerms(text)) out.set(h.canonical, (out.get(h.canonical) ?? 0) + 1);
    return out;
  }

  /**
   * Classify how a profile term set satisfies one JD term.
   * exact/equivalent: same concept (alias spelling differs => equivalent).
   * related: same family or parent/child tool<->domain. weak: plausible by implication only. missing: nothing.
   */
  relate(jdTerm: string, profile: Map<string, Set<string>>): { type: MatchType; via?: string } {
    const jd = this.get(jdTerm);
    if (!jd) return { type: "missing" };
    const surfaces = profile.get(jd.canonical);
    if (surfaces) return { type: "exact" };

    // A child in the profile implies its parent (JasperGold => formal verification): equivalent domain evidence.
    for (const p of profile.keys()) {
      const pe = this.get(p);
      if (pe?.parent && this.sameConcept(pe.parent, jd.canonical)) return { type: "equivalent", via: p };
    }
    // Same family (Questa Formal vs JasperGold, VCS vs Xcelium) or symmetric related edge.
    for (const p of profile.keys()) {
      const pe = this.get(p)!;
      if (jd.family && pe.family === jd.family) return { type: "related", via: p };
      if (jd.related?.includes(p) || pe.related?.includes(jd.canonical)) return { type: "related", via: p };
    }
    // Parent in profile, specific tool/method in JD: domain known, specific gap remains.
    for (const p of profile.keys()) {
      if (jd.parent && this.sameConcept(jd.parent, p)) return { type: "related", via: p };
    }
    for (const p of profile.keys()) {
      const pe = this.get(p)!;
      if (pe.weak?.includes(jd.canonical)) return { type: "weak", via: p };
    }
    return { type: "missing" };
  }

  private sameConcept(a: string, b: string) { return a.toLowerCase() === b.toLowerCase(); }
}

export const ontology = new Ontology();

/** Build a profile term map: canonical -> surface forms seen. */
export function termMap(text: string, extra: string[] = []): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const h of ontology.findTerms(text)) {
    if (!m.has(h.canonical)) m.set(h.canonical, new Set());
    m.get(h.canonical)!.add(h.surface.toLowerCase());
  }
  for (const x of extra) {
    for (const h of ontology.findTerms(x)) {
      if (!m.has(h.canonical)) m.set(h.canonical, new Set());
      m.get(h.canonical)!.add(h.surface.toLowerCase());
    }
  }
  return m;
}
