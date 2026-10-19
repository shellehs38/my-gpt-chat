import { createHash, createPrivateKey, sign } from "node:crypto";
import type { LedgerClient, LedgerExpense, LedgerObject } from "../ledger-contract";

const DEFAULT_SPREADSHEET_ID = "1-frD3ABf1G-IH1cd31Fktb9NY2XPLg05VGLOwSsgA2U";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const MARKER_KEY = "svoi_web_ledger_v1";
const MAX_GRID_ROWS = 10_000;
const MARKER_RETENTION_MS = 10 * 60_000;
const PROBES = 8;
const HEADERS = {
  clients: ["ID клиента", "Фамилия", "Имя / отчество", "Телефон", "Комментарий", "Дата добавления"],
  objects: ["№", "Дата", "Клиент", "Телефон", "Адрес", "Вид работ", "Цена клиенту", "Расходы", "Прибыль", "Налог", "Чистая прибыль", "Статус", "ID объекта", "ID клиента", "Начальные расходы ₽", "Комментарий / исходные данные"],
  expenses: ["ID расхода", "Дата", "ID объекта", "ID клиента", "Описание", "Сумма ₽", "Категория", "Комментарий / документ"],
  journal: ["ID операции", "Хэш команды", "Результат JSON", "Дата подтверждения", "ID маркера"],
} as const;
const TITLES = { clients: "Клиенты", objects: "Лист1", expenses: "Расходы", journal: "_ВебОперации" } as const;
type Entity = keyof typeof HEADERS;
type JsonObject = Record<string, unknown>;
type ServiceAccount = { client_email: string; private_key: string; private_key_id?: string };
type LedgerEnvironment = Partial<NodeJS.ProcessEnv>;
type Sheet = { sheetId: number; title: string; rowCount: number; columnCount: number };
type Layout = Record<Entity, Sheet>;

export type LedgerSnapshot = { clients: LedgerClient[]; objects: LedgerObject[]; expenses: LedgerExpense[] };
export type LedgerCommitInput = { requestId: string; payloadHash: string; client?: LedgerClient; object?: LedgerObject; expenses?: LedgerExpense[] };
export type LedgerRecordHashes = { client?: { id: string; hash: string }; object?: { id: string; hash: string }; expenses: { id: string; hash: string }[] };
export type LedgerCommitResult = { duplicate: boolean; clientId?: string; objectId?: string; expenseIds: string[]; recordHashes?: LedgerRecordHashes };
type Marker = { version: 1; requestId: string; payloadHash: string; resultHash: string };
type Receipt = { requestId: string; payloadHash: string; result: Omit<LedgerCommitResult, "duplicate">; committedAt: number; metadataId: number };

