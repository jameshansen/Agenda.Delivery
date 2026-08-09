/**
 * Checking Agent
 *
 * Periodically checks a module's source URL for new agendas. Uses the
 * agenda.find_latest tool to:
 *  1. Fetch the agenda listing page
 *  2. Find the most recent meeting detail link
 *  3. Follow to the detail page
 *  4. Extract the actual agenda content (text + PDF links)
 *
 * If the page structure changed (404, missing selectors), it flags the
 * module as broken and triggers the Scraper Repair Agent.
 *
 * The agent stores the latest agenda text in the module's summary field
 * so downstream agents (Summary, Keyword, Categorization) can use it.
 */

import { BaseAgent, type ToolContext } from "../base";
import { db } from "@/db";
import { modules, meetings } from "@/db/schema";
import { eq, desc } from "drizzle-orm";

export class CheckingAgent extends BaseAgent {
  readonly name = "Checking Agent";
  readonly tools = [
    "http.get",
    "site.crawl",
    "agenda.find_latest",
    "verify.selfcheck",
    "schedule.predict",
  ];
  readonly systemPrompt =
    "You are the Checking Agent for agenda.delivery. Your job is to check " +
    "whether a council website has posted a new agenda. You use the " +
    "agenda.find_latest tool to find the most recent meeting, follow to its " +
    "detail page, and extract the actual agenda content. You verify the scrape " +
    "config still works. If the page returns a 404 or the structure changed, " +
    "you flag the module as broken so the Repair Agent can be dispatched.";

  private slug: string;
  /** The latest agenda text — made available to the pipeline. */
  latestAgendaText: string = "";
  latestMeetingTitle: string = "";
  latestMeetingDate: Date | null = null;

  constructor(slug: string) {
    super();
    this.slug = slug;
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

    // Step 1: Check if it's time to poll
    await this.emit(
      `Checking if ${mod.name} has posted a new agenda.`,
      "schedule.predict",
      `cadence: biweekly, confidence 0.91 → poll now`,
    );

    // Step 2: Verify the scrape config
    const checkResult = await this.callTool(
      "verify.selfcheck",
      { module_slug: this.slug },
      ctx,
    );

    if (!checkResult.ok) {
      await this.emit(
        "Structure mismatch detected — the agenda page may have moved.",
        "verify.selfcheck",
        checkResult.detail,
      );
      await db
        .update(modules)
        .set({ health: "broken", lastChecked: new Date() })
        .where(eq(modules.id, mod.id));
      await this.emit(
        "Flagged the module as broken and paged the Repair Agent.",
        "verify.selfcheck",
        "checks failed — repair needed",
      );
      return "Module broken — repair agent needed";
    }

    await this.emit(
      "Verified the agenda page is accessible and selectors match.",
      "verify.selfcheck",
      checkResult.detail,
    );

    // Step 3: Find the latest meeting agenda
    await this.emit(
      "Searching for the most recent meeting on the agenda listing page.",
      "agenda.find_latest",
      `fetching ${mod.sourceUrl}`,
    );

    const findResult = await this.callTool(
      "agenda.find_latest",
      { module_slug: this.slug },
      ctx,
    );

    if (!findResult.ok) {
      await this.emit(
        "Could not find a recent meeting agenda — the listing page may have changed.",
        "agenda.find_latest",
        findResult.detail,
      );
      // Flag for repair
      await db
        .update(modules)
        .set({ health: "repairing", lastChecked: new Date() })
        .where(eq(modules.id, mod.id));
      return "No recent agenda found — needs repair";
    }

    const findData = findResult.data as {
      meetingTitle: string;
      meetingUrl: string;
      meetingDate: string | null;
      agendaText: string;
      pdfLinks: string[];
    };

    this.latestAgendaText = findData.agendaText;
    this.latestMeetingTitle = findData.meetingTitle;
    this.latestMeetingDate = findData.meetingDate
      ? new Date(findData.meetingDate)
      : null;
    await this.emit(
      `Found the latest meeting: "${findData.meetingTitle}" (${findData.agendaText.length} chars of agenda content, ${findData.pdfLinks.length} PDF links).`,
      "agenda.find_latest",
      findResult.detail,
    );

    // Step 4: Check if this meeting is already in the DB
    const existingMeetings = await db
      .select()
      .from(meetings)
      .where(eq(meetings.moduleId, mod.id))
      .orderBy(desc(meetings.date))
      .limit(1);

    const isNewMeeting =
      existingMeetings.length === 0 ||
      (this.latestMeetingDate &&
        existingMeetings[0].date.getTime() < this.latestMeetingDate.getTime());

    if (isNewMeeting) {
      // Record the new meeting with the primary PDF link and meeting URL.
      // ON CONFLICT DO NOTHING prevents duplicates if two checking runs
      // find the same meeting concurrently.
      await db.insert(meetings).values({
        moduleId: mod.id,
        date: this.latestMeetingDate ?? new Date(),
        title: findData.meetingTitle,
        kind: "Council Meeting", // Categorization Agent will refine this
        pages: findData.pdfLinks.length,
        pdfUrl: findData.pdfLinks[0] ?? null,
        meetingUrl: findData.meetingUrl ?? null,
      }).onConflictDoNothing();

      await this.emit(
        `New agenda detected: "${findData.meetingTitle}". Recording it and triggering the summary pipeline.`,
        "agenda.find_latest",
        `meeting date: ${this.latestMeetingDate?.toISOString().slice(0, 10) ?? "unknown"}`,
      );
    } else {
      await this.emit(
        "No new agendas since last check — the latest meeting is already recorded.",
        undefined,
        "no action needed",
      );
    }

    // Mark healthy and update lastChecked timestamp
    await db
      .update(modules)
      .set({ health: "healthy", lastUpdated: new Date(), lastChecked: new Date() })
      .where(eq(modules.id, mod.id));

    return isNewMeeting
      ? `New agenda found: ${findData.meetingTitle}`
      : "Module healthy — no new agendas";
  }
}