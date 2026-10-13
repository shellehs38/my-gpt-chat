"use client";

import { Children, createContext, isValidElement, useContext, useState } from "react";
import type { ReactNode, ReactElement } from "react";
import type { FormEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";


type Mode = "general" | "estimate" | "engineering" | "facade" | "business" | "documents";

type MarkdownElement = ReactElement<{ children?: ReactNode }>;

type EstimateEdit = { item: string; field: string; value: string; original: string };
type EstimateEditContextValue = {
  editedValues: Record<string, string>;
  onEdit: (key: string, edit: EstimateEdit) => void;
};
const EstimateEditContext = createContext<EstimateEditContextValue>({
  editedValues: {},
  onEdit: () => {},
});

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

function ResponsiveMarkdownTable({ children, editedValues, onEdit }: { children?: ReactNode; editedValues: Record<string, string>; onEdit: (key: string, edit: EstimateEdit) => void }) {
  const sections = Children.toArray(children);
  const head = sections.find((section) => getElementType(section) === "thead");
  const body = sections.find((section) => getElementType(section) === "tbody");
  const headerRow = head ? getChildren(head).find((row) => getElementType(row) === "tr") : undefined;
  const headers = headerRow
    ? getChildren(headerRow).filter((cell) => ["th", "td"].includes(getElementType(cell) ?? "")).map((cell) => (cell as MarkdownElement).props.children)
    : [];
  const headerNames = headers.map((header) => getPlainText(header).trim());
  const normalized = headerNames.map((name) => name.toLowerCase());
  const quantityIndex = normalized.findIndex((name) => /^(количество|кол-во|количество,?\s*ед\.?|кол-во,?\s*ед\.?)$/.test(name));
  const priceIndex = normalized.findIndex((name) => /цена.*единиц|цена за ед|цена,?\s*руб/.test(name));
  const sumIndex = normalized.findIndex((name) => /^(сумма|сумма,?\s*руб\.?|стоимость,?\s*руб\.?)$/.test(name));
  const tableKey = headerNames.join("|");
  const cellKey = (rowIndex: number, cellIndex: number) => tableKey + ":" + rowIndex + ":" + cellIndex;
  const parseNumber = (value: string): number | null => {
    const cleaned = value.replace(/\s/g, "").replace(/руб\.?/gi, "").replace(",", ".");
    if (!cleaned || !/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
    const number = Number(cleaned);
    return Number.isFinite(number) ? number : null;
  };
  const formatNumber = (value: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value);
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

          const itemName = getPlainText(values[1] ?? values[0] ?? "Позиция");
          const rawQuantity = quantityIndex >= 0 ? (editedValues[cellKey(rowIndex, quantityIndex)] ?? getPlainText(values[quantityIndex] ?? "")) : "";
          const rawPrice = priceIndex >= 0 ? (editedValues[cellKey(rowIndex, priceIndex)] ?? getPlainText(values[priceIndex] ?? "")) : "";
          const quantity = parseNumber(rawQuantity);
          const price = parseNumber(rawPrice);
          const calculatedSum = quantity !== null && price !== null ? formatNumber(quantity * price) : "";

          return (
            <section className="mobile-table-card" key={rowIndex}>
              {cells.map((cell, cellIndex) => {
                const value = (cell as MarkdownElement).props.children;
                if (!getPlainText(value).trim()) return null;
                const label = headerNames[cellIndex] ?? `Поле ${cellIndex + 1}`;
                const key = cellKey(rowIndex, cellIndex);
                const isCalculatedSum = cellIndex === sumIndex && quantityIndex >= 0 && priceIndex >= 0;
                const displayedValue = isCalculatedSum
                  ? calculatedSum || "Заполните количество и цену"
                  : editedValues[key] ?? getPlainText(value);
                return (
                  <div className="mobile-table-field" key={cellIndex}>
                    <span className="mobile-table-label">{label}</span>
                    <div className="mobile-table-value">
                      <textarea
                        className="estimate-card-input"
                        aria-label={label}
                        value={displayedValue}
                        readOnly={isCalculatedSum}
                        inputMode={cellIndex === quantityIndex || cellIndex === priceIndex ? "decimal" : "text"}
                        rows={Math.min(4, Math.max(1, Math.ceil(displayedValue.length / 30)))}
                        onChange={(event) => {
                          const newValue = event.target.value;
                          onEdit(key, { item: itemName, field: label, value: newValue, original: getPlainText(value) });
                          if ((cellIndex === quantityIndex || cellIndex === priceIndex) && sumIndex >= 0 && quantityIndex >= 0 && priceIndex >= 0) {
                            const nextQuantityText = cellIndex === quantityIndex ? newValue : rawQuantity;
                            const nextPriceText = cellIndex === priceIndex ? newValue : rawPrice;
                            const nextQuantity = parseNumber(nextQuantityText);
                            const nextPrice = parseNumber(nextPriceText);
                            const nextSum = nextQuantity !== null && nextPrice !== null ? formatNumber(nextQuantity * nextPrice) : "";
                            const sumValue = nextSum || "Заполните количество и цену";
                            onEdit(cellKey(rowIndex, sumIndex), { item: itemName, field: headerNames[sumIndex] ?? "Сумма, руб.", value: sumValue, original: getPlainText(values[sumIndex] ?? "") });
                          }
                        }}
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

function MarkdownTable(props: { children?: ReactNode }) {
  const editContext = useContext(EstimateEditContext);
  return <ResponsiveMarkdownTable {...props} {...editContext} />;
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
  const [tableEdits, setTableEdits] = useState<Record<string, { item: string; field: string; value: string; original: string }>>({});
  const editedValues = Object.fromEntries(Object.entries(tableEdits).map(([key, edit]) => [key, edit.value]));

  async function sendMessage(event?: FormEvent, overridePrompt?: string) {
    event?.preventDefault();
    const promptToSend = overridePrompt ?? message.trim();
    if (!promptToSend || loading) return;
    if (!overridePrompt) setLastPrompt(promptToSend);

    setLoading(true);
    setReply("");
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
  const hasTable = /\|.+\|[\s\S]*?\n\s*\|?[-:| ]+\|/m.test(reply);
  function submitEditedEstimate() {
    const details = Object.values(tableEdits).map((edit) => "- " + edit.item + "; " + edit.field + ": " + (edit.value || "не указано")).join("\n");
    if (!details || !lastPrompt) return;
    void sendMessage(undefined, lastPrompt + "\n\nДанные, исправленные в карточках сметы:\n" + details + "\n\nПересчитай смету с учётом этих значений. Сохрани карточки материалов и работ. Не выдумывай неизвестные цены.");
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
              <EstimateEditContext.Provider value={{ editedValues, onEdit: (key, edit) => setTableEdits((prev) => ({ ...prev, [key]: edit })) }}><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ table: MarkdownTable }}>{reply}</ReactMarkdown></EstimateEditContext.Provider>
            </div>
            {hasTable && <div className="estimate-edit-actions"><p>Измени значения прямо в карточках, затем отправь их ассистенту на пересчёт.</p><button className="primary-button" type="button" disabled={loading || Object.keys(tableEdits).length === 0} onClick={submitEditedEstimate}>{loading ? "Пересчитываю…" : "Отправить данные ассистенту"}</button></div>}
            <button className="secondary-button" type="button" onClick={() => navigator.clipboard?.writeText(reply)}>Копировать ответ</button>
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
