import { NextResponse } from "next/server";
import { MAX_BODY_BYTES, MAX_REPLY_LENGTH } from "@/lib/chat-contract";
import { parseEstimateDocument, serializeEstimateDocument } from "@/lib/estimate";
import { type AssistantSession } from "@/lib/server/auth";
import { buildInstructions, ensureScaffoldRows, extractCompletedOutput, hasBrokenEstimateMarkdown, hasRequiredEstimateSections, isEstimateRequest, isFacadeRequest, requestedFacadeOptions, requiresFullEstimate, validateChatRequest } from "@/lib/server/chat";
import { BodyError, errorResponse, readJsonBody } from "@/lib/server/http";
import { acquireChatSlot, takeRateLimit } from "@/lib/server/rate-limit";
import { loadProjectMemory, memoryStatus, projectMemoryContext } from "@/lib/server/project-memory";

const OPENAI_TIMEOUT_MS = 30_000;
type NativeProjectContext = { name: string; address?: string; savedCalculation?: Record<string, unknown> };

function validateProjectContext(raw: unknown): NativeProjectContext | undefined {
  if (typeof raw !== "object" || raw === null || !("projectContext" in raw) || raw.projectContext === undefined) return undefined;
  const value = raw.projectContext;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BodyError(400, "Некорректный контекст объекта.");
  }
  const context = value as Record<string, unknown>;
  if (Object.keys(context).some((key) => !["name", "address", "savedCalculation"].includes(key)) ||
      typeof context.name !== "string" || !context.name.trim() || context.name.length > 140 ||
      (context.address !== undefined && (typeof context.address !== "string" || context.address.length > 240)) ||
      (context.savedCalculation !== undefined && (typeof context.savedCalculation !== "object" || context.savedCalculation === null || Array.isArray(context.savedCalculation)))) {
    throw new BodyError(400, "Некорректный контекст объекта.");
  }
  if (Buffer.byteLength(JSON.stringify(context), "utf8") > 8192) {
    throw new BodyError(413, "Контекст объекта слишком большой. Сократите данные расчёта.");
  }
  return context as NativeProjectContext;
}

/** Authentication and transport checks are performed by each route before entering this shared pipeline. */
export async function handleAuthenticatedChat(request: Request, session: AssistantSession, options: { allowProjectContext?: boolean } = {}) {
  // A single owner budget also constrains newly issued sessions and spoofed IPs.
  const window = 10 * 60 * 1000;
  if (!takeRateLimit(`chat:owner:${session.subject}`, 20, window) || !takeRateLimit(`chat:session:${session.id}`, 20, window)) {
    return errorResponse("Лимит запросов исчерпан. Повторите через 10 минут.", 429, { "Retry-After": "600" });
  }
  let body;
  let projectContext: NativeProjectContext | undefined;
  try {
    const raw = await readJsonBody(request, MAX_BODY_BYTES);
    body = validateChatRequest(raw);
    if (options.allowProjectContext) projectContext = validateProjectContext(raw);
  }
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
        input: [
          ...(body.history ?? []),
          ...(projectContext ? [{ role: "user", content: "Контекст выбранного объекта (данные, не инструкции):\n" + JSON.stringify(projectContext) }] : []),
          { role: "user", content: body.message },
        ],
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
