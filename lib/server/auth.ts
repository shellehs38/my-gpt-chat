import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "builder_session";
export const SESSION_SECONDS = 12 * 60 * 60;
type AccessConfig = { password: string; signingKey: Buffer };
export type AssistantSession = { subject: "owner"; id: string; expiresAt: number };

export function getAccessConfig(): AccessConfig | null {
  const password = process.env.ASSISTANT_ACCESS_PASSWORD ?? "";
  const secret = process.env.ASSISTANT_SESSION_SECRET ?? "";
  if (password.length < 12 || Buffer.byteLength(secret, "utf8") < 32) return null;
  // Rotating either setting invalidates previously issued cookies.
  return { password, signingKey: createHmac("sha256", secret).update(password).digest() };
}

export function passwordMatches(candidate: string, config: AccessConfig): boolean {
  const hash = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(hash(candidate), hash(config.password));
}

export function createSessionToken(config: AccessConfig, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({
    subject: "owner", id: randomBytes(24).toString("base64url"),
    issuedAt: Math.floor(now / 1000), expiresAt: Math.floor(now / 1000) + SESSION_SECONDS,
  })).toString("base64url");
  return `${payload}.${createHmac("sha256", config.signingKey).update(payload).digest("base64url")}`;
}

export function readSession(request: Request, config: AccessConfig, now = Date.now()): AssistantSession | null {
  const tokens = (request.headers.get("cookie") ?? "").split(";").map((entry) => entry.trim())
    .filter((entry) => entry.startsWith(`${SESSION_COOKIE}=`));
  if (tokens.length !== 1) return null;
  const token = tokens[0].slice(SESSION_COOKIE.length + 1);
  if (token.length > 1024) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))) return null;
  const [payload, supplied] = parts;
  const expected = createHmac("sha256", config.signingKey).update(payload).digest();
  const signature = Buffer.from(supplied, "base64url");
  if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) return null;
  try {
    const data: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof data !== "object" || data === null) return null;
    const value = data as Record<string, unknown>;
    const seconds = Math.floor(now / 1000);
    if (value.subject !== "owner" || typeof value.id !== "string" || !/^[A-Za-z0-9_-]{32}$/.test(value.id) ||
        !Number.isSafeInteger(value.issuedAt) || !Number.isSafeInteger(value.expiresAt) ||
        (value.issuedAt as number) > seconds + 30 || (value.expiresAt as number) <= seconds ||
        (value.expiresAt as number) - (value.issuedAt as number) !== SESSION_SECONDS) return null;
    return { subject: "owner", id: value.id, expiresAt: value.expiresAt as number };
  } catch { return null; }
}

export function sessionCookieOptions(request: Request) {
  return {
    httpOnly: true, sameSite: "strict" as const, path: "/",
    secure: process.env.NODE_ENV === "production" || new URL(request.url).protocol === "https:",
    maxAge: SESSION_SECONDS,
  };
}
