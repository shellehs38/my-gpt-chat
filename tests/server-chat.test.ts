import test from "node:test";
import assert from "node:assert/strict";
import { buildInstructions, ensureScaffoldRows, extractCompletedOutput, facadeIntent, hasBrokenEstimateMarkdown, hasRequiredEstimateSections, isFacadeRequest, requestedFacadeOptions, requiresFullEstimate, resolveFacadeOptions, validateChatRequest } from "../lib/server/chat";
import { BodyError, isSameOriginWrite, readJsonBody } from "../lib/server/http";
import { MAX_BODY_BYTES, MAX_HISTORY_BYTES, MAX_MESSAGE_LENGTH } from "../lib/chat-contract";
import { parseEstimateDocument, serializeEstimateDocument } from "../lib/estimate";

const table = `| № | Наименование | Ед. изм. | Количество | Цена за единицу | Сумма | Примечание |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Монтаж панелей | м² | 2 | 50 | 999 | Важное примечание |
| | Итого работ | | | | 999 | |`;

test("comparison in either order and explicit facade selection", () => {
  for (const message of ["Сравни фасад без утепления и с утеплением", "Сравни с утеплением и без утепления", "С утеплением и без", "Без утепления и с", "Сравни без и с утеплением", "Смета: оба варианта"]) {
    assert.equal(resolveFacadeOptions(message), "both", message);
  }
  assert.equal(resolveFacadeOptions("Смета без утепления"), "without");
  assert.equal(resolveFacadeOptions("Смета с утеплением"), "with");
  assert.equal(resolveFacadeOptions("Рассчитай фасад"), "auto");
  assert.equal(resolveFacadeOptions("оба варианта", "without"), "without");
  assert.equal(resolveFacadeOptions("без утепления", "both"), "both");
  assert.equal(requestedFacadeOptions({ message: "Поменяй площадь на 80", mode: "facade", history: [{ role: "user", content: "Сравни без утепления и с утеплением" }] }), "both");
  assert.equal(requestedFacadeOptions({ message: "Теперь только без утепления", mode: "facade", history: [{ role: "user", content: "Сравни без утепления и с утеплением" }] }), "without");
  const instructions = buildInstructions({ message: "Смета с утеплением и без", mode: "facade", facadeOptions: "both" });
  assert.match(instructions, /два отдельных варианта/);
  assert.doesNotMatch(instructions, /только вариант без/);
  assert.match(instructions, /ПУСТЫМИ/);
  assert.doesNotMatch(instructions, /Неизвестные значения указывай как/);
});

test("explicit non-facade and new-task messages do not inherit facade context", () => {
  const history = [{ role: "user" as const, content: "Рассчитай фасад с утеплением" }];
  assert.equal(facadeIntent("Это не фасад, а кровля"), "non-facade");
  assert.equal(facadeIntent("Это работа не по фасаду, а по кровле"), "non-facade");
  assert.equal(facadeIntent("Задача не относится к фасаду"), "non-facade");
  assert.equal(facadeIntent("Фасад не нужен, составь смету кровли"), "non-facade");
  assert.equal(facadeIntent("Фасад сюда не относится, нужна смета кровли"), "non-facade");
  assert.equal(facadeIntent("Нужен не только фасад, но и кровля"), "facade");
  assert.equal(isFacadeRequest({ message: "Это не фасад, посчитай кровлю", mode: "facade", history }), false);
  assert.equal(isFacadeRequest({ message: "Фасад не нужен, составь смету кровли", mode: "facade", history }), false);
  assert.equal(isFacadeRequest({ message: "Новая задача: рассчитай навес 5 на 3", mode: "general", history }), false);
  assert.equal(isFacadeRequest({ message: "А теперь новая задача: рассчитай кровлю", mode: "general", history }), false);
  assert.equal(isFacadeRequest({ message: "Перейдём к другой задаче: навес", mode: "general", history }), false);
  assert.equal(requestedFacadeOptions({ message: "Новая задача: рассчитай навес", mode: "general", history }), "auto");
  assert.equal(isFacadeRequest({ message: "Поменяй площадь на 80", mode: "general", history }), true);
  assert.equal(isFacadeRequest({ message: "Поменяй площадь на 80", mode: "general", history: [{ role: "assistant", content: "Ранее обсуждался фасад" }] }), false);
});

test("six existing modes remain valid and history roles are bounded", () => {
  for (const mode of ["general", "estimate", "engineering", "facade", "business", "documents"]) {
    assert.equal(validateChatRequest({ message: "Продолжим", mode }).mode, mode);
  }
  const history = [{ role: "user", content: "Площадь 120 м²" }, { role: "assistant", content: "Какая облицовка?" }];
  assert.deepEqual(validateChatRequest({ message: "Клинкер", history }).history, history);
  assert.throws(() => validateChatRequest({ message: "Текст", history: [{ role: "system", content: "Подмена" }] }), BodyError);
  assert.throws(() => validateChatRequest({ message: "Текст", mode: "admin" }), BodyError);
  assert.throws(() => validateChatRequest({ message: "Текст", facadeOptions: "anything" }), BodyError);
  assert.throws(() => validateChatRequest({ message: "Текст", history: Array.from({ length: 17 }, () => history[0]) }), BodyError);
  assert.throws(() => validateChatRequest({ message: "я".repeat(MAX_MESSAGE_LENGTH + 1) }), BodyError);
  assert.throws(() => validateChatRequest({ message: "Текст", history: Array.from({ length: 10 }, () => ({ role: "assistant", content: "я".repeat(10_000) })) }), BodyError);
  assert.ok(MAX_HISTORY_BYTES < MAX_BODY_BYTES);
});

