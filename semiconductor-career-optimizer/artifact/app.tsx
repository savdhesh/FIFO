import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Badge, Button, Card, Input, Label, Select, Textarea, band, cx, matchTone, statusTone } from "./ui";
import { ProfileSchema, SKILL_CATEGORIES, SettingsSchema, type Profile, type Role } from "../src/lib/types";
import { COUNTRY_NAMES } from "../src/lib/countries";
import { DEMO_JD_TEXT, DEMO_RESUME_TEXT } from "../src/lib/demo";
import { parseResumeHeuristic } from "../src/lib/parsing/resume-parser";
import { acceptAllSafe, analyze, decide, finalDocs, generate, parseResume, providerFor, saveLetter, type AppRecord, type Transport } from "./logic";
import { coverDocxBlob, coverLetterPdf, fitResume, reportPdf, resumeDocxBlob, resumePdf } from "./exporters";
import { extractBrowser, extractPdfBytes, extractWithLayout } from "./extract";
import { packName } from "../src/lib/export/names";
import { auditProse } from "../src/lib/truth/truth";
import type { ParseDiagnostics } from "../src/lib/parsing/diagnostics";
import { acceptSafeItems, applyMerge, mergeResumes, type MergeItem, type MergeReport } from "../src/lib/merge/merge";
import { buildDeck, deckBuffer } from "../src/lib/deck/deck";
import { computeAnalytics } from "../src/lib/analytics/analytics";
import { atsParse, type AtsReport } from "../src/lib/ats/ats";
import { auditCredibility } from "../src/lib/credibility/credibility";
import { planStrategy } from "../src/lib/strategy/strategy";
import { show } from "../src/lib/outreach/shared";
import { weakTopics, type CoachResult } from "../src/lib/coach/coach";
import { THEMES, themeById } from "../src/lib/export/themes";
import { ontology, type VocabEntry } from "../src/lib/ontology/ontology";
import { DEFAULT_WEIGHTS } from "../src/lib/matching/matcher";
import { buildIndex, latestRole } from "../src/lib/profile-index";
const latestRoleTitle = (p: Profile) => latestRole(p)?.title || "no roles found";

declare const claude: any;
const KEY = "sco.v1";

/** Where state lives. Inside Claude it is this browser's local storage; the self-hosted app injects a server adapter (window.SCO_ADAPTER). */
export interface Adapter {
  mode: "local" | "server";
  load(): Promise<any | null>;
  save(state: unknown): void;
  user?: { email: string };
  logout?: () => Promise<void>;
  fetchJob?: (url: string) => Promise<string>;
  storeFile?: (file: File) => Promise<string>;
  deleteFile?: (id: string) => Promise<void>;
  deleteAll?: (password: string, scope: "data" | "account") => Promise<void>;
  aiProvider?: string;
}
const localAdapter: Adapter = {
  mode: "local",
  async load() { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; } },
  save(state) { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* blocked or full: the page keeps working without persistence */ } },
};
const adapter: Adapter = (globalThis as any).SCO_ADAPTER ?? localAdapter;
type Resume = { id: string; name: string; addedAt: string; profile: Profile; ats?: AtsReport | null; diag?: ParseDiagnostics | null; source?: string; fileId?: string; hash?: string; mergedAt?: string };
type Prefs = { weights?: Record<string, number>; theme: string; vocab: VocabEntry[] };
type Store = { profile: Profile | null; apps: AppRecord[]; resumes: Resume[]; prefs: Prefs };
const DEFAULT_PREFS: Prefs = { theme: "plain", vocab: [] };
const hydrate = (s: any): Store => { try { if (!s) throw new Error("empty"); const prefs = { ...DEFAULT_PREFS, ...(s.prefs ?? {}) }; ontology.setCustom(prefs.vocab); return { profile: s.profile ? ProfileSchema.parse(s.profile) : null, apps: s.apps ?? [], resumes: (s.resumes ?? []).map((r: Resume) => ({ ...r, mergedAt: r.mergedAt ?? (s.profile ? r.addedAt : undefined), profile: ProfileSchema.parse(r.profile) })), prefs }; } catch { return { profile: null, apps: [], resumes: [], prefs: DEFAULT_PREFS }; } };


const STATUSES = ["SAVED", "ANALYZED", "APPLYING", "APPLIED", "RECRUITER_CONTACTED", "SCREENING", "TECHNICAL_ROUND", "HIRING_MANAGER", "FINAL_ROUND", "OFFER", "REJECTED", "WITHDRAWN"];
const errCopy = (e: any) => (e?.code === "not_granted" ? "Claude access was declined for this session." : e?.code === "rate_limited" ? "Too many requests. Wait a moment." : e?.code === "cancelled" ? "Cancelled." : e?.message || "Something went wrong.");

function App({ initial }: { initial: Store }) {
  const [store, setStore] = useState<Store>(initial);
  const [view, setView] = useState<"profile" | "analyze" | "apps" | "versions" | "analytics" | "deck" | "settings">("profile");
  const [openId, setOpenId] = useState<string | null>(null);
  const [sample, setSample] = useState<any>(null);
  const [downloads, setDownloads] = useState<any>(null);
  const [useClaude, setUseClaude] = useState(false);
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => { (async () => { try { { const sm = await claude.use("sample"); setSample(sm ? () => sm : null); } setDownloads(await claude.use("downloads")); } catch { /* standalone */ } })(); }, []);
  const first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } adapter.save(store); }, [store]);
  useEffect(() => { if (store.profile === null && store.apps.length === 0) setView("profile"); }, []);
  const say = (tone: "ok" | "err", text: string) => setToast({ tone, text });

  const transport: Transport | null = useMemo(() => (sample && useClaude ? async (system, user) => {
    abort.current = new AbortController();
    const opts = { modelTier: "default", cache: false, signal: abort.current.signal, onText: () => setBusy((b) => (b.startsWith("Claude") ? b : "Claude is working…")) };
    return (sample.complete ? (await sample.complete(system, user, opts)) : (await sample(`${system}\n\n${user}`, opts)).text) as string;
  } : null), [sample, useClaude]);
  const provider = useMemo(() => providerFor(transport), [transport]);

  const run = async (label: string, fn: () => Promise<void>) => { setBusy(label); setToast(null); try { await fn(); } catch (e: any) { say("err", errCopy(e)); } finally { setBusy(""); abort.current = null; } };
  const setProfile = (p: Profile | null) => setStore((s) => ({ ...s, profile: p }));
  const updateApp = (a: AppRecord) => setStore((s) => ({ ...s, apps: s.apps.map((x) => (x.id === a.id ? a : x)) }));
  const open = store.apps.find((a) => a.id === openId) ?? null;

  const nav: [typeof view, string][] = [["profile", "Profile"], ["analyze", "Analyze a job"], ["apps", `Applications (${store.apps.length})`], ["versions", "Versions"], ["analytics", "Analytics"], ["deck", "Presentation"], ["settings", "Settings"]];
  return (
    <div className="sco-main mx-auto max-w-6xl px-4 pb-16" data-view={view}>
      <header className="sco-band flex flex-wrap items-center justify-between gap-3">
        <div><div className="sco-eyebrow">DV · SoC · RISC-V · Formal · FuSa</div><h1>Semiconductor Career Optimizer</h1></div>
        <div className="flex flex-wrap items-center gap-3">{adapter.user && <span className="text-xs text-gray-500">{adapter.user.email} {adapter.logout && <button className="ml-1 underline" onClick={() => adapter.logout!()}>Sign out</button>}</span>}
        <label className={cx("flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm", !sample && "opacity-60")} title={sample ? (adapter.mode === "server" ? "Sends resume and job text to the configured AI vendor from this server." : "Use Claude for parsing, rewrites and the cover letter. Runs on your own Claude usage.") : "No AI provider is available here; the offline engine is used."}>
          <input type="checkbox" id="use-claude" disabled={!sample} checked={useClaude} onChange={(e) => setUseClaude(e.target.checked)} />
          {sample ? (adapter.mode === "server" ? `Use ${adapter.aiProvider ?? "AI"} for language tasks` : "Use Claude for language tasks") : "Offline engine (AI unavailable)"}
        </label></div>
      </header>
      <nav className="sco-nav flex flex-wrap gap-2 py-4" aria-label="Sections">{nav.map(([k, l]) => <button key={k} data-view={k} aria-current={view === k ? "page" : undefined} onClick={() => { setView(k); setOpenId(null); }}>{l}</button>)}</nav>
      {busy && <div role="status" className="sco-busy mb-3 flex items-center justify-between rounded-md border border-line bg-gray-50 p-3 text-sm"><span>{busy}</span>{abort.current && <Button size="sm" variant="outline" onClick={() => abort.current?.abort()}>Stop</Button>}</div>}
      {toast && <div role={toast.tone === "err" ? "alert" : "status"} className={cx("mb-3 rounded-md border p-3 text-sm", toast.tone === "err" ? "border-red-300 bg-red-50 text-red-800" : "border-green-300 bg-green-50 text-green-800")}>{toast.text}</div>}

      {view === "profile" && <ProfileView profile={store.profile} setProfile={setProfile} resumes={store.resumes} setResumes={(f: (r: Resume[]) => Resume[]) => setStore((s) => ({ ...s, resumes: f(s.resumes) }))} provider={provider} run={run} say={say} claudeOn={!!transport} goAnalyze={() => setView("analyze")} />}
      {view === "analyze" && <AnalyzeView weights={store.prefs.weights} profile={store.profile} run={run} say={say} onDone={(a: AppRecord) => { setStore((s) => ({ ...s, apps: [a, ...s.apps] })); setOpenId(a.id); setView("apps"); }} provider={provider} claudeOn={!!transport} />}
      {view === "apps" && !open && <AppsList apps={store.apps} open={setOpenId} />}
      {view === "apps" && open && store.profile && <AppDetail key={open.id} theme={store.prefs.theme} app={open} profile={store.profile} update={updateApp} back={() => setOpenId(null)} remove={() => { setStore((s) => ({ ...s, apps: s.apps.filter((x) => x.id !== open.id) })); setOpenId(null); }} provider={provider} run={run} say={say} downloads={downloads} />}
      {view === "versions" && <VersionsView apps={store.apps} open={(id: string) => { setOpenId(id); setView("apps"); }} />}
      {view === "analytics" && <AnalyticsView apps={store.apps} open={(id: string) => { setOpenId(id); setView("apps"); }} />}
      {view === "deck" && <DeckView profile={store.profile} apps={store.apps} downloads={downloads} say={say} />}
      {view === "settings" && <SettingsView store={store} setStore={setStore} setPrefs={(f: (p: Prefs) => Prefs) => setStore((s) => { const prefs = f(s.prefs); ontology.setCustom(prefs.vocab); return { ...s, prefs }; })} downloads={downloads} say={say} claudeOn={!!sample} />}
    </div>
  );
}

/* ---------- Profile ---------- */
const csv = (a: string[]) => a.join(", "); const unCsv = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
const lines = (a: string[]) => a.join("\n"); const unLines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
const SKILL_LABEL: Record<string, string> = { languages: "HDL / Languages", verification: "Verification", formal: "Formal verification", processor: "Processor / ISA", protocols: "Interfaces / Protocols", domains: "Verification domains", tools: "Tools", methodologies: "Methodologies" };

/** Content hash of normalised resume text: the same resume uploaded from two places is recognised as one. */
const textHash = (t: string) => { let h = 5381; for (const c of t.toLowerCase().replace(/\s+/g, " ").trim()) h = ((h << 5) + h + c.charCodeAt(0)) | 0; return (h >>> 0).toString(36); };
const ACCEPT = /\.(pdf|docx|txt)$/i;

