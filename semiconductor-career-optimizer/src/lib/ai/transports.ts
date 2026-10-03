import type { Transport } from "./llm";

async function post(url: string, headers: Record<string, string>, body: unknown): Promise<any> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(90_000) });
  if (!res.ok) throw new Error(`AI provider HTTP ${res.status}`); // never include the body: it may echo resume text
  return res.json();
}

export const openaiTransport = (key: string, model = "gpt-4o-mini"): Transport => async (system, user) => {
  const j = await post("https://api.openai.com/v1/chat/completions", { authorization: `Bearer ${key}` }, {
    model, temperature: 0.2, response_format: { type: "json_object" },
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
  });
  return j.choices[0].message.content as string;
};

export const anthropicTransport = (key: string, model = "claude-sonnet-5-5"): Transport => async (system, user) => {
  const j = await post("https://api.anthropic.com/v1/messages", { "x-api-key": key, "anthropic-version": "2023-06-01" }, {
    model, max_tokens: 8000, temperature: 0.2, system, messages: [{ role: "user", content: user }],
  });
  return (j.content as { type: string; text?: string }[]).filter((b) => b.type === "text").map((b) => b.text).join("");
};

export const geminiTransport = (key: string, model = "gemini-2.0-flash"): Transport => async (system, user) => {
  const j = await post(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { "x-goog-api-key": key }, {
    systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: user }] }],
    generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
  });
  return j.candidates[0].content.parts.map((p: { text: string }) => p.text).join("");
};
