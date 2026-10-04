import { route, json } from "@/lib/server/api";
import { aiConfigured } from "@/lib/ai/server-transport";

export const GET = route(async () => { const c = aiConfigured(); return json({ available: !!c, provider: c?.name ?? null }); });
