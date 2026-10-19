import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, verify } from "node:crypto";
import test from "node:test";
import { GoogleSheetsLedger, LedgerSheetsError, getLedgerConfiguration, fingerprintClient, fingerprintObject, fingerprintExpense, type LedgerCommitInput } from "../lib/server/ledger-sheets";

const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const secret = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const account = { type: "service_account", client_email: "unit-test@unit-test.iam.gserviceaccount.com", private_key: secret, token_uri: "https://oauth2.googleapis.com/token" };
const env = { GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify(account) };
const hash = (input: string) => createHash("sha256").update(input).digest("hex");
const client = { id: "CL-unit", surname: "Тестов", givenName: "Иван", phone: "+7 (000) 000-00-01", comment: "Учебный" };
const currentObject = { id: "OBJ-unit", clientId: client.id, clientName: "Тестов Иван", address: "Учебный адрес", workType: "Фасад", priceRub: "100000", recordedExpenseRub: null, preliminaryProfitRub: null, status: "в работе", comment: "ДЕМО-1" };
const expense = { id: "EXP-unit", date: "2026-10-19", objectId: currentObject.id, clientId: client.id, description: "Материалы", amountRub: "12000.50", category: "Материалы", comment: "Учебный" };
const headers = {
  "Клиенты": ["ID клиента", "Фамилия", "Имя / отчество", "Телефон", "Комментарий", "Дата добавления"],
  "Лист1": ["№", "Дата", "Клиент", "Телефон", "Адрес", "Вид работ", "Цена клиенту", "Расходы", "Прибыль", "Налог", "Чистая прибыль", "Статус", "ID объекта", "ID клиента", "Начальные расходы ₽", "Комментарий / исходные данные"],
  "Расходы": ["ID расхода", "Дата", "ID объекта", "ID клиента", "Описание", "Сумма ₽", "Категория", "Комментарий / документ"],
  "_ВебОперации": ["ID операции", "Хэш команды", "Результат JSON", "Дата подтверждения", "ID маркера"],
};
type Metadata = { metadataId: number; metadataKey: string; metadataValue: string };
function harness(options: { loseResponse?: boolean; rejectWithoutMarker?: boolean; collisionRace?: boolean } = {}) {
  const markers = new Map<number, Metadata>();
  const calls: { url: string; init: RequestInit }[] = [];
  const batches: any[] = [];
  const values: Record<string, unknown[][]> = Object.fromEntries(Object.entries(headers).map(([title, row]) => [title, [[...row]]]));
  let rowCount = 1000; let locale = "ru_RU"; let tokenCalls = 0; let nowMs = Date.parse("2026-10-18T20:00:00Z"); let expireOnSnapshot = false;
  const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
  const mock: typeof fetch = async (input, init = {}) => {
    const url = String(input); calls.push({ url, init });
    assert.equal(init.redirect, "error"); assert.equal(init.cache, "no-store"); assert.ok(init.signal);
    if (url === "https://oauth2.googleapis.com/token") {
      tokenCalls++;
      const body = new URLSearchParams(String(init.body));
      assert.equal(body.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");
      const token = body.get("assertion")!.split(".");
      const claims = JSON.parse(Buffer.from(token[1], "base64url").toString());
      assert.equal(claims.scope, "https://www.googleapis.com/auth/spreadsheets");
      assert.equal(claims.aud, url); assert.equal(claims.exp - claims.iat, 3600);
      assert.equal(verify("RSA-SHA256", Buffer.from(token.slice(0, 2).join(".")), pair.publicKey, Buffer.from(token[2], "base64url")), true);
      return reply({ access_token: "unit-only-bearer-token", expires_in: 3600 });
    }
    assert.equal(new URL(url).origin, "https://sheets.googleapis.com");
    assert.equal((init.headers as Record<string, string>).Authorization, "Bearer unit-only-bearer-token");
    if (url.endsWith("/developerMetadata:search")) {
      const filters = JSON.parse(String(init.body)).dataFilters as any[];
      if (filters[0]?.developerMetadataLookup.metadataKey) return reply({ matchedDeveloperMetadata: [...markers.values()].filter(m => m.metadataKey === filters[0].developerMetadataLookup.metadataKey).map(developerMetadata => ({ developerMetadata })) });
      return reply({ matchedDeveloperMetadata: filters.flatMap(f => {
        const metadata = markers.get(f.developerMetadataLookup.metadataId);
        return metadata ? [{ developerMetadata: metadata }] : [];
      }) });
    }
    if (url.endsWith(":batchUpdate")) {
      const body = JSON.parse(String(init.body)); batches.push(body);
      if (body.requests[0].deleteDeveloperMetadata) {
        for (const request of body.requests) {
          const filter = request.deleteDeveloperMetadata.dataFilter.developerMetadataLookup;
          const stored = markers.get(filter.metadataId);
          if (stored && stored.metadataValue === filter.metadataValue && stored.metadataKey === filter.metadataKey) markers.delete(filter.metadataId);
        }
        return reply({ replies: [] });
      }
      const entry = body.requests[0].createDeveloperMetadata.developerMetadata;
      if (options.collisionRace) { options.collisionRace = false; markers.set(entry.metadataId, { ...entry, metadataKey: "someone_else", metadataValue: "foreign data" }); return reply({ error: "collision" }, 400); }
      if (options.rejectWithoutMarker) throw new Error("network failed with private request details");
      if (markers.has(entry.metadataId)) return reply({ error: "collision" }, 400);
      markers.set(entry.metadataId, entry);
      const journal = body.requests[1].appendCells;
      assert.equal(journal.sheetId, 3);
      for (const row of journal.rows) values["_ВебОперации"].push(row.values.map((cell: any) => cell.userEnteredValue?.stringValue ?? cell.userEnteredValue?.numberValue ?? ""));
      if (options.loseResponse) { options.loseResponse = false; throw new TypeError("lost response; secret in upstream logs"); }
      return reply({ replies: [] });
    }
    if (url.includes("/values:batchGet?")) {
      const range = new URL(url).searchParams.get("ranges")!;
      const parsed = /^'(.+)'!A(\d+):[A-Z]+(\d+)$/.exec(range)!;
      assert.ok(parsed); assert.ok(Number(parsed[3]) - Number(parsed[2]) < 500);
      if (expireOnSnapshot && parsed[1] === "Клиенты") nowMs += 60_000;
      return reply({ valueRanges: [{ values: values[parsed[1]].slice(Number(parsed[2]) - 1, Number(parsed[3])) }] });
    }
    return reply({ properties: { locale, timeZone: "Asia/Irkutsk" }, sheets: Object.keys(headers).map((title, index) => ({ properties: { sheetId: index, title, gridProperties: { rowCount, columnCount: 16 } } })) });
  };
  const ledger = new GoogleSheetsLedger({ env, fetchImpl: mock, now: () => nowMs });
  return { ledger, calls, markers, batches, values, setRows: (number: number) => { rowCount = number; }, setLocale: (value: string) => { locale = value; }, tokenCalls: () => tokenCalls, advance: (ms: number) => { nowMs += ms; }, expireOnSnapshot: () => { expireOnSnapshot = true; } };
}
const createInput = (): LedgerCommitInput => ({ requestId: "request-unit", payloadHash: hash("create unit"), client, object: currentObject, expenses: [expense] });

test("Sheets access remains unconfigured without a valid RSA service account and never follows token_uri", async () => {
  assert.equal(getLedgerConfiguration({}).configured, false);
  assert.equal(getLedgerConfiguration({ GOOGLE_SERVICE_ACCOUNT_JSON: "broken" }).configured, false);
  assert.equal(getLedgerConfiguration({ GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ ...account, token_uri: "https://attacker.example/token" }) }).configured, false);
  assert.equal(getLedgerConfiguration(env).configured, true);
  let called = false;
  await assert.rejects(new GoogleSheetsLedger({ env: {}, fetchImpl: async () => { called = true; throw new Error(); } }).loadSnapshot(), error => error instanceof LedgerSheetsError && error.code === "sheets_not_configured");
  assert.equal(called, false);
});

