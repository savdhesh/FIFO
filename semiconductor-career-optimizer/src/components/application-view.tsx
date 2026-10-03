"use client";
import { useCallback, useEffect, useState } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, Input, Label, Select, Textarea, matchTone, statusTone } from "@/components/ui";
import { api } from "@/lib/ui/client";
import { cn } from "@/lib/ui/cn";

const STATUSES = ["SAVED", "ANALYZED", "APPLYING", "APPLIED", "RECRUITER_CONTACTED", "SCREENING", "TECHNICAL_ROUND", "HIRING_MANAGER", "FINAL_ROUND", "OFFER", "REJECTED", "WITHDRAWN"];
const TABS = ["Overview", "Requirements", "Skill Match", "Resume Changes", "Cover Letter", "Truth Audit", "Tracking"];
const tab = "border-b-2 border-transparent px-3 py-2 text-sm data-[state=active]:border-ink data-[state=active]:font-medium text-gray-600 data-[state=active]:text-ink";

export function ApplicationView({ id }: { id: string }) {
  const router = useRouter();
  const [a, setA] = useState<any>(null);
  const [err, setErr] = useState("");
  const load = useCallback(async () => { try { setA((await api(`/api/applications/${id}`)).application); } catch (e: any) { setErr(e.message); } }, [id]);
  useEffect(() => { load(); }, [load]);
  if (err) return <p role="alert" className="text-red-600">{err}</p>;
  if (!a) return <p className="text-sm text-gray-500">Loading…</p>;
  return (
    <div className="max-w-6xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><h1 className="text-xl font-semibold">{a.roleTitle || "Untitled role"}</h1><p className="text-sm text-gray-600">{a.company || "Unknown company"} · target {a.settings.country} · {a.settings.seniority} · {a.settings.length === "cv" ? "detailed CV" : `${a.settings.length} page(s)`}</p></div>
        <Badge tone={a.matchScore >= 75 ? "green" : a.matchScore >= 55 ? "amber" : "red"} className="text-base">{a.recommendation} · {a.matchScore}</Badge>
      </div>
      <Tabs.Root defaultValue="Overview">
        <Tabs.List className="flex flex-wrap border-b border-line">{TABS.map((t) => <Tabs.Trigger key={t} value={t} className={tab}>{t}</Tabs.Trigger>)}</Tabs.List>
        <div className="pt-4">
          <Tabs.Content value="Overview"><Overview a={a} /></Tabs.Content>
          <Tabs.Content value="Requirements"><Requirements a={a} /></Tabs.Content>
          <Tabs.Content value="Skill Match"><SkillMatch a={a} /></Tabs.Content>
          <Tabs.Content value="Resume Changes"><ResumeChanges a={a} reload={load} /></Tabs.Content>
          <Tabs.Content value="Cover Letter"><CoverLetter a={a} reload={load} /></Tabs.Content>
          <Tabs.Content value="Truth Audit"><TruthAudit a={a} /></Tabs.Content>
          <Tabs.Content value="Tracking"><Tracking a={a} reload={load} onDelete={() => router.push("/applications")} /></Tabs.Content>
        </div>
      </Tabs.Root>
    </div>
  );
}

