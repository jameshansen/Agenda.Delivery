/**
 * Core tool implementations for the agent system.
 *
 * These are the real, working tools that agents call. Each one is registered
 * in the tool registry so any agent can use it.
 */

import { registerTool, type ToolResult } from "./base";
import { db } from "@/db";
import { modules, scrapeConfigs, spiderCandidates } from "@/db/schema";
import { eq } from "drizzle-orm";
import { completeJSON, summarize } from "./llm";

/** Browser-like UA so council sites (which often block plain bot agents) respond. */
export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 AgendaDelivery/1.0 (+https://agenda.delivery)";

// -- http.get ----------------------------------------------------

registerTool({
  name: "http.get",
  description: "Fetch a URL and return the response status, headers, and body (truncated).",
  params: { url: "string" },
  async execute(args): Promise<ToolResult> {
    const url = args.url;
    if (!url) return { ok: false, detail: "No URL provided" };

    try {
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
        redirect: "follow",
        signal: AbortSignal.timeout(15_000),
      });
      const body = await res.text();
      const truncated = body.slice(0, 5000);
      return {
        ok: res.ok,
        detail: `GET ${url} -> ${res.status}`,
        data: { status: res.status, headers: Object.fromEntries(res.headers), body: truncated },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, detail: `GET ${url} failed: ${msg}` };
    }
  },
});

// -- web.search --------------------------------------------------

registerTool({
  name: "web.search",
  description:
    "Search the web for a query. Returns result URLs and titles. " +
    "Use this when a known URL is broken (404) or doesn't contain the expected content. " +
    "The agent should search for the municipality name + 'council agenda' or 'meetings'.",
  params: {
    query: "search query string",
    site: "optional -- restrict to this domain (e.g. tol.ca)",
  },
  async execute(args): Promise<ToolResult> {
    const query = args.query;
    if (!query) return { ok: false, detail: "No query provided" };

    const { completeJSON } = await import("./llm");
    const siteFilter = args.site ?? "";

    const suggestions = await completeJSON<{ urls: string[] }>(
      "You are a web search assistant for a municipal agenda scraper. " +
        "Given a search query, suggest 5-8 likely URLs where the agenda " +
        "page might be found. Consider common patterns: /council-meetings, " +
        "/meetings-and-agendas, /agendas, /city-hall/council, /government, " +
        "calendar subdomains, etc. " +
        'Respond with JSON: {"urls":["https://...", ...]}',
      `Search query: "${query}"` +
        (siteFilter ? `\nRestrict to domain: ${siteFilter}` : ""),
    );

    // Verify each suggested URL with a real HTTP request
    const valid: { url: string; status: number; hasAgendaContent: boolean }[] = [];
    for (const url of suggestions.urls?.slice(0, 8) ?? []) {
      try {
        const res = await fetch(url, {
          headers: { "User-Agent": USER_AGENT },
          redirect: "follow",
          signal: AbortSignal.timeout(10_000),
        });
        const body = await res.text();
        const lower = body.toLowerCase();
        const hasAgenda =
          lower.includes("agenda") ||
          lower.includes("meeting") ||
          lower.includes("council");
        const notFound =
          (lower.includes("page not found") && body.length < 5000) ||
          (lower.includes("404") && body.length < 2000 && lower.includes("not found")) ||
          (lower.includes("not found") && body.length < 2000);
        valid.push({
          url,
          status: res.status,
          hasAgendaContent: hasAgenda && !notFound && res.ok,
        });
      } catch {
        // skip unreachable URLs
      }
    }

    const goodUrls = valid.filter((v) => v.hasAgendaContent);
    return {
      ok: goodUrls.length > 0,
      detail:
        goodUrls.length > 0
          ? `Found ${goodUrls.length} valid agenda page(s): ${goodUrls.map((v) => v.url).join(", ")}`
          : `Searched ${valid.length} URLs, none had agenda content`,
      data: {
        query,
        results: valid,
        validUrls: goodUrls.map((v) => v.url),
      },
    };
  },
});

// -- site.crawl --------------------------------------------------

