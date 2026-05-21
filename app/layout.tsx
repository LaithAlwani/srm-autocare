import type { Metadata } from "next";
import { Hanken_Grotesk, Inter, JetBrains_Mono } from "next/font/google";
import { ConvexAuthNextjsServerProvider } from "@convex-dev/auth/nextjs/server";
import "./globals.css";
import { Providers } from "./providers";
import { siteConfig } from "@/config/site";

const hanken = Hanken_Grotesk({
  variable: "--font-hanken",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  display: "swap",
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  weight: ["500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: `${siteConfig.name} | ${siteConfig.tagline}`, template: `%s | ${siteConfig.name}` },
  description: siteConfig.description,
  metadataBase: new URL(siteConfig.url),
  openGraph: {
    title: `${siteConfig.name} | ${siteConfig.tagline}`,
    description: siteConfig.description,
    url: siteConfig.url,
    siteName: siteConfig.name,
    type: "website",
  },
  icons: { icon: "/logo.png" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ConvexAuthNextjsServerProvider>
      <html
        lang="en"
        className={`dark ${hanken.variable} ${inter.variable} ${jetbrains.variable}`}
      >
        <head>
          {/* Resource hints — open the network connection to third-party
              origins as early as possible so subsequent fetches don't block
              on TCP/TLS handshake. The Convex client kicks off queries from
              the very first render, so warming it up costs nothing. */}
          {process.env.NEXT_PUBLIC_CONVEX_URL && (
            <link
              rel="preconnect"
              href={process.env.NEXT_PUBLIC_CONVEX_URL}
              crossOrigin="anonymous"
            />
          )}
          <link rel="dns-prefetch" href="https://web.squarecdn.com" />
          <link rel="dns-prefetch" href="https://sandbox.web.squarecdn.com" />
        </head>
        <body className="min-h-screen flex flex-col bg-surface text-foreground antialiased">
          <Providers>{children}</Providers>
        </body>
      </html>
    </ConvexAuthNextjsServerProvider>
  );
}
