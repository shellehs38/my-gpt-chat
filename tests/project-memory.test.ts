import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { handleMemoryMcp } from "../lib/server/memory-mcp";
import { memoryStatus, projectMemoryContext, searchCodeMemory, type ProjectMemory } from "../lib/server/project-memory";

export const fixture: ProjectMemory = {
  schemaVersion: 1, source: "Codebase Memory MCP", upstreamVersion: "0.12.1", project: "svoi-lyudi-builder", repository: "shellehs38/my-gpt-chat",
  revision: "test-revision", fingerprint: "a".repeat(64), generatedAt: "2026-10-19T00:00:00.000Z", access: "public-project-readonly",
  sections: [{ heading: "COMPANY DOCUMENT BRANDING", content: "Подлинный логотип в каждом документе." }],
  symbols: [{ kind: "Function", name: "runLedgerCommand", file: "lib/server/ledger.ts", line: 100, endLine: 200 }, { kind: "Function", name: "readSession", file: "lib/server/auth.ts", line: 20, endLine: 50 }],
  graph: { nodeLabels: [], edgeTypes: [] }, limitations: ["Read-only build snapshot, not a live native engine."],
};

test("chat context carries the same public decisions and fingerprint as MCP", () => {
  const context = projectMemoryContext(fixture, "Где runLedgerCommand?");
  assert.match(context, /Подлинный логотип/);
  assert.match(context, /runLedgerCommand/);
  assert.match(context, new RegExp(fixture.fingerprint));
  assert.match(context, /не память переписки/);
  assert.equal(searchCodeMemory(fixture, "unmatched").length, 0);
  assert.equal(searchCodeMemory(fixture, "runLedgerCommand")[0].file, "lib/server/ledger.ts");
  assert.equal(searchCodeMemory(fixture, "lib", 100).length, 2);
});

test("standard MCP client discovers and calls every published memory tool", async () => {
  const client = new Client({ name: "memory-integration-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL("https://assistant.test/api/mcp"), {
    fetch: async (input, init) => handleMemoryMcp(new Request(input, init), fixture),
  });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), ["get_file_outline", "get_memory_status", "get_project_memory", "search_codebase"]);
    assert.ok(listed.tools.every((tool) => tool.annotations?.readOnlyHint === true && tool.annotations?.destructiveHint === false));
    const decisions = await client.callTool({ name: "get_project_memory", arguments: {} });
    assert.match(JSON.stringify(decisions), /COMPANY DOCUMENT BRANDING/);
    assert.match(JSON.stringify(decisions), new RegExp(fixture.fingerprint));
    const status = await client.callTool({ name: "get_memory_status", arguments: {} });
    assert.deepEqual(status.structuredContent, memoryStatus(fixture));
    const found = await client.callTool({ name: "search_codebase", arguments: { query: "runLedgerCommand" } });
    assert.match(JSON.stringify(found), /lib\/server\/ledger.ts/);
    const outline = await client.callTool({ name: "get_file_outline", arguments: { path: "lib/server/ledger.ts" } });
    assert.match(JSON.stringify(outline), /runLedgerCommand/);
    const invalid = await client.callTool({ name: "search_codebase", arguments: { query: "runLedgerCommand", limit: 9999 } });
    assert.equal(invalid.isError, true);
    const traversal = await client.callTool({ name: "get_file_outline", arguments: { path: "../../.env" } });
    assert.equal(traversal.isError, true);
    const unknown = await client.callTool({ name: "execute_shell", arguments: { command: "anything" } });
    assert.equal(unknown.isError, true);
  } finally { await client.close(); }
});

test("MCP rejects foreign browser origins, oversized bodies and malformed JSON", async () => {
  const make = (body: string, headers = {}) => new Request("https://assistant.test/api/mcp", { method: "POST", body, headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers } });
  assert.equal((await handleMemoryMcp(make("{}", { origin: "https://evil.test" }), fixture)).status, 403);
  assert.equal((await handleMemoryMcp(make("{"), fixture)).status, 400);
  assert.equal((await handleMemoryMcp(make("x".repeat(17000)), fixture)).status, 413);
  assert.equal((await handleMemoryMcp(new Request("https://assistant.test/api/mcp"), fixture)).status, 405);
});
