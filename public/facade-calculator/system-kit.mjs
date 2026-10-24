import {createRow,template,number,geometry,validateSystemConfiguration,SYSTEM_STRING_FIELDS} from './engine.mjs';

export function defaultSystem(){return Object.assign(Object.fromEntries(SYSTEM_STRING_FIELDS.map(k=>[k,''])),{orientation:'horizontal',reserve:'0',insulationReserve:'0',includeMembrane:false,includeAdhesive:false,includeCoating:true,confirmed:false,applied:false});}
const text=v=>typeof v==='string'?v:'';
const filled=v=>text(v).trim()!=='';
const GRID_NOTE='Предварительная сетка по целым прямоугольным стенам, без вычета проёмов. Обрамление проёмов, стыки и усиления — по отдельной проектной раскладке. Шаги и анкеры вводятся по проекту, не назначаются калькулятором.';
const PURCHASE_FIELDS=['price','source','priceDate','pack','stock','ordered','costBasis','enabled'];
const sourceText=card=>(card?.sources??[]).map(s=>`${s.title}: ${s.url}${s.pages?` (${s.pages})`:''}`).join('\n').slice(0,5000);
function snapshot(card){if(!card)return undefined;const copy=JSON.parse(JSON.stringify(card));return copy;}
function normalizedConfig(config){const c={...defaultSystem(),...config};for(const key of SYSTEM_STRING_FIELDS)c[key]=text(c[key]);return c;}
function sameRow(a,b){
  const keys=new Set([...Object.keys(a),...Object.keys(b)]);keys.delete('id');
  for(const k of keys)if((a[k]??'')!==(b[k]??''))return false;
  return true;
}
function templateDisposition(scenario,insulated){
  if(scenario.system?.applied||['materials','works'].some(key=>scenario[key].some(r=>filled(r.kitKey))))return {remove:new Set(),errors:[]};
  const pristine=template(insulated),remove=new Set(),edited=[];
  for(const key of ['materials','works'])for(const row of scenario[key]) {
    const candidate=pristine[key].find(r=>r.name===row.name&&r.unit===row.unit&&r.mode===row.mode);
    if(candidate&&sameRow(row,candidate))remove.add(row.id);
    else if(row.enabled||filled(row.price)||filled(row.quantity)||filled(row.norm))edited.push(row.name||'Без названия');
  }
  return {remove,errors:edited.length?['В этом варианте уже есть введённая смета. Создайте отдельный объект с той же геометрией, чтобы система не дублировала существующие материалы и работы.']:[]};
}
function sumDecimals(...values){const parts=values.map(v=>number(v)===null?['0','']:String(v).trim().replace(/[\s\u00a0\u202f]/g,'').replace(',','.').split('.'));const scale=Math.max(...parts.map(x=>(x[1]||'').length));const total=parts.reduce((n,[w,p=''])=>n+BigInt(w+p.padEnd(scale,'0')),0n);if(!scale)return String(total);const raw=String(total).padStart(scale+1,'0');return (raw.slice(0,-scale)+'.'+raw.slice(-scale)).replace(/\.?0+$/,'');}
function productIdentity(prefix,parts){return `${prefix}:${parts.map(x=>text(x)).join('|')}`;}
function material(key,name,unit,mode,extra={}){return {...createRow(name,unit,mode,'external'),kitKey:key,...extra};}
function work(key,name,mode='area',unit='м²',extra={}){return {...createRow(name,unit,mode,'base'),kitKey:`work:${key}`,...extra};}

