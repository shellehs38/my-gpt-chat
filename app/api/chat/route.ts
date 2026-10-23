import { NextResponse } from "next/server";
import { MAX_BODY_BYTES, MAX_REPLY_LENGTH } from "@/lib/chat-contract";
import { parseEstimateDocument, serializeEstimateDocument } from "@/lib/estimate";
import { getAccessConfig, readSession } from "@/lib/server/auth";
import { buildInstructions, ensureScaffoldRows, extractCompletedOutput, hasBrokenEstimateMarkdown, hasRequiredEstimateSections, isEstimateRequest, isFacadeRequest, requestedFacadeOptions, requiresFullEstimate, validateChatRequest } from "@/lib/server/chat";
import { BodyError, errorResponse, isSameOriginWrite, readJsonBody } from "@/lib/server/http";
import { acquireChatSlot, takeRateLimit } from "@/lib/server/rate-limit";
import { loadProjectMemory, memoryStatus, projectMemoryContext } from "@/lib/server/project-memory";

export const runtime = "nodejs";
const OPENAI_TIMEOUT_MS = 30_000;

export async function POST(request: Request) {
  if (!isSameOriginWrite(request)) return errorResponse("Запрос должен быть отправлен с сайта помощника.", 403);
  const config = getAccessConfig();
  if (!config) return errorResponse("Доступ закрыт: администратору необходимо настроить пароль и секрет сессии на сервере.", 503);
  const session = readSession(request, config);
  if (!session) return errorResponse("Войдите в помощник, чтобы отправить сообщение.", 401);
  // A single owner budget also constrains newly issued sessions and spoofed IPs.
  const window = 10 * 60 * 1000;
  if (!takeRateLimit(`chat:owner:${session.subject}`, 20, window) || !takeRateLimit(`chat:session:${session.id}`, 20, window)) {
    return errorResponse("Лимит запросов исчерпан. Повторите через 10 минут.", 429, { "Retry-After": "600" });
  }
  let body;
  try { body = validateChatRequest(await readJsonBody(request, MAX_BODY_BYTES)); }
  catch (error) { return error instanceof BodyError ? errorResponse(error.message, error.status) : errorResponse("Не удалось прочитать запрос.", 400); }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return errorResponse("Сервис ИИ временно недоступен. Проверьте настройки сервера.", 503);
  const release = acquireChatSlot();
  if (!release) return errorResponse("Уже выполняются два запроса. Дождитесь ответа и повторите.", 429, { "Retry-After": "30" });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
  try {
    const memory = loadProjectMemory();
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL?.trim() || "gpt-4.1-mini",
        instructions: buildInstructions(body) + "\n\n" + projectMemoryContext(memory, body.message),
        input: [...(body.history ?? []), { role: "user", content: body.message }],
        max_output_tokens: 8000,
        store: false,
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) return errorResponse(response.status === 429 ? "Сервис ИИ временно недоступен. Попробуйте позже." : "Не удалось получить ответ ИИ. Попробуйте позже.", response.status === 429 ? 503 : 502);
    let data: unknown;
    try { data = await response.json(); }
    catch { return errorResponse("Сервис ИИ вернул некорректный ответ.", 502); }
    const raw = extractCompletedOutput(data);
    if (!raw || raw.length > MAX_REPLY_LENGTH || hasBrokenEstimateMarkdown(raw) ||
        (requiresFullEstimate(body) && !hasRequiredEstimateSections(raw, requestedFacadeOptions(body)))) {
      return errorResponse("ИИ вернул неполный или повреждённый ответ. Смета не заменена. Повторите запрос или разделите его на меньшие части.", 502);
    }
    const estimate = isEstimateRequest(body);
    const withScaffold = estimate && isFacadeRequest(body) ? ensureScaffoldRows(raw) : raw;
    const document = parseEstimateDocument(withScaffold);
    // Browser and API share precisely the same calculation/serialization path.
    const reply = estimate && document.blocks.some((block) => block.type === "table") ? serializeEstimateDocument(document) : withScaffold;
    return NextResponse.json({ reply, calculation: estimate ? "estimate" : "none", memory: memoryStatus(memory) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return errorResponse(controller.signal.aborted ? "Сервис ИИ отвечает слишком долго. Попробуйте ещё раз." : "Не удалось связаться с сервисом ИИ. Попробуйте позже.", controller.signal.aborted ? 504 : 502);
  } finally {
    clearTimeout(timeout);
    release();
  }
}
