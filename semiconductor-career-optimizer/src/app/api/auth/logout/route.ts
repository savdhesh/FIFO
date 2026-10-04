import { route, json } from "@/lib/server/api";
import { destroySession } from "@/lib/server/session";
export const POST = route(async () => { await destroySession(); return json({ ok: true }); }, { auth: false });
