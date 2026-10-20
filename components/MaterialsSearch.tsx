"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import type { FirecrawlHit } from "@/lib/server/firecrawl";

type SearchResponse = { items?: FirecrawlHit[]; checkedAt?: string; error?: string; note?: string };

export default function MaterialsSearch() {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<FirecrawlHit[]>([]);
  const [checkedAt, setCheckedAt] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [enabled, setEnabled] = useState(true);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!enabled || busy || query.trim().length < 3) return;
    setBusy(true); setError(""); setNotice(""); setItems([]); setCheckedAt("");
    try {
      const response = await fetch("/api/firecrawl/search", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: query.trim() }), cache: "no-store",
      });
      const data = await response.json() as SearchResponse;
      if (!response.ok) throw new Error(data.error || "Поиск не выполнен.");
      if (!Array.isArray(data.items)) throw new Error("Ответ поиска имеет неверный формат.");
      setItems(data.items);
      setCheckedAt(typeof data.checkedAt === "string" ? data.checkedAt : "");
      setNotice(typeof data.note === "string" ? data.note : "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Ошибка поиска.");
    } finally { setBusy(false); }
  }

  return <section className="panel" aria-label="Поиск цен фасадных материалов">
    <h2>Firecrawl (материалы, цены и поставщики)</h2>
    <label style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, margin: "12px 0", fontSize: 14 }}>
      <input type="checkbox" checked={enabled} disabled={busy} onChange={(event) => { setEnabled(event.target.checked); if (!event.target.checked) { setItems([]); setCheckedAt(""); setNotice(""); setError(""); } }} style={{ width: 18, minHeight: 18 }} />
      Включить интернет-поиск Firecrawl
    </label>
    {!enabled && <p className="hint" role="status">Firecrawl выключен. Сметы, клиенты и расходы продолжают работать.</p>}
    {enabled && <>
    <p className="hint">Ищем сайты поставщиков по Иркутску. Никакие найденные цены не вносятся в смету автоматически.</p>
    <form onSubmit={onSubmit}>
      <label className="field-label" htmlFor="material-search-query">Какой материал ищем?</label>
      <input id="material-search-query" value={query} maxLength={120} autoComplete="off" onChange={(event) => setQuery(event.target.value)} placeholder="Например: фасадная минеральная вата 100 мм" />
      <button className="primary-button" style={{ marginTop: 12 }} type="submit" disabled={busy || query.trim().length < 3}>
        {busy ? "Ищу поставщиков…" : "Найти цены и поставщиков"}
      </button>
    </form>
    {error && <p className="error-box" role="alert">{error}</p>}
    {checkedAt && <div aria-live="polite" style={{ marginTop: 16, textAlign: "left" }}>
      <p className="hint">Дата поиска: {new Date(checkedAt).toLocaleString("ru-RU", { timeZone: "Asia/Irkutsk" })} (Иркутск).</p>
      {items.length === 0 ? <p>Подходящих открытых страниц не найдено. Уточните наименование материала.</p> : <ul style={{ paddingLeft: 22, lineHeight: 1.5 }}>
        {items.map((item) => <li key={item.url} style={{ marginBottom: 15 }}>
          <a href={item.url} rel="noopener noreferrer" target="_blank">{item.title}</a>
          {item.description && <p style={{ margin: "5px 0", overflowWrap: "anywhere" }}>{item.description}</p>}
        </li>)}
      </ul>}
      <p className="hint">{notice}</p>
    </div>}
    </>}
  </section>;
}
