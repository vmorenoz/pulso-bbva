import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {atomicWrite,exists,now,readJSON,safePath,withWorkspaceLock} from './fs.mjs';
import {snapshotSignature} from './pagination.mjs';

const projectFile='.pulso/memory.json';
const userFile='.pulso/preferences.json';
const lockFile='.pulso/preferences.lock';
const sources=['user','observed','delegated'];
const empty=()=>({schemaVersion:1,revision:1,updatedAt:now(),context:'',preferences:[],learning:[]});
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fields=(value,allowed,required=allowed)=>object(value)&&required.every(key=>Object.hasOwn(value,key))&&Object.keys(value).every(key=>allowed.includes(key));
const text=(value,max,{blank=false}={})=>typeof value==='string'&&[...value].length<=max&&(blank||value.trim().length>0);
const revision=value=>Number.isSafeInteger(value)&&value>=1;
const date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,19)===value.slice(0,19);
const provenance=item=>item.provenance==='explicit'?'explicit':'legacy-unverified';
function invalid(){throw new Error('MEMORIA_INVALIDA: memoria Pulso incompleta o corrupta; archivo conservado. Revisar y recuperar explícitamente antes de escribir.');}
function valid(value,scope){
  if(!fields(value,['schemaVersion','revision','updatedAt','context','contextUpdatedAt','preferences','learning'],['schemaVersion','revision','updatedAt','context','preferences','learning'])||value.schemaVersion!==1||!revision(value.revision)||!date(value.updatedAt)||typeof value.context!=='string'||!Array.isArray(value.preferences)||!Array.isArray(value.learning))invalid();
  if(Object.hasOwn(value,'contextUpdatedAt')&&!date(value.contextUpdatedAt))invalid();
  const keys=new Set();
  for(const item of value.preferences){
    if(!fields(item,['key','value','scope','source','updatedAt','provenance'],['key','value','scope','source','updatedAt'])||!text(item.key,120)||item.key!==item.key.trim()||!text(item.value,1000)||item.scope!==scope||!sources.includes(item.source)||!date(item.updatedAt)||Object.hasOwn(item,'provenance')&&item.provenance!=='explicit'||keys.has(item.key))invalid();
    keys.add(item.key);
  }
  for(const item of value.learning){
    if(!fields(item,['note','source','recordedAt','provenance'],['note','source','recordedAt'])||!text(item.note,2000)||!sources.includes(item.source)||!date(item.recordedAt)||Object.hasOwn(item,'provenance')&&item.provenance!=='explicit')invalid();
  }
  return value;
}
function location(root,scope,{homeDir}={}){
  if(!['project','user'].includes(scope))throw new Error('Scope de memoria inválido.');
  if(scope==='user'&&(typeof homeDir!=='string'||!path.isAbsolute(homeDir)))throw new Error('homeDir absoluto y explícito requerido para memoria de usuario.');
  return {root:scope==='user'?homeDir:root,file:scope==='user'?userFile:projectFile};
}
function load(root,scope,options){
  const target=location(root,scope,options);
  if(!exists(target.root,target.file))return empty();
  let value;
  try{value=readJSON(target.root,target.file);}catch(error){if(error.cause instanceof SyntaxError)invalid();throw error;}
  return valid(value,scope);
}
function readQuery(input){
  if(!fields(input,['action','scope','section','key','limit','cursor'],[])||Object.values(input).some(value=>value===undefined||value===null)||Object.hasOwn(input,'action')&&input.action!=='read')throw new Error('Consulta de memoria inválida.');
  const query={scope:input.scope??'project',section:input.section??'all',key:input.key??null,limit:input.limit??50,cursor:input.cursor??null};
  if(!['project','user','all'].includes(query.scope)||!['context','preferences','learning','all'].includes(query.section)||query.key!==null&&!text(query.key,120)||!Number.isSafeInteger(query.limit)||query.limit<1||query.limit>100||query.cursor!==null&&(!text(query.cursor,4000)||!/^[A-Za-z0-9_-]+$/.test(query.cursor)))throw new Error('Consulta de memoria inválida.');
  return query;
}
function entriesFor(value,scope){
  const common={scope,revision:value.revision};
  const entries=[];
  if(value.context)entries.push({...common,section:'context',content:value.context,source:'unknown',date:value.contextUpdatedAt??null,documentUpdatedAt:value.updatedAt,provenance:'unattributed'});
  for(const item of value.preferences)entries.push({...common,section:'preferences',key:item.key,value:item.value,source:item.source,date:item.updatedAt,provenance:provenance(item)});
  for(const item of value.learning)entries.push({...common,section:'learning',note:item.note,source:item.source,date:item.recordedAt,provenance:provenance(item)});
  return entries;
}
/** A string scope retains the internal full-document reader used by compact summaries.
 * Query-object reads return complete content, with revision-bound pagination.
 */
