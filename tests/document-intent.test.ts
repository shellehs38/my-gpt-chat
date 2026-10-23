import test from "node:test";
import assert from "node:assert/strict";
import { parseEstimateDocument, serializeEstimateDocument, type EstimateTable } from "../lib/estimate";

const contract = `# Договор подряда

Стороны согласовали пакетную стоимость с учётом скидки, исходные расценки приводятся справочно.

## Цена договора
| Наименование | Количество | Цена, руб. | Сумма, руб. | Примечание |
| --- | --- | --- | --- | --- |
| Комплект работ | 2 | 10000 | 19500 | Согласованная скидка 500 руб. |
| Итого | | | 19500 | Стоимость договора |

**Общая стоимость:** 19500 руб.

Итого к оплате по договору 19500 рублей. Оплата по согласованным условиям.`;
const tables = (text: string) => parseEstimateDocument(text).blocks.filter((block): block is EstimateTable => block.type === "table");

test("document serialization preserves agreed financial-looking table values and contract prose when calculation is disabled", () => {
  const document = parseEstimateDocument(contract, "contract-agreed-price");
  const before = structuredClone(document);
  const preserved = serializeEstimateDocument(document, false);
  assert.deepEqual(tables(preserved)[0].headers, tables(contract)[0].headers);
  assert.deepEqual(tables(preserved)[0].rows.map(row => row.cells), tables(contract)[0].rows.map(row => row.cells));
  assert.match(preserved, /Комплект работ \| 2 \| 10000 \| 19500/);
  assert.match(preserved, /Итого \|\s*\|\s*\| 19500/);
  for (const block of document.blocks) if (block.type === "markdown") assert.ok(preserved.includes(block.text));
  assert.doesNotMatch(preserved, /Арифметический итог|не пересчитанный итог|20 000,00/);
  assert.deepEqual(document, before, "serialization must not modify the stored editable document");
});

test("document and sales tables never acquire a calculated sum column or summary when opted out", () => {
  const budget = `## План рекламы
| Канал | Количество | Цена, руб. |
| --- | --- | --- |
| Размещение | 2 | 10000 |

Всего бюджет 20000 рублей; фактические расходы уточняются отдельно.`;
  const output = serializeEstimateDocument(parseEstimateDocument(budget), false);
  assert.equal(tables(output)[0].headers.length, 3);
  assert.deepEqual(tables(output)[0].rows[0].cells, ["Размещение", "2", "10000"]);
  assert.match(output, /Всего бюджет 20000 рублей; фактические расходы уточняются отдельно\./);
  assert.doesNotMatch(output, /Сумма, руб\. \(расчёт\)|Арифметический|не пересчитанный итог/);
});

test("legacy/default estimate serialization still recalculates exact sums and marks stale prose", () => {
  const document = parseEstimateDocument(contract);
  const implicit = serializeEstimateDocument(document);
  const explicit = serializeEstimateDocument(document, true);
  assert.equal(implicit, explicit);
  assert.match(implicit, /Комплект работ \| 2 \| 10000 \| 20 000,00/);
  assert.match(implicit, /Арифметический итог: 20 000,00/);
  assert.match(implicit, /Пояснение исходного ответа, не пересчитанный итог/);
  const noSum = parseEstimateDocument("| Наименование | Количество | Цена |\n| --- | --- | --- |\n| Материал | 3 | 0,10 |");
  assert.match(serializeEstimateDocument(noSum), /Сумма, руб\. \(расчёт\)/);
  assert.match(serializeEstimateDocument(noSum), /0,30/);
});


test("non-calculating parsing preserves genuine arithmetic-summary prose while legacy parsing still strips generated summaries", () => {
  const source = `# План оплаты

**Арифметический итог: 19500 руб.** Согласованная стоимость договора после скидки.

**Арифметический подытог известных позиций: 10000 руб.** Остальные платежи по отдельному соглашению.

Порядок оплаты определяется договором.`;
  const preserved = parseEstimateDocument(source, "payment-plan", false);
  const output = serializeEstimateDocument(preserved, false);
  assert.equal(output, source);
  assert.match(output, /Арифметический итог: 19500 руб/);
  assert.match(output, /Арифметический подытог известных позиций: 10000 руб/);
  const legacy = parseEstimateDocument(source, "payment-plan");
  assert.deepEqual(legacy, parseEstimateDocument(source, "payment-plan", true));
  assert.doesNotMatch(serializeEstimateDocument(legacy, false), /Арифметический/);
});
