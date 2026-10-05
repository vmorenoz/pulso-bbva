import os from 'node:os';
import {atomicWrite,exists,now,readJSON} from './fs.mjs';

const projectFile='.pulso/memory.json';
const userFile='.pulso/preferences.json';
const empty=()=>({schemaVersion:1,revision:1,updatedAt:now(),context:'',preferences:[],learning:[]});
function valid(value){
  if(!value||value.schemaVersion!==1||!Number.isSafeInteger(value.revision)||typeof value.context!=='string'||!Array.isArray(value.preferences)||!Array.isArray(value.learning))throw new Error('Memoria Pulso no reconocida; no se modificó.');
  return value;
}
const location=(root,scope,{homeDir=os.homedir()}={})=>scope==='user'?{root:homeDir,file:userFile}:{root,file:projectFile};
export function readMemory(root,scope='project',options={}){const target=location(root,scope,options);return exists(target.root,target.file)?valid(readJSON(target.root,target.file)):empty();}
function save(root,scope,value,options={}){const target=location(root,scope,options);value.revision++;value.updatedAt=now();atomicWrite(target.root,target.file,JSON.stringify(value,null,2)+'\n');return value;}
function validateUpdate(input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Input de memoria inválido');
  if(input.scope!==undefined&&!['project','user'].includes(input.scope))throw new Error('scope inválido');
  if(input.source!==undefined&&!['user','observed','delegated'].includes(input.source))throw new Error('source inválido');
  const text=(key,max,nonempty=false)=>{
    if(typeof input[key]!=='string'||input[key].length>max||(nonempty&&!input[key].trim()))throw new Error(`${key}: texto inválido`);
  };
  switch(input.action){
    case 'set_context':text('context',4000);break;
    case 'set_preference':text('key',120,true);text('value',1000);break;
    case 'remove_preference':text('key',120,true);break;
    case 'add_learning':text('note',2000,true);break;
    default:throw new Error('Acción de memoria no admitida.');
  }
}
export function updateMemory(root,input,options={}){
  validateUpdate(input);
  const scope=input.scope==='user'?'user':'project',value=readMemory(root,scope,options);
  if(input.action==='set_context'){value.context=input.context.trim();return save(root,scope,value,options);}
  if(input.action==='set_preference'){
    const index=value.preferences.findIndex(item=>item.key===input.key);
    const item={key:input.key,value:input.value,scope:input.scope||'project',source:input.source||'user',updatedAt:now()};
    if(index<0)value.preferences.push(item);else value.preferences[index]=item;
    return save(root,scope,value,options);
  }
  if(input.action==='remove_preference'){value.preferences=value.preferences.filter(item=>item.key!==input.key);return save(root,scope,value,options);}
  if(input.action==='add_learning'){value.learning.push({note:input.note,source:input.source||'observed',recordedAt:now()});value.learning=value.learning.slice(-50);return save(root,scope,value,options);}
  throw new Error('Acción de memoria no admitida.');
}