/** Preview is side-effect free. Missing project inputs remain incomplete rows, not invented quantities. */
function previewLegacySystem(state,config,variant,insulationProduct,insulationProduct2){
  const c=normalizedConfig(config),errors=[],notes=[],materials=[],works=[],scenario=state.scenarios[state.scenario],insulated=state.scenario==='insulated';
  try{validateSystemConfiguration(c);}catch(e){errors.push(e.message);}
  if(!variant||!filled(variant.id)||!filled(variant.name))errors.push('Выберите профиль и вариант производителя.');
  if(!['horizontal','vertical'].includes(c.orientation))errors.push('Выберите направление облицовки.');
  if(variant?.orientations?.length&&!variant.orientations.includes(c.orientation))errors.push('Выбранный производитель не подтверждает это направление монтажа для данного профиля.');
  const positive=['panelLength','usefulWidth','fullWidth','railPitch','bracketPitch','anchorsPerBracket','layer1','layer2','insulationPack','insulationPack1','insulationPack2','membranePack'];
  const nonnegative=['reserve','fixingsPerM2','insulationReserve','insulationFixingsPerM2','membraneOverlap'];
  const fieldLabels={panelLength:'Длина панели',usefulWidth:'Полезная ширина',fullWidth:'Полная ширина',railPitch:'Шаг направляющих',bracketPitch:'Шаг кронштейнов',anchorsPerBracket:'Анкеров на кронштейн',layer1:'Толщина первого слоя',layer2:'Толщина второго слоя',insulationPack:'Объём упаковки утеплителя',insulationPack1:'Упаковка первого слоя',insulationPack2:'Упаковка второго слоя',membranePack:'Площадь рулона мембраны',reserve:'Запас облицовки',fixingsPerM2:'Расход крепежа облицовки',insulationReserve:'Запас утеплителя',insulationFixingsPerM2:'Расход крепежа утеплителя',membraneOverlap:'Нахлёсты и запас мембраны'};
  for(const key of positive)if(filled(c[key])&&!(number(c[key])>0))errors.push(`${fieldLabels[key]}: нужно положительное число.`);
  for(const key of nonnegative)if(filled(c[key])&&number(c[key])===null)errors.push(`${fieldLabels[key]}: нужно неотрицательное число.`);
  if(filled(c.anchorsPerBracket)&&!Number.isInteger(number(c.anchorsPerBracket)))errors.push('Число анкеров на кронштейн должно быть целым.');
  const width=c.usefulWidth||text(variant?.usefulWidth),fullWidth=c.fullWidth||text(variant?.fullWidth);
  if(!(number(width)>0))notes.push('Полезная ширина панели не задана: количество панелей пока не определено.');
  if(!variant?.openJoint&&filled(fullWidth)&&filled(width)&&number(fullWidth)<number(width))errors.push('Полная ширина панели не может быть меньше полезной.');
  if(filled(c.panelLength)&&number(variant?.minLength)>0&&number(c.panelLength)<number(variant.minLength))errors.push('Длина панели меньше минимальной длины выбранного производителя.');
  if(filled(c.panelLength)&&number(variant?.maxLength)>0&&number(c.panelLength)>number(variant.maxLength))errors.push('Длина панели больше максимальной длины выбранного производителя.');
  errors.push(...templateDisposition(scenario,insulated).errors);
  if(insulated&&filled(c.layer2)&&filled(c.insulationId2)&&!insulationProduct2&&c.insulationId2!==insulationProduct?.id)errors.push('Выберите марку второго слоя утеплителя; она не подменяется первым слоем автоматически.');
  if(insulated&&filled(c.layer2)&&insulationProduct&&insulationProduct2&&insulationProduct.manufacturer!==insulationProduct2.manufacturer&&!filled(c.insulationCompatibilitySource))errors.push('Для сочетания утеплителей разных производителей укажите документ или проект, подтверждающий совместимость слоёв в выбранной системе.');
  if(insulated&&!insulationProduct)notes.push('Марка утеплителя не выбрана: материал и допустимость применения нужно уточнить.');
  if(insulated&&insulationProduct?.restricted)errors.push('Этот утеплитель не подтверждён для выбранной навесной системы. Выберите фасадный минераловатный продукт или используйте отдельный проектный расчёт.');
  if(!c.confirmed)notes.push('Подсистема, крепёж, пожарные и теплотехнические решения требуют подтверждения по проекту.');
  notes.push(variant?.openJoint?'Открытошовная облицовка: расчёт по чистой площади и проектному модулю покрытия с согласованным зазором. Это предварительная закупка до раскладки и раскроя; цена панели вводится за штуку.':'Панели считаются по чистой площади и полезной ширине, с округлением вверх до целых панелей. Это предварительная закупка до раскладки и раскроя; цена панели вводится за штуку.');
  notes.push(GRID_NOTE);
  if(!filled(c.source))notes.push('Введите источник проектных шагов направляющих, кронштейнов и числа анкеров.');
  if(!filled(c.fixingsPerM2)||!filled(c.fastenerSource))notes.push('Расход крепежа облицовки и его источник вводятся по документации выбранной системы.');
  const label=variant?`${variant.manufacturer} · ${variant.name}`:'Облицовка — профиль не выбран';
  const panelIdentity=productIdentity('panel',[variant?.id??'',width,c.panelLength]);
  materials.push(material('siding:panels',label,'шт.','panels',{coverWidth:width,coverHeight:c.panelLength,reserve:c.reserve,pack:'1',normSource:sourceText(variant),kitIdentity:panelIdentity,techNote:variant?.openJoint?'Модуль покрытия = проектный шаг панелей, включая согласованный открытый зазор, а не физическая ширина панели. Расчётная площадь модуля = шаг × заказная длина. Цена за панель; закупка по площади до раскладки и раскроя.':'Полезная площадь одной панели = полезная ширина × заказная длина. Цена за целую панель; закупка по площади до раскроя.'}));
  const grid={orientation:c.orientation,railPitch:c.railPitch,bracketPitch:c.bracketPitch,anchorsPerBracket:c.anchorsPerBracket,normSource:c.source,techNote:GRID_NOTE};
  materials.push(material('subsystem:rails','Направляющие подсистемы — предварительная сетка','м.п.','supportLength',grid));
  materials.push(material('subsystem:brackets','Кронштейны — предварительная сетка','шт.','supportBrackets',grid));
  materials.push(material('subsystem:anchors','Анкеры основания — число по проекту','шт.','supportAnchors',grid));
  materials.push(material('siding:fasteners','Крепёж облицовки — по проектной норме','шт.','norm',{norm:c.fixingsPerM2,normSource:c.fastenerSource,requiresNormSource:true,kitIdentity:productIdentity('fasteners',[variant?.id??'']),techNote:'Норма на м² относится к выбранному профилю, шагу и основанию; универсальный расход не назначен.'}));
  works.push(work('preparation','Подготовка основания — состав уточнить'),work('subsystem','Монтаж подсистемы'),work('siding',`Монтаж облицовки · ${variant?.name??'профиль уточнить'}`));
  const trims=[['base','Стартовая / цокольная планка','baseLength'],['cornice','Завершающая / карнизная планка','corniceLength'],['outer','Наружные углы','outerCorners'],['inner','Внутренние углы','innerCorners']];
  for(const [id,name,mode] of trims){materials.push(material(`trim:${id}`,`${name} — сечение по системе`,'м.п.',mode,{normSource:sourceText(variant),techNote:'Длина по отдельному замеру. Запас, стыки и заказная длина доборов уточняются по раскладке; цена за погонный метр.'}));works.push(work(`trim:${id}`,`Монтаж: ${name.toLowerCase()}`,mode,'м.п.'));}
  if(state.openings?.some(o=>o.type==='window')){
    materials.push(material('trim:window','Облицовка откосов окон','м²','windowRevealArea'),material('trim:sill','Оконные отливы','м.п.','sillLength'));
    works.push(work('trim:window','Монтаж откосов окон','windowRevealArea'),work('trim:sill','Монтаж оконных отливов','sillLength','м.п.'));
  }
  if(state.openings?.some(o=>o.type==='door')){materials.push(material('trim:door','Облицовка откосов дверей','м²','doorRevealArea'));works.push(work('trim:door','Монтаж откосов дверей','doorRevealArea'));}
  if(insulated){
    const layers=[['1',c.layer1||''],...(filled(c.layer2)?[['2',c.layer2]]:[])];
    for(const [layer,thickness] of layers){
      const product=layer==='1'?insulationProduct:(insulationProduct2??insulationProduct),role=layers.length===1?'single':layer==='1'?'inner':'outer';
      if(product?.restricted)errors.push(`Слой ${layer}: этот утеплитель не подтверждён для выбранной навесной системы.`);
      if(product?.layerRoles?.length&&!product.layerRoles.includes(role))errors.push(`Слой ${layer}: ${product.name} не подтверждён для роли «${{single:'единственный слой',inner:'внутренний слой',outer:'наружный слой'}[role]}». Выберите подходящую марку для этого слоя.`);
      if(!product?.layerRoles?.length)notes.push(`Слой ${layer}: допустимость марки для роли «${{single:'единственный слой',inner:'внутренний слой',outer:'наружный слой'}[role]}» нужно подтвердить документацией системы.`);
      const insulationName=product?`${product.manufacturer} · ${product.name}`:'Утеплитель — марку уточнить';
      const pack=c[`insulationPack${layer}`]||(layer==='1'||c.layer1===c.layer2?c.insulationPack:'');materials.push(material(`insulation:layer${layer}`,`${insulationName} · слой ${layer}${filled(thickness)?`, ${thickness} мм`:''}`,'м³','insulationVolume',{thickness,reserve:c.insulationReserve,pack,normSource:sourceText(product),kitIdentity:productIdentity('insulation',[product?.id??'',thickness]),techNote:layers.length>1?'Два слоя со смещением стыков; объём каждого слоя = чистая площадь × его толщина / 1000. Монтаж и допустимость — по документации системы.':'Объём слоя = чистая площадь × толщина / 1000; толщина определяется проектом.'}));works.push(work(`insulation${layer}`,`Монтаж утеплителя · слой ${layer}${filled(thickness)?`, ${thickness} мм`:''}`));}
    materials.push(material('insulation:fixings','Крепёж утеплителя — общая норма системы','шт.','norm',{norm:c.insulationFixingsPerM2,normSource:c.insulationFixingSource,requiresNormSource:true,techNote:'Общая норма системы на м² по схеме раскладки; на число слоёв автоматически не умножается.'}));
    if(!filled(c.layer1))notes.push('Укажите толщину первого слоя утеплителя; второй слой добавляется при введённой толщине.');
    if(layers.length>1)notes.push('Роль внутреннего и наружного слоя не подтверждает совместимость всего фасада: сочетание марок и облицовки проверяется по проектной системе.');
    if(layers.length>1)notes.push('Два слоя утепления: стыки второго слоя смещаются относительно первого. Толщина, марки и крепление проверяются по проекту.');
  }
  if(insulated&&c.includeMembrane){materials.push(material('membrane:material','Ветрозащитная мембрана — марка по системе','м²','area',{reserve:c.membraneOverlap,pack:c.membranePack,normSource:c.source,requiresNormSource:true,techNote:'Включается только если предусмотрена системой. Процент нахлёстов / запаса и площадь рулона вводятся по документации.'}));works.push(work('membrane','Монтаж ветрозащиты'));}
  if(geometry(state).area===null)notes.push('Сначала заполните геометрию объекта: количества будут пересчитываться при её изменении.');
  return {materials,works,errors:[...new Set(errors)],notes:[...new Set(notes)]};
}


