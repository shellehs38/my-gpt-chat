import {initialState, uid, number, geometry, measurements, calculate, csv, validateImport, createRow, copyCommonRows, RATE_LABELS, MODE_LABELS, MODE_UNITS,MAX_PROJECT_FILE_BYTES,serializeProject} from './engine.mjs';
import {buildReport,buildStandaloneReport} from './report.mjs';
import {createProjectStore} from './project-store.mjs';
import {parseTakeoff} from './takeoff.mjs';
import {decodeProjectLink} from './project-link.mjs';
import {createCatalogUI} from './catalog-ui.mjs';
import {syncOpeningRows,getSystemSchema} from './system-kit.mjs';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=(n,max=2)=>n==null||!Number.isFinite(n)?'—':new Intl.NumberFormat('ru-RU',{maximumFractionDigits:max}).format(n);
const money=n=>n==null?'— ₽':`${fmt(n)} ₽`;
const STORAGE='svoi-lyudi-facade-v1';
const linearLabels={outerCorners:'Наружные углы',innerCorners:'Внутренние углы',baseLength:'Старт / цоколь',corniceLength:'Финиш / карниз'};
const measureLabels={windowRevealArea:'Площадь оконных откосов',windowRevealLength:'Длина оконных откосов',doorOpeningArea:'Площадь дверных проёмов · ширина × высота',doorOpeningCount:'Количество дверных проёмов',doorRevealArea:'Площадь дверных откосов',doorRevealLength:'Длина дверных откосов',revealArea:'Общие откосы всех проёмов · площадь',revealLength:'Общие откосы всех проёмов · длина',sillLength:'Длина оконных отливов',...linearLabels};
const modeUnit=mode=>MODE_UNITS[mode]||'';
const quickItems={
  materials:[
    ['window-reveal-area','Облицовка оконных откосов','м²','windowRevealArea'],['window-reveal-length','Доборы оконных откосов по длине','м.п.','windowRevealLength'],['door-opening-area','Дверные проёмы — отдельная площадь','м²','doorOpeningArea'],['door-opening-count','Дверные проёмы — отдельный учёт поштучно','шт.','doorOpeningCount'],['door-reveal-area','Облицовка дверных откосов','м²','doorRevealArea'],['door-reveal-length','Доборы дверных откосов по длине','м.п.','doorRevealLength'],['reveal-area','Все проёмы — общие откосы (прежний расчёт)','м²','revealArea'],['reveal-length','Все проёмы — общие откосы по длине (прежний расчёт)','м.п.','revealLength'],['sills','Оконные отливы','м.п.','sillLength'],
    ['outer','Наружные угловые элементы','м.п.','outerCorners'],['inner','Внутренние угловые элементы','м.п.','innerCorners'],['base','Стартовый / цокольный профиль','м.п.','baseLength'],['cornice','Финишный / карнизный профиль','м.п.','corniceLength'],
    ['layer2','Утеплитель — второй отдельный слой','м³','insulationVolume','insulated'],['membrane','Проектная мембрана — применимость уточнить','м²','area'],['panels','Панели по полезному размеру — до раскладки','шт.','panels']
  ],
  works:[
    ['window-reveal-area','Монтаж / отделка оконных откосов','м²','windowRevealArea'],['window-reveal-length','Монтаж оконных откосов по длине','м.п.','windowRevealLength'],['door-opening-area','Работы с дверными проёмами — отдельно по площади','м²','doorOpeningArea'],['door-opening-count','Работы с дверными проёмами — отдельно поштучно','шт.','doorOpeningCount'],['door-reveal-area','Монтаж / отделка дверных откосов','м²','doorRevealArea'],['door-reveal-length','Монтаж дверных откосов по длине','м.п.','doorRevealLength'],['reveal-area','Все проёмы — общие работы по откосам (прежний расчёт)','м²','revealArea'],['reveal-length','Все проёмы — общие откосы по длине (прежний расчёт)','м.п.','revealLength'],['sills','Монтаж оконных отливов','м.п.','sillLength'],['outer','Монтаж наружных углов','м.п.','outerCorners'],['inner','Монтаж внутренних углов','м.п.','innerCorners'],['base','Монтаж стартового / цокольного профиля','м.п.','baseLength'],['cornice','Монтаж финишного / карнизного профиля','м.п.','corniceLength'],['layer2','Монтаж второго слоя утеплителя','м²','area','insulated'],['membrane','Монтаж проектной мембраны','м²','area'],
    ['delivery','Доставка — внешние затраты','усл.','manual','external'],['unload','Разгрузка — внешние затраты','усл.','manual','external'],['lifting','Подъём материалов — внешние затраты','усл.','manual','external'],['rental','Аренда техники / доступа — внешние затраты','усл.','manual','external'],['waste','Вывоз отходов — внешние затраты','усл.','manual','external']
  ]
};
let state=initialState(),tab='materials',saveTimer,toastTimer,storageWarning='',previewUrl='',drawingUrl='',pendingTakeoff=null,catalogUI;
const incomingProjectHash=location.hash==='#project'||location.hash.startsWith('#project=')?location.hash:'';
if(incomingProjectHash)history.replaceState(null,'',location.pathname+location.search);
const store=createProjectStore();
let projectId=null,revisionId=null,storageReady=false,booting=true,dirty=false,conflict=false,serial=0,inFlight=null,lastSaved='',selectedRestore=null,pendingFallback=null;
const RECOVERY='svoi-lyudi-facade-recovery-';
let tabId;try{tabId=sessionStorage.getItem(RECOVERY+'tab');if(!tabId){tabId=uid();sessionStorage.setItem(RECOVERY+'tab',tabId);}}catch{tabId=uid();}
const recoveryKey=RECOVERY+tabId;
$('main').inert=true;
$('header').inert=true;
function toast(message,error=false){$('#toast').textContent=message;$('#toast').classList.toggle('error',error);$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,7000);}
function storageNotice(message,isConflict=false){$('#project-storage-notice').hidden=!message;$('#project-storage-message').textContent=message;$('#save-conflict-copy').hidden=!isConflict;}
function recoverySnapshot(){if(!dirty)return;try{localStorage.setItem(recoveryKey,JSON.stringify({projectId,baseRevision:revisionId,savedAt:new Date().toISOString(),state}));}catch{/* IndexedDB may still save; its result determines the save status. */}}
function save(){
  if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl='';$('#report-preview').hidden=true;}
  serial++;dirty=true;recoverySnapshot();clearTimeout(saveTimer);
  $('#save-status').textContent=conflict?'Есть конфликт — сохраните копию':'Сохраняем…';
  saveTimer=setTimeout(()=>void flushSave(),350);
}
async function flushSave(force=false){
  clearTimeout(saveTimer);if(inFlight)await inFlight;
  if(!storageReady||conflict||(!dirty&&!force))return !dirty;
  const json=JSON.stringify(state);if(json===lastSaved&&!force){
    dirty=false;try{localStorage.removeItem(recoveryKey);}catch{}
    $('#save-status').textContent='Объект и версия сохранены в этом браузере';
    return true;
  }
  const versionSerial=serial,snapshot=JSON.parse(json),origin=projectId,baseRevision=revisionId;
  const operation=(async()=>{try{
    const saved=await store.saveProject({projectId:origin,baseRevision,state:snapshot});
    if(projectId===origin){revisionId=saved.revisionId;lastSaved=json;if(serial===versionSerial){dirty=false;try{localStorage.removeItem(recoveryKey);}catch{}$('#save-status').textContent='Объект и версия сохранены в этом браузере';}else $('#save-status').textContent='Сохраняем следующие изменения…';}
    return true;
  }catch(error){if(error.code==='CONFLICT'){conflict=true;storageNotice('Объект изменён в другой вкладке. Ваши изменения остались здесь. Сохраните их отдельной копией — обе версии будут доступны.',true);$('#save-status').textContent='Конфликт — сохраните свою копию';}else{storageNotice(error.message||'Не удалось сохранить объект. Скачайте JSON.');$('#save-status').textContent='Сохраните проект в файл';}return false;}})();
  inFlight=operation;const ok=await operation;if(inFlight===operation)inFlight=null;
  if(ok&&dirty&&!conflict)saveTimer=setTimeout(()=>void flushSave(),100);
  return ok&&!dirty;
}
function useProject(saved,preserveRecovery=false){projectId=saved.projectId;revisionId=saved.revisionId;state=saved.state;lastSaved=JSON.stringify(state);dirty=false;conflict=false;serial++;tab='materials';clearTimeout(saveTimer);if(!preserveRecovery)try{localStorage.removeItem(recoveryKey);}catch{}storageNotice('');render();$('#save-status').textContent='Объект и версии сохранены в этом браузере';}
async function beforeSwitch(){if(!storageReady){if(!dirty)return true;return await new Promise(resolve=>{pendingFallback=resolve;$('#fallback-switch-dialog').showModal();});}if(inFlight)await inFlight;if(dirty&&!await flushSave()){toast('Сначала сохраните свои изменения отдельной копией или скачайте JSON.',true);return false;}return true;}
async function initialize(){
  try{useProject(await store.open(),true);storageReady=true;}
  catch(error){try{const legacy=localStorage.getItem(STORAGE);if(legacy)state=validateImport(JSON.parse(legacy));}catch{}storageWarning=error.message||'Хранилище недоступно. Используйте JSON.';storageNotice(storageWarning);render();$('#save-status').textContent='Сохраните проект в файл';}
  finally{
    if(incomingProjectHash)await openLinkedProject(incomingProjectHash);
    booting=false;$('main').inert=false;$('header').inert=false;const count=recoveryDrafts().length;$('#open-recovery').hidden=!count;if(count){$('#project-storage-notice').hidden=false;$('#project-storage-message').textContent+=(storageWarning?' ':'')+'Найден несохранённый черновик. Его можно открыть отдельной копией.';}
  }
}
async function openLinkedProject(hash){
      try{
        const linked=await decodeProjectLink(hash);
        if(linked){
          if(storageReady){
            const key=linked.fingerprint?'svoi-lyudi-project-link-'+linked.fingerprint:null;
            let known=null;try{if(key)known=localStorage.getItem(key);}catch{}
            let saved=null;if(known)try{saved=await store.loadProject(known);}catch(error){if(error.code!=='NOT_FOUND')throw error;}
            if(!saved)saved=await store.createProject(linked.state);
            useProject(saved);try{if(key)localStorage.setItem(key,saved.projectId);}catch{}
            storageNotice('Проект открыт в калькуляторе и сохранён в «Мои объекты». Другие объекты остались в списке.');
          }else{state=linked.state;tab='materials';render();save();storageNotice('Проект открыт. Хранилище браузера недоступно — скачайте JSON через «Файл проекта», чтобы сохранить изменения.');}
          toast('Проект из ссылки открыт. Можно проверять и изменять смету.');
        }
      }catch(error){storageNotice(error.message||'Не удалось открыть проект из ссылки. Загрузите JSON через «Файл проекта».');toast('Ссылка на проект не открылась. Прежние объекты сохранены.',true);}
}
function recoveryDrafts(){const rows=[];try{for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(!key?.startsWith(RECOVERY)||key.endsWith('tab'))continue;try{const v=JSON.parse(localStorage.getItem(key));if(v?.state&&v?.savedAt)rows.push({...v,key});}catch{}}}catch{}return rows.sort((a,b)=>b.savedAt.localeCompare(a.savedAt));}
function dateLabel(value){return new Intl.DateTimeFormat('ru-RU',{dateStyle:'short',timeStyle:'medium',timeZone:'Asia/Irkutsk'}).format(new Date(value));}
async function showProjects(){if(!storageReady)return toast('Хранилище недоступно. Сохраните JSON.',true);const rows=await store.listProjects();$('#projects-list').innerHTML=rows.map(r=>`<article class="library-row"><div><b>${esc(r.title)}</b><small>${esc(dateLabel(r.updatedAt))} · версий: ${r.revisionCount}${r.id===projectId?' · текущий объект':''}</small></div><div class="storage-actions"><button class="secondary-button" data-open-project="${esc(r.id)}">Открыть</button><button class="secondary-button" data-project-versions="${esc(r.id)}">Версии</button></div></article>`).join('');$('#projects-dialog').showModal();}
async function showVersions(id){const rows=await store.listVersions(id);$('#versions-list').innerHTML=rows.map(r=>`<article class="library-row"><div><b>Версия ${r.sequence}</b><small>${esc(dateLabel(r.createdAt))} · ${esc(r.title)}</small></div><button class="secondary-button" data-restore-project="${esc(id)}" data-restore-version="${esc(r.id)}">Восстановить</button></article>`).join('');$('#versions-dialog').showModal();}
function render(){
  $$('[data-bind]').forEach(el=>el.value=state[el.dataset.bind]??'');
  $$('[data-measure]').forEach(el=>el.value=state.measures?.[el.dataset.measure]??'');
  $$('[data-scenario]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.scenario===state.scenario)));
  $$('[data-area]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.area===state.areaMode)));
  $('#building-panel').hidden=state.areaMode!=='building';$('#active-building-notice').hidden=state.areaMode!=='building';if(state.areaMode==='building')$('#building-options').open=true;$('#direct-panel').hidden=state.areaMode!=='direct';$('#walls-panel').hidden=state.areaMode!=='walls';$('#thickness-field').hidden=state.scenario!=='insulated';
  $$('.insulated-project-field').forEach(el=>el.hidden=state.scenario!=='insulated');
  $('#drawing-source').value=state.sourceDocument||'';$('#estimate-kind').value=state.estimateKind||'standard';$('#estimate-assumptions').value=(state.assumptions||[]).join('\n');
  renderDimensions();renderItems();catalogUI?.render();update();
}
function dimensionInput(field,label,value,index,kind){return `<label>${esc(label)}<input data-field="${field}" value="${esc(value)}" inputmode="${field==='count'?'numeric':'decimal'}" placeholder="Введите" maxlength="30" aria-label="${esc(label)} ${kind} ${index+1}"></label>`;}
function renderDimensions(){
  const openReveals=new Set($$('#openings-list .opening-reveals[open]').map(el=>el.closest('[data-id]').dataset.id));
  $('#walls-list').innerHTML=state.walls.map((w,i)=>`<div class="dimension-row" data-dim="walls" data-id="${esc(w.id)}"><div class="dimension-fields"><label class="dimension-name">Название <span data-dim-area>— м²</span><input data-field="name" value="${esc(w.name)}" aria-label="Название поверхности ${i+1}" maxlength="200"></label><label>Форма<select data-field="shape" aria-label="Форма поверхности ${i+1}"><option value="rect" ${w.shape==='rect'?'selected':''}>Прямоугольник</option><option value="triangle" ${w.shape==='triangle'?'selected':''}>Треугольник</option><option value="trapezoid" ${w.shape==='trapezoid'?'selected':''}>Трапеция</option></select></label>${dimensionInput('width',w.shape==='trapezoid'?'Нижнее основание, м':w.shape==='triangle'?'Основание, м':'Ширина фасада, м',w.width,i,'поверхности')}${dimensionInput('height',w.shape==='rect'?'Высота фасада, м':'Высота фигуры, м',w.height,i,'поверхности')}${w.shape==='trapezoid'?dimensionInput('topWidth','Верхнее основание, м',w.topWidth,i,'поверхности'):''}</div><div class="dimension-actions"><button class="icon-button copy-button" data-duplicate-dim aria-label="Дублировать поверхность ${i+1}" title="Дублировать поверхность">⧉</button><button class="icon-button" data-remove-dim aria-label="Удалить поверхность ${i+1}" title="Удалить поверхность">×</button></div></div>`).join('');
  const openingRow=(o,i)=>`<div class="dimension-row opening" data-dim="openings" data-id="${esc(o.id)}"><div class="dimension-fields"><label class="dimension-name">Название <span data-dim-area>— м²</span><input data-field="name" value="${esc(o.name)}" aria-label="Название проёма ${i+1}" maxlength="200"></label><label>Поверхность<select data-field="wallId" aria-label="Поверхность проёма ${i+1}" ${state.areaMode==='building'?'disabled':''}><option value="">Без привязки</option>${state.walls.map(w=>`<option value="${esc(w.id)}" ${o.wallId===w.id?'selected':''}>${esc(w.name||'Без названия')}</option>`).join('')}</select></label><label>Тип проёма<select data-field="type" aria-label="Тип проёма ${i+1}"><option value="" ${!o.type?'selected':''}>Не указан</option><option value="other" ${o.type==='other'?'selected':''}>Другой проём</option><option value="window" ${o.type==='window'?'selected':''}>Окно</option><option value="door" ${o.type==='door'?'selected':''}>Дверь</option></select></label>${dimensionInput('width',o.type==='door'?'Ширина дверного проёма, м':'Ширина, м',o.width,i,'проёма')}${dimensionInput('height',o.type==='door'?'Высота дверного проёма, м':'Высота, м',o.height,i,'проёма')}${dimensionInput('count','Кол-во, шт.',o.count,i,'проёма')}<details class="opening-reveals" ${openReveals.has(o.id)?'open':''}><summary>${o.type==='door'?'Откосы дверного проёма — отдельно':o.type==='window'?'Откосы окна — отдельно':'Откосы этого проёма — отдельно'}</summary><p class="hint">Глубина и стороны задают площадь и длину откосов для отдельных позиций. Площадь стены от них не меняется.</p><div class="opening-reveal-fields">${dimensionInput('depth','Глубина откоса, м',o.depth,i,'проёма')}<label>Стороны откоса<select data-field="sides" aria-label="Стороны откоса проёма ${i+1}"><option value="" ${!o.sides?'selected':''}>Не указаны</option><option value="3" ${o.sides==='3'?'selected':''}>3 стороны: верх + боковые</option><option value="4" ${o.sides==='4'?'selected':''}>4 стороны: весь периметр</option></select></label></div></details></div><div class="dimension-actions"><button class="icon-button copy-button" data-duplicate-dim aria-label="Дублировать проём ${i+1}" title="Дублировать проём">⧉</button><button class="icon-button" data-remove-dim aria-label="Удалить проём ${i+1}" title="Удалить проём">×</button></div></div>`;
  const doorRows=state.openings.map((o,i)=>({o,i})).filter(({o})=>o.type==='door'),otherRows=state.openings.map((o,i)=>({o,i})).filter(({o})=>o.type!=='door');
  $('#openings-list').innerHTML=[['doors','Дверные проёмы',doorRows,'Дверные проёмы не заданы. Добавьте их отдельно по ширине, высоте и количеству.'],['windows','Окна и другие проёмы',otherRows,'Окна и другие проёмы не заданы.']].map(([kind,label,rows,empty])=>`<section class="opening-group" data-opening-group="${kind}"><h4>${label}</h4>${rows.length?rows.map(({o,i})=>openingRow(o,i)).join(''):`<p class="hint">${empty}</p>`}</section>`).join('');
  $('#no-openings').hidden=state.openings.length>0;
}
function rowInput(r,field,label,placeholder,disabled,mode='decimal'){return `<label>${esc(label)}<input data-field="${field}" value="${esc(r[field])}" inputmode="${mode}" placeholder="${esc(placeholder)}" aria-label="${esc(label)}: ${esc(r.name||'Позиция')}" maxlength="${mode==='text'?500:30}" ${disabled}></label>`;}
function renderItems(){
  $$('[data-tab]').forEach(b=>{b.setAttribute('aria-selected',String(b.dataset.tab===tab));b.tabIndex=b.dataset.tab===tab?0:-1;});
  $('#items-panel').setAttribute('aria-labelledby',`tab-${tab}`);$('#work-pricing-help').hidden=tab!=='works';
  $('#quick-item').innerHTML=quickItems[tab].filter(item=>item[4]!=='insulated'||state.scenario==='insulated').map(item=>`<option value="${item[0]}">${esc(item[1])} · ${esc(item[2])}</option>`).join('');
  $('#items-list').innerHTML=state.scenarios[state.scenario][tab].map((r,i)=>{
    const name=esc(r.name||i+1),disabled=r.enabled?'':'disabled',support=['supportLength','supportBrackets','supportAnchors'].includes(r.mode),special=r.mode==='insulationVolume'||r.mode==='panels';
    let detail='';
    if(special)detail+=`<div class="row-detail-fields">${r.mode==='insulationVolume'?rowInput(r,'thickness','Толщина этого слоя, мм','По проекту',disabled):rowInput(r,'coverWidth','Полезная ширина панели, м','По документации',disabled)+rowInput(r,'coverHeight','Полезная высота панели, м','По документации',disabled)}</div><p class="detail-hint">${r.mode==='insulationVolume'?'Одна строка — один слой. Площадь × толщина слоя в метрах; общая толщина проекта автоматически не подставляется.':'Рабочий, а не габаритный размер. Штуки предварительны до раскладки, узлов и раскроя; используйте свою документацию.'}</p>`;
    if(support)detail+=`<div class="row-detail-fields"><label>Направление панелей<select data-field="orientation" ${disabled}><option value="">Укажите</option><option value="horizontal" ${r.orientation==='horizontal'?'selected':''}>Горизонтально</option><option value="vertical" ${r.orientation==='vertical'?'selected':''}>Вертикально</option></select></label>${rowInput(r,'railPitch','Шаг направляющих, м','По проекту',disabled)}${r.mode!=='supportLength'?rowInput(r,'bracketPitch','Шаг кронштейнов, м','По проекту',disabled):''}${r.mode==='supportAnchors'?rowInput(r,'anchorsPerBracket','Анкеров на кронштейн','По узлу',disabled):''}</div>${rowInput(r,'normSource','Источник шагов и крепления','Проект / лист / узел',disabled,'text')}<p class="detail-hint">Предварительная сетка по габариту прямоугольных стен, без вычета проёмов. Дополнительное обрамление и усиления — отдельными позициями. Для сложных поверхностей переключите способ на ручное количество / норму из проекта. Параметры этой строки можно задать здесь; общий комплект обновляется через каталог.</p>`;
    if(r.techNote)detail+=`<p class="detail-hint">${esc(r.techNote)}</p>`;
    if(tab==='materials')detail+=`<div class="row-detail-fields">${rowInput(r,'reserve','Запас, %','Не добавлен',disabled)}${rowInput(r,'pack',`В одной упаковке, ${r.unit||'ед.'}`,'Без округления',disabled)}${rowInput(r,'stock',`Пригодный остаток, ${r.unit||'ед.'}`,'Не задан',disabled)}${rowInput(r,'ordered',`Закреплённый открытый заказ, ${r.unit||'ед.'}`,'Не задан',disabled)}</div><label>Стоимость материала считать<select data-field="costBasis" aria-label="База стоимости: ${name}" ${disabled}><option value="purchase" ${r.costBasis!=='required'?'selected':''}>Только новая закупка</option><option value="required" ${r.costBasis==='required'?'selected':''}>Вся потребность</option></select></label><p class="detail-hint">Учитывайте только пригодный доступный объекту остаток и подтверждённый закреплённый открытый заказ, без повторного учёта одного объёма. Упаковка округляется после вычета. Остаток не делает материал бесплатным: выберите базу стоимости.</p>`;
    else detail+=`<label class="rate-label">Какая ставка введена<select data-field="rateKind" aria-label="Тип ставки: ${name}" ${disabled}>${Object.entries(RATE_LABELS).map(([key,label])=>`<option value="${key}" ${r.rateKind===key?'selected':''}>${esc(label)}</option>`).join('')}</select></label><p class="detail-hint">К базовой работе добавляется 40% один раз. Клиентская ставка уже включает надбавку. Доставка, аренда и другие прямые внешние затраты — без надбавки. Комплект без разбивки требует уточнения труда.</p>`;
    if(r.mode==='norm')detail+=`${rowInput(r,'normSource','Источник нормы расхода','Техкарта / документация конкретного продукта',disabled,'text')}<p class="detail-hint">Расход и запас не назначаются калькулятором. Сохраните источник введённой нормы и проверьте единицы.</p>`;
    const modeOptions=Object.entries(MODE_LABELS).map(([key,label])=>`<option value="${key}" ${r.mode===key?'selected':''}>${esc(label)}${modeUnit(key)?` · ${esc(modeUnit(key))}`:''}</option>`).join('');
    return `<div class="item-row ${r.enabled?'':'disabled'}" data-id="${esc(r.id)}"><div class="item-content"><div class="item-name-line"><input type="checkbox" data-field="enabled" ${r.enabled?'checked':''} aria-label="Включить позицию ${name}"><input class="item-name" data-field="name" value="${esc(r.name)}" placeholder="Название позиции" maxlength="300" aria-label="Название позиции ${i+1}"></div><div class="item-options"><select data-field="mode" aria-label="Способ количества: ${name}" ${disabled}>${modeOptions}</select><input class="unit" data-field="unit" value="${esc(r.unit)}" placeholder="Ед." maxlength="30" aria-label="Единица измерения: ${name}" ${disabled}>${tab==='works'?`<button class="rate-chip ${r.rateKind==='unknown'?'pending':''}" data-open-rate>${r.rateKind==='base'?'Базовая · +40%':r.rateKind==='included'?'Клиентская ставка':r.rateKind==='external'?'Внешние затраты':'Выберите тип ставки'}</button>`:''}${r.mode==='norm'?`<label class="norm-field">Ваш расход<input data-field="norm" value="${esc(r.norm)}" inputmode="decimal" placeholder="Введите" maxlength="30" aria-label="Расход на м²: ${name}" ${disabled}><span>${esc(r.unit||'ед.')} / м²</span></label>`:''}</div>${modeUnit(r.mode)?`<p class="mode-hint">Для выбранной базы единица позиции: ${esc(modeUnit(r.mode))}.</p>`:''}</div><label class="item-quantity"><span class="mobile-label">${tab==='materials'&&r.mode!=='manual'?'К закупке':'Количество'}</span><input data-field="quantity" value="${r.mode==='manual'?esc(r.quantity):''}" inputmode="decimal" placeholder="${r.mode==='manual'?'Введите':'По исходным данным'}" maxlength="30" aria-label="Количество: ${name}" ${r.mode!=='manual'?'readonly':''} ${disabled}><span class="qty-unit" data-quantity-hint>${esc(r.unit)}</span></label><label class="item-price"><span class="mobile-label">Ваша ставка, ₽</span><input data-field="price" value="${esc(r.price)}" inputmode="decimal" placeholder="Введите" maxlength="30" aria-label="Цена за единицу: ${name}" ${disabled}></label><div class="item-sum"><span class="mobile-label">Клиенту, ₽</span><span data-row-total>—</span><small class="row-note" data-row-note></small></div><button class="icon-button item-delete" data-remove-item aria-label="Удалить позицию ${name}" title="Удалить позицию">×</button><details class="row-details" ${special||tab==='works'&&r.rateKind==='unknown'?'open':''}><summary>${tab==='materials'?'Закупка, параметры и источники':'Объём, тип ставки и источники'}<span data-source-status></span></summary>${detail}<div class="row-detail-fields">${rowInput(r,'source','Источник цены','Поставщик / КП / ваша расценка',disabled,'text')}<label>Дата цены<input type="date" data-field="priceDate" value="${esc(r.priceDate)}" aria-label="Дата цены: ${name}" ${disabled}></label></div>${tab==='materials'?'<p class="detail-hint" data-purchase-hint></p>':''}</details></div>`;
  }).join('');
}
const finalReady=c=>c.ready&&c.tax.ready;
function comparisonStatus(c){return !c.ready?`${c.complete} из ${c.active} поз. заполнено`:!c.tax.ready?'Уточните условия НДС':c.confirmed?'Заполнено · к проверке':'Предварительно · уточните цены';}
function focusInput(input){if(!input)return false;input.closest('details')?.setAttribute('open','');input.scrollIntoView({behavior:'smooth',block:'center'});input.focus({preventScroll:true});return true;}
function jumpObject(){if(state.areaMode==='building')focusInput(['buildingLength','buildingWidth','buildingHeight'].map(key=>$(`[data-bind=${key}]`)).find(input=>!(number(input.value)>0))||$('#openings-list [aria-invalid=true]')||$('[data-bind=buildingLength]'));else if(state.areaMode==='direct')focusInput($('[data-bind=directArea]'));else focusInput($('#walls-list [data-field=width]')||$('#add-wall'));}
function jumpMeasure(mode){
  if(Object.hasOwn(linearLabels,mode)){$('#linear-measures').open=true;return focusInput($(`[data-measure=${mode}]`));}
  if(['revealArea','revealLength','sillLength','windowRevealArea','windowRevealLength','doorOpeningArea','doorOpeningCount','doorRevealArea','doorRevealLength'].includes(mode)){
    const type=mode.startsWith('door')?'door':mode.startsWith('window')||mode==='sillLength'?'window':null;
    const rows=$$('#openings-list .dimension-row'),matching=rows.filter(el=>!type||state.openings.find(o=>o.id===el.dataset.id)?.type===type),unknown=rows.find(el=>!state.openings.find(o=>o.id===el.dataset.id)?.type);
    if(type&&unknown)return focusInput(unknown.querySelector('[data-field=type]'));
    if(!matching.length)return focusInput(unknown?.querySelector('[data-field=type]')||$(type==='door'?'#add-door':'#add-opening'));
    const row=matching.find(el=>el.querySelector('[aria-invalid=true]'))||matching[0];
    if(mode==='doorOpeningArea'||mode==='doorOpeningCount'){
      const keys=mode==='doorOpeningCount'?['count']:['width','height','count'];
      const missing=keys.map(key=>row.querySelector(`[data-field=${key}]`)).find(input=>!(number(input.value)>0)||input.dataset.field==='count'&&!Number.isInteger(number(input.value)));
      if(missing)return focusInput(missing);
    }
    return focusInput(row.querySelector('[aria-invalid=true]')||row.querySelector(mode==='doorOpeningArea'||mode==='doorOpeningCount'||mode==='sillLength'?'[data-field=width]':'[data-field=depth]'));
  }
  return false;
}
function jumpToMissing(section,source=false){
  tab=section;renderItems();update();
  const c=calculate(state),missing=(source?c.sourcesMissing:c.missing).find(r=>r.section===section),row=missing&&$$('#items-list .item-row').find(el=>el.dataset.id===missing.id),entry=missing&&state.scenarios[state.scenario][section].find(r=>r.id===missing.id);
  if(row&&entry){const fields=missing.fields||[];
    if(!source&&Object.hasOwn(measureLabels,entry.mode)&&measurements(state)[entry.mode]===null){jumpMeasure(entry.mode);return;}
    let field=source?(entry.source?.trim()?'priceDate':'source'):fields.some(x=>x.includes('тип ставки'))?'rateKind':fields.includes('название')?'name':fields.some(x=>x.includes('единиц'))?'unit':fields.some(x=>x.includes('упаков'))?'pack':fields.some(x=>x.includes('остат'))?'stock':fields.some(x=>x.includes('заказ'))?'ordered':fields.some(x=>x.includes('запас'))?'reserve':fields.some(x=>x.includes('источник нормы')||x.includes('источник проектных'))?'normSource':fields.some(x=>x.includes('шаг направляющих'))?'railPitch':fields.some(x=>x.includes('шаг кронштейнов'))?'bracketPitch':fields.some(x=>x.includes('анкеров на кронштейн'))?'anchorsPerBracket':fields.some(x=>x.includes('направление облицовки'))?'orientation':fields.some(x=>x.includes('расход на м²'))?'norm':entry.mode==='insulationVolume'&&!(number(entry.thickness)>0)?'thickness':entry.mode==='panels'&&!(number(entry.coverWidth)>0)?'coverWidth':entry.mode==='panels'&&!(number(entry.coverHeight)>0)?'coverHeight':fields.includes('количество')?'quantity':'price';
    if(field==='quantity'&&entry.mode!=='manual'){jumpObject();return;}
    if(focusInput(row.querySelector(`[data-field=${field}]`)))return;
  }
  $('#estimate').scrollIntoView({behavior:'smooth',block:'start'});$(`#tab-${tab}`).focus({preventScroll:true});
}
function readinessStep(title,done,text,jump){return `<div class="readiness-step ${done?'done':''}"><span class="readiness-mark">${done?'✓':'·'}</span><div><b>${esc(title)}</b><p>${esc(text)}</p></div>${!done&&jump?`<button data-jump="${jump}">Открыть</button>`:''}</div>`;}
function compactMissing(c,geo){
  const chunks=[];if(geo.errors.length)chunks.push(`<b>Геометрия</b><ul>${geo.errors.slice(0,3).map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`);
  for(const [key,title] of [['materials','Материалы'],['works','Работы']]){const list=c.missing.filter(x=>x.section===key);if(list.length)chunks.push(`<b>${title}</b><ul>${list.slice(0,4).map(x=>`<li>${esc(x.name)}: ${esc(x.fields.join(', '))}</li>`).join('')}</ul>${list.length>4?`<p>Ещё позиций: ${list.length-4}</p>`:''}`);}
  if(c.tax.errors.length)chunks.push(`<b>НДС</b><ul>${c.tax.errors.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`);
  return chunks.length?`<details class="missing-details"><summary>Показать незаполненные поля</summary>${chunks.join('')}</details>`:'';
}
function update(){
  const c=calculate(state),geo=c.geo,m=measurements(state),ready=finalReady(c);
  const activeSystem=state.scenarios[state.scenario].system;
  const activeSchema=activeSystem?.applied?getSystemSchema(activeSystem.variant||activeSystem.selection,activeSystem):null;
  $('#active-system-title').textContent=activeSchema?.title||'Фасадная система и вариант утепления';
  $('#bracket-outreach-field').hidden=!!activeSchema&&activeSchema.method!=='bracket-frame';
  for(const key of ['cladding','insulationType','thickness'])$(`[data-bind=${key}]`).readOnly=!!activeSystem?.applied;
  if(activeSystem?.applied){
    const v=activeSystem.variant||activeSystem.selection,schema=getSystemSchema(v,activeSystem);
    if(v)$('[data-bind=cladding]').value=`${v.manufacturer} · ${v.name}`;
    const ins=[activeSystem.insulationSelection,...(activeSystem.layer2?[activeSystem.insulationSelection2]:[])].filter(Boolean);
    $('[data-bind=insulationType]').value=schema.integratedInsulation?`Встроенный слой панели${v?.coreType?' · '+({'mineral-wool':'минеральная вата',pir:'PIR'}[v.coreType]||v.coreType):''}`:ins.map(x=>`${x.manufacturer} · ${x.name}`).join(' / ');
    const layers=c.sections.materials.rows.filter(r=>r.enabled&&r.mode==='insulationVolume'&&r.kitKey?.startsWith('insulation:layer'));
    $('[data-bind=thickness]').value=schema.integratedInsulation?activeSystem.panelCoreThickness||'':layers.length&&layers.every(r=>number(r.thickness)>0)?fmt(layers.reduce((sum,r)=>sum+number(r.thickness),0),12):'';
  }

  $('#geometry-equation').hidden=state.areaMode==='direct';
  $('#gross-area').textContent=`${fmt(geo.gross,4)} м²`;$('#openings-area').textContent=`${fmt(geo.openings,4)} м²`;$('#net-area').textContent=`${fmt(geo.area,4)} м²`;
  $('#openings-mode-note').textContent=state.areaMode==='building'?'Все заданные проёмы вычитаются общей суммой один раз, без проверки конкретной стены. Сохранённые привязки не меняются и снова применяются в режиме «По стенам: ширина × высота».':state.areaMode==='direct'?'Готовая чистая площадь уже учитывает проёмы. Здесь они задаются только для замеров откосов и отливов — повторного вычета нет.':'Проёмы вычитаются из поверхностей один раз. Привязка к стене позволяет проверить её проёмы; глубина и стороны нужны для отдельных откосов.';
  $('#building-mode-note').textContent=state.areaMode==='building'?'Активен расчёт по габаритам: изменения длины, ширины и высоты обновляют площадь четырёх стен.':'Сейчас габариты сохраняются как сведения об объекте и не меняют площадь. Для их применения нажмите «Рассчитать по габаритам».';
  $('#building-formula').textContent=`2 × (${fmt(number(state.buildingLength),4)} + ${fmt(number(state.buildingWidth),4)}) × ${fmt(number(state.buildingHeight),4)} − ${fmt(geo.openings,4)} = ${fmt(geo.area,4)} м²`;
  $('#gross-area').closest('span').firstChild.textContent=state.areaMode==='building'?'Четыре стены ':'Поверхности ';
  const otherArea=m.openingArea!==null&&m.doorOpeningArea!==null?m.openingArea-m.doorOpeningArea:null;
  $('#measurement-summary').innerHTML=`<div><dt>Чистая площадь стен</dt><dd>${fmt(geo.area,4)} м²</dd></div><div><dt>Окна и прочие проёмы · площадь${state.areaMode==='direct'?' · без повторного вычета':''}</dt><dd>${fmt(otherArea,4)} м²</dd></div><div><dt>Дверные проёмы · отдельная площадь</dt><dd>${fmt(m.doorOpeningArea,4)} м²</dd></div>`;
  const measureCells=keys=>keys.map(key=>`<div class="${m.errors[key]?.length?'measure-unknown':''}"><dt>${esc(measureLabels[key])}</dt><dd>${fmt(m[key],4)} ${modeUnit(key)}</dd>${m.errors[key]?.length?`<small>${esc(m.errors[key][0])}</small>`:''}</div>`).join('');
  $('#window-measurement-summary').innerHTML=measureCells(['windowRevealArea','windowRevealLength']);
  $('#door-measurement-summary').innerHTML=measureCells(['doorOpeningArea','doorOpeningCount','doorRevealArea','doorRevealLength']);
  $('#legacy-measurement-summary').innerHTML=measureCells(['revealArea','revealLength']);
  $('#detail-measurement-summary').innerHTML=measureCells(['sillLength',...Object.keys(linearLabels)]);
  $('#area-status').textContent=geo.errors.length?geo.errors[0]+(geo.errors.length>1?` Ещё ошибок: ${geo.errors.length-1}.`:''):`✓ Площадь для расчёта: ${fmt(geo.area,4)} м². Запас и технологические коэффициенты не добавлены.`;
  $('#area-status').classList.toggle('valid',!geo.errors.length);$('#summary-area').textContent=`${fmt(geo.area,4)} м²`;
  $('#result-scenario').textContent=state.scenario==='insulated'?'С утеплением':'Без утепления';$('#summary-materials').textContent=money(c.sections.materials.subtotal);$('#summary-works').textContent=money(c.sections.works.subtotal);
  $('#grand-total').innerHTML=`${fmt(c.total)} <span>₽</span>`;$('#total-label').textContent=state.estimateKind==='budget'?(c.tax.ready?'Предварительный бюджет':'Предварительный бюджет · НДС уточняется'):c.ready?'Сумма позиций':'Сумма заполненных позиций';
  $('#vat-label').textContent=state.taxMode==='included'?'В том числе НДС':state.taxMode==='onTop'?'НДС сверху':'НДС';
  $('#vat-amount').textContent=state.taxMode==='none'?'Без НДС':c.tax.ready?money(c.tax.amount):'Не определён';$('#payable-total').textContent=ready?money(c.tax.grandTotal):'— ₽';
  $('#tax-status').textContent=!c.ready?'Сумма к оплате появится после заполнения всех включённых позиций и условий НДС.':c.tax.errors.length?c.tax.errors.join(' '):state.taxMode==='included'?'НДС выделен из суммы, повторно не начислен.':state.taxMode==='onTop'?'НДС начислен сверху один раз.':'НДС не начисляется по выбранным условиям.';
  $('#tax-rate-field').hidden=!['included','onTop'].includes(state.taxMode);
  $('#result-status').textContent=ready?(c.confirmed?'Заполнено · требуется проверка инженера':'Предварительно · уточните источники цен'):c.active===0?'Нет включённых позиций':c.overflow?'Слишком большая сумма — проверьте значения':!c.ready?`Расчёт неполный · не готово ${c.active-c.complete} поз.`:'Нужно указать условия НДС';$('#result-status').classList.toggle('ready',ready&&c.confirmed);if(state.estimateKind==='budget'){$('#result-status').textContent='Бюджет по допущениям · не цена договора';$('#result-status').classList.remove('ready');}
  $('#internal-base').textContent=money(c.pricing.base);$('#internal-allowance').textContent=money(c.pricing.allowance);$('#internal-client').textContent=money(c.pricing.clientLabor);$('#internal-external').textContent=money(c.pricing.external);
  $('#completion-label').textContent=c.ready?'Все позиции заполнены':'Заполнено позиций';$('#completion-count').textContent=`${c.complete} / ${c.active}`;$('#completion-bar').style.width=`${c.active?c.complete/c.active*100:0}%`;
  for(const key of ['materials','works'])$(`#${key}-count`).textContent=`${c.sections[key].complete}/${c.sections[key].active}`;
  $('#section-subtotal-label').textContent=`${tab==='materials'?'Материалы':'Работы'} · заполнено ${c.sections[tab].complete} из ${c.sections[tab].active}`;$('#section-subtotal').textContent=money(c.sections[tab].subtotal);
  for(const el of $$('#items-list .item-row')){
    const r=c.sections[tab].rows.find(x=>x.id===el.dataset.id);el.querySelector('[data-row-total]').textContent=r.enabled?fmt(r.value):'—';el.querySelector('.item-sum').classList.toggle('unknown',!r.enabled||r.value===null);
    const notes=!r.enabled?['не учитывается']:r.errors.length?[r.errors.join(' · ')]:[tab==='works'&&r.rateKind==='base'?`Клиентская ставка: ${fmt(r.clientPriceValue,6)} ₽`:!r.sourceConfirmed?'Уточните источник цены':''];
    if(r.enabled&&r.mode==='panels')notes.push('Предварительно до раскладки и раскроя.');
    if(r.enabled&&tab==='materials'&&(r.stock?.trim()||r.ordered?.trim()||r.costBasis==='required'))notes.push(`Стоимость: ${fmt(r.pricedQty,6)} ${r.unit} · ${r.costBasis==='required'?'вся потребность':'новая закупка'}. Новая закупка: ${money(r.purchaseValue)}.`);
    el.querySelector('[data-row-note]').textContent=notes.filter(Boolean).join(' ');el.querySelector('[data-source-status]').textContent=r.enabled?(r.sourceConfirmed?'✓':'уточнить'):'';
    el.querySelector('[data-quantity-hint]').textContent=tab==='materials'&&r.mode==='manual'?`${r.unit} · исходно; к закупке ${fmt(r.qty,6)}`:`${r.unit}${r.packs!==null?` · ${fmt(r.packs,0)} уп.`:''}${tab==='materials'?` · к закупке ${fmt(r.qty,6)}`:''}`;
    const hint=el.querySelector('[data-purchase-hint]');if(hint)hint.textContent=r.qty===null?'Заполните количество, применимую базу замеров и параметры закупки.':`До запаса: ${fmt(r.netQty,6)} ${r.unit}; потребность: ${fmt(r.demandQty,6)}; покрыто остатком / заказом: ${fmt(r.coveredQty,6)}; недостающее: ${fmt(r.neededQty,6)}; к закупке: ${fmt(r.qty,6)}${r.packs!==null?` (${fmt(r.packs,0)} уп.)`:''}. Стоимость считается от ${fmt(r.pricedQty,6)} ${r.unit} (${r.costBasis==='required'?'вся потребность':'новая закупка'}).`;
    if(r.mode!=='manual')el.querySelector('[data-field=quantity]').value=r.qty===null?'':String(r.qty);
    for(const field of ['quantity','price','norm','reserve','pack','stock','ordered','thickness','coverWidth','coverHeight','railPitch','bracketPitch','anchorsPerBracket']){const input=el.querySelector(`[data-field=${field}]`);if(input&&!input.readOnly){const n=number(input.value);input.setAttribute('aria-invalid',String(r.enabled&&input.value.trim()!==''&&(n===null||['pack','thickness','coverWidth','coverHeight','railPitch','bracketPitch','anchorsPerBracket'].includes(field)&&!(n>0)||field==='anchorsPerBracket'&&!Number.isInteger(n))));}}
  }
  const direct=$('[data-bind=directArea]');direct.setAttribute('aria-invalid',String(state.areaMode==='direct'&&state.directArea.trim()!==''&&!(number(state.directArea)>0)));
  for(const key of ['buildingLength','buildingWidth','buildingHeight']){const input=$(`[data-bind=${key}]`);input.setAttribute('aria-invalid',String(input.value.trim()!==''&&!(number(input.value)>0)));}
  $('[data-bind=taxRate]').setAttribute('aria-invalid',String(['included','onTop'].includes(state.taxMode)&&state.taxRate.trim()!==''&&c.tax.errors.some(x=>/ставк|числ|процент/i.test(x))));
  for(const el of $$('[data-measure]'))el.setAttribute('aria-invalid',String(el.value.trim()!==''&&number(el.value)===null));
  for(const el of $$('.dimension-row')){
    const entry=state[el.dataset.dim].find(x=>x.id===el.dataset.id),isOpening=el.dataset.dim==='openings';
    const area=isOpening?(number(entry.width)>0&&number(entry.height)>0&&number(entry.count)>0&&Number.isInteger(number(entry.count))?number(entry.width)*number(entry.height)*number(entry.count):null):geometry({...state,areaMode:'walls',walls:[entry],openings:[]}).area;
    el.querySelector('[data-dim-area]').textContent=`${fmt(area,4)} м²`;
    for(const field of ['width','height','topWidth','count','depth']){const input=el.querySelector(`[data-field=${field}]`);if(input){const n=number(input.value),allowZero=field==='depth';input.setAttribute('aria-invalid',String(input.value.trim()!==''&&(n===null||!allowZero&&!(n>0)||field==='count'&&!Number.isInteger(n))));}}
    if(isOpening){el.querySelector('[data-field=wallId]').setAttribute('aria-invalid',String(state.areaMode!=='building'&&!!entry.wallId&&!state.walls.some(w=>w.id===entry.wallId)));for(const option of el.querySelector('[data-field=wallId]').options){if(option.value){const wall=state.walls.find(w=>w.id===option.value);if(wall)option.textContent=wall.name||'Без названия';}}}
  }
  const materialDone=c.sections.materials.complete===c.sections.materials.active,workDone=c.sections.works.complete===c.sections.works.active;
  let readiness=readinessStep('Площадь фасада',geo.area!==null,geo.area!==null?`${fmt(geo.area,4)} м² · без автоматического запаса`:'Введите габариты, готовую площадь или размеры стен','object');
  readiness+=readinessStep('Материалы',materialDone,`${c.sections.materials.complete} из ${c.sections.materials.active} поз. заполнено`,'materials');readiness+=readinessStep('Работы',workDone,`${c.sections.works.complete} из ${c.sections.works.active} поз. заполнено`,'works');
  const sourceDone=c.complete>0&&!c.sourcesMissing.length;readiness+=readinessStep('Источники цен',sourceDone,c.complete?`${c.complete-c.sourcesMissing.length} из ${c.complete} заполненных поз. с источником и датой`:'Заполняются после цен',c.sourcesMissing.length?`source-${c.sourcesMissing[0].section}`:'materials');
  readiness+=readinessStep('Условия НДС',c.tax.ready,c.tax.ready?'Режим и необходимые параметры заданы':'Выберите режим, ставку задайте только по документам','tax');
  if(ready)readiness+=`<p class="missing-ok">${c.confirmed?'✓ Включённые позиции и условия НДС заполнены.':'Расчёт предварительный: заполните источники и даты цен.'} Проверьте состав и передайте инженеру на проверку.</p>`;
  const next=geo.area===null?'object':c.missing[0]?.section||(c.sourcesMissing[0]?`source-${c.sourcesMissing[0].section}`:!c.tax.ready?'tax':null);
  $('#next-field').hidden=!next;$('#next-field').dataset.jump=next||'';$('#next-field').textContent=geo.area===null?'1. Ввести площадь фасада':c.missing[0]?`Заполнить: ${c.missing[0].name}`:c.sourcesMissing[0]?'Указать источник цены':'Указать условия НДС';
  if(state.scenario==='insulated'&&(!state.thickness.trim()||!state.insulationType.trim()))readiness+='<p class="readiness-note"><b>Для проекта:</b> тип и общую толщину утепления укажите по проекту. Вылет, крепёж и нормы не назначаются автоматически.</p>';
  readiness+=compactMissing(c,geo);$('#missing-data').innerHTML=readiness;
  const variants={insulated:calculate(state,'insulated'),bare:calculate(state,'bare')};for(const key of ['insulated','bare']){$(`#compare-${key}-total`).textContent=money(finalReady(variants[key])?variants[key].tax.grandTotal:variants[key].total);$(`#compare-${key}-status`).textContent=comparisonStatus(variants[key]);}
  const difference=$('#comparison-difference');if(finalReady(variants.insulated)&&finalReady(variants.bare)){const delta=variants.insulated.tax.grandTotal-variants.bare.tax.grandTotal;difference.textContent=delta===0?'Суммы к оплате вариантов равны.':`Разница к оплате по введённым условиям: ${money(Math.abs(delta))} · ${delta>0?'вариант с утеплением выше':'вариант без утепления выше'}.`;difference.classList.add('ready');}else{difference.textContent='Для сравнения сумм к оплате заполните включённые позиции и условия НДС обоих вариантов.';difference.classList.remove('ready');}
  catalogUI?.refresh();
}
document.addEventListener('input',e=>{
  const el=e.target;if(booting)return;if(el.id==='drawing-source'){state.sourceDocument=el.value;save();return;}if(el.id==='estimate-kind'){state.estimateKind=el.value;save();update();return;}if(el.id==='estimate-assumptions'){const list=el.value.split(/\r?\n/).filter(x=>x.trim());if(list.length>200||list.some(x=>x.length>1000)){toast('До 200 допущений, каждое — не более 1000 символов.',true);return;}state.assumptions=list;save();return;}if(el.matches('[data-bind]')){state[el.dataset.bind]=el.value;save();update();return;}
  if(el.matches('[data-measure]')){state.measures[el.dataset.measure]=el.value;save();update();return;}
  const dim=el.closest('[data-dim]');if(dim&&el.dataset.field){state[dim.dataset.dim].find(x=>x.id===dim.dataset.id)[el.dataset.field]=el.value;save();update();return;}
  const item=el.closest('.item-row');if(item&&el.dataset.field&&el.type!=='checkbox'&&el.tagName!=='SELECT'){state.scenarios[state.scenario][tab].find(x=>x.id===item.dataset.id)[el.dataset.field]=el.value;save();update();}
});
document.addEventListener('change',e=>{
  const el=e.target,item=el.closest('.item-row'),dim=el.closest('[data-dim]');
  if(item&&el.dataset.field){const r=state.scenarios[state.scenario][tab].find(x=>x.id===item.dataset.id);r[el.dataset.field]=el.type==='checkbox'?el.checked:el.value;
    if(el.dataset.field==='mode'&&!r.unit.trim()&&modeUnit(r.mode))r.unit=modeUnit(r.mode);
    if(['enabled','mode','unit','rateKind'].includes(el.dataset.field)){renderItems();update();}else update();save();
  }
  if(dim&&el.dataset.field){state[dim.dataset.dim].find(x=>x.id===dim.dataset.id)[el.dataset.field]=el.value;if(['shape','type'].includes(el.dataset.field)){const id=dim.dataset.id,field=el.dataset.field;if(field==='type'){syncOpeningRows(state);renderItems();}renderDimensions();update();focusInput($$('.dimension-row').find(row=>row.dataset.id===id)?.querySelector(`[data-field=${field}]`));}else update();save();}
});
document.addEventListener('click',e=>{
  const button=e.target.closest('button');if(!button||booting)return;
  if(button.dataset.scenario){state.scenario=button.dataset.scenario;syncOpeningRows(state);render();save();return;}
  if(button.dataset.area){state.areaMode=button.dataset.area;render();save();if(button.id==='calculate-building'){if(geometry(state).area===null)jumpObject();else $('#geometry-equation').scrollIntoView({behavior:'smooth',block:'center'});}return;}
  if(button.dataset.tab){tab=button.dataset.tab;renderItems();update();return;}
  if(button.dataset.jump){if(['materials','works','source-materials','source-works'].includes(button.dataset.jump))jumpToMissing(button.dataset.jump.replace('source-',''),button.dataset.jump.startsWith('source-'));else if(button.dataset.jump==='tax')focusInput($('[data-bind=taxMode]'));else jumpObject();return;}
  if(button.hasAttribute('data-duplicate-dim')){const el=button.closest('[data-dim]'),list=state[el.dataset.dim];if(list.length>=200)return toast('Можно добавить до 200 строк геометрии.',true);const at=list.findIndex(x=>x.id===el.dataset.id),source=list[at];list.splice(at+1,0,{...source,id:uid(),name:`${source.name||'Строка'} — копия`});renderDimensions();update();save();return;}
  if(button.hasAttribute('data-remove-dim')){const el=button.closest('[data-dim]'),isWall=el.dataset.dim==='walls';let detached=0;if(isWall)for(const opening of state.openings)if(opening.wallId===el.dataset.id){opening.wallId='';detached++;}state[el.dataset.dim]=state[el.dataset.dim].filter(x=>x.id!==el.dataset.id);renderDimensions();update();save();if(detached)toast(`Поверхность удалена. Проёмов без привязки: ${detached}; выберите для них другую стену.`,true);return;}
  if(button.hasAttribute('data-open-rate')){const row=button.closest('.item-row');row.querySelector('details').open=true;row.querySelector('[data-field=rateKind]').focus();return;}
  if(button.hasAttribute('data-remove-item')){const el=button.closest('.item-row');state.scenarios[state.scenario][tab]=state.scenarios[state.scenario][tab].filter(x=>x.id!==el.dataset.id);renderItems();update();save();return;}
});
$('.estimate-tabs').addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();tab=e.key==='Home'?'materials':e.key==='End'?'works':tab==='materials'?'works':'materials';renderItems();update();$(`#tab-${tab}`).focus();});
$('#add-wall').addEventListener('click',()=>{if(state.walls.length>=200)return toast('Можно добавить до 200 поверхностей.',true);state.walls.push({id:uid(),name:`Стена ${state.walls.length+1}`,shape:'rect',width:'',topWidth:'',height:''});renderDimensions();update();save();$('#walls-list .dimension-row:last-child input').focus();});
function addOpening(type){if(state.openings.length>=200)return toast('Можно добавить до 200 типов проёмов.',true);const id=uid();state.openings.push({id,name:`${type==='door'?'Дверной проём':'Окно'} ${state.openings.length+1}`,wallId:'',type,width:'',height:'',count:'',depth:'',sides:''});syncOpeningRows(state);renderItems();renderDimensions();update();save();focusInput($$('#openings-list .dimension-row').find(row=>row.dataset.id===id)?.querySelector('[data-field=width]'));}
$('#add-opening').addEventListener('click',()=>addOpening('window'));
$('#add-door').addEventListener('click',()=>addOpening('door'));
$('#add-item').addEventListener('click',()=>{const list=state.scenarios[state.scenario][tab];if(list.length>=200)return toast('В разделе можно добавить до 200 позиций.',true);list.push(createRow());renderItems();update();save();$('#items-list .item-row:last-child .item-name').focus();});
$('#add-quick-item').addEventListener('click',()=>{const candidate=quickItems[tab].find(item=>item[0]===$('#quick-item').value),list=state.scenarios[state.scenario][tab];if(!candidate)return;if(list.length>=200)return toast('В разделе можно добавить до 200 позиций.',true);const [,name,unit,mode,kind]=candidate;list.push(createRow(name,unit,mode,tab==='materials'||kind==='external'?'external':'base'));renderItems();update();save();const row=$('#items-list .item-row:last-child');if(['insulationVolume','panels'].includes(mode))row.querySelector('details').open=true;focusInput(row.querySelector(mode==='insulationVolume'?'[data-field=thickness]':mode==='panels'?'[data-field=coverWidth]':'.item-name'));toast('Позиция добавлена без цены. Проверьте применимость, единицы и отсутствие двойного учёта.');});
function download(content,type,filename){const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
function filename(ext){const title=state.project.trim().replace(/[^\p{L}\p{N}\s_-]/gu,'').replace(/\s+/g,'-').slice(0,60)||'Новый-объект';return `СВОИ-ЛЮДИ-${title}-${state.scenario==='insulated'?'с-утеплением':'без-утепления'}.${ext}`;}
$('#download-csv').addEventListener('click',()=>{download(csv(state),'text/csv;charset=utf-8',filename('csv'));toast(calculate(state).ready?'Расчёт сохранён в CSV.':'CSV сохранён с пометкой «Неполный расчёт». Пустые значения оставлены пустыми.');});
$('#save-project').addEventListener('click',()=>{try{download(serializeProject(state),'application/json;charset=utf-8',filename('json'));$('.file-menu').open=false;toast('Файл проекта сохранён. В нём оба варианта фасада.');}catch(error){toast(error.message,true);}});
$('#load-project').addEventListener('click',()=>{$('.file-menu').open=false;$('#import-file').click();});
$('#import-file').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>MAX_PROJECT_FILE_BYTES)throw Error('Файл слишком большой. Максимум 16 МБ.');const next=validateImport(JSON.parse(await file.text()));if(!await beforeSwitch())return;if(storageReady)useProject(await store.createProject(next));else{state=next;tab='materials';render();save();}toast('Проект загружен отдельным объектом. Прежние объекты сохранены.');}catch(err){toast(err instanceof SyntaxError?'Не удалось прочитать JSON. Выберите файл проекта калькулятора.':err.message,true);}finally{e.target.value='';}});
$('#new-project').addEventListener('click',()=>{$('.file-menu').open=false;$('#reset-dialog').showModal();});
$('#cancel-reset').addEventListener('click',()=>$('#reset-dialog').close());
$('#confirm-reset').addEventListener('click',async()=>{try{if(!await beforeSwitch())return;if(storageReady)useProject(await store.createProject(initialState()));else{state=initialState();tab='materials';render();save();}$('#reset-dialog').close();toast('Новый объект создан. Прежние объекты остались в списке.');}catch(error){toast(error.message,true);}});
function printReport(){$('#print-report').innerHTML=buildReport(state);}
window.addEventListener('beforeprint',printReport);
$('#print-project').addEventListener('click',()=>{$('.file-menu').open=false;printReport();window.print();});
$$('.step-nav a').forEach(a=>a.addEventListener('click',()=>{$$('.step-nav a').forEach(x=>x.classList.toggle('active',x===a));}));
catalogUI=createCatalogUI({element:$('#system-catalog'),getState:()=>state,onNotice:toast,
  onScenario:scenario=>{state.scenario=scenario;syncOpeningRows(state);render();save();},
  onApply:next=>{state=next;tab='materials';render();save();},
  onCreate:async next=>{if(!await beforeSwitch())throw Error('Переход отменён. Сначала сохраните текущий проект.');if(storageReady)useProject(await store.createProject(next));else{state=next;tab='materials';render();save();}}
});
const projectReady=initialize();
let projectLinkQueue=Promise.resolve();
window.addEventListener('hashchange',()=>{const hash=location.hash;if(hash!=='#project'&&!hash.startsWith('#project='))return;history.replaceState(null,'',location.pathname+location.search);projectLinkQueue=projectLinkQueue.then(async()=>{await projectReady;if(!await beforeSwitch())return;booting=true;$('main').inert=true;$('header').inert=true;try{await openLinkedProject(hash);}finally{booting=false;$('main').inert=false;$('header').inert=false;}}).catch(error=>{storageNotice(error.message||'Не удалось открыть проект.');});});

