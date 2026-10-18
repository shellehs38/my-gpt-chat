import { NextResponse } from "next/server";
import { createSessionToken, getAccessConfig, passwordMatches, readSession, sessionCookieOptions, SESSION_COOKIE } from "@/lib/server/auth";
import { BodyError, errorResponse, isSameOriginWrite, readJsonBody } from "@/lib/server/http";
import { requestRateKey, takeRateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const config = getAccessConfig();
  return NextResponse.json({ configured: Boolean(config), authenticated: Boolean(config && readSession(request, config)) }, {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  if (!isSameOriginWrite(request)) return errorResponse("Запрос должен быть отправлен с сайта помощника.", 403);
  const config = getAccessConfig();
  if (!config) return errorResponse("Доступ закрыт: администратору необходимо настроить пароль и секрет сессии на сервере.", 503);
  const window = 15 * 60 * 1000;
  if (!takeRateLimit("login:global", 30, window) || !takeRateLimit(`login:${requestRateKey(request)}`, 5, window)) {
    return errorResponse("Слишком много попыток входа. Повторите через 15 минут.", 429, { "Retry-After": "900" });
  }
  let body: unknown;
  try { body = await readJsonBody(request, 4096); }
  catch (error) { return error instanceof BodyError ? errorResponse(error.message, error.status) : errorResponse("Не удалось прочитать запрос.", 400); }
  if (typeof body !== "object" || body === null || !("password" in body) || typeof body.password !== "string" || body.password.length > 1024) {
    return errorResponse("Введите пароль доступа.", 400);
  }
  if (!passwordMatches(body.password, config)) return errorResponse("Неверный пароль доступа.", 401);
  const response = NextResponse.json({ configured: true, authenticated: true }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(SESSION_COOKIE, createSessionToken(config), sessionCookieOptions(request));
  return response;
}

export async function DELETE(request: Request) {
  if (!isSameOriginWrite(request)) return errorResponse("Запрос должен быть отправлен с сайта помощника.", 403);
  const response = NextResponse.json({ authenticated: false, configured: Boolean(getAccessConfig()) }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions(request), maxAge: 0 });
  return response;
}
