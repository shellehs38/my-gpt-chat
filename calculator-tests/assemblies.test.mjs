import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,calculate,validateImport,validateAssemblyDefinition,assemblyInsulationThickness,csv} from '../public/facade-calculator/engine.mjs';
import {defaultSystem,getSystemSchema,previewSystem,applySystem,syncOpeningRows} from '../public/facade-calculator/system-kit.mjs';
import {buildReport} from '../public/facade-calculator/report.mjs';

const field=(id,type='number',extra={})=>({id,label:id,type,...extra});
const source={title:'Синтетический технический пример для теста',url:'https://example.org/test-manual.pdf',checked:'2026-10-25'};
const card=(extra={})=>({id:'test-render',name:'Штукатурная система — тест',manufacturer:'Тестовый производитель',systemId:'render',systemKind:'render',scenarioMode:'bare',coverage:'area',mounting:['Порядок по тестовой техкарте.'],accessories:['Совместимые компоненты.'],limitations:['Учебный пример не является рекомендацией.'],sources:[source],assemblyFields:[field('levelNorm'),field('levelThickness'),field('levelSource','text'),field('levelReserve'),field('levelPack')],assembly:[{id:'level',name:'Выравнивающий состав','unit':'кг',mode:'norm',normKey:'levelNorm',factorKey:'levelThickness',factorLabel:'Толщина выравнивания, мм',sourceKey:'levelSource',reserveKey:'levelReserve',packKey:'levelPack',workName:'Выравнивание основания'}],...extra});
const project=(area='30',scenario='bare')=>{const s=initialState();s.areaMode='direct';s.directArea=area;s.scenario=scenario;s.taxMode='none';return s;};
const config=(assemblyValues={},extra={})=>({...defaultSystem(),mountingMethod:'assembly',assemblyValues,...extra});
const row=(s,key,section='materials')=>calculate(s).sections[section].rows.find(x=>x.kitKey===`assembly:${key}`||x.kitKey===`work:assembly:${key}`);
const levelValues={levelNorm:'1.5',levelThickness:'5',levelSource:'Тестовая техкарта, кг/м²/мм',levelReserve:'10',levelPack:'25'};
function brick(){return card({id:'test-brick',systemId:'facing-brick',systemKind:'masonry',name:'Облицовочный кирпич — тест',assemblyFields:[field('brickLength'),field('brickHeight'),field('jointWidth'),field('jointHeight'),field('brickReserve'),field('brickPack')],assembly:[{id:'brick',name:'Облицовочный кирпич','unit':'шт.',mode:'masonry',lengthKey:'brickLength',heightKey:'brickHeight',jointWidthKey:'jointWidth',jointHeightKey:'jointHeight',reserveKey:'brickReserve',packKey:'brickPack',workName:'Кладка облицовочного кирпича'}]});}
const brickValues={brickLength:'250',brickHeight:'65',jointWidth:'10',jointHeight:'10',brickReserve:'5',brickPack:'420'};

test('render material multiplies exact area, consumption and thickness; procurement does not inflate work',()=>{
  let s=applySystem(project(),config(levelValues),card());
  assert.equal(row(s,'level').netQty,225);assert.equal(row(s,'level').demandQty,247.5);assert.equal(row(s,'level').qty,250);assert.equal(row(s,'level','works').qty,30);
  s.scenarios.bare.materials[0].stock='5';s.scenarios.bare.materials[0].ordered='20';
  assert.equal(row(s,'level').neededQty,222.5);assert.equal(row(s,'level').qty,225);assert.equal(row(s,'level','works').qty,30);
  assert.equal(getSystemSchema(card()).assemblyMode,true);assert.deepEqual(getSystemSchema(card()).baseOptions,[]);
  assert.ok(s.scenarios.bare.materials.every(r=>!r.kitKey.startsWith('subsystem:')&&!r.kitKey.startsWith('trim:')));
});

test('brick counts use both joints and exact module, round pieces and packs, and keep labor net',()=>{
  let s=applySystem(project(),config(brickValues),brick());
  assert.equal(row(s,'brick').coverWidth,'0.26');assert.equal(row(s,'brick').coverHeight,'0.075');assert.equal(row(s,'brick').qty,1680);assert.equal(row(s,'brick','works').qty,30);
  s.scenarios.bare.materials[0].price='37.5';s.scenarios.bare.works[0].price='100';
  assert.equal(calculate(s).total,67200);assert.equal(calculate(s).pricing.allowance,1200);
  s.directArea='31.2';assert.equal(row(s,'brick').netQty,1600);assert.equal(row(s,'brick').qty,1680);assert.equal(row(s,'brick','works').qty,31.2);
  s=applySystem(s,config({...brickValues,jointWidth:'0',jointHeight:'0'}),brick());assert.equal(row(s,'brick').netQty,1920);assert.equal(s.scenarios.bare.materials[0].price,'');
});

