import test from "node:test";
import assert from "node:assert/strict";
import { ConnectError, UserAuthorizationRequiredError } from "@vercel/connect";
import { createDriveConnectHandlers } from "../lib/server/drive-connect";
import { createSessionToken, getAccessConfig, SESSION_COOKIE } from "../lib/server/auth";
import { resetRateLimitsForTests } from "../lib/server/rate-limit";

const origin = "https://assistant.example";
function environment() {
  const keys = ["ASSISTANT_ACCESS_PASSWORD", "ASSISTANT_SESSION_SECRET", "ASSISTANT_PUBLIC_ORIGIN", "GOOGLE_DRIVE_CONNECTOR_UID"] as const;
  const old = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.ASSISTANT_ACCESS_PASSWORD = "unit-only-drive-owner-password";
  process.env.ASSISTANT_SESSION_SECRET = "unit-only-drive-session-signing-key-longer-than-thirty-two";
  process.env.ASSISTANT_PUBLIC_ORIGIN = origin;
  process.env.GOOGLE_DRIVE_CONNECTOR_UID = "google/unit-drive";
  resetRateLimitsForTests();
  return () => { for (const key of keys) if (old[key] === undefined) delete process.env[key]; else process.env[key] = old[key]; resetRateLimitsForTests(); };
}
function request(action?: unknown, options: { cookie?: boolean; origin?: string; method?: string } = {}) {
  const cookie = options.cookie === false ? "" : `${SESSION_COOKIE}=${createSessionToken(getAccessConfig()!)}`;
  return new Request(`${origin}/api/drive/connection`, {
    method: options.method ?? (action === undefined ? "GET" : "POST"),
    headers: { cookie, origin: options.origin ?? origin, "Content-Type": "application/json" },
    ...(action === undefined ? {} : { body: JSON.stringify(action) }),
  });
}
const unused = async (): Promise<never> => { throw new Error("Provider must not be called"); };

test("Drive endpoints reject unauthenticated, cross-origin and forged-scope/subject requests before provider access", async () => {
  const restore = environment();
  const handlers = createDriveConnectHandlers({ getToken: unused, startAuthorization: unused, fetch: unused });
  try {
    assert.equal((await handlers.GET(request(undefined, { cookie: false }))).status, 401);
    assert.equal((await handlers.POST(request({ action: "check" }, { cookie: false }))).status, 401);
    assert.equal((await handlers.POST(request({ action: "authorize" }, { origin: "https://attacker.example" }))).status, 403);
    for (const extra of [{ scopes: ["https://www.googleapis.com/auth/drive"] }, { subject: { id: "another-user" } }, { callbackUrl: "https://attacker.example" }]) {
      assert.equal((await handlers.POST(request({ action: "authorize", ...extra }))).status, 400);
    }
    assert.equal((await handlers.POST(request({ action: ["authorize"] }))).status, 400);
  } finally { restore(); }
});

test("configuration GET never claims a live grant and never calls the provider", async () => {
  const restore = environment();
  const handlers = createDriveConnectHandlers({ getToken: unused, startAuthorization: unused, fetch: unused });
  try {
    assert.equal((await (await handlers.GET(request())).json()).status, "unchecked");
    process.env.GOOGLE_DRIVE_CONNECTOR_UID = "scl_UnitVerifiedConnector123";
    assert.equal((await (await handlers.GET(request())).json()).status, "unchecked");
    for (const invalid of ["", "apps.googleusercontent.com", "https://attacker.example", "google/a?subject=other"]) {
      process.env.GOOGLE_DRIVE_CONNECTOR_UID = invalid;
      const response = await handlers.GET(request());
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal((await response.json()).status, "setup_required");
      assert.equal((await handlers.POST(request({ action: "authorize" }))).status, 503);
    }
  } finally { restore(); }
});

