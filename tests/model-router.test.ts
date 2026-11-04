import test from "node:test";
import assert from "node:assert/strict";
import { chooseModelTier, executeModelRoute, extractFreeLlmOutput, freeLlmEndpoint, omniRouteEndpoint, modelAttemptsForRequest } from "../lib/server/model-router";
import type { ChatRequest } from "../lib/chat-contract";

const general: ChatRequest = { mode: "general", message: "Привет" };
const complex: ChatRequest = { mode: "estimate", message: "Составь полную смету фасада" };
const configured: Record<string, string | undefined> = {
  OPENAI_API_KEY: "test-openai-only",
  OPENAI_MODEL: "gpt-4.1-mini",
  ASSISTANT_MODEL_ROUTER: "on",
  ASSISTANT_ECONOMY_MODEL: "gpt-6-luna",
  ASSISTANT_QUALITY_MODEL: "gpt-6.1-terra",
  ASSISTANT_EXPERT_MODEL: "gpt-6.1-sol",
};

test("router remains disabled by default and retains exact existing provider call", () => {
  assert.deepEqual(modelAttemptsForRequest(general, { OPENAI_API_KEY: "test", OPENAI_MODEL: "gpt-4.1-mini" }), [{
    provider: "openai", model: "gpt-4.1-mini", tier: "legacy",
    maxOutputTokens: 8000, endpoint: "https://api.openai.com/v1/responses", apiKey: "test",
  }]);
  assert.equal(chooseModelTier(general), "economy");
  assert.equal(chooseModelTier(complex), "quality");
  assert.equal(chooseModelTier({ mode: "engineering", message: "Проверь расчёт несущей конструкции на нагрузку" }), "expert");
  assert.equal(chooseModelTier({ mode: "business", message: "Какая норма пожарной безопасности?" }), "expert");
  assert.equal(chooseModelTier({ mode: "documents", message: "Напиши договор" }), "quality");
  assert.equal(chooseModelTier({ mode: "general", message: "Рассчитай нагрузки на несущую конструкцию" }), "expert");
  assert.equal(modelAttemptsForRequest(general, configured)[0].model, "gpt-6-luna");
  assert.equal(modelAttemptsForRequest(complex, configured)[0].model, "gpt-6.1-terra");
  assert.equal(modelAttemptsForRequest(complex, configured)[0].maxOutputTokens, 8000);
  assert.equal(modelAttemptsForRequest({ mode: "engineering", message: "Рассчитай нагрузку на фундамент" }, configured)[0].model, "gpt-6.1-sol");
  assert.equal(modelAttemptsForRequest(general, configured)[0].maxOutputTokens, 1800);
});

test("invalid external endpoints, missing keys or missing approval cannot receive chat or project context", () => {
  for (const value of ["http://router.example/v1", "https://user:pass@router.example/v1", "https://router.example/v1?key=x",
    "https://router.example/admin", "https://router.example/#fragment", "not-a-url"]) {
    assert.equal(freeLlmEndpoint({ FREELLMAPI_BASE_URL: value }), undefined, value);
  }
  assert.equal(freeLlmEndpoint({ FREELLMAPI_BASE_URL: "https://router.example/v1" }), "https://router.example/v1/chat/completions");
  const base = { ...configured, FREELLMAPI_ENABLED: "on", FREELLMAPI_BASE_URL: "https://router.example/v1", FREELLMAPI_API_KEY: "test-gateway-key" };
  assert.deepEqual(modelAttemptsForRequest(general, base).map(a => a.provider), ["openai"]);
  assert.deepEqual(modelAttemptsForRequest(general, { ...base, FREELLMAPI_EXTERNAL_DATA_APPROVED: "yes" }).map(a => a.provider), ["openai"]);
  assert.deepEqual(modelAttemptsForRequest(general, { ...base, FREELLMAPI_EXTERNAL_DATA_APPROVED: "I_APPROVE_EXTERNAL_PROCESSING" }).map(a => a.provider), ["freellmapi"]);
  assert.deepEqual(modelAttemptsForRequest(complex, { ...base, FREELLMAPI_EXTERNAL_DATA_APPROVED: "I_APPROVE_EXTERNAL_PROCESSING" }).map(a => a.provider), ["openai"]);
});