const METHOD_LABELS={'bracket-frame':'Каркас на кронштейнах по проекту','direct-frame':'Обрешётка с креплением к основанию','direct':'Прямое механическое крепление','bonded':'Клеевой монтаж по системе','sandwich-frame':'Крепление к несущему каркасу','seam-base':'Фальцевая облицовка по основанию'};
const SYSTEM_LABELS={vinyl:'Виниловый сайдинг',acrylic:'Акриловый сайдинг',fibercement:'Фиброцементная облицовка',wood:'Деревянная облицовка',plinth:'Фасадные / цокольные панели',thermal:'Термопанели',wpc:'Облицовка ДПК',acp:'Алюминиевые композитные панели',hpl:'HPL-панели',sandwich:'Сэндвич-панели','stone-lock':'Замковые панели под камень',cassettes:'Фасадные кассеты',profiled:'Профилированный лист',seam:'Фальцевая облицовка'};
const EXTRA_FIELDS=['directFastenersPerM2','directFastenerSource','clipsPerM2','clipSource','adhesiveNorm','adhesiveSource','groutNorm','groutSource','primerNorm','primerSource','coatingNorm','coatingLayers','coatingSource','sealantNorm','sealantSource','substrateNorm','substrateSource','subsystemNorm','subsystemSource','jointStripNorm','jointStripSource'];
/** Describes only fields applicable to this product and mounting method. Missing metadata retains the legacy metal kit. */
export function getSystemSchema(variant,config={}){
  const legacy=!variant?.systemKind,kind=variant?.systemKind||'linear',systemId=variant?.systemId||config.systemId||'',requiresType=kind==='unknown'||variant?.requiresType===true;
  let methods=[];
  if(!requiresType){
    if(legacy)methods=['bracket-frame'];
    else if(kind==='sandwich')methods=['sandwich-frame'];
    else if(kind==='seam')methods=['seam-base'];
    else for(const method of variant?.mountingMethods?.length?variant.mountingMethods:['frame']){
      if(method==='frame')methods.push(...(variant?.frameMethods?.length?variant.frameMethods:['vinyl','acrylic','plinth','wood','wpc'].includes(systemId)||kind==='wood'?['direct-frame','bracket-frame']:['bracket-frame','direct-frame']));
      else if(method==='direct'||method==='bonded')methods.push(method);
    }
  }
  methods=[...new Set(methods)];const defaultMethod=methods[0]||'',method=config.mountingMethod||defaultMethod;
  const integratedInsulation=variant?.integratedInsulation===true||kind==='thermal'||kind==='sandwich';
  const frame=['bracket-frame','direct-frame'].includes(method),grid=frame&&variant?.grid!==false,externalInsulation=frame&&!integratedInsulation;
  const fields=['orientation','panelLength','usefulWidth','fullWidth','reserve','source'];
  const notes=[];if(requiresType)notes.push('Сначала выберите конкретный материал и конструкцию: декоративное название не определяет технологию.');
  if(frame){fields.push(...(grid?['railPitch']:['subsystemNorm','subsystemSource']));if(method==='bracket-frame'&&grid)fields.push('bracketPitch','anchorsPerBracket');if(method==='direct-frame')fields.push('directFastenersPerM2','directFastenerSource');}
  if(kind==='sandwich')fields.push('subsystemNorm','subsystemSource','fixingsPerM2','fastenerSource','sealantNorm','sealantSource','jointStripNorm','jointStripSource');
  else if(kind==='seam'){fields.push('baseType','substrateNorm','substrateSource');fields.push(...(variant?.fastenerType==='clips'?['clipsPerM2','clipSource']:['fixingsPerM2','fastenerSource']));}
  else if(method==='direct'||method==='bonded')fields.push('directFastenersPerM2','directFastenerSource');
  else fields.push(...(variant?.fastenerType==='clips'?['clipsPerM2','clipSource']:['fixingsPerM2','fastenerSource']));
  if(method==='bonded'||variant?.adhesiveRequired||(kind==='thermal'&&config.includeAdhesive))fields.push('adhesiveNorm','adhesiveSource');
  if(method==='bonded')fields.push('primerNorm','primerSource');
  if(variant?.needsJointGrout)fields.push('groutNorm','groutSource');
  if(variant?.needsJointSealant)fields.push('sealantNorm','sealantSource');
  const coating=variant?.needsCoating===true||(kind==='wood'&&variant?.needsCoating!==false&&config.includeCoating!==false);if(coating)fields.push('coatingNorm','coatingLayers','coatingSource');else if(kind==='wood')fields.push('coatingSource');
  if(integratedInsulation){fields.push('panelCoreThickness');notes.push('Утепляющий сердечник входит в панель и учитывается один раз в её цене. Отдельные слои ваты и мембрана автоматически не добавляются.');}
  if(!grid&&frame)notes.push('Подсистема зависит от стыков и раскладки панелей: расход направляющих и креплений задаётся по проектной спецификации, без типовой сетки стен.');
  if(kind==='sandwich')notes.push('Несущий каркас, пролёты, крепления и стыки сэндвич-панелей проверяются по проекту; кронштейны навесного фасада не подставляются.');
  if(kind==='seam')notes.push('Тип основания и крепления фальца выбираются по инструкции конкретной панели; клик-панель с крепёжной полкой не заменяется кляммерами.');
  return {kind,systemId,legacy,title:legacy?'Вентилируемый фасад на металлической подсистеме':SYSTEM_LABELS[systemId]||variant?.name||'Выбранная фасадная система',methodOptions:methods.map(id=>({id,label:METHOD_LABELS[id]})),defaultMethod,method,mountingMethod:method,fieldKeys:[...new Set(fields)],notes,integratedInsulation,requiresType,grid,externalInsulation,supportsMembrane:externalInsulation,baseOptions:(variant?.baseOptions||['battens','solid']).map(id=>({id,label:id==='solid'?'Сплошное основание':'Обрешётка по проекту'})),coating};
}
export function previewSystem(state,config,variant,insulationProduct,insulationProduct2){
  if(!variant?.systemKind)return previewLegacySystem(state,config,variant,insulationProduct,insulationProduct2);
  return previewTypedSystem(state,config,variant,insulationProduct,insulationProduct2);
}
// Ignore stale values hidden by a different technology; never carry them into its saved applied kit.
function applicableConfig(config,schema,insulated){
  const c={...config};
  for(const key of ['railPitch','bracketPitch','anchorsPerBracket','fixingsPerM2','fastenerSource',...EXTRA_FIELDS])if(!schema.fieldKeys.includes(key))c[key]='';
  if(!schema.externalInsulation||!insulated)for(const key of ['layer1','layer2','insulationId','insulationId2','insulationCompatibilitySource','insulationReserve','insulationPack','insulationPack1','insulationPack2','insulationFixingsPerM2','insulationFixingSource'])c[key]='';
  if(!schema.supportsMembrane||!insulated){c.includeMembrane=false;c.membraneOverlap='';c.membranePack='';}
  if(!schema.integratedInsulation)c.panelCoreThickness='';
  if(schema.kind!=='thermal')c.includeAdhesive=false;
  return c;
}
function previewTypedSystem(state,config,variant,insulationProduct,insulationProduct2){
  const raw=normalizedConfig(config),schema=getSystemSchema(variant,raw),insulated=state.scenario==='insulated',method=schema.method;
  if(schema.requiresType)return {materials:[],works:[],errors:['Выберите конкретную технологию материала вместо неопределённого типа «под камень» / «фасадные панели».'],notes:schema.notes};
  const c=applicableConfig(raw,schema,insulated);
  const base=previewLegacySystem(state,c,variant,schema.externalInsulation&&insulated?insulationProduct:undefined,schema.externalInsulation&&insulated?insulationProduct2:undefined);
  const errors=[...base.errors],notes=[...schema.notes],materials=[],works=[];
  if(!schema.methodOptions.some(x=>x.id===method)&&!schema.requiresType)errors.push('Выбранный способ монтажа не подтверждён для этого материала.');
  if(schema.integratedInsulation&&!insulated)errors.push('У этой панели уже есть утепляющий сердечник. Переключите вариант на «С утеплением», чтобы не выдавать панель за вариант без утепления.');
  for(const key of schema.fieldKeys.filter(x=>EXTRA_FIELDS.includes(x)&&!x.endsWith('Source')))if(filled(c[key])&&number(c[key])===null)errors.push('Расход материала должен быть неотрицательным числом; источник и единицы берутся из документации системы.');
  if(schema.coating&&filled(c.coatingLayers)&&(!(number(c.coatingLayers)>0)||!Number.isInteger(number(c.coatingLayers))))errors.push('Число слоёв защитного покрытия должно быть целым и больше нуля.');
  if(schema.integratedInsulation&&!(number(c.panelCoreThickness)>0))errors.push('Укажите толщину встроенного утепляющего сердечника в миллиметрах больше нуля: она определяет выбранную панель.');
  if(schema.integratedInsulation&&number(c.panelCoreThickness)>0&&variant.coreThicknessOptions?.length&&!variant.coreThicknessOptions.some(x=>number(x)===number(c.panelCoreThickness)))errors.push('Эта толщина сердечника отсутствует в подтверждённом перечне выбранной панели. Выберите заводской вариант из карточки производителя.');
  if(schema.kind==='seam'&&filled(c.baseType)&&!schema.baseOptions.some(x=>x.id===c.baseType))errors.push('Выбранный тип основания не подтверждён для этой фальцевой облицовки.');
  if(schema.kind==='seam'&&(!c.baseType||!schema.baseOptions.some(x=>x.id===c.baseType)))notes.push('Выберите тип основания фальцевой облицовки по проекту; расход основания пока не определён.');
  const keepMaterial=r=>r.kitKey.startsWith('trim:')||(schema.externalInsulation&&r.kitKey.startsWith('insulation:'))||(schema.supportsMembrane&&r.kitKey.startsWith('membrane:'));
  const keepWork=r=>r.kitKey==='work:preparation'||r.kitKey.startsWith('work:trim:')||(schema.externalInsulation&&r.kitKey.startsWith('work:insulation'))||(schema.supportsMembrane&&r.kitKey.startsWith('work:membrane'));
  materials.push(...base.materials.filter(keepMaterial));works.push(...base.works.filter(keepWork));
  const panels=base.materials.find(r=>r.kitKey==='siding:panels');if(panels){if(schema.integratedInsulation)panels.techNote+=' Утепляющий сердечник включён в панель; отдельно не добавлен.';materials.unshift(panels);}
  const normRow=(key,name,unit,norm,source,extra={})=>materials.push(material(key,name,unit,'norm',{norm:text(norm),normSource:text(source),requiresNormSource:true,...extra}));
  const addFixings=()=>{if(variant.fastenerType==='clips')normRow('mount:clips',variant.fastenerLabel||'Клипсы выбранной системы','шт.',c.clipsPerM2,c.clipSource);else normRow('siding:fasteners',variant.fastenerLabel||'Крепёж облицовки по проекту','шт.',c.fixingsPerM2,c.fastenerSource);};
  if(['bracket-frame','direct-frame'].includes(method)){
    if(schema.grid){const grid={orientation:c.orientation,railPitch:c.railPitch,bracketPitch:c.bracketPitch,anchorsPerBracket:c.anchorsPerBracket,normSource:c.source,techNote:GRID_NOTE};materials.push(material('subsystem:rails',method==='direct-frame'?'Обрешётка — предварительная сетка':'Направляющие подсистемы — предварительная сетка','м.п.','supportLength',grid));if(method==='bracket-frame')materials.push(material('subsystem:brackets','Кронштейны по проекту','шт.','supportBrackets',grid),material('subsystem:anchors','Анкеры кронштейнов по проекту','шт.','supportAnchors',grid));}
    else{normRow('subsystem:rails','Направляющие — расход по раскладке панелей','м.п.',c.subsystemNorm,c.subsystemSource);if(method==='bracket-frame')materials.push(material('subsystem:brackets','Кронштейны — количество по проекту','шт.','manual'),material('subsystem:anchors','Анкеры кронштейнов — количество по проекту','шт.','manual'));}
    if(method==='direct-frame')normRow('mount:base-fixings','Крепёж обрешётки к основанию','шт.',c.directFastenersPerM2,c.directFastenerSource);
    works.push(work('subsystem',method==='direct-frame'?'Монтаж обрешётки':'Монтаж проектной подсистемы'));addFixings();
  }else if(method==='direct'||method==='bonded'){
    normRow('mount:direct-fixings','Механический крепёж панели к основанию','шт.',c.directFastenersPerM2,c.directFastenerSource);
  }else if(method==='sandwich-frame'){
    normRow('subsystem:structure','Элементы несущего каркаса — спецификация проекта','м.п.',c.subsystemNorm,c.subsystemSource,{techNote:'Это отдельный несущий каркас. Пролёты и несущая способность не рассчитываются калькулятором.'});addFixings();
    normRow('sandwich:sealant',variant.sealantLabel||'Герметизация стыков сэндвич-панелей',variant.sealantUnit||'кг',c.sealantNorm,c.sealantSource);
    normRow('sandwich:joint-strips','Нащельники стыков — по проектной норме','м.п.',c.jointStripNorm,c.jointStripSource);
    works.push(work('structure','Монтаж несущего каркаса — по проекту'),work('sandwich-sealing','Герметизация стыков панелей'));
  }else if(method==='seam-base'){
    const validBase=schema.baseOptions.some(x=>x.id===c.baseType);normRow('seam:base',c.baseType==='solid'?'Сплошное основание фальцевой облицовки':'Обрешётка фальцевой облицовки',c.baseType==='solid'?'м²':'м.п.',validBase?c.substrateNorm:'',c.substrateSource,{techNote:'Расход и крепление основания принимаются по проекту выбранного фальца; тип основания должен быть выбран явно.'});addFixings();works.push(work('seam-base','Устройство основания фальцевой облицовки'));
  }
  if(method==='bonded'||variant.adhesiveRequired||(schema.kind==='thermal'&&c.includeAdhesive)){normRow('surface:adhesive','Клей выбранной системы',variant.adhesiveUnit||'кг',c.adhesiveNorm,c.adhesiveSource);works.push(work('adhesive','Нанесение клея по технологии системы'));}
  if(method==='bonded'){normRow('surface:primer','Грунт основания по системе',variant.primerUnit||'л',c.primerNorm,c.primerSource);works.push(work('primer','Грунтование основания'));}
  if(variant.needsJointGrout){normRow('surface:grout',variant.groutLabel||'Затирка швов выбранной облицовки',variant.groutUnit||'кг',c.groutNorm,c.groutSource);works.push(work('grout',variant.groutLabel||'Расшивка / заполнение швов облицовки'));}
  if(variant.needsJointSealant&&schema.kind!=='sandwich'){normRow('surface:sealant',variant.sealantLabel||'Эластичная заделка монтажных швов',variant.sealantUnit||'кг',c.sealantNorm,c.sealantSource);works.push(work('joint-sealant',variant.sealantLabel||'Эластичная заделка монтажных швов'));}
  if(schema.coating){normRow('surface:coating',variant.coatingLabel||'Защитное покрытие облицовки',variant.coatingUnit||'л',c.coatingNorm,c.coatingSource,{normFactor:c.coatingLayers,requiresNormFactor:true,techNote:'Расход на один слой × число слоёв; покрытие не считается автоматически включённым в стоимость необработанной облицовки.'});works.push(work('coating','Нанесение защитного покрытия','norm','м²',{norm:c.coatingLayers,normSource:c.coatingSource,requiresNormSource:true}));}
  if(variant.needsFabrication)works.push(work('fabrication',schema.systemId==='acp'?'Раскрой, фрезеровка и гибка кассет АКП по раскладке':'Подготовка и обработка панелей по раскладке','area','м²',{techNote:'Отдельная операция изготовления; объём предварительно по чистой площади до ведомости раскроя, цена не назначена.'}));
  works.push(work('siding',schema.kind==='sandwich'?'Монтаж сэндвич-панелей':schema.kind==='seam'?'Монтаж фальцевой облицовки':`Монтаж облицовки · ${variant.name}`));
  const identity=[variant.id,method,schema.kind==='seam'?c.baseType:'',schema.integratedInsulation?c.panelCoreThickness:''].join('|');for(const r of [...materials,...works])r.kitIdentity=[r.kitIdentity||'',identity].join('|');
  if(schema.kind==='wood'&&!schema.coating)notes.push(filled(c.coatingSource)?`Дополнительное покрытие древесины не добавлено: ${c.coatingSource}`:'Дополнительное покрытие древесины отключено. Укажите заводскую отделку или основание, почему оно не требуется, по документации выбранной древесины.');
  if(!c.confirmed)notes.push('Состав, основание, крепления и совместимость всей системы подтверждаются проектом и инструкцией производителя.');
  notes.push('Количество панелей предварительно рассчитывается по полезному модулю до раскладки и раскроя. Расходы, цены и проектные шаги без исходных данных остаются пустыми.');
  if(geometry(state).area===null)notes.push('Заполните геометрию объекта для автоматического пересчёта количеств.');
  return {materials,works,errors:[...new Set(errors)],notes:[...new Set(notes)]};
}

