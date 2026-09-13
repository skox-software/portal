import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Pin the workspace root: a stray package-lock.json in the home folder would
  // otherwise be taken as the root.
  turbopack: { root: __dirname },
  // The welcome guide PDF reads brand fonts from disk at runtime.
  outputFileTracingIncludes: {
    "/api/projects/\\[id\\]/welcome-guide": ["./assets/fonts/**/*"],
    "/api/projects/*/welcome-guide": ["./assets/fonts/**/*"],
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
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'; object-src 'none'; base-uri 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;
