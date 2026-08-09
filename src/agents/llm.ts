/**
 * Ollama Cloud chat client.
 *
 * Talks to the Ollama native API (/api/chat) at https://ollama.com.
 * Two model tiers:
 *  - AGENT_MODEL  (glm-5.2) — reasoning, tool-use, scraper logic
 *  - SUMMARY_MODEL (gemma4:31b) — lighter, faster summarisation
 *
 * If no OLLAMA_BASE_URL is configured, calls fall back to a deterministic
 * mock so the UI / agents still work end-to-end in development.
 */

const BASE_URL = (process.env.OLLAMA_BASE_URL ?? "").replace(/\/$/, "");
const API_KEY = process.env.OLLAMA_API_KEY ?? "";
export const AGENT_MODEL = process.env.AGENT_MODEL ?? "glm-5.2";
export const SUMMARY_MODEL = process.env.SUMMARY_MODEL ?? "gemma4:31b";

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string };

export type ChatOptions = {
  model?: string;
  temperature?: number;
  /** When true, use the lighter summary model. */
  summary?: boolean;
};

/** Ollama /api/chat response shape (non-streaming). */
type OllamaChatResponse = {
  model: string;
  message: { role: string; content: string };
  done: boolean;
  done_reason?: string;
};

/** Internal: call the Ollama chat endpoint or fall back to a mock. */
async function chat(
  messages: ChatMessage[],
  opts: ChatOptions = {},
): Promise<string> {
  const model = opts.model ?? (opts.summary ? SUMMARY_MODEL : AGENT_MODEL);

  // ── Dev mock ──────────────────────────────────────────────
  if (!BASE_URL) {
    return mockComplete(messages, model);
  }

  const res = await fetch(`${BASE_URL}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
    },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      options: {
        temperature: opts.temperature ?? 0.4,
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Ollama ${model} returned ${res.status}: ${body.slice(0, 300)}`,
    );
  }

  const data = (await res.json()) as OllamaChatResponse;
  return data.message?.content ?? "";
}

/** Public helpers ──────────────────────────────────────────── */

export async function complete(
  system: string,
  user: string,
  opts?: ChatOptions,
): Promise<string> {
  return chat(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    opts,
  );
}

/** Ask the LLM for a JSON object (parses the first {...} block). */
export async function completeJSON<T = unknown>(
  system: string,
  user: string,
  opts?: ChatOptions,
): Promise<T> {
  const raw = await chat(
    [
      {
        role: "system",
        content: system + "\n\nRespond with valid JSON only.",
      },
      { role: "user", content: user },
    ],
    opts,
  );
  return extractJSON<T>(raw);
}

/** Ask the LLM for a summary using the lighter model. */
export async function summarize(
  system: string,
  content: string,
  opts?: Omit<ChatOptions, "summary">,
): Promise<string> {
  return chat(
    [
      { role: "system", content: system },
      { role: "user", content: content },
    ],
    { ...opts, summary: true },
  );
}

// ── Helpers ─────────────────────────────────────────────────

function extractJSON<T>(raw: string): T {
  // Find the first { ... } block (LLMs sometimes wrap JSON in prose or
  // include <think> tags).
  const cleaned = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "");

  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error(`LLM did not return JSON. Raw: ${raw.slice(0, 300)}`);
  }
  return JSON.parse(cleaned.slice(start, end + 1)) as T;
}

/** Deterministic mock so dev works without an LLM endpoint. */
function mockComplete(messages: ChatMessage[], model: string): string {
  const last = messages[messages.length - 1];
  const text = last?.content ?? "";
  const lower = text.toLowerCase();

  // Give a plausible response based on keywords in the prompt.
  if (lower.includes("summar")) {
    return (
      "The council meeting addressed several key items. " +
      "Council approved a infrastructure funding allocation and discussed " +
      "a zoning amendment for mixed-use development. A public hearing was " +
      "scheduled for the next meeting cycle."
    );
  }

  if (lower.includes("selector") || lower.includes("scrape")) {
    return JSON.stringify({
      agendaUrl: "https://example.ca/council/meetings",
      linkSelector: "a[href$='.pdf']",
      fileTypes: ["pdf"],
      hints: "Look for the .agenda-list container; PDFs are linked by date.",
    });
  }

  if (lower.includes("geoloc") || lower.includes("lat") || lower.includes("lng")) {
    return JSON.stringify({
      lat: 49.1013,
      lng: -122.6587,
      region: "Langley, British Columbia",
    });
  }

  if (lower.includes("categor")) {
    return JSON.stringify({ kind: "Council Meeting" });
  }

  if (lower.includes("keyword")) {
    return JSON.stringify({
      summary:
        "The agenda includes items relevant to this keyword, including " +
        "a staff report and a council resolution.",
    });
  }

  return `(${model} mock) I have analysed the request and determined the appropriate action.`;
}