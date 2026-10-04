import PptxGenJS from "pptxgenjs";
import type { MatchResult, ParsedJD, Profile, Role } from "../types";
import { buildIndex, roleBullets } from "../profile-index";
import { ontology } from "../ontology/ontology";
import { checkClaim } from "../truth/truth";
import { classifyBullet } from "../matching/bullets";
import { matchedJdTerms } from "../tailoring/resume";
import { gatherFacts, show } from "../outreach/shared";

export interface DeckOptions {
  maxProjects?: number; // default 6
  focus?: { jd: ParsedJD; match: MatchResult } | null; // rank projects/achievements for a target job
  include?: Partial<Record<"snapshot" | "timeline" | "projects" | "achievements" | "leadership" | "toolbox" | "education" | "closing", boolean>>;
}
export interface SlideMeta { kind: string; title: string; lines: string[] }
export interface Deck { pres: PptxGenJS; slides: SlideMeta[]; warnings: string[] }

const C = { ink: "13191C", sub: "46535A", accent: "0A5C8A", rule: "D9DFE2", tag: "E1EEFA", tagText: "164A7C", bg: "FFFFFF" };
const FONT = "Calibri";
const METRIC = /(\d+(?:\.\d+)?\s?%|\b\d+(?:\.\d+)?\s?x\b|\bteam of \d+|\b\d+\s+(?:engineers?|members|blocks?|projects?|tape-?outs?|ips?|customers?)\b)/i;

/** Trim to a slide-sized bullet at a clause boundary; never rewords or adds content. */
export function slideBullet(b: string, max = 190): string {
  const t = b.trim().replace(/[.;]\s*$/, "");
  if (t.length <= max) return t;
  const cut = Math.max(t.lastIndexOf(", ", max), t.lastIndexOf(" and ", max), t.lastIndexOf(" using ", max));
  return (cut > 60 ? t.slice(0, cut) : t.slice(0, max).replace(/\s+\S*$/, "")).trim();
}
const period = (r: Role) => [r.startDate, r.endDate || "Present"].filter(Boolean).join(" – ");

interface Proj { name: string; sub: string; highlights: string[]; tech: string[]; facts: string[]; score: number }

