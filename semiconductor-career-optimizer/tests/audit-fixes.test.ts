import { describe, it, expect } from "vitest";
import { parseResumeHeuristic } from "@/lib/parsing/resume-parser";
import { parseJobDescriptionHeuristic } from "@/lib/parsing/jd-parser";
import { analyzeMatch, DEFAULT_WEIGHTS } from "@/lib/matching/matcher";
import { tailorResume, applyDecisions } from "@/lib/tailoring/resume";
import { planLinkedIn } from "@/lib/outreach/linkedin";
import { ontology } from "@/lib/ontology/ontology";
import { auditResume } from "@/lib/truth/truth";
import { resumeDocx } from "@/lib/export/docx";
import { extractText } from "@/lib/parsing/extract";
import { THEMES } from "@/lib/export/themes";
import { resumePdf, fitResume, coverLetterPdf } from "../artifact/exporters";
import { analyze, generate, providerFor, acceptAllSafe, finalDocs } from "../artifact/logic";
import { applyMerge, acceptSafeItems, mergeResumes } from "@/lib/merge/merge";
import { DEMO_JD_TEXT, DEMO_RESUME_TEXT } from "@/lib/demo";
import { SettingsSchema } from "@/lib/types";

const OLD = `Alex Demo\n\nEXPERIENCE\nStaff Verification Engineer | Contoso Semiconductors | Hyderabad, India\nJun 2016 - Dec 2019\n- Developed reusable UVM verification infrastructure and VIP shared by several IP teams.\n\nPROJECTS\nAutomotive MCU Subsystem | Contoso Semiconductors | 2018\n- Verified the interrupt controller and watchdog of an ISO 26262 ASIL-B MCU subsystem.\n- Built fault injection tests for the safety mechanisms.\n\nPROJECTS 2\n`;
const profile = (() => { const cur = parseResumeHeuristic(DEMO_RESUME_TEXT); const old = parseResumeHeuristic(OLD.replace("PROJECTS 2\n", "")); return applyMerge(cur, acceptSafeItems(mergeResumes([{ id: "o", name: "o", profile: old }], cur).items)); })();
const jd = parseJobDescriptionHeuristic(DEMO_JD_TEXT);

describe("score weights from settings", () => {
  it("default weights are used unless overridden; overrides change the score", () => {
    const base = analyzeMatch(profile, jd, SettingsSchema.parse({}));
    const heavy = analyzeMatch(profile, jd, SettingsSchema.parse({ weights: { ...DEFAULT_WEIGHTS, tools: 0.9 } }));
    expect(base.overall).not.toBe(heavy.overall);
    expect(analyzeMatch(profile, jd, SettingsSchema.parse({ weights: DEFAULT_WEIGHTS })).overall).toBe(base.overall);
  });
});

describe("resume projects section", () => {
  const settings3 = SettingsSchema.parse({ length: "3" });
  const m = analyzeMatch(profile, jd, settings3);
  it("appears on 3+ page resumes, verbatim, and is absent on 1-2 pages", () => {
    const t3 = tailorResume(profile, jd, m, settings3).tailored;
    expect(t3.projects[0].name).toBe("Automotive MCU Subsystem");
    expect(t3.projects[0].bullets[0]).toMatch(/interrupt controller and watchdog/);
    expect(tailorResume(profile, jd, m, SettingsSchema.parse({ length: "2" })).tailored.projects).toEqual([]);
  });
  it("passes the truth audit and is exported in PDF and DOCX", async () => {
    const { tailored, changes } = tailorResume(profile, jd, m, settings3);
    const final = applyDecisions(tailored, changes.map((c) => ({ ...c, decision: "accepted" as const })), profile);
    expect(auditResume(final, profile, [jd.company, jd.roleTitle]).hallucinations).toEqual([]);
    const pdf = await extractText("pdf", Buffer.from(resumePdf(final, "3").data));
    expect(pdf).toMatch(/MAJOR TECHNICAL PROJECTS/);
    expect(await extractText("docx", await resumeDocx(final))).toMatch(/Automotive MCU Subsystem/);
  });
  it("old stored resumes without projects still apply cleanly", () => {
    const { tailored, changes } = tailorResume(profile, jd, m, settings3);
    const legacy = { ...tailored } as any; delete legacy.projects;
    expect(applyDecisions(legacy, changes, profile).projects).toEqual([]);
  });
});

describe("page fitting and themes", () => {
  it("trims lowest-ranked content to the requested page count without rewording", async () => {
    const prov = providerFor(null);
    let a = await analyze(profile, prov, { jdText: DEMO_JD_TEXT, jobUrl: "", company: "", title: "", settings: SettingsSchema.parse({ length: "4" }) });
    a = acceptAllSafe(await generate(profile, prov, a));
    const doc = finalDocs(a, profile);
    const one = fitResume(doc.resume, "1");
    expect(one.pages).toBeLessThanOrEqual(1);
    expect(one.trimmed).toBeGreaterThan(0);
    const keep = new Set(doc.resume.experience.flatMap((e) => e.bullets.map((b) => b.text)));
    for (const e of one.resume.experience) for (const b of e.bullets) expect(keep.has(b.text)).toBe(true);
    expect(one.resume.experience.every((e) => e.bullets.length >= 1)).toBe(true);
    const cv = fitResume(doc.resume, "cv");
    expect(cv.trimmed).toBe(0);
  });
  it("every theme is single-column, labelled with an ATS risk, and exports", async () => {
    const prov = providerFor(null);
    let a = await analyze(profile, prov, { jdText: DEMO_JD_TEXT, jobUrl: "", company: "", title: "", settings: SettingsSchema.parse({}) });
    a = acceptAllSafe(await generate(profile, prov, a));
    const doc = finalDocs(a, profile);
    for (const t of THEMES) {
      expect(["Low", "Low-Medium"]).toContain(t.risk);
      const text = await extractText("pdf", Buffer.from(resumePdf(doc.resume, "3", t.id).data));
      expect(text.trim().startsWith("Alex Demo")).toBe(true);
      expect(text).toMatch(/PROFESSIONAL EXPERIENCE/);
    }
    expect(Buffer.from(coverLetterPdf(a.letter!, profile.identity)).length).toBeGreaterThan(1000);
  });
});

describe("custom vocabulary", () => {
  it("user terms are recognised, cannot override built-ins, and can be removed", () => {
    ontology.setCustom([{ canonical: "Acme VIP", aliases: ["AcmeBFM"], category: "Tool", type: "tool" }, { canonical: "UVM", aliases: ["zzz"], category: "x", type: "tool" }]);
    expect(ontology.findTerms("Used AcmeBFM here").map((h) => h.canonical)).toEqual(["Acme VIP"]);
    expect(ontology.findTerms("zzz")).toEqual([]);
    ontology.setCustom([]);
    expect(ontology.findTerms("Used AcmeBFM here")).toEqual([]);
    expect(ontology.findTerms("UVM")[0].canonical).toBe("UVM");
  });
});

describe("linkedin featured", () => {
  it("suggests projects, github and certifications from the profile only", () => {
    const m = analyzeMatch(profile, jd, SettingsSchema.parse({}));
    const plan = planLinkedIn(profile, jd, m, SettingsSchema.parse({}));
    expect(plan.featured.map((f) => f.item)).toEqual(expect.arrayContaining(["Automotive MCU Subsystem", "github.com/alexdemo-demo"]));
  });
});