test('source-card defaults are never silently used by the calculation engine',()=>{
  const v=card({assemblyFields:card().assemblyFields.map(f=>({...f,default:levelValues[f.id]||''}))});
  const s=applySystem(project(),config(),v);assert.equal(row(s,'level').qty,null);assert.equal(row(s,'level').norm,'');assert.equal(row(s,'level').normSource,'');
  assert.match(row(s,'level').errors.join(' '),/расход|источник/);
});

test('unknown norms and thickness stay incomplete; zero or invalid factors are never invented',()=>{
  let s=applySystem(project(),config({...levelValues,levelNorm:'',levelThickness:''}),card());
  assert.equal(row(s,'level').qty,null);assert.equal(calculate(s).ready,false);assert.match(row(s,'level').errors.join(' '),/Толщина выравнивания/);
  s=applySystem(project(),config({...levelValues,levelSource:''}),card());assert.equal(row(s,'level').qty,null);assert.match(row(s,'level').errors.join(' '),/источник/);
});

test('optional stages ignore hidden invalid inputs and preserve quotes of the retained stage',()=>{
  const v=card({assemblyFields:[...card().assemblyFields,...[field('paintNorm'),field('paintSource','text'),field('paintLayers','number',{required:true,min:'1',integer:true})]],assembly:[...card().assembly,{id:'paint',name:'Краска',unit:'л',mode:'norm',normKey:'paintNorm',factorKey:'paintLayers',sourceKey:'paintSource',workName:'Окрашивание',workMode:'norm',workNormKey:'paintLayers',optional:true,enabledDefault:false}]});
  const c=config({...levelValues,paintNorm:'bad',paintLayers:'bad'});let s=applySystem(project(),c,v);assert.equal(s.scenarios.bare.materials.length,1);
  s.scenarios.bare.materials[0].price='19';
  const enabled=config({...levelValues,paintNorm:'0.2',paintSource:'Тест расхода на слой',paintLayers:'2'},{assemblyEnabled:{paint:true}});
  s=applySystem(s,enabled,v);assert.equal(s.scenarios.bare.materials.find(r=>r.kitKey==='assembly:level').price,'19');assert.equal(row(s,'paint').qty,12);assert.equal(row(s,'paint','works').qty,60);
  assert.throws(()=>applySystem(project(),config({...enabled.assemblyValues,paintLayers:'1.5'},{assemblyEnabled:{paint:true}}),v),/цел|диапазон|проверьте/);
});

function insulation(){return card({id:'test-eifs',systemId:'eifs',systemKind:'eifs',name:'СФТК EPS с минеральными вставками — тест',scenarioMode:'insulated',assemblyFields:[field('thickness'),field('barrierArea'),field('barrierSource','text'),field('grade','text')],assembly:[{id:'eps',name:'EPS основной слой',unit:'м³',mode:'insulationVolume',thicknessKey:'thickness',excludeAreaKey:'barrierArea',areaSourceKey:'barrierSource',identityKeys:['grade'],workName:'Приклейка EPS'},{id:'barrier',name:'Минераловатные рассечки',unit:'м³',mode:'insulationVolume',thicknessKey:'thickness',areaKey:'barrierArea',areaSourceKey:'barrierSource',workName:'Приклейка рассечек'}]});}

test('EPS replacement zones subtract area instead of doubling insulation and paired labor',()=>{
  const v=insulation(),c=config({thickness:'100',barrierArea:'10',barrierSource:'Проект рассечек',grade:'EPS фасадный'});let s=applySystem(project('100','insulated'),c,v);
  assert.equal(row(s,'eps').qty,9);assert.equal(row(s,'barrier').qty,1);assert.equal(row(s,'eps','works').qty,90);assert.equal(row(s,'barrier','works').qty,10);assert.equal(s.thickness,'100');
  const out=buildReport(s);assert.match(out,/Толщина основного слоя утепления: 100/);assert.match(out,/исключённый участок 10 м²/);assert.match(csv(s),/Толщина основного слоя утепления, мм";"100/);
  s.directArea='120';assert.equal(row(s,'eps').qty,11);assert.equal(row(s,'barrier').qty,1);
});

