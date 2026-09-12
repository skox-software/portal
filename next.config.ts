import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Pin the workspace root: a stray package-lock.json in the home folder would
  // otherwise be taken as the root.
  turbopack: { root: __dirname },
};

export default nextConfig;