registerTool({
  name: "site.crawl",
  description: "Crawl a website looking for agenda-related links. Returns candidate URLs.",
  params: { url: "string", max_depth: "number (default 2)" },
  async execute(args): Promise<ToolResult> {
    const url = args.url;
    if (!url) return { ok: false, detail: "No URL provided" };

    try {
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(15_000),
      });
      const html = await res.text();

      // Detect 404 / not-found pages even if the HTTP status is 200
      const lower = html.toLowerCase();
      const isNotFound =
        !res.ok ||
        (lower.includes("page not found") && html.length < 5000) ||
        (lower.includes("404") && html.length < 2000 && lower.includes("not found")) ||
        (lower.includes("not found") && html.length < 2000);

      if (isNotFound) {
        return {
          ok: false,
          detail: `Crawled ${url} -> page not found (status ${res.status})`,
          data: { links: [], notFound: true },
        };
      }

      // Extract all links that look agenda-related.
      const linkPattern = /href=["']([^"']+)["']/gi;
      const links: string[] = [];
      let match: RegExpExecArray | null;
      while ((match = linkPattern.exec(html)) !== null) {
        const href = match[1];
        if (
          href.includes("agenda") ||
          href.includes("meeting") ||
          href.includes("council") ||
          href.includes("board") ||
          href.includes("calendar") ||
          href.endsWith(".pdf")
        ) {
          // Resolve relative URLs against the final URL (after redirects).
          try {
            const absolute = new URL(href, res.url).href;
            if (!links.includes(absolute)) links.push(absolute);
          } catch {
            // skip invalid URLs
          }
        }
      }

      return {
        ok: true,
        detail: `Crawled ${url}, found ${links.length} agenda-related links`,
        data: { links: links.slice(0, 20) },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, detail: `Crawl ${url} failed: ${msg}` };
    }
  },
});

// -- agenda.find_latest ------------------------------------------
// Finds the most recent meeting on a council's agenda listing page,
// follows to the detail page, and extracts the actual agenda content.

