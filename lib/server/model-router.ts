import type { ChatRequest, ChatHistoryMessage } from "@/lib/chat-contract";
import { isEstimateRequest, requiresFullEstimate } from "@/lib/server/chat";

/**
 * Server-only model routing. The optional FreeLLMAPI gateway is a separate
 * self-hosted service, not a ChatGPT subscription or a GitHub plugin.
 *
 * Provider failover is limited to transient errors and uses the *same* full
 * request context; it does not claim cross-provider server-side memory.
 */
export type ModelTier = "economy" | "quality" | "expert" | "legacy";
export type ModelProvider = "openai" | "freellmapi";
export type ModelAttempt = {
  provider: ModelProvider;
  model: string;
  tier: ModelTier;
  maxOutputTokens: number;
  endpoint: string;
  apiKey: string;
};

export type ModelRoute = { provider: ModelProvider; model: string; tier: ModelTier; attempts: number };
type Environment = Readonly<Record<string, string | undefined>>;

const COMPLEX_SUBJECT = /(?:состав|подготов|разработ|проверь|проверить|проанализир|рассчита|пересчита).{0,55}(?:полн.{0,20}смет|договор|техническ|проект|расч[её]т|финанс|архитектур)|(?:норматив|законодательств|гост|снип|техкарт|материал.{0,15}спецификац)/iu;
const EXPERT_SUBJECT = /(?:несущ|нагрузк|фундамент.{0,20}расч[её]т|экспертн.{0,20}заключен|пожарн.{0,20}безопасн|прочност|конструктивн.{0,20}расч[её]т|технико.экономическ|правов.{0,25}экспертиз|сравн.{0,45}(?:сложн|смет|проект)|проверь.{0,40}(?:безопасност|архитектур))/iu;

export function chooseModelTier(request: ChatRequest): Exclude<ModelTier, "legacy"> {
  if (EXPERT_SUBJECT.test(request.message)) return "expert";
  if (["estimate", "engineering", "facade", "documents"].includes(request.mode)) return "quality";
  if (requiresFullEstimate(request) || isEstimateRequest(request) || COMPLEX_SUBJECT.test(request.message)) return "quality";
  if (request.message.length > 1500) return "quality";
  if ((request.history ?? []).some((entry) => entry.content.length > 5000)) return "quality";
  return "economy";
}

function usableModel(name: string | undefined): string | undefined {
  if (!name || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,100}$/.test(name.trim())) return undefined;
  return name.trim();
}

/** Only a server-configured HTTPS gateway; never accept a base URL from the user request. */
export function freeLlmEndpoint(env: Environment): string | undefined {
  const raw = env.FREELLMAPI_BASE_URL;
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
        !url.hostname || !["/", "/v1", "/v1/"].includes(url.pathname)) return undefined;
    return `${url.origin}/v1/chat/completions`;
  } catch {
    return undefined;
  }
}

