import { createProject, changeAssembly, createRow } from './engine.mjs';

export const DEMO_NOTICE = 'УЧЕБНЫЙ ПРИМЕР 8 × 14 м. Размеры, спецификации, комплекты и все цены условные. Это не смета по вашей фотографии и не предложение подрядчика. Комплектные позиции показывают бюджет; для закупки нужна их подробная спецификация.';
export function demonstrationProject(technology = 'timber', foundationType = 'slab') {
  if (!['slab', 'strip'].includes(foundationType)) throw Error('Для примера выберите плиту или ленту.');
  const p = changeAssembly(createProject(technology), { foundationType });
  p.demonstration = true; p.name = 'УЧЕБНЫЙ ПРИМЕР · 8 × 14 м'; p.address = 'Условный объект';
  Object.assign(p.geometry, { length: '14', width: '8', wallHeightSum: '3', rectOpenings: '18', gableArea: '12', gableOpenings: '0', gableStructure: 'frame', wallThicknessMm: technology === 'foam' ? '300' : '200', solidReplacements: '0', floorArea: '100', frameLumber: '9', insulationArea: '110', insulationThicknessMm: '200', blockLengthMm: '600', blockHeightMm: '300', blockWidthMm: '300', verticalJointMm: '3', horizontalJointMm: '3' });
  Object.assign(p.foundation, foundationType === 'slab'
    ? { length: '14', width: '8', heightMm: '300', formworkMode: 'geometry', formworkHeightMm: '300' }
    : { length: '42.4', width: '0.4', heightMm: '800', formworkMode: 'geometry', formworkHeightMm: '800', formworkSideLength: '84.8', formworkEndCount: '0' });
  p.roof.area = '160'; p.utilities.wellDepth = '40';
  p.sourceDocument = DEMO_NOTICE + '\nКонтрольная арифметика: наружный контур 112 м², периметр 44 м. Веранды не входят. Глубина скважины, конструктив и трассы заданы только для демонстрации.';
  p.assumptions = 'Учебные данные, не строительные рекомендации. Все комплекты в этом примере — условные бюджетные строки. Наружные стены: геометрия без раскроя; фронтоны отдельно каркасные. Перегородки 2,6 м³ заданы отдельной ведомостью. Для ленты: только замкнутый наружный прямоугольник по оси 42,4 м, без внутренних пересечений. Никаких выводов о достаточности конструкций.';
  p.overhead = '150000'; p.ownerPay = '200000'; p.companyTax = '100000'; p.targetProfit = '500000';
  p.taxNote = 'Учебная сумма налога 100 000 ₽, без вычисления ставки или режима. Все цены условно конечные; бухгалтерские и личные налоги этим примером не определяются.'; p.reviewed = true;
  p.rows = [];
  const add = (id, stage, group, name, unit, quantity, price, metric = 'manual', reserve = '0') => {
    const row = createRow(id, stage, group, name, unit, metric);
    Object.assign(row, { quantity, price, reserve, source: 'УЧЕБНЫЕ ДАННЫЕ: условные количество и ставка, не рыночный прайс и не КП.', date: '2026-10-29' }); p.rows.push(row);
  };
  add('design', 'preparation', 'subcontract', 'Проект, изыскания и топосъёмка — учебный комплект', 'компл.', '1', '180000');
  add('site-clear', 'preparation', 'works', 'Подготовка площадки', 'м²', '180', '180');
  add('foundation-main', 'foundation', 'materials', 'Бетон по учебному объёму', 'м³', '', '7500', 'foundationVolume', '5');
  add('foundation-work', 'foundation', 'works', 'Заливка, уплотнение и выравнивание бетона', 'м³', '', '2500', 'foundationVolume');
  add('foundation-rebar', 'foundation', 'materials', 'Арматура: условная спецификация', 'т', '3', '70000');
  add('foundation-rebar-work', 'foundation', 'works', 'Армирование по условной спецификации', 'т', '3', '20000');
  add('foundation-form', 'foundation', 'materials', 'Щиты к закупке: учебная раскладка с оборачиваемостью', 'м²', foundationType === 'slab' ? '15' : '70', '1200');
  add('foundation-form-fix', 'foundation', 'materials', 'Опоры, стяжки, раскосы и крепёж — учебный комплект', 'компл.', '1', '15000');
  add('foundation-form-work', 'foundation', 'works', 'Установка и раскрепление опалубки', 'м²', '', '650', 'foundationFormworkArea');
  add('foundation-form-remove', 'foundation', 'works', 'Разборка опалубки', 'м²', '', '250', 'foundationFormworkArea');
  add('foundation-base', 'foundation', 'materials', 'Подготовка, утепление и гидроизоляция — учебный комплект', 'компл.', '1', '180000');
  add('foundation-earth', 'foundation', 'works', 'Земляные работы, подготовка, гидроизоляция и уход — учебный комплект', 'компл.', '1', '130000');
  if (technology === 'timber') {
    add('wall-timber', 'walls', 'materials', 'Брус наружных стен, до раскроя', 'м³', '', '32000', 'wallVolume', '7');
    add('wall-timber-work', 'walls', 'works', 'Сборка наружных стен из бруса', 'м³', '', '8000', 'wallVolume');
  } else if (technology === 'foam') {
    add('wall-block', 'walls', 'materials', 'Пеноблок по учебному кладочному модулю', 'шт.', '', '240', 'blockCount', '5');
    add('wall-block-work', 'walls', 'works', 'Кладка наружных стен из пеноблока', 'м³', '', '4500', 'wallVolume');
  } else {
    add('wall-frame', 'walls', 'materials', 'Пиломатериал каркаса: условная спецификация', 'м³', '', '28000', 'frameLumber', '5');
    add('wall-frame-work', 'walls', 'works', 'Сборка каркаса', 'м²', '', '1600', 'wallArea');
    add('wall-insulation', 'walls', 'materials', 'Утеплитель: условная площадь ячеек', 'м³', '', '5000', 'insulationVolume', '5');
    add('wall-insulation-work', 'walls', 'works', 'Укладка утеплителя', 'м²', '', '450', 'insulationArea');
  }
  add('demo-wall-kit', 'walls', 'materials', 'Внутренние стены, фронтоны, соединения и слои — учебный комплект', 'компл.', '1', '240000');
  add('demo-wall-kit-work', 'walls', 'works', 'Монтаж внутренних стен, фронтонов и слоёв — учебный комплект', 'компл.', '1', '130000');
  add('floor-structure', 'floors', 'materials', 'Несущие элементы и слои перекрытий — учебный комплект', 'компл.', '1', '280000');
  add('floor-work', 'floors', 'works', 'Устройство перекрытий', 'м²', '', '1500', 'floorArea');
  add('roof-cover', 'roof', 'materials', 'Кровельное покрытие', 'м²', '', '1200', 'roofArea', '10');
  add('roof-cover-work', 'roof', 'works', 'Монтаж покрытия', 'м²', '', '900', 'roofArea');
  add('roof-structure', 'roof', 'materials', 'Стропила, слои, доборы и водосток — учебный комплект', 'компл.', '1', '290000');
  add('roof-structure-work', 'roof', 'works', 'Монтаж стропил, слоёв и водостока — учебный комплект', 'компл.', '1', '190000');
  add('windows', 'openings', 'materials', 'Окна по условной ведомости', 'м²', '14', '14000');
  add('windows-work', 'openings', 'works', 'Монтаж окон', 'м²', '14', '2500');
  add('doors', 'openings', 'materials', 'Наружные двери', 'шт.', '2', '40000');
  add('doors-work', 'openings', 'works', 'Монтаж наружных дверей', 'шт.', '2', '8000');
  add('well-drill', 'well', 'subcontract', 'Бурение с обсадкой: условная глубина', 'м.п.', '', '4000', 'wellDepth');
  add('well-head', 'well', 'materials', 'Насос, адаптер, арматура и водоподготовка — учебный комплект', 'компл.', '1', '120000');
  add('well-test', 'well', 'subcontract', 'Монтаж, прокачка и анализ воды — учебный комплект', 'компл.', '1', '45000');
  add('ext-trench', 'external', 'works', 'Траншеи и обратная засыпка', 'м³', '25', '1200');
  add('ext-water', 'external', 'materials', 'Водопровод: условная трасса и комплект фитингов', 'м.п.', '30', '450', 'manual', '5');
  add('ext-water-work', 'external', 'works', 'Прокладка водопровода', 'м.п.', '30', '500');
  add('ext-sewer', 'external', 'materials', 'Наружная канализация с фитингами', 'м.п.', '18', '800', 'manual', '5');
  add('ext-sewer-work', 'external', 'works', 'Прокладка канализации', 'м.п.', '18', '600');
  add('septic', 'external', 'subcontract', 'Септик, подготовка, колодцы, вводы и запуск — учебный комплект', 'компл.', '1', '220000');
  add('el-cable', 'electrical', 'materials', 'Кабель по условной ведомости одной марки', 'м.п.', '500', '100', 'manual', '5');
  add('el-cable-work', 'electrical', 'works', 'Прокладка кабеля', 'м.п.', '500', '150');
  add('el-board', 'electrical', 'materials', 'Ввод, трассы, щит, точки, свет и заземление — учебный комплект', 'компл.', '1', '170000');
  add('el-board-work', 'electrical', 'works', 'Монтаж ввода, трасс, щита, точек и заземления — учебный комплект', 'компл.', '1', '100000');
  add('el-test', 'electrical', 'subcontract', 'Подключение и электроизмерения — учебный комплект', 'компл.', '1', '50000');
  add('pl-cold', 'plumbing', 'materials', 'Трубы ХВС/ГВС/канализации, арматура и приборы — учебный комплект', 'компл.', '1', '230000');
  add('pl-cold-work', 'plumbing', 'works', 'Разводка, сантехника, бойлер и испытания — учебный комплект', 'компл.', '1', '140000');
  add('heat-source', 'heating', 'materials', 'Источник тепла, трубы, приборы и автоматика — учебный комплект', 'компл.', '1', '300000');
  add('heat-source-work', 'heating', 'works', 'Монтаж отопления — учебный комплект', 'компл.', '1', '150000');
  add('heat-start', 'heating', 'subcontract', 'Пусконаладка отопления', 'компл.', '1', '25000');
  add('vent-equipment', 'ventilation', 'materials', 'Воздуховоды и оборудование — учебный комплект', 'компл.', '1', '120000');
  add('vent-equipment-work', 'ventilation', 'works', 'Монтаж и наладка вентиляции — учебный комплект', 'компл.', '1', '70000');
  add('finish-interior', 'finishing', 'materials', 'Фасад, внутренняя отделка, полы, мокрые зоны и двери — учебный комплект', 'компл.', '1', '650000');
  add('finish-interior-work', 'finishing', 'works', 'Наружная и внутренняя отделка — учебный комплект', 'компл.', '1', '500000');
  add('porch', 'siteworks', 'materials', 'Крыльцо, отмостка и водоотвод — учебный комплект', 'компл.', '1', '180000');
  add('porch-work', 'siteworks', 'works', 'Монтаж крыльца, отмостки и водоотвода — учебный комплект', 'компл.', '1', '100000');
  add('delivery', 'other', 'other', 'Доставка, техника, временные сети и вывоз — учебный комплект', 'компл.', '1', '250000');
  add('handover', 'other', 'works', 'Уборка, исполнительные схемы и сдача', 'компл.', '1', '30000');
  return p;
}
