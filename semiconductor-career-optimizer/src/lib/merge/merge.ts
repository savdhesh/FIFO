import { ProfileSchema, type Profile, type Role, type Project } from "../types";
import { jaccard } from "../matching/bullets";
import { ontology } from "../ontology/ontology";
import { monthIndex, parseYM, totalYears } from "../parsing/dates";

export interface SourceResume { id: string; name: string; profile: Profile }

export type MergeKind =
  | "role-new" | "bullet-new" | "bullet-detail" | "terms-new" | "field-fill" | "conflict" | "skill-new"
  | "edu-new" | "cert-new" | "pub-new" | "project-new" | "achievement-new" | "identity-fill";

export interface MergeItem {
  id: string; kind: MergeKind; group: string; // group label shown in UI (role label / section)
  label: string; source: string; current?: string; proposed: string; note?: string;
  safe: boolean; // additions only: nothing replaced, nothing contradicted
  decision: "pending" | "accepted" | "rejected";
  payload: any;
}

export interface MergeAnalysis {
  sources: { name: string; roles: number; bullets: number; years: number; latest: string }[];
  gaps: { from: string; to: string; months: number }[];
  onlyInOlder: string[]; // ontology terms that appear in older resumes but not in the base profile
  baseName: string;
}
export interface MergeReport { base: Profile; items: MergeItem[]; analysis: MergeAnalysis }

const STOP = /\b(pvt|ltd|limited|inc|incorporated|corp|corporation|llc|gmbh|co|company|technologies|technology|semiconductors?|systems|microsystems|sdn|bhd|india|usa|the)\b/g;
const empKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(STOP, " ").replace(/\s+/g, " ").trim();
function sameEmployer(a: string, b: string) {
  const x = empKey(a), y = empKey(b);
  if (!x || !y) return false;
  return x === y || (x.length >= 4 && y.length >= 4 && (x.includes(y) || y.includes(x))) || jaccard(x, y) >= 0.6;
}
const span = (r: Role): [number, number] | null => {
  const a = parseYM(r.startDate), b = parseYM(r.endDate || "Present", true);
  return a && b ? [monthIndex(a), monthIndex(b)] : null;
};
const overlap = (a: Role, b: Role) => {
  const x = span(a), y = span(b);
  if (!x || !y) return false;
  const inter = Math.min(x[1], y[1]) - Math.max(x[0], y[0]);
  return inter >= 0 || Math.abs(x[0] - y[0]) <= 6;
};
const roleLabel = (r: Role) => [r.title || "Role", r.employer].filter(Boolean).join(" @ ");
const nums = (s: string) => (s.match(/\d+(?:\.\d+)?\s?%?/g) ?? []).map((x) => x.replace(/\s/g, "")).sort().join(",");
const termSet = (s: string) => new Set(ontology.findTerms(s).map((h) => h.canonical));

