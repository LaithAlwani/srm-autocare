import type { MetadataRoute } from "next";
import { siteConfig } from "@/config/site";

// Dynamic XML sitemap. Lists every public marketing page so Google can
// discover the full site from a single fetch. Available at /sitemap.xml.
// Admin routes and the booking-success page are excluded via robots.ts.
//
// `changeFrequency` is a hint to crawlers, not a contract. `priority` is
// relative within this sitemap (so 1.0 for home, lower for ancillary pages).
export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteConfig.url.replace(/\/$/, "");
  const now = new Date();
  return [
    {
      url: `${base}/`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${base}/services`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: `${base}/gallery`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: `${base}/book`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${base}/about`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      url: `${base}/contact`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.6,
    },
  ];
}
