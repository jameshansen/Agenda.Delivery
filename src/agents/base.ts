/**
 * Agent framework — base class, tool registry, and event emitter.
 *
 * Each agent:
 *  1. Declares a set of tools it can call.
 *  2. Runs a loop: think → call tool → observe → think again (or finish).
 *  3. Emits AgentEvent rows to the DB + an in-memory emitter for live SSE.
 *
 * The design is intentionally simple — no external agent library — so it's
 * easy to follow in the UI logs and fully open-source.
 */

import { db } from "@/db";
import { agentEvents, agentRuns } from "@/db/schema";
import { eq } from "drizzle-orm";
import { complete, type ChatMessage } from "./llm";

// ── Event emitter (for SSE streaming) ───────────────────────

export type AgentEventData = {
  runId: string;
  moduleId?: string;
  agent: string;
  action: string;
  tool?: string;
  detail?: string;
};

type EventListener = (event: AgentEventData) => void;

class EventEmitter {
  // Keyed by runId AND moduleId — a listener on either gets events.
  private listeners = new Map<string, Set<EventListener>>();

  /** Subscribe to events by runId or moduleId. Returns an unsubscribe fn. */
  on(key: string, fn: EventListener): () => void {
    let set = this.listeners.get(key);
    if (!set) {
      set = new Set();
      this.listeners.set(key, set);
    }
    set.add(fn);
    return () => set!.delete(fn);
  }

  /** Emit to runId listeners, moduleId listeners, and global "*" listeners. */
  emit(event: AgentEventData) {
    const keys = [event.runId];
    if (event.moduleId) keys.push(event.moduleId);
    keys.push("*");
    for (const key of keys) {
      const set = this.listeners.get(key);
      if (set) for (const fn of set) fn(event);
    }
  }

  close(runId: string) {
    this.listeners.delete(runId);
  }
}

export const emitter = new EventEmitter();

// ── Tool registry ───────────────────────────────────────────

export type ToolContext = {
  runId: string;
  moduleId?: string;
};

export type ToolResult = {
  ok: boolean;
  data?: unknown;
  detail: string; // human-readable, shown in the UI
};

export type ToolDef = {
  name: string;
  description: string;
  /** JSON-schema-ish hint for the LLM prompt. */
  params: Record<string, string>;
  execute: (args: Record<string, string>, ctx: ToolContext) => Promise<ToolResult>;
};

const registry = new Map<string, ToolDef>();

export function registerTool(tool: ToolDef) {
  registry.set(tool.name, tool);
}

export function getTool(name: string): ToolDef | undefined {
  return registry.get(name);
}

export function listToolNames(): string[] {
  return [...registry.keys()];
}

/** Build a "you have these tools" system prompt section. */
function toolsPrompt(tools: string[]): string {
  const defs = tools
    .map((n) => {
      const t = registry.get(n);
      if (!t) return "";
      const params = Object.entries(t.params)
        .map(([k, v]) => `    "${k}": ${v}`)
        .join(",\n");
      return `- ${t.name}: ${t.description}\n  params: {\n${params}\n  }`;
    })
    .filter(Boolean)
    .join("\n\n");
  return `You have access to these tools:\n\n${defs}\n\nTo call a tool, respond with JSON:\n{"tool":"<name>","args":{...}}\nWhen you are done, respond with {"done":true,"result":"<summary>"}`;
}

// ── Base Agent ──────────────────────────────────────────────

export abstract class BaseAgent {
  abstract readonly name: string;
  abstract readonly tools: string[];
  abstract readonly systemPrompt: string;

  runId!: string;
  moduleId?: string;

  /** Main logic — subclasses implement the orchestration. */
  abstract run(ctx: ToolContext): Promise<string>;

  /** Emit + persist an agent event. */
  protected async emit(action: string, tool?: string, detail?: string) {
    const event: AgentEventData = {
      runId: this.runId,
      moduleId: this.moduleId,
      agent: this.name,
      action,
      tool,
      detail,
    };

    // Persist to DB.
    await db.insert(agentEvents).values({
      moduleId: this.moduleId ?? null,
      runId: this.runId ?? null,
      agent: this.name,
      action,
      tool: tool ?? null,
      detail: detail ?? null,
      // sort = current event count for this module
      sort: await this.nextSort(),
    });

    // Notify SSE listeners.
    emitter.emit(event);
  }

  private async nextSort(): Promise<number> {
    // Simple incrementing sort — good enough for UI ordering.
    return Date.now() % 1000000;
  }

