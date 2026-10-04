import { describe, it, expect } from "vitest";
import fs from "fs";
import { parseResumeHeuristic } from "@/lib/parsing/resume-parser";
import { parseJobDescriptionHeuristic } from "@/lib/parsing/jd-parser";
import { analyzeMatch } from "@/lib/matching/matcher";
import { generateCoverLetter } from "@/lib/tailoring/cover-letter";
import { planLinkedIn } from "@/lib/outreach/linkedin";
import { planInterview } from "@/lib/interview/interview";
import { checkClaim } from "@/lib/truth/truth";
import { auditCredibility } from "@/lib/credibility/credibility";
import { buildIndex, latestRole } from "@/lib/profile-index";
import { DEMO_JD_TEXT, DEMO_RESUME_TEXT } from "@/lib/demo";
import { SettingsSchema } from "@/lib/types";

// Defects found by the third audit (generated-output review). Each test pins one fix.
const demo = parseResumeHeuristic(DEMO_RESUME_TEXT);
const settings = SettingsSchema.parse({});
const jd = (head: string, body = "Requirements\n- Strong SystemVerilog and UVM\n") => parseJobDescriptionHeuristic(`${head}\n\n${body}`);

describe("JD header line", () => {
  it.each([
    ["Wayne Interconnect · San Jose, CA (Hybrid)", "Wayne Interconnect", "San Jose, CA (Hybrid)"],
    ["Stark Formal Labs — Austin, TX", "Stark Formal Labs", "Austin, TX"],
    ["Initech India Pvt Ltd | Bengaluru", "Initech India Pvt Ltd", "Bengaluru"],
    ["Massive Dynamic Semiconductors (Remote, Singapore)", "Massive Dynamic Semiconductors", "Remote, Singapore"],
  ])("%s", (line, company, location) => {
    const j = jd(`Senior Design Verification Engineer\n${line}`);
    expect(j.company).toBe(company);
    expect(j.location).toBe(location);
  });
});

describe("alternatives", () => {
  const j = jd("Design Verification Engineer\nInitech", "Must have:\n1. Exposure to simulators like Xcelium or VCS\n2. Experience with APB, AHB or AXI\n");
  it("groups 'Xcelium or VCS' into one requirement", () => {
    expect(j.requirements.find((r) => r.text === "Xcelium or VCS")?.terms).toEqual(["Xcelium", "VCS"]);
    expect(j.requirements.find((r) => r.text === "VCS")).toBeUndefined();
  });
  it("is satisfied by any member and is not a gap", () => {
    const m = analyzeMatch(parseResumeHeuristic("Bo\nbo@example.com\n\nEXPERIENCE\nDV Engineer, X Corp, Jan 2020 - Present\n- Ran regressions on Xcelium for APB peripherals.\n"), j);
    const row = m.requirements.find((r) => r.explanation.includes("any of: Xcelium, VCS"))!;
    expect(row.matchType).toBe("exact");
    expect(m.gaps.map((g) => g.term)).not.toContain("VCS");
  });
});

describe("years", () => {
  it("keeps the upper bound of a range and caps STRONG APPLY when heavily overqualified", () => {
    const j = jd("Design Verification Engineer\nInitech", "We are hiring with 2-4 years of experience.\nMust have:\n- SystemVerilog and UVM\n- AXI\n");
    expect([j.yearsRequired, j.yearsMax]).toEqual([2, 4]);
    const m = analyzeMatch(demo, j);
    expect(m.recommendation.verdict).not.toBe("STRONG APPLY");
    expect(m.recommendation.reasons.join(" ")).toMatch(/Overqualified/);
  });
  it("counts domain-qualified years only from roles showing the domain", () => {
    const j = jd("Principal CPU Verification Engineer\nAcme Cores", "Requirements\n- 12+ years of CPU verification experience\n");
    const row = analyzeMatch(demo, j).requirements.find((r) => r.type === "experience")!;
    expect(row.requirement).toMatch(/CPU Verification/);
    expect(row.explanation).toMatch(/in roles showing CPU Verification/);
  });
});

