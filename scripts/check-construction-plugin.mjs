import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = join(repository, "plugin-source/svoi-lyudi-builder/skills/construction-assistant/references");
const files = ["facade-systems.md", "construction-operations.md", "estimating-project-control.md", "quality-safety-logistics.md", "regulatory-source-map.md"];
const documents = await Promise.all(files.map(async (name) => ({ name, text: await readFile(join(root, name), "utf8") })));
const content = documents.map((document) => document.text).join("\n");
for (const document of documents) {
  if (!document.text.startsWith("# ")) throw new Error(`Missing title: ${document.name}`);
  for (const match of document.text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    if (!/^https?:\/\//.test(match[1]) && !files.includes(match[1])) throw new Error(`Unknown reference in ${document.name}: ${match[1]}`);
  }
}
for (const marker of [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\bsk-[A-Za-z0-9_-]{20,}\b/, /\bAIza[A-Za-z0-9_-]{20,}\b/, /pricing-40percent/, /40%/]) {
  if (marker.test(content)) throw new Error(`Private information in public knowledge: ${marker}`);
}
console.log(`Construction knowledge: ${documents.length} reference files, local links and public-content boundaries verified.`);
