import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogFamilies, insulationCatalog, catalogChecked} from '../public/facade-calculator/material-catalog.mjs';

const actual=()=>catalogFamilies.flatMap(f=>f.variants.filter(v=>!v.id.startsWith('custom-')));
const find=id=>actual().find(v=>v.id===id);
const officialHosts=new Set(['www.grandline.ru','stynergy.ru','novosibirsk.metallprofil.ru','metallprofil.ru','ulan-ude.metallprofil.ru','vitebsk.metallprofil.by','stavropol.metallprofil.ru','irkutsk.metallprofil.ru','bajkom.ru','nav.tn.ru','shop.rwl.ru','rwl.ru']);

test('all ten requested families have a sourced manufacturer and a separate custom profile',()=>{
 assert.deepEqual(new Set(catalogFamilies.map(f=>f.name)),new Set(['Корабельная доска','Блок-хаус','Евробрус','ЭкоБрус','L-брус','L-брус XL','Квадро Брус','Металлический планкен','Вертикаль','Woodstock']));
 assert.equal(new Set(catalogFamilies.map(f=>f.id)).size,10);
 for(const family of catalogFamilies){
  assert.ok(family.variants.some(v=>v.sources.length&&v.manufacturer!=='Другой производитель'),family.name);
  const custom=family.variants.find(v=>v.id==='custom-'+family.id);
  assert.equal(custom.manual,true); assert.equal(custom.usefulWidth,''); assert.equal(custom.fullWidth,''); assert.deepEqual(custom.sources,[]);
 }
 assert.ok(new Set(actual().map(v=>v.manufacturer)).size>=4);
 assert.equal(new Set(catalogFamilies.flatMap(f=>f.variants.map(v=>v.id))).size,catalogFamilies.flatMap(f=>f.variants).length);
});

test('catalog dimensions are decimal metres with valid useful/full boundaries; unknown strip module remains editable',()=>{
 for(const v of actual()){
  for(const key of ['usefulWidth','fullWidth','minLength','maxLength']) assert.ok(v[key]===''||/^\d+(\.\d+)?$/.test(v[key])&&+v[key]>0,`${v.id} ${key}`);
  if(v.usefulWidth&&v.fullWidth&&!v.openJoint)assert.ok(+v.fullWidth>=+v.usefulWidth,v.id);
  if(v.minLength&&v.maxLength)assert.ok(+v.maxLength>=+v.minLength,v.id);
  if(!v.usefulWidth)assert.equal(v.manual,true,v.id+' must allow actual project dimensions');
  assert.ok(v.orientations.length&&v.orientations.every(x=>['horizontal','vertical'].includes(x)),v.id);
  assert.ok(v.mounting.length&&v.accessories.length&&v.limitations.length,v.id);
 }
 const planken=find('bajkom-planken-project');
 assert.equal(planken.manual,true);assert.equal(planken.openJoint,true);assert.equal(planken.usefulWidth,'');
 assert.match(planken.limitations.join(' '),/зазор/);
});

test('different factories and manufacturers keep distinct coverage dimensions',()=>{
 assert.equal(find('gl-shipboard-240').usefulWidth,'0.240');
 assert.equal(find('gl-shipboard-235').usefulWidth,'0.235');
 assert.equal(find('st-shipboard').usefulWidth,'0.230');
 assert.equal(find('gl-blockhouse-new').usefulWidth,'0.334');
 assert.equal(find('st-blockhouse').usefulWidth,'0.335');
 assert.equal(find('gl-ecobrus-new').usefulWidth,'0.332');
 assert.equal(find('gl-ecobrus').usefulWidth,'0.320');
 assert.equal(find('gl-kvadro-verhovye').usefulWidth,'0.293');
 assert.equal(find('gl-kvadro-ilskiy-ekb').usefulWidth,'0.292');
});

test('profile-specific assembly orders are preserved instead of a universal mounting card',()=>{
 assert.match(find('st-eurobrus').mounting.join(' '),/сверху вниз/i);
 assert.match(find('gl-ecobrus-new').mounting.join(' '),/снизу вверх/i);
 assert.match(find('mp-lbrus-240').mounting.join(' '),/сверху вниз/i);
 assert.match(find('mp-lbrus-xl-335').mounting.join(' '),/снизу вверх/i);
 assert.deepEqual(find('grandline-vertical').orientations,['vertical']);
 assert.match(find('metallprofil-woodstock').limitations.join(' '),/профиль.*ECOSTEEL/s);
});

test('product and installation references retain official URLs, inspection date and page strings',()=>{
 assert.equal(catalogChecked,'2026-10-24');
 for(const entry of [...actual(),...insulationCatalog]){
  assert.ok(entry.sources.length,entry.id);
  for(const s of entry.sources){
   const u=new URL(s.url);assert.equal(u.protocol,'https:');assert.ok(officialHosts.has(u.host),s.url);
   assert.ok(s.title.length);assert.equal(s.checked,catalogChecked);
   if(s.pages!==undefined)assert.equal(typeof s.pages,'string');
  }
 }
 const incomplete=find('mp-lbrus-240');
 assert.match(incomplete.limitations.join(' '),/недоступен/);
 assert.ok(incomplete.sources.some(s=>s.evidence==='indexedExcerpt'));
});

test('insulation products retain layer roles and reject unrestricted XPS substitution',()=>{
 const byId=Object.fromEntries(insulationCatalog.map(x=>[x.id,x]));
 assert.deepEqual(byId['tn-technovent-standard'].layerRoles,['outer','single']);
 assert.deepEqual(byId['tn-walls-roofs-prof'].layerRoles,['inner']);
 assert.equal(byId['tn-walls-roofs-prof'].restricted,false);
 assert.equal(byId['tn-carbon-eco-local'].restricted,true);
 assert.deepEqual(byId['tn-carbon-eco-local'].layerRoles,[]);
 for(const entry of insulationCatalog){
  assert.ok(entry.application&&entry.mounting.length&&entry.limitations.length);
  assert.ok(entry.layerRoles.every(x=>['inner','outer','single'].includes(x)));
  if(['eps','xps','pir','pur','cellulose'].includes(entry.type))assert.equal(entry.restricted,true,entry.id);
 }
});
