/**
 * Scraper Create & Repair Agent
 *
 * Two modes:
 *  - Create: Given a new module, build the initial scraping configuration
 *    by crawling the site. If the known URL is broken (404), the agent
 *    uses web.search to find the correct agenda page autonomously.
 *  - Repair: When the Checking Agent flags a module as broken, re-crawl
 *    the site, use the LLM to infer the new page structure, and rewrite
 *    the extraction selectors.
 *
 * The agent is fully autonomous — it detects broken URLs, searches the
 * web for the correct page, crawls candidates, and self-verifies. No
 * human intervention required.
 */

import { BaseAgent, type ToolContext } from "../base";
import { USER_AGENT } from "../tools";
import { db } from "@/db";
import { modules, scrapeConfigs, meetings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { completeJSON } from "../llm";

export class ScraperCreateAgent extends BaseAgent {
  readonly name = "Scraper Agent";
  readonly tools = [
    "http.get",
    "site.crawl",
    "web.search",
    "llm.repair",
    "db.save_config",
    "verify.selfcheck",
    "agenda.find_latest",
  ];
  readonly systemPrompt =
    "You are the Scraper Create Agent for agenda.delivery. Given a council " +
    "website, you crawl it to find the agenda page, then determine the CSS " +
    "selector that links to agenda PDFs. If the known URL is broken (404), " +
    "you search the web for the correct agenda page, crawl candidates, and " +
    "pick the one that actually contains agenda links. You save the scraping " +
    "config, verify it works, and immediately fetch the first agenda so the " +
    "module has content. Be methodical — crawl, search if needed, " +
    "analyse, save, verify, fetch.";

  private slug: string;

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

    // Step 1: Crawl the known URL
    await this.emit(
      `Crawling ${mod.name} to locate the agenda listing page.`,
      "site.crawl",
      `crawling ${mod.sourceUrl}`,
    );

    let crawlResult = await this.callTool(
      "site.crawl",
      { url: mod.sourceUrl },
      ctx,
    );

    let agendaUrl = mod.sourceUrl;
    let crawlData = crawlResult.data as {
      links?: string[];
      notFound?: boolean;
    };

    // Step 2: If the URL is broken (404 / not found), search for the real page
    const wasNotFound = !crawlResult.ok || crawlData.notFound || (crawlData.links ?? []).length === 0;

    if (wasNotFound) {
      await this.emit(
        `The known URL (${mod.sourceUrl}) returned no agenda content. Searching the web for the correct page.`,
        "web.search",
        `searching for: ${mod.name} council agenda meetings`,
      );

      // Extract the domain for site-restricted search
      const domain = extractDomain(mod.sourceUrl);

      const searchResult = await this.callTool(
        "web.search",
        {
          query: `${mod.name} council agenda meetings`,
          site: domain,
        },
        ctx,
      );

      const searchData = searchResult.data as {
        validUrls?: string[];
        results?: { url: string; status: number; hasAgendaContent: boolean }[];
      };

      if (searchResult.ok && (searchData.validUrls ?? []).length > 0) {
        // Try each valid URL found by the search
        for (const candidateUrl of searchData.validUrls!.slice(0, 3)) {
          await this.emit(
            `Trying candidate URL: ${candidateUrl}`,
            "site.crawl",
            `crawling ${candidateUrl}`,
          );

          const candidateCrawl = await this.callTool(
            "site.crawl",
            { url: candidateUrl },
            ctx,
          );

          const candidateData = candidateCrawl.data as { links?: string[] };
          if (candidateCrawl.ok && (candidateData.links ?? []).length > 0) {
            agendaUrl = candidateUrl;
            crawlResult = candidateCrawl;
            crawlData = candidateData;
            await this.emit(
              `Found the agenda page at ${candidateUrl} with ${candidateData.links!.length} agenda links.`,
              "site.crawl",
              candidateCrawl.detail,
            );
            break;
          }
        }
      }

      // If still no luck, try crawling the root domain and following links
      if ((crawlData.links ?? []).length === 0) {
        const rootUrl = `https://${domain}`;
        await this.emit(
          `Trying the root domain: ${rootUrl}`,
          "site.crawl",
          `crawling ${rootUrl}`,
        );

        const rootCrawl = await this.callTool(
          "site.crawl",
          { url: rootUrl },
          ctx,
        );
        const rootData = rootCrawl.data as { links?: string[] };
        if (rootCrawl.ok && (rootData.links ?? []).length > 0) {
          // Sort links by relevance: prefer "agenda" > "meeting" > "council"
          const ranked = rootData.links!.sort((a, b) => {
            const score = (url: string) =>
              (url.includes("agenda") ? 3 : 0) +
              (url.includes("meeting") ? 2 : 0) +
              (url.includes("calendar") ? 2 : 0) +
              (url.includes("council") ? 1 : 0);
            return score(b) - score(a);
          });

          // Try the top 3 candidates
          for (const candidateUrl of ranked.slice(0, 3)) {
            await this.emit(
              `Following link from root: ${candidateUrl}`,
              "site.crawl",
              `deep-crawling ${candidateUrl}`,
            );

            const deepCrawl = await this.callTool(
              "site.crawl",
              { url: candidateUrl },
              ctx,
            );
            const deepData = deepCrawl.data as { links?: string[] };
            if (deepCrawl.ok && (deepData.links ?? []).length > 0) {
              agendaUrl = candidateUrl;
              crawlResult = deepCrawl;
              crawlData = deepData;
              await this.emit(
                `Found ${deepData.links!.length} agenda links at ${candidateUrl}.`,
                "site.crawl",
                deepCrawl.detail,
              );
              break;
            }
          }
        }
      }
    } else {
      await this.emit(
        "Found agenda-related links on the site.",
        "site.crawl",
        crawlResult.detail,
      );
    }

    // Step 3: Fetch the actual HTML for LLM analysis
    const links = crawlData.links ?? [];
    const htmlSample = await fetchHtml(agendaUrl);

    await this.emit(
      "Analysing the page structure to determine extraction selectors.",
      "llm.repair",
      `analysing ${htmlSample.length} chars of HTML from ${agendaUrl}`,
    );

    const config = await completeJSON<{
      agendaUrl: string;
      linkSelector: string;
      fileTypes: string[];
      hints: string;
    }>(
      "You are a scraper configuration agent. Given a website URL and HTML, " +
        "determine the best CSS selector to find agenda links. " +
        'Respond with JSON: {"agendaUrl":"...","linkSelector":"...","fileTypes":["pdf"],"hints":"..."}',
      `URL: ${agendaUrl}\nFound links: ${links.slice(0, 10).join(", ")}\nHTML sample:\n${htmlSample.slice(0, 3000)}`,
    );

    // Use the agent's discovered URL if the LLM didn't override it
    const finalUrl = config.agendaUrl || agendaUrl;

    // Step 4: Save the config (also updates the module's source_url if it changed)
    await this.emit(
      `Saving the scraping configuration${finalUrl !== mod.sourceUrl ? ` (updated URL: ${finalUrl})` : "."}`,
      "db.save_config",
      `selector: ${config.linkSelector}`,
    );

    await this.callTool(
      "db.save_config",
      {
        module_slug: this.slug,
        agenda_url: finalUrl,
        link_selector: config.linkSelector,
        file_types: config.fileTypes.join(","),
        hints: config.hints,
      },
      ctx,
    );

    // Update the module's source_url if the agent found a new one
    if (finalUrl !== mod.sourceUrl) {
      await db
        .update(modules)
        .set({ sourceUrl: finalUrl })
        .where(eq(modules.id, mod.id));
    }

    // Step 5: Verify
    const verifyResult = await this.callTool(
      "verify.selfcheck",
      { module_slug: this.slug },
      ctx,
    );
    await this.emit(
      verifyResult.ok
        ? "Scrape config verified and ready."
        : "Config saved but verification had issues — will need a repair run.",
      "verify.selfcheck",
      verifyResult.detail,
    );

    // Step 6: Immediately find and record the latest meeting so the
    // module has an agenda visible right away. This is the user-facing
    // payoff of the scraper build — without it, the module shows as
    // healthy but has no agenda, which makes no sense to users.
    if (verifyResult.ok) {
      await this.emit(
        "Scrape config is live. Searching for the first agenda to populate the module.",
        "agenda.find_latest",
        `initial agenda fetch for ${this.slug}`,
      );

      const findResult = await this.callTool(
        "agenda.find_latest",
        { module_slug: this.slug },
        ctx,
      );

      if (findResult.ok) {
        const findData = findResult.data as {
          meetingTitle: string;
          meetingUrl: string;
          meetingDate: string | null;
          agendaText: string;
          pdfLinks: string[];
        };

        // Record the meeting if it's new
        const meetingDate = findData.meetingDate
          ? new Date(findData.meetingDate)
          : null;

        if (findData.meetingTitle && findData.meetingTitle !== "Council Meeting") {
          await db.insert(meetings).values({
            moduleId: mod.id,
            date: meetingDate ?? new Date(),
            title: findData.meetingTitle,
            kind: "Council Meeting",
            pages: findData.pdfLinks.length,
            pdfUrl: findData.pdfLinks[0] ?? null,
            meetingUrl: findData.meetingUrl ?? null,
          }).onConflictDoNothing();

          await this.emit(
            `Found and recorded the latest agenda: "${findData.meetingTitle}" (${findData.pdfLinks.length} PDF links).`,
            "agenda.find_latest",
            findResult.detail,
          );

          // Also generate a summary right away so the module has content
          if (findData.agendaText && findData.agendaText.length > 100) {
            await this.emit(
              "Generating an initial summary for the found agenda.",
              "llm.summarize",
              `${findData.agendaText.length} chars of agenda content`,
            );

            // Run the summary agent inline (shares the run context)
            const { SummaryAgent } = await import("./summary");
            const summaryAgent = new SummaryAgent(this.slug, findData.agendaText);
            summaryAgent.runId = this.runId;
            summaryAgent.moduleId = mod.id;
            try {
              await summaryAgent.run(ctx);
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              await this.emit(
                `Summary generation skipped: ${msg.slice(0, 80)}`,
                "llm.summarize",
                "initial summary failed",
              );
            }
          }
        } else {
          await this.emit(
            "No specific meeting title found on the agenda page yet — the Checking Agent will populate it on the next run.",
            "agenda.find_latest",
            findResult.detail,
          );
        }
      } else {
        await this.emit(
          "Could not find an agenda on the first try — the Checking Agent will retry automatically.",
          "agenda.find_latest",
          findResult.detail,
        );
      }
    }

    return "Scrape config created and verified";
  }
}

