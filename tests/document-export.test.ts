import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import ExcelJS from "exceljs";
import { POST } from "../app/api/documents/export/route";
import { createBrandedDocument, validateDocumentExport, DOCUMENT_BODY_BYTES, type DocumentExport } from "../lib/server/document-export";
import { createSessionToken, getAccessConfig, SESSION_COOKIE } from "../lib/server/auth";
import { resetRateLimitsForTests } from "../lib/server/rate-limit";
import { buildInstructions } from "../lib/server/chat";

const input: DocumentExport = { format: "pdf", title: "Смета — проверочный образец", versionDate: "05.11.2026", markdown: `# Договор подряда
Согласованная цена со скидкой. Все данные — тестовые.

| Наименование | Количество | Цена, ₽ | Сумма, ₽ | Примечание |
| --- | --- | --- | --- | --- |
| Комплект работ | 2 | 10000 | 19500 | Скидка согласована |
| Итого | | | 19500 | |

Стоимость договора: 19500 рублей.` };

test("export rejects unsupported formats, remote images and unbounded input", () => {
  assert.deepEqual(validateDocumentExport(input), input);
  for (const bad of [{ ...input, format: "exe" }, { ...input, format: "__proto__" }, { ...input, logo: "https://example.org/unapproved.png" }, { ...input, markdown: "x".repeat(80001) }, { ...input, title: "\0" }, { ...input, markdown: "" }]) assert.throws(() => validateDocumentExport(bad));
});

test("PDF embeds original logo and Cyrillic fonts; long tables have multiple branded pages", async () => {
  const bytes = await createBrandedDocument({ ...input, markdown: input.markdown + "\n\n| Позиция | Объём |\n| --- | --- |\n" + Array.from({ length: 100 }, (_, i) => `| Контрольная позиция ${i} | 1 |`).join("\n") });
  assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
  const text = bytes.toString("latin1");
  assert.match(text, /\/Subtype \/Image/);
  assert.match(text, /DejaVuSans/);
  assert.ok((text.match(/\/Type \/Page\b/g) || []).length >= 3);
  // Each page references an image; a sign on page 1 alone is insufficient.
  assert.ok((text.match(/\/I\d+ \d+ 0 R/g) || []).length >= 3);
  assert.ok(bytes.length < 700_000, "repeating logo should reuse the embedded image rather than inflating every page");
});

test("Word contains exact approved PNG, table values and a repeating branded header", async () => {
  const bytes = await createBrandedDocument({ ...input, format: "docx" });
  const zip = await JSZip.loadAsync(bytes), logo = await readFile("public/brand/logo-sl-approved-light.png");
  const media = Object.values(zip.files).filter(f => f.name.startsWith("word/media/") && !f.dir);
  assert.ok(media.length > 0);
  assert.ok((await Promise.all(media.map(async f => (await f.async("nodebuffer")).equals(logo)))).some(Boolean));
  const xml = await zip.file("word/document.xml")!.async("string");
  assert.match(xml, /19500/); assert.match(xml, /Скидка согласована/); assert.doesNotMatch(xml, /20000/);
  assert.match(xml, /headerReference/);
  const header = await zip.file("word/header1.xml")!.async("string"); assert.match(header, /a:blip/);
  assert.doesNotMatch(await zip.file("word/_rels/document.xml.rels")!.async("string"), /TargetMode="External"/);
});

test("Excel embeds PNG in the printable sheet and preserves agreed prices and formula-looking text", async () => {
  const bytes = await createBrandedDocument({ ...input, format: "xlsx", markdown: input.markdown + "\n\n| Поле | Значение |\n| --- | --- |\n| =1+1 | Не исполнять |" });
  const zip = await JSZip.loadAsync(bytes), logo = await readFile("public/brand/logo-sl-approved-light.png");
  const media = Object.values(zip.files).filter(f => f.name.startsWith("xl/media/") && !f.dir);
  assert.equal(media.length, 1); assert.deepEqual(await media[0].async("nodebuffer"), logo);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(new Uint8Array(bytes) as unknown as ExcelJS.Buffer);
  assert.equal(wb.worksheets.length, 1);
  const sheet = wb.worksheets[0]; assert.equal(sheet.getImages().length, 1);
  assert.match(sheet.pageSetup.printArea!, /^A1:/);
  assert.equal(sheet.pageSetup.fitToWidth, 1); assert.equal(sheet.pageSetup.fitToHeight, 0);
  const values: ExcelJS.CellValue[] = []; sheet.eachRow(row => row.eachCell(cell => values.push(cell.value)));
  assert.ok(values.includes("19500")); assert.ok(!values.includes("20000")); assert.ok(values.includes("=1+1"));
  assert.ok(values.every(value => typeof value !== "object" || value === null || !("formula" in value)));
});

