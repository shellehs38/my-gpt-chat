import { createHash } from "node:crypto";

/**
 * A bounded, per-process backstop for this single-owner application.
 * It resets on cold starts; multiple serverless instances require an external
 * shared limiter / hosting firewall and a provider spending limit as documented.
 */
type Bucket = { used: number; until: number };
const buckets = new Map<string, Bucket>();
let activeChats = 0;
const MAX_BUCKETS = 2048;

export function takeRateLimit(key: string, maximum: number, windowMs: number, now = Date.now()): boolean {
  for (const [storedKey, bucket] of buckets) if (bucket.until <= now) buckets.delete(storedKey);
  const bucket = buckets.get(key);
  if (bucket) {
    if (bucket.used >= maximum) return false;
    bucket.used += 1;
    return true;
  }
  // Fail closed when saturated; don't evict active limits and permit a bypass.
  if (buckets.size >= MAX_BUCKETS) return false;
  buckets.set(key, { used: 1, until: now + windowMs });
  return true;
}

/** Forwarded IP is only supplementary; the global/owner budgets cannot be bypassed with it. */
export function requestRateKey(request: Request): string {
  const address = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim().slice(0, 128) || "unknown";
  return createHash("sha256").update(address).digest("hex");
}

export function acquireChatSlot(): (() => void) | null {
  if (activeChats >= 2) return null;
  activeChats += 1;
  let released = false;
  return () => { if (!released) { activeChats -= 1; released = true; } };
}

/** For isolated node:test cases, never exposed through a route. */
export function resetRateLimitsForTests() { buckets.clear(); activeChats = 0; }
