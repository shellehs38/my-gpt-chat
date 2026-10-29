import { parseProject, serializeProject, uid } from './engine.mjs';
export const STORAGE_KEY = 'svoi-lyudi.house-calculator.v1';
export function readStorage(storage) {
  const text = storage.getItem(STORAGE_KEY);
  if (text === null) return { revision: null, project: null, versions: [] };
  let item;
  try { item = JSON.parse(text); } catch { throw Error('Сохранённый файл браузера повреждён. Автосохранение приостановлено; скачайте текущий расчёт в JSON.'); }
  if (!item || typeof item.revision !== 'string' || !Array.isArray(item.versions) || item.versions.length > 8) throw Error('Неизвестный формат сохранения браузера.');
  return { revision: item.revision, project: parseProject(serializeProject(item.project)), versions: item.versions.map(v => {
    if (!v || typeof v.id !== 'string' || typeof v.date !== 'string' || !Number.isFinite(Date.parse(v.date)) || typeof v.name !== 'string') throw Error('Некорректная сохранённая версия.');
    return { id: v.id, date: v.date, name: v.name, project: parseProject(serializeProject(v.project)) };
  }) };
}
export function saveStorage(storage, project, versions, expectedRevision) {
  const existing = readStorage(storage);
  if (existing.revision !== expectedRevision) throw Error('Расчёт изменён в другой вкладке. Автосохранение приостановлено. Скачайте JSON или сохраните текущий расчёт отдельным действием.');
  const revision = uid();
  const item = { revision, project: parseProject(serializeProject(project)), versions: versions.slice(-8) };
  storage.setItem(STORAGE_KEY, JSON.stringify(item));
  // Confirm that this tab's write is still present; this is conflict detection, not a database lock.
  if (JSON.parse(storage.getItem(STORAGE_KEY) || 'null')?.revision !== revision) throw Error('Не удалось подтвердить сохранение. Скачайте JSON.');
  return revision;
}
export function snapshot(project, name = '') {
  return { id: uid(), date: new Date().toISOString(), name: name || project.name || 'Расчёт без названия', project: parseProject(serializeProject(project)) };
}
