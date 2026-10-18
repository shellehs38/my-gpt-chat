import { NextResponse } from "next/server";

export function errorResponse(message: string, status: number, headers?: HeadersInit) {
  return NextResponse.json({ error: message }, {
    status,
    headers: { "Cache-Control": "no-store", ...Object.fromEntries(new Headers(headers)) },
  });
}

/** A browser write must originate on this application, including login and logout. */
export function isSameOriginWrite(request: Request): boolean {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (!origin || origin === "null") return false;
  try {
    const supplied = new URL(origin);
    if (origin !== supplied.origin || !["http:", "https:"].includes(supplied.protocol)) return false;
    const configured = process.env.ASSISTANT_PUBLIC_ORIGIN?.trim();
    if (configured) {
      const canonical = new URL(configured);
      return canonical.origin === configured && supplied.origin === canonical.origin;
    }
    const expected = new URL(request.url);
    // Next may canonicalize Request.url to localhost while the browser opened
    // 127.0.0.1 (or the deployment's host). Host is browser-controlled; forwarded
    // host headers are deliberately ignored because clients can spoof them.
    const host = request.headers.get("host");
    if (host) {
      if (host.length > 255 || /[\s\\/@?#]/.test(host)) return false;
      const external = new URL(`${expected.protocol}//${host}`);
      if (external.host.toLowerCase() !== host.toLowerCase()) return false;
      expected.host = external.host;
    }
    return supplied.origin === expected.origin;
  } catch {
    return false;
  }
}

export class BodyError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

/** Enforce the bytes actually read, not a caller-supplied Content-Length header. */
export async function readJsonBody(request: Request, maxBytes: number): Promise<unknown> {
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)))) {
    throw new BodyError(400, "Некорректный размер запроса.");
  }
  if (length !== null && Number(length) > maxBytes) throw new BodyError(413, "Запрос слишком большой.");
  const reader = request.body?.getReader();
  if (!reader) throw new BodyError(400, "Не удалось прочитать запрос.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        void reader.cancel().catch(() => undefined);
        throw new BodyError(413, "Запрос слишком большой.");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof BodyError) throw error;
    throw new BodyError(400, "Не удалось прочитать запрос.");
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new BodyError(400, "Некорректный формат запроса.");
  }
}