export class ScraperRepairAgent extends BaseAgent {
  readonly name = "Scraper Repair Agent";
  readonly tools = [
    "http.get",
    "site.crawl",
    "web.search",
    "llm.repair",
    "db.save_config",
    "verify.selfcheck",
    "agenda.find_latest",
  ];
  readonly systemPrompt =
    "You are the Scraper Repair Agent for agenda.delivery. A module's " +
    "scraping config has broken — the website changed. You re-crawl the " +
    "site, and if the old URL is now 404, you search the web for the new " +
    "agenda page. You infer the new page structure, rewrite the selectors, " +
    "verify the fix works, and fetch the latest agenda. You must be " +
    "thorough and confirm the repair.";

  private slug: string;

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

    // Mark as repairing
    await db
      .update(modules)
      .set({ health: "repairing" })
      .where(eq(modules.id, mod.id));

    // Get the broken config
    const [oldCfg] = await db
      .select()
      .from(scrapeConfigs)
      .where(eq(scrapeConfigs.moduleId, mod.id))
      .limit(1);

    // Step 1: Re-crawl to find the new agenda page
    await this.emit(
      "The agenda page broke. Re-crawling the site to locate the new agenda listing.",
      "site.crawl",
      `old URL: ${oldCfg?.agendaUrl ?? mod.sourceUrl} no longer works`,
    );

