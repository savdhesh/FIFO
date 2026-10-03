import { describe, it, expect } from "vitest";
import { parseResumeHeuristic } from "@/lib/parsing/resume-parser";
import { parseJobDescriptionHeuristic } from "@/lib/parsing/jd-parser";
import { analyzeMatch } from "@/lib/matching/matcher";
import { planLinkedIn, HEADLINE_LIMIT } from "@/lib/outreach/linkedin";
import { planOutreach, CONNECT_LIMIT } from "@/lib/outreach/recruiter";
import { checkClaim } from "@/lib/truth/truth";
import { buildIndex } from "@/lib/profile-index";
import { DEMO_JD_TEXT, DEMO_RESUME_TEXT } from "@/lib/demo";
import { SettingsSchema } from "@/lib/types";
import { MockProvider } from "@/lib/ai/mock";
import { LLMProvider } from "@/lib/ai/llm";

const settings = SettingsSchema.parse({ country: "USA" });
const run = (resume: string, jdText = DEMO_JD_TEXT) => {
  const profile = parseResumeHeuristic(resume), jd = parseJobDescriptionHeuristic(jdText);
  return { profile, jd, match: analyzeMatch(profile, jd, settings) };
};

describe("LinkedIn optimizer", () => {
  const { profile, jd, match } = run(DEMO_RESUME_TEXT);
  const plan = planLinkedIn(profile, jd, match, settings);
  it("marks keyword coverage as present / related / missing without upgrading related", () => {
    const st = (k: string) => plan.keywordCoverage.find((x) => x.keyword === k)?.state;
    expect(st("SystemVerilog")).toBe("present");
    expect(st("JasperGold")).toBe("related");
    expect(st("CXL")).toBe("related");
  });
  it("does not let you claim titles you have not held", () => {
    expect(plan.titleKeywords.find((t) => t.keyword === "Verification Manager")!.held).toBe(false);
    expect(plan.titleKeywords.find((t) => t.keyword === "Principal Engineer")!.held).toBe(true);
    expect(plan.headlines.every((h) => !/manager|director/i.test(h.text))).toBe(true);
  });
  it("headlines respect the length limit and pass the truth check", () => {
    expect(plan.headlines.length).toBeGreaterThanOrEqual(3);
    for (const h of plan.headlines) { expect(h.length).toBeLessThanOrEqual(HEADLINE_LIMIT); expect(["VERIFIED", "SUPPORTED"]).toContain(h.status); }
  });
  it("skips variants with no supporting evidence and says why", () => {
    expect(plan.skippedHeadlines.map((s) => s.kind)).toEqual(expect.arrayContaining(["Consulting-focused", "AI + verification"]));
  });
  it("About is trimmed profile content, not a resume dump, and has no unsupported claims", () => {
    expect(plan.about.removed).toHaveLength(0);
    expect(plan.about.text).toContain("What I work on:");
    expect(plan.about.text.split("\n").filter((l) => l.startsWith("•"))).toHaveLength(3);
    expect(plan.about.text).not.toMatch(/jaspergold|40%/i);
  });
  it("emits a consulting variant only when the profile has contract work", () => {
    const r = run(`Sam\n\nEXPERIENCE\nDV Consultant (Contract) | Freelance | Singapore | Feb 2021 – Present\n- Built a UVM testbench for a PCIe endpoint using Xcelium.\n`);
    const p = planLinkedIn(r.profile, r.jd, r.match, settings);
    expect(p.headlines.some((h) => h.kind === "Consulting-focused")).toBe(true);
  });
  it("analyses a pasted current headline/About", () => {
    const p = planLinkedIn(profile, jd, match, settings, { headline: "Verification engineer | SystemVerilog", about: "I do UVM." });
    expect(p.current?.headline?.present).toContain("SystemVerilog");
    expect(p.current?.headline?.missing).toContain("RISC-V");
  });
});

describe("recruiter messages", () => {
  const { profile, jd, match } = run(DEMO_RESUME_TEXT);
  const pack = planOutreach(profile, jd, match, settings);
  it("produces the four message types within limits", () => {
    expect(pack.messages.map((m) => m.kind)).toEqual(["Connection request", "Message after applying", "Reply to a recruiter who contacted you", "Hiring manager outreach"]);
    expect(pack.messages[0].length).toBeLessThanOrEqual(CONNECT_LIMIT);
  });
  it("never fabricates names, mutual contacts or company knowledge; keeps placeholders", () => {
    for (const m of pack.messages) { expect(m.text).toMatch(/\[Name\]/); expect(m.text).not.toMatch(/mutual|noticed your|your recent|congrat|admire/i); expect(m.removed).toHaveLength(0); }
  });
  it("only states claims the profile supports (including years)", () => {
    const idx = buildIndex(profile);
    for (const m of pack.messages) expect(checkClaim(m.text.replace(/\[[^\]]+\]/g, ""), { index: idx, allowedNames: [jd.company, jd.roleTitle] }).status).not.toBe("UNSUPPORTED");
    expect(pack.messages[0].text).toMatch(/13\+ years/);
    expect(pack.messages.map((m) => m.text).join(" ")).not.toMatch(/jaspergold/i);
  });
  it("uses a supplied recruiter name", () => {
    expect(planOutreach(profile, jd, match, settings, { recruiterName: "Taylor" }).messages[0].text).toMatch(/^Hi Taylor,/);
  });
});

describe("provider guards", () => {
  const { profile, jd, match } = run(DEMO_RESUME_TEXT);
  it("mock provider implements both", async () => {
    const p = new MockProvider();
    expect((await p.optimizeLinkedIn(profile, jd, match, settings)).headlines.length).toBeGreaterThan(0);
    expect((await p.generateRecruiterMessage(profile, jd, match, settings)).messages).toHaveLength(4);
  });
  it("LLM output with an invented tool or fabricated familiarity falls back to the deterministic text", async () => {
    const evil = new LLMProvider("fake", async (_s, u) => (u.includes("kinds")
      ? JSON.stringify({ messages: [{ kind: "Connection request", text: "Hi Pat, we have a mutual connection and I know JasperGold well." }] })
      : JSON.stringify({ about: "I am a JasperGold expert. ".repeat(30) })));
    const li = await evil.optimizeLinkedIn(profile, jd, match, settings);
    expect(li.about.text).not.toMatch(/jaspergold/i);
    const msgs = await evil.generateRecruiterMessage(profile, jd, match, settings);
    expect(msgs.messages[0].text).not.toMatch(/mutual|jaspergold/i);
  });
});
