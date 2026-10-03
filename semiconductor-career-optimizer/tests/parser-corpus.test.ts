import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import { parseResumeHeuristic } from "@/lib/parsing/resume-parser";
import { extractText } from "@/lib/parsing/extract";

const dir = path.join(__dirname, "fixtures/resumes");
const load = (f: string) => fs.readFileSync(path.join(dir, f), "utf8");

type R = [title: string, employer: string, start: string, end: string, bullets: number];
const EXPECT: Record<string, { name: string; email: string; roles: R[]; degrees: number }> = {
  "a-rightdates.txt": { name: "Priya Fictional", email: "priya.f@example.com", degrees: 2, roles: [["Staff Verification Engineer", "Globex Microsystems", "03/2020", "Present", 3], ["Senior Verification Engineer", "Initech Semiconductors Pvt. Ltd.", "07/2016", "02/2020", 2]] },
  "b-employer-first.txt": { name: "LEE FICTIONAL", email: "lee.f@example.com", degrees: 1, roles: [["Principal Verification Engineer", "Northern Chips GmbH", "Sep 2018", "Present", 3], ["Senior Verification Engineer", "Northern Chips GmbH", "Jan 2014", "Aug 2018", 2], ["Verification Engineer", "Southern Silicon Ltd", "2010", "2013", 1]] },
  "c-contract-client.txt": { name: "Sam Fictional", email: "sam.f@example.com", degrees: 1, roles: [["DV Consultant", "", "Feb 2021", "Present", 3], ["Senior Verification Engineer", "Hooli Semiconductor", "Aug 2015", "Jan 2021", 2]] },
  "d-promotions-inline-skills.txt": { name: "Jordan Fictional", email: "jordan.f@example.com", degrees: 1, roles: [["Verification Architect", "Contoso Silicon", "2021", "Present", 2], ["Principal Engineer", "Contoso Silicon", "2018", "2021", 1], ["Senior Engineer", "Contoso Silicon", "2013", "2018", 1]] },
  "e-wrapped-glyphs.txt": { name: "Chris Fictional", email: "chris.f@example.com", degrees: 1, roles: [["Verification Engineer", "Umbrella Devices Sdn Bhd", "Jun 2019", "Present", 2], ["Junior Engineer", "Stark Electronics", "Jan 2017", "May 2019", 1]] },
};

function check(text: string, exp: (typeof EXPECT)[string]) {
  const p = parseResumeHeuristic(text);
  expect(p.identity.name).toBe(exp.name);
  expect(p.identity.email).toBe(exp.email);
  expect(p.roles.map((r) => [r.title, r.employer, r.startDate, r.endDate, r.responsibilities.length + r.achievements.length])).toEqual(exp.roles);
  expect(p.education.filter((e) => e.degree).length).toBe(exp.degrees);
  return p;
}

describe("parser corpus (varied fictional layouts)", () => {
  for (const [f, exp] of Object.entries(EXPECT)) it(`parses ${f}`, () => { check(load(f), exp); });

  it("captures client, employment type, certifications (contract layout)", () => {
    const p = parseResumeHeuristic(load("c-contract-client.txt"));
    expect(p.roles[0]).toMatchObject({ client: "Acme Fabless Co.", employmentType: "Freelance" });
    expect(p.certifications[0]).toMatch(/Jasper/);
    expect(p.identity.location).toBe("Singapore");
  });
  it("does not invent skills in the absence of a skills section from soft/planning terms", () => {
    const p = parseResumeHeuristic(load("b-employer-first.txt"));
    const all = Object.values(p.skills).flat();
    expect(all).not.toContain("Technical Leadership");
    expect(all).not.toContain("Verification Planning");
  });
  it("strips ZIP codes and keeps the first segment of 'Name — Title' as the name", () => {
    const p = parseResumeHeuristic(load("d-promotions-inline-skills.txt"));
    expect(p.identity.location).toBe("Austin, TX");
  });
  it("handles bullets glyphs without spaces and private-use bullets", () => {
    const p = parseResumeHeuristic("Pat Q\n\nEXPERIENCE\nEngineer | Co | Austin, USA\nJan 2015 – Present\n•Wrote UVM tests for AXI.\n Debugged failures with Verdi.\n");
    expect(p.roles[0].responsibilities).toHaveLength(2);
  });
  it("empty / garbage input yields an empty but valid profile, never throws", () => {
    for (const t of ["", "   \n\n", "lorem ipsum dolor sit amet", "• • •\n- -\n2020 – 2021"]) expect(() => parseResumeHeuristic(t)).not.toThrow();
    expect(parseResumeHeuristic("").roles).toEqual([]);
  });
});

describe("PDF round trip (text extraction layer)", () => {
  async function toPdf(text: string): Promise<Buffer> {
    return new Promise((res) => {
      const d = new PDFDocument({ size: "A4", margins: { top: 36, bottom: 36, left: 36, right: 36 } });
      const chunks: Buffer[] = []; d.on("data", (c: Buffer) => chunks.push(c)); d.on("end", () => res(Buffer.concat(chunks)));
      d.font("Courier").fontSize(7.5);
      let y = 36;
      for (const line of text.split("\n")) {
        if (y > 800) { d.addPage(); y = 36; }
        d.text(line.replace(/[\uF000-\uF0FF]/g, "•") || " ", 36, y, { lineBreak: false });
        y += 10;
      }
      d.end();
    });
  }
  for (const f of ["a-rightdates.txt", "b-employer-first.txt", "d-promotions-inline-skills.txt"]) {
    it(`PDF text of ${f} parses like the source`, async () => {
      const text = await extractText("pdf", await toPdf(load(f)));
      check(text, EXPECT[f]);
    });
  }
});
