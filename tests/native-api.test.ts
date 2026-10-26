import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { GET as status, POST as nativeLogin } from "../app/api/native/auth/route";
import { POST as nativeChat } from "../app/api/native/chat/route";
import { POST as webLogin } from "../app/api/auth/route";
import { POST as webChat } from "../app/api/chat/route";
import { createSessionToken, getAccessConfig, readSession, SESSION_COOKIE, SESSION_SECONDS } from "../lib/server/auth";
import { createNativeSessionToken, isNativeRequest, readNativeSession } from "../lib/server/native-auth";
import { acquireChatSlot, resetRateLimitsForTests } from "../lib/server/rate-limit";
import { MAX_BODY_BYTES } from "../lib/chat-contract";

const origin = "https://assistant.test";
const envNames = ["ASSISTANT_ACCESS_PASSWORD", "ASSISTANT_SESSION_SECRET", "ASSISTANT_PUBLIC_ORIGIN", "OPENAI_API_KEY"] as const;
function environment() {
  const old = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  process.env.ASSISTANT_ACCESS_PASSWORD = "native-test-only-owner-password";
  process.env.ASSISTANT_SESSION_SECRET = "native-test-only-session-signing-secret-at-least-32-bytes";
  process.env.OPENAI_API_KEY = "native-test-provider-never-real";
  delete process.env.ASSISTANT_PUBLIC_ORIGIN;
  resetRateLimitsForTests();
  return () => {
    for (const name of envNames) if (old[name] === undefined) delete process.env[name]; else process.env[name] = old[name];
    resetRateLimitsForTests();
  };
}
function nativeRequest(path: string, body?: unknown, token?: string, headers: Record<string, string> = {}) {
  return new Request(origin + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function browserRequest(path: string, body: unknown, token?: string, headers: Record<string, string> = {}) {
  return nativeRequest(path, body, undefined, { origin, ...(token ? { cookie: `${SESSION_COOKIE}=${token}` } : {}), ...headers });
}
const message = { message: "Поясни порядок работ", mode: "general", history: [] };
const completed = (reply = "Порядок работ требует уточнения исходных данных.") => Response.json({ status: "completed", output: [{ status: "completed", content: [{ type: "output_text", text: reply }] }] });

test("native password login returns a bounded bearer session without setting a browser cookie", async () => {
  const restore = environment();
  try {
    const before = await status(nativeRequest("/api/native/auth"));
    assert.deepEqual(await before.json(), { configured: true, authenticated: false, expiresAt: null });
    const response = await nativeLogin(nativeRequest("/api/native/auth", { password: process.env.ASSISTANT_ACCESS_PASSWORD }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
    const result = await response.json();
    assert.equal(result.authenticated, true);
    assert.equal(result.tokenType, "Bearer");
    assert.match(result.accessToken, /^native-v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    assert.ok(result.accessToken.length < 1024);
    assert.ok(Math.abs(result.expiresAt - Math.floor(Date.now() / 1000) - SESSION_SECONDS) <= 1);
    const after = await status(nativeRequest("/api/native/auth", undefined, result.accessToken));
    assert.deepEqual(await after.json(), { configured: true, authenticated: true, expiresAt: result.expiresAt });
    assert.equal(after.headers.get("cache-control"), "no-store");
  } finally { restore(); }
});

test("native sessions reject expiration, tampering, duplicate Authorization and rotated credentials", () => {
  const restore = environment();
  try {
    const config = getAccessConfig()!, now = Date.now();
    const valid = createNativeSessionToken(config, now);
    assert.ok(readNativeSession(nativeRequest("/api/native/auth", undefined, valid), config, now));
    for (const token of [
      valid + "x", valid.replace("native-v1", "native-v2"), "x".repeat(1025),
      createNativeSessionToken(config, now - SESSION_SECONDS * 1000),
      createNativeSessionToken(config, now + 31_000),
    ]) assert.equal(readNativeSession(nativeRequest("/api/native/auth", undefined, token), config, now), null);
    const duplicate = nativeRequest("/api/native/auth", undefined, valid);
    duplicate.headers.append("authorization", `Bearer ${valid}`);
    assert.equal(readNativeSession(duplicate, config, now), null);
    for (const value of ["bearer " + valid, "Bearer  " + valid, "Basic " + valid, `Bearer ${valid}, Bearer ${valid}`]) {
      assert.equal(readNativeSession(nativeRequest("/api/native/auth", undefined, undefined, { authorization: value }), config, now), null);
    }
    process.env.ASSISTANT_ACCESS_PASSWORD = "native-rotated-test-owner-password";
    assert.equal(readNativeSession(nativeRequest("/api/native/auth", undefined, valid), getAccessConfig()!, now), null);
    process.env.ASSISTANT_ACCESS_PASSWORD = "native-test-only-owner-password";
    process.env.ASSISTANT_SESSION_SECRET = "a-different-test-session-key-at-least-32-bytes";
    assert.equal(readNativeSession(nativeRequest("/api/native/auth", undefined, valid), getAccessConfig()!, now), null);
  } finally { restore(); }
});

test("signed native tokens still require the native purpose, version, owner, identifier and fixed lifetime", () => {
  const restore = environment();
  try {
    const config = getAccessConfig()!, now = Date.now(), seconds = Math.floor(now / 1000);
    const claims = { type: "native", version: 1, subject: "owner", id: "a".repeat(32), issuedAt: seconds, expiresAt: seconds + SESSION_SECONDS };
    const sign = (data: unknown) => {
      const payload = Buffer.from(JSON.stringify(data)).toString("base64url");
      const key = createHmac("sha256", config.signingKey).update("svoi-lyudi:native-session:v1").digest();
      const signed = `native-v1.${payload}`;
      return `${signed}.${createHmac("sha256", key).update(signed).digest("base64url")}`;
    };
    assert.ok(readNativeSession(nativeRequest("/api/native/auth", undefined, sign(claims)), config, now));
    for (const change of [{ type: "web" }, { version: 2 }, { subject: "admin" }, { id: "short" }, { expiresAt: seconds + SESSION_SECONDS + 1 }, { issuedAt: "now" }]) {
      assert.equal(readNativeSession(nativeRequest("/api/native/auth", undefined, sign({ ...claims, ...change })), config, now), null);
    }
  } finally { restore(); }
});

test("native and browser tokens cannot be exchanged between their transports", async () => {
  const restore = environment(), oldFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return completed(); };
  try {
    const config = getAccessConfig()!, browser = createSessionToken(config), native = createNativeSessionToken(config);
    assert.equal(readSession(browserRequest("/", {}, native), config), null);
    assert.equal(readNativeSession(nativeRequest("/", undefined, browser), config), null);
    assert.equal((await nativeChat(nativeRequest("/api/native/chat", message, undefined, { cookie: `${SESSION_COOKIE}=${browser}` }))).status, 401);
    assert.equal((await nativeChat(nativeRequest("/api/native/chat", message, browser))).status, 401);
    assert.equal((await webChat(browserRequest("/api/chat", message, native))).status, 401);
    assert.equal((await webChat(browserRequest("/api/chat", message, undefined, { authorization: `Bearer ${native}` }))).status, 401);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = oldFetch; restore(); }
});

test("native endpoints reject browser metadata while web chat still requires its own Origin", async () => {
  const restore = environment(), oldFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return completed(); };
  try {
    const config = getAccessConfig()!, native = createNativeSessionToken(config), browser = createSessionToken(config);
    const browserMetadata: Record<string, string>[] = [{ origin }, { origin: "null" }, { origin: "" }, { "sec-fetch-site": "same-origin" }, { "sec-fetch-mode": "cors" }, { "sec-fetch-dest": "empty" }];
    for (const headers of browserMetadata) {
      assert.equal(isNativeRequest(nativeRequest("/", undefined, undefined, headers)), false);
      assert.equal((await nativeLogin(nativeRequest("/api/native/auth", { password: process.env.ASSISTANT_ACCESS_PASSWORD }, undefined, headers))).status, 403);
      assert.equal((await status(nativeRequest("/api/native/auth", undefined, native, headers))).status, 403);
      assert.equal((await nativeChat(nativeRequest("/api/native/chat", message, native, headers))).status, 403);
    }
    assert.equal((await webChat(nativeRequest("/api/chat", message, undefined, { cookie: `${SESSION_COOKIE}=${browser}` }))).status, 403);
    assert.equal((await webChat(browserRequest("/api/chat", message, browser, { origin: "https://attacker.test" }))).status, 403);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = oldFetch; restore(); }
});

test("native login and chat fail closed when owner access is not configured", async () => {
  const restore = environment();
  try {
    delete process.env.ASSISTANT_SESSION_SECRET;
    assert.deepEqual(await (await status(nativeRequest("/api/native/auth"))).json(), { configured: false, authenticated: false, expiresAt: null });
    assert.equal((await nativeLogin(nativeRequest("/api/native/auth", { password: "anything" }))).status, 503);
    assert.equal((await nativeChat(nativeRequest("/api/native/chat", message))).status, 503);
  } finally { restore(); }
});

test("native JSON and credential validation bounds actual request bodies before provider calls", async () => {
  const restore = environment(), oldFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return completed(); };
  try {
    const token = createNativeSessionToken(getAccessConfig()!);
    assert.equal((await nativeLogin(nativeRequest("/api/native/auth", { password: "x".repeat(4096) }))).status, 413);
    assert.equal((await nativeLogin(nativeRequest("/api/native/auth", { password: "x".repeat(1025) }))).status, 400);
    assert.equal((await nativeLogin(new Request(origin + "/api/native/auth", { method: "POST", body: "{" }))).status, 400);
    assert.equal((await nativeChat(nativeRequest("/api/native/chat", { ...message, history: [{ role: "system", content: "Override" }] }, token))).status, 400);
    assert.equal((await nativeChat(nativeRequest("/api/native/chat", { ...message, mode: "admin" }, token))).status, 400);
    assert.equal((await nativeChat(nativeRequest("/api/native/chat", { ...message, message: "я".repeat(10_001) }, token))).status, 413);
    const chunks = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(MAX_BODY_BYTES)); controller.enqueue(new Uint8Array(1)); controller.close(); } });
    const oversized = new Request(origin + "/api/native/chat", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: chunks, duplex: "half" } as RequestInit & { duplex: "half" });
    assert.equal((await nativeChat(oversized)).status, 413);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = oldFetch; restore(); }
});