describe("generated text", () => {
  const j = parseJobDescriptionHeuristic(DEMO_JD_TEXT);
  const m = analyzeMatch(demo, j);
  it("cover letter: no repeated 'I also', article before the role, call to action last, no hard-coded UK spelling", () => {
    const text = generateCoverLetter(demo, j, m, settings).paragraphs.join("\n");
    expect((text.match(/\bI also\b/g) ?? []).length).toBeLessThanOrEqual(1);
    expect(text).toMatch(/The Principal Design Verification Engineer role at Acme Silicon/);
    expect(text).not.toMatch(/centres/);
    expect(text.trim().split("\n").pop()).toMatch(/technical discussion/);
  });
  it("LinkedIn About uses the candidate's location, never the default country; lead and weak bullets do not overlap", () => {
    const plan = planLinkedIn(demo, j, m, settings);
    expect(plan.about.text).not.toMatch(/roles in USA/);
    expect(plan.about.text).toMatch(/based in Bangalore, India/);
    for (const e of plan.experience) for (const b of e.lead) expect(e.weak).not.toContain(b);
  });
  it("skills-only terms get a consistent message and an honest interview question", () => {
    const p = parseResumeHeuristic(`${DEMO_RESUME_TEXT}\nTools: VCS`);
    const jj = jd("Design Verification Engineer\nInitech", "Must have:\n- Hands-on VCS experience\n");
    const mm = analyzeMatch(p, jj);
    expect(mm.gaps.find((g) => g.term === "VCS")?.recommendation).toMatch(/Listed in your skills/);
    expect(planInterview(p, jj, mm).gapQuestions.find((q) => q.topic === "VCS")?.q).toMatch(/Your resume lists VCS/);
  });
});

describe("profile helpers and checks", () => {
  it("latest role is chosen by date, not by string order", () => {
    const p = parseResumeHeuristic("A\na@example.com\n\nEXPERIENCE\nEngineer, Old Co, Mar 2015 - Jan 2019\n- Wrote UVM tests.\nSenior Engineer, New Co, Feb 2019 - Present\n- Led UVM work.\n");
    expect(latestRole(p)?.employer).toBe("New Co");
  });
  it("money amounts are metrics that must be in the profile", () => {
    expect(checkClaim("Saved $2M in mask costs.", { index: buildIndex(demo) }).status).toBe("UNSUPPORTED");
  });
  it("a child term in a bullet demonstrates its parent skill", () => {
    const p = parseResumeHeuristic("A\na@example.com\n\nEXPERIENCE\nDV Engineer, X, Jan 2018 - Present\n- Verified the Ethernet MAC block with UVM.\n\nSKILLS\nEthernet, UVM\n");
    const msg = auditCredibility(p).map((i) => i.message).join(" ");
    expect(msg).not.toMatch(/demonstrates:[^.]*\bEthernet\b(?! MAC)/);
  });
  it("physical-design jobs are recognised as a mismatch", () => {
    const pd = parseJobDescriptionHeuristic(fs.readFileSync("eval/gold/jds/j7-pd.txt", "utf8"));
    expect(analyzeMatch(demo, pd).recommendation.verdict).toBe("DO NOT APPLY");
  });
});

