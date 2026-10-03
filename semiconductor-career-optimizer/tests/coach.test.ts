import { describe, it, expect } from "vitest";
import { coachAnswer, weakTopics } from "@/lib/coach/coach";
import { planInterview, type PlannedQ } from "@/lib/interview/interview";
import { parseResumeHeuristic } from "@/lib/parsing/resume-parser";
import { parseJobDescriptionHeuristic } from "@/lib/parsing/jd-parser";
import { analyzeMatch } from "@/lib/matching/matcher";
import { parseResume } from "../artifact/logic";
import { MockProvider } from "@/lib/ai/mock";
import { LLMProvider } from "@/lib/ai/llm";
import { DEMO_JD_TEXT, DEMO_RESUME_TEXT } from "@/lib/demo";
import { SettingsSchema } from "@/lib/types";

const settings = SettingsSchema.parse({});
const profile = parseResumeHeuristic(DEMO_RESUME_TEXT), jd = parseJobDescriptionHeuristic(DEMO_JD_TEXT);
const match = analyzeMatch(profile, jd, settings);
const plan = planInterview(profile, jd, match, settings);
const q = (topic: string) => plan.questions.find((x) => x.topic === topic)!;

const GOOD = "At Northwind Silicon I owned the UVM verification architecture for a multi-block automotive SoC subsystem. The goal was to let blocks reuse the same agents, scoreboards and reference models at subsystem level. I defined the environment layout, the register model and the functional coverage plan, and I wrote the configuration objects so each block could run passive monitors. As a result the team closed coverage across the subsystem using one shared scoreboard design. Looking back I would add the coverage model earlier, because we reworked two crosses late. The trade-off was more upfront effort for easier reuse.";

describe("answer coach", () => {
  const uvm = plan.questions.find((x) => x.topic === "UVM" && x.level >= 3)!;
  it("rewards a structured, specific, honest answer that uses real experience", () => {
    const r = coachAnswer(uvm, GOOD, profile, [jd.company, jd.roleTitle]);
    expect(r.score).toBeGreaterThanOrEqual(65);
    expect(r.flags.filter((f) => f.severity === "claim")).toEqual([]);
    expect(r.usedEvidence).toBe(true);
    expect(r.dims.find((d) => d.key === "structure")!.score).toBeGreaterThanOrEqual(0.6);
  });
  it("scores a vague answer low and says what is missing", () => {
    const r = coachAnswer(uvm, "I think we did some UVM stuff and it was kind of fine, basically.", profile);
    expect(r.score).toBeLessThan(45);
    expect(r.improvements.join(" ")).toMatch(/short|specific|outcome/i);
    expect(r.missed.length).toBeGreaterThan(0);
  });
  it("caps the grade and flags claims the profile does not support", () => {
    const r = coachAnswer(uvm, GOOD + " I also used JasperGold to prove the arbiter and improved regression time by 60%.", profile);
    expect(r.flags.some((f) => f.severity === "claim")).toBe(true);
    expect(r.score).toBeLessThanOrEqual(60);
    expect(r.improvements.join(" ")).toMatch(/does not show|profile/);
  });
  it("on a gap question, dodging is penalised and honesty is rewarded", () => {
    const gap = plan.gapQuestions.find((g) => g.topic === "JasperGold")!;
    const dodge = coachAnswer(gap, "JasperGold is a formal tool and it is great, I use it for property checking and proofs on blocks in many projects.", profile);
    expect(dodge.dims.find((d) => d.key === "honesty")!.score).toBeLessThanOrEqual(0.4);
    const honest = coachAnswer(gap, "I have not used JasperGold directly. My formal work was property checking with Questa Formal on assertion-based checks, so the concepts of assumptions, proofs and counterexample debug carry over. I would start with a small arbiter design, learn its setup flow, and aim to be productive within the first few weeks.", profile);
    expect(honest.dims.find((d) => d.key === "honesty")!.score).toBe(1);
    expect(honest.strengths.join(" ")).toMatch(/acknowledged/);
    expect(honest.score).toBeGreaterThan(dodge.score);
  });
  it("handles empty input", () => { const r = coachAnswer(uvm, "", profile); expect(r.score).toBeLessThanOrEqual(35); expect(r.words).toBe(0); });
  it("ranks weak topics from practice history", () => {
    const qs = [q("UVM"), q("CSR")];
    const w = weakTopics({ [qs[0].id]: [{ at: "1", score: 40, words: 50 }, { at: "2", score: 70, words: 150 }], [qs[1].id]: [{ at: "1", score: 55, words: 80 }] }, qs);
    expect(w[0]).toMatchObject({ topic: "CSR", avg: 55 });
    expect(w[1]).toMatchObject({ topic: "UVM", avg: 70 });
  });
});

describe("coach providers", () => {
  const evil = new LLMProvider("fake", async () => JSON.stringify({ summary: "Good, but mention how you used JasperGold daily.", strengths: ["Clear ownership of the architecture."], improvements: ["Add that you cut regression time by 60% with JasperGold.", "Explain the reuse trade-off in one sentence."] }));
  it("LLM feedback that suggests unsupported claims is filtered; honest feedback is kept", async () => {
    const uvm = plan.questions.find((x) => x.topic === "UVM" && x.level >= 3)!;
    const r = await evil.coachAnswer(profile, jd, uvm, GOOD);
    expect(r.llm!.summary).toBe("");
    expect(r.llm!.improvements).toEqual(["Explain the reuse trade-off in one sentence."]);
    expect(r.llm!.strengths).toHaveLength(1);
  });
  it("mock provider coaches deterministically", async () => { const r = await new MockProvider().coachAnswer(profile, jd, plan.questions[0], GOOD); expect(r.dims).toHaveLength(5); expect(r.llm).toBeUndefined(); });
});

describe("consensus resume parsing", () => {
  it("offline: heuristic result with diagnostics", async () => {
    const r = await parseResume(new MockProvider(), DEMO_RESUME_TEXT);
    expect(r.diag.confidence).toBe("High"); expect(r.source).toMatch(/built-in/);
  });
  it("with Claude: invented content is grounded away; a weaker LLM parse loses to the heuristic", async () => {
    const forged = JSON.stringify({ identity: { name: "Alex Demo" }, roles: [{ id: "x", title: "Principal Verification Engineer", employer: "Imaginary Corp", startDate: "Jan 2020", endDate: "Present", responsibilities: ["Improved regression efficiency by 40% across all programs."], tools: ["JasperGold"] }] });
    const r = await parseResume(new LLMProvider("fake", async () => forged), DEMO_RESUME_TEXT);
    expect(JSON.stringify(r.profile)).not.toMatch(/Imaginary|JasperGold|40%/);
    expect(r.profile.roles.length).toBe(3); // fewer roles from the model: heuristic kept
    expect(r.source).toMatch(/built-in/);
  });
});
