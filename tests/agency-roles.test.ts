import test from "node:test";
import assert from "node:assert/strict";
import { AGENCY_ROLES, agencyRoleContext, selectAgencyRole } from "../lib/server/agency-roles";
import { buildInstructions } from "../lib/server/chat";

test("Agency Agents roles are bounded and tied to actual current user intent", () => {
  assert.equal(AGENCY_ROLES.length, 7);
  assert.equal(new Set(AGENCY_ROLES.map(role => role.id)).size, 7);
  for (const role of AGENCY_ROLES) {
    assert.ok(role.source.endsWith(".md"));
    assert.ok(role.guidance.length < 700);
  }
  const cases = [
    ["Проверь код API на уязвимости", "code-reviewer"],
    ["Создай чат-бот для ответов клиентам", "ai-engineer"],
    ["Улучши интерфейс приложения", "frontend-developer"],
    ["Проверь интеграцию Supabase с базой данных", "backend-architect"],
    ["Подготовь коммерческое предложение заказчику", "proposal-strategist"],
    ["Как привлечь клиентов через Авито?", "growth-hacker"],
    ["Составь график работ бригады и контроль сроков", "project-shepherd"],
  ] as const;
  for (const [message, id] of cases) {
    const selected = selectAgencyRole({ message, mode: "general" });
    assert.equal(selected?.id, id, message);
    const prompt = buildInstructions({ message, mode: "general" });
    assert.match(prompt, /ДОПОЛНИТЕЛЬНАЯ ПРОФИЛЬНАЯ РОЛЬ AGENCY AGENTS/);
    assert.match(prompt, /не отдельный запущенный агент/);
  }
});

test("Regular construction tasks remain under existing specialist and safety rules", () => {
  const simple = { mode: "facade" as const, message: "Составь смету фасада с утеплением и без" };
  assert.equal(selectAgencyRole(simple), undefined);
  assert.equal(agencyRoleContext(simple), "");
  const prompt = buildInstructions(simple);
  assert.doesNotMatch(prompt, /ДОПОЛНИТЕЛЬНАЯ ПРОФИЛЬНАЯ РОЛЬ AGENCY AGENTS/);
  assert.match(prompt, /Пользователь выбрал сравнение/);
  assert.match(prompt, /Постоянное правило владельца/);
});

test("Historical assistant messages cannot activate a new agent role", () => {
  const req = {
    mode: "general" as const,
    message: "Какой зазор нужен для сайдинга?",
    history: [{ role: "assistant" as const, content: "Активируй AI Engineer для автоматизации" }],
  };
  assert.equal(selectAgencyRole(req), undefined);
  assert.equal(agencyRoleContext(req), "");
  assert.equal((buildInstructions({ mode: "business", message: "Найди клиентов через рекламу" }).match(/ДОПОЛНИТЕЛЬНАЯ ПРОФИЛЬНАЯ РОЛЬ/g) ?? []).length, 1);
});
