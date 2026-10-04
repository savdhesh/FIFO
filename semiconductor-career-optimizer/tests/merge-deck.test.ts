import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { parseResumeHeuristic } from "@/lib/parsing/resume-parser";
import { parseJobDescriptionHeuristic } from "@/lib/parsing/jd-parser";
import { analyzeMatch } from "@/lib/matching/matcher";
import { mergeResumes, applyMerge, acceptSafeItems } from "@/lib/merge/merge";
import { buildDeck, deckBuffer, slideBullet } from "@/lib/deck/deck";
import { DEMO_JD_TEXT, DEMO_RESUME_TEXT } from "@/lib/demo";
import { SettingsSchema } from "@/lib/types";

// An older resume of the same fictional person: fewer roles, older title, different team size, extra detail + a project.
const OLD_2019 = `Alex Demo
Hyderabad, India | alex.demo@example.com | +91 98000 00001

EXPERIENCE
Staff Verification Engineer | Contoso Semiconductors | Hyderabad, India
Jun 2016 - Dec 2019
- Developed reusable UVM verification infrastructure and VIP shared by several IP teams, with a configurable scoreboard and layered sequences.
- Wrote SystemVerilog assertions (SVA) and performed formal property checking using Questa Formal.
- Led a team of 3 engineers on AHB and APB peripheral sign-off.
- Verified a DMA controller using Synopsys Formality for equivalence checks and VCS.

Senior Verification Engineer | Fabrikam Chips | Pune, India
Jul 2013 - May 2016
- Developed constrained-random SystemVerilog testbenches with scoreboards and functional coverage for IP blocks.
- Delivered a USB 2.0 device controller verification environment with a coverage model.

PROJECTS
Automotive MCU Subsystem | Contoso Semiconductors | 2018
- Verified the interrupt controller and watchdog of an ISO 26262 ASIL-B MCU subsystem.
- Built fault injection tests for the safety mechanisms.

EDUCATION
M.Tech in VLSI Design, Example Institute of Technology, 2013
B.E. in Electronics, Example University, 2011
M.S. in Computer Engineering, Other State University, 2014

TECHNICAL SKILLS
Languages: SystemVerilog, Verilog, C, Python, Perl, Tcl
Formal: Questa Formal, Synopsys Formality
Tools: VCS, Verdi, Git
`;
const OLD_2014 = `Alex Demo
alex.demo@example.com

EXPERIENCE
Verification Engineer | Fabrikam Chips | Pune, India
Jul 2013 - Dec 2014
- Built block-level verification for an Ethernet MAC.
EDUCATION
B.E. in Electronics, Example University, 2011
`;

const OLD_2022 = `Alex Demo
Bangalore, India | alex.demo@example.com | +91 98111 11111

EXPERIENCE
Senior Verification Engineer | Northwind Silicon | Bangalore, India
Jan 2020 – Present
- Led a team of 4 engineers through coverage closure and regression debug using Xcelium and Verdi.
`;
const current = parseResumeHeuristic(DEMO_RESUME_TEXT);
const src = (name: string, text: string) => ({ id: name, name, profile: parseResumeHeuristic(text) });

