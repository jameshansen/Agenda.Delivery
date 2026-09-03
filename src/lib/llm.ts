// Server-only Ollama Cloud client. The agents have their own (Python) client;
// this exists for the one thing the UI generates itself: mailing-list
// templates from a prompt. Same endpoint, same model env vars.

const BASE_URL = (process.env.OLLAMA_BASE_URL ?? "").replace(/\/+$/, "");
const API_KEY = process.env.OLLAMA_API_KEY ?? "";
const MODEL = process.env.AGENT_MODEL ?? "glm-5.3";

export function llmConfigured(): boolean {
  return Boolean(BASE_URL);
}

export async function chat(
  system: string,
  user: string,
  opts: { model?: string; temperature?: number; timeoutMs?: number } = {},
): Promise<string> {
  if (!BASE_URL) throw new Error("OLLAMA_BASE_URL is not configured on this server.");

  const res = await fetch(`${BASE_URL}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
    },
    body: JSON.stringify({
      model: opts.model ?? MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      stream: false,
      options: { temperature: opts.temperature ?? 0.4 },
    }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 180_000),
  });

  if (res.status === 429) throw new Error("The model is rate limited right now. Try again shortly.");
  if (!res.ok) throw new Error(`Model returned ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const data = (await res.json()) as { message?: { content?: string } };
  return data.message?.content ?? "";
}

/** Pull an HTML document out of a model response that may be fenced or
 * prefaced with chatter. */
export function extractHtml(raw: string): string {
  const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const fenced = cleaned.match(/```(?:html)?\s*([\s\S]*?)```/i);
  const body = (fenced ? fenced[1] : cleaned).trim();
  const start = body.search(/<(!doctype|html|body|table|div)\b/i);
  return start > 0 ? body.slice(start) : body;
}