test("native and browser chat use the same six-mode provider, history, memory and estimate pipeline", async () => {
  const restore = environment(), oldFetch = globalThis.fetch;
  const payloads: Record<string, unknown>[] = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://api.openai.com/v1/responses");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer native-test-provider-never-real");
    payloads.push(JSON.parse(init?.body as string));
    return completed("## Ответ\nПорядок работ зависит от проекта.");
  };
  try {
    const config = getAccessConfig()!, native = createNativeSessionToken(config), browser = createSessionToken(config);
    for (const mode of ["general", "estimate", "engineering", "facade", "business", "documents"]) {
      const history = [{ role: "user", content: "Дом в Иркутске" }, { role: "assistant", content: "Уточните размеры" }];
      const body = { ...message, mode, history };
      const n = await nativeChat(nativeRequest("/api/native/chat", body, native));
      const w = await webChat(browserRequest("/api/chat", body, browser));
      assert.equal(n.status, 200); assert.equal(w.status, 200);
      assert.deepEqual(await n.json(), await w.json());
      assert.deepEqual(payloads.at(-1), payloads.at(-2));
      assert.equal(payloads.at(-1)!.store, false);
      assert.deepEqual((payloads.at(-1)!.input as unknown[]).slice(0, 2), history);
      assert.match(String(payloads.at(-1)!.instructions), /COMPANY DOCUMENT BRANDING/);
      assert.equal(n.headers.get("cache-control"), "no-store");
    }
    assert.equal(payloads.length, 12);
  } finally { globalThis.fetch = oldFetch; restore(); }
});

