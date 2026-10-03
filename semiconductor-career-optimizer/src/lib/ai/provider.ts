import type { ClaimCheck, MatchResult, ParsedJD, Profile, Settings } from "../types";
import type { BulletRewrite } from "../tailoring/resume";
import type { CoverLetter } from "../tailoring/cover-letter";

export class NotImplementedError extends Error {
  constructor(feature: string) { super(`${feature} is not available yet (planned for a later phase).`); }
}

/**
 * Every AI-backed capability goes through this interface so the vendor can be swapped via AI_PROVIDER.
 * Contract: providers PROPOSE. Application code (src/lib/truth) validates every proposal against the
 * structured career profile before anything reaches a document.
 */
export interface AIProvider {
  readonly name: string;
  readonly sendsDataExternally: boolean;
  analyzeResume(rawText: string): Promise<Profile>;
  analyzeJob(jdText: string, hints?: { company?: string; title?: string }): Promise<ParsedJD>;
  compareResumeToJob(profile: Profile, jd: ParsedJD, settings: Settings): Promise<MatchResult>;
  rewriteResume(profile: Profile, jd: ParsedJD, match: MatchResult): Promise<BulletRewrite[]>;
  generateCoverLetter(profile: Profile, jd: ParsedJD, match: MatchResult, settings: Settings): Promise<CoverLetter>;
  auditClaims(profile: Profile, claims: string[]): Promise<ClaimCheck[]>;
  // Phase 3
  optimizeLinkedIn(profile: Profile, jd: ParsedJD, match: MatchResult): Promise<never>;
  generateRecruiterMessage(profile: Profile, jd: ParsedJD, match: MatchResult): Promise<never>;
}
