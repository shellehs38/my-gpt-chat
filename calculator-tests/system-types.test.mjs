import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,calculate,validateImport,csv} from '../public/facade-calculator/engine.mjs';
import {defaultSystem,getSystemSchema,previewSystem,applySystem,syncOpeningRows} from '../public/facade-calculator/system-kit.mjs';
import {claddingSystems,selectSystem} from '../public/facade-calculator/system-catalog.mjs';
import {buildReport} from '../public/facade-calculator/report.mjs';

const choose=(id,variantId='')=>selectSystem(id,'',variantId).variant;
function project(){
  const s=initialState();s.walls[0].width='10';s.walls[0].height='3';
  s.measures={outerCorners:'0',innerCorners:'0',baseLength:'10',corniceLength:'10'};
  return s;
}
function config(v,extra={}){
  return {...defaultSystem(),systemId:v.systemId,variantId:v.id,orientation:v.orientations?.[0]||'horizontal',
    usefulWidth:v.usefulWidth||'1',fullWidth:v.fullWidth||'1',panelLength:v.suggestedLength||v.minLength||'3',
    source:'Подтверждённый проект: узел 5',railPitch:'0.6',bracketPitch:'1.5',anchorsPerBracket:'2',
    ...(v.integratedInsulation?{panelCoreThickness:'100'}:{}),...extra};
}
const calcRow=(s,key,section='materials')=>calculate(s).sections[section].rows.find(x=>x.kitKey===key);
const keys=(p,section='materials')=>p[section].map(x=>x.kitKey);

test('all 15 requested categories resolve to product-specific schemas and saved snapshots roundtrip',()=>{
  assert.equal(claddingSystems.length,15);
  for(const category of claddingSystems.filter(s=>s.id!=='metal-siding'))for(const card of category.variants){
    const v=choose(category.id,card.id),schema=getSystemSchema(v),c=config(v),p=previewSystem(project(),c,v);
    assert.equal(schema.systemId,category.id,card.id);
    assert.ok(v.mounting.length>0,card.id);assert.ok(v.sources.length>0||schema.requiresType,card.id);
    if(schema.requiresType){assert.ok(p.errors.length,card.id);assert.throws(()=>applySystem(project(),c,v));continue;}
    assert.deepEqual(p.errors,[],card.id);
    const applied=applySystem(project(),c,v),restored=validateImport(JSON.parse(JSON.stringify(applied)));
    assert.deepEqual(restored.scenarios.insulated.system,applied.scenarios.insulated.system,card.id);
    assert.equal(calcRow(restored,'siding:panels').qty,calcRow(applied,'siding:panels').qty,card.id);
  }
});

test('vinyl, acrylic, plinth, wood and WPC default to battens without universal metal brackets',()=>{
  for(const id of ['vinyl','acrylic','plinth','wood','wpc']){
    const v=choose(id),p=previewSystem(project(),config(v),v),k=keys(p);
    assert.equal(getSystemSchema(v).method,'direct-frame',id);
    assert.ok(k.includes('subsystem:rails'),id);assert.ok(k.includes('mount:base-fixings'),id);
    assert.ok(!k.includes('subsystem:brackets'),id);assert.ok(!k.includes('subsystem:anchors'),id);
  }
});

test('project panels use layout takeoff rather than a rectangle grid; direct battens stay a separate supported method',()=>{
  for(const id of ['acp','hpl','cassettes']){
    const v=choose(id),c=config(v,{subsystemNorm:'1.25',subsystemSource:'Раскладка панелей: ведомость направляющих'}),p=previewSystem(project(),c,v);
    assert.equal(getSystemSchema(v,c).grid,false,id);
    assert.ok(!p.materials.some(r=>r.mode.startsWith('support')),id);
    const applied=applySystem(project(),c,v);assert.equal(calcRow(applied,'subsystem:rails').qty,37.5,id);
    assert.equal(calcRow(applied,'subsystem:brackets').qty,null,id);
  }
  const acp=choose('acp'),direct=previewSystem(project(),config(acp,{mountingMethod:'direct-frame'}),acp);
  assert.deepEqual(direct.errors,[]);assert.ok(keys(direct).includes('mount:base-fixings'));
  assert.ok(!keys(direct).includes('subsystem:brackets'));
  assert.ok(keys(direct,'works').includes('work:fabrication'));
  const cassette=choose('cassettes');
  assert.throws(()=>applySystem(project(),config(cassette,{mountingMethod:'direct-frame'}),cassette),/способ монтажа/);
  const latonit=choose('fibercement','latonit-facade-board');assert.equal(getSystemSchema(latonit).grid,false);
});

