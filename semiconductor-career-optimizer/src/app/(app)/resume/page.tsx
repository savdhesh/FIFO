import { db } from "@/lib/server/db";
import { currentUser } from "@/lib/server/session";
import { ResumeManager } from "@/components/resume-manager";

export default async function Page() {
  const user = (await currentUser())!;
  const [files, profile] = await Promise.all([
    db.resumeFile.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, select: { id: true, filename: true, size: true, createdAt: true } }),
    db.careerProfile.findUnique({ where: { userId: user.id }, select: { id: true } }),
  ]);
  return <ResumeManager files={files.map((f) => ({ ...f, createdAt: f.createdAt.toISOString() }))} hasProfile={!!profile} provider={process.env.AI_PROVIDER || "mock"} />;
}