function Overview({ a }: { a: any }) {
  const [open, setOpen] = useState<string>("overall");
  const sel = a.match.scores.find((s: any) => s.key === open);
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <h2 className="mb-1 text-sm font-semibold">Scores <span className="font-normal text-gray-500">— click a score to see why</span></h2>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {a.match.scores.map((s: any) => (
              <button key={s.key} onClick={() => setOpen(s.key)} className={cn("rounded-md border p-3 text-left hover:bg-gray-50", open === s.key ? "border-ink" : "border-line")}>
                <div className="text-xs text-gray-500">{s.label}</div><div className="text-2xl font-semibold">{s.value}</div>
                <div className="mt-1 h-1.5 rounded bg-gray-100"><div className="h-1.5 rounded bg-ink" style={{ width: `${s.value}%` }} /></div>
              </button>))}
          </div>
          {sel && <div className="mt-3 rounded-md bg-gray-50 p-3 text-sm"><b>{sel.label}: {sel.value}</b><ul className="mt-1 list-disc pl-5 text-gray-700">{sel.why.map((w: string, i: number) => <li key={i}>{w}</li>)}</ul></div>}
        </Card>
        <Card>
          <h2 className="mb-2 text-sm font-semibold">Recommendation</h2>
          <div className="mb-2 text-lg font-semibold">{a.match.recommendation.verdict}</div>
          <ul className="list-disc space-y-1 pl-5 text-sm">{a.match.recommendation.reasons.map((r: string, i: number) => <li key={i}>{r}</li>)}</ul>
          <h3 className="mb-1 mt-4 text-xs font-semibold uppercase text-gray-500">Seniority</h3>
          <p className="text-sm">Resume communicates <b>{a.match.seniority.detected}</b>; JD seniority: {a.jd.seniority}.</p>
        </Card>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card><h2 className="mb-2 text-sm font-semibold">Gaps</h2>{a.match.gaps.length ? a.match.gaps.map((g: any) => <div key={g.term} className="border-b border-line py-2 text-sm last:border-0"><b>{g.term}</b> <Badge tone={g.gap === "critical" ? "red" : g.gap === "medium" ? "amber" : "gray"}>{g.gap}</Badge> <Badge tone={g.kind === "presentation-gap" ? "blue" : "gray"}>{g.kind === "presentation-gap" ? "presentation gap" : "real skill gap"}</Badge><p className="mt-1 text-gray-600">{g.recommendation}</p></div>) : <p className="text-sm text-gray-500">No gaps found.</p>}</Card>
        <Card><h2 className="mb-2 text-sm font-semibold">Weak bullets in your resume</h2>{a.match.seniority.weakBullets.slice(0, 8).map((w: any, i: number) => <div key={i} className="border-b border-line py-2 text-sm last:border-0">“{w.text}”<p className="text-xs text-gray-500">{w.reason}</p></div>)}{!a.match.seniority.weakBullets.length && <p className="text-sm text-gray-500">None detected.</p>}</Card>
      </div>
    </div>
  );
}

function Requirements({ a }: { a: any }) {
  return (
    <Card className="overflow-x-auto p-0">
      <table className="w-full text-sm"><thead className="border-b border-line text-left text-xs uppercase text-gray-500"><tr><th className="p-3">JD requirement</th><th>Importance</th><th>Resume evidence</th><th>Match</th><th>Confidence</th><th>Action</th></tr></thead>
        <tbody>{a.match.requirements.map((r: any) => (
          <tr key={r.requirementId} className="border-b border-line align-top last:border-0">
            <td className="p-3 font-medium">{r.requirement}</td><td>{r.importance}</td>
            <td className="max-w-md py-3 pr-3 text-gray-700">{r.evidence[0] ? <><span className="text-xs text-gray-500">{r.evidence[0].roleLabel}</span><br />{r.evidence[0].text.slice(0, 160)}</> : <span className="text-gray-400">No evidence</span>}<p className="mt-1 text-xs text-gray-500">{r.explanation}</p></td>
            <td><Badge tone={matchTone(r.matchType)}>{r.matchType}</Badge></td><td>{r.confidence}</td><td className="pr-3">{r.action}</td>
          </tr>))}</tbody></table>
    </Card>
  );
}

