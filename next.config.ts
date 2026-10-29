import type { NextConfig } from "next";

const config: NextConfig = {
  // Bound build workers so CI behaves consistently on large shared hosts.
  experimental: { cpus: 2 },
  poweredByHeader: false,
  outputFileTracingIncludes: {
    "/api/chat": ["./data/codebase-memory.json", "./data/facade-material-catalog.json"],
    "/api/mcp": ["./data/codebase-memory.json"],
    "/api/project-memory": ["./data/codebase-memory.json"],
  },
  async redirects() {
    return [
      {source: "/facade-calculator", destination: "/facade-calculator/index.html", permanent: false},
      {source: "/house-calculator", destination: "/house-calculator/index.html", permanent: false},
      {source: "/calculators", destination: "/calculators/index.html", permanent: false}
    ];
  },
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