  /** Call a registered tool by name. */
  protected async callTool(
    name: string,
    args: Record<string, string>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const tool = registry.get(name);
    if (!tool) {
      return { ok: false, detail: `Unknown tool: ${name}` };
    }
    const result = await tool.execute(args, ctx);
    return result;
  }

  /** Let the LLM pick a tool to call, given the current conversation. */
  protected async llmStep(
    conversation: ChatMessage[],
    _ctx: ToolContext,
  ): Promise<{ tool?: string; args?: Record<string, string>; done?: boolean; result?: string }> {
    const systemMsg: ChatMessage = {
      role: "system",
      content: `${this.systemPrompt}\n\n${toolsPrompt(this.tools)}`,
    };
    const raw = await complete(
      systemMsg.content,
      conversation.map((m) => m.content).join("\n\n"),
    );

    // Try to parse as JSON tool call.
    try {
      const parsed = JSON.parse(raw);
      if (parsed.done) {
        return { done: true, result: parsed.result ?? raw };
      }
      if (parsed.tool) {
        return { tool: parsed.tool, args: parsed.args ?? {} };
      }
    } catch {
      // Not JSON — treat as a final answer.
      return { done: true, result: raw };
    }
    return { done: true, result: raw };
  }

  /** Create an agent_run row and set up the run context. */
  async startRun(
    agent: string,
    trigger: string,
    moduleId?: string,
  ): Promise<string> {
    // Map display names to enum values
    const agentTypeMap: Record<string, string> = {
      "Spider Agent": "spider",
      "Scraper Agent": "scraper_create",
      "Scraper Repair Agent": "scraper_repair",
      "Checking Agent": "checking",
      "Categorization Agent": "categorization",
      "Summary Agent": "summary",
      "Keyword Agent": "keyword",
    };
    const agentType = agentTypeMap[agent] ?? agent.toLowerCase().replace(/\s+/g, "_");

    const [row] = await db
      .insert(agentRuns)
      .values({
        moduleId: moduleId ?? null,
        agent: agentType as never,
        trigger,
        status: "running",
        startedAt: new Date(),
      })
      .returning({ id: agentRuns.id });

    this.runId = row.id;
    this.moduleId = moduleId;
    return row.id;
  }

  /** Mark the run complete. */
  async finishRun(result: string, error?: string) {
    await db
      .update(agentRuns)
      .set({
        status: error ? "failed" : "completed",
        finishedAt: new Date(),
        error: error ?? null,
      })
      .where(eq(agentRuns.id, this.runId));
    emitter.close(this.runId);
  }
}

/**
 * Run an agent in the background. Returns the runId as soon as the
 * agent_run row is created (via onStarted), without waiting for completion.
 */
export async function runAgentBackground(
  agent: BaseAgent,
  opts: { trigger?: string; moduleId?: string; onStarted?: (runId: string) => void },
): Promise<void> {
  const ctx: ToolContext = {
    runId: "",
    moduleId: opts.moduleId,
  };

  // startRun creates the DB row and sets agent.runId
  const runId = await agent.startRun(
    agent.name,
    opts.trigger ?? "manual",
    opts.moduleId,
  );
  ctx.runId = runId;

  // Notify that the run has started (so the route can return the runId)
  opts.onStarted?.(runId);

  // Run the agent in the background — don't await
  agent
    .run(ctx)
    .then((result) => agent.finishRun(result))
    .catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      agent.finishRun("", msg);
    });
}

// ── Orchestrator ────────────────────────────────────────────

/** Maximum time an agent run can take before being timed out (10 minutes). */
const AGENT_RUN_TIMEOUT_MS = 10 * 60 * 1000;

/** Run an agent and wait for completion. Returns the run ID.
 * Times out after AGENT_RUN_TIMEOUT_MS to prevent stuck agents blocking
 * the scheduler indefinitely.
 */
export async function runAgent(
  agent: BaseAgent,
  opts: { trigger?: string; moduleId?: string } = {},
): Promise<{ runId: string; result: string }> {
  const ctx: ToolContext = {
    runId: "",
    moduleId: opts.moduleId,
  };

  // startRun sets agent.runId internally.
  const runId = await agent.startRun(agent.name, opts.trigger ?? "manual", opts.moduleId);
  ctx.runId = runId;

  try {
    // Race the agent run against a timeout so a stuck agent cannot
    // block the scheduler forever.
    const result = await Promise.race([
      agent.run(ctx),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Agent ${agent.name} timed out after ${AGENT_RUN_TIMEOUT_MS / 1000}s`)),
          AGENT_RUN_TIMEOUT_MS,
        ),
      ),
    ]);
    await agent.finishRun(result);
    return { runId, result };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await agent.finishRun("", msg);
    return { runId, result: "" };
  }
}