/** Messages are deliberately static: Google response bodies may contain private data. */
export class LedgerSheetsError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 503) {
    super(message); this.name = "LedgerSheetsError";
  }
}
class GoogleHttpError extends Error { constructor(public readonly status: number) { super("Google API request failed"); } }
const unavailable = () => new LedgerSheetsError("sheets_unavailable", "Не удалось получить подтверждение от Google Таблицы. Повторите ту же команду; номер операции сохранён.");
const schemaError = () => new LedgerSheetsError("sheets_schema", "Структура рабочей Google Таблицы изменилась. Запись остановлена, чтобы сохранить данные.");
function object(value: unknown): JsonObject { return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {}; }
function text(value: unknown): string { return typeof value === "string" ? value : typeof value === "number" ? String(value) : ""; }
function id(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(value); }
function spreadsheetId(env: LedgerEnvironment): string { return env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim() || DEFAULT_SPREADSHEET_ID; }
function credentials(env: LedgerEnvironment): ServiceAccount | null {
  try {
    const raw = env.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (!raw || raw.length > 32_768 || !/^[A-Za-z0-9_-]{20,150}$/.test(spreadsheetId(env))) return null;
    const data = object(JSON.parse(raw));
    if (data.type !== "service_account" || typeof data.client_email !== "string" || !/^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.gserviceaccount\.com$/.test(data.client_email)
      || typeof data.private_key !== "string" || (data.token_uri !== undefined && data.token_uri !== TOKEN_URL)) return null;
    const key = createPrivateKey(data.private_key);
    if (key.asymmetricKeyType !== "rsa" || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) return null;
    return { client_email: data.client_email, private_key: data.private_key, ...(typeof data.private_key_id === "string" && /^[a-fA-F0-9]{1,100}$/.test(data.private_key_id) ? { private_key_id: data.private_key_id } : {}) };
  } catch { return null; }
}
export function getLedgerConfiguration(env: LedgerEnvironment = process.env) {
  const configured = credentials(env) !== null;
  return {
    configured,
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId(env))}/edit`,
    message: configured ? "Подключение настроено. Доступ к таблице проверяется при открытии учёта." : "Для учёта на сайте нужно подключить служебный аккаунт Google и дать ему доступ к рабочей таблице. Пока записи в таблицу недоступны.",
  };
}
function rub(value: unknown, positive = false): string | null {
  if (value === undefined || value === null || value === "") return null;
  const source = text(value).replace(/\u00a0/g, "").replace(/ /g, "").replace(",", ".");
  if (!/^-?\d{1,12}(?:\.\d{1,2})?$/.test(source)) throw schemaError();
  const number = Number(source);
  if (!Number.isFinite(number) || (positive && number <= 0)) throw schemaError();
  return source;
}
function dateNow(now: number) { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Irkutsk", year: "numeric", month: "2-digit", day: "2-digit" }).format(now); }
function cell(value: string | number | null) { return value === null ? {} : { userEnteredValue: typeof value === "number" ? { numberValue: value } : { stringValue: value } }; }
function moneyCell(value: string | null) { const normalized = rub(value); return normalized === null ? {} : cell(Number(normalized)); }
function rowsRequest(sheetId: number, rows: unknown[]) { return { appendCells: { sheetId, rows, fields: "userEnteredValue" } }; }
function metadataIds(requestId: string): number[] { return Array.from({ length: PROBES }, (_, salt) => (createHash("sha256").update(`${MARKER_KEY}:${requestId}:${salt}`).digest().readUInt32BE(0) & 0x7fffffff) || 1); }
function canonicalMoney(value: string | null): string | null {
  const amount = rub(value);
  if (amount === null) return null;
  const negative = amount.startsWith("-"); const [whole, fraction = ""] = (negative ? amount.slice(1) : amount).split(".");
  return ((BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"))) * (negative ? -1n : 1n)).toString();
}
function recordHash(values: unknown[]) { return createHash("sha256").update(JSON.stringify(values)).digest("hex"); }
export function fingerprintClient(client: LedgerClient): string {
  return recordHash(["client-v1", client.id, client.surname, client.givenName, client.phone, client.comment]);
}
/** Running expense/profit formulas are intentionally excluded: later expenses change them. */
export function fingerprintObject(object: LedgerObject): string {
  return recordHash(["object-v1", object.id, object.clientId, object.clientName, object.address, object.workType, canonicalMoney(object.priceRub), object.status, object.comment]);
}
export function fingerprintExpense(expense: LedgerExpense): string {
  return recordHash(["expense-v1", expense.id, expense.date, expense.objectId, expense.clientId, expense.description, canonicalMoney(expense.amountRub), expense.category, expense.comment]);
}
function hashesValid(value: unknown, result: JsonObject): boolean {
  if (value === undefined) return true; // Legacy receipts stay readable; replay must reject missing hashes.
  const hashes = object(value);
  const entryValid = (entry: unknown) => {
    const data = object(entry);
    return Object.keys(data).length === 2 && id(data.id) && typeof data.hash === "string" && /^[a-f0-9]{64}$/.test(data.hash);
  };
  if (Object.keys(hashes).some(key => !["client", "object", "expenses"].includes(key)) || !Array.isArray(hashes.expenses) || hashes.expenses.length > 50
    || !hashes.expenses.every(entryValid) || (hashes.client !== undefined && (!entryValid(hashes.client) || object(hashes.client).id !== result.clientId))
    || (hashes.object !== undefined && (!entryValid(hashes.object) || object(hashes.object).id !== result.objectId))) return false;
  const expenseIds = result.expenseIds as string[];
  return hashes.expenses.length === expenseIds.length && hashes.expenses.every((entry, index) => object(entry).id === expenseIds[index]);
}
function resultValid(result: JsonObject): boolean {
  return Object.keys(result).every(key => ["clientId", "objectId", "expenseIds", "recordHashes"].includes(key))
    && Array.isArray(result.expenseIds) && result.expenseIds.length <= 50 && result.expenseIds.every(id)
    && (result.clientId === undefined || id(result.clientId)) && (result.objectId === undefined || id(result.objectId)) && hashesValid(result.recordHashes, result);
}
function resultHash(result: Omit<LedgerCommitResult, "duplicate">) { return createHash("sha256").update(JSON.stringify(result)).digest("hex"); }
function parseMarker(value: unknown): Marker | null {
  try {
    if (typeof value !== "string" || value.length > 16_384) return null;
    const data = object(JSON.parse(value));
    if (data.version !== 1 || !id(data.requestId) || typeof data.payloadHash !== "string" || !/^[a-f0-9]{64}$/.test(data.payloadHash)
      || typeof data.resultHash !== "string" || !/^[a-f0-9]{64}$/.test(data.resultHash)) return null;
    return data as unknown as Marker;
  } catch { return null; }
}

/** Server-only Sheets client. It never uses URLs supplied in credentials or model output. */
export class GoogleSheetsLedger {
  private readonly env: LedgerEnvironment;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private token: { value: string; expiresAt: number } | null = null;
  private tokenPromise: Promise<string> | null = null;
  constructor(options: { env?: LedgerEnvironment; fetchImpl?: typeof fetch; now?: () => number } = {}) {
    this.env = options.env ?? process.env; this.fetchImpl = options.fetchImpl ?? fetch; this.now = options.now ?? Date.now;
  }
  private async json(url: string, init: RequestInit, maximum = 4_194_304): Promise<unknown> {
    try {
      const response = await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(12_000), redirect: "error", cache: "no-store" });
      if (!response.ok) { await response.body?.cancel(); throw new GoogleHttpError(response.status); }
      const reader = response.body?.getReader();
      if (!reader) throw unavailable();
      let length = 0; const chunks: Uint8Array[] = [];
      while (true) {
        const next = await reader.read(); if (next.done) break;
        length += next.value.byteLength;
        if (length > maximum) { await reader.cancel(); throw unavailable(); }
        chunks.push(next.value);
      }
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch (error) { if (error instanceof GoogleHttpError || error instanceof LedgerSheetsError) throw error; throw unavailable(); }
  }
  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > this.now() + 60_000) return this.token.value;
    if (this.tokenPromise) return this.tokenPromise;
    this.tokenPromise = this.newAccessToken();
    try { return await this.tokenPromise; } finally { this.tokenPromise = null; }
  }
  private async newAccessToken(): Promise<string> {
    const account = credentials(this.env);
    if (!account) throw new LedgerSheetsError("sheets_not_configured", getLedgerConfiguration(this.env).message);
    const seconds = Math.floor(this.now() / 1000);
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const unsigned = `${encode({ alg: "RS256", typ: "JWT", ...(account.private_key_id ? { kid: account.private_key_id } : {}) })}.${encode({ iss: account.client_email, scope: SCOPE, aud: TOKEN_URL, iat: seconds, exp: seconds + 3600 })}`;
    const assertion = `${unsigned}.${sign("RSA-SHA256", Buffer.from(unsigned), account.private_key).toString("base64url")}`;
    try {
      const data = object(await this.json(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString() }, 16_384));
      if (typeof data.access_token !== "string" || data.access_token.length < 5 || data.access_token.length > 8192 || typeof data.expires_in !== "number" || data.expires_in < 60 || data.expires_in > 86_400) throw unavailable();
      this.token = { value: data.access_token, expiresAt: this.now() + data.expires_in * 1000 }; return this.token.value;
    } catch { throw new LedgerSheetsError("sheets_auth", "Google не подтвердил служебный доступ. Проверьте настройку аккаунта на сервере."); }
  }
  private async api(path: string, body?: unknown): Promise<unknown> {
    const token = await this.accessToken();
    try {
      return await this.json(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId(this.env))}${path}`, {
        method: body === undefined ? "GET" : "POST", headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (error) {
      if (error instanceof GoogleHttpError && (error.status === 401 || error.status === 403 || error.status === 404)) {
        this.token = null;
        throw new LedgerSheetsError("sheets_access", "Нет доступа к рабочей Google Таблице. Проверьте доступ служебного аккаунта и ID таблицы.");
      }
      throw error;
    }
  }
  private async layout(): Promise<Layout> {
    const data = object(await this.api("?fields=properties(locale,timeZone),sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))"));
    if (!Array.isArray(data.sheets)) throw schemaError();
    // The confirmed workbook uses semicolon-delimited formulas (ru_RU). Refuse a changed locale.
    if (object(data.properties).locale !== "ru_RU") throw schemaError();
    const result = {} as Layout;
    for (const entity of Object.keys(TITLES) as Entity[]) {
      const matches = data.sheets.map(s => object(object(s).properties)).filter(p => p.title === TITLES[entity]);
      if (matches.length !== 1) throw schemaError();
      const entry = matches[0]; const grid = object(entry.gridProperties);
      if (!Number.isInteger(entry.sheetId) || typeof entry.sheetId !== "number" || entry.sheetId < 0 || typeof grid.rowCount !== "number" || !Number.isInteger(grid.rowCount)
        || grid.rowCount < 2 || grid.rowCount > MAX_GRID_ROWS || typeof grid.columnCount !== "number" || grid.columnCount < HEADERS[entity].length) throw schemaError();
      result[entity] = { sheetId: entry.sheetId, title: TITLES[entity], rowCount: grid.rowCount, columnCount: grid.columnCount };
    }
    return result;
  }
  private async sheetValues(entity: Entity, sheet: Sheet): Promise<unknown[][]> {
      const result: unknown[][] = [];
      const lastColumn = String.fromCharCode(64 + HEADERS[entity].length);
      for (let start = 1; start <= sheet.rowCount; start += 500) {
        const end = Math.min(sheet.rowCount, start + 499);
        const range = `'${sheet.title}'!A${start}:${lastColumn}${end}`;
        const query = new URLSearchParams({ ranges: range, valueRenderOption: "UNFORMATTED_VALUE", dateTimeRenderOption: "FORMATTED_STRING" });
        const data = object(await this.api(`/values:batchGet?${query}`)); const ranges = data.valueRanges;
        if (!Array.isArray(ranges) || ranges.length !== 1) throw schemaError();
        const values = object(ranges[0]).values ?? [];
        if (!Array.isArray(values) || values.length > end - start + 1 || values.some(v => !Array.isArray(v) || v.length > HEADERS[entity].length)) throw schemaError();
        for (let offset = 0; offset <= end - start; offset++) result.push((values[offset] ?? []) as unknown[]);
      }
      const actual = result[0] ?? [];
      if (HEADERS[entity].some((header, index) => text(actual[index]).trim().normalize("NFKC") !== header.normalize("NFKC"))) throw schemaError();
      return result;
  }
  private async values(layout: Layout): Promise<Record<Exclude<Entity, "journal">, unknown[][]>> {
    return { clients: await this.sheetValues("clients", layout.clients), objects: await this.sheetValues("objects", layout.objects), expenses: await this.sheetValues("expenses", layout.expenses) };
  }
  private async journal(): Promise<{ layout: Layout; receipts: Receipt[] }> {
    const layout = await this.layout();
    const rows = await this.sheetValues("journal", layout.journal);
    const receipts = rows.slice(1).filter(row => row.some(v => v !== "" && v !== null)).map(row => {
      const result = object((() => { try { return JSON.parse(text(row[2])); } catch { return null; } })());
      const committedAt = Date.parse(text(row[3])); const metadataId = Number(row[4]);
      if (!id(row[0]) || !/^[a-f0-9]{64}$/.test(text(row[1])) || !resultValid(result) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(text(row[3])) || !Number.isFinite(committedAt) || !Number.isInteger(metadataId) || metadataId <= 0 || metadataId > 0x7fffffff) throw schemaError();
      return { requestId: row[0], payloadHash: text(row[1]), result: result as unknown as Receipt["result"], committedAt, metadataId };
    });
    if (new Set(receipts.map(r => r.requestId)).size !== receipts.length) throw schemaError();
    return { layout, receipts };
  }
  private async collectOldMarkers(receipts: Receipt[]): Promise<void> {
    const data = object(await this.api("/developerMetadata:search", { dataFilters: [{ developerMetadataLookup: { metadataKey: MARKER_KEY, visibility: "DOCUMENT" } }] }));
    const entries = data.matchedDeveloperMetadata ?? [];
    if (!Array.isArray(entries) || entries.length > 1000) throw schemaError();
    const byId = new Map(receipts.map(r => [r.metadataId, r]));
    const requests: unknown[] = [];
    for (const entry of entries) {
      const metadata = object(object(entry).developerMetadata); const marker = parseMarker(metadata.metadataValue);
      const receipt = typeof metadata.metadataId === "number" ? byId.get(metadata.metadataId) : undefined;
      if (metadata.metadataKey !== MARKER_KEY || !marker || !receipt || receipt.committedAt > this.now() - MARKER_RETENTION_MS
        || receipt.requestId !== marker.requestId || receipt.payloadHash !== marker.payloadHash || resultHash(receipt.result) !== marker.resultHash) continue;
      // Match value as well as ID: a concurrent GC may already have freed and reused this ID.
      requests.push({ deleteDeveloperMetadata: { dataFilter: { developerMetadataLookup: { metadataId: metadata.metadataId, metadataKey: MARKER_KEY, metadataValue: metadata.metadataValue, visibility: "DOCUMENT" } } } });
    }
    if (requests.length) await this.api(":batchUpdate", { requests, includeSpreadsheetInResponse: false });
  }
  async loadSnapshot(): Promise<LedgerSnapshot> {
    try {
      const values = await this.values(await this.layout());
      const clients: LedgerClient[] = values.clients.slice(1).filter(row => row.some(v => v !== "" && v !== null)).map(row => {
        if (!id(row[0]) || !text(row[1]).trim()) throw schemaError();
        return { id: row[0], surname: text(row[1]), givenName: text(row[2]), phone: text(row[3]), comment: text(row[4]) };
      });
      const objects: LedgerObject[] = values.objects.slice(1).filter(row => [0, 1, 2, 3, 4, 5, 6, 9, 11, 12, 13, 14, 15].some(i => row[i] !== undefined && row[i] !== "" && row[i] !== null)).map(row => {
        if (!id(row[12]) || !id(row[13])) throw schemaError();
        return { id: row[12], clientId: row[13], clientName: text(row[2]), address: text(row[4]), workType: text(row[5]), priceRub: rub(row[6]), recordedExpenseRub: rub(row[7]), preliminaryProfitRub: rub(row[8]), status: text(row[11]), comment: text(row[15]) };
      });
      const expenses: LedgerExpense[] = values.expenses.slice(1).filter(row => row.some(v => v !== "" && v !== null)).map(row => {
        if (!id(row[0]) || !id(row[2]) || !id(row[3]) || !/^\d{4}-\d{2}-\d{2}$/.test(text(row[1]))) throw schemaError();
        const amount = rub(row[5], true); if (!amount) throw schemaError();
        return { id: row[0], date: text(row[1]), objectId: row[2], clientId: row[3], description: text(row[4]), amountRub: amount, category: text(row[6]), comment: text(row[7]) };
      });
      for (const rows of [clients, objects, expenses]) if (new Set(rows.map(row => row.id)).size !== rows.length) throw schemaError();
      const clientIds = new Set(clients.map(c => c.id)); const objectMap = new Map(objects.map(o => [o.id, o]));
      if (objects.some(o => !clientIds.has(o.clientId)) || expenses.some(e => objectMap.get(e.objectId)?.clientId !== e.clientId)) throw schemaError();
      return { clients, objects, expenses };
    } catch (error) { if (error instanceof LedgerSheetsError) throw error; throw unavailable(); }
  }
  private async markers(requestId: string): Promise<Map<number, { key: string; marker: Marker | null }>> {
    if (!id(requestId)) throw new LedgerSheetsError("operation_invalid", "Некорректный номер операции.", 400);
    const ids = metadataIds(requestId);
    const data = object(await this.api("/developerMetadata:search", { dataFilters: ids.map(metadataId => ({ developerMetadataLookup: { metadataId } })) }));
    const found = data.matchedDeveloperMetadata ?? [];
    if (!Array.isArray(found) || found.length > PROBES) throw schemaError();
    const result = new Map<number, { key: string; marker: Marker | null }>();
    for (const item of found) {
      const metadata = object(object(item).developerMetadata);
      if (typeof metadata.metadataId !== "number" || !ids.includes(metadata.metadataId)) throw schemaError();
      result.set(metadata.metadataId, { key: text(metadata.metadataKey), marker: parseMarker(metadata.metadataValue) });
    }
    return result;
  }
  async operationLookup(requestId: string): Promise<(LedgerCommitResult & { payloadHash: string }) | null> {
    try {
      if (!id(requestId)) throw new LedgerSheetsError("operation_invalid", "Некорректный номер операции.", 400);
      const receipt = (await this.journal()).receipts.find(r => r.requestId === requestId);
      return receipt ? { ...receipt.result, duplicate: true, payloadHash: receipt.payloadHash } : null;
    } catch (error) { if (error instanceof LedgerSheetsError) throw error; throw unavailable(); }
  }
  async commit(input: LedgerCommitInput): Promise<LedgerCommitResult> {
    const operationStartedAt = this.now();
    if (!id(input.requestId) || !/^[a-f0-9]{64}$/.test(input.payloadHash) || (!input.client && !input.object && !input.expenses?.length) || (input.expenses?.length ?? 0) > 50) throw new LedgerSheetsError("operation_invalid", "Некорректные данные операции.", 400);
    const result: Omit<LedgerCommitResult, "duplicate"> = {
      clientId: input.client?.id ?? input.object?.clientId ?? input.expenses?.[0]?.clientId,
      objectId: input.object?.id ?? input.expenses?.[0]?.objectId,
      expenseIds: input.expenses?.map(e => e.id) ?? [],
      recordHashes: { ...(input.client ? { client: { id: input.client.id, hash: fingerprintClient(input.client) } } : {}), ...(input.object ? { object: { id: input.object.id, hash: fingerprintObject(input.object) } } : {}), expenses: input.expenses?.map(e => ({ id: e.id, hash: fingerprintExpense(e) })) ?? [] },
    };
    const marker: Marker = { version: 1, requestId: input.requestId, payloadHash: input.payloadHash, resultHash: resultHash(result) };
    if (!parseMarker(JSON.stringify(marker)) || !resultValid(result)) throw new LedgerSheetsError("operation_invalid", "Некорректные данные операции.", 400);
    const replay = (stored: Pick<Receipt, "payloadHash" | "result">): LedgerCommitResult => {
      if (stored.payloadHash !== input.payloadHash) throw new LedgerSheetsError("operation_conflict", "Этот номер операции уже использован для другой команды. Обновите команду перед отправкой.", 409);
      return { ...stored.result, duplicate: true };
    };
    try {
      const journal = await this.journal();
      const previousReceipt = journal.receipts.find(r => r.requestId === input.requestId);
      if (previousReceipt) return replay(previousReceipt);
      if (journal.receipts.length >= MAX_GRID_ROWS - 1) throw new LedgerSheetsError("sheets_capacity", "Достигнут предел журнала операций. Требуется расширение учёта.");
      await this.collectOldMarkers(journal.receipts);
      let existing = await this.markers(input.requestId);
      const previous = [...existing.values()].find(e => e.key === MARKER_KEY && e.marker?.requestId === input.requestId)?.marker;
      // A matching marker without its journal row violates the atomic write contract.
      if (previous) throw schemaError();
      const layout = journal.layout;
      // Recheck headers immediately before mutations. No precomputed grid indexes are reused.
      const snapshot = await this.loadSnapshot();
      if (input.client && snapshot.clients.some(c => c.id === input.client!.id) || input.object && snapshot.objects.some(o => o.id === input.object!.id) || input.expenses?.some(e => snapshot.expenses.some(old => old.id === e.id))) throw new LedgerSheetsError("record_conflict", "Запись с таким номером уже существует. Обновите данные.", 409);
      const clientMap = new Map(snapshot.clients.map(c => [c.id, c])); if (input.client) clientMap.set(input.client.id, input.client);
      const objectMap = new Map(snapshot.objects.map(o => [o.id, o])); if (input.object) objectMap.set(input.object.id, input.object);
      if (input.object && !clientMap.has(input.object.clientId) || input.expenses?.some(e => objectMap.get(e.objectId)?.clientId !== e.clientId)) throw new LedgerSheetsError("record_conflict", "Клиент и объект больше не совпадают. Выберите объект заново.", 409);
      const requests: unknown[] = [];
      const today = dateNow(this.now());
      if (input.client) { const c = input.client; requests.push(rowsRequest(layout.clients.sheetId, [{ values: [c.id, c.surname, c.givenName, c.phone, c.comment, today].map(cell) }])); }
      if (input.object) {
        if (layout.objects.rowCount >= MAX_GRID_ROWS) throw new LedgerSheetsError("sheets_capacity", "Достигнут предел строк учёта. Сначала расширьте настроенный диапазон.");
        const o = input.object; const c = clientMap.get(o.clientId)!;
        const values: unknown[] = [cell(o.id), cell(today), cell(o.clientName), cell(c.phone), cell(o.address), cell(o.workType), moneyCell(o.priceRub),
          { userEnteredValue: { formulaValue: '=IF($M2="";"";IF(AND($O2="";COUNTIF(\'Расходы\'!$C$2:$C;$M2)=0);"";IF($O2="";0;$O2)+SUMIF(\'Расходы\'!$C$2:$C;$M2;\'Расходы\'!$F$2:$F)))' } },
          { userEnteredValue: { formulaValue: '=IF(OR($M2="";$G2="";$H2="");"";$G2-$H2)' } }, {},
          { userEnteredValue: { formulaValue: '=IF(OR($M2="";$I2="";$J2="");"";$I2-$J2)' } }, cell(o.status), cell(o.id), cell(o.clientId), {}, cell(o.comment)];
        requests.push({ insertDimension: { range: { sheetId: layout.objects.sheetId, dimension: "ROWS", startIndex: 1, endIndex: 2 }, inheritFromBefore: false } },
          { updateCells: { range: { sheetId: layout.objects.sheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 16 }, rows: [{ values }], fields: "userEnteredValue" } });
      }
      if (input.expenses?.length) requests.push(rowsRequest(layout.expenses.sheetId, input.expenses.map(e => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date) || !rub(e.amountRub, true)) throw new LedgerSheetsError("operation_invalid", "Некорректная дата или сумма расхода.", 400);
        return { values: [cell(e.id), cell(e.date), cell(e.objectId), cell(e.clientId), cell(e.description), moneyCell(e.amountRub), cell(e.category), cell(e.comment)] };
      })));
      for (const metadataId of metadataIds(input.requestId)) {
        if (existing.has(metadataId)) continue;
        // No stale request can live until a marker's ten-minute GC window. The route is also
        // restricted to 60 seconds. Never relax this guard independently of GC retention.
        if (this.now() - operationStartedAt > 50_000) throw new LedgerSheetsError("operation_expired", "Команда заняла слишком много времени. Повторите её с тем же номером операции.");
        try {
          const receiptRow = { values: [cell(input.requestId), cell(input.payloadHash), cell(JSON.stringify(result)), cell(new Date(this.now()).toISOString()), cell(metadataId)] };
          await this.api(":batchUpdate", { requests: [{ createDeveloperMetadata: { developerMetadata: { metadataId, metadataKey: MARKER_KEY, metadataValue: JSON.stringify(marker), location: { spreadsheet: true }, visibility: "DOCUMENT" } } }, rowsRequest(layout.journal.sheetId, [receiptRow]), ...requests], includeSpreadsheetInResponse: false });
          return { ...result, duplicate: false };
        } catch (error) {
          // A timeout may mean the entire batch committed. Never retry using another slot unless
          // Google definitely rejected this batch and another request owns this exact slot.
          const retryableCollision = error instanceof GoogleHttpError && error.status === 400;
          const committedReceipt = (await this.journal()).receipts.find(r => r.requestId === input.requestId);
          if (committedReceipt) return replay(committedReceipt);
          existing = await this.markers(input.requestId);
          const committed = [...existing.values()].find(e => e.key === MARKER_KEY && e.marker?.requestId === input.requestId)?.marker;
          if (committed) throw schemaError();
          if (retryableCollision && existing.has(metadataId)) continue;
          throw error;
        }
      }
      throw new LedgerSheetsError("operation_collision", "Не удалось выделить номер операции. Обратитесь к администратору.");
    } catch (error) { if (error instanceof LedgerSheetsError) throw error; throw unavailable(); }
  }
}
