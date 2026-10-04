import type { AIProvider } from "./provider";
import { MockProvider } from "./mock";
import { LLMProvider } from "./llm";
import { anthropicTransport, geminiTransport, openaiTransport } from "./transports";

let cached: AIProvider | null = null;

export function getProvider(): AIProvider {
  if (cached) return cached;
  const name = (process.env.AI_PROVIDER || "mock").toLowerCase();
  const model = process.env.AI_MODEL || undefined;
  const need = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`${k} is required when AI_PROVIDER=${name}`); return v; };
  switch (name) {
    case "openai": cached = new LLMProvider("openai", openaiTransport(need("OPENAI_API_KEY"), model)); break;
    case "anthropic": cached = new LLMProvider("anthropic", anthropicTransport(need("ANTHROPIC_API_KEY"), model)); break;
    case "gemini": cached = new LLMProvider("gemini", geminiTransport(need("GEMINI_API_KEY"), model)); break;
    case "mock": cached = new MockProvider(); break;
    default: throw new Error(`Unknown AI_PROVIDER "${name}"`);
  }
  return cached;
}
export type { AIProvider };
