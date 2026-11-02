"use client";

import { useMemo, useState } from "react";
import { LEAD_STATUSES, leadStatusLabel, validateLeadDraft } from "@/lib/crm/lead";
import type { Lead, LeadDraft, LeadStatus } from "@/lib/crm/lead";

const empty: LeadDraft = { name: "", phone: "", channel: "Сайт", workType: "", address: "", notes: "" };
const fields: { key: keyof LeadDraft; label: string }[] = [
  { key: "name", label: "Имя" }, { key: "phone", label: "Телефон" },
  { key: "channel", label: "Источник" }, { key: "workType", label: "Вид работ" },
  { key: "address", label: "Адрес объекта" }, { key: "notes", label: "Комментарий" },
];

/** UI-only CRM prototype: records are ephemeral and never sent to a server. */
export default function LeadBoard() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [draft, setDraft] = useState<LeadDraft>(empty);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<LeadStatus | "all">("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState("");
  const filtered = useMemo(() => leads.filter(lead => {
    const text = [lead.name, lead.phone, lead.workType, lead.address].join(" ").toLocaleLowerCase("ru-RU");
    return (status === "all" || lead.status === status) && text.includes(search.trim().toLocaleLowerCase("ru-RU"));
  }), [leads, search, status]);
  const current = leads.find(lead => lead.id === selected);
  function addLead(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const checked = validateLeadDraft(draft);
    if (!checked.ok) { setError(checked.errors.join(" ")); return; }
    const now = new Date().toISOString();
    const lead: Lead = { ...checked.value, id: crypto.randomUUID(), status: "new", createdAt: now, updatedAt: now, nextContactAt: null };
    setLeads(previous => [lead, ...previous]);
    setSelected(lead.id);
    setDraft(empty);
    setError("");
  }
  function changeStatus(id: string, next: LeadStatus) {
    setLeads(previous => previous.map(lead => lead.id === id ? { ...lead, status: next, updatedAt: new Date().toISOString() } : lead));
  }
  return <section aria-label="CRM заявки" style={{ display: "grid", gap: 16, maxWidth: 1100, margin: "auto", padding: 16 }}>
    <h1>CRM — заявки клиентов</h1>
    <p role="status">Прототип. Данные хранятся только в памяти вкладки и исчезнут при обновлении страницы. Не вводите реальные персональные данные.</p>
    <form onSubmit={addLead} style={{ display: "grid", gap: 8 }}>
      <h2>Новая тестовая заявка</h2>
      {fields.map(field => <label key={field.key} style={{ display: "grid", gap: 4 }}>{field.label}
        <input maxLength={field.key === "notes" ? 2000 : 240} value={draft[field.key]} onChange={e => setDraft(prev => ({ ...prev, [field.key]: e.target.value }))} />
      </label>)}
      {error && <p role="alert">{error}</p>}
      <button type="submit">Добавить тестовую заявку</button>
    </form>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <label>Поиск <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Имя, телефон, адрес" /></label>
      <label>Статус <select value={status} onChange={e => setStatus(e.target.value as LeadStatus | "all")}>
        <option value="all">Все</option>
        {LEAD_STATUSES.map(item => <option key={item} value={item}>{leadStatusLabel(item)}</option>)}
      </select></label>
    </div>
    <p>Найдено заявок: {filtered.length}</p>
    <div style={{ overflowX: "auto" }}><table style={{ width: "100%", textAlign: "left" }}>
      <thead><tr><th>Клиент</th><th>Телефон</th><th>Работы</th><th>Статус</th><th>Действие</th></tr></thead>
      <tbody>{filtered.map(lead => <tr key={lead.id}>
        <td>{lead.name || "Не указано"}</td><td>{lead.phone || "Не указан"}</td><td>{lead.workType || "Не указано"}</td>
        <td><select aria-label={"Статус "+(lead.name || lead.id)} value={lead.status} onChange={e => changeStatus(lead.id, e.target.value as LeadStatus)}>{LEAD_STATUSES.map(item => <option key={item} value={item}>{leadStatusLabel(item)}</option>)}</select></td>
        <td><button type="button" onClick={() => setSelected(lead.id)}>Открыть</button></td>
      </tr>)}</tbody>
    </table></div>
    {current && <aside aria-label="Карточка заявки" style={{ border: "1px solid #888", padding: 16, borderRadius: 8 }}>
      <h2>Карточка: {current.name || "Без имени"}</h2>
      <p>Телефон: {current.phone || "Не указан"}</p><p>Источник: {current.channel}</p>
      <p>Адрес: {current.address || "Не указан"}</p><p>Вид работ: {current.workType || "Не указан"}</p>
      <p>Комментарий: {current.notes || "Нет"}</p>
      <p>Создана: {new Date(current.createdAt).toLocaleString("ru-RU")}</p>
      <button type="button" onClick={() => setSelected(null)}>Закрыть</button>
    </aside>}
  </section>;
}
