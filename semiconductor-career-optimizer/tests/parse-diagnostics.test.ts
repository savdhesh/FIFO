import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { parseResumeHeuristic } from "@/lib/parsing/resume-parser";
import { diagnoseParse } from "@/lib/parsing/diagnostics";
import { DEMO_RESUME_TEXT } from "@/lib/demo";

const dir = path.join(__dirname, "fixtures/resumes");
const load = (f: string) => fs.readFileSync(path.join(dir, f), "utf8");
const d = (t: string) => diagnoseParse(t, parseResumeHeuristic(t));

describe("parse diagnostics", () => {
  it("well-formed resumes are high confidence with high coverage", () => {
    for (const t of [DEMO_RESUME_TEXT, ...["a-rightdates.txt", "b-employer-first.txt", "d-promotions-inline-skills.txt", "f-european-datecol.txt", "j-oneline-header.txt", "k-pipe-header.txt"].map(load)]) {
      const r = d(t);
      expect(r.coverage).toBeGreaterThanOrEqual(0.8);
      expect(["High", "Medium"]).toContain(r.confidence);
    }
    expect(d(DEMO_RESUME_TEXT).confidence).toBe("High");
  });
  it("reports lines it could not place so they can be assigned manually", () => {
    const t = DEMO_RESUME_TEXT + "\nVOLUNTEERING\nMentored students at a robotics club every weekend\nOrganised the annual chip design contest for local colleges\nGave talks on verification at university meetups\nCoached a school team for a national olympiad\nHelped run a hardware hackathon for beginners\nWrote tutorials on SystemVerilog basics for students\n";
    const r = d(t);
    expect(r.unplaced.join(" ")).toMatch(/robotics club/);
    expect(r.flags.some((f) => /could not be placed/.test(f.message))).toBe(true);
  });
  it("flags garbage and empty input as low confidence without throwing", () => {
    expect(d("lorem ipsum dolor sit amet\nconsectetur adipiscing elit sed do eiusmod\ntempor incididunt ut labore\net dolore magna aliqua ut enim\nad minim veniam quis nostrud\nexercitation ullamco laboris nisi\nut aliquip ex ea commodo consequat\nduis aute irure dolor in reprehenderit").confidence).toBe("Low");
    expect(d("").confidence).toBe("Low");
  });
  it("flags missing dates/titles and merged bullets", () => {
    const t = "Pat Q\npat@example.com\n\nEXPERIENCE\nCo | Austin, USA\nJan 2015 – Present\n• " + "Wrote UVM tests for AXI blocks and ".repeat(15) + "\n";
    const r = d(t);
    expect(r.flags.map((f) => f.message).join(" ")).toMatch(/no title|merged/);
  });
  it("does not count deliberately dropped sections as unplaced", () => {
    expect(d(load("i-indian-style.txt")).unplaced.join(" ")).not.toMatch(/Date of Birth|declare|Languages Known/);
  });
});
