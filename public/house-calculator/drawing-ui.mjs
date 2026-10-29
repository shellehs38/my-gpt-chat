import { DRAWING_FIELDS, DRAWING_UNITS, MAX_DRAWING_BYTES, drawingReview, validateDrawingResult, projectFromDrawing } from './drawing.mjs';
import { TECHNOLOGIES } from './engine.mjs';
import { escapeHtml as esc } from './report.mjs';

export function mountDrawing(root, onApply) {
  let file, url, review = drawingReview(), questions = [], request, generation = 0;
  root.innerHTML = `<div class="section-title"><span>Фото</span><div><h2>Материалы по схеме</h2><p>Фото от руки → проверка размеров → объёмы и смета</p></div></div>
    <p class="hint">Загрузите читаемое фото целиком. Помощник предложит подписанные размеры; перенос в расчёт — после вашей проверки. Масштаб клеток и пиксели не используются как обмер.</p>
    <label>Схема или чертёж<input id="drawing-file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf"></label>
    <p class="hint">Распознавание: JPEG, PNG, WebP до 3 МБ. PDF можно открыть рядом и перенести размеры вручную; для распознавания выберите фото страницы.</p>
    <div class="drawing-preview" hidden><img alt="Выбранная схема для проверки размеров" hidden><a target="_blank" rel="noopener">Открыть чертёж крупно ↗</a></div>
    <div class="toolbar"><button type="button" class="primary" id="recognize-drawing" disabled>Распознать схему</button><button type="button" class="secondary" id="manual-drawing">Ввести размеры вручную</button></div>
    <p class="hint">При распознавании фото отправляется сервису ИИ помощника. В калькуляторе и резервном JSON сохраняются только проверенные числа и текст основания, без фото. <a href="/" target="_blank" rel="noopener">Войти в помощник ↗</a></p>
    <p id="drawing-status" role="status" class="notice" hidden></p>
    <div id="drawing-review" hidden><h3>Проверьте перед переносом</h3><p id="drawing-description"></p><ul id="drawing-questions" class="hint"></ul>
      <p class="notice warning">Каждую цифру сверяйте с оригиналом. Если размер не известен, оставьте его без отметки. Ноль означает подтверждённое отсутствие, а не пропуск.</p>
      <div id="drawing-fields"></div>
      <label class="check"><input type="checkbox" id="drawing-rectangle">Я проверил: оба габарита относятся к одному наружному прямоугольному контуру; веранды и пристройки учтены отдельно.</label>
      <label>Материал наружных стен<select id="drawing-technology">${Object.entries(TECHNOLOGIES).map(([k,v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></label>
      <label>Источник проверенных размеров<input id="drawing-source" maxlength="2000" placeholder="Фото, лист проекта, дата обмера"></label>
      <button class="primary" type="button" id="apply-drawing">Создать расчёт из проверенных размеров</button>
      <p class="hint">Предыдущий расчёт сохранится в версиях. Цены, фундамент, крыша и инженерные сети в новом расчёте будут ожидать своих данных.</p>
    </div>`;
  const $ = s => root.querySelector(s);
  const status = text => { $('#drawing-status').hidden = false; $('#drawing-status').textContent = text; };
  function renderReview(result) {
    review = drawingReview(result); questions = result?.questions || [];
    $('#drawing-review').hidden = false; $('#drawing-rectangle').checked = false;
    $('#drawing-description').textContent = result ? `${result.summary} ${result.outline === 'rectangle' ? 'Контур предположительно прямоугольный — проверьте границы.' : 'Контур не подтверждён как прямоугольный. Проверьте веранды, пристройки и размерные цепочки.'}` : 'Введите только проверенные размеры. Для неизвестных полей отметки не ставьте.';
    $('#drawing-questions').innerHTML = questions.map(q => `<li>${esc(q)}</li>`).join('');
    $('#drawing-source').value = file ? `Чертёж: ${file.name}` : '';
    $('#drawing-fields').innerHTML = review.map(r => {
      const dimensional = ['m', 'mm'].includes(DRAWING_FIELDS[r.field][1]);
      const units = dimensional ? ['unknown', 'mm', 'cm', 'm'] : ['unknown', DRAWING_FIELDS[r.field][1]];
      // An inconsistent provider unit stays visible and unconfirmed; never silently substitute it.
      if (!units.includes(r.unit)) units.push(r.unit);
      return `<article class="drawing-measure" data-measure="${r.field}"><b>${esc(r.label)}</b><span class="reading-state">${r.confidence === 'clear' ? 'Прочитано — проверить' : r.confidence === 'unclear' ? 'Нужно уточнение' : 'Нет подтверждённых данных'}</span><p>${esc(r.evidence)}</p><div class="fields two"><label>Значение<input data-drawing-value="${r.field}" value="${esc(r.value)}" inputmode="decimal" maxlength="30"></label><label>Единица<select data-drawing-unit="${r.field}">${units.map(u => `<option value="${u}"${r.unit === u ? ' selected' : ''}>${esc(DRAWING_UNITS[u])}</option>`).join('')}</select></label></div><label class="check"><input type="checkbox" data-drawing-confirm="${r.field}">Размер и единица проверены</label></article>`;
    }).join('');
  }
  function cancel() { generation++; request?.abort(); request = null; $('#apply-drawing').disabled = false; }
  $('#drawing-file').addEventListener('change', event => {
    cancel(); file = event.target.files[0]; $('#drawing-review').hidden = true; $('#drawing-status').hidden = true;
    if (url) URL.revokeObjectURL(url); url = undefined;
    $('.drawing-preview').hidden = true; $('#recognize-drawing').disabled = true;
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(file.type)) { file = undefined; status('Выберите JPEG, PNG, WebP или PDF.'); return; }
    if (file.size > (file.type === 'application/pdf' ? 20 * 1024 * 1024 : MAX_DRAWING_BYTES)) { file = undefined; status('Фото должно быть не больше 3 МБ, PDF для просмотра — не больше 20 МБ.'); return; }
    url = URL.createObjectURL(file); $('.drawing-preview').hidden = false;
    $('.drawing-preview a').href = url; $('.drawing-preview img').hidden = file.type === 'application/pdf';
    if (file.type !== 'application/pdf') $('.drawing-preview img').src = url;
    $('#recognize-drawing').disabled = file.type === 'application/pdf';
    status('Файл выбран. Можно распознать подписи или ввести проверенные размеры вручную.');
  });
  $('#manual-drawing').addEventListener('click', () => { cancel(); $('#recognize-drawing').disabled = !file || file.type === 'application/pdf'; renderReview(); status('Ручной ввод открыт. Заполните габариты и отметьте проверенные поля.'); });
  $('#recognize-drawing').addEventListener('click', async () => {
    if (!file || request) return;
    const selected = file; cancel(); const sequence = generation; request = new AbortController(); const controller = request, signal = controller.signal;
    $('#recognize-drawing').disabled = true; $('#apply-drawing').disabled = true; status('Читаю подписи на схеме. Текущий расчёт не изменяется…');
    const timeout = setTimeout(() => controller.abort(), 60_000);
    try {
      const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(Error('Не удалось прочитать файл.')); reader.readAsDataURL(selected); });
      if (sequence !== generation || signal.aborted) return;
      const response = await fetch('/api/drawing', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ image: dataUrl }), signal });
      let data; try { data = await response.json(); } catch { throw Error('Сервис распознавания недоступен. Можно перенести размеры вручную.'); }
      if (sequence !== generation) return;
      if (!response.ok) throw Error(data.error || 'Не удалось распознать схему.');
      renderReview(validateDrawingResult(data.drawing)); status('Подписи прочитаны. Проверьте значения и единицы, особенно контур дома и веранды.');
    } catch (error) { if (sequence === generation) status(signal.aborted ? 'Ожидание завершено. Повторите распознавание или введите размеры вручную.' : error.message); }
    finally { clearTimeout(timeout); if (sequence === generation) { request = null; $('#recognize-drawing').disabled = !file || file.type === 'application/pdf'; $('#apply-drawing').disabled = false; } }
  });
  root.addEventListener('input', event => {
    const el = event.target, field = el.dataset.drawingValue || el.dataset.drawingUnit;
    if (!field) return;
    const row = review.find(r => r.field === field); row.confirmed = false;
    if (el.dataset.drawingValue) row.value = el.value; else row.unit = el.value;
    root.querySelector(`[data-drawing-confirm="${field}"]`).checked = false;
  });
  root.addEventListener('change', event => {
    const field = event.target.dataset.drawingConfirm;
    if (field) review.find(r => r.field === field).confirmed = event.target.checked;
  });
  $('#apply-drawing').addEventListener('click', () => {
    try {
      const next = projectFromDrawing({ technology: $('#drawing-technology').value, review, rectangleConfirmed: $('#drawing-rectangle').checked, source: $('#drawing-source').value, questions });
      onApply(next); status('Проверенные размеры перенесены в новый расчёт. Ниже заполните недостающие данные, спецификации и расценки.');
      document.getElementById('object').scrollIntoView({ behavior: 'smooth' });
    } catch (error) { status(error.message); }
  });
  window.addEventListener('pagehide', () => { cancel(); if (url) URL.revokeObjectURL(url); });
}
