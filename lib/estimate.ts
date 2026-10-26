/** A single source of truth for editable Markdown tables. No floating point money. */
export type EstimateRow = { id: string; cells: string[] };
export type EstimateTable = { type: "table"; id: string; variantId: string; title: string; headers: string[]; rows: EstimateRow[]; priceBasis?: "client" };
export type EstimateBlock = { type: "markdown"; id: string; text: string } | EstimateTable;
export type EstimateDocument = { id: string; blocks: EstimateBlock[] };
export type CalculatedRow = { rowId: string; kind: "item" | "total" | "section"; amountKopecks: string | null; complete: boolean };
export type CalculatedTable = { tableId: string; rows: CalculatedRow[]; knownTotalKopecks: string; complete: boolean; hasCalculation: boolean; quantityIndex: number; priceIndex: number; sumIndex: number };
export type CalculatedDocument = { tables: CalculatedTable[]; hasCalculation: boolean; complete: boolean };

function newId(): string {
  return typeof globalThis.crypto?.randomUUID === "function" ? globalThis.crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
export function createDocumentId(): string { return newId(); }

/** Pipes inside inline code or escaped as \| do not start another cell. */
export function splitMarkdownRow(line: string): string[] {
  const text = line.trim();
  const result: string[] = [];
  let current = "";
  let codeDelimiter = 0;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === "\\" && index + 1 < text.length) {
      current += character + text[++index];
    } else if (character === "`") {
      let length = 1;
      while (text[index + length] === "`") length++;
      if (!codeDelimiter) codeDelimiter = length;
      else if (length === codeDelimiter) codeDelimiter = 0;
      current += "`".repeat(length);
      index += length - 1;
    } else if (character === "|" && !codeDelimiter) {
      result.push(current.trim());
      current = "";
    } else current += character;
  }
  result.push(current.trim());
  if (text.startsWith("|")) result.shift();
  if (text.endsWith("|") && !text.endsWith("\\|")) result.pop();
  return result;
}
function isDivider(line: string): boolean {
  const cells = splitMarkdownRow(line);
  return cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}
