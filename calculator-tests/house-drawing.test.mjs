import test from 'node:test';
import assert from 'node:assert/strict';
import { drawingReview, projectFromDrawing, convertDrawingValue, validateDrawingResult } from '../public/house-calculator/drawing.mjs';
import { demonstrationProject, DEMO_NOTICE } from '../public/house-calculator/demo.mjs';
import { calculate, createProject, parseProject, serializeProject, STAGES } from '../public/house-calculator/engine.mjs';
import { createReport } from '../public/house-calculator/report.mjs';

const recognized = { summary: 'Синтетическая схема, не фото клиента.', outline: 'unclear', measurements: [
  { field: 'width', value: 8000, unit: 'unknown', confidence: 'unclear', evidence: '8000, единица не подписана, граница веранды неясна' },
  { field: 'length', value: 14000, unit: 'mm', confidence: 'clear', evidence: 'Наружный размер 14000 мм в тестовом чертеже' },
], questions: ['Отделить веранду от основного контура.', 'Нужны высоты и проёмы.'] };
function checked() {
  const review = drawingReview(recognized);
  for (const row of review.filter(r => ['width','length'].includes(r.field))) { row.confirmed = true; row.unit = 'mm'; }
  return { technology: 'timber', review, rectangleConfirmed: true, source: 'Проверочный чертёж', questions: recognized.questions };
}
test('readings never become measurements before individual review, including clear OCR', () => {
  const review = drawingReview(validateDrawingResult(recognized));
  assert.ok(review.every(r => r.confirmed === false));
  assert.equal(review.find(r => r.field === 'wallHeightSum').value, '');
  assert.equal(review.find(r => r.field === 'gableArea').value, '');
  assert.throws(() => projectFromDrawing({ ...checked(), review }), /оба наружных/);
  assert.throws(() => projectFromDrawing({ ...checked(), rectangleConfirmed: false }), /контур/);
});
test('units are explicit and dimensionally checked; guesses and incompatible areas cannot transfer', () => {
  assert.equal(convertDrawingValue('length', '14 000', 'mm'), '14');
  assert.equal(convertDrawingValue('width', '800', 'cm'), '8');
  assert.equal(convertDrawingValue('wallThicknessMm', '0,2', 'm'), '200');
  assert.equal(convertDrawingValue('rectOpenings', '0', 'm2'), '0');
  for (const [field, value, unit] of [['length','8000','unknown'], ['width','8','m2'], ['rectOpenings','18','m'], ['length','','m'], ['width','0','m'], ['width','-8','m'], ['width','1e3','m']]) assert.throws(() => convertDrawingValue(field, value, unit));
});
test('review transfers only confirmed fields into a fresh incomplete project without prices or inferred structure', () => {
  const args = checked(); args.review.find(r => r.field === 'wallHeightSum').value = '3';
  const p = projectFromDrawing(args), c = calculate(p);
  assert.equal(c.metrics.footprint, 112); assert.equal(c.metrics.perimeter, 44);
  assert.equal(c.metrics.wallVolume, null); assert.equal(c.total, null);
  assert.equal(p.geometry.wallHeightSum, ''); assert.equal(p.foundation.heightMm, '');
  assert.equal(p.utilities.wellDepth, ''); assert.equal(p.ownerPay, '');
  assert.ok(p.rows.every(r => r.price === ''));
  assert.match(p.sourceDocument, /14000 мм → 14 м/); assert.match(p.assumptions, /веранду/);
  assert.equal(parseProject(serializeProject(p)).geometry.width, '8');
  assert.doesNotMatch(serializeProject(p), /data:image|base64/);
});
test('manual checked heights, openings and thickness feed the existing corner-corrected material engine', () => {
  const args = checked();
  for (const [field,value] of Object.entries({ wallHeightSum:'3', wallThicknessMm:'200', rectOpenings:'18', gableArea:'0', gableOpenings:'0', solidReplacements:'0' })) Object.assign(args.review.find(r => r.field === field), { value, confirmed:true });
  const c = calculate(projectFromDrawing(args));
  // Outer ring: (14*8 - 13.6*7.6)*3 - 18*.2. Corners counted once.
  assert.equal(c.metrics.wallVolume, 22.32);
  assert.equal(c.metrics.wallArea, 114);
  assert.equal(c.total, null);
});
test('malformed model output, duplicate fields, prototype paths and invalid numeric readings are rejected', () => {
  for (const corrupt of [
    { ...recognized, extra: 1 }, { ...recognized, measurements: [...recognized.measurements, recognized.measurements[0]] },
    { ...recognized, measurements: [{ ...recognized.measurements[0], field: '__proto__' }] },
    { ...recognized, measurements: [{ ...recognized.measurements[0], value: -1 }] },
    { ...recognized, measurements: [{ ...recognized.measurements[0], value: '8000' }] },
    { ...recognized, measurements: [{ ...recognized.measurements[0], confidence: 'missing' }] },
    { ...recognized, questions: Array(21).fill('x') },
  ]) assert.throws(() => validateDrawingResult(corrupt));
  assert.throws(() => projectFromDrawing({ ...checked(), review: [...checked().review, checked().review[0]] }));
});
for (const technology of ['timber','frame','foam']) for (const foundation of ['slab','strip']) {
  test(`all 15 stages form a complete explicitly fictional example: ${technology}/${foundation}`, () => {
    const p = demonstrationProject(technology, foundation), c = calculate(p);
    assert.deepEqual(c.reasons, []); assert.equal(c.missing.length, 0);
    assert.ok(Object.keys(STAGES).every(s => c.rows.some(r => r.stage === s)));
    assert.equal(c.metrics.footprint, 112); assert.equal(c.metrics.perimeter, 44);
    assert.equal(c.metrics.foundationVolume, foundation === 'slab' ? 33.6 : 13.568);
    assert.equal(c.metrics.foundationFormworkArea, foundation === 'slab' ? 13.2 : 67.84);
    assert.equal(c.ownerPay, 20_000_000n); assert.equal(c.companyProfit, 50_000_000n);
    assert.equal(c.total, c.costSubtotal + 15_000_000n + 20_000_000n + 10_000_000n + 50_000_000n);
    assert.equal(parseProject(serializeProject(p)).demonstration, true);
    assert.match(p.sourceDocument, /не смета по вашей фотографии/);
    assert.ok(p.rows.every(r => r.source.includes('УЧЕБНЫЕ ДАННЫЕ')));
  });
}
test('concrete purchase reserve does not increase pouring/formwork crew volume; earnings remain separate', () => {
  const p = demonstrationProject(), c = calculate(p), row = id => c.rows.find(r => r.id === id);
  assert.equal(row('foundation-main').calculatedQuantity, 35.28);
  assert.equal(row('foundation-main').amount, 26_460_000n);
  assert.equal(row('foundation-work').calculatedQuantity, 33.6);
  assert.equal(row('foundation-work').amount, 8_400_000n);
  assert.equal(row('foundation-form-work').amount, 858_000n);
  assert.equal(row('foundation-form-remove').amount, 330_000n);
  assert.equal(c.total, 886_347_180n);
  p.saleMode = 'contract'; p.contractPrice = '8000000';
  assert.equal(calculate(p).companyProfit, -36_347_180n);
});
test('an omitted engineering quantity, tax or stage cannot masquerade as a finished turnkey quote', () => {
  for (const id of ['el-cable','ext-water','pl-cold','heat-source','vent-equipment']) {
    const p = demonstrationProject(); p.rows.find(r => r.id === id).quantity = '';
    const c = calculate(p); assert.equal(c.total, null); assert.equal(c.companyProfit, null);
  }
  const noTax = demonstrationProject(); noTax.companyTax = ''; assert.equal(calculate(noTax).total, null);
  const emptyStage = demonstrationProject(); emptyStage.rows = emptyStage.rows.filter(r => r.stage !== 'plumbing');
  assert.equal(calculate(emptyStage).total, null);
});
test('demo warning survives report export and v1 JSON; fresh projects never inherit demonstration prices', () => {
  const p = demonstrationProject();
  const html = createReport(parseProject(serializeProject(p)), 'data:image/png;base64,AAAA');
  assert.ok(html.includes(DEMO_NOTICE)); assert.match(html, /Подлинный логотип/);
  assert.equal(createProject().demonstration, false); assert.ok(createProject().rows.every(r => r.price === ''));
  const old = createProject(); delete old.demonstration;
  assert.equal(parseProject(serializeProject(old)).demonstration, false);
});
