import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 is a native module; keep it external so webpack doesn't try to bundle it.
  serverExternalPackages: ["better-sqlite3"],
  // Next.js blocks cross-origin requests to dev-only assets by default (DNS-rebinding
  // protection). To open the dev server from another machine, list its hostnames or IPs
  // in ALLOWED_DEV_ORIGINS (comma-separated), e.g. in .env.local. A bare "*" is not
  // supported (use "*.domain"). http://localhost:3000 on the same machine needs nothing.
  allowedDevOrigins: (process.env.ALLOWED_DEV_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  // A second dev server (e.g. a throwaway one for browser tests) needs its own build
  // folder, or the two overwrite each other's files.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
