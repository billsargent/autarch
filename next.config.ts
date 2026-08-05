import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 is a native module; keep it external so webpack doesn't try to bundle it.
  serverExternalPackages: ["better-sqlite3"],
  // Next.js blocks cross-origin requests to dev-only assets by default (DNS-rebinding
  // protection). Add every hostname/IP you use to open the dev server from a browser.
  // NOTE: a bare "*" is NOT supported — origins must be enumerated (or use "*.domain").
  // Accessing via http://localhost:3000 on the same machine needs no entry.
  allowedDevOrigins: ["192.168.1.58"],
};

export default nextConfig;
