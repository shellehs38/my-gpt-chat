import test from "node:test";
import assert from "node:assert/strict";
import { POST as login } from "../app/api/auth/route";
import { POST as chat } from "../app/api/chat/route";
import { createSessionToken, getAccessConfig, SESSION_COOKIE } from "../lib/server/auth";
import { acquireChatSlot, resetRateLimitsForTests, takeRateLimit } from "../lib/server/rate-limit";

function environment() {
  const keys = ["ASSISTANT_ACCESS_PASSWORD", "ASSISTANT_SESSION_SECRET", "ASSISTANT_PUBLIC_ORIGIN", "OPENAI_API_KEY"] as const;
  const prior = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.ASSISTANT_ACCESS_PASSWORD = "unit-limit-test-password";
  process.env.ASSISTANT_SESSION_SECRET = "unit-limit-test-session-secret-with-more-than-32-bytes";
  process.env.OPENAI_API_KEY = "test-only-provider-is-mocked";
  delete process.env.ASSISTANT_PUBLIC_ORIGIN;
  resetRateLimitsForTests();
  return () => {
    for (const key of keys) if (prior[key] === undefined) delete process.env[key]; else process.env[key] = prior[key];
    resetRateLimitsForTests();
  };
}
const origin = "http://localhost:3000";
function request(path: string, body: unknown, cookie = "", address = "127.0.0.1") {
  return new Request(origin + path, {
    method: "POST",
    headers: { origin, "Content-Type": "application/json", cookie, "x-forwarded-for": address },
    body: JSON.stringify(body),
  });
}

test("owner request budget cannot be bypassed by new signed sessions or forwarded IPs", async () => {
  const restore = environment(), originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(JSON.stringify({ status: "completed", output: [{ content: [{ type: "output_text", text: "Тестовый ответ" }] }] }), { status: 200 });
  };
  try {
    for (let index = 0; index < 20; index++) {
      const cookie = `${SESSION_COOKIE}=${createSessionToken(getAccessConfig()!)}`;
      assert.equal((await chat(request("/api/chat", { message: "Проверка лимита", mode: "general" }, cookie, `127.0.0.${index + 1}`))).status, 200);
    }
    const another = `${SESSION_COOKIE}=${createSessionToken(getAccessConfig()!)}`;
    assert.equal((await chat(request("/api/chat", { message: "Ещё запрос" }, another, "another-forwarded-value"))).status, 429);
    assert.equal(calls, 20);
  } finally { globalThis.fetch = originalFetch; restore(); }
});

test("five failed logins prevent another password attempt from the same address", async () => {
  const restore = environment();
  try {
    for (let index = 0; index < 5; index++) assert.equal((await login(request("/api/auth", { password: "incorrect" }))).status, 401);
    const response = await login(request("/api/auth", { password: process.env.ASSISTANT_ACCESS_PASSWORD }));
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("retry-after"), "900");
  } finally { restore(); }
});

test("rate windows expire and concurrency slots are bounded and released exactly once", () => {
  resetRateLimitsForTests();
  assert(takeRateLimit("window", 1, 100, 1000));
  assert(!takeRateLimit("window", 1, 100, 1099));
  assert(takeRateLimit("window", 1, 100, 1100));
  const first = acquireChatSlot(), second = acquireChatSlot();
  assert(first); assert(second);
  assert.equal(acquireChatSlot(), null);
  first(); first();
  const replacement = acquireChatSlot();
  assert(replacement);
  assert.equal(acquireChatSlot(), null);
  second(); replacement();
  resetRateLimitsForTests();
});