test('zero replacement area requires explicit project evidence to omit unneeded zero-zone stages',()=>{
  const v=insulation();const p=previewSystem(project('100','insulated'),config({thickness:'100',barrierArea:'0',barrierSource:'Проект: рассечки отсутствуют'}),v);
  assert.equal(p.materials.some(r=>r.kitKey==='assembly:barrier'),false);assert.equal(p.works.some(r=>r.kitKey==='work:assembly:barrier'),false);assert.match(p.notes.join(' '),/участок по проекту 0/);
  const s=applySystem(project('100','insulated'),config({thickness:'100',barrierArea:'0',barrierSource:''}),v);assert.equal(row(s,'barrier').netQty,0);assert.ok(s.scenarios.insulated.materials.some(r=>r.kitKey==='assembly:barrier'));
});

test('missing, oversized or unsourced replacement area cannot become a valid material quantity',()=>{
  for(const [area,source] of [['','Проект'],['101','Проект'],['10','']]){
    const s=applySystem(project('100','insulated'),config({thickness:'100',barrierArea:area,barrierSource:source}),insulation());
    assert.equal(row(s,'eps').qty,null);assert.equal(row(s,'barrier').qty,null);assert.equal(calculate(s).ready,false);
  }
});

test('assembly scenarios require the matching insulation variant and never synthesize missing insulation',()=>{
  assert.throws(()=>applySystem(project(),config({thickness:'100',barrierArea:'10',barrierSource:'Проект'}),insulation()),/С утеплением/);
  assert.throws(()=>applySystem(project('30','insulated'),config(levelValues),card()),/Без утепления/);
  const noLayer=card({scenarioMode:'insulated'});assert.throws(()=>applySystem(project('30','insulated'),config(levelValues),noLayer),/утепляющий слой/);
});

