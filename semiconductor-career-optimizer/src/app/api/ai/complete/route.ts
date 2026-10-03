import { z } from "zod";
import { route, json, HttpError } from "@/lib/server/api";
import { serverTransport } from "@/lib/ai/server-transport";
import { log } from "@/lib/server/log";

const Body = z.object({ system: z.string().max(40_000), user: z.string().min(1).max(200_000) });

/** Thin authenticated proxy to the configured AI vendor. The API key never reaches the browser; content is never logged. */
export const POST = route(async (req, { user }) => {
  const b = Body.parse(await req.json());
  const t = serverTransport();
  if (!t) throw new HttpError(501, "No AI provider is configured on this server (set AI_PROVIDER and its API key).");
  const started = Date.now();
  try {
    const text = await t.complete(b.system, b.user);
    log("info", "ai_complete", { userId: user.id, provider: t.name, ms: Date.now() - started, bytes: b.user.length });
    return json({ text });
  } catch {
    log("error", "ai_error", { userId: user.id, provider: t.name });
    throw new HttpError(502, "The AI provider request failed. Try again, or switch it off to use the built-in engine.");
  }
}, { limit: { max: 80, windowMs: 3600_000, name: "ai" } });
