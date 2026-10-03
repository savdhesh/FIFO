import { Analyzer } from "@/components/analyzer";
import { db } from "@/lib/server/db";
import { currentUser } from "@/lib/server/session";
import { ProfileSchema } from "@/lib/types";

export default async function Page() {
  const user = (await currentUser())!;
  const row = await db.careerProfile.findUnique({ where: { userId: user.id } });
  const p = row ? ProfileSchema.parse(row.data) : null;
  return <Analyzer profile={p ? { name: p.identity.name, roles: p.roles.length, latest: p.roles[0]?.title ?? "" } : null} />;
}
