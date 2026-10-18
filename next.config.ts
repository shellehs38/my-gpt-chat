import type { NextConfig } from "next";

const config: NextConfig = {
  // Bound build workers so CI behaves consistently on large shared hosts.
  experimental: { cpus: 2 },
  poweredByHeader: false,
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "same-origin" },
        { key: "X-Frame-Options", value: "DENY" }
      ]
    }];
  }
};

export default config;
