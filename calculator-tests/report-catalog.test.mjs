import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,createRow,serializeProject,validateImport} from '../public/facade-calculator/engine.mjs';
import {buildReport,buildStandaloneReport} from '../public/facade-calculator/report.mjs';

function fixture(){
  const state=initialState();state.areaMode='walls';state.walls=[{id:'wall',name:'Фасад',shape:'rect',width:'10',height:'3',topWidth:''}];
  for(const scenario of Object.values(state.scenarios))for(const key of ['materials','works'])scenario[key]=[];
  state.scenarios.insulated.system={
    familyId:'test',variantId:'test-product',orientation:'horizontal',usefulWidth:'0.25',fullWidth:'0.28',panelLength:'3',railPitch:'0.6',bracketPitch:'0.8',anchorsPerBracket:'2',layer1:'50',layer2:'50',source:'Проект узлов П-1',includeMembrane:true,membraneOverlap:'12',membranePack:'70',
    variant:{id:'test-product',name:'Профиль «Тест»',manufacturer:'Производитель А',mounting:['Направляющие поперёк панелей'],accessories:['Стартовый элемент этой системы'],limitations:['Крепёж подтверждается проектом'],sources:[{title:'Инструкция профиля',url:'https://manufacturer.example/manual.pdf',checked:'2026-10-24',pages:'3–7'}]},
    insulationSelection:{id:'test-wool',name:'Фасадная минеральная вата',manufacturer:'Производитель Б',application:'Вентилируемый фасад по проектной системе',mounting:['Стыки соседних рядов смещают'],limitations:['Не заменять плитами для иной области применения'],sources:[{title:'Карта утеплителя',url:'https://insulation.example/facade.pdf',checked:'2026-10-24'}]}
  };
  state.scenarios.insulated.materials.push({...createRow('Панели','шт.','panels','external'),kitKey:'siding:panels',coverWidth:'0.25',coverHeight:'3',price:'1000'});
  state.scenarios.insulated.materials.push({...createRow('Первый слой','м³','insulationVolume','external'),kitKey:'insulation:layer1',thickness:'50',price:'1000'});
  state.scenarios.insulated.materials.push({...createRow('Второй слой','м³','insulationVolume','external'),kitKey:'insulation:layer2',thickness:'50',price:'1000'});
  return state;
}

test('report carries applied product snapshots, technical cards and sources through JSON transfer',()=>{
  const state=validateImport(JSON.parse(serializeProject(fixture())));
  const html=buildReport(state);
  for(const expected of ['Паспорт выбранных материалов','Производитель А','Производитель Б','Профиль «Тест»','Полезная ширина:</b> 0.25 м','Полная ширина:</b> 0.28 м','Заказная длина панели:</b> 3 м','Инструкция профиля','Карта утеплителя','страницы: 3–7','2026-10-24','Стартовый элемент этой системы','Не заменять плитами для иной области применения','Проект узлов П-1'])assert.ok(html.includes(expected),expected);
  assert.match(html,/href="https:\/\/manufacturer\.example\/manual\.pdf"/);
  assert.match(html,/href="https:\/\/insulation\.example\/facade\.pdf"/);
  assert.match(html,/href="#system-cladding-card"/);assert.match(html,/href="#system-insulation-card"/);
  assert.match(html,/Цена панели в строке материалов задаётся за одну штуку/);
  assert.match(html,/Толщина слоя 1:<\/b> 50 мм/);assert.match(html,/Толщина слоя 2:<\/b> 50 мм/);
  assert.match(html,/стыки плит слоёв смещают/);
  assert.match(html,/Дополнительное обрамление проёмов, усиления, стыки/);
  assert.match(html,/Мембрана включена/);
});

test('source cards escape content and link only to safe HTTPS documents',()=>{
  const state=fixture(),card=state.scenarios.insulated.system.variant;
  card.name='<script>bad()</script>';card.mounting=['<img src=x onerror=bad()>'];
  card.sources=[{title:'<b>Unsafe</b>',url:'javascript:alert(1)'},{title:'HTTP rejected',url:'http://example.org/file.pdf'},{title:'Credentials rejected',url:'https://user:password@example.org/file.pdf'},{title:'Safe title',url:'https://example.org/a?first=1&second=2'}];
  const html=buildReport(state);
  assert.doesNotMatch(html,/<script>|<img src=x|href="javascript:|href="http:|user:password/);
  assert.match(html,/&lt;script&gt;bad\(\)&lt;\/script&gt;/);assert.match(html,/&lt;img src=x onerror=bad\(\)&gt;/);
  assert.match(html,/&lt;b&gt;Unsafe&lt;\/b&gt;/);assert.match(html,/href="https:\/\/example\.org\/a\?first=1&amp;second=2"/);
});

