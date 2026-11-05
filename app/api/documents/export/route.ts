import { getAccessConfig, readSession } from "@/lib/server/auth";
import { BodyError, errorResponse, isSameOriginWrite, readJsonBody } from "@/lib/server/http";
import { takeRateLimit } from "@/lib/server/rate-limit";
import { createBrandedDocument, DOCUMENT_BODY_BYTES, DOCUMENT_FORMATS, validateDocumentExport } from "@/lib/server/document-export";

export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  if (!isSameOriginWrite(request)) return errorResponse("Скачайте документ с сайта помощника.", 403);
  const config = getAccessConfig();
  if (!config) return errorResponse("Доступ к помощнику ещё не настроен.", 503);
  if (!readSession(request, config)) return errorResponse("Войдите в рабочий помощник.", 401);
  if (!takeRateLimit("owner-document-export", 15, 60_000)) return errorResponse("Слишком много выгрузок. Повторите через минуту.", 429);
  try {
    const input = validateDocumentExport(await readJsonBody(request, DOCUMENT_BODY_BYTES));
    const bytes = await createBrandedDocument(input);
    return new Response(new Uint8Array(bytes), { headers: {
      "Content-Type": DOCUMENT_FORMATS[input.format], "Content-Disposition": `attachment; filename="svoi-lyudi-document.${input.format}"`,
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    } });
  } catch (cause) {
    if (cause instanceof BodyError) return errorResponse(cause.message, cause.status);
    return errorResponse("Не удалось встроить логотип и сформировать файл. Документ без логотипа не выдан; повторите скачивание.", 500);
  }
}
