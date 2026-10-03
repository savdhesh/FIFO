import { z } from "zod";

/* ---------- Career profile (structured knowledge base) ---------- */
export const RoleSchema = z.object({
  id: z.string(),
  employer: z.string().default(""),
  client: z.string().default(""),
  title: z.string().default(""),
  location: z.string().default(""),
  startDate: z.string().default(""),
  endDate: z.string().default(""), // "" or "Present" = current
  employmentType: z.string().default(""),
  responsibilities: z.array(z.string()).default([]),
  achievements: z.array(z.string()).default([]),
  technologies: z.array(z.string()).default([]),
  methodologies: z.array(z.string()).default([]),
  protocols: z.array(z.string()).default([]),
  tools: z.array(z.string()).default([]),
  leadership: z.string().default(""),
  teamSize: z.string().default(""),
  technicalOwnership: z.string().default(""),
  architectureOwnership: z.string().default(""),
  customerFacing: z.string().default(""),
});
export type Role = z.infer<typeof RoleSchema>;

export const ProjectSchema = z.object({
  id: z.string(),
  name: z.string().default(""),
  employer: z.string().default(""), // employer/context, optional
  period: z.string().default(""),
  summary: z.string().default(""),
  highlights: z.array(z.string()).default([]),
  technologies: z.array(z.string()).default([]),
});
export type Project = z.infer<typeof ProjectSchema>;

export const SKILL_CATEGORIES = [
  "languages", "verification", "formal", "processor", "protocols", "domains", "tools", "methodologies",
] as const;
export type SkillCategory = (typeof SKILL_CATEGORIES)[number];

export const ProfileSchema = z.object({
  identity: z.object({
    name: z.string().default(""), location: z.string().default(""), email: z.string().default(""),
    phone: z.string().default(""), linkedin: z.string().default(""), github: z.string().default(""),
    portfolio: z.string().default(""),
  }).default({}),
  summary: z.string().default(""),
  roles: z.array(RoleSchema).default([]),
  education: z.array(z.object({
    degree: z.string().default(""), university: z.string().default(""),
    specialization: z.string().default(""), year: z.string().default(""),
  })).default([]),
  skills: z.object({
    languages: z.array(z.string()).default([]), verification: z.array(z.string()).default([]),
    formal: z.array(z.string()).default([]), processor: z.array(z.string()).default([]),
    protocols: z.array(z.string()).default([]), domains: z.array(z.string()).default([]),
    tools: z.array(z.string()).default([]), methodologies: z.array(z.string()).default([]),
  }).default({}),
  certifications: z.array(z.string()).default([]),
  publications: z.array(z.string()).default([]),
  projects: z.array(ProjectSchema).default([]),
  achievements: z.array(z.string()).default([]), // resume-level key achievements / awards, verbatim
});
export type Profile = z.infer<typeof ProfileSchema>;

/* ---------- Job description ---------- */
export const REQ_IMPORTANCE = ["mandatory", "preferred", "implied", "boilerplate", "administrative"] as const;
export type ReqImportance = (typeof REQ_IMPORTANCE)[number];

export const REQ_TYPES = [
  "language", "methodology", "protocol", "processor", "domain", "simulator", "formal-tool", "scripting",
  "debugging", "planning", "coverage", "assertion", "leadership", "architecture", "management",
  "communication", "customer", "tool", "experience", "education", "other",
] as const;
export type ReqType = (typeof REQ_TYPES)[number];

export const RequirementSchema = z.object({
  id: z.string(),
  text: z.string(),
  importance: z.enum(REQ_IMPORTANCE),
  type: z.enum(REQ_TYPES),
  context: z.string().default(""), // source sentence
  terms: z.array(z.string()).default([]), // canonical ontology terms in this requirement
  weight: z.number().default(1),
});
export type Requirement = z.infer<typeof RequirementSchema>;

