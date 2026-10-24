import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,createRow,serializeProject,validateImport,MAX_PROJECT_FILE_BYTES} from '../public/facade-calculator/engine.mjs';
import {parseTakeoff} from '../public/facade-calculator/takeoff.mjs';

test('a valid large project above the former 2MB boundary roundtrips through the shared file contract',()=>{
 const s=initialState();for(const v of Object.values(s.scenarios))for(const key of ['materials','works'])v[key]=Array.from({length:200},()=>({...createRow('Я'.repeat(300),'м²','norm',key==='works'?'included':'external'),norm:'1',price:'1',normSource:'Я'.repeat(500),source:'Я'.repeat(500),priceDate:'2026-10-24'}));
 const text=serializeProject(s);assert.ok(new TextEncoder().encode(text).length>2e6);assert.ok(new TextEncoder().encode(text).length<MAX_PROJECT_FILE_BYTES);const restored=validateImport(JSON.parse(text));assert.equal(restored.scenarios.bare.works.length,200);assert.equal(restored.scenarios.insulated.materials[199].source,'Я'.repeat(500));
});
test('oversize projects use the same rejection on import and export',()=>{const s=initialState();s.extra='x'.repeat(MAX_PROJECT_FILE_BYTES);assert.throws(()=>serializeProject(s),/16 МБ/);assert.throws(()=>validateImport(s),/16 МБ/);});
test('budget assumptions and provenance survive the portable file contract',()=>{const s=initialState();s.estimateKind='budget';s.sourceDocument='Чертёж.pdf, стр.3';s.assumptions=['(принято самостоятельно: глубина 0,2 м)'];const r=validateImport(JSON.parse(serializeProject(s)));assert.deepEqual(r.assumptions,s.assumptions);assert.equal(r.sourceDocument,s.sourceDocument);assert.throws(()=>validateImport({...s,assumptions:[{}]}),/допущений/);});
test('reviewed takeoff accepts Russian decimals and an optional header without applying dimensions itself',()=>{const w=parseTakeoff('Название; ширина; высота\nПередний;11,270;2,650\nБоковой\t3.790\t2.650');assert.equal(w.length,2);assert.equal(w[0].width,'11,270');assert.equal(w[1].height,'2.650');assert.notEqual(w[0].id,w[1].id);});
test('takeoff rejects incomplete, negative, zero, or implausible table fields instead of making up dimensions',()=>{for(const v of ['', 'Фасад;-1;2','Фасад;0;2','Фасад;11;','Фасад;11;2;другое','Фасад;текст;2'])assert.throws(()=>parseTakeoff(v));});