function SkillMatch({ a }: { a: any }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card><h2 className="mb-2 text-sm font-semibold">Keyword analysis</h2>
        {a.match.keywordAnalysis.map((k: any) => <div key={k.term} className="border-b border-line py-2 text-sm last:border-0"><div className="flex items-center justify-between"><b>{k.term}</b><span className="flex gap-2 text-xs text-gray-500">JD ×{k.jdMentions}<Badge tone={matchTone(k.matchType)}>{k.matchType}</Badge></span></div>{k.why && <p className="mt-1 text-gray-600"><b>Why:</b> {k.why}</p>}</div>)}</Card>
      <div className="space-y-4">
        <Card><h2 className="mb-2 text-sm font-semibold">Strengths (mandatory, fully matched)</h2><div className="flex flex-wrap gap-1">{a.match.strengths.map((s: string) => <Badge key={s} tone="green">{s}</Badge>)}</div></Card>
        <Card><h2 className="mb-2 text-sm font-semibold">JD profile</h2>
          <dl className="space-y-1 text-sm"><div><dt className="inline text-gray-500">Seniority: </dt>{a.jd.seniority}</div><div><dt className="inline text-gray-500">Years required: </dt>{a.jd.yearsRequired ?? "not stated"}</div><div><dt className="inline text-gray-500">Education: </dt>{a.jd.education || "not stated"}</div><div><dt className="inline text-gray-500">Location: </dt>{a.jd.location || "not stated"}</div><div><dt className="inline text-gray-500">Work authorization: </dt>{a.jd.workAuthorization || "not mentioned"}</div></dl>
          {a.jd.leadershipExpectations.length > 0 && <><h3 className="mt-3 text-xs font-semibold uppercase text-gray-500">Leadership expectations</h3><ul className="list-disc pl-5 text-sm">{a.jd.leadershipExpectations.map((l: string, i: number) => <li key={i}>{l}</li>)}</ul></>}
          {a.jd.architectureExpectations.length > 0 && <><h3 className="mt-3 text-xs font-semibold uppercase text-gray-500">Architecture expectations</h3><ul className="list-disc pl-5 text-sm">{a.jd.architectureExpectations.map((l: string, i: number) => <li key={i}>{l}</li>)}</ul></>}
        </Card>
      </div>
    </div>
  );
}

