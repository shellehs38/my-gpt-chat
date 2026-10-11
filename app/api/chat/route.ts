
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
        { error: "Не настроен ключ OpenAI API" },
        { status: 500 }
      );
    }

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
            "Ты ИИ-помощник строительной компании ООО СВОИ ЛЮДИ в Иркутске. Помогай со строительными сметами, фасадами, материалами, коммерческими предложениями, договорами и управлением проектами. Не выдумывай цены и технические характеристики. Если данных недостаточно, задай уточняющие вопросы.",
          input: message,
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { error: "Не удалось получить ответ от ИИ" },
        { status: response.status }
      );
    }

    return NextResponse.json({
      reply:
        data.output_text || "Не удалось получить текст ответа",
    });
  } catch {
    return NextResponse.json(
      { error: "Ошибка обработки сообщения" },
      { status: 500 }
    );
  }
}
