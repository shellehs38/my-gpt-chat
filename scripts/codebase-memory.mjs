import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const project = "svoi-lyudi-builder";
const lock = JSON.parse(await readFile(join(root, "tools/codebase-memory.lock.json"), "utf8"));
const platform = `${process.platform}-${process.arch}`;
const asset = lock.assets[platform];
export const binary = join(root, ".local/codebase-memory", `v${lock.version}`, platform, "codebase-memory-mcp");
export const environment = { ...process.env, CBM_ALLOWED_ROOT: root, CBM_WORKERS: process.env.CBM_WORKERS || "2", CBM_MEM_BUDGET_MB: process.env.CBM_MEM_BUDGET_MB || "512" };

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
export async function verifyBinary() {
  if (!asset) throw new Error("This project launcher supports Linux/macOS x64 and arm64. See docs/CODEBASE_MEMORY.md for other clients.");
  if (!existsSync(binary)) throw new Error("Run npm run memory:install before starting Codebase Memory.");
  if (await sha256(binary) !== asset.binarySha256) throw new Error("Codebase Memory binary checksum mismatch. Run memory:install to reinstall the pinned release.");
}
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, env: environment, encoding: "utf8", timeout: 180000, maxBuffer: 16 * 1024 * 1024, ...options });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || `${command} failed: ${(result.stderr || result.stdout || "").slice(-2000)}`);
  return result.stdout;
}
async function install() {
  if (!asset) throw new Error(`Unsupported platform ${platform}; use the upstream installer for your OS.`);
  if (existsSync(binary) && existsSync(join(dirname(binary), "LICENSE")) && existsSync(join(dirname(binary), "THIRD_PARTY_NOTICES.md")) && await sha256(binary) === asset.binarySha256) { console.error(`Codebase Memory ${lock.version} is verified.`); return; }
  await mkdir(dirname(binary), { recursive: true });
  const staging = await mkdtemp(join(dirname(binary), ".download-"));
  try {
    const archive = join(staging, asset.archive);
    const url = `https://github.com/${lock.repository}/releases/download/v${lock.version}/${asset.archive}`;
    console.error(`Downloading verified Codebase Memory ${lock.version} for ${platform}…`);
    // curl preserves the machine's proxy/CA configuration. No shell or upstream install script is executed.
    run("curl", ["--fail", "--location", "--silent", "--show-error", "--proto", "=https", "--proto-redir", "=https", "--max-time", "120", "--output", archive, url]);
    if (await sha256(archive) !== asset.sha256) throw new Error("Release archive checksum mismatch.");
    const members = run("tar", ["-tzf", archive]).trim().split(/\r?\n/);
    const expected = new Set(["codebase-memory-mcp", "LICENSE", "install.sh", "THIRD_PARTY_NOTICES.md"]);
    if (members.length !== expected.size || members.some((name) => !expected.has(name))) throw new Error("Unexpected release archive members.");
    // Extract authenticated members through stdout; archive paths cannot write elsewhere.
    const candidate = join(staging, "codebase-memory-mcp");
    const output = createWriteStream(candidate, { flags: "wx", mode: 0o700 });
    const extraction = spawn("tar", ["-xzOf", archive, "codebase-memory-mcp"], { stdio: ["ignore", "pipe", "inherit"] });
    await new Promise((accept, reject) => {
      let exited = false, finished = false;
      const complete = () => { if (exited && finished) accept(); };
      const fail = (error) => { extraction.kill("SIGTERM"); output.destroy(); reject(error); };
      output.on("error", fail); extraction.on("error", fail);
      extraction.on("exit", (code) => { if (code !== 0) reject(new Error("Binary extraction failed.")); else { exited = true; complete(); } });
      output.on("finish", () => { finished = true; complete(); });
      extraction.stdout.pipe(output);
    });
    if (await sha256(candidate) !== asset.binarySha256) throw new Error("Extracted binary checksum mismatch.");
    for (const name of ["LICENSE", "THIRD_PARTY_NOTICES.md"]) await writeFile(join(dirname(binary), name), run("tar", ["-xzOf", archive, name]));
    await chmod(candidate, 0o755);
    const version = run(candidate, ["--version"]).trim();
    if (version !== `codebase-memory-mcp ${lock.version}`) throw new Error("Unexpected binary version.");
    await rename(candidate, binary);
    console.error(`${version} installed locally; agent configuration and global hooks were not changed.`);
  } finally { await rm(staging, { recursive: true, force: true }); }
}
export function payload(envelope) {
  if (envelope.isError || envelope.error) throw new Error(JSON.stringify(envelope.error || envelope.content));
  if (envelope.structuredContent) return envelope.structuredContent;
  const text = envelope.content?.filter((block) => block.type === "text").map((block) => block.text).join("\n");
  return text ? JSON.parse(text) : envelope;
}
export function call(tool, args = {}) {
  return payload(JSON.parse(run(binary, ["cli", "--json", tool], { input: JSON.stringify(args) })));
}
export function syncDecisions() {
  return readFile(join(root, "docs/CODEBASE_MEMORY_ADR.md"), "utf8").then((text) => {
    const updates = {};
    for (const section of text.split(/^## /m).slice(1)) {
      const [heading, ...body] = section.split("\n");
      updates[heading.trim()] = body.join("\n").trim();
    }
    if (!Object.keys(updates).length) throw new Error("No managed ADR sections found.");
    return call("manage_adr", { project, mode: "set_sections", section_updates: updates, format: "json" });
  });
}

async function main() {
  const [command = "serve", ...args] = process.argv.slice(2);
  if (command === "install") return install();
  await verifyBinary();
  if (command === "index") {
    const args = { repo_path: root, name: project, mode: "full", persistence: false };
    const result = call("index_repository", args);
    if (result.status && !["indexed", "unchanged", "up_to_date"].includes(result.status)) throw new Error(`Index not confirmed: ${JSON.stringify(result)}`);
    await syncDecisions();
    const refreshed = call("index_repository", { ...args, persistence: true });
    if (refreshed.status !== "indexed" || !refreshed.adr_present) throw new Error("Index/ADR snapshot was not confirmed.");
    console.log(JSON.stringify({ ...refreshed, adr_synced: true }, null, 2)); return;
  }
  if (command === "cli") { process.stdout.write(run(binary, ["cli", ...args], { stdio: ["inherit", "pipe", "inherit"] })); return; }
  if (command !== "serve") throw new Error("Use install, index, cli <tool> or serve.");
  const child = spawn(binary, ["--ui=false"], { cwd: root, env: environment, stdio: "inherit" });
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
  child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
  child.on("exit", (code) => { process.exitCode = code ?? 1; });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
