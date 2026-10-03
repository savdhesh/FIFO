import { z } from "zod";
import { route, json } from "@/lib/server/api";
import { fetchJobPage } from "@/lib/server/security";

export const POST = route(async (req) => {
  const { url } = z.object({ url: z.string().url().max(2000) }).parse(await req.json());
  return json({ text: await fetchJobPage(url) });
}, { limit: { max: 20, windowMs: 3600_000, name: "fetch-job" } });
