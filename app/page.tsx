"use client";

import { Children, isValidElement, useState } from "react";
import type { ReactNode, ReactElement } from "react";
import type { FormEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";


function repairMarkdownTables(markdown: string): string {
  const lines = markdown.split("\n");
  const output: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const next = lines[i + 1] ?? "";
    const isPipeLine = /^\s*\|.*\|\s*$/.test(line) && (line.match(/\|/g)?.length ?? 0) >= 3;
    const nextIsSeparator = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(next);

    if (isPipeLine && !nextIsSeparator) {
      const cells = line.split("|").map((cell) => cell.trim()).filter(Boolean);
      const looksLikeSeparator = cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
      if (!looksLikeSeparator && cells.length >= 3) {
        output.push("- " + cells.map((cell, index) => index === 0 ? "**" + cell + "**" : cell).join(" — "));
        continue;
      }
    }
    output.push(line);
  }

  return output.join("\n");
}

type Mode = "general" | "estimate" | "engineering" | "facade" | "business" | "documents";

type MarkdownElement = ReactElement<{ children?: ReactNode }>;

function getChildren(node: ReactNode): ReactNode[] {
  if (!isValidElement(node)) return [];
  return Children.toArray((node as MarkdownElement).props.children);
}

function getElementType(node: ReactNode): string | undefined {
  if (!isValidElement(node)) return undefined;
  const type = (node as MarkdownElement).type;
  return typeof type === "string" ? type : undefined;
}

function getPlainText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(getPlainText).join("");
  if (!isValidElement(node)) return "";
  return getChildren(node).map(getPlainText).join("");
}

function ResponsiveMarkdownTable({ children }: { children?: ReactNode }) {
  const sections = Children.toArray(children);
  const head = sections.find((section) => getElementType(section) === "thead");
  const body = sections.find((section) => getElementType(section) === "tbody");
  const headerRow = head ? getChildren(head).find((row) => getElementType(row) === "tr") : undefined;
  const headers = headerRow
    ? getChildren(headerRow).filter((cell) => ["th", "td"].includes(getElementType(cell) ?? "")).map((cell) => (cell as MarkdownElement).props.children)
    : [];
  const rows = body
    ? getChildren(body).filter((row) => getElementType(row) === "tr")
    : [];

  return (
    <>
      <div className="desktop-table-scroll">
        <table>{children}</table>
      </div>
      <div className="mobile-table-cards">
        {rows.map((row, rowIndex) => {
          const cells = getChildren(row).filter((cell) => ["th", "td"].includes(getElementType(cell) ?? ""));
          const values = cells.map((cell) => (cell as MarkdownElement).props.children);
          const nonEmpty = values.map((value) => getPlainText(value).trim());
          const firstLabel = (headers[0] ? getPlainText(headers[0]) : "").trim().toLowerCase();
          const firstValue = (nonEmpty[0] ?? "").trim().toLowerCase();
          const secondValue = (nonEmpty[1] ?? "").trim().toLowerCase();
          const remainingEmpty = nonEmpty.slice(2).every((value) => !value);
          const sectionNames = ["материалы", "работы"];
          const isMaterialsOrWorksRow =
            remainingEmpty &&
            firstLabel === "статья" &&
            ((sectionNames.includes(firstValue) && !secondValue) ||
              (!firstValue && sectionNames.includes(secondValue)));
          const onlyOneCellHasValue = nonEmpty.filter(Boolean).length === 1;
          const isSectionRow = isMaterialsOrWorksRow || (remainingEmpty && onlyOneCellHasValue);

          if (isSectionRow) {
            const title = isMaterialsOrWorksRow
              ? (firstValue ? values[0] : values[1])
              : values[nonEmpty.findIndex((value) => Boolean(value))];
            return <h4 className="mobile-table-section-heading" key={rowIndex}>{title}</h4>;
          }

          return (
            <section className="mobile-table-card" key={rowIndex}>
              {cells.map((cell, cellIndex) => {
                const value = (cell as MarkdownElement).props.children;
                if (!getPlainText(value).trim()) return null;
                return (
                  <div className="mobile-table-field" key={cellIndex}>
                    <span className="mobile-table-label">{headers[cellIndex] ?? `Поле ${cellIndex + 1}`}</span>
                    <div className="mobile-table-value">{value}</div>
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>
    </>
  );
}

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
            <button className="secondary-button" type="button" onClick={() => void sendMessage()}>Повторить запрос</button>
          </div>
        )}
        {reply && (
          <article className="answer" aria-live="polite">
            <div className="answer-heading">
              <span className="answer-dot" />
              <h3>Ответ помощника</h3>
            </div>
            <div className="markdown-content">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ table: ResponsiveMarkdownTable }}>{repairMarkdownTables(reply)}</ReactMarkdown>
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
