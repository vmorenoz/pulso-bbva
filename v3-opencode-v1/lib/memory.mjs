import os from 'node:os';
import {atomicWrite,exists,now,readJSON} from './fs.mjs';

const projectFile='.pulso/memory.json';
const userFile='.pulso/preferences.json';
const empty=()=>({schemaVersion:1,revision:1,updatedAt:now(),context:'',preferences:[],learning:[]});
function valid(value){
  if(!value||value.schemaVersion!==1||!Number.isSafeInteger(value.revision)||typeof value.context!=='string'||!Array.isArray(value.preferences)||!Array.isArray(value.learning))throw new Error('Memoria Pulso no reconocida; no se modificó.');
  return value;
}
const location=scope=>scope==='user'?{root:os.homedir(),file:userFile}:{root:scope,file:projectFile};
export function readMemory(root,scope='project'){const target=location(scope==='user'?'user':root);return exists(target.root,target.file)?valid(readJSON(target.root,target.file)):empty();}
function save(root,scope,value){const target=location(scope==='user'?'user':root);value.revision++;value.updatedAt=now();atomicWrite(target.root,target.file,JSON.stringify(value,null,2)+'\n');return value;}
export function updateMemory(root,input){
  const scope=input.scope==='user'?'user':'project',value=readMemory(root,scope);
  if(input.action==='set_context'){value.context=input.context.trim();return save(root,scope,value);}
  if(input.action==='set_preference'){
    const index=value.preferences.findIndex(item=>item.key===input.key);
    const item={key:input.key,value:input.value,scope:input.scope||'project',source:input.source||'user',updatedAt:now()};
    if(index<0)value.preferences.push(item);else value.preferences[index]=item;
    return save(root,scope,value);
  }
  if(input.action==='remove_preference'){value.preferences=value.preferences.filter(item=>item.key!==input.key);return save(root,scope,value);}
  if(input.action==='add_learning'){value.learning.push({note:input.note,source:input.source||'observed',recordedAt:now()});value.learning=value.learning.slice(-50);return save(root,scope,value);}
  throw new Error('Acción de memoria no admitida.');
}
