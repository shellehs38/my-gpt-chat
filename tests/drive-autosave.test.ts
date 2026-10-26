import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createDriveWorkspaceHandler } from "../lib/server/drive-workspace";
import { createSessionToken, getAccessConfig, SESSION_COOKIE } from "../lib/server/auth";
import { resetRateLimitsForTests } from "../lib/server/rate-limit";
import { DriveAutosave, type AutosaveState } from "../lib/drive-autosave";
import { CLOUD_STORAGE_KEY, decodeSnapshot, type Snapshot } from "../lib/drive-workspace-contract";
import { emptyWorkspace, type Workspace, WORKSPACE_STORAGE_KEY } from "../lib/workspace-storage";

const origin = "https://assistant.example";
function environment() {
  const keys = ["ASSISTANT_ACCESS_PASSWORD", "ASSISTANT_SESSION_SECRET", "ASSISTANT_PUBLIC_ORIGIN", "GOOGLE_DRIVE_CONNECTOR_UID"] as const;
  const old = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  process.env.ASSISTANT_ACCESS_PASSWORD = "unit-only-autosave-password";
  process.env.ASSISTANT_SESSION_SECRET = "unit-only-autosave-session-key-at-least-thirty-two";
  process.env.ASSISTANT_PUBLIC_ORIGIN = origin; process.env.GOOGLE_DRIVE_CONNECTOR_UID = "google/unit-autosave";
  resetRateLimitsForTests();
  return () => { for (const key of keys) if (old[key] === undefined) delete process.env[key]; else process.env[key] = old[key]; resetRateLimitsForTests(); };
}
function request(body: unknown, cookie = true, from = origin) {
  return new Request(origin + "/api/drive/workspace", { method: "POST", headers: { origin: from, "Content-Type": "application/json", ...(cookie ? { cookie: `${SESSION_COOKIE}=${createSessionToken(getAccessConfig()!)}` } : {}) }, body: JSON.stringify(body) });
}
type File = { id: string; mimeType: string; createdTime: string; appProperties: Record<string, string>; parents: string[]; size?: string; sha256Checksum?: string; content?: string; trashed?: boolean };
/** Drive-shaped test double; not a claim of live Google-provider validation. */
class FakeDrive {
  files = new Map<string, File>(); next = 0; uploads = 0; calls = 0; corrupt = false; failAfterWrite = false;
  fetch: typeof fetch = async (input, init) => {
    this.calls++;
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer unit-private-token");
    assert.equal(init?.redirect, "error"); assert.equal(init?.cache, "no-store");
    const url = new URL(String(input)); const method = init?.method ?? "GET";
    if (url.pathname.endsWith("generateIds")) return Response.json({ ids: [`file_${String(++this.next).padStart(12, "0")}`] });
    if (url.pathname.includes("/upload/")) {
      const boundary = new Headers(init?.headers).get("Content-Type")!.split("boundary=")[1];
      const parts = String(init?.body).split(`--${boundary}`);
      const meta = JSON.parse(parts[1].split("\r\n\r\n")[1].trim());
      const content = parts[2].slice(parts[2].indexOf("\r\n\r\n") + 4).replace(/\r\n$/, "");
      if (this.files.has(meta.id)) return Response.json({}, { status: 409 });
      this.uploads++;
      this.files.set(meta.id, { ...meta, createdTime: new Date(1700000000000 + this.next * 1000).toISOString(), content, size: String(Buffer.byteLength(content)), sha256Checksum: createHash("sha256").update(content).digest("hex") });
      if (this.failAfterWrite) { this.failAfterWrite = false; throw new Error("provider timed out after commit"); }
      return Response.json({ id: meta.id });
    }
    if (method === "POST") {
      const meta = JSON.parse(String(init?.body));
      const folder = { ...meta, id: `folder_${String(++this.next).padStart(12, "0")}`, createdTime: new Date().toISOString(), parents: ["root_1234567890"] };
      this.files.set(folder.id, folder); return Response.json(folder);
    }
    if (url.searchParams.has("q")) {
      const kind = url.searchParams.get("q")!.includes("value='snapshot'") ? "snapshot" : "folder";
      return Response.json({ files: [...this.files.values()].filter(f => !f.trashed && f.appProperties.kind === kind).map(({ content, ...m }) => m) });
    }
    const id = url.pathname.split("/").at(-1)!; const file = this.files.get(id);
    if (!file) return Response.json({}, { status: 404 });
    if (url.searchParams.get("alt") === "media") return new Response(this.corrupt ? file.content!.replace('"draft":', '"draft":"corrupted", "extra":') : file.content, { headers: { "Content-Type": "application/json" } });
    const { content, ...meta } = file; return Response.json(meta);
  };
}
function provider(drive: FakeDrive) {
  return createDriveWorkspaceHandler({ fetch: drive.fetch, getToken: async (_connector, params) => {
    assert.deepEqual(params, { subject: { type: "user", id: "owner" }, scopes: ["openid", "https://www.googleapis.com/auth/drive.file"] });
    return "unit-private-token";
  } });
}
const snapshot = (draft: string, parents: string[] = []): Snapshot => ({ schemaVersion: 1, operationId: crypto.randomUUID(), parents, workspace: { ...emptyWorkspace(), draft } });
async function save(handler: ReturnType<typeof provider>, value: Snapshot) {
  const reserved = await handler(request({ action: "reserve", snapshot: value })); assert.equal(reserved.status, 200, await reserved.clone().text());
  const { ticket } = await reserved.json();
  const response = await handler(request({ action: "save", snapshot: value, ticket }));
  assert.equal(response.status, 200, await response.clone().text()); return { data: await response.json(), ticket };
}
class MemoryStorage {
  map = new Map<string, string>(); failJournal = false;
  getItem(key: string) { return this.map.get(key) ?? null; }
  get length() { return this.map.size; }
  key(index: number) { return [...this.map.keys()][index] ?? null; }
  removeItem(key: string) { this.map.delete(key); }
  setItem(key: string, value: string) { if (this.failJournal && key === CLOUD_STORAGE_KEY) throw new Error("Browser storage quota"); this.map.set(key, value); }
}
function browser(handler: ReturnType<typeof provider>, initial = emptyWorkspace(), storage = new MemoryStorage()) {
  let workspace: Workspace = initial; let state: AutosaveState | undefined; let dropResponse = false;
  const controller = new DriveAutosave({ storage, getWorkspace: () => workspace, restore: w => { workspace = w; }, notify: s => { state = s; }, fetch: async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    const response = await handler(request(body));
    if (body.action === "save" && dropResponse && response.ok) { dropResponse = false; throw new Error("connection lost after write"); }
    return response;
  } });
  return { controller, storage, get workspace() { return workspace; }, get state() { return state!; }, edit(draft: string) { workspace = { ...workspace, draft }; controller.changed(); }, loseResponse() { dropResponse = true; } };
}

