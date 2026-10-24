import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {readFileSync,existsSync} from 'node:fs';
import {initialState,calculate} from '../public/facade-calculator/engine.mjs';
import {encodeProjectLink,decodeProjectLink,MAX_PROJECT_LINK_PAYLOAD_CHARS} from '../public/facade-calculator/project-link.mjs';
const fragment=bytes=>'#project=gz1.'+Buffer.from(bytes).toString('base64url');
const compressed=text=>fragment(gzipSync(text));
const onlyProject=s=>{for(const list of Object.values(s.scenarios.insulated))for(const r of list)r.enabled=false;Object.assign(s.scenarios.insulated.materials[0],{enabled:true,price:'100'});s.areaMode='direct';s.directArea='10';return s;};
test('project link roundtrip retains Unicode, geometry and amounts without changing its source state',async()=>{
 const s=onlyProject(initialState());s.project='Павильон — Судостроительная, 171';s.notes='Размеры (принято самостоятельно: 1,2 × 1,5 м)';const original=JSON.stringify(s),hash=await encodeProjectLink(s);assert.match(hash,/^#project=gz1\.[A-Za-z0-9_-]+$/);assert.equal(JSON.stringify(s),original);
 const a=await decodeProjectLink(hash),b=await decodeProjectLink(hash);assert.equal(a.state.project,s.project);assert.equal(a.state.notes,s.notes);assert.equal(calculate(a.state).total,1000);assert.match(a.fingerprint,/^[a-f0-9]{64}$/);assert.equal(a.fingerprint,b.fingerprint);assert.notEqual(a.state.walls[0].id,b.state.walls[0].id);
});
test('the provided pavilion opens with both budget variants and original assumptions',async t=>{
 const path=process.env.FACADE_PRIVATE_PAVILION_FIXTURE;if(!path||!existsSync(path))return t.skip('Optional private pavilion fixture is not provided');
 const s=JSON.parse(readFileSync(path,'utf8'));const result=await decodeProjectLink(await encodeProjectLink(s));assert.equal(calculate(result.state).total,768560.26);assert.equal(calculate(result.state,'bare').total,618314.01);assert.deepEqual(result.state.assumptions,s.assumptions);assert.equal(result.state.openings.every(o=>result.state.walls.some(w=>w.id===o.wallId)),true);
});
test('ordinary section hashes are ignored while malformed project links fail visibly',async()=>{
 for(const h of ['','#object','#estimate','#project-other'])assert.equal(await decodeProjectLink(h),null);
 for(const h of ['#project','#project=','#project=gz1.','#project=gz1.a','#project=gz1.!','#project=gz1.AB'])await assert.rejects(()=>decodeProjectLink(h),{code:'PROJECT_LINK_FORMAT'});
 await assert.rejects(()=>decodeProjectLink('#project=gz2.abc'),{code:'PROJECT_LINK_VERSION'});
});
test('corrupted or truncated gzip, invalid UTF8, JSON and incompatible schemas are rejected',async()=>{
 const good=gzipSync(JSON.stringify(initialState()));await assert.rejects(()=>decodeProjectLink(fragment(good.subarray(0,-5))),{code:'PROJECT_LINK_FORMAT'});const damaged=Buffer.from(good);damaged[damaged.length-5]^=255;await assert.rejects(()=>decodeProjectLink(fragment(damaged)),{code:'PROJECT_LINK_FORMAT'});
 for(const text of ['{broken','{"version":999}',Buffer.from([255,254,253])])await assert.rejects(()=>decodeProjectLink(compressed(text)),{code:'PROJECT_LINK_CONTENT'});
});
test('oversized links are rejected before decompression and decompressed bytes have a streaming cap',async()=>{
 await assert.rejects(()=>decodeProjectLink('#project=gz1.'+'A'.repeat(MAX_PROJECT_LINK_PAYLOAD_CHARS+1)),{code:'PROJECT_LINK_TOO_LARGE'});
 const repetitive=compressed(' '.repeat(1024*1024));await assert.rejects(()=>decodeProjectLink(repetitive,{maxDecodedBytes:2048}),{code:'PROJECT_LINK_TOO_LARGE'});
});
test('browsers without compression support receive an actionable file-import fallback',async()=>{
 const C=globalThis.CompressionStream,D=globalThis.DecompressionStream;try{globalThis.CompressionStream=undefined;globalThis.DecompressionStream=undefined;await assert.rejects(()=>encodeProjectLink(initialState()),e=>e.code==='PROJECT_LINK_UNSUPPORTED'&&e.message.includes('Загрузить проект .json'));await assert.rejects(()=>decodeProjectLink(compressed('{}')),{code:'PROJECT_LINK_UNSUPPORTED'});}finally{globalThis.CompressionStream=C;globalThis.DecompressionStream=D;}
});
