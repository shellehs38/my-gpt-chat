import test from "node:test";
import assert from "node:assert/strict";
import { agentExperienceContext, selectAgentLessons, type AgentLesson } from "../lib/server/agent-experience";

const examples: AgentLesson[] = [
  { id: "net-area", status: "approved", modes: ["facade", "estimate"], topics: ["облицовк", "проём"], lesson: "Не вычитать проёмы повторно из чистой площади облицовки.", evidence: "Исправленный расчёт" },
  { id: "draft", status: "candidate", modes: ["facade"], topics: ["облицовк"], lesson: "Непроверенная гипотеза, не использовать.", evidence: "Автоматический черновик" },
  { id: "logo", status: "approved", modes: ["documents"], topics: ["логотип", "документ"], lesson: "Проверить настоящий графический логотип в документе.", evidence: "Правило владельца" },
];

test("selects only approved relevant lessons for a fresh task", () => {
  const selected = selectAgentLessons(examples, { message: "Посчитай площадь облицовки с проёмами", mode: "facade", history: [] });
  assert.deepEqual(selected.map((item) => item.id), ["net-area"]);
});

test("ignores unrelated modes and candidate lessons", () => {
  assert.deepEqual(selectAgentLessons(examples, { message: "Покажи смету", mode: "business", history: [] }), []);
  assert.doesNotMatch(agentExperienceContext(examples, { message: "Облицовка фасада", mode: "facade", history: [] }), /Непроверенная гипотеза/);
});

test("maintains project context only for task-relevant user follow-ups", () => {
  const request = { message: "Проверь", mode: "facade" as const, history: [{ role: "user" as const, content: "Площадь облицовки, проёмы" }] };
  assert.match(agentExperienceContext(examples, request), /Не вычитать проёмы/);
});

test("sets a strict per-task memory budget and does not override numeric inputs", () => {
  const context = agentExperienceContext(examples, { message: "Нужен логотип в документе", mode: "documents", history: [] });
  assert.match(context, /числа, цены и детали предыдущих объектов не переноси/);
  assert.match(context, /графический логотип/);
});
