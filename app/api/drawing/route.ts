import { getAccessConfig, readSession } from "@/lib/server/auth";
import { errorResponse, isSameOriginWrite } from "@/lib/server/http";
import { handleDrawing } from "@/lib/server/drawing";

export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  if (!isSameOriginWrite(request)) return errorResponse("Отправьте фото с сайта помощника.", 403);
  const config = getAccessConfig();
  if (!config) return errorResponse("Доступ к помощнику ещё не настроен.", 503);
  const session = readSession(request, config);
  if (!session) return errorResponse("Войдите в рабочий помощник и вернитесь к схеме.", 401);
  return handleDrawing(request, session);
}
