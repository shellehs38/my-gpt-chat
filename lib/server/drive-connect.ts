import { getToken, startAuthorization, ConnectError, NoValidTokenError, UserAuthorizationRequiredError } from "@vercel/connect";
import { NextResponse } from "next/server";
import { getAccessConfig, readSession } from "./auth";
import { BodyError, errorResponse, isSameOriginWrite, readJsonBody } from "./http";
import { takeRateLimit } from "./rate-limit";

// Identical, explicit scopes for authorization and every subsequent token request.
// Never use dashboard defaults, request-body scopes, an email, or a login session ID.
export const DRIVE_SCOPES = ["openid", "https://www.googleapis.com/auth/drive.file"] as const;
export function driveTokenParams() {
  return { subject: { type: "user" as const, id: "owner" }, scopes: [...DRIVE_SCOPES] };
}
type Dependencies = {
  getToken: typeof getToken;
  startAuthorization: typeof startAuthorization;
  fetch: typeof fetch;
};
const noStore = { "Cache-Control": "no-store" };
function reply(status: string, message: string, extra: Record<string, unknown> = {}, httpStatus = 200) {
  return NextResponse.json({ status, message, ...extra }, { status: httpStatus, headers: noStore });
}
function connectorUid(): string | null {
  const value = process.env.GOOGLE_DRIVE_CONNECTOR_UID?.trim() ?? "";
  return /^(?:(?:google|oauth)\/[a-z0-9][a-z0-9_-]{0,79}|scl_[A-Za-z0-9]{10,80})$/.test(value) ? value : null;
}
function allowedAuthorizationUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return value.length <= 8192 && url.protocol === "https:" && url.hostname === "connect.vercel.com" &&
      url.port === "" && !url.username && !url.password;
  } catch { return false; }
}
function connectionFailure(error: unknown) {
  if (error instanceof UserAuthorizationRequiredError || error instanceof NoValidTokenError) {
    return reply("authorization_required", "Подключите Google-аккаунт, затем проверьте доступ к Drive.");
  }
  // Do not return/log raw SDK messages, vendor bodies, URLs, tokens or secrets.
  if (error instanceof ConnectError) {
    if (["client_not_linked_to_project", "client_not_enabled_for_environment", "client_not_found", "connector_not_found"].includes(error.code ?? "")) {
      return reply("setup_required", "Администратору нужно проверить подключение Google Drive к этому проекту и окружению.", {}, 503);
    }
  }
  return reply("unavailable", "Не удалось проверить Google Drive. Подключение не подтверждено. Повторите позже.", {}, 502);
}

/** Only the existing signed owner session may initiate/inspect this owner's grant. */
export function createDriveConnectHandlers(dependencies: Dependencies = {
  getToken, startAuthorization, fetch: (...args) => fetch(...args),
}) {
  function authorizeOwner(request: Request) {
    const config = getAccessConfig();
    return Boolean(config && readSession(request, config));
  }
  return {
    async GET(request: Request) {
      if (!authorizeOwner(request)) return errorResponse("Войдите в помощника.", 401);
      // Loading a page never mints a token, starts OAuth, or confirms a grant.
      return connectorUid()
        ? reply("unchecked", "Подключение Google Drive ещё не проверено.")
        : reply("setup_required", "Подключение Google Drive ещё не настроено на сервере.");
    },
    async POST(request: Request) {
      if (!isSameOriginWrite(request)) return errorResponse("Запрос должен быть отправлен с сайта помощника.", 403);
      if (!authorizeOwner(request)) return errorResponse("Войдите в помощника.", 401);
      const connector = connectorUid();
      if (!connector) return reply("setup_required", "Подключение Google Drive ещё не настроено на сервере.", {}, 503);
      let action: string;
      try {
        const body = await readJsonBody(request, 1024);
        if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1 ||
            !("action" in body) || typeof body.action !== "string" || !["authorize", "check"].includes(body.action)) {
          return errorResponse("Выберите подключение или проверку Google Drive.", 400);
        }
        action = body.action;
      } catch (error) {
        return error instanceof BodyError ? errorResponse(error.message, error.status) : errorResponse("Некорректный запрос.", 400);
      }
      if (!takeRateLimit(`drive:${action}:owner`, action === "authorize" ? 5 : 15, 5 * 60_000)) {
        return errorResponse("Слишком много проверок. Повторите через пять минут.", 429, { "Retry-After": "300" });
      }
      try {
        if (action === "authorize") {
          // Vercel Connect owns OAuth state, PKCE, refresh tokens and Google's callback.
          // No arbitrary callback, scope or subject is accepted from the browser.
          const result = await dependencies.startAuthorization(connector, driveTokenParams(), {
            prompt: "consent", expiresInMs: 10 * 60_000,
          });
          if (!allowedAuthorizationUrl(result.url)) throw new Error("Invalid authorization destination");
          return reply("authorization_required", "Завершите вход в Google, затем вернитесь в помощника и проверьте подключение.", { authorizationUrl: result.url });
        }
        const token = await dependencies.getToken(connector, driveTokenParams(), { forceRefresh: true });
        const response = await dependencies.fetch("https://www.googleapis.com/drive/v3/files?spaces=drive&pageSize=1&fields=kind", {
          headers: { Authorization: `Bearer ${token}` }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) {
          // In particular, an OpenID-only token does not establish access to Drive.
          return response.status === 401 || response.status === 403
            ? reply("authorization_required", "Google не подтвердил доступ к файлам Drive. Подключите аккаунт заново.", {}, 502)
            : reply("unavailable", "Google Drive временно недоступен. Повторите проверку позже.", {}, 502);
        }
        const data: unknown = await response.json();
        if (!data || typeof data !== "object" || !("kind" in data) || data.kind !== "drive#fileList") throw new Error("Invalid Drive reply");
        return reply("connected", "Доступ к Google Drive проверен. Автоматическое сохранение проектов ещё не включено.");
      } catch (error) { return connectionFailure(error); }
    },
  };
}
