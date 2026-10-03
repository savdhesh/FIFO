import { z } from "zod";
import type { AIProvider } from "./provider";
import { NotImplementedError } from "./provider";
import { MockProvider } from "./mock";
import { PROMPTS } from "./prompts";
import { ProfileSchema, ParsedJDSchema, type ClaimCheck, type ClaimStatus, type Profile } from "../types";
import { normalizeText } from "../parsing/resume-parser";
import { jaccard } from "../matching/bullets";
import { ontology } from "../ontology/ontology";
import { checkClaim, sanitizeProse } from "../truth/truth";
import { buildIndex } from "../profile-index";
import { generateCoverLetter } from "../tailoring/cover-letter";
import type { CoverLetter } from "../tailoring/cover-letter";
import { countryStyle } from "../countries";

export type Transport = (system: string, user: string) => Promise<string>;

export function extractJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const start = t.indexOf("{"), end = t.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("No JSON object in model output");
  return JSON.parse(t.slice(start, end + 1));
}

/** Call the model, validate with Zod, retry with the validation error fed back. */
export async function structured<T>(transport: Transport, schema: z.ZodType<T, z.ZodTypeDef, unknown>, system: string, user: string, retries = 2): Promise<T> {
  let lastErr = "";
  for (let i = 0; i <= retries; i++) {
    const prompt = i === 0 ? user : `${user}\n\nYour previous reply was invalid: ${lastErr}\nReturn ONLY corrected JSON.`;
    try {
      return schema.parse(extractJson(await transport(system, prompt)));
    } catch (e) {
      lastErr = e instanceof Error ? e.message.slice(0, 600) : "invalid";
    }
  }
  throw new Error(`Model returned invalid structured output after ${retries + 1} attempts`);
}

/** Drop anything the model "found" that is not grounded in the source resume text. */
export function groundProfile(profile: Profile, raw: string): Profile {
  const lines = normalizeText(raw).split("\n").map((l) => l.trim()).filter(Boolean);
  const lower = raw.toLowerCase();
  const grounded = (b: string) => lower.includes(b.toLowerCase().slice(0, 40)) || lines.some((l) => jaccard(l, b) >= 0.6);
  return ProfileSchema.parse({
    ...profile,
    roles: profile.roles.map((r) => ({
      ...r,
      employer: !r.employer || lower.includes(r.employer.toLowerCase()) ? r.employer : "",
      title: !r.title || lower.includes(r.title.toLowerCase()) ? r.title : "",
      responsibilities: r.responsibilities.filter(grounded),
      achievements: r.achievements.filter(grounded),
      tools: r.tools.filter((t) => lower.includes(t.toLowerCase())),
      protocols: r.protocols.filter((t) => lower.includes(t.toLowerCase())),
      technologies: r.technologies.filter((t) => lower.includes(t.toLowerCase())),
      methodologies: r.methodologies.filter((t) => lower.includes(t.toLowerCase()) || ontology.findTerms(r.responsibilities.join(" ")).some((h) => h.canonical.toLowerCase() === t.toLowerCase())),
    })),
  });
}

export class LLMProvider implements AIProvider {
  readonly sendsDataExternally = true;
  private mock = new MockProvider();
  constructor(readonly name: string, private transport: Transport) {}

  async analyzeResume(raw: string) {
    try {
      const p = await structured(this.transport, ProfileSchema, PROMPTS.resumeParser, `RESUME TEXT:\n${raw}`);
      p.roles.forEach((r, i) => { r.id ||= `r${i + 1}`; });
      return groundProfile(p, raw);
    } catch { return this.mock.analyzeResume(raw); } // fall back to the deterministic parser
  }
  async analyzeJob(text: string, hints?: { company?: string; title?: string }) {
    const base = await this.mock.analyzeJob(text, hints); // deterministic ontology terms + frequencies
    try {
      const llm = await structured(this.transport, ParsedJDSchema.partial({ keywordFrequency: true }), PROMPTS.jdParser, `JOB DESCRIPTION:\n${text}`);
      // Keep ontology-grounded requirements from the deterministic parser; take the model's metadata when the parser found none.
      return ParsedJDSchema.parse({
        ...base, roleTitle: base.roleTitle || llm.roleTitle, company: base.company || llm.company, location: base.location || llm.location,
        workAuthorization: base.workAuthorization || llm.workAuthorization, education: base.education || llm.education,
        yearsRequired: base.yearsRequired ?? llm.yearsRequired,
      });
    } catch { return base; }
  }
  // Scoring stays deterministic for explainability; the model never overrides match types.
  compareResumeToJob(p: Profile, jd: Parameters<AIProvider["compareResumeToJob"]>[1], s: Parameters<AIProvider["compareResumeToJob"]>[2]) { return this.mock.compareResumeToJob(p, jd, s); }