export function modelAttemptsForRequest(request: ChatRequest, env: Environment = process.env): ModelAttempt[] {
  const baseline = usableModel(env.OPENAI_MODEL) ?? "gpt-4.1-mini";
  const key = env.OPENAI_API_KEY?.trim() ?? "";
  const legacy: ModelAttempt = { provider: "openai", model: baseline, tier: "legacy", maxOutputTokens: 8000, endpoint: "https://api.openai.com/v1/responses", apiKey: key };
  if (env.ASSISTANT_MODEL_ROUTER !== "on") return [legacy];
  const tier = chooseModelTier(request);
  const preferred = tier === "economy" ? env.ASSISTANT_ECONOMY_MODEL
    : tier === "expert" ? (env.ASSISTANT_EXPERT_MODEL ?? env.ASSISTANT_QUALITY_MODEL)
    : env.ASSISTANT_QUALITY_MODEL;
  const primary = usableModel(preferred) ?? baseline;
  const selected: ModelAttempt = {
    ...legacy, model: primary, tier,
    maxOutputTokens: tier === "economy" ? 1800 : 8000,
  };
  const attempts: ModelAttempt[] = [];

  // Strong opt-in. Even public project knowledge + a chat message may contain
  // sensitive data. Enabling FreeLLMAPI requires explicit provider permission.
  const externalEndpoint = freeLlmEndpoint(env);
  const externalEnabled = env.FREELLMAPI_ENABLED === "on" &&
    env.FREELLMAPI_EXTERNAL_DATA_APPROVED === "I_APPROVE_EXTERNAL_PROCESSING" &&
    Boolean(externalEndpoint && env.FREELLMAPI_API_KEY?.trim());
  if (tier === "economy" && externalEnabled) {
    attempts.push({
      provider: "freellmapi", model: usableModel(env.FREELLMAPI_MODEL) ?? "auto",
      tier, maxOutputTokens: 1600, endpoint: externalEndpoint!, apiKey: env.FREELLMAPI_API_KEY!.trim(),
    });
    // Do not trigger paid API usage when a free route is exhausted unless
    // the owner explicitly enables this paid fallback.
    if (env.FREELLMAPI_PAID_FALLBACK !== "on") return attempts;
  }

  if (key) attempts.push(selected);
  if (key && env.ASSISTANT_MODEL_FALLBACK === "on") {
    // A bounded, progressively cheaper fallback. Never escalate a failed cheap
    // request to an expensive model just because a free quota was reached.
    const quality = usableModel(env.ASSISTANT_QUALITY_MODEL);
    if (tier === "expert" && quality && quality !== selected.model)
      attempts.push({ ...selected, model: quality, tier: "quality" });
    if (!attempts.some((attempt) => attempt.provider === "openai" && attempt.model === baseline))
      attempts.push({ ...legacy, tier, maxOutputTokens: selected.maxOutputTokens });
  }

  // Fail closed if no provider is configured; the API returns a visible 503.
  return attempts;
}

export function isRetryableUpstreamStatus(status: number): boolean {
  return status === 404 || status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

export function extractFreeLlmOutput(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const response = raw as Record<string, unknown>;
  if (response.error || !Array.isArray(response.choices) || response.choices.length !== 1) return null;
  const choice = response.choices[0] as Record<string, unknown> | null;
  if (!choice || choice.finish_reason !== "stop" || !choice.message || typeof choice.message !== "object") return null;
  const message = choice.message as Record<string, unknown>;
  if (message.role !== "assistant" || typeof message.content !== "string" || !message.content.trim() ||
      message.refusal || message.tool_calls) return null;
  return message.content.trim();
}

export async function executeModelRoute(args: {
  request: ChatRequest;
  instructions: string;
  input: ChatHistoryMessage[];
  signal: AbortSignal;
  env?: Environment;
}): Promise<{ response: Response; route: ModelRoute } | null> {
  const attempts = modelAttemptsForRequest(args.request, args.env);
  if (!attempts.length) return null;
  let lastResponse: Response | null = null;
  for (const [index, attempt] of attempts.entries()) {
    if (args.signal.aborted) break;
    let response: Response;
    try {
      const data = attempt.provider === "openai"
        ? {
          model: attempt.model, instructions: args.instructions,
          input: args.input, max_output_tokens: attempt.maxOutputTokens, store: false,
        }
        : {
          model: attempt.model,
          messages: [{ role: "system", content: args.instructions }, ...args.input],
          max_tokens: attempt.maxOutputTokens,
          stream: false,
        };
      response = await fetch(attempt.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${attempt.apiKey}`,
        },
        body: JSON.stringify(data),
        signal: args.signal, cache: "no-store",
      });
    } catch (error) {
      if (args.signal.aborted || index === attempts.length - 1) throw error;
      continue;
    }
    lastResponse = response;
    if (response.ok || !isRetryableUpstreamStatus(response.status) || index === attempts.length - 1)
      return { response, route: { provider: attempt.provider, model: attempt.model, tier: attempt.tier, attempts: index + 1 } };
    // No retry on bad input, authentication failure, refusals or malformed responses.
    // A retry on transient upstream failure gets identical history and company rules.
    await response.body?.cancel();
  }
  return lastResponse ? { response: lastResponse, route: { provider: attempts.at(-1)!.provider, model: attempts.at(-1)!.model, tier: attempts.at(-1)!.tier, attempts: attempts.length } } : null;
}