function ProfileView({ profile, setProfile, resumes, setResumes, provider, run, say, claudeOn, goAnalyze }: any) {
  const file = useRef<HTMLInputElement>(null);
  const [paste, setPaste] = useState("");
  const [drag, setDrag] = useState(false);
  const [report, setReport] = useState<MergeReport | null>(null);
  const [review, setReview] = useState<{ id: string; name: string; diag: ParseDiagnostics; source: string } | null>(null);
  const [items, setItems] = useState<MergeItem[]>([]);
  const pending: Resume[] = resumes.filter((r: Resume) => !r.mergedAt);

  // Step 1: add. Each resume is parsed when added and kept in the library; nothing touches the profile yet.
  const addResume = async (name: string, text: string, existing: Resume[], layout?: any): Promise<{ all: Resume[]; added: boolean }> => {
    if (text.trim().length < 200) throw new Error(`${name}: almost no text found. This looks like a scanned/image file, which an ATS cannot read either. Use a text-based PDF, DOCX or TXT, or paste the text.`);
    const hash = textHash(text);
    const dup = existing.find((r) => r.hash === hash);
    if (dup) return { all: existing, added: false };
    const parsed = await parseResume(provider, text);
    return { all: [...existing, { id: `res${Date.now().toString(36)}${existing.length}`, name, addedAt: new Date().toISOString(), profile: parsed.profile, ats: atsParse(text, layout), diag: { ...parsed.diag, unplaced: parsed.diag.unplaced }, source: parsed.source, hash }], added: true };
  };
  const afterAdd = (all: Resume[], added: number, skipped: string[]) => {
    setResumes(() => all);
    const waiting = all.filter((r) => !r.mergedAt).length;
    const dupNote = skipped.length ? ` Skipped ${skipped.join(", ")}: already in your library.` : "";
    if (added) say("ok", `Added ${added} resume${added > 1 ? "s" : ""}. ${waiting} ready to ${profile ? "merge" : "build your profile from"}. Add more from anywhere, then select ${profile ? "Merge into profile" : "Build profile"} when you are done.${dupNote}`);
    else if (skipped.length) say("err", `Nothing added.${dupNote}`);
  };
  const onFiles = (files: File[]) => {
    const bad = files.filter((f) => !ACCEPT.test(f.name));
    const ok = files.filter((f) => ACCEPT.test(f.name));
    if (bad.length) say("err", `${bad.map((f) => f.name).join(", ")}: only PDF, DOCX or TXT files can be read.`);
    if (!ok.length) return;
    run(claudeOn ? "Reading resumes with Claude…" : "Reading resumes…", async () => {
      let all: Resume[] = resumes, added = 0;
      const skipped: string[] = [];
      for (const f of ok) {
        const ex = await extractWithLayout(f);
        const r = await addResume(f.name, ex.text, all, ex.layout);
        if (!r.added) { skipped.push(f.name); continue; }
        all = r.all; added++;
        if (adapter.storeFile) { try { const id = await adapter.storeFile(f); all = all.map((x, i) => (i === all.length - 1 ? { ...x, fileId: id } : x)); } catch { /* original file not stored; parsed data is kept */ } }
      }
      afterAdd(all, added, skipped);
    });
  };

  // Step 2: build. Runs once you have added everything: the strongest resume becomes the base, the rest are proposed as additions.
  const build = () => {
    if (!resumes.length) return;
    const src = resumes.map((x: Resume) => ({ id: x.id, name: x.name, profile: x.profile }));
    let base = profile;
    if (!base) { const r0 = mergeResumes(src); base = r0.base; setProfile(base); }
    const r = mergeResumes(src, base);
    const now = new Date().toISOString();
    setResumes((xs: Resume[]) => xs.map((x) => (x.mergedAt ? x : { ...x, mergedAt: now })));
    setReview(null);
    if (resumes.length > 1 || profile) { setReport(r); setItems(r.items); }
    say("ok", profile
      ? `${pending.length} new resume(s) compared with your profile: ${r.items.length} proposed change(s). Nothing is applied until you accept it.`
      : `Profile built from ${r.analysis.baseName}${resumes.length > 1 ? `; ${r.items.length} addition(s) from your other ${resumes.length - 1} resume(s) to review below` : ""}. Correct anything the parser got wrong.`);
  };

  const setResumeProfile = (id: string) => (p: Profile) => setResumes((xs: Resume[]) => xs.map((x) => (x.id === id ? { ...x, profile: p } : x)));
  const decide = (id: string, decision: MergeItem["decision"]) => setItems((xs) => xs.map((x) => (x.id === id ? { ...x, decision } : x)));
  const accepted = items.filter((i) => i.decision === "accepted").length;
  const groups = useMemo(() => { const m = new Map<string, MergeItem[]>(); for (const i of items) m.set(i.group, [...(m.get(i.group) ?? []), i]); return [...m.entries()]; }, [items]);
  const step = !resumes.length && !profile ? 1 : pending.length ? 2 : report ? 3 : 4;
  const STEPS = ["Add resumes", profile ? "Merge into profile" : "Build profile", "Review merge", "Analyze a job"];
  const reviewed: Resume | undefined = review ? resumes.find((r: Resume) => r.id === review.id) : undefined;
  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Resume library</h2>
          <ol className="m-0 flex list-none flex-wrap gap-1 pl-0 text-xs" aria-label="Progress">{STEPS.map((t, i) => <li key={t} aria-current={step === i + 1 ? "step" : undefined} className={cx("rounded-full border px-2 py-0.5", step === i + 1 ? "border-view bg-view text-on-view" : step > i + 1 ? "border-view text-view" : "border-line text-gray-500")}>{i + 1}. {t}</li>)}</ol>
        </div>
        <p className="text-sm text-gray-600">Add your current resume and any older ones, as many times as you like and from anywhere: pick files, drop them here, or paste text. Each one is read and kept in this library (in this browser only); nothing changes your profile until you build it. {claudeOn ? "Claude is on: resume text is sent to Claude for parsing." : "Parsing runs locally with the built-in engine."}</p>
        <div
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); const fs = [...e.dataTransfer.files]; if (fs.length) onFiles(fs); }}
          className={cx("flex flex-wrap items-center gap-2 rounded-lg border-2 border-dashed p-4", drag ? "border-view bg-view-soft" : "border-line")}>
          <input ref={file} type="file" id="resume-file" multiple accept=".pdf,.docx,.txt" className="hidden" onChange={(e) => { const fs = [...(e.target.files ?? [])]; if (fs.length) onFiles(fs); e.target.value = ""; }} />
          <Button variant={resumes.length ? "outline" : "primary"} onClick={() => file.current?.click()}>{resumes.length ? "Add more resumes" : "Add resumes"}</Button>
          <span className="text-sm text-gray-500">or drop PDF, DOCX or TXT files here (5 MB each)</span>
          {!profile && !resumes.length && <Button variant="ghost" className="ml-auto" onClick={() => { setProfile(parseResumeHeuristic(DEMO_RESUME_TEXT)); say("ok", "Fictional demo profile ready."); }}>Load demo profile</Button>}
        </div>
        <details><summary className="cursor-pointer text-sm underline">Paste resume text instead</summary><Textarea id="resume-paste" aria-label="Resume text" rows={8} className="mt-2" value={paste} onChange={(e) => setPaste(e.target.value)} /><Button className="mt-2" variant="outline" disabled={paste.length < 50} onClick={() => run("Parsing…", async () => { const r = await addResume(`pasted-${resumes.length + 1}.txt`, paste, resumes); afterAdd(r.all, r.added ? 1 : 0, r.added ? [] : ["the pasted text"]); setPaste(""); })}>Add pasted resume</Button></details>
        {resumes.length > 0 && <ul className="divide-y divide-line rounded-md border border-line text-sm">{resumes.map((r: Resume) => <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 p-2">
          <span className="min-w-0"><b>{r.name}</b> <span className="text-gray-500">· {r.profile.roles.length} roles, {r.profile.roles.reduce((a, x) => a + x.responsibilities.length + x.achievements.length, 0)} bullets · {latestRoleTitle(r.profile)}</span>{" "}
            <Badge tone={r.mergedAt ? "gray" : "blue"}>{r.mergedAt ? "in profile" : "ready"}</Badge>{" "}
            {r.diag && <Badge tone={r.diag.confidence === "High" ? "green" : r.diag.confidence === "Medium" ? "amber" : "red"}>parse {r.diag.confidence.toLowerCase()}</Badge>}{" "}
            {r.ats && <span title={r.ats.checks.filter((c) => c.status !== "pass").map((c) => `${c.label}: ${c.detail}`).join("\n") || "No ATS issues found"}><Badge tone={r.ats.risk === "Low" ? "green" : r.ats.risk === "Medium" ? "amber" : "red"}>ATS {r.ats.risk}</Badge></span>}</span>
          <span className="flex gap-3">{r.diag && <button className="text-xs underline" onClick={() => setReview({ id: r.id, name: r.name, diag: r.diag!, source: r.source ?? "built-in engine" })}>Check parse</button>}
            <button className="text-xs text-red-800 underline" onClick={() => { if (r.fileId && adapter.deleteFile) adapter.deleteFile(r.fileId).catch(() => undefined); setResumes((xs: Resume[]) => xs.filter((x) => x.id !== r.id)); if (review?.id === r.id) setReview(null); }}>Remove</button></span></li>)}</ul>}
        {resumes.length > 0 && <div className="flex flex-wrap items-center gap-3">
          {pending.length > 0
            ? <Button id="build-profile" onClick={build}>{profile ? `Merge ${pending.length} new resume${pending.length > 1 ? "s" : ""} into profile` : `Build profile from ${resumes.length} resume${resumes.length > 1 ? "s" : ""}`}</Button>
            : profile && <Button variant="outline" onClick={() => { const r = mergeResumes(resumes.map((x: Resume) => ({ id: x.id, name: x.name, profile: x.profile })), profile); setReport(r); setItems(r.items); }}>Re-analyse library against profile</Button>}
          {pending.length > 0 && <span className="text-xs text-gray-500">Add everything first; you can still add more later and merge again.</span>}
        </div>}
      </Card>

      {review && reviewed && <ParseReview review={review} profile={reviewed.mergedAt && profile ? profile : reviewed.profile} setProfile={reviewed.mergedAt && profile ? setProfile : setResumeProfile(reviewed.id)} close={() => setReview(null)} />}
      {report && (
        <Card className="space-y-4" id="merge-review">
          <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold">Merge review <span className="font-normal text-gray-500">· base: {report.analysis.baseName}</span></h2>
            <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setItems(acceptSafeItems(items))}>Accept all additions</Button><Button size="sm" disabled={!accepted} onClick={() => { setProfile(applyMerge(profile, items)); setReport(null); setItems([]); say("ok", `Applied ${accepted} change(s) to your profile.`); }}>Apply {accepted} accepted</Button><Button size="sm" variant="ghost" onClick={() => { setReport(null); setItems([]); }}>Close</Button></div></div>
          <div className="grid gap-3 md:grid-cols-3">
            <div><Label>Sources</Label><ul className="text-sm">{report.analysis.sources.map((s) => <li key={s.name}>{s.name}: {s.roles} roles, {s.bullets} bullets, {s.years} yrs</li>)}</ul></div>
            <div><Label>Timeline gaps over 3 months</Label>{report.analysis.gaps.length ? <ul className="text-sm">{report.analysis.gaps.map((g, i) => <li key={i}>{g.from} → {g.to} ({g.months} months)</li>)}</ul> : <p className="text-sm text-gray-500">None found.</p>}</div>
            <div><Label>Terms only in older resumes</Label>{report.analysis.onlyInOlder.length ? <div className="flex flex-wrap gap-1">{report.analysis.onlyInOlder.slice(0, 14).map((t) => <Badge key={t} tone="blue">{t}</Badge>)}</div> : <p className="text-sm text-gray-500">None.</p>}</div>
          </div>
          {!items.length && <p className="text-sm text-gray-600">Your profile already contains everything in these resumes.</p>}
          {groups.map(([g, xs]) => <div key={g}><h3 className="mb-1 text-sm font-semibold">{g}</h3><div className="space-y-2">{xs.map((i) => (
            <div key={i.id} className={cx("rounded-md border p-3", i.kind === "conflict" ? "border-amber-300" : "border-line")}>
              <div className="mb-1 flex flex-wrap items-center gap-2"><Badge tone={i.kind === "conflict" ? "amber" : i.safe ? "green" : "blue"}>{i.kind === "conflict" ? "conflict" : i.kind === "bullet-detail" ? "more detail" : "new"}</Badge><span className="text-xs text-gray-500">{i.label} · from {i.source}</span><Badge tone={i.decision === "accepted" ? "green" : i.decision === "rejected" ? "gray" : "amber"}>{i.decision}</Badge></div>
              {i.current && <p className="text-sm"><span className="text-xs uppercase text-gray-500">Current </span>{i.current}</p>}
              <p className="text-sm"><span className="text-xs uppercase text-gray-500">{i.current ? "Other " : "Add "}</span>{i.proposed}</p>
              {i.note && <p className="text-xs text-gray-500">{i.note}</p>}
              <div className="mt-2 flex gap-2"><Button size="sm" onClick={() => decide(i.id, "accepted")}>{i.current ? "Use this" : "Add"}</Button><Button size="sm" variant="outline" onClick={() => decide(i.id, "rejected")}>{i.current ? "Keep current" : "Skip"}</Button></div>
            </div>))}</div></div>)}
        </Card>
      )}
      {profile ? <ProfileEditor profile={profile} setProfile={setProfile} say={say} goAnalyze={goAnalyze} /> : <Card className="text-sm text-gray-600">{resumes.length ? `No profile yet. ${resumes.length} resume${resumes.length > 1 ? "s" : ""} in the library: add any others, then select Build profile.` : "No profile yet. Add your resumes (or load the demo profile) to begin."}</Card>}
    </div>
  );
}


function ParseReview({ review, profile, setProfile, close }: { review: { name: string; diag: ParseDiagnostics; source: string }; profile: Profile | null; setProfile: (p: Profile) => void; close: () => void }) {
  const [left, setLeft] = useState<string[]>(review.diag.unplaced);
  const [target, setTarget] = useState<Record<string, string>>({});
  useEffect(() => setLeft(review.diag.unplaced), [review]);
  const d = review.diag;
  const place = (line: string) => {
    const t = target[line] ?? "dismiss";
    if (profile && t.startsWith("role:")) { const id = t.slice(5); setProfile({ ...profile, roles: profile.roles.map((r) => (r.id === id ? { ...r, responsibilities: [...r.responsibilities, line.replace(/^[•\-–*]\s*/, "")] } : r)) }); }
    else if (profile && t === "achievement") setProfile({ ...profile, achievements: [...profile.achievements, line] });
    else if (profile && t === "summary") setProfile({ ...profile, summary: [profile.summary, line].filter(Boolean).join(" ") });
    setLeft((xs) => xs.filter((x) => x !== line));
  };
  return (
    <Card className="space-y-3" id="parse-review">
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold">Parse review · {review.name}</h2><div className="flex items-center gap-2"><Badge tone={d.confidence === "High" ? "green" : d.confidence === "Medium" ? "amber" : "red"}>{d.confidence} confidence</Badge><span className="font-mono text-xs text-gray-500">{Math.round(d.coverage * 100)}% of text placed</span><Button size="sm" variant="ghost" onClick={close}>Close</Button></div></div>
      <p className="text-xs text-gray-500">Parsed with the {review.source}. {d.confidence === "High" && !left.length ? "Nothing needs attention, but still skim the profile below." : "Check the items below, then correct the profile."}</p>
      {d.flags.length > 0 && <ul className="list-disc space-y-1 pl-5 text-sm">{d.flags.map((f, i) => <li key={i} className={f.level === "error" ? "text-red-800" : "text-amber-800"}>{f.message}</li>)}</ul>}
      {left.length > 0 && <div><Label>Lines the parser could not place</Label><div className="space-y-2">{left.map((l) => <div key={l} className="grid items-center gap-2 rounded-md border border-line p-2 md:grid-cols-[1fr_14rem_auto]"><span className="text-sm">{l}</span>
        <Select aria-label={`Where to put: ${l.slice(0, 30)}`} value={target[l] ?? "dismiss"} onChange={(e) => setTarget({ ...target, [l]: e.target.value })}><option value="dismiss">Ignore</option>{profile?.roles.map((r) => <option key={r.id} value={`role:${r.id}`}>Bullet in {r.title || "role"} @ {r.employer || "?"}</option>)}<option value="achievement">Key achievement</option><option value="summary">Append to summary</option></Select>
        <Button size="sm" variant="outline" onClick={() => place(l)}>Apply</Button></div>)}</div></div>}
    </Card>
  );
}

