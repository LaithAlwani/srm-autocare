import type { Metadata } from "next";
import type { ReactNode } from "react";

// Applies to /admin and every nested route (login + authed pages). The
// `noindex, nofollow` directive in the meta tag is the authoritative
// signal to search engines — robots.txt only asks crawlers to skip
// fetching, while this tag tells them not to index any version they
// already have. Both layers together cover both the polite case (bot
// respects robots.txt) and the misbehaving case (bot crawls anyway).
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    googleBot: { index: false, follow: false },
  },
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
