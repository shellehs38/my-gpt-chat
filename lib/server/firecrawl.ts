/** Untrusted public search data must never be treated as a confirmed supplier quotation. */
export type FirecrawlHit = { title: string; description: string; url: string };

export function validateMaterialQuery(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const query = (value as Record<string, unknown>).query;
  if (typeof query !== "string") return null;
  const clean = query.replace(/\s+/g, " ").trim();
  if (clean.length < 3 || clean.length > 120 || /[\x00-\x1f\x7f]/.test(clean)) return null;
  return clean;
}

export function parseFirecrawlResults(value: unknown): FirecrawlHit[] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (body.success !== true || !body.data || typeof body.data !== "object") return null;
  const web = (body.data as Record<string, unknown>).web;
  if (!Array.isArray(web)) return null;
  const seen = new Set<string>();
  const found: FirecrawlHit[] = [];
  for (const raw of web) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const item = raw as Record<string, unknown>;
    if (typeof item.url !== "string") continue;
    let url: URL;
    try { url = new URL(item.url); } catch { continue; }
    if (url.protocol !== "https:" && url.protocol !== "http:") continue;
    if (url.username || url.password || !url.hostname.includes(".") || seen.has(url.href)) continue;
    if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(url.hostname)) continue;
    seen.add(url.href);
    const title = typeof item.title === "string" && item.title.trim() ? item.title.trim() : url.hostname;
    const description = typeof item.description === "string" ? item.description : "";
    found.push({ title: title.slice(0, 180), description: description.trim().slice(0, 700), url: url.href });
    if (found.length === 5) break;
  }
  return found;
}