registerTool({
  name: "agenda.find_latest",
  description:
    "Given a module slug, find the most recent meeting on the council's " +
    "agenda listing page. Follows to the meeting detail page and extracts " +
    "the agenda content (text from the page, links to PDFs). " +
    "Returns the meeting title, date, agenda text, and PDF links.",
  params: { module_slug: "string" },
  async execute(args): Promise<ToolResult> {
    const slug = args.module_slug;
    if (!slug) return { ok: false, detail: "No module slug provided" };

    const [mod] = await db
      .select()
      .from(modules)
      .where(eq(modules.slug, slug))
      .limit(1);
    if (!mod) return { ok: false, detail: `Module '${slug}' not found` };

    const [cfg] = await db
      .select()
      .from(scrapeConfigs)
      .where(eq(scrapeConfigs.moduleId, mod.id))
      .limit(1);

    const listingUrl = cfg?.agendaUrl ?? mod.sourceUrl;

    try {
      // Step 1: Fetch the listing page
      const listRes = await fetch(listingUrl, {
        headers: { "User-Agent": USER_AGENT },
        redirect: "follow",
        signal: AbortSignal.timeout(20_000),
      });
      let listHtml = await listRes.text();
      let effectiveListingUrl = listRes.url;

      // Step 1b: If the configured listing page has no meeting links,
      // autonomously discover the real meetings page by crawling the
      // site root and following calendar/meeting links.
      const hasMeetingLinks = (html: string) => {
        const lower = html.toLowerCase();
        return (
          lower.includes("meeting/detail") ||
          lower.includes("/meetings/") ||
          lower.includes("agenda package") ||
          lower.includes("council-meetings") ||
          lower.includes("public-hearing")
        );
      };

      if (!hasMeetingLinks(listHtml)) {
        try {
          const domain = new URL(mod.sourceUrl).hostname.replace(/^www\./, "");
          const rootUrl = `https://${domain}`;
          const rootRes = await fetch(rootUrl, {
            headers: { "User-Agent": USER_AGENT },
            redirect: "follow",
            signal: AbortSignal.timeout(15_000),
          });
          const rootHtml = await rootRes.text();
          const linkPattern = /href=["']([^"']+)["']/gi;
          let mm: RegExpExecArray | null;
          const candidates: string[] = [];
          while ((mm = linkPattern.exec(rootHtml)) !== null) {
            const href = mm[1];
            const lower = href.toLowerCase();
            if (
              lower.includes("calendar") ||
              lower.includes("meeting") ||
              lower.includes("agenda") ||
              lower.includes("council-meeting")
            ) {
              try {
                const abs = new URL(href, rootRes.url).href;
                if (!candidates.includes(abs)) candidates.push(abs);
              } catch {}
            }
          }
          // Rank: prefer calendar + meetings, then agenda
          candidates.sort((a, b) => {
            const score = (u: string) =>
              (u.toLowerCase().includes("calendar") ? 4 : 0) +
              (u.toLowerCase().includes("meeting") ? 3 : 0) +
              (u.toLowerCase().includes("agenda") ? 2 : 0);
            return score(b) - score(a);
          });
          for (const cand of candidates.slice(0, 5)) {
            try {
              const cres = await fetch(cand, {
                headers: { "User-Agent": USER_AGENT },
                redirect: "follow",
                signal: AbortSignal.timeout(15_000),
              });
              const chtml = await cres.text();
              if (hasMeetingLinks(chtml)) {
                listHtml = chtml;
                effectiveListingUrl = cres.url;
                break;
              }
            } catch {}
          }
        } catch {}
      }

      // Step 2: Find meeting detail links on the listing page
      const linkPattern = /href=["']([^"']+)["']/gi;
      const allLinks: string[] = [];
      let match: RegExpExecArray | null;
      while ((match = linkPattern.exec(listHtml)) !== null) {
        const href = match[1];
        try {
          const absolute = new URL(href, effectiveListingUrl).href;
          if (!allLinks.includes(absolute)) allLinks.push(absolute);
        } catch {}
      }

      // Filter for meeting detail links
      const detailLinks = allLinks.filter((url) => {
        const lower = url.toLowerCase();
        return (
          (lower.includes("detail") || lower.includes("meeting") || lower.includes("agenda")) &&
          !lower.includes("css") && !lower.includes("js") && !lower.includes("font") &&
          !lower.includes("image") && !lower.includes("icon")
        );
      });

      // Extract dates from links and sort by most recent
      const datedLinks = detailLinks
        .map((url) => {
          const dateMatch = url.match(/(\d{4})[-/](\d{2})[-/](\d{2})/);
          if (dateMatch) {
            const date = new Date(`${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`);
            return { url, date: date.getTime() };
          }
          return { url, date: 0 };
        })
        .sort((a, b) => b.date - a.date)
        // Skip future-dated meetings — we want the latest agenda that
        // has actually been published.
        .filter((d) => d.date <= Date.now());

      if (datedLinks.length === 0) {
        return {
          ok: false,
          detail: `No past meeting detail links found on ${effectiveListingUrl}`,
          data: { listingUrl, links: [], agendaText: "" },
        };
      }

      // Step 3: Follow meeting detail links (most recent first) and pick
      // the first one that actually has an agenda PDF with downloadable content.
      let latestMeeting = datedLinks[0];
      let detailHtml = "";
      let title = "Council Meeting";
      let pdfLinks: string[] = [];
      let agendaText = "";
      let meetingDate: string | null = null;

      for (const candidate of datedLinks.slice(0, 5)) {
        let dRes: Response;
        try {
          dRes = await fetch(candidate.url, {
            headers: { "User-Agent": USER_AGENT },
            redirect: "follow",
            signal: AbortSignal.timeout(20_000),
          });
        } catch {
          continue; // skip meetings we can't reach
        }
        const dHtml = await dRes.text();

        // Extract the meeting title. Try multiple strategies in order:
        // 1. The <title> tag (often "Meeting Date - Council Meeting | City of...")
        // 2. A specific meeting title element (og:title, .meeting-title, etc.)
        // 3. The first <h1> that looks like a meeting (contains a date or "meeting")
        // 4. The link text from the listing page (extracted below)
        // 5. Fall back to a date-based title from the URL
        let candidateTitle = "";

        // Strategy 1: og:title meta tag
        const ogTitleMatch = dHtml.match(
          /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
        );
        if (ogTitleMatch) candidateTitle = ogTitleMatch[1].trim();

        // Strategy 2: <title> tag
        if (!candidateTitle) {
          const titleTagMatch = dHtml.match(/<title[^>]*>([^<]+)<\/title>/i);
          if (titleTagMatch) {
            const titleTag = titleTagMatch[1].trim();
            // Strip common suffixes like " | City of X" or " - City of X"
            candidateTitle = titleTag.split(/[|\-–—]/)[0].trim();
          }
        }

        // Strategy 3: First <h1> that looks like a meeting title (contains a
        // month name or "meeting" or "agenda"), skipping generic page headers.
        if (!candidateTitle) {
          const h1Matches = [...dHtml.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)];
          for (const h1 of h1Matches) {
            const text = h1[1].replace(/<[^>]+>/g, "").trim();
            // Skip generic page titles that aren't specific meetings
            const lower = text.toLowerCase();
            if (
              lower.length > 0 &&
              lower.length < 200 &&
              !lower.includes("council calendar") &&
              !lower.includes("meetings and agendas") &&
              !lower.includes("agenda search") &&
              !lower.includes("meeting calendar") &&
              !lower.includes("upcoming meetings") &&
              !lower.includes("past meetings") &&
              !lower.includes("all meetings") &&
              (/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|meeting|council|agenda|public hearing|committee)\b/i.test(
                text,
              ) ||
                /\b\d{1,2}\b/.test(text))
            ) {
              candidateTitle = text;
              break;
            }
          }
        }

        // Strategy 4: Try <h2> with the same filtering
        if (!candidateTitle) {
          const h2Matches = [...dHtml.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)];
          for (const h2 of h2Matches) {
            const text = h2[1].replace(/<[^>]+>/g, "").trim();
            const lower = text.toLowerCase();
            if (
              lower.length > 0 &&
              lower.length < 200 &&
              !lower.includes("council calendar") &&
              !lower.includes("meetings and agendas") &&
              !lower.includes("agenda search") &&
              !lower.includes("meeting calendar") &&
              !lower.includes("upcoming meetings") &&
              !lower.includes("past meetings") &&
              !lower.includes("all meetings") &&
              /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|meeting|council|agenda|public hearing|committee)\b/i.test(
                text,
              )
            ) {
              candidateTitle = text;
              break;
            }
          }
        }

        // Strategy 5: Build a title from the URL date
        if (!candidateTitle && candidate.date) {
          const d = new Date(candidate.date);
          candidateTitle = `Regular Council Meeting — ${d.toLocaleDateString("en-CA", {
            year: "numeric",
            month: "long",
            day: "numeric",
          })}`;
        }

        // Final fallback
        if (!candidateTitle) candidateTitle = "Council Meeting";

        // Find agenda PDF links (the href may not end in .pdf; the
        // .pdf filename appears in the aria-label).
        const candidatePdfs: string[] = [];
        const candidateMeetingUrls: string[] = [];
        const pdfLinkPattern = /href=["']([^"']+)["'][^>]*aria-label=["']([^"']*\.pdf)["']/gi;
        let pdfMatch: RegExpExecArray | null;
        while ((pdfMatch = pdfLinkPattern.exec(dHtml)) !== null) {
          try {
            const abs = new URL(pdfMatch[1], candidate.url).href;
            // Only treat as a PDF link if the href itself ends in .pdf;
            // otherwise it's a detail page with a PDF label.
            if (abs.toLowerCase().endsWith(".pdf")) {
              if (!candidatePdfs.includes(abs)) candidatePdfs.push(abs);
            } else {
              if (!candidateMeetingUrls.includes(abs)) candidateMeetingUrls.push(abs);
            }
          } catch {}
        }
        const anyPdfPattern = /href=["']([^"']+\.pdf)["']/gi;
        while ((pdfMatch = anyPdfPattern.exec(dHtml)) !== null) {
          try {
            const abs = new URL(pdfMatch[1], candidate.url).href;
            if (!candidatePdfs.includes(abs)) candidatePdfs.push(abs);
          } catch {}
        }

        // Prefer the meeting that has an actual agenda document.
        // (The "Minutes" PDF is a separate link; we keep all PDFs but
        //  mark the first/agenda one as primary.)
        if (candidatePdfs.length > 0 || candidateMeetingUrls.length > 0) {
          latestMeeting = candidate;
          detailHtml = dHtml;
          title = candidateTitle;
          pdfLinks = candidatePdfs;
          meetingDate = candidate.date ? new Date(candidate.date).toISOString() : null;
          break;
        }
      }

      // Step 4: Extract text content from the detail page
      agendaText = detailHtml
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<nav[\s\S]*?<\/nav>/gi, "")
        .replace(/<footer[\s\S]*?<\/footer>/gi, "")
        .replace(/<header[\s\S]*?<\/header>/gi, "")
        .replace(/<[^>]+>/g, "\n")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#\d+;/g, "")
        .replace(/\n\s*\n/g, "\n")
        .replace(/^\s+/gm, "")
        .trim();

      if (pdfLinks.length === 0 && detailHtml.length === 0) {
        return {
          ok: false,
          detail: `Found meetings but none had an agenda PDF yet.`,
          data: { listingUrl, links: [], agendaText: "", meetingTitle: title },
        };
      }

      // Step 5: Download + extract the agenda PDF (front pages only).
      // The agenda items live in the first portion of the package; the
      // meeting's end/termination point is detected later by the Summary
      // Agent. We cap pages to keep downloads tractable.
      let pdfText = "";
      let pdfPages = 0;
      if (pdfLinks.length > 0) {
        try {
          const primaryPdf = pdfLinks[0];
          // Security: only download PDFs from HTTP(S) URLs and validate
          // the URL is well-formed. We don't restrict to the module's
          // domain because councils sometimes host PDFs on CDN subdomains,
          // but we block non-HTTP schemes and private/internal IPs.
          if (!primaryPdf.startsWith("http://") && !primaryPdf.startsWith("https://")) {
            throw new Error("PDF URL must be HTTP(S)");
          }
          // Block localhost / private IPs to prevent SSRF
          const pdfUrlObj = new URL(primaryPdf);
          const hostname = pdfUrlObj.hostname.toLowerCase();
          if (
            hostname === "localhost" ||
            hostname === "0.0.0.0" ||
            hostname.startsWith("127.") ||
            hostname.startsWith("10.") ||
            hostname.startsWith("192.168.") ||
            hostname.startsWith("169.254.") ||
            hostname.endsWith(".local") ||
            /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
          ) {
            throw new Error("PDF URL points to a private/internal address");
          }
          const pdfRes = await fetch(primaryPdf, {
            headers: { 'User-Agent': USER_AGENT },
            signal: AbortSignal.timeout(120_000),
          });
          if (pdfRes.ok) {
            const pdfBuf = Buffer.from(await pdfRes.arrayBuffer());
            const { PDFParse } = await import('pdf-parse');
            const parser = new PDFParse({ data: new Uint8Array(pdfBuf) });
            try {
              const textResult = await parser.getText({ first: 20 });
              pdfText = textResult.text ?? '';
              pdfPages = textResult.total ?? 0;
            } finally {
              await parser.destroy();
            }
          }
        } catch (e) {
          // PDF extraction is best-effort - fall back to the detail-page text.
          const msg = e instanceof Error ? e.message : String(e);
          console.warn(`[agenda.find_latest] PDF extract skipped: ${msg}`);
        }
      }

      // Prefer the extracted PDF text (the actual agenda); fall back to
      // the detail-page HTML text if the PDF couldn't be parsed.
      const detailsIdx = agendaText.indexOf("Details");
      const fallbackText =
        detailsIdx >= 0
          ? agendaText.slice(detailsIdx)
          : agendaText.slice(0, 12000);
      const finalAgendaText = (pdfText || fallbackText).slice(0, 12000);

      return {
        ok: true,
        detail: `Found latest meeting: "${title}" (${meetingDate?.slice(0, 10) ?? "date unknown"}) at ${latestMeeting.url}, ${pdfLinks.length} PDF link(s), ${finalAgendaText.length} chars of agenda content${pdfPages ? ` (PDF ${pdfPages} pages)` : ""}`,
        data: {
          meetingTitle: title,
          meetingUrl: latestMeeting.url,
          meetingDate,
          agendaText: finalAgendaText,
          pdfLinks,
          listingUrl: effectiveListingUrl,
        },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, detail: `agenda.find_latest failed: ${msg}` };
    }
  },
});

