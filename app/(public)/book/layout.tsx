import type { Metadata } from "next";
import type { ReactNode } from "react";
import { siteConfig } from "@/config/site";

export const metadata: Metadata = {
  title: "Book an Appointment",
  description: `Reserve a detailing slot at ${siteConfig.name} in ${siteConfig.address.city}, ${siteConfig.address.state}. Pick a service, choose a time, and secure your appointment with a deposit.`,
  alternates: { canonical: "/book" },
  openGraph: {
    title: `Book an Appointment | ${siteConfig.name}`,
    description: "Reserve your slot.",
    url: `${siteConfig.url}/book`,
  },
};

export default function BookLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
