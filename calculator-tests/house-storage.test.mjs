import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../public/house-calculator/engine.mjs';
import { readStorage, saveStorage, snapshot, STORAGE_KEY } from '../public/house-calculator/storage.mjs';
const memory = () => { const values = new Map(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }; };
test('сохранение и версии восстанавливают все текущие поля', () => {
  const s = memory(), p = createProject(); p.name = 'Дом';
  const v = snapshot(p); const revision = saveStorage(s, p, [v], null), saved = readStorage(s);
  assert.equal(saved.revision, revision); assert.deepEqual(saved.project, p); assert.deepEqual(saved.versions, [v]);
});
test('устаревшая вкладка не перезаписывает более новую сохранённую версию', () => {
  const s = memory(), first = createProject(), second = createProject(); first.name = 'Первый'; second.name = 'Второй';
  const a = saveStorage(s, first, [], null); saveStorage(s, second, [], a);
  assert.throws(() => saveStorage(s, first, [], a), /другой вкладке/); assert.equal(readStorage(s).project.name, 'Второй');
});
test('повреждённое хранилище не перезаписывается, ошибки квоты не скрываются', () => {
  const s = memory(); s.setItem(STORAGE_KEY, '{bad');
  assert.throws(() => saveStorage(s, createProject(), [], null)); assert.equal(s.getItem(STORAGE_KEY), '{bad');
  const quota = { getItem: () => null, setItem: () => { throw Error('QuotaExceeded'); } };
  assert.throws(() => saveStorage(quota, createProject(), [], null), /QuotaExceeded/);
});
