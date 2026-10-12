"use client";

import { FormEvent, useState } from "react";
import ReactMarkdown from "react-markdown";

type Mode = "general" | "estimate" | "engineering" | "facade" | "business" | "documents";

const modes: { id: Mode; label: string; description: string; prompt: string }[] = [
  { id: "general", label: "Общий помощник", description: "Дом, стройка и организация работ", prompt: "Опиши задачу, объект или вопрос по строительству." },
  { id: "estimate", label: "Смета и расчёты", description: "Материалы, работы, количество и стоимость", prompt: "Например: помоги составить смету. Сначала уточни недостающие исходные данные." },
  { id: "engineering", label: "Технологии и конструкции", description: "Фундаменты, стены, подпорные стены, кровля", prompt: "Опиши конструкцию и исходные данные. Укажи, какие сведения ещё необходимы для безопасной оценки." },
  { id: "facade", label: "Фасады", description: "Сайдинг, панели, утепление и подсистемы", prompt: "Опиши дом, площадь фасада, облицовку и необходимость утепления." },
  { id: "business", label: "Бизнес и продажи", description: "Клиенты, прибыль, планирование и закупки", prompt: "Опиши ситуацию в бизнесе или задачу по работе с клиентом." },
  { id: "documents", label: "Документы", description: "Коммерческие предложения, договоры и акты", prompt: "Укажи вид документа, стороны, объект, объём работ и известные условия." },
];

export default function Home() {
  const [message, setMessage] = useState("");
  const [reply, setReply] = useState("");
  const [mode, setMode] = useState<Mode>("general");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function sendMessage(event?: FormEvent) {
    event?.preventDefault();
    if (!message.trim() || loading) return;

    setLoading(true);
    setReply("");
    setError("");

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: message.trim(), mode }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Ошибка запроса");
      setReply(data.reply || "ИИ не вернул текст ответа.");
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : "Не удалось получить ответ.");
    } finally {
      setLoading(false);
    }
  }

  const selectedMode = modes.find((item) => item.id === mode) ?? modes[0];

  return (
    <main className="app-shell">
      <header className="hero">
        <div className="brand-mark" aria-hidden="true">СП</div>
        <div>
          <p className="eyebrow">СТРОИТЕЛЬНЫЙ ПОМОЩНИК</p>
          <h1>«СВОИ ЛЮДИ»</h1>
          <p className="subtitle">Помощник для строительного бизнеса в Иркутске</p>
        </div>
      </header>

      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>Выберите направление</h2>
            <p>Это помогает помощнику точнее учитывать задачу.</p>
          </div>
        </div>
        <div className="mode-grid">
          {modes.map((item) => (
            <button
              className={mode === item.id ? "mode-card selected" : "mode-card"}
              type="button"
              key={item.id}
              onClick={() => setMode(item.id)}
              aria-pressed={mode === item.id}
            >
              <span className="mode-title">{item.label}</span>
              <span className="mode-description">{item.description}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="panel chat-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">ТЕКУЩИЙ РЕЖИМ</p>
            <h2>{selectedMode.label}</h2>
            <p>{selectedMode.description}</p>
          </div>
        </div>

        <form onSubmit={sendMessage}>
          <label className="field-label" htmlFor="message">Опишите задачу</label>
          <textarea
            id="message"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder={selectedMode.prompt}
            rows={5}
            maxLength={10000}
          />
          <div className="form-footer">
            <span className="hint">{message.length}/10000 символов</span>
            <button className="primary-button" type="submit" disabled={loading || !message.trim()}>
              {loading ? "Готовлю ответ…" : "Отправить вопрос"}
            </button>
          </div>
        </form>

        {loading && <div className="status" role="status">Анализирую задачу и готовлю ответ…</div>}
        {error && (
          <div className="error-box" role="alert">
            <strong>Не удалось получить ответ</strong>
            <p>{error}</p>
            <button className="secondary-button" type="button" onClick={() => sendMessage()}>Повторить запрос</button>
          </div>
        )}
        {reply && (
          <article className="answer" aria-live="polite">
            <div className="answer-heading">
              <span className="answer-dot" />
              <h3>Ответ помощника</h3>
            </div>
            <div className="markdown-content">
              <ReactMarkdown>{reply}</ReactMarkdown>
            </div>
            <button className="secondary-button" type="button" onClick={() => navigator.clipboard?.writeText(reply)}>
              Копировать ответ
            </button>
          </article>
        )}
      </section>

      <footer className="footer">
        Проверяйте исходные данные, цены и технические требования перед выполнением работ.
        Расчёты несущих конструкций требуют проверки специалистом.
      </footer>
    </main>
  );
}
