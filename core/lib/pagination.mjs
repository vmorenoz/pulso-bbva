/** Snapshot/filter-bound cursors, independent of process, adapter, or native session. */
import {createHash} from 'node:crypto';
function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));
  return value;
}
export const snapshotSignature = value => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const invalid = () => {throw new Error('CURSOR_INVALIDO: cursor de lectura inválido.');};
const stale = () => {throw new Error('CURSOR_OBSOLETO: cambió el contenido o la consulta; volver a leer desde el inicio.');};
/** This signature detects changed read snapshots; it is not an authorization token. */
export function pagination({kind,binding,snapshot,total,limit=20,cursor}={}){
  if(typeof kind!=='string'||!Number.isSafeInteger(total)||total<0||!Number.isSafeInteger(limit)||limit<1||limit>100)throw new Error('Consulta paginada inválida.');
  const signature=snapshotSignature({kind,binding,snapshot});
  let offset=0;
  if(cursor!==undefined){
    if(typeof cursor!=='string'||cursor.length>4000||!cursor.length||!/^[A-Za-z0-9_-]+$/.test(cursor))invalid();
    let decoded;
    try{decoded=JSON.parse(Buffer.from(cursor,'base64url').toString('utf8'));}catch{invalid();}
    if(!decoded||Array.isArray(decoded)||Object.keys(decoded).sort().join(',')!=='kind,offset,signature,version'||decoded.version!==1||typeof decoded.kind!=='string'||typeof decoded.signature!=='string'||!/^[a-f0-9]{64}$/.test(decoded.signature)||!Number.isSafeInteger(decoded.offset)||decoded.offset<0)invalid();
    if(decoded.kind!==kind||decoded.signature!==signature)stale();
    offset=decoded.offset;
    if(offset>total)invalid();
  }
  const next=Math.min(offset+limit,total),hasMore=next<total;
  const nextCursor=hasMore?Buffer.from(JSON.stringify({version:1,kind,signature,offset:next})).toString('base64url'):null;
  return {offset,limit,total,hasMore,nextCursor};
}
export function pageItems(items,options){
  const info=pagination({...options,total:items.length});
  return {items:items.slice(info.offset,info.offset+info.limit),total:items.length,hasMore:info.hasMore,nextCursor:info.nextCursor};
}
