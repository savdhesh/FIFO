/**
 * Evaluation harness: scores the deterministic engines against eval/gold/gold.json.
 * Every metric is reported per split (dev = tunable, holdout = never tuned against).
 *   npm run eval            -> eval/report/report.md + report.json
 */
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { parseResumeHeuristic } from "../src/lib/parsing/resume-parser";
import { parseJobDescriptionHeuristic } from "../src/lib/parsing/jd-parser";
import { analyzeMatch } from "../src/lib/matching/matcher";
import { checkClaim } from "../src/lib/truth/truth";
import { ontology } from "../src/lib/ontology/ontology";
import { buildIndex } from "../src/lib/profile-index";
import { DEMO_RESUME_TEXT } from "../src/lib/demo";
import type { ClaimStatus, MatchType, ParsedJD, Profile } from "../src/lib/types";

type Split = "dev" | "holdout";
interface GoldRole { title: string; employer: string; start: string; end: string; bullets: number }
interface GoldResume { id: string; split: Split; name: string; email: string; roles: GoldRole[] }
interface GoldJD { id: string; split: Split; title: string; company: string; seniority: string; years: number | null; requirements: { skill: string; importance: string }[] }
interface GoldPair { id: string; resume: string; jd: string; split: Split; verdicts: string[]; critical: string[]; labels: Record<string, MatchType> }
interface GoldClaim { profile: string; split: Split; text: string; gold: ClaimStatus[] }
interface Gold { version: number; resumes: GoldResume[]; jds: GoldJD[]; pairs: GoldPair[]; claims: GoldClaim[] }

const ROOT = path.resolve(__dirname);
const gold: Gold = JSON.parse(fs.readFileSync(path.join(ROOT, "gold/gold.json"), "utf8"));
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const resumeText = (id: string) => (id === "demo" ? DEMO_RESUME_TEXT : read(`gold/resumes/${id}.txt`));
const jdText = (id: string) => read(`gold/jds/${id}.txt`);

/* ---------- tallies ---------- */
class Tally {
  ok = 0; n = 0;
  add(pass: boolean) { this.n++; if (pass) this.ok++; }
  get rate() { return this.n ? this.ok / this.n : null; }
  toJSON() { return { ok: this.ok, n: this.n, rate: this.rate }; }
}
const SPLITS: Split[] = ["dev", "holdout"];
const per = () => ({ dev: new Tally(), holdout: new Tally() });
const failures: Record<Split, string[]> = { dev: [], holdout: [] };
const fail = (s: Split, area: string, msg: string) => failures[s].push(`[${area}] ${msg}`);

const norm = (s: string) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/* ---------- strict ontology mapping: the alias must cover the whole skill phrase ---------- */
const ontologyGaps = new Map<string, string>(); // skill -> reason
function canon(skill: string): string | null {
  const hits = ontology.findTerms(skill);
  if (hits.length === 1 && norm(hits[0].surface) === norm(skill)) return hits[0].canonical;
  const e = ontology.get(skill);
  if (e) return e.canonical;
  ontologyGaps.set(skill, hits.length ? `partial: matched only "${hits.map((h) => h.surface).join(", ")}"` : "no ontology term");
  return null;
}