test("missing original logo prevents every binary format instead of producing an unbranded file", async () => {
  const cwd = process.cwd(), directory = await mkdtemp(join(tmpdir(), "logo-export-test-"));
  try {
    process.chdir(directory);
    for (const format of ["pdf", "docx", "xlsx"] as const) await assert.rejects(createBrandedDocument({ ...input, format }), /ENOENT/);
  } finally { process.chdir(cwd); await rm(directory, { recursive: true }); }
});

test("long Excel notes continue on rows below the maximum height without lost text", async () => {
  const note = "Длинное примечание для проверки.\n".repeat(150);
  const markdown = "| Позиция | Примечание |\n| --- | --- |\n| Проверка | " + note.replace(/\n/g, "<br>") + " |";
  const bytes = await createBrandedDocument({ ...input, format: "xlsx", markdown });
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(new Uint8Array(bytes) as unknown as ExcelJS.Buffer);
  const parts: string[] = [];
  wb.worksheets[0].eachRow(row => { assert.ok((row.height || 0) <= 409); if (row.number > 10) parts.push(String(row.getCell(2).value || "")); });
  assert.equal(parts.join(""), note);
});

test("download route requires owner session and same origin, caps body, returns real bytes without provider calls", async () => {
  const names = ["ASSISTANT_ACCESS_PASSWORD", "ASSISTANT_SESSION_SECRET", "ASSISTANT_PUBLIC_ORIGIN"] as const;
  const old = names.map(n => process.env[n]), original = globalThis.fetch;
  process.env.ASSISTANT_ACCESS_PASSWORD = "document-test-password-only";
  process.env.ASSISTANT_SESSION_SECRET = "document-test-signing-secret-longer-than-32";
  delete process.env.ASSISTANT_PUBLIC_ORIGIN; resetRateLimitsForTests();
  globalThis.fetch = async () => { throw Error("No network allowed during export"); };
  const request = (authenticated = true, origin = "https://assistant.test", body = input, extra = {}) => new Request("https://assistant.test/api/documents/export", { method: "POST", headers: { origin, "content-type": "application/json", ...(authenticated ? { cookie: `${SESSION_COOKIE}=${createSessionToken(getAccessConfig()!)}` } : {}), ...extra }, body: JSON.stringify(body) });
  try {
    assert.equal((await POST(request(false))).status, 401);
    assert.equal((await POST(request(true, "https://other.test"))).status, 403);
    assert.equal((await POST(request(true, "https://assistant.test", input, { "content-length": String(DOCUMENT_BODY_BYTES + 1) }))).status, 413);
    const response = await POST(request()); assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/pdf");
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.match(response.headers.get("content-disposition")!, /\.pdf/);
    assert.equal(Buffer.from(await response.arrayBuffer()).subarray(0, 5).toString(), "%PDF-");
  } finally { globalThis.fetch = original; names.forEach((n, i) => { if (old[i] === undefined) delete process.env[n]; else process.env[n] = old[i]; }); resetRateLimitsForTests(); }
});

test("all six assistant modes enforce logo and distinguish files from copied text", () => {
  for (const mode of ["general", "estimate", "engineering", "facade", "business", "documents"] as const) {
    const instructions = buildInstructions({ mode, message: "Подготовь документ", history: [] });
    assert.match(instructions, /каждый документ/); assert.match(instructions, /PDF, Word \(DOCX\), Excel \(XLSX\) и HTML/);
    assert.match(instructions, /Текст ответа сам по себе не подтверждает/);
  }
});
