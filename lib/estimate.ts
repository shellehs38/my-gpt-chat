/** A single source of truth for editable Markdown tables. No floating point money. */
export type EstimateRow = { id: string; cells: string[] };
export type EstimateTable = { type: "table"; id: string; variantId: string; title: string; headers: string[]; rows: EstimateRow[] };
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
export function parseEstimateDocument(markdown: string, documentId = newId()): EstimateDocument {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n").filter((line) => !/^\*\*Арифметический (?:итог|подытог известных позиций):/u.test(line));
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
    priceIndex: headers.findIndex((name) => /^(цена|расценка|стоимость за|стоимость ед)/u.test(name)),
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
  return text.split("\n").map((line) => /^\s*(?:[-*>]\s*)?\*{0,2}(?:итог(?:о)?|всего|общий итог|общая стоимость|сумма материалов|сумма работ|стоимость (?:всех|материалов|работ))[^\n]*\d/iu.test(line)
    ? `> Пояснение исходного ответа, не пересчитанный итог: ${line.replace(/^\s*>\s*/, "")}` : line).join("\n");
}
export function serializeEstimateDocument(document: EstimateDocument): string {
  const calculated = calculateEstimateDocument(document);
  return document.blocks.map((block) => {
    if (block.type === "markdown") {
      // A model's prose total cannot remain authoritative after table edits.
      return formatEstimateProse(block.text, calculated.hasCalculation);
    }
    const table = calculated.tables.find((item) => item.tableId === block.id)!;
    const needsSum = table.hasCalculation && table.sumIndex < 0;
    const headers = needsSum ? [...block.headers, "Сумма, руб. (расчёт)"] : block.headers;
    const lines = [`| ${headers.map(escapeCell).join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`];
    block.rows.forEach((row) => {
      const values = block.headers.map((_, index) => displayedCell(row, index, table));
      if (needsSum) {
        const calculatedRow = table.rows.find((item) => item.rowId === row.id)!;
        values.push(calculatedRow.kind === "section" ? "" : calculatedRow.amountKopecks === null ? "Не рассчитано" : `${formatKopecks(calculatedRow.amountKopecks)}${calculatedRow.complete ? "" : " (известная часть; неполно)"}`);
      }
      lines.push(`| ${values.map(escapeCell).join(" | ")} |`);
    });
    if (table.hasCalculation) lines.push("", `**Арифметический ${table.complete ? "итог" : "подытог известных позиций"}: ${formatKopecks(table.knownTotalKopecks)} руб.** ${table.complete ? "Все строки этой таблицы рассчитаны по количеству и цене; технические объёмы и цены требуют проверки." : "Полный итог не определён: заполните количество и цену всех позиций. Неизвестные значения не считаются нулём."}`);
    return lines.join("\n");
  }).join("\n\n");
}
export function updateEstimateCell(document: EstimateDocument, tableId: string, rowId: string, columnIndex: number, value: string): EstimateDocument {
  return { ...document, blocks: document.blocks.map((block) => block.type === "table" && block.id === tableId ? { ...block, rows: block.rows.map((row) => row.id === rowId ? { ...row, cells: row.cells.map((cell, index) => index === columnIndex ? value : cell) } : row) } : block) };
}
