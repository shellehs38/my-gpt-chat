import {calculate,WARNING,MODE_UNITS,number,assemblyInsulationThickness} from './engine.mjs';
import {getSystemSchema} from './system-kit.mjs';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=(n,max=12)=>n===null?'—':new Intl.NumberFormat('ru-RU',{maximumFractionDigits:max}).format(n);
const money=n=>`${fmt(n,2)} ₽`;
// Preserve entered decimal rates without passing their text through binary floats.
// A base labor rate may acquire a thirteenth decimal digit in its client rate.
function clientRate(r,key){
  if(r.errors.includes('тип ставки / разбивка комплекта')||r.priceValue===null)return '—';
  const text=String(r.price??'').trim().replace(/[\s\u00a0\u202f]/g,'').replace(',','.');
  if(!/^\d+(\.\d{1,12})?$/.test(text))return fmt(r.clientPriceValue);
  const [whole,part='']=text.split('.'),uplift=key==='works'&&r.rateKind==='base';
  const numerator=BigInt(whole+part)*(uplift?14n:1n),scale=part.length+(uplift?1:0),denominator=10n**BigInt(scale);
  const integer=new Intl.NumberFormat('ru-RU',{maximumFractionDigits:0}).format(numerator/denominator);
  const fraction=scale?String(numerator%denominator).padStart(scale,'0').replace(/0+$/,''):'';
  return integer+(fraction?','+fraction:'');
}
function clientSource(r,key){
  const source=r.source||'Источник не указан';
  if(key==='works'&&r.rateKind==='base'&&/базов|40\s*%|(?:бюджет|вознаграждени[ея])\s+(?:на\s+)?руководител/i.test(source))return 'Расчётная клиентская ставка (принято самостоятельно; источник исходной расценки хранится во внутреннем проекте)';
  return source;
}
function sourceReport(state){
  let html=typeof state.sourceDocument==='string'&&state.sourceDocument.trim()?`<p><b>Исходный документ:</b> ${esc(state.sourceDocument)}</p>`:'';
  const assumptions=Array.isArray(state.assumptions)?state.assumptions.filter(x=>typeof x==='string'&&x.trim()):[];
  if(assumptions.length)html+='<h2>Допущения и самостоятельно добавленные данные</h2><ul>'+assumptions.map(x=>`<li>${esc(x.trim().startsWith('(')&&x.trim().endsWith(')')?x:`(${x})`)}</li>`).join('')+'</ul>';
  return html;
}
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const textList=value=>Array.isArray(value)?value.filter(item=>typeof item==='string'&&item.trim()):[];
const materialName=card=>record(card)?[card.manufacturer,card.name].filter(value=>typeof value==='string'&&value.trim()).join(' · '):'';
function sumThickness(rows){
  if(!rows.length)return '';
  let total=0n;
  for(const row of rows){
    const text=String(row.thickness??'').trim().replace(/[\s\u00a0\u202f]/g,'').replace(',','.');
    if(!/^\d+(\.\d{1,12})?$/.test(text))return '';
    const [whole,part='']=text.split('.'),value=BigInt(whole+part.padEnd(12,'0'));
    if(value<=0n||value>1000000000000000000000000n)return '';total+=value;
  }
  const whole=total/1000000000000n,part=String(total%1000000000000n).padStart(12,'0').replace(/0+$/,'');
  return new Intl.NumberFormat('ru-RU',{maximumFractionDigits:0}).format(whole)+(part?','+part:'');
}
function projectMaterialMetadata(state){
  const scenario=state.scenarios?.[state.scenario],system=scenario?.system;
  if(!record(system))return {cladding:state.cladding,insulationType:state.insulationType,thickness:state.thickness};
  const schema=getSystemSchema(system.variant||system.selection,system);
  if(schema.integratedInsulation)return {cladding:materialName(system.variant||system.selection),insulationType:'Утепляющий сердечник включён в панель; отдельно не добавлен',thickness:system.panelCoreThickness||system.variant?.panelCoreThickness||''};
  const insulationRows=(scenario.materials||[]).filter(row=>row.enabled&&row.mode==='insulationVolume'&&/^(insulation:layer[12]|assembly:)/.test(row.kitKey||''));
  const insulationType=insulationRows.map(row=>{
    if(row.kitKey?.startsWith('assembly:'))return row.name;
    const outer=row.kitKey==='insulation:layer2',card=outer?(system.insulationSelection2||system.insulationSelection):system.insulationSelection;
    return `${materialName(card)||'Марка не указана'} (слой ${outer?'2':'1'})`;
  }).join('; ');
  const thickness=schema.assemblyMode?assemblyInsulationThickness(insulationRows):sumThickness(insulationRows);
  return {cladding:materialName(system.variant||system.selection),insulationType,thickness};
}
function sourceUrl(value){
  if(typeof value!=='string')return null;
  try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.href:null;}catch{return null;}
}
function materialCard(card,id,title){
  if(!record(card))return '';
  let html=`<section id="${id}" class="material-card"><h3>${esc(title)}: ${esc(card.name||'Материал не указан')}</h3><p><b>Производитель:</b> ${esc(card.manufacturer||'Не указан')}</p>`;
  if(typeof card.application==='string'&&card.application.trim())html+=`<p><b>Область применения:</b> ${esc(card.application)}</p>`;
  for(const [key,label] of [['mounting','Конструктив и монтаж'],['accessories','Комплектующие по системе'],['limitations','Ограничения и условия применения']]){
    const items=textList(card[key]);if(items.length)html+=`<h4>${label}</h4><ul>${items.map(item=>`<li>${esc(item)}</li>`).join('')}</ul>`;
  }
  const sources=Array.isArray(card.sources)?card.sources.filter(record):[];
  if(sources.length){
    html+='<h4>Документация материала</h4><ul>';
    for(const source of sources){const url=sourceUrl(source.url);html+=`<li>${url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(source.title||url)}</a>`:esc(source.title||'Ссылка не указана')}${source.pages?` · страницы: ${esc(source.pages)}`:''}${source.checked?` · дата проверки источника: ${esc(source.checked)}`:''}</li>`;}
    html+='</ul>';
  }else html+='<p>Документация конкретного продукта не приложена. Уточните её до применения.</p>';
  return html+'</section>';
}
function systemReport(state){
  const system=state.scenarios?.[state.scenario]?.system;
  if(!record(system))return '';
  if((system.variant||system.selection)?.assembly)return assemblySystemReport(state,system);
  if((system.variant||system.selection)?.systemKind)return typedSystemReport(state,system);
  const variant=record(system.variant)?system.variant:system.selection;
  const value=(key,suffix='')=>system[key]!==undefined&&String(system[key]).trim()!==''?esc(system[key])+suffix:'Не задано';
  const orientation={horizontal:'Горизонтально',vertical:'Вертикально'}[system.orientation]||'Не задано';
  let html='<h2>Паспорт выбранных материалов</h2><p>Сохранённый состав комплекта для текущего варианта расчёта. Источники технологии и источники цен учитываются отдельно.</p>';
  html+=`<p><b>Направление панелей:</b> ${orientation} · <b>Полезная ширина:</b> ${value('usefulWidth',' м')} · <b>Полная ширина:</b> ${value('fullWidth',' м')} · <b>Заказная длина панели:</b> ${value('panelLength',' м')}</p><p>Панели считаются в штуках по полезной площади, затем учитываются заданные запас, остаток и упаковка. Цена панели в строке материалов задаётся за одну штуку. Это предварительная потребность до раскладки, стыков и раскроя.</p>`;
  html+=`<p><b>Шаг направляющих:</b> ${value('railPitch',' м')} · <b>Шаг кронштейнов вдоль направляющей:</b> ${value('bracketPitch',' м')} · <b>Анкеров на кронштейн:</b> ${value('anchorsPerBracket')}</p><p>Сетка подсистемы рассчитывается по прямоугольным стенам до вычета проёмов. Направляющие расположены поперёк панелей: количество на стене = округление вверх(поперечный размер / шаг) + 1; длина = количество × продольный размер. Кронштейны на направляющей = округление вверх(её длина / шаг кронштейнов) + 1. Дополнительное обрамление проёмов, усиления, стыки и особые узлы в эту сетку не включены и требуют отдельных проектных позиций.</p>`;
  if(typeof system.source==='string'&&system.source.trim())html+=`<p><b>Основание параметров подсистемы:</b> ${esc(system.source)}</p>`;
  html+=materialCard(variant,'system-cladding-card','Облицовка');
  if(state.scenario==='insulated'){
    const layerThickness=layer=>{
      const row=state.scenarios[state.scenario].materials.find(item=>item.mode==='insulationVolume'&&item.kitKey===`insulation:layer${layer}`),thickness=row&&sumThickness([row]);
      return thickness?`${esc(thickness)} мм${row.enabled?'':' (позиция отключена)'}`:'Не задано';
    };
    html+=`<p><b>Толщина слоя 1:</b> ${layerThickness('1')} · <b>Толщина слоя 2:</b> ${layerThickness('2')}</p><p>Толщины приведены по текущим строкам материалов. Каждый слой утеплителя рассчитан отдельной строкой: чистая площадь × толщина слоя / 1000. В двухслойном решении стыки плит слоёв смещают относительно друг друга по монтажной карте выбранного материала. Толщина и допустимость решения подтверждаются проектом.</p>`;
    const twoLayers=system.layer2!==undefined&&String(system.layer2).trim()!=='';
    html+=materialCard(system.insulationSelection||{},'system-insulation-card',twoLayers?'Утеплитель · слой 1 (внутренний)':'Утеплитель · слой 1');
    if(twoLayers){
      const outer=record(system.insulationSelection2)?system.insulationSelection2:system.insulationSelection;
      html+=materialCard(outer||{},'system-insulation-card-2','Утеплитель · слой 2 (наружный)');
    }
  }
  if(system.includeMembrane)html+=`<p><b>Мембрана включена:</b> добавка к площади ${value('membraneOverlap','%')}; упаковка ${value('membranePack',' м²')}. Мембрана применяется только при наличии её в проектной системе; инструкция сайдинга сама по себе не подтверждает её допустимость.</p>`;
  return html;
}
function assemblySystemReport(state,system){
  const variant=system.variant||system.selection,schema=getSystemSchema(variant,system),values=system.assemblyValues||{};
  let html=`<h2>Паспорт выбранной технологии</h2><p><b>Система:</b> ${esc(schema.title)}</p><h3>Состав по операциям</h3><ol>`;
  for(const entry of schema.assembly){const enabled=[...(state.scenarios[state.scenario].materials||[]),...(state.scenarios[state.scenario].works||[])].some(r=>r.enabled&&(r.kitKey===`assembly:${entry.id}`||r.kitKey===`work:assembly:${entry.id}`));
    html+=`<li><b>${esc(entry.name)}</b> · ${enabled?'Включена':'Не включена в расчёт'} · ${esc(entry.unit)}${entry.techNote?`<br>${esc(entry.techNote)}`:''}</li>`;
  }
  html+='</ol><h3>Параметры и источники</h3><dl>';
  for(const field of schema.assemblyFields){const raw=values[field.id]||'',value=field.type==='select'?(field.options.find(x=>x.id===raw)?.label||raw):raw;html+=`<dt>${esc(field.label)}</dt><dd>${String(value).trim()?esc(value):'Не задано'}</dd>`;}
  html+='</dl><p>Материалы считаются в единицах выбранных позиций: м² облицовки, кг или л составов, м³ утепления и штуки кирпича. Запас, выделенные остатки, открытые заказы и упаковки относятся к материалам; объёмы работ считаются отдельно по чистой геометрии.</p>';
  if(schema.kind==='masonry')html+='<p>Количество кирпича = чистая площадь / ((длина кирпича + вертикальный шов) × (высота кирпича + горизонтальный шов)); размеры модуля переводятся из миллиметров в метры. Закупка округляется до целых штук и выбранной упаковки. Раскладка, углы, перевязка, проёмы, опоры и связи уточняются проектом.</p>';
  for(const note of schema.notes)html+=`<p>${esc(note)}</p>`;
  return html+materialCard(variant,'system-cladding-card','Материалы, последовательность монтажа и ограничения');
}
function typedSystemReport(state,system){
  const variant=system.variant||system.selection,schema=getSystemSchema(variant,system),value=key=>String(system[key]??'').trim()?esc(system[key]):'Не задано';
  const labels={panelLength:'Длина / высота модуля панели, м',usefulWidth:'Полезная ширина модуля, м',fullWidth:'Полная ширина изделия, м',railPitch:'Шаг обрешётки / направляющих, м',bracketPitch:'Шаг кронштейнов, м',anchorsPerBracket:'Анкеров на кронштейн',source:'Основание проектных параметров',directFastenersPerM2:'Крепёж к основанию, шт./м²',directFastenerSource:'Источник крепежа к основанию',fixingsPerM2:'Крепёж облицовки, шт./м²',fastenerSource:'Источник нормы крепежа',clipsPerM2:'Клипсы / кляммеры, шт./м²',clipSource:'Источник нормы клипс',adhesiveNorm:'Расход клея на м²',adhesiveSource:'Источник расхода клея',primerNorm:'Расход грунта на м²',primerSource:'Источник расхода грунта',groutNorm:'Расход заполнителя швов на м²',groutSource:'Источник нормы заполнителя',sealantNorm:'Расход герметизации на м²',sealantSource:'Источник нормы герметизации',coatingNorm:'Расход защитного покрытия на один слой и м²',coatingLayers:'Число слоёв покрытия',coatingSource:'Источник защитного покрытия',substrateNorm:'Расход основания на м²',substrateSource:'Источник расхода основания',subsystemNorm:'Расход каркаса / направляющих, м.п./м²',subsystemSource:'Источник проектной спецификации',jointStripNorm:'Расход нащельников, м.п./м²',jointStripSource:'Источник расхода нащельников',panelCoreThickness:'Толщина встроенного сердечника, мм'};
  let html=`<h2>Паспорт выбранных материалов</h2><p><b>Система:</b> ${esc(schema.title)} · <b>Монтаж:</b> ${esc(schema.methodOptions.find(x=>x.id===schema.method)?.label||'Не указан')}</p><dl>`;
  for(const key of schema.fieldKeys)if(labels[key])html+=`<dt>${labels[key]}</dt><dd>${value(key)}</dd>`;
  if(schema.kind==='seam')html+=`<dt>Основание фальца</dt><dd>${esc(schema.baseOptions.find(x=>x.id===system.baseType)?.label||'Не выбрано')}</dd>`;
  if(schema.kind==='wood'&&!schema.coating)html+='<dt>Дополнительное покрытие древесины</dt><dd>Не добавлено: '+value('coatingSource')+'</dd>';
  html+='</dl><p>Количество панелей предварительное, до раскладки, стыков и раскроя. Цена панели — за штуку. Расходы и цены не назначаются по одному названию материала.</p>';
  if(schema.grid)html+='<p>Обрешётка / направляющие рассчитаны по предварительной сетке целых прямоугольных стен до вычета проёмов. Количество направляющих = округление вверх(поперечный размер стены / шаг) + 1. Обрамление проёмов, усиления и стыки требуют проектной раскладки.</p>';
  for(const note of schema.notes)html+=`<p>${esc(note)}</p>`;
  html+=materialCard(variant,'system-cladding-card','Облицовка и технология выбранного материала');
  if(state.scenario==='insulated'&&schema.externalInsulation){
    for(const layer of ['1','2']){const r=state.scenarios[state.scenario].materials.find(x=>x.kitKey===`insulation:layer${layer}`);if(!r)continue;html+=`<p><b>Слой утеплителя ${layer}:</b> ${esc(sumThickness([r])||'Не задано')} мм${r.enabled?'':' (отключён)'}. Объём = чистая площадь × толщина / 1000; запас и упаковки учитываются только в материале.</p>`;html+=materialCard(layer==='1'?system.insulationSelection:(system.insulationSelection2||system.insulationSelection),layer==='1'?'system-insulation-card':'system-insulation-card-2',`Утеплитель · слой ${layer}`);}
    if(system.insulationCompatibilitySource)html+=`<p><b>Основание совместимости слоёв:</b> ${esc(system.insulationCompatibilitySource)}</p>`;
  }
  return html;
}
function rowTechnology(r){
  const key=typeof r.kitKey==='string'?r.kitKey:'';
  let html='';
  if(key.startsWith('assembly:')||key.startsWith('work:assembly:')||key==='siding:panels'||key==='work:siding'||/^(surface:|mount:|seam:|sandwich:|work:(coating|adhesive|primer|grout|joint-sealant|sandwich-sealing|seam-base|fabrication))/.test(key))html='<br><small><a href="#system-cladding-card">Технология выбранной облицовки</a></small>';
  else if(key==='insulation:layer1'||key==='work:insulation1')html='<br><small><a href="#system-insulation-card">Технология утеплителя слоя 1</a></small>';
  else if(key==='insulation:layer2'||key==='work:insulation2')html='<br><small><a href="#system-insulation-card-2">Технология утеплителя слоя 2</a></small>';
  if(r.areaSource)html+=`<br><small>Источник площади участка: ${esc(r.areaSource)}</small>`;
  if(typeof r.techNote==='string'&&r.techNote.trim())html+=`<br><small>${esc(r.techNote)}</small>`;
  return html;
}
const status=c=>!c.ready?'НЕПОЛНЫЙ РАСЧЁТ — есть незаполненные значения':!c.tax?.ready?'ПРЕДВАРИТЕЛЬНО — уточните налоговые условия':c.confirmed?'Заполнено по введённым данным; требуется проверка':'ПРЕДВАРИТЕЛЬНО — уточните источники и даты цен';
const units={windowRevealArea:'Площадь откосов окон',windowRevealLength:'Длина откосов окон',doorOpeningArea:'Площадь дверных проёмов',doorOpeningCount:'Количество дверных проёмов',doorRevealArea:'Площадь откосов дверных проёмов',doorRevealLength:'Длина откосов дверных проёмов',revealArea:'Откосы всех проёмов — общий замер',revealLength:'Откосы всех проёмов — общая длина',sillLength:'Отливы окон',outerCorners:'Наружные углы',innerCorners:'Внутренние углы',baseLength:'Старт / цоколь',corniceLength:'Финиш / карниз'};
const shapeNames={rect:'Прямоугольник',triangle:'Треугольник',trapezoid:'Трапеция'};
const taxNames={unknown:'Не определены',none:'Без начисления НДС',included:'НДС включён в цены',onTop:'НДС начисляется сверху'};
function basisFormula(r){
  let area=(r.requiresAreaOverride||r.areaOverride)?`Площадь участка ${esc(r.areaOverride||'—')} м²`:'Чистая площадь';
  if(r.requiresAreaDeduction||r.areaDeduction)area=`(${area} − исключённый участок ${esc(r.areaDeduction||'—')} м²)`;
  if(r.mode==='norm')return `${area} × ${esc(r.norm||'—')} ${esc(r.unit)}/м²${r.requiresNormFactor||r.normFactor?` × ${esc(r.factorLabel||'число слоёв')} ${esc(r.normFactor||'—')}`:''}`;
  if(r.mode==='area')return area;
  if(r.mode==='insulationVolume')return `${area} × толщина слоя ${esc(r.thickness||'—')} мм / 1000`;
  if(r.mode==='panels'&&r.coverageKind==='masonry')return `${area} / кладочный модуль ${esc(r.coverWidth||'—')} × ${esc(r.coverHeight||'—')} м, включая швы; закупка до раскладки`;
  if(r.mode==='panels')return `${area} / полезный размер панели ${esc(r.coverWidth||'—')} × ${esc(r.coverHeight||'—')} м; предварительно до раскладки`;
  if(['supportLength','supportBrackets','supportAnchors'].includes(r.mode)){
    const direction=r.orientation==='vertical'?'Горизонтальные направляющие':'Вертикальные направляющие';
    const base=`${direction}; шаг ${esc(r.railPitch||'—')} м; по каждой прямоугольной стене, без вычета проёмов`;
    if(r.mode==='supportLength')return `${base}; сумма длин направляющих по сетке`;
    const brackets=`${base}; кронштейны с шагом ${esc(r.bracketPitch||'—')} м, включая концы направляющей`;
    return r.mode==='supportAnchors'?`${brackets}; × ${esc(r.anchorsPerBracket||'—')} анкеров на кронштейн`:brackets;
  }
  return units[r.mode]||'Количество задано';
}
function geometryReport(state,c){
  let html='<h2>Обмеры стен и проёмов</h2><p>Площадь стен считается по ширине и высоте поверхностей за вычетом проёмов. Откосы не входят в площадь стен и рассчитываются отдельными позициями по своим размерам.</p>';
  if(state.areaMode==='building'){
    html+=`<p><b>Режим: по габаритам прямоугольного здания.</b> Длина здания: ${esc(state.buildingLength||'—')} м; ширина здания: ${esc(state.buildingWidth||'—')} м; высота стен до карниза: ${esc(state.buildingHeight||'—')} м.</p><p>Четыре прямоугольные стены: 2 × (длина + ширина) × высота − площадь всех проёмов. До вычета: ${fmt(c.geo.gross)} м²; проёмы: ${fmt(c.geo.openings)} м²; чистая площадь: ${fmt(c.geo.area)} м². Проёмы вычитаются один раз.</p><p>Фронтоны, пристройки и сложная форма этим режимом не учитываются. Для их обмера и проверки проёмов конкретной стены используйте режим «По стенам и проёмам». Сохранённые отдельные стены и привязки в расчёте по габаритам не используются.</p>`;
  }else if(state.areaMode==='walls'){
    html+='<table><thead><tr><th>Поверхность</th><th>Форма</th><th>Ширина фасада / основание, м</th><th>Верх трапеции, м</th><th>Высота фасада, м</th></tr></thead><tbody>';
    for(const w of state.walls)html+=`<tr><td>${esc(w.name)}</td><td>${shapeNames[w.shape]||'—'}</td><td>${esc(w.width||'—')}</td><td>${w.shape==='trapezoid'?esc(w.topWidth||'—'):'—'}</td><td>${esc(w.height||'—')}</td></tr>`;
    html+='</tbody></table>';
  }else html+='<p>Введена готовая чистая площадь. Приведённые ниже проёмы используются для откосов и отливов и повторно из неё не вычитаются.</p>';
  for(const [title,list] of [['Окна и прочие проёмы',state.openings.filter(o=>o.type!=='door')],['Дверные проёмы',state.openings.filter(o=>o.type==='door')]]){
    if(!list.length)continue;
    html+=`<h3>${title}</h3><table><thead><tr><th>Проём / поверхность</th><th>Тип</th><th>Ширина × высота, м</th><th>Количество</th><th>Глубина откоса, м</th><th>Отделываемые стороны</th></tr></thead><tbody>`;
    for(const o of list){const wall=state.walls.find(w=>w.id===o.wallId);html+=`<tr><td>${esc(o.name)}<br>${state.areaMode==='building'?'Общий вычет из четырёх стен':esc(wall?.name||'Привязка не указана')}</td><td>${{window:'Окно',door:'Дверь',other:'Другое'}[o.type]||'Не указан'}</td><td>${esc(o.width||'—')} × ${esc(o.height||'—')}</td><td>${esc(o.count||'—')}</td><td>${esc(o.depth||'—')}</td><td>${o.sides==='3'?'Верх и две боковые':o.sides==='4'?'Все четыре':'Не указаны'}</td></tr>`;}
    html+='</tbody></table>';
  }
  if(c.measurements){
    for(const [title,keys] of [['Откосы окон — отдельные объёмы',['windowRevealArea','windowRevealLength']],['Дверные проёмы — отдельные объёмы',['doorOpeningArea','doorOpeningCount','doorRevealArea','doorRevealLength']],['Остальные замеры и общие базы',['revealArea','revealLength','sillLength','outerCorners','innerCorners','baseLength','corniceLength']]]){
      html+=`<h2>${title}</h2><dl>`;for(const key of keys)html+=`<dt>${units[key]}</dt><dd>${fmt(c.measurements[key]??null)} ${MODE_UNITS[key]||'м.п.'}</dd>`;html+='</dl>';
    }
    html+='<p>Площадь дверного проёма (ширина × высота) и площадь его откосов (отделываемые стороны × глубина) — разные базы. Стоимость определяется отдельными включёнными позициями. Не учитывайте одни и те же откосы одновременно общей и отдельной строкой.</p>';
  }
  return html;
}
function taxReport(c){
  const t=c.tax;
  if(!t)return '<p>Налоговые условия не определены.</p>';
  return `<p><b>Налоговые условия:</b> ${taxNames[t.mode]||'Не определены'}${t.rate!==null&&t.rate!==undefined?` · ставка ${fmt(t.rate)}%`:''}</p><p>Выбранный режим и ставка применяются ко всем включённым позициям. Разные ставки или режимы требуют отдельных расчётов.</p><p>${t.mode==='included'?'В том числе НДС':'НДС к начислению'}: ${money(t.amount)}</p>${t.errors.length?`<p>Уточнить: ${esc(t.errors.join('; '))}</p>`:''}<p class="print-total">${c.ready&&t.ready?'Итого с учётом выбранных налоговых условий':'Полный итог не определён'}: ${c.ready&&t.ready?money(t.grandTotal):'—'}</p>`;
}
export function buildReport(state,date=new Date()) {
  const c=calculate(state),variants={insulated:calculate(state,'insulated'),bare:calculate(state,'bare')},metadata=projectMaterialMetadata(state),system=state.scenarios?.[state.scenario]?.system,schema=getSystemSchema(system?.variant||system?.selection,system||{});
  let html=`<div class="print-brand"><img src="./brand/logo-sl-approved-light.png" alt="Логотип СВОИ ЛЮДИ" width="1674" height="944"></div><h1>СВОИ ЛЮДИ · Расчёт фасадных работ</h1><p>Иркутск · ${esc(new Intl.DateTimeFormat('ru-RU',{timeZone:'Asia/Irkutsk'}).format(date))}</p><p><b>Объект:</b> ${esc(state.project||'Не указан')} · <b>Адрес:</b> ${esc(state.address||'Не указан')}</p><p><b>Система:</b> ${esc(schema.legacy?'вентилируемый фасад на металлической подсистеме':schema.title)} · ${state.scenario==='insulated'?'с утеплением':'без утепления'}</p><p><b>Чистая площадь:</b> ${fmt(c.geo.area)} м² · <b>Основание:</b> ${esc(state.substrate||'Не указано')} · <b>Облицовка:</b> ${esc(metadata.cladding||'Не указана')}</p><p>Высота здания: ${esc(state.buildingHeight||'не указана')} м${state.scenario==='insulated'?` · ${schema.assemblyMode?'Толщина основного слоя утепления':'Общая толщина утепления'}: ${esc(metadata.thickness||'не указана')} мм`:''}</p><p><b>${status(c)}</b></p>`;
  if(schema.legacy)html+=`<p><b>Подсистема:</b> ${esc(state.subsystem||'Не указана')} · <b>Вылет кронштейна:</b> ${esc(state.bracketOutreach||'Не указан')} мм · <b>Проект / версия:</b> ${esc(state.projectRef||'Не указан')}</p>`;
  else html+=`<p><b>Способ монтажа:</b> ${esc(schema.methodOptions.find(x=>x.id===schema.method)?.label||'Не указан')} · <b>Проект / версия:</b> ${esc(state.projectRef||'Не указан')}</p>`;
  if(state.scenario==='insulated')html+=`<p><b>Тип утепления:</b> ${esc(metadata.insulationType||'Не указан')}. Состав слоёв и толщина отражаются в соответствующих позициях.</p>`;
  if(state.estimateKind==='budget')html+=`<div class="print-warning"><b>ПРЕДВАРИТЕЛЬНАЯ БЮДЖЕТНАЯ СУММА</b>: ${money(c.total)} — ${c.ready?'сумма включённых позиций':'подытог заполненных позиций; есть пробелы'}. Это ориентир по введённым данным и допущениям. Полная цена договора не определена.${!c.tax.ready?' Налоговые условия требуют уточнения; дополнительный НДС не начислен.':''}</div>`;
  html+=sourceReport(state)+systemReport(state);
  for(const [key,title] of [['materials','Материалы'],['works','Работы']]) {
    html+=`<h2>${title}</h2><table><thead><tr><th>Наименование</th><th>Ед.</th><th>Основание количества</th><th>Количество</th><th>Цена за ед., ₽</th><th>Сумма, ₽</th><th>Источник / дата цены</th></tr></thead><tbody>`;
    for(const r of c.sections[key].rows.filter(r=>r.enabled)) {
      let formula=basisFormula(r);
      if(key==='materials'&&r.reserve.trim())formula+=` · запас ${esc(r.reserve)}%`;
      if(key==='materials'&&r.pack.trim())formula+=` · ${fmt(r.packs,0)} уп. по ${esc(r.pack)} ${esc(r.unit)}`;
      if(key==='materials')formula+=` · потребность с запасом ${fmt(r.demandQty)} ${esc(r.unit)} · доступный остаток ${esc(r.stock||'0')} · открытый заказ ${esc(r.ordered||'0')} · к закупке ${fmt(r.qty)} ${esc(r.unit)} · стоимость: ${r.costBasis==='required'?'вся потребность':'новая закупка'}`;
      if(r.normSource?.trim())formula+=` · основание: ${esc(r.normSource)}`;
      html+=`<tr><td>${esc(r.name||'Без названия')}${rowTechnology(r)}${r.errors.length?`<br><small>Уточнить: ${esc(r.errors.join(', '))}</small>`:''}</td><td>${esc(r.unit||'—')}</td><td>${formula}</td><td>${fmt(key==='materials'&&Object.hasOwn(r,'pricedQty')?r.pricedQty:r.qty)}</td><td>${clientRate(r,key)}</td><td>${fmt(r.value,2)}</td><td>${esc(clientSource(r,key))}<br>${esc(r.priceDate||'Дата не указана')}</td></tr>`;
    }
    html+=`</tbody></table><p>${title}: ${c.ready?'итого':'сумма заполненных позиций'} — ${money(c.sections[key].subtotal)}</p>`;
  }
  html+=`<p>Сумма заполненных позиций до выбранного налогового пересчёта: ${money(c.total)}</p>${taxReport(c)}<h2>Сравнение вариантов</h2><table><thead><tr><th>Вариант</th><th>Материалы</th><th>Работы</th><th>Итого / подытог позиций</th><th>Статус</th></tr></thead><tbody>`;
  for(const [key,title] of [['insulated','С утеплением'],['bare','Без утепления']]){const v=variants[key];html+=`<tr><td>${title}</td><td>${money(v.sections.materials.subtotal)}</td><td>${money(v.sections.works.subtotal)}</td><td>${money(v.total)}</td><td>${status(v)}</td></tr>`;}
  html+=`</tbody></table>${geometryReport(state,c)}<p>Количества показываются с точностью до 12 знаков после запятой; более длинные расчётные значения округлены только для отображения. Суммы строк рассчитаны по полной точности исходных данных и округлены до копеек; итог складывается из сумм строк.</p><p>Налоги применяются только по выбранным условиям и введённой ставке. Доставка и дополнительные расходы — только по включённым позициям. Пустой запас означает отсутствие добавленного запаса. Остатки и заказы должны быть пригодными и закреплёнными за этим объектом, без повторного распределения. Стоимость новой закупки не является автоматически стоимостью всей потребности.</p><p>Расчёт панелей по полезной площади предварительный до раскладки и раскроя. Толщина утепления и шаги крепления принимаются по проекту; калькулятор их не назначает.</p><p><b>Дополнительные условия:</b> ${esc(state.terms||'Не указаны')}</p><p><b>Примечания:</b> ${esc(state.notes||'—')}</p>${c.geo.errors.length?`<p>Геометрия: ${esc(c.geo.errors.join(' '))}</p>`:''}<div class="print-warning">${esc(WARNING)}</div>`;
  return html;
}

export function buildStandaloneReport(state,logo,date=new Date()) {
  if(!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(logo))throw Error('Нужен подлинный PNG-лейбл');
  const report=buildReport(state,date).replace('./brand/logo-sl-approved-light.png',logo);
  const css='body{font:14px/1.6 Arial,sans-serif;color:#23372f;max-width:1100px;margin:30px auto;padding:0 20px}h1{font-size:24px}h2{font-size:19px;margin-top:28px}.print-brand{text-align:center}.print-brand img{display:block;width:200px;height:auto;margin:0 auto}table{border-collapse:collapse;width:100%;font-size:12px}td,th{border:1px solid #ccd3c1;text-align:left;padding:8px;overflow-wrap:anywhere}th{background:#edf0e5}.print-warning{border:1px solid #b79c76;padding:15px;margin-top:25px}.print-total{font-size:22px;font-weight:bold}@media print{@page{size:A4 landscape;margin:14mm}body{font-size:10px;margin:0;padding:0}table{font-size:9px}tr{break-inside:avoid}.print-brand img{width:45mm}thead{display:table-header-group}}';
  return '<!doctype html><html lang="ru"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>СВОИ ЛЮДИ — Расчёт фасада</title><style>'+css+'</style></head><body>'+report+'</body></html>';
}
