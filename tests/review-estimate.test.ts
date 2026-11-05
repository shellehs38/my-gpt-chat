import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateEstimateDocument, formatEstimateProse, multiplyMoney, parseEstimateDocument,
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

test("confirmed work, material and direct-cost rates survive recalculation and repeated export", () => {
  const source = `## Материалы
${header}
| 1 | Панель | м² | 2 | 5000 | 99999 | |

## Работы
${header}
| 1 | Монтаж | м² | 2 | 5000 | 99999 | |
| 2 | Доставка | рейс | 1 | 5000 | 99999 | |
| 3 | Комплект под ключ | компл. | 1 | 5000 | 99999 | Нет разбивки |
| 4 | Уже конечная ставка | шт. | 1 | 5000 | 99999 | Цена для клиента |
| 5 | Поставка и монтаж панелей | компл. | 1 | 5000 | 99999 | Требует разбивки |
| 6 | Затраты на транспорт | рейс | 1 | 5000 | 99999 | |
| 7 | Монтаж ограждений | шт. | 1 | 5000 | 99999 | Ставка подтверждена владельцем |
| 8 | Комплектование объекта | шт. | 1 | 5000 | 99999 | |
| | Итого работ | | | | 99999 | |`;
  const exported = serializeEstimateDocument(parseEstimateDocument(source, "pricing"));
  const exportedTables = tables(exported);
  assert.equal(exportedTables.length, 2);
  for (const table of exportedTables) {
    const itemRows = table.rows.filter((row) => row.cells[0]);
    assert.ok(itemRows.length > 0);
    assert.ok(itemRows.every((row) => row.cells[4] === "5000"));
  }
  assert.match(exported, /Панель \| м² \| 2 \| 5000 \| 10 000,00/);
  assert.match(exported, /Монтаж \| м² \| 2 \| 5000 \| 10 000,00/);
  assert.match(exported, /Итого работ(?: \| {1,2}){4}45 000,00/);
  assert.doesNotMatch(exported, /99999/);
  const secondPass = serializeEstimateDocument(parseEstimateDocument(exported, "repeat"));
  assert.deepEqual(tables(secondPass).map((table) => table.rows.map((row) => row.cells)), exportedTables.map((table) => table.rows.map((row) => row.cells)));
});

test("section titles and price labels never authorize a rate change", () => {
  for (const title of ["Смета на работы", "Стоимость работ", "Перечень работ", "Монтажные работы", "Работы и материалы"]) {
    for (const priceHeader of ["Цена за единицу, руб.", "Базовая цена за единицу, руб.", "Цена для клиента, руб."]) {
      const source = `## ${title}\n${header.replace("Цена за единицу, руб.", priceHeader)}\n| 1 | Монтаж | шт. | 2 | 5000,25 | 99999 | |`;
      const exported = serializeEstimateDocument(parseEstimateDocument(source));
      assert.equal(tables(exported)[0].rows[0].cells[4], "5000,25", `${title}: ${priceHeader}`);
      assert.match(exported, /Монтаж \| шт\. \| 2 \| 5000,25 \| 10 000,50/);
      assert.ok(exported.includes(priceHeader));
    }
  }
});

test("mixed table sections preserve rates and calculate each subtotal from its own items", () => {
  const source = `## Работы
${header}
| | Материалы | | | | | |
| 1 | Панель | м² | 2 | 5000 | 99999 | |
| | Итого материалов | | | | 99999 | |
| | Работы | | | | | |
| 2 | Монтаж | м² | 3 | 5000 | 99999 | |
| | Итого работ | | | | 99999 | |
| | Всего | | | | 99999 | |`;
  const exported = serializeEstimateDocument(parseEstimateDocument(source, "mixed-sections"));
  assert.match(exported, /Панель \| м² \| 2 \| 5000 \| 10 000,00/);
  assert.match(exported, /Монтаж \| м² \| 3 \| 5000 \| 15 000,00/);
  assert.match(exported, /Итого материалов(?: \| {1,2}){4}10 000,00/);
  assert.match(exported, /Итого работ(?: \| {1,2}){4}15 000,00/);
  assert.match(exported, /Всего(?: \| {1,2}){4}25 000,00/);
});

test("edited exports remove obsolete prose amounts instead of preserving contradictions", () => {
  const prose = [
    "600 + 5000 = 5600 руб.",
    "Таким образом, общая стоимость составляет 5600 руб.",
    "Общая сумма: 5600 руб.",
    "Стоимость проекта: 5600 руб.",
    "К оплате: 5600 руб.",
    "7000 - 1400 = 5600 руб.",
    "7000 / 2 = 3500 руб.",
    "Площадь фасада: 10 × 5 = 50 м².",
    "Периметр: 10 + 8 + 10 + 8 = 36 м.",
    "Итого площадь фасада: 50 м².",
    "Итого длина откосов: 36 пог. м.",
    "Итого: 12 окон.",
  ].join("\n");
  const doc = parseEstimateDocument(`${header}\n| 1 | Работа | шт. | 10 | 500 | 5600 | |\n\n${prose}`, "stale-total");
  const table = doc.blocks.find((block): block is EstimateTable => block.type === "table")!;
  const edited = updateEstimateCell(doc, table.id, table.rows[0].id, 3, "20");
  const exported = serializeEstimateDocument(edited);
  assert.match(exported, /Работа \| шт\. \| 20 \| 500 \| 10 000,00/);
  assert.match(exported, /Исходный текстовый итог удалён/);
  assert.doesNotMatch(exported, /600\s*\+|5000\s*=|5600/);
  assert.match(exported, /Площадь фасада: 10 × 5 = 50 м²/);
  assert.match(exported, /Периметр: 10 \+ 8 \+ 10 \+ 8 = 36 м/);
  assert.match(exported, /Итого площадь фасада: 50 м²/);
  assert.match(exported, /Итого длина откосов: 36 пог\. м/);
  assert.match(exported, /Итого: 12 окон/);
  assert.doesNotMatch(exported, /7000\s*[-/]\s*(?:1400|2)/);
});

test("stale totals across prose blocks add one notice and preserve a semicolon clause", () => {
  const source = `Общая сумма: 5000 руб.

${header}
| 1 | Работа | шт. | 1 | 5000 | 5000 | |

Итого к оплате 5000 руб.; срок выполнения — 5 дней.`;
  const exported = serializeEstimateDocument(parseEstimateDocument(source, "stale-blocks"));
  assert.equal(exported.match(/Исходный текстовый итог удалён/g)?.length, 1);
  assert.doesNotMatch(exported, /Итого к оплате 5000|Общая сумма: 5000/);
  assert.match(exported, /срок выполнения — 5 дней\./);
});

test("screen prose blocks share one stale-total notice", () => {
  const proseState = { noticeAdded: false };
  const rendered = ["Общая сумма: 5000 руб.", "Итого к оплате 5000 руб.; срок выполнения — 5 дней."]
    .map((text) => formatEstimateProse(text, true, proseState)).join("\n");
  assert.equal(rendered.match(/Исходный текстовый итог удалён/g)?.length, 1);
  assert.match(rendered, /срок выполнения — 5 дней\./);
});
