import type { Profile, Role } from "../types";
import { buildIndex, roleBullets } from "../profile-index";
import { classifyBullet } from "../matching/bullets";
import { detectSeniority, titleLevel, LEVEL_NAMES } from "../matching/seniority";
import { monthIndex, parseYM } from "../parsing/dates";
import { ontology } from "../ontology/ontology";

export interface Issue { severity: "high" | "medium" | "low"; area: string; message: string; fix: string; evidence?: string }

// First year a technology could plausibly appear on a resume (ratification/first silicon, rounded conservatively).
const INTRODUCED: [string, RegExp, number][] = [
  ["UVM", /\buvm\b/i, 2011], ["RISC-V", /risc-?v/i, 2015], ["CXL", /\bcxl\b/i, 2019], ["PCIe Gen5", /pcie\s*gen\s*5|gen5/i, 2019], ["PCIe Gen6", /pcie\s*gen\s*6|gen6/i, 2022],
  ["DDR5", /\bddr5\b/i, 2020], ["LPDDR5", /lpddr5/i, 2019], ["UCIe", /\bucie\b/i, 2022], ["HBM3", /hbm3/i, 2022], ["USB4", /usb\s*4\b|usb4/i, 2019], ["ISO 26262", /iso\s*26262/i, 2011],
  ["CHI", /\bchi\b(?!ld)/i, 2013], ["AXI5", /axi5/i, 2020], ["LLM", /\bllms?\b/i, 2020], ["Gen AI", /generative ai|genai/i, 2022],
];
const BUZZ = /\b(results-driven|dynamic|passionate|hardworking|team player|self-starter|go-getter|synerg\w+|rockstar|ninja|detail-oriented)\b/i;

const endYear = (r: Role) => parseYM(r.endDate || "Present", true)?.y;

