import type { Profile, SeniorityResult } from "../types";
import { buildIndex, roleBullets, roleLabel, type ProfileIndex } from "../profile-index";
import { classifyBullet } from "./bullets";

const SIGNALS: [string, RegExp][] = [
  ["Verification architecture ownership", /\b(verification architecture|environment architecture|architected|testbench architecture|defined the (?:verification )?(?:architecture|environment))\b/i],
  ["Methodology definition", /\b(methodolog\w+|defined (?:the )?(?:flow|standard|guidelines)|established (?:the )?(?:flow|process|standards)|best practices)\b/i],
  ["Subsystem ownership", /\b(subsystem|full[- ]chip|top[- ]level|sub-system)\b/i],
  ["Cross-IP responsibility", /\b(cross[- ]ip|multi[- ]ip|multiple (?:ips|blocks|projects)|multi-?block|several (?:ips|blocks))\b/i],
  ["Technical leadership", /\b(led|lead|leading|technical lead|drove|guided)\b/i],
  ["Mentorship", /\b(mentor\w*|coach\w*|trained|onboard\w*)\b/i],
  ["Sign-off responsibility", /\b(sign[- ]?off|tape[- ]?out|release)\b/i],
  ["Coverage strategy", /\b(coverage (?:strategy|plan|closure|model)|functional coverage|coverage-driven|coverage closure)\b/i],
  ["Verification planning", /\b(verification plan\w*|test ?plan\w*|vplan|verification strategy)\b/i],
  ["Root-cause debugging", /\b(root[- ]cause|rca|complex debug|triage)\b/i],
  ["Multi-team coordination", /\b(cross[- ]functional|cross[- ]team|multi[- ]team|multi[- ]site|collaborat\w+ with (?:design|architecture|software|firmware)|stakeholders?)\b/i],
  ["Reusable infrastructure", /\b(reusable|reuse|infrastructure|framework|vip|verification ip)\b/i],
  ["Customer-facing technical leadership", /\b(customers?|clients?)\b/i],
  ["Design/verification tradeoff decisions", /\b(trade-?offs?|design reviews?|spec reviews?|architecture reviews?)\b/i],
];
export const LEVEL_NAMES = ["", "Engineer", "Senior Engineer", "Staff Engineer", "Principal Engineer", "Architect / Manager"];

export function titleLevel(title: string): number {
  if (/principal|distinguished|fellow/i.test(title)) return 4;
  if (/architect|manager|director|head/i.test(title)) return 5;
  if (/\bstaff\b/i.test(title)) return 3;
  if (/\blead\b/i.test(title)) return 3;
  if (/senior|\bsr\b/i.test(title)) return 2;
  return 1;
}

export function detectSeniority(profile: Profile, idx: ProfileIndex = buildIndex(profile)): SeniorityResult {
  const signals: SeniorityResult["signals"] = [];
  const bullets = profile.roles.flatMap((r) => roleBullets(r).map((b) => ({ r, b })));
  for (const [name, re] of SIGNALS) {
    const hit = bullets.find(({ b }) => re.test(b));
    if (hit) signals.push({ signal: name, evidence: hit.b });
  }
  const n = signals.length;
  // Content-based level; capped by experience so a short career with big words is not inflated.
  let level = n >= 8 ? 4 : n >= 5 ? 3 : n >= 2 ? 2 : 1;
  // A held title can lift the content-derived level by at most one step.
  const held = Math.max(0, ...profile.roles.map((r) => titleLevel(r.title)));
  level = Math.max(level, Math.min(held, level + 1));
  if (idx.years < 3) level = Math.min(level, 1);
  else if (idx.years < 6) level = Math.min(level, 2);
  else if (idx.years < 9) level = Math.min(level, 3);
  const hasMgmt = bullets.some(({ b }) => /\b(managed|line manag|direct reports|people manag)/i.test(b));
  if (hasMgmt && n >= 6 && idx.years >= 10) level = Math.max(level, 4);

  const weak: SeniorityResult["weakBullets"] = [];
  for (const r of profile.roles) {
    const seen: string[] = [];
    for (const b of roleBullets(r)) {
      const c = classifyBullet(b, seen);
      seen.push(b);
      if (c.cls === "Weak" || c.cls === "Generic" || c.cls === "Duplicate") weak.push({ roleId: r.id, text: b, reason: `${c.cls}: ${c.reason}` });
    }
  }
  return { detected: LEVEL_NAMES[level], level, signals, weakBullets: weak };
}

export { roleLabel };
