import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, changeAssembly, foundationTakeoff, calculate, upgradeFoundationRows, parseProject, serializeProject } from '../public/house-calculator/engine.mjs';
import { createReport } from '../public/house-calculator/report.mjs';

function foundation(type, dimensions) {
  const p = changeAssembly(createProject(), { foundationType: type });
  Object.assign(p.foundation, dimensions);
  return p;
}
function estimate(p) {
  p.stages = Object.fromEntries(Object.keys(p.stages).map(key => [key, key === 'foundation']));
  p.rows = p.rows.filter(row => ['foundation-main', 'foundation-work', 'foundation-form-work', 'foundation-form-remove'].includes(row.id));
  const prices = { 'foundation-main': '5000', 'foundation-work': '1000', 'foundation-form-work': '400', 'foundation-form-remove': '100' };
  for (const row of p.rows) Object.assign(row, { price: prices[row.id], reserve: '0', source: 'Условные ставки для теста, не рыночный прайс', date: '2026-10-29' });
  Object.assign(p, { overhead: '0', ownerPay: '2000', companyTax: '0', targetProfit: '10000', sourceDocument: 'Условные размеры теста', taxNote: 'Тестовые суммы, не налоговый расчёт', reviewed: true });
  return p;
}

test('плита 10 × 8 × 0,3: 24 м³ бетона и 10,8 м² наружных бортов', () => {
  const p = foundation('slab', { length: '10', width: '8', heightMm: '300', formworkHeightMm: '300' });
  const c = foundationTakeoff(p.foundation);
  assert.equal(c.metrics.foundationVolume, 24);
  assert.equal(c.metrics.foundationFormworkArea, 10.8);
  assert.deepEqual(c.errors, {});
  Object.assign(p.geometry, { length: '99', width: '99' });
  assert.equal(calculate(p).metrics.foundationFormworkArea, 10.8, 'foundation geometry is independent of house footprint');
});

test('отдельная прямая лента учитывает две боковые грани и два свободных торца', () => {
  const p = foundation('strip', { length: '10', width: '0.4', heightMm: '800', formworkHeightMm: '800', formworkSideLength: '20', formworkEndCount: '2' });
  const c = foundationTakeoff(p.foundation);
  assert.equal(c.metrics.foundationVolume, 3.2);
  assert.equal(c.metrics.foundationFormworkArea, 16.64);
  assert.deepEqual(c.errors, {});
});

test('замкнутая лента: независимая проверка по наружному и внутреннему контурам без двойного учёта углов', () => {
  // Outer 10 × 8, width 0.4, height 0.8; centre-line rectangle 9.6 × 7.6.
  const p = foundation('strip', { length: '34.4', width: '0.4', heightMm: '800', formworkHeightMm: '800', formworkSideLength: '68.8', formworkEndCount: '0' });
  const c = foundationTakeoff(p.foundation);
  assert.equal(c.metrics.foundationVolume, Number(((10 * 8 - 9.2 * 7.2) * 0.8).toFixed(6)));
  assert.equal(c.metrics.foundationFormworkArea, Number(((2 * (10 + 8) + 2 * (9.2 + 7.2)) * 0.8).toFixed(6)));
});

test('при частичной опалубке ленты высота контакта не подменяется полной высотой бетона', () => {
  const p = foundation('strip', { length: '10', width: '0.4', heightMm: '800', formworkHeightMm: '200', formworkSideLength: '20', formworkEndCount: '2' });
  const c = foundationTakeoff(p.foundation);
  assert.equal(c.metrics.foundationVolume, 3.2);
  assert.equal(c.metrics.foundationFormworkArea, 4.16);
  p.foundation.formworkHeightMm = '';
  assert.equal(foundationTakeoff(p.foundation).metrics.foundationFormworkArea, null);
});

test('неизвестные грани и торцы не становятся нулём; дробные торцы и слишком высокая опалубка блокируются', () => {
  const p = foundation('strip', { length: '10', width: '0.4', heightMm: '800', formworkHeightMm: '800', formworkSideLength: '20', formworkEndCount: '0' });
  for (const [key, value] of [['formworkSideLength', ''], ['formworkEndCount', ''], ['formworkEndCount', '0.5'], ['formworkHeightMm', '801'], ['formworkHeightMm', '-1']]) {
    const f = { ...p.foundation, [key]: value };
    assert.equal(foundationTakeoff(f).metrics.foundationFormworkArea, null, key);
    assert.ok(foundationTakeoff(f).errors[key], key);
  }
  p.foundation.formworkSideLength = '0'; p.foundation.formworkEndCount = '0';
  assert.equal(foundationTakeoff(p.foundation).metrics.foundationFormworkArea, 0);
});

test('сложная геометрия принимает готовую ведомость объёмов и площадей, а не типовые коэффициенты', () => {
  const p = createProject(); Object.assign(p.foundation, { volume: '17,6', formworkArea: '43,2' });
  assert.deepEqual(foundationTakeoff(p.foundation).metrics, { foundationVolume: 17.6, foundationFormworkArea: 43.2, pileCount: null });
  p.foundation.formworkArea = ''; assert.equal(foundationTakeoff(p.foundation).metrics.foundationFormworkArea, null);
  p.foundation.formworkArea = '0'; assert.equal(foundationTakeoff(p.foundation).metrics.foundationFormworkArea, 0);
});