test('different insulation products keep their own inner and outer layer cards after project transfer',()=>{
  const state=fixture();
  state.scenarios.insulated.system.insulationId2='outer-product';
  state.scenarios.insulated.system.insulationSelection2={id:'outer-product',name:'Наружная фасадная плита',manufacturer:'Производитель наружного слоя',mounting:['Правило монтажа только наружной плиты'],limitations:['Применять только как наружный слой двухслойного решения'],sources:[{title:'Техкарта наружного слоя',url:'https://outer.example/facade.pdf',checked:'2026-10-24'}]};
  state.scenarios.insulated.materials.find(row=>row.kitKey==='insulation:layer2').price='2000';
  state.scenarios.insulated.works.push({...createRow('Монтаж внутреннего слоя','м²','area','base'),kitKey:'work:insulation1',price:'100'},{...createRow('Монтаж наружного слоя','м²','area','base'),kitKey:'work:insulation2',price:'100'});
  const html=buildReport(validateImport(JSON.parse(serializeProject(state))));
  const inner=html.match(/<section id="system-insulation-card"[\s\S]*?<\/section>/)?.[0];
  const outer=html.match(/<section id="system-insulation-card-2"[\s\S]*?<\/section>/)?.[0];
  assert.ok(inner);assert.ok(outer);
  assert.match(inner,/слой 1 \(внутренний\)/);assert.match(inner,/Производитель Б/);assert.match(inner,/Карта утеплителя/);
  assert.doesNotMatch(inner,/Производитель наружного слоя|Техкарта наружного слоя/);
  assert.match(outer,/слой 2 \(наружный\)/);assert.match(outer,/Производитель наружного слоя|Правило монтажа только наружной плиты/);
  assert.match(outer,/Применять только как наружный слой/);assert.match(outer,/href="https:\/\/outer\.example\/facade\.pdf"/);
  assert.doesNotMatch(outer,/Производитель Б|Карта утеплителя/);
  assert.equal((html.match(/href="#system-insulation-card"/g)||[]).length,2);
  assert.equal((html.match(/href="#system-insulation-card-2"/g)||[]).length,2);
});

test('legacy two-layer system reuses its saved insulation card for the second layer',()=>{
  const html=buildReport(fixture());
  const inner=html.match(/<section id="system-insulation-card"[\s\S]*?<\/section>/)?.[0];
  const outer=html.match(/<section id="system-insulation-card-2"[\s\S]*?<\/section>/)?.[0];
  assert.match(inner,/Фасадная минеральная вата/);assert.match(outer,/Фасадная минеральная вата/);
  assert.match(outer,/href="https:\/\/insulation\.example\/facade\.pdf"/);
  const state=fixture();state.scenarios.insulated.system.layer2='';
  assert.doesNotMatch(buildReport(state),/<section id="system-insulation-card-2"/);
});

