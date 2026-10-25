import type { MetadataRoute } from "next";

/** The owner workspace is private and should never appear in search results. */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
