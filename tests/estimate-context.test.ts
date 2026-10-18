import test from "node:test";
import assert from "node:assert/strict";
import { buildChatPayload, decodeWorkspace, emptyWorkspace } from "../lib/workspace-storage";
import { calculateEstimateDocument, parseEstimateDocument, serializeEstimateDocument, splitMarkdownRow, updateEstimateCell, type EstimateTable } from "../lib/estimate";
import { MAX_HISTORY_MESSAGE_LENGTH, MAX_HISTORY_MESSAGES, MAX_HISTORY_BYTES } from "../lib/chat-contract";
const sample = "## Вариант без утепления\n**Материалы:**\n| Позиция | Ед. изм. | Кол-во | Цена, руб. | Сумма, руб. | Примечание |\n| --- | --- | --- | --- | --- | --- |\n| Панель | м² | 10 | 0,10 | 9000 | Сохранить примечание |\n| Итого | | | | 9000 | |\n\n**Общая стоимость:** 9000 руб.";
test("ordinary follow-up includes an edited selected snapshot and bounded context", () => {
  const workspace = emptyWorkspace();
  workspace.messages = [{ id: "user", role: "user", content: "Первый объект" }, { id: "assistant", role: "assistant", content: sample, documentId: "original" }];
  const original = parseEstimateDocument(sample, "original");
  const snapshot = parseEstimateDocument(sample, "snapshot");
  const table = snapshot.blocks.find((block): block is EstimateTable => block.type === "table")!;
  workspace.documents = [{ id: "original", createdAt: "today", mode: "estimate", prompt: "Объект", document: original }, { id: "snapshot", createdAt: "today", mode: "estimate", prompt: "Объект", document: updateEstimateCell(snapshot, table.id, table.rows[0].id, 2, "2") }];
  workspace.activeDocumentId = "snapshot";
  const payload = buildChatPayload(workspace, "Теперь площадь 200 м²");
  assert.match(payload.history.at(-1)!.content, /Панель \| м² \| 2 \| 0,10 \| 0,20/);
  assert.match(payload.history.at(-1)!.content, /Сохранить примечание/);
  assert.match(payload.history.at(-1)!.content, /не пересчитанный итог/);
  workspace.documents = [];
  workspace.messages = Array.from({ length: 30 }, (_, index) => ({ id: String(index), role: index % 2 ? "assistant" as const : "user" as const, content: "ж".repeat(50000) }));
  const bounded = buildChatPayload(workspace, "Следующий вопрос").history;
  assert.ok(bounded.length <= MAX_HISTORY_MESSAGES);
  assert.ok(bounded.every((message) => message.content.length <= MAX_HISTORY_MESSAGE_LENGTH));
  assert.ok(new TextEncoder().encode(bounded.map((message) => JSON.stringify(message)).join("")).byteLength <= MAX_HISTORY_BYTES);
});
test("overall total before an unpriced later row cannot look complete", () => {
  const document = parseEstimateDocument(sample.replace("\n\n**Общая", "\n| Леса | м² | 10 | | | Нужно уточнить |\n\n**Общая"));
  const table = calculateEstimateDocument(document).tables[0];
  assert.equal(table.complete, false);
  assert.equal(table.rows.find((row) => row.kind === "total")!.complete, false);
  assert.match(serializeEstimateDocument(document), /1,00 \(известная часть; неполно\)/);
});
test("Markdown escapes and inline code pipes preserve cell boundaries, generated summaries remain singular", () => {
  assert.deepEqual(splitMarkdownRow("| A\\|B | `x|y` | C |"), ["A\\|B", "`x|y`", "C"]);
  const document = parseEstimateDocument(sample);
  const first = serializeEstimateDocument(document);
  const second = serializeEstimateDocument(parseEstimateDocument(first));
  assert.equal((second.match(/\*\*Арифметический итог:/g) ?? []).length, 1);
  assert.match(second, /Сохранить примечание/);
  assert.equal(document.blocks.find((block): block is EstimateTable => block.type === "table")!.title, "Материалы");
});
test("backup validation rejects repeated record identities and leaves valid saved work usable when retry is corrupt", () => {
  const workspace = emptyWorkspace();
  workspace.documents = [{ id: "original", createdAt: "today", mode: "estimate", prompt: "Объект", document: parseEstimateDocument(sample, "source") }];
  workspace.activeDocumentId = "original";
  (workspace as unknown as { failedRequest: unknown }).failedRequest = { message: "test", mode: "estimate", facadeOptions: "both", history: [null] };
  assert.equal(decodeWorkspace(JSON.stringify(workspace)).failedRequest, undefined);
  for (const raw of ["null", "[]", "5"]) assert.throws(() => decodeWorkspace(raw), /Формат/);
  const duplicated = JSON.parse(JSON.stringify(workspace));
  const table = duplicated.documents[0].document.blocks.find((block: { type: string }) => block.type === "table");
  table.rows.push(table.rows[0]);
  assert.throws(() => decodeWorkspace(JSON.stringify(duplicated)), /прочитать/);
});

test("save refuses a project exceeding the same UTF-8 restore limit without overwriting the backup", async () => {
  const { saveWorkspace, WORKSPACE_STORAGE_KEY, MAX_WORKSPACE_BYTES } = await import("../lib/workspace-storage");
  const saved = new Map([[WORKSPACE_STORAGE_KEY, JSON.stringify(emptyWorkspace())]]);
  const storage = { setItem: (key: string, value: string) => { saved.set(key, value); } };
  const workspace = emptyWorkspace();
  workspace.draft = "ж".repeat(Math.ceil(MAX_WORKSPACE_BYTES / 2));
  assert.throws(() => saveWorkspace(storage, workspace), /слишком велик/);
  assert.equal(saved.get(WORKSPACE_STORAGE_KEY), JSON.stringify(emptyWorkspace()));
});
