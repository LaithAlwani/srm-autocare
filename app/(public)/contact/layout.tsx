import type { Metadata } from "next";
import type { ReactNode } from "react";
import { siteConfig } from "@/config/site";

export const metadata: Metadata = {
  title: "Contact & Location",
  description: `Visit ${siteConfig.name} at ${siteConfig.address.street}, ${siteConfig.address.city}, ${siteConfig.address.state} ${siteConfig.address.zip}. Call ${siteConfig.contact.phone} or email ${siteConfig.contact.email}.`,
  alternates: { canonical: "/contact" },
  openGraph: {
    title: `Contact | ${siteConfig.name}`,
    description: `Get in touch with ${siteConfig.name} in ${siteConfig.address.city}.`,
    url: `${siteConfig.url}/contact`,
  },
};

export default function ContactLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