function Downloads({ id, docs, disabled }: { id: string; docs: [string, string][]; disabled?: boolean }) {
  const [err, setErr] = useState<any>(null);
  async function get(doc: string, format: string) {
    setErr(null);
    const res = await fetch(`/api/applications/${id}/export?doc=${doc}&format=${format}`);
    if (!res.ok) { setErr(await res.json()); return; }
    const blob = await res.blob();
    const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? `${doc}.${format}`;
    const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = name; link.click(); URL.revokeObjectURL(url);
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">{docs.map(([doc, fmt]) => <Button key={doc + fmt} variant="outline" disabled={disabled} onClick={() => get(doc, fmt)}>Download {doc === "report" ? "match report" : doc === "cover" ? "cover letter" : "resume"} ({fmt.toUpperCase()})</Button>)}</div>
      {err && <div role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700"><b>{err.error}</b>{(err.claims ?? []).map((c: any, i: number) => <p key={i} className="mt-1">“{c.text}” — {c.reasons.join(" ")}</p>)}</div>}
    </div>
  );
}

function ResumeChanges({ a, reload }: { a: any; reload: () => void }) {
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<{ id: string; text: string } | null>(null);
  const [msg, setMsg] = useState("");
  const generated = !!a.tailored;
  async function generate() {
    if (generated && !confirm("Regenerating discards your accept/reject decisions and edits. Continue?")) return;
    setBusy(true); setMsg(""); try { await api(`/api/applications/${a.id}/generate`, { method: "POST" }); await reload(); } catch (e: any) { setMsg(e.message); } finally { setBusy(false); }
  }
  async function decide(changeId: string, decision: string, finalText?: string) {
    setMsg("");
    try { const r = await api(`/api/applications/${a.id}/changes`, { method: "PATCH", json: { changeId, decision, finalText } }); if (r.warning) setMsg(r.warning); setEdit(null); await reload(); } catch (e: any) { setMsg(e.message); }
  }
  async function acceptSafe() { await api(`/api/applications/${a.id}/changes`, { method: "PATCH", json: { acceptAllSafe: true } }); await reload(); }
  const pending = a.changes.filter((c: any) => c.decision === "pending").length;
  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-gray-700">{generated ? <>{a.changes.length} proposed changes · <b>{pending}</b> pending. Nothing is applied until you accept it. Reordering and trimming bullets to fit your page length is applied automatically; wording is never changed without approval.</> : "Generate a tailored resume, cover letter and truth audit from this analysis."}</p>
        <div className="flex gap-2">{generated && <Button variant="outline" onClick={acceptSafe}>Accept all safe changes</Button>}<Button disabled={busy} onClick={generate}>{busy ? "Generating…" : generated ? "Regenerate" : "Generate application pack"}</Button></div>
      </Card>
      {msg && <p role="alert" className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">{msg}</p>}
      {a.changes.map((c: any) => (
        <Card key={c.id} className={cn(c.status === "UNSUPPORTED" && "border-red-300")}>
          <div className="mb-2 flex flex-wrap items-center gap-2"><Badge tone="gray">{c.section}</Badge><Badge tone={statusTone(c.status)}>{c.status}</Badge>{c.hallucination && <Badge tone="red">POTENTIAL HALLUCINATION</Badge>}<Badge tone={c.decision === "accepted" || c.decision === "edited" ? "green" : c.decision === "rejected" ? "gray" : "amber"}>{c.decision}</Badge></div>
          <div className="grid gap-3 md:grid-cols-2">
            <div><Label>Original</Label><p className="whitespace-pre-wrap rounded bg-gray-50 p-2 text-sm">{c.original || <span className="text-gray-400">(none)</span>}</p></div>
            <div><Label>Proposed{c.decision === "edited" ? " (your edit applied)" : ""}</Label>{edit && edit.id === c.id ? <Textarea rows={4} value={edit.text} onChange={(e) => setEdit({ id: c.id, text: e.target.value })} /> : <p className="whitespace-pre-wrap rounded bg-green-50 p-2 text-sm">{c.decision === "edited" && c.finalText ? c.finalText : c.proposed}</p>}</div>
          </div>
          <p className="mt-2 text-sm text-gray-700"><b>Why:</b> {c.reason}</p>
          <p className="text-xs text-gray-500"><b>Evidence:</b> {c.evidence}</p>
          <div className="mt-3 flex gap-2">
            {edit && edit.id === c.id ? <><Button size="sm" onClick={() => decide(c.id, "edited", edit.text)}>Save edit</Button><Button size="sm" variant="ghost" onClick={() => setEdit(null)}>Cancel</Button></> : <>
              <Button size="sm" disabled={c.status === "UNSUPPORTED"} onClick={() => decide(c.id, "accepted")}>Accept</Button>
              <Button size="sm" variant="outline" onClick={() => decide(c.id, "rejected")}>Reject</Button>
              <Button size="sm" variant="ghost" onClick={() => setEdit({ id: c.id, text: c.decision === "edited" && c.finalText ? c.finalText : c.proposed })}>Edit</Button></>}
          </div>
        </Card>
      ))}
      {generated && a.final && (
        <Card>
          <h2 className="mb-2 text-sm font-semibold">Resume as it will be exported</h2>
          <ResumePreview r={a.final.resume} />
          <div className="mt-4"><Downloads id={a.id} docs={[["resume", "pdf"], ["resume", "docx"]]} /></div>
        </Card>
      )}
    </div>
  );
}

function ResumePreview({ r }: { r: any }) {
  return (
    <div className="max-h-[600px] overflow-auto rounded border border-line bg-white p-5 text-sm leading-relaxed">
      <div className="text-lg font-bold">{r.identity.name}</div>
      <div className="text-xs text-gray-600">{[r.identity.location, r.identity.email, r.identity.phone, r.identity.linkedin].filter(Boolean).join(" | ")}</div>
      {r.headline && <div className="mt-2 font-semibold">{r.headline}</div>}
      {r.summary && <Sec t="Professional summary"><p>{r.summary}</p></Sec>}
      {r.competencies.length > 0 && <Sec t="Core competencies"><p>{r.competencies.join(" • ")}</p></Sec>}
      <Sec t="Technical skills">{r.skills.map((s: any) => <p key={s.label}><b>{s.label}:</b> {s.items.join(", ")}</p>)}</Sec>
      <Sec t="Professional experience">{r.experience.map((e: any) => <div key={e.roleId} className="mb-2"><div className="font-semibold">{[e.title, e.employer].filter(Boolean).join(", ")}</div><div className="text-xs italic text-gray-600">{[e.dates, e.location].filter(Boolean).join(" | ")}</div><ul className="list-disc pl-5">{e.bullets.map((b: any, i: number) => <li key={i}>{b.text}</li>)}</ul></div>)}</Sec>
      {r.education.length > 0 && <Sec t="Education">{r.education.map((e: string, i: number) => <p key={i}>{e}</p>)}</Sec>}
    </div>
  );
}
const Sec = ({ t, children }: { t: string; children: React.ReactNode }) => <div className="mt-3"><div className="mb-1 border-b border-gray-400 text-xs font-bold uppercase">{t}</div>{children}</div>;

function CoverLetter({ a, reload }: { a: any; reload: () => void }) {
  const [paras, setParas] = useState<string[] | null>(null);
  const [msg, setMsg] = useState<any>(null);
  const l = a.letter;
  useEffect(() => { setParas(l?.paragraphs ?? null); }, [l]);
  if (!l) return <Card className="text-sm">Generate the application pack on the Resume Changes tab first.</Card>;
  const words = (paras ?? []).join(" ").split(/\s+/).filter(Boolean).length;
  async function save() { setMsg(null); try { await api(`/api/applications/${a.id}/cover-letter`, { method: "PUT", json: { paragraphs: paras } }); setMsg({ ok: "Saved." }); await reload(); } catch (e: any) { setMsg({ err: e.message, sentences: e.data?.sentences }); } }
  async function regen() { if (!confirm("Discard edits and regenerate?")) return; await api(`/api/applications/${a.id}/cover-letter`, { method: "POST" }); await reload(); }
  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <div className="flex items-center justify-between text-sm"><span>{l.date} · {l.salutation}</span><Badge tone={words >= 250 && words <= 400 ? "green" : "amber"}>{words} words (target 250–400)</Badge></div>
        {paras?.map((p, i) => <Textarea key={i} rows={Math.max(3, Math.ceil(p.length / 95))} value={p} onChange={(e) => setParas(paras.map((x, j) => (j === i ? e.target.value : x)))} />)}
        <div className="text-sm">{l.closing}<br /><b>{l.signature}</b></div>
        <div className="flex gap-2"><Button onClick={save}>Save edits</Button><Button variant="outline" onClick={regen}>Regenerate</Button></div>
        {msg?.ok && <p className="text-sm text-green-700">{msg.ok}</p>}
        {msg?.err && <div role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700"><b>{msg.err}</b>{msg.sentences?.map((s: any, i: number) => <p key={i} className="mt-1">“{s.text}” — {s.reasons.join(" ")}</p>)}</div>}
      </Card>
      {l.removed?.length > 0 && <Card className="border-amber-300 bg-amber-50 text-sm"><b>Removed during truth check:</b>{l.removed.map((r: any, i: number) => <p key={i} className="mt-1">“{r.text}” — {r.reasons.join(" ")}</p>)}</Card>}
      <Downloads id={a.id} docs={[["cover", "pdf"], ["cover", "docx"]]} />
    </div>
  );
}

function TruthAudit({ a }: { a: any }) {
  if (!a.final) return <Card className="text-sm">Generate the application pack first. The audit covers exactly what would be exported.</Card>;
  const { audit } = a.final;
  const lAudit = a.letterAudit;
  const flagged = [...audit.checks, ...(lAudit?.checks ?? [])].filter((c: any) => c.status === "INFERRED" || c.status === "UNSUPPORTED");
  return (
    <div className="space-y-4">
      <Card>
        <h2 className="mb-2 text-sm font-semibold">Final resume (decisions applied)</h2>
        <div className="flex flex-wrap gap-2">{(["VERIFIED", "SUPPORTED", "INFERRED", "UNSUPPORTED"] as const).map((s) => <Badge key={s} tone={statusTone(s)}>{s} {audit.counts[s]}</Badge>)}</div>
        {lAudit && <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">Cover letter: {(["VERIFIED", "SUPPORTED", "INFERRED", "UNSUPPORTED"] as const).map((s) => <Badge key={s} tone={statusTone(s)}>{s} {lAudit.counts[s]}</Badge>)}</div>}
        <p className="mt-2 text-sm text-gray-600">{audit.passed && (!lAudit || lAudit.passed) ? "No unsupported claims. Exports are enabled." : "Unsupported claims found — exports are blocked until they are fixed."}</p>
      </Card>
      {flagged.length > 0 && <Card><h2 className="mb-2 text-sm font-semibold">Needs your attention</h2>{flagged.map((c: any, i: number) => <div key={i} className="border-b border-line py-2 text-sm last:border-0"><Badge tone={statusTone(c.status)}>{c.status}</Badge> {c.hallucination && <Badge tone="red">POTENTIAL HALLUCINATION</Badge>} “{c.text}”<ul className="mt-1 list-disc pl-5 text-gray-600">{c.reasons.map((r: string, j: number) => <li key={j}>{r}</li>)}</ul></div>)}</Card>}
      <Card><h2 className="mb-2 text-sm font-semibold">All resume claims</h2><div className="max-h-96 overflow-auto">{audit.checks.map((c: any, i: number) => <div key={i} className="flex items-start gap-2 border-b border-line py-1.5 text-sm last:border-0"><Badge tone={statusTone(c.status)} className="shrink-0">{c.status}</Badge><span>{c.text}{c.evidence && c.status !== "VERIFIED" && <span className="block text-xs text-gray-500">Evidence: {c.evidence}</span>}</span></div>)}</div></Card>
      <Downloads id={a.id} docs={[["report", "pdf"]]} />
    </div>
  );
}

function Tracking({ a, reload, onDelete }: { a: any; reload: () => void; onDelete: () => void }) {
  const [f, setF] = useState({ status: a.status, company: a.company, roleTitle: a.roleTitle, jobUrl: a.jobUrl ?? "", notes: a.notes ?? "", recruiterName: a.recruiterName ?? "", recruiterContact: a.recruiterContact ?? "", appliedAt: a.appliedAt ? a.appliedAt.slice(0, 10) : "" });
  const [msg, setMsg] = useState("");
  const set = (k: string) => (e: React.ChangeEvent<any>) => setF({ ...f, [k]: e.target.value });
  async function save() { try { await api(`/api/applications/${a.id}`, { method: "PATCH", json: { ...f, jobUrl: f.jobUrl || null, notes: f.notes || null, recruiterName: f.recruiterName || null, recruiterContact: f.recruiterContact || null, appliedAt: f.appliedAt ? new Date(f.appliedAt).toISOString() : null } }); setMsg("Saved."); await reload(); } catch (e: any) { setMsg(e.message); } }
  async function del() { if (confirm("Delete this application and its generated documents?")) { await api(`/api/applications/${a.id}`, { method: "DELETE" }); onDelete(); } }
  return (
    <Card className="max-w-3xl space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        <div><Label>Status</Label><Select value={f.status} onChange={set("status")}>{STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}</Select></div>
        <div><Label>Application date</Label><Input type="date" value={f.appliedAt} onChange={set("appliedAt")} /></div>
        <div><Label>Company</Label><Input value={f.company} onChange={set("company")} /></div>
        <div><Label>Role</Label><Input value={f.roleTitle} onChange={set("roleTitle")} /></div>
        <div className="md:col-span-2"><Label>Job URL</Label><Input value={f.jobUrl} onChange={set("jobUrl")} /></div>
        <div><Label>Recruiter name</Label><Input value={f.recruiterName} onChange={set("recruiterName")} /></div>
        <div><Label>Recruiter contact</Label><Input value={f.recruiterContact} onChange={set("recruiterContact")} /></div>
      </div>
      <div><Label>Notes</Label><Textarea rows={4} value={f.notes} onChange={set("notes")} /></div>
      <div className="flex items-center gap-3"><Button onClick={save}>Save</Button><Button variant="danger" onClick={del}>Delete application</Button>{msg && <span role="status" className="text-sm text-gray-600">{msg}</span>}</div>
    </Card>
  );
}
