"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button, Card, Input, Label, Select, Textarea } from "@/components/ui";
import { api } from "@/lib/ui/client";
import { COUNTRY_NAMES } from "@/lib/countries";
import { DEMO_JD_TEXT } from "@/lib/demo";

export function Analyzer({ profile }: { profile: { name: string; roles: number; latest: string } | null }) {
  const r = useRouter();
  const [jd, setJd] = useState("");
  const [url, setUrl] = useState("");
  const [f, setF] = useState({ company: "", title: "", country: "USA", seniority: "Principal", length: "3" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function fetchUrl() { setErr(""); setBusy(true); try { const x = await api("/api/jobs/fetch", { method: "POST", json: { url } }); setJd(x.text); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } }
  async function analyze() {
    setErr(""); setBusy(true);
    try { const x = await api("/api/applications", { method: "POST", json: { jdText: jd, jobUrl: url || undefined, company: f.company || undefined, title: f.title || undefined, settings: { targetRole: f.title, country: f.country, seniority: f.seniority, length: f.length } } }); r.push(`/applications/${x.id}`); }
    catch (e: any) { setErr(e.message); setBusy(false); }
  }
  const set = (k: string) => (e: React.ChangeEvent<any>) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="max-w-6xl space-y-4">
      <h1 className="text-xl font-semibold">Job Analyzer</h1>
      {!profile && <Card className="border-amber-300 bg-amber-50 text-sm">You need a career profile first. <Link className="underline" href="/resume">Upload a resume</Link>.</Card>}
      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="space-y-3 lg:col-span-3">
          <div><Label>Job posting URL (optional)</Label><div className="flex gap-2"><Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" /><Button variant="outline" disabled={!url || busy} onClick={fetchUrl}>Fetch</Button></div><p className="mt-1 text-xs text-gray-500">Some job boards block fetching or need login — paste the text if it fails.</p></div>
          <div><div className="flex items-center justify-between"><Label>Job description</Label><button className="text-xs underline" onClick={() => setJd(DEMO_JD_TEXT)}>Use sample JD</button></div><Textarea rows={20} value={jd} onChange={(e) => setJd(e.target.value)} placeholder="Paste the full job description…" /></div>
        </Card>
        <Card className="space-y-3 lg:col-span-2">
          <h2 className="text-sm font-semibold">Candidate &amp; target</h2>
          <p className="text-sm text-gray-600">{profile ? <>Profile: <b>{profile.name || "Unnamed"}</b> · {profile.roles} roles{profile.latest && ` · ${profile.latest}`}</> : "No profile"}</p>
          <div><Label>Company (auto-detected if blank)</Label><Input value={f.company} onChange={set("company")} /></div>
          <div><Label>Target role (auto-detected if blank)</Label><Input value={f.title} onChange={set("title")} /></div>
          <div><Label>Target country</Label><Select value={f.country} onChange={set("country")}>{COUNTRY_NAMES.map((c) => <option key={c}>{c}</option>)}</Select></div>
          <div><Label>Desired seniority</Label><Select value={f.seniority} onChange={set("seniority")}>{["Engineer", "Senior", "Staff", "Principal", "Architect", "Lead", "Manager"].map((c) => <option key={c}>{c}</option>)}</Select></div>
          <div><Label>Resume length</Label><Select value={f.length} onChange={set("length")}>{[["1", "1 page"], ["2", "2 pages"], ["3", "3 pages"], ["4", "4 pages"], ["cv", "Detailed technical CV"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></div>
          {err && <p role="alert" className="text-sm text-red-600">{err}</p>}
          <Button className="w-full" disabled={busy || !profile || jd.length < 80} onClick={analyze}>{busy ? "Analyzing…" : "Analyze match"}</Button>
        </Card>
      </div>
    </div>
  );
}
