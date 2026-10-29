import { calculate, createProject, changeAssembly, upgradeFoundationRows, applyScope, createRow, uid, TECHNOLOGIES, STAGES, GROUPS, METRICS, format, money, parseProject, serializeProject, MAX_FILE_BYTES, WARNING } from './engine.mjs';
import { PROJECTS, referenceProject } from './project-catalog.mjs';
import { createReport, escapeHtml as esc } from './report.mjs';
import { readStorage, saveStorage, snapshot, STORAGE_KEY } from './storage.mjs';
import { PRICE_SOURCES } from './price-sources.mjs';

const $ = selector => document.querySelector(selector);
let project = createProject(), versions = [], revision = null, paused = false, timer, drawingUrl, logo;
function message(text) { $('#save-status').textContent = text; }
function pause(error) {
  paused = true; $('#storage-warning').hidden = false;
  $('#storage-warning').textContent = `${error.message || error} Текущий расчёт доступен для работы и скачивания JSON.`;
  $('#resume-storage').hidden = false;
}
try {
  const saved = readStorage(localStorage);
  project = saved.project || project; versions = saved.versions; revision = saved.revision;
  message(saved.project ? 'Открыт последний расчёт из этого браузера.' : 'Новый расчёт. Заполните параметры или загрузите проект для проверки.');
} catch (error) { pause(error); }
function save() {
  clearTimeout(timer);
  if (paused) return;
  project.updatedAt = new Date().toISOString();
  try { revision = saveStorage(localStorage, project, versions, revision); message('Сохранено в этом браузере. Для резервной копии скачайте JSON.'); }
  catch (error) { pause(error); }
}
function changed() {
  project.reviewed = false; $('[data-bind="reviewed"]').checked = false;
  updateCalculation(); clearTimeout(timer); if (!paused) timer = setTimeout(save, 500);
}
function keepVersion(name = '') { versions.push(snapshot(project, name)); versions = versions.slice(-8); }
function replaceProject(next, reason) {
  keepVersion(reason || 'Перед заменой расчёта'); project = next; renderAll(); save();
}
function get(path) { return path.split('.').reduce((value, key) => value[key], project); }
function set(path, value) { const keys = path.split('.'), final = keys.pop(); keys.reduce((item, key) => item[key], project)[final] = value; }
const checked = value => value ? ' checked' : '';
const options = (values, selected) => Object.entries(values).map(([id, name]) => `<option value="${esc(id)}"${id === selected ? ' selected' : ''}>${esc(Array.isArray(name) ? name[0] : name)}</option>`).join('');
function renderStructure() {
  $('#solid-fields').hidden = project.technology === 'frame'; $('#frame-fields').hidden = project.technology !== 'frame';
  $('#foam-fields').hidden = project.technology !== 'foam'; $('#timber-note').hidden = project.technology !== 'timber';
  $('[data-bind="geometry.gableStructure"]').disabled = project.technology === 'frame';
  document.querySelectorAll('[data-technology]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.technology === project.technology)));
  const type = project.foundation.type;
  $('#foundation-manual').hidden = type !== 'manual'; $('#foundation-piles').hidden = type !== 'piles';
  $('#foundation-dimensions').hidden = !['slab', 'strip'].includes(type);
  $('#foundation-length-label').textContent = type === 'strip' ? 'Расчётная длина лент без задвоений, м' : 'Длина плиты по проекту, м';
  $('#foundation-width-label').textContent = type === 'strip' ? 'Ширина ленты, м' : 'Ширина плиты по проекту, м';
  $('#foundation-strip-note').hidden = type !== 'strip';
  $('#foundation-formwork').hidden = type === 'piles';
  const formGeometry = project.foundation.formworkMode === 'geometry';
  $('#formwork-geometry-option').disabled = !['slab', 'strip'].includes(type);
  $('#formwork-manual').hidden = formGeometry;
  $('#formwork-height').hidden = !formGeometry;
  $('#formwork-strip').hidden = !formGeometry || type !== 'strip';
  $('#formwork-slab-note').hidden = !formGeometry || type !== 'slab';
  $('#foundation-upgrade').hidden = type === 'piles' || project.rows.some(r => r.id === 'foundation-form-remove');
  $('#roof-direct').hidden = project.roof.mode !== 'direct'; $('#roof-dimensions').hidden = project.roof.mode === 'direct';
  $('#target-profit-field').hidden = project.saleMode !== 'cost-plus'; $('#contract-price-field').hidden = project.saleMode !== 'contract';
  $('#reference-notice').hidden = !project.reference;
  if (project.reference) $('#reference-notice').innerHTML = `<b>Проверочный проект:</b> <a href="${esc(project.reference.url)}" target="_blank" rel="noopener noreferrer">${esc(project.reference.title)} ↗</a><br>${esc(project.reference.publishedArea)} · проверен ${esc(project.reference.checked)}<br>${esc(project.reference.note)}`;
}
function renderRows() {
  const openStages = new Set([...document.querySelectorAll('.estimate-stage[open]')].map(d => d.dataset.stage));
  const first = !$('#estimate-rows').children.length;
  $('#stage-switches').innerHTML = Object.entries(STAGES).map(([key, name]) => `<label><input type="checkbox" data-stage="${key}"${checked(project.stages[key])}>${esc(name)}</label>`).join('');
  $('#estimate-rows').innerHTML = Object.entries(STAGES).filter(([key]) => project.stages[key]).map(([stage, name]) => {
    const rows = project.rows.filter(r => r.stage === stage);
    return `<details class="estimate-stage" id="stage-${stage}" data-stage="${stage}"${openStages.has(stage) || first && stage === 'walls' ? ' open' : ''}><summary>${esc(name)}<small>${rows.filter(r => r.enabled).length} позиций включено</small></summary>${rows.map(row => {
      const prefix = `row-${row.id}`;
      return `<article class="estimate-row${row.enabled ? '' : ' disabled'}" id="${esc(prefix)}" data-row-id="${esc(row.id)}"><div class="row-head"><label><input type="checkbox" data-row="${esc(row.id)}" data-key="enabled" aria-label="Включить ${esc(row.name)}"${checked(row.enabled)}><input class="row-name" data-row="${esc(row.id)}" data-key="name" value="${esc(row.name)}" maxlength="1000" aria-label="Наименование позиции"></label>${row.template ? '' : `<button class="small-button" data-delete="${esc(row.id)}" aria-label="Удалить позицию ${esc(row.name)}">Удалить</button>`}</div><p class="row-group">${esc(GROUPS[row.group])} · ${esc(row.unit || 'единица не указана')}</p><div class="row-main"><label>${row.group === 'materials' ? 'К закупке' : 'Объём'}${row.metric === 'manual' ? `<input data-row="${esc(row.id)}" data-key="quantity" inputmode="decimal" value="${esc(row.quantity)}" placeholder="Количество" aria-label="Количество ${esc(row.name)}">` : `<output data-quantity="${esc(row.id)}">—</output>`}<small>${esc(row.unit)} · ${esc(METRICS[row.metric][0])}</small></label><label>${row.group === 'works' ? 'Оплата бригаде' : 'Цена за единицу'}, ₽<input data-row="${esc(row.id)}" data-key="price" inputmode="decimal" value="${esc(row.price)}" placeholder="Ваша расценка" aria-label="Цена ${esc(row.name)}"></label><label class="sum-label">Сумма<output data-amount="${esc(row.id)}">—</output></label></div><details class="row-more"><summary>Источник, способ расчёта${row.group === 'materials' ? ', запас и упаковка' : ''}</summary><div class="fields two"><label>Способ расчёта<select data-row="${esc(row.id)}" data-key="metric">${options(METRICS, row.metric)}</select></label><label>Единица измерения<input data-row="${esc(row.id)}" data-key="unit" value="${esc(row.unit)}" maxlength="30"${row.metric !== 'manual' ? ' readonly' : ''}></label>${row.group === 'materials' ? `<label>Запас, %<input data-row="${esc(row.id)}" data-key="reserve" value="${esc(row.reserve)}" inputmode="decimal" placeholder="0 — без запаса"></label><label>Количество в упаковке <small>пусто — упаковка не учитывается</small><input data-row="${esc(row.id)}" data-key="pack" value="${esc(row.pack)}" inputmode="decimal" placeholder="В единицах этой строки"></label>` : ''}<label>Источник цены / состав комплекта<input data-row="${esc(row.id)}" data-key="source" value="${esc(row.source)}" maxlength="2000" placeholder="Поставщик, КП, прайс или согласовано владельцем"></label><label>Дата цены<input data-row="${esc(row.id)}" data-key="date" type="date" value="${esc(row.date)}"></label>${!row.template ? `<label>Этап<select data-row="${esc(row.id)}" data-key="stage">${options(STAGES, row.stage)}</select></label><label>Группа затрат<select data-row="${esc(row.id)}" data-key="group">${options(GROUPS, row.group)}</select></label>` : ''}</div></details><p class="row-state" data-errors="${esc(row.id)}"></p></article>`;
    }).join('')}</details>`;
  }).join('');
}
function renderVersions() {
  $('#versions-list').innerHTML = versions.length ? [...versions].reverse().map(v => `<div class="version-row"><div><b>${esc(v.name)}</b><p>${esc(new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Irkutsk' }).format(new Date(v.date)))}</p></div><button class="secondary" data-version="${esc(v.id)}">Открыть</button></div>`).join('') : '<p class="hint">Версий пока нет. Перед сменой технологии, проекта или импортом текущий расчёт сохраняется здесь.</p>';
}
function updateCalculation() {
  const c = calculate(project);
  const foundationMetrics = project.foundation.type === 'piles' ? [['pileCount', 'Сваи по проекту', 'шт.']] : [['foundationVolume', 'Бетон фундамента', 'м³'], ['foundationFormworkArea', 'Площадь контакта опалубки', 'м²']];
  const metrics = [['footprint', 'Наружный контур уровня', 'м²'], ['perimeter', 'Наружный периметр', 'м.п.'], ['wallArea', 'Наружные стены с фронтонами', 'м²'], ...project.technology === 'frame' ? [['frameLumber', 'Каркас по спецификации', 'м³'], ['insulationVolume', 'Утеплитель в ячейках', 'м³']] : [['wallVolume', 'Сплошные стены', 'м³']], ...project.technology === 'foam' ? [['blockCount', 'Пеноблок до запаса', 'шт.']] : [], ...foundationMetrics, ['floorArea', 'Перекрытия по проекту', 'м²'], ['roofArea', 'Кровля по скатам', 'м²']];
  $('#metrics').innerHTML = metrics.map(([key, label, unit]) => `<div><dt>${esc(label)}<small>${esc(unit)}</small></dt><dd>${esc(format(c.metrics[key]))}</dd></div>`).join('');
  $('#foundation-metrics').innerHTML = foundationMetrics.map(([key, label, unit]) => `<div><dt>${esc(label)}<small>${esc(unit)}</small></dt><dd>${esc(format(c.metrics[key]))}</dd></div>`).join('');
  $('#foundation-errors').textContent = Object.values(c.foundationErrors).join(' ');
  const foundationRows = c.rows.filter(r => r.stage === 'foundation');
  const foundationComplete = foundationRows.length > 0 && foundationRows.every(r => !r.errors.length);
  $('#foundation-costs').innerHTML = !project.stages.foundation ? '<p class="hint">Этап «Фундамент» исключён из общей сметы.</p>' : `<p class="hint">${foundationComplete ? 'Затраты по включённым строкам фундамента' : 'Известные затраты на фундамент — состав / цены не заполнены полностью'}. Накладные, ваше вознаграждение, налог и прибыль задаются в общем итоге.</p><dl class="foundation-summary">${Object.entries(GROUPS).map(([key, label]) => `<div><dt>${esc(label)}</dt><dd>${esc(money(foundationRows.filter(r => r.group === key).reduce((sum, row) => sum + (row.amount ?? 0n), 0n)))}</dd></div>`).join('')}</dl>`;
  $('#costs').innerHTML = Object.entries(GROUPS).map(([key, label]) => `<div><dt>${esc(label)}<small>известная часть</small></dt><dd>${esc(money(c.groups[key]))}</dd></div>`).join('') + `<div><dt>Себестоимость<small>${c.costComplete ? 'все включённые строки заполнены' : 'известный подытог, неполно'}</small></dt><dd>${esc(money(c.costSubtotal))}</dd></div>`;
  $('#profit-results').innerHTML = [['Затраты с накладными, вознаграждением и налогом', c.fullCost], ['Ваше вознаграждение руководителя', c.ownerPay], ['Плановая прибыль ООО после учтённого налога', c.companyProfit]].map(([name, value]) => `<div><dt>${esc(name)}</dt><dd>${esc(money(value))}</dd></div>`).join('');
  $('#grand-total').textContent = money(c.total); $('#total-label').textContent = c.total === null ? 'Общий итог не определён' : 'Предварительная цена включённого состава';
  $('#total-note').textContent = `${c.rows.filter(r => r.amount !== null).length} из ${c.rows.length} включённых строк имеют рассчитанную сумму. ${c.total === null ? 'Подытог не является полной стоимостью строительства.' : 'Итог относится к указанным этапам, позициям и исключениям.'}`;
  $('#completion-reasons').innerHTML = c.reasons.length ? `<ul>${c.reasons.map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : '';
  const byId = new Map(c.rows.map(r => [r.id, r]));
  document.querySelectorAll('[data-quantity]').forEach(el => { el.textContent = format(byId.get(el.dataset.quantity)?.calculatedQuantity); });
  document.querySelectorAll('[data-amount]').forEach(el => { el.textContent = money(byId.get(el.dataset.amount)?.amount); });
  document.querySelectorAll('[data-errors]').forEach(el => {
    const r = byId.get(el.dataset.errors);
    el.textContent = r ? r.errors.length ? `Уточнить: ${r.errors.join('; ')}.` : 'Данные строки заполнены.' : 'Позиция исключена из расчёта.';
  });
  $('#missing-summary').innerHTML = `<p class="hint">${c.missing.length ? `${c.missing.length} позиций требуют данных. Нажмите на название, чтобы перейти к заполнению.` : 'Включённые строки заполнены.'}</p>`;
  $('#missing-list').innerHTML = Object.keys(STAGES).map(stage => {
    const items = c.missing.filter(r => r.stage === stage);
    return items.length ? `<details class="missing-stage"><summary>${esc(STAGES[stage])} · ${items.length}</summary>${items.map(r => `<div class="missing-item"><a href="#row-${esc(r.id)}" data-goto="${esc(r.id)}">${esc(r.name)}</a><br>${esc(r.errors.join('; '))}</div>`).join('')}</details>` : '';
  }).join('');
  const exclusions = [...c.excluded, ...c.excludedRows];
  $('#exclusions').innerHTML = exclusions.length ? `<ul>${exclusions.map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : '<p class="hint">Этапы и позиции не отключены. Проверьте полноту по спецификации.</p>';
  $('#formulas').innerHTML = `<ul>${c.formulas.map(s => `<li>${esc(s)}</li>`).join('')}</ul>`;
  $('#engineering-note').textContent = WARNING;
}
function renderAll() {
  document.querySelectorAll('[data-bind]').forEach(el => { const value = get(el.dataset.bind); if (el.type === 'checkbox') el.checked = value; else el.value = value; });
  renderStructure(); renderRows(); renderVersions(); updateCalculation();
}
function updateInput(event) {
  const el = event.target;
  if (el.dataset.bind) {
    const path = el.dataset.bind, value = el.type === 'checkbox' ? el.checked : el.value;
    if (['foundation.type', 'geometry.gableStructure'].includes(path)) {
      keepVersion('Перед сменой состава конструкций');
      project = changeAssembly(project, path === 'foundation.type' ? { foundationType: value } : { gableStructure: value });
      renderAll(); changed(); return;
    }
    set(path, value);
    if (path === 'roof.mode' || path === 'saleMode' || path === 'foundation.formworkMode') renderStructure();
    if (path === 'utilities.wellPricing') {
      const included = value === 'included', drill = project.rows.find(r => r.id === 'well-drill'), casing = project.rows.find(r => r.id === 'well-casing');
      if (drill) { drill.name = included ? 'Бурение с обсадкой по составу КП' : 'Бурение без обсадной трубы по КП'; drill.price = ''; drill.source = ''; drill.date = ''; }
      if (casing) { casing.enabled = !included; casing.price = ''; casing.source = ''; casing.date = ''; }
      renderRows();
    }
    if (path === 'reviewed') { updateCalculation(); clearTimeout(timer); if (!paused) timer = setTimeout(save, 500); }
    else changed();
  }
  if (el.dataset.row) {
    const row = project.rows.find(r => r.id === el.dataset.row); if (!row) return;
    const key = el.dataset.key; row[key] = el.type === 'checkbox' ? el.checked : el.value;
    if (key === 'metric' && row.metric !== 'manual') { row.unit = METRICS[row.metric][1]; row.quantity = ''; }
    if (key === 'group') row.reserve = row.group === 'materials' ? '' : '0';
    if (['metric', 'enabled', 'stage', 'group'].includes(key)) renderRows();
    changed();
  }
  if (el.dataset.stage) { project.stages[el.dataset.stage] = el.checked; renderRows(); changed(); }
}
document.addEventListener('input', event => { if (event.target.tagName !== 'SELECT' && event.target.type !== 'checkbox') updateInput(event); });
document.addEventListener('change', event => { if (event.target.tagName === 'SELECT' || event.target.type === 'checkbox') updateInput(event); });
document.addEventListener('click', event => {
  const button = event.target.closest('button');
  const stageLink = event.target.closest('[data-open-stage]');
  if (stageLink) {
    const stage = document.getElementById(`stage-${stageLink.dataset.openStage}`);
    if (stage) { event.preventDefault(); stage.open = true; stage.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    return;
  }
  const link = event.target.closest('[data-goto]');
  if (link) {
    event.preventDefault(); const row = document.getElementById(`row-${link.dataset.goto}`); if (!row) return;
    row.closest('details.estimate-stage').open = true; row.querySelector('.row-more').open = true;
    row.scrollIntoView({ behavior: 'smooth', block: 'center' }); return;
  }
  if (!button) return;
  try {
    if (button.id === 'upgrade-foundation') {
      keepVersion('Перед разделением работ по опалубке'); project = upgradeFoundationRows(project); renderAll(); save();
      message('Установка и разборка добавлены отдельно. Прежняя совмещённая строка сохранена и отключена; проверьте новые расценки.');
    }
    if (button.dataset.technology && button.dataset.technology !== project.technology) {
      keepVersion(`Перед сменой технологии: ${TECHNOLOGIES[project.technology]}`);
      project = changeAssembly(project, { technology: button.dataset.technology }); renderAll(); save();
    }
    if (button.dataset.scope) { keepVersion('Перед сменой комплектации'); project = applyScope(project, button.dataset.scope); renderAll(); save(); }
    if (button.dataset.reference) { replaceProject(referenceProject(button.dataset.reference), 'Перед загрузкой проверочного проекта'); $('#object').scrollIntoView(); }
    if (button.dataset.delete) { keepVersion('Перед удалением своей позиции'); project.rows = project.rows.filter(r => r.id !== button.dataset.delete); renderRows(); changed(); renderVersions(); }
    if (button.dataset.version) {
      const v = versions.find(v => v.id === button.dataset.version); if (!v) return;
      const next = parseProject(serializeProject(v.project)); replaceProject(next, 'Перед открытием сохранённой версии');
    }
  } catch (error) { message(error.message); }
});
function download(content, name, type) {
  const url = URL.createObjectURL(new Blob([content], { type })), link = document.createElement('a');
  link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
}
async function logoData() {
  if (logo) return logo;
  const response = await fetch('../brand/logo-sl-approved-light.png');
  if (!response.ok) throw Error('Подлинный логотип недоступен; отчёт не сформирован.');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes[0] !== 137 || bytes[1] !== 80 || bytes[2] !== 78 || bytes[3] !== 71) throw Error('Вместо логотипа получен другой файл.');
  let text = ''; for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  logo = `data:image/png;base64,${btoa(text)}`; return logo;
}
$('#download-project').addEventListener('click', () => {
  try { download(serializeProject(project), 'svoi-lyudi-house.json', 'application/json'); message('JSON подготовлен для скачивания. Файл можно загрузить на другом устройстве.'); } catch (error) { message(error.message); }
});
$('#import-project').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  try { if (file.size > MAX_FILE_BYTES) throw Error('Файл больше 2 МБ.'); const next = parseProject(await file.text()); replaceProject(next, 'Перед импортом JSON'); message('Проект загружен. Предыдущий расчёт сохранён в версиях.'); }
  catch (error) { message(`Не удалось загрузить файл: ${error.message}`); }
  finally { event.target.value = ''; }
});
$('#download-report').addEventListener('click', async () => {
  const current = structuredClone(project);
  try { download(createReport(current, await logoData()), 'svoi-lyudi-house-report.html', 'text/html;charset=utf-8'); message('Сформирован самостоятельный HTML-отчёт с логотипом и текущими данными. Его можно распечатать в PDF.'); }
  catch (error) { message(error.message); }
});
$('#print-project').addEventListener('click', async () => {
  const current = structuredClone(project), popup = window.open('', '_blank');
  if (!popup) { message('Браузер заблокировал окно печати. Скачайте «Отчёт с логотипом» и откройте его.'); return; }
  popup.opener = null;
  try { const html = createReport(current, await logoData()); popup.document.open(); popup.document.write(html); popup.document.close(); popup.addEventListener('load', () => popup.print(), { once: true }); }
  catch (error) { popup.close(); message(error.message); }
});
$('#new-project').addEventListener('click', () => replaceProject(createProject(), 'Перед новым расчётом'));
$('#save-version').addEventListener('click', () => { keepVersion(); save(); renderVersions(); if (!paused) message('Версия сохранена в этом браузере.'); });
$('#add-row').addEventListener('click', () => {
  if (project.rows.length >= 500) { message('В проекте уже 500 позиций.'); return; }
  const stage = Object.keys(STAGES).find(key => project.stages[key]) || 'walls'; project.stages[stage] = true;
  const row = createRow(uid(), stage, 'materials', 'Новая позиция', 'м²'); row.template = false; project.rows.push(row); renderRows(); changed();
  const el = document.getElementById(`row-${row.id}`); el.closest('details').open = true; el.scrollIntoView({ block: 'center' }); el.querySelector('.row-name').focus();
});
$('#resume-storage').addEventListener('click', () => {
  try {
    let latest;
    try { latest = readStorage(localStorage); }
    catch {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw !== null) localStorage.setItem(`${STORAGE_KEY}.recovery`, raw);
      localStorage.removeItem(STORAGE_KEY);
      latest = { revision: null, project: null, versions: [] };
    }
    if (latest.project) versions = [...latest.versions, ...versions, snapshot(latest.project, 'Расчёт другой вкладки перед сохранением')].slice(-8);
    revision = latest.revision; paused = false; $('#storage-warning').hidden = true; $('#resume-storage').hidden = true; save(); renderVersions();
  } catch (error) { pause(error); }
});
$('#drawing-file').addEventListener('change', event => {
  const file = event.target.files[0]; if (!file) return;
  if (!['application/pdf', 'image/png', 'image/jpeg'].includes(file.type)) { message('Для просмотра выберите PDF, PNG или JPEG.'); return; }
  if (drawingUrl) URL.revokeObjectURL(drawingUrl); drawingUrl = URL.createObjectURL(file);
  $('#drawing-link').href = drawingUrl; $('#drawing-link').hidden = false;
  message(`Чертёж «${file.name}» открыт локально. Размеры переносятся вручную; файл не входит в JSON.`);
});
window.addEventListener('storage', event => { if (event.key === STORAGE_KEY) pause(Error('Сохранение изменено в другой вкладке.')); });
window.addEventListener('beforeunload', () => { if (drawingUrl) URL.revokeObjectURL(drawingUrl); save(); });
$('#project-catalog').innerHTML = PROJECTS.map(p => `<article class="reference-card"><h3>${esc(p.title)}</h3><p>${esc(p.publishedArea)}. ${esc(p.note)}</p><a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">Исходная карточка и планировка ↗</a><button class="secondary" data-reference="${p.id}">Загрузить габариты для проверки</button></article>`).join('');
$('#price-sources').innerHTML = PRICE_SOURCES.map(p => `<article class="reference-card"><h3>${esc(p.title)} · ${esc(p.price)}</h3><p>${esc(p.company)} · проверено ${esc(p.checked)}. ${esc(p.note)}</p><a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">Проверить состав и цену у подрядчика ↗</a></article>`).join('');
renderAll();