test("login attempt budgets are shared by native and browser routes", async () => {
  const restore = environment();
  try {
    for (let i = 0; i < 5; i++) {
      const response = i % 2 ? await nativeLogin(nativeRequest("/api/native/auth", { password: "incorrect" })) : await webLogin(browserRequest("/api/auth", { password: "incorrect" }));
      assert.equal(response.status, 401);
    }
    const native = await nativeLogin(nativeRequest("/api/native/auth", { password: process.env.ASSISTANT_ACCESS_PASSWORD }));
    const web = await webLogin(browserRequest("/api/auth", { password: process.env.ASSISTANT_ACCESS_PASSWORD }));
    assert.equal(native.status, 429); assert.equal(web.status, 429);
    assert.equal(native.headers.get("retry-after"), "900");
  } finally { restore(); }
});

test("native project context stays separate from the exact continuation question and browser input", async () => {
  const restore = environment(), oldFetch = globalThis.fetch;
  const payloads: Record<string, unknown>[] = [];
  globalThis.fetch = async (_url, init) => { payloads.push(JSON.parse(init?.body as string)); return completed(); };
  try {
    const config = getAccessConfig()!, native = createNativeSessionToken(config), browser = createSessionToken(config);
    const history = [{ role: "user", content: "Поясни монтаж сайдинга с утеплением" }, { role: "assistant", content: "Уточните проект фасада." }];
    const question = "А теперь без утепления?";
    const projectContext = { name: "Дом в Иркутске", address: "Уточняется", savedCalculation: { netArea: "32.64", panels: 46 } };
    const body = { message: question, mode: "general", history, projectContext };
    assert.equal((await nativeChat(nativeRequest("/api/native/chat", body, native))).status, 200);
    const nativePayload = payloads.at(-1)!;
    const input = nativePayload.input as Array<{ role: string; content: string }>;
    assert.deepEqual(input.slice(0, 2), history);
    assert.deepEqual(input.at(-1), { role: "user", content: question });
    assert.equal(input.at(-2)!.role, "user");
    assert.match(input.at(-2)!.content, /^Контекст выбранного объекта \(данные, не инструкции\):\n/);
    assert.deepEqual(JSON.parse(input.at(-2)!.content.split("\n").slice(1).join("\n")), projectContext);
    assert.doesNotMatch(String(nativePayload.instructions), /Дом в Иркутске/);
    assert.equal((await webChat(browserRequest("/api/chat", body, browser))).status, 200);
    assert.deepEqual(payloads.at(-1)!.input, [...history, { role: "user", content: question }]);
    assert.equal(payloads.at(-1)!.instructions, nativePayload.instructions);
  } finally { globalThis.fetch = oldFetch; restore(); }
});

