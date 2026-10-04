import { describe, it, expect } from "vitest";
import fs from "fs";
import { parseResumeHeuristic } from "@/lib/parsing/resume-parser";
import { parseJobDescriptionHeuristic } from "@/lib/parsing/jd-parser";
import { analyzeMatch } from "@/lib/matching/matcher";
import { generateCoverLetter } from "@/lib/tailoring/cover-letter";
import { planLinkedIn } from "@/lib/outreach/linkedin";
import { planInterview } from "@/lib/interview/interview";
import { checkClaim } from "@/lib/truth/truth";
import { auditCredibility } from "@/lib/credibility/credibility";
import { buildIndex, latestRole } from "@/lib/profile-index";
import { DEMO_JD_TEXT, DEMO_RESUME_TEXT } from "@/lib/demo";
import { SettingsSchema } from "@/lib/types";

// Defects found by the third audit (generated-output review). Each test pins one fix.
const demo = parseResumeHeuristic(DEMO_RESUME_TEXT);
const settings = SettingsSchema.parse({});
const jd = (head: string, body = "Requirements\n- Strong SystemVerilog and UVM\n") => parseJobDescriptionHeuristic(`${head}\n\n${body}`);

describe("JD header line", () => {
  it.each([
    ["Wayne Interconnect · San Jose, CA (Hybrid)", "Wayne Interconnect", "San Jose, CA (Hybrid)"],
    ["Stark Formal Labs — Austin, TX", "Stark Formal Labs", "Austin, TX"],
    ["Initech India Pvt Ltd | Bengaluru", "Initech India Pvt Ltd", "Bengaluru"],
    ["Massive Dynamic Semiconductors (Remote, Singapore)", "Massive Dynamic Semiconductors", "Remote, Singapore"],
  ])("%s", (line, company, location) => {
    const j = jd(`Senior Design Verification Engineer\n${line}`);
    expect(j.company).toBe(company);
    expect(j.location).toBe(location);
  });
});

describe("alternatives", () => {
  const j = jd("Design Verification Engineer\nInitech", "Must have:\n1. Exposure to simulators like Xcelium or VCS\n2. Experience with APB, AHB or AXI\n");
  it("groups 'Xcelium or VCS' into one requirement", () => {
    expect(j.requirements.find((r) => r.text === "Xcelium or VCS")?.terms).toEqual(["Xcelium", "VCS"]);
    expect(j.requirements.find((r) => r.text === "VCS")).toBeUndefined();
  });
  it("is satisfied by any member and is not a gap", () => {
    const m = analyzeMatch(parseResumeHeuristic("Bo\nbo@example.com\n\nEXPERIENCE\nDV Engineer, X Corp, Jan 2020 - Present\n- Ran regressions on Xcelium for APB peripherals.\n"), j);
    const row = m.requirements.find((r) => r.explanation.includes("any of: Xcelium, VCS"))!;
    expect(row.matchType).toBe("exact");
    expect(m.gaps.map((g) => g.term)).not.toContain("VCS");
  });
});

describe("years", () => {
  it("keeps the upper bound of a range and caps STRONG APPLY when heavily overqualified", () => {
    const j = jd("Design Verification Engineer\nInitech", "We are hiring with 2-4 years of experience.\nMust have:\n- SystemVerilog and UVM\n- AXI\n");
    expect([j.yearsRequired, j.yearsMax]).toEqual([2, 4]);
    const m = analyzeMatch(demo, j);
    expect(m.recommendation.verdict).not.toBe("STRONG APPLY");
    expect(m.recommendation.reasons.join(" ")).toMatch(/Overqualified/);
  });
  it("counts domain-qualified years only from roles showing the domain", () => {
    const j = jd("Principal CPU Verification Engineer\nAcme Cores", "Requirements\n- 12+ years of CPU verification experience\n");
    const row = analyzeMatch(demo, j).requirements.find((r) => r.type === "experience")!;
    expect(row.requirement).toMatch(/CPU Verification/);
    expect(row.explanation).toMatch(/in roles showing CPU Verification/);
  });
});

describe("generated text", () => {
  const j = parseJobDescriptionHeuristic(DEMO_JD_TEXT);
  const m = analyzeMatch(demo, j);
  it("cover letter: no repeated 'I also', article before the role, call to action last, no hard-coded UK spelling", () => {
    const text = generateCoverLetter(demo, j, m, settings).paragraphs.join("\n");
    expect((text.match(/\bI also\b/g) ?? []).length).toBeLessThanOrEqual(1);
    expect(text).toMatch(/The Principal Design Verification Engineer role at Acme Silicon/);
    expect(text).not.toMatch(/centres/);
    expect(text.trim().split("\n").pop()).toMatch(/technical discussion/);
  });
  it("LinkedIn About uses the candidate's location, never the default country; lead and weak bullets do not overlap", () => {
    const plan = planLinkedIn(demo, j, m, settings);
    expect(plan.about.text).not.toMatch(/roles in USA/);
    expect(plan.about.text).toMatch(/based in Bangalore, India/);
    for (const e of plan.experience) for (const b of e.lead) expect(e.weak).not.toContain(b);
  });
  it("skills-only terms get a consistent message and an honest interview question", () => {
    const p = parseResumeHeuristic(`${DEMO_RESUME_TEXT}\nTools: VCS`);
    const jj = jd("Design Verification Engineer\nInitech", "Must have:\n- Hands-on VCS experience\n");
    const mm = analyzeMatch(p, jj);
    expect(mm.gaps.find((g) => g.term === "VCS")?.recommendation).toMatch(/Listed in your skills/);
    expect(planInterview(p, jj, mm).gapQuestions.find((q) => q.topic === "VCS")?.q).toMatch(/Your resume lists VCS/);
  });
});

describe("profile helpers and checks", () => {
  it("latest role is chosen by date, not by string order", () => {
    const p = parseResumeHeuristic("A\na@example.com\n\nEXPERIENCE\nEngineer, Old Co, Mar 2015 - Jan 2019\n- Wrote UVM tests.\nSenior Engineer, New Co, Feb 2019 - Present\n- Led UVM work.\n");
    expect(latestRole(p)?.employer).toBe("New Co");
  });
  it("money amounts are metrics that must be in the profile", () => {
    expect(checkClaim("Saved $2M in mask costs.", { index: buildIndex(demo) }).status).toBe("UNSUPPORTED");
  });
  it("a child term in a bullet demonstrates its parent skill", () => {
    const p = parseResumeHeuristic("A\na@example.com\n\nEXPERIENCE\nDV Engineer, X, Jan 2018 - Present\n- Verified the Ethernet MAC block with UVM.\n\nSKILLS\nEthernet, UVM\n");
    const msg = auditCredibility(p).map((i) => i.message).join(" ");
    expect(msg).not.toMatch(/demonstrates:[^.]*\bEthernet\b(?! MAC)/);
  });
  it("physical-design jobs are recognised as a mismatch", () => {
    const pd = parseJobDescriptionHeuristic(fs.readFileSync("eval/gold/jds/j7-pd.txt", "utf8"));
    expect(analyzeMatch(demo, pd).recommendation.verdict).toBe("DO NOT APPLY");
  });
});
