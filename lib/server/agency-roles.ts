import type { ChatRequest } from "@/lib/chat-contract";

/**
 * A small, reviewed adaptation of specialist workflow prompts from
 * https://github.com/msitarzewski/agency-agents (MIT, 2025 AgentLand Contributors).
 * No external code or tool execution. This adds only response guidance.
 * See docs/AGENCY_AGENTS_INTEGRATION.md for source mappings and constraints.
 */
export type AgencyRoleId =
  | "frontend-developer"
  | "code-reviewer"
  | "ai-engineer"
  | "backend-architect"
  | "proposal-strategist"
  | "growth-hacker"
  | "project-shepherd";

export type AgencyRole = {
  id: AgencyRoleId;
  name: string;
  source: string;
  guidance: string;
};

export const AGENCY_ROLES: readonly AgencyRole[] = [
  {
    id: "frontend-developer",
    name: "Frontend Developer",
    source: "engineering/engineering-frontend-developer.md",
    guidance: "Для интерфейса определи сценарий пользователя, мобильную доступность, состояния форм и ошибок. Отделяй предложенный код от реально внедрённого. Укажи критерии проверки удобства и доступности.",
  },
  {
    id: "code-reviewer",
    name: "Code Reviewer",
    source: "engineering/engineering-code-reviewer.md",
    guidance: "При анализе кода проверяй корректность, безопасность, совместимость, тесты и производительность. Разделяй критичные дефекты и улучшения; связывай выводы с конкретными доказательствами. Не утверждай, что выполнил тесты, если они не запускались.",
  },
  {
    id: "ai-engineer",
    name: "AI Engineer",
    source: "engineering/engineering-ai-engineer.md",
    guidance: "Для ИИ и автоматизации сформулируй входные данные, этапы обработки, права доступа, ошибки, контроль качества и способ проверки результата. Предпочитай минимальную работоспособную схему; не обещай интеграцию с неподключёнными сервисами.",
  },
  {
    id: "backend-architect",
    name: "Backend Architect",
    source: "engineering/engineering-backend-architect.md",
    guidance: "Для серверной архитектуры и интеграций сначала определи источник данных, контракт API, авторизацию, идемпотентность, угрозы и отказоустойчивость. Не предлагай переносить рабочие данные без плана миграции, тестов и отката.",
  },
  {
    id: "proposal-strategist",
    name: "Proposal Strategist",
    source: "sales/sales-proposal-strategist.md",
    guidance: "При подготовке коммерческого предложения выдели задачу клиента, проверяемые преимущества, состав и границы работ, цену и следующий шаг. Не выдумывай выполненные объекты, гарантии, скидки или подтверждённые результаты.",
  },
  {
    id: "growth-hacker",
    name: "Growth Hacker",
    source: "marketing/marketing-growth-hacker.md",
    guidance: "Для привлечения заказов предложи измеримый эксперимент: канал, аудитория, гипотеза, бюджет, показатель отклика и срок проверки. Разделяй потенциальные и подтверждённые результаты; не обещай гарантированную конверсию.",
  },
  {
    id: "project-shepherd",
    name: "Project Shepherd",
    source: "project-management/project-management-project-shepherd.md",
    guidance: "Для организации проекта выдели этапы, ответственных, зависимости, сроки, контрольные точки, риски и критерии приёмки. Не считай план согласованным и не заявляй о назначении задач без внешнего подтверждения.",
  },
] as const;

const patterns: ReadonlyArray<{ id: AgencyRoleId; regex: RegExp }> = [
  { id: "frontend-developer", regex: /интерфейс|кнопк|форм[ыу].{0,18}(?:сайт|приложен)|дизайн.{0,20}(?:сайт|приложен)|адаптив|фронтенд|в[её]рстк|\b(?:frontend|ux|ui)\b/iu },
  { id: "code-reviewer", regex: /провер.{0,18}код|ревью.{0,12}код|ошибк.{0,22}(?:код|сайт|api|программ)|(?:^|\W)(?:pull request|code review)(?:\W|$)/iu },
  { id: "ai-engineer", regex: /чат[ -]?бот|автоматизац|ии[ -]?помощник|искусственн.{0,8}интеллект|нейросет|\b(?:gpt|llm|rag)\b/iu },
  { id: "backend-architect", regex: /сервер|баз[аеуы].{0,10}данн|интеграц|авторизац|\b(?:api|backend|supabase|postgresql|vercel|webhook)\b/iu },
  { id: "proposal-strategist", regex: /коммерческ.{0,18}предложен|(?:^|\W)кп(?:\W|$)|тендер|предложен.{0,20}(?:заказчик|клиент)/iu },
  { id: "growth-hacker", regex: /реклам|маркетинг|привлеч.{0,18}(?:клиент|заказ)|поиск.{0,18}(?:клиент|заказ)|лидогенерац|продвижен|конверси|воронк|\bavito\b|авито/iu },
  { id: "project-shepherd", regex: /график.{0,12}работ|срок.{0,18}(?:работ|объект|строительств)|организац.{0,15}работ|план.{0,16}(?:проекта|объекта|строительств)|делегир|контрол.{0,15}(?:бригад|сотрудник|этап)|управлен.{0,10}(?:проект|команд)/iu },
];

/** Current user request determines the role; past model output cannot activate one. */
export function selectAgencyRole(request: ChatRequest): AgencyRole | undefined {
  const message = request.message.slice(0, 10_000);
  const match = patterns.find(({ regex }) => regex.test(message));
  return match ? AGENCY_ROLES.find((role) => role.id === match.id) : undefined;
}

/** A bounded, subordinate specialist lens; never grants tools or autonomy. */
export function agencyRoleContext(request: ChatRequest): string {
  const role = selectAgencyRole(request);
  if (!role) return "";
  return [
    `ДОПОЛНИТЕЛЬНАЯ ПРОФИЛЬНАЯ РОЛЬ AGENCY AGENTS: ${role.name}.`,
    role.guidance,
    "Это методический подход к ответу, не отдельный запущенный агент и не новая функция сервиса. Он не отменяет инструкции строительной компании, ограничения безопасности, проверку нормативов и условия пользователя. У роли нет доступа к GitHub, почте, таблицам, интернету или другим сервисам внутри чата сайта без отдельной реальной интеграции.",
  ].join(" ");
}
