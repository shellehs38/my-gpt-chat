import test from "node:test";
import assert from "node:assert/strict";
import { POST as search } from "../app/api/firecrawl/search/route";
import { createSessionToken, getAccessConfig, SESSION_COOKIE } from "../lib/server/auth";
import { resetRateLimitsForTests } from "../lib/server/rate-limit";
import { parseFirecrawlResults, validateMaterialQuery } from "../lib/server/firecrawl";

const origin = "http://localhost:3000";
function setup() {
  const keys = ["ASSISTANT_ACCESS_PASSWORD", "ASSISTANT_SESSION_SECRET", "FIRECRAWL_API_KEY"] as const;
  const original = Object.fromEntries(keys.map((name) => [name, process.env[name]]));
  process.env.ASSISTANT_ACCESS_PASSWORD = "secure-owner-demo-password";
  process.env.ASSISTANT_SESSION_SECRET = "secure-demo-session-secret-with-at-least-32-bytes";
  process.env.FIRECRAWL_API_KEY = "test-only-provider-key";
  resetRateLimitsForTests();
  return () => {
    for (const key of keys) if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key];
    resetRateLimitsForTests();
  };
}
function request(body: unknown, cookie = "", source = origin) {
  return new Request(origin + "/api/firecrawl/search", {
    method: "POST", headers: { origin: source, "Content-Type": "application/json", cookie },
    body: JSON.stringify(body),
  });
}

test("Firecrawl query parser accepts material and rejects invalid requests", () => {
  assert.equal(validateMaterialQuery({ query: "  фасадная   вата 100 мм  " }), "фасадная вата 100 мм");
  assert.equal(validateMaterialQuery({ query: "a" }), null);
  assert.equal(validateMaterialQuery({ query: "a".repeat(121) }), null);
  assert.equal(validateMaterialQuery({ query: 123 }), null);
  assert.equal(validateMaterialQuery([]), null);
});

test("Firecrawl result parser retains only safe unique URLs and evidence text", () => {
  const parsed = parseFirecrawlResults({ success: true, data: { web: [
    { title: "Поставщик", url: "https://example.com/product", description: "Цена по запросу" },
    { title: "Копия", url: "https://example.com/product" },
    { title: "Опасный URL", url: "javascript:alert(1)" },
    { title: "Локальный", url: "http://localhost/private" },
  ] } });
  assert.deepEqual(parsed, [{ title: "Поставщик", url: "https://example.com/product", description: "Цена по запросу" }]);
  assert.equal(parseFirecrawlResults({ success: false }), null);
});

test("only authenticated owner on same origin can spend Firecrawl credits", async () => {
  const restore = setup(), fetchBefore = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ success: true, data: { web: [] } }), { status: 200 }); };
  try {
    assert.equal((await search(request({ query: "минеральная вата" }))).status, 401);
    const token = createSessionToken(getAccessConfig()!);
    const cookie = SESSION_COOKIE + "=" + token;
    assert.equal((await search(request({ query: "минеральная вата" }, cookie, "https://attacker.example"))).status, 403);
    assert.equal((await search(request({ query: "a" }, cookie))).status, 400);
    assert.equal(calls, 0);
    const valid = await search(request({ query: "фасадная вата" }, cookie));
    assert.equal(valid.status, 200);
    assert.equal((await valid.json()).items.length, 0);
    assert.equal(calls, 1);
    for (let i = 0; i < 4; i++) assert.equal((await search(request({ query: "вата для фасада" }, cookie))).status, 200);
    assert.equal((await search(request({ query: "вата для фасада" }, cookie))).status, 429);
    assert.equal(calls, 5);
  } finally { globalThis.fetch = fetchBefore; restore(); }
});

test("Firecrawl server search uses bounded web-only API request and protects key", async () => {
  const restore = setup(), fetchBefore = globalThis.fetch;
  let url = ""; let sent: Record<string, unknown> = {};
  globalThis.fetch = async (source, init) => {
    url = String(source); sent = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ success: true, data: { web: [{ title: "Тест", url: "https://example.com", description: "Товар" }] } }), { status: 200 });
  };
  try {
    const cookie = SESSION_COOKIE + "=" + createSessionToken(getAccessConfig()!);
    const response = await search(request({ query: "металлическая подсистема" }, cookie));
    assert.equal(response.status, 200);
    assert.equal(url, "https://api.firecrawl.dev/v2/search");
    assert.equal(sent.limit, 5);
    assert.deepEqual(sent.sources, ["web"]);
    assert.match(String(sent.query), /Иркутск/);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.text();
    assert(!body.includes("test-only-provider-key"));
    assert(body.includes("https://example.com/"));
  } finally { globalThis.fetch = fetchBefore; restore(); }
});

test("missing server key closes lookup without provider call", async () => {
  const restore = setup(), fetchBefore = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw Error("must not call"); };
  try {
    delete process.env.FIRECRAWL_API_KEY;
    const cookie = SESSION_COOKIE + "=" + createSessionToken(getAccessConfig()!);
    const response = await search(request({ query: "сайдинг фасадный" }, cookie));
    assert.equal(response.status, 503);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = fetchBefore; restore(); }
});