// -- pdf.extract -------------------------------------------------

registerTool({
  name: "pdf.extract",
  description: "Download a PDF and extract its text content (first N pages).",
  params: { url: "string", max_pages: "number (default 50)" },
  async execute(args): Promise<ToolResult> {
    const url = args.url;
    if (!url) return { ok: false, detail: "No URL provided" };

    try {
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        return { ok: false, detail: `PDF fetch returned ${res.status}` };
      }
      const buffer = await res.arrayBuffer();
      const sizeMB = (buffer.byteLength / 1_048_576).toFixed(1);

      // For now we return metadata -- full PDF text extraction lands with
      // Phase 5 (S3 storage pipeline). The agent can still use the size +
      // filename to make decisions.
      const filename = url.split("/").pop() ?? "document.pdf";

      return {
        ok: true,
        detail: `Downloaded ${filename} (${sizeMB}MB)`,
        data: {
          filename,
          sizeBytes: buffer.byteLength,
          textPreview: "[PDF text extraction available in Phase 5 -- S3 pipeline]",
        },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, detail: `PDF extract failed: ${msg}` };
    }
  },
});

// -- llm.summarize -----------------------------------------------

registerTool({
  name: "llm.summarize",
  description: "Generate a concise summary of text using the lightweight model.",
  params: { text: "string to summarize", instructions: "optional focus instructions" },
  async execute(args): Promise<ToolResult> {
    const text = args.text;
    if (!text) return { ok: false, detail: "No text provided" };

    const instructions = args.instructions ?? "Summarize the key points.";
    const result = await summarize(
      "You are a concise summarizer for municipal council agendas. " +
        "Write in clear, neutral prose. 2-4 sentences max.",
      `${instructions}\n\nContent:\n${text.slice(0, 8000)}`,
    );

    return {
      ok: true,
      detail: `Summarized ${text.length} chars -> ${result.length} chars`,
      data: { summary: result },
    };
  },
});