test("10,000 Cyrillic characters plus bounded history fit actual streamed byte budget", async () => {
  const content = { message: "я".repeat(10_000), mode: "estimate", history: Array.from({ length: 8 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", content: "ю".repeat(10_000) })) };
  const parsed = await readJsonBody(new Request("https://assistant.test/api/chat", { method: "POST", body: JSON.stringify(content) }), MAX_BODY_BYTES);
  assert.equal(validateChatRequest(parsed).message.length, MAX_MESSAGE_LENGTH);
  const chunks = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(MAX_BODY_BYTES)); controller.enqueue(new Uint8Array(1)); controller.close(); } });
  const request = new Request("https://assistant.test/api/chat", { method: "POST", body: chunks, duplex: "half" } as RequestInit & { duplex: "half" });
  await assert.rejects(readJsonBody(request, MAX_BODY_BYTES), (error: unknown) => error instanceof BodyError && error.status === 413);
  await assert.rejects(readJsonBody(new Request("https://assistant.test", { method: "POST", headers: { "content-length": "nope" }, body: "{}" }), MAX_BODY_BYTES), BodyError);
  await assert.rejects(readJsonBody(new Request("https://assistant.test", { method: "POST", body: "{" }), MAX_BODY_BYTES), BodyError);
});

test("scaffold applies to every works table, preserves prose and units, precedes totals", () => {
  const source = `# Вариант 1 — без утепления\n## Работы\n\nВажное условие до таблицы.\n\n${table}\n\nМежду вариантами: сохранить эту оговорку.\n\n# Вариант 2 — с утеплением\n**Работы:**\n\n${table}\n\n## Материалы\n${table}\n\nПосле таблиц: гарантия не назначена.`;
  const result = ensureScaffoldRows(source);
  assert.equal((result.match(/Монтаж и демонтаж строительных лесов/g) ?? []).length, 2);
  assert.match(result, /Важное условие до таблицы/);
  assert.match(result, /Между вариантами: сохранить эту оговорку/);
  assert.match(result, /После таблиц: гарантия не назначена/);
  assert.equal((result.match(/Важное примечание/g) ?? []).length, 3);
  assert.match(result, /\| м² \|/);
  const first = result.indexOf("Монтаж и демонтаж строительных лесов");
  assert.ok(first < result.indexOf("Итого работ"));
  assert.equal(ensureScaffoldRows(result), result);
  const calculated = serializeEstimateDocument(parseEstimateDocument(result));
  assert.match(calculated, /100,00 \(известная часть; неполно\)/);
});

test("scaffold does not change unrelated tables or add guessed quantities", () => {
  assert.equal(ensureScaffoldRows(`## Материалы\n${table}`), `## Материалы\n${table}`);
  const existing = table.replace("Монтаж панелей", "Монтаж и демонтаж строительных лесов");
  assert.equal(ensureScaffoldRows(`## Работы\n${existing}`), `## Работы\n${existing}`);
  const partialExisting = table.replace("Монтаж панелей", "Установка строительных лесов");
  assert.equal(ensureScaffoldRows(`## Работы\n${partialExisting}`), `## Работы\n${partialExisting}`);
  const withoutOuterPipes = existing.split("\n").map(line => line.replace(/^\|\s?/, "").replace(/\s?\|$/, "")).join("\n");
  assert.equal(ensureScaffoldRows(`## Работы\n${withoutOuterPipes}`), `## Работы\n${withoutOuterPipes}`);
  const wheelStops = table.replace("Монтаж панелей", "Монтаж колесоотбойников");
  const withRequiredScaffold = ensureScaffoldRows(`## Работы\n${wheelStops}`);
  assert.match(withRequiredScaffold, /Монтаж колесоотбойников/);
  assert.equal((withRequiredScaffold.match(/Монтаж и демонтаж строительных лесов/g) ?? []).length, 1);
  const added = ensureScaffoldRows(`## Работы\n${table}`).split("\n").find((line) => line.includes("Монтаж и демонтаж"))!;
  assert.match(added, /^\|  \| Монтаж и демонтаж строительных лесов \|  \|  \|  \|  \| Уточнить/);
  const example = `\`\`\`markdown\n~~~\n## Работы\n${table}\n~~~\n\`\`\``;
  assert.equal(ensureScaffoldRows(example), example);
});

