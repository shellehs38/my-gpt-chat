import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const referenceDirectory = "plugin-source/svoi-lyudi-builder/skills/construction-assistant/references";
// Only this public reference set is exported; no plugin actions, private pricing,
// customer records or Google credentials can enter the website's model context.
const identifiers = ["facade-systems", "construction-operations", "estimating-project-control", "quality-safety-logistics", "regulatory-source-map"];
const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const files = await Promise.all(identifiers.map(async (id) => {
  const source = `${referenceDirectory}/${id}.md`;
  const text = (await readFile(join(root, source), "utf8")).replace(/\r\n?/g, "\n").trim() + "\n";
  if (Buffer.byteLength(text, "utf8") > 64 * 1024 || !text.startsWith("# ")) throw new Error(`Invalid construction reference: ${id}`);
  for (const secret of [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\bsk-[A-Za-z0-9_-]{20,}\b/, /\bAIza[A-Za-z0-9_-]{20,}\b/]) {
    if (secret.test(text)) throw new Error(`Refusing unsafe construction reference: ${id}`);
  }
  return { id, source, title: text.split("\n")[0].slice(2).trim(), text };
}));
const sourceMap = files.find((file) => file.id === "regulatory-source-map");
const review = sourceMap.text.slice(0, 1500).match(/(?:сверены|проверены)\s+(\d{1,2})\s+([а-яё]+)\s+(\d{4})/iu);
const months = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
if (!review || !months.includes(review[2].toLowerCase())) throw new Error("Construction source-map review date is missing.");
const checkedAt = `${review[3]}-${String(months.indexOf(review[2].toLowerCase()) + 1).padStart(2, "0")}-${review[1].padStart(2, "0")}`;
if (new Date(`${checkedAt}T00:00:00Z`).toISOString().slice(0, 10) !== checkedAt) throw new Error("Invalid construction review date.");
// This is the reference-set/source-map review date, not a claim that every
// regulation remains current on the date a user asks their question.
const documents = files.map((file) => ({ ...file, checkedAt, fingerprint: sha256(file.text) }));
const snapshot = { schemaVersion: 1, source: "versioned-construction-references", checkedAt, fingerprint: sha256(JSON.stringify(documents)), documents };
await mkdir(join(root, "data"), { recursive: true });
await writeFile(join(root, "data/construction-knowledge.json"), JSON.stringify(snapshot, null, 2) + "\n");
console.log(`Construction knowledge: ${documents.length} references, source review ${checkedAt}, fingerprint ${snapshot.fingerprint.slice(0, 12)}.`);
