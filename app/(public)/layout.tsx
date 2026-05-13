import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { JsonLd } from "@/components/json-ld";
import { siteConfig } from "@/config/site";

// Canonical at the public-section root. Per-route layouts (e.g. /services)
// override the title; the rest of the OG fields cascade down.
export const metadata: Metadata = {
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: siteConfig.name,
    locale: "en_CA",
  },
};

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <JsonLd />
      <Navbar />
      <main className="flex-1">{children}</main>
      <Footer />
    </>
  );
}