export function auditCredibility(profile: Profile, now = new Date()): Issue[] {
  const idx = buildIndex(profile);
  const issues: Issue[] = [];
  const add = (i: Issue) => issues.push(i);
  const sen = detectSeniority(profile, idx);

  // 1. Skills listed but never demonstrated
  const SKIP = new Set(["Git", "Linux", "Makefile", "Jenkins", "Bash"]);
  const undemonstrated = new Set<string>();
  for (const [cat, vals] of Object.entries(profile.skills)) for (const v of vals) for (const h of ontology.findTerms(v)) {
    if (SKIP.has(h.canonical)) continue;
    // A bullet showing a child term ("Ethernet MAC verification") demonstrates the parent ("Ethernet").
    const family = [h.canonical, ...ontology.entries.filter((e) => e.parent?.toLowerCase() === h.canonical.toLowerCase()).map((e) => e.canonical)];
    if (!family.some((t) => (idx.evidence.get(t) ?? []).some((e) => e.kind === "bullet"))) undemonstrated.add(h.canonical);
    void cat;
  }
  if (undemonstrated.size) add({ severity: "medium", area: "Skills", message: `Listed in skills but no role bullet demonstrates: ${[...undemonstrated].slice(0, 8).join(", ")}${undemonstrated.size > 8 ? "…" : ""}.`, fix: "Add a bullet that shows real use of each, or remove the skill. Recruiters and interviewers test skill-list claims." });

  // 2. Title vs content
  const held = Math.max(0, ...profile.roles.slice(0, 2).map((r) => titleLevel(r.title)));
  if (held - sen.level >= 2) add({ severity: "high", area: "Seniority", message: `Your recent title reads ${LEVEL_NAMES[held]} but the bullets show ${sen.detected}-level scope (${sen.signals.length} seniority signals).`, fix: "Add evidence of ownership, methodology, planning, mentoring or sign-off where it is true. Do not reword to sound senior." });
  if (sen.level - held >= 2 && held > 0) add({ severity: "low", area: "Seniority", message: `Your bullets show ${sen.detected}-level scope under a ${LEVEL_NAMES[held]} title.`, fix: "Fine to keep, but make sure the scope is described clearly; it supports a move up." });
  if (sen.level >= 3 && !sen.signals.some((s) => /planning|sign-off|methodology/i.test(s.signal))) add({ severity: "medium", area: "Seniority", message: "Staff/Principal-level content normally shows planning, sign-off or methodology ownership; none is stated.", fix: "If you did this work, add it to the relevant role." });

  // 3. Dates
  const spans = profile.roles.map((r) => ({ r, a: parseYM(r.startDate), b: parseYM(r.endDate || "Present", true) }));
  for (const { r, a, b } of spans) {
    if (!a) add({ severity: "medium", area: "Dates", message: `${r.title || "A role"} has no readable start date.`, fix: "Use a month and year, e.g. Jan 2020." });
    else if (b && monthIndex(b) < monthIndex(a)) add({ severity: "high", area: "Dates", message: `${r.title} ends before it starts (${r.startDate} → ${r.endDate}).`, fix: "Correct the dates." });
    else if (a && a.y > now.getFullYear() + 1) add({ severity: "high", area: "Dates", message: `${r.title} starts in the future (${r.startDate}).`, fix: "Correct the dates." });
  }
  const dated = spans.filter((s) => s.a && s.b).sort((x, y) => monthIndex(x.a!) - monthIndex(y.a!));
  for (let i = 1; i < dated.length; i++) {
    const prev = dated[i - 1], cur = dated[i];
    const overlap = monthIndex(prev.b!) - monthIndex(cur.a!);
    const sameEmployer = prev.r.employer && prev.r.employer.toLowerCase() === cur.r.employer.toLowerCase();
    if (overlap > 3 && !sameEmployer) add({ severity: "medium", area: "Dates", message: `Overlap of ${overlap} months between ${prev.r.employer || prev.r.title} and ${cur.r.employer || cur.r.title}.`, fix: "Check the dates, or note part-time/contract work explicitly." });
    const gap = monthIndex(cur.a!) - monthIndex(prev.b!) - 1;
    if (gap > 6) add({ severity: "low", area: "Dates", message: `${gap}-month gap between ${prev.r.employer || prev.r.title} and ${cur.r.employer || cur.r.title}.`, fix: "Be ready to explain it; a one-line note on the resume is acceptable." });
  }

  // 4. Stated years vs computed
  const m = profile.summary.match(/(\d{1,2})\+?\s+years/i);
  if (m && Math.abs(+m[1] - idx.years) > 1.5) add({ severity: "high", area: "Experience", message: `Summary says ${m[1]} years, role dates add up to ${idx.years}.`, fix: "Use the figure your dates support." });

  // 5. Quantification and bullet quality
  const bullets = profile.roles.flatMap(roleBullets);
  if (bullets.length >= 6 && sen.level >= 3 && !bullets.some((b) => /\d+\s?%|\b\d+(?:\.\d+)?\s?x\b|\b\d+\s+(?:engineers?|blocks?|projects?|tape-?outs?)\b/i.test(b))) add({ severity: "medium", area: "Impact", message: "No measurable result appears anywhere in your experience.", fix: "Add real numbers you can defend (team size, blocks, tape-outs, regression time). Never estimate to fill the gap." });
  const weak = sen.weakBullets.length;
  if (weak >= 3) add({ severity: "medium", area: "Bullets", message: `${weak} weak, generic or duplicate bullets.`, fix: "Rewrite as action + technical scope + ownership (+ result if you have one).", evidence: sen.weakBullets[0].text });
  for (const r of profile.roles) {
    const n = roleBullets(r).length, a = parseYM(r.startDate), b = parseYM(r.endDate || "Present", true);
    if (a && b && monthIndex(b) - monthIndex(a) >= 24 && n <= 1) add({ severity: "medium", area: "Bullets", message: `${r.title || "A role"} at ${r.employer || "?"} spans ${Math.round((monthIndex(b) - monthIndex(a)) / 12)} years but has ${n} bullet(s).`, fix: "Add the main projects and your ownership." });
  }
  if (BUZZ.test(profile.summary)) add({ severity: "low", area: "Wording", message: `Summary uses filler wording ("${profile.summary.match(BUZZ)![0]}").`, fix: "Replace with technical scope and evidence." });
  const led = profile.roles.filter((r) => /\b(led|managed)\b/i.test(roleBullets(r).join(" ")) && !/\d/.test(r.teamSize) && !/team of \d+|\d+ engineers/i.test(roleBullets(r).join(" ")));
  if (led.length) add({ severity: "low", area: "Leadership", message: `Leadership is claimed without scope in ${led.length} role(s).`, fix: "State team size or what you owned, if you can." });

  // 6. Technology era
  for (const r of profile.roles) {
    const ey = endYear(r); if (!ey) continue;
    const text = roleBullets(r).concat(r.technologies, r.tools, r.protocols, r.methodologies).join(" ");
    for (const [name, re, year] of INTRODUCED) if (re.test(text) && ey < year) add({ severity: "medium", area: "Technology era", message: `${name} appears in ${r.title || "a role"} that ended in ${ey}, before it existed (about ${year}).`, fix: "Check the dates or the technology; interviewers notice anachronisms." });
  }
  const order = { high: 0, medium: 1, low: 2 } as const;
  return issues.sort((a, b) => order[a.severity] - order[b.severity]);
}