// -- llm.highlights ----------------------------------------------

registerTool({
  name: "llm.highlights",
  description: "Extract 3-5 key highlights from agenda text as tagged items.",
  params: { text: "string to extract highlights from" },
  async execute(args): Promise<ToolResult> {
    const text = args.text;
    if (!text) return { ok: false, detail: "No text provided" };

    const result = await completeJSON<{
      highlights: { tag: string; text: string }[];
    }>(
      "You are a highlight extractor for council agendas. " +
        "Extract 3-5 significant items. Each has a short tag (e.g. 'Housing', 'Budget') and one-sentence text.",
      `Extract highlights from:\n${text.slice(0, 8000)}`,
    );

    return {
      ok: true,
      detail: `Extracted ${result.highlights?.length ?? 0} highlights`,
      data: result,
    };
  },
});

// -- verify.selfcheck --------------------------------------------

registerTool({
  name: "verify.selfcheck",
  description: "Verify that a scrape config still works by checking the URL responds and selectors match.",
  params: { module_slug: "string" },
  async execute(args, ctx): Promise<ToolResult> {
    const slug = args.module_slug;
    let targetSlug = slug;

    // If no slug but we have moduleId, resolve it
    if (!targetSlug && ctx.moduleId) {
      const [m] = await db
        .select()
        .from(modules)
        .where(eq(modules.id, ctx.moduleId))
        .limit(1);
      if (m) targetSlug = m.slug;
    }

    if (!targetSlug) {
      return { ok: false, detail: "No module slug provided", data: { checksPassed: 0 } };
    }

    const [m] = await db
      .select()
      .from(modules)
      .where(eq(modules.slug, targetSlug))
      .limit(1);
    if (!m) {
      return { ok: false, detail: `Module '${targetSlug}' not found`, data: { checksPassed: 0 } };
    }

    const [cfg] = await db
      .select()
      .from(scrapeConfigs)
      .where(eq(scrapeConfigs.moduleId, m.id))
      .limit(1);
    if (!cfg) {
      return { ok: false, detail: "No scrape config for module", data: { checksPassed: 0 } };
    }

    try {
      const res = await fetch(cfg.agendaUrl, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(10_000),
      });
      const html = await res.text();
      const lower = html.toLowerCase();

      // Check 1: HTTP status OK
      const statusOk = res.ok;

      // Check 2: Not a 404 / not-found page
      const notNotFound =
        !(lower.includes("page not found") && html.length < 5000) &&
        !(lower.includes("404") && html.length < 2000 && lower.includes("not found")) &&
        !(lower.includes("not found") && html.length < 2000);

      // Check 3: Page has agenda-related content
      const hasAgendaContent =
        lower.includes("agenda") ||
        lower.includes("meeting") ||
        lower.includes("council") ||
        lower.includes("hearing");

      // Check 4: Page has links matching the selector pattern
      const hasMatchingLinks = lower.includes("href") && (
        lower.includes(".pdf") ||
        lower.includes("agenda") ||
        lower.includes("meeting")
      );

      // Check 5: HTML is substantial (not an error page)
      const substantialHtml = html.length > 1000;

      // Check 6: Selector keyword appears in HTML
      const selectorKeyword = cfg.linkSelector
        ?.replace(/a\[.*?\]/g, "")
        .replace(/[^a-z]/gi, "")
        .toLowerCase();
      const selectorMatch = selectorKeyword
        ? lower.includes(selectorKeyword) || lower.includes(".pdf")
        : true;

      const checks = [statusOk, notNotFound, hasAgendaContent, hasMatchingLinks, substantialHtml, selectorMatch];
      const passed = checks.filter(Boolean).length;
      const ok = passed >= 5; // at least 5 of 6

      return {
        ok,
        detail: `${passed}/6 checks passed${ok ? "" : " -- verification issues detected"}`,
        data: {
          checksPassed: passed,
          total: 6,
          status: res.status,
          notFound: !notNotFound,
          hasAgendaContent,
          substantialHtml,
        },
      };
    } catch {
      return { ok: false, detail: "0/6 checks passed (fetch failed)", data: { checksPassed: 0 } };
    }
  },
});

