import test from "node:test";
import assert from "node:assert/strict";
import { amountFromSource, commandHash, hasExplicitWriteIntent, ledgerId, LedgerDomainError, moneyKopecks, runLedgerCommand, todayIrkutsk, validateExtraction, validateLedgerCommand, validIsoDate, type LedgerExtraction, type LedgerStore } from "../lib/server/ledger";
import type { LedgerCommitInput, LedgerCommitResult, LedgerSnapshot } from "../lib/server/ledger-sheets";
import { fingerprintClient, fingerprintExpense, fingerprintObject } from "../lib/server/ledger-sheets";
import type { LedgerClient, LedgerCommand, LedgerObject } from "../lib/ledger-contract";
import { GET as ledgerGet, POST as ledgerPost } from "../app/api/ledger/route";
import { createSessionToken, getAccessConfig, SESSION_COOKIE } from "../lib/server/auth";
import { resetRateLimitsForTests } from "../lib/server/rate-limit";
const requestId = "11111111-1111-4111-8111-111111111111";
const client: LedgerClient = { id: "CL-1", surname: "Иванов", givenName: "Пётр", phone: "+79140000001", comment: "" };
const object: LedgerObject = { id: "OBJ-1", clientId: "CL-1", clientName: "Иванов Пётр", address: "Иркутск, улица Мира, 1", workType: "Фасад", priceRub: "100000", recordedExpenseRub: null, preliminaryProfitRub: null, status: "В работе", comment: "" };
const expenseExtraction = (amount = "2500"): LedgerExtraction => ({ intent: "addExpenses", query: null, client: null, object: null, expenses: [{ date: null, dateSource: null, description: "Доставка", amountRub: amount, amountSource: amount, category: "", comment: "" }] });
class MemoryStore implements LedgerStore {
 snapshot: LedgerSnapshot = { clients: [structuredClone(client)], objects: [structuredClone(object)], expenses: [] };
 operations = new Map<string, LedgerCommitResult & { payloadHash: string }>();
 commits = 0; loseCommitResponse = false; corruptReadback = false;
 async loadSnapshot() { return structuredClone(this.snapshot); }
 async operationLookup(id: string) { return this.operations.get(id) ?? null; }
 async commit(input: LedgerCommitInput): Promise<LedgerCommitResult> {
  const prior = this.operations.get(input.requestId); if (prior) { assert.equal(prior.payloadHash, input.payloadHash); return { ...prior, duplicate: true }; }
  this.commits++;
  if (input.client) this.snapshot.clients.push(structuredClone(input.client));
  if (input.object) this.snapshot.objects.push(structuredClone(input.object));
  if (input.expenses) this.snapshot.expenses.push(...structuredClone(input.expenses));
  const result = { duplicate: false, clientId: input.client?.id ?? input.object?.clientId ?? input.expenses?.[0]?.clientId, objectId: input.object?.id ?? input.expenses?.[0]?.objectId, expenseIds: input.expenses?.map((row) => row.id) ?? [], recordHashes: { ...(input.client ? { client: { id: input.client.id, hash: fingerprintClient(input.client) } } : {}), ...(input.object ? { object: { id: input.object.id, hash: fingerprintObject(input.object) } } : {}), expenses: (input.expenses ?? []).map((row) => ({ id: row.id, hash: fingerprintExpense(row) })) } };
  this.operations.set(input.requestId, { ...result, payloadHash: input.payloadHash });
  if (this.corruptReadback && this.snapshot.expenses.length) this.snapshot.expenses[0].amountRub = "1";
  if (this.loseCommitResponse) { this.loseCommitResponse = false; throw new Error("Simulated uncertain response"); }
  return result;
 }
}
const message = (text: string, selection = { clientId: "CL-1", objectId: "OBJ-1" }): Extract<LedgerCommand, { kind: "message" }> => ({ kind: "message", message: text, requestId, selection });

