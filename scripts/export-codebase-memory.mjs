import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { root, project, environment, call } from "./codebase-memory.mjs";

// Run the real pinned engine at build time; production serves its read-only export.
for (const command of ["install", "index"]) {
  const result = spawnSync(process.execPath, [join(root, "scripts/codebase-memory.mjs"), command], { cwd: root, env: environment, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`Memory ${command} failed; refusing to publish stale context.`);
}
const safePath = (path) => typeof path === "string" && /^(?:app|components|lib|scripts|tests)\/[\w./-]+\.(?:ts|tsx|mjs)$/.test(path) && !path.split("/").includes("..");
const symbols = [];
for (const kind of ["Function", "Class", "Type", "Interface", "Method"]) {
  const result = call("query_graph", { project, query: `MATCH (n:${kind}) RETURN n.name, n.file_path, n.start_line, n.end_line`, max_rows: 10000, max_output_tokens: 200000, format: "json" });
  if (result.has_more || result.truncated) throw new Error(`Incomplete ${kind} export.`);
  for (const [name, file, start, end] of result.rows) {
    if (safePath(file) && typeof name === "string") symbols.push({ kind, name, file, line: Number(start) || 1, endLine: Number(end) || Number(start) || 1 });
  }
}
symbols.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.name.localeCompare(b.name));
const adr = call("manage_adr", { project, mode: "get", format: "json" });
const managed = await readFile(join(root, "docs/CODEBASE_MEMORY_ADR.md"), "utf8");
const sections = managed.split(/^## /m).slice(1).map((section) => {
  const [heading, ...body] = section.split("\n");
  const content = body.join("\n").trim();
  if (!adr.content.includes(`## ${heading.trim()}\n${content}`)) throw new Error(`ADR section not synchronized: ${heading}`);
  return { heading: heading.trim(), content };
});
const schema = call("get_graph_schema", { project, format: "json" });
const hash = createHash("sha256");
const files = [...new Set(symbols.map((symbol) => symbol.file).concat(["docs/CODEBASE_MEMORY_ADR.md", "DOCUMENT_BRANDING.md"]))].sort();
for (const file of files) hash.update(file + "\0").update(await readFile(join(root, file))).update("\0");
const git = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
const snapshot = { schemaVersion: 1, source: "Codebase Memory MCP", upstreamVersion: "0.12.1", project, repository: "shellehs38/my-gpt-chat", revision: environment.VERCEL_GIT_COMMIT_SHA || environment.GITHUB_SHA || git.stdout?.trim() || "local", fingerprint: hash.digest("hex"), generatedAt: new Date().toISOString(), access: "public-project-readonly", sections, symbols, graph: { nodeLabels: schema.node_labels, edgeTypes: schema.edge_types }, limitations: ["Read-only build snapshot, not a live native engine.", "Contains public project rules and symbol locations, not customer records or conversations.", "Static analysis can miss dynamic dependencies; absence is not proof."] };
if (!symbols.some((symbol) => symbol.name === "runLedgerCommand") || !sections.some((section) => section.heading === "COMPANY DOCUMENT BRANDING")) throw new Error("Required project memory is missing.");
await mkdir(join(root, "data"), { recursive: true });
await writeFile(join(root, "data/codebase-memory.json"), JSON.stringify(snapshot) + "\n");
console.error(`Published memory export: ${symbols.length} symbols, ${sections.length} ADR sections, ${snapshot.fingerprint.slice(0, 12)}.`);
