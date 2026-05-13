import type { MetadataRoute } from "next";
import { siteConfig } from "@/config/site";

// robots.txt — tells crawlers what they may and may not index.
// /admin/* and the booking confirmation page are private surfaces.
// Everything else is fair game and the sitemap pointer helps discovery.
export default function robots(): MetadataRoute.Robots {
  const base = siteConfig.url.replace(/\/$/, "");
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/admin/",
          "/api/",
          "/book/success",
        ],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
