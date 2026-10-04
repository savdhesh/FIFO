import type { EvidenceRef, Profile, Role } from "./types";
import { ontology } from "./ontology/ontology";
import { parseYM, totalYears } from "./parsing/dates";

export const roleLabel = (r: Role) => [r.title || "Role", r.employer].filter(Boolean).join(" @ ");

export interface EvidenceItem extends EvidenceRef { kind: "bullet" | "skills" | "role-field" | "summary" }

export interface ProfileIndex {
  profile: Profile;
  terms: Map<string, Set<string>>; // canonical -> surface forms
  evidence: Map<string, EvidenceItem[]>;
  items: EvidenceItem[];
  allText: string;
  years: number;
}

export function roleBullets(r: Role): string[] { return [...r.responsibilities, ...r.achievements]; }

export function buildIndex(profile: Profile): ProfileIndex {
  const items: EvidenceItem[] = [];
  for (const r of profile.roles) {
    if (r.title) items.push({ roleId: r.id, roleLabel: roleLabel(r), field: "title", text: r.title, kind: "role-field" });
    for (const b of roleBullets(r)) items.push({ roleId: r.id, roleLabel: roleLabel(r), field: "bullet", text: b, kind: "bullet" });
    const fields: [string, string[]][] = [["technologies", r.technologies], ["tools", r.tools], ["protocols", r.protocols], ["methodologies", r.methodologies]];
    for (const [f, vals] of fields) if (vals.length) items.push({ roleId: r.id, roleLabel: roleLabel(r), field: f, text: vals.join(", "), kind: "role-field" });
    for (const [f, v] of [["leadership", r.leadership], ["technicalOwnership", r.technicalOwnership], ["architectureOwnership", r.architectureOwnership], ["customerFacing", r.customerFacing]] as const)
      if (v) items.push({ roleId: r.id, roleLabel: roleLabel(r), field: f, text: v, kind: "role-field" });
  }
  for (const [cat, vals] of Object.entries(profile.skills)) if (vals.length) items.push({ roleId: "skills", roleLabel: "Skills", field: cat, text: vals.join(", "), kind: "skills" });
  if (profile.summary) items.push({ roleId: "summary", roleLabel: "Summary", field: "summary", text: profile.summary, kind: "summary" });
  for (const pr of profile.projects ?? []) {
    const label = [pr.name, pr.employer].filter(Boolean).join(" @ ") || "Project";
    if (pr.summary) items.push({ roleId: `project:${pr.id}`, roleLabel: label, field: "summary", text: pr.summary, kind: "bullet" });
    for (const h of pr.highlights) items.push({ roleId: `project:${pr.id}`, roleLabel: label, field: "bullet", text: h, kind: "bullet" });
    if (pr.technologies.length) items.push({ roleId: `project:${pr.id}`, roleLabel: label, field: "technologies", text: pr.technologies.join(", "), kind: "role-field" });
  }
  for (const a of profile.achievements ?? []) items.push({ roleId: "achievements", roleLabel: "Key achievements", field: "achievement", text: a, kind: "bullet" });
  for (const c of profile.certifications) items.push({ roleId: "certifications", roleLabel: "Certifications", field: "cert", text: c, kind: "skills" });

  const terms = new Map<string, Set<string>>();
  const evidence = new Map<string, EvidenceItem[]>();
  for (const it of items) {
    for (const h of ontology.findTerms(it.text)) {
      if (!terms.has(h.canonical)) terms.set(h.canonical, new Set());
      terms.get(h.canonical)!.add(h.surface.toLowerCase());
      const arr = evidence.get(h.canonical) ?? [];
      if (!arr.includes(it)) arr.push(it);
      evidence.set(h.canonical, arr);
    }
  }
  const years = totalYears(profile.roles.map((r) => ({ start: r.startDate, end: r.endDate })));
  const allText = items.map((i) => i.text).join("\n") + "\n" + profile.roles.map((r) => `${r.title} ${r.employer} ${r.client} ${r.location}`).join("\n") +
    "\n" + profile.education.map((e) => `${e.degree} ${e.university} ${e.specialization}`).join("\n") + "\n" + profile.certifications.join("\n") + "\n" + profile.publications.join("\n");
  return { profile, terms, evidence, items, allText, years };
}

/** Canonical terms evidenced in the most recent role (current role, else latest end date). Used for "where my current work is" wording. */
/** Most recent role: current first, then latest end date, then latest start date (dates compared as dates, not strings). */
export function latestRole(profile: Profile): Role | undefined {
  const ym = (s: string, end: boolean) => { const t = s.trim(); if (end && (!t || /present|current|now/i.test(t))) return 1e9; const d = parseYM(t, end); return d ? d.y * 12 + d.m : 0; };
  return [...profile.roles].sort((a, b) => ym(b.endDate, true) - ym(a.endDate, true) || ym(b.startDate, false) - ym(a.startDate, false))[0];
}

export function recentTerms(profile: Profile): Set<string> {
  const latest = latestRole(profile);
  if (!latest) return new Set();
  const text = [...roleBullets(latest), latest.title, ...latest.tools, ...latest.technologies, ...latest.protocols, ...latest.methodologies].join("\n");
  return new Set(ontology.findTerms(text).map((h) => h.canonical));
}

export const toEvidenceRef = (e: EvidenceItem): EvidenceRef => ({ roleId: e.roleId, roleLabel: e.roleLabel, field: e.field, text: e.text });
