import type { AIProvider } from "./provider";
import { parseResumeHeuristic } from "../parsing/resume-parser";
import { parseJobDescriptionHeuristic } from "../parsing/jd-parser";
import { analyzeMatch } from "../matching/matcher";
import { deterministicRewrites } from "../tailoring/resume";
import { generateCoverLetter } from "../tailoring/cover-letter";
import { checkClaim } from "../truth/truth";
import { buildIndex } from "../profile-index";
import { planLinkedIn } from "../outreach/linkedin";
import { planOutreach } from "../outreach/recruiter";
import { planInterview } from "../interview/interview";

/** Offline provider: fully deterministic, no network, no data leaves the server. */
export class MockProvider implements AIProvider {
  readonly name = "mock";
  readonly sendsDataExternally = false;
  async analyzeResume(raw: string) { return parseResumeHeuristic(raw); }
  async analyzeJob(text: string, hints?: { company?: string; title?: string }) { return parseJobDescriptionHeuristic(text, hints); }
  async compareResumeToJob(p: Parameters<AIProvider["compareResumeToJob"]>[0], jd: Parameters<AIProvider["compareResumeToJob"]>[1], s: Parameters<AIProvider["compareResumeToJob"]>[2]) { return analyzeMatch(p, jd, s); }
  async rewriteResume(p: Parameters<AIProvider["rewriteResume"]>[0], jd: Parameters<AIProvider["rewriteResume"]>[1], m: Parameters<AIProvider["rewriteResume"]>[2]) { return deterministicRewrites(p, jd, m, buildIndex(p)); }
  async generateCoverLetter(p: Parameters<AIProvider["generateCoverLetter"]>[0], jd: Parameters<AIProvider["generateCoverLetter"]>[1], m: Parameters<AIProvider["generateCoverLetter"]>[2], s: Parameters<AIProvider["generateCoverLetter"]>[3]) { return generateCoverLetter(p, jd, m, s); }
  async auditClaims(p: Parameters<AIProvider["auditClaims"]>[0], claims: string[]) { const index = buildIndex(p); return claims.map((c) => checkClaim(c, { index })); }
  async generateInterviewPrep(p: Parameters<AIProvider["generateInterviewPrep"]>[0], jd: Parameters<AIProvider["generateInterviewPrep"]>[1], m: Parameters<AIProvider["generateInterviewPrep"]>[2], s: Parameters<AIProvider["generateInterviewPrep"]>[3]) { return planInterview(p, jd, m, s); }
  async optimizeLinkedIn(...a: Parameters<AIProvider["optimizeLinkedIn"]>) { return planLinkedIn(...a); }
  async generateRecruiterMessage(...a: Parameters<AIProvider["generateRecruiterMessage"]>) { return planOutreach(...a); }
}
