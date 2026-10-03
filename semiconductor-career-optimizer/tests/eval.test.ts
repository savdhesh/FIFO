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
    expect(r.truth.blockedRecall.holdout.rate).toBeGreaterThanOrEqual(6 / 7);
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
