import { db } from "@/lib/server/db";
import { currentUser } from "@/lib/server/session";
import { ProfileEditor } from "@/components/profile-editor";
import { ProfileSchema } from "@/lib/types";

export default async function Page() {
  const user = (await currentUser())!;
  const row = await db.careerProfile.findUnique({ where: { userId: user.id } });
  return <ProfileEditor initial={row ? ProfileSchema.parse(row.data) : null} />;
}
