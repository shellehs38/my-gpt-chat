import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { activeModeDocument, appendModeReply, buildChatPayload, decodeWorkspace, emptyWorkspace, modeDocuments, modeMessages, pendingModeRequest, recordModeRequest, switchWorkspaceMode, type ChatPayload, type DocumentVersion, type Workspace } from "../lib/workspace-storage";
import { decodeSnapshot, hasWorkspaceContent, snapshotText } from "../lib/drive-workspace-contract";
import { parseEstimateDocument, updateEstimateCell, type EstimateTable } from "../lib/estimate";

function version(id: string, mode: DocumentVersion["mode"], content = id): DocumentVersion {
  return { id, mode, createdAt: "2026-10-23T00:00:00.000Z", prompt: id, document: parseEstimateDocument(content, id) };
}
function legacy(): Workspace {
  return { ...emptyWorkspace(), mode: "facade", facadeOptions: "both", draft: "Фасадный черновик", messages: [
    { id: "e-user", role: "user", content: "Посчитай бетон" }, { id: "e-reply", role: "assistant", content: "ОБЪЁМ БЕТОНА", documentId: "estimate" },
    { id: "f-user", role: "user", content: "Фасад с утеплением и без" }, { id: "f-reply", role: "assistant", content: "ФАСАДНАЯ СМЕТА", documentId: "facade" },
  ], documents: [version("estimate", "estimate", "ОБЪЁМ БЕТОНА"), version("facade", "facade", "ФАСАДНАЯ СМЕТА")], activeDocumentId: "facade" };
}
const payload = (mode: ChatPayload["mode"], message = "Вопрос"): ChatPayload => ({ mode, message, facadeOptions: "auto", history: [] });

test("old mixed-mode browser and cloud snapshots remain byte-identical while selectors isolate their content", () => {
  const original = legacy(); const raw = JSON.stringify(original);
  assert.equal(JSON.stringify(decodeWorkspace(raw)), raw);
  assert.deepEqual(modeMessages(original).map(m => m.id), ["f-user", "f-reply"]);
  assert.deepEqual(modeMessages(original, "estimate").map(m => m.id), ["e-user", "e-reply"]);
  const oldSnapshot = JSON.stringify({ schemaVersion: 1, operationId: "a1234567-1234-1234-1234-123456789012", parents: [], workspace: original });
  const decoded = snapshotText(decodeSnapshot(JSON.parse(oldSnapshot)));
  assert.equal(decoded, oldSnapshot);
  assert.equal(createHash("sha256").update(decoded).digest("hex"), createHash("sha256").update(oldSnapshot).digest("hex"));
  assert.equal(JSON.stringify(original), raw, "selectors must not migrate stored data during verification");
});

test("switching tabs retains each draft, selected version, retries and edited values without mixing model history", () => {
  let state = legacy(); state = recordModeRequest(state, payload("facade", "Повтори фасад"));
  const facadePayload = buildChatPayload(state, "Продолжи"); assert.equal(facadePayload.facadeOptions, "both");
  state = switchWorkspaceMode(state, "estimate");
  assert.equal(state.draft, ""); assert.equal(activeModeDocument(state)?.id, "estimate"); assert.equal(pendingModeRequest(state), undefined);
  assert.deepEqual(modeDocuments(state).map(d => d.id), ["estimate"]);
  const request = buildChatPayload(state, "Посчитай плиту");
  assert.equal(request.facadeOptions, "auto"); assert.doesNotMatch(JSON.stringify(request.history), /ФАСАД|Фасад/); assert.match(JSON.stringify(request.history), /БЕТОНА|бетон/);
  state = { ...state, draft: "Черновик расчёта плиты" };
  state = switchWorkspaceMode(state, "facade");
  assert.equal(state.draft, "Фасадный черновик"); assert.equal(activeModeDocument(state)?.id, "facade"); assert.equal(pendingModeRequest(state)?.message, "Повтори фасад");
  state = switchWorkspaceMode(state, "estimate"); assert.equal(state.draft, "Черновик расчёта плиты");
  assert.equal(JSON.stringify(decodeWorkspace(JSON.stringify(state))), JSON.stringify(state));
});

test("late answer updates its originating tab while preserving current draft, selected answer and pending retry", () => {
  let state = legacy(); const request = buildChatPayload(state, "Новая фасадная смета");
  state = recordModeRequest(state, request); state = switchWorkspaceMode(state, "estimate");
  state = { ...state, draft: "Новый расчёт" }; state = recordModeRequest(state, payload("estimate", "Неудачный расчёт"));
  state = appendModeReply(state, request, version("late-facade", "facade", "ПОЗДНИЙ ФАСАД"), "ПОЗДНИЙ ФАСАД", "late-user", "late-assistant");
  assert.equal(state.mode, "estimate"); assert.equal(state.draft, "Новый расчёт"); assert.equal(activeModeDocument(state)?.id, "estimate");
  assert.equal(pendingModeRequest(state)?.message, "Неудачный расчёт"); assert.doesNotMatch(JSON.stringify(buildChatPayload(state, "Продолжи").history), /ПОЗДНИЙ ФАСАД/);
  state = switchWorkspaceMode(state, "facade"); assert.equal(activeModeDocument(state)?.id, "late-facade"); assert.equal(pendingModeRequest(state), undefined);
  assert.match(JSON.stringify(buildChatPayload(state, "Продолжи").history), /ПОЗДНИЙ ФАСАД/);
});