test('заливка в м³, установка и разборка в м² включены в общий итог и заработок отдельно', () => {
  const p = estimate(foundation('slab', { length: '10', width: '8', heightMm: '300', formworkHeightMm: '300' }));
  const c = calculate(p);
  assert.equal(c.groups.materials, 12000000n);
  assert.equal(c.groups.works, 2940000n); // 24 × 1000 + 10.8 × (400 + 100)
  assert.equal(c.total, 16140000n);
  assert.equal(c.ownerPay, 200000n); assert.equal(c.companyProfit, 1000000n);
  p.rows.find(r => r.id === 'foundation-form-remove').enabled = false;
  assert.equal(calculate(p).total, 16032000n, 'combined installation rate can exclude a separate dismantling charge');
});

test('запас бетона не увеличивает объём заливки; щиты и аренда не назначаются по площади работ', () => {
  const p = estimate(foundation('slab', { length: '10', width: '8', heightMm: '300', formworkHeightMm: '300' }));
  p.rows.find(r => r.id === 'foundation-main').reserve = '10';
  const c = calculate(p);
  assert.equal(c.rows.find(r => r.id === 'foundation-main').calculatedQuantity, 26.4);
  assert.equal(c.rows.find(r => r.id === 'foundation-work').calculatedQuantity, 24);
  assert.equal(c.rows.find(r => r.id === 'foundation-form-work').calculatedQuantity, 10.8);
  const template = createProject();
  assert.equal(template.rows.find(r => r.id === 'foundation-form').metric, 'manual');
  assert.equal(template.rows.find(r => r.id === 'foundation-form-rent').enabled, false);
  assert.equal(template.rows.find(r => r.id === 'foundation-pump').enabled, false);
});

test('смена типа фундамента не переносит длину всех лент в длину плиты и не утверждает прежние расценки', () => {
  const p = foundation('strip', { length: '34.4', width: '0.4', heightMm: '800', formworkHeightMm: '800', formworkSideLength: '68.8', formworkEndCount: '0' });
  p.rows.find(r => r.id === 'foundation-work').price = '900';
  const next = changeAssembly(p, { foundationType: 'slab' });
  assert.equal(next.foundation.length, ''); assert.equal(next.foundation.width, ''); assert.equal(next.foundation.formworkHeightMm, '');
  assert.equal(next.foundation.formworkMode, 'geometry'); assert.equal(next.rows.find(r => r.id === 'foundation-work').price, '');
  assert.equal(p.foundation.length, '34.4'); assert.equal(p.rows.find(r => r.id === 'foundation-work').price, '900');
});

test('старый JSON v1 сохраняет совмещённую ставку и итог до явного обновления', () => {
  const p = estimate(foundation('slab', { length: '10', width: '8', heightMm: '300', formworkHeightMm: '300' }));
  p.rows = p.rows.filter(r => r.id !== 'foundation-form-remove');
  const old = p.rows.find(r => r.id === 'foundation-form-work');
  Object.assign(old, { metric: 'manual', name: 'Монтаж / демонтаж опалубки', quantity: '10.8', price: '500' });
  for (const key of ['formworkMode', 'formworkArea', 'formworkHeightMm', 'formworkSideLength', 'formworkEndCount']) delete p.foundation[key];
  const oldTotal = calculate(p).total, parsed = parseProject(serializeProject(p));
  assert.equal(calculate(parsed).total, oldTotal);
  assert.deepEqual(parsed.rows, p.rows);
  assert.equal(parsed.foundation.formworkMode, 'manual');
  const otherTechnology = changeAssembly(parsed, { technology: 'frame' });
  assert.deepEqual(otherTechnology.rows.filter(r => r.stage === 'foundation'), parsed.rows);
  const upgraded = upgradeFoundationRows(parsed);
  const archived = upgraded.rows.find(r => r.name.includes('Прежняя совмещённая'));
  assert.equal(archived.price, '500'); assert.equal(archived.enabled, false); assert.equal(archived.template, false);
  assert.equal(upgraded.rows.find(r => r.id === 'foundation-form-work').price, '');
  assert.ok(upgraded.rows.some(r => r.id === 'foundation-form-remove'));
  assert.equal(parsed.rows.length, 3); assert.equal(old.enabled, true);
  assert.equal(upgradeFoundationRows(upgraded).rows.length, upgraded.rows.length, 'upgrade is idempotent');
});

test('новые поля сохраняются в JSON, некорректные типы и режим опалубки отклоняются', () => {
  const p = foundation('strip', { length: '10', width: '0.4', heightMm: '800', formworkHeightMm: '800', formworkSideLength: '20', formworkEndCount: '2' });
  assert.deepEqual(parseProject(serializeProject(p)), p);
  for (const value of [null, 10, {}, []]) {
    const bad = structuredClone(p); bad.foundation.formworkArea = value;
    assert.throws(() => parseProject(JSON.stringify(bad)));
  }
  p.foundation.formworkMode = 'unsafe'; assert.throws(() => parseProject(JSON.stringify(p)));
});

test('отчёт показывает тип фундамента, площадь опалубки, раздельные работы и экранирует новые данные', () => {
  const p = estimate(foundation('slab', { length: '10', width: '8', heightMm: '300', formworkHeightMm: '300' }));
  const html = createReport(p, 'data:image/png;base64,iVBORw0KGgo=');
  for (const text of ['Фундаментная плита', 'Площадь контакта опалубки', '10,8', 'Установка и раскрепление опалубки', 'Разборка опалубки']) assert.ok(html.includes(text), text);
  p.foundation.formworkHeightMm = '<script>bad()</script>';
  assert.ok(!createReport(p, 'data:image/png;base64,iVBORw0KGgo=').includes('<script>bad()'));
});
