"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Input, Label, Badge } from "@/components/ui";
import { api } from "@/lib/ui/client";

export function SettingsPanel({ email, provider, external, storage }: { email: string; provider: string; external: boolean; storage: string }) {
  const r = useRouter();
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState("");
  async function logout() { await api("/api/auth/logout", { method: "POST" }); r.push("/login"); r.refresh(); }
  async function wipe(scope: "data" | "account") {
    if (!confirm(scope === "account" ? "Permanently delete your account and ALL data? This cannot be undone." : "Permanently delete your profile, resumes and applications? This cannot be undone.")) return;
    try { await api("/api/account", { method: "DELETE", json: { password: pw, scope } }); if (scope === "account") { r.push("/login"); r.refresh(); } else { setMsg("All data deleted."); r.refresh(); } } catch (e: any) { setMsg(e.message); }
  }
  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-xl font-semibold">Settings</h1>
      <Card className="space-y-2 text-sm"><div>Signed in as <b>{email}</b></div><div>AI provider: <Badge tone={external ? "amber" : "green"}>{provider}</Badge> {external ? "— resume and job text is sent to this vendor for processing." : "— runs fully on this server; no data leaves it."}</div><div>Storage: <Badge>{storage}</Badge> (private, authenticated access only)</div><Button variant="outline" onClick={logout}>Sign out</Button></Card>
      <Card className="space-y-3"><h2 className="text-sm font-semibold text-red-700">Delete data</h2>
        <p className="text-sm text-gray-600">Resume files, parsed profile, analyses and generated documents are removed permanently. Resume content is never used for training.</p>
        <div><Label>Confirm password</Label><Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} /></div>
        <div className="flex gap-2"><Button variant="danger" disabled={!pw} onClick={() => wipe("data")}>Delete all my data</Button><Button variant="danger" disabled={!pw} onClick={() => wipe("account")}>Delete account</Button></div>
        {msg && <p role="status" className="text-sm">{msg}</p>}
      </Card>
    </div>
  );
}
