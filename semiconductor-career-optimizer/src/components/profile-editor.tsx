"use client";
import { useState } from "react";
import Link from "next/link";
import { Button, Card, Input, Label, Textarea } from "@/components/ui";
import { api } from "@/lib/ui/client";
import { SKILL_CATEGORIES, type Profile, type Role } from "@/lib/types";

const csv = (a: string[]) => a.join(", ");
const unCsv = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
const lines = (a: string[]) => a.join("\n");
const unLines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
const SKILL_LABEL: Record<string, string> = { languages: "HDL / Languages", verification: "Verification", formal: "Formal verification", processor: "Processor / ISA", protocols: "Interfaces / Protocols", domains: "Verification domains", tools: "Tools", methodologies: "Methodologies" };

export function ProfileEditor({ initial }: { initial: Profile | null }) {
  const [p, setP] = useState<Profile | null>(initial);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  if (!p) return <div className="max-w-xl"><h1 className="mb-2 text-xl font-semibold">Career Profile</h1><Card className="text-sm">No profile yet. <Link className="underline" href="/resume">Upload your master resume</Link> first.</Card></div>;

  const setRole = (i: number, patch: Partial<Role>) => setP({ ...p, roles: p.roles.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const save = async () => { setBusy(true); setMsg(""); try { const r = await api("/api/profile", { method: "PUT", json: p }); setP(r.profile); setMsg("Saved."); } catch (e: any) { setMsg(e.message); } finally { setBusy(false); } };
  const id = (k: keyof Profile["identity"], label: string) => <div key={k}><Label>{label}</Label><Input value={p.identity[k]} onChange={(e) => setP({ ...p, identity: { ...p.identity, [k]: e.target.value } })} /></div>;

  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex items-center justify-between"><h1 className="text-xl font-semibold">Career Profile</h1><div className="flex items-center gap-3">{msg && <span role="status" className="text-sm text-gray-600">{msg}</span>}<Button disabled={busy} onClick={save}>Save profile</Button></div></div>
      <p className="text-sm text-gray-600">This is the single source of truth. Every generated claim is checked against it, so correct anything the parser got wrong.</p>
      <Card><h2 className="mb-3 text-sm font-semibold">Identity</h2><div className="grid gap-3 md:grid-cols-3">{id("name", "Name")}{id("location", "Location")}{id("email", "Email")}{id("phone", "Phone")}{id("linkedin", "LinkedIn")}{id("github", "GitHub")}{id("portfolio", "Portfolio")}</div></Card>
      <Card><Label>Summary (your own words)</Label><Textarea rows={3} value={p.summary} onChange={(e) => setP({ ...p, summary: e.target.value })} /></Card>
      {p.roles.map((r, i) => (
        <Card key={r.id} className="space-y-3">
          <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">{r.title || "Role"} {r.employer && `· ${r.employer}`}</h2><button className="text-xs text-red-600 underline" onClick={() => confirm("Remove this role?") && setP({ ...p, roles: p.roles.filter((_, j) => j !== i) })}>Remove</button></div>
          <div className="grid gap-3 md:grid-cols-3">
            {([["title", "Title"], ["employer", "Employer"], ["client", "Customer / client"], ["location", "Location"], ["startDate", "Start (e.g. Jan 2020)"], ["endDate", "End (or Present)"], ["employmentType", "Employment type"], ["teamSize", "Team size (only if stated)"]] as const).map(([k, l]) => <div key={k}><Label>{l}</Label><Input value={r[k]} onChange={(e) => setRole(i, { [k]: e.target.value } as Partial<Role>)} /></div>)}
          </div>
          <div><Label>Responsibilities (one bullet per line)</Label><Textarea rows={6} value={lines(r.responsibilities)} onChange={(e) => setRole(i, { responsibilities: unLines(e.target.value) })} /></div>
          <div><Label>Achievements with real metrics (one per line)</Label><Textarea rows={3} value={lines(r.achievements)} onChange={(e) => setRole(i, { achievements: unLines(e.target.value) })} /></div>
          <div className="grid gap-3 md:grid-cols-2">
            {([["technologies", "Technologies"], ["tools", "Tools"], ["protocols", "Protocols"], ["methodologies", "Methodologies"]] as const).map(([k, l]) => <div key={k}><Label>{l} (comma separated)</Label><Input value={csv(r[k])} onChange={(e) => setRole(i, { [k]: unCsv(e.target.value) } as Partial<Role>)} /></div>)}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {([["leadership", "Leadership responsibility"], ["technicalOwnership", "Technical ownership"], ["architectureOwnership", "Architecture ownership"], ["customerFacing", "Customer-facing responsibility"]] as const).map(([k, l]) => <div key={k}><Label>{l}</Label><Textarea rows={2} value={r[k]} onChange={(e) => setRole(i, { [k]: e.target.value } as Partial<Role>)} /></div>)}
          </div>
        </Card>
      ))}
      <Button variant="outline" onClick={() => setP({ ...p, roles: [...p.roles, { id: `r${Date.now().toString(36)}`, employer: "", client: "", title: "", location: "", startDate: "", endDate: "", employmentType: "", responsibilities: [], achievements: [], technologies: [], methodologies: [], protocols: [], tools: [], leadership: "", teamSize: "", technicalOwnership: "", architectureOwnership: "", customerFacing: "" }] })}>+ Add role</Button>
      <Card className="space-y-3"><h2 className="text-sm font-semibold">Technical skills</h2>
        {SKILL_CATEGORIES.map((k) => <div key={k}><Label>{SKILL_LABEL[k]}</Label><Input value={csv(p.skills[k])} onChange={(e) => setP({ ...p, skills: { ...p.skills, [k]: unCsv(e.target.value) } })} /></div>)}
      </Card>
      <Card className="space-y-3"><h2 className="text-sm font-semibold">Education</h2>
        {p.education.map((e, i) => <div key={i} className="grid gap-3 md:grid-cols-4">{(["degree", "university", "specialization", "year"] as const).map((k) => <div key={k}><Label>{k}</Label><Input value={e[k]} onChange={(ev) => setP({ ...p, education: p.education.map((x, j) => (j === i ? { ...x, [k]: ev.target.value } : x)) })} /></div>)}</div>)}
        <Button variant="outline" size="sm" onClick={() => setP({ ...p, education: [...p.education, { degree: "", university: "", specialization: "", year: "" }] })}>+ Add education</Button>
      </Card>
      <Card className="grid gap-3 md:grid-cols-2"><div><Label>Certifications (one per line)</Label><Textarea rows={3} value={lines(p.certifications)} onChange={(e) => setP({ ...p, certifications: unLines(e.target.value) })} /></div><div><Label>Publications / patents (one per line)</Label><Textarea rows={3} value={lines(p.publications)} onChange={(e) => setP({ ...p, publications: unLines(e.target.value) })} /></div></Card>
      <Button disabled={busy} onClick={save}>Save profile</Button>
    </div>
  );
}
