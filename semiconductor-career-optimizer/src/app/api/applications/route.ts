import { z } from "zod";
import { db } from "@/lib/server/db";
import { route, json } from "@/lib/server/api";
import { createAnalysis } from "@/lib/server/service";
import { SettingsSchema } from "@/lib/types";

const Body = z.object({
  jdText: z.string().min(80, "Paste the full job description").max(60_000),
  jobUrl: z.string().url().max(2000).optional().or(z.literal("")),
  company: z.string().max(120).optional(), title: z.string().max(160).optional(),
  settings: SettingsSchema,
});

export const GET = route(async (_req, { user }) => {
  const apps = await db.application.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, select: { id: true, company: true, roleTitle: true, matchScore: true, recommendation: true, status: true, createdAt: true, appliedAt: true, jobUrl: true } });
  return json({ applications: apps });
});

export const POST = route(async (req, { user }) => {
  const b = Body.parse(await req.json());
  const app = await createAnalysis(user.id, b);
  return json({ id: app.id }, 201);
}, { limit: { max: 30, windowMs: 3600_000, name: "analyze" } });