test('report header belongs to the current scenario and totals active layer thickness exactly',()=>{
  const state=fixture();state.cladding='Устаревшая глобальная облицовка';state.insulationType='Устаревшее глобальное утепление';state.thickness='999';
  state.scenarios.insulated.materials.find(row=>row.kitKey==='insulation:layer1').thickness='0.100000000001';
  state.scenarios.insulated.materials.find(row=>row.kitKey==='insulation:layer2').thickness='0.200000000002';
  state.scenarios.insulated.system.insulationSelection2={id:'outer',name:'Внешняя плита',manufacturer:'Производитель Г'};
  let html=buildReport(state);
  assert.match(html,/<b>Облицовка:<\/b> Производитель А · Профиль «Тест»/);
  assert.match(html,/Общая толщина утепления: 0,300000000003 мм/);
  assert.match(html,/Толщина слоя 1:<\/b> 0,100000000001 мм/);assert.match(html,/Толщина слоя 2:<\/b> 0,200000000002 мм/);
  assert.match(html,/<b>Тип утепления:<\/b> Производитель Б · Фасадная минеральная вата \(слой 1\); Производитель Г · Внешняя плита \(слой 2\)/);
  assert.doesNotMatch(html,/Устаревшая глобальная облицовка|Устаревшее глобальное утепление|Общая толщина утепления: 999/);
  state.scenarios.insulated.materials.find(row=>row.kitKey==='insulation:layer2').enabled=false;
  html=buildReport(state);assert.match(html,/Общая толщина утепления: 0,100000000001 мм/);assert.match(html,/Толщина слоя 2:<\/b> 0,200000000002 мм \(позиция отключена\)/);
  state.scenarios.insulated.materials.find(row=>row.kitKey==='insulation:layer1').thickness='';
  assert.match(buildReport(state),/Общая толщина утепления: не указана мм/);
  state.scenario='bare';state.scenarios.bare.system={variant:{name:'Другой профиль',manufacturer:'Производитель Д'}};
  html=buildReport(state);assert.match(html,/<b>Облицовка:<\/b> Производитель Д · Другой профиль/);assert.doesNotMatch(html,/Общая толщина утепления:/);
});

test('legacy report metadata continues to use the original project fields',()=>{
  const state=initialState();state.cladding='Старая облицовка';state.insulationType='Старый утеплитель';state.thickness='120';
  const html=buildReport(state);
  assert.match(html,/<b>Облицовка:<\/b> Старая облицовка/);assert.match(html,/<b>Тип утепления:<\/b> Старый утеплитель/);assert.match(html,/Общая толщина утепления: 120 мм/);
});

test('report explains support grid modes instead of calling them manual quantities',()=>{
  const state=fixture();
  for(const [mode,name,unit] of [['supportLength','Сетка направляющих','м.п.'],['supportBrackets','Кронштейны сетки','шт.'],['supportAnchors','Анкеры сетки','шт.']])state.scenarios.insulated.materials.push({...createRow(name,unit,mode,'external'),orientation:'vertical',railPitch:'0.6',bracketPitch:'0.8',anchorsPerBracket:'2',normSource:'П-1',price:'100',techNote:'Предварительная сетка без усилений проёмов'});
  const html=buildReport(state);
  assert.match(html,/Горизонтальные направляющие; шаг 0.6 м/);
  assert.match(html,/без вычета проёмов; сумма длин направляющих по сетке/);
  assert.match(html,/кронштейны с шагом 0.8 м, включая концы направляющей/);
  assert.match(html,/× 2 анкеров на кронштейн/);
  assert.match(html,/Предварительная сетка без усилений проёмов/);
});

test('bare scenario does not print the insulated scenario card or membrane',()=>{
  const state=fixture();state.scenario='bare';
  state.scenarios.bare.system={orientation:'vertical',usefulWidth:'0.3',panelLength:'2',variant:{name:'Отдельный профиль',manufacturer:'Производитель В',sources:[]}};
  const html=buildReport(state);
  assert.match(html,/Отдельный профиль/);assert.match(html,/Производитель В/);
  assert.doesNotMatch(html,/Производитель А|Производитель Б|Фасадная минеральная вата|Мембрана включена|Толщина слоя 1:/);
});

test('legacy report has no fabricated catalog selection and keeps its approved logo',()=>{
  const html=buildReport(initialState());
  assert.doesNotMatch(html,/Паспорт выбранных материалов|system-cladding-card|system-insulation-card/);
  assert.match(html,/brand\/logo-sl-approved-light.png/);
});

test('standalone technical cards retain safe clickable sources and embedded approved brand',async()=>{
  const {readFileSync}=await import('node:fs');
  const png=readFileSync(new URL('../public/facade-calculator/brand/logo-sl-approved-light.png',import.meta.url));
  const html=buildStandaloneReport(fixture(),'data:image/png;base64,'+png.toString('base64'));
  assert.match(html,/src="data:image\/png;base64,/);assert.doesNotMatch(html,/src="\.\/brand\//);
  assert.match(html,/href="https:\/\/manufacturer\.example\/manual\.pdf"/);
  for(const phrase of ['+40%','Бюджет руководителя','Базовая трудовая часть'])assert.ok(!html.includes(phrase),phrase);
});
