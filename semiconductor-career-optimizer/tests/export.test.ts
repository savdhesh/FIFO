import { describe, it, expect } from "vitest";
import { DEMO_RESUME_TEXT, DEMO_JD_TEXT } from "@/lib/demo";
import { parseResumeHeuristic } from "@/lib/parsing/resume-parser";
import { parseJobDescriptionHeuristic } from "@/lib/parsing/jd-parser";
import { analyzeMatch } from "@/lib/matching/matcher";
import { tailorResume, applyDecisions } from "@/lib/tailoring/resume";
import { generateCoverLetter } from "@/lib/tailoring/cover-letter";
import { resumePdf, coverLetterPdf, reportPdf } from "@/lib/export/pdf";
import { resumeDocx, coverLetterDocx } from "@/lib/export/docx";
import { extractText } from "@/lib/parsing/extract";
import { SettingsSchema } from "@/lib/types";

const profile = parseResumeHeuristic(DEMO_RESUME_TEXT);
const jd = parseJobDescriptionHeuristic(DEMO_JD_TEXT);
const settings = SettingsSchema.parse({ country: "USA" });
const match = analyzeMatch(profile, jd, settings);
const { tailored, changes } = tailorResume(profile, jd, match, settings);
const final = applyDecisions(tailored, changes.map((c) => ({ ...c, decision: c.status === "INFERRED" ? ("pending" as const) : ("accepted" as const) })), profile);

describe("exports are ATS-parsable round trips", () => {
  it("resume PDF text extracts in reading order with name first", async () => {
    const buf = await resumePdf(final, "3");
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    const text = await extractText("pdf", buf);
    expect(text.trim().startsWith("Alex Demo")).toBe(true);
    expect(text).toMatch(/PROFESSIONAL EXPERIENCE/);
    expect(text.indexOf("PROFESSIONAL SUMMARY")).toBeLessThan(text.indexOf("PROFESSIONAL EXPERIENCE"));
    expect(text).not.toMatch(/jaspergold/i);
  });
  it("resume DOCX extracts and contains experience bullets", async () => {
    const text = await extractText("docx", await resumeDocx(final));
    expect(text).toContain("Northwind Silicon");
    expect(text).toMatch(/UVM verification architecture/);
  });
  it("cover letter and report render", async () => {
    const letter = generateCoverLetter(profile, jd, match, settings);
    expect((await coverLetterPdf(letter, "Alex Demo", profile.identity)).length).toBeGreaterThan(1000);
    expect((await coverLetterDocx(letter, profile.identity)).length).toBeGreaterThan(1000);
    expect((await reportPdf({ candidate: "Alex Demo", company: "Acme", role: "X", jd, match })).length).toBeGreaterThan(1000);
  });
});
