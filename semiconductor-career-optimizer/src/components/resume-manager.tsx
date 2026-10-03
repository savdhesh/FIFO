"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button, Card, Badge } from "@/components/ui";
import { api } from "@/lib/ui/client";

type F = { id: string; filename: string; size: number; createdAt: string };

export function ResumeManager({ files, hasProfile, provider }: { files: F[]; hasProfile: boolean; provider: string }) {
  const r = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [pending, setPending] = useState<any>(null);

  async function upload(file: File) {
    setBusy(true); setMsg(null); setPending(null);
    const fd = new FormData(); fd.append("file", file);
    try {
      const res = await api("/api/resume/upload", { method: "POST", body: fd });
      if (res.applied) { setMsg({ tone: "ok", text: "Resume parsed and saved as your career profile. Review it on the Career Profile page." }); r.refresh(); }
      else { setPending(res.parsed); setMsg({ tone: "ok", text: "Resume parsed. Your existing profile was NOT changed — apply the parse below if you want to replace it." }); r.refresh(); }
    } catch (e: any) { setMsg({ tone: "err", text: e.message }); } finally { setBusy(false); if (input.current) input.current.value = ""; }
  }
  async function applyParsed() { await api("/api/profile", { method: "PUT", json: pending }); setPending(null); setMsg({ tone: "ok", text: "Profile replaced." }); r.refresh(); }
  async function demo() { if (hasProfile && !confirm("Replace your current profile with the fictional demo profile?")) return; await api("/api/demo", { method: "POST" }); setMsg({ tone: "ok", text: "Demo profile loaded (fictional data)." }); r.refresh(); }
  async function del(id: string) { if (!confirm("Delete this file permanently?")) return; await api(`/api/resume/${id}`, { method: "DELETE" }); r.refresh(); }

  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">Master Resume</h1>
      <Card className="space-y-3">
        <p className="text-sm text-gray-600">Upload a PDF, DOCX or TXT (max 5 MB). Files are stored privately and never served from a public URL. Extraction runs {provider === "mock" ? "locally on this server" : <>through the <b>{provider}</b> AI provider (resume text is sent to that vendor)</>}.</p>
        <div className="flex flex-wrap gap-2">
          <input ref={input} type="file" accept=".pdf,.docx,.txt" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          <Button disabled={busy} onClick={() => input.current?.click()}>{busy ? "Parsing…" : "Upload resume"}</Button>
          <Button variant="outline" onClick={demo}>Load demo profile</Button>
          {hasProfile && <Link href="/profile"><Button variant="outline">Edit career profile →</Button></Link>}
        </div>
        {msg && <p role="status" className={msg.tone === "ok" ? "text-sm text-green-700" : "text-sm text-red-600"}>{msg.text}</p>}
        {pending && <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">Parsed: {pending.roles.length} roles, {pending.education.length} education entries. <Button size="sm" className="ml-2" onClick={applyParsed}>Replace my profile with this</Button></div>}
      </Card>
      <Card>
        <h2 className="mb-2 text-sm font-semibold">Uploaded files</h2>
        {files.map((f) => (
          <div key={f.id} className="flex items-center justify-between border-b border-line py-2 text-sm last:border-0">
            <span>{f.filename} <Badge>{(f.size / 1024).toFixed(0)} KB</Badge> <span className="text-gray-500">{new Date(f.createdAt).toLocaleDateString()}</span></span>
            <span className="flex gap-2"><a className="text-accent underline" href={`/api/resume/${f.id}`}>Download</a><button className="text-red-600 underline" onClick={() => del(f.id)}>Delete</button></span>
          </div>
        ))}
        {!files.length && <p className="text-sm text-gray-500">No files uploaded.</p>}
      </Card>
    </div>
  );
}
