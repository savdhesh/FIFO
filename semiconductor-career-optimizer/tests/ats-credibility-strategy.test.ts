import { describe, it, expect } from "vitest";
import PDFDocument from "pdfkit";
import { atsParse } from "@/lib/ats/ats";
import { auditCredibility } from "@/lib/credibility/credibility";
import { planStrategy } from "@/lib/strategy/strategy";
import { parseResumeHeuristic } from "@/lib/parsing/resume-parser";
import { parseJobDescriptionHeuristic } from "@/lib/parsing/jd-parser";
import { analyzeMatch } from "@/lib/matching/matcher";
import { DEMO_JD_TEXT, DEMO_RESUME_TEXT } from "@/lib/demo";
import { SettingsSchema } from "@/lib/types";

describe("ATS check", () => {
  it("demo resume text parses cleanly: low risk, contact + sections + dates", () => {
    const r = atsParse(DEMO_RESUME_TEXT);
    expect(r.risk).toBe("Low");
    expect(r.extracted).toMatchObject({ name: "Alex Demo", email: "alex.demo@example.com" });
    expect(r.extracted.roles).toHaveLength(3);
    expect(r.extracted.sections).toEqual(expect.arrayContaining(["experience", "education", "skills"]));
  });
  it("flags missing email, creative headings, icons, and image-only files as risky", () => {
    const bad = atsParse("Pat Q\nMY JOURNEY\nWorked at Co 2015-2020\n call me\n");
    expect(bad.risk).toBe("High");
    expect(bad.checks.find((c) => c.id === "email")!.status).toBe("fail");
    expect(bad.checks.find((c) => c.id === "text")!.status).toBe("fail");
    expect(bad.checks.find((c) => c.id === "glyphs")!.status).toBe("warn");
  });
  it("multi-column layout metadata raises the risk", () => {
    const r = atsParse(DEMO_RESUME_TEXT, { pages: 2, columns: true, minFontPt: 10, images: 0 });
    expect(r.checks.find((c) => c.id === "columns")!.status).toBe("fail");
    expect(r.risk).toBe("High");
    const small = atsParse(DEMO_RESUME_TEXT, { pages: 6, columns: false, minFontPt: 7, images: 2 });
    expect(small.checks.filter((c) => c.status === "warn").length).toBeGreaterThanOrEqual(3);
    expect(small.risk).toBe("Medium");
  });
  it("shows exactly the extracted text", () => { expect(atsParse("Pat\nA@b.co\n").text).toBe("Pat\nA@b.co"); void PDFDocument; });
});

describe("technical credibility audit", () => {
  const issues = (t: string) => auditCredibility(parseResumeHeuristic(t), new Date("2026-10-03"));
  it("the demo profile has no high-severity issues", () => { expect(issues(DEMO_RESUME_TEXT).filter((i) => i.severity === "high")).toEqual([]); });
  it("flags skills that no bullet demonstrates", () => {
    const r = issues("Pat\n\nEXPERIENCE\nEngineer | Co | Austin, USA\nJan 2015 – Present\n- Wrote Perl scripts for log parsing.\n\nTECHNICAL SKILLS\nVerification: UVM, SVA\nFormal: JasperGold\n");
    expect(r.find((i) => i.area === "Skills")!.message).toMatch(/UVM|JasperGold/);
  });
  it("flags title inflation, date errors, wrong years, and anachronisms", () => {
    const r = issues(`Pat\n\nSUMMARY\n15 years of experience in verification.\n\nEXPERIENCE\nPrincipal Verification Engineer | Co | Austin, USA\nJan 2022 – Present\n- Worked on tests.\n\nSenior Engineer | Old Co | Austin, USA\nJun 2014 – Dec 2012\n- Verified CXL and PCIe Gen6 links with UCIe dies.\n`);
    const areas = r.map((i) => i.area);
    expect(areas).toEqual(expect.arrayContaining(["Seniority", "Dates", "Experience", "Technology era"]));
    expect(r[0].severity).toBe("high");
    expect(r.filter((i) => i.area === "Technology era").length).toBeGreaterThanOrEqual(2);
  });
  it("every issue carries a concrete fix", () => { for (const i of issues("Pat\n\nEXPERIENCE\nEngineer | Co | Austin, USA\nJan 2010 – Present\n- Worked on tests.\n")) expect(i.fix.length).toBeGreaterThan(10); });
});

describe("application strategy", () => {
  const profile = parseResumeHeuristic(DEMO_RESUME_TEXT), jd = parseJobDescriptionHeuristic(DEMO_JD_TEXT), settings = SettingsSchema.parse({});
  const match = analyzeMatch(profile, jd, settings);
  const s = planStrategy(profile, jd, match, settings);
  it("covers priority, positioning, evidence, keywords, gaps, risks, sequence and interview focus", () => {
    const titles = s.sections.map((x) => x.title);
    expect(titles).toEqual(expect.arrayContaining(["Priority", "Positioning", "Lead with this evidence", "Keywords to mirror (you can support these)", "Sequence", "Interview focus"]));
    expect(s.headline).toMatch(/STRONG APPLY/);
  });
  it("never tells you to claim what you lack, and lists tools under do-not-claim", () => {
    const txt = JSON.stringify(s);
    expect(s.sections.find((x) => x.title === "Do not claim")!.items.join(" ")).toMatch(/JasperGold/);
    expect(txt).not.toMatch(/add jaspergold|claim jaspergold on/i);
    expect(s.sections.find((x) => x.title === "Gaps to handle honestly")!.items.join(" ")).toMatch(/do not claim|related background/i);
  });
  it("surfaces work-authorization and level risks without judging them", () => {
    const risks = s.sections.find((x) => x.title === "Risks to check")!.items.join(" ");
    expect(risks).toMatch(/cannot judge eligibility/);
  });
});
