import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {initialState,createRow,calculate,validateImport,copyCommonRows,csv} from '../public/facade-calculator/engine.mjs';
import {defaultSystem,previewSystem,applySystem,syncOpeningRows} from '../public/facade-calculator/system-kit.mjs';
const variant={id:'maker-siding',manufacturer:'Производитель',name:'Профиль',usefulWidth:'0.2',fullWidth:'0.22',minLength:'0.5',maxLength:'6',orientations:['horizontal','vertical'],mounting:['Шаги по проекту.'],accessories:['Углы'],limitations:['До раскроя'],sources:[{title:'Инструкция',url:'https://example.org/manual.pdf',checked:'2026-10-24',pages:'4–5'}]};
const wool={id:'facade-wool',manufacturer:'Марка',name:'Фасадная плита',mounting:['Смещение стыков.'],limitations:[],sources:[{title:'Система',url:'https://example.org/system.pdf',checked:'2026-10-24'}]};
function project(){const s=initialState();s.walls[0].width='1.2';s.walls[0].height='3';s.measures={outerCorners:'0',innerCorners:'0',baseLength:'1.2',corniceLength:'1.2'};return s;}
function config(extra={}){return {...defaultSystem(),variantId:variant.id,familyId:'family',orientation:'horizontal',panelLength:'3',railPitch:'0.6',bracketPitch:'1.5',anchorsPerBracket:'2',source:'Проект — проверенные шаги',layer1:'50',layer2:'50',insulationPack1:'0.216',insulationPack2:'0.216',...extra};}
const row=(s,key,section='materials')=>calculate(s).sections[section].rows.find(r=>r.kitKey===key);

