import { NextResponse } from "next/server";
import { getAccessConfig, readSession } from "@/lib/server/auth";
import { isSameOriginWrite, readJsonBody, errorResponse } from "@/lib/server/http";
import { takeRateLimit } from "@/lib/server/rate-limit";
import { LEAD_STATUSES, validateLeadDraft } from "@/lib/crm/lead";
import { CrmStorageError, createLead, listLeads, updateLeadStatus } from "@/lib/server/crm-store";

export const runtime = "nodejs";
function authorized(request: Request) {
  const config = getAccessConfig();
  return config && readSession(request, config) !== null;
}
function failure(error: unknown) {
  if (error instanceof CrmStorageError) return errorResponse(error.message, error.status);
  return errorResponse("CRM временно недоступна. Проверьте соединение и повторите операцию с тем же номером.", 503);
}
export async function GET(request: Request) {
  if (!authorized(request)) return errorResponse("Необходимо войти в кабинет.", 401);
  try { return NextResponse.json({ leads: await listLeads() }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  if (!isSameOriginWrite(request)) return errorResponse("Недопустимый источник запроса.", 403);
  if (!authorized(request)) return errorResponse("Необходимо войти в кабинет.", 401);
  if (!takeRateLimit("crm:owner", 30, 600000)) return errorResponse("Слишком много запросов.", 429);
  try {
    const raw = await readJsonBody(request, 10000);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return errorResponse("Некорректный запрос.", 400);
    const data = raw as Record<string, unknown>;
    if (typeof data.requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(data.requestId)) return errorResponse("Некорректный номер операции.", 400);
    const checked = validateLeadDraft(data.lead);
    if (!checked.ok) return errorResponse(checked.errors.join(" "), 400);
    return NextResponse.json({ lead: await createLead(checked.value, data.requestId) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}
export async function PATCH(request: Request) {
  if (!isSameOriginWrite(request)) return errorResponse("Недопустимый источник запроса.", 403);
  if (!authorized(request)) return errorResponse("Необходимо войти в кабинет.", 401);
  if (!takeRateLimit("crm:owner", 30, 600000)) return errorResponse("Слишком много запросов.", 429);
  try {
    const raw = await readJsonBody(request, 2000);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return errorResponse("Некорректный запрос.", 400);
    const data = raw as Record<string, unknown>;
    if (typeof data.id !== "string" || !/^[0-9a-f-]{36}$/i.test(data.id) || !LEAD_STATUSES.includes(data.status as typeof LEAD_STATUSES[number])) return errorResponse("Некорректные данные.", 400);
    return NextResponse.json({ lead: await updateLeadStatus(data.id, data.status as typeof LEAD_STATUSES[number]) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}
