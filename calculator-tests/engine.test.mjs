import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {initialState,number,geometry,measurements,calculate,csv,validateImport,copyCommonRows,createRow,WARNING,MODE_LABELS,MODE_UNITS} from '../public/facade-calculator/engine.mjs';
const onlyRow=()=>{const s=initialState();s.areaMode='direct';s.directArea='100';for(const key of ['materials','works'])s.scenarios.insulated[key].forEach(r=>r.enabled=false);const r=s.scenarios.insulated.materials[0];r.enabled=true;return {s,r};};
test('decimal input: commas and grouping, unknown is never zero',()=>{
  assert.equal(number('1 234,56'),1234.56);assert.equal(number('0'),0);
  for(const v of ['',null,undefined,'-1','NaN','Infinity','1e3','1,2,3','123abc'])assert.equal(number(v),null);
});
test('fresh project contains no assumed prices, norms, dimensions, or total',()=>{
  const s=initialState(),c=calculate(s);assert.equal(c.total,null);assert.equal(c.ready,false);assert.equal(c.geo.area,null);
  assert.equal(s.version,4);assert.equal(s.areaMode,'walls');assert.equal(s.walls.length,1);assert.equal(s.walls[0].shape,'rect');assert.equal(s.walls[0].width,'');assert.equal(s.walls[0].height,'');assert.equal(s.buildingLength,'');assert.equal(s.buildingWidth,'');assert.equal(s.buildingHeight,'');
  assert.equal(s.thickness,'');for(const scenario of Object.values(s.scenarios))for(const rows of Object.values(scenario))for(const r of rows){assert.equal(r.price,'');assert.equal(r.norm,'');assert.equal(r.quantity,'');}
  assert.equal(s.scenarios.insulated.materials[0].mode,'area');assert.equal(s.scenarios.insulated.materials.find(r=>r.name.startsWith('Утеплитель')).mode,'area');
});
test('direct net area is used without adding a stock coefficient',()=>{
  const s=initialState();s.areaMode='direct';s.directArea='163,25';assert.equal(geometry(s).area,163.25);s.directArea='0';assert.equal(geometry(s).area,null);
});
test('rectangles, triangular gable and repeated openings calculate exactly',()=>{
  const s=initialState();s.areaMode='walls';s.walls=[{name:'Стена',width:'10',height:'3',shape:'rect'},{name:'Фронтон',width:'10',height:'2',shape:'triangle'}];s.openings=[{name:'Окна',width:'1,5',height:'1,2',count:'2'}];assert.equal(geometry(s).area,36.4);assert.equal(geometry(s).gross,40);assert.equal(geometry(s).openings,3.6);
});
test('incomplete geometry, excessive openings, noninteger counts and empty walls stay unknown',()=>{
  const s=initialState();s.areaMode='walls';assert.equal(geometry(s).area,null);s.walls=[];assert.equal(geometry(s).area,null);
  s.walls=[{name:'Стена',width:'2',height:'2',shape:'rect'}];s.openings=[{name:'Дверь',width:'2',height:'2',count:'1'}];assert.equal(geometry(s).area,null);s.openings[0].count='0,5';assert.match(geometry(s).errors[0],/целое/);
});
test('consumption requires explicit input and multiplies exact net area',()=>{
  const {s,r}=onlyRow();r.mode='norm';r.price='500';assert.equal(calculate(s).total,null);r.norm='1,1';assert.equal(calculate(s).total,55000);assert.equal(calculate(s).ready,true);
});
test('unknown and invalid prices do not get counted as zero; explicit zero does',()=>{
  const {s,r}=onlyRow();r.mode='manual';r.quantity='10';assert.equal(calculate(s).total,null);r.price='-5';assert.equal(calculate(s).total,null);r.price='0';assert.equal(calculate(s).total,0);assert.equal(calculate(s).ready,true);
});
test('manual, area and consumption amounts produce separate work and material totals',()=>{
  const {s,r}=onlyRow();r.mode='norm';r.norm='1.1';r.price='800';const work=s.scenarios.insulated.works[0];work.enabled=true;work.price='350';const c=calculate(s);assert.equal(c.sections.materials.subtotal,88000);assert.equal(c.sections.works.subtotal,49000);assert.equal(c.pricing.base,35000);assert.equal(c.pricing.allowance,14000);assert.equal(c.total,137000);assert.equal(c.ready,true);
});
test('incomplete result exposes only known subtotal and stays incomplete',()=>{
  const {s,r}=onlyRow();r.mode='norm';r.norm='1';r.price='100';const b=s.scenarios.insulated.materials[1];b.enabled=true;const c=calculate(s);assert.equal(c.total,10000);assert.equal(c.ready,false);assert.equal(c.missing.length,1);assert.equal(c.complete,1);b.enabled=false;assert.equal(calculate(s).ready,true);
});
test('scenario switching preserves independent prices and insulation positions',()=>{
  const s=initialState();s.scenarios.insulated.materials[0].price='800';s.scenarios.bare.materials[0].price='900';s.scenario='bare';assert.equal(s.scenarios[s.scenario].materials[0].price,'900');assert.equal(s.scenarios.bare.materials.some(x=>x.name.includes('Утеплитель')),false);s.scenario='insulated';assert.equal(s.scenarios[s.scenario].materials[0].price,'800');
});
test('both scenarios can be compared without changing the active variant',()=>{
  const s=initialState();s.areaMode='direct';s.directArea='10';for(const scenario of Object.values(s.scenarios))for(const key of ['materials','works'])scenario[key].forEach(r=>r.enabled=false);
  for(const [key,price] of [['insulated','500'],['bare','300']]){const r=s.scenarios[key].materials[0];r.enabled=true;r.price=price;}
  s.scenario='insulated';assert.equal(calculate(s,'insulated').total,5000);assert.equal(calculate(s,'bare').total,3000);assert.equal(s.scenario,'insulated');
});
test('line rounding and total rounding use the displayed line values',()=>{
  const {s,r}=onlyRow();r.mode='manual';r.quantity='3';r.price='0.335';assert.equal(calculate(s).total,1.01);
});
test('CSV marks incomplete, keeps unknown blank, includes engineering check, escapes formulas',()=>{
  const s=initialState();s.project='=CMD()';const out=csv(s);assert.ok(out.startsWith('\ufeff'));assert.ok(out.includes('НЕПОЛНЫЙ РАСЧЁТ'));assert.ok(out.includes("'=CMD()"));assert.ok(out.includes(WARNING));assert.ok(!out.includes('NaN'));assert.ok(!out.includes('undefined'));
  const {s:filled,r}=onlyRow();r.mode='manual';r.quantity='1,5';r.price='1';assert.ok(csv(filled).includes('"1,5"'));
});
test('JSON project roundtrip preserves all data; rejects malformed structure and duplicated IDs',()=>{
  const s=initialState();s.project='Дом';s.directArea='150';s.scenarios.bare.works[0].price='300';const loaded=validateImport(JSON.parse(JSON.stringify(s)));assert.equal(loaded.project,'Дом');assert.equal(loaded.scenarios.bare.works[0].price,'300');assert.notEqual(loaded.walls[0].id,s.walls[0].id);assert.throws(()=>validateImport({version:1}));const broken=initialState();broken.scenarios.insulated.materials[0].mode='bad';assert.throws(()=>validateImport(broken));
});
test('HTML has private/local messaging, engineering warning, exports and no remote assets',()=>{
  const html=readFileSync(new URL('../public/facade-calculator/index.html',import.meta.url),'utf8');assert.ok(html.includes('Рабочий инструмент'));assert.ok(html.includes('СП/ГОСТ'));assert.ok(html.includes('несущие расчёты'));assert.ok(html.includes('только в этом браузере'));assert.ok(html.includes('download-csv'));assert.ok(!/(?:src|href)="https?:/i.test(html));
  for(const file of ['app.mjs','engine.mjs','report.mjs','styles.css','brand/logo-sl-approved-light.png'])assert.ok(existsSync(new URL('../public/facade-calculator/'+file,import.meta.url)));
  const app=readFileSync(new URL('../public/facade-calculator/app.mjs',import.meta.url),'utf8');for(const id of [...app.matchAll(/\$\('#([\w-]+)'\)/g)].map(x=>x[1]))assert.ok(html.includes(`id="${id}"`),`Missing DOM target ${id}`);
});


test('material reserve and exact package rounding do not increase labor area',()=>{
  const {s,r}=onlyRow();s.directArea='101';r.price='500';r.reserve='7';r.pack='3.6';
  const c=calculate(s),m=c.sections.materials.rows[0];assert.equal(m.netQty,101);assert.equal(m.packs,31);assert.equal(m.qty,111.6);assert.equal(c.total,55800);
  const w=s.scenarios.insulated.works[0];w.enabled=true;w.price='100';assert.equal(calculate(s).sections.works.rows[0].qty,101);assert.equal(calculate(s).sections.works.subtotal,14140);
  r.reserve='';s.directArea='10.8';assert.equal(calculate(s).sections.materials.rows[0].packs,3);s.directArea='10.800000000001';assert.equal(calculate(s).sections.materials.rows[0].packs,4);
});
test('manual material quantity retains original input; invalid package cannot produce a total',()=>{
  const {s,r}=onlyRow();r.mode='manual';r.quantity='10';r.price='20';r.reserve='10';r.pack='3';assert.equal(calculate(s).total,240);assert.equal(r.quantity,'10');
  r.pack='0';assert.equal(calculate(s).total,null);assert.equal(calculate(s).ready,false);r.pack='';r.reserve='-5';assert.equal(calculate(s).total,null);
});
test('base work gets 40% once; included rates and external purchases do not',()=>{
  const {s,r}=onlyRow();r.enabled=false;const w=s.scenarios.insulated.works[0];w.enabled=true;w.price='100';
  let c=calculate(s);assert.equal(c.total,14000);assert.equal(c.pricing.base,10000);assert.equal(c.pricing.allowance,4000);
  w.rateKind='included';w.price='140';c=calculate(s);assert.equal(c.total,14000);assert.equal(c.pricing.base,10000);assert.equal(c.pricing.allowance,4000);
  w.rateKind='external';w.price='100';c=calculate(s);assert.equal(c.total,10000);assert.equal(c.pricing.allowance,null);assert.equal(c.pricing.external,10000);
  w.rateKind='unknown';assert.equal(calculate(s).total,null);assert.equal(calculate(s).ready,false);
});
test('decimal money rounds exact products to cents, then sums line cents',()=>{
  const {s,r}=onlyRow();r.mode='manual';r.quantity='3';r.price='3.025';assert.equal(calculate(s).total,9.08);
  r.quantity='1';r.price='1.005';assert.equal(calculate(s).total,1.01);r.price='10.075';assert.equal(calculate(s).total,10.08);
  const b=s.scenarios.insulated.materials[1];b.enabled=true;b.quantity='1';b.price='1.005';assert.equal(calculate(s).total,11.09);
});
test('prices without source and date stay preliminary even with all amounts entered',()=>{
  const {s,r}=onlyRow();r.price='10';let c=calculate(s);assert.equal(c.ready,true);assert.equal(c.confirmed,false);assert.equal(c.sourcesMissing.length,1);
  r.source='КП поставщика';r.priceDate='2026-10-20';c=calculate(s);assert.equal(c.confirmed,true);r.priceDate='';assert.equal(calculate(s).confirmed,false);
});
test('legacy imports preserve rates and require classification before applying any uplift',()=>{
  const s=initialState();s.version=1;const w=s.scenarios.insulated.works[0];w.price='140';
  for(const variant of Object.values(s.scenarios))for(const rows of Object.values(variant))for(const r of rows)for(const k of ['source','priceDate','reserve','pack','rateKind'])delete r[k];
  const restored=validateImport(s);assert.equal(restored.version,4);assert.equal(restored.scenarios.insulated.works[0].price,'140');assert.equal(restored.scenarios.insulated.works[1].rateKind,'base');assert.equal(restored.scenarios.insulated.works[0].rateKind,'unknown');assert.equal(calculate(restored).ready,false);
  assert.equal(createRow().rateKind,'unknown');
});
test('copy only common empty rows; protect existing prices and insulation exclusions',()=>{
  const s=initialState();const src=s.scenarios.insulated.materials[0];src.price='500';src.reserve='8';src.source='КП';src.priceDate='2026-10-20';s.scenarios.insulated.works[0].price='200';s.scenarios.bare.works[0].price='999';
  const id=s.scenarios.bare.materials[0].id;const result=copyCommonRows(s);assert.equal(result.copied,1);assert.equal(result.skipped,1);assert.equal(s.scenarios.bare.materials[0].price,'500');assert.equal(s.scenarios.bare.materials[0].id,id);assert.equal(s.scenarios.bare.materials[0].reserve,'8');assert.equal(s.scenarios.bare.works[0].price,'999');assert.equal(s.scenarios.bare.materials.length,8);
  s.scenarios.bare.materials[0].price='600';assert.equal(src.price,'500');
});

test('aggregate money overflow and invalid source date remain visibly unconfirmed',()=>{
  const {s,r}=onlyRow();r.mode='manual';r.quantity='10000000000';r.price='5000';r.source='КП';r.priceDate='2026-02-30';assert.equal(calculate(s).confirmed,false);
  const b=s.scenarios.insulated.materials[1];b.enabled=true;b.quantity='10000000000';b.price='5000';const c=calculate(s);assert.equal(c.total,null);assert.equal(c.ready,false);assert.equal(c.overflow,true);assert.equal(c.sections.materials.subtotal,null);
});

test('trapezoids use two explicit bases and linked openings cannot exhaust another wall',()=>{
  const s=initialState();s.areaMode='walls';
  s.walls=[{id:'small',name:'Малая стена',shape:'trapezoid',width:'4',topWidth:'2',height:'3'},{id:'large',name:'Большая стена',shape:'rect',width:'10',height:'5'}];
  s.openings=[{id:'a',name:'Окно',wallId:'small',width:'3',height:'2',count:'2'}];
  assert.equal(geometry(s).area,null);assert.match(geometry(s).errors.join(' '),/Малая стена.*больше площади этой стены/);
  s.openings[0].count='1';assert.equal(geometry(s).gross,59);assert.equal(geometry(s).area,53);
  s.openings[0].wallId='';assert.equal(geometry(s).area,53);
  s.walls[0].topWidth='';assert.equal(geometry(s).area,null);assert.match(geometry(s).errors.join(' '),/верхнюю ширину/);
});
test('linked opening bounds reject an impossible wide opening even if its area fits',()=>{
  const s=initialState();s.areaMode='walls';s.walls=[{id:'wall',name:'Стена',shape:'rect',width:'2',height:'5'}];
  s.openings=[{name:'Широкий проём',wallId:'wall',width:'10',height:'0.1',count:'1'}];
  assert.equal(geometry(s).area,null);assert.match(geometry(s).errors.join(' '),/габариты/);
  s.openings[0].width='1';s.openings[0].height='6';assert.equal(geometry(s).area,null);
  s.openings[0].wallId='missing';assert.match(geometry(s).errors.join(' '),/существующую стену/);
  s.openings[0].wallId='wall';s.openings[0].width='2';s.openings[0].height='1';assert.equal(geometry(s).area,8);
});
test('reveal bases and window sills use explicit types, depths, sides and counts without deducting direct area',()=>{
  const s=initialState();s.areaMode='direct';s.directArea='100';
  s.openings=[{name:'Окна',type:'window',width:'1.5',height:'1.2',count:'2',depth:'0.2',sides:'3'},{name:'Дверь',type:'door',width:'1',height:'2',count:'1',depth:'0.3',sides:'4'}];
  const m=measurements(s);assert.equal(m.revealLength,13.8);assert.equal(m.revealArea,3.36);assert.equal(m.sillLength,3);assert.equal(m.openingArea,5.6);assert.equal(geometry(s).area,100);
  s.openings[0].depth='';let missing=measurements(s);assert.equal(missing.revealArea,null);assert.equal(missing.revealLength,13.8);assert.equal(missing.sillLength,3);assert.match(missing.errors.revealArea.join(' '),/глубину/);
  s.openings[0].depth='0';s.openings[0].sides='';missing=measurements(s);assert.equal(missing.revealLength,null);assert.equal(missing.revealArea,null);assert.equal(missing.sillLength,3);
  s.openings=[{name:'Дверь',type:'door',width:'1',height:'2',count:'1',depth:'0.2',sides:'3'}];assert.equal(measurements(s).sillLength,0);
  delete s.openings[0].type;assert.equal(measurements(s).sillLength,null);
});
test('blank optional measures stay unknown and explicit zero is usable independently',()=>{
  const {s,r}=onlyRow();r.mode='outerCorners';r.unit='м.п.';r.price='100';
  assert.equal(calculate(s).total,null);assert.equal(measurements(s).outerCorners,null);assert.equal(measurements(s).revealArea,null);
  s.measures.outerCorners='0';assert.equal(calculate(s).total,0);assert.equal(calculate(s).ready,true);
  s.measures.outerCorners='12.4';assert.equal(calculate(s).total,1240);
  assert.equal(measurements(s).baseLength,null);r.unit='м²';assert.equal(calculate(s).total,null);assert.match(calculate(s).missing[0].fields.join(' '),/м.п./);
  r.mode='manual';r.quantity='2';r.price='10';assert.equal(calculate(s).total,20);
});
test('material procurement subtracts allocated stock and orders before exact package rounding',()=>{
  const {s,r}=onlyRow();r.mode='manual';r.quantity='26';r.price='10';r.stock='1';r.pack='25';
  let row=calculate(s).sections.materials.rows[0];assert.equal(row.netQty,26);assert.equal(row.demandQty,26);assert.equal(row.coveredQty,1);assert.equal(row.neededQty,25);assert.equal(row.packs,1);assert.equal(row.qty,25);assert.equal(row.value,250);
  r.quantity='80';r.stock='20';r.pack='';row=calculate(s).sections.materials.rows[0];assert.equal(row.neededQty,60);assert.equal(row.qty,60);
  r.ordered='15';r.pack='25';row=calculate(s).sections.materials.rows[0];assert.equal(row.coveredQty,35);assert.equal(row.neededQty,45);assert.equal(row.qty,50);assert.equal(row.packs,2);
  r.stock='100';row=calculate(s).sections.materials.rows[0];assert.equal(row.coveredQty,80);assert.equal(row.neededQty,0);assert.equal(row.qty,0);assert.equal(row.packs,0);assert.equal(row.value,0);
  r.stock='-1';assert.equal(calculate(s).total,null);r.stock='';r.ordered='bad';assert.equal(calculate(s).total,null);
});
test('stock changes the procurement cost independently of material cost for the full requirement',()=>{
  const {s,r}=onlyRow();r.mode='manual';r.quantity='80';r.price='10';r.reserve='10';r.stock='20';r.ordered='8';r.pack='25';
  let c=calculate(s),row=c.sections.materials.rows[0];assert.equal(row.netQty,80);assert.equal(row.demandQty,88);assert.equal(row.qty,75);assert.equal(row.pricedQty,75);assert.equal(c.total,750);assert.equal(row.purchaseValue,750);
  r.costBasis='required';c=calculate(s);row=c.sections.materials.rows[0];assert.equal(row.pricedQty,88);assert.equal(c.total,880);assert.equal(row.purchaseValue,750);assert.equal(row.qty,75);
  r.stock='100';c=calculate(s);row=c.sections.materials.rows[0];assert.equal(c.total,880);assert.equal(row.purchaseValue,0);assert.equal(row.pricedQty,88);
  r.costBasis='unknown';assert.equal(calculate(s).total,null);assert.throws(()=>validateImport(s));
});
test('panels use effective dimensions and reserve, whole pieces, stock and packs in that order',()=>{
  const {s,r}=onlyRow();s.directArea='10';r.mode='panels';r.unit='шт.';r.coverWidth='1.2';r.coverHeight='2.5';r.reserve='10';r.stock='1';r.pack='2';r.price='100';r.norm='999';
  let row=calculate(s).sections.materials.rows[0];assert.ok(Math.abs(row.netQty-10/3)<1e-14);assert.equal(row.demandQty,4);assert.equal(row.neededQty,3);assert.equal(row.qty,4);assert.equal(row.packs,2);assert.equal(row.pricedQty,4);
  r.pack='';row=calculate(s).sections.materials.rows[0];assert.equal(row.qty,3);r.costBasis='required';assert.equal(calculate(s).sections.materials.rows[0].pricedQty,4);
  s.directArea='10.8';r.coverWidth='1.2';r.coverHeight='3';r.reserve='';r.stock='';assert.equal(calculate(s).sections.materials.rows[0].demandQty,3);
  s.directArea='10.800000000001';assert.equal(calculate(s).sections.materials.rows[0].demandQty,4);
  r.coverHeight='';assert.equal(calculate(s).total,null);r.coverHeight='3';r.unit='м²';assert.equal(calculate(s).total,null);
});
test('piece procurement is whole, while labor does not consume stock or get reserve and packaging',()=>{
  const {s,r}=onlyRow();r.mode='manual';r.unit='шт.';r.quantity='2.1';r.price='10';assert.equal(calculate(s).sections.materials.rows[0].qty,3);
  r.stock='0.5';assert.equal(calculate(s).total,null);r.stock='';r.pack='1.5';assert.equal(calculate(s).total,null);
  r.enabled=false;const w=s.scenarios.insulated.works[0];w.enabled=true;w.price='100';w.reserve='bad';w.pack='bad';w.stock='bad';w.ordered='bad';w.costBasis='bad';
  assert.equal(calculate(s).sections.works.rows[0].qty,100);assert.equal(calculate(s).total,14000);
});
test('insulation volume is calculated per explicitly entered layer without increasing installation area',()=>{
  const {s,r}=onlyRow();s.directArea='80';r.mode='insulationVolume';r.unit='м³';r.thickness='50';r.price='1000';r.reserve='10';
  const layer=createRow('Второй слой','м³','insulationVolume','external');layer.thickness='100';layer.price='2000';s.scenarios.insulated.materials.push(layer);
  const w=s.scenarios.insulated.works[0];w.enabled=true;w.price='100';
  const c=calculate(s);assert.equal(c.sections.materials.rows[0].netQty,4);assert.equal(c.sections.materials.rows[0].qty,4.4);assert.equal(c.sections.materials.rows.at(-1).qty,8);assert.equal(c.sections.materials.subtotal,20400);assert.equal(c.sections.works.rows[0].qty,80);
  r.thickness='';assert.equal(calculate(s).sections.materials.rows[0].value,null);r.thickness='0';assert.equal(calculate(s).sections.materials.rows[0].value,null);
  assert.equal(MODE_UNITS.insulationVolume,'м³');assert.ok(MODE_LABELS.panels);
});
test('structured tax keeps unknown totals separate and calculates included and added VAT exactly',()=>{
  const {s,r}=onlyRow();r.mode='manual';r.quantity='1';r.price='100';
  let c=calculate(s);assert.equal(c.ready,true);assert.equal(c.total,100);assert.equal(c.tax.ready,false);assert.equal(c.tax.grandTotal,null);
  s.taxMode='none';c=calculate(s);assert.equal(c.tax.ready,true);assert.equal(c.tax.amount,0);assert.equal(c.tax.grandTotal,100);
  s.taxMode='included';s.taxRate='20';c=calculate(s);assert.equal(c.tax.amount,16.67);assert.equal(c.tax.grandTotal,100);assert.equal(c.total,100);
  s.taxMode='onTop';c=calculate(s);assert.equal(c.tax.amount,20);assert.equal(c.tax.grandTotal,120);assert.equal(c.total,100);
  r.price='1.025';s.taxRate='50';c=calculate(s);assert.equal(c.total,1.03);assert.equal(c.tax.amount,0.52);assert.equal(c.tax.grandTotal,1.55);
  s.taxRate='';assert.equal(calculate(s).tax.grandTotal,null);s.taxRate='-20';assert.equal(calculate(s).tax.ready,false);
  s.taxMode='bad';assert.equal(calculate(s).tax.grandTotal,null);assert.throws(()=>validateImport(s));
});
test('tax handles explicit zero and money overflow without a false final amount',()=>{
  const {s,r}=onlyRow();r.mode='manual';r.quantity='1';r.price='0';s.taxMode='onTop';s.taxRate='20';let c=calculate(s);assert.equal(c.tax.ready,true);assert.equal(c.tax.grandTotal,0);
  r.price='100';s.taxRate='0';for(const mode of ['included','onTop']) {s.taxMode=mode;c=calculate(s);assert.equal(c.tax.mode,mode);assert.equal(c.tax.rate,0);assert.equal(c.tax.ready,true);assert.equal(c.tax.amount,0);assert.equal(c.tax.grandTotal,100);assert.equal(c.total,100);}
  r.quantity='10000000000';r.price='5000';s.taxRate='100';c=calculate(s);assert.equal(c.total,50000000000000);assert.equal(c.tax.ready,false);assert.equal(c.tax.grandTotal,null);assert.match(c.tax.errors.join(' '),/большой итог/);
});
test('v2 migration preserves old inputs and classifications, adds no physical guesses and remaps wall links',()=>{
  const s=initialState();s.version=2;s.project='Дом';s.walls=s.walls.slice(0,1);s.walls[0].width='4';s.walls[0].height='3';s.openings=[{id:'opening',name:'Проём',width:'1',height:'2',count:'1',wallId:s.walls[0].id}];
  const r=s.scenarios.insulated.materials[0];r.price='500.12';r.rateKind='external';r.quantity='9';r.reserve='7';r.pack='3.6';
  for(const k of ['taxMode','taxRate','measures','insulationType','subsystem','bracketOutreach','projectRef'])delete s[k];
  for(const variant of Object.values(s.scenarios))for(const list of Object.values(variant))for(const row of list)for(const k of ['stock','ordered','thickness','coverWidth','coverHeight','normSource','costBasis'])delete row[k];
  const restored=validateImport(s),row=restored.scenarios.insulated.materials[0];assert.equal(restored.version,4);assert.equal(row.price,'500.12');assert.equal(row.rateKind,'external');assert.equal(row.quantity,'9');assert.equal(row.reserve,'7');assert.equal(row.pack,'3.6');assert.equal(row.costBasis,'purchase');assert.equal(row.stock,'');assert.equal(row.coverWidth,'');assert.equal(restored.openings[0].depth,'');assert.equal(restored.openings[0].sides,'');assert.equal(restored.openings[0].type,'');assert.equal(restored.openings[0].wallId,restored.walls[0].id);assert.notEqual(restored.walls[0].id,s.walls[0].id);assert.equal(restored.measures.outerCorners,'');assert.equal(restored.taxMode,'unknown');
});
test('import rejects malformed records and enums and regenerates duplicate unambiguous IDs',()=>{
  for(const replacement of [null,[],42]) {const s=initialState();s.walls=[replacement];assert.throws(()=>validateImport(s));}
  for(const replacement of [null,[],42]) {const s=initialState();s.scenarios.insulated.materials=[replacement];assert.throws(()=>validateImport(s));}
  for(const [key,value] of [['type','skylight'],['sides','2'],['depth',3]]) {const s=initialState();s.openings=[{id:'o',name:'Проём',width:'1',height:'1',count:'1',[key]:value}];assert.throws(()=>validateImport(s));}
  let s=initialState();s.scenarios.insulated.materials[1].id=s.scenarios.insulated.materials[0].id;let restored=validateImport(s);assert.notEqual(restored.scenarios.insulated.materials[0].id,restored.scenarios.insulated.materials[1].id);
  s=initialState();s.walls.push({...s.walls[0]});restored=validateImport(s);assert.notEqual(restored.walls[0].id,restored.walls[1].id);
  s.openings=[{id:'o',name:'Проём',width:'1',height:'1',count:'1',wallId:s.walls[0].id}];assert.throws(()=>validateImport(s),/однозначно/);
  s=initialState();s.walls[0].shape='polygon';assert.throws(()=>validateImport(s));s=initialState();s.measures=[];assert.throws(()=>validateImport(s));
  s=initialState();s.scenarios.bare={materials:[],works:[]};s.openings=Array.from({length:201},()=>({}));assert.throws(()=>validateImport(s));
});
test('copy includes new user fields only into empty common rows and excludes insulation volumes',()=>{
  const s=initialState(),source=s.scenarios.insulated.materials[0],target=s.scenarios.bare.materials[0];source.mode='panels';source.unit='шт.';target.unit='шт.';source.coverWidth='1.2';source.coverHeight='3';source.stock='4';source.ordered='6';source.normSource='Спецификация';source.costBasis='required';
  assert.equal(copyCommonRows(s).copied,1);assert.equal(target.coverWidth,'1.2');assert.equal(target.stock,'4');assert.equal(target.ordered,'6');assert.equal(target.normSource,'Спецификация');assert.equal(target.costBasis,'required');
  target.price='999';source.price='500';assert.equal(copyCommonRows(s).skipped,1);assert.equal(target.price,'999');
  const a=createRow('Слой','м³','insulationVolume','external'),b=createRow('Слой','м³','insulationVolume','external');a.thickness='50';a.price='1000';s.scenarios.insulated.materials.push(a);s.scenarios.bare.materials.push(b);copyCommonRows(s);assert.equal(b.thickness,'');assert.equal(b.price,'');
});
test('internal CSV includes new geometry, procurement, pricing and tax data without leaking unknowns as zeros',()=>{
  const {s,r}=onlyRow();r.mode='manual';r.quantity='26';r.price='100';r.stock='1';r.pack='25';r.costBasis='required';s.taxMode='included';s.taxRate='20';s.projectRef='=A1';
  const out=csv(s);for(const label of ['Полезная ширина панели','Пригодный выделенный остаток','База стоимости','Вся потребность','Стоимость новой закупки','НДС включён','ИТОГО С УЧЁТОМ РЕЖИМА НДС'])assert.ok(out.includes(label));assert.ok(out.includes("'=A1"));assert.ok(!out.includes('undefined'));assert.ok(!out.includes('NaN'));
});

test('building dimensions calculate four rectangular walls and deduct every opening exactly once',()=>{
  const s=initialState();s.areaMode='building';s.buildingLength='10';s.buildingWidth='8';s.buildingHeight='3';
  let geo=geometry(s);assert.equal(geo.area,108);assert.equal(geo.gross,108);assert.equal(geo.openings,0);
  s.walls[0].name='Сохранённый фронтон';s.walls[0].shape='triangle';s.walls[0].width='1';s.walls[0].height='1';
  s.openings=[{name:'Окна',type:'window',width:'1.2',height:'1.5',count:'2',wallId:s.walls[0].id},{name:'Дверь',type:'door',width:'1',height:'2',count:'1'}];
  const snapshot=JSON.stringify(s);geo=geometry(s);assert.equal(geo.gross,108);assert.equal(geo.openings,5.6);assert.equal(geo.area,102.4);assert.equal(geo.areaRatio.n,512n);assert.equal(geo.areaRatio.d,5n);assert.equal(JSON.stringify(s),snapshot);
  s.openings[0].wallId='old-wall-unavailable';assert.equal(geometry(s).area,102.4);
  s.areaMode='direct';s.directArea='100';assert.equal(geometry(s).area,100);
  s.areaMode='walls';s.openings[0].wallId=s.walls[0].id;assert.equal(geometry(s).area,null);
});
test('building geometry keeps decimal dimensions and opening deductions exact',()=>{
  const s=initialState();s.areaMode='building';s.buildingLength='0.1';s.buildingWidth='0,2';s.buildingHeight='0.3';
  s.openings=[{name:'Проём',width:'0.1',height:'0.1',count:'1'}];
  const geo=geometry(s);assert.equal(geo.gross,0.18);assert.equal(geo.openings,0.01);assert.equal(geo.area,0.17);assert.deepEqual(geo.areaRatio,{n:17n,d:100n});
});
test('building mode requires all three strictly positive dimensions and rejects impossible or exhausting openings',()=>{
  const s=initialState();s.areaMode='building';s.buildingLength='10';s.buildingWidth='8';s.buildingHeight='3';
  for(const key of ['buildingLength','buildingWidth','buildingHeight']) {
    const saved=s[key];for(const invalid of ['', '0', '-1', 'NaN', '1e3', 'bad']) {s[key]=invalid;assert.equal(geometry(s).area,null,`${key}=${invalid}`);assert.ok(geometry(s).errors.length);}
    s[key]=saved;
  }
  s.openings=[{name:'Слишком широкий',width:'11',height:'0.1',count:'1'}];assert.equal(geometry(s).area,null);assert.match(geometry(s).errors.join(' '),/габариты здания/);
  s.openings[0]={name:'Слишком высокий',width:'1',height:'3.1',count:'1'};assert.equal(geometry(s).area,null);assert.match(geometry(s).errors.join(' '),/габариты здания/);
  s.openings[0]={name:'Все стены',width:'9',height:'3',count:'4'};assert.equal(geometry(s).area,null);assert.match(geometry(s).errors.join(' '),/меньше общей площади/);
  s.openings[0].count='5';assert.equal(geometry(s).area,null);
  s.openings[0].count='0';assert.equal(geometry(s).area,null);assert.match(geometry(s).errors.join(' '),/целое количество/);
  s.openings[0].count='1.5';assert.equal(geometry(s).area,null);
});
test('v3 import preserves manual area modes, stored dimensions, prices and taxes without guessing new dimensions',()=>{
  for(const mode of ['direct','walls']) {
    const s=initialState();s.version=3;s.areaMode=mode;s.directArea='90';s.buildingHeight='5';delete s.buildingLength;delete s.buildingWidth;
    s.walls=[{id:'wall',name:'Стена',shape:'rect',width:'10',height:'5',topWidth:''}];s.openings=[{id:'opening',name:'Окно',type:'window',width:'1',height:'2',count:'1',wallId:'wall',depth:'0.2',sides:'3'}];
    const row=s.scenarios.insulated.materials[0];row.price='500.12';row.reserve='7';row.pack='3.6';row.stock='2';row.ordered='1';row.costBasis='required';row.rateKind='external';s.taxMode='included';s.taxRate='20';
    const before=calculate(s),restored=validateImport(JSON.parse(JSON.stringify(s))),after=calculate(restored);
    assert.equal(restored.version,4);assert.equal(restored.areaMode,mode);assert.equal(restored.buildingLength,'');assert.equal(restored.buildingWidth,'');assert.equal(restored.buildingHeight,'5');assert.equal(restored.directArea,'90');assert.equal(restored.walls[0].width,'10');assert.equal(restored.openings[0].wallId,restored.walls[0].id);
    const migrated=restored.scenarios.insulated.materials[0];for(const key of ['price','reserve','pack','stock','ordered','costBasis','rateKind'])assert.equal(migrated[key],row[key]);assert.equal(after.geo.area,before.geo.area);assert.equal(after.total,before.total);assert.deepEqual(after.tax,before.tax);
  }
});
test('v4 building project roundtrip preserves inputs and calculated results, validates new dimensions strictly as strings',()=>{
  const {s,r}=onlyRow();s.areaMode='building';s.buildingLength='10';s.buildingWidth='8';s.buildingHeight='3';r.price='100';s.taxMode='none';
  s.openings=[{id:'o',name:'Окно',type:'window',width:'1.2',height:'1.5',count:'2',wallId:s.walls[0].id,depth:'0.2',sides:'3'}];
  const restored=validateImport(JSON.parse(JSON.stringify(s)));assert.equal(restored.version,4);assert.equal(restored.areaMode,'building');assert.equal(restored.buildingLength,'10');assert.equal(restored.buildingWidth,'8');assert.equal(restored.buildingHeight,'3');assert.equal(restored.openings[0].wallId,restored.walls[0].id);assert.equal(geometry(restored).area,104.4);assert.equal(calculate(restored).total,10440);assert.equal(calculate(restored).tax.grandTotal,10440);
  for(const key of ['buildingLength','buildingWidth'])for(const invalid of [null,10,{},'x'.repeat(5001)]) {const broken=JSON.parse(JSON.stringify(s));broken[key]=invalid;assert.throws(()=>validateImport(broken));}
  const invalid=JSON.parse(JSON.stringify(s));invalid.areaMode='perimeter';assert.throws(()=>validateImport(invalid));
});
test('building CSV identifies three dimensions, one opening deduction and excludes dormant wall geometry',()=>{
  const s=initialState();s.areaMode='building';s.buildingLength='10';s.buildingWidth='8';s.buildingHeight='3';s.walls[0].name='Dormant legacy gable';
  s.openings=[{id:'o',name:'Окно',type:'window',width:'1',height:'2',count:'1',wallId:s.walls[0].id}];
  const out=csv(s);for(const label of ['По габаритам здания','Длина здания, м','Ширина здания, м','Высота здания, м','2 × (длина + ширина) × высота','проёмы вычитаются один раз','Без фронтонов','конкретной стене','Вычтено проёмов, м²'])assert.ok(out.includes(label));assert.ok(!out.includes('Dormant legacy gable'));assert.ok(out.includes('"106"'));assert.ok(!out.includes('NaN'));assert.ok(!out.includes('undefined'));
});

test('new scenario templates separate optional reveal cladding and installation from other trim',()=>{
  const s=initialState();
  for(const scenario of Object.values(s.scenarios)) {
    assert.ok(scenario.materials.some(r=>r.name==='Доборные элементы (без откосов и отливов)'));
    assert.ok(scenario.works.some(r=>r.name==='Монтаж доборных элементов (без откосов)'));
    const material=scenario.materials.find(r=>r.name==='Облицовка откосов окон'),work=scenario.works.find(r=>r.name==='Монтаж откосов окон');
    for(const row of [material,work]) {assert.equal(row.enabled,false);assert.equal(row.mode,'windowRevealArea');assert.equal(row.unit,'м²');assert.equal(row.price,'');assert.equal(row.quantity,'');}
    assert.equal(material.rateKind,'external');assert.equal(work.rateKind,'base');
    const doorMaterial=scenario.materials.find(r=>r.name==='Дверные проёмы — материалы (по площади проёма)'),doorWork=scenario.works.find(r=>r.name==='Дверные проёмы — работы (по площади проёма)');
    for(const row of [doorMaterial,doorWork]) {assert.equal(row.enabled,false);assert.equal(row.mode,'doorOpeningArea');assert.equal(row.unit,'м²');assert.equal(row.price,'');assert.equal(row.quantity,'');}
    assert.equal(doorMaterial.rateKind,'external');assert.equal(doorWork.rateKind,'base');
    assert.ok(!scenario.materials.some(r=>r.name==='Доборные элементы, откосы, отливы'));
    assert.ok(!scenario.works.some(r=>r.name==='Монтаж доборных элементов и откосов'));
  }
});

test('separate reveal depth changes reveal materials and labor without changing facade area',()=>{
  for(const scenarioKey of ['insulated','bare']) {
    const s=initialState();s.scenario=scenarioKey;s.walls[0].width='10';s.walls[0].height='3';
    s.openings=[{id:'window',name:'Окно',wallId:s.walls[0].id,type:'window',width:'2',height:'1.5',count:'1',depth:'0.2',sides:'3'}];
    const scenario=s.scenarios[scenarioKey];for(const section of ['materials','works'])for(const row of scenario[section])row.enabled=false;
    const material=scenario.materials.find(r=>r.name==='Облицовка откосов окон'),work=scenario.works.find(r=>r.name==='Монтаж откосов окон');material.enabled=true;material.price='100';work.enabled=true;work.price='100';
    let c=calculate(s);assert.equal(c.ready,true);assert.equal(c.geo.area,27);assert.equal(c.measurements.revealLength,5);assert.equal(c.measurements.revealArea,1);assert.equal(c.sections.materials.rows.find(r=>r.id===material.id).qty,1);assert.equal(c.sections.works.rows.find(r=>r.id===work.id).qty,1);assert.equal(c.sections.materials.subtotal,100);assert.equal(c.sections.works.subtotal,140);assert.equal(c.pricing.base,100);assert.equal(c.pricing.allowance,40);assert.equal(c.total,240);assert.equal(c.sections.materials.rows[0].qty,27);
    s.openings[0].depth='0.4';c=calculate(s);assert.equal(c.geo.area,27);assert.equal(c.measurements.revealArea,2);assert.equal(c.sections.materials.subtotal,200);assert.equal(c.sections.works.subtotal,280);assert.equal(c.total,480);assert.equal(c.sections.materials.rows[0].qty,27);assert.equal(c.sections.works.rows[0].qty,27);
  }
});

test('import keeps saved mixed trim rows, their activation and prices unchanged instead of replacing templates',()=>{
  const s=initialState();s.version=3;s.areaMode='direct';s.directArea='100';
  for(const scenario of Object.values(s.scenarios)) {
    scenario.materials=scenario.materials.filter(r=>!['windowRevealArea','doorOpeningArea'].includes(r.mode));scenario.works=scenario.works.filter(r=>!['windowRevealArea','doorOpeningArea'].includes(r.mode));
    const material=scenario.materials.find(r=>r.name==='Доборные элементы (без откосов и отливов)'),work=scenario.works.find(r=>r.name==='Монтаж доборных элементов (без откосов)');
    material.name='Доборные элементы, откосы, отливы';material.enabled=false;material.price='650';material.quantity='12';
    work.name='Монтаж доборных элементов и откосов';work.enabled=true;work.price='140';work.quantity='12';work.rateKind='included';
  }
  const restored=validateImport(JSON.parse(JSON.stringify(s)));assert.equal(restored.version,4);assert.equal(restored.areaMode,'direct');assert.equal(restored.directArea,'100');
  for(const key of ['insulated','bare']) {
    const old=s.scenarios[key],scenario=restored.scenarios[key];assert.equal(scenario.materials.length,old.materials.length);assert.equal(scenario.works.length,old.works.length);assert.ok(!scenario.materials.some(r=>r.mode==='windowRevealArea'||r.mode==='doorOpeningArea'));assert.ok(!scenario.works.some(r=>r.mode==='windowRevealArea'||r.mode==='doorOpeningArea'));
    const material=scenario.materials.find(r=>r.name==='Доборные элементы, откосы, отливы'),work=scenario.works.find(r=>r.name==='Монтаж доборных элементов и откосов');assert.equal(material.enabled,false);assert.equal(material.price,'650');assert.equal(material.quantity,'12');assert.equal(work.enabled,true);assert.equal(work.price,'140');assert.equal(work.quantity,'12');assert.equal(work.rateKind,'included');
  }
});

test('window reveals, door openings and door reveals have independent exact bases',()=>{
  const s=initialState();s.walls[0].width='10';s.walls[0].height='3';
  s.openings=[{id:'w',name:'Окно',type:'window',wallId:s.walls[0].id,width:'2',height:'1.5',count:'1',depth:'0.2',sides:'3'},{id:'d',name:'Дверь',type:'door',wallId:s.walls[0].id,width:'1',height:'2',count:'1',depth:'0.3',sides:'3'}];
  let m=measurements(s);assert.equal(geometry(s).area,25);assert.equal(m.windowRevealArea,1);assert.equal(m.windowRevealLength,5);assert.equal(m.doorOpeningArea,2);assert.equal(m.doorOpeningCount,1);assert.equal(m.doorRevealArea,1.5);assert.equal(m.doorRevealLength,5);assert.equal(m.revealArea,2.5);assert.equal(m.revealLength,10);
  s.openings[0].depth='0.4';m=measurements(s);assert.equal(m.windowRevealArea,2);assert.equal(m.doorRevealArea,1.5);assert.equal(m.doorOpeningArea,2);assert.equal(m.doorOpeningCount,1);assert.equal(geometry(s).area,25);
  s.openings[1].width='1.2';m=measurements(s);assert.equal(m.windowRevealArea,2);assert.equal(m.windowRevealLength,5);assert.equal(m.doorRevealArea,1.56);assert.equal(m.doorRevealLength,5.2);assert.equal(m.doorOpeningArea,2.4);assert.equal(m.doorOpeningCount,1);assert.equal(geometry(s).area,24.6);
});

test('scoped bases reject unknown types but validate only their relevant dimensions, sides and depth',()=>{
  const s=initialState();s.openings=[{name:'Окно',type:'window',width:'2',height:'1.5',count:'1',depth:'0.2',sides:'3'},{name:'Дверь',type:'door',width:'1',height:'2',count:'1',depth:'',sides:''}];
  let m=measurements(s);assert.equal(m.windowRevealArea,1);assert.equal(m.windowRevealLength,5);assert.equal(m.doorOpeningArea,2);assert.equal(m.doorOpeningCount,1);assert.equal(m.doorRevealArea,null);assert.equal(m.doorRevealLength,null);assert.equal(m.errors.doorOpeningArea.length,0);assert.match(m.errors.doorRevealArea.join(' '),/глубину/);
  s.openings[1].depth='0.3';s.openings[1].sides='3';s.openings[1].height='';m=measurements(s);assert.equal(m.windowRevealArea,1);assert.equal(m.doorOpeningCount,1);assert.equal(m.doorOpeningArea,null);assert.equal(m.doorRevealLength,null);
  s.openings[1].height='2';s.openings[1].type='';m=measurements(s);for(const key of ['windowRevealArea','windowRevealLength','doorOpeningArea','doorOpeningCount','doorRevealArea','doorRevealLength']){assert.equal(m[key],null);assert.match(m.errors[key].join(' '),/тип проёма/);}assert.equal(m.revealArea,2.5);
});

test('scoped groups distinguish no opening list from an explicitly typed list with no matches',()=>{
  const s=initialState(),keys=['windowRevealArea','windowRevealLength','doorOpeningArea','doorOpeningCount','doorRevealArea','doorRevealLength'];
  let m=measurements(s);for(const key of keys){assert.equal(m[key],null);assert.ok(m.errors[key].length);}
  s.openings=[{name:'Прочий проём',type:'other',width:'',height:'',count:'',depth:'',sides:''}];m=measurements(s);for(const key of keys){assert.equal(m[key],0);assert.equal(m.errors[key].length,0);}
  s.openings=[{name:'Окно',type:'window',width:'2',height:'1.5',count:'1',depth:'0.2',sides:'4'}];m=measurements(s);assert.equal(m.windowRevealArea,1.4);assert.equal(m.windowRevealLength,7);for(const key of ['doorOpeningArea','doorOpeningCount','doorRevealArea','doorRevealLength'])assert.equal(m[key],0);
  s.openings=[{name:'Дверь',type:'door',width:'1',height:'2',count:'2',depth:'0.3',sides:'4'}];m=measurements(s);assert.equal(m.windowRevealArea,0);assert.equal(m.windowRevealLength,0);assert.equal(m.doorOpeningCount,2);assert.equal(m.doorOpeningArea,4);assert.equal(m.doorRevealLength,12);assert.equal(m.doorRevealArea,3.6);
});

test('separate window and door scope quantities price their own rows, with labor uplift applied once',()=>{
  const s=initialState();s.walls[0].width='10';s.walls[0].height='3';s.openings=[{name:'Окно',type:'window',width:'2',height:'1.5',count:'1',depth:'0.2',sides:'3'},{name:'Дверь',type:'door',width:'1',height:'2',count:'1',depth:'0.3',sides:'3'}];
  const scenario=s.scenarios.insulated;for(const section of ['materials','works'])for(const row of scenario[section])row.enabled=false;
  const window=scenario.materials.find(r=>r.mode==='windowRevealArea'),door=scenario.materials.find(r=>r.mode==='doorOpeningArea');window.enabled=true;window.price='100';door.enabled=true;door.price='100';
  const doorRevealWork=createRow('Откосы дверей отдельно','м²','doorRevealArea','base');doorRevealWork.price='100';scenario.works.push(doorRevealWork);
  let c=calculate(s);assert.equal(c.geo.area,25);assert.equal(c.sections.materials.rows.find(r=>r.id===window.id).value,100);assert.equal(c.sections.materials.rows.find(r=>r.id===door.id).value,200);assert.equal(c.sections.works.rows.at(-1).value,210);assert.equal(c.pricing.base,150);assert.equal(c.pricing.allowance,60);assert.equal(c.total,510);
  s.openings[0].depth='0.4';c=calculate(s);assert.equal(c.total,610);assert.equal(c.sections.materials.rows.find(r=>r.id===door.id).value,200);assert.equal(c.sections.works.rows.at(-1).value,210);assert.equal(c.geo.area,25);
  door.unit='м.п.';assert.equal(calculate(s).sections.materials.rows.find(r=>r.id===door.id).value,null);assert.match(calculate(s).missing.find(r=>r.id===door.id).fields.join(' '),/м²/);
});

test('saved generic reveal rows retain their mode, entered prices and activation alongside the new scoped modes',()=>{
  const s=initialState();s.areaMode='direct';s.directArea='100';s.openings=[{id:'w',name:'Окно',type:'window',width:'2',height:'1.5',count:'1',depth:'0.2',sides:'3'}];
  const generic=createRow('Облицовка откосов','м²','revealArea','external');generic.price='355';s.scenarios.insulated.materials.push(generic);
  for(const mode of ['windowRevealArea','windowRevealLength','doorOpeningArea','doorOpeningCount','doorRevealArea','doorRevealLength']){const row=createRow(MODE_LABELS[mode],MODE_UNITS[mode],mode,'external');row.price='100';s.scenarios.insulated.materials.push(row);}
  const restored=validateImport(JSON.parse(JSON.stringify(s))),row=restored.scenarios.insulated.materials.find(r=>r.name==='Облицовка откосов');assert.equal(row.mode,'revealArea');assert.equal(row.price,'355');assert.equal(row.enabled,true);
  for(const mode of ['windowRevealArea','windowRevealLength','doorOpeningArea','doorOpeningCount','doorRevealArea','doorRevealLength'])assert.ok(restored.scenarios.insulated.materials.some(r=>r.mode===mode));
  const out=csv(restored);for(const label of ['По площади откосов окон','По площади дверных проёмов','По количеству дверных проёмов','По площади откосов дверей'])assert.ok(out.includes(label));assert.ok(!out.includes('undefined'));
});
