import test from "node:test";
import assert from "node:assert/strict";
import { buildInstructions, isEstimateRequest, isFacadeRequest, requestedFacadeOptions, requiresFullEstimate } from "../lib/server/chat";
import { selectConstructionKnowledge } from "../lib/server/construction-knowledge";
import type { ChatRequest } from "../lib/chat-contract";

const modes = ["general", "estimate", "engineering", "facade", "business", "documents"] as const;
const titles = ["Общий помощник", "Смета и расчёты", "Технологии и конструкции", "Фасады", "Бизнес и продажи", "Документы"];
const facadeHistory: NonNullable<ChatRequest["history"]> = [
  { role: "user", content: "Сравни смету фасада с утеплением и без утепления." },
  { role: "assistant", content: "Есть два варианта. Далее окна, откосы и строительные леса." },
];

test("all six tabs send a distinct role and an appropriate task shape", () => {
  const prompts = modes.map(mode => buildInstructions({ mode, message: "Помоги с задачей" }));
  assert.equal(new Set(prompts).size, 6);
  for (const [index, prompt] of prompts.entries()) {
    assert.match(prompt, new RegExp(`НАЗНАЧЕНИЕ ВКЛАДКИ «${titles[index]}»`));
    assert.equal((prompt.match(/НАЗНАЧЕНИЕ ВКЛАДКИ/g) ?? []).length, 1);
  }
  assert.match(prompts[0], /обычный совет не превращай в смету/);
  assert.match(prompts[1], /фундамент, стены, кровля, отделка, инженерные сети/);
  assert.match(prompts[2], /последовательность строительных работ/);
  assert.match(prompts[3], /крепёж, примыкания и откосы/);
  assert.match(prompts[4], /ответами заказчикам/);
  assert.match(prompts[5], /проект запрошенного документа/);
});

test("new foundation, roof and interior estimates do not inherit facade rules, variants or scaffold from past replies", () => {
  for (const [mode, message] of [
    ["estimate", "Составь полную смету ленточного фундамента"],
    ["estimate", "Составь смету кровли"],
    ["estimate", "Подготовь смету внутренней отделки ванной"],
    ["engineering", "Как подготовить фундамент к бетонированию?"],
    ["facade", "Как подготовить фундамент к бетонированию?"],
  ] as const) {
    const request: ChatRequest = { mode, message, history: facadeHistory, facadeOptions: "both" };
    assert.equal(isFacadeRequest(request), false, message);
    assert.equal(requestedFacadeOptions(request), "auto", message);
    assert.doesNotMatch(buildInstructions(request), /Пользователь выбрал сравнение|Монтаж и демонтаж строительных лесов|БАЗОВАЯ КАРТА ФАСАДНЫХ РАБОТ/, message);
    assert.equal(selectConstructionKnowledge(request).some(reference => reference.id === "facade-systems"), false, message);
  }
});

test("only the current task and recent user context may identify a facade continuation", () => {
  assert.equal(isFacadeRequest({ mode: "general", message: "Привет! Сколько будет два плюс два?", history: facadeHistory }), false);
  assert.equal(isFacadeRequest({ mode: "estimate", message: "Поменяй площадь на 80", history: facadeHistory }), true);
  assert.equal(requestedFacadeOptions({ mode: "estimate", message: "Поменяй площадь на 80", history: facadeHistory }), "both");
  assert.equal(isFacadeRequest({ mode: "estimate", message: "Продолжи", history: [{ role: "assistant", content: "Фасад с утеплением и без" }] }), false);
  assert.equal(isFacadeRequest({ mode: "estimate", message: "Пересчитай", history: [...facadeHistory, { role: "user", content: "Теперь считаем кровлю" }] }), false);
});