test("JWT is signed for the fixed Google OAuth host and token is cached; bounded schema reads return no synthetic rows", async () => {
  const h = harness();
  assert.deepEqual(await h.ledger.loadSnapshot(), { clients: [], objects: [], expenses: [] });
  assert.deepEqual(await h.ledger.loadSnapshot(), { clients: [], objects: [], expenses: [] });
  assert.equal(h.tokenCalls(), 1);
  assert.equal(h.calls.some(c => c.url.includes("key=")), false);
});

test("Changed headers, foreign keys, duplicate IDs, locale and oversized grid fail closed", async () => {
  const h = harness(); h.values["Клиенты"][0][1] = "Другое поле";
  await assert.rejects(h.ledger.loadSnapshot(), error => error instanceof LedgerSheetsError && error.code === "sheets_schema");
  h.values["Клиенты"][0][1] = "Фамилия";
  h.values["Лист1"].push([1, "2026-10-19", "Тестов", "phone", "address", "work", 1000, "", "", "", "", "active", "OBJ-test", "missing-client"]);
  await assert.rejects(h.ledger.loadSnapshot(), LedgerSheetsError);
  h.values["Лист1"].splice(1); h.setRows(10001);
  await assert.rejects(h.ledger.loadSnapshot(), LedgerSheetsError);
  h.setRows(1000); h.setLocale("en_US");
  await assert.rejects(h.ledger.loadSnapshot(), LedgerSheetsError);
  assert.equal(h.batches.length, 0);
});

