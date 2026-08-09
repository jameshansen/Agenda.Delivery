import { getModuleBySlug } from "@/db/queries";

export const dynamic = "force-dynamic";

/**
 * GET /module/[slug]/rss.xml — RSS feed for a module's recent agendas.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const m = await getModuleBySlug(slug);
  if (!m) {
    return new Response("Not found", { status: 404 });
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://agenda.delivery";
  const items = m.meetings
    .slice(0, 20)
    .map((mt) => {
      const link = `${baseUrl}/module/${m.slug}`;
      const date = new Date(mt.dateRaw).toUTCString();
      const description = `${escapeXml(mt.kind)} — ${mt.pages} pages`;
      const enclosure = mt.pdfUrl
        ? `\n      <enclosure url="${escapeXml(mt.pdfUrl)}" type="application/pdf" />`
        : "";
      return `    <item>
      <title>${escapeXml(mt.title)}</title>
      <link>${link}</link>
      <guid isPermaLink="false">${m.slug}-${escapeXml(mt.title)}</guid>
      <pubDate>${date}</pubDate>
      <description>${description}</description>${enclosure}
    </item>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeXml(m.name)} — agenda.delivery</title>
    <link>${baseUrl}/module/${m.slug}</link>
    <description>Recent agendas and AI summaries for ${escapeXml(m.name)}.</description>
    <language>en-ca</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