test("arithmetic and quantities in estimates tab have calculation form rather than a full financial estimate", () => {
  for (const message of ["Посчитай 125 умножить на 24", "Рассчитай объём бетона для фундамента 10 на 8 метров", "Сколько плитки понадобится на пол ванной 12 м²?", "Определи площадь стены 8 на 3 метра"]) {
    const request: ChatRequest = { mode: "estimate", message };
    assert.equal(isEstimateRequest(request), false, message);
    assert.equal(requiresFullEstimate(request), false, message);
    const prompt = buildInstructions(request);
    assert.match(prompt, /формулу, подстановку, единицы и результат/);
    assert.doesNotMatch(prompt, /Финансовые таблицы оформляй|Столбцы: № \| Наименование/);
  }
  assert.equal(requiresFullEstimate({ mode: "estimate", message: "Составь полную смету фундамента" }), true);
  assert.equal(isEstimateRequest({ mode: "estimate", message: "Посчитай стоимость монтажа перегородки" }), true);
});

test("document drafting and sales advice do not acquire financial-estimate format from words about price", () => {
  for (const request of [
    { mode: "documents", message: "Подготовь договор на ремонт со стоимостью 150000 рублей и приложением сметы" },
    { mode: "documents", message: "Составь акт выполненных работ по смете" },
    { mode: "business", message: "Подготовь коммерческое предложение на фасад с ценой 150000 рублей" },
  ] satisfies ChatRequest[]) {
    assert.equal(isEstimateRequest(request), false);
    assert.equal(requiresFullEstimate(request), false);
    assert.doesNotMatch(buildInstructions(request), /Финансовые таблицы оформляй|Монтаж и демонтаж строительных лесов/);
  }
  const business = buildInstructions({ mode: "business", message: "Как ответить клиенту на возражение о высокой цене?" });
  assert.match(business, /сообщение в этом чате не является записью в таблицу/);
  assert.match(business, /в этом чате у тебя нет таких инструментов/);
  assert.match(business, /выручку, себестоимость, денежный остаток и прибыль/);
});

test("facade estimates retain their domain reference and explicit comparison protection", () => {
  const request: ChatRequest = { mode: "facade", message: "Составь смету", facadeOptions: "both" };
  assert.equal(isFacadeRequest(request), true);
  assert.equal(requestedFacadeOptions(request), "both");
  const prompt = buildInstructions(request);
  assert.match(prompt, /два отдельных варианта/);
  assert.match(prompt, /Монтаж и демонтаж строительных лесов/);
  assert.ok(selectConstructionKnowledge(request).some(reference => reference.id === "facade-systems"));
  assert.equal(isFacadeRequest({ mode: "estimate", message: "Составь смету наружной облицовки дома" }), true);
  assert.equal(isFacadeRequest({ mode: "estimate", message: "Составь смету облицовки ванной плиткой" }), false);
  const technical = buildInstructions({ mode: "facade", message: "Какой зазор нужен за сайдингом?" });
  assert.doesNotMatch(technical, /Финансовые таблицы оформляй/);
});


test("sales budgets and contract-price follow-ups keep their selected task instead of becoming construction estimates", () => {
  const history: NonNullable<ChatRequest["history"]> = [
    { role: "user", content: "Подготовь договор на ремонт. Стоимость по смете — 150000 рублей." },
    { role: "assistant", content: "Проект договора: пункт 2. Цена и порядок оплаты — 150000 рублей." },
  ];
  for (const request of [
    { mode: "business", message: "Составь бюджет рекламы на 20000 рублей" },
    { mode: "business", message: "Посчитай стоимость привлечения клиента и бюджет продаж" },
    { mode: "documents", message: "Уточни стоимость в пункте 2", history },
    { mode: "documents", message: "Пересчитай цену договора после согласованной скидки", history },
  ] satisfies ChatRequest[]) {
    assert.equal(isEstimateRequest(request), false, request.message);
    assert.equal(requiresFullEstimate(request), false, request.message);
    assert.doesNotMatch(buildInstructions(request), /Финансовые таблицы оформляй|Столбцы: № \| Наименование|Монтаж и демонтаж строительных лесов/, request.message);
  }
  for (const mode of ["business", "documents"] as const) {
    const request: ChatRequest = { mode, message: "Составь новую полную смету фундамента" };
    assert.equal(isEstimateRequest(request), true);
    assert.equal(requiresFullEstimate(request), true);
  }
});