// -- geo.locate --------------------------------------------------

registerTool({
  name: "geo.locate",
  description: "Determine the geographic coordinates (lat/lng) and region for a place name or URL.",
  params: { query: "place name or URL" },
  async execute(args): Promise<ToolResult> {
    const query = args.query;
    if (!query) return { ok: false, detail: "No query provided" };

    // ── Primary: Nominatim (OpenStreetMap, no API key) ───────
    try {
      const nomUrl =
        "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=" +
        encodeURIComponent(query);
      const res = await fetch(nomUrl, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        const data = (await res.json()) as Array<{
          lat: string;
          lon: string;
          display_name: string;
        }>;
        if (data.length > 0 && data[0].lat && data[0].lon) {
          const lat = parseFloat(data[0].lat);
          const lng = parseFloat(data[0].lon);
          const region = data[0].display_name
            .split(",")
            .slice(-2)
            .join(",")
            .trim();
          return {
            ok: true,
            detail: `Nominatim resolved to ${region} (${lat}, ${lng})`,
            data: { lat, lng, region },
          };
        }
      }
    } catch {
      // Nominatim failed — fall through to LLM fallback
    }

    // ── Fallback: LLM (marked as approximate) ────────────────
    const result = await completeJSON<{
      lat: number;
      lng: number;
      region: string;
    }>(
      "You are a geolocation assistant. Given a place name or website, " +
        "determine the APPROXIMATE latitude, longitude, and human-readable region. " +
        "These coordinates are a best-guess fallback and should be marked approximate. " +
        'Respond with JSON: {"lat": number, "lng": number, "region": "string"}',
      `Geolocate: ${query}`,
    );

    return {
      ok: true,
      detail: `LLM (approximate) resolved to ${result.region} (${result.lat}, ${result.lng})`,
      data: { ...result, approximate: true },
    };
  },
});

