import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateEstimateDocument, multiplyMoney, parseEstimateDocument,
  serializeEstimateDocument, updateEstimateCell, type EstimateTable,
} from "../lib/estimate";
import { buildChatPayload, decodeWorkspace, emptyWorkspace, loadWorkspace, saveWorkspace, WORKSPACE_STORAGE_KEY } from "../lib/workspace-storage";
import { MAX_HISTORY_MESSAGE_LENGTH } from "../lib/chat-contract";

const tables = (text: string) => parseEstimateDocument(text, "independent-review").blocks.filter((block): block is EstimateTable => block.type === "table");
const header = "| № | Наименование | Ед. изм. | Количество | Цена за единицу, руб. | Сумма, руб. | Примечание |\n| --- | --- | --- | --- | --- | --- | --- |";
const variant = (name: string) => `## ${name}\n### Материалы\n${header}\n| 1 | Кронштейн | шт. | 10 | 100 | 99999 | |\n| | Итого материалов | | | | 99999 | |`;

test("independent review: identical variants have independent editable records and exports", () => {
  const doc = parseEstimateDocument(`${variant("Вариант — без утепления")}\n\n${variant("Вариант — с утеплением")}`, "review-variants");
  const original = doc.blocks.filter((block): block is EstimateTable => block.type === "table");
  assert.equal(original.length, 2);
  assert.notEqual(original[0].variantId, original[1].variantId);
  assert.notEqual(original[0].rows[0].id, original[1].rows[0].id);
  const edited = updateEstimateCell(doc, original[0].id, original[0].rows[0].id, 3, "2");
  const result = calculateEstimateDocument(edited);
  assert.deepEqual(result.tables.map((table) => table.knownTotalKopecks), ["20000", "100000"]);
  const exported = serializeEstimateDocument(edited);
  assert.match(exported, /Кронштейн \| шт\. \| 2 \| 100 \| 200,00/);
  assert.match(exported, /Кронштейн \| шт\. \| 10 \| 100 \| 1 000,00/);
  assert.doesNotMatch(exported, /99999/);
  assert.deepEqual(calculateEstimateDocument(parseEstimateDocument(exported)).tables.map((table) => table.knownTotalKopecks), ["20000", "100000"]);
});

test("independent review: exact decimal arithmetic, very large values, and unknowns", () => {
  assert.equal(multiplyMoney("0,1", "0,2"), "2");
  assert.equal(multiplyMoney("0,005", "1"), "1");
  assert.equal(multiplyMoney("99999999999999", "99999999999999"), "999999999999980000000000000100");
  for (const invalid of ["", "требует уточнения", "-1", "1e9", "100 USD", "1,2,3"]) assert.equal(multiplyMoney(invalid, "100"), null);
});

test("independent review: subtotal rows are excluded and missing prices cannot produce a full total", () => {
  const source = `${header}\n| 1 | Панель | м² | 0,1 | 0,2 | 100 | |\n| 2 | Профиль | пог. м | 3 | | 300 | |\n| | **Итого материалов** | | | | 400 | |\n| | Всего | | | | 400 | |`;
  const doc = parseEstimateDocument(source);
  const result = calculateEstimateDocument(doc).tables[0];
  assert.equal(result.knownTotalKopecks, "2");
  assert.equal(result.complete, false);
  assert.deepEqual(result.rows.map((row) => row.kind), ["item", "item", "total", "total"]);
  const exported = serializeEstimateDocument(doc);
  assert.match(exported, /Не рассчитано/);
  assert.match(exported, /Полный итог не определён/);
  assert.match(exported, /0,02 \(известная часть; неполно\)/);
  assert.doesNotMatch(exported, /\| 400 \|/);
});

test("independent review: headings and tables in fenced examples are not editable estimate rows", () => {
  const source = `\`\`\`md\n${variant("Вариант-пример")}\n\`\`\`\n\n${variant("Вариант рабочий")}`;
  assert.equal(tables(source).length, 1);
});

test("independent review: drafts, edited documents, and failed requests survive local save", () => {
  const state = emptyWorkspace();
  const doc = parseEstimateDocument(variant("Вариант рабочий"), "review-save");
  const table = doc.blocks.find((block): block is EstimateTable => block.type === "table")!;
  state.draft = "Теперь площадь 200 м²";
  state.documents.push({ id: "v1", createdAt: "2026-10-18T00:00:00.000Z", mode: "estimate", prompt: "Первый объект", document: updateEstimateCell(doc, table.id, table.rows[0].id, 3, "2") });
  state.activeDocumentId = "v1";
  state.failedRequest = { message: state.draft, mode: "estimate", facadeOptions: "both", history: [{ role: "user", content: "Первый объект" }] };
  const memory = new Map<string, string>();
  const storage = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, value); } };
  saveWorkspace(storage, state);
  const restored = loadWorkspace(storage);
  assert.deepEqual(restored, state);
  assert.equal(calculateEstimateDocument(restored.documents[0].document).tables[0].knownTotalKopecks, "20000");
  memory.set(WORKSPACE_STORAGE_KEY, "{broken");
  assert.throws(() => loadWorkspace(storage));
  assert.equal(memory.get(WORKSPACE_STORAGE_KEY), "{broken");
  assert.throws(() => decodeWorkspace('{"schemaVersion":2}'));
});

test("independent review: truncated context stays within API limits and active snapshot edits are included", () => {
  const state = emptyWorkspace();
  state.mode = "facade";
  state.messages = [{ id: "u", role: "user", content: "Фасад 100 м²" }, { id: "a", role: "assistant", content: "я".repeat(MAX_HISTORY_MESSAGE_LENGTH + 100) }];
  const doc = parseEstimateDocument(variant("Вариант сохранённый"), "snapshot");
  const table = doc.blocks.find((block): block is EstimateTable => block.type === "table")!;
  state.documents = [{ id: "snapshot", createdAt: "2026-10-18T00:00:00.000Z", mode: "facade", prompt: "Фасад 100 м²", document: updateEstimateCell(doc, table.id, table.rows[0].id, 3, "7") }];
  state.activeDocumentId = "snapshot";
  const payload = buildChatPayload(state, "Теперь площадь 200 м²");
  assert.ok(payload.history.every((item) => item.content.length <= MAX_HISTORY_MESSAGE_LENGTH));
  assert.ok(payload.history.some((item) => item.content.includes("[Предыдущий ответ сокращён")));
  assert.match(payload.history.at(-1)!.content, /Кронштейн \| шт\. \| 7 \| 100 \| 700,00/);
});

test("independent review: a premature overall total cannot hide a later unpriced item", () => {
  const doc = parseEstimateDocument(`${header}\n| 1 | Работа | м² | 2 | 50 | 100 | |\n| | Всего | | | | 100 | |\n| 2 | Леса | | | | | Уточнить |`);
  const result = calculateEstimateDocument(doc).tables[0];
  assert.equal(result.complete, false);
  assert.equal(result.rows[1].complete, false);
  assert.match(serializeEstimateDocument(doc), /Всего(?: \| {1,2}){4}100,00 \(известная часть; неполно\)/);
});
