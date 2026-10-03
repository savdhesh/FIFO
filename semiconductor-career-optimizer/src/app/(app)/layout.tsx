import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/server/session";

const NAV: [string, string, boolean][] = [
  ["/", "Dashboard", true], ["/profile", "Career Profile", true], ["/resume", "Master Resume", true], ["/analyzer", "Job Analyzer", true],
  ["/applications", "Applications", true], ["#", "Resume Versions", false], ["#", "Cover Letters", false], ["#", "LinkedIn Optimizer", false], ["#", "Interview Prep", false], ["/settings", "Settings", true],
];

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 border-r border-line bg-white p-4">
        <div className="mb-6 text-sm font-semibold leading-tight">Semiconductor<br />Career Optimizer</div>
        <nav className="space-y-1 text-sm">
          {NAV.map(([href, label, on]) => on
            ? <Link key={label} href={href} className="block rounded px-2 py-1.5 hover:bg-gray-100">{label}</Link>
            : <span key={label} title="Planned for a later phase" className="block cursor-not-allowed rounded px-2 py-1.5 text-gray-400">{label}</span>)}
        </nav>
        <div className="mt-8 truncate text-xs text-gray-500">{user.email}</div>
      </aside>
      <main className="min-w-0 flex-1 p-6">{children}</main>
    </div>
  );
}
