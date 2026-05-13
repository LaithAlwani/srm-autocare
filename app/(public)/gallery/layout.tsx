import type { Metadata } from "next";
import type { ReactNode } from "react";
import { siteConfig } from "@/config/site";

export const metadata: Metadata = {
  title: "Results Gallery",
  description: `Before-and-after detailing transformations from ${siteConfig.name}'s ${siteConfig.address.city} studio — ceramic coatings, paint correction, and interior reconditioning.`,
  alternates: { canonical: "/gallery" },
  openGraph: {
    title: `Results Gallery | ${siteConfig.name}`,
    description: "Before. After. Surgical precision.",
    url: `${siteConfig.url}/gallery`,
  },
};

export default function GalleryLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