const sameStart = (a: Role, b: Role) => { const x = span(a), y = span(b); return !!x && !!y && Math.abs(x[0] - y[0]) <= 1; };
function matchRole(base: Role[], r: Role): Role | undefined {
  return base.find((b) => (sameEmployer(b.employer, r.employer) && overlap(b, r)) || (!b.employer && !r.employer && b.title && jaccard(b.title, r.title) > 0.6 && overlap(b, r)))
    // The same job written differently in two resumes ("Architect, Design & Verification" vs "Consultant, WaferCo"): same start month.
    ?? base.find((b) => sameStart(b, r) && (jaccard(b.title, r.title) > 0.3 || !b.employer || !r.employer || sameEmployer(b.employer, r.employer) || overlapSpan(b, r) >= 6));
}
const overlapSpan = (a: Role, b: Role) => { const x = span(a), y = span(b); return x && y ? Math.min(x[1], y[1]) - Math.max(x[0], y[0]) : -1; };
const tokens = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9+#]{3,}/g) ?? []);
/** Share of the shorter bullet's words found in the longer one: catches reworded copies that Jaccard misses. */
function containment(a: string, b: string) { const x = tokens(a), y = tokens(b); let i = 0; for (const w of x) if (y.has(w)) i++; return i / Math.max(1, Math.min(x.size, y.size)); }
const skillKey = (v: string) => v.replace(/\s*\([^)]*\)/, "").toLowerCase().replace(/[^a-z0-9+#]/g, "");
const uniKey = (u: string) => u.toLowerCase().replace(/[^\p{L}0-9]/gu, "");

export function mergeResumes(sources: SourceResume[], currentBase?: Profile | null): MergeReport {
  if (!sources.length && !currentBase) throw new Error("Upload at least one resume");
  // Base: the existing master profile, otherwise the source with the most recent role (ties: most roles).
  const latestOf = (p: Profile) => Math.max(0, ...p.roles.map((r) => { const e = parseYM(r.endDate || "Present", true); return e ? monthIndex(e) : 0; }));
  let baseName = "your current profile";
  let order = [...sources];
  let base: Profile;
  if (currentBase) base = structuredClone(currentBase);
  else {
    order.sort((a, b) => latestOf(b.profile) - latestOf(a.profile) || b.profile.roles.length - a.profile.roles.length);
    base = structuredClone(order[0].profile); baseName = order[0].name; order = order.slice(1);
  }
  const work = structuredClone(base) as Profile; // virtual state with every proposal applied, so later sources dedupe against earlier ones
  const items: MergeItem[] = [];
  let n = 0;
  const add = (i: Omit<MergeItem, "id" | "decision">) => items.push({ ...i, id: `m${++n}`, decision: "pending" });
  const onlyInOlder = new Set<string>();
  const baseTerms = termSet(JSON.stringify(base));

  for (const src of order) {
    const sp = src.profile;
    // identity: fill blanks, flag disagreements
    for (const k of Object.keys(sp.identity) as (keyof Profile["identity"])[]) {
      const v = sp.identity[k], cur = work.identity[k];
      if (v && !cur) { work.identity[k] = v; add({ kind: "identity-fill", group: "Identity", label: k, source: src.name, proposed: v, safe: true, payload: { field: k, value: v } }); }
      else if (v && cur && v.trim().toLowerCase() !== cur.trim().toLowerCase() && ["email", "phone", "location"].includes(k))
        add({ kind: "conflict", group: "Identity", label: k, source: src.name, current: cur, proposed: v, note: "Differs between resumes. Keep the one that is current.", safe: false, payload: { scope: "identity", field: k, value: v } });
    }

    for (const r of sp.roles) {
      const m = matchRole(work.roles, r);
      if (!m) {
        const copy = { ...structuredClone(r), id: r.id || `r${Date.now().toString(36)}${n}` };
        work.roles.push(copy);
        add({ kind: "role-new", group: roleLabel(r), label: "Role not in current profile", source: src.name, proposed: `${roleLabel(r)} (${r.startDate || "?"} – ${r.endDate || "?"}), ${r.responsibilities.length + r.achievements.length} bullets`, safe: true, payload: copy });
        continue;
      }
      const group = roleLabel(m);
      // fields: fill blanks, flag conflicts
      for (const f of ["title", "employer", "location", "startDate", "endDate", "employmentType", "client", "teamSize", "leadership", "technicalOwnership", "architectureOwnership", "customerFacing"] as const) {
        const nv = r[f], cv = m[f];
        if (nv && !cv) { m[f] = nv; add({ kind: "field-fill", group, label: f, source: src.name, proposed: nv, safe: true, payload: { roleId: m.id, field: f, value: nv } }); }
        else if (nv && cv && nv.trim().toLowerCase() !== cv.trim().toLowerCase() && ["title", "employer", "startDate", "endDate", "teamSize"].includes(f) && !(f === "employer" && sameEmployer(nv, cv)))
          add({ kind: "conflict", group, label: f, source: src.name, current: cv, proposed: nv, note: f === "title" ? "Title differs between resumes (promotion, or a rewording?). Pick what is accurate." : f === "employer" ? "Employer differs for the same dates (a department or client in one resume?). Pick the company you were employed by." : "Differs between resumes. Pick what is accurate.", safe: false, payload: { scope: "role", roleId: m.id, field: f, value: nv } });
      }
      // bullets
      for (const [fld, arr] of [["responsibilities", r.responsibilities], ["achievements", r.achievements]] as const) {
        for (const b of arr) {
          const existing = [...m.responsibilities, ...m.achievements];
          let best = 0, bestB = "";
          for (const e of existing) { const j = Math.max(jaccard(e, b), containment(e, b) >= 0.75 ? 0.6 : 0); if (j > best) { best = j; bestB = e; } }
          if (best >= 0.5) {
            // Same bullet with different numbers is a conflict even when the wording is identical (tokens ignore digits).
            const metricDiff = nums(b) !== nums(bestB) && (nums(b) || nums(bestB));
            if (best >= 0.85 && !metricDiff) continue; // duplicate
            const richer = b.length > bestB.length * 1.15 && [...termSet(bestB)].every((t) => termSet(b).has(t)) && termSet(b).size > termSet(bestB).size;
            if (metricDiff) add({ kind: "conflict", group, label: "bullet metrics differ", source: src.name, current: bestB, proposed: b, note: "The numbers differ between versions. Use only the figure you can stand behind.", safe: false, payload: { scope: "bullet", roleId: m.id, original: bestB, value: b } });
            else if (richer) add({ kind: "bullet-detail", group, label: "More detailed version", source: src.name, current: bestB, proposed: b, note: "Adds technical detail already supported by your older resume.", safe: false, payload: { roleId: m.id, original: bestB, value: b } });
            continue;
          }
          m[fld].push(b);
          add({ kind: "bullet-new", group, label: fld === "achievements" ? "Achievement" : "Bullet", source: src.name, proposed: b, safe: true, payload: { roleId: m.id, field: fld, value: b } });
        }
      }
      // technologies etc.
      for (const f of ["technologies", "tools", "protocols", "methodologies"] as const) {
        const fresh = r[f].filter((t) => !m[f].some((x) => x.toLowerCase() === t.toLowerCase()));
        if (fresh.length) { m[f].push(...fresh); add({ kind: "terms-new", group, label: f, source: src.name, proposed: fresh.join(", "), safe: true, payload: { roleId: m.id, field: f, terms: fresh } }); }
      }
    }
    for (const cat of Object.keys(sp.skills) as (keyof Profile["skills"])[]) {
      const all = Object.values(work.skills).flat().map(skillKey);
      const fresh = [...new Map(sp.skills[cat].filter((t) => !all.includes(skillKey(t))).map((t) => [skillKey(t), t])).values()];
      if (fresh.length) { work.skills[cat].push(...fresh); add({ kind: "skill-new", group: "Skills", label: cat, source: src.name, proposed: fresh.join(", "), safe: true, payload: { category: cat, terms: fresh } }); }
    }
    for (const e of sp.education) if (!work.education.some((x) => (uniKey(x.university) === uniKey(e.university) || sameEmployer(x.university, e.university)) && (!x.degree || !e.degree || jaccard(x.degree, e.degree) > 0.4 || x.year === e.year))) { work.education.push(e); add({ kind: "edu-new", group: "Education", label: "Education", source: src.name, proposed: [e.degree, e.university, e.year].filter(Boolean).join(", "), safe: true, payload: e }); }
    for (const c of sp.certifications) if (!work.certifications.some((x) => jaccard(x, c) > 0.7)) { work.certifications.push(c); add({ kind: "cert-new", group: "Certifications", label: "Certification", source: src.name, proposed: c, safe: true, payload: c }); }
    for (const c of sp.publications) if (!work.publications.some((x) => jaccard(x, c) > 0.7)) { work.publications.push(c); add({ kind: "pub-new", group: "Publications", label: "Publication / patent", source: src.name, proposed: c, safe: true, payload: c }); }
    for (const a of sp.achievements ?? []) if (!(work.achievements ?? []).some((x) => jaccard(x, a) > 0.7)) { (work.achievements ??= []).push(a); add({ kind: "achievement-new", group: "Key achievements", label: "Achievement", source: src.name, proposed: a, safe: true, payload: a }); }
    for (const p of sp.projects ?? []) if (!(work.projects ??= []).some((x) => jaccard(x.name, p.name) > 0.6)) { work.projects.push(p); add({ kind: "project-new", group: "Projects", label: p.name || "Project", source: src.name, proposed: [p.name, p.summary, ...p.highlights.slice(0, 2)].filter(Boolean).join(" — "), safe: true, payload: p }); }
    for (const t of termSet(JSON.stringify(sp))) if (!baseTerms.has(t)) onlyInOlder.add(t);
  }

  // Timeline gaps in the merged career
  const spans = work.roles.map(span).filter((x): x is [number, number] => !!x).sort((a, b) => a[0] - b[0]);
  const gaps: MergeAnalysis["gaps"] = [];
  let end = -1;
  for (const [s, e] of spans) { if (end >= 0 && s - end > 3) gaps.push({ from: `${Math.floor(end / 12)}-${String(end % 12 || 12).padStart(2, "0")}`, to: `${Math.floor(s / 12)}-${String(s % 12 || 12).padStart(2, "0")}`, months: s - end - 1 }); end = Math.max(end, e); }
  const sum = (name: string, p: Profile) => ({ name, roles: p.roles.length, bullets: p.roles.reduce((a, r) => a + r.responsibilities.length + r.achievements.length, 0), years: totalYears(p.roles.map((r) => ({ start: r.startDate, end: r.endDate }))), latest: p.roles[0]?.title ?? "" });
  const analysis: MergeAnalysis = { sources: [...(currentBase ? [sum("Current profile", currentBase)] : []), ...sources.map((s) => sum(s.name, s.profile))], gaps, onlyInOlder: [...onlyInOlder].map((t) => ontology.get(t)?.canonical ?? t).slice(0, 30), baseName };
  return { base, items, analysis };
}

/** Apply decisions. Only accepted items change anything; pending/rejected leave the base untouched. */
export function applyMerge(base: Profile, items: MergeItem[]): Profile {
  const p = structuredClone(base) as Profile;
  const role = (id: string) => p.roles.find((r) => r.id === id);
  // Roles first so later items can attach to them.
  for (const i of items.filter((x) => x.decision === "accepted" && x.kind === "role-new")) if (!role(i.payload.id)) p.roles.push(structuredClone(i.payload));
  for (const i of items.filter((x) => x.decision === "accepted" && x.kind !== "role-new")) {
    const d = i.payload;
    switch (i.kind) {
      case "identity-fill": if (!p.identity[d.field as keyof Profile["identity"]]) p.identity[d.field as keyof Profile["identity"]] = d.value; break;
      case "field-fill": { const r = role(d.roleId); if (r && !(r as any)[d.field]) (r as any)[d.field] = d.value; break; }
      case "conflict":
        if (d.scope === "identity") p.identity[d.field as keyof Profile["identity"]] = d.value;
        else if (d.scope === "role") { const r = role(d.roleId); if (r) (r as any)[d.field] = d.value; }
        else if (d.scope === "bullet") { const r = role(d.roleId); if (r) for (const f of ["responsibilities", "achievements"] as const) r[f] = r[f].map((b) => (b === d.original ? d.value : b)); }
        break;
      case "bullet-new": { const r = role(d.roleId); if (r && ![...r.responsibilities, ...r.achievements].includes(d.value)) r[d.field as "responsibilities"].push(d.value); break; }
      case "bullet-detail": { const r = role(d.roleId); if (r) for (const f of ["responsibilities", "achievements"] as const) r[f] = r[f].map((b) => (b === d.original ? d.value : b)); break; }
      case "terms-new": { const r = role(d.roleId); if (r) for (const t of d.terms as string[]) if (!(r as any)[d.field].some((x: string) => x.toLowerCase() === t.toLowerCase())) (r as any)[d.field].push(t); break; }
      case "skill-new": for (const t of d.terms as string[]) if (!p.skills[d.category as keyof Profile["skills"]].some((x) => x.toLowerCase() === t.toLowerCase())) p.skills[d.category as keyof Profile["skills"]].push(t); break;
      case "edu-new": p.education.push(d); break;
      case "cert-new": p.certifications.push(d); break;
      case "pub-new": p.publications.push(d); break;
      case "achievement-new": (p.achievements ??= []).push(d); break;
      case "project-new": (p.projects ??= []).push(d as Project); break;
    }
  }
  return ProfileSchema.parse(p);
}

export const acceptSafeItems = (items: MergeItem[]): MergeItem[] => items.map((i) => (i.decision === "pending" && i.safe ? { ...i, decision: "accepted" as const } : i));
