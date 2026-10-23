import { serializeEstimateDocument } from "./estimate";
import type { EstimateDocument } from "./estimate";
import { MAX_HISTORY_MESSAGES, MAX_HISTORY_MESSAGE_LENGTH, MAX_HISTORY_BYTES } from "./chat-contract";
export type Mode = "general" | "estimate" | "engineering" | "facade" | "business" | "documents";
export type FacadeOptions = "auto" | "without" | "with" | "both";
export type ChatMessage = { id: string; role: "user" | "assistant"; content: string; documentId?: string; mode?: Mode };
export type ChatPayload = { message: string; mode: Mode; history: { role: "user" | "assistant"; content: string }[]; facadeOptions: FacadeOptions };
export type DocumentVersion = { id: string; createdAt: string; mode: Mode; prompt: string; document: EstimateDocument; calculation?: "estimate" | "none" };
export type ModeState = { draft: string; activeDocumentId: string | null; failedRequest?: ChatPayload };
export type Workspace = { schemaVersion: 1; mode: Mode; facadeOptions: FacadeOptions; draft: string; messages: ChatMessage[]; documents: DocumentVersion[]; activeDocumentId: string | null; failedRequest?: ChatPayload; legacyMode?: Mode; modeState?: Partial<Record<Mode, ModeState>> };
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
  if (value.documents.some(version => version.calculation !== undefined && !["estimate", "none"].includes(version.calculation))) throw new Error("Не удалось прочитать назначение документа. Данные не удалены.");
  if (value.legacyMode !== undefined && !modes.has(value.legacyMode) || value.messages.some(message => message.mode !== undefined && !modes.has(message.mode))) throw new Error("Не удалось прочитать направления диалога. Данные не удалены.");
  if (value.modeState !== undefined && (!value.modeState || typeof value.modeState !== "object" || Array.isArray(value.modeState) || Object.entries(value.modeState).some(([mode, state]) => !modes.has(mode) || !state || typeof state !== "object" || typeof state.draft !== "string" || state.draft.length > 10000 || state.activeDocumentId !== null && (typeof state.activeDocumentId !== "string" || state.activeDocumentId.length > 200) || state.failedRequest !== undefined && (!validPayload(state.failedRequest) || state.failedRequest.mode !== mode)))) throw new Error("Не удалось прочитать рабочие данные вкладок. Данные не удалены.");
  if (new Set(value.documents.map((version) => version.id)).size !== value.documents.length || new Set(value.documents.map((version) => version.document.id)).size !== value.documents.length || new Set(value.messages.map((message) => message.id)).size !== value.messages.length) throw new Error("В файле повторяются идентификаторы версий или сообщений. Текущий проект сохранён.");
  if (value.failedRequest && !validPayload(value.failedRequest)) delete value.failedRequest;
  // Preserve legacy checksum behavior, but an empty selected tab may intentionally have no active document.
  if (value.modeState === undefined && value.legacyMode === undefined) value.activeDocumentId = value.documents.some((version) => version.id === value.activeDocumentId) ? value.activeDocumentId : value.documents.at(-1)?.id ?? null;
  else if (value.activeDocumentId !== null && typeof value.activeDocumentId !== "string") throw new Error("Не удалось прочитать выбранный ответ. Данные не удалены.");
  return value;
}
function validPayload(value: ChatPayload): boolean {
  return Boolean(value && typeof value === "object" && typeof value.message === "string" && modes.has(value.mode) && options.has(value.facadeOptions) && Array.isArray(value.history) && value.history.every(item => item && typeof item === "object" && ["user", "assistant"].includes(item.role) && typeof item.content === "string"));
}
/** Load the browser copy; cloud synchronization is handled separately. */
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

