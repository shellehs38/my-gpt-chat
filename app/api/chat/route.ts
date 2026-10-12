import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const { message } = await request.json();

    if (!message || typeof message !== "string") {
      return NextResponse.json(
        { error: "Введите сообщение" },
        { status: 400 }
      );
    }

    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: "В Vercel не задан OPENAI_API_KEY. Добавьте ключ в Environment Variables и выполните новое развертывание." },
        { status: 500 }
      );
    }

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        instructions:
          "Ты ИИ-помощник строительной компании ООО СВОИ ЛЮДИ в Иркутске. Помогай со строительными сметами, фасадами, материалами, коммерческими предложениями, договорами и управлением проектами. Не выдумывай цены и технические характеристики. Если данных недостаточно, задай уточняющие вопросы.",
        input: message,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      const apiMessage =
        typeof data?.error?.message === "string"
          ? data.error.message
          : "Сервис OpenAI отклонил запрос.";

      return NextResponse.json(
        {
          error: `OpenAI API (${response.status}): ${apiMessage}`,
        },
        { status: response.status }
      );
    }

    const reply =
      typeof data.output_text === "string" ? data.output_text.trim() : "";

    if (!reply) {
      return NextResponse.json(
        { error: "OpenAI вернул ответ без текста. Попробуйте задать вопрос ещё раз." },
        { status: 502 }
      );
    }

    return NextResponse.json({ reply });
  } catch {
    return NextResponse.json(
      { error: "Ошибка обработки сообщения на сервере. Проверьте журналы Vercel." },
      { status: 500 }
    );
  }
}