test('Cedral Click uses its clamps, while SAVEWOOD uses documented screws and not generic clips',()=>{
  const click=choose('fibercement','cedral-click'),clickKit=previewSystem(project(),config(click,{clipsPerM2:'8',clipSource:'Монтажная карта Click'}),click);
  assert.ok(keys(clickKit).includes('mount:clips'));assert.ok(!keys(clickKit).includes('siding:fasteners'));
  const wpc=choose('wpc'),wpcKit=previewSystem(project(),config(wpc),wpc);
  assert.ok(keys(wpcKit).includes('siding:fasteners'));assert.ok(!keys(wpcKit).includes('mount:clips'));
  assert.match(wpcKit.materials.find(r=>r.kitKey==='siding:fasteners').name,/сверление/);
});

test('thermal core is included once; Favorit mechanical direct installation does not invent adhesive or external wool',()=>{
  const v=choose('thermal','favorit-clinker-thermal'),c=config(v,{mountingMethod:'direct',panelCoreThickness:'100',layer1:'50',layer2:'50',includeMembrane:true}),p=previewSystem(project(),c,v);
  assert.deepEqual(p.errors,[]);assert.ok(keys(p).includes('mount:direct-fixings'));
  for(const prefix of ['insulation:','membrane:','subsystem:','surface:adhesive'])assert.ok(!keys(p).some(k=>k.startsWith(prefix)),prefix);
  const withGlue=previewSystem(project(),{...c,includeAdhesive:true},v);assert.ok(keys(withGlue).includes('surface:adhesive'));
  const applied=applySystem(project(),c,v);assert.equal(applied.thickness,'100');assert.match(csv(applied),/Утепляющий сердечник включён в панель/);
  assert.ok(csv(applied).includes('"Общая толщина утепления, мм";"100"'));
  const bare=project();bare.scenario='bare';assert.throws(()=>applySystem(bare,c,v),/Переключите вариант/);
});

test('Polifasad includes adhesive plus anchors and one elastic joint operation, primer and paint',()=>{
  const v=choose('thermal','polifasad-fibrothermal'),c=config(v),p=previewSystem(project(),c,v);
  assert.equal(getSystemSchema(v).method,'bonded');
  for(const key of ['mount:direct-fixings','surface:adhesive','surface:primer','surface:sealant','surface:coating'])assert.ok(keys(p).includes(key),key);
  assert.ok(!keys(p).includes('surface:grout'));assert.ok(!keys(p).includes('subsystem:rails'));
  assert.equal(p.works.filter(r=>r.kitKey==='work:joint-sealant').length,1);
  assert.match(p.materials.find(r=>r.kitKey==='surface:sealant').name,/Эластичная/);
});

test('sandwich adds its structural frame, joints and core once, without NFS grid or duplicate sealant',()=>{
  const v=choose('sandwich'),c=config(v,{subsystemNorm:'0.7',subsystemSource:'Несущий каркас, спецификация КМ',sealantNorm:'0.05',sealantSource:'Карта стыков',panelCoreThickness:'120'}),p=previewSystem(project(),c,v);
  assert.deepEqual(p.errors,[]);assert.ok(keys(p).includes('subsystem:structure'));assert.ok(keys(p).includes('sandwich:joint-strips'));
  assert.ok(!p.materials.some(r=>r.mode.startsWith('support')||r.kitKey.startsWith('insulation:')||r.kitKey.startsWith('membrane:')));
  assert.equal(p.materials.filter(r=>/sealant/.test(r.kitKey)).length,1);
  const applied=applySystem(project(),c,v);assert.equal(calcRow(applied,'subsystem:structure').qty,21);
  const report=buildReport(applied);assert.match(report,/Утепляющий сердечник/);assert.ok(!report.includes('Система:</b> Вентилируемый фасад на металлической подсистеме'));
});