test("Create is one atomic metadata + client + inserted object + expense batch; text remains literal and tax unknown", async () => {
  const h = harness(); const input = createInput(); input.client = { ...client, surname: '=IMPORTXML("https://example.invalid")' };
  const result = await h.ledger.commit(input);
  assert.deepEqual(result, { duplicate: false, clientId: client.id, objectId: currentObject.id, expenseIds: [expense.id], recordHashes: {
    client: { id: client.id, hash: fingerprintClient(input.client) }, object: { id: currentObject.id, hash: fingerprintObject(currentObject) }, expenses: [{ id: expense.id, hash: fingerprintExpense(expense) }],
  } });
  assert.equal(h.batches.length, 1);
  const requests = h.batches[0].requests;
  assert.deepEqual(requests.map((r: any) => Object.keys(r)[0]), ["createDeveloperMetadata", "appendCells", "appendCells", "insertDimension", "updateCells", "appendCells"]);
  assert.ok(requests[0].createDeveloperMetadata.developerMetadata.metadataId > 0);
  assert.equal(requests[2].appendCells.rows[0].values[1].userEnteredValue.stringValue, input.client.surname);
  assert.equal(requests[2].appendCells.rows[0].values[5].userEnteredValue.stringValue, "2026-10-19");
  assert.deepEqual(requests[3].insertDimension.range, { sheetId: 1, dimension: "ROWS", startIndex: 1, endIndex: 2 });
  const cells = requests[4].updateCells.rows[0].values;
  assert.equal(cells[7].userEnteredValue.formulaValue.includes("COUNTIF"), true);
  assert.equal(cells[7].userEnteredValue.formulaValue.includes(";"), true);
  assert.deepEqual(cells[9], {}); assert.deepEqual(cells[14], {});
  assert.equal(requests[5].appendCells.rows[0].values[5].userEnteredValue.numberValue, 12000.5);
});

test("Replayed operation returns recorded IDs; same request with another payload conflicts without a write", async () => {
  const h = harness(); const input = createInput(); await h.ledger.commit(input);
  const second = await h.ledger.commit(input);
  assert.equal(second.duplicate, true); assert.equal(h.batches.length, 1);
  const lookup = await h.ledger.operationLookup(input.requestId);
  assert.equal(lookup!.payloadHash, input.payloadHash); assert.deepEqual(lookup!.expenseIds, [expense.id]);
  assert.deepEqual(lookup!.recordHashes, second.recordHashes);
  await assert.rejects(h.ledger.commit({ ...input, payloadHash: hash("different") }), error => error instanceof LedgerSheetsError && error.status === 409);
  assert.equal(h.batches.length, 1);
});

test("Lost batch response recovers the atomic marker without adding another expense", async () => {
  const h = harness({ loseResponse: true }); const result = await h.ledger.commit(createInput());
  assert.equal(result.duplicate, true); assert.equal(h.batches.length, 1);
});

test("Uncertain network failure without readback does not try a fresh operation slot", async () => {
  const h = harness({ rejectWithoutMarker: true });
  await assert.rejects(h.ledger.commit(createInput()), error => error instanceof LedgerSheetsError && error.code === "sheets_unavailable" && !error.message.includes("private"));
  assert.equal(h.batches.length, 1); assert.equal(h.markers.size, 0);
});

test("A definitely rejected metadata ID collision probes a new slot and retains the other operation", async () => {
  const h = harness({ collisionRace: true }); const result = await h.ledger.commit(createInput());
  assert.equal(result.duplicate, false); assert.equal(h.batches.length, 2); assert.equal(h.markers.size, 2);
  assert.notEqual(h.batches[0].requests[0].createDeveloperMetadata.developerMetadata.metadataId, h.batches[1].requests[0].createDeveloperMetadata.developerMetadata.metadataId);
});

test("Concurrent retries share one explicit metadata ID and return one committed result", async () => {
  const h = harness(); const results = await Promise.all([h.ledger.commit(createInput()), h.ledger.commit(createInput())]);
  assert.equal(h.markers.size, 1); assert.equal(results.filter(r => !r.duplicate).length, 1);
  assert.deepEqual(results.map(r => r.expenseIds), [[expense.id], [expense.id]]);
});