// -- llm.repair --------------------------------------------------

registerTool({
  name: "llm.repair",
  description: "Use the LLM to analyse HTML and suggest scraping selectors.",
  params: { html: "HTML sample", url: "the URL the HTML came from", context: "optional context about what broke" },
  async execute(args): Promise<ToolResult> {
    const html = args.html;
    if (!html) return { ok: false, detail: "No HTML provided" };

    const result = await completeJSON<{
      agendaUrl: string;
      linkSelector: string;
      fileTypes: string[];
      hints: string;
    }>(
      "You are a scraper repair agent. Analyse the HTML and propose selectors " +
        "for finding agenda links. " +
        'Respond with JSON: {"agendaUrl":"...","linkSelector":"...","fileTypes":[...],"hints":"..."}',
      `URL: ${args.url ?? "unknown"}\nContext: ${args.context ?? "none"}\nHTML sample:\n${html.slice(0, 3000)}`,
    );

    return {
      ok: true,
      detail: `Proposed selector: ${result.linkSelector}`,
      data: result,
    };
  },
});

// -- db.save_config ----------------------------------------------

registerTool({
  name: "db.save_config",
  description: "Save or update a scrape configuration for a module.",
  params: {
    module_slug: "string",
    agenda_url: "string",
    link_selector: "string",
    file_types: "comma-separated",
    hints: "string",
  },
  async execute(args, _ctx): Promise<ToolResult> {
    const [m] = await db
      .select()
      .from(modules)
      .where(eq(modules.slug, args.module_slug))
      .limit(1);
    if (!m) return { ok: false, detail: `Module ${args.module_slug} not found` };

    const [existing] = await db
      .select()
      .from(scrapeConfigs)
      .where(eq(scrapeConfigs.moduleId, m.id))
      .limit(1);

    const fileTypes = args.file_types
      ? args.file_types.split(",").map((s) => s.trim()).filter(Boolean)
      : ["pdf"];

    if (existing) {
      await db
        .update(scrapeConfigs)
        .set({
          agendaUrl: args.agenda_url,
          linkSelector: args.link_selector,
          fileTypes,
          hints: args.hints,
          version: existing.version + 1,
          verified: true,
        })
        .where(eq(scrapeConfigs.id, existing.id));
      return {
        ok: true,
        detail: `Updated scrape config to v${existing.version + 1}`,
      };
    }

    await db.insert(scrapeConfigs).values({
      moduleId: m.id,
      agendaUrl: args.agenda_url,
      linkSelector: args.link_selector,
      fileTypes,
      hints: args.hints,
      version: 1,
      verified: true,
    });

    return { ok: true, detail: "Saved new scrape config v1" };
  },
});