test("an edited selected snapshot remains scoped to its mode and survives export/restore", () => {
  let state = legacy();
  const doc = version("editable", "estimate", "| Позиция | Количество | Цена | Сумма |\n| --- | --- | --- | --- |\n| Бетон | 2 | 100 | 200 |\n");
  const table = doc.document.blocks.find((b): b is EstimateTable => b.type === "table")!;
  doc.document = updateEstimateCell(doc.document, table.id, table.rows[0].id, 1, "3"); state.documents.push(doc);
  state = switchWorkspaceMode(state, "estimate"); state.activeDocumentId = doc.id;
  state = switchWorkspaceMode(state, "documents"); assert.equal(activeModeDocument(state), undefined);
  assert.equal(buildChatPayload(state, "Подготовь договор").history.length, 0);
  state = switchWorkspaceMode(state, "estimate"); assert.equal(activeModeDocument(state)?.id, doc.id);
  assert.match(JSON.stringify(buildChatPayload(state, "Продолжи").history), /Бетон.*3.*300,00/);
  const restored = decodeWorkspace(JSON.stringify(state)); assert.equal(activeModeDocument(restored)?.id, doc.id); assert.equal(restored.documents.length, 3);
});

test("orphan legacy messages stay in their original tab, and inactive drafts count as data for autosave", () => {
  let state = emptyWorkspace(); state.messages.push({ id: "orphan", role: "user", content: "Старый вопрос" });
  state = switchWorkspaceMode(state, "engineering"); assert.equal(modeMessages(state).length, 0);
  assert.equal(modeMessages(state, "general")[0].id, "orphan");
  let drafts = { ...emptyWorkspace(), draft: "Несохранённый вопрос" };
  drafts = switchWorkspaceMode(drafts, "documents"); assert.equal(drafts.draft, ""); assert.equal(hasWorkspaceContent(drafts), true);
});

test("invalid optional tab data is rejected without changing valid old format or dropping other tab content", () => {
  const state = legacy();
  for (const extra of [{ legacyMode: "admin" }, { modeState: { admin: { draft: "x", activeDocumentId: null } } }, { modeState: { estimate: { draft: "x", activeDocumentId: null, failedRequest: payload("facade") } } }, { modeState: [] }]) assert.throws(() => decodeWorkspace(JSON.stringify({ ...state, ...extra })));
  assert.equal(state.draft, "Фасадный черновик");
});

test("legacy cross-tab retry and an older selected answer survive switching through an unrelated third tab", () => {
  let state = legacy(); state.mode = "general";
  state.documents.push(version("facade-newest", "facade"));
  state.failedRequest = payload("estimate", "Незавершённый расчёт");
  state = switchWorkspaceMode(state, "documents");
  state = switchWorkspaceMode(state, "estimate"); assert.equal(pendingModeRequest(state)?.message, "Незавершённый расчёт");
  state = switchWorkspaceMode(state, "facade"); assert.equal(activeModeDocument(state)?.id, "facade");
});

test("an intentionally empty tab with other saved tabs round-trips exactly in browser and Drive", () => {
  const state = switchWorkspaceMode(legacy(), "documents");
  assert.equal(state.activeDocumentId, null); assert.equal(hasWorkspaceContent(state), true);
  const raw = JSON.stringify(state); assert.equal(JSON.stringify(decodeWorkspace(raw)), raw);
  const snapshot = { schemaVersion: 1 as const, operationId: "a1234567-1234-1234-1234-123456789012", parents: [], workspace: state };
  assert.equal(snapshotText(snapshot), JSON.stringify(snapshot));
});

test("document history preserves agreed amounts and genuine total prose without estimate recalculation", () => {
  const text = "## Договор\n| Работа | Количество | Цена | Сумма |\n| --- | --- | --- | --- |\n| Работа по соглашению | 2 | 100 | 195 |\n\n**Арифметический итог: 195 по соглашению сторон**";
  const request = payload("documents", "Подготовь договор");
  const doc = { ...version("contract", "documents"), calculation: "none" as const, document: parseEstimateDocument(text, "contract", false) };
  let state = switchWorkspaceMode(emptyWorkspace(), "documents");
  state = appendModeReply(state, request, doc, text, "contract-user", "contract-assistant");
  const history = buildChatPayload(state, "Уточни условия оплаты").history;
  assert.match(history.at(-1)!.content, /2 \| 100 \| 195/); assert.match(history.at(-1)!.content, /Арифметический итог: 195 по соглашению/);
  assert.doesNotMatch(history.at(-1)!.content, /200,00|Расчёт таблицы/);
  assert.equal(JSON.stringify(decodeWorkspace(JSON.stringify(state))), JSON.stringify(state));
});

test("revision requests keep full-estimate protection without forcing plain or partial calculations into full estimates", async () => {
  const { revisionRequest } = await import("../lib/assistant-modes");
  const { requiresFullEstimate, isEstimateRequest } = await import("../lib/server/chat");
  const table = "| Позиция | Количество | Цена | Сумма |\n| --- | --- | --- | --- |\n| Позиция | 2 | 100 | 200 |\n";
  const full = parseEstimateDocument("## Материалы\n" + table + "\n## Работы\n" + table, "full");
  assert.equal(requiresFullEstimate(payload("estimate", revisionRequest("estimate", full))), true);
  const partial = parseEstimateDocument("## Материалы\n" + table, "partial");
  const partialRequest = payload("estimate", revisionRequest("estimate", partial));
  assert.equal(isEstimateRequest(partialRequest), true); assert.equal(requiresFullEstimate(partialRequest), false);
  const volume = parseEstimateDocument("6 × 4 × 0,2 = 4,8 м³", "volume");
  const volumeRequest = payload("estimate", revisionRequest("estimate", volume, false));
  assert.equal(isEstimateRequest(volumeRequest), false); assert.equal(requiresFullEstimate(volumeRequest), false);
});
