import { z } from "zod";
import { route, json } from "@/lib/server/api";
import { loadProfile, ownApplication, view } from "@/lib/server/service";
import { getProvider } from "@/lib/ai";

const Body = z.object({
  kind: z.enum(["linkedin", "messages", "interview"]),
  currentHeadline: z.string().max(300).optional(), currentAbout: z.string().max(5000).optional(),
  recruiterName: z.string().max(120).optional(), hiringManagerName: z.string().max(120).optional(),
});

/** Phase 3 on the server app: LinkedIn plan or recruiter messages (computed on demand, not stored). */
export const POST = route(async (req, { user, params }) => {
  const b = Body.parse(await req.json());
  const v = view(await ownApplication(user.id, params.id));
  const profile = await loadProfile(user.id);
  const p = getProvider();
  if (b.kind === "interview") return json({ interview: await p.generateInterviewPrep(profile, v.jd, v.match, v.settings) });
  return json(b.kind === "linkedin"
    ? { linkedin: await p.optimizeLinkedIn(profile, v.jd, v.match, v.settings, { headline: b.currentHeadline, about: b.currentAbout }) }
    : { outreach: await p.generateRecruiterMessage(profile, v.jd, v.match, v.settings, { recruiterName: b.recruiterName, hiringManagerName: b.hiringManagerName }) });
}, { limit: { max: 30, windowMs: 3600_000, name: "outreach" } });
