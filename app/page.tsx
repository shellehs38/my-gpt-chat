
"use client";

import { useState } from "react";

export default function Home() {
  const [message, setMessage] = useState("");
  const [reply, setReply] = useState("");
  const [loading, setLoading] = useState(false);

  async function sendMessage() {
    if (!message.trim() || loading) return;

    setLoading(true);
    setReply("");

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Ошибка запроса");
      }

      setReply(data.reply || "ИИ не вернул текст ответа");
    } catch (error: unknown) {
      setReply(
        error instanceof Error
          ? error.message
          : "Не удалось получить ответ"
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main
      style={{
        maxWidth: "800px",
        margin: "0 auto",
        padding: "24px",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <h1>ИИ-помощник «СВОИ ЛЮДИ»</h1>

      <p>Помощник для строительного бизнеса.</p>

      <section>
        <h2>Чем я могу помочь?</h2>
        <ul>
          <li>Расчёт строительных смет</li>
          <li>Фасадные технологии и материалы</li>
          <li>Подготовка коммерческих предложений</li>
          <li>Договоры и строительные документы</li>
          <li>Управление строительными проектами</li>
        </ul>
      </section>

      <section>
        <h2>Задайте вопрос помощнику</h2>

        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Например: составь смету на вентилируемый фасад"
          rows={5}
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: "12px",
            fontSize: "16px",
          }}
        />

        <button
          onClick={sendMessage}
          disabled={loading || !message.trim()}
          style={{
            marginTop: "12px",
            padding: "12px 20px",
            fontSize: "16px",
          }}
        >
          {loading ? "Думаю..." : "Отправить вопрос"}
        </button>

        {reply && (
          <section
            style={{
              marginTop: "24px",
              padding: "16px",
              background: "#f2f2f2",
              color: "#111",
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
            }}
          >
            {reply}
          </section>
        )}
      </section>
    </main>
  );
}