test("ledger command parsing, UUIDs and current-message write permission", () => {
 for (const text of ["Внеси расходы: доставка 2500", "Иванов, добавь расход 500", "Создай клиента Иванов", "Запиши объект по адресу Мира 1", "Добавь ещё доставку 500", "По Тестову внеси расходы 500", "Тестов, запиши расходы 500"]) assert.equal(hasExplicitWriteIntent(text), true, text);
 for (const text of ["Иванов", "Покажи расходы", "Как внести расходы", "Если скажу внеси расходы", "Не вноси расходы", "Объясни команду «внеси расходы»", "«внеси расходы»"]) assert.equal(hasExplicitWriteIntent(text), false, text);
 assert.throws(() => validateLedgerCommand({ kind: "message", message: "Иванов", requestId: "bad" }));
 assert.throws(() => validateLedgerCommand({ kind: "message", message: "я".repeat(10001), requestId }));
 assert.throws(() => validateLedgerCommand({ kind: "select", requestId, objectId: "../x" }));
 assert.equal(validateLedgerCommand(message("Иванов")).kind, "message");
 assert.equal(ledgerId("EXP", requestId), ledgerId("EXP", requestId));
 assert.notEqual(ledgerId("EXP", requestId, 0), ledgerId("EXP", requestId, 1));
});

test("exact money and sane dates use Irkutsk, including spoken values", () => {
 assert.equal(moneyKopecks("1 234,56"), 123456n);
 assert.equal(moneyKopecks("0"), null);
 assert.equal(moneyKopecks("-500"), null);
 assert.equal(moneyKopecks("12.345"), null);
 assert.equal(amountFromSource("пять тысяч рублей"), 500000n);
 assert.equal(amountFromSource("пятнадцать тысяч двести рублей 50 копеек"), 1520050n);
 assert.equal(amountFromSource("2,5 тыс."), 250000n);
 assert.equal(amountFromSource("один два рубля"), null);
 assert.equal(todayIrkutsk(Date.parse("2026-10-17T17:00:00Z")), "2026-10-18");
 assert.equal(validIsoDate("2026-02-29"), false);
 assert.equal(validIsoDate("2024-02-29"), true);
 assert.equal(validIsoDate("2026-13-01"), false);
});

test("surname lookup is read only and does not use a model; namesakes require a choice", async () => {
 const store = new MemoryStore(); let modelCalls = 0;
 const dependencies = { store, extract: async () => { modelCalls++; return expenseExtraction(); } };
 const result = await runLedgerCommand(message("Иванов", {} as never), dependencies);
 assert.equal(result.selection.objectId, "OBJ-1"); assert.equal(modelCalls, 0); assert.equal(store.commits, 0);
 store.snapshot.clients.push({ ...client, id: "CL-2", givenName: "Иван" });
 const duplicate = await runLedgerCommand(message("Иванов", {} as never), dependencies);
 assert.equal(duplicate.needsChoice, "client"); assert.equal(duplicate.clients?.length, 2); assert.deepEqual(duplicate.selection, {});
});

test("multiple objects need explicit selection; foreign object never receives a write", async () => {
 const store = new MemoryStore(); store.snapshot.objects.push({ ...object, id: "OBJ-2", address: "Иркутск, Ленина, 2" });
 const pending = await runLedgerCommand(message("Внеси расходы: доставка 2500", { clientId: "CL-1" } as never), { store, extract: async () => expenseExtraction() });
 assert.equal(pending.needsChoice, "object"); assert.equal(store.commits, 0);
 store.snapshot.clients.push({ ...client, id: "CL-2" });
 await assert.rejects(runLedgerCommand(message("Внеси расходы: доставка 2500", { clientId: "CL-2", objectId: "OBJ-1" }), { store, extract: async () => expenseExtraction() }), LedgerDomainError);
 assert.equal(store.commits, 0);
});

test("missing or hallucinated amount and malformed model extraction never write", async () => {
 const store = new MemoryStore();
 const missing = expenseExtraction(); missing.expenses[0].amountRub = null; missing.expenses[0].amountSource = null;
 const reply = await runLedgerCommand(message("Внеси расходы: доставка"), { store, extract: async () => missing });
 assert.equal(reply.applied, false); assert.match(reply.message, /Уточните сумму/);
 const invented = await runLedgerCommand(message("Внеси расходы: доставка 2500"), { store, extract: async () => expenseExtraction("9999") });
 assert.equal(invented.applied, false); assert.equal(store.commits, 0);
 assert.throws(() => validateExtraction({ intent: "addExpenses", expenses: "not-array" }), LedgerDomainError);
 const noPermission = await runLedgerCommand(message("Покажи расходы 2500"), { store, extract: async () => expenseExtraction() });
 assert.equal(noPermission.applied, false); assert.equal(store.commits, 0);
 for (const command of ["Покажи пример команды: внеси расход материалы 2500", "Не добавляй расходы, только объясни 2500", "Как записать расходы 2500?"]) {
  const guarded = await runLedgerCommand(message(command), { store, extract: async () => expenseExtraction() });
  assert.equal(guarded.applied, false, command); assert.equal(store.commits, 0, command);
 }
});