test('default system has no invented project pitches, thicknesses, norms or prices',()=>{const c=defaultSystem();for(const key of ['railPitch','bracketPitch','anchorsPerBracket','layer1','layer2','fixingsPerM2','insulationFixingsPerM2'])assert.equal(c[key],'');assert.equal(c.includeMembrane,false);assert.equal(c.reserve,'0');});
test('horizontal siding grid uses exact ceil boundaries and gross walls without opening deduction',()=>{
  let s=applySystem(project(),config(),variant,wool);assert.equal(row(s,'subsystem:rails').netQty,9);assert.equal(row(s,'subsystem:brackets').netQty,9);assert.equal(row(s,'subsystem:anchors').netQty,18);
  s.walls[0].width='1.200000000001';assert.equal(row(s,'subsystem:rails').netQty,12);assert.equal(row(s,'subsystem:brackets').netQty,12);
  s.walls[0].width='1.2';s.openings=[{name:'Окно',type:'window',width:'0.5',height:'1',count:'1',wallId:s.walls[0].id,depth:'0.2',sides:'3'}];assert.equal(calculate(s).geo.area,3.1);assert.equal(row(s,'subsystem:rails').netQty,9);assert.equal(row(s,'siding:panels').qty,6);
});
test('vertical siding rotates rails and brackets; building mode uses four walls',()=>{
  let s=applySystem(project(),config({orientation:'vertical',bracketPitch:'0.6'}),variant,wool);assert.equal(row(s,'subsystem:rails').netQty,7.2);assert.equal(row(s,'subsystem:brackets').netQty,18);assert.equal(row(s,'subsystem:anchors').netQty,36);
  s.areaMode='building';s.buildingLength='1.2';s.buildingWidth='1.8';s.buildingHeight='3';assert.equal(row(s,'subsystem:rails').netQty,36);assert.equal(row(s,'subsystem:brackets').netQty,84);
});
test('missing pitches or design source stay unknown; direct area and gables require project takeoff',()=>{
  let s=applySystem(project(),config({railPitch:''}),variant,wool);assert.equal(row(s,'subsystem:rails').qty,null);assert.match(row(s,'subsystem:rails').errors.join(' '),/шаг направляющих/);
  s=applySystem(project(),config({source:''}),variant,wool);assert.equal(row(s,'subsystem:rails').qty,null);assert.match(row(s,'subsystem:rails').errors.join(' '),/источник/);
  s=applySystem(project(),config(),variant,wool);s.areaMode='direct';s.directArea='10';assert.equal(row(s,'subsystem:rails').qty,null);assert.match(row(s,'subsystem:rails').errors.join(' '),/прямоугольные/);
  s.areaMode='walls';s.walls[0].shape='triangle';assert.equal(row(s,'subsystem:rails').qty,null);assert.match(row(s,'subsystem:rails').errors.join(' '),/фронтонов/);
});
test('two50mm layers have independent volume and packs; reserves never inflate labor',()=>{
  const s=applySystem(project(),config({insulationReserve:'5',reserve:'10',fixingsPerM2:'2',fastenerSource:'Проект',insulationFixingsPerM2:'5',insulationFixingSource:'Раскладка'}),variant,wool);
  for(const key of ['insulation:layer1','insulation:layer2']){assert.equal(row(s,key).netQty,0.18);assert.equal(row(s,key).qty,0.216);assert.equal(row(s,key).packs,1);}
  assert.equal(s.thickness,'100');assert.equal(row(s,'work:insulation1','works').qty,3.6);assert.equal(row(s,'work:insulation2','works').qty,3.6);assert.equal(row(s,'work:siding','works').qty,3.6);assert.equal(row(s,'siding:panels').qty,7);assert.equal(row(s,'insulation:fixings').qty,18);
});
test('layer packs are independent for different thickness and common fallback only for equal layers',()=>{
  let s=applySystem(project(),config({layer2:'100',insulationPack1:'',insulationPack2:'',insulationPack:'0.216'}),variant,wool);assert.equal(row(s,'insulation:layer1').pack,'0.216');assert.equal(row(s,'insulation:layer2').pack,'');
  s=applySystem(project(),config({layer1:'0.1',layer2:'0.2'}),variant,wool);assert.equal(s.thickness,'0.3');
});
test('first apply replaces only empty generic template and does not touch another scenario',()=>{
  const s=project(),before=JSON.stringify(s),bare=JSON.stringify(s.scenarios.bare),out=applySystem(s,config(),variant,wool);
  assert.equal(JSON.stringify(s),before);assert.equal(JSON.stringify(out.scenarios.bare),bare);assert.ok(out.scenarios.insulated.materials.every(r=>r.kitKey));assert.equal(out.scenarios.insulated.materials.filter(r=>r.kitKey==='siding:panels').length,1);assert.equal(out.scenarios.insulated.system.variant.name,variant.name);
});
test('reapply is idempotent, preserves same-product quotes and custom rows, and resets changed products',()=>{
  let s=applySystem(project(),config(),variant,wool),p=s.scenarios.insulated.materials.find(r=>r.kitKey==='siding:panels');Object.assign(p,{price:'1000',source:'КП1',priceDate:'2026-10-24',stock:'1',ordered:'2'});const id=p.id;s.scenarios.insulated.materials.push({...createRow('Особая деталь','шт.','manual','external'),quantity:'2',price:'40'});
  s=applySystem(s,config({railPitch:'0.5'}),variant,wool);p=s.scenarios.insulated.materials.find(r=>r.kitKey==='siding:panels');assert.equal(p.id,id);assert.equal(p.price,'1000');assert.equal(p.stock,'1');assert.equal(s.scenarios.insulated.materials.filter(r=>r.kitKey==='siding:panels').length,1);assert.equal(s.scenarios.insulated.materials.find(r=>r.name==='Особая деталь').price,'40');
  s=applySystem(s,config({panelLength:'2'}),variant,wool);p=s.scenarios.insulated.materials.find(r=>r.kitKey==='siding:panels');assert.equal(p.price,'');assert.equal(p.stock,'');assert.equal(p.source,'');
});
test('legacy populated estimates require a separate object and never mutate on preview',()=>{
  const s=project();s.scenarios.insulated.materials[0].price='500';const before=JSON.stringify(s),p=previewSystem(s,config(),variant,wool);assert.match(p.errors.join(' '),/отдельный объект/);assert.throws(()=>applySystem(s,config(),variant,wool),/не дублировала/);assert.equal(JSON.stringify(s),before);
});
test('blank project norms can apply; quantities stay incomplete until norm plus source supplied',()=>{
  let s=applySystem(project(),defaultSystem(),variant,wool);assert.equal(row(s,'siding:panels').qty,null);assert.equal(row(s,'siding:fasteners').qty,null);assert.equal(row(s,'insulation:layer1').qty,null);
  s=applySystem(project(),config({fixingsPerM2:'3',fastenerSource:''}),variant,wool);assert.equal(row(s,'siding:fasteners').qty,null);assert.match(row(s,'siding:fasteners').errors.join(' '),/источник нормы/);
});
test('bare scenario excludes insulation and membrane even if config carries stale insulation choices',()=>{
  const s=project();s.scenario='bare';const out=applySystem(s,config({includeMembrane:true,membraneOverlap:'10',membranePack:'50'}),variant,wool);
  assert.equal(out.scenarios.bare.materials.some(r=>/insulation|membrane/.test(r.kitKey)),false);assert.equal(out.scenarios.bare.works.some(r=>/insulation|membrane/.test(r.kitKey)),false);assert.equal(out.scenarios.bare.system.insulationSelection,undefined);assert.equal(out.scenarios.bare.system.includeMembrane,false);
});
test('catalogkit rejects unsupported orientations and lengths, fractional anchors and restricted insulation',()=>{
  assert.throws(()=>applySystem(project(),config({orientation:'vertical'}),{...variant,orientations:['horizontal']},wool),/направление/);
  for(const length of ['0.4','6.1'])assert.throws(()=>applySystem(project(),config({panelLength:length}),variant,wool),/Длина/);
  assert.throws(()=>applySystem(project(),config({anchorsPerBracket:'1.5'}),variant,wool),/целым/);assert.throws(()=>applySystem(project(),config(),variant,{...wool,restricted:true}),/не подтверждён/);
});
test('import roundtrip preserves system snapshots, quantities, metadata and prices; rejects malformed config',()=>{
  const s=applySystem(project(),config(),variant,wool);s.scenarios.insulated.materials.find(r=>r.kitKey==='subsystem:rails').price='90';const restored=validateImport(JSON.parse(JSON.stringify(s)));
  assert.equal(row(restored,'subsystem:rails').qty,row(s,'subsystem:rails').qty);assert.equal(row(restored,'subsystem:rails').value,row(s,'subsystem:rails').value);assert.deepEqual(restored.scenarios.insulated.system,s.scenarios.insulated.system);assert.notEqual(restored.walls[0].id,s.walls[0].id);
  const bad=JSON.parse(JSON.stringify(s));bad.scenarios.insulated.system.railPitch=0.6;assert.throws(()=>validateImport(bad),/параметры системы/);bad.scenarios.insulated.system.railPitch='0.6';bad.scenarios.insulated.materials[0].requiresNormSource='yes';assert.throws(()=>validateImport(bad),/строка/);
});
test('copyCommonRows never copies managed kit metadata and CSV carries project inputs and source docs',()=>{
  const s=applySystem(project(),config(),variant,wool);s.scenarios.insulated.materials[0].price='100';assert.equal(copyCommonRows(s).copied,0);assert.ok(s.scenarios.bare.materials.every(r=>!r.kitKey));const output=csv(s);for(const token of ['ВЫБРАННАЯ СИСТЕМА','Шаг направляющих по проекту','https://example.org/manual.pdf','Направление облицовки','Примечание технологии'])assert.ok(output.includes(token));
});
test('existing pavilion estimate keeps its exact result without applying a catalogkit',t=>{
  const path=process.env.FACADE_PRIVATE_PAVILION_FIXTURE;if(!path||!existsSync(path))return t.skip('Optional private pavilion fixture is not provided');const saved=JSON.parse(readFileSync(path,'utf8'));
  assert.equal(calculate(saved,'insulated').total,768560.26);assert.equal(calculate(saved,'bare').total,618314.01);const imported=validateImport(saved);assert.equal(calculate(imported,'insulated').total,768560.26);
});
test('layer-specific mineral wool roles prohibit inner-only products at single or outer position',()=>{
  const inner={...wool,id:'glass-inner',name:'Плита для внутреннего слоя',layerRoles:['inner']},outer={...wool,id:'stone-outer',name:'Наружная плита',layerRoles:['single','outer','inner']};
  assert.throws(()=>applySystem(project(),config({layer2:''}),variant,inner),/единственный слой/);
  assert.throws(()=>applySystem(project(),config(),variant,inner),/наружный слой/);
  const s=applySystem(project(),config({insulationId:inner.id,insulationId2:outer.id}),variant,inner,outer);
  assert.match(row(s,'insulation:layer1').name,/внутреннего слоя/);assert.match(row(s,'insulation:layer2').name,/Наружная плита/);assert.equal(s.scenarios.insulated.system.insulationSelection2.id,outer.id);
  const imported=validateImport(JSON.parse(JSON.stringify(s)));assert.deepEqual(imported.scenarios.insulated.system.insulationSelection2.layerRoles,outer.layerRoles);
  assert.throws(()=>applySystem(project(),config({insulationId2:'another-unknown-product'}),variant,wool),/не подменяется/);
});
test('explicit changes to layer and membrane pack settings take effect while retaining same-product prices',()=>{
  let s=applySystem(project(),config({includeMembrane:true,membraneOverlap:'0',membranePack:'50'}),variant,wool);
  s.scenarios.insulated.materials.find(r=>r.kitKey==='insulation:layer1').price='4000';
  s=applySystem(s,config({includeMembrane:true,membraneOverlap:'0',membranePack:'75',insulationPack1:'0.3'}),variant,wool);
  assert.equal(row(s,'insulation:layer1').pack,'0.3');assert.equal(row(s,'insulation:layer1').price,'4000');assert.equal(row(s,'membrane:material').pack,'75');
});
test('mixed-manufacturer insulation layers require explicit project compatibility evidence',()=>{
  const inner={...wool,id:'inner-a',manufacturer:'Марка А',layerRoles:['inner']},outer={...wool,id:'outer-b',manufacturer:'Марка Б',layerRoles:['outer']};
  assert.throws(()=>applySystem(project(),config(),variant,inner,outer),/совместимость/);
  const s=applySystem(project(),config({insulationCompatibilitySource:'Проектная система, узел 5: обе марки согласованы'}),variant,inner,outer);
  assert.equal(s.scenarios.insulated.system.insulationCompatibilitySource,'Проектная система, узел 5: обе марки согласованы');assert.ok(csv(s).includes('Основание совместимости разных марок'));
});

