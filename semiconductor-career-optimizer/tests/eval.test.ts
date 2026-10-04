import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";

// Regression floors on the gold-set evaluation (eval/run.ts). Floors sit at the current measured values for safety
// metrics; raising a floor is fine, lowering one needs a reason in eval/CHANGELOG.md.
describe("gold-set evaluation floors", () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "sco-eval-"));
  execFileSync(process.execPath, [path.resolve("node_modules/tsx/dist/cli.mjs"), "eval/run.ts"], { env: { ...process.env, EVAL_OUT: out }, stdio: "pipe" });
  const r = JSON.parse(fs.readFileSync(path.join(out, "report.json"), "utf8"));

  it("truth: no dev leaks, every dev UNSUPPORTED claim blocked", () => {
    expect(r.truth.blockedRecall.dev.rate).toBe(1);
    expect(r.truth.overclaim.dev.rate).toBe(0);
    expect(r.truth.blockedRecall.holdout.rate).toBe(1); // contaminated after the degree fix; kept as a regression floor
  });
  it("parser: every gold role found", () => {
    expect(r.parse.roleFound.dev.rate).toBe(1);
    expect(r.parse.roleFound.holdout.rate).toBe(1);
  });
  it("matching: overclaims stay rare, verdicts stay acceptable", () => {
    expect(r.match.overclaimIso.dev.rate).toBeLessThanOrEqual(0.05);
    expect(r.match.overclaimIso.holdout.rate).toBeLessThanOrEqual(0.07);
    expect(r.match.verdict.dev.rate).toBe(1);
    expect(r.match.verdict.holdout.rate).toBe(1);
  });
  it("jd: dev requirement recall stays complete", () => {
    expect(r.jd.recall.dev.rate).toBe(1);
    expect(r.jd.recall.holdout.rate).toBeGreaterThanOrEqual(46 / 59);
  });
}, 60_000);

describe("degree claims", async () => {
  const { parseResumeHeuristic } = await import("../src/lib/parsing/resume-parser");
  const { buildIndex } = await import("../src/lib/profile-index");
  const { checkClaim } = await import("../src/lib/truth/truth");
  const { DEMO_RESUME_TEXT } = await import("../src/lib/demo");
  const index = buildIndex(parseResumeHeuristic(DEMO_RESUME_TEXT)); // M.Tech + B.E.
  it.each([
    ["Holds a PhD in formal methods.", "UNSUPPORTED"],
    ["Ph.D. candidate in EE.", "UNSUPPORTED"],
    ["Holds an MBA.", "UNSUPPORTED"],
    ["Holds a master's degree in VLSI.", "SUPPORTED"],
    ["Bachelor of Engineering in Electronics.", "SUPPORTED"],
    ["Ran MS Office reports.", "SUPPORTED"],
  ])("%s -> %s", (text, want) => expect(checkClaim(text, { index }).status).toBe(want));
});
