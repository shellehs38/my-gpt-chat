
import { NextResponse } from "next/server";

const MAX_BODY_BYTES = 16 * 1024;
const MAX_MESSAGE_LENGTH = 10_000;
const OPENAI_TIMEOUT_MS = 30_000;

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function extractOutputText(data: unknown): string {
  if (
    typeof data !== "object" ||
    data === null ||
    !("output" in data) ||
    !Array.isArray(data.output)
  ) {
    return "";
  }

  return data.output
    .flatMap((item: unknown) => {
      if (
        typeof item !== "object" ||
        item === null ||
        !("content" in item) ||
        !Array.isArray(item.content)
      ) {
        return [];
      }

      return item.content.flatMap((part: unknown) => {
        if (
          typeof part !== "object" ||
          part === null ||
          !("type" in part) ||
          part.type !== "output_text" ||
          !("text" in part) ||
          typeof part.text !== "string"
        ) {
          return [];
        }

        return [part.text];
      });
    })
    .join("")
    .trim();
}

export async function POST(request: Request) {
  const contentLength = request.headers.get("content-length");

  if (contentLength !== null) {
    const size = Number(contentLength);

    if (!Number.isFinite(size) || size < 0) {
      return errorResponse("Некорректный размер запроса.", 400);
    }

    if (size > MAX_BODY_BYTES) {
      return errorResponse("Запрос слишком большой.", 413);
    }
  }

  const reader = request.body?.getReader();

  if (!reader) {
    return errorResponse("Не удалось прочитать запрос.", 400);
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let rawBody: string;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      totalBytes += value.byteLength;

      if (totalBytes > MAX_BODY_BYTES) {
        void reader.cancel().catch(() => undefined);
        return errorResponse("Запрос слишком большой.", 413);
      }

      chunks.push(value);
    }

    const bodyBytes = new Uint8Array(totalBytes);
    let offset = 0;

    for (const chunk of chunks) {
      bodyBytes.set(chunk, offset);
      offset += chunk.byteLength;
    }

    rawBody = new TextDecoder().decode(bodyBytes);
  } catch {
    return errorResponse("Не удалось прочитать запрос.", 400);
  } finally {
    reader.releaseLock();
  }

  let body: unknown;

  try {
    body = JSON.parse(rawBody);
  } catch {
    return errorResponse("Некорректный формат запроса.", 400);
  }

  if (
    typeof body !== "object" ||
    body === null ||
    !("message" in body) ||
    typeof body.message !== "string"
  ) {
    return errorResponse("Введите текст сообщения.", 400);
  }

  const message = body.message.trim();

  if (!message) {
    return errorResponse("Введите текст сообщения.", 400);
  }

  if (message.length > MAX_MESSAGE_LENGTH) {
    return errorResponse(
      `Сообщение не должно превышать ${MAX_MESSAGE_LENGTH} символов.`,
      413
    );
  }

  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    console.error("OPENAI_API_KEY is not configured");

    return errorResponse(
      "Сервис ИИ временно недоступен. Проверьте настройки сервера.",
      503
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    OPENAI_TIMEOUT_MS
  );

  try {
    const response = await fetch(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          instructions:
            "Ты ИИ-помощник строительной компании ООО СВОИ ЛЮДИ в Иркутске. " +
            "Помогай со строительными сметами, фасадами, материалами, " +
            "коммерческими предложениями, договорами и управлением проектами. " +
            "Не выдумывай цены и технические характеристики. " +
            "Если данных недостаточно, задай уточняющие вопросы.",
          input: message,
          max_output_tokens: 1200,
          store: false,
        }),
        signal: controller.signal,
        cache: "no-store",
      }
    );

    if (!response.ok) {
      console.error("OpenAI API request failed", {
        status: response.status,
      });

      if (response.status === 429) {
        return errorResponse(
          "Сервис ИИ временно недоступен. Попробуйте позже.",
          503
        );
      }

      return errorResponse(
        "Не удалось получить ответ ИИ. Попробуйте позже.",
        502
      );
    }

    let data: unknown;

    try {
      data = await response.json();
    } catch {
      console.error("OpenAI returned invalid JSON");

      return errorResponse(
        "Сервис ИИ вернул некорректный ответ.",
        502
      );
    }

    const reply = extractOutputText(data);

    if (!reply) {
      console.error("OpenAI response contained no output text");

      return errorResponse(
        "ИИ не вернул текст ответа. Попробуйте ещё раз.",
        502
      );
    }

    return NextResponse.json(
      { reply },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch {
    if (controller.signal.aborted) {
      console.error("OpenAI API request timed out");

      return errorResponse(
        "Сервис ИИ отвечает слишком долго. Попробуйте ещё раз.",
        504
      );
    }

    console.error("Failed to communicate with OpenAI API");

    return errorResponse(
      "Не удалось связаться с сервисом ИИ. Попробуйте позже.",
      502
    );
  } finally {
    clearTimeout(timeout);
  }
}