/** Explicitly applies a reviewed kit to a cloned project; never changes another scenario. */
export function applySystem(state,config,variant,insulationProduct,insulationProduct2){
  const normalized=normalizedConfig(config),schema=getSystemSchema(variant,normalized),c=variant?.systemKind?applicableConfig(normalized,schema,state.scenario==='insulated'):normalized,preview=previewSystem(state,c,variant,insulationProduct,insulationProduct2);
  if(preview.errors.length)throw Error(preview.errors.join(' '));
  const result=JSON.parse(JSON.stringify(state)),insulated=result.scenario==='insulated',scenario=result.scenarios[result.scenario],disposition=templateDisposition(scenario,result.scenario==='insulated');
  for(const key of ['materials','works']){
    const old=new Map(scenario[key].filter(r=>filled(r.kitKey)).map(r=>[r.kitKey,r]));
    const rows=preview[key].map(row=>{
      const prior=old.get(row.kitKey),sameProduct=prior&&(prior.kitIdentity??'')===(row.kitIdentity??'');
      if(prior&&sameProduct&&prior.name===row.name&&prior.unit===row.unit){
        row.id=prior.id;
        for(const field of PURCHASE_FIELDS)if(prior[field]!==undefined){
          if(field==='pack'&&/^insulation:layer[12]$/.test(row.kitKey)){
            const layer=row.kitKey.endsWith('1')?'1':'2',oldSystem=scenario.system??{};
            if(c[`insulationPack${layer}`]!==text(oldSystem[`insulationPack${layer}`])||c.insulationPack!==text(oldSystem.insulationPack))continue;
          }
          if(field==='pack'&&row.kitKey==='membrane:material'&&c.membranePack!==text(scenario.system?.membranePack))continue;
          row[field]=prior[field];
        }
      }
      return row;
    });
    scenario[key]=[...scenario[key].filter(r=>!filled(r.kitKey)&&!disposition.remove.has(r.id)),...rows];
  }
  scenario.system={...c,mountingMethod:schema.method,systemId:schema.systemId,variantId:c.variantId||variant.id,insulationId:insulated&&schema.externalInsulation?(c.insulationId||insulationProduct?.id||''):'',insulationId2:insulated&&schema.externalInsulation&&filled(c.layer2)?(c.insulationId2||insulationProduct2?.id||insulationProduct?.id||''):'',includeMembrane:insulated&&schema.supportsMembrane&&c.includeMembrane,usefulWidth:c.usefulWidth||text(variant.usefulWidth),fullWidth:c.fullWidth||text(variant.fullWidth),applied:true,variant:snapshot(variant),...(insulated&&schema.externalInsulation&&insulationProduct?{insulationSelection:snapshot(insulationProduct)}:{}),...(insulated&&schema.externalInsulation&&filled(c.layer2)&&(insulationProduct2??insulationProduct)?{insulationSelection2:snapshot(insulationProduct2??insulationProduct)}:{})};
  result.cladding=`${variant.manufacturer} · ${variant.name}`;
  if(result.scenario==='insulated'&&schema.integratedInsulation){result.insulationType='Утепляющий сердечник включён в панель';result.thickness=c.panelCoreThickness||text(variant.panelCoreThickness);}
  else if(result.scenario==='insulated'&&schema.externalInsulation){
    result.insulationType=[insulationProduct,...(filled(c.layer2)&&insulationProduct2&&insulationProduct2.id!==insulationProduct?.id?[insulationProduct2]:[])].filter(Boolean).map(p=>`${p.manufacturer} · ${p.name}`).join(' / ');
    const total=sumDecimals(c.layer1,c.layer2);result.thickness=total==='0'?'':total;
  }
  return result;
}

/** Adds newly required opening rows after an explicit kit was applied. Existing rows are never overwritten. */
export function syncOpeningRows(state){
  const scenario=state.scenarios?.[state.scenario],system=scenario?.system,added={materials:0,works:0};
  if(!system?.applied)return added;
  const variant=system.variant??system.selection;
  if(!variant?.id)return added;
  const preview=previewSystem(state,system,variant,system.insulationSelection,system.insulationSelection2);
  if(preview.errors.length)return added;
  const openingKeys=new Set(['trim:window','trim:sill','trim:door','work:trim:window','work:trim:sill','work:trim:door']);
  for(const key of ['materials','works']){
    const existing=new Set(scenario[key].map(r=>r.kitKey));
    for(const row of preview[key])if(openingKeys.has(row.kitKey)&&!existing.has(row.kitKey)){
      scenario[key].push(row);existing.add(row.kitKey);added[key]++;
    }
  }
  return added;
}
