/**
 * Keyword Agent
 *
 * Generates bespoke summaries for each keyword that users follow
 * (max 5 per module). Each keyword summary focuses on just the
 * parts of the agenda relevant to that keyword.
 */

import { BaseAgent, type ToolContext } from "../base";
import { findMeetingEnd } from "./summary";
import { db } from "@/db";
import { modules, keywords } from "@/db/schema";
import { eq } from "drizzle-orm";
import { summarize } from "../llm";

export class KeywordAgent extends BaseAgent {
  readonly name = "Keyword Agent";
  readonly tools = ["llm.summarize"];
  readonly systemPrompt =
    "You are the Keyword Agent for agenda.delivery. For each keyword that " +
    "users follow, you generate a bespoke summary focusing only on the parts " +
    "of the agenda relevant to that keyword.";

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

    // Get existing keywords for this module (max 5 per the product spec)
    const kws = (await db
      .select()
      .from(keywords)
      .where(eq(keywords.moduleId, mod.id)))
      .slice(0, 5);

    if (kws.length === 0) {
      await this.emit(
        "No tracked keywords for this module — skipping.",
        undefined,
        "0 keywords",
      );
      return "No keywords to summarize";
    }

    // Detect the meeting's end so keyword summaries cover only the
    // actual meeting content (not trailing appendices).
    const meetingBody = findMeetingEnd(this.agendaText);

    await this.emit(
      `Generating bespoke summaries for ${kws.length} tracked keyword${kws.length > 1 ? "s" : ""}.`,
      "llm.summarize",
      kws.map((k) => k.keyword).join(", "),
    );

    // Generate a summary for each keyword
    for (const kw of kws) {
      const kwSummary = await summarize(
        `You are a keyword-focused summarizer for council agendas. ` +
          `Focus only on items related to "${kw.keyword}". ` +
          `Write 1-3 sentences highlighting what the agenda says about this topic. ` +
          `If nothing relevant is found, say so briefly.`,
        meetingBody.slice(0, 8000),
      );

      // Update the keyword's summary
      await db
        .update(keywords)
        .set({ summary: kwSummary })
        .where(eq(keywords.id, kw.id));

      await this.emit(
        `Summarized "${kw.keyword}".`,
        "llm.summarize",
        `${kw.followers} followers`,
      );
    }

    return `Generated ${kws.length} keyword summaries`;
  }
}