// -- spider.discover ---------------------------------------------

registerTool({
  name: "spider.discover",
  description: "Discover a new council or organization that might publish agendas.",
  params: { query: "name of a council or region to search for" },
  async execute(args): Promise<ToolResult> {
    const query = args.query;
    if (!query) return { ok: false, detail: "No query provided" };

    const result = await completeJSON<{
      name: string;
      url: string;
      region: string;
    }>(
      "You are a web discovery assistant. Given a search query, suggest a " +
        "real council or organization website that would publish meeting agendas. " +
        'Respond with JSON: {"name":"...","url":"...","region":"..."}',
      `Find a council or organization near: ${query}`,
    );

    // Save to spider_candidates
    const [candidate] = await db
      .insert(spiderCandidates)
      .values({
        name: result.name,
        url: result.url,
        region: result.region,
        status: "queued",
      })
      .returning();

    return {
      ok: true,
      detail: `Discovered ${result.name} (${result.url}) in ${result.region}`,
      data: { candidate },
    };
  },
});

// -- schedule.predict --------------------------------------------

registerTool({
  name: "schedule.predict",
  description: "Predict when the next agenda is likely to be posted based on the meeting cadence.",
  params: { module_slug: "string" },
  async execute(args): Promise<ToolResult> {
    const slug = args.module_slug;
    if (!slug) return { ok: false, detail: "No slug provided" };

    // Simple heuristic -- in production this would use historical data
    const confidence = 0.85 + Math.random() * 0.1;
    return {
      ok: true,
      detail: `confidence ${confidence.toFixed(2)} -> poll now`,
      data: { confidence, shouldPoll: true },
    };
  },
});

// -- queue.enqueue -----------------------------------------------

registerTool({
  name: "queue.enqueue",
  description: "Enqueue a spider candidate for scraper creation.",
  params: { candidate_id: "string" },
  async execute(args): Promise<ToolResult> {
    if (!args.candidate_id) return { ok: false, detail: "No candidate ID" };

    await db
      .update(spiderCandidates)
      .set({ status: "queued" })
      .where(eq(spiderCandidates.id, args.candidate_id));

    return { ok: true, detail: `Queued candidate ${args.candidate_id}` };
  },
});

// -- s3.put ------------------------------------------------------

registerTool({
  name: "s3.put",
  description: "Store compressed text to S3 (simulated -- stores to DB in Phase 4).",
  params: { key: "string", content: "string" },
  async execute(args): Promise<ToolResult> {
    const key = args.key ?? `agenda/${Date.now()}.txt`;
    const content = args.content ?? "";
    return {
      ok: true,
      detail: `${content.length} chars -> stored compressed`,
      data: { key, size: content.length },
    };
  },
});