export function buildDeck(profile: Profile, opts: DeckOptions = {}): Deck {
  const idx = buildIndex(profile);
  const f = opts.focus ? gatherFacts(profile, opts.focus.jd, opts.focus.match) : null;
  const jdTerms = new Set(f ? f.jdTerms : []);
  const relevance = (text: string) => [...new Set(ontology.findTerms(text).map((h) => h.canonical))].reduce((s, t) => s + (jdTerms.has(t) ? 3 : 0.3), 0);
  const inc = { snapshot: true, timeline: true, projects: true, achievements: true, leadership: true, toolbox: true, education: true, closing: true, ...opts.include };
  const warnings: string[] = [];
  const meta: SlideMeta[] = [];
  const pres = new PptxGenJS();
  pres.layout = "LAYOUT_WIDE"; // 13.33 x 7.5 in
  pres.title = `${profile.identity.name} — projects and achievements`;
  pres.author = profile.identity.name;
  const W = 13.33;
  let n = 0;

  const slide = (kind: string, title: string, lines: string[]) => {
    const s = pres.addSlide(); n++;
    s.background = { color: C.bg };
    s.addShape(pres.ShapeType.rect, { x: 0, y: 0, w: 0.18, h: 7.5, fill: { color: C.accent }, line: { color: C.accent } });
    s.addText(title, { x: 0.7, y: 0.4, w: W - 1.4, h: 0.8, fontFace: FONT, fontSize: 28, bold: true, color: C.ink, fit: "shrink" });
    s.addShape(pres.ShapeType.line, { x: 0.7, y: 1.25, w: W - 1.4, h: 0, line: { color: C.rule, width: 1 } });
    s.addText(`${profile.identity.name}   ${n}`, { x: 0.7, y: 7.0, w: W - 1.4, h: 0.3, fontFace: FONT, fontSize: 10, color: C.sub, align: "right" });
    meta.push({ kind, title, lines });
    return s;
  };
  const bullets = (s: PptxGenJS.Slide, items: string[], box: { x: number; y: number; w: number; h: number }, size = 16) => {
    s.addText(items.map((t) => ({ text: t, options: { bullet: { indent: 18 }, breakLine: true, paraSpaceAfter: 8 } })), { ...box, fontFace: FONT, fontSize: size, color: C.ink, valign: "top", fit: "shrink" });
  };
  const tags = (s: PptxGenJS.Slide, items: string[], x: number, y: number, w: number) => {
    let cx = x, cy = y;
    for (const t of items.slice(0, 16)) {
      const tw = Math.min(3.2, 0.28 + t.length * 0.095);
      if (cx + tw > x + w) { cx = x; cy += 0.5; }
      s.addText(t, { x: cx, y: cy, w: tw, h: 0.38, fontFace: FONT, fontSize: 12, color: C.tagText, fill: { color: C.tag }, align: "center", valign: "middle" });
      cx += tw + 0.12;
    }
  };

  // 1. Title
  const headTerms = f ? matchedJdTerms(opts.focus!.jd, opts.focus!.match).filter((m) => !["leadership", "management", "communication", "customer", "experience", "education"].includes(m.type)).slice(0, 4).map((m) => show(m.term)) : ["SystemVerilog", "UVM", "RISC-V", "Formal Verification", "SoC Verification", "Functional Safety", "PCIe", "Gate-Level Simulation"].filter((t) => idx.terms.has(t)).slice(0, 4).map(show);
  const latest = profile.roles[0];
  const subtitle = [latest?.title, ...headTerms].filter(Boolean).join("  |  ");
  const hc = checkClaim(subtitle, { index: idx });
  if (hc.status === "UNSUPPORTED") warnings.push(`Title slide text flagged: ${hc.reasons.join(" ")}`);
  { const s = pres.addSlide(); n++; s.background = { color: C.bg };
    s.addShape(pres.ShapeType.rect, { x: 0, y: 0, w: 0.35, h: 7.5, fill: { color: C.accent }, line: { color: C.accent } });
    s.addText(profile.identity.name || "Candidate", { x: 0.9, y: 2.3, w: W - 1.8, h: 1.1, fontFace: FONT, fontSize: 44, bold: true, color: C.ink });
    s.addText(subtitle, { x: 0.9, y: 3.5, w: W - 1.8, h: 0.9, fontFace: FONT, fontSize: 20, color: C.accent, fit: "shrink" });
    s.addText("Projects and achievements", { x: 0.9, y: 4.5, w: W - 1.8, h: 0.5, fontFace: FONT, fontSize: 16, color: C.sub });
    s.addText([profile.identity.location, profile.identity.email].filter(Boolean).join("   |   "), { x: 0.9, y: 6.5, w: W - 1.8, h: 0.4, fontFace: FONT, fontSize: 12, color: C.sub });
    meta.push({ kind: "title", title: profile.identity.name, lines: [subtitle] }); }

  // 2. Snapshot
  if (inc.snapshot) {
    const years = Math.floor(idx.years);
    const sk = profile.skills;
    const s = slide("snapshot", "Career snapshot", []);
    const stats: [string, string][] = [[years ? `${years}+` : "–", "years of experience"], [String(profile.roles.length), "roles"], ...(profile.projects.length ? [[String(profile.projects.length), "listed projects"] as [string, string]] : []), [String(idx.terms.size), "verification terms evidenced"]];
    stats.forEach(([big, small], i) => { const x = 0.7 + i * 3.1; s.addText(big, { x, y: 1.6, w: 2.9, h: 0.9, fontFace: FONT, fontSize: 40, bold: true, color: C.accent }); s.addText(small, { x, y: 2.5, w: 2.9, h: 0.4, fontFace: FONT, fontSize: 13, color: C.sub }); });
    const cols: [string, string[]][] = [["Domains", [...sk.domains, ...sk.processor].slice(0, 8)], ["Methods", [...sk.verification, ...sk.formal, ...sk.methodologies].slice(0, 8)], ["Tools and protocols", [...sk.tools, ...sk.protocols].slice(0, 8)]];
    cols.forEach(([h, items], i) => { const x = 0.7 + i * 4.1; s.addText(h, { x, y: 3.4, w: 3.8, h: 0.4, fontFace: FONT, fontSize: 14, bold: true, color: C.ink }); bullets(s, items.length ? items : ["(none listed)"], { x, y: 3.85, w: 3.8, h: 2.9 }, 14); });
    meta[meta.length - 1].lines = [...stats.map(([a, b]) => `${a} ${b}`), ...cols.map(([h, i]) => `${h}: ${i.join(", ")}`)];
  }

  // 3. Timeline
  if (inc.timeline && profile.roles.length) {
    const s = slide("timeline", "Career timeline", []);
    const rows = profile.roles.slice(0, 7);
    rows.forEach((r, i) => {
      const y = 1.6 + i * 0.75;
      s.addShape(pres.ShapeType.ellipse, { x: 0.8, y: y + 0.12, w: 0.2, h: 0.2, fill: { color: C.accent }, line: { color: C.accent } });
      s.addText(period(r), { x: 1.2, y, w: 2.6, h: 0.45, fontFace: FONT, fontSize: 14, color: C.sub, valign: "middle" });
      s.addText([{ text: r.title || "Role", options: { bold: true, breakLine: true } }, { text: [r.employer, r.location].filter(Boolean).join(" · "), options: { color: C.sub, fontSize: 12 } }], { x: 3.9, y: y - 0.08, w: 8.6, h: 0.65, fontFace: FONT, fontSize: 15, color: C.ink, valign: "top", fit: "shrink" });
    });
    meta[meta.length - 1].lines = rows.map((r) => `${period(r)} — ${r.title} @ ${r.employer}`);
  }

  // 4. Project slides: explicit projects first, then each role's strongest bullets.
  const projects: Proj[] = [];
  for (const p of profile.projects) {
    const hl = [p.summary, ...p.highlights].filter(Boolean);
    projects.push({ name: p.name || "Project", sub: [p.employer, p.period].filter(Boolean).join(" · "), highlights: hl, tech: p.technologies, facts: [], score: hl.reduce((a, b) => a + relevance(b), 0) + 5 });
  }
  for (const r of profile.roles) {
    const bs = roleBullets(r).filter((b) => !["Generic", "Duplicate"].includes(classifyBullet(b).cls));
    if (!bs.length) continue;
    const ranked = bs.map((b) => ({ b, s: relevance(b) + (METRIC.test(b) ? 1 : 0) + (/own|led|architect|defin|built/i.test(b) ? 0.5 : 0) })).sort((a, b) => b.s - a.s);
    projects.push({ name: r.title || "Role", sub: [r.employer, period(r)].filter(Boolean).join(" · "), highlights: ranked.slice(0, 4).map((x) => x.b), tech: [...r.tools, ...r.protocols, ...r.technologies, ...r.methodologies].slice(0, 14), facts: [r.teamSize && `Team: ${r.teamSize.replace(/^team of /i, "")}`, r.client && `Client: ${r.client}`].filter(Boolean) as string[], score: ranked.slice(0, 4).reduce((a, x) => a + x.s, 0) });
  }
  if (inc.projects) {
    const chosen = (f ? projects.sort((a, b) => b.score - a.score) : projects).slice(0, opts.maxProjects ?? 6);
    for (const p of chosen) {
      const s = slide("project", p.name, p.highlights.map((h) => slideBullet(h)));
      s.addText(p.sub, { x: 0.7, y: 1.3, w: W - 1.4, h: 0.4, fontFace: FONT, fontSize: 14, color: C.sub });
      bullets(s, p.highlights.slice(0, 4).map((h) => slideBullet(h)), { x: 0.7, y: 1.9, w: 7.6, h: 4.8 }, 17);
      s.addText("Technologies", { x: 8.7, y: 1.9, w: 4, h: 0.4, fontFace: FONT, fontSize: 14, bold: true, color: C.ink });
      tags(s, p.tech.length ? p.tech : ["(see highlights)"], 8.7, 2.4, 4.0);
      if (p.facts.length) { s.addText(p.facts.join("\n"), { x: 8.7, y: 5.4, w: 4, h: 1, fontFace: FONT, fontSize: 13, color: C.sub }); }
      meta[meta.length - 1].lines.push(...p.tech.slice(0, 14).map((t) => `tag: ${t}`));
    }
    if (!chosen.length) warnings.push("No project or role bullets to build project slides from.");
  }

  // 5. Achievements: only what you wrote; metrics are shown verbatim, never created.
  if (inc.achievements) {
    const ach: { t: string; src: string; s: number }[] = [];
    for (const a of profile.achievements) ach.push({ t: a, src: "Key achievements", s: 5 + relevance(a) });
    for (const r of profile.roles) for (const a of r.achievements) ach.push({ t: a, src: r.employer || r.title, s: 4 + relevance(a) });
    for (const r of profile.roles) for (const b of r.responsibilities) if (METRIC.test(b) && !ach.some((x) => x.t === b)) ach.push({ t: b, src: r.employer || r.title, s: 2 + relevance(b) });
    const top = ach.sort((a, b) => b.s - a.s).slice(0, 6);
    if (top.length) {
      const s = slide("achievements", "Achievements", top.map((a) => slideBullet(a.t)));
      top.forEach((a, i) => { const col = i % 2, row = Math.floor(i / 2), x = 0.7 + col * 6.2, y = 1.6 + row * 1.7; s.addShape(pres.ShapeType.rect, { x, y, w: 5.9, h: 1.5, fill: { color: "F1F4F5" }, line: { color: C.rule, width: 0.75 } }); s.addText([{ text: slideBullet(a.t, 150), options: { breakLine: true } }, { text: a.src, options: { fontSize: 11, color: C.sub } }], { x: x + 0.15, y: y + 0.05, w: 5.6, h: 1.4, fontFace: FONT, fontSize: 14, color: C.ink, valign: "middle", fit: "shrink" }); });
      if (!top.some((a) => METRIC.test(a.t))) warnings.push("No measurable results in your profile, so no numbers appear on the achievements slide. Add real metrics to your achievements if you have them.");
    } else warnings.push("No achievements found. Add them to roles or to the Key achievements list in your profile.");
  }

  // 6. Leadership & architecture (verbatim profile fields)
  if (inc.leadership) {
    const L: [string, string][] = [];
    for (const r of profile.roles) for (const [lab, v] of [["Leadership", r.leadership], ["Architecture", r.architectureOwnership], ["Technical ownership", r.technicalOwnership], ["Customer-facing", r.customerFacing]] as const) if (v && !L.some((x) => x[1] === v)) L.push([lab, v]);
    if (L.length) { const s = slide("leadership", "Leadership and ownership", L.slice(0, 5).map(([a, b]) => `${a}: ${slideBullet(b)}`)); bullets(s, L.slice(0, 5).map(([a, b]) => `${a}: ${slideBullet(b)}`), { x: 0.7, y: 1.7, w: W - 1.4, h: 5 }, 17); }
  }
  // 7. Toolbox
  if (inc.toolbox) {
    const LAB: Record<string, string> = { languages: "HDL / Languages", verification: "Verification", formal: "Formal", processor: "Processor / ISA", protocols: "Protocols", domains: "Domains", tools: "Tools", methodologies: "Methodologies" };
    const entries = Object.entries(profile.skills).filter(([, v]) => v.length);
    if (entries.length) { const s = slide("toolbox", "Technical toolbox", entries.map(([k, v]) => `${LAB[k]}: ${v.join(", ")}`)); entries.slice(0, 8).forEach(([k, v], i) => { const col = i % 2, row = Math.floor(i / 2), x = 0.7 + col * 6.2, y = 1.6 + row * 1.3; s.addText(LAB[k], { x, y, w: 5.9, h: 0.35, fontFace: FONT, fontSize: 13, bold: true, color: C.accent }); s.addText(v.slice(0, 14).join("  ·  "), { x, y: y + 0.35, w: 5.9, h: 0.8, fontFace: FONT, fontSize: 13, color: C.ink, valign: "top", fit: "shrink" }); }); }
  }
  // 8. Education
  if (inc.education && (profile.education.length || profile.certifications.length || profile.publications.length)) {
    const lines = [...profile.education.map((e) => [e.degree, e.degree.toLowerCase().includes(e.specialization.toLowerCase()) ? "" : e.specialization, e.university, e.year].filter(Boolean).join(", ")), ...profile.certifications.map((c) => `Certification: ${c}`), ...profile.publications.map((c) => `Publication: ${c}`)];
    const s = slide("education", "Education and credentials", lines); bullets(s, lines.slice(0, 8), { x: 0.7, y: 1.7, w: W - 1.4, h: 5 }, 17);
  }
  // 9. Closing
  if (inc.closing) {
    const s = pres.addSlide(); n++; s.background = { color: C.bg };
    s.addShape(pres.ShapeType.rect, { x: 0, y: 0, w: 0.35, h: 7.5, fill: { color: C.accent }, line: { color: C.accent } });
    s.addText("Thank you", { x: 0.9, y: 2.6, w: W - 1.8, h: 1, fontFace: FONT, fontSize: 40, bold: true, color: C.ink });
    const contact = [profile.identity.email, profile.identity.phone, profile.identity.linkedin, profile.identity.github].filter(Boolean);
    s.addText(contact.join("\n"), { x: 0.9, y: 3.8, w: W - 1.8, h: 1.6, fontFace: FONT, fontSize: 18, color: C.accent });
    meta.push({ kind: "closing", title: "Thank you", lines: contact });
  }
  return { pres, slides: meta, warnings };
}

export const deckBuffer = (d: Deck, type: "nodebuffer" | "arraybuffer" = "arraybuffer") => d.pres.write({ outputType: type }) as Promise<any>;
