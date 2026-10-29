import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createProject, changeAssembly, applyScope, calculate, takeoff, createRow, amountKopecks, money, number, parseProject, serializeProject, MAX_FILE_BYTES } from '../public/house-calculator/engine.mjs';
import { PROJECTS, referenceProject } from '../public/house-calculator/project-catalog.mjs';
import { createReport } from '../public/house-calculator/report.mjs';
import { HOUSE_FIXTURES } from './house-project-fixtures.mjs';

function fixture(id) {
  const f = HOUSE_FIXTURES.find(f => f.id === id), p = referenceProject(id);
  Object.assign(p.geometry, f.geometry); Object.assign(p.roof, f.roof); Object.assign(p.foundation, f.foundation);
  p.assumptions += '\nТЕСТ: геометрия, размеры и объёмы этого сценария условные; рабочие чертежи не обмерялись.';
  return p;
}
function pricedRows() {
  const p = createProject();
  p.rows = [createRow('material', 'walls', 'materials', 'Материал', 'м²'), createRow('work', 'walls', 'works', 'Работа', 'м²')];
  for (const key of Object.keys(p.stages)) p.stages[key] = key === 'walls';
  p.overhead = '0'; p.ownerPay = '0'; p.companyTax = '0';
  for (const row of p.rows) Object.assign(row, { quantity: '10', price: '2', reserve: '0', source: 'Учебная расценка, не рынок', date: '2026-10-29' });
  p.sourceDocument = 'Учебный пример'; p.targetProfit = '10'; p.taxNote = 'Учебный сценарий: налоги не рассчитываются'; p.reviewed = true;
  return p;
}
for (const f of HOUSE_FIXTURES) test(`проект ${f.id}: независимые контрольные объёмы с явными тестовыми допущениями`, () => {
  const p = fixture(f.id), c = calculate(p);
  for (const [key, expected] of Object.entries(f.expected)) assert.equal(c.metrics[key], expected, key);
  assert.equal(c.total, null, 'prices were not sourced or invented');
});
test('каталог содержит три первичных источника; карточка не заполняет рабочую геометрию и цены', () => {
  assert.equal(PROJECTS.length, 3);
  for (const item of PROJECTS) {
    const p = referenceProject(item.id), c = calculate(p);
    assert.equal(p.reference.url, item.url); assert.match(item.url, /^https:/);
    assert.equal(p.geometry.wallHeightSum, ''); assert.equal(c.metrics.wallArea, null);
    assert.equal(p.geometry.floorArea, ''); assert.ok(p.rows.every(r => r.price === ''));
    assert.equal(parseProject(serializeProject(p)).reference.note, item.note);
  }
  assert.match(PROJECTS.find(p => p.id === 're-103').note, /пенобетон 375 мм D600/);
});
test('пустые значения не становятся нулём, нулевые значения вводятся явно', () => {
  const p = fixture('nalchik-6x6'); p.geometry.rectOpenings = '';
  assert.equal(takeoff(p).metrics.wallVolume, null);
  p.geometry.rectOpenings = '0'; assert.equal(takeoff(p).metrics.wallVolume, 9.477);
  const blank = calculate(createProject()); assert.equal(blank.total, null); assert.ok(blank.missing.length > 0);
});
test('углы сплошных стен не входят в объём два раза', () => {
  const p = fixture('nalchik-6x6');
  assert.equal(takeoff(p).metrics.wallVolume, 7.977);
  assert.notEqual(takeoff(p).metrics.wallVolume, 8.22, 'external perimeter multiplied by thickness double counts four corner squares');
});
test('каркасные фронтоны не добавляются к объёму бруса', () => {
  const p = fixture('nalchik-6x6'), same = changeAssembly(p, { gableStructure: 'same' });
  assert.equal(takeoff(same).metrics.wallVolume, 9.027);
  assert.equal(takeoff(p).metrics.wallVolume, 7.977);
  assert.ok(p.rows.some(r => r.id === 'wall-gable-frame'));
});
test('проёмы, замещения и толщина не допускают отрицательных объёмов', () => {
  const p = fixture('nalchik-6x6');
  for (const [key, invalid] of [['rectOpenings', '10000'], ['gableOpenings', '100'], ['solidReplacements', '100'], ['wallThicknessMm', '3000']]) {
    const copy = structuredClone(p); copy.geometry[key] = invalid;
    assert.equal(takeoff(copy).metrics.wallVolume, null, key);
  }
});
test('сетка стоек и свай не придумывается; каркас и ячейки берутся из спецификации', () => {
  const p = fixture('odk-6x8'); p.geometry.frameLumber = ''; p.geometry.insulationArea = '';
  const c = takeoff(p); assert.equal(c.metrics.frameLumber, null); assert.equal(c.metrics.insulationVolume, null);
  p.foundation.type = 'piles'; p.foundation.count = ''; assert.equal(takeoff(p).metrics.pileCount, null);
  p.foundation.count = '12.5'; assert.equal(takeoff(p).metrics.pileCount, null);
  p.foundation.count = '12'; assert.equal(takeoff(p).metrics.pileCount, 12);
});
test('пеноблок учитывает швы, а несовместимая толщина требует ручной ведомости', () => {
  const p = fixture('re-103'); p.geometry.horizontalJointMm = ''; assert.equal(takeoff(p).metrics.blockCount, null);
  p.geometry.horizontalJointMm = '3'; p.geometry.blockWidthMm = '300'; assert.equal(takeoff(p).metrics.blockCount, null);
  p.geometry.blockWidthMm = '375'; assert.equal(takeoff(p).metrics.blockCount, 1371);
});
test('плита и лента имеют собственные проектные размеры, не габариты стен', () => {
  const p = createProject(); Object.assign(p.foundation, { type: 'slab', length: '10.5', width: '8.5', heightMm: '250' });
  assert.equal(takeoff(p).metrics.foundationVolume, 22.3125);
  Object.assign(p.geometry, { length: '100', width: '100' }); assert.equal(takeoff(p).metrics.foundationVolume, 22.3125);
});
test('двускатная кровля: горизонтальные свесы учитываются, несовместимый угол блокируется', () => {
  const p = fixture('odk-6x8'); p.roof.angle = '85'; assert.equal(takeoff(p).metrics.roofArea, null);
  p.roof.angle = '30'; p.roof.holes = '1000'; assert.equal(takeoff(p).metrics.roofArea, null);
  p.roof = { ...p.roof, mode: 'direct', area: '110.2' }; assert.equal(takeoff(p).metrics.roofArea, 110.2);
});
test('запас и упаковка увеличивают только материалы; оплата работы остаётся по чистому объёму', () => {
  const p = pricedRows(); Object.assign(p.rows[0], { reserve: '10', pack: '5' }); Object.assign(p.rows[1], { reserve: '90', pack: '5' });
  const c = calculate(p); assert.equal(c.rows[0].calculatedQuantity, 15); assert.equal(c.rows[0].amount, 3000n);
  assert.equal(c.rows[1].calculatedQuantity, 10); assert.equal(c.rows[1].amount, 2000n);
});
test('неуказанный запас не выдается за подтверждённый ноль', () => {
  const p = pricedRows(); p.rows[0].reserve = '';
  const c = calculate(p); assert.equal(c.rows[0].amount, null); assert.equal(c.total, null);
  p.rows[0].reserve = '0'; assert.equal(calculate(p).rows[0].amount, 2000n);
});
test('денежное округление точное; автоматической надбавки 40% нет', () => {
  assert.equal(amountKopecks('3', '0.335'), 101n); assert.equal(amountKopecks('0.1', '0.1'), 1n);
  assert.equal(amountKopecks('100', '300'), 3000000n); assert.equal(amountKopecks('', '0'), null);
  const p = pricedRows(), c = calculate(p); assert.equal(c.costSubtotal, 4000n); assert.equal(c.total, 5000n);
  assert.equal(money(c.total), '50,00 ₽');
});
test('неизвестная прибыль, источник или налог не превращаются в полный итог', () => {
  const p = pricedRows(); p.targetProfit = ''; assert.equal(calculate(p).total, null);
  p.targetProfit = '0'; p.rows[0].source = ''; assert.equal(calculate(p).total, null);
  p.rows[0].source = 'Тест'; p.taxNote = ''; assert.equal(calculate(p).total, null);
  p.taxNote = 'Тест'; p.reviewed = false; assert.equal(calculate(p).total, null);
});
test('выключенные этапы и строки исключаются из сумм и явно перечисляются', () => {
  const p = pricedRows(); p.rows[0].enabled = false;
  const c = calculate(p); assert.equal(c.costSubtotal, 2000n); assert.deepEqual(c.excludedRows, ['Материал']); assert.ok(c.excluded.includes('Окна и двери'));
  p.stages.walls = false; assert.equal(calculate(p).total, null);
});
test('изменение геометрии сохраняет цены, смена технологии сбрасывает цены несовместимых стен', () => {
  const p = fixture('nalchik-6x6'), roof = p.rows.find(r => r.id === 'roof-cover'), wall = p.rows.find(r => r.id === 'wall-timber');
  Object.assign(roof, { price: '1200', name: 'Конкретная кровля' }); wall.price = '30000';
  p.geometry.length = '7'; calculate(p); assert.equal(wall.price, '30000');
  const next = changeAssembly(p, { technology: 'foam' });
  assert.equal(next.rows.find(r => r.id === 'roof-cover').price, '1200');
  assert.equal(next.rows.find(r => r.id === 'roof-cover').name, 'Конкретная кровля');
  assert.ok(next.rows.filter(r => r.stage === 'walls').every(r => r.price === '')); assert.equal(next.geometry.wallThicknessMm, '');
  assert.equal(p.technology, 'timber', 'original version remains intact');
});
test('переход с бетона на сваи не переносит цену за кубометр на штуку', () => {
  const p = createProject(); p.rows.find(r => r.id === 'foundation-main').price = '8000';
  const next = changeAssembly(p, { foundationType: 'piles' }), row = next.rows.find(r => r.id === 'foundation-main');
  assert.equal(row.unit, 'шт.'); assert.equal(row.price, ''); assert.equal(row.metric, 'pileCount');
});
test('цена за другую единицу не применяется к автоматическому объёму', () => {
  const p = fixture('nalchik-6x6'), row = p.rows.find(r => r.id === 'wall-timber');
  Object.assign(row, { unit: 'шт.', price: '100', reserve: '0', source: 'Тест', date: '2026-10-29' });
  assert.equal(calculate(p).rows.find(r => r.id === row.id).amount, null);
});
test('формат чисел ограничен, запятая и пробелы поддерживаются', () => {
  assert.equal(number('1 234,50'), 1234.5); assert.equal(number('0'), 0);
  for (const x of ['', '-1', 'Infinity', 'NaN', '1e4', '12abc', '0.1234567']) assert.equal(number(x), null, x);
});
test('JSON восстанавливает текущие данные и не меняет их при ошибках импорта', () => {
  const p = fixture('re-103'), serialized = serializeProject(p); assert.deepEqual(parseProject(serialized), p);
  for (const mutate of [x => x.schemaVersion = 9, x => x.technology = 'gaz', x => x.rows[0].metric = 'eval', x => x.rows[1].id = x.rows[0].id, x => x.reference.url = 'javascript:alert(1)']) {
    const copy = structuredClone(p); mutate(copy); assert.throws(() => parseProject(JSON.stringify(copy)));
  }
  assert.throws(() => parseProject('{')); assert.throws(() => parseProject('x'.repeat(MAX_FILE_BYTES + 1)));
  assert.equal(serializeProject(p), serialized);
});
test('цена с несуществующей датой не подтверждается', () => {
  const p = pricedRows(); p.rows[0].date = '2026-02-30'; assert.equal(calculate(p).total, null);
});
test('отчёт встраивает оригинальный PNG, показывает неполный статус и исключения', async () => {
  const png = await readFile(new URL('../public/brand/logo-sl-approved-light.png', import.meta.url));
  const p = fixture('nalchik-6x6'), html = createReport(p, `data:image/png;base64,${png.toString('base64')}`);
  assert.ok(html.includes(png.toString('base64'))); assert.match(html, /Общий итог не определён/); assert.match(html, /Окна и двери/);
  assert.match(html, /Чистая площадь наружных стен/); assert.match(html, /ТЕСТ/); assert.match(html, /Нальчик/);
  assert.throws(() => createReport(p, 'https://example.com/logo.png'));
});
test('HTML отчёта экранирует имена, цены, адрес и источники', () => {
  const p = pricedRows(); p.name = '<script>bad()</script>'; p.rows[0].source = '<img src=x onerror=bad()>';
  const html = createReport(p, 'data:image/png;base64,iVBORw0KGgo=');
  assert.ok(!html.includes('<script>bad()')); assert.ok(!html.includes('<img src=x'));
  assert.match(html, /&lt;script&gt;/); assert.match(html, /&lt;img src=x/);
});
test('все три технологических шаблона содержат отдельные материалы и работы', () => {
  for (const technology of ['timber', 'frame', 'foam']) {
    const p = createProject(technology), ids = new Set(p.rows.map(r => r.id));
    assert.equal(ids.size, p.rows.length);
    assert.ok(p.rows.some(r => r.stage === 'walls' && r.group === 'works'));
    assert.ok(p.rows.some(r => r.stage === 'walls' && r.group === 'materials'));
  }
});
test('под ключ включает скважину, сети, электрику, сантехнику, отопление, вентиляцию и отделку', () => {
  for (const technology of ['timber', 'frame', 'foam']) {
    const p = createProject(technology);
    for (const stage of ['well', 'external', 'electrical', 'plumbing', 'heating', 'ventilation', 'finishing', 'siteworks']) {
      assert.equal(p.stages[stage], true, stage); assert.ok(p.rows.some(r => r.stage === stage && r.enabled), stage);
    }
    assert.ok(p.rows.some(r => r.id === 'pl-toilet')); assert.ok(p.rows.some(r => r.id === 'septic'));
    assert.equal(p.rows.find(r => r.id === 'well-drill').group, 'subcontract');
    assert.equal(p.rows.find(r => r.id === 'well-casing').enabled, false);
  }
});
test('комплектации переключают охват, сохраняя введённые расценки и объёмы', () => {
  const p = createProject(); p.rows.find(r => r.id === 'el-cable').price = '123';
  const shell = applyScope(p, 'shell'); assert.equal(shell.stages.plumbing, false); assert.equal(shell.stages.roof, true);
  const full = applyScope(shell, 'turnkey'); assert.equal(full.stages.plumbing, true); assert.equal(full.rows.find(r => r.id === 'el-cable').price, '123');
});
test('прибыль компании, оплата руководителя, налоги и накладные не смешиваются', () => {
  const p = pricedRows(); Object.assign(p, { overhead: '5', ownerPay: '10', companyTax: '3', targetProfit: '12' });
  const c = calculate(p); assert.equal(c.costSubtotal, 4000n); assert.equal(c.fullCost, 5800n); assert.equal(c.total, 7000n); assert.equal(c.companyProfit, 1200n); assert.equal(c.ownerPay, 1000n);
  p.saleMode = 'contract'; p.contractPrice = '60'; assert.equal(calculate(p).companyProfit, 200n);
  p.contractPrice = '50'; assert.equal(calculate(p).companyProfit, -800n); assert.equal(money(-805n), '−8,05 ₽');
});
test('неизвестный налог или пропущенный включённый этап блокирует расчёт заработка', () => {
  const p = pricedRows(); p.companyTax = ''; assert.equal(calculate(p).companyProfit, null);
  p.companyTax = '0'; p.stages.electrical = true; assert.equal(calculate(p).total, null); assert.equal(calculate(p).companyProfit, null);
});
test('обсадная труба не считается повторно в комплексной ставке бурения', () => {
  const p = createProject(); p.utilities.wellDepth = '50';
  assert.equal(takeoff(p).metrics.wellDepth, 50);
  p.rows.find(r => r.id === 'well-casing').enabled = true;
  assert.ok(calculate(p).reasons.some(s => s.includes('Обсадка уже включена')));
  p.utilities.wellPricing = 'separate'; assert.ok(!calculate(p).reasons.some(s => s.includes('Обсадка уже включена')));
});
