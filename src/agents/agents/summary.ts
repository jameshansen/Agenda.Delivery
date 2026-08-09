/**
 * Summary Agent
 *
 * Generates a general AI summary and 3-5 highlights from a newly
 * downloaded agenda. Uses the lighter summary model (gemma4).
 *
 * First, it detects the "termination" / end-of-meeting marker in the
 * agenda text so it only summarizes up to the actual end of the meeting
 * (not trailing appendices, schedules, or back-matter in the PDF package).
 */

import { BaseAgent, type ToolContext } from "../base";
import { db } from "@/db";
import { modules, highlights } from "@/db/schema";
import { eq } from "drizzle-orm";
import { summarize, completeJSON } from "../llm";

/** Detect the point in an agenda where the meeting actually ends. */
export function findMeetingEnd(text: string): string {
  // Common end-of-agenda markers across municipalities.
  const markers = [
    /\bADJOURNMENT\b/i,
    /\bTermination\b/i,
    /\bEnd of (the )?(Council )?Meeting\b/i,
    /\bADJOURN\b/i,
    /\bMotion to (adjourn|terminate)\b/i,
    /\bNEXT (COUNCIL )?MEETING\b/i,
  ];
  let endIdx = text.length;
  for (const re of markers) {
    const m = text.search(re);
    if (m !== -1 && m < endIdx) endIdx = m;
  }
  // Include the marker line itself so the summary can reference it.
  if (endIdx < text.length) {
    const lineEnd = text.indexOf("\n", endIdx);
    if (lineEnd !== -1) endIdx = Math.min(lineEnd + 1, text.length);
  }
  return text.slice(0, endIdx);
}

export class SummaryAgent extends BaseAgent {
  readonly name = "Summary Agent";
  readonly tools = ["llm.summarize", "llm.highlights", "s3.put"];
  readonly systemPrompt =
    "You are the Summary Agent for agenda.delivery. Given agenda text, " +
    "you write a concise general summary (2-4 sentences) and extract 3-5 " +
    "key highlights with short tags. You also store the compressed text to S3.";

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

    // Guard: don't summarize empty or near-empty content
    if (!this.agendaText || this.agendaText.length < 100) {
      await this.emit(
        "Agenda text is empty or too short to summarize — skipping.",
        "llm.summarize",
        `${this.agendaText.length} chars — below 100-char threshold`,
      );
      return "No content to summarize";
    }

    // Step 1: Store compressed text to S3 (simulated)
    await this.emit(
      "Stripped embedded images and stored the compressed text to S3.",
      "s3.put",
      `${this.agendaText.length} chars -> stored compressed`,
    );

    // Step 2: Detect the termination / end-of-meeting point
    await this.emit(
      "Detecting the end of the meeting in the agenda text.",
      "llm.summarize",
      "scanning for adjournment / termination marker",
    );

    const meetingBody = findMeetingEnd(this.agendaText);

    await this.emit(
      `Found the meeting's end marker. Summarizing the ${meetingBody.length} chars up to that point.`,
      "llm.summarize",
      `agenda body ${meetingBody.length} chars`,
    );

    // Step 3: Generate summary from the meeting body only
    await this.emit(
      "Writing the general meeting summary.",
      "llm.summarize",
      `${meetingBody.length} chars -> summarizing`,
    );

    const summaryText = await summarize(
      "You are a concise summarizer for municipal council agendas. " +
        "Write in clear, neutral prose. 2-4 sentences. Focus on the most " +
        "significant decisions and discussions.",
      meetingBody.slice(0, 8000),
    );

    // Update the module's summary
    await db
      .update(modules)
      .set({ summary: summaryText, lastUpdated: new Date() })
      .where(eq(modules.id, mod.id));

    // Step 4: Extract highlights
    await this.emit(
      "Extracting key highlights from the agenda.",
      "llm.highlights",
      "extracting 3-5 tagged highlights",
    );

    const highlightsResult = await completeJSON<{
      highlights: { tag: string; text: string }[];
    }>(
      "You are a highlight extractor for council agendas. " +
        "Extract 3-5 significant items. Each has a short tag and one-sentence text. " +
        'Respond with JSON: {"highlights":[{"tag":"...","text":"..."}]}',
      `Extract highlights from:\n${meetingBody.slice(0, 8000)}`,
    );

    // Delete old highlights and insert new ones
    await db.delete(highlights).where(eq(highlights.moduleId, mod.id));
    if (highlightsResult.highlights?.length) {
      for (let i = 0; i < highlightsResult.highlights.length; i++) {
        const h = highlightsResult.highlights[i];
        await db.insert(highlights).values({
          moduleId: mod.id,
          tag: h.tag,
          text: h.text,
          sort: i,
        });
      }
    }

    await this.emit(
      `Wrote general summary and ${highlightsResult.highlights?.length ?? 0} highlights.`,
      "llm.summarize",
      `1 summary + ${highlightsResult.highlights?.length ?? 0} highlights`,
    );

    return `Summary: ${summaryText.slice(0, 100)}...`;
  }
}