test("multiple expenses save exact amounts once, read back, and survive a lost response", async () => {
 const store = new MemoryStore();
 const extraction = expenseExtraction(); extraction.expenses.push({ ...extraction.expenses[0], description: "Крепёж", amountRub: "1200.50", amountSource: "1200,50" });
 const command = message("Внеси расходы: доставка 2500, крепёж 1200,50"); let modelCalls = 0;
 const dependencies = { store, extract: async () => { modelCalls++; return extraction; }, now: () => Date.parse("2026-10-17T17:00:00Z") };
 store.loseCommitResponse = true;
 await assert.rejects(runLedgerCommand(command, dependencies));
 const recovered = await runLedgerCommand(command, dependencies);
 assert.equal(recovered.applied, true); assert.equal(recovered.operationId, requestId);
 assert.equal(recovered.expenses?.length, 2); assert.equal(recovered.expenses?.[0].date, "2026-10-18");
 assert.deepEqual(recovered.expenses?.map((item) => item.amountRub), ["2500.00", "1200.50"]);
 assert.equal(store.commits, 1); assert.equal(modelCalls, 1);
 await assert.rejects(runLedgerCommand({ ...command, message: "Внеси расходы: другая 2500" }, dependencies), LedgerDomainError);
 assert.equal(store.commits, 1);
});

test("matched existing client plus new object is atomic and recovers without duplicating client", async () => {
 const store = new MemoryStore();
 const extraction: LedgerExtraction = { intent: "createClientObject", query: "Иванов", client: { surname: "Иванов", givenName: "Пётр", phone: null, comment: null }, object: { address: "Мира 9", workType: "Фасад", priceRub: "100000", priceSource: "100000", status: "в работе", comment: null }, expenses: [] };
 const command = message("Создай объект Мира 9 для клиента Иванов Пётр, Фасад, цена 100000, статус в работе", {} as never);
 store.loseCommitResponse = true;
 await assert.rejects(runLedgerCommand(command, { store, extract: async () => extraction }));
 const result = await runLedgerCommand(command, { store, extract: async () => { throw new Error("must not call model on recovery"); } });
 assert.equal(result.applied, true); assert.equal(store.snapshot.clients.length, 1); assert.equal(store.snapshot.objects.length, 2);
 assert.equal(result.currentObject?.priceRub, "100000.00"); assert.equal(result.currentObject?.preliminaryProfitRub, null);
 assert.equal(result.currentObject?.status, "в работе");
 assert.equal(result.currentObject?.id, ledgerId("OBJ", requestId));
 assert.equal(store.operations.get(requestId)?.payloadHash, commandHash(command));
});

test("replay detects manual changes to amount, date, description and never adds another row", async () => {
 for (const change of [
  { amountRub: "1" }, { date: "2026-01-01" }, { description: "Изменено вручную" }, { category: "Другая категория" }, { comment: "Новый комментарий" },
 ]) {
  const store = new MemoryStore(); const command = message("Внеси расходы: доставка 2500");
  await runLedgerCommand(command, { store, extract: async () => expenseExtraction() });
  Object.assign(store.snapshot.expenses[0], change);
  await assert.rejects(runLedgerCommand(command, { store, extract: async () => { throw new Error("replay must not call model"); } }), (error: unknown) => error instanceof LedgerDomainError && error.status === 409);
  assert.equal(store.commits, 1); assert.equal(store.snapshot.expenses.length, 1); assert.deepEqual(Object.fromEntries(Object.keys(change).map((key) => [key, (store.snapshot.expenses[0] as unknown as Record<string, unknown>)[key]])), change);
 }
 const store = new MemoryStore(); const command = message("Внеси расходы: доставка 2500");
 await runLedgerCommand(command, { store, extract: async () => expenseExtraction() });
 store.snapshot.expenses[0].amountRub = "2500";
 assert.equal((await runLedgerCommand(command, { store })).applied, true, "equivalent money formatting is not a manual financial change");
 const legacy = store.operations.get(requestId)!; delete legacy.recordHashes;
 await assert.rejects(runLedgerCommand(command, { store }), (error: unknown) => error instanceof LedgerDomainError && error.status === 409);
 assert.equal(store.commits, 1);
});

