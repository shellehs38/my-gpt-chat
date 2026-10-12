import { NextResponse } from "next/server";

const MAX_BODY_BYTES = 24 * 1024;
const MAX_MESSAGE_LENGTH = 10_000;
const OPENAI_TIMEOUT_MS = 30_000;

const MODES = {
  general: "Общий строительный помощник: строительство частных домов, организация работ, технологии, качество, риски и последовательность этапов.",
  estimate: "Режим сметчика. Уточняй исходные данные. Разделяй материалы, работы, доставку, аренду техники и прочие расходы. Показывай формулы, единицы измерения, количества и промежуточные итоги. Не придумывай цены и нормы расхода.",
  engineering: "Режим технического консультанта. Рассматривай фундаменты, стены, кровлю, утепление, гидроизоляцию, дренаж и подпорные стены. Уточняй нагрузки, геометрию, грунты, воду и применимые нормы. Не выдавай предварительную оценку за рабочий инженерный проект.",
  facade: "Режим фасадного специалиста: сайдинг, панели, штукатурные и вентилируемые фасады, подсистемы, крепёж, утепление, мембраны, доборные элементы и контроль монтажа.",
  business: "Режим управления строительным бизнесом: продажи, коммерческие предложения, договоры, планирование, закупки, себестоимость, риски, сроки и прибыль.",
  documents: "Режим строительных документов: готовь проекты смет, коммерческих предложений, договоров, актов, технических заданий и чек-листов. Помечай данные, которые нужно заполнить или проверить."
} as const;

type Mode = keyof typeof MODES;

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function extractOutputText(data: unknown): string {
  if (
    typeof data !== "object" ||
    data === null ||
    !("output" in data) ||
    !Array.isArray(data.output)
  ) return "";

  return data.output.flatMap((item: unknown) => {
    if (
      typeof item !== "object" ||
      item === null ||
      !("content" in item) ||
      !Array.isArray(item.content)
    ) return [];

    return item.content.flatMap((part: unknown) => {
      if (
        typeof part !== "object" ||
        part === null ||
        !("type" in part) ||
        part.type !== "output_text" ||
        !("text" in part) ||
        typeof part.text !== "string"
      ) return [];
      return [part.text];
    });
  }).join("\n").trim();
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Некорректный формат запроса.", 400);
  }

  if (
    typeof body !== "object" ||
    body === null ||
    !("message" in body) ||
    typeof body.message !== "string"
  ) return errorResponse("Введите текст сообщения.", 400);

  const message = body.message.trim();
  if (!message) return errorResponse("Введите текст сообщения.", 400);
  if (message.length > MAX_MESSAGE_LENGTH) {
    return errorResponse(`Сообщение не должно превышать ${MAX_MESSAGE_LENGTH} символов.`, 413);
  }

  const requestedMode = "mode" in body ? body.mode : "general";
  const mode: Mode =
    typeof requestedMode === "string" && requestedMode in MODES
      ? requestedMode as Mode
      : "general";

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("OPENAI_API_KEY is not configured");
    return errorResponse("Сервис ИИ временно недоступен. Проверьте настройки сервера.", 503);
  }

  const instructions = [
    "Ты — строительный ИИ-помощник компании ООО «СВОИ ЛЮДИ» в Иркутске.",
    "Помогай в строительстве частных домов, фундаментах, стенах, перекрытиях, кровле, фасадах, подпорных стенах, отмостках, ливневой канализации, бетонных работах, ограждениях, сметах, документах и управлении строительными проектами.",
    "РЕЖИМ РАБОТЫ: " + MODES[mode],
    "Не выдумывай цены, нормативы, технические характеристики, цитаты и источники. Разделяй подтверждённые данные, допущения и неизвестные сведения.",
    "Если критически важных исходных данных не хватает, сначала задай конкретные уточняющие вопросы. Не скрывай допущения.",
    "В расчётах указывай исходные данные, формулы, единицы измерения и промежуточные результаты. Проверяй арифметику.",
    "Для смет разделяй материалы, работы, доставку, технику и прочие расходы. Неизвестные цены отмечай как «не указаны», не подставляй выдуманные значения.",
    "Для несущих конструкций, фундаментов, подпорных стен и устойчивости грунта перечисляй необходимые проверки и ограничения. Не представляй предварительный ответ как рабочий инженерный проект.",
    "При обсуждении нормативов проси уточнить юрисдикцию и назначение объекта, если это важно. Не называй норму обязательной без достаточных оснований.",
    "Форматируй ответы в Markdown: ясные заголовки, списки и таблицы там, где они помогают. Сначала краткий вывод, затем подробности и практический следующий шаг."
  ].join("\n\n");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        instructions,
        input: message,
        max_output_tokens: 1800,
        store: false,
      }),
      signal: controller.signal,
      cache: "no-store",
    });

    if (!response.ok) {
      console.error("OpenAI API request failed", { status: response.status });
      if (response.status === 429) {
        return errorResponse("Сервис ИИ временно недоступен. Проверьте лимиты и оплату API или попробуйте позже.", 503);
      }
      if (response.status === 401) {
        return errorResponse("Сервис ИИ не авторизован. Нужно проверить API-ключ в настройках сервера.", 502);
      }
      return errorResponse("Не удалось получить ответ ИИ. Проверьте журнал сервера и попробуйте позже.", 502);
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      console.error("OpenAI returned invalid JSON");
      return errorResponse("Сервис ИИ вернул некорректный ответ.", 502);
    }

    const reply = extractOutputText(data);
    if (!reply) {
      console.error("OpenAI response contained no output text");
      return errorResponse("ИИ не вернул текст ответа. Попробуйте ещё раз.", 502);
    }

    return NextResponse.json({ reply }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    if (controller.signal.aborted) {
      console.error("OpenAI API request timed out");
      return errorResponse("Сервис ИИ отвечает слишком долго. Попробуйте ещё раз.", 504);
    }
    console.error("Failed to communicate with OpenAI API");
    return errorResponse("Не удалось связаться с сервисом ИИ. Попробуйте позже.", 502);
  } finally {
    clearTimeout(timeout);
  }
}
