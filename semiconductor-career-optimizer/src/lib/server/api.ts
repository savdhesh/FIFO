import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { currentUser } from "./session";
import { rateLimit } from "./ratelimit";
import { log } from "./log";

export class HttpError extends Error {
  constructor(public status: number, message: string, public extra?: Record<string, unknown>) { super(message); }
}
export type User = NonNullable<Awaited<ReturnType<typeof currentUser>>>;
type Ctx = { params: Promise<Record<string, string>> };

interface Opts { auth?: boolean; limit?: { max: number; windowMs: number; name: string } }

/** Wraps a route handler with auth, rate limiting, uniform error JSON and content-free logging. */
export function route(handler: (req: Request, ctx: { user: User; params: Record<string, string> }) => Promise<Response>, opts: Opts = {}) {
  const auth = opts.auth ?? true;
  return async (req: Request, ctx: Ctx) => {
    const started = Date.now();
    try {
      const user = auth ? await currentUser() : null;
      if (auth && !user) throw new HttpError(401, "Not signed in");
      const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
      const rl = opts.limit ? rateLimit(`${opts.limit.name}:${user?.id ?? ip}`, opts.limit.max, opts.limit.windowMs) : { ok: true, retryAfter: 0 };
      if (!rl.ok) throw new HttpError(429, `Too many requests. Retry in ${rl.retryAfter}s.`);
      const res = await handler(req, { user: user as User, params: await ctx.params });
      log("info", "api", { route: new URL(req.url).pathname, status: res.status, ms: Date.now() - started, userId: user?.id });
      return res;
    } catch (e) {
      if (e instanceof HttpError) return NextResponse.json({ error: e.message, ...e.extra }, { status: e.status });
      if (e instanceof ZodError) return NextResponse.json({ error: "Invalid input", issues: e.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, { status: 400 });
      log("error", "api_error", { route: new URL(req.url).pathname, status: 500 }); // never log e.message: may contain resume text
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }
  };
}
export const json = (data: unknown, status = 200) => NextResponse.json(data, { status });