test("autosave authorization and malformed uploads are rejected before provider access", async () => {
  const restore = environment(); const drive = new FakeDrive(); const handler = provider(drive);
  try {
    assert.equal((await handler(request({ action: "load" }, false))).status, 401);
    assert.equal((await handler(request({ action: "load" }, true, "https://evil.example"))).status, 403);
    assert.equal((await handler(request({ action: "load", subject: "someone-else" }))).status, 400);
    assert.equal((await handler(request({ action: "save", snapshot: snapshot("test"), ticket: "forged.signature" }))).status, 400);
    assert.equal((await handler(request({ action: "reserve", snapshot: { ...snapshot("bad"), parents: ["../secret"] } }))).status, 400);
    assert.equal((await handler(request({ action: ["save"], snapshot: snapshot("bad action") }))).status, 400);
    assert.equal(drive.calls, 0);
  } finally { restore(); }
});

test("immutable Drive uploads read back metadata, parent, bytes and checksum; ticket retries never duplicate", async () => {
  const restore = environment(); const drive = new FakeDrive(); const handler = provider(drive);
  try {
    const value = snapshot("Смета фасада: 100 м²");
    const { data, ticket } = await save(handler, value);
    const retried = await handler(request({ action: "save", snapshot: value, ticket }));
    assert.equal(retried.status, 200); assert.equal(drive.uploads, 1);
    assert.equal((await retried.json()).revision.id, data.revision.id);
    const load = await (await handler(request({ action: "load" }))).json();
    assert.deepEqual(load.snapshot, decodeSnapshot(value));
    assert.equal(load.heads.length, 1);
    assert.equal((await handler(request({ action: "save", snapshot: snapshot("changed"), ticket }))).status, 400);
    const text = JSON.stringify(load); assert.doesNotMatch(text, /unit-private-token|signingKey|authorizationUrl/);
    drive.corrupt = true;
    const corrupt = await handler(request({ action: "load" }));
    assert.equal(corrupt.status, 502); assert.doesNotMatch(await corrupt.text(), /unit-private-token/);
  } finally { restore(); }
});

