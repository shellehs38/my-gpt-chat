import type { NextConfig } from "next";

const development = process.env.NODE_ENV !== "production";
const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  `script-src 'self' 'unsafe-inline'${development ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${development ? " ws: wss:" : ""}`,
  "manifest-src 'self'",
  "worker-src 'self' blob:",
].join("; ");

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
    return [{source: "/facade-calculator", destination: "/facade-calculator/index.html", permanent: false}];
  },
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "Content-Security-Policy", value: contentSecurityPolicy },
        { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
        { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(), payment=(), usb=()" },
        { key: "X-DNS-Prefetch-Control", value: "off" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
        { key: "Referrer-Policy", value: "same-origin" },
        ...(!development ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
        { key: "X-Frame-Options", value: "DENY" }
      ]
    }, {
      // Markdown exports may be viewed on another origin and reference this
      // public immutable logo. All application routes stay same-origin.
      source: "/brand/:path*",
      headers: [{ key: "Cross-Origin-Resource-Policy", value: "cross-origin" }],
    }];
  }
};

export default config;
