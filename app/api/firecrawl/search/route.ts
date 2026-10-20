import { NextResponse } from "next/server";
import { getAccessConfig, readSession } from "@/lib/server/auth";
import { BodyError, errorResponse, isSameOriginWrite, readJsonBody } from "@/lib/server/http";
import { takeRateLimit } from "@/lib/server/rate-limit";
import { parseFirecrawlResults, validateMaterialQuery } from "@/lib/server/firecrawl";

export const runtime = "nodejs";
const SEARCH_TIMEOUT_MS = 15_000;

/** Owner-only, deliberately bounded web search; does not modify ledgers or estimates. */
export async function POST(request: Request) {
  if (!isSameOriginWrite(request)) return errorResponse("Запрос должен быть отправлен с сайта помощника.", 403);
  const config = getAccessConfig();
  if (!config) return errorResponse("Доступ к помощнику не настроен.", 503);
  const session = readSession(request, config);
  if (!session) return errorResponse("Войдите в помощник, чтобы искать материалы.", 401);

  let body: unknown;
  try { body = await readJsonBody(request, 4096); }
  catch (error) { return error instanceof BodyError ? errorResponse(error.message, error.status) : errorResponse("Некорректный запрос.", 400); }
  const query = validateMaterialQuery(body);
  if (!query) return errorResponse("Введите название материала от 3 до 120 символов.", 400);
  if (process.env.FIRECRAWL_ENABLED === "false") return errorResponse("Firecrawl отключён в настройках сервера. Остальные функции работают.", 503);
  const key = process.env.FIRECRAWL_API_KEY?.trim();
  if (!key) return errorResponse("Поиск пока не подключён: настройте FIRECRAWL_API_KEY на сервере.", 503);

  // In-process owner/session budgets; production also needs provider-side spending limits.
  const windowMs = 10 * 60 * 1000;
  if (!takeRateLimit("firecrawl:owner:" + session.subject, 5, windowMs) ||
      !takeRateLimit("firecrawl:session:" + session.id, 5, windowMs)) {
    return errorResponse("Лимит поиска: 5 запросов за 10 минут. Повторите позже.", 429, { "Retry-After": "600" });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  try {
    const response = await fetch("https://api.firecrawl.dev/v2/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
      body: JSON.stringify({ query: query + " купить цена поставщик Иркутск", limit: 5, sources: ["web"], safe: true, timeout: 12_000 }),
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return errorResponse(response.status === 429 ? "Лимит Firecrawl исчерпан. Повторите позже." : "Firecrawl пока не отвечает. Проверьте подключение и доступные кредиты.", 502);
    const result: unknown = await response.json();
    const items = parseFirecrawlResults(result);
    if (!items) return errorResponse("Firecrawl вернул неожиданные данные.", 502);
    return NextResponse.json({
      items, query, checkedAt: new Date().toISOString(),
      note: "Это ссылки и выдержки из открытых сайтов, а не подтверждённые цены поставщиков. Проверяйте дату, наличие, доставку и цену за единицу.",
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return errorResponse(controller.signal.aborted ? "Время поиска истекло. Повторите позже." : "Не удалось выполнить поиск Firecrawl.", controller.signal.aborted ? 504 : 502);
  } finally {
    clearTimeout(timer);
  }
}
