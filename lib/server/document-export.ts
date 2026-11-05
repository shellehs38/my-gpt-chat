import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import PDFDocument from "pdfkit";
import ExcelJS from "exceljs";
import { AlignmentType, Document, Footer, Header, ImageRun, Packer, Paragraph, Table, TableCell, TableLayoutType, TableRow, TextRun, WidthType } from "docx";
import { parseEstimateDocument, type EstimateDocument } from "../estimate";
import { COMPANY_NAME } from "../document-branding";
import { BodyError } from "./http";

export const DOCUMENT_BODY_BYTES = 400_000;
export const DOCUMENT_FORMATS = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
} as const;
export type DocumentFormat = keyof typeof DOCUMENT_FORMATS;
export type DocumentExport = { format: DocumentFormat; title: string; versionDate: string; markdown: string };

export function validateDocumentExport(body: unknown): DocumentExport {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new BodyError(400, "Не указан документ.");
  const value = body as Record<string, unknown>;
  if (Object.keys(value).some(key => !["format", "title", "versionDate", "markdown"].includes(key)) ||
      typeof value.format !== "string" || !Object.hasOwn(DOCUMENT_FORMATS, value.format) ||
      typeof value.title !== "string" || !value.title.trim() || value.title.length > 180 ||
      typeof value.versionDate !== "string" || value.versionDate.length > 100 ||
      typeof value.markdown !== "string" || !value.markdown.trim() || value.markdown.length > 80_000 ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value.title + value.versionDate + value.markdown)) {
    throw new BodyError(400, "Проверьте формат, название и размер документа (до 80 000 символов).");
  }
  return value as DocumentExport;
}

