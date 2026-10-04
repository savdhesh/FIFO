import { describe, it, expect } from "vitest";
import { ontology, termMap } from "@/lib/ontology/ontology";
import { analyzeMatch, DEFAULT_WEIGHTS } from "@/lib/matching/matcher";
import { parseResumeHeuristic } from "@/lib/parsing/resume-parser";
import { parseJobDescriptionHeuristic } from "@/lib/parsing/jd-parser";
import { DEMO_RESUME_TEXT, DEMO_JD_TEXT } from "@/lib/demo";
import { detectSeniority } from "@/lib/matching/seniority";
import { classifyBullet } from "@/lib/matching/bullets";
import { totalYears } from "@/lib/parsing/dates";

const canon = (t: string) => ontology.findTerms(t).map((h) => h.canonical);

describe("ontology", () => {
  it("resolves aliases to canonical terms", () => {
    expect(canon("SV and UVM")).toEqual(["SystemVerilog", "UVM"]);
    expect(canon("DV")).toEqual(["Design Verification"]);
    expect(canon("SVA")).toEqual(["SystemVerilog Assertions"]);
    expect(canon("GLS")).toEqual(["Gate-Level Simulation"]);
    expect(canon("gate level simulation")).toEqual(["Gate-Level Simulation"]);
    expect(canon("FCOV and CRV")).toEqual(["Functional Coverage", "Constrained Random Verification"]);
    expect(canon("FPV")).toEqual(["Formal Verification"]);
    expect(canon("property checking")).toEqual(["Formal Verification"]);
  });
  it("does not confuse C with C++ or match short acronyms in words", () => {
    expect(canon("C++ only")).toEqual(["C++"]);
    expect(canon("C and Python")).toEqual(["C", "Python"]);
    expect(canon("the device is activated")).toEqual([]);
  });
  it("longest alias wins: Questa Formal is not Questa the simulator", () => {
    expect(canon("Questa Formal")).toEqual(["Questa Formal"]);
  });
  it("classifies relations: exact, equivalent, related, weak, missing", () => {
    const p = termMap("Formal verification using Questa Formal, SystemVerilog, RISC-V, plus assertion flows");
    expect(ontology.relate("SystemVerilog", p).type).toBe("exact");
    expect(ontology.relate("JasperGold", p).type).toBe("related"); // same family, never exact
    expect(ontology.relate("CSR", p).type).toBe("weak"); // RISC-V makes CSR plausible, not proven
    expect(ontology.relate("PCIe", p).type).toBe("missing");
    const q = termMap("Used JasperGold for property proofs");
    expect(ontology.relate("Formal Verification", q).type).toBe("equivalent"); // tool implies domain
    expect(ontology.relate("VC Formal", q).type).toBe("related");
  });
});

describe("scoring", () => {
  const profile = parseResumeHeuristic(DEMO_RESUME_TEXT);
  const jd = parseJobDescriptionHeuristic(DEMO_JD_TEXT);
  const m = analyzeMatch(profile, jd, { seniority: "Principal" });

  it("default weights sum to 100%", () => {
    expect(Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
  });
  it("all scores are 0..100 integers and every score explains itself", () => {
    for (const s of m.scores) { expect(Number.isInteger(s.value)).toBe(true); expect(s.value).toBeGreaterThanOrEqual(0); expect(s.value).toBeLessThanOrEqual(100); expect(s.why.length).toBeGreaterThan(0); }
  });
  it("strong demo match yields STRONG APPLY; JasperGold stays a gap", () => {
    expect(m.recommendation.verdict).toBe("STRONG APPLY");
    expect(m.requirements.find((r) => r.requirement === "JasperGold")!.matchType).not.toBe("exact");
  });
  it("a profile with no verification skills scores low and is not recommended", () => {
    const empty = parseResumeHeuristic("Sam Nobody\n\nEXPERIENCE\nBaker | Bread Co | Paris, France\nJan 2015 – Present\n- Baked bread every morning for the local shop.\n- Managed the ovens.\n");
    const r = analyzeMatch(empty, jd, { seniority: "Principal" });
    expect(r.overall).toBeLessThan(35);
    expect(["DO NOT APPLY", "LOW PRIORITY"]).toContain(r.recommendation.verdict);
  });
  it("weights are configurable and change the outcome", () => {
    const heavyTools = { ...DEFAULT_WEIGHTS, tools: 0.9 };
    const a = analyzeMatch(profile, jd, { seniority: "Principal" }, heavyTools);
    expect(a.overall).not.toBe(m.overall);
  });
  it("skills listed but never demonstrated get reduced credit and a supporting-bullet action", () => {
    const p = parseResumeHeuristic("Pat\n\nEXPERIENCE\nEngineer | Co | Austin, USA\nJan 2015 – Present\n- Wrote Perl scripts.\n\nTECHNICAL SKILLS\nLanguages: SystemVerilog\n");
    const r = analyzeMatch(p, parseJobDescriptionHeuristic("Verification Engineer\nAcme\n\nRequirements\n- Strong SystemVerilog skills.\n"));
    const sv = r.requirements.find((x) => x.requirement === "SystemVerilog")!;
    expect(sv.matchType).toBe("exact");
    expect(sv.score).toBeLessThan(1);
    expect(sv.action).toMatch(/supporting bullet/i);
  });
  it("presentation gap vs real skill gap are distinguished", () => {
    const p = parseResumeHeuristic("Pat\n\nEXPERIENCE\nSenior Engineer | Co | Austin, USA\nJan 2015 – Present\n- Led UVM environment bring-up and coverage closure for an SoC subsystem.\n");
    const r = analyzeMatch(p, parseJobDescriptionHeuristic("Verification Engineer\nAcme\n\nRequirements\n- Verification planning.\n- JasperGold experience.\n- PCIe verification.\n"));
    expect(r.requirements.find((x) => x.requirement === "Verification Planning")!.gapKind).toBe("presentation-gap");
    expect(r.requirements.find((x) => x.requirement === "PCIe")!.gapKind).toBe("real-skill-gap");
  });
});

describe("seniority & bullets", () => {
  it("does not inflate a short career", () => {
    const p = parseResumeHeuristic("Kid\n\nEXPERIENCE\nJunior Engineer | Co | Austin, USA\nJan 2024 – Present\n- Led architecture methodology, subsystem signoff, mentoring and reusable infrastructure for cross-team verification coverage strategy.\n");
    expect(detectSeniority(p).level).toBeLessThanOrEqual(1);
  });
  it("demo candidate reads as principal", () => { expect(detectSeniority(parseResumeHeuristic(DEMO_RESUME_TEXT)).level).toBe(4); });
  it("classifies bullet quality", () => {
    expect(classifyBullet("Worked on UVM verification.").cls).toMatch(/Generic|Weak/);
    expect(classifyBullet("Owned UVM verification of a multi-block SoC subsystem, including environment architecture, scoreboarding, functional coverage and regression debug.").cls).toBe("Strong");
    expect(classifyBullet("Owned UVM verification of a multi-block SoC subsystem, including environment architecture, scoreboarding, functional coverage and regression debug.", ["Owned UVM verification of a multi-block SoC subsystem, including environment architecture, scoreboarding, functional coverage and regression debug."]).cls).toBe("Duplicate");
  });
  it("merges overlapping date ranges when computing years", () => {
    expect(totalYears([{ start: "Jan 2010", end: "Dec 2014" }, { start: "Jan 2013", end: "Dec 2016" }])).toBe(7);
  });
});