$('#download-report').addEventListener('click',async()=>{
  try {
    printReport();
    const response=await fetch('./brand/logo-sl-approved-light.png');
    if(!response.ok)throw Error('Logo unavailable');
    const blob=await response.blob();
    const logo=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(blob);});
    const report=buildStandaloneReport(state,logo);
    download(report,'text/html;charset=utf-8',filename('html'));
    if(previewUrl)URL.revokeObjectURL(previewUrl);
    previewUrl=URL.createObjectURL(new Blob([report],{type:'text/html;charset=utf-8'}));
    $('#report-preview').href=previewUrl;$('#report-preview').hidden=false;
    toast('Расчёт с вашим логотипом подготовлен. Если файл не скачался, откройте просмотр для печати.');
  }catch{toast('Не удалось встроить логотип. Повторите скачивание или используйте Печать / PDF.',true);}
});

$('#copy-common').addEventListener('click',()=>{const result=copyCommonRows(state);save();update();toast(`Перенесено общих позиций: ${result.copied}. Совпадений с заполненными строками: ${result.skipped}. Проверьте подсистему для другого варианта.`);});

window.addEventListener('pagehide',()=>{clearTimeout(saveTimer);recoverySnapshot();});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'){recoverySnapshot();void flushSave();}});

$('#open-projects').addEventListener('click',()=>{void showProjects().catch(e=>toast(e.message,true));$('.file-menu').open=false;});
$('#save-version').addEventListener('click',async()=>{const ok=await flushSave(true);if(ok)toast('Текущая версия сохранена в истории.');});
$('#save-conflict-copy').addEventListener('click',async()=>{try{if(inFlight)await inFlight;const copy=structuredClone(state);copy.project=(copy.project||'Объект')+' — копия из другой вкладки';useProject(await store.createProject(copy));toast('Изменения сохранены отдельным объектом. Исходный объект не заменён.');}catch(e){toast(e.message,true);}});
$('#open-recovery').addEventListener('click',()=>{const drafts=recoveryDrafts();$('#recovery-list').innerHTML=drafts.map((d,i)=>`<article class="library-row"><div><b>${esc(d.state.project||'Без названия')}</b><small>${esc(dateLabel(d.savedAt))}</small></div><button class="secondary-button" data-recover-draft="${i}">Открыть копией</button></article>`).join('')||'<p>Черновиков нет.</p>';$('#recovery-dialog').showModal();});
document.addEventListener('click',async e=>{const b=e.target.closest('button');if(!b||booting)return;try{
  if(b.dataset.closeDialog)$('#'+b.dataset.closeDialog).close();
  if(b.dataset.openProject){if(!await beforeSwitch())return;useProject(await store.loadProject(b.dataset.openProject));$('#projects-dialog').close();}
  if(b.dataset.projectVersions)await showVersions(b.dataset.projectVersions);
  if(b.dataset.restoreVersion){selectedRestore={projectId:b.dataset.restoreProject,revisionId:b.dataset.restoreVersion};$('#restore-dialog').showModal();}
  if(b.dataset.recoverDraft!==undefined){const draft=recoveryDrafts()[Number(b.dataset.recoverDraft)];if(!draft)return;if(!await beforeSwitch())return;const copy=validateImport(draft.state);copy.project=(copy.project||'Объект')+' — восстановленный черновик';useProject(await store.createProject(copy));try{localStorage.removeItem(draft.key);}catch{}$('#recovery-dialog').close();toast('Черновик восстановлен отдельной копией.');}
}catch(error){toast(error.message,true);}});
$('#confirm-restore').addEventListener('click',async()=>{try{if(!selectedRestore||!await beforeSwitch())return;const current=await store.loadProject(selectedRestore.projectId);const restored=await store.restoreVersion({projectId:current.projectId,baseRevision:current.revisionId,revisionId:selectedRestore.revisionId});useProject(restored);for(const id of ['restore-dialog','versions-dialog','projects-dialog'])$('#'+id).close();toast('Версия восстановлена. Более новые версии остались в истории.');}catch(e){toast(e.message,true);}});
$('#drawing-file').addEventListener('change',e=>{const file=e.target.files[0];if(!file)return;if(!['application/pdf','image/png','image/jpeg'].includes(file.type)||file.size>30*1024*1024)return toast('Выберите PDF, PNG или JPG до 30 МБ.',true);if(drawingUrl)URL.revokeObjectURL(drawingUrl);drawingUrl=URL.createObjectURL(file);$('#drawing-open').href=drawingUrl;$('#drawing-open').hidden=false;$('#drawing-view').hidden=false;$('#drawing-view').innerHTML=file.type==='application/pdf'?'<iframe title="Просмотр чертежа"></iframe>':'<img alt="Чертёж для сверки обмеров">';$('#drawing-view').firstElementChild.src=drawingUrl;$('#drawing-source').value=file.name;state.sourceDocument=file.name;save();});
$('#review-takeoff').addEventListener('click',()=>{try{pendingTakeoff=parseTakeoff($('#takeoff-text').value);$('#takeoff-preview').innerHTML='<p>Проверьте перед переносом: это размеры в метрах.</p><ul>'+pendingTakeoff.map(w=>`<li>${esc(w.name)}: ${esc(w.width)} × ${esc(w.height)} м</li>`).join('')+'</ul>';$('#takeoff-preview').hidden=false;$('#apply-takeoff').hidden=false;}catch(e){pendingTakeoff=null;$('#apply-takeoff').hidden=true;toast(e.message,true);}});
$('#takeoff-text').addEventListener('input',()=>{pendingTakeoff=null;$('#takeoff-preview').hidden=true;$('#apply-takeoff').hidden=true;});
$('#apply-takeoff').addEventListener('click',async()=>{if(!pendingTakeoff||!await beforeSwitch())return;state.walls=pendingTakeoff;state.areaMode='walls';for(const o of state.openings)o.wallId='';state.sourceDocument=$('#drawing-source').value;pendingTakeoff=null;render();save();$('#takeoff-preview').hidden=true;$('#apply-takeoff').hidden=true;toast('Поверхности перенесены. Проверьте проёмы и заново привяжите их к стенам.');});

$('#fallback-save-and-continue').addEventListener('click',()=>{try{download(serializeProject(state),'application/json;charset=utf-8',filename('json'));recoverySnapshot();dirty=false;$('#fallback-switch-dialog').close();pendingFallback?.(true);pendingFallback=null;}catch(error){toast(error.message,true);}});
$('#fallback-cancel-switch').addEventListener('click',()=>{$('#fallback-switch-dialog').close();pendingFallback?.(false);pendingFallback=null;});
$('#fallback-switch-dialog').addEventListener('cancel',()=>{pendingFallback?.(false);pendingFallback=null;});
