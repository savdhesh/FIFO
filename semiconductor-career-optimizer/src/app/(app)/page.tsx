import Link from "next/link";
import { db } from "@/lib/server/db";
import { currentUser } from "@/lib/server/session";
import { Card, Badge } from "@/components/ui";
import type { MatchResult } from "@/lib/types";

export default async function Dashboard() {
  const user = (await currentUser())!;
  const [apps, profile] = await Promise.all([db.application.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" } }), db.careerProfile.findUnique({ where: { userId: user.id } })]);
  const weekAgo = Date.now() - 7 * 86400_000;
  const thisWeek = apps.filter((a) => a.createdAt.getTime() > weekAgo).length;
  const avg = apps.length ? Math.round(apps.reduce((s, a) => s + a.matchScore, 0) / apps.length) : null;
  const applied = apps.filter((a) => !["SAVED", "ANALYZED", "APPLYING"].includes(a.status));
  const interviews = apps.filter((a) => ["SCREENING", "TECHNICAL_ROUND", "HIRING_MANAGER", "FINAL_ROUND", "OFFER"].includes(a.status)).length;
  const offers = apps.filter((a) => a.status === "OFFER").length;
  const responded = applied.filter((a) => !["APPLIED", "REJECTED", "WITHDRAWN"].includes(a.status) || a.status === "REJECTED").length;
  const gapCount = new Map<string, number>(), skillCount = new Map<string, number>();
  for (const a of apps) for (const r of (a.match as unknown as MatchResult).requirements) {
    if (r.gap !== "none" && r.gap !== "keyword-only") gapCount.set(r.requirement, (gapCount.get(r.requirement) ?? 0) + 1);
    if (r.score >= 0.9 && r.type !== "experience" && r.type !== "education") skillCount.set(r.requirement, (skillCount.get(r.requirement) ?? 0) + 1);
  }
  const top = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const stat = (label: string, v: string | number) => <Card><div className="text-xs uppercase tracking-wide text-gray-500">{label}</div><div className="mt-1 text-2xl font-semibold">{v}</div></Card>;
  return (
    <div className="max-w-5xl space-y-6">
      <h1 className="text-xl font-semibold">Dashboard</h1>
      {!profile && <Card className="border-amber-300 bg-amber-50 text-sm">No career profile yet. <Link className="underline" href="/resume">Upload your master resume</Link> (or load the demo profile) to start.</Card>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {stat("Applications this week", thisWeek)}{stat("Average match", avg ?? "–")}{stat("Interviews", interviews)}{stat("Offers", offers)}{stat("Response rate", applied.length ? `${Math.round((responded / applied.length) * 100)}%` : "–")}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card><h2 className="mb-2 text-sm font-semibold">Top matching skills</h2>{top(skillCount).map(([k, n]) => <div key={k} className="flex justify-between text-sm"><span>{k}</span><span className="text-gray-500">{n}</span></div>) || null}{!skillCount.size && <p className="text-sm text-gray-500">Analyze a job to see data.</p>}</Card>
        <Card><h2 className="mb-2 text-sm font-semibold">Most frequent gaps</h2>{top(gapCount).map(([k, n]) => <div key={k} className="flex justify-between text-sm"><span>{k}</span><span className="text-gray-500">{n}</span></div>)}{!gapCount.size && <p className="text-sm text-gray-500">No gaps recorded yet.</p>}</Card>
      </div>
      <Card>
        <h2 className="mb-2 text-sm font-semibold">Recent applications</h2>
        {apps.slice(0, 6).map((a) => <Link key={a.id} href={`/applications/${a.id}`} className="flex items-center justify-between border-b border-line py-2 text-sm last:border-0 hover:bg-gray-50"><span>{a.roleTitle || "Untitled"} <span className="text-gray-500">· {a.company || "Unknown company"}</span></span><span className="flex gap-2"><Badge tone="gray">{a.status.replace(/_/g, " ")}</Badge><Badge tone={a.matchScore >= 75 ? "green" : a.matchScore >= 55 ? "amber" : "red"}>{a.matchScore}</Badge></span></Link>)}
        {!apps.length && <p className="text-sm text-gray-500">Nothing yet. <Link className="underline" href="/analyzer">Analyze a job</Link>.</p>}
      </Card>
    </div>
  );
}