test("authorization and Drive probe use the same fixed scopes and stable owner across fresh login sessions", async () => {
  const restore = environment();
  const calls: unknown[] = [];
  const handlers = createDriveConnectHandlers({
    startAuthorization: async (connector, params) => {
      calls.push([connector, params]);
      return { url: "https://connect.vercel.com/authorize?request=unit-test", request: "private-request", verifier: "private-verifier" };
    },
    getToken: async (connector, params, options) => {
      calls.push([connector, params]); assert.equal(options?.forceRefresh, true); return "unit-only-provider-token";
    },
    fetch: async (input, init) => {
      assert.equal(String(input), "https://www.googleapis.com/drive/v3/files?spaces=drive&pageSize=1&fields=kind");
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer unit-only-provider-token");
      assert.equal(init?.redirect, "error");
      return Response.json({ kind: "drive#fileList" });
    },
  });
  try {
    const start = await handlers.POST(request({ action: "authorize" }));
    const text = await start.text();
    assert.match(text, /authorizationUrl/); assert.doesNotMatch(text, /private-request|private-verifier/);
    const checked = await handlers.POST(request({ action: "check" }));
    const data = await checked.json();
    assert.equal(data.status, "connected");
    assert.match(data.message, /сохранение проектов ещё не включено/);
    assert.doesNotMatch(JSON.stringify(data), /unit-only-provider-token/);
    assert.deepEqual(calls, [
      ["google/unit-drive", { subject: { type: "user", id: "owner" }, scopes: ["openid", "https://www.googleapis.com/auth/drive.file"] }],
      ["google/unit-drive", { subject: { type: "user", id: "owner" }, scopes: ["openid", "https://www.googleapis.com/auth/drive.file"] }],
    ]);
  } finally { restore(); }
});

test("a token or OAuth completion alone never establishes access to Drive", async () => {
  const restore = environment();
  try {
    for (const providerResponse of [new Response("sensitive-provider-error", { status: 403 }), Response.json({ unrelated: "reply" })]) {
      const handlers = createDriveConnectHandlers({ getToken: async () => "private-token", startAuthorization: unused, fetch: async () => providerResponse });
      const response = await handlers.POST(request({ action: "check" }));
      const text = await response.text();
      assert.equal(response.status, 502);
      assert.doesNotMatch(text, /"status":"connected"|private-token|sensitive-provider-error/);
    }
  } finally { restore(); }
});

test("untrusted consent URLs and raw SDK vendor errors never reach the browser", async () => {
  const restore = environment();
  try {
    for (const url of ["https://attacker.example/authorize", "http://connect.vercel.com/authorize", "https://connect.vercel.com.attacker.example", "https://user:pass@connect.vercel.com/authorize"]) {
      const handlers = createDriveConnectHandlers({ getToken: unused, fetch: unused, startAuthorization: async () => ({ url, request: "private-request", verifier: "private-verifier" }) });
      const response = await handlers.POST(request({ action: "authorize" }));
      assert.equal(response.status, 502);
      assert.doesNotMatch(await response.text(), /attacker|private-request|private-verifier/);
    }
    const handlers = createDriveConnectHandlers({ startAuthorization: unused, fetch: unused, getToken: async () => {
      throw new ConnectError("raw secret and vendor URL", { vendor: { secret: "private-value" }, status: 500 });
    } });
    assert.doesNotMatch(await (await handlers.POST(request({ action: "check" }))).text(), /raw secret|private-value|vendor/);
  } finally { restore(); }
});

test("missing grant and missing project link report different safe next steps", async () => {
  const restore = environment();
  try {
    for (const [error, expected, status] of [
      [new UserAuthorizationRequiredError("private-grant-details"), "authorization_required", 200],
      [new ConnectError("private-link-details", { code: "client_not_linked_to_project" }), "setup_required", 503],
    ] as const) {
      const handlers = createDriveConnectHandlers({ startAuthorization: unused, fetch: unused, getToken: async () => { throw error; } });
      const response = await handlers.POST(request({ action: "check" }));
      assert.equal(response.status, status);
      assert.equal((await response.json()).status, expected);
    }
  } finally { restore(); }
});

test("OAuth initiation is bounded per owner even across new signed sessions", async () => {
  const restore = environment(); let calls = 0;
  const handlers = createDriveConnectHandlers({ getToken: unused, fetch: unused, startAuthorization: async () => {
    calls++; return { url: "https://connect.vercel.com/authorize", request: "private", verifier: "private" };
  } });
  try {
    for (let n = 0; n < 5; n++) assert.equal((await handlers.POST(request({ action: "authorize" }))).status, 200);
    assert.equal((await handlers.POST(request({ action: "authorize" }))).status, 429);
    assert.equal(calls, 5);
  } finally { restore(); }
});
