import { route, json } from "@/lib/server/api";
export const GET = route(async (_req, { user }) => json({ email: user.email, name: user.name }));
