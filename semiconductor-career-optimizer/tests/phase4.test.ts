import { describe, it, expect } from "vitest";
import { parseResumeHeuristic } from "@/lib/parsing/resume-parser";
import { parseJobDescriptionHeuristic } from "@/lib/parsing/jd-parser";
import { analyzeMatch } from "@/lib/matching/matcher";
import { planInterview, targetLevel } from "@/lib/interview/interview";
import { BANK } from "@/lib/interview/bank";
import { computeAnalytics, type AppLite } from "@/lib/analytics/analytics";
import { ontology } from "@/lib/ontology/ontology";
import { DEMO_JD_TEXT, DEMO_RESUME_TEXT } from "@/lib/demo";
import { SettingsSchema } from "@/lib/types";
import { MockProvider } from "@/lib/ai/mock";
import { LLMProvider } from "@/lib/ai/llm";

const settings = SettingsSchema.parse({});
const mk = (resume: string, jdText: string) => { const profile = parseResumeHeuristic(resume), jd = parseJobDescriptionHeuristic(jdText); return { profile, jd, match: analyzeMatch(profile, jd, settings) }; };

describe("question bank", () => {
  it("every topic is a known ontology term; levels valid; each question has key points", () => {
    for (const b of BANK) { expect(ontology.get(b.topic), b.topic).toBeTruthy(); expect([1, 2, 3, 4]).toContain(b.level); expect(b.points.length).toBeGreaterThanOrEqual(2); }
    expect(BANK.length).toBeGreaterThanOrEqual(100);
    expect(new Set(BANK.map((b) => b.q)).size).toBe(BANK.length);
    for (const l of [1, 2, 3, 4]) expect(BANK.some((b) => b.level === l)).toBe(true);
  });
});

describe("interview prediction", () => {
  const { profile, jd, match } = mk(DEMO_RESUME_TEXT, DEMO_JD_TEXT);
  const plan = planInterview(profile, jd, match, settings);
  it("returns 20 labelled questions weighted to the target level", () => {
    expect(plan.questions).toHaveLength(20);
    expect(plan.targetLevelName).toBe("Principal");
    expect(plan.questions.every((q) => ["Basic", "Intermediate", "Staff", "Principal"].includes(q.levelName))).toBe(true);
    const senior = plan.questions.filter((q) => q.level >= 3).length;
    expect(senior).toBeGreaterThanOrEqual(10);
  });
  it("ranks JD-driven topics high, with reasons", () => {
    const t = (x: string) => plan.topics.find((r) => r.topic === x)!;
    expect(t("UVM").probability).toBe("High");
    expect(t("CSR").probability).toBe("High");
    expect(t("UVM").reasons.join(" ")).toMatch(/JD/);
    expect(plan.topics.every((x) => x.score > 0)).toBe(true);
  });
  it("evidence is verbatim profile text; gaps carry honesty notes and never claim experience", () => {
    const profText = JSON.stringify(profile);
    for (const q of [...plan.questions, ...plan.resumeDrills, ...plan.gapQuestions]) for (const e of q.evidence) expect(profText).toContain(JSON.stringify(e.text).slice(1, -1));
    const jg = plan.gapQuestions.find((g) => g.topic === "JasperGold")!;
    expect(jg.stance).toBe("gap");
    expect(jg.honestyNote).toMatch(/Do not claim JasperGold/);
    expect(jg.evidence.length).toBeGreaterThanOrEqual(0);
  });
  it("builds resume drills from the candidate's own bullets", () => {
    expect(plan.resumeDrills.length).toBeGreaterThanOrEqual(5);
    const text = JSON.stringify(profile);
    for (const d of plan.resumeDrills) expect(text).toContain(d.evidence[0].text.slice(0, 30));
  });
  it("target level follows JD seniority; a junior JD yields more basic questions", () => {
    const jr = mk(DEMO_RESUME_TEXT, "Verification Engineer\nAcme\n\nRequirements\n- SystemVerilog and UVM.\n- Functional coverage and constrained random verification.\n- AXI protocol knowledge.\n");
    const p = planInterview(jr.profile, jr.jd, jr.match, settings);
    expect(targetLevel(jr.jd, settings)).toBe(1);
    expect(p.questions.filter((q) => q.level <= 2).length).toBeGreaterThan(plan.questions.filter((q) => q.level <= 2).length);
  });
  it("suggests live exercises only for relevant topics", () => {
    expect(plan.liveExercises.join(" ")).toMatch(/SVA|UVM/);
    const noFormal = mk(DEMO_RESUME_TEXT, "Engineer\nAcme\n\nRequirements\n- Strong UVM and SystemVerilog.\n");
    expect(planInterview(noFormal.profile, noFormal.jd, noFormal.match, settings).liveExercises.join(" ")).not.toMatch(/arbiter/);
  });
});

