import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { SESSION_SECONDS, type AssistantSession, getAccessConfig } from "@/lib/server/auth";

type AccessConfig = NonNullable<ReturnType<typeof getAccessConfig>>;
const TOKEN_PREFIX = "native-v1";
const MAX_TOKEN_LENGTH = 1024;

/** Native clients send no browser request metadata. This does not replace authentication. */
export function isNativeRequest(request: Request): boolean {
  if (request.headers.has("origin")) return false;
  for (const name of request.headers.keys()) if (name.startsWith("sec-fetch-")) return false;
  return true;
}

function nativeSigningKey(config: AccessConfig): Buffer {
  return createHmac("sha256", config.signingKey).update("svoi-lyudi:native-session:v1").digest();
}

/** A separate purpose and signing key prevent swapping native tokens and web cookies. */
export function createNativeSessionToken(config: AccessConfig, now = Date.now()): string {
  const issuedAt = Math.floor(now / 1000);
  const payload = Buffer.from(JSON.stringify({
    type: "native", version: 1, subject: "owner", id: randomBytes(24).toString("base64url"),
    issuedAt, expiresAt: issuedAt + SESSION_SECONDS,
  })).toString("base64url");
  const signed = `${TOKEN_PREFIX}.${payload}`;
  return `${signed}.${createHmac("sha256", nativeSigningKey(config)).update(signed).digest("base64url")}`;
}

export function readNativeSession(request: Request, config: AccessConfig, now = Date.now()): AssistantSession | null {
  const authorization = request.headers.get("authorization") ?? "";
  // Headers combines duplicate Authorization fields with a comma, which this grammar rejects.
  if (authorization.length > MAX_TOKEN_LENGTH + 7 || !/^Bearer [A-Za-z0-9_.-]+$/.test(authorization)) return null;
  const token = authorization.slice(7);
  if (token.length > MAX_TOKEN_LENGTH) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX || !parts.slice(1).every((part) => /^[A-Za-z0-9_-]+$/.test(part))) return null;
  const [, payload, supplied] = parts;
  const expected = createHmac("sha256", nativeSigningKey(config)).update(`${TOKEN_PREFIX}.${payload}`).digest();
  const signature = Buffer.from(supplied, "base64url");
  if (signature.length !== expected.length || signature.toString("base64url") !== supplied || !timingSafeEqual(signature, expected)) return null;
  try {
    const decoded = Buffer.from(payload, "base64url");
    if (decoded.toString("base64url") !== payload) return null;
    const data: unknown = JSON.parse(decoded.toString("utf8"));
    if (typeof data !== "object" || data === null) return null;
    const value = data as Record<string, unknown>;
    const seconds = Math.floor(now / 1000);
    if (value.type !== "native" || value.version !== 1 || value.subject !== "owner" ||
        typeof value.id !== "string" || !/^[A-Za-z0-9_-]{32}$/.test(value.id) ||
        !Number.isSafeInteger(value.issuedAt) || !Number.isSafeInteger(value.expiresAt) ||
        (value.issuedAt as number) > seconds + 30 || (value.expiresAt as number) <= seconds ||
        (value.expiresAt as number) - (value.issuedAt as number) !== SESSION_SECONDS) return null;
    return { subject: "owner", id: value.id, expiresAt: value.expiresAt as number };
  } catch { return null; }
}