test("Snapshot keeps object IDs separate and reports unknown totals as null", async () => {
  const h = harness();
  h.values["Клиенты"].push([client.id, client.surname, client.givenName, client.phone, client.comment, "2026-10-19"]);
  h.values["Лист1"].push([1, "2026-10-19", currentObject.clientName, client.phone, currentObject.address, currentObject.workType, 100000, 12000.5, 87999.5, "", "", "active", currentObject.id, client.id, "", currentObject.comment]);
  h.values["Расходы"].push([expense.id, expense.date, expense.objectId, expense.clientId, expense.description, 12000.5, expense.category, expense.comment]);
  const snapshot = await h.ledger.loadSnapshot();
  assert.equal(snapshot.objects[0].recordedExpenseRub, "12000.5");
  assert.equal(snapshot.objects[0].preliminaryProfitRub, "87999.5");
  assert.equal(snapshot.expenses[0].amountRub, "12000.5");
});

test("Old verified markers are collected but journal receipts permanently prevent replay and conflict", async () => {
  const h = harness(); const original = createInput(); await h.ledger.commit(original);
  h.advance(11 * 60_000);
  await h.ledger.commit({ ...createInput(), requestId: "second-request", payloadHash: hash("second"), client: { ...client, id: "CL-second" }, object: { ...currentObject, id: "OBJ-second", clientId: "CL-second" }, expenses: [] });
  assert.equal(h.markers.size, 1);
  assert.equal(h.values["_ВебОперации"].length, 3);
  assert.equal((await h.ledger.commit(original)).duplicate, true);
  await assert.rejects(h.ledger.commit({ ...original, payloadHash: hash("changed old command") }), error => error instanceof LedgerSheetsError && error.status === 409);
  const deletes = h.batches.find(b => b.requests[0].deleteDeveloperMetadata).requests;
  assert.equal(deletes[0].deleteDeveloperMetadata.dataFilter.developerMetadataLookup.metadataKey, "svoi_web_ledger_v1");
  assert.equal(typeof deletes[0].deleteDeveloperMetadata.dataFilter.developerMetadataLookup.metadataValue, "string");
});

test("Recent or unverified markers remain untouched and stale requests cannot commit", async () => {
  const h = harness(); await h.ledger.commit(createInput());
  await h.ledger.commit({ ...createInput(), requestId: "fresh-second", payloadHash: hash("fresh second"), client: { ...client, id: "CL-second" }, object: { ...currentObject, id: "OBJ-second", clientId: "CL-second" }, expenses: [] });
  assert.equal(h.markers.size, 2);
  assert.equal(h.batches.some(b => b.requests[0].deleteDeveloperMetadata), false);
  const expired = harness(); expired.expireOnSnapshot();
  await assert.rejects(expired.ledger.commit(createInput()), error => error instanceof LedgerSheetsError && error.code === "operation_expired");
  assert.equal(expired.batches.length, 0);
});

test("Receipt fingerprints detect financial edits and survive Sheets numeric formatting without hashing running totals", () => {
  const original = fingerprintExpense(expense);
  assert.equal(original, fingerprintExpense({ ...expense, amountRub: "12 000,5" }));
  assert.notEqual(original, fingerprintExpense({ ...expense, amountRub: "12001.50" }));
  assert.notEqual(original, fingerprintExpense({ ...expense, date: "2026-10-20" }));
  assert.notEqual(original, fingerprintExpense({ ...expense, description: "Работа" }));
  assert.notEqual(original, fingerprintExpense({ ...expense, objectId: "OBJ-other" }));
  assert.notEqual(original, fingerprintExpense({ ...expense, clientId: "CL-other" }));
  assert.equal(fingerprintObject(currentObject), fingerprintObject({ ...currentObject, priceRub: "100000.00", recordedExpenseRub: "20000", preliminaryProfitRub: "80000" }));
  assert.notEqual(fingerprintObject(currentObject), fingerprintObject({ ...currentObject, priceRub: "100001" }));
});

test("Durable receipt fingerprints remain available after metadata collection; malformed hashes block lookup", async () => {
  const h = harness(); const original = createInput(); const saved = await h.ledger.commit(original);
  h.advance(11 * 60_000);
  await h.ledger.commit({ ...createInput(), requestId: "gc-followup", payloadHash: hash("gc"), client: { ...client, id: "CL-second" }, object: { ...currentObject, id: "OBJ-second", clientId: "CL-second" }, expenses: [] });
  assert.deepEqual((await h.ledger.operationLookup(original.requestId))!.recordHashes, saved.recordHashes);
  const row = h.values["_ВебОперации"][1]; const corrupted = JSON.parse(String(row[2]));
  corrupted.recordHashes.expenses[0].hash = "invalid hash"; row[2] = JSON.stringify(corrupted);
  await assert.rejects(h.ledger.operationLookup(original.requestId), error => error instanceof LedgerSheetsError && error.code === "sheets_schema");
});
