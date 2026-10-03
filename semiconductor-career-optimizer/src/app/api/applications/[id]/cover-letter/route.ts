import { z } from "zod";
import { db } from "@/lib/server/db";
import { route, json, HttpError } from "@/lib/server/api";
import { loadProfile, ownApplication, view } from "@/lib/server/service";
import { auditProse, summarizeChecks } from "@/lib/truth/truth";
import { buildIndex } from "@/lib/profile-index";
import { getProvider } from "@/lib/ai";

/** Regenerate the cover letter. */
export const POST = route(async (_req, { user, params }) => {
  const app = await ownApplication(user.id, params.id);
  const v = view(app);
  const letter = await getProvider().generateCoverLetter(await loadProfile(user.id), v.jd, v.match, v.settings);
  await db.application.update({ where: { id: app.id }, data: { coverLetter: letter as object } });
  return json({ letter });
}, { limit: { max: 20, windowMs: 3600_000, name: "cover" } });

/** Save user edits; every sentence is re-audited and UNSUPPORTED text is rejected. */
export const PUT = route(async (req, { user, params }) => {
  const app = await ownApplication(user.id, params.id);
  const v = view(app);
  if (!v.letter) throw new HttpError(409, "Generate the application pack first.");
  const { paragraphs } = z.object({ paragraphs: z.array(z.string().min(1).max(3000)).min(1).max(8) }).parse(await req.json());
  const profile = await loadProfile(user.id);
  const checks = auditProse(paragraphs.join("\n"), { index: buildIndex(profile), allowedNames: [v.jd.company, v.jd.roleTitle] });
  const bad = checks.filter((c) => c.status === "UNSUPPORTED");
  if (bad.length) throw new HttpError(422, "POTENTIAL HALLUCINATION: some sentences are not supported by your profile.", { sentences: bad.map((b) => ({ text: b.text, reasons: b.reasons })) });
  const letter = { ...v.letter, paragraphs, checks, removed: [], wordCount: paragraphs.join(" ").split(/\s+/).length };
  await db.application.update({ where: { id: app.id }, data: { coverLetter: letter as object } });
  return json({ letter, audit: summarizeChecks(checks) });
});