test("new object status must be explicit, and price changes invalidate replay fingerprints", async () => {
 const extraction: LedgerExtraction = { intent: "createClientObject", query: "Иванов", client: null, object: { address: "Мира 9", workType: null, priceRub: "100000", priceSource: "100000", status: "Завершён", comment: null }, expenses: [] };
 const command = message("Создай объект Мира 9 для клиента Иванов, цена 100000", {} as never);
 const store = new MemoryStore();
 await assert.rejects(runLedgerCommand(command, { store, extract: async () => extraction }), LedgerDomainError);
 assert.equal(store.commits, 0);
 extraction.object!.status = null;
 const saved = await runLedgerCommand(command, { store, extract: async () => extraction });
 assert.equal(saved.currentObject?.status, "Новый");
 const actual = store.snapshot.objects.find((row) => row.id === ledgerId("OBJ", requestId))!;
 actual.recordedExpenseRub = "500"; actual.preliminaryProfitRub = "99500";
 assert.equal((await runLedgerCommand(command, { store })).applied, true, "computed aggregates can change as later expenses are added");
 actual.priceRub = "999";
 await assert.rejects(runLedgerCommand(command, { store }), (error: unknown) => error instanceof LedgerDomainError && error.status === 409);
 assert.equal(store.commits, 1); assert.equal(actual.priceRub, "999");
});

test("actual readback mismatch is never announced as saved", async () => {
 const store = new MemoryStore(); store.corruptReadback = true;
 await assert.rejects(runLedgerCommand(message("Внеси расходы: доставка 2500"), { store, extract: async () => expenseExtraction() }), (error: unknown) => error instanceof LedgerDomainError && error.status === 503);
});

test("ledger route fails closed without Google credentials before any model or external call", async () => {
 const names = ["ASSISTANT_ACCESS_PASSWORD", "ASSISTANT_SESSION_SECRET", "GOOGLE_SERVICE_ACCOUNT_JSON", "OPENAI_API_KEY"];
 const before = Object.fromEntries(names.map((name) => [name, process.env[name]]));
 const fetchBefore = globalThis.fetch; let calls = 0;
 try {
  process.env.ASSISTANT_ACCESS_PASSWORD = "test-ledger-owner-password";
  process.env.ASSISTANT_SESSION_SECRET = "test-ledger-session-secret-at-least-32-characters";
  process.env.OPENAI_API_KEY = "test-key-not-real"; delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  globalThis.fetch = async () => { calls++; throw new Error("external calls forbidden in this test"); };
  resetRateLimitsForTests();
  const token = createSessionToken(getAccessConfig()!);
  const headers = { cookie: `${SESSION_COOKIE}=${token}`, origin: "https://assistant.test", "content-type": "application/json" };
  const status = await ledgerGet(new Request("https://assistant.test/api/ledger", { headers }));
  assert.equal(status.status, 200); assert.equal((await status.json()).configured, false);
  const unavailable = await ledgerPost(new Request("https://assistant.test/api/ledger", { method: "POST", headers, body: JSON.stringify(message("Внеси расходы: доставка 2500")) }));
  assert.equal(unavailable.status, 503); assert.equal(calls, 0);
  const denied = await ledgerGet(new Request("https://assistant.test/api/ledger")); assert.equal(denied.status, 401);
  const crossOrigin = await ledgerPost(new Request("https://assistant.test/api/ledger", { method: "POST", headers: { ...headers, origin: "https://other.test" }, body: "{}" }));
  assert.equal(crossOrigin.status, 403); assert.equal(calls, 0);
 } finally {
  globalThis.fetch = fetchBefore; resetRateLimitsForTests();
  for (const name of names) { if (before[name] === undefined) delete process.env[name]; else process.env[name] = before[name]; }
 }
});