/* ---------- dates ---------- */
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
function normDate(s: string, isEnd: boolean): string {
  const t = (s ?? "").trim();
  if (isEnd && (t === "" || /present|current|now|ongoing|date/i.test(t))) return "Present";
  if (/^\d{4}$/.test(t)) return t;
  let m = t.match(/^(\d{4})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}`;
  m = t.match(/^([a-z]{3})[a-z]*\.?\s*'?,?\s*(\d{4}|\d{2})$/i);
  if (m && MONTHS.includes(m[1].toLowerCase())) {
    const y = m[2].length === 2 ? `20${m[2]}` : m[2];
    return `${y}-${String(MONTHS.indexOf(m[1].toLowerCase()) + 1).padStart(2, "0")}`;
  }
  m = t.match(/^(\d{1,2})[/.](\d{4})$/);
  if (m) return `${m[2]}-${m[1].padStart(2, "0")}`;
  return t;
}

/* ---------- 1. resume parsing ---------- */
const P = { name: per(), email: per(), roleFound: per(), title: per(), employer: per(), start: per(), end: per(), bullets: per(), spurious: { dev: 0, holdout: 0 } };
const profiles = new Map<string, Profile>();
function profileOf(id: string): Profile {
  if (!profiles.has(id)) profiles.set(id, parseResumeHeuristic(resumeText(id)));
  return profiles.get(id)!;
}

for (const g of gold.resumes) {
  const s = g.split, p = profileOf(g.id);
  const nameOk = norm(p.identity.name) === norm(g.name);
  P.name[s].add(nameOk); if (!nameOk) fail(s, "parse", `${g.id} name: got "${p.identity.name}", want "${g.name}"`);
  const emailOk = p.identity.email.toLowerCase() === g.email.toLowerCase();
  P.email[s].add(emailOk); if (!emailOk) fail(s, "parse", `${g.id} email: got "${p.identity.email}", want "${g.email}"`);

  // Order-insensitive role alignment: best remaining engine role by title/employer/start agreement.
  const pool = p.roles.map((r) => ({
    r, title: norm(r.title), employer: norm(r.employer), start: normDate(r.startDate, false), end: normDate(r.endDate, true),
    bullets: r.responsibilities.length + r.achievements.length,
  }));
  const used = new Set<number>();
  for (const gr of g.roles) {
    const want = { title: norm(gr.title), employer: norm(gr.employer), start: gr.start, end: gr.end };
    let best = -1, bestScore = 0;
    pool.forEach((c, i) => {
      if (used.has(i)) return;
      const sc = (c.title === want.title ? 2 : 0) + (c.employer === want.employer ? 2 : 0) + (c.start === want.start ? 1 : 0)
        + (c.employer && want.employer.includes(c.employer) ? 0.5 : 0) + (c.title && want.title.includes(c.title) ? 0.5 : 0);
      if (sc > bestScore) { bestScore = sc; best = i; }
    });
    const label = `${g.id} role "${gr.title} @ ${gr.employer}"`;
    P.roleFound[s].add(best >= 0);
    if (best < 0) {
      fail(s, "parse", `${label}: not found`);
      for (const k of ["title", "employer", "start", "end", "bullets"] as const) P[k][s].add(false);
      continue;
    }
    used.add(best);
    const c = pool[best];
    const checks: [keyof typeof want | "bullets", boolean, string, string][] = [
      ["title", c.title === want.title, c.r.title, gr.title],
      ["employer", c.employer === want.employer, c.r.employer, gr.employer],
      ["start", c.start === want.start, c.r.startDate, gr.start],
      ["end", c.end === want.end, c.r.endDate, gr.end],
      ["bullets", c.bullets === gr.bullets, String(c.bullets), String(gr.bullets)],
    ];
    for (const [k, ok, got, exp] of checks) {
      P[k][s].add(ok);
      if (!ok) fail(s, "parse", `${label} ${k}: got "${got}", want "${exp}"`);
    }
  }
  const extra = pool.length - used.size;
  P.spurious[s] += extra;
  if (extra > 0) fail(s, "parse", `${g.id}: ${extra} spurious role(s): ${pool.filter((_, i) => !used.has(i)).map((c) => `"${c.r.title} @ ${c.r.employer}"`).join(", ")}`);
}

/* ---------- 2. JD parsing ---------- */
const J = { title: per(), company: per(), seniority: per(), years: per(), recall: per(), precision: per(), importance: per() };
const SKIP_TYPES = new Set(["experience", "education"]);
const RANK: Record<string, number> = { mandatory: 3, implied: 2, preferred: 1, boilerplate: 0, administrative: 0 };
const jds = new Map<string, ParsedJD>();
const importanceConfusion: Record<string, Record<string, number>> = {};

for (const g of gold.jds) {
  const s = g.split, jd = parseJobDescriptionHeuristic(jdText(g.id));
  jds.set(g.id, jd);
  const cmp = (k: "title" | "company" | "seniority" | "years", got: unknown, want: unknown, ok: boolean) => {
    J[k][s].add(ok); if (!ok) fail(s, "jd", `${g.id} ${k}: got "${got}", want "${want}"`);
  };
  cmp("title", jd.roleTitle, g.title, norm(jd.roleTitle) === norm(g.title));
  cmp("company", jd.company, g.company, norm(jd.company) === norm(g.company));
  cmp("seniority", jd.seniority, g.seniority, jd.seniority === g.seniority);
  cmp("years", jd.yearsRequired, g.years, jd.yearsRequired === g.years);

  // Engine term -> strongest importance it was given.
  const engineImp = new Map<string, string>();
  for (const r of jd.requirements) {
    if (SKIP_TYPES.has(r.type)) continue;
    for (const t of r.terms) if (!engineImp.has(t) || RANK[r.importance] > RANK[engineImp.get(t)!]) engineImp.set(t, r.importance);
  }
  const goldCanon = new Set<string>();
  const seen = new Map<string, string>();
  for (const req of g.requirements) {
    const c = canon(req.skill);
    if (!c) { J.recall[s].add(false); fail(s, "jd", `${g.id} requirement "${req.skill}": not representable in ontology`); continue; }
    if (seen.has(c)) fail(s, "jd", `${g.id}: "${req.skill}" and "${seen.get(c)}" collapse to one ontology term (${c})`);
    seen.set(c, req.skill); goldCanon.add(c);
    const got = engineImp.get(c);
    J.recall[s].add(!!got);
    if (!got) { fail(s, "jd", `${g.id} requirement "${req.skill}" (${c}): not extracted`); continue; }
    if (req.importance === "mandatory" || req.importance === "preferred") {
      const ok = got === req.importance;
      J.importance[s].add(ok);
      (importanceConfusion[req.importance] ??= {})[got] = ((importanceConfusion[req.importance] ??= {})[got] ?? 0) + 1;
      if (!ok) fail(s, "jd", `${g.id} "${req.skill}" importance: got ${got}, want ${req.importance}`);
    }
  }
  for (const t of engineImp.keys()) {
    const ok = goldCanon.has(t);
    J.precision[s].add(ok);
    if (!ok) fail(s, "jd", `${g.id}: extracted "${t}" (${engineImp.get(t)}) not in gold requirements`);
  }
}

/* ---------- 3. matching ---------- */
const STRENGTH: Record<string, number> = { exact: 4, equivalent: 3, related: 2, weak: 1, missing: 0, "not-extracted": 0, unmapped: 0 };
const M = {
  e2e: per(), isolated: per(), overclaimE2E: per(), overclaimIso: per(), underclaimIso: per(), verdict: per(),
  critTP: { dev: 0, holdout: 0 }, critFP: { dev: 0, holdout: 0 }, critFN: { dev: 0, holdout: 0 },
};
const confusion: Record<string, Record<string, number>> = {};
const pairOut: Record<string, unknown>[] = [];

for (const g of gold.pairs) {
  const s = g.split, profile = profileOf(g.resume), jd = jds.get(g.jd) ?? parseJobDescriptionHeuristic(jdText(g.jd));
  const idx = buildIndex(profile);
  const res = analyzeMatch(profile, jd);
  const e2eType = new Map<string, MatchType>();
  for (const row of res.requirements) for (const mt of row.matchedTerms) if (!e2eType.has(mt.jdTerm)) e2eType.set(mt.jdTerm, mt.matchType);

  for (const [skill, want] of Object.entries(g.labels)) {
    const c = canon(skill);
    const iso = c ? ontology.relate(c, idx.terms).type : "unmapped";
    const e2e = c ? e2eType.get(c) ?? "not-extracted" : "unmapped";
    (confusion[want] ??= {})[iso] = ((confusion[want] ??= {})[iso] ?? 0) + 1;
    M.e2e[s].add(e2e === want);
    if (c) {
      M.isolated[s].add(iso === want);
      M.overclaimIso[s].add(STRENGTH[iso] > STRENGTH[want]);
      M.underclaimIso[s].add(STRENGTH[iso] < STRENGTH[want]);
    }
    M.overclaimE2E[s].add(STRENGTH[e2e] > STRENGTH[want]);
    if (iso !== want) fail(s, "match", `${g.id} ${g.resume}×${g.jd} "${skill}": engine ${iso}${STRENGTH[iso] > STRENGTH[want] ? " (OVERCLAIM)" : ""}, gold ${want}`);
    else if (e2e !== want) fail(s, "match", `${g.id} "${skill}": ontology right (${iso}) but end-to-end ${e2e}`);
  }

  const goldCrit = new Set(g.critical.map((k) => canon(k) ?? `?${k}`));
  const engCrit = new Set(res.requirements.filter((r) => r.gap === "critical").map((r) => r.requirement));
  for (const c of engCrit) { if (goldCrit.has(c)) M.critTP[s]++; else { M.critFP[s]++; fail(s, "gap", `${g.id}: engine flagged "${c}" critical; gold does not`); } }
  for (const c of goldCrit) if (!engCrit.has(c)) { M.critFN[s]++; fail(s, "gap", `${g.id}: gold critical "${c}" not flagged critical by engine`); }

  const vOk = g.verdicts.includes(res.recommendation.verdict);
  M.verdict[s].add(vOk);
  if (!vOk) fail(s, "verdict", `${g.id}: got ${res.recommendation.verdict} (${res.overall}), acceptable ${g.verdicts.join(" / ")}`);
  pairOut.push({ id: g.id, split: s, verdict: res.recommendation.verdict, overall: res.overall, acceptable: g.verdicts, engineCritical: [...engCrit] });
}

/* ---------- 4. truth ---------- */
const TRANK: Record<ClaimStatus, number> = { VERIFIED: 3, SUPPORTED: 2, INFERRED: 1, UNSUPPORTED: 0 };
const T = { exact: per(), blockedRecall: per(), falseBlock: per(), overclaim: per() };
const truthConfusion: Record<string, Record<string, number>> = {};
for (const c of gold.claims) {
  const s = c.split, idx = buildIndex(profileOf(c.profile));
  const got = checkClaim(c.text, { index: idx });
  const ok = c.gold.includes(got.status);
  T.exact[s].add(ok);
  const key = c.gold.join("|");
  (truthConfusion[key] ??= {})[got.status] = ((truthConfusion[key] ??= {})[got.status] ?? 0) + 1;
  const goldBlocked = c.gold.every((x) => x === "UNSUPPORTED"), goldAllowed = !c.gold.includes("UNSUPPORTED");
  if (goldBlocked) T.blockedRecall[s].add(got.status === "UNSUPPORTED");
  if (goldAllowed) T.falseBlock[s].add(got.status === "UNSUPPORTED");
  const over = TRANK[got.status] > Math.max(...c.gold.map((x) => TRANK[x]));
  T.overclaim[s].add(over);
  if (!ok) fail(s, "truth", `${c.profile}: "${c.text.slice(0, 90)}${c.text.length > 90 ? "…" : ""}" got ${got.status}${over ? " (LEAK)" : ""}, gold ${c.gold.join("/")}${got.reasons.length ? ` — ${got.reasons[0]}` : ""}`);
}

/* ---------- report ---------- */
const fmt = (t: Tally) => (t.rate === null ? "—" : `${(t.rate * 100).toFixed(1)}% (${t.ok}/${t.n})`);
const row = (label: string, x: Record<Split, Tally>, note = "") => `| ${label} | ${fmt(x.dev)} | ${fmt(x.holdout)} | ${note} |`;
const prf = (s: Split) => {
  const tp = M.critTP[s], fp = M.critFP[s], fn = M.critFN[s];
  const p = tp + fp ? tp / (tp + fp) : null, r = tp + fn ? tp / (tp + fn) : null;
  const f = (x: number | null, a: number, b: number) => (x === null ? "—" : `${(x * 100).toFixed(1)}% (${a}/${b})`);
  return { p: f(p, tp, tp + fp), r: f(r, tp, tp + fn), raw: { tp, fp, fn, precision: p, recall: r } };
};
let goldCommit = "unknown";
try { goldCommit = execSync(`git log -1 --format=%h -- ${path.join(ROOT, "gold")}`, { cwd: ROOT }).toString().trim(); } catch { /* not a git checkout */ }
let engineCommit = "unknown";
try {
  engineCommit = execSync("git rev-parse --short HEAD", { cwd: ROOT }).toString().trim();
  if (execSync("git status --porcelain -- ../src", { cwd: ROOT }).toString().trim()) engineCommit += " + uncommitted engine changes";
} catch { /* not a git checkout */ }

const H = "| Metric | dev | holdout | Note |\n|---|---|---|---|";
const lines = [
  `# Evaluation report`,
  ``,
  `Gold set v${gold.version} (last changed in \`${goldCommit}\`), engine at \`${engineCommit}\`. Generated by \`npm run eval\`.`,
  `dev = may be tuned against. holdout = never tuned against; a fix motivated by a holdout failure contaminates it.`,
  ``,
  `## Resume parsing (${gold.resumes.length} resumes)`,
  H,
  row("Name", P.name), row("Email", P.email), row("Role found", P.roleFound, "order-insensitive alignment"),
  row("Title", P.title), row("Employer", P.employer), row("Start date", P.start), row("End date", P.end), row("Bullet count (exact)", P.bullets),
  `| Spurious roles | ${P.spurious.dev} | ${P.spurious.holdout} | extra roles the engine invented |`,
  ``,
  `## JD parsing (${gold.jds.length} JDs)`,
  H,
  row("Title", J.title), row("Company", J.company), row("Seniority", J.seniority), row("Years required", J.years),
  row("Requirement recall", J.recall, "gold skill extracted as a term"),
  row("Requirement precision", J.precision, "extracted term is a gold requirement"),
  row("Importance (mandatory/preferred)", J.importance),
  ``,
  `## Matching (${gold.pairs.length} pairs, ${Object.values(gold.pairs).reduce((a, p) => a + Object.keys(p.labels).length, 0)} labels)`,
  H,
  row("Match type, ontology isolated", M.isolated, "relate(gold term, parsed profile)"),
  row("Match type, end to end", M.e2e, "includes JD extraction misses"),
  row("Overclaim rate, isolated", M.overclaimIso, "engine stronger than gold: dangerous"),
  row("Overclaim rate, end to end", M.overclaimE2E),
  row("Underclaim rate, isolated", M.underclaimIso, "engine weaker than gold: lost credit"),
  `| Critical-gap precision | ${prf("dev").p} | ${prf("holdout").p} | engine gap = critical |`,
  `| Critical-gap recall | ${prf("dev").r} | ${prf("holdout").r} | gold = mandatory missing/weak |`,
  row("Verdict in acceptable set", M.verdict),
  ``,
  `### Match-type confusion (rows = gold, cols = engine, ontology isolated, both splits)`,
  `| gold \\ engine | exact | equivalent | related | weak | missing |`, `|---|---|---|---|---|---|`,
  ...["exact", "equivalent", "related", "weak", "missing"].map((g) => `| ${g} | ${["exact", "equivalent", "related", "weak", "missing"].map((e) => confusion[g]?.[e] ?? 0).join(" | ")} |`),
  ``,
  `## Truth protection (${gold.claims.length} claims)`,
  H,
  row("Status in gold set", T.exact, "4-class"),
  row("Blocked recall", T.blockedRecall, "UNSUPPORTED claims caught: safety-critical"),
  row("False-block rate", T.falseBlock, "true claims wrongly blocked"),
  row("Leak rate", T.overclaim, "engine status stronger than any gold status"),
  ``,
  `### Truth confusion (rows = gold, cols = engine)`,
  `| gold \\ engine | VERIFIED | SUPPORTED | INFERRED | UNSUPPORTED |`, `|---|---|---|---|---|`,
  ...Object.entries(truthConfusion).map(([g, m]) => `| ${g} | ${(["VERIFIED", "SUPPORTED", "INFERRED", "UNSUPPORTED"] as const).map((e) => m[e] ?? 0).join(" | ")} |`),
  ``,
  `## Verdicts`,
  `| Pair | Split | Engine | Score | Acceptable |`, `|---|---|---|---|---|`,
  ...pairOut.map((p) => `| ${p.id} | ${p.split} | ${p.verdict} | ${p.overall} | ${(p.acceptable as string[]).join(" / ")} |`),
  ``,
  `## Ontology gaps (gold skills the vocabulary cannot represent)`,
  ...(ontologyGaps.size ? [...ontologyGaps].map(([k, v]) => `- ${k} — ${v}`) : ["- none"]),
  ``,
  ...SPLITS.flatMap((s) => [`## Failures: ${s} (${failures[s].length})`, ...(failures[s].length ? failures[s].map((f) => `- ${f}`) : ["- none"]), ``]),
];