test("concurrent and offline saves preserve branches and explicit recovery joins them", async () => {
  const restore = environment(); const drive = new FakeDrive(); const handler = provider(drive);
  try {
    const root = (await save(handler, snapshot("original"))).data.revision.id;
    const a = (await save(handler, snapshot("device A", [root]))).data.revision.id;
    const b = (await save(handler, snapshot("device B", [root]))).data;
    assert.deepEqual(new Set(b.heads.map((r: { id: string }) => r.id)), new Set([a, b.revision.id]));
    assert.equal((await (await handler(request({ action: "load" }))).json()).snapshot, undefined);
    const resolved = (await save(handler, snapshot("device B", [a, b.revision.id]))).data;
    assert.equal(resolved.heads.length, 1); assert.equal(drive.uploads, 4);
    const old = await (await handler(request({ action: "load", id: a }))).json(); assert.equal(old.snapshot.workspace.draft, "device A");
  } finally { restore(); }
});

test("new device restores automatically, reload does not write or request OAuth", async () => {
  const restore = environment(); const drive = new FakeDrive(); const handler = provider(drive); const devices: ReturnType<typeof browser>[] = [];
  try {
    const a = browser(handler, { ...emptyWorkspace(), draft: "Saved draft" }); devices.push(a); await a.controller.sync();
    assert.equal(a.state.status, "saved"); assert.equal(drive.uploads, 1);
    a.controller.dispose();
    const reload = browser(handler, a.workspace, a.storage); devices.push(reload); await reload.controller.sync(); assert.equal(reload.state.status, "saved"); assert.equal(drive.uploads, 1);
    const b = browser(handler); devices.push(b); await b.controller.sync();
    assert.equal(b.workspace.draft, "Saved draft"); assert.equal(b.state.status, "saved"); assert.equal(drive.uploads, 1);
    assert.equal(JSON.parse(b.storage.getItem(WORKSPACE_STORAGE_KEY)!).draft, "Saved draft");
  } finally { devices.forEach(d => d.controller.dispose()); restore(); }
});

test("lost save response and reload reconcile the same preallocated file before subsequent edits", async () => {
  const restore = environment(); const drive = new FakeDrive(); const handler = provider(drive); const devices: ReturnType<typeof browser>[] = [];
  try {
    const a = browser(handler, { ...emptyWorkspace(), draft: "first" }); devices.push(a); a.loseResponse(); await a.controller.sync();
    assert.equal(a.state.status, "error"); assert.ok(JSON.parse([...a.storage.map.entries()].find(([k]) => k.startsWith(CLOUD_STORAGE_KEY + ".pending."))![1]).ticket); assert.equal(drive.uploads, 1); a.controller.dispose();
    const b = browser(handler, { ...emptyWorkspace(), draft: "later edits" }, a.storage); devices.push(b); await b.controller.sync();
    assert.equal(b.state.status, "saved"); assert.equal(drive.uploads, 2); assert.equal(JSON.parse(b.storage.getItem(CLOUD_STORAGE_KEY)!).pending, undefined);
    assert.equal((await (await handler(request({ action: "load" }))).json()).snapshot.workspace.draft, "later edits");
  } finally { devices.forEach(d => d.controller.dispose()); restore(); }
});

test("provider timeout after commit retries safely; quota failure never sends unjournaled writes", async () => {
  const restore = environment(); const drive = new FakeDrive(); const handler = provider(drive); const devices: ReturnType<typeof browser>[] = [];
  try {
    const a = browser(handler, { ...emptyWorkspace(), draft: "durable" }); devices.push(a); drive.failAfterWrite = true; await a.controller.sync(); assert.equal(a.state.status, "error");
    await a.controller.sync(); assert.equal(a.state.status, "saved"); assert.equal(drive.uploads, 1);
    a.edit("unsent"); a.storage.failJournal = true; await a.controller.sync(); assert.equal(drive.uploads, 1); assert.notEqual(a.state.status, "saved");
    a.storage.failJournal = false; await a.controller.sync(); assert.equal(drive.uploads, 2); assert.equal(a.state.status, "saved");
  } finally { devices.forEach(d => d.controller.dispose()); restore(); }
});