test("routing to another provider receives the exact same user history and full project instructions", async () => {
  const env = { ...configured, FREELLMAPI_ENABLED: "on", FREELLMAPI_BASE_URL: "https://router.example/v1",
    FREELLMAPI_API_KEY: "test-gateway-key", FREELLMAPI_EXTERNAL_DATA_APPROVED: "I_APPROVE_EXTERNAL_PROCESSING",
    FREELLMAPI_PAID_FALLBACK: "on" };
  const history = [{ role: "user" as const, content: "Фасад 100 м²" }, { role: "assistant" as const, content: "Какая облицовка?" },
    { role: "user" as const, content: "Металлосайдинг" }];
  const input = [...history, { role: "user" as const, content: "Продолжим" }];
  const instructions = "Фирменный логотип ООО СВОИ ЛЮДИ. Память Codebase Memory. Не выдумывай цены.";
  const actual: Array<{ url: string; headers: Headers; body: Record<string, unknown> }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    actual.push({ url: String(url), headers: new Headers(options?.headers), body: JSON.parse(String(options?.body)) });
    if (actual.length === 1) return new Response("rate limited", { status: 429 });
    return new Response(JSON.stringify({ status: "completed", output: [{ content: [{ type: "output_text", text: "Ответ" }] }] }), { status: 200 });
  };
  try {
    const result = await executeModelRoute({ request: general, instructions, input, signal: new AbortController().signal, env });
    assert.equal(result?.route.model, "gpt-6-luna");
    assert.equal(result?.route.provider, "openai");
    assert.equal(result?.route.attempts, 2);
    assert.equal(actual.length, 2);
    assert.equal(actual[0].url, "https://router.example/v1/chat/completions");
    assert.equal(actual[1].url, "https://api.openai.com/v1/responses");
    assert.equal(actual[0].headers.get("authorization"), "Bearer test-gateway-key");
    assert.equal(actual[1].headers.get("authorization"), "Bearer test-openai-only");
    assert.deepEqual(actual[0].body.messages, [{ role: "system", content: instructions }, ...input]);
    assert.equal(actual[1].body.instructions, instructions);
    assert.deepEqual(actual[1].body.input, input);
    assert.equal(actual[1].body.store, false);
  } finally { globalThis.fetch = originalFetch; }
});

test("no unexpected paid fallback after FreeLLMAPI quota failure", async () => {
  const env = { ...configured, FREELLMAPI_ENABLED: "on", FREELLMAPI_BASE_URL: "https://router.example/v1",
    FREELLMAPI_API_KEY: "test-gateway-key", FREELLMAPI_EXTERNAL_DATA_APPROVED: "I_APPROVE_EXTERNAL_PROCESSING" };
  const old = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response("quota reached", { status: 429 }); };
  try {
    const result = await executeModelRoute({ request: general, instructions: "Rules", input: [{ role: "user", content: "Message" }],
      signal: new AbortController().signal, env });
    assert.equal(result?.response.status, 429);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = old; }
});

test("non-retryable provider responses are not silently forwarded or retried", async () => {
  const env = { ...configured, ASSISTANT_MODEL_FALLBACK: "on" };
  const old = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response("bad credentials", { status: 401 }); };
  try {
    const result = await executeModelRoute({ request: general, instructions: "Rules", input: [{ role: "user", content: "Message" }],
      signal: new AbortController().signal, env });
    assert.equal(result?.response.status, 401);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = old; }
});

test("FreeLLM completion results must be complete and non-refusal", () => {
  const valid = { choices: [{ finish_reason: "stop", message: { role: "assistant", content: "Готово" } }] };
  assert.equal(extractFreeLlmOutput(valid), "Готово");
  assert.equal(extractFreeLlmOutput({ ...valid, choices: [{ ...valid.choices[0], finish_reason: "length" }] }), null);
  assert.equal(extractFreeLlmOutput({ ...valid, choices: [{ finish_reason: "stop", message: { role: "assistant", content: "Готово", tool_calls: [1] } }] }), null);
  assert.equal(extractFreeLlmOutput({ error: "failed", ...valid }), null);
});


test("expert routing falls back to cheaper models and ultimately existing baseline", async () => {
  const env = { ...configured, ASSISTANT_MODEL_FALLBACK: "on" };
  const req: ChatRequest = { mode: "engineering", message: "Рассчитай нагрузки на несущую конструкцию" };
  assert.deepEqual(modelAttemptsForRequest(req, env).map(a => a.model), ["gpt-6.1-sol", "gpt-6.1-terra", "gpt-4.1-mini"]);
  assert.deepEqual(modelAttemptsForRequest(general, env).map(a => a.model), ["gpt-6-luna", "gpt-4.1-mini"]);
  const fetch0 = globalThis.fetch;
  const calls: Array<{ model: string; instructions: string }> = [];
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(String(options?.body));
    calls.push({ model: body.model, instructions: body.instructions });
    return calls.length === 1 ? new Response("model unavailable", { status: 404 })
      : new Response(JSON.stringify({ status: "completed", output: [{ content: [{ type: "output_text", text: "Ответ" }] }] }), { status: 200 });
  };
  try {
    const result = await executeModelRoute({ request: req, instructions: "Правила СВОИ ЛЮДИ", input: [{ role: "user", content: req.message }],
      signal: new AbortController().signal, env });
    assert.equal(result?.route.model, "gpt-6.1-terra");
    assert.equal(result?.route.attempts, 2);
    assert.deepEqual(calls.map(c => c.model), ["gpt-6.1-sol", "gpt-6.1-terra"]);
    assert.ok(calls.every(c => c.instructions === "Правила СВОИ ЛЮДИ"));
  } finally { globalThis.fetch = fetch0; }
});

