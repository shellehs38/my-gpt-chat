import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState} from '../public/facade-calculator/engine.mjs';
import {buildReport} from '../public/facade-calculator/report.mjs';
test('client report has approved logo and final labor rates without internal remuneration',()=>{
  const s=initialState();s.areaMode='direct';s.directArea='10';s.project='<script>alert(1)</script>';
  for(const v of Object.values(s.scenarios))for(const rows of Object.values(v))rows.forEach(r=>r.enabled=false);
  const w=s.scenarios.insulated.works[0];w.enabled=true;w.price='100';w.source='Расценка компании';w.priceDate='2026-10-20';
  const html=buildReport(s,new Date('2026-10-20T12:00:00Z'));
  assert.ok(html.includes('brand/logo-sl-approved-light.png'));assert.ok(html.includes('140</td>'));assert.ok(html.includes('1 400'));assert.ok(html.includes('20.10.2026'));assert.ok(html.includes('Расценка компании'));
  for(const text of ['+40','40%','Бюджет руководителя','Базовая трудовая часть','<script>'])assert.ok(!html.includes(text),text);
  assert.ok(html.includes('&lt;script&gt;'));
});
test('client export marks incomplete and unverified prices; no fabricated total',()=>{
  let s=initialState();assert.ok(buildReport(s).includes('НЕПОЛНЫЙ РАСЧЁТ'));
  s.areaMode='direct';s.directArea='10';for(const rows of Object.values(s.scenarios.insulated))rows.forEach(r=>r.enabled=false);
  const m=s.scenarios.insulated.materials[0];m.enabled=true;m.price='100';m.reserve='5';m.pack='2';
  const html=buildReport(s);assert.ok(html.includes('ПРЕДВАРИТЕЛЬНО'));assert.ok(html.includes('6 уп. по 2'));assert.ok(html.includes('1 200'));assert.ok(html.includes('Источник не указан'));
});

test('standalone report embeds the exact approved PNG and has no remote image dependency',async()=>{
  const {readFileSync}=await import('node:fs');const {buildStandaloneReport}=await import('../public/facade-calculator/report.mjs');
  const png=readFileSync(new URL('../public/facade-calculator/brand/logo-sl-approved-light.png',import.meta.url));const s=initialState();const html=buildStandaloneReport(s,'data:image/png;base64,'+png.toString('base64'));
  const encoded=html.match(/src="data:image\/png;base64,([A-Za-z0-9+/=]+)"/);assert.ok(encoded);assert.deepEqual(Buffer.from(encoded[1],'base64'),png);assert.ok(!html.includes('src="./brand/'));assert.throws(()=>buildStandaloneReport(s,'javascript:alert(1)'));
});

test('client document includes input geometry, slope depth, procurement basis and explicit tax without exposing private pricing',()=>{
  const s=initialState();s.areaMode='direct';s.directArea='26';s.taxMode='onTop';s.taxRate='20';s.subsystem='Проектная система';s.projectRef='<img src=x onerror=alert(1)>';
  s.openings=[{id:'o',name:'Окно',type:'window',width:'1.2',height:'1.5',count:'2',depth:'0.2',sides:'3',wallId:''}];
  for(const rows of Object.values(s.scenarios.insulated))rows.forEach(r=>r.enabled=false);
  const r=s.scenarios.insulated.materials[0];r.enabled=true;r.price='100';r.stock='1';r.pack='25';r.costBasis='required';
  const html=buildReport(s);
  assert.match(html,/Глубина откоса/);assert.match(html,/повторно из неё не вычитаются/);assert.match(html,/вся потребность/);assert.match(html,/3\s?120/);assert.match(html,/НДС начисляется сверху/);
  assert.match(html,/Проектная система/);assert.doesNotMatch(html,/<img src=x/);assert.doesNotMatch(html,/Бюджет руководителя|40%|Базовая трудовая часть/);
});

test('missing tax settings never become a final payable total in the client report',()=>{
  const s=initialState();s.areaMode='direct';s.directArea='10';for(const rows of Object.values(s.scenarios.insulated))rows.forEach(r=>r.enabled=false);
  const r=s.scenarios.insulated.materials[0];r.enabled=true;r.price='100';
  const html=buildReport(s);assert.match(html,/Полный итог не определён/);assert.match(html,/налоговые условия/);
});

