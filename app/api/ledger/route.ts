import { NextResponse } from "next/server";
import { MAX_BODY_BYTES } from "@/lib/chat-contract";
import { getAccessConfig, readSession } from "@/lib/server/auth";
import { BodyError, errorResponse, isSameOriginWrite, readJsonBody } from "@/lib/server/http";
import { acquireChatSlot, takeRateLimit } from "@/lib/server/rate-limit";
import { LedgerDomainError, runLedgerCommand, validateLedgerCommand } from "@/lib/server/ledger";
import { getLedgerConfiguration, GoogleSheetsLedger, LedgerSheetsError } from "@/lib/server/ledger-sheets";

export const runtime = "nodejs";
export const maxDuration = 60;
function auth(request: Request) {
  const config = getAccessConfig();
  if (!config) return errorResponse("Доступ закрыт: настройте пароль и секрет сессии на сервере.", 503);
  if (!readSession(request, config)) return errorResponse("Войдите в помощник, чтобы открыть учёт.", 401);
  return null;
}
export async function GET(request: Request) {
  const denied = auth(request);
  if (denied) return denied;
  const configuration = getLedgerConfiguration();
  if (!configuration.configured) return NextResponse.json(configuration, { headers: { "Cache-Control": "no-store" } });
  try {
    await new GoogleSheetsLedger().loadSnapshot();
    return NextResponse.json({ ...configuration, configured: true, message: "Рабочая Google Таблица доступна. Команды учёта сохраняются в ней после проверки." }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ...configuration, configured: false, message: "Учёт пока не подключён: проверьте доступ сервисного аккаунта к книге и структуру листов. Запись недоступна." }, { headers: { "Cache-Control": "no-store" } });
  }
}
export async function POST(request: Request) {
  if (!isSameOriginWrite(request)) return errorResponse("Запрос должен быть отправлен с сайта помощника.", 403);
  const denied = auth(request);
  if (denied) return denied;
  const configuration = getLedgerConfiguration();
  if (!configuration.configured) return errorResponse(configuration.message, 503);
  if (!takeRateLimit("ledger:owner", 20, 10 * 60 * 1000)) return errorResponse("Слишком много команд учёта. Повторите через 10 минут.", 429, { "Retry-After": "600" });
  let command;
  try { command = validateLedgerCommand(await readJsonBody(request, MAX_BODY_BYTES)); }
  catch (error) { return error instanceof BodyError ? errorResponse(error.message, error.status) : errorResponse("Не удалось прочитать команду учёта.", 400); }
  const release = acquireChatSlot();
  if (!release) return errorResponse("Дождитесь завершения текущего запроса и повторите команду.", 429, { "Retry-After": "30" });
  try {
    const reply = await runLedgerCommand(command, { store: new GoogleSheetsLedger() });
    return NextResponse.json(reply, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof LedgerDomainError || error instanceof LedgerSheetsError) return errorResponse(error.message, error.status);
    return errorResponse("Не удалось подтвердить операцию учёта. Сохраните команду и повторите её с тем же номером операции.", 503);
  } finally { release(); }
}