export const ParsedJDSchema = z.object({
  roleTitle: z.string().default(""),
  company: z.string().default(""),
  location: z.string().default(""),
  seniority: z.enum(["Engineer", "Senior", "Staff", "Principal", "Architect", "Lead", "Manager", "Unspecified"]).default("Unspecified"),
  yearsRequired: z.number().nullable().default(null),
  education: z.string().default(""),
  workAuthorization: z.string().default(""),
  requirements: z.array(RequirementSchema).default([]),
  keywordFrequency: z.record(z.number()).default({}), // canonical term -> mentions in JD
  leadershipExpectations: z.array(z.string()).default([]),
  architectureExpectations: z.array(z.string()).default([]),
  domainExpectations: z.array(z.string()).default([]),
});
export type ParsedJD = z.infer<typeof ParsedJDSchema>;

/* ---------- Match ---------- */
export const MATCH_TYPES = ["exact", "equivalent", "related", "weak", "missing"] as const;
export type MatchType = (typeof MATCH_TYPES)[number];
export type GapClass = "none" | "critical" | "medium" | "minor" | "keyword-only";
export type GapKind = "none" | "real-skill-gap" | "presentation-gap";

export interface EvidenceRef { roleId: string; roleLabel: string; field: string; text: string }

export interface RequirementMatch {
  requirementId: string;
  requirement: string;
  importance: ReqImportance;
  type: ReqType;
  matchType: MatchType;
  confidence: "High" | "Medium" | "Low";
  evidence: EvidenceRef[];
  matchedTerms: { jdTerm: string; profileTerm: string | null; matchType: MatchType; via?: string }[];
  action: string;
  gap: GapClass;
  gapKind: GapKind;
  explanation: string;
  score: number; // 0..1 credit
}

export interface ScoreDetail { key: string; label: string; value: number; weight?: number; why: string[] }

export interface SeniorityResult {
  detected: string;
  level: number; // 1 Engineer .. 5 Architect/Manager
  signals: { signal: string; evidence: string }[];
  weakBullets: { roleId: string; text: string; reason: string }[];
}

export interface MatchResult {
  overall: number;
  scores: ScoreDetail[];
  requirements: RequirementMatch[];
  seniority: SeniorityResult;
  recommendation: { verdict: "STRONG APPLY" | "APPLY" | "APPLY WITH GAPS" | "LOW PRIORITY" | "DO NOT APPLY"; reasons: string[] };
  keywordAnalysis: { term: string; jdMentions: number; inResume: boolean; matchType: MatchType; suggestion?: string; why?: string }[];
  strengths: string[];
  gaps: { term: string; gap: GapClass; kind: GapKind; recommendation: string }[];
}

/* ---------- Truth ---------- */
export type ClaimStatus = "VERIFIED" | "SUPPORTED" | "INFERRED" | "UNSUPPORTED";
export interface ClaimCheck {
  text: string;
  status: ClaimStatus;
  reasons: string[];
  hallucination: boolean;
  unknownTerms: string[];
  unknownMetrics: string[];
  unknownEntities: string[];
  evidence?: string;
}

/* ---------- Tailoring ---------- */
export type ChangeDecision = "pending" | "accepted" | "rejected" | "edited";
export interface ChangeProposal {
  id: string;
  section: "headline" | "summary" | "competencies" | "skills" | "bullet";
  roleId?: string;
  original: string;
  proposed: string;
  finalText?: string; // set when user edits
  reason: string;
  evidence: string;
  status: ClaimStatus;
  hallucination: boolean;
  decision: ChangeDecision;
}

export interface TailoredResume {
  headline: string;
  summary: string;
  competencies: string[];
  skills: { label: string; items: string[] }[];
  experience: { roleId: string; title: string; employer: string; location: string; dates: string; bullets: { text: string; changeId?: string }[] }[];
  education: string[];
  certifications: string[];
  publications: string[];
  identity: Profile["identity"];
}

export const SettingsSchema = z.object({
  targetRole: z.string().default(""),
  country: z.string().default("USA"),
  seniority: z.enum(["Engineer", "Senior", "Staff", "Principal", "Architect", "Lead", "Manager"]).default("Principal"),
  length: z.enum(["1", "2", "3", "4", "cv"]).default("3"),
});
export type Settings = z.infer<typeof SettingsSchema>;