test('building report records all three dimensions and a single opening deduction without presenting saved walls as the basis',()=>{
  const s=initialState();s.areaMode='building';s.buildingLength='10';s.buildingWidth='8';s.buildingHeight='3';s.taxMode='none';
  s.walls[0].name='СТАРАЯ НЕИСПОЛЬЗУЕМАЯ СТЕНА';
  s.openings=[{id:'o',name:'Окна',type:'window',width:'1.2',height:'1.5',count:'2',depth:'0.2',sides:'3',wallId:s.walls[0].id},{id:'d',name:'Дверь',type:'door',width:'1',height:'2',count:'1',depth:'0.2',sides:'3',wallId:''}];
  for(const rows of Object.values(s.scenarios.insulated))rows.forEach(r=>r.enabled=false);
  Object.assign(s.scenarios.insulated.materials[0],{enabled:true,price:'100'});
  const html=buildReport(s);assert.match(html,/Длина здания: 10 м/);assert.match(html,/ширина здания: 8 м/);assert.match(html,/высота стен до карниза: 3 м/);assert.match(html,/До вычета: 108 м²/);assert.match(html,/проёмы: 5,6 м²/);assert.match(html,/чистая площадь: 102,4 м²/);assert.match(html,/10\s?240/);
  assert.match(html,/Проёмы вычитаются один раз/);assert.match(html,/Фронтоны, пристройки/);assert.doesNotMatch(html,/СТАРАЯ НЕИСПОЛЬЗУЕМАЯ СТЕНА|повторно из неё не вычитаются/);
});

test('client report separates wall area from reveals and their independent priced positions',()=>{
  const s=initialState();s.areaMode='walls';s.walls=[{id:'facade',name:'Фасад',shape:'rect',width:'10',height:'3',topWidth:''}];s.taxMode='none';
  s.openings=[{id:'window',wallId:'facade',name:'Окно',type:'window',width:'2',height:'1.5',count:'1',depth:'0.2',sides:'3'}];
  for(const rows of Object.values(s.scenarios.insulated))rows.forEach(r=>r.enabled=false);
  Object.assign(s.scenarios.insulated.materials[0],{enabled:true,price:'100'});Object.assign(s.scenarios.insulated.works[0],{enabled:true,price:'100'});
  for(const key of ['materials','works']){const r=s.scenarios.insulated[key].find(r=>r.mode==='windowRevealArea');assert.ok(r);Object.assign(r,{enabled:true,price:'100'});}
  const html=buildReport(s);assert.match(html,/<b>Чистая площадь:<\/b> 27 м²/);assert.match(html,/<dt>Площадь откосов окон<\/dt><dd>1 м²/);assert.match(html,/6\s?720/);assert.match(html,/Откосы не входят в площадь стен/);assert.match(html,/Облицовка откосов окон/);assert.match(html,/Монтаж откосов окон/);
  s.openings[0].depth='0.4';const changed=buildReport(s);assert.match(changed,/<b>Чистая площадь:<\/b> 27 м²/);assert.match(changed,/<dt>Площадь откосов окон<\/dt><dd>2 м²/);assert.match(changed,/6\s?960/);
});

