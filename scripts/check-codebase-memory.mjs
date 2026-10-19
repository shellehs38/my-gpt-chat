import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { root, project, environment, payload, verifyBinary, syncDecisions, call } from "./codebase-memory.mjs";

await verifyBinary();
const reportDirectory = join(root, ".local/codebase-memory/reports");
await mkdir(reportDirectory, { recursive: true });
const pending = new Map();
const child = spawn(process.execPath, [join(root, "scripts/codebase-memory.mjs"), "serve"], { cwd: root, env: environment, stdio: ["pipe", "pipe", "pipe"] });
let buffer = "", diagnostics = "", nextId = 0, report;
child.stderr.on("data", (data) => { diagnostics = (diagnostics + data.toString()).slice(-4000); });
child.stdout.on("data", (data) => {
  buffer += data.toString();
  let end;
  while ((end = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
    if (!line.trim()) continue;
    let message;
    try { message = JSON.parse(line); } catch { failed(new Error("MCP stdout contained non-JSON output.")); child.kill("SIGTERM"); return; }
    if (message.id !== undefined) {
      const waiter = pending.get(message.id);
      if (waiter) { pending.delete(message.id); clearTimeout(waiter.timer); message.error ? waiter.reject(new Error(JSON.stringify(message.error))) : waiter.resolve(message.result); }
    }
  }
});
function failed(error) {
  for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
  pending.clear();
}
child.on("error", failed);
child.on("exit", () => failed(new Error(`MCP exited early. ${diagnostics}`)));
function rpc(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`MCP timeout: ${method}`)); }, 120000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
}
const invoke = async (name, args = {}) => payload(await rpc("tools/call", { name, arguments: args }));
try {
  const initialized = await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "svoi-lyudi-memory-verification", version: "1.0.0" } });
  assert.equal(initialized.serverInfo.version, "0.12.1");
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  const { tools } = await rpc("tools/list");
  for (const name of ["index_repository", "get_graph_schema", "search_graph", "get_file_outline", "manage_adr", "check_index_coverage"]) assert.ok(tools.some((tool) => tool.name === name), name);
  const indexed = await invoke("index_repository", { repo_path: root, name: project, mode: "full", persistence: true });
  assert.equal(indexed.status, "indexed");
  assert.ok(indexed.nodes > 0 && indexed.edges > 0, "Graph must contain code and relationships");
  assert.equal(indexed.parse_unusable_count, 0);
  assert.ok(indexed.not_indexed_files.files.some((file) => file.path === ".env.example" && file.reason === "cbmignore"));
  await syncDecisions();
  const adr = await invoke("manage_adr", { project, mode: "get", format: "json" });
  assert.match(JSON.stringify(adr), /COMPANY DOCUMENT BRANDING/);
  assert.match(JSON.stringify(adr), /DOCUMENT_BRANDING\.md/);
  const symbols = {};
  for (const name of ["runLedgerCommand", "brandedDocumentHtml", "createSessionToken"]) {
    const result = await invoke("search_graph", { project, name_pattern: name, label: "Function", format: "json", limit: 10 });
    assert.match(JSON.stringify(result), new RegExp(name)); symbols[name] = true;
  }
  const schema = await invoke("get_graph_schema", { project, format: "json" });
  assert.ok(schema.edge_types.some((edge) => edge.type === "CALLS" && edge.count > 0));
  const outline = await invoke("get_file_outline", { project, file_path: "lib/server/ledger.ts", format: "json" });
  assert.match(JSON.stringify(outline), /runLedgerCommand/);
  const coverage = await invoke("check_index_coverage", { project, paths: ["lib/server/ledger.ts", "lib/server/auth.ts", "lib/document-branding.ts"], format: "json" });
  assert.equal(coverage.path_returned, 3);
  assert.ok(coverage.paths.every((path) => path.status === "no_recorded_issue" && path.freshness === "metadata_match"));
  // Keep full coverage evidence in the report; a clean result is not a proof of complete static analysis.
  const refreshed = await invoke("index_repository", { repo_path: root, name: project, mode: "full", persistence: true });
  assert.equal(refreshed.adr_present, true);
  const graph = await stat(join(root, ".codebase-memory/graph.db.zst"));
  assert.ok(graph.size > 0);
  await writeFile(join(reportDirectory, "schema.json"), JSON.stringify(schema, null, 2) + "\n");
  await writeFile(join(reportDirectory, "coverage.json"), JSON.stringify(coverage, null, 2) + "\n");
  report = { version: "0.12.1", protocol: initialized.protocolVersion, toolCount: tools.length, tools: tools.map((tool) => tool.name), indexedNodes: refreshed.nodes, indexedEdges: refreshed.edges, parseUnusable: refreshed.parse_unusable_count, expectedSymbols: symbols, adrBrandingRuleVerified: true, envFilesExcluded: true, graphArtifactBytes: graph.size, actualMcpJsonRpc: true, realModelCalls: 0, googleWrites: 0 };
} finally {
  child.stdin.end();
  const timer = setTimeout(() => child.kill("SIGTERM"), 5000);
  await new Promise((resolve) => { if (child.exitCode !== null) resolve(); else child.once("exit", resolve); });
  clearTimeout(timer);
}
// Verify that the ADR survives closing the MCP connection; this uses a new CLI session.
const persisted = call("manage_adr", { project, mode: "get", format: "json" });
assert.match(JSON.stringify(persisted), /COMPANY DOCUMENT BRANDING/);
report.adrSurvivesSessionRestart = true;
report.passed = true;
await writeFile(join(reportDirectory, "summary.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
console.error("Architecture decisions survived the MCP session restart.");
