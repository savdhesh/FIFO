import { z } from "zod";
import { db } from "@/lib/server/db";
import { route, json, HttpError } from "@/lib/server/api";
import { auditChangeText, loadProfile, ownApplication, view } from "@/lib/server/service";

const Body = z.union([
  z.object({ acceptAllSafe: z.literal(true) }),
  z.object({ changeId: z.string(), decision: z.enum(["accepted", "rejected", "pending"]) }),
  z.object({ changeId: z.string(), decision: z.literal("edited"), finalText: z.string().min(1).max(2000) }),
]);

export const PATCH = route(async (req, { user, params }) => {
  const app = await ownApplication(user.id, params.id);
  const v = view(app);
  const b = Body.parse(await req.json());
  const profile = await loadProfile(user.id);
  const allowed = [v.jd.company, v.jd.roleTitle];
  let warning: string | undefined;
  if ("acceptAllSafe" in b) {
    // Only VERIFIED/SUPPORTED. INFERRED needs explicit per-item approval; UNSUPPORTED can never be accepted.
    for (const c of v.changes) if (c.decision === "pending" && (c.status === "VERIFIED" || c.status === "SUPPORTED")) c.decision = "accepted";
  } else {
    const c = v.changes.find((x) => x.id === b.changeId);
    if (!c) throw new HttpError(404, "Change not found");
    if (b.decision === "accepted" && c.status === "UNSUPPORTED") throw new HttpError(422, "This change contains unsupported claims and cannot be accepted. Edit it so it only uses facts from your profile.", { reasons: auditChangeText(c, c.proposed, profile, allowed).checks.flatMap((k) => k.reasons) });
    if (b.decision === "edited") {
      const r = auditChangeText(c, b.finalText, profile, allowed);
      c.finalText = b.finalText; c.status = r.status; c.hallucination = r.hallucination; c.decision = "edited";
      if (r.status === "UNSUPPORTED") warning = `POTENTIAL HALLUCINATION: ${r.checks.flatMap((k) => k.reasons).join(" ")} This text will be excluded from exports until fixed.`;
    } else c.decision = b.decision;
  }
  await db.application.update({ where: { id: app.id }, data: { changes: v.changes as object[] } });
  return json({ changes: v.changes, warning });
});
