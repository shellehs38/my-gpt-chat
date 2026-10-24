import {validateImport,MAX_PROJECT_FILE_BYTES} from './engine.mjs';

export const MAX_PROJECT_LINK_PAYLOAD_CHARS=200000;
const PREFIX='#project=';
const FALLBACK='Скачайте файл проекта .json и откройте его через «Файл проекта → Загрузить проект .json».';
function failure(code,message,cause){return Object.assign(new Error(`${message} ${FALLBACK}`,cause?{cause}:undefined),{code});}
function compressionAvailable(){
  if(typeof globalThis.CompressionStream!=='function'||typeof globalThis.DecompressionStream!=='function')throw failure('PROJECT_LINK_UNSUPPORTED','Этот браузер не поддерживает открытие сжатого проекта по ссылке.');
}
async function readBounded(stream,limit){
  const reader=stream.getReader(),chunks=[];let length=0;
  try{
    while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>limit)throw failure('PROJECT_LINK_TOO_LARGE','Проект по ссылке превышает допустимый размер.');chunks.push(value);}
    const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return bytes;
  }catch(error){try{await reader.cancel();}catch{}throw error;}
  finally{reader.releaseLock();}
}
function base64url(bytes){
  let binary='';for(let offset=0;offset<bytes.length;offset+=8192)binary+=String.fromCharCode(...bytes.subarray(offset,offset+8192));
  return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function fromBase64url(text){
  if(!text||!/^[A-Za-z0-9_-]+$/.test(text)||text.length%4===1)throw failure('PROJECT_LINK_FORMAT','Ссылка на проект повреждена.');
  let binary;try{binary=atob(text.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(text.length/4)*4,'='));}catch(error){throw failure('PROJECT_LINK_FORMAT','Ссылка на проект повреждена.',error);}
  const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
  // Reject alternate encodings with ignored trailing bits; one payload has one spelling.
  if(base64url(bytes)!==text)throw failure('PROJECT_LINK_FORMAT','Ссылка на проект повреждена.');
  return bytes;
}
async function fingerprint(bytes){
  if(!globalThis.crypto?.subtle)return undefined;
  const digest=await globalThis.crypto.subtle.digest('SHA-256',bytes);return Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
}

/** Make a portable fragment. No request is sent; the host owns navigation and storage. */
export async function encodeProjectLink(state){
  compressionAvailable();validateImport(state);
  const bytes=new TextEncoder().encode(JSON.stringify(state));
  if(bytes.byteLength>MAX_PROJECT_FILE_BYTES)throw failure('PROJECT_LINK_TOO_LARGE','Проект слишком большой для ссылки.');
  let compressed;try{compressed=await readBounded(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip')),Math.floor(MAX_PROJECT_LINK_PAYLOAD_CHARS*3/4));}
  catch(error){if(String(error.code).startsWith('PROJECT_LINK_'))throw error;throw failure('PROJECT_LINK_UNSUPPORTED','Браузер не смог подготовить ссылку на проект.',error);}
  const payload=base64url(compressed);if(payload.length>MAX_PROJECT_LINK_PAYLOAD_CHARS)throw failure('PROJECT_LINK_TOO_LARGE','Проект слишком большой для ссылки.');
  return `${PREFIX}gz1.${payload}`;
}

/** Decode only a recognized project fragment; malformed recognized links fail visibly. */
export async function decodeProjectLink(hash,{maxDecodedBytes=MAX_PROJECT_FILE_BYTES}={}){
  if(typeof hash!=='string'||(!hash.startsWith(PREFIX)&&hash!=='#project'))return null;
  if(!hash.startsWith(PREFIX))throw failure('PROJECT_LINK_FORMAT','Ссылка на проект повреждена.');
  const encoded=hash.slice(PREFIX.length),dot=encoded.indexOf('.');
  if(dot<0)throw failure('PROJECT_LINK_FORMAT','Ссылка на проект повреждена.');
  if(encoded.slice(0,dot)!=='gz1')throw failure('PROJECT_LINK_VERSION','Версия ссылки на проект не поддерживается.');
  const payload=encoded.slice(dot+1);if(payload.length>MAX_PROJECT_LINK_PAYLOAD_CHARS)throw failure('PROJECT_LINK_TOO_LARGE','Ссылка на проект слишком длинная.');
  compressionAvailable();
  const compressed=fromBase64url(payload);
  const limit=Math.min(MAX_PROJECT_FILE_BYTES,Number.isFinite(maxDecodedBytes)&&maxDecodedBytes>0?Math.floor(maxDecodedBytes):MAX_PROJECT_FILE_BYTES);
  let bytes;try{bytes=await readBounded(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip')),limit);}
  catch(error){if(String(error.code).startsWith('PROJECT_LINK_'))throw error;throw failure('PROJECT_LINK_FORMAT','Сжатые данные проекта в ссылке повреждены.',error);}
  let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch(error){throw failure('PROJECT_LINK_CONTENT','Не удалось прочитать данные проекта из ссылки.',error);}
  let state;try{state=validateImport(value);}catch(error){throw failure('PROJECT_LINK_CONTENT','В ссылке нет корректного проекта калькулятора.',error);}
  return {state,fingerprint:await fingerprint(bytes)};
}