export function parseEstimateDocument(markdown: string, documentId = newId(), stripGeneratedSummary = true): EstimateDocument {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n").filter((line) => !stripGeneratedSummary || !/^\*\*Арифметический (?:итог|подытог известных позиций):/u.test(line));
  const blocks: EstimateBlock[] = [];
  let pending: string[] = [];
  let fence = "";
  let heading = "Смета";
  let variantOrdinal = 0;
  const flush = () => {
    if (pending.length) blocks.push({ type: "markdown", id: `${documentId}:text:${blocks.length}`, text: pending.join("\n") });
    pending = [];
  };
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1];
      else if (fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) fence = "";
      pending.push(line);
      continue;
    }
    const boldHeading = line.match(/^\s*\*\*([^*]+)\*\*:?[\s]*$/);
    if (!fence && (/^\s*#{1,6}\s+/.test(line) || boldHeading)) {
      heading = boldHeading ? boldHeading[1].replace(/:$/, "").trim() : line.replace(/^\s*#{1,6}\s+/, "").trim();
      if (/вариант|с утеплением|без утепления/i.test(heading)) variantOrdinal++;
    }
    if (!fence && index + 1 < lines.length && line.includes("|") && isDivider(lines[index + 1])) {
      flush();
      const tableId = `${documentId}:variant:${variantOrdinal}:table:${blocks.length}`;
      const headers = splitMarkdownRow(line);
      const rows: EstimateRow[] = [];
      index += 2;
      while (index < lines.length && lines[index].trim() && lines[index].includes("|") && !/^\s*#{1,6}\s/.test(lines[index])) {
        const cells = splitMarkdownRow(lines[index]);
        // Keep extra cells instead of silently discarding supplied notes.
        while (headers.length < cells.length) headers.push(`Поле ${headers.length + 1}`);
        rows.push({ id: `${tableId}:row:${rows.length}`, cells });
        index++;
      }
      index--;
      for (const row of rows) while (row.cells.length < headers.length) row.cells.push("");
      blocks.push({ type: "table", id: tableId, variantId: `${documentId}:variant:${variantOrdinal}`, title: heading, headers, rows });
    } else pending.push(line);
  }
  flush();
  return { id: documentId, blocks };
}
const plain = (text: string) => text.replace(/[*_`]/g, "").replace(/\\\|/g, "|").trim();
export function tableColumns(table: EstimateTable): { quantityIndex: number; priceIndex: number; sumIndex: number } {
  const headers = table.headers.map((value) => plain(value).toLowerCase().replace(/ё/g, "е"));
  return {
    quantityIndex: headers.findIndex((name) => /^(количество|кол[- ]?во|объем)(\b|[\s,.(/]|$)/u.test(name) || /^(количество|кол[- ]?во|объем)$/u.test(name)),
    priceIndex: headers.findIndex((name) => /^(?:базовая\s+)?(?:цена|расценка|ставка|стоимость за|стоимость ед)/u.test(name)),
    sumIndex: headers.findIndex((name) => /^(сумма|стоимость|итого)([\s,.(]|$)/u.test(name) && !/за|единиц|ед\./u.test(name)),
  };
}
export function rowKind(row: EstimateRow): CalculatedRow["kind"] {
  const values = row.cells.map(plain).filter(Boolean);
  if (values.some((value) => /^(итого|всего|общий итог|общая стоимость|суммарно|подытог|подитог)([\s:,.]|$)/iu.test(value))) return "total";
  if (values.length === 1 && /^(материалы|работы|подготовительные работы|основные работы|дополнительные работы|раздел)([\s:]|$)/iu.test(values[0])) return "section";
  return "item";
}
type Decimal = { integer: bigint; scale: number };
function parseDecimal(raw: string): Decimal | null {
  const value = plain(raw).replace(/[\s\u00a0\u202f]/g, "").replace(/(?:руб\.?|₽)$/iu, "").replace(",", ".");
  if (!/^\d{1,14}(?:\.\d{1,6})?$/.test(value)) return null;
  const [integer, fraction = ""] = value.split(".");
  return { integer: BigInt(integer + fraction), scale: fraction.length };
}
export function multiplyMoney(quantity: string, price: string): string | null {
  const q = parseDecimal(quantity), p = parseDecimal(price);
  if (!q || !p) return null;
  const numerator = q.integer * p.integer * BigInt(100);
  const denominator = BigInt(10) ** BigInt(q.scale + p.scale);
  return ((numerator + denominator / BigInt(2)) / denominator).toString();
}
export function formatKopecks(value: string): string {
  const integer = BigInt(value);
  const rubles = (integer / BigInt(100)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${rubles},${(integer % BigInt(100)).toString().padStart(2, "0")}`;
}

const finalPriceHeader = /(?:для\s+клиента|клиентск|конечн|финальн|надбавк[^|]{0,30}(?:включ|учтен))/iu;
const explicitlyNotFinalPrice = /(?:не\s+(?:для\s+клиента|включ\p{L}*|учт\p{L}*|рассчит\p{L}*|конечн\p{L}*|финальн\p{L}*)|без\s+(?:надбавк|наценк))/iu;
const directCost = /(?:^(?:материал|достав|поставк|логистик|вывоз|транспорт|аренд|прокат|техник|механизм|оборудован|закуп)\p{L}*(?:[^\p{L}]|$)|^комплект(?:[^\p{L}]|$)|^(?:затрат|расход)\p{L}*\s+на\s+(?:транспорт|достав|материал|оборудован)|под\s+ключ|(?:работ|монтаж|установк)\p{L}*\s+(?:и|с|\/)\s+материал)/iu;

function marksFinalPrice(raw: string): boolean {
  const value = plain(raw);
  return !explicitlyNotFinalPrice.test(value) && finalPriceHeader.test(value);
}

function adjustedUnitPrice(raw: string): string | null {
  const value = parseDecimal(raw);
  if (!value) return null;
  const numerator = value.integer * BigInt(100) * BigInt(7);
  const denominator = (BigInt(10) ** BigInt(value.scale)) * BigInt(5);
  return formatKopecks(((numerator + denominator / BigInt(2)) / denominator).toString());
}

/**
 * Converts server-side base work rates to customer-facing rates exactly once.
 * The returned document contains only final prices; the internal rule is never
 * serialized as a separate customer line.
 */
export function prepareEstimateForClient(document: EstimateDocument): EstimateDocument {
  return {
    ...document,
    blocks: document.blocks.map((block) => {
      if (block.type !== "table") return block;
      const nameIndex = block.headers.findIndex((header) => /^(?:№\s*)?(?:наименован|назван|вид\s+работ|работа|позици)/iu.test(plain(header)));
      const columns = tableColumns(block);
      const title = plain(block.title);
      const mixedTitle = /(?:материал\p{L}*\s+(?:и|\/)\s+работ\p{L}*|работ\p{L}*\s+(?:и|\/)\s+материал\p{L}*)/iu.test(title);
      const isWorks = !mixedTitle && (/(?:^|[^\p{L}])работ\p{L}*(?=[^\p{L}]|$)/iu.test(title) || block.headers.some((header) => /наименование\s+работ/iu.test(plain(header))));
      const alreadyFinal = block.priceBasis === "client" || block.headers.some(marksFinalPrice);
      if (!isWorks || alreadyFinal || columns.priceIndex < 0 || nameIndex < 0) return block;
      const headers = [...block.headers];
      headers[columns.priceIndex] = "Цена для клиента, руб.";
      const noteIndex = headers.findIndex((header) => /примечан|комментар/iu.test(plain(header)));
      const rows = block.rows.map((row) => {
        if (rowKind(row) !== "item") return row;
        const name = plain(row.cells[nameIndex] ?? "");
        const note = noteIndex >= 0 ? plain(row.cells[noteIndex] ?? "") : "";
        if (!name || directCost.test(name) || marksFinalPrice(note)) return row;
        const price = adjustedUnitPrice(row.cells[columns.priceIndex] ?? "");
        if (price === null) return row;
        return { ...row, cells: row.cells.map((cell, index) => index === columns.priceIndex ? price : cell) };
      });
      return { ...block, headers, rows, priceBasis: "client" };
    }),
  };
}
export function calculateEstimateDocument(document: EstimateDocument): CalculatedDocument {
  const tables = document.blocks.filter((block): block is EstimateTable => block.type === "table").map((table): CalculatedTable => {
    const columns = tableColumns(table);
    const hasCalculation = columns.quantityIndex >= 0 && columns.priceIndex >= 0;
    let known = BigInt(0), complete = true, sectionKnown = BigInt(0), sectionComplete = true;
    const rows = table.rows.map((row): CalculatedRow => {
      const kind = rowKind(row);
      if (!hasCalculation) return { rowId: row.id, kind, amountKopecks: null, complete: true };
      if (kind === "section") {
        sectionKnown = BigInt(0); sectionComplete = true;
        return { rowId: row.id, kind, amountKopecks: null, complete: true };
      }
      if (kind === "total") {
        const label = row.cells.map(plain).join(" ");
        const isSectionTotal = /материал|работ/iu.test(label) && !/общ|всего/iu.test(label);
        return { rowId: row.id, kind, amountKopecks: (isSectionTotal ? sectionKnown : known).toString(), complete: isSectionTotal ? sectionComplete : complete };
      }
      const amount = multiplyMoney(row.cells[columns.quantityIndex] ?? "", row.cells[columns.priceIndex] ?? "");
      if (amount === null) { complete = false; sectionComplete = false; }
      else { known += BigInt(amount); sectionKnown += BigInt(amount); }
      return { rowId: row.id, kind, amountKopecks: amount, complete: amount !== null };
    });
    // Overall totals are calculated from the whole table, even if the model put
    // an additional (possibly unpriced) line after its own total row.
    rows.forEach((result, index) => {
      if (result.kind !== "total" || !hasCalculation) return;
      const label = table.rows[index].cells.map(plain).join(" ");
      const isSectionTotal = /материал|работ/iu.test(label) && !/общ|всего/iu.test(label);
      if (!isSectionTotal) { result.amountKopecks = known.toString(); result.complete = complete; }
    });
    return { tableId: table.id, rows, knownTotalKopecks: known.toString(), complete, hasCalculation, ...columns };
  });
  return { tables, hasCalculation: tables.some((table) => table.hasCalculation), complete: tables.every((table) => table.complete) };
}
export function displayedCell(row: EstimateRow, cellIndex: number, table: CalculatedTable): string {
  const calculated = table.rows.find((item) => item.rowId === row.id);
  if (table.hasCalculation && cellIndex === table.sumIndex && calculated?.kind !== "section") {
    if (!calculated || calculated.amountKopecks === null) return "Не рассчитано";
    return `${formatKopecks(calculated.amountKopecks)}${calculated.complete ? "" : " (известная часть; неполно)"}`;
  }
  return row.cells[cellIndex] ?? "";
}
function escapeCell(value: string): string {
  return value.replace(/\r?\n/g, " ").replace(/(?<!\\)\|/g, "\\|");
}
export function formatEstimateProse(text: string, hasCalculation: boolean): string {
  if (!hasCalculation) return text;
  const explicitMoneyTotal = /(?:итоговая (?:стоимость|сумма)|общая (?:стоимость|сумма|цена)|сумма (?:материалов|работ)|стоимость (?:всех|материалов|работ|проекта)|к оплате)/iu;
  const genericTotal = /(?:^|[^\p{L}])(?:итог(?:о)?|всего(?: к оплате)?|общий итог)(?=[^\p{L}]|$)/iu;
  const arithmetic = /\d[\d\s.,]*\s*(?:\+|[-−–—/÷×*])\s*\d[\d\s.,]*\s*=\s*\d/iu;
  const monetaryContext = /(?:₽|руб(?:\.|\p{L}*)?)(?=[^\p{L}]|$)|(?:цен|стоимост|сумм)\p{L}*(?=[^\p{L}]|$)/iu;
  const isStaleTotal = (value: string) => {
    const hasNumber = /\d/u.test(value);
    const hasMoney = monetaryContext.test(value);
    return hasNumber && (explicitMoneyTotal.test(value) || genericTotal.test(value) && hasMoney)
      || arithmetic.test(value) && hasMoney;
  };
  let noticeAdded = false;
  return text.split("\n").map((line) => {
    if (!isStaleTotal(line)) return line;
    const sentences = line.split(/(?<=[.!?])\s+(?=[\p{L}*_#>])/u);
    const retained = sentences.length > 1 ? sentences.filter((sentence) => !isStaleTotal(sentence)).join(" ") : "";
    const notice = noticeAdded ? "" : "> Исходный текстовый итог удалён после пересчёта; актуальные суммы приведены в таблицах.";
    noticeAdded = true;
    return [notice, retained].filter(Boolean).join("\n");
  }).join("\n");
}
/** Calculation can be disabled for contracts/advisory tables whose agreed values must remain verbatim. */
export function serializeEstimateDocument(document: EstimateDocument, calculate = true): string {
  const calculated = calculate ? calculateEstimateDocument(document) : undefined;
  return document.blocks.map((block) => {
    if (block.type === "markdown") {
      // A model's prose total cannot remain authoritative after table edits.
      return formatEstimateProse(block.text, calculated?.hasCalculation ?? false);
    }
    const table = calculated?.tables.find((item) => item.tableId === block.id);
    const needsSum = Boolean(table?.hasCalculation && table.sumIndex < 0);
    const headers = needsSum ? [...block.headers, "Сумма, руб. (расчёт)"] : block.headers;
    const lines = [`| ${headers.map(escapeCell).join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`];
    block.rows.forEach((row) => {
      const values = block.headers.map((_, index) => table ? displayedCell(row, index, table) : row.cells[index] ?? "");
      if (needsSum && table) {
        const calculatedRow = table.rows.find((item) => item.rowId === row.id)!;
        values.push(calculatedRow.kind === "section" ? "" : calculatedRow.amountKopecks === null ? "Не рассчитано" : `${formatKopecks(calculatedRow.amountKopecks)}${calculatedRow.complete ? "" : " (известная часть; неполно)"}`);
      }
      lines.push(`| ${values.map(escapeCell).join(" | ")} |`);
    });
    if (table?.hasCalculation) lines.push("", `**Арифметический ${table.complete ? "итог" : "подытог известных позиций"}: ${formatKopecks(table.knownTotalKopecks)} руб.** ${table.complete ? "Все строки этой таблицы рассчитаны по количеству и цене; технические объёмы и цены требуют проверки." : "Полный итог не определён: заполните количество и цену всех позиций. Неизвестные значения не считаются нулём."}`);
    return lines.join("\n");
  }).join("\n\n");
}
export function updateEstimateCell(document: EstimateDocument, tableId: string, rowId: string, columnIndex: number, value: string): EstimateDocument {
  return { ...document, blocks: document.blocks.map((block) => block.type === "table" && block.id === tableId ? { ...block, rows: block.rows.map((row) => row.id === rowId ? { ...row, cells: row.cells.map((cell, index) => index === columnIndex ? value : cell) } : row) } : block) };
}