/** Pure legacy inference: never rewrite an old cloud snapshot during decoding/checksum verification. */
export function messageMode(workspace: Workspace, index: number): Mode {
  const item = workspace.messages[index];
  if (item.mode) return item.mode;
  const documentMode = (message: ChatMessage) => workspace.documents.find(version => version.id === message.documentId)?.mode;
  const own = documentMode(item);
  if (own) return own;
  if (item.role === "user") {
    for (const next of workspace.messages.slice(index + 1)) {
      if (next.role === "user") break;
      const paired = next.mode ?? documentMode(next);
      if (paired) return paired;
    }
  }
  return workspace.legacyMode ?? workspace.mode;
}
export function modeMessages(workspace: Workspace, mode = workspace.mode): ChatMessage[] {
  return workspace.messages.filter((_, index) => messageMode(workspace, index) === mode);
}
export function modeDocuments(workspace: Workspace, mode = workspace.mode): DocumentVersion[] { return workspace.documents.filter(version => version.mode === mode); }
export function activeModeDocument(workspace: Workspace, mode = workspace.mode): DocumentVersion | undefined {
  const documents = modeDocuments(workspace, mode);
  const selected = mode === workspace.mode ? workspace.activeDocumentId : workspace.modeState?.[mode]?.activeDocumentId;
  return documents.find(version => version.id === selected) ?? documents.at(-1);
}
function stateForMode(workspace: Workspace, mode: Mode): ModeState {
  if (mode === workspace.mode) return { draft: workspace.draft, activeDocumentId: activeModeDocument(workspace, mode)?.id ?? null,
    failedRequest: workspace.failedRequest?.mode === mode ? workspace.failedRequest : workspace.modeState?.[mode]?.failedRequest };
  return workspace.modeState?.[mode] ?? { draft: "", activeDocumentId: activeModeDocument(workspace, mode)?.id ?? null, failedRequest: workspace.failedRequest?.mode === mode ? workspace.failedRequest : undefined };
}
function preservedModeStates(workspace: Workspace): Partial<Record<Mode, ModeState>> {
  const states = { ...workspace.modeState };
  // The old shared UI could leave a retry/selection belonging to another tab in the flat fields.
  const retry = workspace.failedRequest;
  if (retry && retry.mode !== workspace.mode && !states[retry.mode]?.failedRequest) states[retry.mode] = { ...stateForMode(workspace, retry.mode), failedRequest: retry };
  const selected = workspace.documents.find(version => version.id === workspace.activeDocumentId);
  if (selected && selected.mode !== workspace.mode && !states[selected.mode]?.activeDocumentId) states[selected.mode] = { ...stateForMode(workspace, selected.mode), ...states[selected.mode], activeDocumentId: selected.id };
  return states;
}
export function switchWorkspaceMode(workspace: Workspace, mode: Mode): Workspace {
  if (mode === workspace.mode) return workspace;
  const previous = stateForMode(workspace, workspace.mode);
  const modeState = { ...preservedModeStates(workspace), [workspace.mode]: previous };
  const next = modeState[mode] ?? stateForMode(workspace, mode);
  return { ...workspace, legacyMode: workspace.legacyMode ?? workspace.mode, modeState, mode,
    draft: next.draft, activeDocumentId: next.activeDocumentId, failedRequest: next.failedRequest };
}
export function pendingModeRequest(workspace: Workspace): ChatPayload | undefined { return stateForMode(workspace, workspace.mode).failedRequest; }
export function recordModeRequest(workspace: Workspace, payload: ChatPayload): Workspace {
  const state = { ...stateForMode(workspace, payload.mode), failedRequest: payload };
  return { ...workspace, legacyMode: workspace.legacyMode ?? workspace.mode, modeState: { ...preservedModeStates(workspace), [payload.mode]: state },
    ...(workspace.mode === payload.mode ? { failedRequest: payload } : {}) };
}
export function appendModeReply(workspace: Workspace, payload: ChatPayload, version: DocumentVersion, reply: string, userId: string, assistantId: string): Workspace {
  const previous = stateForMode(workspace, payload.mode);
  const state = { ...previous, draft: previous.draft.trim() === payload.message ? "" : previous.draft, activeDocumentId: version.id, failedRequest: undefined };
  return { ...workspace, legacyMode: workspace.legacyMode ?? workspace.mode, modeState: { ...preservedModeStates(workspace), [payload.mode]: state },
    messages: [...workspace.messages, { id: userId, role: "user", content: payload.message, mode: payload.mode }, { id: assistantId, role: "assistant", content: reply, documentId: version.id, mode: payload.mode }],
    documents: [...workspace.documents, version], ...(workspace.mode === payload.mode ? state : {}) };
}

/** Build context only from this tab, including its edited selected snapshot. */
export function buildChatPayload(workspace: Workspace, message: string): ChatPayload {
  const messages = modeMessages(workspace);
  const candidates: ChatPayload["history"] = messages.map((item) => {
    const version = workspace.documents.find((entry) => entry.id === item.documentId);
    return { role: item.role, content: version ? serializeEstimateDocument(version.document, version.calculation !== "none") : item.content };
  });
  const active = activeModeDocument(workspace);
  const lastAssistant = [...messages].reverse().find((item) => item.role === "assistant");
  if (active && active.id !== lastAssistant?.documentId) candidates.push({ role: "assistant", content: "Текущая открытая версия пользователя:\n" + serializeEstimateDocument(active.document, active.calculation !== "none") });
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
  return { message, mode: workspace.mode, facadeOptions: workspace.mode === "facade" ? workspace.facadeOptions : "auto", history };
}