    let crawlResult = await this.callTool(
      "site.crawl",
      { url: oldCfg?.agendaUrl ?? mod.sourceUrl },
      ctx,
    );

    let agendaUrl = oldCfg?.agendaUrl ?? mod.sourceUrl;
    let crawlData = crawlResult.data as {
      links?: string[];
      notFound?: boolean;
    };

    // Step 2: If broken, search for the new page
    if (!crawlResult.ok || crawlData.notFound || (crawlData.links ?? []).length === 0) {
      const domain = extractDomain(mod.sourceUrl);

      await this.emit(
        `Old URL is broken. Searching the web for the new agenda page.`,
        "web.search",
        `searching for: ${mod.name} council agenda meetings`,
      );

      const searchResult = await this.callTool(
        "web.search",
        {
          query: `${mod.name} council agenda meetings`,
          site: domain,
        },
        ctx,
      );

      const searchData = searchResult.data as { validUrls?: string[] };

      if (searchResult.ok && (searchData.validUrls ?? []).length > 0) {
        for (const candidateUrl of searchData.validUrls!.slice(0, 3)) {
          await this.emit(
            `Trying candidate URL: ${candidateUrl}`,
            "site.crawl",
            `crawling ${candidateUrl}`,
          );

          const candidateCrawl = await this.callTool(
            "site.crawl",
            { url: candidateUrl },
            ctx,
          );

          const candidateData = candidateCrawl.data as { links?: string[] };
          if (candidateCrawl.ok && (candidateData.links ?? []).length > 0) {
            agendaUrl = candidateUrl;
            crawlResult = candidateCrawl;
            crawlData = candidateData;
            await this.emit(
              `Found the new agenda page at ${candidateUrl}.`,
              "site.crawl",
              candidateCrawl.detail,
            );
            break;
          }
        }
      }
    } else {
      await this.emit(
        "Found the agenda listing page after re-crawling.",
        "site.crawl",
        crawlResult.detail,
      );
    }

