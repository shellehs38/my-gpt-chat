import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import ExcelJS from "exceljs";
import { buildInstructions } from "../lib/server/chat";
import { brandedMarkdown } from "../lib/document-branding";
import { createBrandedDocument } from "../lib/server/document-export";
import { loadProjectMemory, publicProjectMemory } from "../lib/server/project-memory";

// Owner-confirmed card; no customer or object records are included in this fixture.
const confirmed = {
  shortName: "ООО «СВОИ ЛЮДИ»",
  fullName: 'ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ "СВОИ ЛЮДИ"',
  legalAddress: "664053, РОССИЯ, ИРКУТСКАЯ ОБЛАСТЬ, Г.О. ГОРОД ИРКУТСК, Г. ИРКУТСК, УЛ. БАУМАНА, Д. 234, КВ. 6",
  inn: "3812162353", kpp: "381201001", ogrn: "1243800012675",
  settlementAccount: "40702810810001649119",
  "bank.name": "АО «ТБанк»", "bank.inn": "7710140679", "bank.bic": "044525974",
  "bank.correspondentAccount": "30101810145250000974",
  "bank.legalAddress": "127287, г. Москва, ул. Хуторская 2-я, д. 38А, стр. 26",
  "director.fullName": "Касинич Сергей Юрьевич", "director.position": "Генеральный директор",
};
const template = Object.keys(confirmed).map(key => `${key}: {{company.${key}}}`).join("\n");

test("every assistant mode uses the confirmed company and corrected director without asking again", () => {
  for (const mode of ["general", "estimate", "engineering", "facade", "business", "documents"] as const) {
    const instructions = buildInstructions({ mode, message: "Подготовь документ с реквизитами подрядчика", history: [] });
    assert.ok(instructions.includes("Касинич Сергей Юрьевич"), mode);
    assert.ok(instructions.includes("3812162353"));
    assert.ok(instructions.includes("40702810810001649119"));
    assert.match(instructions, /не запрашивай.*повторно/iu);
  }
});

test("named company slots fill the complete card and preserve unrelated parties and user values", () => {
  const suffix = "\nЗаказчик: ИНН [заполнить]. {{customer.inn}}\nДругой счёт: 40700000000000000001\nНалог: {{company.taxRate}}";
  const markdown = brandedMarkdown(template + suffix, "https://assistant.test");
  for (const value of Object.values(confirmed)) assert.ok(markdown.includes(value), value);
  assert.ok(markdown.endsWith(suffix));
  assert.doesNotMatch(markdown, /\{\{company\.(?:inn|director\.fullName)\}\}/);
  assert.equal(brandedMarkdown("Согласованная цена: 19500 руб.", "https://assistant.test").split("\n\n").at(-1), "Согласованная цена: 19500 руб.");
});

for (const format of ["docx", "xlsx"] as const) {
  test(`${format} export fills company slots while retaining the agreed price and customer blanks`, async () => {
    const bytes = await createBrandedDocument({ format, title: "Реквизиты подрядчика", versionDate: "17.11.2026", markdown: template + "\nЗаказчик: ИНН [заполнить]\nСогласованная цена: 19500 руб." });
    let text = "";
    if (format === "docx") {
      const zip = await JSZip.loadAsync(bytes);
      text = (await zip.file("word/document.xml")!.async("string")).replaceAll("&quot;", '"');
    } else {
      const wb = new ExcelJS.Workbook(); await wb.xlsx.load(new Uint8Array(bytes) as unknown as ExcelJS.Buffer);
      wb.worksheets[0].eachRow(row => row.eachCell(cell => { text += String(cell.value) + "\n"; }));
    }
    for (const value of Object.values(confirmed)) assert.ok(text.includes(value), value);
    assert.ok(text.includes("Заказчик: ИНН [заполнить]"));
    assert.ok(text.includes("Согласованная цена: 19500 руб."));
    assert.doesNotMatch(text, /\{\{company\./);
  });
}

test("published memory carries all confirmed bank identifiers and the corrected signer", () => {
  const payload = publicProjectMemory(loadProjectMemory());
  const card = payload.sections.find(section => section.heading === "COMPANY REQUISITES");
  assert.ok(card);
  for (const key of ["inn", "kpp", "ogrn", "settlementAccount", "bank.inn", "bank.bic", "bank.correspondentAccount", "director.fullName"] as const) {
    assert.ok(card.content.includes(confirmed[key]), key);
  }
});