/** Formatting markers are removed, but values and link destinations are retained. */
function plain(value: string): string {
  return value.replace(/<br\s*\/?\s*>/gi, "\n").replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)").replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1").replace(/`([^`]+)`/g, "$1").replace(/\\([|*_`])/g, "$1");
}
function paragraphs(text: string) {
  return text.split("\n").filter(line => !/^\s*(?:```|~~~)/.test(line)).map(line => ({
    text: plain(line.replace(/^\s*#{1,6}\s+/, "")), heading: /^\s*#{1,6}\s+/.test(line),
  }));
}
async function approvedLogo(): Promise<Buffer> {
  const logo = await readFile(join(process.cwd(), "public/brand/logo-sl-approved-light.png"));
  if (createHash("sha256").update(logo).digest("hex") !== "3252f7cea9f749e436963940fad54bd72b995b996c9f3dd6a75e4993ceb30ed3") {
    throw Error("Утверждённый логотип недоступен. Документ без логотипа не сформирован.");
  }
  return logo;
}

async function pdf(input: DocumentExport, content: EstimateDocument, logo: Buffer): Promise<Buffer> {
  const regular = await readFile(join(process.cwd(), "native/assets/fonts/DejaVuSans.ttf"));
  const bold = await readFile(join(process.cwd(), "native/assets/fonts/DejaVuSans-Bold.ttf"));
  // A custom font is supplied at construction; PDFKit must not require Helvetica AFM at runtime.
  const doc = new PDFDocument({ size: "A4", margin: 40, font: regular as unknown as string, info: { Title: input.title, Author: COMPANY_NAME } });
  doc.registerFont("regular", regular); doc.registerFont("bold", bold);
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => { doc.on("data", chunk => chunks.push(chunk)); doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject); });
  // PDFKit caches string sources: every page reuses one embedded PNG, keeping long files small.
  const logoSource = `data:image/png;base64,${logo.toString("base64")}`;
  const width = doc.page.width - 80, bottom = doc.page.height - 45;
  const pageHeader = (first = false) => {
    const w = first ? 150 : 70;
    doc.image(logoSource, (doc.page.width - w) / 2, 30, { width: w });
    doc.y = first ? 123 : 80; doc.x = 40;
    if (first) {
      doc.font("bold").fontSize(15).fillColor("#18352b").text(input.title, { align: "center" });
      doc.font("regular").fontSize(9).text(`${COMPANY_NAME} · Версия: ${input.versionDate}`, { align: "center" });
      doc.moveDown();
    }
  };
  doc.on("pageAdded", () => pageHeader()); pageHeader(true);
  const room = (height: number) => { if (doc.y + height > bottom) doc.addPage(); };
  const lines = (text: string, w: number): string[] => {
    const result: string[] = [];
    for (const paragraph of plain(text).split("\n")) {
      let line = "";
      for (const part of paragraph.split(/(\s+)/)) {
        if (doc.widthOfString(line + part) <= w) { line += part; continue; }
        if (line.trim()) { result.push(line.trimEnd()); line = ""; }
        for (const char of part.trimStart()) {
          if (doc.widthOfString(line + char) > w && line) { result.push(line); line = ""; }
          line += char;
        }
      }
      result.push(line.trimEnd());
    }
    return result;
  };
  for (const block of content.blocks) {
    if (block.type === "markdown") {
      for (const p of paragraphs(block.text)) {
        doc.font(p.heading ? "bold" : "regular").fontSize(p.heading ? 12 : 9).fillColor("#17221e");
        for (const line of lines(p.text, width)) { room(16); doc.text(line || " ", 40, doc.y, { width, lineBreak: false }); doc.y += 14; }
        doc.y += p.heading ? 5 : 2;
      }
    } else {
      const count = block.headers.length;
      // Name and notes receive more space than short quantities/units.
      const weights = block.headers.map((h, i) => /наимен|позици|примеч|описан/i.test(h) ? 3 : i === 0 && count < 6 ? 3 : 1.2);
      const sum = weights.reduce((a, b) => a + b, 0), widths = weights.map(w => width * w / sum);
      const draw = (values: string[], header = false, start = 0, take = Infinity): number => {
        doc.font(header ? "bold" : "regular").fontSize(8);
        const cells = values.map((v, i) => lines(v, widths[i] - 10));
        const length = Math.min(take, Math.max(...cells.map(c => c.length)) - start);
        const height = length * 12 + 10; const y = doc.y;
        let x = 40;
        cells.forEach((cell, i) => {
          doc.rect(x, y, widths[i], height).fillAndStroke(header ? "#eaf4ee" : "#ffffff", "#cbd7d0");
          doc.fillColor("#17221e");
          cell.slice(start, start + length).forEach((line, j) => doc.text(line || " ", x + 5, y + 5 + j * 12, { width: widths[i] - 10, lineBreak: false }));
          x += widths[i];
        });
        doc.y = y + height; doc.x = 40; return Math.max(...cells.map(c => c.length));
      };
      doc.font("bold").fontSize(8);
      const headerHeight = Math.max(...block.headers.map((v, i) => lines(v, widths[i] - 10).length)) * 12 + 10;
      room(headerHeight + 35); draw(block.headers, true);
      for (const row of block.rows) {
        doc.font("regular").fontSize(8);
        const total = Math.max(...row.cells.map((v, i) => lines(v, widths[i] - 10).length));
        if (total * 12 + 10 <= bottom - 80 - headerHeight && doc.y + total * 12 + 10 > bottom) { doc.addPage(); draw(block.headers, true); }
        let start = 0;
        while (start < total) {
          const fit = Math.floor((bottom - doc.y - 10) / 12);
          if (fit < 1) { doc.addPage(); draw(block.headers, true); continue; }
          draw(row.cells, false, start, fit); start += fit;
        }
      }
      doc.y += 14;
    }
  }
  doc.end(); return done;
}

async function word(input: DocumentExport, content: EstimateDocument, logo: Buffer): Promise<Buffer> {
  const image = (width: number) => new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ type: "png", data: logo, transformation: { width, height: Math.round(width * 941 / 1672) } })] });
  const children: (Paragraph | Table)[] = [image(170), new Paragraph({ text: input.title, alignment: AlignmentType.CENTER, heading: "Heading1" }), new Paragraph({ text: `${COMPANY_NAME} · Версия: ${input.versionDate}`, alignment: AlignmentType.CENTER })];
  for (const block of content.blocks) {
    if (block.type === "markdown") children.push(...paragraphs(block.text).map(p => new Paragraph({ text: p.text, ...(p.heading ? { heading: "Heading2" as const } : {}), spacing: { after: 100 } })));
    else {
      const weights = block.headers.map((h, i) => /наимен|позици|примеч|описан/i.test(h) ? 3 : i === 0 && block.headers.length < 6 ? 3 : 1.2);
      const total = weights.reduce((a, b) => a + b, 0), widths = weights.map(w => Math.floor(10500 * w / total));
      children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, columnWidths: widths, layout: TableLayoutType.FIXED, rows: [block.headers, ...block.rows.map(r => r.cells)].map((values, index) => new TableRow({ tableHeader: index === 0, children: values.map((value, i) => new TableCell({ width: { size: widths[i], type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 80, right: 80 }, shading: index === 0 ? { fill: "EAF4EE" } : undefined, children: [new Paragraph({ children: [new TextRun({ text: plain(value), bold: index === 0 })] })] })) })) }));
    }
  }
  const doc = new Document({ creator: COMPANY_NAME, title: input.title, styles: { default: { document: { run: { font: "Arial", size: 20 } } }, paragraphStyles: [
    { id: "Heading1", name: "Heading 1", basedOn: "Normal", run: { color: "18352B", bold: true, size: 30 } },
    { id: "Heading2", name: "Heading 2", basedOn: "Normal", run: { color: "18352B", bold: true, size: 24 } },
  ] }, sections: [{
    properties: { titlePage: true, page: { margin: { top: 900, bottom: 900, left: 700, right: 700 } } },
    headers: { default: new Header({ children: [image(60)] }), first: new Header({ children: [] }) },
    footers: { default: new Footer({ children: [new Paragraph({ text: COMPANY_NAME, alignment: AlignmentType.CENTER })] }) }, children,
  }] });
  return Packer.toBuffer(doc);
}

async function excel(input: DocumentExport, content: EstimateDocument, logo: Buffer): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook(); workbook.creator = COMPANY_NAME; workbook.title = input.title;
  const sheet = workbook.addWorksheet("Документ", { pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  const columns = Math.max(5, ...content.blocks.filter(b => b.type === "table").map(b => b.headers.length));
  sheet.columns = Array.from({ length: columns }, (_, i) => ({ width: i === 0 ? 44 : 19 }));
  const image = workbook.addImage({ buffer: logo as unknown as ExcelJS.Buffer, extension: "png" });
  sheet.addImage(image, { tl: { col: Math.max(0, columns / 2 - 1), row: 0 }, ext: { width: 180, height: 102 }, editAs: "absolute" });
  for (let r = 1; r <= 6; r++) sheet.getRow(r).height = 16;
  let rowNumber = 8;
  // Excel caps row height. Split long text into continuation rows rather than clipping it.
  const pieces = (text: string, limit: number): string[] => {
    const parts: string[] = [];
    while (text.length) {
      const newlines = [...text.slice(0, limit).matchAll(/\n/g)];
      const end = newlines.length > 7 ? newlines[7].index! + 1 : Math.min(limit, text.length);
      parts.push(text.slice(0, end)); text = text.slice(end);
    }
    return parts.length ? parts : [""];
  };
  const paragraph = (text: string, heading = false) => {
    for (const part of pieces(text, columns * 160)) {
    sheet.mergeCells(rowNumber, 1, rowNumber, columns);
    const row = sheet.getRow(rowNumber++); row.getCell(1).value = part;
    row.font = { name: "Arial", size: heading ? 14 : 11, bold: heading };
    row.alignment = { wrapText: true, vertical: "top" };
    row.height = 18 * Math.max(1, Math.ceil(part.length / (columns * 16)), part.split("\n").length);
    }
  };
  paragraph(input.title, true); paragraph(`${COMPANY_NAME} · Версия: ${input.versionDate}`);
  for (const block of content.blocks) {
    if (block.type === "markdown") for (const p of paragraphs(block.text)) paragraph(p.text, p.heading);
    else for (const [index, values] of [block.headers, ...block.rows.map(r => r.cells)].entries()) {
      const parts = values.map((v, i) => pieces(plain(v), i === 0 ? 540 : 200));
      for (let section = 0; section < Math.max(...parts.map(p => p.length)); section++) {
      const strings = parts.map(p => p[section] || "");
      const row = sheet.getRow(rowNumber++); row.values = strings;
      row.font = { name: "Arial", size: 10, bold: index === 0 };
      row.alignment = { wrapText: true, vertical: "top" };
      row.height = 16 * Math.max(2, ...strings.map((v, i) => Math.ceil(v.length / (i === 0 ? 34 : 13)) + v.split("\n").length - 1));
      row.eachCell({ includeEmpty: true }, cell => {
        cell.border = { top: { style: "thin", color: { argb: "FFCBD7D0" } }, bottom: { style: "thin", color: { argb: "FFCBD7D0" } } };
        if (index === 0) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEAF4EE" } };
      });
      }
    }
  }
  sheet.pageSetup.printArea = `A1:${sheet.getColumn(columns).letter}${rowNumber - 1}`;
  // These are exact displayed values, not formulas or a replacement financial engine.
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export async function createBrandedDocument(input: DocumentExport): Promise<Buffer> {
  // The browser sends its current, already serialized version. Never recalculate contracts here.
  const content = parseEstimateDocument(input.markdown, "export", false);
  const tables = content.blocks.filter(b => b.type === "table");
  if (tables.some(t => t.headers.length > 12 || t.headers.some(h => h.length > 200)) || tables.reduce((n, t) => n + t.rows.length, 0) > 600) throw new BodyError(400, "Документ слишком большой: до 600 строк, 12 столбцов и 200 символов в заголовке столбца.");
  const logo = await approvedLogo();
  if (input.format === "pdf") return pdf(input, content, logo);
  if (input.format === "docx") return word(input, content, logo);
  return excel(input, content, logo);
}
