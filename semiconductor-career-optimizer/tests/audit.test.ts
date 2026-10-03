/**
 * Cross-product consistency audit: every candidate-facing text the system can generate, for many resume x job pairs,
 * must contain no ontology term, metric, credential or leadership claim that the profile does not support.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { parseResumeHeuristic } from "@/lib/parsing/resume-parser";
import { parseJobDescriptionHeuristic } from "@/lib/parsing/jd-parser";
import { analyzeMatch } from "@/lib/matching/matcher";
import { tailorResume, applyDecisions } from "@/lib/tailoring/resume";
import { generateCoverLetter } from "@/lib/tailoring/cover-letter";
import { planLinkedIn } from "@/lib/outreach/linkedin";
import { planOutreach } from "@/lib/outreach/recruiter";
import { buildDeck } from "@/lib/deck/deck";
import { planInterview } from "@/lib/interview/interview";
import { auditResume, checkClaim, auditProse } from "@/lib/truth/truth";
import { buildIndex } from "@/lib/profile-index";
import { ontology } from "@/lib/ontology/ontology";
import { DEMO_JD_TEXT, DEMO_RESUME_TEXT } from "@/lib/demo";
import { SettingsSchema, type Profile } from "@/lib/types";

const dir = path.join(__dirname, "fixtures/resumes");
const RESUMES: [string, string][] = [["demo", DEMO_RESUME_TEXT], ...fs.readdirSync(dir).map((f) => [f, fs.readFileSync(path.join(dir, f), "utf8")] as [string, string])];
const JDS: [string, string][] = [
  ["demo", DEMO_JD_TEXT],
  ["formal-manager", `Verification Manager\nHooli Silicon\nLocation: Munich, Germany\n\nRequirements\n- 12+ years in design verification, managing a team of 10 engineers.\n- JasperGold and VC Formal experience; formal sign-off.\n- UCIe, CXL and PCIe Gen6 verification.\n- Hiring, performance reviews and budget ownership.\n\nPreferred\n- Experience with Palladium emulation and PMP certification.\n`],
  ["safety", `Functional Safety Verification Engineer\nInitrode Automotive\nLocation: Stuttgart, Germany\n\nRequirements\n- ISO 26262 ASIL-D experience with fault injection campaigns and FMEDA.\n- Lockstep, ECC, watchdog and BIST safety mechanisms.\n- CAN FD and LIN protocols; AUTOSAR knowledge.\n- SystemVerilog and UVM.\n\nPreferred\n- ISO 21434 cybersecurity and SOTIF.\n`],
  ["ai", `AI + Design Verification Engineer\nGlobex AI\n\nRequirements\n- Experience applying LLMs and machine learning to verification, test generation and coverage prediction.\n- Strong UVM and SystemVerilog.\n- Python for ML pipelines.\n\nPreferred\n- Experience with reinforcement learning stimulus generation and agentic debug.\n`],
  ["junior", `Verification Engineer\nStartup Chips\n\nRequirements\n- 2+ years of SystemVerilog and UVM.\n- AXI and APB protocol knowledge.\n- Scripting in Python or Perl.\n`],
];
const settings = SettingsSchema.parse({ country: "Germany", seniority: "Principal" });

/** Ontology terms present in `text` that the profile does not support (exact/equivalent) — excluding allowed JD names. */
function unsupportedTerms(text: string, profile: Profile, allowed: string[]): string[] {
  const idx = buildIndex(profile);
  let t = text;
  for (const a of allowed.filter(Boolean)) t = t.split(a).join(" ");
  return [...new Set(ontology.findTerms(t).map((h) => h.canonical))].filter((term) => { const r = ontology.relate(term, idx.terms).type; return r !== "exact" && r !== "equivalent"; });
}

describe("cross-product truth audit", () => {
  for (const [rn, rtext] of RESUMES) for (const [jn, jtext] of JDS) {
    it(`${rn} x ${jn}`, () => {
      const profile = parseResumeHeuristic(rtext);
      if (!profile.roles.length) return;
      const jd = parseJobDescriptionHeuristic(jtext);
      const match = analyzeMatch(profile, jd, settings);
      const allowed = [jd.company, jd.roleTitle];
      const idx = buildIndex(profile);

      // scores sane
      for (const s of match.scores) { expect(s.value).toBeGreaterThanOrEqual(0); expect(s.value).toBeLessThanOrEqual(100); }
      expect(match.overall).toBeGreaterThanOrEqual(0);

      // resume with EVERYTHING accepted (including inferred) never contains unsupported claims
      const { tailored, changes } = tailorResume(profile, jd, match, settings);
      const final = applyDecisions(tailored, changes.map((c) => ({ ...c, decision: "accepted" as const })), profile);
      const audit = auditResume(final, profile, allowed);
      expect(audit.hallucinations.map((h) => h.text + " :: " + h.reasons.join("|")), "resume").toEqual([]);
      // INFERRED proposals (e.g. "including verification planning") are the user-approved exception by design.
      const inferred = new Set(changes.filter((c) => c.status === "INFERRED").map((c) => c.proposed));
      const plainText = [final.headline, final.summary, ...final.competencies, ...final.experience.flatMap((e) => e.bullets.map((b) => b.text))].filter((t) => !inferred.has(t)).join(" ¦ ");
      expect(unsupportedTerms(plainText, profile, allowed), "resume terms").toEqual([]);
      expect(changes.filter((c) => c.status === "UNSUPPORTED").map((c) => c.proposed), "no unsupported proposals are ever generated").toEqual([]);

      // cover letter
      const letter = generateCoverLetter(profile, jd, match, settings);
      const lt = letter.paragraphs.join("\n");
      expect(auditProse(lt, { index: idx, allowedNames: allowed }).filter((c) => c.status === "UNSUPPORTED").map((c) => c.text), "letter").toEqual([]);
      expect(unsupportedTerms(lt, profile, allowed), "letter terms").toEqual([]);

      // linkedin
      const li = planLinkedIn(profile, jd, match, settings);
      for (const h of li.headlines) { expect(h.length).toBeLessThanOrEqual(220); expect(unsupportedTerms(h.text, profile, allowed), `headline ${h.kind}`).toEqual([]); expect(h.status).not.toBe("UNSUPPORTED"); }
      expect(unsupportedTerms(li.about.text, profile, allowed), "about").toEqual([]);

      // outreach
      const out = planOutreach(profile, jd, match, settings);
      for (const m of out.messages) {
        const clean = m.text.replace(/\[[^\]]+\]/g, "");
        expect(checkClaim(clean, { index: idx, allowedNames: allowed }).status, `msg ${m.kind}`).not.toBe("UNSUPPORTED");
        expect(unsupportedTerms(clean, profile, allowed), `msg terms ${m.kind}`).toEqual([]);
        if (m.limit) expect(m.length).toBeLessThanOrEqual(m.limit);
      }

      // deck slides
      const deck = buildDeck(profile, { focus: { jd, match } });
      for (const s of deck.slides) expect(unsupportedTerms([s.title, ...s.lines.filter((l) => !l.startsWith("tag: "))].join("\n"), profile, allowed), `deck ${s.kind}`).toEqual([]);

      // interview evidence is verbatim
      const plan = planInterview(profile, jd, match, settings);
      const pt = JSON.stringify(profile);
      for (const q of [...plan.questions, ...plan.resumeDrills, ...plan.gapQuestions]) for (const e of q.evidence) expect(pt).toContain(JSON.stringify(e.text).slice(1, -1));
      expect(plan.questions).toHaveLength(20);
    });
  }
});
