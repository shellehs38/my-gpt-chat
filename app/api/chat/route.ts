import { getAccessConfig, readSession } from "@/lib/server/auth";
import { handleAuthenticatedChat } from "@/lib/server/chat-handler";
import { errorResponse, isSameOriginWrite } from "@/lib/server/http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isSameOriginWrite(request)) return errorResponse("Запрос должен быть отправлен с сайта помощника.", 403);
  const config = getAccessConfig();
  if (!config) return errorResponse("Доступ закрыт: администратору необходимо настроить пароль и секрет сессии на сервере.", 503);
  const session = readSession(request, config);
  if (!session) return errorResponse("Войдите в помощник, чтобы отправить сообщение.", 401);
  return handleAuthenticatedChat(request, session);
}
