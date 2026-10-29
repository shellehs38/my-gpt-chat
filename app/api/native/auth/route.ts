import { NextResponse } from "next/server";
import { getAccessConfig, passwordMatches, SESSION_SECONDS } from "@/lib/server/auth";
import { createNativeSessionToken, isNativeRequest, readNativeSession } from "@/lib/server/native-auth";
import { BodyError, errorResponse, readJsonBody } from "@/lib/server/http";
import { requestRateKey, takeRateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!isNativeRequest(request)) return errorResponse("Этот адрес предназначен для нативного приложения.", 403);
  const config = getAccessConfig();
  const session = config && readNativeSession(request, config);
  return NextResponse.json({
    configured: Boolean(config), authenticated: Boolean(session), expiresAt: session ? session.expiresAt : null,
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!isNativeRequest(request)) return errorResponse("Этот адрес предназначен для нативного приложения.", 403);
  const config = getAccessConfig();
  if (!config) return errorResponse("Доступ закрыт: администратору необходимо настроить пароль и секрет сессии на сервере.", 503);
  const window = 15 * 60 * 1000;
  // The native and browser routes share both budgets, including failed attempts.
  if (!takeRateLimit("login:global", 30, window) || !takeRateLimit(`login:${requestRateKey(request)}`, 5, window)) {
    return errorResponse("Слишком много попыток входа. Повторите через 15 минут.", 429, { "Retry-After": "900" });
  }
  let body: unknown;
  try { body = await readJsonBody(request, 4096); }
  catch (error) { return error instanceof BodyError ? errorResponse(error.message, error.status) : errorResponse("Не удалось прочитать запрос.", 400); }
  if (typeof body !== "object" || body === null || Array.isArray(body) || !("password" in body) || typeof body.password !== "string" || body.password.length > 1024) {
    return errorResponse("Введите пароль доступа.", 400);
  }
  if (!passwordMatches(body.password, config)) return errorResponse("Неверный пароль доступа.", 401);
  const now = Date.now();
  return NextResponse.json({
    configured: true, authenticated: true, accessToken: createNativeSessionToken(config, now),
    tokenType: "Bearer", expiresAt: Math.floor(now / 1000) + SESSION_SECONDS,
  }, { headers: { "Cache-Control": "no-store" } });
}
