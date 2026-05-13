import type { Metadata } from "next";
import type { ReactNode } from "react";
import { siteConfig } from "@/config/site";

// `services` is a client component (uses Convex hooks for live pricing), so
// it can't export metadata itself. Putting it on this server-only layout is
// the canonical Next.js workaround.
export const metadata: Metadata = {
  title: "Services & Pricing",
  description: `Detailing services from ${siteConfig.name} in ${siteConfig.address.city}, ${siteConfig.address.state}: 9H ceramic coating, paint correction, PPF, interior steam care, and showroom wash & wax.`,
  alternates: { canonical: "/services" },
  openGraph: {
    title: `Services & Pricing | ${siteConfig.name}`,
    description: "Engineered detailing programs tailored to your vehicle.",
    url: `${siteConfig.url}/services`,
  },
};

export default function ServicesLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
