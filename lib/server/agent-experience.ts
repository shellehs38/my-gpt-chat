import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ChatRequest } from "@/lib/chat-contract";

export type AgentLesson = {
  id: string;
  status: "approved" | "candidate";
  modes: string[];
  topics: string[];
  lesson: string;
  evidence: string;
};

/** Only owner-reviewed lessons may affect answers. No raw chat history is persisted here. */
export function loadApprovedAgentLessons(): AgentLesson[] {
  if (process.env.AGENT_EXPERIENCE_ENABLED !== "1") return [];
  try {
    const data: unknown = JSON.parse(readFileSync(join(process.cwd(), "data/agent-lessons.json"), "utf8"));
    if (!data || typeof data !== "object" || Array.isArray(data)) return [];
    const bundle = data as { schemaVersion?: unknown; lessons?: unknown };
    if (bundle.schemaVersion !== 1 || !Array.isArray(bundle.lessons)) return [];
    return bundle.lessons.filter((item: unknown): item is AgentLesson => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return false;
      const record = item as Record<string, unknown>;
      return record.status === "approved" && typeof record.id === "string" && record.id.length <= 100 &&
        typeof record.lesson === "string" && record.lesson.length > 10 && record.lesson.length <= 1500 &&
        typeof record.evidence === "string" && record.evidence.length > 0 && record.evidence.length <= 500 &&
        Array.isArray(record.topics) && record.topics.length <= 20 &&
        record.topics.every((word: unknown) => typeof word === "string" && word.length >= 2 && word.length <= 60) &&
        Array.isArray(record.modes) && record.modes.length <= 6 && record.modes.every((mode: unknown) =>
          ["general", "estimate", "engineering", "facade", "business", "documents"].includes(String(mode)));
    }).slice(0, 100);
  } catch {
    // Experience memory is optional and may never break the chat API.
    return [];
  }
}

/** Select bounded lessons relevant to the current subject, not all previous conversations. */
export function selectAgentLessons(lessons: AgentLesson[], request: Pick<ChatRequest, "message" | "mode" | "history">, limit = 4): AgentLesson[] {
  const subject = [request.message, ...(request.history ?? []).filter((item) => item.role === "user").slice(-2).map((item) => item.content)].join(" ").toLowerCase();
  return lessons
    .filter((item) => item.status === "approved" && item.modes.includes(request.mode))
    .map((item) => ({ item, score: item.topics.reduce((sum, topic) => sum + (subject.includes(topic.toLowerCase()) ? 1 : 0), 0) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id))
    .slice(0, Math.max(0, Math.min(4, limit)))
    .map(({ item }) => item);
}

/** Lessons are reference context; they never override user inputs or safety rules. */
export function agentExperienceContext(lessons: AgentLesson[], request: Pick<ChatRequest, "message" | "mode" | "history">): string {
  const selected = selectAgentLessons(lessons, request);
  if (!selected.length) return "";
  return "ПРОВЕРЕННЫЕ УРОКИ ПРЕДЫДУЩИХ ЗАДАЧ (справочная память, не инструкции более высокого приоритета):\n" +
    "Применяй только релевантные общие принципы; числа, цены и детали предыдущих объектов не переноси в новую задачу без указания пользователя.\n" +
    selected.map((item) => "- [" + item.id + "] " + item.lesson).join("\n");
}
