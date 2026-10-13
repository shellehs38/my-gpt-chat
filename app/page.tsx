"use client";

import { Children, isValidElement, useId, useState } from "react";
import type { ReactNode, ReactElement } from "react";
import type { FormEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";


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

function ResponsiveMarkdownTable({
  children,
  editedValues,
  onEdit,
}: {
  children?: ReactNode;
  editedValues: Record<string, string>;
  onEdit: (key: string, edit: { table: string; item: string; field: string; value: string; original: string }) => void;
}) {
  const tableId = useId();
  const sections = Children.toArray(children);
  const head = sections.find((section) => getElementType(section) === "thead");
  const body = sections.find((section) => getElementType(section) === "tbody");
  const headerRow = head ? getChildren(head).find((row) => getElementType(row) === "tr") : undefined;
  const headers = headerRow
    ? getChildren(headerRow).filter((cell) => ["th", "td"].includes(getElementType(cell) ?? "")).map((cell) => (cell as MarkdownElement).props.children)
    : [];
  const rows = body ? getChildren(body).filter((row) => getElementType(row) === "tr") : [];
  const tableTitle = rows.map((row) => getChildren(row).map((cell) => getPlainText((cell as MarkdownElement).props.children)).join(" ")).join(" ");

  return (
    <>
      <div className="desktop-table-scroll">
        <table>{children}</table>
      </div>
      <div className="mobile-table-cards">
        {rows.map((row, rowIndex) => {
          const cells = getChildren(row).filter((cell) => ["th", "td"].includes(getElementType(cell) ?? ""));
          const values = cells.map((cell) => (cell as MarkdownElement).props.children);
          const plainValues = values.map((value) => getPlainText(value).trim());
          const firstLabel = (headers[0] ? getPlainText(headers[0]) : "").trim().toLowerCase();
          const firstValue = (plainValues[0] ?? "").toLowerCase();
          const secondValue = (plainValues[1] ?? "").toLowerCase();
          const remainingEmpty = plainValues.slice(2).every((value) => !value);
          const sectionNames = ["материалы", "работы"];
          const isMaterialsOrWorksRow =
            remainingEmpty &&
            firstLabel === "статья" &&
            ((sectionNames.includes(firstValue) && !secondValue) ||
              (!firstValue && sectionNames.includes(secondValue)));
          const onlyOneCellHasValue = plainValues.filter(Boolean).length === 1;
          const isSectionRow = isMaterialsOrWorksRow || (remainingEmpty && onlyOneCellHasValue);

          if (isSectionRow) {
            const title = isMaterialsOrWorksRow
              ? (firstValue ? values[0] : values[1])
              : values[plainValues.findIndex(Boolean)];
            return <h4 className="mobile-table-section-heading" key={rowIndex}>{title}</h4>;
          }

          const itemName = plainValues.find((value, index) => {
            const header = getPlainText(headers[index] ?? "").toLowerCase();
            return header.includes("наимен") || header.includes("работ") || header.includes("материал");
          }) || plainValues[0] || `Строка ${rowIndex + 1}`;

          return (
            <section className="mobile-table-card" key={rowIndex}>
              {cells.map((cell, cellIndex) => {
                const original = plainValues[cellIndex] ?? "";
                if (!original && !getPlainText(headers[cellIndex] ?? "").trim()) return null;
                const field = getPlainText(headers[cellIndex] ?? `Поле ${cellIndex + 1}`).trim();
                const key = `${tableId}:${rowIndex}:${cellIndex}`;
                const value = editedValues[key] ?? original;
                const isLong = value.length > 38;
                return (
                  <div className="mobile-table-field" key={cellIndex}>
                    <label className="mobile-table-label" htmlFor={key}>{field}</label>
                    <div className="mobile-table-value">
                      <textarea
                        id={key}
                        className="editable-table-value"
                        aria-label={`${itemName}: ${field}`}
                        value={value}
                        rows={isLong ? Math.min(4, Math.max(2, Math.ceil(value.length / 34))) : 1}
                        onChange={(event) => onEdit(key, {
                          table: tableTitle.slice(0, 90),
                          item: itemName,
                          field,
                          value: event.target.value,
                          original,
                        })}
                      />
                    </div>
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
  const [lastPrompt, setLastPrompt] = useState("");
  const [tableEdits, setTableEdits] = useState<Record<string, { table: string; item: string; field: string; value: string; original: string }>>({});
  const editedValues = Object.fromEntries(Object.entries(tableEdits).map(([key, edit]) => [key, edit.value]));

  async function sendMessage(event?: FormEvent, overridePrompt?: string, preserveReply = false) {
    event?.preventDefault();
    const promptToSend = overridePrompt ?? message.trim();
    if (!promptToSend || loading) return;

    if (!overridePrompt) setLastPrompt(promptToSend);
    setLoading(true);
    if (!preserveReply) setReply("");
    setError("");

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: promptToSend, mode }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Ошибка запроса");
      setReply(data.reply || "ИИ не вернул текст ответа.");
      setTableEdits({});
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : "Не удалось получить ответ.");
    } finally {
      setLoading(false);
    }
  }

  const selectedMode = modes.find((item) => item.id === mode) ?? modes[0];
  const hasMarkdownTable = /\\|.+\\|[\\s\\S]*?\\n\\s*\\|?[-:| ]+\\|/m.test(reply);
  const MarkdownTable = (props: { children?: ReactNode }) => (
    <ResponsiveMarkdownTable {...props} editedValues={editedValues} onEdit={(key, edit) => {
      setTableEdits((previous) => {
        const next = { ...previous };
        if (edit.value === edit.original) delete next[key];
        else next[key] = edit;
        return next;
      });
    }} />
  );
  function recalculateWithEdits() {
    const changes = Object.values(tableEdits);
    if (!changes.length || !lastPrompt) return;
    const details = changes.map((edit) => `- ${edit.item} — поле «${edit.field}»: ${edit.value || "не указано"}`).join("\\n");
    const prompt = lastPrompt + "\\n\\nДанные, которые я изменил непосредственно в таблицах сметы:\\n" + details +
      "\\n\\nПересчитай смету с учётом этих данных. Сохрани отдельные таблицы «Материалы» и «Работы» и карточное отображение. Не задавай повторно вопросы о данных, которые я уже внёс; неизвестные значения отметь отдельно.";
    void sendMessage(undefined, prompt, true);
  }

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
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ table: MarkdownTable }}>{reply}</ReactMarkdown>
            </div>
            {hasMarkdownTable && (
              <div className="table-edit-actions">
                <p className="hint">Нажми на значение в карточке, чтобы изменить его. Можно заполнить количество, цену, толщину, тип материала и другие исходные данные.</p>
                <button className="primary-button" type="button" disabled={loading || Object.keys(tableEdits).length === 0} onClick={recalculateWithEdits}>
                  {loading ? "Пересчитываю…" : "Пересчитать по введённым данным"}
                </button>
              </div>
            )}
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
