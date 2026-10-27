import { getAccessConfig } from "@/lib/server/auth";
import { handleAuthenticatedChat } from "@/lib/server/chat-handler";
import { errorResponse } from "@/lib/server/http";
import { isNativeRequest, readNativeSession } from "@/lib/server/native-auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isNativeRequest(request)) return errorResponse("Этот адрес предназначен для нативного приложения.", 403);
  const config = getAccessConfig();
  if (!config) return errorResponse("Доступ закрыт: администратору необходимо настроить пароль и секрет сессии на сервере.", 503);
  const session = readNativeSession(request, config);
  if (!session) return errorResponse("Войдите в помощник, чтобы отправить сообщение.", 401);
  return handleAuthenticatedChat(request, session, { allowProjectContext: true });
}