test('wall click-seam keeps nailing-flange screws and documented base choices, not assumed standing-seam clips',()=>{
  const v=choose('seam'),c=config(v,{baseType:'battens',substrateNorm:'2',substrateSource:'Раскладка обрешётки',fixingsPerM2:'5',fastenerSource:'Схема гвоздевой полки'}),p=previewSystem(project(),c,v);
  assert.deepEqual(p.errors,[]);assert.deepEqual(getSystemSchema(v).baseOptions.map(x=>x.id),['battens']);
  assert.ok(keys(p).includes('seam:base'));assert.ok(keys(p).includes('siding:fasteners'));assert.ok(!keys(p).includes('mount:clips'));
  assert.throws(()=>applySystem(project(),{...c,baseType:'solid'},v),/тип основания не подтверждён/);
  assert.ok(!csv(applySystem(project(),c,v)).includes('сетка подсистемы по целым прямоугольным стенам'));
});

test('wood coating multiplies exact area, per-coat consumption and layers without affecting siding labor',()=>{
  const v=choose('wood'),c=config(v,{coatingNorm:'0.12',coatingLayers:'2',coatingSource:'Паспорт выбранного масла',reserve:'10'}),s=applySystem(project(),c,v);
  assert.equal(calcRow(s,'surface:coating').netQty,7.2);assert.equal(calcRow(s,'work:coating','works').qty,60);
  assert.equal(calcRow(s,'work:siding','works').qty,30);assert.match(csv(s),/Число слоёв \/ множитель расхода/);
  const zero=applySystem(project(),{...c,coatingNorm:'0'},v);assert.equal(calcRow(zero,'surface:coating').qty,0);
  const off=previewSystem(project(),{...c,includeCoating:false,coatingSource:'Заводская отделка по паспорту'},v);
  assert.ok(!keys(off).includes('surface:coating'));assert.ok(!keys(off,'works').includes('work:coating'));
  assert.ok(off.notes.some(n=>n.includes('Заводская отделка')));assert.ok(getSystemSchema(v,{...c,includeCoating:false}).fieldKeys.includes('coatingSource'));
  assert.match(buildReport(applySystem(project(),{...c,includeCoating:false,coatingSource:'Заводская отделка по паспорту'},v)),/Не добавлено:.*Заводская отделка/);
  for(const coatingLayers of ['0','1.5','-1'])assert.throws(()=>applySystem(project(),{...c,coatingLayers},v),/слоёв|неотрицательным/);
});

test('technology changes remove obsolete kit rows and quotes; same product reapply preserves user quotes and unmanaged rows',()=>{
  const v=choose('thermal','favorit-clinker-thermal'),c=config(v,{mountingMethod:'direct'});let s=applySystem(project(),c,v);
  const panel=s.scenarios.insulated.materials.find(r=>r.kitKey==='siding:panels');panel.price='100';panel.source='КП поставщика';
  s=applySystem(s,c,v);assert.equal(calcRow(s,'siding:panels').price,'100');
  s=applySystem(s,{...c,mountingMethod:'bracket-frame'},v);assert.equal(calcRow(s,'siding:panels').price,'');
  assert.ok(!s.scenarios.insulated.materials.some(r=>r.kitKey==='mount:direct-fixings'));
  const before=JSON.stringify(s);previewSystem(s,config(choose('wood')),choose('wood'));assert.equal(JSON.stringify(s),before);
});

