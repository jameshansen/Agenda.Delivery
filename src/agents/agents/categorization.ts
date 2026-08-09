/**
 * Categorization Agent
 *
 * Detects and categorizes the type of agenda (e.g. "Council Meeting",
 * "Public Hearing", "Committee Meeting") so that agendas across all
 * sources can be grouped into global categories.
 *
 * The agent does NOT create a new meeting row — it updates the `kind`
 * field on the most recently recorded meeting (the one the Checking
 * Agent just created during the pipeline run).
 */

import { BaseAgent, type ToolContext } from "../base";
import { db } from "@/db";
import { modules, meetings } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { completeJSON } from "../llm";

export class CategorizationAgent extends BaseAgent {
  readonly name = "Categorization Agent";
  readonly tools = ["llm.summarize"];
  readonly systemPrompt =
    "You are the Categorization Agent for agenda.delivery. You analyse " +
    "agenda titles and content to classify them into standard categories: " +
    "Council Meeting, Committee Meeting, Public Hearing, Special Meeting, " +
    "Workshop, Board Meeting, etc.";

  private slug: string;
  private agendaText: string;

  constructor(slug: string, agendaText: string) {
    super();
    this.slug = slug;
    this.agendaText = agendaText;
  }

  async run(ctx: ToolContext): Promise<string> {
    const [mod] = await db
      .select()
      .from(modules)
      .where(eq(modules.slug, this.slug))
      .limit(1);
    if (!mod) throw new Error(`Module ${this.slug} not found`);

    ctx.moduleId = mod.id;
    this.moduleId = mod.id;

    await this.emit(
      "Categorizing the agenda type from the title and content.",
      "llm.summarize",
      "classifying meeting type",
    );

    // Look up the most recent meeting title so the categorizer can use it.
    // We fetch the latest meeting BEFORE classifying so the title is available.
    const [latestForTitle] = await db
      .select()
      .from(meetings)
      .where(eq(meetings.moduleId, mod.id))
      .orderBy(desc(meetings.date))
      .limit(1);

    const meetingTitle = latestForTitle?.title ?? mod.name;

    const result = await completeJSON<{
      kind: string;
      confidence: number;
    }>(
      "You are a meeting categorization assistant. Given an agenda title " +
        "and content, classify it into one of: Council Meeting, Committee " +
        "Meeting, Public Hearing, Special Meeting, Workshop, Board Meeting. " +
        'Respond with JSON: {"kind":"...","confidence":0.0-1.0}',
      `Title: ${meetingTitle}\nAgenda title for categorization:\n${this.agendaText.slice(0, 2000)}`,
    );

    // Update the most recent meeting's kind — do NOT create a new row.
    // The Checking Agent already recorded the meeting; we just refine its
    // category. This avoids duplicate/bogus "Council Calendar" entries.
    if (latestForTitle) {
      await db
        .update(meetings)
        .set({ kind: result.kind })
        .where(eq(meetings.id, latestForTitle.id));

      await this.emit(
        `Categorized "${latestForTitle.title}" as "${result.kind}" (confidence ${result.confidence ?? 0.9}).`,
        "llm.summarize",
        `category: ${result.kind}`,
      );
    } else {
      await this.emit(
        `Categorized as "${result.kind}" (confidence ${result.confidence ?? 0.9}) — no meeting row to update.`,
        "llm.summarize",
        `category: ${result.kind}`,
      );
    }

    return `Categorized as ${result.kind}`;
  }
}