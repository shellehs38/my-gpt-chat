import {initialState, uid, validateImport} from './engine.mjs';

export const LEGACY_PROJECT_KEY = 'svoi-lyudi-facade-v1';
const DEFAULT_DATABASE = 'svoi-lyudi-facade-projects-v1';
const TABLES = ['projects', 'revisions', 'meta'];
const clone = value => JSON.parse(JSON.stringify(value));
const titleOf = state => state.project?.trim() || 'Новый объект';

function failure(code, message, extra = {}) {
  return Object.assign(new Error(message), {code, ...extra});
}
function storageFailure(error) {
  if (error?.code && typeof error.code === 'string') return error;
  if (error?.name === 'QuotaExceededError') return failure('STORAGE_FULL', 'Память браузера заполнена. Сохраните проект в файл; прежние версии сохранены.', {cause:error});
  return failure('STORAGE_UNAVAILABLE', 'Браузер не разрешил сохранение проекта. Сохраните проект в файл.', {cause:error});
}
function checkedSnapshot(state) {
  // Validate the portable contract without regenerating IDs in the stored copy.
  validateImport(state);
  return clone(state);
}

/** Local project history. IndexedDB transactions serialize head comparisons and writes. */
export function createProjectStore(options = {}) {
  const provider = options.indexedDB ?? globalThis.indexedDB;
  const databaseName = options.databaseName || DEFAULT_DATABASE;
  let connectionPromise;
  let initializePromise;

  function connect() {
    if (connectionPromise) return connectionPromise;
    connectionPromise = new Promise((resolve, reject) => {
      if (!provider) return reject(storageFailure());
      let request;
      try { request = provider.open(databaseName, 1); }
      catch (error) { reject(storageFailure(error)); return; }
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore('projects', {keyPath:'id'});
        const revisions = db.createObjectStore('revisions', {keyPath:'id'});
        revisions.createIndex('projectId', 'projectId', {unique:false});
        db.createObjectStore('meta', {keyPath:'key'});
      };
      request.onerror = () => reject(storageFailure(request.error));
      request.onblocked = () => reject(failure('STORAGE_BLOCKED', 'Закройте старую вкладку калькулятора и повторите открытие списка объектов.'));
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };
    });
    // Permit a later retry after a transient denied/open/upgrade failure.
    connectionPromise.catch(() => { connectionPromise = undefined; });
    return connectionPromise;
  }

  async function transact(names, mode, action) {
    const db = await connect();
    return new Promise((resolve, reject) => {
      let transaction, result, explicitError;
      try { transaction = db.transaction(names, mode); }
      catch (error) { reject(storageFailure(error)); return; }
      const stores = Object.fromEntries(names.map(name => [name, transaction.objectStore(name)]));
      const abort = error => { explicitError = storageFailure(error); try { transaction.abort(); } catch {} };
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(explicitError || storageFailure(transaction.error));
      transaction.onerror = () => { /* onabort reports the final transaction outcome. */ };
      try { action(stores, value => { result = value; }, abort); }
      catch (error) { abort(error); }
    });
  }

  const readMeta = async key => transact(['meta'], 'readonly', (s, done) => {
    s.meta.get(key).onsuccess = event => done(event.target.result?.value);
  });

  async function initialize() {
    if (initializePromise) return initializePromise;
    initializePromise = (async () => {
      const count = await transact(['projects'], 'readonly', (s, done) => {
        s.projects.count().onsuccess = event => done(event.target.result);
      });
      if (count) return;
      let raw, state;
      try {
        const legacy = Object.hasOwn(options, 'legacyStorage') ? options.legacyStorage : globalThis.localStorage;
        raw = legacy?.getItem(LEGACY_PROJECT_KEY);
      } catch (error) {
        throw failure('LEGACY_UNAVAILABLE', 'Не удалось прочитать прежний проект браузера. Исходные данные не изменены; сохраните открытый проект в файл.', {cause:error});
      }
      if (raw) {
        try { state = validateImport(JSON.parse(raw)); }
        catch (error) { throw failure('LEGACY_INVALID', 'Не удалось восстановить прежний проект. Его исходная копия сохранена в браузере; загрузите резервный JSON.', {cause:error}); }
      } else state = initialState();
      const timestamp = new Date().toISOString();
      const projectId = uid(), revisionId = uid();
      await transact(TABLES, 'readwrite', (s, done) => {
        // Another tab may have completed migration while this tab read localStorage.
        s.projects.count().onsuccess = event => {
          if (event.target.result) return done();
          s.projects.add({id:projectId, title:titleOf(state), createdAt:timestamp, updatedAt:timestamp, headRevision:revisionId, revisionCount:1});
          s.revisions.add({id:revisionId, projectId, createdAt:timestamp, title:titleOf(state), sequence:1, state});
          s.meta.put({key:'activeProject', value:projectId});
          s.meta.put({key:'legacyMigration', value:{completedAt:timestamp, hadLegacyProject:Boolean(raw)}});
        };
      });
    })();
    initializePromise.catch(() => { initializePromise = undefined; });
    return initializePromise;
  }

  async function listProjects() {
    await initialize();
    return transact(['projects'], 'readonly', (s, done) => {
      s.projects.getAll().onsuccess = event => done(event.target.result.map(project => ({...project})).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)));
    });
  }

  async function readProject(projectId, activate) {
    await initialize();
    return transact(activate ? TABLES : ['projects','revisions'], activate ? 'readwrite' : 'readonly', (s, done, abort) => {
      s.projects.get(projectId).onsuccess = event => {
        const project = event.target.result;
        if (!project) return abort(failure('NOT_FOUND', 'Объект не найден в этом браузере.'));
        s.revisions.get(project.headRevision).onsuccess = event => {
          const revision = event.target.result;
          if (!revision) return abort(failure('STORAGE_INVALID', 'Не найдена сохранённая версия объекта. Исходные записи не изменены.'));
          if (activate) s.meta.put({key:'activeProject',value:projectId});
          done({projectId, revisionId:revision.id, state:clone(revision.state)});
        };
      };
    });
  }

  async function open() {
    await initialize();
    const projects = await listProjects();
    const active = await readMeta('activeProject');
    const projectId = projects.some(p => p.id === active) ? active : projects[0]?.id;
    if (!projectId) throw failure('STORAGE_INVALID', 'В хранилище нет сохранённых объектов.');
    return {...await readProject(projectId, true), projects};
  }

  async function createProject(state) {
    await initialize();
    const snapshot = checkedSnapshot(state);
    const projectId = uid(), revisionId = uid(), timestamp = new Date().toISOString();
    return transact(TABLES, 'readwrite', (s, done) => {
      s.projects.add({id:projectId,title:titleOf(snapshot),createdAt:timestamp,updatedAt:timestamp,headRevision:revisionId,revisionCount:1});
      s.revisions.add({id:revisionId,projectId,title:titleOf(snapshot),createdAt:timestamp,sequence:1,state:snapshot});
      s.meta.put({key:'activeProject',value:projectId});
      done({projectId,revisionId,state:clone(snapshot)});
    });
  }

  async function appendRevision({projectId,baseRevision,state,restoreId}) {
    await initialize();
    const snapshot = state === undefined ? undefined : checkedSnapshot(state);
    return transact(['projects','revisions'], 'readwrite', (s, done, abort) => {
      s.projects.get(projectId).onsuccess = event => {
        const project = event.target.result;
        if (!project) return abort(failure('NOT_FOUND', 'Объект не найден в этом браузере.'));
        if (project.headRevision !== baseRevision) return abort(failure('CONFLICT', 'В другой вкладке уже сохранены изменения. Сохраните свою версию отдельным объектом или откройте свежую.', {projectId,currentRevision:project.headRevision}));
        const request = s.revisions.get(restoreId || project.headRevision);
        request.onsuccess = event => {
          const previous = event.target.result;
          if (!previous || previous.projectId !== projectId) return abort(failure('NOT_FOUND', 'Сохранённая версия этого объекта не найдена.'));
          const nextState = snapshot === undefined ? clone(previous.state) : snapshot;
          if (!restoreId && JSON.stringify(nextState) === JSON.stringify(previous.state)) return done({projectId,revisionId:project.headRevision,state:clone(nextState)});
          const revisionId = uid(), timestamp = new Date().toISOString(), sequence = project.revisionCount + 1;
          const revision = {id:revisionId,projectId,title:titleOf(nextState),createdAt:timestamp,sequence,state:nextState};
          if (restoreId) revision.restoredFrom = restoreId;
          s.revisions.add(revision);
          s.projects.put({...project,title:titleOf(nextState),updatedAt:timestamp,headRevision:revisionId,revisionCount:sequence});
          // Saving an inactive tab never changes which object is selected on reopen.
          done({projectId,revisionId,state:clone(nextState)});
        };
      };
    });
  }

  async function listVersions(projectId) {
    await initialize();
    return transact(['revisions'], 'readonly', (s, done) => {
      s.revisions.index('projectId').getAll(projectId).onsuccess = event => done(event.target.result.map(({state,...version}) => version).sort((a,b) => b.sequence-a.sequence));
    });
  }

  async function loadVersion(revisionId) {
    await initialize();
    return transact(['revisions'], 'readonly', (s, done, abort) => {
      s.revisions.get(revisionId).onsuccess = event => {
        const revision = event.target.result;
        if (!revision) return abort(failure('NOT_FOUND', 'Сохранённая версия не найдена.'));
        done({projectId:revision.projectId,revisionId:revision.id,state:clone(revision.state)});
      };
    });
  }

  return {
    open, listProjects, createProject, listVersions, loadVersion,
    loadProject:projectId => readProject(projectId,true),
    saveProject:input => appendRevision(input),
    restoreVersion:({projectId,baseRevision,revisionId}) => appendRevision({projectId,baseRevision,restoreId:revisionId}),
    async close() { const db = await connectionPromise?.catch(() => null); db?.close(); connectionPromise=undefined; initializePromise=undefined; }
  };
}