test('malformed persisted technology settings are rejected before import, including booleans, methods and coating factors',()=>{
  const v=choose('wood'),s=applySystem(project(),config(v),v);
  for(const mutate of [
    p=>p.scenarios.insulated.system.includeCoating='yes',
    p=>p.scenarios.insulated.system.coatingLayers=2,
    p=>p.scenarios.insulated.system.mountingMethod='universal-glue',
    p=>p.scenarios.insulated.system.variant.grid='yes',
    p=>p.scenarios.insulated.system.variant.frameMethods=['universal-glue'],
    p=>p.scenarios.insulated.materials[0].normFactor=2,
  ]){const bad=JSON.parse(JSON.stringify(s));mutate(bad);assert.throws(()=>validateImport(bad));}
});

test('unknown stone-lock and unconfirmed custom thermal do not acquire an invented mounting scheme',()=>{
  for(const v of [choose('stone-lock'),choose('thermal','custom-fibrothermal')]){
    const schema=getSystemSchema(v),s=project(),before=JSON.stringify(s);assert.equal(schema.requiresType,true);assert.deepEqual(schema.methodOptions,[]);
    const preview=previewSystem(s,config(v),v);assert.deepEqual(preview.materials,[]);assert.deepEqual(preview.works,[]);
    assert.throws(()=>applySystem(s,config(v),v),/конкретную технологию/);assert.equal(JSON.stringify(s),before);
  }
});

test('new product kits synchronize opening rows after application without disturbing existing quotes',()=>{
  const v=choose('wpc'),s=applySystem(project(),config(v),v),panel=s.scenarios.insulated.materials.find(r=>r.kitKey==='siding:panels');panel.price='500';
  s.openings.push({id:'window',name:'Окно',type:'window',wallId:s.walls[0].id,width:'1',height:'1',count:'1',depth:'0.2',sides:'3'});
  assert.deepEqual(syncOpeningRows(s),{materials:2,works:2});assert.equal(panel.price,'500');assert.deepEqual(syncOpeningRows(s),{materials:0,works:0});
});


test('hidden fields from another technology never block or pollute the newly applied kit',()=>{
  const hidden={insulationPack:'bad',insulationPack1:'bad',insulationPack2:'bad',insulationReserve:'bad',insulationFixingsPerM2:'bad',membranePack:'bad',membraneOverlap:'bad',layer1:'bad',layer2:'bad',includeMembrane:true};
  for(const [id,variantId,extra] of [['seam','',{baseType:'battens'}],['thermal','favorit-clinker-thermal',{mountingMethod:'direct'}]]){
    const v=choose(id,variantId),s=applySystem(project(),config(v,{...hidden,...extra}),v);
    for(const key of Object.keys(hidden).filter(x=>x!=='includeMembrane'))assert.equal(s.scenarios.insulated.system[key],'',key);
    assert.equal(s.scenarios.insulated.system.includeMembrane,false);
  }
  const clip=choose('fibercement','cedral-click'),s=applySystem(project(),config(clip,{fixingsPerM2:'bad',fastenerSource:'obsolete'}),clip);
  assert.equal(s.scenarios.insulated.system.fixingsPerM2,'');assert.equal(s.scenarios.insulated.system.fastenerSource,'');
});

test('an integrated panel requires an explicit factory core thickness and resets quotes when it changes',()=>{
  const v=choose('sandwich'),c=config(v,{panelCoreThickness:''});
  assert.throws(()=>applySystem(project(),c,v),/Укажите толщину/);
  assert.throws(()=>applySystem(project(),{...c,panelCoreThickness:'110'},v),/перечне/);
  let s=applySystem(project(),{...c,panelCoreThickness:'100'},v);s.scenarios.insulated.materials.find(r=>r.kitKey==='siding:panels').price='500';
  s=applySystem(s,{...c,panelCoreThickness:'150'},v);assert.equal(calcRow(s,'siding:panels').price,'');
  assert.equal(s.scenarios.insulated.system.panelCoreThickness,'150');
  const bad=JSON.parse(JSON.stringify(s));bad.scenarios.insulated.system.variant.coreThicknessOptions=['no'];assert.throws(()=>validateImport(bad),/толщин/);
});
