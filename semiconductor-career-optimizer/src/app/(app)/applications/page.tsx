import Link from "next/link";
import { db } from "@/lib/server/db";
import { currentUser } from "@/lib/server/session";
import { Badge, Card } from "@/components/ui";

export default async function Page() {
  const user = (await currentUser())!;
  const apps = await db.application.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" } });
  return (
    <div className="max-w-5xl space-y-4">
      <div className="flex items-center justify-between"><h1 className="text-xl font-semibold">Applications</h1><Link className="text-sm underline" href="/analyzer">+ Analyze a job</Link></div>
      <Card className="p-0">
        <table className="w-full text-sm"><thead className="border-b border-line text-left text-xs uppercase text-gray-500"><tr><th className="p-3">Role</th><th>Company</th><th>Match</th><th>Verdict</th><th>Status</th><th>Created</th></tr></thead>
          <tbody>{apps.map((a) => <tr key={a.id} className="border-b border-line last:border-0 hover:bg-gray-50"><td className="p-3"><Link className="underline" href={`/applications/${a.id}`}>{a.roleTitle || "Untitled"}</Link></td><td>{a.company}</td><td>{a.matchScore}</td><td><Badge tone={a.recommendation.includes("STRONG") || a.recommendation === "APPLY" ? "green" : a.recommendation.includes("GAPS") ? "amber" : "red"}>{a.recommendation}</Badge></td><td>{a.status.replace(/_/g, " ")}</td><td>{a.createdAt.toLocaleDateString()}</td></tr>)}</tbody></table>
        {!apps.length && <p className="p-4 text-sm text-gray-500">No applications yet.</p>}
      </Card>
    </div>
  );
}
