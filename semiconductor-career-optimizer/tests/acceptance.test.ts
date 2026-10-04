import { describe, it, expect } from "vitest";
import { parseResumeHeuristic } from "@/lib/parsing/resume-parser";
import { parseJobDescriptionHeuristic } from "@/lib/parsing/jd-parser";
import { analyzeMatch } from "@/lib/matching/matcher";
import { tailorResume, applyDecisions } from "@/lib/tailoring/resume";
import { generateCoverLetter, letterToText, BANNED_PHRASES } from "@/lib/tailoring/cover-letter";
import { auditResume } from "@/lib/truth/truth";
import { SettingsSchema } from "@/lib/types";

const RESUME = `Pat Example
Austin, USA | pat@example.com

EXPERIENCE
Staff Verification Engineer | Example Corp | Austin, USA
Jan 2012 – Present
- Owned the UVM verification architecture for an SoC subsystem, including agents, scoreboards and functional coverage.
- Built a RISC-V CPU verification environment in SystemVerilog and UVM, simulated with Xcelium.
- Wrote SystemVerilog assertions for protocol checking.

TECHNICAL SKILLS
Languages: SystemVerilog
Verification: UVM, SVA
Processor: RISC-V
Tools: Xcelium
`;
const JD = `Senior Design Verification Engineer
Globex Semi

Requirements
- Strong SystemVerilog and UVM experience.
- RISC-V verification experience.
- Formal verification experience.

Preferred
- JasperGold experience is a plus.
`;

describe("acceptance scenario (spec §35)", () => {
  const profile = parseResumeHeuristic(RESUME);
  const jd = parseJobDescriptionHeuristic(JD);
  const settings = SettingsSchema.parse({ country: "USA", seniority: "Senior" });
  const match = analyzeMatch(profile, jd, settings);
  const row = (t: string) => match.requirements.find((r) => r.requirement === t)!;

  it("classifies SystemVerilog, UVM, RISC-V as exact", () => {
    expect(row("SystemVerilog").matchType).toBe("exact");
    expect(row("UVM").matchType).toBe("exact");
    expect(row("RISC-V").matchType).toBe("exact");
  });
  it("does not treat formal verification as direct experience; JasperGold is missing/related", () => {
    expect(["missing", "related", "weak"]).toContain(row("Formal Verification").matchType);
    expect(row("Formal Verification").matchType).not.toBe("exact");
    expect(["missing", "related"]).toContain(row("JasperGold").matchType);
    expect(row("JasperGold").action).toMatch(/do not claim/i);
  });
  it("never puts JasperGold in the resume, change proposals or cover letter", () => {
    const { tailored, changes } = tailorResume(profile, jd, match, settings);
    const final = applyDecisions(tailored, changes.map((c) => ({ ...c, decision: "accepted" as const })), profile);
    const everything = JSON.stringify([tailored, changes, final]) + letterToText(generateCoverLetter(profile, jd, match, settings));
    expect(everything).not.toMatch(/jasper/i);
  });
  it("passes the truth audit on the full accept-all resume", () => {
    const { tailored, changes } = tailorResume(profile, jd, match, settings);
    const final = applyDecisions(tailored, changes.map((c) => ({ ...c, decision: "accepted" as const })), profile);
    expect(auditResume(final, profile, [jd.company, jd.roleTitle]).counts.UNSUPPORTED).toBe(0);
  });
});

describe("demo pipeline", () => {
  it("cover letter respects length and banned phrases", async () => {
    const { DEMO_RESUME_TEXT, DEMO_JD_TEXT } = await import("@/lib/demo");
    const profile = parseResumeHeuristic(DEMO_RESUME_TEXT);
    const jd = parseJobDescriptionHeuristic(DEMO_JD_TEXT);
    const settings = SettingsSchema.parse({ country: "USA" });
    const match = analyzeMatch(profile, jd, settings);
    const letter = generateCoverLetter(profile, jd, match, settings);
    const text = letterToText(letter).toLowerCase();
    expect(letter.wordCount).toBeGreaterThanOrEqual(250);
    expect(letter.wordCount).toBeLessThanOrEqual(400);
    for (const b of BANNED_PHRASES) expect(text).not.toContain(b);
    expect(text).not.toContain("jaspergold");
    expect(letter.removed).toHaveLength(0);
  });
});
