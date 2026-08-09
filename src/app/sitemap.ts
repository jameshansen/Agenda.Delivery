import type { MetadataRoute } from "next";
import { db } from "@/db";
import { modules } from "@/db/schema";

export const dynamic = "force-dynamic";

/**
 * /sitemap.xml — lists all module pages and key static pages.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://agenda.delivery";

  const staticPages: MetadataRoute.Sitemap = [
    { url: `${baseUrl}/`, lastModified: new Date(), priority: 1.0, changeFrequency: "hourly" },
    { url: `${baseUrl}/map`, lastModified: new Date(), priority: 0.8, changeFrequency: "daily" },
    { url: `${baseUrl}/search`, lastModified: new Date(), priority: 0.6, changeFrequency: "daily" },
    { url: `${baseUrl}/agents`, lastModified: new Date(), priority: 0.5, changeFrequency: "hourly" },
    { url: `${baseUrl}/spider`, lastModified: new Date(), priority: 0.5, changeFrequency: "daily" },
  ];

  let modulePages: MetadataRoute.Sitemap = [];
  try {
    const mods = await db
      .select({ slug: modules.slug, lastUpdated: modules.lastUpdated })
      .from(modules);

    modulePages = mods.map((m) => ({
      url: `${baseUrl}/module/${m.slug}`,
      lastModified: m.lastUpdated ?? new Date(),
      priority: 0.7,
      changeFrequency: "weekly",
    }));
  } catch {
    // DB not ready — just return static pages
  }

  return [...staticPages, ...modulePages];
}