  async rewriteResume(p: Profile, jd: Parameters<AIProvider["rewriteResume"]>[1], m: Parameters<AIProvider["rewriteResume"]>[2]) {
    const det = await this.mock.rewriteResume(p, jd, m);
    const weak = m.seniority.weakBullets.slice(0, 12);
    if (!weak.length) return det;
    try {
      const out = await structured(this.transport, z.object({ rewrites: z.array(z.object({ roleId: z.string(), original: z.string(), proposed: z.string(), reason: z.string().default("Model-proposed rewrite") })) }),
        PROMPTS.resumeRewrite, JSON.stringify({ profile: p, jd: { roleTitle: jd.roleTitle, requirements: jd.requirements.slice(0, 25).map((r) => r.text) }, bullets: weak }));
      const known = new Set(p.roles.flatMap((r) => [...r.responsibilities, ...r.achievements]));
      return [...out.rewrites.filter((r) => known.has(r.original)).map((r) => ({ ...r, reason: `${r.reason} — confirm it is accurate.` })), ...det.filter((d) => !out.rewrites.some((o) => o.original === d.original))];
    } catch { return det; }
  }

  async generateCoverLetter(p: Profile, jd: Parameters<AIProvider["generateCoverLetter"]>[1], m: Parameters<AIProvider["generateCoverLetter"]>[2], s: Parameters<AIProvider["generateCoverLetter"]>[3]): Promise<CoverLetter> {
    const det = generateCoverLetter(p, jd, m, s);
    try {
      const out = await structured(this.transport, z.object({ paragraphs: z.array(z.string()).min(3).max(6) }), PROMPTS.coverLetter, JSON.stringify({ profile: p, jd: { roleTitle: jd.roleTitle, company: jd.company, requirements: jd.requirements.slice(0, 20).map((r) => r.text) }, country: s.country, matched: m.strengths }));
      const idx = buildIndex(p);
      const ctx = { index: idx, allowedNames: [jd.company, jd.roleTitle].filter(Boolean) };
      const removed: ClaimCheck[] = [];
      const paragraphs = out.paragraphs.map((x) => { const r = sanitizeProse(x, ctx, false); removed.push(...r.removed); return r.clean; }).filter(Boolean);
      const words = paragraphs.join(" ").split(/\s+/).length;
      if (words < 200 || words > 450) return det; // model ignored the length brief: use the deterministic letter
      const style = countryStyle(s.country);
      return { ...det, paragraphs, removed, wordCount: words, salutation: style.salutation, closing: style.closing };
    } catch { return det; }
  }

  async auditClaims(p: Profile, claims: string[]): Promise<ClaimCheck[]> {
    const idx = buildIndex(p);
    const det = claims.map((c) => checkClaim(c, { index: idx }));
    try {
      const out = await structured(this.transport, z.object({ checks: z.array(z.object({ text: z.string(), status: z.enum(["VERIFIED", "SUPPORTED", "INFERRED", "UNSUPPORTED"]), reasons: z.array(z.string()).default([]) })) }), PROMPTS.truthAudit, JSON.stringify({ profile: p, claims }));
      const rank: Record<ClaimStatus, number> = { VERIFIED: 0, SUPPORTED: 1, INFERRED: 2, UNSUPPORTED: 3 };
      // The model may only make the verdict STRICTER than the deterministic checker.
      return det.map((d) => { const m = out.checks.find((c) => c.text === d.text); return m && rank[m.status] > rank[d.status] ? { ...d, status: m.status, hallucination: m.status === "UNSUPPORTED", reasons: [...d.reasons, ...m.reasons.map((r) => `Model: ${r}`)] } : d; });
    } catch { return det; }
  }
  async optimizeLinkedIn(): Promise<never> { throw new NotImplementedError("LinkedIn optimizer"); }
  async generateRecruiterMessage(): Promise<never> { throw new NotImplementedError("Recruiter messages"); }
}