test("OmniRoute must never receive data without its own approval, key, and HTTPS endpoint", () => {
  const base = {
    ...configured,
    OMNIROUTE_BASE_URL: "https://omni.example/v1",
    OMNIROUTE_ENABLED: "on",
    OMNIROUTE_API_KEY: "test-omniroute",
  };
  assert.equal(omniRouteEndpoint({ OMNIROUTE_BASE_URL: "https://omni.example/v1" }), "https://omni.example/v1/chat/completions");
  assert.equal(omniRouteEndpoint({ OMNIROUTE_BASE_URL: "http://omni.example/v1" }), undefined);
  assert.equal(omniRouteEndpoint({ OMNIROUTE_BASE_URL: "https://omni.example/admin" }), undefined);
  assert.deepEqual(modelAttemptsForRequest(general, base).map(x => x.provider), ["openai"]);
  assert.deepEqual(modelAttemptsForRequest(general, { ...base, OMNIROUTE_EXTERNAL_DATA_APPROVED: "I_APPROVE_EXTERNAL_PROCESSING" }).map(x => x.provider), ["omniroute"]);
  assert.deepEqual(modelAttemptsForRequest(complex, { ...base, OMNIROUTE_EXTERNAL_DATA_APPROVED: "I_APPROVE_EXTERNAL_PROCESSING" }).map(x => x.provider), ["openai"]);
  assert.deepEqual(modelAttemptsForRequest(general, { ...base, OMNIROUTE_API_KEY: "", OMNIROUTE_EXTERNAL_DATA_APPROVED: "I_APPROVE_EXTERNAL_PROCESSING" }).map(x => x.provider), ["openai"]);
});

test("FreeLLMAPI -> OmniRoute gateway failover preserves identical rules and conversation history, without paid API calls", async () => {
  const env = {
    ...configured,
    FREELLMAPI_ENABLED: "on",
    FREELLMAPI_EXTERNAL_DATA_APPROVED: "I_APPROVE_EXTERNAL_PROCESSING",
    FREELLMAPI_BASE_URL: "https://free.example/v1",
    FREELLMAPI_API_KEY: "test-free",
    OMNIROUTE_ENABLED: "on",
    OMNIROUTE_EXTERNAL_DATA_APPROVED: "I_APPROVE_EXTERNAL_PROCESSING",
    OMNIROUTE_BASE_URL: "https://omni.example/v1",
    OMNIROUTE_API_KEY: "test-omni",
    ASSISTANT_GATEWAY_FAILOVER: "on",
  };
  assert.deepEqual(modelAttemptsForRequest(general, env).map(x => x.provider), ["freellmapi", "omniroute"]);
  assert.deepEqual(modelAttemptsForRequest(general, { ...env, ASSISTANT_GATEWAY_PRIORITY: "omniroute" }).map(x => x.provider), ["omniroute", "freellmapi"]);
  assert.deepEqual(modelAttemptsForRequest(general, { ...env, ASSISTANT_GATEWAY_FAILOVER: "off" }).map(x => x.provider), ["freellmapi"]);
  const fetchOld = globalThis.fetch;
  const captured: Array<{ url: string; authorization: string | null; body: Record<string, unknown> }> = [];
  globalThis.fetch = async (url, options) => {
    captured.push({ url: String(url), authorization: new Headers(options?.headers).get("Authorization"),
      body: JSON.parse(String(options?.body)) });
    return captured.length === 1 ? new Response("free quota exhausted", { status: 429 })
      : new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: "Принято" } }] }), { status: 200 });
  };
  try {
    const history = [{ role: "user" as const, content: "У нас 100 м² фасада" },
      { role: "assistant" as const, content: "Какая облицовка?" },
      { role: "user" as const, content: "Металлосайдинг" }];
    const instructions = "ООО СВОИ ЛЮДИ. Не придумывать цены. Codebase Memory.";
    const result = await executeModelRoute({ request: general, instructions, input: history, env,
      signal: new AbortController().signal });
    assert.equal(result?.route.provider, "omniroute");
    assert.equal(result?.route.attempts, 2);
    assert.equal(captured.length, 2);
    assert.deepEqual(captured.map(x => x.url), ["https://free.example/v1/chat/completions", "https://omni.example/v1/chat/completions"]);
    assert.deepEqual(captured.map(x => x.authorization), ["Bearer test-free", "Bearer test-omni"]);
    assert.deepEqual(captured[0].body.messages, captured[1].body.messages);
    assert.deepEqual(captured[1].body.messages, [{ role: "system", content: instructions }, ...history]);
    assert.equal(captured.every(x => x.body.model === "auto"), true);
  } finally { globalThis.fetch = fetchOld; }
});
