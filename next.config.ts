import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Allow next/image to optimize URLs served from any Convex
    // deployment. Convex assigns each deployment its own subdomain like
    // `fiery-gecko-691.convex.cloud`, so a wildcard pattern lets dev
    // and prod (and any future deployment) work without a config edit.
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.convex.cloud",
      },
    ],
  },
};

export default nextConfig;