function ProfileEditor({ profile: p, setProfile, say, goAnalyze }: { profile: Profile; setProfile: (p: Profile) => void; say: any; goAnalyze: () => void }) {
  const setRole = (i: number, patch: Partial<Role>) => setProfile({ ...p, roles: p.roles.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const id = (k: keyof Profile["identity"], label: string) => <div key={k}><Label htmlFor={`id-${k}`}>{label}</Label><Input id={`id-${k}`} value={p.identity[k]} onChange={(e) => setProfile({ ...p, identity: { ...p.identity, [k]: e.target.value } })} /></div>;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Career profile</h2><Button onClick={goAnalyze}>Analyze a job →</Button></div>
      <p className="text-sm text-gray-600">This is the single source of truth. Every generated claim is checked against it, so correct anything the parser got wrong. Changes save automatically.</p>
      <Card><h3 className="mb-3 text-sm font-semibold">Identity</h3><div className="grid gap-3 md:grid-cols-3">{id("name", "Name")}{id("location", "Location")}{id("email", "Email")}{id("phone", "Phone")}{id("linkedin", "LinkedIn")}{id("github", "GitHub")}{id("portfolio", "Portfolio")}</div></Card>
      <Card><Label htmlFor="summary">Summary (your own words)</Label><Textarea id="summary" rows={3} value={p.summary} onChange={(e) => setProfile({ ...p, summary: e.target.value })} /></Card>
      {p.roles.map((r, i) => (
        <Card key={r.id} className="space-y-3">
          <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">{r.title || "Role"} {r.employer && `· ${r.employer}`}</h3><button className="text-xs text-red-600 underline" onClick={() => setProfile({ ...p, roles: p.roles.filter((_, j) => j !== i) })}>Remove</button></div>
          <div className="grid gap-3 md:grid-cols-3">{([["title", "Title"], ["employer", "Employer"], ["client", "Customer / client"], ["location", "Location"], ["startDate", "Start (e.g. Jan 2020)"], ["endDate", "End (or Present)"], ["employmentType", "Employment type"], ["teamSize", "Team size (only if stated)"]] as const).map(([k, l]) => <div key={k}><Label htmlFor={`r${i}-${k}`}>{l}</Label><Input id={`r${i}-${k}`} value={r[k]} onChange={(e) => setRole(i, { [k]: e.target.value } as Partial<Role>)} /></div>)}</div>
          <div><Label htmlFor={`r${i}-resp`}>Responsibilities (one bullet per line)</Label><Textarea id={`r${i}-resp`} rows={6} value={lines(r.responsibilities)} onChange={(e) => setRole(i, { responsibilities: unLines(e.target.value) })} /></div>
          <div><Label htmlFor={`r${i}-ach`}>Achievements with real metrics (one per line)</Label><Textarea id={`r${i}-ach`} rows={3} value={lines(r.achievements)} onChange={(e) => setRole(i, { achievements: unLines(e.target.value) })} /></div>
          <div className="grid gap-3 md:grid-cols-2">{([["technologies", "Technologies"], ["tools", "Tools"], ["protocols", "Protocols"], ["methodologies", "Methodologies"]] as const).map(([k, l]) => <div key={k}><Label htmlFor={`r${i}-${k}`}>{l} (comma separated)</Label><Input id={`r${i}-${k}`} value={csv(r[k])} onChange={(e) => setRole(i, { [k]: unCsv(e.target.value) } as Partial<Role>)} /></div>)}</div>
          <div className="grid gap-3 md:grid-cols-2">{([["leadership", "Leadership responsibility"], ["technicalOwnership", "Technical ownership"], ["architectureOwnership", "Architecture ownership"], ["customerFacing", "Customer-facing responsibility"]] as const).map(([k, l]) => <div key={k}><Label htmlFor={`r${i}-${k}`}>{l}</Label><Textarea id={`r${i}-${k}`} rows={2} value={r[k]} onChange={(e) => setRole(i, { [k]: e.target.value } as Partial<Role>)} /></div>)}</div>
        </Card>
      ))}
      <Button variant="outline" onClick={() => setProfile({ ...p, roles: [...p.roles, { id: `r${Date.now().toString(36)}`, employer: "", client: "", title: "", location: "", startDate: "", endDate: "", employmentType: "", responsibilities: [], achievements: [], technologies: [], methodologies: [], protocols: [], tools: [], leadership: "", teamSize: "", technicalOwnership: "", architectureOwnership: "", customerFacing: "" }] })}>+ Add role</Button>
      <Card className="space-y-3"><h3 className="text-sm font-semibold">Technical skills</h3>{SKILL_CATEGORIES.map((k) => <div key={k}><Label htmlFor={`sk-${k}`}>{SKILL_LABEL[k]}</Label><Input id={`sk-${k}`} value={csv(p.skills[k])} onChange={(e) => setProfile({ ...p, skills: { ...p.skills, [k]: unCsv(e.target.value) } })} /></div>)}</Card>
      <Card className="space-y-3"><h3 className="text-sm font-semibold">Education</h3>
        {p.education.map((e, i) => <div key={i} className="grid gap-3 md:grid-cols-4">{(["degree", "university", "specialization", "year"] as const).map((k) => <div key={k}><Label htmlFor={`ed${i}-${k}`}>{k}</Label><Input id={`ed${i}-${k}`} value={e[k]} onChange={(ev) => setProfile({ ...p, education: p.education.map((x, j) => (j === i ? { ...x, [k]: ev.target.value } : x)) })} /></div>)}</div>)}
        <Button variant="outline" size="sm" onClick={() => setProfile({ ...p, education: [...p.education, { degree: "", university: "", specialization: "", year: "" }] })}>+ Add education</Button></Card>
      <Card className="space-y-3"><h3 className="text-sm font-semibold">Projects <span className="font-normal text-gray-500">(used for the presentation)</span></h3>
        {p.projects.map((pr, i) => { const setPr = (patch: Partial<typeof pr>) => setProfile({ ...p, projects: p.projects.map((x, j) => (j === i ? { ...x, ...patch } : x)) }); return (
          <div key={pr.id} className="space-y-2 rounded-md border border-line p-3">
            <div className="grid gap-3 md:grid-cols-3"><div><Label htmlFor={`pj${i}-n`}>Name</Label><Input id={`pj${i}-n`} value={pr.name} onChange={(e) => setPr({ name: e.target.value })} /></div><div><Label htmlFor={`pj${i}-e`}>Employer / context</Label><Input id={`pj${i}-e`} value={pr.employer} onChange={(e) => setPr({ employer: e.target.value })} /></div><div><Label htmlFor={`pj${i}-p`}>Period</Label><Input id={`pj${i}-p`} value={pr.period} onChange={(e) => setPr({ period: e.target.value })} /></div></div>
            <div><Label htmlFor={`pj${i}-h`}>Highlights (one per line)</Label><Textarea id={`pj${i}-h`} rows={4} value={lines([pr.summary, ...pr.highlights].filter(Boolean))} onChange={(e) => { const ls = unLines(e.target.value); setPr({ summary: "", highlights: ls }); }} /></div>
            <div><Label htmlFor={`pj${i}-t`}>Technologies (comma separated)</Label><Input id={`pj${i}-t`} value={csv(pr.technologies)} onChange={(e) => setPr({ technologies: unCsv(e.target.value) })} /></div>
            <button className="text-xs text-red-800 underline" onClick={() => setProfile({ ...p, projects: p.projects.filter((_, j) => j !== i) })}>Remove project</button>
          </div>); })}
        <Button variant="outline" size="sm" onClick={() => setProfile({ ...p, projects: [...p.projects, { id: `pj${Date.now().toString(36)}`, name: "", employer: "", period: "", summary: "", highlights: [], technologies: [] }] })}>+ Add project</Button>
        <div><Label htmlFor="achv">Key achievements and awards (one per line, real results only)</Label><Textarea id="achv" rows={3} value={lines(p.achievements)} onChange={(e) => setProfile({ ...p, achievements: unLines(e.target.value) })} /></div>
      </Card>
      <Card className="grid gap-3 md:grid-cols-2"><div><Label htmlFor="certs">Certifications (one per line)</Label><Textarea id="certs" rows={3} value={lines(p.certifications)} onChange={(e) => setProfile({ ...p, certifications: unLines(e.target.value) })} /></div><div><Label htmlFor="pubs">Publications / patents (one per line)</Label><Textarea id="pubs" rows={3} value={lines(p.publications)} onChange={(e) => setProfile({ ...p, publications: unLines(e.target.value) })} /></div></Card>
    </div>
  );
}

/* ---------- Analyze ---------- */
function AnalyzeView({ profile, run, say, onDone, provider, claudeOn, weights }: any) {
  const [jd, setJd] = useState("");
  const [f, setF] = useState({ company: "", title: "", country: "USA", seniority: "Principal", length: "3", url: "" });
  const set = (k: string) => (e: React.ChangeEvent<any>) => setF({ ...f, [k]: e.target.value });
  if (!profile) return <Card className="text-sm text-gray-600">Create your career profile first (Profile tab).</Card>;
  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <Card className="space-y-3 lg:col-span-3">
        <div className="flex items-center justify-between"><Label htmlFor="jd">Job description</Label><button className="text-xs underline" onClick={() => setJd(DEMO_JD_TEXT)}>Use sample JD</button></div>
        <Textarea id="jd" rows={22} value={jd} onChange={(e) => setJd(e.target.value)} placeholder={adapter.fetchJob ? "Paste the full job description, or fetch it from a URL below." : "Paste the full job description. Job pages can't be fetched from inside Claude, so paste the text."} />
        <div><Label htmlFor="jurl">Job URL {adapter.fetchJob ? "(fetch fills the description)" : "(for your records)"}</Label><div className="flex gap-2"><Input id="jurl" value={f.url} onChange={set("url")} placeholder="https://…" />{adapter.fetchJob && <Button variant="outline" disabled={!f.url} onClick={() => run("Fetching job page…", async () => setJd(await adapter.fetchJob!(f.url)))}>Fetch</Button>}</div></div>
      </Card>
      <Card className="space-y-3 lg:col-span-2">
        <h2 className="text-sm font-semibold">Target</h2>
        <p className="text-sm text-gray-600">Profile: <b>{profile.identity.name || "Unnamed"}</b> · {profile.roles.length} roles</p>
        <div><Label htmlFor="co">Company (auto-detected if blank)</Label><Input id="co" value={f.company} onChange={set("company")} /></div>
        <div><Label htmlFor="ti">Target role (auto-detected if blank)</Label><Input id="ti" value={f.title} onChange={set("title")} /></div>
        <div><Label htmlFor="ct">Target country</Label><Select id="ct" value={f.country} onChange={set("country")}>{COUNTRY_NAMES.map((c) => <option key={c}>{c}</option>)}</Select></div>
        <div><Label htmlFor="sn">Desired seniority</Label><Select id="sn" value={f.seniority} onChange={set("seniority")}>{["Engineer", "Senior", "Staff", "Principal", "Architect", "Lead", "Manager"].map((c) => <option key={c}>{c}</option>)}</Select></div>
        <div><Label htmlFor="ln">Resume length</Label><Select id="ln" value={f.length} onChange={set("length")}>{[["1", "1 page"], ["2", "2 pages"], ["3", "3 pages"], ["4", "4 pages"], ["cv", "Detailed technical CV"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></div>
        <Button className="w-full" disabled={jd.length < 80} onClick={() => run(claudeOn ? "Analyzing with Claude…" : "Analyzing…", async () => onDone(await analyze(profile, provider, { jdText: jd, jobUrl: f.url, company: f.company, title: f.title, settings: SettingsSchema.parse({ targetRole: f.title, country: f.country, seniority: f.seniority, length: f.length, weights }) })))}>Analyze match</Button>
      </Card>
    </div>
  );
}

/* ---------- Applications ---------- */
function AppsList({ apps: all, open }: { apps: AppRecord[]; open: (id: string) => void }) {
  const [filter, setFilter] = useState("ALL");
  const apps = filter === "ALL" ? all : all.filter((a) => a.status === filter);
  const counts = new Map<string, number>(); for (const a of all) counts.set(a.status, (counts.get(a.status) ?? 0) + 1);
  const week = Date.now() - 7 * 864e5, thisWeek = all.filter((a) => new Date(a.createdAt).getTime() > week).length;
  const progressed = all.filter((a) => !["SAVED", "ANALYZED", "APPLYING"].includes(a.status));
  const interviews = all.filter((a) => ["SCREENING", "TECHNICAL_ROUND", "HIRING_MANAGER", "FINAL_ROUND", "OFFER"].includes(a.status)).length;
  const responded = progressed.filter((a) => !["APPLIED", "WITHDRAWN"].includes(a.status)).length;
  const avg = all.length ? Math.round(all.reduce((s, a) => s + a.match.overall, 0) / all.length) : null;
  const gaps = new Map<string, number>(), skills = new Map<string, number>();
  for (const a of all) for (const r of a.match.requirements) { if (r.gap !== "none" && r.gap !== "keyword-only") gaps.set(r.requirement, (gaps.get(r.requirement) ?? 0) + 1); if (r.score >= 0.9 && r.type !== "experience" && r.type !== "education") skills.set(r.requirement, (skills.get(r.requirement) ?? 0) + 1); }
  const top = (m: Map<string, number>) => [...m.entries()].sort((a: [string, number], b: [string, number]) => b[1] - a[1]).slice(0, 5);
  if (!all.length) return <Card className="text-sm text-gray-600">No applications yet. Analyze a job to create one.</Card>;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        <Card><div className="text-xs uppercase text-gray-500">Applications · this week</div><div className="font-mono text-2xl">{all.length} · {thisWeek}</div></Card>
        <Card><div className="text-xs uppercase text-gray-500">Average match</div><div className="font-mono text-2xl">{avg}</div></Card>
        <Card><div className="text-xs uppercase text-gray-500">Top skills</div><div className="text-sm">{top(skills).map(([k]) => k).join(", ") || "–"}</div></Card>
        <Card><div className="text-xs uppercase text-gray-500">Frequent gaps</div><div className="text-sm">{top(gaps).map(([k]) => k).join(", ") || "–"}</div></Card>
      </div>
      <div className="grid gap-3 md:grid-cols-3"><Card><div className="text-xs uppercase text-gray-500">Interviews</div><div className="font-mono text-2xl">{interviews}</div></Card><Card><div className="text-xs uppercase text-gray-500">Offers</div><div className="font-mono text-2xl">{counts.get("OFFER") ?? 0}</div></Card><Card><div className="text-xs uppercase text-gray-500">Response rate</div><div className="font-mono text-2xl">{progressed.length ? `${Math.round((responded / progressed.length) * 100)}%` : "–"}</div></Card></div>
      <div className="flex flex-wrap gap-1" role="group" aria-label="Pipeline">{[["ALL", all.length] as [string, number], ...STATUSES.filter((st) => counts.has(st)).map((st) => [st, counts.get(st)!] as [string, number])].map(([st, n]) => <button key={st} onClick={() => setFilter(st)} className={cx("rounded-md border border-line px-2 py-1 text-xs", filter === st && "bg-view text-on-view")}>{st === "ALL" ? "All" : st.replace(/_/g, " ")} <span className="font-mono">{n}</span></button>)}</div>
      <Card className="overflow-x-auto p-0"><table className="w-full text-sm"><thead className="border-b border-line text-left text-xs uppercase text-gray-500"><tr><th className="p-3">Role</th><th>Company</th><th>Match</th><th>Verdict</th><th>Status</th><th>Created</th></tr></thead>
        <tbody>{apps.map((a) => <tr key={a.id} className="border-b border-line last:border-0 hover:bg-gray-50"><td className="p-3"><button className="text-left underline" onClick={() => open(a.id)}>{a.roleTitle || "Untitled"}</button></td><td>{a.company}</td><td className="font-mono">{a.match.overall}</td><td><Badge tone={a.match.recommendation.verdict.includes("GAPS") ? "amber" : a.match.recommendation.verdict.match(/LOW|DO NOT/) ? "red" : "green"}>{a.match.recommendation.verdict}</Badge></td><td>{a.status.replace(/_/g, " ")}</td><td>{new Date(a.createdAt).toLocaleDateString()}</td></tr>)}</tbody></table></Card>
    </div>
  );
}

const TABS = ["Overview", "Strategy", "Requirements", "Skill Match", "Resume Changes", "Cover Letter", "LinkedIn", "Recruiter Messages", "Interview Prep", "Truth Audit", "Tracking"];
function AppDetail({ app: a, profile, update, back, remove, provider, run, say, downloads, theme }: any) {
  const [tab, setTab] = useState("Overview");
  const doc = useMemo(() => { try { return a.tailored ? finalDocs(a, profile) : null; } catch { return null; } }, [a, profile]);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><button className="text-xs underline" onClick={back}>← All applications</button><h2 className="text-xl font-semibold">{a.roleTitle || "Untitled role"}</h2><p className="text-sm text-gray-600">{a.company || "Unknown company"} · {a.settings.country} · {a.settings.seniority} · {a.settings.length === "cv" ? "detailed CV" : `${a.settings.length} page(s)`}</p></div>
        <Badge tone={a.match.overall >= 75 ? "green" : a.match.overall >= 55 ? "amber" : "red"} className="text-base">{a.match.recommendation.verdict} · {a.match.overall}</Badge>
      </div>
      <div role="tablist" className="flex flex-wrap border-b border-line">{TABS.map((t) => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cx("border-b-2 px-3 py-2 text-sm", tab === t ? "border-view font-semibold text-view" : "border-transparent text-gray-600 hover:text-view")}>{t}</button>)}</div>
      {tab === "Overview" && <Overview a={a} profile={profile} />}
      {tab === "Strategy" && <StrategyTab a={a} profile={profile} />}
      {tab === "Requirements" && <Requirements a={a} />}
      {tab === "Skill Match" && <SkillMatch a={a} />}
      {tab === "Resume Changes" && <ResumeChanges a={a} profile={profile} update={update} provider={provider} run={run} say={say} doc={doc} downloads={downloads} theme={a.theme ?? theme} setTheme={(t: string) => update({ ...a, theme: t })} />}
      {tab === "Cover Letter" && <CoverLetterTab a={a} profile={profile} update={update} provider={provider} run={run} say={say} doc={doc} downloads={downloads} />}
      {tab === "LinkedIn" && <LinkedInTab a={a} profile={profile} update={update} provider={provider} run={run} say={say} />}
      {tab === "Recruiter Messages" && <OutreachTab a={a} profile={profile} update={update} provider={provider} run={run} say={say} />}
      {tab === "Interview Prep" && <InterviewTab a={a} profile={profile} update={update} provider={provider} run={run} />}
      {tab === "Truth Audit" && <TruthAudit a={a} doc={doc} profile={profile} downloads={downloads} say={say} />}
      {tab === "Tracking" && <Tracking a={a} update={update} remove={remove} say={say} />}
    </div>
  );
}