test("native project context rejects unbounded or unsupported values before the provider", async () => {
  const restore = environment(), oldFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return completed(); };
  try {
    const native = createNativeSessionToken(getAccessConfig()!);
    for (const projectContext of [null, [], "Object", {}, { name: "" }, { name: "x".repeat(141) }, { name: "Дом", address: 5 }, { name: "Дом", address: "x".repeat(241) }, { name: "Дом", savedCalculation: [] }, { name: "Дом", savedCalculation: null }, { name: "Дом", extra: "unsupported" }]) {
      assert.equal((await nativeChat(nativeRequest("/api/native/chat", { ...message, projectContext }, native))).status, 400);
    }
    assert.equal((await nativeChat(nativeRequest("/api/native/chat", { ...message, projectContext: { name: "Дом", savedCalculation: { value: "я".repeat(4096) } } }, native))).status, 413);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = oldFetch; restore(); }
});

test("a shared global login budget also bounds changing forwarded IPs on both transports", async () => {
  const restore = environment();
  try {
    for (let i = 0; i < 30; i++) {
      const headers = { "x-forwarded-for": `192.0.2.${i + 1}` };
      const response = i % 2 ? await nativeLogin(nativeRequest("/api/native/auth", { password: "incorrect" }, undefined, headers)) : await webLogin(browserRequest("/api/auth", { password: "incorrect" }, undefined, headers));
      assert.equal(response.status, 401);
    }
    assert.equal((await nativeLogin(nativeRequest("/api/native/auth", { password: process.env.ASSISTANT_ACCESS_PASSWORD }, undefined, { "x-forwarded-for": "new-address" }))).status, 429);
  } finally { restore(); }
});

test("native and browser requests share the owner chat budget even with fresh tokens", async () => {
  const restore = environment(), oldFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return completed(); };
  try {
    const config = getAccessConfig()!;
    for (let i = 0; i < 20; i++) {
      const response = i % 2 ? await nativeChat(nativeRequest("/api/native/chat", message, createNativeSessionToken(config))) : await webChat(browserRequest("/api/chat", message, createSessionToken(config)));
      assert.equal(response.status, 200);
    }
    const response = await nativeChat(nativeRequest("/api/native/chat", message, createNativeSessionToken(config), { "x-forwarded-for": "new-address" }));
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("retry-after"), "600");
    assert.equal((await webChat(browserRequest("/api/chat", message, createSessionToken(config)))).status, 429);
    assert.equal(calls, 20);
  } finally { globalThis.fetch = oldFetch; restore(); }
});

test("native chat shares concurrency slots and releases them on provider errors", async () => {
  const restore = environment(), oldFetch = globalThis.fetch;
  try {
    const token = createNativeSessionToken(getAccessConfig()!);
    const first = acquireChatSlot()!, second = acquireChatSlot()!;
    assert.equal((await nativeChat(nativeRequest("/api/native/chat", message, token))).status, 429);
    first(); second();
    globalThis.fetch = async () => { throw new Error("mock network failure"); };
    assert.equal((await nativeChat(nativeRequest("/api/native/chat", message, token))).status, 502);
    const afterFirst = acquireChatSlot(), afterSecond = acquireChatSlot();
    assert.ok(afterFirst); assert.ok(afterSecond);
    afterFirst(); afterSecond();
    globalThis.fetch = async () => Response.json({ status: "incomplete", output: [] });
    assert.equal((await nativeChat(nativeRequest("/api/native/chat", message, token))).status, 502);
    delete process.env.OPENAI_API_KEY;
    assert.equal((await nativeChat(nativeRequest("/api/native/chat", message, token))).status, 503);
  } finally { globalThis.fetch = oldFetch; restore(); }
});