export function readMemory(root,input={},options={}){
  if(typeof input==='string')return load(root,input,options);
  const query=readQuery(input),scopes=query.scope==='all'?['project','user']:[query.scope],revisions={},updatedAt={},entries=[],roots={},snapshot={};
  for(const scope of scopes){
    const value=load(root,scope,options),target=location(root,scope,options);
    roots[scope]=path.resolve(target.root);
    snapshot[scope]=exists(target.root,target.file)?value:{missing:true};
    revisions[scope]=value.revision;updatedAt[scope]=value.updatedAt;entries.push(...entriesFor(value,scope));
  }
  const matching=entries.filter(item=>(query.section==='all'||query.section===item.section)&&(query.key===null||item.section==='preferences'&&item.key===query.key));
  const binding={scope:query.scope,section:query.section,key:query.key,revisions,signature:snapshotSignature({roots,snapshot})};
  let offset=0;
  if(query.cursor){
    let cursor;
    try{cursor=JSON.parse(Buffer.from(query.cursor,'base64url').toString('utf8'));}catch{throw new Error('Cursor de memoria inválido.');}
    if(!fields(cursor,['binding','offset'])||!Number.isSafeInteger(cursor.offset)||cursor.offset<0)throw new Error('Cursor de memoria inválido.');
    if(JSON.stringify(cursor.binding)!==JSON.stringify(binding))throw new Error('CURSOR_OBSOLETO: cambió la memoria o la consulta; volver a leer desde el inicio.');
    offset=cursor.offset;
    if(offset>matching.length)throw new Error('Cursor de memoria inválido.');
  }
  const page=matching.slice(offset,offset+query.limit),next=offset+page.length,hasMore=next<matching.length;
  return {scope:query.scope,section:query.section,revisions,updatedAt,entries:page,hasMore,nextCursor:hasMore?Buffer.from(JSON.stringify({binding,offset:next})).toString('base64url'):null};
}
function mutation(input){
  const extra={set_context:['context'],set_preference:['key','value','source'],remove_preference:['key'],add_learning:['note','source']};
  if(!object(input)||!Object.hasOwn(extra,input.action)||!fields(input,['action','scope','expectedRevision',...extra[input.action]])||!['project','user'].includes(input.scope)||!revision(input.expectedRevision))throw new Error('Mutación de memoria inválida: action, scope, expectedRevision y campos propios requeridos; no se admiten campos extra.');
  if(Object.hasOwn(input,'context')&&!text(input.context,4000,{blank:true})||Object.hasOwn(input,'key')&&!text(input.key,120)||Object.hasOwn(input,'value')&&!text(input.value,1000)||Object.hasOwn(input,'note')&&!text(input.note,2000)||Object.hasOwn(input,'source')&&!sources.includes(input.source))throw new Error('Mutación de memoria inválida: key/value/note no vacíos y source explícito cuando corresponda.');
  return {...input,...(Object.hasOwn(input,'key')?{key:input.key.trim()}:{})};
}
function expected(value,input){
  if(value.revision!==input.expectedRevision)throw new Error(`CONFLICTO: revisión de memoria ${value.revision}, esperada ${input.expectedRevision}; releer y reconciliar antes de reintentar.`);
}
function update(root,input,options){
  const value=load(root,input.scope,options);expected(value,input);
  const timestamp=now();
  if(input.action==='set_context'){value.context=input.context;value.contextUpdatedAt=timestamp;}
  if(input.action==='set_preference'){
    const index=value.preferences.findIndex(item=>item.key===input.key);
    const item={key:input.key,value:input.value,scope:input.scope,source:input.source,updatedAt:timestamp,provenance:'explicit'};
    if(index<0)value.preferences.push(item);else value.preferences[index]=item;
  }
  if(input.action==='remove_preference')value.preferences=value.preferences.filter(item=>item.key!==input.key);
  if(input.action==='add_learning')value.learning.push({note:input.note,source:input.source,recordedAt:timestamp,provenance:'explicit'});
  value.revision++;value.updatedAt=timestamp;
  valid(value,input.scope); // Check the complete document again, never serialize partial entries.
  const target=location(root,input.scope,options);
  atomicWrite(target.root,target.file,JSON.stringify(value,null,2)+'\n');
  return {action:input.action,scope:input.scope,revision:value.revision,updatedAt:value.updatedAt};
}
const sameDirectory=(directory,identity)=>{try{const stat=fs.lstatSync(directory);return stat.isDirectory()&&stat.dev===identity.dev&&stat.ino===identity.ino;}catch{return false;}};
/** Internal synchronous user-memory transaction. Never acquire a workspace lock here. */
export function withUserLock(homeDir,fn){
  const directory=safePath(homeDir,lockFile),token=randomUUID();
  fs.mkdirSync(path.dirname(directory),{recursive:true});safePath(homeDir,lockFile);
  try{fs.mkdirSync(directory,{mode:0o700});}
  catch(error){if(error.code!=='EEXIST')throw error;throw new Error(`MEMORIA_OCUPADA: lock ${directory}. Reintentar explícitamente; si quedó abandonado, comprobar que su propietario no vive antes de recuperarlo manualmente. Nunca se elimina por antigüedad.`);}
  const identity=fs.lstatSync(directory),ownerPath=`${lockFile}/owner.json`;
  let owned=false,result,failure,failed=false,cleanupFailure;
  try{
    // Publish the operation's token before reading the shared document inside the lock.
    atomicWrite(homeDir,ownerPath,JSON.stringify({token,pid:process.pid,hostname:os.hostname(),createdAt:now(),root:path.resolve(homeDir)})+'\n');
    owned=true;
    result=fn();
  }catch(error){failed=true;failure=error;}
  try{
    if(sameDirectory(directory,identity)){
      if(owned){
        // A replaced/foreign lock is never removed, even if this operation failed.
        let owner;try{owner=readJSON(homeDir,ownerPath);}catch{}
        if(owner?.token===token){
          // Preserve the owner reference if unexpected contents prevent cleanup.
          if(fs.readdirSync(directory).some(name=>name!=='owner.json'))throw new Error('Contenido inesperado en lock de memoria; conservar para revisión manual');
          fs.unlinkSync(safePath(homeDir,ownerPath));fs.rmdirSync(directory);
        }else throw new Error('Propiedad del lock de memoria cambiada; no se elimina');
      }else if(fs.readdirSync(directory).length===0)fs.rmdirSync(directory);
    }else throw new Error('Directorio del lock de memoria reemplazado; no se elimina');
  }catch(error){cleanupFailure=error;}
  if(failed)throw failure;
  if(cleanupFailure){
    const error=new Error(`Memoria persistida; limpieza de lock pendiente: ${directory}`,{cause:cleanupFailure});
    error.code='METADATA_CLEANUP_PENDING';
    error.persistence={applied:true,cleanupPending:true,lockPath:directory,ownerPath:path.join(directory,'owner.json'),receipt:result,recovery:'No repetir la mutación. Releer memoria; detener escritores y verificar propietario/host antes de recuperación manual del lock.'};
    throw error;
  }
  return result;
}
export function updateMemory(root,input,options={}){
  const request=mutation(input);
  // Read-only preflight rejects corrupt input/files and stale revisions before creating a lock.
  if(request.scope==='user'){
    expected(load(root,request.scope,options),request);
    return withUserLock(location(root,'user',options).root,()=>update(root,request,options));
  }
  return withWorkspaceLock(root,()=>update(root,request,options));
}