describe("real-world merge of two versions of one resume (table layout + modern layout)", async () => {
  const { mergeResumes, applyMerge, acceptSafeItems } = await import("@/lib/merge/merge");
  const { tailorResume } = await import("@/lib/tailoring/resume");
  const { resumePdf } = await import("../artifact/exporters");
  const { extractText, getDocumentProxy } = await import("unpdf");
  const a = parseResumeHeuristic(fs.readFileSync("tests/fixtures/resumes/l-table-footer-wraps.txt", "utf8"));
  const b = parseResumeHeuristic(fs.readFileSync("tests/fixtures/resumes/l2-same-person-modern.txt", "utf8"));
  const r = mergeResumes([{ id: "a", name: "table.pdf", profile: a }, { id: "b", name: "modern.docx", profile: b }]);
  const merged = applyMerge(r.base, acceptSafeItems(r.items));

  it("parses the table layout: four roles, no labels, footers, hyphen splits or split bullets", () => {
    expect(a.roles.map((x) => `${x.title} @ ${x.employer}`)).toEqual(["Senior Verification Architect @ Orbit Silicon", "Lead Engineer @ Kestrel Devices", "SoC Design Consultant @ NovaChip Semiconductors", "SoC Verification Consultant @ Zephyr Devices"]);
    const text = JSON.stringify(a.roles);
    for (const bad of [/Designation|Projects and Responsibilities|"Company"/, /P a g e/, /C-221/, /\w- [a-z]/, /"PTB traffic/]) expect(text).not.toMatch(bad);
    expect(a.roles[1].achievements).toContain("Silicon Award Recipient");
  });
  it("cleans skills and education", () => {
    expect(a.skills.languages).toEqual(["System Verilog", "Verilog", "C", "Python"]);
    expect(a.skills.formal).toEqual(["formal verification (exposure)"]);
    expect(Object.values(a.skills).flat().join(" ")).not.toMatch(/Engineer|Languages |Simulation &|C-221/);
    expect(a.education.map((e) => e.university)).toEqual(["Example Universität", "Sample University"]);
    expect(b.education).toHaveLength(1);
    expect(a.certifications.join(" ")).toMatch(/Scrum Master/);
  });
  it("merges the same job written two ways into one role under the real employer", () => {
    expect(merged.roles.filter((x) => x.startDate.includes("2024"))).toHaveLength(1);
    // "Design & Verification" is read as a department, so the role keeps the real employer instead of raising a false conflict
    expect(merged.roles.find((x) => x.startDate.includes("2024"))?.employer).toBe("Orbit Silicon");
    expect(b.roles[0].employer).toBe("");
    expect(b.roles[0].client).toMatch(/Design & Verification/);
    // the reworded camera-subsystem bullet is not added a second time
    expect(merged.roles.flatMap((x) => [...x.responsibilities, ...x.achievements]).filter((t) => /camera subsystem/i.test(t) && /bring-up/.test(t))).toHaveLength(1);
    expect(merged.education.length).toBe(2);
    expect(Object.values(merged.skills).flat().filter((s) => /^system ?verilog$/i.test(s))).toHaveLength(1);
  });
  it("exported PDF text has no garbled glyph runs, furniture or duplicated skills", async () => {
    const j = parseJobDescriptionHeuristic(DEMO_JD_TEXT);
    const m = analyzeMatch(merged, j);
    const { tailored } = tailorResume(merged, j, m, SettingsSchema.parse({ length: "3" }));
    const pdf = resumePdf(tailored, "3");
    const { text } = await extractText(await getDocumentProxy(new Uint8Array(pdf.data)), { mergePages: true });
    expect(text).not.toMatch(/(?:\b\w ){6,}/); // letter-spaced runs: "C o n s u l t a n t"
    expect(text).not.toMatch(/P a g e|Designation|Projects and Responsibilities|C-221|% \+P/);
    expect(text).toMatch(/Automotive SerDes Link Verification IP/); // project line rendered under its role
  });
});

describe("merge: same dates, different employer names", async () => {
  const { mergeResumes } = await import("@/lib/merge/merge");
  it("matches by start month and asks which employer is right", () => {
    const x = parseResumeHeuristic("A\na@example.com\n\nEXPERIENCE\nSoC Specialist, Nordic Radio Oy\n07/2022 – 03/2024 | Finland\n• Owned SoC-top verification for an RF SoC.\n");
    const y = parseResumeHeuristic("A\na@example.com\n\nEXPERIENCE\nSoC Specialist, Nordic Radio Networks\n07/2022 – 03/2024 | Finland\n• Led sprint planning for the SoC verification team.\n");
    const z = parseResumeHeuristic("A\na@example.com\n\nEXPERIENCE\nSoC Verification Lead, Polar Systems AB\n07/2022 – 03/2024 | Finland\n• Owned SoC-top verification for an RF SoC.\n");
    expect(mergeResumes([{ id: "x", name: "x", profile: x }, { id: "y", name: "y", profile: y }]).base.roles).toHaveLength(1);
    const r = mergeResumes([{ id: "x", name: "x", profile: x }, { id: "z", name: "z", profile: z }]);
    expect(r.items.filter((i) => i.kind === "role-new")).toHaveLength(0);
    expect(r.items.some((i) => i.kind === "conflict" && i.label === "employer")).toBe(true);
  });
});


describe("generated skills section", async () => {
  const { tailorResume } = await import("@/lib/tailoring/resume");
  it("one entry per skill across spellings, distinct protocol variants kept, honest qualifiers kept", () => {
    const p = parseResumeHeuristic("A\na@example.com\n\nSKILLS\nSystemVerilog, System Verilog, UVM\nProtocols: AHB, AMBA AHB, SPI, QSPI, I2C, I3C\nMethods: GLS, Gate-Level Simulation\nFormal, formal verification (exposure)\n\nEXPERIENCE\nDV Engineer, X Corp, Jan 2018 - Present\n- Verified AHB and QSPI controllers with UVM and ran GLS.\n");
    const j = parseJobDescriptionHeuristic(DEMO_JD_TEXT);
    const items = tailorResume(p, j, analyzeMatch(p, j), settings).tailored.skills.flatMap((g) => g.items);
    expect(items.filter((x) => /system ?verilog$/i.test(x))).toHaveLength(1);
    expect(items.filter((x) => /AHB/.test(x))).toHaveLength(1);
    expect(items).toEqual(expect.arrayContaining(["SPI", "QSPI", "I2C", "I3C", "formal verification (exposure)"]));
    expect(items.filter((x) => /^(GLS|Gate-Level Simulation)$/.test(x))).toHaveLength(1);
  });
});

describe("date formats seen on real resumes", () => {
  it.each([
    ["Nov-2017 – Dec-2019", "Nov-2017", "Dec-2019"], ["Nov-17 to Dec-19", "Nov-17", "Dec-19"], ["November, 2017 – Till Now", "November, 2017", "Present"],
    ["2017-11 – 2019-12", "2017-11", "2019-12"], ["04-2024 – Present", "04-2024", "Present"], ["Apr 2024 − Present", "Apr 2024", "Present"],
    ["Apr 2024 - Continuing", "Apr 2024", "Present"], ["Jan 2020 ~ Mar 2021", "Jan 2020", "Mar 2021"], ["Jun 2016 through Oct 2017", "Jun 2016", "Oct 2017"],
    ["Since Apr 2024", "Apr 2024", "Present"], ["From: 04/2024 To: Present", "04/2024", "Present"], ["Apr 2024 –\nPresent", "Apr 2024", "Present"],
  ])("%s", (dates, start, end) => {
    const p = parseResumeHeuristic(`Test Person\ntest@example.com\n\nEXPERIENCE\nSenior DV Engineer, Acme Silicon\n${dates}\n• Built UVM testbenches for AXI.\n`);
    expect(p.roles).toHaveLength(1);
    expect([p.roles[0].startDate, p.roles[0].endDate]).toEqual([start, end]);
  });
  it("month names only count at a word start ('Grammar 2019' is not March)", () => {
    expect(parseResumeHeuristic("T\nt@example.com\n\nEXPERIENCE\nGrammar School 2019 – 2020\n• Studied.\n").roles.every((r) => !/mar/i.test(r.startDate))).toBe(true);
  });
  it("'04-2024' is April, not January", async () => {
    const { parseYM } = await import("@/lib/parsing/dates");
    expect(parseYM("04-2024")).toEqual({ y: 2024, m: 4 });
    expect(parseYM("Nov-17")).toEqual({ y: 2017, m: 11 });
  });
});