describe("analytics", () => {
  const { profile, jd, match } = mk(DEMO_RESUME_TEXT, DEMO_JD_TEXT);
  const weak = mk("Sam\n\nEXPERIENCE\nEngineer | Co | Austin, USA\nJan 2015 – Present\n- Wrote UVM tests for AXI blocks.\n", DEMO_JD_TEXT);
  const day = 864e5, now = Date.now();
  const app = (id: string, status: string, m: typeof match, ago: number, history: AppLite["history"] = []): AppLite => ({ id, status, createdAt: new Date(now - ago * day).toISOString(), roleTitle: "R", company: "C", history, match: m, jd, settings: { country: "USA" } });
  const apps = [
    app("1", "TECHNICAL_ROUND", match, 3, [{ status: "APPLIED", at: new Date(now - 3 * day).toISOString() }, { status: "SCREENING", at: new Date(now - 1 * day).toISOString() }, { status: "TECHNICAL_ROUND", at: new Date(now).toISOString() }]),
    app("2", "REJECTED", weak.match, 10, [{ status: "APPLIED", at: new Date(now - 10 * day).toISOString() }]),
    app("3", "ANALYZED", match, 1),
  ];
  const a = computeAnalytics(apps, now);
  it("computes funnel and rates from status history", () => {
    expect(a.total).toBe(3);
    expect(a.funnel.find((f) => f.stage === "Applied")!.count).toBe(2);
    expect(a.funnel.find((f) => f.stage === "Screening")!.count).toBe(1);
    expect(a.interviewRate).toBe(50);
    expect(a.daysToFirstResponse.median).toBe(2);
  });
  it("refuses to overclaim on small samples", () => {
    expect(a.scoreVsOutcome.caution).toMatch(/Too few/);
    expect(a.notes.join(" ")).toMatch(/Fewer than 5/);
  });
  it("ranks demand and gaps by weighted frequency, separating presentation from real gaps", () => {
    expect(a.demand[0].jobs).toBeGreaterThan(0);
    const jg = a.gapPriorities.find((g) => g.term === "JasperGold")!;
    expect(jg.kind).toBe("real-skill-gap");
    expect(jg.advice).toMatch(/Do not claim/);
    expect(a.weekly).toHaveLength(8);
    expect(a.weekly.reduce((s, w) => s + w.analyzed, 0)).toBe(3);
  });
  it("handles zero applications", () => { const z = computeAnalytics([]); expect(z.total).toBe(0); expect(z.avgScore).toBeNull(); expect(z.responseRate).toBeNull(); });
});

describe("providers", () => {
  const { profile, jd, match } = mk(DEMO_RESUME_TEXT, DEMO_JD_TEXT);
  it("mock provider returns the plan", async () => { expect((await new MockProvider().generateInterviewPrep(profile, jd, match, settings)).questions).toHaveLength(20); });
  it("LLM outlines that invent experience are dropped, honest ones kept", async () => {
    const plan = await new MockProvider().generateInterviewPrep(profile, jd, match, settings);
    const ids = plan.questions.slice(0, 2).map((q) => q.id);
    const llm = new LLMProvider("fake", async () => JSON.stringify({ outlines: [
      { id: ids[0], outline: "I used JasperGold daily and improved regression efficiency by 40%, so structure your answer around that." },
      { id: ids[1], outline: "Start from the verification plan you wrote, explain how coverage closure was tracked, and say what you would change." },
    ] }));
    const out = await llm.generateInterviewPrep(profile, jd, match, settings);
    expect(out.questions.find((q) => q.id === ids[0])!.outline).toBeUndefined();
    expect(out.questions.find((q) => q.id === ids[1])!.outline).toBeTruthy();
  });
});