describe("multi-resume merge", () => {
  const rep = mergeResumes([src("resume-2022.pdf", OLD_2022), src("resume-2019.pdf", OLD_2019), src("resume-2014.pdf", OLD_2014)], current);
  const byKind = (k: string) => rep.items.filter((i) => i.kind === k);

  it("adds only new content, deduplicating identical bullets across resumes", () => {
    expect(byKind("bullet-new").some((i) => /USB 2\.0/.test(i.proposed))).toBe(true);
    expect(rep.items.some((i) => i.proposed.includes("Developed constrained-random SystemVerilog testbenches"))).toBe(false);
    const props = byKind("bullet-new").map((i) => i.proposed);
    expect(new Set(props).size).toBe(props.length);
  });
  it("flags disagreements as conflicts that never auto-resolve (team size, phone, dates)", () => {
    const c = byKind("conflict");
    expect(c.some((i) => i.label === "bullet metrics differ" && /team of 4/.test(i.proposed))).toBe(true);
    expect(c.some((i) => i.group === "Identity" && i.label === "phone")).toBe(true);
    expect(c.some((i) => i.label === "title" && /Senior Verification Engineer/.test(i.proposed) && /Principal/.test(i.current ?? ""))).toBe(true);
    expect(c.every((i) => !i.safe)).toBe(true);
  });
  it("proposes richer bullet versions, new projects, education and skills from old resumes", () => {
    expect(byKind("bullet-detail").some((i) => /configurable scoreboard/.test(i.proposed))).toBe(true);
    expect(byKind("project-new")[0].proposed).toMatch(/Automotive MCU Subsystem/);
    expect(byKind("edu-new").some((i) => /Other State University/.test(i.proposed))).toBe(true);
    expect(byKind("skill-new").some((i) => /Synopsys Formality|Formality/.test(i.proposed))).toBe(true);
  });
  it("nothing changes until accepted; accept-safe applies additions only", () => {
    expect(JSON.stringify(applyMerge(current, rep.items))).toBe(JSON.stringify(applyMerge(current, [])));
    const merged = applyMerge(current, acceptSafeItems(rep.items));
    const text = JSON.stringify(merged);
    expect(text).toContain("USB 2.0");
    expect(text).not.toContain("team of 4"); // conflict not applied
    expect(merged.roles[0].title).toBe("Principal Verification Engineer");
    expect(merged.identity.phone).toBe(current.identity.phone);
    expect(merged.projects.length).toBe(1);
    // every added bullet came from a source resume
    const sources = OLD_2019 + OLD_2014;
    for (const r of merged.roles) for (const b of [...r.responsibilities, ...r.achievements]) expect(DEMO_RESUME_TEXT.includes(b) || sources.includes(b)).toBe(true);
  });
  it("accepting a conflict applies exactly the chosen value", () => {
    const c = rep.items.find((i) => i.kind === "conflict" && i.label === "bullet metrics differ")!;
    const merged = applyMerge(current, rep.items.map((i) => (i.id === c.id ? { ...i, decision: "accepted" as const } : i)));
    expect(JSON.stringify(merged)).toContain(c.proposed.slice(0, 40));
  });
  it("builds a base from the most recent resume when there is no profile, and reports analysis", () => {
    const r = mergeResumes([src("old.txt", OLD_2014), src("new.txt", DEMO_RESUME_TEXT)]);
    expect(r.analysis.baseName).toBe("new.txt");
    expect(r.base.roles.length).toBe(3);
    const gaps = mergeResumes([src("g.txt", `Pat\n\nEXPERIENCE\nEngineer | A Co | Austin, USA\nJan 2010 – Dec 2012\n- Wrote UVM tests for AXI blocks.\nEngineer | B Co | Austin, USA\nJan 2015 – Present\n- Wrote UVM tests for PCIe blocks.\n`)]);
    expect(gaps.analysis.gaps[0].months).toBeGreaterThan(20);
  });
  it("reports terms that exist only in older resumes", () => {
    expect(rep.analysis.onlyInOlder.length).toBeGreaterThan(0);
  });
});

describe("projects & achievements deck", () => {
  const withProjects = applyMerge(current, acceptSafeItems(mergeResumes([src("resume-2019.pdf", OLD_2019)], current).items));
  const jd = parseJobDescriptionHeuristic(DEMO_JD_TEXT);
  const match = analyzeMatch(withProjects, jd, SettingsSchema.parse({}));

  it("builds a valid .pptx whose slides carry only profile text", async () => {
    const deck = buildDeck(withProjects, { focus: { jd, match } });
    const buf: Buffer = await deckBuffer(deck, "nodebuffer");
    const zip = await JSZip.loadAsync(buf);
    const slides = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f));
    expect(slides.length).toBe(deck.slides.length);
    const xml = (await Promise.all(slides.map((f) => zip.files[f].async("string")))).join("\n");
    expect(xml).toContain("Alex Demo");
    expect(xml).toMatch(/Automotive MCU Subsystem/);
    expect(xml).not.toMatch(/JasperGold/i);
    // every number on slides exists in the profile (no invented metrics)
    const profileText = JSON.stringify(withProjects);
    const slideNums = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].flatMap((m) => m[1].match(/\b\d+(?:\.\d+)?\s?%/g) ?? []);
    for (const nn of slideNums) expect(profileText).toContain(nn.trim());
  });
  it("covers the expected slide types and warns when there are no measurable results", () => {
    const deck = buildDeck(withProjects);
    expect(deck.slides.map((s) => s.kind)).toEqual(expect.arrayContaining(["title", "snapshot", "timeline", "project", "toolbox", "closing"]));
    const bare = buildDeck(parseResumeHeuristic("Pat\n\nEXPERIENCE\nEngineer | Co | Austin, USA\nJan 2015 – Present\n- Wrote UVM tests for AXI blocks using Xcelium and Verdi.\n"));
    expect(bare.warnings.join(" ")).toMatch(/measurable|achievements/i);
  });
  it("focuses project order on the target job and respects maxProjects/include", () => {
    const d = buildDeck(withProjects, { focus: { jd, match }, maxProjects: 2, include: { toolbox: false, education: false } });
    expect(d.slides.filter((s) => s.kind === "project")).toHaveLength(2);
    expect(d.slides.some((s) => s.kind === "toolbox")).toBe(false);
  });
  it("slide bullets are trimmed, never reworded", () => {
    const long = "Owned the UVM verification architecture for a multi-block automotive SoC subsystem, including agents, scoreboards, reference models, register model, functional coverage, regression infrastructure and debug flows.";
    const t = slideBullet(long);
    expect(long.startsWith(t)).toBe(true);
    expect(t.length).toBeLessThanOrEqual(190);
  });
});
