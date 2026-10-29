// Quantity take-off only: structural sizes and consumption rates come from a project.
import { TURNKEY_STAGES, TURNKEY_ROWS, SCOPE_STAGES } from './turnkey-kit.mjs';
export const SCHEMA_VERSION = 1;
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const TECHNOLOGIES = { timber: 'Дом из бруса', frame: 'Каркасный дом', foam: 'Дом из пеноблока' };
export const STAGES = { preparation: TURNKEY_STAGES.preparation, foundation: 'Фундамент', walls: 'Стены и перегородки', floors: 'Перекрытия', roof: 'Крыша', openings: 'Окна и двери', well: TURNKEY_STAGES.well, external: TURNKEY_STAGES.external, electrical: TURNKEY_STAGES.electrical, plumbing: TURNKEY_STAGES.plumbing, heating: TURNKEY_STAGES.heating, ventilation: TURNKEY_STAGES.ventilation, finishing: 'Отделка', siteworks: TURNKEY_STAGES.siteworks, other: 'Доставка, техника и прочее' };
export const GROUPS = { materials: 'Материалы', works: 'Работы бригады', subcontract: 'Субподряд и подключения', other: 'Прочие расходы' };
export const WARNING = 'Предварительная калькуляция по введённым данным. Для Иркутска проектировщик должен проверить грунты, сейсмичность площадки, фундамент, несущие конструкции, снеговые и ветровые нагрузки, узлы, пожарные и теплотехнические требования, применимость и актуальные редакции СП/ГОСТ. Калькулятор не подбирает сечения, армирование, шаг стоек или свай и не заменяет рабочий проект.';
export const METRICS = {
  manual: ['Вручную по проекту', ''], footprint: ['Наружный контур одного уровня', 'м²'],
  perimeter: ['Наружный периметр', 'м.п.'], wallArea: ['Наружные стены и фронтоны, за вычетом проёмов', 'м²'],
  mainWallArea: ['Стены основной технологии, за вычетом проёмов', 'м²'],
  frameGableArea: ['Каркасные фронтоны, за вычетом проёмов', 'м²'],
  wallVolume: ['Основные сплошные стены, геометрический объём', 'м³'],
  blockCount: ['Пеноблок по кладочному модулю', 'шт.'],
  frameLumber: ['Каркас: пиломатериал по спецификации', 'м³'],
  insulationVolume: ['Утеплитель в ячейках каркаса', 'м³'],
  insulationArea: ['Чистая площадь ячеек утепления', 'м²'],
  floorArea: ['Перекрытия: площадь по проекту', 'м²'], roofArea: ['Кровля: площадь скатов', 'м²'],
  foundationVolume: ['Бетон фундамента', 'м³'], pileCount: ['Сваи по проекту', 'шт.'], wellDepth: ['Глубина бурения по КП / факту', 'м.п.']
};
export const uid = () => globalThis.crypto?.randomUUID?.() || `house-${Date.now()}-${Math.random().toString(36).slice(2)}`;
export function number(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const s = String(value).trim().replace(/[\s\u00a0\u202f]/g, '').replace(',', '.');
  if (!/^\d+(?:\.\d{1,6})?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n <= 1e9 ? n : null;
}
export function quantityText(n) {
  return n === null || !Number.isFinite(n) || n < 0 || n > 1e9 ? '' : n.toFixed(6).replace(/\.?0+$/, '');
}
function scaled(value) {
  if (number(value) === null) return null;
  const s = String(value).trim().replace(/[\s\u00a0\u202f]/g, '').replace(',', '.');
  const [whole, part = ''] = s.split('.');
  return BigInt(whole) * 1000000n + BigInt(part.padEnd(6, '0'));
}
export function amountKopecks(quantity, price) {
  const q = scaled(quantity), p = scaled(price);
  if (q === null || p === null) return null;
  // Round each line once, half a kopeck upwards, using exactly the displayed quantity.
  const result = (q * p + 5000000000n) / 10000000000n;
  return result <= BigInt(Number.MAX_SAFE_INTEGER) ? result : null;
}
export function money(kopecks) {
  if (kopecks === null || kopecks === undefined) return '—';
  const value = BigInt(kopecks), k = value < 0n ? -value : value, w = new Intl.NumberFormat('ru-RU').format(k / 100n);
  return `${value < 0n ? '−' : ''}${w},${String(k % 100n).padStart(2, '0')} ₽`;
}
export const format = n => n === null || n === undefined ? '—' : new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 6 }).format(n);
export function createRow(id, stage, group, name, unit, metric = 'manual') {
  return { id, stage, group, name, unit, metric, quantity: '', price: '', reserve: group === 'materials' ? '' : '0', pack: '', source: '', date: '', enabled: true, template: true };
}
function rowTemplate(technology, foundationType = 'manual', gableStructure = 'same') {
  const rows = [];
  const add = (id, stage, group, name, unit, metric = 'manual') => rows.push(createRow(id, stage, group, name, unit, metric));
  const mat = (id, stage, name, unit, metric) => add(id, stage, 'materials', name, unit, metric);
  const work = (id, stage, name, unit, metric) => add(id, stage, 'works', name, unit, metric);
  if (foundationType === 'piles') {
    mat('foundation-main', 'foundation', 'Сваи выбранной марки', 'шт.', 'pileCount');
    work('foundation-work', 'foundation', 'Монтаж свай', 'шт.', 'pileCount');
    mat('foundation-grillage', 'foundation', 'Ростверк / обвязка по спецификации', 'компл.');
    work('foundation-grillage-work', 'foundation', 'Устройство ростверка / обвязки', 'компл.');
  } else {
    mat('foundation-main', 'foundation', 'Бетон фундамента по проектной марке', 'м³', 'foundationVolume');
    work('foundation-work', 'foundation', 'Укладка бетона фундамента', 'м³', 'foundationVolume');
    mat('foundation-rebar', 'foundation', 'Арматура по спецификации', 'т');
    work('foundation-rebar-work', 'foundation', 'Армирование по спецификации', 'т');
    mat('foundation-form', 'foundation', 'Материалы опалубки', 'м²');
    work('foundation-form-work', 'foundation', 'Монтаж / демонтаж опалубки', 'м²');
    mat('foundation-base', 'foundation', 'Подготовка: песок, щебень (разбить при уточнении)', 'м³');
    work('foundation-earth', 'foundation', 'Земляные работы и подготовка основания', 'м³');
  }
  mat('foundation-waterproof', 'foundation', 'Гидроизоляция по спецификации', 'м²');
  work('foundation-waterproof-work', 'foundation', 'Устройство гидроизоляции', 'м²');
  if (technology === 'timber') {
    mat('wall-timber', 'walls', 'Брус: наружные стены без выпусков и раскроя', 'м³', 'wallVolume');
    work('wall-timber-work', 'walls', 'Сборка наружных стен из бруса', 'м³', 'wallVolume');
    mat('wall-seal', 'walls', 'Межвенцовый уплотнитель по раскладке', 'м.п.');
    mat('wall-partition', 'walls', 'Брус внутренних стен по спецификации', 'м³');
    work('wall-partition-work', 'walls', 'Сборка внутренних стен', 'м³');
  } else if (technology === 'frame') {
    mat('wall-frame', 'walls', 'Пиломатериал стенового каркаса по спецификации', 'м³', 'frameLumber');
    work('wall-frame-work', 'walls', 'Сборка наружного стенового каркаса', 'м²', 'wallArea');
    mat('wall-insulation', 'walls', 'Утеплитель в ячейках стен', 'м³', 'insulationVolume');
    work('wall-insulation-work', 'walls', 'Монтаж утеплителя стен', 'м²', 'insulationArea');
    mat('wall-sheathing', 'walls', 'Листовая обшивка по проекту (стороны раздельно)', 'м²');
    work('wall-sheathing-work', 'walls', 'Монтаж листовой обшивки', 'м²');
    mat('wall-membrane', 'walls', 'Мембраны и ленты по слоям (разбить при уточнении)', 'компл.');
    work('wall-membrane-work', 'walls', 'Монтаж мембран и герметизация стыков', 'компл.');
    mat('wall-partition', 'walls', 'Перегородки по спецификации', 'компл.');
    work('wall-partition-work', 'walls', 'Монтаж перегородок', 'компл.');
  } else {
    mat('wall-block', 'walls', 'Пеноблок выбранного размера', 'шт.', 'blockCount');
    work('wall-block-work', 'walls', 'Кладка наружных стен из пеноблока', 'м³', 'wallVolume');
    mat('wall-mortar', 'walls', 'Кладочный состав по документированному расходу', 'кг');
    mat('wall-reinforcement', 'walls', 'Армирование кладки по проекту', 'м.п.');
    mat('wall-belt', 'walls', 'Материалы армопоясов и перемычек по спецификации', 'компл.');
    work('wall-belt-work', 'walls', 'Устройство армопоясов и перемычек', 'компл.');
    mat('wall-partition', 'walls', 'Внутренние стены и перегородки по спецификации', 'м³');
    work('wall-partition-work', 'walls', 'Кладка внутренних стен и перегородок', 'м³');
  }
  if (technology !== 'frame' && gableStructure === 'frame') {
    mat('wall-gable-frame', 'walls', 'Каркасные фронтоны: пиломатериал по спецификации', 'м³');
    work('wall-gable-frame-work', 'walls', 'Сборка каркасных фронтонов', 'м²', 'frameGableArea');
    mat('wall-gable-layers', 'walls', 'Слои и крепёж каркасных фронтонов по спецификации', 'компл.');
    work('wall-gable-layers-work', 'walls', 'Монтаж слоёв каркасных фронтонов', 'компл.');
  }
  mat('wall-fix', 'walls', 'Крепёж и соединения стен по спецификации', 'компл.');
  mat('floor-structure', 'floors', 'Несущая часть перекрытий по спецификации', 'компл.');
  mat('floor-layers', 'floors', 'Слои перекрытий (разбить по материалам)', 'компл.');
  work('floor-work', 'floors', 'Устройство перекрытий по проекту', 'м²', 'floorArea');
  mat('roof-structure', 'roof', 'Стропильная система по спецификации', 'компл.');
  work('roof-structure-work', 'roof', 'Монтаж стропильной системы', 'компл.');
  mat('roof-cover', 'roof', 'Кровельное покрытие', 'м²', 'roofArea');
  work('roof-cover-work', 'roof', 'Монтаж кровельного покрытия', 'м²', 'roofArea');
  mat('roof-layers', 'roof', 'Слои, доборы, крепёж, водосток по спецификации', 'компл.');
  work('roof-layers-work', 'roof', 'Монтаж слоёв, доборов и водостока', 'компл.');
  mat('windows', 'openings', 'Окна по ведомости', 'м²');
  work('windows-work', 'openings', 'Монтаж окон', 'м²');
  mat('doors', 'openings', 'Наружные двери по ведомости', 'шт.');
  work('doors-work', 'openings', 'Монтаж наружных дверей', 'шт.');
  mat('finish-exterior', 'finishing', 'Наружная отделка: материалы по системе', 'м²', 'wallArea');
  work('finish-exterior-work', 'finishing', 'Наружная отделка: работа', 'м²', 'wallArea');
  mat('finish-interior', 'finishing', 'Отделка стен и потолков: материалы по ведомости', 'компл.');
  work('finish-interior-work', 'finishing', 'Отделка стен и потолков: работы по ведомости', 'компл.');
  mat('finish-floor', 'finishing', 'Чистовые покрытия полов, подложка, плинтусы', 'компл.');
  work('finish-floor-work', 'finishing', 'Укладка чистовых полов и монтаж плинтусов', 'компл.');
  add('delivery', 'other', 'other', 'Доставка и разгрузка', 'рейс');
  add('equipment', 'other', 'other', 'Техника и аренда', 'смена');
  add('site', 'other', 'other', 'Организация площадки, временные сети и вывоз', 'компл.');
  for (const [id, stage, group, name, unit, metric = 'manual', disabled = false] of TURNKEY_ROWS) {
    add(id, stage, group, name, unit, metric); rows[rows.length - 1].enabled = !disabled;
  }
  return rows;
}
export function createProject(technology = 'timber') {
  if (!Object.hasOwn(TECHNOLOGIES, technology)) throw Error('Неизвестная технология.');
  return {
    schemaVersion: SCHEMA_VERSION, id: uid(), name: '', address: '', technology,
    geometry: { length: '', width: '', wallHeightSum: '', rectOpenings: '', gableArea: '', gableOpenings: '', gableStructure: 'same', wallThicknessMm: '', solidReplacements: '', frameLumber: '', insulationArea: '', insulationThicknessMm: '', floorArea: '', blockLengthMm: '', blockHeightMm: '', blockWidthMm: '', verticalJointMm: '', horizontalJointMm: '' },
    foundation: { type: 'manual', length: '', width: '', heightMm: '', count: '', volume: '' },
    roof: { mode: 'direct', area: '', ridgeLength: '', span: '', angle: '', eave: '', endOverhang: '', holes: '' },
    stages: Object.fromEntries(Object.keys(STAGES).map(key => [key, true])),
    rows: rowTemplate(technology), utilities: { wellDepth: '', wellPricing: 'included' }, sourceDocument: '', assumptions: '', targetProfit: '', taxNote: '', reviewed: false,
    saleMode: 'cost-plus', contractPrice: '', overhead: '', ownerPay: '', companyTax: '',
    reference: null, updatedAt: ''
  };
}
export function applyScope(project, scope) {
  if (!Object.hasOwn(SCOPE_STAGES, scope)) throw Error('Неизвестная комплектация.');
  const next = structuredClone(project);
  next.stages = Object.fromEntries(Object.keys(STAGES).map(key => [key, SCOPE_STAGES[scope].includes(key)])); next.reviewed = false;
  return next;
}
// Reconcile template rows without carrying a price across a different unit/material.
export function changeAssembly(project, { technology = project.technology, foundationType = project.foundation.type, gableStructure = project.geometry.gableStructure } = {}) {
  if (!Object.hasOwn(TECHNOLOGIES, technology)) throw Error('Неизвестная технология.');
  const next = structuredClone(project), oldTech = project.technology;
  next.technology = technology; next.foundation.type = foundationType; next.geometry.gableStructure = gableStructure;
  const old = new Map(project.rows.map(r => [r.id, r]));
  next.rows = rowTemplate(technology, foundationType, gableStructure).map(row => {
    const prior = old.get(row.id);
    const changedWall = oldTech !== technology && row.stage === 'walls';
    return prior && !changedWall && prior.unit === row.unit && prior.metric === row.metric ? structuredClone(prior) : row;
  });
  next.rows.push(...structuredClone(project.rows.filter(r => !r.template && !(oldTech !== technology && r.stage === 'walls'))));
  if (oldTech !== technology) {
    for (const key of ['wallThicknessMm', 'solidReplacements', 'frameLumber', 'insulationArea', 'insulationThicknessMm', 'blockLengthMm', 'blockHeightMm', 'blockWidthMm', 'verticalJointMm', 'horizontalJointMm']) next.geometry[key] = '';
  }
  next.reviewed = false;
  return next;
}
export function takeoff(project) {
  const g = project.geometry, f = project.foundation, r = project.roof, errors = {};
  const value = (object, key, label, positive = false) => {
    const n = number(object[key]);
    if (n === null || positive && n <= 0) { errors[key] = label; return null; }
    return n;
  };
  const safe = n => n !== null && Number.isFinite(n) && n >= 0 && n <= 1e9 ? Number(n.toFixed(6)) : null;
  const l = value(g, 'length', 'Длина наружного прямоугольного контура', true), w = value(g, 'width', 'Ширина наружного прямоугольного контура', true);
  const perimeter = l !== null && w !== null ? 2 * (l + w) : null;
  const footprint = l !== null && w !== null ? l * w : null;
  const h = value(g, 'wallHeightSum', 'Сумма высот прямоугольных наружных стен', true);
  const o = value(g, 'rectOpenings', 'Площадь проёмов в прямоугольных стенах (0, если отсутствуют)');
  const ga = value(g, 'gableArea', 'Суммарная площадь фронтонов (0, если отсутствуют)');
  const go = value(g, 'gableOpenings', 'Проёмы во фронтонах (0, если отсутствуют)');
  let rectangularNet = perimeter !== null && h !== null && o !== null ? perimeter * h - o : null;
  if (rectangularNet !== null && rectangularNet < 0) { errors.rectOpenings = 'Проёмы превышают площадь прямоугольных стен'; rectangularNet = null; }
  let gableNet = ga !== null && go !== null ? ga - go : null;
  if (gableNet !== null && gableNet < 0) { errors.gableOpenings = 'Проёмы превышают площадь фронтонов'; gableNet = null; }
  const wallArea = rectangularNet !== null && gableNet !== null ? rectangularNet + gableNet : null;
  const solidGable = g.gableStructure === 'same' || project.technology === 'frame';
  const mainWallArea = rectangularNet !== null && gableNet !== null ? rectangularNet + (solidGable ? gableNet : 0) : null;
  const frameGableArea = gableNet !== null ? (!solidGable ? gableNet : 0) : null;
  let wallVolume = null, blockCount = null, frameLumber = null, insulationArea = null, insulationVolume = null;
  if (project.technology === 'frame') {
    frameLumber = value(g, 'frameLumber', 'Объём пиломатериала стенового каркаса по спецификации');
    insulationArea = value(g, 'insulationArea', 'Чистая площадь ячеек утепления по проекту');
    const t = value(g, 'insulationThicknessMm', 'Толщина утепления ячеек по проекту', true);
    insulationVolume = insulationArea !== null && t !== null ? insulationArea * t / 1000 : null;
  } else {
    const t = value(g, 'wallThicknessMm', 'Толщина сплошной наружной стены по проекту', true);
    const replacement = value(g, 'solidReplacements', 'Замещающий объём поясов, перемычек и других включений (0 при отсутствии)');
    if (t !== null && l !== null && w !== null && 2 * t / 1000 >= Math.min(l, w)) errors.wallThicknessMm = 'Толщина стены несовместима с наружными габаритами';
    if (l !== null && w !== null && t !== null && h !== null && o !== null && gableNet !== null && replacement !== null && !errors.wallThicknessMm && rectangularNet !== null) {
      // Ring of four walls: corners belong to the material exactly once.
      const tm = t / 1000, ring = l * w - (l - 2 * tm) * (w - 2 * tm);
      wallVolume = ring * h - o * tm + (solidGable ? gableNet * tm : 0) - replacement;
      if (wallVolume < -1e-7) { errors.solidReplacements = 'Вычеты превышают объём сплошных стен'; wallVolume = null; }
      else if (wallVolume !== null) wallVolume = Math.max(0, wallVolume);
    }
    if (project.technology === 'foam') {
      const bl = value(g, 'blockLengthMm', 'Длина пеноблока', true), bh = value(g, 'blockHeightMm', 'Высота пеноблока', true), bw = value(g, 'blockWidthMm', 'Ширина пеноблока', true);
      const jv = value(g, 'verticalJointMm', 'Вертикальный шов по проекту (0 только при подтверждении)'), jh = value(g, 'horizontalJointMm', 'Горизонтальный шов по проекту');
      if (bw !== null && t !== null && bw !== t) errors.blockWidthMm = 'Автоматический подсчёт поддерживает один блок по толщине стены; иначе нужна ручная ведомость';
      if (wallVolume !== null && bl !== null && bh !== null && bw !== null && jv !== null && jh !== null && !errors.blockWidthMm) {
        const module = (bl + jv) * (bh + jh) * bw / 1e9;
        blockCount = Math.ceil(Number((wallVolume / module).toFixed(9)));
      }
    }
  }
  let foundationVolume = null, pileCount = null;
  if (f.type === 'manual') foundationVolume = value(f, 'volume', 'Объём бетона фундамента по спецификации');
  if (f.type === 'slab' || f.type === 'strip') {
    const fl = value(f, 'length', f.type === 'slab' ? 'Длина плиты по проекту' : 'Суммарная длина лент по осевым линиям', true);
    const fw = value(f, 'width', f.type === 'slab' ? 'Ширина плиты по проекту' : 'Ширина ленты', true);
    const ft = value(f, 'heightMm', 'Высота / толщина бетонного тела по проекту', true);
    foundationVolume = fl !== null && fw !== null && ft !== null ? fl * fw * ft / 1000 : null;
  }
  if (f.type === 'piles') {
    pileCount = value(f, 'count', 'Количество свай по проекту', true);
    if (pileCount !== null && !Number.isInteger(pileCount)) { errors.count = 'Количество свай должно быть целым'; pileCount = null; }
  }
  let roofArea = null;
  if (r.mode === 'direct') roofArea = value(r, 'area', 'Чистая площадь скатов по проекту');
  else {
    const rl = value(r, 'ridgeLength', 'Длина здания вдоль конька', true), span = value(r, 'span', 'Горизонтальный пролёт крыши', true);
    const angle = value(r, 'angle', 'Угол одинаковых скатов в градусах'), eave = value(r, 'eave', 'Горизонтальный карнизный свес с каждой стороны'), end = value(r, 'endOverhang', 'Фронтонный свес с каждого торца'), holes = value(r, 'holes', 'Проёмы в кровле (0, если отсутствуют)');
    if (angle !== null && angle >= 85) errors.angle = 'Для этой формулы угол должен быть меньше 85°';
    if ([rl, span, angle, eave, end, holes].every(n => n !== null) && !errors.angle) {
      roofArea = (rl + 2 * end) * (span + 2 * eave) / Math.cos(angle * Math.PI / 180) - holes;
      if (roofArea < 0) { errors.holes = 'Проёмы превышают площадь кровли'; roofArea = null; }
    }
  }
  const floorArea = value(g, 'floorArea', 'Суммарная чистая площадь перекрытий по проекту');
  const wellDepth = value(project.utilities, 'wellDepth', 'Глубина бурения по КП / факту');
  const metrics = Object.fromEntries(Object.entries({ footprint, perimeter, wallArea, mainWallArea, frameGableArea, wallVolume, blockCount, frameLumber, insulationArea, insulationVolume, foundationVolume, pileCount, roofArea, floorArea, wellDepth }).map(([key, n]) => [key, safe(n)]));
  return { metrics, errors, formulas: [
    'Периметр = 2 × (длина + ширина). Наружный контур = длина × ширина; это не полезная площадь.',
    'Площадь стен = периметр × сумма прямоугольных высот − проёмы стен + фронтоны − проёмы фронтонов.',
    'Сплошные стены = [L×W − (L−2t)×(W−2t)] × H − проёмы стен × t + сплошные фронтоны × t − замещающий объём. Углы учтены один раз.',
    'Пеноблок: округление вверх(объём кладки / ((длина + вертикальный шов) × (высота + горизонтальный шов) × ширина блока)). Это предварительный подсчёт до раскладки.',
    'Утеплитель каркаса = чистая площадь ячеек × толщина. Стойки, обвязки, проёмы вычитаются в проектной площади ячеек; пиломатериал берётся из спецификации.',
    'Простая симметричная двускатная кровля = (длина вдоль конька + 2×торцевой свес) × (пролёт + 2×горизонтальный карнизный свес) / cos(угол) − проёмы.',
    'Плита = её проектные длина × ширина × толщина. Лента = суммарная осевая длина × ширина × высота. Рёбра, ступени, отдельные ростверки и вычеты вводятся вручную.'
  ] };
}
export function calculate(project) {
  const take = takeoff(project), groups = { materials: 0n, works: 0n, subcontract: 0n, other: 0n }, missing = [];
  const rows = project.rows.filter(r => project.stages[r.stage] && r.enabled).map(row => {
    const errors = [];
    let q = row.metric === 'manual' ? number(row.quantity) : take.metrics[row.metric];
    if (row.metric !== 'manual' && row.unit !== METRICS[row.metric]?.[1]) { q = null; errors.push('единица не соответствует способу расчёта'); }
    const netQuantity = q ?? null;
    if (q === null || q === undefined) errors.push('количество / исходные данные');
    if (row.group === 'materials') {
      const reserve = number(row.reserve), pack = String(row.pack).trim() ? number(row.pack) : null;
      if (reserve === null || reserve > 100) { q = null; errors.push('запас 0–100% (0 — без запаса)'); }
      if (String(row.pack).trim() && (pack === null || pack <= 0)) { q = null; errors.push('размер упаковки'); }
      if (q !== null && q !== undefined && reserve !== null) {
        q *= 1 + reserve / 100;
        if (pack !== null && pack > 0) q = Math.ceil(Number((q / pack).toFixed(9))) * pack;
        if (row.unit === 'шт.') q = Math.ceil(Number(q.toFixed(9)));
      }
    }
    const qt = quantityText(q ?? null);
    if (!qt && q !== 0) { q = null; if (!errors.length) errors.push('количество вне диапазона'); }
    const price = number(row.price), amount = amountKopecks(qt, row.price);
    if (price === null) errors.push('цена за единицу');
    if (amount === null && qt && price !== null) errors.push('сумма вне диапазона');
    if (!row.name.trim()) errors.push('наименование');
    if (!row.unit.trim()) errors.push('единица измерения');
    if (!row.source.trim()) errors.push('источник цены');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date) || Number.isNaN(Date.parse(row.date)) || new Date(row.date).toISOString().slice(0, 10) !== row.date) errors.push('дата цены');
    if (amount !== null) groups[row.group] += amount;
    if (errors.length) missing.push({ id: row.id, name: row.name || 'Новая позиция', stage: row.stage, errors });
    return { ...row, netQuantity, calculatedQuantity: qt ? number(qt) : null, quantityText: qt, amount, errors };
  });
  const costSubtotal = groups.materials + groups.works + groups.subcontract + groups.other;
  const emptyStages = Object.keys(STAGES).filter(stage => project.stages[stage] && !rows.some(row => row.stage === stage));
  const duplicateCasing = project.stages.well && project.utilities.wellPricing === 'included' && rows.some(r => r.id === 'well-drill') && rows.some(r => r.id === 'well-casing');
  const profit = amountKopecks('1', project.targetProfit);
  const overhead = amountKopecks('1', project.overhead), ownerPay = amountKopecks('1', project.ownerPay), companyTax = amountKopecks('1', project.companyTax);
  const fullCost = [overhead, ownerPay, companyTax].every(x => x !== null) && rows.length > 0 && !missing.length && !emptyStages.length && !duplicateCasing ? costSubtotal + overhead + ownerPay + companyTax : null;
  const quote = project.saleMode === 'contract' ? amountKopecks('1', project.contractPrice) : fullCost !== null && profit !== null ? fullCost + profit : null;
  const companyProfit = fullCost !== null && quote !== null ? quote - fullCost : null;
  const reasons = [];
  if (!rows.length) reasons.push('Не выбрано ни одной позиции.');
  if (missing.length) reasons.push(`Не заполнены данные ${missing.length} позиций.`);
  for (const stage of emptyStages) reasons.push(`Нет включённых позиций этапа «${STAGES[stage]}». Заполните этап или исключите его явно.`);
  if (duplicateCasing) reasons.push('Обсадка уже включена в метр бурения: отключите отдельную трубу или выберите раздельную расценку.');
  if (!project.sourceDocument.trim()) reasons.push('Нужен источник размеров и объёмов.');
  if (!project.reviewed) reasons.push('Нужно проверить полноту состава и исключений.');
  if (project.saleMode === 'cost-plus' && profit === null) reasons.push('Целевая прибыль не согласована (введите сумму или явный 0).');
  if (project.saleMode === 'contract' && quote === null) reasons.push('Не введена цена договора.');
  if (overhead === null) reasons.push('Не указан бюджет накладных расходов (или явный 0).');
  if (ownerPay === null) reasons.push('Не указано ваше вознаграждение руководителя (или явный 0).');
  if (companyTax === null) reasons.push('Не указан налог компании в рублях (или подтверждённый 0).');
  if (!project.taxNote.trim()) reasons.push('Не указан порядок учёта НДС и налогов.');
  return { ...take, rows, groups, missing, costSubtotal, costComplete: rows.length > 0 && missing.length === 0 && !emptyStages.length && !duplicateCasing,
    targetProfit: profit, overhead, ownerPay, companyTax, fullCost, companyProfit, quote,
    total: reasons.length ? null : quote, reasons,
    excluded: Object.entries(STAGES).filter(([key]) => !project.stages[key]).map(([, name]) => name),
    excludedRows: project.rows.filter(r => project.stages[r.stage] && !r.enabled).map(r => r.name)
  };
}
export function serializeProject(project) {
  const text = JSON.stringify(project, null, 2);
  if (new TextEncoder().encode(text).length > MAX_FILE_BYTES) throw Error('Проект больше 2 МБ.');
  return text;
}
export function parseProject(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_FILE_BYTES) throw Error('Файл проекта больше 2 МБ.');
  let p;
  try { p = JSON.parse(text); } catch { throw Error('Некорректный JSON. Текущий расчёт сохранён.'); }
  const record = x => x && typeof x === 'object' && !Array.isArray(x);
  if (!record(p) || p.schemaVersion !== SCHEMA_VERSION || !Object.hasOwn(TECHNOLOGIES, p.technology)) throw Error('Это не проект калькулятора домов версии 1.');
  const base = createProject(p.technology);
  const strings = (target, source, keys, max = 2000) => {
    for (const key of keys) {
      if (typeof source?.[key] !== 'string' || source[key].length > max) throw Error(`Некорректное поле ${key}.`);
      target[key] = source[key];
    }
  };
  strings(base, p, ['id', 'name', 'address', 'sourceDocument', 'assumptions', 'targetProfit', 'taxNote', 'updatedAt', 'saleMode', 'contractPrice', 'overhead', 'ownerPay', 'companyTax'], 20000);
  if (!['cost-plus', 'contract'].includes(base.saleMode)) throw Error('Неизвестный способ назначения цены.');
  for (const section of ['geometry', 'foundation', 'roof', 'utilities']) {
    if (!record(p[section])) throw Error(`Нет раздела ${section}.`);
    strings(base[section], p[section], Object.keys(base[section]), 200);
  }
  if (!['same', 'frame'].includes(base.geometry.gableStructure) || !['manual', 'slab', 'strip', 'piles'].includes(base.foundation.type) || !['direct', 'duopitch'].includes(base.roof.mode)) throw Error('Неизвестный способ расчёта.');
  if (!['included', 'separate'].includes(base.utilities.wellPricing)) throw Error('Неизвестный состав цены бурения.');
  if (!record(p.stages) || Object.keys(STAGES).some(key => typeof p.stages[key] !== 'boolean')) throw Error('Некорректные этапы.');
  base.stages = Object.fromEntries(Object.keys(STAGES).map(key => [key, p.stages[key]]));
  if (!Array.isArray(p.rows) || p.rows.length > 500) throw Error('Допускается не более 500 позиций.');
  const ids = new Set();
  base.rows = p.rows.map(row => {
    if (!record(row) || !Object.hasOwn(STAGES, row.stage) || !Object.hasOwn(GROUPS, row.group) || !Object.hasOwn(METRICS, row.metric) || typeof row.enabled !== 'boolean' || typeof row.template !== 'boolean') throw Error('Некорректная позиция.');
    const clean = { stage: row.stage, group: row.group, enabled: row.enabled, template: row.template };
    strings(clean, row, ['id', 'name', 'unit', 'metric', 'quantity', 'price', 'reserve', 'pack', 'source', 'date']);
    if (!clean.id || ids.has(clean.id)) throw Error('Идентификаторы позиций должны быть разными.');
    ids.add(clean.id); return clean;
  });
  base.reviewed = p.reviewed === true;
  // Reference metadata is display-only and is never trusted as a source of quantities.
  if (record(p.reference)) {
    base.reference = {};
    strings(base.reference, p.reference, ['title', 'url', 'checked', 'publishedArea', 'note'], 5000);
    try { const u = new URL(base.reference.url); if (u.protocol !== 'https:' || u.username || u.password) throw Error(); } catch { throw Error('Некорректная ссылка на проект.'); }
  }
  return base;
}
