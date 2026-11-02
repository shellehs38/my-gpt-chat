import "server-only";
import type { Lead, LeadDraft, LeadStatus } from "@/lib/crm/lead";

type DbLead = { id: string; name: string; phone: string; channel: string; work_type: string; address: string; notes: string; status: LeadStatus; created_at: string; updated_at: string; next_contact_at: string | null };
export class CrmStorageError extends Error { constructor(message: string, public status = 503) { super(message); } }
function configuration() {
  const url = process.env.CRM_SUPABASE_URL;
  const key = process.env.CRM_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !/^https:\/\/[a-z0-9.-]+\.supabase\.co\/?$/i.test(url) || !key) throw new CrmStorageError("CRM пока не подключена к отдельной базе Supabase.");
  return { url: url.replace(/\/$/, ""), key };
}
function leadFromDb(row: DbLead): Lead {
  return { id: row.id, name: row.name, phone: row.phone, channel: row.channel, workType: row.work_type, address: row.address, notes: row.notes, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at, nextContactAt: row.next_contact_at };
}
async function requestDb(path: string, method: string, body?: unknown, prefer?: string): Promise<unknown> {
  const { url, key } = configuration();
  const response = await fetch(url + "/rest/v1/crm_leads" + path, {
    method,
    headers: { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json", ...(prefer ? { Prefer: prefer } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    cache: "no-store",
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new CrmStorageError("CRM: операция с базой не подтверждена.", 502);
  return response.json();
}
export async function listLeads(): Promise<Lead[]> {
  const rows = await requestDb("?select=*&order=created_at.desc&limit=200", "GET");
  if (!Array.isArray(rows)) throw new CrmStorageError("CRM: некорректный ответ базы.", 502);
  return (rows as DbLead[]).map(leadFromDb);
}
export async function createLead(draft: LeadDraft, requestId: string): Promise<Lead> {
  const body = { name: draft.name, phone: draft.phone, channel: draft.channel, work_type: draft.workType, address: draft.address, notes: draft.notes, request_id: requestId };
  const rows = await requestDb("?on_conflict=request_id&select=*", "POST", body, "resolution=ignore-duplicates,return=representation");
  if (!Array.isArray(rows)) throw new CrmStorageError("CRM: запись не подтверждена.", 502);
  if (rows.length === 1) return leadFromDb(rows[0] as DbLead);
  const existing = await requestDb("?request_id=eq." + encodeURIComponent(requestId) + "&select=*&limit=1", "GET");
  if (!Array.isArray(existing) || existing.length !== 1) throw new CrmStorageError("CRM: не удалось подтвердить повторную запись.", 502);
  const record = existing[0] as DbLead;
  if ([record.name,record.phone,record.channel,record.work_type,record.address,record.notes].join("\u0000") !== [draft.name,draft.phone,draft.channel,draft.workType,draft.address,draft.notes].join("\u0000")) throw new CrmStorageError("Номер операции уже использован для другой заявки.", 409);
  return leadFromDb(record);
}
export async function updateLeadStatus(id: string, status: LeadStatus): Promise<Lead> {
  const rows = await requestDb("?id=eq." + encodeURIComponent(id) + "&select=*", "PATCH", { status, updated_at: new Date().toISOString() }, "return=representation");
  if (!Array.isArray(rows) || rows.length !== 1) throw new CrmStorageError("Заявка не найдена.", 404);
  return leadFromDb(rows[0] as DbLead);
}