function Overview({ a, profile }: { a: AppRecord; profile: Profile }) {
  const issues = useMemo(() => auditCredibility(profile), [profile]);
  const [open, setOpen] = useState("overall");
  const sel = a.match.scores.find((s) => s.key === open);
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2"><h3 className="mb-1 text-sm font-semibold">Scores <span className="font-normal text-gray-500">· select one to see why</span></h3>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">{a.match.scores.map((s) => <button key={s.key} onClick={() => setOpen(s.key)} className={cx("rounded-md border p-3 text-left", open === s.key ? "border-view bg-view-soft" : "border-line hover:border-view")}><div className="text-xs text-gray-500">{s.label}</div><div className="font-mono text-2xl font-semibold">{s.value}</div><div className="mt-1 h-1.5 rounded bg-gray-100"><div className="sco-meter h-1.5 rounded" data-band={band(s.value)} style={{ width: `${s.value}%` }} /></div></button>)}</div>
          {sel && <div className="mt-3 rounded-md bg-gray-50 p-3 text-sm"><b>{sel.label}: {sel.value}</b><ul className="mt-1 list-disc pl-5 text-gray-700">{sel.why.map((w, i) => <li key={i}>{w}</li>)}</ul></div>}
        </Card>
        <Card><h3 className="mb-2 text-sm font-semibold">Recommendation</h3><div className="mb-2 text-lg font-semibold">{a.match.recommendation.verdict}</div><ul className="list-disc space-y-1 pl-5 text-sm">{a.match.recommendation.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul><h4 className="mb-1 mt-4 text-xs font-semibold uppercase text-gray-500">Seniority</h4><p className="text-sm">Resume communicates <b>{a.match.seniority.detected}</b>; JD seniority: {a.jd.seniority}.</p></Card>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card><h3 className="mb-2 text-sm font-semibold">Gaps</h3>{a.match.gaps.length ? a.match.gaps.map((g) => <div key={g.term} className="border-b border-line py-2 text-sm last:border-0"><b>{g.term}</b> <Badge tone={g.gap === "critical" ? "red" : g.gap === "medium" ? "amber" : "gray"}>{g.gap}</Badge> <Badge tone={g.kind === "presentation-gap" ? "blue" : "gray"}>{g.kind === "presentation-gap" ? "presentation gap" : "real skill gap"}</Badge><p className="mt-1 text-gray-600">{g.recommendation}</p></div>) : <p className="text-sm text-gray-500">No gaps found.</p>}</Card>
        <Card className="md:col-span-2"><h3 className="mb-2 text-sm font-semibold">Technical credibility <span className="font-normal text-gray-500">· things an interviewer or recruiter may question in your profile</span></h3>{issues.length ? issues.map((i, k) => <div key={k} className="border-b border-line py-2 text-sm last:border-0"><Badge tone={i.severity === "high" ? "red" : i.severity === "medium" ? "amber" : "gray"}>{i.severity}</Badge> <b>{i.area}</b>: {i.message}<p className="text-xs text-gray-600"><b>Fix:</b> {i.fix}</p></div>) : <p className="text-sm text-gray-500">No credibility issues found.</p>}</Card>
        <Card><h3 className="mb-2 text-sm font-semibold">Weak bullets in your resume</h3>{a.match.seniority.weakBullets.slice(0, 8).map((w, i) => <div key={i} className="border-b border-line py-2 text-sm last:border-0">“{w.text}”<p className="text-xs text-gray-500">{w.reason}</p></div>)}{!a.match.seniority.weakBullets.length && <p className="text-sm text-gray-500">None detected.</p>}</Card>
      </div>
    </div>
  );
}

function Requirements({ a }: { a: AppRecord }) {
  return <Card className="overflow-x-auto p-0"><table className="w-full text-sm"><thead className="border-b border-line text-left text-xs uppercase text-gray-500"><tr><th className="p-3">JD requirement</th><th>Importance</th><th>Resume evidence</th><th>Match</th><th>Confidence</th><th>Action</th></tr></thead>
    <tbody>{a.match.requirements.map((r) => <tr key={r.requirementId} className="border-b border-line align-top last:border-0"><td className="p-3 font-medium">{r.requirement}</td><td>{r.importance}</td><td className="max-w-md py-3 pr-3 text-gray-700">{r.evidence[0] ? <><span className="text-xs text-gray-500">{r.evidence[0].roleLabel}</span><br />{r.evidence[0].text.slice(0, 160)}</> : <span className="text-gray-400">No evidence</span>}<p className="mt-1 text-xs text-gray-500">{r.explanation}</p></td><td><Badge tone={matchTone(r.matchType)}>{r.matchType}</Badge></td><td>{r.confidence}</td><td className="pr-3">{r.action}</td></tr>)}</tbody></table></Card>;
}

function SkillMatch({ a }: { a: AppRecord }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card><h3 className="mb-2 text-sm font-semibold">Keyword analysis</h3>{a.match.keywordAnalysis.map((k) => <div key={k.term} className="border-b border-line py-2 text-sm last:border-0"><div className="flex items-center justify-between"><b>{k.term}</b><span className="flex items-center gap-2 text-xs text-gray-500">JD ×{k.jdMentions}<Badge tone={matchTone(k.matchType)}>{k.matchType}</Badge></span></div>{k.why && <p className="mt-1 text-gray-600"><b>Why:</b> {k.why}</p>}</div>)}</Card>
      <div className="space-y-4">
        <Card><h3 className="mb-2 text-sm font-semibold">Strengths (mandatory, fully matched)</h3><div className="flex flex-wrap gap-1">{a.match.strengths.map((s) => <Badge key={s} tone="green">{s}</Badge>)}</div></Card>
        <Card><h3 className="mb-2 text-sm font-semibold">JD profile</h3><dl className="space-y-1 text-sm"><div><dt className="inline text-gray-500">Seniority: </dt>{a.jd.seniority}</div><div><dt className="inline text-gray-500">Years required: </dt>{a.jd.yearsRequired ?? "not stated"}</div><div><dt className="inline text-gray-500">Education: </dt>{a.jd.education || "not stated"}</div><div><dt className="inline text-gray-500">Location: </dt>{a.jd.location || "not stated"}</div><div><dt className="inline text-gray-500">Work authorization: </dt>{a.jd.workAuthorization || "not mentioned"}</div></dl>
          {a.jd.leadershipExpectations.length > 0 && <><h4 className="mt-3 text-xs font-semibold uppercase text-gray-500">Leadership expectations</h4><ul className="list-disc pl-5 text-sm">{a.jd.leadershipExpectations.map((l, i) => <li key={i}>{l}</li>)}</ul></>}
          {a.jd.architectureExpectations.length > 0 && <><h4 className="mt-3 text-xs font-semibold uppercase text-gray-500">Architecture expectations</h4><ul className="list-disc pl-5 text-sm">{a.jd.architectureExpectations.map((l, i) => <li key={i}>{l}</li>)}</ul></>}</Card>
      </div>
    </div>
  );
}

async function save(downloads: any, filename: string, data: Blob | ArrayBuffer, say: any) {
  if (!downloads) { say("err", "Saving files is unavailable in this view."); return; }
  try { await downloads.save({ filename, data }); say("ok", `Saved ${filename}.`); } catch (e: any) { if (e?.code !== "declined") say("err", `Could not save: ${e?.message ?? e?.code}`); }
}

function DownloadRow({ a, profile, doc, kinds, downloads, say, theme }: any) {
  const name = profile.identity.name || "Candidate";
  const guard = (ok: boolean, claims: any[]) => { if (!ok) { say("err", "POTENTIAL HALLUCINATION: unsupported claims remain. " + claims.map((c: any) => `“${c.text}” — ${c.reasons.join(" ")}`).join(" | ")); return false; } return true; };
  const fitted = () => fitResume(doc.resume, a.settings.length, theme);
  const act: Record<string, () => Promise<void>> = {
    "resume-pdf": async () => { if (guard(doc.audit.passed, doc.audit.hallucinations)) { const f = fitted(); await save(downloads, packName(name, a.company, "Resume", "pdf"), resumePdf(f.resume, a.settings.length, theme).data, say); } },
    "resume-docx": async () => { if (guard(doc.audit.passed, doc.audit.hallucinations)) { const f = fitted(); await save(downloads, packName(name, a.company, "Resume", "docx"), await resumeDocxBlob(f.resume, theme), say); } },
    "cover-pdf": async () => { if (guard(!doc.letterAudit || doc.letterAudit.passed, doc.letterAudit?.hallucinations ?? [])) await save(downloads, packName(name, a.company, "CoverLetter", "pdf"), coverLetterPdf(a.letter, profile.identity), say); },
    "cover-docx": async () => { if (guard(!doc.letterAudit || doc.letterAudit.passed, doc.letterAudit?.hallucinations ?? [])) await save(downloads, packName(name, a.company, "CoverLetter", "docx"), await coverDocxBlob(a.letter, profile.identity), say); },
    "report-pdf": async () => save(downloads, packName(name, a.company, "MatchReport", "pdf"), reportPdf({ candidate: name, company: a.company, role: a.roleTitle, jd: a.jd, match: a.match, audit: doc?.audit, strategy: planStrategy(profile, a.jd, a.match, a.settings), credibility: auditCredibility(profile) }), say),
  };
  const L: Record<string, string> = { "resume-pdf": "Resume (PDF)", "resume-docx": "Resume (DOCX)", "cover-pdf": "Cover letter (PDF)", "cover-docx": "Cover letter (DOCX)", "report-pdf": "Match report (PDF)" };
  return <div className="flex flex-wrap gap-2">{kinds.map((k: string) => <Button key={k} variant="outline" disabled={!downloads || !doc} onClick={act[k]}>Download {L[k]}</Button>)}{!downloads && <span className="self-center text-xs text-gray-500">File saving is only available when this page runs inside Claude.</span>}</div>;
}

