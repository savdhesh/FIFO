import { route, json } from "@/lib/server/api";
import { generatePack, ownApplication, view } from "@/lib/server/service";

export const POST = route(async (_req, { user, params }) => {
  const a = await generatePack(user.id, await ownApplication(user.id, params.id));
  return json({ ...view(a), truthAudit: a.truthAudit });
}, { limit: { max: 20, windowMs: 3600_000, name: "generate" } });
