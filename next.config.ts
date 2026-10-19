import type { NextConfig } from "next";
import { BASE_PATH } from "./lib/paths";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Served inside the main site at skoxsoftware.com/portal, which forwards
  // every /portal request here. See lib/paths.ts.
  basePath: BASE_PATH,
  // Pin the workspace root: a stray package-lock.json in the home folder would
  // otherwise be taken as the root.
  turbopack: { root: __dirname },
  // The welcome guide PDF reads brand fonts from disk at runtime.
  outputFileTracingIncludes: {
    "/api/projects/\\[id\\]/welcome-guide": ["./assets/fonts/**/*"],
    "/api/projects/*/welcome-guide": ["./assets/fonts/**/*"],
  },
  // Old bookmarks and emailed links point at portal.skoxsoftware.com with no
  // /portal prefix. Send them to the address the portal lives at now.
  // basePath: false keeps these matching the raw path, so /portal/* (the real
  // app, and what the main site forwards here) is never caught by them.
  async redirects() {
    const site = "https://www.skoxsoftware.com/portal";
    const moved = [
      "/sign-in",
      "/settings",
      "/projects/:path*",
      "/admin/:path*",
      "/s/:path*",
      "/r/:path*",
      "/u/:path*",
      // Welcome guides and file links in emails already sent.
      "/api/:path*",
    ];
    return [
      { source: "/", destination: site, permanent: false, basePath: false as const },
      ...moved.map((source) => ({
        source,
        destination: `${site}${source}`,
        permanent: false,
        basePath: false as const,
      })),
    ];
  },
  // Forms submit from the main site's address, not this app's own, so that
  // origin has to be named or every server action is rejected.
  experimental: {
    serverActions: {
      allowedOrigins: ["www.skoxsoftware.com", "skoxsoftware.com", "portal.skoxsoftware.com"],
    },
  },
  // Files go straight from the browser to private Blob storage, so actions
  // only carry form fields and the default 1MB action body limit stays.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          // payment is granted to Stripe's checkout frame: without it, Apple Pay
          // and Google Pay can't run inside the embedded payment form.
          {
            key: "Permissions-Policy",
            value: 'camera=(), microphone=(), geolocation=(), payment=(self "https://checkout.stripe.com"), usb=()',
          },
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'; object-src 'none'; base-uri 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;
