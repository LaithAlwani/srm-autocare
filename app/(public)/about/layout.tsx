import type { Metadata } from "next";
import type { ReactNode } from "react";
import { siteConfig } from "@/config/site";

export const metadata: Metadata = {
  title: "About",
  description: `${siteConfig.name} is a precision auto-detailing studio in ${siteConfig.address.city}, ${siteConfig.address.state} dedicated to extracting the best possible finish from every vehicle.`,
  alternates: { canonical: "/about" },
  openGraph: {
    title: `About | ${siteConfig.name}`,
    description: "Engineered for the discerning owner.",
    url: `${siteConfig.url}/about`,
  },
};

export default function AboutLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
