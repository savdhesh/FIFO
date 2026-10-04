import { anthropicTransport, geminiTransport, openaiTransport } from "./transports";
import type { Transport } from "./llm";

/** Server-side vendor access for the /api/ai proxy. `AI_PROVIDER=mock` (default) means no vendor: the browser uses the built-in engine. */
export function aiConfigured(): { name: string } | null {
  const n = (process.env.AI_PROVIDER || "mock").toLowerCase();
  const key = n === "openai" ? process.env.OPENAI_API_KEY : n === "anthropic" ? process.env.ANTHROPIC_API_KEY : n === "gemini" ? process.env.GEMINI_API_KEY : null;
  return key ? { name: n } : null;
}

export function serverTransport(): { name: string; complete: Transport } | null {
  const c = aiConfigured();
  if (!c) return null;
  const model = process.env.AI_MODEL || undefined;
  const t = c.name === "openai" ? openaiTransport(process.env.OPENAI_API_KEY!, model) : c.name === "anthropic" ? anthropicTransport(process.env.ANTHROPIC_API_KEY!, model) : geminiTransport(process.env.GEMINI_API_KEY!, model);
  return { name: c.name, complete: t };
}