test("different device data is retained as a conflict, recovery preserves history, local clear pauses cloud writes", async () => {
  const restore = environment(); const drive = new FakeDrive(); const handler = provider(drive); const devices: ReturnType<typeof browser>[] = [];
  try {
    const a = browser(handler, { ...emptyWorkspace(), draft: "cloud A" }); devices.push(a); await a.controller.sync();
    const b = browser(handler, { ...emptyWorkspace(), draft: "local B" }); devices.push(b); await b.controller.sync();
    assert.equal(b.state.status, "conflict"); assert.equal(b.workspace.draft, "local B"); assert.equal(drive.uploads, 2);
    const selected = b.state.heads.find(r => r.id !== JSON.parse(b.storage.getItem(CLOUD_STORAGE_KEY)!).base)!;
    await b.controller.restoreVersion(selected.id); assert.equal(b.workspace.draft, "cloud A"); assert.equal(b.state.status, "saved"); assert.equal(drive.uploads, 3);
    b.controller.pause(); b.edit(""); await b.controller.sync(); assert.equal(b.state.status, "paused"); assert.equal(drive.uploads, 3);
    b.controller.resume(); // wait by an explicit subsequent sync after the in-flight resume operation
    for (let n = 0; n < 50 && b.controller.isBusy(); n++) await new Promise(resolve => setTimeout(resolve, 1));
    assert.equal(b.workspace.draft, "cloud A"); assert.equal(drive.uploads, 3);
  } finally { devices.forEach(d => d.controller.dispose()); restore(); }
});

test("local clear removes durable Drive payloads before pausing autosave", async () => {
  const restore = environment(); const drive = new FakeDrive(); const handler = provider(drive); const devices: ReturnType<typeof browser>[] = [];
  try {
    const client = browser(handler, { ...emptyWorkspace(), draft: "private unsent draft" }); devices.push(client);
    client.loseResponse(); await client.controller.sync();
    assert.equal(client.state.status, "error");
    assert.equal([...client.storage.map.keys()].filter(key => key.includes(".pending.")).length, 1);
    assert.match([...client.storage.map.values()].join("\n"), /private unsent draft/);

    client.controller.pause();
    assert.equal([...client.storage.map.keys()].filter(key => key.includes(".pending.")).length, 0);
    assert.deepEqual(JSON.parse(client.storage.getItem(CLOUD_STORAGE_KEY)!), { version: 1, paused: true });
    assert.doesNotMatch([...client.storage.map.values()].join("\n"), /private unsent draft/);

    const reload = browser(handler, emptyWorkspace(), client.storage); devices.push(reload);
    await reload.controller.sync();
    assert.equal(reload.state.status, "paused");
    assert.equal(drive.uploads, 1);
  } finally { devices.forEach(device => device.controller.dispose()); restore(); }
});

test("a shared pause marker stops stale controllers in every open tab", async () => {
  const restore = environment(); const drive = new FakeDrive(); const handler = provider(drive); const devices: ReturnType<typeof browser>[] = [];
  try {
    const storage = new MemoryStorage();
    const first = browser(handler, { ...emptyWorkspace(), draft: "cloud baseline" }, storage); devices.push(first);
    const staleTab = browser(handler, { ...emptyWorkspace(), draft: "old tab state" }, storage); devices.push(staleTab);
    await first.controller.sync();
    assert.equal(drive.uploads, 1);

    first.controller.pause();
    staleTab.edit("private edit after clear");
    await staleTab.controller.sync();

    assert.equal(staleTab.state.status, "paused");
    assert.equal(drive.uploads, 1);
    assert.equal([...storage.map.keys()].filter(key => key.includes(".pending.")).length, 0);
    assert.doesNotMatch([...storage.map.values()].join("\n"), /private edit after clear|old tab state/);
    assert.deepEqual(JSON.parse(storage.getItem(CLOUD_STORAGE_KEY)!), { version: 1, paused: true });
  } finally { devices.forEach(device => device.controller.dispose()); restore(); }
});