function ResumeChanges({ a, profile, update, provider, run, say, doc, downloads, theme, setTheme }: any) {
  const [edit, setEdit] = useState<{ id: string; text: string } | null>(null);
  const gen = () => run("Generating application pack…", async () => update(await generate(profile, provider, a)));
  const act = (id: string, d: any, text?: string) => { try { const r = decide(a, profile, id, d, text); update(r.app); setEdit(null); if (r.warning) say("err", r.warning); } catch (e: any) { say("err", e.message); } };
  const pending = a.changes.filter((c: any) => c.decision === "pending").length;
  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-gray-700">{a.tailored ? <>{a.changes.length} proposed changes · <b>{pending}</b> pending. Nothing is applied until you accept it. Page-fit trimming and reordering of your own bullets is automatic; wording never changes without approval.</> : "Generate a tailored resume, cover letter and truth audit from this analysis."}</p>
        <div className="flex gap-2">{a.tailored && <Button variant="outline" onClick={() => update(acceptAllSafe(a))}>Accept all safe changes</Button>}<Button onClick={() => { if (a.tailored && a.changes.some((c: any) => c.decision !== "pending")) say("ok", "Regenerating replaces your decisions."); gen(); }}>{a.tailored ? "Regenerate" : "Generate application pack"}</Button></div>
      </Card>
      {a.changes.map((c: any) => (
        <Card key={c.id} className={cx(c.status === "UNSUPPORTED" && "border-red-300")}>
          <div className="mb-2 flex flex-wrap items-center gap-2"><Badge>{c.section}</Badge><Badge tone={statusTone(c.status)}>{c.status}</Badge>{c.hallucination && <Badge tone="red">POTENTIAL HALLUCINATION</Badge>}<Badge tone={c.decision === "accepted" || c.decision === "edited" ? "green" : c.decision === "rejected" ? "gray" : "amber"}>{c.decision}</Badge></div>
          <div className="grid gap-3 md:grid-cols-2">
            <div><Label>Original</Label><p className="whitespace-pre-wrap rounded bg-gray-50 p-2 text-sm">{c.original || <span className="text-gray-400">(none)</span>}</p></div>
            <div><Label>Proposed{c.decision === "edited" ? " (your edit)" : ""}</Label>{edit && edit.id === c.id ? <Textarea rows={4} value={edit.text} onChange={(e) => setEdit({ id: c.id, text: e.target.value })} /> : <p className="whitespace-pre-wrap rounded bg-green-50 p-2 text-sm">{c.decision === "edited" && c.finalText ? c.finalText : c.proposed}</p>}</div>
          </div>
          <p className="mt-2 text-sm text-gray-700"><b>Why:</b> {c.reason}</p><p className="text-xs text-gray-500"><b>Evidence:</b> {c.evidence}</p>
          <div className="mt-3 flex gap-2">{edit && edit.id === c.id ? <><Button size="sm" onClick={() => act(c.id, "edited", edit.text)}>Save edit</Button><Button size="sm" variant="ghost" onClick={() => setEdit(null)}>Cancel</Button></> : <><Button size="sm" disabled={c.status === "UNSUPPORTED"} onClick={() => act(c.id, "accepted")}>Accept</Button><Button size="sm" variant="outline" onClick={() => act(c.id, "rejected")}>Reject</Button><Button size="sm" variant="ghost" onClick={() => setEdit({ id: c.id, text: c.decision === "edited" && c.finalText ? c.finalText : c.proposed })}>Edit</Button></>}</div>
        </Card>
      ))}
      {doc && <ExportCard a={a} profile={profile} doc={doc} downloads={downloads} say={say} theme={theme} setTheme={setTheme} run={run} />}
    </div>
  );
}


function ExportCard({ a, profile, doc, downloads, say, theme, setTheme, run }: any) {
  const [ats, setAts] = useState<AtsReport | null>(null);
  const fit = useMemo(() => fitResume(doc.resume, a.settings.length, theme), [doc.resume, a.settings.length, theme]);
  const th = themeById(theme);
  const check = () => run("Running ATS check on the exported PDF…", async () => {
    const pdf = resumePdf(fit.resume, a.settings.length, theme);
    const ex = await extractPdfBytes(pdf.data.slice(0));
    setAts(atsParse(ex.text, ex.layout));
  });
  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h3 className="text-sm font-semibold">Resume as it will be exported</h3>
        <div className="flex items-end gap-3"><div><Label htmlFor="theme">Design theme</Label><Select id="theme" value={theme} onChange={(e) => setTheme(e.target.value)}>{THEMES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</Select></div><Badge tone={th.risk === "Low" ? "green" : "amber"}>ATS risk: {th.risk}</Badge></div>
      </div>
      <p className="text-xs text-gray-500">{th.note}</p>
      <p className="text-sm">{fit.target ? <>Fits <b>{fit.pages}</b> page(s) of the {fit.target} requested{fit.trimmed ? <>; <b>{fit.trimmed}</b> lowest-ranked item(s) left out to fit (nothing reworded).</> : "."}{fit.pages > fit.target && <span className="text-amber-800"> Still over the target: shorten the profile text or choose more pages.</span>}</> : <>Detailed CV: {fit.pages} page(s), nothing trimmed.</>}</p>
      <ResumePreview r={fit.resume} />
      <div className="flex flex-wrap items-center gap-2"><DownloadRow a={a} profile={profile} doc={doc} kinds={["resume-pdf", "resume-docx"]} downloads={downloads} say={say} theme={theme} /><Button variant="outline" onClick={check}>Run ATS check on this PDF</Button></div>
      {ats && <AtsPanel r={ats} />}
    </Card>
  );
}

function AtsPanel({ r }: { r: AtsReport }) {
  return (
    <div className="space-y-3 rounded-md border border-line p-3">
      <div className="flex items-center gap-2"><b className="text-sm">ATS parse risk</b><Badge tone={r.risk === "Low" ? "green" : r.risk === "Medium" ? "amber" : "red"}>{r.risk}</Badge></div>
      <ul className="space-y-1 text-sm">{r.checks.map((c) => <li key={c.id} className="flex gap-2"><span className={cx("w-4 font-mono", c.status === "pass" ? "text-green-800" : c.status === "warn" ? "text-amber-800" : "text-red-800")}>{c.status === "pass" ? "✓" : c.status === "warn" ? "△" : "✗"}</span><span><b>{c.label}.</b> {c.detail}</span></li>)}</ul>
      <div className="grid gap-3 md:grid-cols-2">
        <div><Label>What the parser extracted</Label><dl className="text-sm"><div><dt className="inline text-gray-500">Name: </dt>{r.extracted.name || "—"}</div><div><dt className="inline text-gray-500">Email: </dt>{r.extracted.email || "—"}</div><div><dt className="inline text-gray-500">Phone: </dt>{r.extracted.phone || "—"}</div><div><dt className="inline text-gray-500">Sections: </dt>{r.extracted.sections.join(", ") || "—"}</div></dl><ul className="mt-1 text-sm">{r.extracted.roles.map((x, i) => <li key={i}>{x.title || "?"} · {x.employer || "?"} · {x.dates || "no dates"}</li>)}</ul></div>
        <div><Label>Raw extracted text, in reading order</Label><pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-gray-50 p-2 text-xs">{r.text}</pre></div>
      </div>
    </div>
  );
}

function StrategyTab({ a, profile }: { a: AppRecord; profile: Profile }) {
  const st = useMemo(() => planStrategy(profile, a.jd, a.match, a.settings), [a, profile]);
  return (
    <div className="space-y-4">
      <Card><h3 className="text-sm font-semibold">Application strategy · {st.headline}</h3><p className="mt-1 text-xs text-gray-500">Advice derived from the analysis. It quotes your own evidence and never suggests claiming anything your profile does not support.</p></Card>
      <div className="grid gap-4 md:grid-cols-2">{st.sections.map((sec) => <Card key={sec.title}><h4 className="mb-2 text-sm font-semibold">{sec.title}</h4><ul className="list-disc space-y-1 pl-5 text-sm text-gray-700">{sec.items.map((it, i) => <li key={i}>{it}</li>)}</ul></Card>)}</div>
    </div>
  );
}

function VersionsView({ apps, open }: { apps: AppRecord[]; open: (id: string) => void }) {
  const packs = apps.filter((a) => a.tailored);
  if (!packs.length) return <Card className="text-sm text-gray-600">No generated packs yet. Open an application and generate its pack on the Resume Changes tab.</Card>;
  return (
    <Card className="overflow-x-auto p-0"><table className="w-full text-sm"><thead className="border-b border-line text-left text-xs uppercase text-gray-500"><tr><th className="p-3">Job</th><th>Pack</th><th>Generated</th><th>Changes accepted</th><th>Cover letter</th><th>Theme</th></tr></thead>
      <tbody>{packs.map((a) => { const acc = a.changes.filter((c) => c.decision === "accepted" || c.decision === "edited").length; return <tr key={a.id} className="border-b border-line last:border-0 hover:bg-gray-50"><td className="p-3"><button className="text-left underline" onClick={() => open(a.id)}>{a.roleTitle || "Untitled"}</button><div className="text-xs text-gray-500">{a.company}</div></td><td className="font-mono">v{a.packVersion ?? 1}</td><td>{a.packAt ? new Date(a.packAt).toLocaleDateString() : "–"}</td><td>{acc}/{a.changes.length}</td><td>{a.letter ? `${a.letter.wordCount} words` : "–"}</td><td>{themeById(a.theme).label}</td></tr>; })}</tbody></table></Card>
  );
}

function ResumePreview({ r }: { r: any }) {
  const Sec = ({ t, children }: any) => <div className="mt-3"><div className="mb-1 border-b border-gray-400 text-xs font-bold uppercase">{t}</div>{children}</div>;
  return (
    <div className="max-h-[600px] overflow-auto rounded border border-line bg-white p-5 text-sm leading-relaxed">
      <div className="text-lg font-bold">{r.identity.name}</div><div className="text-xs text-gray-600">{[r.identity.location, r.identity.email, r.identity.phone, r.identity.linkedin].filter(Boolean).join(" | ")}</div>
      {r.headline && <div className="mt-2 font-semibold">{r.headline}</div>}
      {r.summary && <Sec t="Professional summary"><p>{r.summary}</p></Sec>}
      {r.competencies.length > 0 && <Sec t="Core competencies"><p>{r.competencies.join(" • ")}</p></Sec>}
      <Sec t="Technical skills">{r.skills.map((s: any) => <p key={s.label}><b>{s.label}:</b> {s.items.join(", ")}</p>)}</Sec>
      <Sec t="Professional experience">{r.experience.map((e: any) => <div key={e.roleId} className="mb-2"><div className="font-semibold">{[e.title, e.employer].filter(Boolean).join(", ")}</div><div className="text-xs italic text-gray-600">{[e.dates, e.location].filter(Boolean).join(" | ")}</div><ul className="list-disc pl-5">{e.bullets.map((b: any, i: number) => <li key={i}>{b.text}</li>)}</ul></div>)}</Sec>
      {(r.projects ?? []).length > 0 && <Sec t="Major technical projects">{r.projects.map((p: any) => <div key={p.name} className="mb-2"><div className="font-semibold">{p.name}{p.sub && <span className="font-normal italic text-gray-600"> ({p.sub})</span>}</div><ul className="list-disc pl-5">{p.bullets.map((b: string, i: number) => <li key={i}>{b}</li>)}</ul></div>)}</Sec>}
      {r.education.length > 0 && <Sec t="Education">{r.education.map((e: string, i: number) => <p key={i}>{e}</p>)}</Sec>}
    </div>
  );
}

function CoverLetterTab({ a, profile, update, provider, run, say, doc, downloads }: any) {
  const [paras, setParas] = useState<string[] | null>(a.letter?.paragraphs ?? null);
  const [err, setErr] = useState("");
  useEffect(() => setParas(a.letter?.paragraphs ?? null), [a.letter]);
  if (!a.letter || !paras) return <Card className="text-sm text-gray-600">Generate the application pack on the Resume Changes tab first.</Card>;
  const words = paras.join(" ").split(/\s+/).filter(Boolean).length;
  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <div className="flex items-center justify-between text-sm"><span>{a.letter.date} · {a.letter.salutation}</span><Badge tone={words >= 250 && words <= 400 ? "green" : "amber"}>{words} words (target 250–400)</Badge></div>
        {paras.map((p, i) => <Textarea key={i} id={`cl-${i}`} aria-label={`Cover letter paragraph ${i + 1}`} rows={Math.max(3, Math.ceil(p.length / 95))} value={p} onChange={(e) => setParas(paras.map((x, j) => (j === i ? e.target.value : x)))} />)}
        <div className="text-sm">{a.letter.closing}<br /><b>{a.letter.signature}</b></div>
        <div className="flex gap-2"><Button onClick={() => { try { update(saveLetter(a, profile, paras)); setErr(""); say("ok", "Cover letter saved."); } catch (e: any) { setErr(e.message); } }}>Save edits</Button><Button variant="outline" onClick={() => run("Writing cover letter…", async () => update({ ...a, letter: await provider.generateCoverLetter(profile, a.jd, a.match, a.settings) }))}>Regenerate</Button></div>
        {err && <div role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">{err}</div>}
      </Card>
      {a.letter.removed?.length > 0 && <Card className="border-amber-300 bg-amber-50 text-sm text-amber-800"><b>Removed during truth check:</b>{a.letter.removed.map((r: any, i: number) => <p key={i} className="mt-1">“{r.text}” — {r.reasons.join(" ")}</p>)}</Card>}
      <DownloadRow a={a} profile={profile} doc={doc} kinds={["cover-pdf", "cover-docx"]} downloads={downloads} say={say} />
    </div>
  );
}