const ser = (o: Record<string, unknown>) => JSON.parse(JSON.stringify(o));
const json = {
  goldVersion: gold.version, goldCommit, engineCommit,
  parse: ser(P), jd: ser(J), importanceConfusion,
  match: { ...ser(M), critical: { dev: prf("dev").raw, holdout: prf("holdout").raw }, confusion, pairs: pairOut },
  truth: ser(T), truthConfusion, ontologyGaps: Object.fromEntries(ontologyGaps), failures,
};
const outDir = process.env.EVAL_OUT ? path.resolve(process.env.EVAL_OUT) : path.join(ROOT, "report");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "report.md"), lines.join("\n") + "\n");
fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(json, null, 2) + "\n");

// Console summary: headline numbers only.
const head = (l: string, x: Record<Split, Tally>) => console.log(`${l.padEnd(34)} dev ${fmt(x.dev).padEnd(18)} holdout ${fmt(x.holdout)}`);
head("parse: role found", P.roleFound); head("parse: dates (start)", P.start); head("parse: bullets", P.bullets);
head("jd: requirement recall", J.recall); head("jd: requirement precision", J.precision); head("jd: importance", J.importance);
head("match: type (isolated)", M.isolated); head("match: overclaim (isolated)", M.overclaimIso); head("match: verdict", M.verdict);
head("truth: blocked recall", T.blockedRecall); head("truth: false-block", T.falseBlock); head("truth: leak", T.overclaim);
console.log(`report: ${path.relative(process.cwd(), path.join(outDir, "report.md"))}`);
