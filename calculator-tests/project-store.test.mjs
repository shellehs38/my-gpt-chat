import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

// Test real IndexedDB transaction ordering without adding a production dependency.
// A browser-equipped environment runs these; other environments report the gap.
let chrome;
for (const candidate of [process.env.CHROME_BIN,'/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome'].filter(Boolean)) {
  try { await access(candidate); chrome=candidate; break; } catch {}
}

test('browser project history and concurrent save contract', {skip:chrome?false:'Chromium is required for the real IndexedDB checks',timeout:30000}, async t => {
  const directory = await mkdtemp(join(tmpdir(),'facade-store-test-'));
  const server=createServer(async(req,res)=>{
    if(req.url==='/') {res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Project storage tests</title>');return;}
    const name=req.url?.slice(1);
    if(!['project-store.mjs','engine.mjs'].includes(name)){res.writeHead(404).end();return;}
    res.setHeader('Content-Type','text/javascript');res.end(await readFile(new URL('../public/facade-calculator/'+name,import.meta.url)));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  const child=spawn(chrome,['--headless=new','--no-sandbox','--disable-dev-shm-usage','--remote-debugging-port=0','--user-data-dir='+directory,'about:blank'],{stdio:['ignore','ignore','pipe']});
  let socket;
  try {
    const devtools=await new Promise((resolve,reject)=>{
      let text='';const timeout=setTimeout(()=>reject(Error('Chromium did not start')),10000);
      child.stderr.on('data',chunk=>{text+=chunk;const match=text.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(match){clearTimeout(timeout);resolve(match[1]);}});
      child.once('error',reject);child.once('exit',code=>{clearTimeout(timeout);reject(Error('Chromium exited: '+code));});
    });
    const target=await fetch('http://'+new URL(devtools).host+'/json/new?'+encodeURIComponent(origin),{method:'PUT'}).then(r=>r.json());
    socket=new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
    let nextId=0;const pending=new Map();
    socket.addEventListener('message',event=>{const result=JSON.parse(event.data);if(result.id){const listener=pending.get(result.id);pending.delete(result.id);result.error?listener?.reject(Error(result.error.message)):listener?.resolve(result.result);}});
    const call=(method,params)=>new Promise((resolve,reject)=>{const id=++nextId;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
    async function evaluate(expression){const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value;}
    for(let i=0;i<20;i++){if(await evaluate('location.origin')===origin)break;await new Promise(r=>setTimeout(r,50));}
    await evaluate(`(async()=>{
      const {createProjectStore,LEGACY_PROJECT_KEY}=await import('/project-store.mjs');
      const {initialState}=await import('/engine.mjs');
      window.api={createProjectStore,LEGACY_PROJECT_KEY,initialState};
      window.storeTest=(name)=>createProjectStore({databaseName:'test-'+name+'-'+crypto.randomUUID(),legacyStorage:{getItem:()=>null}});
      window.ensure=(value,message)=>{if(!value)throw Error(message)};
      return true;
    })()`);

    await t.test('one-time legacy migration keeps the original backup and opening links',async()=>{
      assert.equal(await evaluate(`(async()=>{
        const {createProjectStore,LEGACY_PROJECT_KEY,initialState}=api;
        const state=initialState();state.project='Прежний объект';state.walls[0].width='10';state.walls[0].height='3';state.openings=[{id:'o',name:'Окно',type:'window',wallId:state.walls[0].id,width:'1',height:'1.5',count:'1',depth:'0.2',sides:'3'}];
        const raw=JSON.stringify(state);localStorage.setItem(LEGACY_PROJECT_KEY,raw);
        const store=createProjectStore({databaseName:'legacy-'+crypto.randomUUID()});const migrated=await store.open();
        ensure(migrated.state.project==='Прежний объект','legacy title');ensure(migrated.state.openings[0].wallId===migrated.state.walls[0].id,'opening reference');ensure(localStorage.getItem(LEGACY_PROJECT_KEY)===raw,'legacy backup changed');
        localStorage.setItem(LEGACY_PROJECT_KEY,'corrupt old tab');const canonical=await store.open();ensure(canonical.revisionId===migrated.revisionId,'legacy remigrated');await store.close();return true;
      })()`),true);
    });
    await t.test('simultaneous writers compare revisions atomically and preserve the winner',async()=>{
      assert.equal(await evaluate(`(async()=>{
        const name='race-'+crypto.randomUUID(),a=api.createProjectStore({databaseName:name,legacyStorage:null}),b=api.createProjectStore({databaseName:name,legacyStorage:null});
        const x=await a.open(),y=await b.open();x.state.project='Вкладка A';y.state.project='Вкладка B';
        const result=await Promise.allSettled([a.saveProject({projectId:x.projectId,baseRevision:x.revisionId,state:x.state}),b.saveProject({projectId:y.projectId,baseRevision:y.revisionId,state:y.state})]);
        ensure(result.filter(r=>r.status==='fulfilled').length===1,'both saves committed');const rejected=result.find(r=>r.status==='rejected');ensure(rejected.reason.code==='CONFLICT','missing conflict');
        const winner=result.find(r=>r.status==='fulfilled').value;const latest=await b.loadProject(x.projectId);ensure(latest.state.project===winner.state.project,'winner overwritten');ensure((await a.listVersions(x.projectId)).length===2,'incorrect immutable history');await a.close();await b.close();return true;
      })()`),true);
    });
    await t.test('restoring an older version appends history and repeated unchanged save is deduplicated',async()=>{
      assert.equal(await evaluate(`(async()=>{
        const store=storeTest('restore'),first=await store.open();first.state.project='Первый';const second=await store.saveProject({projectId:first.projectId,baseRevision:first.revisionId,state:first.state});
        second.state.project='Второй';const third=await store.saveProject({projectId:second.projectId,baseRevision:second.revisionId,state:second.state});
        const restored=await store.restoreVersion({projectId:third.projectId,baseRevision:third.revisionId,revisionId:second.revisionId});ensure(restored.state.project==='Первый','restore state');ensure(restored.revisionId!==second.revisionId,'restore rewrote old revision');
        const versions=await store.listVersions(first.projectId);ensure(versions.length===4,'history lost');ensure(versions[0].restoredFrom===second.revisionId,'restore origin absent');
        await store.saveProject({projectId:restored.projectId,baseRevision:restored.revisionId,state:restored.state});ensure((await store.listVersions(first.projectId)).length===4,'unchanged version duplicated');
        const old=await store.loadVersion(third.revisionId);ensure(old.state.project==='Второй','future revision deleted');await store.close();return true;
      })()`),true);
    });
    await t.test('project switching survives reopen and inactive autosave does not select itself',async()=>{
      assert.equal(await evaluate(`(async()=>{
        const store=storeTest('projects'),first=await store.open();const next=api.initialState();next.project='Другой объект';const second=await store.createProject(next);
        first.state.project='Сохранено из прежней вкладки';await store.saveProject({projectId:first.projectId,baseRevision:first.revisionId,state:first.state});ensure((await store.open()).projectId===second.projectId,'inactive save changed selection');
        await store.loadProject(first.projectId);ensure((await store.open()).projectId===first.projectId,'selection not persisted');ensure((await store.listProjects()).length===2,'project disappeared');await store.close();return true;
      })()`),true);
    });
    await t.test('failed migration never replaces invalid original data with a blank project',async()=>{
      assert.equal(await evaluate(`(async()=>{
        const legacy={getItem:()=>'{broken'},store=api.createProjectStore({databaseName:'broken-'+crypto.randomUUID(),legacyStorage:legacy});let code;try{await store.open()}catch(e){code=e.code}ensure(code==='LEGACY_INVALID','invalid legacy silently cleared');await store.close();return true;
      })()`),true);
    });
    await t.test('blocked legacy storage and unavailable IndexedDB fail visibly',async()=>{
      assert.equal(await evaluate(`(async()=>{
        const store=api.createProjectStore({databaseName:'denied-'+crypto.randomUUID(),legacyStorage:{getItem(){throw Error('denied')}}});let code;try{await store.open()}catch(e){code=e.code}ensure(code==='LEGACY_UNAVAILABLE','unreadable legacy cleared');await store.close();
        const absent=api.createProjectStore({indexedDB:{open(){throw new DOMException('Denied','SecurityError')}},legacyStorage:null});try{await absent.open()}catch(e){code=e.code}ensure(code==='STORAGE_UNAVAILABLE','missing storage error');return true;
      })()`),true);
    });
    await t.test('returned snapshots are independent and cross-project restore is rejected',async()=>{
      assert.equal(await evaluate(`(async()=>{
        const store=storeTest('clone'),first=await store.open();first.state.project='Changed outside store';ensure((await store.loadVersion(first.revisionId)).state.project==='','read mutated stored state');
        const other=await store.createProject(api.initialState());let code;try{await store.restoreVersion({projectId:other.projectId,baseRevision:other.revisionId,revisionId:first.revisionId})}catch(e){code=e.code}ensure(code==='NOT_FOUND','cross-project version accepted');ensure((await store.listVersions(other.projectId)).length===1,'failed restore changed history');await store.close();return true;
      })()`),true);
    });
    await t.test('a failed write aborts project creation without deleting the previous object',async()=>{
      assert.equal(await evaluate(`(async()=>{
        const store=storeTest('quota'),first=await store.open(),original=IDBObjectStore.prototype.add;let code;
        IDBObjectStore.prototype.add=function(value){if(this.name==='revisions')throw new DOMException('Simulated full browser storage','QuotaExceededError');return original.call(this,value)};
        try{await store.createProject(api.initialState())}catch(error){code=error.code}finally{IDBObjectStore.prototype.add=original}
        ensure(code==='STORAGE_FULL','quota message not preserved');ensure((await store.listProjects()).length===1,'partially created object retained');ensure((await store.open()).revisionId===first.revisionId,'previous head lost');await store.close();return true;
      })()`),true);
    });
  } finally {
    socket?.close();child.kill('SIGTERM');server.close();
    await new Promise(resolve=>child.exitCode!==null?resolve():child.once('exit',resolve));
    // Chromium subprocesses can finish flushing the temporary profile just after exit.
    await rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  }
});