test('JSON carries source-backed assembly fields, replacement areas and all calculated row parameters',()=>{
  const s=applySystem(project('100','insulated'),config({thickness:'100',barrierArea:'10',barrierSource:'Проект',grade:'Класс А'}),insulation()),r=validateImport(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(r.scenarios.insulated.system,s.scenarios.insulated.system);assert.equal(row(r,'eps').qty,9);assert.equal(row(r,'eps','works').qty,90);
  const out=csv(r),report=buildReport(r);assert.match(out,/Параметр операций фасадной системы/);assert.match(out,/Источник площади участка/);assert.match(report,/Паспорт выбранной технологии/);assert.match(report,/logo-sl-approved-light.png/);assert.doesNotMatch(report,/Цена панели — за штуку/);
});

test('definition and imported map validation reject malformed formulas, fields, scopes and keys',()=>{
  const mutations=[v=>v.assemblyFields.push({...v.assemblyFields[0]}),v=>v.assembly[0].mode='eval',v=>v.assembly[0].factorKey='missing',v=>v.assembly[0].sourceKey=undefined,v=>v.assembly[0].identityKeys=['missing'],v=>v.assembly[0].areaKey='levelNorm',v=>v.assemblyFields[0].id='constructor'];
  for(const mutate of mutations){const v=structuredClone(card());mutate(v);assert.throws(()=>validateAssemblyDefinition(v));}
  const s=applySystem(project(),config(levelValues),card());for(const value of [{levelNorm:2},{constructor:'bad'},{unknown:'1'}]){const bad=structuredClone(s);bad.scenarios.bare.system.assemblyValues=value;assert.throws(()=>validateImport(bad));}
  const bad=structuredClone(s);bad.scenarios.bare.system.assemblyEnabled={level:true};assert.throws(()=>validateImport(bad));
});

test('reapply honors changed packaging, preserves manual project quantities, and resets changed grade quotes',()=>{
  let s=applySystem(project(),config(levelValues),card());s.scenarios.bare.materials[0].price='30';s.scenarios.bare.materials[0].pack='50';
  s=applySystem(s,config(levelValues),card());assert.equal(s.scenarios.bare.materials[0].pack,'50');
  s=applySystem(s,config({...levelValues,levelPack:'20'}),card());assert.equal(s.scenarios.bare.materials[0].pack,'20');assert.equal(s.scenarios.bare.materials[0].price,'30');
  const v=card({assemblyFields:[],assembly:[{id:'anchors',name:'Крепления по проекту',unit:'шт.',mode:'manual',workName:'Работа по спецификации',workMode:'manual'}]});let m=applySystem(project(),config(),v);m.scenarios.bare.materials[0].quantity='42';m.scenarios.bare.works[0].quantity='2';m=applySystem(m,config(),v);assert.equal(row(m,'anchors').qty,42);assert.equal(row(m,'anchors','works').qty,2);
  const c=config({thickness:'100',barrierArea:'10',barrierSource:'Проект',grade:'А'});let i=applySystem(project('100','insulated'),c,insulation());i.scenarios.insulated.materials[0].price='2000';i=applySystem(i,config({...c.assemblyValues,grade:'Б'}),insulation());assert.equal(i.scenarios.insulated.materials[0].price,'');
});

test('legacy-only inputs and newly entered openings never create unrelated siding rows in an assembly',()=>{
  let s=applySystem(project(),config(levelValues,{panelLength:'bad',railPitch:'bad',layer1:'bad',membranePack:'bad'}),card());
  assert.equal(s.scenarios.bare.system.panelLength,'');assert.equal(s.scenarios.bare.system.railPitch,'');assert.equal(s.scenarios.bare.system.layer1,'');
  s.openings.push({id:'new',name:'Окно',type:'window',wallId:'',width:'1',height:'1',count:'1',depth:'0.2',sides:'3'});assert.deepEqual(syncOpeningRows(s),{materials:0,works:0});
  const before=JSON.stringify(s);previewSystem(s,config(levelValues),card());assert.equal(JSON.stringify(s),before);
});


test('assembly thickness sums full-area layers and keeps replacement zones lateral with exact decimals',()=>{
  const layer=(thickness,extra={})=>({enabled:true,mode:'insulationVolume',thickness,...extra});
  assert.equal(assemblyInsulationThickness([layer('50'),layer('50')]),'100');
  assert.equal(assemblyInsulationThickness([layer('100',{areaDeduction:'10'}),layer('100',{areaOverride:'10',requiresAreaOverride:true})]),'100');
  assert.equal(assemblyInsulationThickness([layer('50.15'),layer('49.85'),layer('100',{areaOverride:'10'})]),'100');
  assert.equal(assemblyInsulationThickness([layer('50'),layer('50',{enabled:false})]),'50');
  assert.equal(assemblyInsulationThickness([layer('50'),layer('')]),'');
});


test('switching from a saved assembly uses the new selected product rather than the old snapshot',()=>{
  let s=applySystem(project(),config(levelValues),card());
  const oldConfig=structuredClone(s.scenarios.bare.system);oldConfig.assemblyValues={...brickValues};
  s=applySystem(s,oldConfig,brick());assert.equal(s.scenarios.bare.system.variant.id,'test-brick');assert.equal(s.scenarios.bare.system.selection,undefined);assert.equal(row(s,'brick').qty,1680);
  assert.equal(s.scenarios.bare.system.assemblyValues.levelNorm,undefined);assert.equal(s.scenarios.bare.materials.some(r=>r.kitKey==='assembly:level'),false);assert.doesNotThrow(()=>validateImport(JSON.parse(JSON.stringify(s))));
});

test('every source-backed catalog assembly applies with explicit project fixtures and survives JSON transfer',async()=>{
  const {claddingSystems,selectSystem}=await import('../public/facade-calculator/system-catalog.mjs');let checked=0;
  for(const category of claddingSystems)for(const raw of category.variants||[]){
    const v=selectSystem(category.id,'',raw.id).variant;if(!v.assembly)continue;
    const values=Object.fromEntries(v.assemblyFields.map(f=>{
      if(f.type==='text')return [f.id,'Тестовая проектная спецификация'];
      if(f.type==='select')return [f.id,f.default||f.options.find(o=>o.id)?.id||''];
      const n=Math.min(f.max===undefined?Infinity:Number(f.max),Math.max(1,Number(f.min||'0')));
      return [f.id,f.default!==undefined&&f.default!==''?f.default:String(n)];
    }));
    const c=config(values,{assemblyEnabled:Object.fromEntries(v.assembly.filter(e=>e.optional).map(e=>[e.id,true]))});
    const s=applySystem(project('30',v.scenarioMode==='insulated'?'insulated':'bare'),c,v),restored=validateImport(JSON.parse(JSON.stringify(s)));
    assert.equal(restored.scenarios[restored.scenario].system.variant.id,v.id);assert.equal(calculate(restored).geo.area,30);
    for(const r of restored.scenarios[restored.scenario].materials)assert.match(r.kitKey,/^assembly:/,v.id);
    for(const r of restored.scenarios[restored.scenario].works)assert.match(r.kitKey,/^work:assembly:/,v.id);
    assert.doesNotThrow(()=>buildReport(restored));checked++;
  }
  assert.ok(checked>=20,`Only ${checked} new catalog assemblies were checked`);
});
