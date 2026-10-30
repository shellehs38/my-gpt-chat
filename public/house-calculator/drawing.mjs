import { createProject, number, quantityText } from './engine.mjs';

// One allowlist for the model, review form and deterministic transfer. Never accept paths from the model.
export const DRAWING_FIELDS = {
  length: ['Наружная длина прямоугольного контура', 'm', true],
  width: ['Наружная ширина прямоугольного контура', 'm', true],
  wallHeightSum: ['Сумма высот прямоугольных наружных стен', 'm', true],
  wallThicknessMm: ['Толщина сплошной наружной стены', 'mm', true],
  rectOpenings: ['Сумма площадей всех наружных проёмов', 'm2', false],
  gableArea: ['Сумма площадей фронтонов до вычета проёмов', 'm2', false],
  gableOpenings: ['Сумма площадей проёмов во фронтонах', 'm2', false],
  solidReplacements: ['Замещающий объём поясов и перемычек', 'm3', false],
  floorArea: ['Чистая площадь перекрытий, все уровни', 'm2', false],
};
export const DRAWING_UNITS = { mm: 'мм', cm: 'см', m: 'м', m2: 'м²', m3: 'м³', unknown: 'Уточнить единицу' };
export const MAX_DRAWING_BYTES = 3 * 1024 * 1024;
export const DRAWING_BODY_BYTES = 4 * 1024 * 1024 + 4096;
export const DRAWING_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    summary: { type: 'string' }, outline: { type: 'string', enum: ['rectangle', 'complex', 'unclear'] },
    measurements: { type: 'array', items: { type: 'object', additionalProperties: false,
      properties: { field: { type: 'string', enum: Object.keys(DRAWING_FIELDS) }, value: { type: ['number', 'null'] }, unit: { type: 'string', enum: Object.keys(DRAWING_UNITS) }, confidence: { type: 'string', enum: ['clear', 'unclear', 'missing'] }, evidence: { type: 'string' } },
      required: ['field', 'value', 'unit', 'confidence', 'evidence'] } },
    questions: { type: 'array', items: { type: 'string' } },
  }, required: ['summary', 'outline', 'measurements', 'questions'],
};
export function validateDrawingResult(raw) {
  const object = v => v && typeof v === 'object' && !Array.isArray(v);
  const text = (v, max) => typeof v === 'string' && v.length <= max;
  if (!object(raw) || Object.keys(raw).some(k => !['summary', 'outline', 'measurements', 'questions'].includes(k)) ||
      !text(raw.summary, 2000) || !['rectangle', 'complex', 'unclear'].includes(raw.outline) ||
      !Array.isArray(raw.measurements) || raw.measurements.length > Object.keys(DRAWING_FIELDS).length ||
      !Array.isArray(raw.questions) || raw.questions.length > 20 || raw.questions.some(q => !text(q, 1000))) throw Error('Повреждённый результат распознавания. Введите размеры вручную или повторите запрос.');
  const seen = new Set();
  for (const m of raw.measurements) {
    if (!object(m) || Object.keys(m).length !== 5 || !Object.hasOwn(DRAWING_FIELDS, m.field) || seen.has(m.field) ||
        !Object.hasOwn(DRAWING_UNITS, m.unit) || !['clear', 'unclear', 'missing'].includes(m.confidence) || !text(m.evidence, 1500) ||
        !(m.value === null || typeof m.value === 'number' && Number.isFinite(m.value) && m.value >= 0 && m.value <= 1e9) ||
        m.confidence === 'missing' && m.value !== null) throw Error('Некорректные размеры в ответе распознавания. Расчёт не изменён.');
    seen.add(m.field);
  }
  return structuredClone(raw);
}
export function drawingReview(result = { measurements: [] }) {
  return Object.entries(DRAWING_FIELDS).map(([field, [label, expectedUnit]]) => {
    const m = result.measurements.find(m => m.field === field);
    return { field, label, value: m?.value === null || m?.value === undefined ? '' : quantityText(m.value), unit: m?.unit || expectedUnit,
      confidence: m?.confidence || 'missing', evidence: m?.evidence || 'На схеме не подтверждено. Заполните по проекту.', confirmed: false };
  });
}
export function convertDrawingValue(field, value, unit) {
  if (!Object.hasOwn(DRAWING_FIELDS, field)) throw Error('Неизвестное поле.');
  const [label, expected, positive] = DRAWING_FIELDS[field], n = number(value);
  if (n === null || positive && n <= 0) throw Error(`${label}: введите ${positive ? 'положительное число' : 'число или явный 0'}.`);
  const linear = { mm: .001, cm: .01, m: 1 };
  let converted;
  if (expected === 'm' || expected === 'mm') {
    if (!Object.hasOwn(linear, unit)) throw Error(`${label}: подтвердите мм, см или м.`);
    converted = n * linear[unit] / (expected === 'mm' ? .001 : 1);
  } else {
    if (unit !== expected) throw Error(`${label}: нужна единица ${DRAWING_UNITS[expected]}.`);
    converted = n;
  }
  const valueText = quantityText(converted);
  if (!valueText || positive && Number(valueText) <= 0) throw Error(`${label}: размер вне диапазона.`);
  return valueText;
}
export function projectFromDrawing({ technology, review, rectangleConfirmed, source, questions = [] }) {
  if (rectangleConfirmed !== true) throw Error('Подтвердите наружный прямоугольный контур без веранд и пристроек. Для сложного контура нужна отдельная ведомость.');
  if (typeof source !== 'string' || !source.trim() || source.length > 2000) throw Error('Укажите источник размеров.');
  if (!Array.isArray(review) || review.length > Object.keys(DRAWING_FIELDS).length) throw Error('Некорректная ведомость проверки.');
  const next = createProject(technology), seen = new Set(), audit = [];
  for (const row of review) {
    if (!Object.hasOwn(DRAWING_FIELDS, row.field) || seen.has(row.field)) throw Error('Неизвестный или повторный размер.');
    seen.add(row.field);
    if (row.confirmed !== true) continue;
    const v = convertDrawingValue(row.field, row.value, row.unit);
    next.geometry[row.field] = v;
    audit.push(`${DRAWING_FIELDS[row.field][0]}: ${row.value} ${DRAWING_UNITS[row.unit]} → ${v} ${DRAWING_UNITS[DRAWING_FIELDS[row.field][1]]}; проверено пользователем.`);
  }
  if (!next.geometry.length || !next.geometry.width) throw Error('Проверьте и отметьте оба наружных габарита.');
  if (next.geometry.wallThicknessMm && 2 * Number(next.geometry.wallThicknessMm) / 1000 >= Math.min(Number(next.geometry.length), Number(next.geometry.width))) throw Error('Толщина стены несовместима с габаритами.');
  next.name = 'Расчёт по проверенной схеме';
  next.sourceDocument = `${source.trim()}\n${audit.join('\n')}`;
  next.assumptions = `Контур подтверждён пользователем: прямоугольный, без пристроек и веранд. Фото не является рабочим проектом.\nНепроверенные размеры не перенесены. Внутренние стены, фундамент, крыша, каркас и инженерия — по отдельным спецификациям.\n${questions.filter(q => typeof q === 'string').slice(0, 20).map(q => q.slice(0, 1000)).join('\n')}`.slice(0, 20000);
  return next;
}
