import { describe, it, expect } from "vitest";
import { parseResumeHeuristic } from "@/lib/parsing/resume-parser";
import { parseJobDescriptionHeuristic } from "@/lib/parsing/jd-parser";
import { DEMO_JD_TEXT, DEMO_RESUME_TEXT } from "@/lib/demo";
import { sanitizeFilename, detectKind, htmlToText, fetchJobPage } from "@/lib/server/security";
import { structured, extractJson, groundProfile } from "@/lib/ai/llm";
import { ProfileSchema } from "@/lib/types";
import { z } from "zod";

describe("resume parser", () => {
  const p = parseResumeHeuristic(DEMO_RESUME_TEXT);
  it("extracts identity", () => { expect(p.identity).toMatchObject({ name: "Alex Demo", email: "alex.demo@example.com", location: "Bangalore, India" }); expect(p.identity.linkedin).toContain("linkedin.com/in/"); });
  it("extracts roles with dates, titles, employers, bullets", () => {
    expect(p.roles).toHaveLength(3);
    expect(p.roles[0]).toMatchObject({ title: "Principal Verification Engineer", employer: "Northwind Silicon", startDate: "Jan 2020", endDate: "Present" });
    expect(p.roles[0].responsibilities.length).toBe(6);
    expect(p.roles[0].teamSize).toMatch(/6/);
    expect(p.roles[0].tools).toContain("Xcelium");
    expect(p.roles[0].protocols).toContain("PCIe");
  });
  it("extracts education and categorized skills", () => {
    expect(p.education.length).toBe(2);
    expect(p.skills.languages).toContain("SystemVerilog");
    expect(p.skills.formal).toContain("Questa Formal");
    expect(p.skills.protocols).toContain("AXI");
  });
});

describe("JD parser", () => {
  const jd = parseJobDescriptionHeuristic(DEMO_JD_TEXT);
  const imp = (t: string) => jd.requirements.find((r) => r.text === t)?.importance;
  it("extracts metadata", () => { expect(jd).toMatchObject({ roleTitle: "Principal Design Verification Engineer", company: "Acme Silicon", seniority: "Principal", yearsRequired: 10 }); });
  it("classifies importance rather than weighting all sentences equally", () => {
    expect(imp("SystemVerilog")).toBe("mandatory");
    expect(imp("JasperGold")).toBe("preferred");
    expect(imp("PCIe or CXL")).toBe("preferred"); // "PCIe or CXL" is one requirement either term satisfies
    expect(jd.requirements.some((r) => r.importance === "administrative")).toBe(true);
    expect(jd.workAuthorization).toMatch(/eligible to work/i);
  });
  it("drops recruiter boilerplate", () => { expect(jd.requirements.some((r) => /competitive salary|equal opportunity/i.test(r.text))).toBe(false); });
  it("classifies requirement types", () => {
    expect(jd.requirements.find((r) => r.text === "JasperGold")!.type).toBe("formal-tool");
    expect(jd.requirements.find((r) => r.text === "RISC-V")!.type).toBe("processor");
  });
});

describe("upload & URL security", () => {
  it("sanitizes filenames", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("my résumé (final).pdf")).not.toMatch(/[()/\\]/);
    expect(sanitizeFilename("")).toBe("file");
  });
  it("validates extension and magic bytes", () => {
    expect(() => detectKind("a.exe", Buffer.from("MZ"))).toThrow();
    expect(() => detectKind("a.pdf", Buffer.from("not a pdf at all"))).toThrow();
    expect(() => detectKind("a.docx", Buffer.from("plain"))).toThrow();
    expect(detectKind("a.pdf", Buffer.from("%PDF-1.7 ..."))).toBe("pdf");
    expect(detectKind("a.txt", Buffer.from("hello"))).toBe("txt");
  });
  it("blocks SSRF to loopback / private / metadata addresses", async () => {
    for (const u of ["http://127.0.0.1/", "http://169.254.169.254/latest/meta-data", "http://10.0.0.5/", "http://[::1]/", "file:///etc/passwd", "ftp://example.com"]) await expect(fetchJobPage(u)).rejects.toThrow();
  });
  it("extracts job text from html and prefers JSON-LD", () => {
    expect(htmlToText("<html><script>x()</script><body><h1>Role</h1><ul><li>UVM</li></ul></body></html>")).toContain("- UVM");
    expect(htmlToText(`<script type="application/ld+json">{"title":"DV Eng","description":"Strong UVM","hiringOrganization":{"name":"Acme"}}</script>`)).toContain("Acme");
  });
});

describe("AI abstraction guards", () => {
  it("extracts JSON from fenced output", () => { expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 }); });
  it("retries invalid structured output and feeds the error back", async () => {
    const seen: string[] = [];
    const replies = ["not json", '{"x":"wrong type"}', '{"x":5}'];
    const out = await structured(async (_s, u) => { seen.push(u); return replies.shift()!; }, z.object({ x: z.number() }), "sys", "user");
    expect(out).toEqual({ x: 5 });
    expect(seen[1]).toMatch(/invalid/i);
  });
  it("gives up after retries", async () => { await expect(structured(async () => "nope", z.object({ x: z.number() }), "s", "u", 1)).rejects.toThrow(/invalid structured output/); });
  it("grounding drops model-invented tools and bullets absent from the resume", () => {
    const base = parseResumeHeuristic(DEMO_RESUME_TEXT);
    const forged = ProfileSchema.parse({ ...base, roles: [{ ...base.roles[0], tools: [...base.roles[0].tools, "JasperGold"], responsibilities: [...base.roles[0].responsibilities, "Improved regression efficiency by 40% across all programs."], employer: "Imaginary Corp" }] });
    const g = groundProfile(forged, DEMO_RESUME_TEXT);
    expect(g.roles[0].tools).not.toContain("JasperGold");
    expect(g.roles[0].responsibilities.some((b) => b.includes("40%"))).toBe(false);
    expect(g.roles[0].employer).toBe("");
  });
});