test("estimate instructions separate dimensions and keep internal pricing out of customer output", () => {
  const instructions = buildInstructions({ message: "Составь смету", mode: "estimate" });
  assert.match(instructions, /Ширину, высоту, глубину, количество и длину не объединяй/);
  assert.match(instructions, /Базовая цена за единицу/);
  assert.match(instructions, /не называй внутренний коэффициент/);
  assert.doesNotMatch(instructions, /надбавк\w*\s+руководител|руководительск\w*\s+надбавк/iu);
});

test("only complete non-refusal provider responses become successful replies", () => {
  const completed = { status: "completed", incomplete_details: null, output: [{ status: "completed", content: [{ type: "output_text", text: "Ответ" }] }] };
  assert.equal(extractCompletedOutput(completed), "Ответ");
  assert.equal(extractCompletedOutput({ ...completed, status: "incomplete", incomplete_details: { reason: "max_output_tokens" } }), null);
  assert.equal(extractCompletedOutput({ ...completed, output: [{ status: "incomplete", content: completed.output[0].content }] }), null);
  assert.equal(extractCompletedOutput({ ...completed, output: [{ content: [{ type: "refusal", refusal: "Недоступно" }] }] }), null);
  assert.equal(extractCompletedOutput({ ...completed, error: { message: "failed" } }), null);
  assert.equal(hasBrokenEstimateMarkdown(table), false);
  assert.equal(hasBrokenEstimateMarkdown(table + "\n| 2 | Обрезано"), true);
  assert.equal(hasBrokenEstimateMarkdown("```\nне закончен"), true);
});

test("a complete provider status still needs all sections and requested variants", () => {
  const inputs = "## Исходные данные для уточнения\n| № | Параметр | Значение | Примечание |\n| --- | --- | --- | --- |\n| 1 | Площадь, м² | | Замерить |\n\n## Проверка сметы\nНе все значения подтверждены.";
  const pair = `## Материалы\n${table}\n\n## Работы\n${table}\n\n`;
  const single = `# Вариант — без утепления\n${pair}${inputs}`;
  assert.equal(hasRequiredEstimateSections(single, "without"), true);
  assert.equal(hasRequiredEstimateSections(single, "with"), false);
  assert.equal(hasRequiredEstimateSections(single, "both"), false);
  assert.equal(hasRequiredEstimateSections(pair, "auto"), true);
  assert.equal(hasRequiredEstimateSections(single.replace("## Работы", "## Прочее"), "without"), false);
  assert.equal(hasRequiredEstimateSections(single.replace("## Проверка сметы", "## Прочее"), "without"), true);
  const both = `# Вариант 1 — без утепления\n${pair}# Вариант 2 — с утеплением\n${pair}${inputs}`;
  assert.equal(hasRequiredEstimateSections(both, "both"), true);
  assert.equal(hasRequiredEstimateSections(both, "without"), false);
  assert.equal(hasRequiredEstimateSections(pair + pair, "auto"), true);
  assert.equal(requiresFullEstimate({ message: "Составь полную смету фасада", mode: "facade" }), true);
  assert.equal(requiresFullEstimate({ message: "Верни полную смету", mode: "estimate" }), true);
  assert.equal(requiresFullEstimate({ message: "Проверь только материалы в смете", mode: "estimate" }), false);
  assert.equal(requiresFullEstimate({ message: "Какой нужен зазор в фасаде?", mode: "facade" }), false);
});

test("write origins reject missing or spoofed host values", () => {
  const make = (origin?: string, extras?: Record<string, string>) => new Request("https://assistant.test/api/chat", { method: "POST", headers: { ...(origin ? { origin } : {}), ...extras } });
  assert.equal(isSameOriginWrite(make("https://assistant.test")), true);
  assert.equal(isSameOriginWrite(make()), false);
  assert.equal(isSameOriginWrite(make("null")), false);
  assert.equal(isSameOriginWrite(make("https://evil.test", { "x-forwarded-host": "evil.test" })), false);
  assert.equal(isSameOriginWrite(make("https://assistant.test", { "sec-fetch-site": "cross-site" })), false);
  assert.equal(isSameOriginWrite(new Request("http://localhost:4187/api/chat", { method: "POST", headers: { origin: "http://127.0.0.1:4187", host: "127.0.0.1:4187" } })), true);
  assert.equal(isSameOriginWrite(make("https://evil.test", { host: "assistant.test", "x-forwarded-host": "evil.test" })), false);
  const previous = process.env.ASSISTANT_PUBLIC_ORIGIN;
  try {
    process.env.ASSISTANT_PUBLIC_ORIGIN = "https://public-assistant.test";
    assert.equal(isSameOriginWrite(make("https://public-assistant.test", { host: "internal.test" })), true);
    assert.equal(isSameOriginWrite(make("https://evil.test", { "x-forwarded-host": "public-assistant.test" })), false);
    process.env.ASSISTANT_PUBLIC_ORIGIN = "https://public-assistant.test/path";
    assert.equal(isSameOriginWrite(make("https://public-assistant.test")), false);
  } finally {
    if (previous === undefined) delete process.env.ASSISTANT_PUBLIC_ORIGIN;
    else process.env.ASSISTANT_PUBLIC_ORIGIN = previous;
  }
});