test("pausing during reservation cancels the pending upload before Drive save", async () => {
  const restore = environment(); const drive = new FakeDrive(); const handler = provider(drive);
  const storage = new MemoryStorage(); let workspace = { ...emptyWorkspace(), draft: "clear while reserving" }; let state: AutosaveState | undefined;
  let release!: () => void; let reserved!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { reserved = resolve; });
  const controller = new DriveAutosave({ storage, getWorkspace: () => workspace, restore: value => { workspace = value; }, notify: value => { state = value; }, fetch: async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    const response = await handler(request(body));
    if (body.action === "reserve") { reserved(); await blocked; }
    return response;
  } });
  try {
    const running = controller.sync(); await started;
    controller.pause(); release(); await running;
    assert.equal(state?.status, "paused");
    assert.equal(drive.uploads, 0);
    assert.equal([...storage.map.keys()].filter(key => key.includes(".pending.")).length, 0);
    assert.doesNotMatch([...storage.map.values()].join("\n"), /clear while reserving/);
  } finally { controller.dispose(); restore(); }
});

test("another tab's unfinished outbox is recovered without replacing newer cloud data with an unchanged local copy", async () => {
  const restore = environment(); const drive = new FakeDrive(); const handler = provider(drive); const devices: ReturnType<typeof browser>[] = [];
  try {
    const a = browser(handler, { ...emptyWorkspace(), draft: "first" }); devices.push(a); await a.controller.sync();
    const b = browser(handler, a.workspace, a.storage); devices.push(b);
    a.edit("newer from tab A"); a.loseResponse(); await a.controller.sync(); assert.equal(drive.uploads, 2);
    // B was already open and has an older in-memory baseline. It must recover A's durable task first.
    await b.controller.sync(); assert.equal(b.workspace.draft, "newer from tab A"); assert.equal(b.state.status, "saved"); assert.equal(drive.uploads, 2);
    assert.equal([...a.storage.map.keys()].filter(k => k.includes(".pending.")).length, 0);
  } finally { devices.forEach(d => d.controller.dispose()); restore(); }
});

test("edits during a slow cloud load are never replaced by automatic restore", async () => {
  const restore = environment(); const drive = new FakeDrive(); const handler = provider(drive);
  let release!: () => void; let edited!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; }); const started = new Promise<void>(resolve => { edited = resolve; });
  const seed = browser(handler, { ...emptyWorkspace(), draft: "cloud version" });
  let workspace = emptyWorkspace(); let state: AutosaveState | undefined;
  let hold = true;
  const client = new DriveAutosave({ storage: new MemoryStorage(), getWorkspace: () => workspace, restore: w => { workspace = w; }, notify: s => { state = s; }, fetch: async (_url, init) => {
    const body = JSON.parse(String(init?.body)); const response = await handler(request(body));
    if (hold && body.action === "load") { hold = false; edited(); await blocked; }
    return response;
  } });
  try {
    await seed.controller.sync(); const running = client.sync(); await started;
    workspace = { ...workspace, draft: "new local edit while loading" }; client.changed(); release(); await running;
    assert.equal(workspace.draft, "new local edit while loading"); assert.equal(state?.status, "conflict"); assert.equal(drive.uploads, 2);
  } finally { seed.controller.dispose(); client.dispose(); restore(); }
});

test("oversize projects cannot poison the durable outbox; reducing the size resumes saving", async () => {
  const restore = environment(); const drive = new FakeDrive(); const handler = provider(drive);
  const huge = emptyWorkspace(); huge.messages = Array.from({ length: 20 }, (_, i) => ({ id: `message-${i}`, role: "user", content: "x".repeat(160000) }));
  const client = browser(handler, huge);
  try {
    await client.controller.sync(); assert.equal(client.state.status, "error"); assert.equal(drive.uploads, 0);
    assert.equal([...client.storage.map.keys()].filter(k => k.includes(".pending.")).length, 0);
    // Existing history still fits locally; changing the active draft alone cannot shrink it.
    const small = browser(handler, { ...emptyWorkspace(), draft: "small" }, client.storage);
    try { await small.controller.sync(); assert.equal(small.state.status, "saved"); assert.equal(drive.uploads, 1); } finally { small.controller.dispose(); }
  } finally { client.controller.dispose(); restore(); }
});
