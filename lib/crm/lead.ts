export const LEAD_STATUSES = ["new","contact_due","qualified","measurement","estimate","negotiation","won","lost"] as const;
export type LeadStatus = typeof LEAD_STATUSES[number];
export type LeadDraft = { name: string; phone: string; channel: string; workType: string; address: string; notes: string };
export type Lead = LeadDraft & { id: string; status: LeadStatus; createdAt: string; updatedAt: string; nextContactAt: string | null };
export type LeadValidation = { ok: true; value: LeadDraft } | { ok: false; errors: string[] };
const clean = (value: string) => value.trim().replace(/\s+/g, " ");
export function validateLeadDraft(value: unknown): LeadValidation {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, errors: ["Некорректная заявка."] };
  const input = value as Record<string, unknown>;
  const fields = ["name","phone","channel","workType","address","notes"] as const;
  const errors: string[] = [];
  const draft = {} as LeadDraft;
  for (const field of fields) {
    const raw = input[field];
    if (typeof raw !== "string") { errors.push("Поле "+field+" должно быть текстом."); continue; }
    const normalized = clean(raw);
    if (normalized.length > (field === "notes" ? 2000 : 240)) errors.push("Поле "+field+" слишком длинное.");
    draft[field] = normalized;
  }
  if (errors.length) return { ok: false, errors };
  if (!draft.phone && !draft.name) errors.push("Укажите имя или телефон.");
  if (draft.phone && !/^\+?[0-9 ()-]{7,25}$/.test(draft.phone)) errors.push("Проверьте номер телефона.");
  if (!draft.channel) errors.push("Укажите источник заявки.");
  return errors.length ? { ok: false, errors } : { ok: true, value: draft };
}
export function leadStatusLabel(status: LeadStatus): string {
  return ({new:"Новая",contact_due:"Связаться",qualified:"Уточнена",measurement:"Замер",estimate:"Смета",negotiation:"Согласование",won:"Договор",lost:"Отказ"} as const)[status];
}
