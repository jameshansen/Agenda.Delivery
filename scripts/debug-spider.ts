import "dotenv/config";
import { db } from "../src/db";
import { spiderCandidates } from "../src/db/schema";
import { eq } from "drizzle-orm";
import "../src/agents/tools";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 AgendaDelivery/1.0";

async function testCandidate(url: string) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA },
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
    });
    const html = await res.text();
    const lower = html.toLowerCase();

    // Check what kind of links exist
    const linkPattern = /href=["']([^"']+)["']/gi;
    const links: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = linkPattern.exec(html)) !== null) {
      const href = m[1];
      try {
        const abs = new URL(href, res.url).href;
        if (!links.includes(abs)) links.push(abs);
      } catch {}
    }

    const agendaLinks = links.filter((l) => {
      const ll = l.toLowerCase();
      return (
        ll.includes("agenda") ||
        ll.includes("meeting") ||
        ll.includes("council") ||
        ll.includes("calendar") ||
        ll.includes("board") ||
        ll.endsWith(".pdf")
      );
    });

    const detailLinks = agendaLinks.filter((l) => {
      const ll = l.toLowerCase();
      return (
        ll.includes("detail") ||
        ll.includes("meeting") ||
        ll.includes("agenda")
      );
    });

    // Check for common agenda page patterns
    const hasAgendaPage =
      lower.includes("council meeting") ||
      lower.includes("agenda") ||
      lower.includes("council agenda") ||
      lower.includes("meeting agenda") ||
      lower.includes("public hearing") ||
      lower.includes("board meeting");

    const isNotFound =
      (lower.includes("page not found") && html.length < 5000) ||
      (lower.includes("404") && html.length < 2000 && lower.includes("not found"));

    return {
      status: res.status,
      htmlLen: html.length,
      isNotFound,
      hasAgendaPage,
      totalLinks: links.length,
      agendaLinks: agendaLinks.length,
      detailLinks: detailLinks.length,
      sampleAgendaLinks: agendaLinks.slice(0, 5),
    };
  } catch (e: unknown) {
    const err = e as Error & { cause?: { code?: string } };
    return { error: err.cause?.code || err.message };
  }
}

async function main() {
  // Get the next 5 queued candidates
  const candidates = await db
    .select()
    .from(spiderCandidates)
    .where(eq(spiderCandidates.status, "queued"))
    .limit(5);

  for (const c of candidates) {
    console.log(`\n=== ${c.name} (${c.url}) ===`);
    const result = await testCandidate(c.url);
    console.log(JSON.stringify(result, null, 2));
  }
  process.exit(0);
}

main().catch(console.error);