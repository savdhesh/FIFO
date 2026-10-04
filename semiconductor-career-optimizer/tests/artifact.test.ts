import { describe, it, expect } from "vitest";
import { analyze, generate, providerFor, acceptAllSafe, decide, finalDocs, saveLetter } from "../artifact/logic";
import { resumePdf, coverLetterPdf, reportPdf, resumeDocxBlob, coverDocxBlob } from "../artifact/exporters";
import { parseResumeHeuristic } from "@/lib/parsing/resume-parser";
import { extractText } from "@/lib/parsing/extract";
import { DEMO_JD_TEXT, DEMO_RESUME_TEXT } from "@/lib/demo";
import { SettingsSchema } from "@/lib/types";

const profile = parseResumeHeuristic(DEMO_RESUME_TEXT);
const prov = providerFor(null);

describe("in-Claude artifact (keyless) flow", () => {
  it("analyze → generate → accept safe → export gates hold", async () => {
    let a = await analyze(profile, prov, { jdText: DEMO_JD_TEXT, jobUrl: "", company: "", title: "", settings: SettingsSchema.parse({}) });
    a = await generate(profile, prov, a);
    a = acceptAllSafe(a);
    expect(a.changes.filter((c) => c.status === "INFERRED").every((c) => c.decision === "pending")).toBe(true);
    // an edit with an invented tool + metric is flagged and kept out of the export
    const summary = a.changes.find((c) => c.section === "summary")!;
    const r = decide(a, profile, summary.id, "edited", "JasperGold expert who improved regression efficiency by 40%.");
    expect(r.warning).toMatch(/HALLUCINATION/);
    const doc = finalDocs(r.app, profile);
    expect(JSON.stringify(doc.resume)).not.toMatch(/jaspergold|40%/i);
    expect(() => decide(a, profile, summary.id, "accepted")).not.toThrow(); // original supported proposal still acceptable
    expect(() => saveLetter(a, profile, ["I have deep JasperGold experience."])).toThrow(/HALLUCINATION/);
  });
  it("PDF/DOCX exporters produce parsable files", async () => {
    let a = await analyze(profile, prov, { jdText: DEMO_JD_TEXT, jobUrl: "", company: "", title: "", settings: SettingsSchema.parse({}) });
    a = acceptAllSafe(await generate(profile, prov, a));
    const doc = finalDocs(a, profile);
    const pdf = Buffer.from(resumePdf(doc.resume, "3").data);
    const text = await extractText("pdf", pdf);
    expect(text.trim().startsWith("Alex Demo")).toBe(true);
    expect(text).toMatch(/PROFESSIONAL EXPERIENCE/);
    expect(Buffer.from(coverLetterPdf(a.letter!, profile.identity)).length).toBeGreaterThan(1000);
    expect(Buffer.from(reportPdf({ candidate: "Alex Demo", company: a.company, role: a.roleTitle, jd: a.jd, match: a.match, audit: doc.audit })).length).toBeGreaterThan(1000);
    const docx = Buffer.from(await (await resumeDocxBlob(doc.resume)).arrayBuffer());
    expect(await extractText("docx", docx)).toContain("Northwind Silicon");
    expect((await coverDocxBlob(a.letter!, profile.identity)).size).toBeGreaterThan(1000);
  });
});
