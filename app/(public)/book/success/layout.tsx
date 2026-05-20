import type { Metadata } from "next";
import type { ReactNode } from "react";

// Transient confirmation page — no SEO value, and the URL is keyed on our
// internal payment idempotency key so we don't want Google sniffing them.
export const metadata: Metadata = {
  title: "Booking confirmed",
  robots: { index: false, follow: false },
};

export default function BookSuccessLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