test('door openings and their reveals remain distinct from window reveals in the client report',()=>{
  const s=initialState();s.areaMode='walls';s.walls=[{id:'f',name:'Фасад',shape:'rect',width:'10',height:'3',topWidth:''}];s.taxMode='none';
  s.openings=[{id:'w',wallId:'f',name:'Окно',type:'window',width:'2',height:'1.5',count:'1',depth:'0.2',sides:'3'},{id:'d',wallId:'f',name:'Дверь',type:'door',width:'1',height:'2',count:'1',depth:'0.3',sides:'3'}];
  for(const key of ['materials','works']){
    for(const r of s.scenarios.insulated[key])r.enabled=false;
    Object.assign(s.scenarios.insulated[key][0],{enabled:true,price:'100'});
    Object.assign(s.scenarios.insulated[key].find(r=>r.mode==='windowRevealArea'),{enabled:true,price:'100'});
    Object.assign(s.scenarios.insulated[key].find(r=>r.mode==='doorOpeningArea'),{enabled:true,price:'200'});
  }
  const html=buildReport(s);assert.match(html,/<b>Чистая площадь:<\/b> 25 м²/);assert.match(html,/<dt>Площадь откосов окон<\/dt><dd>1 м²/);assert.match(html,/<dt>Площадь дверных проёмов<\/dt><dd>2 м²/);assert.match(html,/<dt>Количество дверных проёмов<\/dt><dd>1 шт\./);assert.match(html,/<dt>Площадь откосов дверных проёмов<\/dt><dd>1,5 м²/);assert.match(html,/7\s?200/);assert.match(html,/<h3>Дверные проёмы<\/h3>/);
  s.openings[0].depth='0.4';const changed=buildReport(s);assert.match(changed,/<b>Чистая площадь:<\/b> 25 м²/);assert.match(changed,/<dt>Площадь откосов окон<\/dt><dd>2 м²/);assert.match(changed,/<dt>Площадь дверных проёмов<\/dt><dd>2 м²/);assert.match(changed,/7\s?440/);
});

test('client report retains fractional quantity needed to verify the printed amount',()=>{
  const s=initialState();s.areaMode='direct';s.directArea='10';s.taxMode='none';
  for(const rows of Object.values(s.scenarios.insulated))for(const r of rows)r.enabled=false;
  Object.assign(s.scenarios.insulated.materials[0],{enabled:true,name:'Точный объём',unit:'м³',mode:'manual',quantity:'1.2345674',price:'50000'});
  const html=buildReport(s);
  assert.match(html,/<td>1,2345674<\/td><td>50\s?000<\/td><td>61\s?728,37<\/td>/);
  assert.match(html,/более длинные расчётные значения округлены только для отображения/);
  const quantity=1.2345674,price=50000;assert.equal(Math.round(quantity*price*100)/100,61728.37);
});

test('client labor rate retains the thirteenth decimal created by the single uplift',()=>{
  const s=initialState();s.areaMode='direct';s.directArea='1';
  for(const rows of Object.values(s.scenarios.insulated))for(const r of rows)r.enabled=false;
  Object.assign(s.scenarios.insulated.works[0],{enabled:true,price:'0.123456789123',rateKind:'base'});
  const html=buildReport(s);assert.match(html,/<td>0,1728395047722<\/td>/);assert.doesNotMatch(html,/<td>0,123456789123<\/td>/);
});

test('budget report labels assumptions, escapes source text and keeps unknown tax unresolved',()=>{
  const s=initialState();s.areaMode='direct';s.directArea='10';s.estimateKind='budget';s.taxMode='unknown';
  s.sourceDocument='Павильон.pdf, лист 3 <script>alert(1)</script>';
  s.assumptions=['принято самостоятельно: глубина откоса 0,2 м','(принято самостоятельно: сохранение окон)'];
  for(const rows of Object.values(s.scenarios.insulated))for(const r of rows)r.enabled=false;
  Object.assign(s.scenarios.insulated.works[0],{enabled:true,price:'100',rateKind:'base',source:'Базовая ставка 100 ₽, бюджет руководителя 40%',priceDate:'2026-10-23'});
  const html=buildReport(s);
  assert.match(html,/ПРЕДВАРИТЕЛЬНАЯ БЮДЖЕТНАЯ СУММА/);assert.match(html,/1\s?400/);assert.match(html,/Полная цена договора не определена/);
  assert.match(html,/Налоговые условия требуют уточнения/);assert.match(html,/Полный итог не определён: —/);
  assert.match(html,/<li>\(принято самостоятельно: глубина откоса 0,2 м\)<\/li>/);assert.match(html,/<li>\(принято самостоятельно: сохранение окон\)<\/li>/);
  assert.match(html,/Павильон.pdf, лист 3 &lt;script&gt;/);assert.doesNotMatch(html,/<script>|Базовая ставка 100|бюджет руководителя 40%/);
  assert.match(html,/источник исходной расценки хранится во внутреннем проекте/);
});
