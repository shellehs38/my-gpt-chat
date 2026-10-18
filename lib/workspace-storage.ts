import { serializeEstimateDocument } from "./estimate";
import type { EstimateDocument } from "./estimate";
import { MAX_HISTORY_MESSAGES, MAX_HISTORY_MESSAGE_LENGTH, MAX_HISTORY_BYTES } from "./chat-contract";
export type Mode = "general" | "estimate" | "engineering" | "facade" | "business" | "documents";
export type FacadeOptions = "auto" | "without" | "with" | "both";
export type ChatMessage = { id: string; role: "user" | "assistant"; content: string; documentId?: string };
export type ChatPayload = { message: string; mode: Mode; history: { role: "user" | "assistant"; content: string }[]; facadeOptions: FacadeOptions };
export type DocumentVersion = { id: string; createdAt: string; mode: Mode; prompt: string; document: EstimateDocument };
export type Workspace = { schemaVersion: 1; mode: Mode; facadeOptions: FacadeOptions; draft: string; messages: ChatMessage[]; documents: DocumentVersion[]; activeDocumentId: string | null; failedRequest?: ChatPayload };
export const MAX_WORKSPACE_BYTES = 5_000_000;
export const WORKSPACE_STORAGE_KEY = "svoi-lyudi.builder.workspace.v1";
export function emptyWorkspace(): Workspace { return { schemaVersion: 1, mode: "general", facadeOptions: "auto", draft: "", messages: [], documents: [], activeDocumentId: null }; }
const modes = new Set(["general", "estimate", "engineering", "facade", "business", "documents"]);
const options = new Set(["auto", "without", "with", "both"]);
function validDocument(value: unknown): value is EstimateDocument {
  if (!value || typeof value !== "object") return false;
  const doc = value as EstimateDocument;
  if (typeof doc.id !== "string" || doc.id.length > 200 || !Array.isArray(doc.blocks) || doc.blocks.length > 1000) return false;
  const ids = new Set<string>();
  const unique = (id: unknown): id is string => typeof id === "string" && id.length <= 1000 && !ids.has(id) && Boolean(ids.add(id));
  return doc.blocks.every((block) => block && unique(block.id) && (block.type === "markdown" ? typeof block.text === "string" && block.text.length <= 200000 : block.type === "table" && typeof block.variantId === "string" && typeof block.title === "string" && block.title.length <= 2000 && Array.isArray(block.headers) && block.headers.length <= 100 && block.headers.every((cell) => typeof cell === "string" && cell.length <= 2000) && Array.isArray(block.rows) && block.rows.length <= 10000 && block.rows.every((row) => row && unique(row.id) && Array.isArray(row.cells) && row.cells.length <= 100 && row.cells.every((cell) => typeof cell === "string" && cell.length <= 20000))));
}
export function decodeWorkspace(raw: string): Workspace {
  if (new TextEncoder().encode(raw).byteLength > MAX_WORKSPACE_BYTES) throw new Error("Сохранённый проект слишком велик. Сначала экспортируйте резервную копию.");
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Формат сохранённого проекта не поддерживается. Данные не удалены.");
  const value = parsed as Workspace;
  if (value.schemaVersion !== 1 || !modes.has(value.mode) || !options.has(value.facadeOptions) || typeof value.draft !== "string" || value.draft.length > 10000 || !Array.isArray(value.messages) || value.messages.length > 1000 || !Array.isArray(value.documents) || value.documents.length > 200) throw new Error("Формат сохранённого проекта не поддерживается. Данные не удалены.");
  if (!value.messages.every((message) => message && typeof message.id === "string" && ["user", "assistant"].includes(message.role) && typeof message.content === "string" && message.content.length <= 200000) || !value.documents.every((version) => version && typeof version.id === "string" && typeof version.createdAt === "string" && typeof version.prompt === "string" && modes.has(version.mode) && validDocument(version.document))) throw new Error("Не удалось прочитать сохранённый проект. Данные не удалены.");
  if (new Set(value.documents.map((version) => version.id)).size !== value.documents.length || new Set(value.documents.map((version) => version.document.id)).size !== value.documents.length || new Set(value.messages.map((message) => message.id)).size !== value.messages.length) throw new Error("В файле повторяются идентификаторы версий или сообщений. Текущий проект сохранён.");
  if (value.failedRequest && (typeof value.failedRequest.message !== "string" || !modes.has(value.failedRequest.mode) || !options.has(value.failedRequest.facadeOptions) || !Array.isArray(value.failedRequest.history) || !value.failedRequest.history.every((item) => item && typeof item === "object" && ["user", "assistant"].includes(item.role) && typeof item.content === "string"))) delete value.failedRequest;
  value.activeDocumentId = value.documents.some((version) => version.id === value.activeDocumentId) ? value.activeDocumentId : value.documents.at(-1)?.id ?? null;
  return value;
}
/** Only local browser storage; never promises cloud synchronisation. */
export function loadWorkspace(storage: Pick<Storage, "getItem">): Workspace {
  const raw = storage.getItem(WORKSPACE_STORAGE_KEY);
  return raw ? decodeWorkspace(raw) : emptyWorkspace();
}
export function saveWorkspace(storage: Pick<Storage, "setItem">, workspace: Workspace): void {
  const raw = JSON.stringify(workspace);
  // Never overwrite a good backup with a project this version cannot restore.
  decodeWorkspace(raw);
  storage.setItem(WORKSPACE_STORAGE_KEY, raw);
}

/** Build context from the edited document, including a selected snapshot not linked to a chat turn. */
export function buildChatPayload(workspace: Workspace, message: string): ChatPayload {
  const candidates: ChatPayload["history"] = workspace.messages.map((item) => {
    const version = workspace.documents.find((entry) => entry.id === item.documentId);
    return { role: item.role, content: version ? serializeEstimateDocument(version.document) : item.content };
  });
  const active = workspace.documents.find((entry) => entry.id === workspace.activeDocumentId);
  const lastAssistant = [...workspace.messages].reverse().find((item) => item.role === "assistant");
  if (active && active.id !== lastAssistant?.documentId) candidates.push({ role: "assistant", content: "Текущая открытая версия пользователя:\n" + serializeEstimateDocument(active.document) });
  const history: ChatPayload["history"] = [];
  const suffix = "\n[Предыдущий ответ сокращён по лимиту контекста.]";
  let used = 0;
  for (const item of candidates.slice(-MAX_HISTORY_MESSAGES).reverse()) {
    const content = item.content.length > MAX_HISTORY_MESSAGE_LENGTH ? item.content.slice(0, MAX_HISTORY_MESSAGE_LENGTH - suffix.length) + suffix : item.content;
    const next = { role: item.role, content };
    const size = new TextEncoder().encode(JSON.stringify(next)).byteLength;
    if (used + size > MAX_HISTORY_BYTES) break;
    history.unshift(next); used += size;
  }
  return { message, mode: workspace.mode, facadeOptions: workspace.facadeOptions, history };
}