    // Step 3: Get the new HTML and ask the LLM to rewrite selectors
    const links = crawlData.links ?? [];
    const htmlSample = await fetchHtml(agendaUrl);

    await this.emit(
      "Inferring the new page structure and rewriting extraction selectors.",
      "llm.repair",
      "analysing new HTML structure",
    );

    const newConfig = await completeJSON<{
      agendaUrl: string;
      linkSelector: string;
      fileTypes: string[];
      hints: string;
    }>(
      "You are a scraper repair agent. The old scraping config broke. " +
        "Analyse the current HTML and propose new selectors. " +
        'Respond with JSON: {"agendaUrl":"...","linkSelector":"...","fileTypes":[...],"hints":"..."}',
      `URL: ${agendaUrl}\nOld selector: ${oldCfg?.linkSelector ?? "none"}\nFound links: ${links.slice(0, 10).join(", ")}\nHTML sample:\n${htmlSample.slice(0, 3000)}`,
    );

    const finalUrl = newConfig.agendaUrl || agendaUrl;

    // Step 4: Save the repaired config
    await this.emit(
      "Saving the repaired scraping configuration.",
      "db.save_config",
      `new selector: ${newConfig.linkSelector}`,
    );

    await this.callTool(
      "db.save_config",
      {
        module_slug: this.slug,
        agenda_url: finalUrl,
        link_selector: newConfig.linkSelector,
        file_types: newConfig.fileTypes.join(","),
        hints: newConfig.hints,
      },
      ctx,
    );

    if (finalUrl !== mod.sourceUrl) {
      await db
        .update(modules)
        .set({ sourceUrl: finalUrl })
        .where(eq(modules.id, mod.id));
    }

    // Step 5: Verify the fix
    const verifyResult = await this.callTool(
      "verify.selfcheck",
      { module_slug: this.slug },
      ctx,
    );
    await this.emit(
      verifyResult.ok
        ? "Re-ran extraction against the new layout — fix confirmed."
        : "Repair saved but verification incomplete.",
      "verify.selfcheck",
      verifyResult.detail,
    );

    // Step 6: After a successful repair, find and record the latest meeting
    // so the module has fresh agenda content immediately.
    if (verifyResult.ok) {
      await this.emit(
        "Repair confirmed. Re-fetching the latest agenda to populate the module.",
        "agenda.find_latest",
        `post-repair agenda fetch for ${this.slug}`,
      );

      const findResult = await this.callTool(
        "agenda.find_latest",
        { module_slug: this.slug },
        ctx,
      );

      if (findResult.ok) {
        const findData = findResult.data as {
          meetingTitle: string;
          meetingUrl: string;
          meetingDate: string | null;
          agendaText: string;
          pdfLinks: string[];
        };

        const meetingDate = findData.meetingDate
          ? new Date(findData.meetingDate)
          : null;

        if (findData.meetingTitle && findData.meetingTitle !== "Council Meeting") {
          await db.insert(meetings).values({
            moduleId: mod.id,
            date: meetingDate ?? new Date(),
            title: findData.meetingTitle,
            kind: "Council Meeting",
            pages: findData.pdfLinks.length,
            pdfUrl: findData.pdfLinks[0] ?? null,
            meetingUrl: findData.meetingUrl ?? null,
          }).onConflictDoNothing();

          await this.emit(
            `Post-repair: found and recorded "${findData.meetingTitle}".`,
            "agenda.find_latest",
            findResult.detail,
          );

          // Generate a fresh summary too
          if (findData.agendaText && findData.agendaText.length > 100) {
            await this.emit(
              "Post-repair: regenerating the summary from the newly fetched agenda.",
              "llm.summarize",
              `${findData.agendaText.length} chars`,
            );
            const { SummaryAgent } = await import("./summary");
            const summaryAgent = new SummaryAgent(this.slug, findData.agendaText);
            summaryAgent.runId = this.runId;
            summaryAgent.moduleId = mod.id;
            try {
              await summaryAgent.run(ctx);
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              await this.emit(
                `Post-repair summary skipped: ${msg.slice(0, 80)}`,
                "llm.summarize",
                "post-repair summary failed",
              );
            }
          }
        }
      }
    }

    // Mark healthy again
    await db
      .update(modules)
      .set({ health: "healthy", lastChecked: new Date() })
      .where(eq(modules.id, mod.id));

    return "Module repaired and healthy";
  }
}

// ── Helpers ─────────────────────────────────────────────────

/** Extract the domain from a URL. */
function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.replace(/^https?:\/\/(www\.)?/, "").split("/")[0];
  }
}

/** Fetch HTML for LLM analysis. */
async function fetchHtml(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(15_000),
    });
    return await res.text();
  } catch {
    return "[could not fetch HTML]";
  }
}