"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button, Card, Input, Label } from "@/components/ui";
import { api } from "@/lib/ui/client";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const r = useRouter();
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setErr("");
    const f = new FormData(e.currentTarget);
    try { await api(`/api/auth/${mode}`, { method: "POST", json: Object.fromEntries(f) }); r.push("/"); r.refresh(); }
    catch (x: any) { setErr(x.message); } finally { setBusy(false); }
  }
  return (
    <main className="mx-auto mt-24 max-w-sm px-4">
      <h1 className="mb-1 text-xl font-semibold">Semiconductor Career Optimizer</h1>
      <p className="mb-6 text-sm text-gray-500">Truth-protected application tailoring for verification engineers.</p>
      <Card>
        <form onSubmit={submit} className="space-y-3">
          {mode === "register" && <div><Label>Name</Label><Input name="name" autoComplete="name" /></div>}
          <div><Label>Email</Label><Input name="email" type="email" required autoComplete="email" /></div>
          <div><Label>Password</Label><Input name="password" type="password" required minLength={mode === "register" ? 10 : 1} autoComplete={mode === "login" ? "current-password" : "new-password"} />{mode === "register" && <p className="mt-1 text-xs text-gray-500">At least 10 characters.</p>}</div>
          {err && <p role="alert" className="text-sm text-red-600">{err}</p>}
          <Button disabled={busy} className="w-full">{mode === "login" ? "Sign in" : "Create account"}</Button>
        </form>
      </Card>
      <p className="mt-4 text-center text-sm text-gray-600">{mode === "login" ? <>No account? <Link className="underline" href="/register">Register</Link></> : <>Have an account? <Link className="underline" href="/login">Sign in</Link></>}</p>
    </main>
  );
}