function TruthAudit({ a, doc, profile, downloads, say }: any) {
  if (!doc) return <Card className="text-sm text-gray-600">Generate the application pack first. The audit covers exactly what would be exported.</Card>;
  const flagged = [...doc.audit.checks, ...(doc.letterAudit?.checks ?? [])].filter((c: any) => c.status === "INFERRED" || c.status === "UNSUPPORTED");
  const S = ["VERIFIED", "SUPPORTED", "INFERRED", "UNSUPPORTED"] as const;
  return (
    <div className="space-y-4">
      <Card><h3 className="mb-2 text-sm font-semibold">Final resume (decisions applied)</h3><div className="flex flex-wrap gap-2">{S.map((s) => <Badge key={s} tone={statusTone(s)}>{s} {doc.audit.counts[s]}</Badge>)}</div>
        {doc.letterAudit && <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">Cover letter: {S.map((s) => <Badge key={s} tone={statusTone(s)}>{s} {doc.letterAudit.counts[s]}</Badge>)}</div>}
        <p className="mt-2 text-sm text-gray-600">{doc.audit.passed && (!doc.letterAudit || doc.letterAudit.passed) ? "No unsupported claims. Exports are enabled." : "Unsupported claims found. Exports are blocked until they are fixed."}</p></Card>
      {flagged.length > 0 && <Card><h3 className="mb-2 text-sm font-semibold">Needs your attention</h3>{flagged.map((c: any, i: number) => <div key={i} className="border-b border-line py-2 text-sm last:border-0"><Badge tone={statusTone(c.status)}>{c.status}</Badge> {c.hallucination && <Badge tone="red">POTENTIAL HALLUCINATION</Badge>} “{c.text}”<ul className="mt-1 list-disc pl-5 text-gray-600">{c.reasons.map((r: string, j: number) => <li key={j}>{r}</li>)}</ul></div>)}</Card>}
      <Card><h3 className="mb-2 text-sm font-semibold">All resume claims</h3><div className="max-h-96 overflow-auto">{doc.audit.checks.map((c: any, i: number) => <div key={i} className="flex items-start gap-2 border-b border-line py-1.5 text-sm last:border-0"><Badge tone={statusTone(c.status)} className="shrink-0">{c.status}</Badge><span>{c.text}{c.evidence && c.status !== "VERIFIED" && <span className="block text-xs text-gray-500">Evidence: {c.evidence}</span>}</span></div>)}</div></Card>
      <DownloadRow a={a} profile={profile} doc={doc} kinds={["report-pdf"]} downloads={downloads} say={say} theme={undefined} />
    </div>
  );
}

function Tracking({ a, update, remove, say }: any) {
  const [f, setF] = useState({ status: a.status, company: a.company, roleTitle: a.roleTitle, jobUrl: a.jobUrl, notes: a.notes, recruiterName: a.recruiterName, recruiterContact: a.recruiterContact, appliedAt: a.appliedAt });
  const [confirm, setConfirm] = useState(false);
  const set = (k: string) => (e: React.ChangeEvent<any>) => setF({ ...f, [k]: e.target.value });
  return (
    <Card className="max-w-3xl space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="md:col-span-2 text-sm text-gray-600">Resume version used: <b>{a.packVersion ? `v${a.packVersion}` : "none generated yet"}</b>{a.packAt && ` · ${new Date(a.packAt).toLocaleDateString()}`}</div>
        <div><Label htmlFor="t-status">Status</Label><Select id="t-status" value={f.status} onChange={set("status")}>{STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}</Select></div>
        <div><Label htmlFor="t-date">Application date</Label><Input id="t-date" type="date" value={f.appliedAt} onChange={set("appliedAt")} /></div>
        <div><Label htmlFor="t-co">Company</Label><Input id="t-co" value={f.company} onChange={set("company")} /></div>
        <div><Label htmlFor="t-role">Role</Label><Input id="t-role" value={f.roleTitle} onChange={set("roleTitle")} /></div>
        <div className="md:col-span-2"><Label htmlFor="t-url">Job URL</Label><Input id="t-url" value={f.jobUrl} onChange={set("jobUrl")} /></div>
        <div><Label htmlFor="t-rn">Recruiter name</Label><Input id="t-rn" value={f.recruiterName} onChange={set("recruiterName")} /></div>
        <div><Label htmlFor="t-rc">Recruiter contact</Label><Input id="t-rc" value={f.recruiterContact} onChange={set("recruiterContact")} /></div>
      </div>
      <div><Label htmlFor="t-notes">Notes</Label><Textarea id="t-notes" rows={4} value={f.notes} onChange={set("notes")} /></div>
      {(a.history?.length ?? 0) > 0 && <div><Label>Status history</Label><ol className="space-y-1 text-sm">{a.history!.map((h: any, i: number) => <li key={i} className="flex gap-3"><span className="font-mono text-xs text-gray-500">{new Date(h.at).toLocaleDateString()}</span>{h.status.replace(/_/g, " ")}</li>)}</ol></div>}
      <div className="flex items-center gap-3"><Button onClick={() => { const changed = f.status !== a.status; update({ ...a, ...f, history: changed ? [...(a.history ?? []), { status: f.status, at: new Date().toISOString() }] : a.history }); say("ok", "Saved."); }}>Save</Button>{confirm ? <><Button variant="danger" onClick={remove}>Confirm delete</Button><Button variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button></> : <Button variant="outline" onClick={() => setConfirm(true)}>Delete application</Button>}</div>
    </Card>
  );
}


/* ---------- Phase 3: LinkedIn + recruiter messages ---------- */
async function copy(text: string, say: any) {
  try { await navigator.clipboard.writeText(text); say("ok", "Copied."); }
  catch { say("err", "Copy was blocked here. Select the text and copy it manually."); }
}
const glyph = { present: "✓", related: "△", missing: "✗" } as const;

function LinkedInTab({ a, profile, update, provider, run, say }: any) {
  const [cur, setCur] = useState({ headline: "", about: "" });
  const p = a.linkedin;
  const gen = () => run("Building LinkedIn plan…", async () => update({ ...a, linkedin: await provider.optimizeLinkedIn(profile, a.jd, a.match, a.settings, { headline: cur.headline || undefined, about: cur.about || undefined }) }));
  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <p className="text-sm text-gray-700">LinkedIn is for discovery, the resume is for ATS parsing, so this plan leads with recruiter-search keywords and scope instead of copying resume bullets. Everything is drawn from your profile.</p>
        <details><summary className="cursor-pointer text-sm underline">Paste your current LinkedIn headline and About to compare (optional)</summary>
          <div className="mt-2 space-y-2"><div><Label htmlFor="li-h">Current headline</Label><Input id="li-h" value={cur.headline} onChange={(e) => setCur({ ...cur, headline: e.target.value })} /></div><div><Label htmlFor="li-a">Current About</Label><Textarea id="li-a" rows={5} value={cur.about} onChange={(e) => setCur({ ...cur, about: e.target.value })} /></div></div></details>
        <Button onClick={gen}>{p ? "Rebuild plan" : "Build LinkedIn plan"}</Button>
      </Card>
      {p && <>
        <Card><h3 className="mb-2 text-sm font-semibold">Recruiter-search keyword coverage</h3>
          <div className="grid gap-x-6 gap-y-1 md:grid-cols-3">{p.keywordCoverage.map((k: any) => <div key={k.keyword} className="flex items-start gap-2 text-sm" title={k.note}><span className={cx("w-4 font-mono", k.state === "present" ? "text-green-800" : k.state === "related" ? "text-amber-800" : "text-red-800")}>{glyph[k.state as keyof typeof glyph]}</span>{k.keyword}</div>)}</div>
          <p className="mt-2 text-xs text-gray-500">✓ in your profile · △ related background only (add the phrase only if you confirm you did it) · ✗ not in your profile (do not add)</p>
          <h4 className="mb-1 mt-4 text-xs font-semibold uppercase text-gray-500">Title keywords</h4>
          {p.titleKeywords.map((t: any) => <div key={t.keyword} className="flex items-start gap-2 text-sm"><span className={cx("w-4 font-mono", t.held ? "text-green-800" : "text-red-800")}>{t.held ? "✓" : "✗"}</span><span><b>{t.keyword}</b> <span className="text-gray-500">{t.note}</span></span></div>)}
        </Card>
        <Card className="space-y-3"><h3 className="text-sm font-semibold">Headline variants <span className="font-normal text-gray-500">(limit 220 characters)</span></h3>
          {p.headlines.map((h: any) => <div key={h.kind} className="rounded-md border border-line p-3"><div className="mb-1 flex flex-wrap items-center gap-2"><b className="text-sm">{h.kind}</b><Badge tone={statusTone(h.status)}>{h.status}</Badge><span className="font-mono text-xs text-gray-500">{h.length}/220</span></div><p className="text-sm">{h.text}</p><Button size="sm" variant="outline" className="mt-2" onClick={() => copy(h.text, say)}>Copy</Button></div>)}
          {p.skippedHeadlines.map((s: any) => <p key={s.kind} className="text-sm text-gray-500"><b>{s.kind}</b> not generated: {s.why}</p>)}
        </Card>
        <Card className="space-y-2"><h3 className="text-sm font-semibold">About</h3><Textarea readOnly aria-label="Suggested About section" rows={12} value={p.about.text} /><div className="flex items-center gap-3"><Button size="sm" variant="outline" onClick={() => copy(p.about.text, say)}>Copy</Button><span className="font-mono text-xs text-gray-500">{p.about.text.length}/2600</span></div></Card>
        <div className="grid gap-4 md:grid-cols-2">
          <Card><h3 className="mb-2 text-sm font-semibold">Skills order (top 50, from your profile)</h3><ol className="list-decimal pl-5 text-sm columns-2">{p.skills.map((k: string) => <li key={k}>{k}</li>)}</ol></Card>
          <Card><h3 className="mb-2 text-sm font-semibold">Recruiter keywords to consider</h3>{p.missingKeywords.length ? p.missingKeywords.map((k: any) => <div key={k.keyword} className="border-b border-line py-2 text-sm last:border-0"><b>{k.keyword}</b><p className="text-gray-600">{k.why}</p></div>) : <p className="text-sm text-gray-500">No presentation gaps for this job.</p>}</Card>
        </div>
        <Card><h3 className="mb-2 text-sm font-semibold">Featured section ideas</h3>{(p.featured ?? []).map((f: any, i: number) => <div key={i} className="border-b border-line py-2 text-sm last:border-0"><b>{f.item}</b><p className="text-gray-600">{f.why}</p></div>)}</Card>
        <Card><h3 className="mb-2 text-sm font-semibold">Experience: lead with these</h3>{p.experience.map((e: any) => <div key={e.roleLabel} className="border-b border-line py-2 text-sm last:border-0"><b>{e.roleLabel}</b><ul className="mt-1 text-gray-700">{e.lead.map((b: string, i: number) => <li key={i}>{b}</li>)}</ul>{e.weak.length > 0 && <p className="mt-1 text-xs text-gray-500">Weak or generic here (rewrite before reusing): {e.weak.map((w: string) => `“${w}”`).join("; ")}</p>}</div>)}</Card>
        {p.current && <Card><h3 className="mb-2 text-sm font-semibold">Your current profile</h3>{p.current.headline && <p className="text-sm">Headline ({p.current.headline.length}/220): has {p.current.headline.present.join(", ") || "none of the tracked keywords"}; missing {p.current.headline.missing.join(", ") || "nothing"}.</p>}{p.current.about && <p className="text-sm">About: has {p.current.about.present.join(", ") || "none of the tracked keywords"}; missing {p.current.about.missing.join(", ") || "nothing"}.</p>}</Card>}
        <Card><ul className="list-disc space-y-1 pl-5 text-sm text-gray-700">{p.notes.map((n: string, i: number) => <li key={i}>{n}</li>)}</ul></Card>
      </>}
    </div>
  );
}

function OutreachTab({ a, profile, update, provider, run, say }: any) {
  const [names, setNames] = useState({ recruiter: a.recruiterName || "", manager: "" });
  const [texts, setTexts] = useState<Record<string, string>>({});
  const pack = a.outreach;
  useEffect(() => setTexts(Object.fromEntries((pack?.messages ?? []).map((m: any) => [m.kind, m.text]))), [pack]);
  const gen = () => run("Drafting messages…", async () => update({ ...a, outreach: await provider.generateRecruiterMessage(profile, a.jd, a.match, a.settings, { recruiterName: names.recruiter || undefined, hiringManagerName: names.manager || undefined }) }));
  const idx = useMemo(() => buildIndex(profile), [profile]);
  const bad = (t: string) => auditProse(t.replace(/\[[^\]]+\]/g, ""), { index: idx, allowedNames: [a.jd.company, a.jd.roleTitle] }).filter((c) => c.status === "UNSUPPORTED");
  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <p className="text-sm text-gray-700">Short messages built from your profile and the posting. The app does not know names, mutual contacts or anything about the company beyond the job text, and it does not make any up. Fill the bracketed placeholders yourself.</p>
        <div className="grid gap-3 md:grid-cols-2"><div><Label htmlFor="o-r">Recruiter name (optional)</Label><Input id="o-r" value={names.recruiter} onChange={(e) => setNames({ ...names, recruiter: e.target.value })} /></div><div><Label htmlFor="o-m">Hiring manager name (optional)</Label><Input id="o-m" value={names.manager} onChange={(e) => setNames({ ...names, manager: e.target.value })} /></div></div>
        <Button onClick={gen}>{pack ? "Redraft messages" : "Draft messages"}</Button>
      </Card>
      {pack?.messages.map((m: any) => { const t = texts[m.kind] ?? m.text; const flagged = bad(t); const over = m.limit && t.length > m.limit; return (
        <Card key={m.kind} className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">{m.kind}</h3><span className={cx("font-mono text-xs", over ? "text-red-800" : "text-gray-500")}>{t.length}{m.limit ? `/${m.limit}` : ""}</span></div>
          <Textarea id={`msg-${m.kind}`} aria-label={`${m.kind} text`} rows={Math.max(3, Math.ceil(t.length / 90))} value={t} onChange={(e) => setTexts({ ...texts, [m.kind]: e.target.value })} />
          {flagged.length > 0 && <div role="alert" className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800"><b>POTENTIAL HALLUCINATION:</b> {flagged.map((f) => `“${f.text}” — ${f.reasons.join(" ")}`).join(" | ")}</div>}
          <Button size="sm" variant="outline" disabled={flagged.length > 0 || !!over} onClick={() => copy(t, say)}>Copy</Button>
        </Card>); })}
      {pack && <Card><ul className="list-disc space-y-1 pl-5 text-sm text-gray-700">{pack.notes.map((n: string, i: number) => <li key={i}>{n}</li>)}</ul></Card>}
    </div>
  );
}


