import type { MetadataRoute } from "next";

/**
 * /robots.txt — crawl directives for search engines.
 * Allows all crawlers, disallows API and auth endpoints.
 */
export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://agenda.delivery";

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/account", "/login"],
    },
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}