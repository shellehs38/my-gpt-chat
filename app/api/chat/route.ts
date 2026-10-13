
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
  const requestMode = "mode" in body && typeof body.mode === "string" ? body.mode : "general";
  const isEstimateRequest = requestMode === "estimate" || requestMode === "facade" || /смет[аыуе]|рассчита|стоимост[ьи]|количеств[оа].{0,30}материал/i.test(message);
  const asksNoInsulationOnly = /без утеплени[яе]/i.test(message) && !/(с утеплением и без|с утеплением,?\s*и?\s*без|оба вариант|два вариант)/i.test(message);
  const asksInsulationOnly = /с утеплением/i.test(message) && !/(с утеплением и без|с утеплением,?\s*и?\s*без|оба вариант|два вариант)/i.test(message);
  const asksBothFacadeOptions = /(с утеплением и без|с утеплением,?\s*и?\s*без|оба вариант|два вариант)/i.test(message);
  const requestedScope = asksNoInsulationOnly
    ? "ПОЛЬЗОВАТЕЛЬ ПРОСИТ ТОЛЬКО ФАСАД БЕЗ УТЕПЛЕНИЯ. Выдай ровно один вариант без утепления. Не добавляй вариант с утеплением. "
    : asksInsulationOnly
      ? "ПОЛЬЗОВАТЕЛЬ ПРОСИТ ТОЛЬКО ФАСАД С УТЕПЛЕНИЕМ. Выдай ровно один вариант с утеплением. Не добавляй вариант без утепления. "
      : asksBothFacadeOptions
        ? "ПОЛЬЗОВАТЕЛЬ ПРОСИТ ДВА ВАРИАНТА: с утеплением и без утепления. Выдай оба. "
        : "";

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
            "Помогай со строительными сметами, фасадами, материалами, коммерческими предложениями, договорами и управлением проектами. " +
            "Не выдумывай цены и технические характеристики. " +
            (isEstimateRequest
              ? requestedScope + "Для сметы обязательно сначала выдай готовую предварительную смету, а не только вопросы. Используй корректные Markdown-таблицы с заголовком и строкой-разделителем. " +
                "Для каждого варианта сделай отдельные таблицы «Материалы» и «Работы». " +
                "Столбцы материалов и работ: №, Наименование, Ед. изм., Количество, Цена за единицу, Сумма, Примечание. " +
                "Неизвестные значения указывай как «требует уточнения», не выдумывай цены. Если площадь известна, используй её как предварительное количество только там, где это оправдано, и поясни ограничения. " +
                "После таблиц задай только необходимые уточняющие вопросы. Не заменяй таблицы списками или абзацами."
              : "Если данных недостаточно, задай уточняющие вопросы."),
          input: isEstimateRequest
            ? message +
              "\\n\\n" + requestedScope +
              "ОБЯЗАТЕЛЬНЫЙ ФОРМАТ ОТВЕТА: выдай смету именно Markdown-таблицами, не списками и не текстовыми шаблонами с подчёркиваниями. " +
              (asksNoInsulationOnly
                ? "Выведи только один заголовок «Вариант — без утепления», таблицу «Материалы» и отдельную таблицу «Работы». Не упоминай и не составляй вариант с утеплением. "
                : asksInsulationOnly
                  ? "Выведи только один заголовок «Вариант — с утеплением», таблицу «Материалы» и отдельную таблицу «Работы». Не упоминай и не составляй вариант без утепления. "
                  : "Сначала заголовок «Вариант 1 — без утепления», затем таблица «Материалы» со столбцами «№ | Наименование | Ед. изм. | Количество | Цена за единицу, руб. | Сумма, руб. | Примечание», затем отдельная таблица «Работы» с теми же столбцами. После этого так же оформи «Вариант 2 — с утеплением» с отдельными таблицами материалов и работ. ") +
              "Используй синтаксис Markdown: строка заголовков, следующая строка с разделителями вида |---|---|---|, затем строки позиций. " +
              "Неизвестную цену указывай словами «требует уточнения» в ячейке, а не пустыми подчёркиваниями. " +
              "Не заменяй таблицы списками. После таблиц задай краткий список недостающих уточнений."
            : message,
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
