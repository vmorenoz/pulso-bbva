/** OpenCode 1.18.2 public SDK v1: session.get/messages/message. No prompt IDs are credentials. */
import fs from 'node:fs';
import {correlation} from './delegation-observer.mjs';
import {readDelegation} from '../resources/lib/delegation-registry.mjs';
import {contentHash} from '../resources/lib/continuity.mjs';
import {scopeError} from '../resources/lib/assignment-tools.mjs';
const nativeText=value=>typeof value==='string'&&value.trim().length>0;
function sameRoot(directory,root){try{return typeof directory==='string'&&fs.realpathSync(directory)===root;}catch{return false;}}
export async function nativeAuthority(client,context,root){
  if(!nativeText(context.sessionID)||!nativeText(context.messageID)||!nativeText(context.agent))throw scopeError('Identidad nativa de sesión/mensaje/agente no disponible','NATIVE_AUTHORITY_UNAVAILABLE');
  async function read(method,path){
    if(typeof client?.session?.[method]!=='function')throw scopeError('API nativa de identidad no disponible','NATIVE_AUTHORITY_UNAVAILABLE');
    let result;try{result=await client.session[method]({path,query:{directory:root},throwOnError:true});}catch{throw scopeError('No se pudo comprobar la identidad nativa','NATIVE_AUTHORITY_UNAVAILABLE');}
    if(result?.error||result?.data===undefined)throw scopeError('Respuesta nativa de identidad incompleta','NATIVE_AUTHORITY_UNAVAILABLE');
    return result.data;
  }
  const session=await read('get',{id:context.sessionID});
  if(session?.id!==context.sessionID||!nativeText(session.projectID)||!sameRoot(session.directory,root))throw scopeError('Sesión nativa de otro proyecto');
  const message=await read('message',{id:context.sessionID,messageID:context.messageID});
  if(message?.info?.id!==context.messageID||message.info.sessionID!==session.id||message.info.role!=='assistant'||(message.info.agent??message.info.mode)!==context.agent)throw scopeError('Agente/mensaje nativo no coincide con la invocación');
  if(!session.parentID){
    if(context.agent!=='pulso')throw scopeError('Sólo el primario Pulso coordina las tools globales');
    return Object.freeze({kind:'primary',projectRoot:root,sessionID:session.id,agent:context.agent});
  }
  const parent=await read('get',{id:session.parentID});
  if(parent?.id!==session.parentID||parent.parentID||parent.projectID!==session.projectID||!sameRoot(parent.directory,root))throw scopeError('Ancestría nativa ajena o recursiva');
  // No limit: the public v1 API returns the complete history, so a second match
  // cannot be hidden by selecting only the newest page. Fail closed on ambiguity.
  const messages=await read('messages',{id:parent.id});
  if(!Array.isArray(messages))throw scopeError('Historial nativo incompleto');
  const parts=messages.flatMap(m=>Array.isArray(m?.parts)?m.parts.filter(p=>p?.type==='tool'&&p.tool==='task'&&p.state?.metadata?.sessionId===session.id).map(part=>({part,info:m.info})):[]);
  if(parts.length!==1)throw scopeError('No hay un único ToolPart padre verificable para este hijo');
  const {part,info}=parts[0],state=part.state;
  if(info?.sessionID!==parent.id||info.role!=='assistant'||(info.agent??info.mode)!=='pulso'||part.messageID!==info.id||part.sessionID!==parent.id||state.metadata.parentSessionId!==parent.id)throw scopeError('ToolPart padre con mensaje, rol o relación incoherente');
  const backgroundRunning=state.status==='completed'&&state.metadata.background===true&&typeof state.output==='string'&&state.output.startsWith(`<task id="${session.id}" state="running">\n`);
  if(state.status!=='running'&&!backgroundRunning)throw scopeError('La llamada nativa padre no está activa');
  const ids=correlation(state.input?.prompt);
  if(ids.correlationConflicts?.length||!ids.workId||!ids.delegationId)throw scopeError('ToolPart sin identidad canónica inequívoca');
  const r=readDelegation(root,{workId:ids.workId,delegationId:ids.delegationId});
  if(state.input?.subagent_type!==context.agent||r.delegation.agent!==context.agent||state.input.prompt!==r.specialistPrompt||!r.attempts.some(a=>a.sessionID===parent.id&&a.callID===part.callID&&a.agent===context.agent&&a.provenance==='host_dispatch'))throw scopeError('ToolPart/rol/prompt no coincide con el dispatch persistido');
  return Object.freeze({kind:'assignment',projectRoot:root,sessionID:session.id,parentSessionID:parent.id,parentCallID:part.callID,workId:r.workId,delegationId:r.delegationId,continuityId:r.continuityId,agent:context.agent,promptHash:contentHash(r.specialistPrompt)});
}
