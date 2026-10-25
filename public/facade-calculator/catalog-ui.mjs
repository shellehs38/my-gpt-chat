import {insulationCatalog} from './material-catalog.mjs';
import {claddingSystems,systemGroups,selectSystem} from './system-catalog.mjs';
import {defaultSystem,getSystemSchema,previewSystem,applySystem} from './system-kit.mjs';
import {calculate,initialState,number} from './engine.mjs';

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=v=>v==null?'—':new Intl.NumberFormat('ru-RU',{maximumFractionDigits:6}).format(v);
const list=items=>(items||[]).length?'<ul>'+items.map(x=>`<li>${esc(x)}</li>`).join('')+'</ul>':'';
const safeURL=u=>{try{const url=new URL(u);return url.protocol==='https:'&&!url.username&&!url.password?url.href:null;}catch{return null;}};
function sources(items){return '<ul class="catalog-sources">'+(items||[]).map(s=>{const url=safeURL(s.url);return `<li>${url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(s.title||'Документ производителя')}</a>`:esc(s.title||'Документ')} ${s.pages?`· стр. ${esc(s.pages)}`:''}<small>Проверено: ${esc(s.checked||'дата не указана')}</small></li>`;}).join('')+'</ul>';}
const projectFields={
  railPitch:'Шаг направляющих, м',bracketPitch:'Шаг кронштейнов вдоль направляющей, м',anchorsPerBracket:'Анкеров на кронштейн, шт.',
  fixingsPerM2:'Крепёж облицовки, шт./м²',fastenerSource:'Источник нормы крепежа облицовки',source:'Проект, техкарта и узел системы',
  directFastenersPerM2:'Крепление обрешётки / панели к основанию, шт./м²',directFastenerSource:'Источник нормы крепления к основанию',
  clipsPerM2:'Кляммеры / клипсы, шт./м²',clipSource:'Источник нормы клипс',
  adhesiveNorm:'Клей, кг/м²',adhesiveSource:'Источник расхода клея',groutNorm:'Затирка швов, кг/м²',groutSource:'Источник расхода затирки',
  primerNorm:'Грунтовка, л/м²',primerSource:'Источник расхода грунтовки',coatingNorm:'Защитное покрытие на один слой, л/м²',coatingLayers:'Количество слоёв покрытия',coatingSource:'Источник расхода и числа слоёв покрытия',
  sealantNorm:'Герметик / эластичная заделка, л/м²',sealantSource:'Источник расхода герметика',substrateNorm:'Основание фальцевой облицовки, м²/м²',substrateSource:'Источник расхода основания',
  subsystemNorm:'Направляющие / несущий каркас по спецификации, м.п./м²',subsystemSource:'Источник спецификации подсистемы',jointStripNorm:'Уплотнение стыков, м.п./м²',jointStripSource:'Источник расхода уплотнения стыков'
};
const productNormKeys=['railPitch','bracketPitch','anchorsPerBracket','fixingsPerM2','source','fastenerSource','directFastenersPerM2','directFastenerSource','clipsPerM2','clipSource','adhesiveNorm','adhesiveSource','groutNorm','groutSource','primerNorm','primerSource','coatingNorm','coatingLayers','coatingSource','sealantNorm','sealantSource','substrateNorm','substrateSource','subsystemNorm','subsystemSource','jointStripNorm','jointStripSource','panelCoreThickness','baseType'];

export function createCatalogUI({element,getState,onApply,onCreate,onNotice,onScenario}){
  const drafts=new WeakMap();
  const $=s=>element.querySelector(s);
  function scenarioDrafts(){const s=getState();if(!drafts.has(s))drafts.set(s,{});return drafts.get(s);}
  function adoptProduct(c,{variant:v,system},reset=false){
    if(reset){for(const key of productNormKeys)c[key]='';c.includeAdhesive=false;c.includeCoating=true;c.mountingMethod='';c.assemblyValues={};c.assemblyEnabled={};}
    c.systemId=system.id;
    c.usefulWidth=v.usefulWidth||'';c.fullWidth=v.fullWidth||'';
    if(reset||v.minLength&&v.minLength===v.maxLength)c.panelLength=v.suggestedLength||(v.minLength===v.maxLength?v.minLength:'')||'';
    if(!v.orientations?.includes(c.orientation))c.orientation=v.orientations?.[0]||'horizontal';
    const schema=getSystemSchema(v,c);
    if(schema.assemblyMode){
      c.assemblyValues={...(c.assemblyValues||{})};c.assemblyEnabled={...(c.assemblyEnabled||{})};
      for(const f of schema.assemblyFields)if(c.assemblyValues[f.id]===undefined)c.assemblyValues[f.id]=f.default||'';
      for(const entry of schema.assembly)if(entry.optional&&c.assemblyEnabled[entry.id]===undefined)c.assemblyEnabled[entry.id]=entry.enabledDefault===true;
    }
    if(!schema.methodOptions.some(x=>x.id===c.mountingMethod))c.mountingMethod=schema.defaultMethod;
    if(schema.baseOptions.length===1)c.baseType=schema.baseOptions[0].id;
  }
  function draft(){const s=getState(),byScenario=scenarioDrafts();if(!byScenario[s.scenario]){
    const saved=s.scenarios[s.scenario].system,c=structuredClone({...defaultSystem(),...(saved||{})});
    for(const key of ['variant','selection','insulationSelection','insulationSelection2'])delete c[key];
    const selected=selectSystem(c.systemId||'metal-siding',c.familyId,c.variantId);
    c.familyId=selected.family.id;c.variantId=selected.variant.id;
    // Viewing a saved manual product preserves its entered coverage and project norms.
    if(!saved)adoptProduct(c,selected);else {c.systemId=selected.system.id;if(!selected.variant.manual){c.usefulWidth=selected.variant.usefulWidth||'';c.fullWidth=selected.variant.fullWidth||'';}}
    if(!c.insulationId)c.insulationId=insulationCatalog.find(x=>!x.restricted&&x.layerRoles?.includes('single'))?.id||'';
    if(!c.insulationId2)c.insulationId2=insulationCatalog.find(x=>!x.restricted&&x.layerRoles?.includes('outer'))?.id||c.insulationId;
    byScenario[s.scenario]=c;
  }return byScenario[s.scenario];}
  function selected(){const c=draft(),selection=selectSystem(c.systemId,c.familyId,c.variantId);return {c,...selection,v:selection.variant,i:insulationCatalog.find(x=>x.id===c.insulationId),i2:insulationCatalog.find(x=>x.id===c.insulationId2),schema:getSystemSchema(selection.variant,c)};}
  function field(key,label,placeholder='',attrs=''){
    const text=key==='source'||/Source$/.test(key),limit=text?500:30;
    return `<label${text?' class="catalog-wide"':''}>${esc(label)}<input data-kit-field="${key}" value="${esc(draft()[key])}" ${text?'':'inputmode="decimal"'} maxlength="${limit}" placeholder="${esc(placeholder|| (text?'Проект / техкарта, лист и узел':'По проекту'))}" ${attrs}></label>`;
  }
  function select(key,label,options,value){return `<label>${esc(label)}<select data-kit-field="${key}">${options.map(x=>`<option value="${esc(x.id)}" ${x.id===value?'selected':''}>${esc(x.label||x.name)}</option>`).join('')}</select></label>`;}
  function card(v){return `<article class="catalog-product"><h3>${esc(v.manufacturer)} · ${esc(v.name)}</h3>${v.assembly?`<p class="hint">${esc(v.assemblyTitle||'Расчёт по слоям и операциям выбранной системы.')} Цена и единица каждого материала указываются отдельно.</p>`:`<dl><div><dt>Полезная / полная ширина</dt><dd>${v.usefulWidth?fmt(number(v.usefulWidth)):'По выбранному изделию'} / ${v.fullWidth?fmt(number(v.fullWidth)):'уточнить'} м</dd></div><div><dt>Длина по каталогу</dt><dd>${v.minLength?esc(v.minLength):'По проекту'}${v.maxLength?'–'+esc(v.maxLength)+' м':''}</dd></div></dl>`}<details data-mounting-instructions><summary>Конструктив и порядок монтажа</summary>${list(v.mounting)}<h4>Комплектующие</h4>${list(v.accessories)}<h4>Что проверить перед расчётом</h4>${list(v.limitations)}${sources(v.sources)}</details></article>`;}
  function insulation(c,i,i2){const opts=insulationCatalog.map(x=>({id:x.id,label:x.manufacturer+' · '+x.name}));const info=p=>`<div class="catalog-insulation"><p>${esc(p?.application||'Применимость подтвердите проектом.')}</p>${list(p?.mounting)}${list(p?.limitations)}${sources(p?.sources)}</div>`;
    return `<details class="catalog-settings" open><summary>Утеплитель и слои</summary>${select('insulationId','Первый слой / однослойное утепление',opts,c.insulationId)}${info(i)}${select('insulationId2','Второй слой — наружный (при заданной толщине)',opts,c.insulationId2)}<details><summary>Применимость второго слоя</summary>${info(i2)}</details><div class="catalog-grid">${field('layer1','Толщина первого слоя, мм')}${field('insulationPack1','Упаковка первого слоя, м³')}${field('layer2','Толщина второго слоя, мм','Пусто — один слой')}${field('insulationPack2','Упаковка второго слоя, м³')}${field('insulationReserve','Запас утеплителя, %','Не добавлен')}${field('insulationFixingsPerM2','Крепёж утеплителя, шт./м²')}${field('insulationCompatibilitySource','Основание совместимости разных марок')}${field('insulationFixingSource','Источник нормы крепежа утеплителя')}</div><button type="button" class="secondary-button" data-kit-two-layers>Задать два слоя 50 + 50 мм</button><p class="hint">Слои учитываются отдельно в м³ и работах, стыки — вразбежку. Марка и упаковка должны подходить каждому слою.</p><label class="catalog-check"><input type="checkbox" data-kit-field="includeMembrane" ${c.includeMembrane?'checked':''}> Включить ветрозащиту, предусмотренную системой</label><div class="catalog-grid">${field('membraneOverlap','Добавка на нахлёсты мембраны, %')}${field('membranePack','Площадь рулона мембраны, м²')}</div></details>`;
  }
  function normLabel(key,v,c){
    const units={adhesiveNorm:['Клей',v.adhesiveUnit||'кг'],groutNorm:[v.groutLabel||'Затирка швов',v.groutUnit||'кг'],primerNorm:['Грунтовка',v.primerUnit||'л'],coatingNorm:['Защитное покрытие на один слой',v.coatingUnit||'л'],sealantNorm:[v.sealantLabel||'Герметик / эластичная заделка',v.sealantUnit||'кг'],substrateNorm:['Основание фальцевой облицовки',c.baseType==='solid'?'м²':'м.п.']};
    if(units[key])return `${units[key][0]} — ${units[key][1]}/м²`;
    if(key==='fixingsPerM2'&&v.fastenerLabel)return v.fastenerLabel+' — шт./м²';
    if(key==='coatingSource'&&c.includeCoating===false)return 'Заводская отделка / основание отсутствия дополнительного покрытия';
    return projectFields[key];
  }
  function assemblyField(f,c){
    const value=c.assemblyValues?.[f.id]??'',help=f.help?`<small class="assembly-help">${esc(f.help)}</small>`:'';
    const attrs=`data-assembly-field="${esc(f.id)}"${f.required?' aria-required="true"':''}`;
    if(f.type==='select')return `<label>${esc(f.label)}<select ${attrs}>${(f.options||[]).map(o=>`<option value="${esc(o.id)}" ${o.id===value?'selected':''}>${esc(o.label)}</option>`).join('')}</select>${help}</label>`;
    return `<label${f.type==='text'?' class="catalog-wide"':''}>${esc(f.label)}<input ${attrs} value="${esc(value)}" maxlength="${f.type==='text'?5000:30}" ${f.type==='number'?'inputmode="decimal"':''} placeholder="${esc(f.placeholder||(f.type==='text'?'Документ, продукт и источник':'По проекту / техкарте'))}">${help}</label>`;
  }
  function assemblyForm(schema,c){
    if(!schema.assemblyMode)return '';
    const refs=['normKey','sourceKey','factorKey','thicknessKey','quantityKey','reserveKey','packKey','lengthKey','heightKey','jointWidthKey','jointHeightKey','workNormKey','workQuantityKey','areaKey','excludeAreaKey','areaSourceKey'];
    const referenced=new Set(schema.assembly.flatMap(e=>refs.map(key=>e[key]).filter(Boolean))),rendered=new Set();
    const common=schema.assemblyFields.filter(f=>!referenced.has(f.id));
    const stages=schema.assembly.map((entry,index)=>{
      const enabled=!entry.optional||(c.assemblyEnabled?.[entry.id]??entry.enabledDefault)===true;
      const keys=new Set(refs.map(key=>entry[key]).filter(Boolean));
      const fields=schema.assemblyFields.filter(f=>keys.has(f.id)&&!rendered.has(f.id));
      if(enabled)fields.forEach(f=>rendered.add(f.id));
      return `<fieldset class="assembly-stage" data-assembly-stage="${esc(entry.id)}"><legend>${index+1}. ${esc(entry.name)}</legend>${entry.optional?`<label class="catalog-check"><input type="checkbox" data-assembly-enable="${esc(entry.id)}" ${enabled?'checked':''}> Включить эту операцию по выбранному узлу</label>`:''}${enabled?`<p class="hint">${esc(entry.techNote||({area:'Количество — по чистой площади фасада.',norm:'Количество — площадь × расход по техкарте выбранного продукта.',insulationVolume:'Объём утеплителя — площадь × толщина в миллиметрах / 1000.',masonry:'Кирпич — по длине, высоте и швам кладочного модуля. Проёмы вычитаются один раз.',manual:'Количество — по проектной спецификации.'}[entry.mode]||'Количество — по отдельным замерам этой операции.'))}</p><div class="catalog-grid">${fields.map(f=>assemblyField(f,c)).join('')}</div>`:'<p class="hint">Операция не включена в предварительный состав.</p>'}</fieldset>`;
    }).join('');
    const mismatch=schema.scenarioMode!=='either'&&schema.scenarioMode!==getState().scenario;
    return `<section class="assembly-form" data-assembly-form><h3>Слои и операции этой системы</h3>${list(schema.notes)}${mismatch?`<div class="catalog-error">Выбранная система ${schema.scenarioMode==='insulated'?'содержит отдельный слой утепления':'рассчитывается без дополнительного утепления'}.<button type="button" class="secondary-button" data-kit-scenario="${esc(schema.scenarioMode)}">Перейти к варианту ${schema.scenarioMode==='insulated'?'с утеплением':'без утепления'}</button></div>`:''}${common.length?`<div class="catalog-grid">${common.map(f=>assemblyField(f,c)).join('')}</div>`:''}${schema.assembly.some(e=>e.coverage&&!e.reserveKey)?`<div class="catalog-grid">${field('reserve','Запас облицовки, %','Не добавлен')}</div>`:''}${stages}<p class="hint">Упаковка задаётся в единицах строки: кг, м², м³ или штуках. Запас относится к материалу и не увеличивает объём работ. Дополнительные узлы и подготовку включайте по документации выбранной системы.</p></section>`;
  }
  function render(){
    const {c,system,family,variant:v,families,i,i2,schema}=selected(),s=getState(),applied=s.scenarios[s.scenario].system;
    const category=`<label>Фасадная система<select data-kit-field="systemId">${systemGroups.map(g=>`<optgroup label="${esc(g.name)}">${claddingSystems.filter(x=>x.group===g.id).map(x=>`<option value="${esc(x.id)}" ${x.id===system.id?'selected':''}>${esc(x.name)}</option>`).join('')}</optgroup>`).join('')}</select></label>`;
    const sizes=schema.requiresType||schema.assemblyMode?'':`<details class="catalog-settings" open><summary>Размер изделия и закупка</summary><div class="catalog-grid">${select('orientation','Направление облицовки',(v.orientations||['horizontal','vertical']).map(id=>({id,label:id==='horizontal'?'Горизонтально':'Вертикально'})),c.orientation)}${field('panelLength','Длина заказываемого изделия, м',v.minLength&&v.maxLength?`${v.minLength}–${v.maxLength} м`:'По раскладке')}${field('usefulWidth',v.openJoint?'Рабочий модуль с проектным зазором, м':'Полезная ширина, м','По паспорту',v.manual?'':'readonly')}${field('fullWidth','Полная ширина, м','Справочно',v.manual?'':'readonly')}${field('reserve','Запас облицовки, %','Не добавлен')}</div><p class="hint">Штуки = чистая площадь / (рабочая ширина × длина), затем ваш запас и округление. Цена изделия — за штуку указанного размера. Раскрой, нахлёсты и стыки проверяются по раскладке. Размер исходного листа АКП не заменяет полезный размер готовой кассеты.</p></details>`;
    const project=schema.requiresType||schema.assemblyMode?'':`<details class="catalog-settings" open><summary>Монтаж и расход по проекту</summary><div class="catalog-grid">${select('mountingMethod','Способ монтажа',schema.methodOptions,schema.method)}${schema.kind==='seam'?select('baseType','Основание облицовки',schema.baseOptions,c.baseType):''}${schema.fieldKeys.filter(key=>Object.hasOwn(projectFields,key)).map(key=>field(key,normLabel(key,v,c))).join('')}</div>${schema.kind==='thermal'&&!v.adhesiveRequired?`<label class="catalog-check"><input type="checkbox" data-kit-field="includeAdhesive" ${c.includeAdhesive?'checked':''}> Добавить клей, если он предусмотрен выбранным узлом</label>`:''}${schema.kind==='wood'?`<label class="catalog-check"><input type="checkbox" data-kit-field="includeCoating" ${c.includeCoating!==false?'checked':''}> Добавить защитное покрытие для необработанной древесины</label>`:''}${list(schema.notes)}${schema.grid?'<p class="hint">Сетка по целым прямоугольным стенам предварительная: проёмы из подсистемы не вычитаются. Обрамления, усиления и стыки — по отдельной раскладке. Шаги не назначаются калькулятором.</p>':'<p class="hint">Для проектной подсистемы задайте расход со ссылкой на спецификацию либо заполните её количества вручную в смете после применения. Неизвестные нормы остаются пустыми.</p>'}</details>`;
    let thermal='';
    if(!schema.requiresType&&!schema.assemblyMode){if(schema.integratedInsulation)thermal=`<div class="catalog-product" data-integrated-core><h3>Утепляющий слой входит в изделие</h3>${v.coreThicknessOptions?.length?select('panelCoreThickness','Толщина встроенного утепляющего слоя, мм',[{id:'',label:'Выберите толщину по проекту'},...v.coreThicknessOptions.map(id=>({id,label:id+' мм'}))],c.panelCoreThickness):field('panelCoreThickness','Толщина встроенного утепляющего слоя, мм','По паспорту выбранной панели')}<p class="hint">Панель и её утепляющий сердечник учитываются одной позицией. Дополнительная вата и мембрана в этот комплект не добавляются.</p>${s.scenario==='bare'?'<p class="catalog-error">Для панели со встроенным утеплением выберите вариант «С утеплением».</p><button type="button" class="secondary-button" data-kit-insulated>Перейти к варианту с утеплением</button>':''}</div>`;else if(s.scenario==='insulated'&&schema.externalInsulation)thermal=insulation(c,i,i2);else thermal='<p class="catalog-current">Отдельное утепление не включено в выбранный вариант и способ монтажа.</p>';}
    element.innerHTML=`<div class="section-title"><span class="section-number">+</span><div><h2>Каталог материалов и монтаж</h2><p>Система определяет поля расчёта, состав сметы и монтажную инструкцию.</p></div></div><p class="catalog-current">${applied?`В смете применён: ${esc((applied.variant||applied.selection)?.manufacturer||'')} · ${esc((applied.variant||applied.selection)?.name||'система')}. Изменения ниже вступят в силу после применения.`:'Просмотр каталога не меняет вашу смету. Проверьте комплект и примените его.'}</p><div class="catalog-grid">${category}${system.id==='metal-siding'?select('familyId','Профиль металлического сайдинга',families,c.familyId):''}${select('variantId','Производитель и изделие',family.variants.map(x=>({id:x.id,label:x.manufacturer+' · '+x.name})),v.id)}</div><p class="hint catalog-classification">Вентилируемый и невентилируемый фасад — типы конструкции. Для сметы выберите конкретный материал и подтверждённую систему его монтажа.</p><div class="hint">${esc(system.description||'')}${list(system.hints)}</div>${card(v)}${schema.requiresType?'<div class="catalog-error" data-type-required><h3>Нужно уточнить конструкцию панели</h3><p>«Каменный замок» — название без подтверждённого типа. Уточните материал, марку, вид замка и крепления. Затем выберите соответствующую систему в списке выше. До этого автоматический комплект не применяется.</p></div>':''}${sizes}${project}${thermal}${assemblyForm(schema,c)}<details class="catalog-settings" open><summary>Предварительный состав и количества</summary><div id="catalog-preview" aria-live="polite"></div></details><div class="catalog-actions"><button type="button" class="dark-button" data-kit-apply ${schema.requiresType?'disabled':''}>Применить комплект к этому варианту</button><button type="button" class="secondary-button" data-kit-create ${schema.requiresType?'disabled':''}>Отдельный расчёт по этим замерам</button></div><p class="hint">Цены не подставляются. Повторное применение обновляет строки комплекта; прочие позиции сохраняются. Смена изделия или метода сбрасывает несовместимые цены и нормы. Для заполненной вручную сметы создайте отдельный расчёт.</p><p id="catalog-action-status" role="status"></p>`;
    refresh();
  }
  function refresh(){if(!$('#catalog-preview'))return;const {c,v,i,i2}=selected();try{const p=previewSystem(getState(),c,v,i,i2),s=getState(),tmp={...s,scenarios:{...s.scenarios,[s.scenario]:{materials:p.materials,works:p.works}}},calc=calculate(tmp);
    $('#catalog-preview').innerHTML=(p.errors?.length?`<p class="catalog-error">${esc(p.errors.join(' '))}</p>`:'')+list(p.notes)+['materials','works'].map(key=>`<h4>${key==='materials'?'Материалы':'Работы'}</h4><div class="catalog-table-wrap"><table><thead><tr><th>Позиция</th><th>Без запаса</th><th>${key==='materials'?'К закупке':'Объём работ'}</th></tr></thead><tbody>${calc.sections[key].rows.map(r=>{const errors=r.errors.filter(x=>!/(?:цена|ставк|источник цены|дата цены)/i.test(x));return `<tr><td>${esc(r.name)}${errors.length?`<small>Уточнить: ${esc(errors.join('; '))}</small>`:''}</td><td>${fmt(r.netQty)} ${esc(r.unit)}</td><td>${fmt(r.qty)} ${esc(r.unit)}</td></tr>`;}).join('')}</tbody></table></div>`).join('')+`<p class="hint">Пустые значения показаны прочерком. ${v.assembly?'Узлы, откосы, примыкания и доборные элементы включаются только отдельными операциями выбранной системы.':'Углы, откосы, старт и отливы — по вашим замерам.'} Цены заполняются после применения.</p>`;
  }catch(e){$('#catalog-preview').textContent=e.message;}}
  element.addEventListener('input',e=>{const assemblyKey=e.target.dataset.assemblyField;if(assemblyKey){draft().assemblyValues[assemblyKey]=e.target.value;refresh();return;}const key=e.target.dataset.kitField;if(!key||e.target.tagName==='SELECT'||e.target.type==='checkbox')return;draft()[key]=e.target.value;refresh();});
  element.addEventListener('change',e=>{const assemblyKey=e.target.dataset.assemblyField,enableKey=e.target.dataset.assemblyEnable;if(assemblyKey){draft().assemblyValues[assemblyKey]=e.target.value;refresh();return;}if(enableKey){draft().assemblyEnabled[enableKey]=e.target.checked;render();return;}const key=e.target.dataset.kitField;if(!key)return;const c=draft(),oldSystem=c.systemId;c[key]=e.target.type==='checkbox'?e.target.checked:e.target.value;
    if(key==='systemId'||key==='familyId'||key==='variantId'){
      if(key==='systemId'){c.familyId='';c.variantId='';}else if(key==='familyId')c.variantId='';
      const choice=selectSystem(c.systemId,c.familyId,c.variantId);c.familyId=choice.family.id;c.variantId=choice.variant.id;
      adoptProduct(c,choice,key==='systemId'||oldSystem!=='metal-siding');render();
    }else if(['insulationId','insulationId2','mountingMethod','includeAdhesive','includeCoating'].includes(key))render();else refresh();
  });
  element.addEventListener('click',async e=>{const b=e.target.closest('button');if(!b)return;const {c,v,i,i2}=selected();try{
    if(b.dataset.kitScenario){const scenario=b.dataset.kitScenario;if(!['bare','insulated'].includes(scenario))return;scenarioDrafts()[scenario]=structuredClone(c);onScenario?.(scenario);return;}
    if(b.hasAttribute('data-kit-insulated')){scenarioDrafts().insulated=structuredClone(c);onScenario?.('insulated');return;}
    if(b.hasAttribute('data-kit-two-layers')){c.layer1='50';c.layer2='50';if(i?.layerRoles&&!i.layerRoles.includes('inner'))c.insulationId=(insulationCatalog.find(x=>!x.restricted&&x.layerRoles?.includes('inner')&&x.manufacturer===i2?.manufacturer&&/каменная/i.test(x.name))||insulationCatalog.find(x=>!x.restricted&&x.layerRoles?.includes('inner')))?.id||c.insulationId;c.insulationPack1='';c.insulationPack2='';render();return;}
    if(b.hasAttribute('data-kit-apply')){const next=applySystem(getState(),c,v,i,i2);await onApply(next);onNotice('Комплект применён. При изменении замеров количества пересчитываются. Заполните цены и недостающие нормы.');}
    if(b.hasAttribute('data-kit-create')){const old=getState(),clean=structuredClone(old),blank=initialState();clean.project=(old.project||'Объект')+' — '+v.name;clean.scenarios=blank.scenarios;const next=applySystem(clean,c,v,i,i2);await onCreate(next);onNotice('Создан отдельный расчёт по тем же замерам. Прежний объект сохранён.');}
  }catch(error){$('#catalog-action-status').textContent=error.message;$('#catalog-action-status').className='catalog-error';onNotice(error.message,true);}});
  return {render,refresh};
}
