export const WARNING = 'Перед применением расчёта профильный инженер должен проверить применимые СП/ГОСТ, несущую способность основания, анкеров, кронштейнов и подсистемы, нагрузки, узлы, пожарные и теплотехнические требования. Калькулятор не заменяет проект и несущие расчёты.';
export const RATE_LABELS = {base:'Базовая ставка работы', included:'Клиентская ставка, надбавка включена', external:'Внешние затраты без надбавки', unknown:'Уточните состав / тип ставки'};
export const MODE_LABELS = {manual:'Вручную',area:'По чистой площади',norm:'По расходу на м²',revealArea:'По площади всех откосов',revealLength:'По длине всех откосов',windowRevealArea:'По площади откосов окон',windowRevealLength:'По длине откосов окон',doorOpeningArea:'По площади дверных проёмов',doorOpeningCount:'По количеству дверных проёмов',doorRevealArea:'По площади откосов дверей',doorRevealLength:'По длине откосов дверей',sillLength:'По длине оконных отливов',outerCorners:'По наружным углам',innerCorners:'По внутренним углам',baseLength:'По длине цоколя',corniceLength:'По длине карниза',insulationVolume:'Объём слоя утеплителя',panels:'Панели по полезному размеру',supportLength:'Направляющие по сетке стен',supportBrackets:'Кронштейны по сетке стен',supportAnchors:'Анкеры по сетке стен'};
export const MODE_UNITS = {area:'м²',revealArea:'м²',revealLength:'м.п.',windowRevealArea:'м²',windowRevealLength:'м.п.',doorOpeningArea:'м²',doorOpeningCount:'шт.',doorRevealArea:'м²',doorRevealLength:'м.п.',sillLength:'м.п.',outerCorners:'м.п.',innerCorners:'м.п.',baseLength:'м.п.',corniceLength:'м.п.',insulationVolume:'м³',panels:'шт.',supportLength:'м.п.',supportBrackets:'шт.',supportAnchors:'шт.'};
export function number(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const text = String(value).trim().replace(/[\s\u00a0\u202f]/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,12})?$/.test(text)) return null;
  const result = Number(text);
  return Number.isFinite(result) && result <= 1e12 ? result : null;
}
export const uid = () => globalThis.crypto?.randomUUID?.() || `r${Date.now()}${Math.random().toString(36).slice(2)}`;
export const MAX_PROJECT_FILE_BYTES=16*1024*1024;
export function serializeProject(state){const text=JSON.stringify(state,null,2);if(new TextEncoder().encode(text).length>MAX_PROJECT_FILE_BYTES)throw Error('Проект превышает предел 16 МБ. Сохраните отдельные объекты разными файлами.');return text;}
export const createRow = (name='', unit='', mode='manual', rateKind='unknown') => ({id:uid(),name,unit,mode,quantity:'',norm:'',price:'',enabled:true,reserve:'',pack:'',stock:'',ordered:'',thickness:'',coverWidth:'',coverHeight:'',normSource:'',costBasis:'purchase',source:'',priceDate:'',rateKind});
export function template(insulated) {
  const material=(name,unit,mode='manual')=>createRow(name,unit,mode,'external');
  const work=(name,unit,mode='manual',kind='base')=>createRow(name,unit,mode,kind);
  return {
    materials:[material('Облицовочный материал','м²','area'),material('Направляющие подсистемы','м.п.'),material('Кронштейны','шт.'),material('Анкеры крепления к основанию','шт.'),material('Крепёж облицовки и подсистемы','шт.'),material('Доборные элементы (без откосов и отливов)','м.п.'),...(insulated?[material('Утеплитель — марку и толщину уточнить','м²','area'),material('Крепёж утеплителя','шт.')]:[]),{...material('Облицовка откосов окон','м²','windowRevealArea'),enabled:false},{...material('Дверные проёмы — материалы (по площади проёма)','м²','doorOpeningArea'),enabled:false}],
    works:[work('Подготовка основания','м²','area'),work('Монтаж металлической подсистемы','м²','area'),...(insulated?[work('Монтаж утеплителя','м²','area')]:[]),work('Монтаж облицовки','м²','area'),work('Монтаж доборных элементов (без откосов)','м.п.'),work('Леса / средства доступа','компл.','manual','external'),{...work('Монтаж откосов окон','м²','windowRevealArea'),enabled:false},{...work('Дверные проёмы — работы (по площади проёма)','м²','doorOpeningArea'),enabled:false}]
  };
}
export function initialState() {
  return {version:4,project:'',address:'',substrate:'',cladding:'',buildingLength:'',buildingWidth:'',buildingHeight:'',thickness:'',insulationType:'',subsystem:'',bracketOutreach:'',projectRef:'',terms:'',notes:'',taxMode:'unknown',taxRate:'',measures:{outerCorners:'',innerCorners:'',baseLength:'',corniceLength:''},scenario:'insulated',areaMode:'walls',directArea:'',walls:[{id:uid(),name:'Фасад 1',shape:'rect',width:'',topWidth:'',height:''}],openings:[],scenarios:{insulated:template(true),bare:template(false)}};
}
// Exact decimal fractions protect geometry, procurement boundaries and money from binary rounding.
const gcd=(a,b)=>b?gcd(b,a%b):a;
const ratio=(n,d=1n)=>{const g=gcd(n,d);return {n:n/g,d:d/g};};
const zero=()=>ratio(0n);
function decimal(value) {
  if(number(value)===null)return null;
  const t=String(value).trim().replace(/[\s\u00a0\u202f]/g,'').replace(',','.');
  const [whole,part='']=t.split('.');return ratio(BigInt(whole+part),10n**BigInt(part.length));
}
const mul=(a,b)=>ratio(a.n*b.n,a.d*b.d);
const add=(a,b)=>ratio(a.n*b.d+b.n*a.d,a.d*b.d);
const sub=(a,b)=>ratio(a.n*b.d-b.n*a.d,a.d*b.d);
const div=(a,b)=>ratio(a.n*b.d,a.d*b.n);
const compare=(a,b)=>a.n*b.d-b.n*a.d;
const ceil=a=>ratio((a.n+a.d-1n)/a.d);
const numeric=a=>a?Number(a.n)/Number(a.d):null;
const filled=value=>value!==undefined&&value!==null&&String(value).trim()!=='';
const cents=a=>{if(!a)return null;const v=(a.n*200n+a.d)/(a.d*2n);return v<=BigInt(Number.MAX_SAFE_INTEGER)?Number(v):null;};
const sumCents=rows=>{if(!rows.length)return null;const n=rows.reduce((a,b)=>a+BigInt(b),0n);return n<=BigInt(Number.MAX_SAFE_INTEGER)?Number(n):null;};
const scopedMeasureKeys=['windowRevealArea','windowRevealLength','doorOpeningArea','doorOpeningCount','doorRevealArea','doorRevealLength'];
const measureKeys=['revealArea','revealLength',...scopedMeasureKeys,'sillLength','outerCorners','innerCorners','baseLength','corniceLength'];
const directMeasures=['outerCorners','innerCorners','baseLength','corniceLength'];
function wallArea(w) {
  const width=decimal(w.width),height=decimal(w.height);
  if(!width||width.n===0n||!height||height.n===0n)return null;
  if(w.shape==='rect')return mul(width,height);
  if(w.shape==='triangle')return mul(mul(width,height),ratio(1n,2n));
  const top=decimal(w.topWidth);
  return w.shape==='trapezoid'&&top&&top.n>0n?mul(mul(add(width,top),height),ratio(1n,2n)):null;
}
function openingDimensions(o) {
  const width=decimal(o.width),height=decimal(o.height),count=decimal(o.count);
  return width?.n>0n&&height?.n>0n&&count?.n>0n&&count.d===1n?{width,height,count}:null;
}
export function geometry(state) {
  if(state.areaMode==='direct') {
    const area=number(state.directArea),valid=area>0;
    return {area:valid?area:null,areaRatio:valid?decimal(state.directArea):null,gross:null,openings:null,errors:valid?[]:['Введите чистую площадь фасада больше нуля.']};
  }
  if(state.areaMode==='building') {
    const errors=[],length=decimal(state.buildingLength),width=decimal(state.buildingWidth),height=decimal(state.buildingHeight);
    for(const [dimension,label] of [[length,'длину'],[width,'ширину'],[height,'высоту']])if(!dimension||dimension.n===0n)errors.push(`Укажите ${label} здания в метрах больше нуля.`);
    const gross=!errors.length?mul(mul(add(length,width),height),ratio(2n)):null;
    let openings=zero();
    for(const [i,o] of (state.openings??[]).entries()) {
      const dims=openingDimensions(o),name=o.name||`Проём ${i+1}`;
      if(!dims){errors.push(`${name}: нужны размеры и целое количество больше нуля.`);continue;}
      openings=add(openings,mul(mul(dims.width,dims.height),dims.count));
      if(gross&&(compare(dims.width,compare(length,width)>0n?length:width)>0n||compare(dims.height,height)>0n))errors.push(`${name}: размеры проёма превышают габариты здания.`);
    }
    if(!errors.length&&compare(openings,gross)>=0n)errors.push('Площадь проёмов должна быть меньше общей площади четырёх стен.');
    const net=!errors.length?sub(gross,openings):null;
    return {area:numeric(net),areaRatio:net,gross:errors.length?null:numeric(gross),openings:errors.length?null:numeric(openings),errors};
  }
  const errors=[];let gross=zero(),openings=zero();
  const walls=state.walls??[],openingRows=state.openings??[],wallAreas=new Map(),linked=new Map();
  if(!walls.length)errors.push('Добавьте хотя бы одну стену или фронтон.');
  for(const [i,w] of walls.entries()) {
    const area=wallArea(w),name=w.name||`Поверхность ${i+1}`;
    if(!area)errors.push(`${name}: укажите размеры больше нуля и допустимую форму${w.shape==='trapezoid'?' (включая верхнюю ширину)':''}.`);
    else {gross=add(gross,area);if(w.id)wallAreas.set(w.id,{area,name,wall:w});}
  }
  for(const [i,o] of openingRows.entries()) {
    const dims=openingDimensions(o),name=o.name||`Проём ${i+1}`;
    if(!dims){errors.push(`${name}: нужны размеры и целое количество больше нуля.`);continue;}
    const area=mul(mul(dims.width,dims.height),dims.count);openings=add(openings,area);
    if(filled(o.wallId)) {
      if(!wallAreas.has(o.wallId))errors.push(`${name}: выберите существующую стену с заполненными размерами.`);
      else {
        const {wall}=wallAreas.get(o.wallId),width=decimal(wall.width),top=decimal(wall.topWidth);
        const maxWidth=wall.shape==='trapezoid'&&compare(top,width)>0n?top:width;
        if(compare(dims.width,maxWidth)>0n||compare(dims.height,decimal(wall.height))>0n)errors.push(`${name}: размеры проёма превышают габариты выбранной стены.`);
        linked.set(o.wallId,add(linked.get(o.wallId)??zero(),area));
      }
    }
  }
  for(const [id,area] of linked)if(compare(area,wallAreas.get(id).area)>0n)errors.push(`${wallAreas.get(id).name}: площадь закреплённых проёмов больше площади этой стены.`);
  if(!errors.length&&compare(openings,gross)>=0n)errors.push('Площадь проёмов должна быть меньше общей площади поверхностей.');
  const net=!errors.length?sub(gross,openings):null;
  return {area:numeric(net),areaRatio:net,gross:errors.length?null:numeric(gross),openings:errors.length?null:numeric(openings),errors};
}
export function measurements(state) {
  const errors=Object.fromEntries(measureKeys.map(k=>[k,[]]));
  const ratios=Object.fromEntries(measureKeys.map(k=>[k,null]));
  const openings=state.openings??[],scopedTotals=Object.fromEntries(scopedMeasureKeys.map(k=>[k,zero()]));let revealLength=zero(),revealArea=zero(),sillLength=zero(),openingArea=zero(),openingAreaKnown=true;
  if(!openings.length)for(const k of ['revealArea','revealLength','sillLength'])errors[k].push('Добавьте проёмы с размерами и укажите тип и стороны откосов.');
  if(!openings.length)for(const key of scopedMeasureKeys)errors[key].push('Добавьте проёмы и укажите их тип, чтобы рассчитать отдельную группу.');
  for(const [i,o] of openings.entries()) {
    const name=o.name||`Проём ${i+1}`,dims=openingDimensions(o);
    if(dims)openingArea=add(openingArea,mul(mul(dims.width,dims.height),dims.count));else openingAreaKnown=false;
    if(!dims)for(const k of ['revealArea','revealLength'])errors[k].push(`${name}: нужны ширина, высота и целое количество больше нуля.`);
    const validSides=['3','4'].includes(o.sides);
    if(!validSides)for(const k of ['revealArea','revealLength'])errors[k].push(`${name}: выберите 3 или 4 стороны откоса.`);
    const depth=decimal(o.depth);
    if(!depth)errors.revealArea.push(`${name}: укажите глубину откоса в метрах (ноль — только явно).`);
    if(dims&&validSides) {
      const length=mul(o.sides==='3'?add(mul(dims.height,ratio(2n)),dims.width):mul(add(dims.height,dims.width),ratio(2n)),dims.count);
      revealLength=add(revealLength,length);if(depth)revealArea=add(revealArea,mul(length,depth));
    }
    if(!['window','door','other'].includes(o.type)) {
      errors.sillLength.push(`${name}: укажите тип проёма, чтобы определить оконные отливы.`);
      for(const key of scopedMeasureKeys)errors[key].push(`${name}: укажите тип проёма, чтобы не исключить неизвестное окно или дверь из отдельной группы.`);
    }
    else if(o.type==='window') {
      const width=decimal(o.width),count=decimal(o.count);
      if(!width||width.n===0n||!count||count.n===0n||count.d!==1n)errors.sillLength.push(`${name}: укажите ширину окна и целое количество больше нуля.`);
      else sillLength=add(sillLength,mul(width,count));
    }
    if(o.type==='window'||o.type==='door') {
      const areaKey=o.type==='window'?'windowRevealArea':'doorRevealArea',lengthKey=o.type==='window'?'windowRevealLength':'doorRevealLength';
      if(!dims)for(const key of [areaKey,lengthKey])errors[key].push(`${name}: нужны ширина, высота и целое количество больше нуля.`);
      if(!validSides)for(const key of [areaKey,lengthKey])errors[key].push(`${name}: выберите 3 или 4 стороны откоса.`);
      if(!depth)errors[areaKey].push(`${name}: укажите глубину откоса в метрах (ноль — только явно).`);
      if(dims&&validSides) {
        const length=mul(o.sides==='3'?add(mul(dims.height,ratio(2n)),dims.width):mul(add(dims.height,dims.width),ratio(2n)),dims.count);
        scopedTotals[lengthKey]=add(scopedTotals[lengthKey],length);if(depth)scopedTotals[areaKey]=add(scopedTotals[areaKey],mul(length,depth));
      }
      if(o.type==='door') {
        if(dims)scopedTotals.doorOpeningArea=add(scopedTotals.doorOpeningArea,mul(mul(dims.width,dims.height),dims.count));
        else errors.doorOpeningArea.push(`${name}: нужны ширина, высота и целое количество дверных проёмов больше нуля.`);
        const count=decimal(o.count);
        if(count?.n>0n&&count.d===1n)scopedTotals.doorOpeningCount=add(scopedTotals.doorOpeningCount,count);
        else errors.doorOpeningCount.push(`${name}: укажите целое количество дверных проёмов больше нуля.`);
      }
    }
  }
  for(const [key,value] of [['revealArea',revealArea],['revealLength',revealLength],['sillLength',sillLength]])if(!errors[key].length)ratios[key]=value;
  for(const key of scopedMeasureKeys)if(!errors[key].length)ratios[key]=scopedTotals[key];
  const labels={outerCorners:'длину наружных углов',innerCorners:'длину внутренних углов',baseLength:'длину цоколя',corniceLength:'длину карниза'};
  for(const key of directMeasures) {
    ratios[key]=decimal(state.measures?.[key]);
    if(!ratios[key])errors[key].push(`Укажите ${labels[key]} в метрах (ноль — только явно).`);
  }
  return {...Object.fromEntries(measureKeys.map(k=>[k,numeric(ratios[k])])),openingArea:openings.length&&openingAreaKnown?numeric(openingArea):null,errors,ratios};
}
export function quantity(item,area,measures,state) {
  if(supportModes.includes(item.mode))return state?numeric(supportRatio(item,state,geometry(state)).amount):null;
  if(item.mode==='area')return area;
  if(item.mode==='norm')return area!==null&&number(item.norm)!==null?area*number(item.norm):null;
  if(measureKeys.includes(item.mode))return measures?.[item.mode]??null;
  if(item.mode==='insulationVolume')return area!==null&&number(item.thickness)>0?area*number(item.thickness)/1000:null;
  if(item.mode==='panels')return area!==null&&number(item.coverWidth)>0&&number(item.coverHeight)>0?area/(number(item.coverWidth)*number(item.coverHeight)):null;
  return item.mode==='manual'?number(item.quantity):null;
}
const supportModes=['supportLength','supportBrackets','supportAnchors'];
// A preliminary gross rectangular grid. Opening framing, rail joints and structural design remain project inputs.
function supportRatio(item,state,geo) {
  const errors=[];let amount=zero();
  if(!geo.areaRatio)errors.push('сначала корректная площадь фасада');
  if(!['horizontal','vertical'].includes(item.orientation))errors.push('направление облицовки');
  const railPitch=decimal(item.railPitch),bracketPitch=decimal(item.bracketPitch),anchors=decimal(item.anchorsPerBracket);
  if(!railPitch||railPitch.n===0n)errors.push('шаг направляющих по проекту, м, больше нуля');
  if(item.mode!=='supportLength'&&(!bracketPitch||bracketPitch.n===0n))errors.push('шаг кронштейнов по проекту, м, больше нуля');
  if(item.mode==='supportAnchors'&&(!anchors||anchors.n===0n||anchors.d!==1n))errors.push('целое число анкеров на кронштейн по проекту');
  if(!item.normSource?.trim())errors.push('источник проектных шагов и крепления подсистемы');
  let walls=[];
  if(state.areaMode==='building')walls=[{shape:'rect',width:state.buildingLength,height:state.buildingHeight},{shape:'rect',width:state.buildingWidth,height:state.buildingHeight},{shape:'rect',width:state.buildingLength,height:state.buildingHeight},{shape:'rect',width:state.buildingWidth,height:state.buildingHeight}];
  else if(state.areaMode==='walls')walls=state.walls??[];
  else errors.push('для сетки нужны прямоугольные стены или габариты здания; выберите ручное количество / проектную норму для готовой площади');
  if(!walls.length&&!errors.length)errors.push('добавьте прямоугольные стены для расчёта сетки');
  if(walls.some(w=>w.shape!=='rect'))errors.push('для фронтонов и сложных стен нужна раскладка: выберите ручное количество или проектную норму');
  if(errors.length)return {amount:null,errors};
  for(const wall of walls) {
    const width=decimal(wall.width),height=decimal(wall.height);
    if(!width||width.n===0n||!height||height.n===0n)return {amount:null,errors:['для сетки нужны размеры каждой стены больше нуля']};
    const transverse=item.orientation==='horizontal'?width:height,span=item.orientation==='horizontal'?height:width;
    const railCount=add(ceil(div(transverse,railPitch)),ratio(1n));
    const value=item.mode==='supportLength'?mul(railCount,span):mul(railCount,add(ceil(div(span,bracketPitch)),ratio(1n)));
    amount=add(amount,item.mode==='supportAnchors'?mul(value,anchors):value);
  }
  if(!Number.isFinite(numeric(amount))||numeric(amount)>Number.MAX_SAFE_INTEGER)return {amount:null,errors:['слишком большая сетка подсистемы']};
  return {amount,errors};
}
function quantityRatio(item,geo,measures,state) {
  const errors=[];let amount=null;
  if(supportModes.includes(item.mode))return supportRatio(item,state,geo);
  if(item.mode==='manual') {amount=decimal(item.quantity);if(!amount)errors.push('количество');}
  else if(item.mode==='area') {amount=geo.areaRatio;if(!amount)errors.push('сначала площадь фасада');}
  else if(item.mode==='norm') {
    const norm=decimal(item.norm);if(!geo.areaRatio)errors.push('сначала площадь фасада');if(!norm)errors.push('расход на м²');if(geo.areaRatio&&norm)amount=mul(geo.areaRatio,norm);
  } else if(measureKeys.includes(item.mode)) {amount=measures.ratios[item.mode];errors.push(...measures.errors[item.mode]);}
  else if(item.mode==='insulationVolume') {
    const thickness=decimal(item.thickness);if(!geo.areaRatio)errors.push('сначала площадь фасада');if(!thickness||thickness.n===0n)errors.push('толщина этого слоя утеплителя, мм, больше нуля');if(geo.areaRatio&&thickness?.n>0n)amount=mul(mul(geo.areaRatio,thickness),ratio(1n,1000n));
  } else if(item.mode==='panels') {
    const width=decimal(item.coverWidth),height=decimal(item.coverHeight);if(!geo.areaRatio)errors.push('сначала площадь фасада');if(!width||width.n===0n||!height||height.n===0n)errors.push('полезная ширина и высота панели в метрах больше нуля');if(geo.areaRatio&&width?.n>0n&&height?.n>0n)amount=div(geo.areaRatio,mul(width,height));
  } else errors.push('способ расчёта количества');
  if(item.requiresNormSource&&!item.normSource?.trim())errors.push('источник нормы / проектного параметра');
  return {amount,errors};
}
function purchase(item,geo,measures,material,state) {
  const initial=quantityRatio(item,geo,measures,state),errors=[...initial.errors],netQty=numeric(initial.amount);
  let demand=initial.amount,needed=initial.amount,covered=zero(),purchaseAmount=initial.amount,packs=null;
  if(material) {
    if(filled(item.reserve)) {
      const reserve=decimal(item.reserve);if(!reserve)errors.push('запас, %');else if(demand)demand=mul(demand,mul(add(ratio(100n),reserve),ratio(1n,100n)));
    }
    const pieces=item.mode==='panels'||['шт.','шт'].includes(item.unit.trim());
    if(demand&&pieces)demand=ceil(demand);
    const stock=filled(item.stock)?decimal(item.stock):zero(),ordered=filled(item.ordered)?decimal(item.ordered):zero();
    if(!stock)errors.push('пригодный остаток для этого объекта');if(!ordered)errors.push('подтверждённый заказ для этого объекта');
    if(pieces&&stock?.d!==1n&&stock)errors.push('остаток в штуках должен быть целым');
    if(pieces&&ordered?.d!==1n&&ordered)errors.push('заказ в штуках должен быть целым');
    if(demand&&stock&&ordered) {const available=add(stock,ordered);covered=compare(available,demand)>0n?demand:available;needed=sub(demand,covered);}
    else needed=null;
    purchaseAmount=needed;
    if(purchaseAmount&&pieces)purchaseAmount=ceil(purchaseAmount);
    if(filled(item.pack)) {
      const pack=decimal(item.pack);
      if(!pack||pack.n===0n)errors.push('размер упаковки больше нуля');
      else if(pieces&&pack.d!==1n)errors.push('упаковка в штуках должна содержать целое количество');
      else if(purchaseAmount) {
        const count=ceil(div(purchaseAmount,pack));
        if(count.n>BigInt(Number.MAX_SAFE_INTEGER))errors.push('слишком много упаковок');
        else {packs=Number(count.n);purchaseAmount=mul(pack,count);}
      }
    }
    if(!['purchase','required'].includes(item.costBasis??'purchase'))errors.push('база стоимости материала');
  }
  const amount=material&&item.costBasis==='required'?demand:purchaseAmount;
  return {netQty,demandQty:errors.length?null:numeric(demand),coveredQty:errors.length?null:numeric(covered),neededQty:errors.length?null:numeric(needed),qty:errors.length?null:numeric(purchaseAmount),pricedQty:errors.length?null:numeric(amount),packs,amount:errors.length?null:amount,purchaseAmount:errors.length?null:purchaseAmount,errors};
}
function taxCalculation(state,totalCents) {
  const mode=state.taxMode??'unknown',rate=decimal(state.taxRate),errors=[];
  let amountCents=null,grandCents=null;
  if(!['unknown','none','included','onTop'].includes(mode))errors.push('Укажите допустимый режим НДС.');
  else if(mode==='unknown')errors.push('Уточните режим НДС перед финальным итогом.');
  else if(mode!=='none'&&!rate)errors.push('Укажите неотрицательную ставку НДС.');
  if(!errors.length&&totalCents!==null) {
    amountCents=mode==='none'?0:cents(mul(ratio(totalCents,100n),mode==='included'?div(rate,add(ratio(100n),rate)):mul(rate,ratio(1n,100n))));
    if(amountCents===null)errors.push('Слишком большая сумма НДС.');
    else {const grand=mode==='onTop'?totalCents+BigInt(amountCents):totalCents;if(grand>BigInt(Number.MAX_SAFE_INTEGER))errors.push('Слишком большой итог с НДС.');else grandCents=Number(grand);}
  }
  return {mode,rate:numeric(rate),amount:!errors.length&&amountCents!==null?amountCents/100:null,grandTotal:!errors.length&&grandCents!==null?grandCents/100:null,ready:!errors.length&&grandCents!==null,errors};
}
function compatibleUnit(item) {
  const expected=MODE_UNITS[item.mode],unit=item.unit.trim();
  if(!expected)return true;
  return unit===expected||(expected==='м²'&&unit==='m²')||(expected==='м³'&&unit==='m³');
}
export function calculate(state,scenarioKey=state.scenario) {
  const geo=geometry(state),measures=measurements(state),scenario=state.scenarios[scenarioKey],sections={};
  let active=0,complete=0,totalCents=0n;const missing=[],sourcesMissing=[],base=[],allowance=[],labor=[],external=[];
  for(const key of ['materials','works']) {
    const rows=scenario[key].map(item=>{
      const p=purchase(item,geo,measures,key==='materials',state),price=decimal(item.price),kind=item.rateKind??'unknown';
      const clientPrice=price&&key==='works'&&kind==='base'?mul(price,ratio(7n,5n)):price;
      const valueCents=p.amount&&clientPrice?cents(mul(p.amount,clientPrice)):null;
      const purchaseValueCents=p.purchaseAmount&&clientPrice?cents(mul(p.purchaseAmount,clientPrice)):null;
      const errors=[...p.errors];
      if(!item.name.trim())errors.push('название');if(!item.unit.trim())errors.push('единица измерения');
      if(!compatibleUnit(item))errors.push(item.mode==='area'?'для площади нужна единица м²':`для выбранного способа нужна единица ${MODE_UNITS[item.mode]}`);
      if(!price)errors.push('цена за единицу');
      if(key==='works'&&!['base','included','external'].includes(kind))errors.push('тип ставки / разбивка комплекта');
      if(p.amount&&price&&valueCents===null)errors.push('слишком большое значение');
      if(key==='materials'&&p.purchaseAmount&&price&&purchaseValueCents===null)errors.push('слишком большая стоимость закупки');
      let baseCents=null,allowanceCents=null;
      if(key==='works'&&valueCents!==null&&!errors.length&&kind!=='external') {
        baseCents=kind==='base'?cents(mul(p.amount,price)):cents(mul(mul(p.amount,price),ratio(5n,7n)));
        allowanceCents=valueCents-baseCents;
      }
      const date=item.priceDate??'',parsedDate=new Date(date+'T00:00:00Z');
      const sourceConfirmed=!!item.source?.trim()&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(parsedDate.getTime())&&parsedDate.toISOString().slice(0,10)===date;
      if(item.enabled) {
        active++;
        if(!errors.length&&valueCents!==null){complete++;totalCents+=BigInt(valueCents);if(!sourceConfirmed)sourcesMissing.push({id:item.id,name:item.name,section:key});
          if(key==='works'){if(kind==='external')external.push(valueCents);else{base.push(baseCents);allowance.push(allowanceCents);labor.push(valueCents);}}
        }else missing.push({id:item.id,name:item.name||'Без названия',fields:errors,section:key});
      }
      return {...item,...p,amount:undefined,purchaseAmount:undefined,priceValue:number(item.price),clientPriceValue:numeric(clientPrice),valueCents:errors.length?null:valueCents,value:errors.length||valueCents===null?null:valueCents/100,purchaseValue:errors.length||purchaseValueCents===null?null:purchaseValueCents/100,baseCents,allowanceCents,sourceConfirmed,errors};
    });
    const completeRows=rows.filter(r=>r.enabled&&!r.errors.length&&r.valueCents!==null),subtotalCents=sumCents(completeRows.map(r=>r.valueCents));
    sections[key]={rows,subtotal:subtotalCents===null?null:subtotalCents/100,priced:completeRows.length,active:rows.filter(r=>r.enabled).length,complete:completeRows.length};
  }
  const safe=totalCents<=BigInt(Number.MAX_SAFE_INTEGER);
  if(!safe)missing.push({name:'Итог',fields:['слишком большое суммарное значение'],section:'works'});
  const ready=geo.area!==null&&active>0&&complete===active&&safe,total=complete&&safe?Number(totalCents)/100:null;
  const value=list=>{const v=sumCents(list);return v===null?null:v/100;};
  return {scenario:scenarioKey,geo,measurements:measures,sections,active,complete,missing,sourcesMissing,total,tax:taxCalculation(state,total===null?null:totalCents),overflow:!safe,ready,confirmed:ready&&!sourcesMissing.length,pricing:{base:value(base),allowance:value(allowance),clientLabor:value(labor),external:value(external)}};
}
const rowInputFields=['quantity','norm','price','reserve','pack','stock','ordered','thickness','coverWidth','coverHeight','normSource','source','priceDate','railPitch','bracketPitch','anchorsPerBracket','kitKey','kitIdentity','techNote'];
export function copyCommonRows(state) {
  const from=state.scenario,to=from==='insulated'?'bare':'insulated';let copied=0,skipped=0;
  for(const key of ['materials','works'])for(const source of state.scenarios[from][key]) {
    if(!source.enabled||filled(source.kitKey)||source.mode==='insulationVolume'||/утеплит|утеплен/i.test(source.name)||!rowInputFields.some(k=>filled(source[k])))continue;
    const target=state.scenarios[to][key].find(r=>r.name===source.name&&r.unit===source.unit&&r.mode!=='insulationVolume');
    if(!target)continue;
    if(!target.enabled||rowInputFields.some(k=>filled(target[k]))||(target.costBasis??'purchase')!=='purchase'){skipped++;continue;}
    Object.assign(target,{...source,id:target.id});copied++;
  }
  return {copied,skipped,to};
}
export function csv(state) {
  const c=calculate(state),system=state.scenarios[state.scenario].system;
  const label=card=>card?[card.manufacturer,card.name].filter(Boolean).join(' · '):'';
  const insulationRows=c.sections.materials.rows.filter(r=>r.enabled&&r.mode==='insulationVolume'&&/^insulation:layer[12]$/.test(r.kitKey||''));
  const exactThickness=insulationRows.length&&insulationRows.every(r=>decimal(r.thickness)?.n>0n)?numeric(insulationRows.reduce((sum,r)=>add(sum,decimal(r.thickness)),zero())):'';
  const cladding=system?.applied?label(system.variant||system.selection):state.cladding;
  const insulationName=system?.applied?insulationRows.map(r=>label(r.kitKey==='insulation:layer2'?(system.insulationSelection2||system.insulationSelection):system.insulationSelection)).filter(Boolean).join(' / '):state.insulationType;
  const thickness=system?.applied?exactThickness:state.thickness;
  const layerThickness=layer=>c.sections.materials.rows.find(r=>r.enabled&&r.kitKey===`insulation:layer${layer}`&&r.mode==='insulationVolume')?.thickness??'';
  const taxLabels={unknown:'Не указан',none:'Без НДС',included:'НДС включён',onTop:'НДС сверху'};
  const rows=[['ООО «СВОИ ЛЮДИ» · Иркутск — ВНУТРЕННИЙ РАСЧЁТ'],['Объект',state.project],['Адрес',state.address],['Вариант',state.scenario==='insulated'?'С утеплением':'Без утепления'],['Статус',!c.ready?'НЕПОЛНЫЙ РАСЧЁТ':c.confirmed?'Заполнено по введённым данным':'ПРЕДВАРИТЕЛЬНО — УТОЧНИТЕ ИСТОЧНИКИ ЦЕН'],['Чистая площадь, м²',c.geo.area??''],['Основание',state.substrate],['Облицовка',cladding],['Длина здания, м',state.buildingLength],['Ширина здания, м',state.buildingWidth],['Высота здания, м',state.buildingHeight],['Общая толщина утепления, мм',state.scenario==='insulated'?thickness:'Не применяется'],['Тип утеплителя',state.scenario==='insulated'?insulationName:'Не применяется'],['Подсистема',state.subsystem],['Вылет кронштейна',state.bracketOutreach],['Проект / спецификация',state.projectRef],['Условия цены',state.terms],['Режим НДС',taxLabels[c.tax.mode]],['Ставка НДС, %',state.taxRate],[]];
  if(system?.applied){
    rows.push(['ВЫБРАННАЯ СИСТЕМА'],['Профиль',system.variant?.name??''],['Производитель',system.variant?.manufacturer??''],['Направление облицовки',system.orientation==='vertical'?'Вертикальное':'Горизонтальное'],['Длина панели, м',system.panelLength],['Полезная ширина панели, м',system.usefulWidth],['Полная ширина панели, м',system.fullWidth],['Шаг направляющих по проекту, м',system.railPitch],['Шаг кронштейнов по проекту, м',system.bracketPitch],['Анкеров на кронштейн по проекту',system.anchorsPerBracket],['Источник проектных параметров',system.source],['Утеплитель',state.scenario==='insulated'?system.insulationSelection?.name??'':'Не применяется'],['Слой 1, мм',state.scenario==='insulated'?layerThickness('1'):''],['Слой 2, мм',state.scenario==='insulated'?layerThickness('2'):''],['Основание совместимости разных марок утепления',state.scenario==='insulated'?system.insulationCompatibilitySource??'':'']);
    for(const card of [system.variant,...(state.scenario==='insulated'?[system.insulationSelection,system.insulationSelection2]:[])].filter(Boolean)){
      rows.push(['Паспорт материала',card.manufacturer,card.name]);
      for(const line of card.mounting??[])rows.push(['Монтаж по выбранному материалу',line]);
      for(const line of card.limitations??[])rows.push(['Ограничение применения',line]);
      for(const ref of card.sources??[])rows.push(['Источник документации',ref.title,ref.url,ref.checked??'',ref.pages??'']);
    }
    rows.push(['Ограничение расчёта','Панели предварительно по площади до раскроя; сетка подсистемы по целым прямоугольным стенам без вычета проёмов. Обрамление проёмов, стыки и усиления проверяются по проектной раскладке.']);
  }
  for(const [key,title] of [['materials','МАТЕРИАЛЫ'],['works','РАБОТЫ']]) {
    rows.push([title],['Наименование','Ед.','Способ количества','Расход на м²','Источник нормы','Толщина слоя, мм','Полезная ширина панели, м','Полезная высота панели, м','Чистое количество','Запас, %','Потребность с запасом','Пригодный выделенный остаток','Подтверждённый выделенный заказ','Покрыто остатком / заказом','Не покрыто до упаковок','Размер упаковки','Упаковок','Новая закупка','База стоимости','Количество к расчёту','Исходная ставка, ₽','Тип ставки','Клиентская ставка, ₽','Сумма клиенту, ₽','Стоимость новой закупки, ₽','Источник цены','Дата цены','Что заполнить','Направление облицовки','Шаг направляющих, м','Шаг кронштейнов, м','Анкеров на кронштейн','Примечание технологии']);
    for(const r of c.sections[key].rows.filter(x=>x.enabled))rows.push([r.name,r.unit,MODE_LABELS[r.mode],r.mode==='norm'?r.norm:'',r.normSource,r.mode==='insulationVolume'?r.thickness:'',r.mode==='panels'?r.coverWidth:'',r.mode==='panels'?r.coverHeight:'',r.netQty??'',key==='materials'?r.reserve:'',r.demandQty??'',key==='materials'?r.stock:'',key==='materials'?r.ordered:'',key==='materials'?r.coveredQty??'':'',key==='materials'?r.neededQty??'':'',key==='materials'?r.pack:'',r.packs??'',r.qty??'',key==='materials'?(r.costBasis==='required'?'Вся потребность':'Новая закупка'):'Объём работ',r.pricedQty??'',r.priceValue??'',key==='works'?RATE_LABELS[r.rateKind]:'Материал',r.clientPriceValue??'',r.value??'',key==='materials'?r.purchaseValue??'':'',r.source,r.priceDate,r.errors.join(', '),r.orientation??'',r.railPitch??'',r.bracketPitch??'',r.anchorsPerBracket??'',r.techNote??'']);
    rows.push(['Сумма заполненных позиций',c.sections[key].subtotal??''],[]);
  }
  rows.push(['ИСХОДНАЯ ГЕОМЕТРИЯ'],['Режим площади',{building:'По габаритам здания',walls:'По стенам минус проёмы',direct:'Введённая площадь уже чистая'}[state.areaMode]]);
  if(state.areaMode==='building')rows.push(['Формула площади четырёх прямоугольных стен','2 × (длина + ширина) × высота − общая площадь проёмов; проёмы вычитаются один раз'],['Общая площадь четырёх стен, м²',c.geo.gross??''],['Вычтено проёмов, м²',c.geo.openings??''],['Ограничения геометрии','Без фронтонов; проверка привязки проёмов к конкретной стене доступна в режиме «По стенам». Сохранённые отдельные стены в этом режиме не используются.']);
  if(state.areaMode==='walls') {
    rows.push(['Поверхность','Форма','Ширина / нижнее основание, м','Верхнее основание, м','Высота, м']);
    for(const w of state.walls)rows.push([w.name,{triangle:'Треугольник',rect:'Прямоугольник',trapezoid:'Трапеция'}[w.shape],w.width,w.topWidth,w.height]);
  }
  rows.push(['Проём','Тип','Стена','Ширина, м','Высота, м','Количество','Глубина откоса, м','Сторон откоса']);
  for(const o of state.openings)rows.push([o.name,{window:'Окно',door:'Дверь',other:'Другой'}[o.type]??'',state.areaMode==='building'?'Не используется в режиме по габаритам':state.walls.find(w=>w.id===o.wallId)?.name??'',o.width,o.height,o.count,o.depth,o.sides]);
  for(const k of measureKeys)rows.push([MODE_LABELS[k],c.measurements[k]??'',c.measurements.errors[k].join(', ')]);
  rows.push([],[c.ready?'ИТОГО ПО ВВЕДЁННЫМ ДАННЫМ':'СУММА ЗАПОЛНЕННЫХ ПОЗИЦИЙ',c.total??''],['НДС',c.tax.amount??''],['ИТОГО С УЧЁТОМ РЕЖИМА НДС',c.ready&&c.tax.ready?c.tax.grandTotal:''],['Базовая стоимость трудовой части',c.pricing.base??''],['Внутренний бюджет 40%',c.pricing.allowance??''],['Трудовая часть клиенту',c.pricing.clientLabor??''],['Внешние затраты без надбавки',c.pricing.external??''],['Недостающие данные',...c.geo.errors,...c.missing.map(x=>`${x.name}: ${x.fields.join(', ')}`),...c.tax.errors],['Источники цен не заполнены',...c.sourcesMissing.map(r=>r.name)],['Примечания',state.notes],['Проверка инженером',WARNING]);
  return '\ufeff'+rows.map(r=>r.map(v=>{let s=typeof v==='number'?new Intl.NumberFormat('ru-RU',{useGrouping:false,maximumFractionDigits:12}).format(v):String(v??'');if(/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}).join(';')).join('\r\n');
}
export function validateImport(value) {
  const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
  const str=x=>typeof x==='string'&&x.length<=5000;
  if(!record(value)||![1,2,3,4].includes(value.version)||!['insulated','bare'].includes(value.scenario)||!['direct','walls','building'].includes(value.areaMode))throw Error('Неверный формат проекта. Нужен файл, сохранённый этим калькулятором.');
  if(value.estimateKind!==undefined&&!['budget','standard'].includes(value.estimateKind))throw Error('Повреждён вид сметы.');
  if(value.sourceDocument!==undefined&&(typeof value.sourceDocument!=='string'||value.sourceDocument.length>1000))throw Error('Повреждён источник обмеров.');
  if(value.assumptions!==undefined&&(!Array.isArray(value.assumptions)||value.assumptions.length>200||value.assumptions.some(x=>typeof x!=='string'||x.length>1000)))throw Error('Повреждён список допущений.');
  for(const k of ['project','address','substrate','cladding','buildingHeight','thickness','terms','notes','directArea'])if(!str(value[k]))throw Error('Повреждены поля проекта.');
  for(const k of ['buildingLength','buildingWidth','insulationType','subsystem','bracketOutreach','projectRef','taxRate'])if(value[k]!==undefined&&!str(value[k]))throw Error('Повреждены дополнительные поля проекта.');
  if(value.taxMode!==undefined&&!['unknown','none','included','onTop'].includes(value.taxMode))throw Error('Повреждён режим НДС.');
  if(value.measures!==undefined&&(!record(value.measures)||directMeasures.some(k=>value.measures[k]!==undefined&&!str(value.measures[k]))))throw Error('Повреждены линейные измерения.');
  for(const key of ['walls','openings']) {
    if(!Array.isArray(value[key])||value[key].length>200)throw Error('Слишком много поверхностей или проёмов.');
    for(const r of value[key]) {
      if(!record(r)||!['id','name','width','height'].every(k=>str(r[k])))throw Error('Повреждены размеры проекта.');
      if(key==='walls') {if(!['rect','triangle','trapezoid'].includes(r.shape)||(r.topWidth!==undefined&&!str(r.topWidth)))throw Error('Повреждена форма поверхности.');}
      else if(!str(r.count)||['wallId','depth'].some(k=>r[k]!==undefined&&!str(r[k]))||(r.type!==undefined&&!['','window','door','other'].includes(r.type))||(r.sides!==undefined&&!['','3','4'].includes(r.sides)))throw Error('Повреждены параметры проёма.');
    }
  }
  const wallIds=new Set(value.walls.map(w=>w.id));
  for(const o of value.openings)if(filled(o.wallId)&&!wallIds.has(o.wallId))throw Error('Проём ссылается на неизвестную стену.');
  const duplicateWalls=value.walls.filter((w,i,all)=>all.findIndex(other=>other.id===w.id)!==i).map(w=>w.id);
  if(value.openings.some(o=>filled(o.wallId)&&duplicateWalls.includes(o.wallId)))throw Error('У связанных стен повторяются идентификаторы: невозможно однозначно привязать проёмы.');
  if(!record(value.scenarios))throw Error('Повреждены варианты расчёта.');
  for(const s of ['insulated','bare']) {
    if(!record(value.scenarios[s]))throw Error('Повреждён вариант расчёта.');
    if(value.scenarios[s].system!==undefined)validateSystemConfiguration(value.scenarios[s].system);
    for(const key of ['materials','works']) {
      const rows=value.scenarios[s][key];
      if(!Array.isArray(rows)||rows.length>200)throw Error('Повреждены позиции расчёта.');
      for(const r of rows)if(!record(r)||!['id','name','unit','quantity','norm','price'].every(k=>str(r[k]))||!Object.hasOwn(MODE_LABELS,r.mode)||typeof r.enabled!=='boolean'||rowInputFields.some(k=>r[k]!==undefined&&!str(r[k]))||(r.rateKind!==undefined&&!Object.hasOwn(RATE_LABELS,r.rateKind))||(r.costBasis!==undefined&&!['purchase','required'].includes(r.costBasis))||(r.orientation!==undefined&&!['','horizontal','vertical'].includes(r.orientation))||(r.requiresNormSource!==undefined&&typeof r.requiresNormSource!=='boolean'))throw Error('Повреждена строка расчёта.');
    }
  }
  const result=JSON.parse(JSON.stringify(value));result.version=4;
  for(const k of ['buildingLength','buildingWidth','insulationType','subsystem','bracketOutreach','projectRef','taxRate'])result[k]??='';
  result.taxMode??='unknown';result.measures??={};for(const k of directMeasures)result.measures[k]??='';
  const wallMap=new Map();for(const wall of result.walls){const old=wall.id;wall.id=uid();wall.topWidth??='';if(!wallMap.has(old))wallMap.set(old,wall.id);}
  for(const opening of result.openings){opening.id=uid();opening.wallId=filled(opening.wallId)?wallMap.get(opening.wallId):'';for(const k of ['type','depth','sides'])opening[k]??='';}
  for(const s of ['insulated','bare'])for(const key of ['materials','works'])for(const r of result.scenarios[s][key]) {
    r.id=uid();for(const k of rowInputFields)r[k]??='';r.costBasis??='purchase';
    r.rateKind??=key==='materials'?'external':r.price.trim()?'unknown':r.name==='Леса / средства доступа'?'external':'base';
    if(r.mode==='norm'&&!r.norm.trim()&&!r.quantity.trim()&&!r.price.trim()&&(r.name==='Облицовочный материал'||r.name==='Утеплитель — марку и толщину уточнить'))r.mode='area';
  }
  serializeProject(result);
  return result;
}

// Optional catalog settings are validated without changing legacy project versions.
export const SYSTEM_STRING_FIELDS=['familyId','variantId','orientation','panelLength','usefulWidth','fullWidth','reserve','railPitch','bracketPitch','anchorsPerBracket','fixingsPerM2','fastenerSource','layer1','layer2','insulationId','insulationId2','insulationCompatibilitySource','insulationReserve','insulationPack','insulationPack1','insulationPack2','insulationFixingsPerM2','insulationFixingSource','membraneOverlap','membranePack','source'];
export function validateSystemConfiguration(value) {
  const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x),str=x=>typeof x==='string'&&x.length<=5000;
  if(!record(value)||SYSTEM_STRING_FIELDS.some(k=>value[k]!==undefined&&!str(value[k])))throw Error('Повреждены параметры системы материалов.');
  for(const k of ['confirmed','includeMembrane','applied'])if(value[k]!==undefined&&typeof value[k]!=='boolean')throw Error('Повреждены признаки системы материалов.');
  if(value.orientation!==undefined&&!['','horizontal','vertical'].includes(value.orientation))throw Error('Повреждено направление монтажа.');
  for(const key of ['variant','selection','insulationSelection','insulationSelection2'])if(value[key]!==undefined) {
    const card=value[key];if(!record(card))throw Error('Повреждён паспорт материала.');
    for(const k of ['id','name','manufacturer','application','usefulWidth','fullWidth','minLength','maxLength'])if(card[k]!==undefined&&!str(card[k]))throw Error('Повреждён паспорт материала.');
    for(const k of ['mounting','accessories','limitations','orientations','layerRoles'])if(card[k]!==undefined&&(!Array.isArray(card[k])||card[k].length>50||card[k].some(x=>!str(x))))throw Error('Повреждена инструкция материала.');
    if(card.sources!==undefined&&(!Array.isArray(card.sources)||card.sources.length>30||card.sources.some(x=>!record(x)||!str(x.title)||!str(x.url)||!/^https?:\/\//i.test(x.url)||(x.checked!==undefined&&!str(x.checked))||(x.pages!==undefined&&!str(x.pages)))))throw Error('Повреждены источники материала.');
  }
  return value;
}
