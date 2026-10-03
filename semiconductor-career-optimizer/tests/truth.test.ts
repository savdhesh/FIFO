import { describe, it, expect } from "vitest";
import { parseResumeHeuristic } from "@/lib/parsing/resume-parser";
import { DEMO_RESUME_TEXT } from "@/lib/demo";
import { buildIndex } from "@/lib/profile-index";
import { checkClaim, sanitizeProse } from "@/lib/truth/truth";

const profile = parseResumeHeuristic(DEMO_RESUME_TEXT);
const index = buildIndex(profile);
const ctx = { index };
const top = profile.roles[0];

describe("truth protection", () => {
  it("VERIFIED: text taken directly from the profile", () => {
    expect(checkClaim(top.responsibilities[1], { index, roleId: top.id }).status).toBe("VERIFIED");
  });
  it("SUPPORTED: recombined using only profile facts", () => {
    const c = checkClaim("Verification of PCIe and AXI interfaces using Xcelium and Verdi.", ctx);
    expect(c.status).toBe("SUPPORTED");
  });
  it("UNSUPPORTED: a tool the candidate never used (related is not direct)", () => {
    const c = checkClaim("Performed formal verification using JasperGold.", ctx);
    expect(c.status).toBe("UNSUPPORTED");
    expect(c.hallucination).toBe(true);
    expect(c.unknownTerms).toContain("JasperGold");
  });
  it("UNSUPPORTED: invented metrics, team sizes, tapeouts", () => {
    expect(checkClaim("Improved regression efficiency by 40%.", ctx).unknownMetrics).toContain("40%");
    expect(checkClaim("Led a team of 25 engineers.", ctx).status).toBe("UNSUPPORTED");
    expect(checkClaim("Contributed to 7 tapeouts.", ctx).status).toBe("UNSUPPORTED");
  });
  it("metrics that the user supplied are allowed", () => {
    expect(checkClaim("Led a team of 6 engineers through coverage closure.", ctx).status).not.toBe("UNSUPPORTED");
  });
  it("UNSUPPORTED: invented protocols, certifications, patents, employers", () => {
    expect(checkClaim("Verified CXL.cache coherency.", ctx).status).toBe("UNSUPPORTED");
    expect(checkClaim("Certified ISO 26262 functional safety professional.", ctx).status).toBe("UNSUPPORTED");
    expect(checkClaim("Holds two patents in verification.", ctx).status).toBe("UNSUPPORTED");
    expect(checkClaim("Previously at Globex Semiconductors.", ctx).status).toBe("UNSUPPORTED");
  });
  it("UNSUPPORTED: leadership the profile does not state", () => {
    const p = parseResumeHeuristic("Pat\n\nEXPERIENCE\nEngineer | Co | Austin, USA\nJan 2015 – Present\n- Wrote UVM testcases for an AXI block.\n");
    expect(checkClaim("Led the UVM verification effort.", { index: buildIndex(p) }).status).toBe("UNSUPPORTED");
  });
  it("INFERRED: plausible-but-unstated practice terms need approval", () => {
    const p = parseResumeHeuristic("Pat\n\nEXPERIENCE\nEngineer | Co | Austin, USA\nJan 2015 – Present\n- Closed functional coverage for an AXI block.\n");
    const c = checkClaim("Closed functional coverage and verification planning for an AXI block.", { index: buildIndex(p) });
    expect(c.status).toBe("INFERRED");
  });
  it("INFERRED: a term from another role attributed to this role", () => {
    const second = profile.roles[2];
    const c = checkClaim("Verified PCIe interfaces.", { index, roleId: second.id });
    expect(c.status).toBe("INFERRED");
  });
  it("sanitizeProse strips unsupported sentences only", () => {
    const r = sanitizeProse("I verified AXI interfaces. I used JasperGold to prove properties. I improved throughput by 40%.", ctx);
    expect(r.clean).toBe("I verified AXI interfaces.");
    expect(r.removed).toHaveLength(2);
  });
  it("allowed names (JD company/title) do not trigger false hallucinations", () => {
    const c = checkClaim("I am applying for the JasperGold Formal Lead role at Acme Semiconductors.", { index, allowedNames: ["JasperGold Formal Lead", "Acme Semiconductors"] });
    expect(c.status).not.toBe("UNSUPPORTED");
  });
});