test('first window and door added after kit application get their own missing-price rows without resetting quotes',()=>{
  const s=applySystem(project(),config(),variant,wool),scenario=s.scenarios.insulated,bare=JSON.stringify(s.scenarios.bare);
  for(const key of ['materials','works'])for(const r of scenario[key]){r.price='10';if(r.mode==='norm'){r.norm='1';r.normSource='Проект';}}
  assert.equal(calculate(s).ready,true);const panel=scenario.materials.find(r=>r.kitKey==='siding:panels');panel.enabled=false;panel.source='Сохранённое КП';
  s.openings.push({id:'window',name:'Окно',type:'window',wallId:s.walls[0].id,width:'0.5',height:'1',count:'1',depth:'0.2',sides:'3'});
  assert.deepEqual(syncOpeningRows(s),{materials:2,works:2});
  assert.equal(row(s,'trim:window').netQty,0.5);assert.equal(row(s,'trim:sill').netQty,0.5);assert.equal(row(s,'work:trim:window','works').qty,0.5);assert.equal(row(s,'trim:window').price,'');assert.equal(calculate(s).ready,false);
  assert.equal(scenario.materials.find(r=>r.kitKey==='siding:panels').enabled,false);assert.equal(panel.source,'Сохранённое КП');assert.equal(panel.price,'10');assert.equal(JSON.stringify(s.scenarios.bare),bare);
  const windowRow=scenario.materials.find(r=>r.kitKey==='trim:window');windowRow.price='50';windowRow.enabled=false;
  const snapshot=JSON.stringify(scenario);assert.deepEqual(syncOpeningRows(s),{materials:0,works:0});assert.equal(JSON.stringify(scenario),snapshot);
  s.openings.push({id:'door',name:'Дверь',type:'door',wallId:s.walls[0].id,width:'0.5',height:'2',count:'1',depth:'0.1',sides:'3'});
  assert.deepEqual(syncOpeningRows(s),{materials:1,works:1});assert.equal(row(s,'trim:door').netQty,0.45);assert.equal(row(s,'work:trim:door','works').qty,0.45);assert.equal(windowRow.price,'50');assert.equal(windowRow.enabled,false);
  assert.deepEqual(syncOpeningRows(s),{materials:0,works:0});
});
test('opening synchronization leaves legacy unapplied estimates unchanged',()=>{
  const s=project();s.openings=[{type:'window',width:'0.5',height:'1',count:'1',depth:'0.2',sides:'3'}];const before=JSON.stringify(s);assert.deepEqual(syncOpeningRows(s),{materials:0,works:0});assert.equal(JSON.stringify(s),before);
});
test('open-joint coverage module may include an approved gap beyond physical panel width',()=>{
  const openProfile={...variant,id:'planken-open',name:'Открытый планкен',openJoint:true,usefulWidth:'',fullWidth:''};
  const c=config({usefulWidth:'0.2',fullWidth:'0.18'}),s=applySystem(project(),c,openProfile,wool);
  assert.equal(row(s,'siding:panels').qty,6);assert.match(row(s,'siding:panels').techNote,/согласованный открытый зазор/);assert.match(row(s,'siding:panels').techNote,/не физическая ширина/);
  assert.throws(()=>applySystem(project(),c,variant,wool),/Полная ширина/);
});
test('CSV header uses active variant and actual insulation rows instead of stale shared metadata',()=>{
  let s=applySystem(project(),config(),variant,wool);
  s.scenario='bare';s=applySystem(s,config(),{...variant,id:'second',name:'Другой профиль'},wool);
  s.scenario='insulated';s.cladding='Устаревшее общее поле';s.insulationType='Старый утеплитель';s.thickness='999';
  s.scenarios.insulated.materials.find(r=>r.kitKey==='insulation:layer1').thickness='30';
  s.scenarios.insulated.materials.find(r=>r.kitKey==='insulation:layer2').enabled=false;
  const text=csv(s);assert.ok(text.includes('"Облицовка";"Производитель · Профиль"'));assert.ok(text.includes('"Общая толщина утепления, мм";"30"'));assert.ok(!text.includes('Устаревшее общее поле'));assert.ok(!text.includes('Старый утеплитель'));
});
