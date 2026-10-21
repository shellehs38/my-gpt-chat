import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildInstructions } from "../lib/server/chat";
import { constructionKnowledgeContext, loadConstructionKnowledge, MAX_CONSTRUCTION_CONTEXT_CHARACTERS, MAX_CONSTRUCTION_REFERENCES, selectConstructionKnowledge } from "../lib/server/construction-knowledge";
import type { ChatRequest } from "../lib/chat-contract";
const ids = (request: ChatRequest) => selectConstructionKnowledge(request).map((reference) => reference.id);

test("website instructions contain the actual versioned facade reference without its legacy duplicate", () => {
  const request: ChatRequest = { mode: "facade", message: "Какие исходные данные нужны для сметы СФТК фасада с клинкером?" };
  const reference = selectConstructionKnowledge(request).find((item) => item.id === "facade-systems")!;
  assert.ok(reference);
  const source = readFileSync(join(process.cwd(), reference.source), "utf8").replace(/\r\n?/g, "\n").trim() + "\n";
  assert.equal(reference.text, source);
  assert.equal(reference.fingerprint, createHash("sha256").update(source).digest("hex"));
  const prompt = buildInstructions(request);
  assert.ok(prompt.includes(JSON.stringify(reference.text)), "the model receives the source body, not just its name or an availability claim");
  assert.doesNotMatch(prompt, /БАЗОВАЯ КАРТА ФАСАДНЫХ РАБОТ/);
  assert.match(prompt, /Монтаж и демонтаж строительных лесов/);
});

test("short follow-ups inherit only recent user context; a new explicit subject overrides old mode and history", () => {
  const history: NonNullable<ChatRequest["history"]> = [
    { role: "user", content: "Планируем сайдинг на фасаде." },
    { role: "assistant", content: "Далее поговорим о кровле, прибыли и ГОСТ." },
  ];
  assert.deepEqual(ids({ mode: "general", message: "Продолжи", history }), ["facade-systems"]);
  const acceptance = ids({ mode: "general", message: "А как их принимать?", history });
  assert.ok(acceptance.includes("facade-systems"));
  assert.ok(acceptance.includes("quality-safety-logistics"));
  const current = ids({ mode: "facade", message: "Как подготовить фундамент к бетонированию?", history });
  assert.deepEqual(current, ["construction-operations"]);
  assert.doesNotMatch(buildInstructions({ mode: "facade", message: "Как подготовить фундамент к бетонированию?", history }), /БАЗОВАЯ КАРТА ФАСАДНЫХ РАБОТ/);
  const packaging = ids({ mode: "general", message: "А сколько потребуется упаковок?", history });
  assert.ok(packaging.includes("estimating-project-control"));
  assert.ok(packaging.includes("facade-systems"));
});

test("accounting references remain advisory and cannot grant website chat write capabilities", () => {
  const request: ChatRequest = { mode: "business", message: "Проверь план-факт расходов, прибыль и запиши итог в Google Таблицу." };
  const selected = selectConstructionKnowledge(request);
  assert.ok(selected.some((reference) => reference.id === "estimating-project-control"));
  assert.deepEqual(ids({ mode: "estimate", message: "Составь ведомость материалов" }), ["estimating-project-control"]);
  const prompt = buildInstructions(request);
  assert.match(prompt, /в этом чате у тебя нет таких инструментов/);
  assert.match(prompt, /нельзя объявлять выполнение внешних действий или сохранение данных/);
  assert.match(prompt, /не добавляют модели инструментов или полномочий/);
  assert.match(prompt, /Не представляй аналитическую модель данных как существующую схему рабочей таблицы/);
  assert.doesNotMatch(JSON.stringify(loadConstructionKnowledge()), /1-frD3ABf1G|GOOGLE_SERVICE_ACCOUNT_JSON|BEGIN PRIVATE KEY|pricing-40percent/);
});

test("normative questions receive source pointers with honest review date and at most three complete references", () => {
  const request: ChatRequest = { mode: "engineering", message: "Нужны ГОСТ и СП для фасада, пожарная безопасность и контроль бетона, смета и закупки." };
  const references = selectConstructionKnowledge(request);
  assert.equal(references[0].id, "regulatory-source-map");
  assert.equal(references.length, MAX_CONSTRUCTION_REFERENCES);
  assert.ok(references.reduce((total, reference) => total + reference.text.length, 0) <= MAX_CONSTRUCTION_CONTEXT_CHARACTERS);
  const prompt = constructionKnowledgeContext(references);
  assert.match(prompt, /не подтверждение действующей редакции каждого норматива/);
  assert.match(prompt, /Проект не отменяет обязательные требования закона и безопасности/);
  assert.equal(loadConstructionKnowledge().checkedAt, "2026-10-20");
  for (const reference of references) assert.ok(prompt.includes(JSON.stringify(reference.text)), "no truncated or cross-spliced reference bodies");
  assert.deepEqual(ids(request), ids(request), "selection has no random or clock-dependent ranking");
});

test("unrelated conversation does not inherit construction data from assistant messages or stale user tasks", () => {
  const history: NonNullable<ChatRequest["history"]> = [{ role: "user", content: "Рассчитай смету фасада." }, { role: "assistant", content: "ГОСТ, фундамент, контроль качества, склад." }];
  const request: ChatRequest = { mode: "general", message: "Привет! Сколько будет два плюс два?", history };
  assert.deepEqual(selectConstructionKnowledge(request), []);
  assert.equal(constructionKnowledgeContext([]), "");
  assert.doesNotMatch(buildInstructions(request), /СПРАВОЧНАЯ СТРОИТЕЛЬНАЯ БАЗА/);
  assert.deepEqual(ids({ mode: "documents", message: "Напиши поздравление с днём рождения." }), []);
});