/* ---------- Presentation ---------- */
function DeckView({ profile, apps, downloads, say }: { profile: Profile | null; apps: AppRecord[]; downloads: any; say: any }) {
  const [focus, setFocus] = useState("");
  const [max, setMax] = useState("6");
  const [inc, setInc] = useState({ snapshot: true, timeline: true, projects: true, achievements: true, leadership: true, toolbox: true, education: true, closing: true });
  const [busy, setBusy] = useState(false);
  const app = apps.find((a) => a.id === focus);
  const deck = useMemo(() => (profile ? buildDeck(profile, { maxProjects: Number(max), include: inc, focus: app ? { jd: app.jd, match: app.match } : null }) : null), [profile, app, max, inc]);
  if (!profile || !deck) return <Card className="text-sm text-gray-600">Create your profile first (Profile tab).</Card>;
  const name = (profile.identity.name || "Candidate").replace(/[^\w]+/g, "");
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="space-y-3 lg:col-span-1">
        <h2 className="text-sm font-semibold">Projects and achievements deck</h2>
        <p className="text-sm text-gray-600">A .pptx built only from your profile: your own bullets (trimmed, never reworded), your real metrics, your tools. Nothing is invented.</p>
        <div><Label htmlFor="d-focus">Tailor to a job (optional)</Label><Select id="d-focus" value={focus} onChange={(e) => setFocus(e.target.value)}><option value="">General</option>{apps.map((a) => <option key={a.id} value={a.id}>{a.roleTitle || "Untitled"} · {a.company || "?"}</option>)}</Select></div>
        <div><Label htmlFor="d-max">Project slides</Label><Select id="d-max" value={max} onChange={(e) => setMax(e.target.value)}>{["3", "4", "6", "8", "12"].map((v) => <option key={v}>{v}</option>)}</Select></div>
        <fieldset className="grid grid-cols-2 gap-1 text-sm"><legend className="mb-1 text-xs font-medium uppercase text-gray-500">Include</legend>{Object.keys(inc).map((k) => <label key={k} className="flex items-center gap-2"><input type="checkbox" id={`inc-${k}`} checked={(inc as any)[k]} onChange={(e) => setInc({ ...inc, [k]: e.target.checked })} />{k}</label>)}</fieldset>
        <Button disabled={busy || !downloads} onClick={async () => { setBusy(true); try { const buf: ArrayBuffer = await deckBuffer(deck, "arraybuffer"); await downloads.save({ filename: `${name}_Projects_Achievements.pptx`, data: buf }); say("ok", "Presentation saved."); } catch (e: any) { if (e?.code !== "declined") say("err", `Could not save: ${e?.message ?? e?.code ?? e}`); } finally { setBusy(false); } }}>Download .pptx</Button>
        {!downloads && <p className="text-xs text-gray-500">File saving is only available when this page runs inside Claude.</p>}
        {deck.warnings.map((w, i) => <p key={i} role="status" className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">{w}</p>)}
      </Card>
      <div className="space-y-2 lg:col-span-2"><h3 className="text-sm font-semibold">{deck.slides.length} slides</h3>
        {deck.slides.map((s, i) => <Card key={i} className="p-3"><div className="flex items-baseline gap-3"><span className="font-mono text-xs text-gray-500">{String(i + 1).padStart(2, "0")}</span><b className="text-sm">{s.title}</b><Badge>{s.kind}</Badge></div>{s.lines.filter((l) => !l.startsWith("tag: ")).length > 0 && <ul className="mt-1 text-sm text-gray-700">{s.lines.filter((l) => !l.startsWith("tag: ")).slice(0, 5).map((l, j) => <li key={j}>{l}</li>)}</ul>}{s.lines.some((l) => l.startsWith("tag: ")) && <div className="mt-1 flex flex-wrap gap-1">{s.lines.filter((l) => l.startsWith("tag: ")).map((l) => <Badge key={l} tone="blue">{l.slice(5)}</Badge>)}</div>}</Card>)}
      </div>
    </div>
  );
}


/* ---------- Phase 4: interview prep + analytics ---------- */
const probTone = (p: string) => (p === "High" ? "red" : p === "Medium" ? "amber" : "gray");
const levelTone = (l: number) => (l >= 4 ? "red" : l === 3 ? "amber" : l === 2 ? "blue" : "green");

function InterviewTab({ a, profile, update, provider, run }: any) {
  const [src, setSrc] = useState<"bank" | "resume" | "gap" | "live" | "practice">("bank");
  const [lvl, setLvl] = useState(0);
  const plan = a.interview;
  const done: Record<string, boolean> = a.prepDone ?? {};
  const build = () => run("Building interview prep…", async () => update({ ...a, interview: await provider.generateInterviewPrep(profile, a.jd, a.match, a.settings) }));
  const list = !plan ? [] : (src === "bank" ? plan.questions : src === "resume" ? plan.resumeDrills : plan.gapQuestions).filter((q: any) => !lvl || q.level === lvl);
  const total = plan ? plan.questions.length + plan.resumeDrills.length + plan.gapQuestions.length : 0;
  const nDone = plan ? [...plan.questions, ...plan.resumeDrills, ...plan.gapQuestions].filter((q: any) => done[q.id]).length : 0;
  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-3xl text-sm text-gray-700">Likely questions from this job description and your own resume. Evidence shown is your own profile text; where you have a gap, the note says to be honest and bridge to real related work. {plan && <b>{nDone}/{total} prepared.</b>}</p>
        <Button onClick={build}>{plan ? "Rebuild" : "Build interview prep"}</Button>
      </Card>
      {plan && <>
        <Card><h3 className="mb-2 text-sm font-semibold">Topic likelihood <span className="font-normal text-gray-500">· weighted to {plan.targetLevelName} level</span></h3>
          <div className="grid gap-x-8 gap-y-1 md:grid-cols-2">{plan.topics.map((t: any) => <div key={t.topic} className="text-sm" title={t.reasons.join("; ")}><div className="flex items-center justify-between gap-2"><span>{t.display} {t.stance !== "strength" && <Badge tone={t.stance === "gap" ? "red" : "amber"}>{t.stance}</Badge>}</span><Badge tone={probTone(t.probability)}>{t.probability}</Badge></div><div className="mt-0.5 h-1 rounded bg-gray-100"><div className="sco-meter h-1 rounded" style={{ width: `${Math.min(100, t.score * 10)}%` }} /></div></div>)}</div>
          <ul className="mt-3 list-disc pl-5 text-xs text-gray-500">{plan.notes.map((n: string, i: number) => <li key={i}>{n}</li>)}</ul></Card>
        <div className="flex flex-wrap items-center gap-2" role="tablist">{([["bank", `Top ${plan.questions.length}`], ["resume", `From your resume (${plan.resumeDrills.length})`], ["gap", `Your gaps (${plan.gapQuestions.length})`], ["live", "Live exercises"], ["practice", "Practice with feedback"]] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={src === k} onClick={() => setSrc(k)} className={cx("rounded-md border border-line px-3 py-1 text-sm", src === k && "bg-view text-on-view")}>{l}</button>)}
          {src !== "live" && src !== "practice" && <span className="ml-3 flex gap-1" role="group" aria-label="Level">{[[0, "All"], [1, "Basic"], [2, "Intermediate"], [3, "Staff"], [4, "Principal"]].map(([v, l]) => <button key={v as number} onClick={() => setLvl(v as number)} className={cx("rounded-md border border-line px-2 py-1 text-xs", lvl === v && "bg-view text-on-view")}>{l}</button>)}</span>}</div>
        {src === "practice" ? <PracticePanel a={a} plan={plan} profile={profile} update={update} provider={provider} run={run} /> : src === "live" ? <Card><h3 className="mb-2 text-sm font-semibold">Likely live exercises</h3>{plan.liveExercises.length ? <ul className="list-disc space-y-1 pl-5 text-sm">{plan.liveExercises.map((x: string, i: number) => <li key={i}>{x}</li>)}</ul> : <p className="text-sm text-gray-500">Nothing in this job points at a specific live exercise.</p>}</Card>
          : <div className="space-y-3">{list.map((q: any) => (
            <Card key={q.id} className={cx(done[q.id] && "opacity-70")}>
              <div className="mb-1 flex flex-wrap items-center gap-2"><Badge tone={levelTone(q.level)}>{q.levelName}</Badge>{q.stance !== "strength" && <Badge tone={q.stance === "gap" ? "red" : "amber"}>{q.stance === "gap" ? "gap: be honest" : "related only"}</Badge>}<span className="text-xs text-gray-500">{q.source === "resume" ? "from your resume" : q.topic}</span>
                <label className="ml-auto flex items-center gap-2 text-sm"><input type="checkbox" id={`prep-${q.id}`} checked={!!done[q.id]} onChange={(e) => update({ ...a, prepDone: { ...done, [q.id]: e.target.checked } })} />Prepared</label></div>
              <p className="text-sm font-medium">{q.q}</p>
              <p className="mt-1 text-xs text-gray-500"><b>Why likely:</b> {q.whyLikely}</p>
              <details className="mt-2"><summary className="cursor-pointer text-sm underline">What a good answer covers</summary>
                <ul className="mt-1 list-disc pl-5 text-sm text-gray-700">{q.points.map((p: string, i: number) => <li key={i}>{p}</li>)}</ul>
                {q.follow && <p className="mt-1 text-sm"><b>Likely follow-up:</b> {q.follow}</p>}
                {q.outline && <p className="mt-2 rounded bg-gray-50 p-2 text-sm"><b>Outline:</b> {q.outline}</p>}
                {q.honestyNote && <p className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-sm text-amber-800">{q.honestyNote}</p>}
                {q.evidence.length > 0 && <div className="mt-2"><Label>Your own example to draw on</Label>{q.evidence.map((e: any, i: number) => <p key={i} className="text-sm"><span className="text-xs text-gray-500">{e.label}: </span>{e.text}</p>)}</div>}
              </details>
            </Card>))}{!list.length && <Card className="text-sm text-gray-500">No questions at this level.</Card>}</div>}
      </>}
    </div>
  );
}


function PracticePanel({ a, plan, profile, update, provider, run }: any) {
  const all: any[] = useMemo(() => [...plan.questions, ...plan.gapQuestions, ...plan.resumeDrills], [plan]);
  const practice: Record<string, { at: string; score: number; words: number }[]> = a.practice ?? {};
  const [sel, setSel] = useState<string>(() => (all.find((q) => !practice[q.id]) ?? all[0])?.id);
  const [answer, setAnswer] = useState("");
  const [res, setRes] = useState<CoachResult | null>(null);
  const q = all.find((x) => x.id === sel);
  useEffect(() => { setAnswer(""); setRes(null); }, [sel]);
  const weak = useMemo(() => weakTopics(practice, all), [a.practice, all]);
  if (!q) return null;
  const hist = practice[q.id] ?? [];
  const submit = () => run(provider.name === "claude" ? "Claude is reviewing your answer…" : "Reviewing your answer…", async () => {
    const r: CoachResult = await provider.coachAnswer(profile, a.jd, q, answer);
    setRes(r);
    update({ ...a, practice: { ...practice, [q.id]: [...hist, { at: new Date().toISOString(), score: r.score, words: r.words }] }, prepDone: r.score >= 70 ? { ...(a.prepDone ?? {}), [q.id]: true } : a.prepDone });
  });
  const tone = (s: number) => (s >= 80 ? "green" : s >= 65 ? "blue" : s >= 45 ? "amber" : "red");
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="space-y-2 lg:col-span-1"><h3 className="text-sm font-semibold">Pick a question</h3>
        <div className="max-h-[28rem] space-y-1 overflow-auto" role="listbox" aria-label="Questions">{all.map((x) => { const h = practice[x.id]; return <button key={x.id} role="option" aria-selected={x.id === sel} onClick={() => setSel(x.id)} className={cx("block w-full rounded-md border border-line p-2 text-left text-sm", x.id === sel && "border-view")}><span className="line-clamp-2">{x.q}</span><span className="mt-1 flex gap-1"><Badge tone={levelTone(x.level)}>{x.levelName}</Badge>{h ? <Badge tone={tone(h[h.length - 1].score)}>last {h[h.length - 1].score}</Badge> : <Badge>new</Badge>}</span></button>; })}</div>
        {weak.length > 0 && <div><Label>Weakest topics so far</Label>{weak.slice(0, 4).map((w) => <div key={w.topic} className="flex justify-between text-sm"><span>{show(w.topic)}</span><span className="font-mono text-xs text-gray-500">{w.avg} · {w.attempts}×</span></div>)}</div>}
      </Card>
      <div className="space-y-3 lg:col-span-2">
        <Card className="space-y-3">
          <div className="flex flex-wrap items-center gap-2"><Badge tone={levelTone(q.level)}>{q.levelName}</Badge>{q.stance !== "strength" && <Badge tone={q.stance === "gap" ? "red" : "amber"}>{q.stance === "gap" ? "gap: be honest" : "related only"}</Badge>}</div>
          <p className="text-sm font-medium">{q.q}</p>
          {q.honestyNote && <p className="rounded border border-amber-300 bg-amber-50 p-2 text-sm text-amber-800">{q.honestyNote}</p>}
          {q.evidence.length > 0 && <details><summary className="cursor-pointer text-sm underline">Your own example to draw on</summary>{q.evidence.map((e: any, i: number) => <p key={i} className="mt-1 text-sm"><span className="text-xs text-gray-500">{e.label}: </span>{e.text}</p>)}</details>}
          <Textarea id="practice-answer" aria-label="Your answer" rows={9} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Type your answer as you would say it. Aim for 90 to 250 words." />
          <div className="flex items-center gap-3"><Button disabled={answer.trim().length < 5} onClick={submit}>Get feedback</Button><span className="font-mono text-xs text-gray-500">{answer.trim() ? answer.trim().split(/\s+/).length : 0} words</span>{hist.length > 0 && <span className="text-xs text-gray-500">Attempts: {hist.map((h) => h.score).join(" → ")}</span>}</div>
        </Card>
        {res && <Card className="space-y-3">
          <div className="flex items-center gap-3"><div className="font-mono text-3xl font-semibold">{res.score}</div><Badge tone={tone(res.score)}>{res.band}</Badge></div>
          <div className="space-y-1">{res.dims.map((d) => <div key={d.key} className="grid grid-cols-[14rem_1fr_auto] items-center gap-2 text-sm"><span>{d.label}</span><div className="h-2 rounded bg-gray-100"><div className="sco-meter h-2 rounded" data-band={band(Math.round(d.score * 100))} style={{ width: `${Math.round(d.score * 100)}%` }} /></div><span className="text-xs text-gray-500">{d.note}</span></div>)}</div>
          {res.flags.filter((f) => f.severity === "claim").length > 0 && <div role="alert" className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800"><b>POTENTIAL HALLUCINATION in your answer:</b> {res.flags.filter((f) => f.severity === "claim").map((f) => `“${f.text}” — ${f.reasons.join(" ")}`).join(" | ")}</div>}
          {res.strengths.length > 0 && <div><Label>What worked</Label><ul className="list-disc pl-5 text-sm">{res.strengths.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
          {res.improvements.length > 0 && <div><Label>To improve</Label><ul className="list-disc pl-5 text-sm">{res.improvements.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
          {res.missed.length > 0 && <div><Label>Points not yet covered</Label><ul className="list-disc pl-5 text-sm text-gray-700">{res.missed.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
          {res.llm && <div className="rounded bg-gray-50 p-3 text-sm"><Label>Claude's feedback</Label>{res.llm.summary && <p>{res.llm.summary}</p>}{res.llm.improvements.length > 0 && <ul className="mt-1 list-disc pl-5">{res.llm.improvements.map((x, i) => <li key={i}>{x}</li>)}</ul>}</div>}
          {res.score >= 70 && <p className="text-sm text-green-800">Marked as prepared.</p>}
        </Card>}
      </div>
    </div>
  );
}

function Bars({ rows, label }: { rows: { name: string; value: number; sub?: string }[]; label: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return <div role="img" aria-label={label} className="space-y-1">{rows.map((r) => <div key={r.name} className="grid grid-cols-[8rem_1fr_3.5rem] items-center gap-2 text-sm"><span className="truncate">{r.name}</span><div className="h-3 rounded bg-gray-100"><div className="sco-meter h-3 rounded" style={{ width: `${(r.value / max) * 100}%` }} /></div><span className="text-right font-mono text-xs">{r.value}{r.sub ? ` ${r.sub}` : ""}</span></div>)}</div>;
}

function AnalyticsView({ apps, open }: { apps: AppRecord[]; open: (id: string) => void }) {
  const A = useMemo(() => computeAnalytics(apps as any), [apps]);
  if (!apps.length) return <Card className="text-sm text-gray-600">Analyze a few jobs to see trends. Analytics are computed from your saved applications, in this browser.</Card>;
  const stat = (l: string, v: string | number | null, sub?: string) => <Card><div className="text-xs uppercase tracking-wide text-gray-500">{l}</div><div className="font-mono text-2xl">{v ?? "–"}</div>{sub && <div className="text-xs text-gray-500">{sub}</div>}</Card>;
  return (
    <div className="space-y-4">
      {A.total < 5 && <p role="status" className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">Fewer than 5 applications analysed, so the percentages and trends here are not meaningful yet.</p>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">{stat("Applications", A.total, `${A.thisWeek} this week`)}{stat("Average match", A.avgScore)}{stat("Response rate", A.responseRate === null ? null : `${A.responseRate}%`)}{stat("Interview rate", A.interviewRate === null ? null : `${A.interviewRate}%`)}{stat("Median days to response", A.daysToFirstResponse.median, `${A.daysToFirstResponse.n} samples`)}</div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card><h3 className="mb-2 text-sm font-semibold">Funnel</h3><Bars label="Application funnel" rows={A.funnel.map((f) => ({ name: f.stage, value: f.count, sub: f.rate === null ? "" : `${f.rate}%` }))} /></Card>
        <Card><h3 className="mb-2 text-sm font-semibold">Last 8 weeks</h3><Bars label="Applications analysed per week" rows={A.weekly.map((w) => ({ name: w.weekStart.slice(5), value: w.analyzed, sub: `/${w.applied}` }))} /><p className="mt-1 text-xs text-gray-500">analysed / applied per week</p></Card>
      </div>
      <Card><h3 className="mb-2 text-sm font-semibold">Does match score predict progress?</h3><p className="text-sm">Reached screening or later: <b>{A.scoreVsOutcome.progressed.avg ?? "–"}</b> avg match (n={A.scoreVsOutcome.progressed.n}) · Stalled or rejected: <b>{A.scoreVsOutcome.stalled.avg ?? "–"}</b> (n={A.scoreVsOutcome.stalled.n})</p>{A.scoreVsOutcome.caution && <p className="mt-1 text-xs text-amber-800">{A.scoreVsOutcome.caution}</p>}</Card>
      <div className="grid gap-4 md:grid-cols-2">
        <Card><h3 className="mb-2 text-sm font-semibold">What jobs ask for most <span className="font-normal text-gray-500">(weighted by importance)</span></h3>{A.demand.map((d) => <div key={d.term} className="flex items-center justify-between border-b border-line py-1 text-sm last:border-0"><span>{d.term} <span className="text-xs text-gray-500">{d.jobs} job(s)</span></span><Badge tone={d.yours === "strong" ? "green" : d.yours === "partial" ? "amber" : "red"}>{d.yours === "strong" ? "you have it" : d.yours === "partial" ? "partial" : "gap"}</Badge></div>)}</Card>
        <Card><h3 className="mb-2 text-sm font-semibold">Gaps to prioritise</h3>{A.gapPriorities.slice(0, 8).map((g) => <div key={g.term} className="border-b border-line py-2 text-sm last:border-0"><div className="flex items-center justify-between"><b>{g.term}</b><span className="flex items-center gap-2"><span className="text-xs text-gray-500">{g.jobs} job(s)</span><Badge tone={g.kind === "presentation-gap" ? "blue" : "red"}>{g.kind === "presentation-gap" ? "presentation" : "real gap"}</Badge></span></div><p className="text-xs text-gray-600">{g.advice}</p></div>)}{!A.gapPriorities.length && <p className="text-sm text-gray-500">No gaps recorded.</p>}</Card>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card><h3 className="mb-2 text-sm font-semibold">Recommendation mix</h3>{Object.entries(A.verdicts).map(([k, v]) => <div key={k} className="flex justify-between text-sm"><span>{k}</span><span className="font-mono">{v}</span></div>)}</Card>
        <Card><h3 className="mb-2 text-sm font-semibold">By country</h3>{A.byCountry.map((c) => <div key={c.country} className="flex justify-between text-sm"><span>{c.country}</span><span className="font-mono">{c.n} · avg {c.avg}</span></div>)}</Card>
      </div>
      <Card><ul className="list-disc space-y-1 pl-5 text-sm text-gray-700">{A.notes.map((n, i) => <li key={i}>{n}</li>)}</ul></Card>
    </div>
  );
}


const W_LABEL: Record<string, string> = { mandatoryTechnical: "Mandatory technical requirements", coreDomain: "Core verification / domain fit", seniority: "Role / seniority alignment", architecture: "Architecture / ownership", leadership: "Leadership", preferred: "Preferred skills", tools: "Tool alignment", educationOther: "Education / other" };
function WeightsCard({ prefs, setPrefs }: { prefs: Prefs; setPrefs: (f: (p: Prefs) => Prefs) => void }) {
  const cur: Record<string, number> = { ...DEFAULT_WEIGHTS, ...(prefs.weights ?? {}) };
  const total = Object.values(cur).reduce((a, b) => a + b, 0);
  return (
    <Card className="space-y-2"><div className="flex items-center justify-between"><h3 className="text-sm font-semibold">Match score weights</h3><Button size="sm" variant="ghost" onClick={() => setPrefs((p) => ({ ...p, weights: undefined }))}>Reset to default</Button></div>
      <p className="text-sm text-gray-600">Applies to new analyses. Weights are normalised, so they only need to be in proportion (currently sum to {Math.round(total * 100)}%). Categories a job does not mention are dropped.</p>
      <div className="grid gap-x-6 gap-y-2 md:grid-cols-2">{Object.keys(DEFAULT_WEIGHTS).map((k) => <div key={k}><Label htmlFor={`w-${k}`}>{W_LABEL[k]}: {Math.round(cur[k] * 100)}%</Label><input id={`w-${k}`} type="range" min={0} max={60} value={Math.round(cur[k] * 100)} className="w-full" onChange={(e) => setPrefs((p) => ({ ...p, weights: { ...cur, [k]: Number(e.target.value) / 100 } }))} /></div>)}</div></Card>
  );
}

function VocabCard({ prefs, setPrefs, say }: { prefs: Prefs; setPrefs: (f: (p: Prefs) => Prefs) => void; say: any }) {
  const [f, setF] = useState({ canonical: "", aliases: "", category: "Verification", type: "methodology", parent: "", related: "" });
  const set = (k: string) => (e: React.ChangeEvent<any>) => setF({ ...f, [k]: e.target.value });
  const names = useMemo(() => ontology.entries.map((e) => e.canonical).sort(), [prefs.vocab]);
  const types = ["language", "methodology", "protocol", "processor", "domain", "simulator", "formal-tool", "scripting", "debugging", "planning", "coverage", "assertion", "leadership", "architecture", "management", "communication", "customer", "tool"];
  const add = () => {
    const canonical = f.canonical.trim();
    if (!canonical) return say("err", "Give the term a name.");
    const aliases = f.aliases.split(",").map((x) => x.trim()).filter(Boolean);
    if (ontology.get(canonical)) return say("err", `"${canonical}" already exists in the vocabulary.`);
    const clash = [canonical, ...aliases].map((a) => ontology.findTerms(a).map((h) => h.canonical)).flat();
    if (clash.length) return say("err", `Already covered by: ${[...new Set(clash)].join(", ")}. Aliases must not duplicate existing terms.`);
    const entry: VocabEntry = { canonical, aliases, category: f.category, type: f.type as VocabEntry["type"], ...(f.parent ? { parent: f.parent } : {}), ...(f.related.trim() ? { related: f.related.split(",").map((x) => x.trim()).filter((x) => ontology.get(x)) } : {}) };
    setPrefs((p) => ({ ...p, vocab: [...p.vocab, entry] })); setF({ ...f, canonical: "", aliases: "", parent: "", related: "" }); say("ok", `Added "${canonical}". It applies to new analyses and parses.`);
  };
  return (
    <Card className="space-y-3"><h3 className="text-sm font-semibold">Custom vocabulary <span className="font-normal text-gray-500">· {ontology.entries.length} terms ({prefs.vocab.length} yours)</span></h3>
      <p className="text-sm text-gray-600">Add tools, protocols or phrasing the built-in ontology does not know. The built-in list is not editable here and cannot be overridden. Terms you add count as real skills when they appear in your profile, so only add what you mean.</p>
      <div className="grid gap-3 md:grid-cols-3"><div><Label htmlFor="v-c">Term</Label><Input id="v-c" value={f.canonical} onChange={set("canonical")} /></div><div className="md:col-span-2"><Label htmlFor="v-a">Aliases (comma separated)</Label><Input id="v-a" value={f.aliases} onChange={set("aliases")} /></div>
        <div><Label htmlFor="v-t">Type</Label><Select id="v-t" value={f.type} onChange={set("type")}>{types.map((t) => <option key={t}>{t}</option>)}</Select></div><div><Label htmlFor="v-p">Parent (implies this broader term)</Label><Select id="v-p" value={f.parent} onChange={set("parent")}><option value="">none</option>{names.map((n) => <option key={n}>{n}</option>)}</Select></div><div><Label htmlFor="v-r">Related terms (comma separated)</Label><Input id="v-r" value={f.related} onChange={set("related")} /></div></div>
      <Button variant="outline" onClick={add}>Add term</Button>
      {prefs.vocab.length > 0 && <ul className="divide-y divide-line rounded-md border border-line text-sm">{prefs.vocab.map((v) => <li key={v.canonical} className="flex items-center justify-between gap-2 p-2"><span><b>{v.canonical}</b> <span className="text-gray-500">{v.aliases.join(", ")} · {v.type}{v.parent ? ` · implies ${v.parent}` : ""}</span></span><button className="text-xs text-red-800 underline" onClick={() => setPrefs((p) => ({ ...p, vocab: p.vocab.filter((x) => x.canonical !== v.canonical) }))}>Remove</button></li>)}</ul>}
    </Card>
  );
}

/* ---------- Settings ---------- */
function SettingsView({ store, setStore, setPrefs, downloads, say, claudeOn }: any) {
  const file = useRef<HTMLInputElement>(null);
  const [confirm, setConfirm] = useState(false);
  const [pw, setPw] = useState("");
  return (
    <div className="max-w-2xl space-y-4">
      <Card className="space-y-2 text-sm"><h3 className="font-semibold">Where your data lives</h3>{adapter.mode === "server" ? <p>Your profile, resumes and applications are stored in your account on this server (private, not served at any public URL). Resume text is only sent to an AI vendor if you switch on “Use {adapter.aiProvider ?? "AI"}”; the built-in engine runs entirely in your browser.</p> : <p>Profile, resume text and applications are stored in <b>this browser only</b> (local storage for this artifact). They are not sent anywhere unless you switch on “Use Claude”, which sends the relevant text to Claude on your own account. Clearing site data or using another device starts empty, so keep a backup.</p>}<p>AI: <Badge tone={claudeOn ? "green" : "amber"}>{claudeOn ? (adapter.mode === "server" ? `${adapter.aiProvider ?? "provider"} configured` : "Claude available") : "offline engine only"}</Badge></p></Card>
      <WeightsCard prefs={store.prefs} setPrefs={setPrefs} />
      <VocabCard prefs={store.prefs} setPrefs={setPrefs} say={say} />
      <Card className="space-y-3"><h3 className="text-sm font-semibold">Backup</h3>
        <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={!downloads} onClick={() => save(downloads, "career-optimizer-backup.json", JSON.stringify(store, null, 1) as any, say)}>Export backup (JSON)</Button>
          <input ref={file} id="restore" type="file" accept=".json" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; try { const s = JSON.parse(await f.text()); setStore({ prefs: { ...DEFAULT_PREFS, ...(s.prefs ?? {}) }, profile: s.profile ? ProfileSchema.parse(s.profile) : null, apps: Array.isArray(s.apps) ? s.apps : [], resumes: Array.isArray(s.resumes) ? s.resumes.map((r: Resume) => ({ ...r, profile: ProfileSchema.parse(r.profile) })) : [] }); say("ok", "Backup restored."); } catch { say("err", "That file is not a valid backup."); } e.target.value = ""; }} />
          <Button variant="outline" onClick={() => file.current?.click()}>Restore backup</Button></div></Card>
      <Card className="space-y-3"><h3 className="text-sm font-semibold text-red-700">Delete data</h3><p className="text-sm text-gray-600">{adapter.deleteAll ? "Permanently deletes your stored profile, resumes, applications and uploaded files from the server. Resume content is never used for training." : "Removes your profile, uploaded resumes and every application from this browser."}</p>
        {adapter.deleteAll && <div><Label htmlFor="del-pw">Confirm password</Label><Input id="del-pw" type="password" value={pw} onChange={(e) => setPw(e.target.value)} /></div>}
        {confirm ? <div className="flex flex-wrap gap-2"><Button variant="danger" disabled={!!adapter.deleteAll && !pw} onClick={async () => { try { if (adapter.deleteAll) await adapter.deleteAll(pw, "data"); setStore({ profile: null, apps: [], resumes: [], prefs: DEFAULT_PREFS }); ontology.setCustom([]); if (!adapter.deleteAll) { try { localStorage.removeItem(KEY); } catch { /* ignore */ } } setConfirm(false); say("ok", "All data deleted."); } catch (e: any) { say("err", e.message); } }}>Yes, delete everything</Button>{adapter.deleteAll && <Button variant="danger" disabled={!pw} onClick={async () => { try { await adapter.deleteAll!(pw, "account"); } catch (e: any) { say("err", e.message); } }}>Delete my whole account</Button>}<Button variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button></div> : <Button variant="danger" onClick={() => setConfirm(true)}>Delete all my data</Button>}</Card>
    </div>
  );
}

adapter.load().then((raw) => createRoot(document.getElementById("root")!).render(<App initial={hydrate(raw)} />));
