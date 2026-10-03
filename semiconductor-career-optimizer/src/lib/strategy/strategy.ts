import type { MatchResult, ParsedJD, Profile, Settings } from "../types";
import { gatherFacts, list, show } from "../outreach/shared";
import { matchedJdTerms } from "../tailoring/resume";
import { planInterview } from "../interview/interview";
import { classifyBullet } from "../matching/bullets";

export interface StrategySection { title: string; items: string[] }
export interface Strategy { headline: string; sections: StrategySection[] }

/** Application strategy: what to do with this job, derived from the analysis. No claims, only advice and your own evidence. */
export function planStrategy(profile: Profile, jd: ParsedJD, match: MatchResult, settings: Settings): Strategy {
  const f = gatherFacts(profile, jd, match);
  const verdict = match.recommendation.verdict;
  const critical = match.requirements.filter((r) => r.gap === "critical");
  const real = match.requirements.filter((r) => r.gapKind === "real-skill-gap" && r.gap !== "none");
  const pres = match.requirements.filter((r) => r.gapKind === "presentation-gap");
  const top = matchedJdTerms(jd, match).slice(0, 6).map((m) => show(m.term));
  const sections: StrategySection[] = [];

  const effort = verdict === "STRONG APPLY" ? "Apply this week with the full pack (tailored resume, cover letter, recruiter message)." : verdict === "APPLY" ? "Apply with the full pack; spend extra effort on the gaps below." : verdict === "APPLY WITH GAPS" ? "Worth applying if the role interests you, but tailor carefully and expect screening questions on the gaps." : verdict === "LOW PRIORITY" ? "Apply only if you have a referral or a specific reason; put your time into stronger matches first." : "Skip unless something changes (a referral, a different level, a hiring manager who asks for you).";
  sections.push({ title: "Priority", items: [`${verdict}: ${effort}`, ...match.recommendation.reasons] });

  sections.push({ title: "Positioning", items: [`Lead as a ${f.title} with ${f.years ? `${f.years}+ years in ` : ""}${f.domain}${top.length ? `, strongest on ${list(top.slice(0, 4))}` : ""}.`, `Keep the resume headline on your real title (${f.title}); seniority comes from scope and ownership, not a new title.`] });

  const bullets = profile.roles.flatMap((r) => [...r.responsibilities, ...r.achievements]).filter((b) => ["Strong", "Acceptable"].includes(classifyBullet(b).cls));
  const lead = match.requirements.filter((m) => (m.matchType === "exact" || m.matchType === "equivalent") && m.importance === "mandatory" && m.evidence.some((e) => e.field === "bullet")).slice(0, 4);
  const seen = new Set<string>(); const evidenceLines: string[] = [];
  for (const m of lead) { const e = m.evidence.find((x) => x.field === "bullet")!; if (seen.has(e.text)) continue; seen.add(e.text); evidenceLines.push(`${show(m.requirement)}: “${e.text}” (${e.roleLabel})`); }
  if (evidenceLines.length || bullets.length) sections.push({ title: "Lead with this evidence", items: evidenceLines.length ? evidenceLines : bullets.slice(0, 3).map((b) => `“${b}”`) });

  const mirror = match.requirements.filter((m) => (m.matchType === "exact" || m.matchType === "equivalent") && m.importance !== "preferred").slice(0, 8).map((m) => show(m.requirement));
  sections.push({ title: "Keywords to mirror (you can support these)", items: [mirror.length ? mirror.join(", ") : "No mandatory terms matched directly.", ...(pres.length ? [`Confirm, then add where true (presentation gaps): ${pres.map((p) => show(p.requirement)).join(", ")}.`] : [])] });

  if (real.length) sections.push({ title: "Gaps to handle honestly", items: real.slice(0, 6).map((g) => `${show(g.requirement)} (${g.gap}): ${g.matchType === "related" ? `you have related background (${g.matchedTerms[0]?.via ? show(g.matchedTerms[0].via!) : "adjacent work"}); say that plainly and name a ramp-up plan.` : "no evidence in your profile; do not claim it. Address it in the interview, not on the resume."}`) });
  const no = match.requirements.filter((m) => m.matchType === "missing" || m.matchType === "related").filter((m) => ["simulator", "formal-tool", "tool", "protocol", "language"].includes(m.type)).map((m) => show(m.requirement));
  if (no.length) sections.push({ title: "Do not claim", items: [no.join(", ")] });

  const risks: string[] = [];
  if (match.seniority.level < ({ Engineer: 1, Senior: 2, Staff: 3, Lead: 3, Principal: 4, Architect: 4, Manager: 4 } as Record<string, number>)[jd.seniority]) risks.push(`The job targets ${jd.seniority} level and your resume currently reads ${match.seniority.detected}. Strengthen ownership evidence before applying.`);
  if (jd.yearsRequired && f.years < jd.yearsRequired) risks.push(`The job asks for ${jd.yearsRequired}+ years; your dates add up to ${f.years}.`);
  if (jd.workAuthorization) risks.push(`Work authorization is mentioned ("${jd.workAuthorization.slice(0, 120)}"). This app cannot judge eligibility; check it yourself before applying.`);
  if (jd.location && profile.identity.location && !match.scores.some((s) => s.key === "location" && s.value === 100)) risks.push(`Location: the job is in ${jd.location}; you are in ${profile.identity.location}. Confirm relocation or remote terms.`);
  if (critical.length) risks.push(`Critical gaps: ${critical.map((c) => show(c.requirement)).join(", ")}.`);
  if (risks.length) sections.push({ title: "Risks to check", items: risks });

  sections.push({ title: "Sequence", items: ["1. Review and accept resume changes (only ones that are true), then run the ATS check on the export.", "2. Submit the application with the cover letter.", `3. Within a day, send the connection request and post-application message to the recruiter${jd.company ? ` at ${jd.company}` : ""} (placeholders need real names).`, "4. If you can identify the hiring manager through your own network, send the outreach message.", "5. Prepare the interview topics below; practise the gap answers out loud.", "6. Track status and follow up after about a week of silence."] });

  const plan = planInterview(profile, jd, match, settings);
  sections.push({ title: "Interview focus", items: plan.topics.slice(0, 5).map((t) => `${t.display} (${t.probability}): ${t.reasons[0] ?? ""}`) });
  return { headline: `${verdict} · ${match.overall}/100`, sections };
}
