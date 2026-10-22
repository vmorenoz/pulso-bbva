/** Four semantic tools. Roots and invocation checks come only from the adapter. */
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {toolDefinitions,validateToolInput} from './tool-contracts.mjs';
import * as artifacts from './artifacts.mjs';
import * as mutations from './work-mutations.mjs';
import {prepareDelegation,acceptResult,acceptDelivery} from './acceptance.mjs';
import {supersedeEvidence} from './evidence-supersession.mjs';
import {bindContinuity,checkContext,getContinuity,inspectContinuities,resumeContinuity,updateIntent} from './continuity.mjs';
import {getDelegation,reconcileDelegation,readDelegation} from './delegation-registry.mjs';
import * as memory from './memory.mjs';
import {prepareWorkspace,recoverWorkspaceMigration,workspacePreparation} from './workspace.mjs';
import {exists,readJSON,withWorkspaceLock} from './fs.mjs';
import {formatReceipt,recoveryDetails} from './receipts.mjs';
import {pagination,pageItems} from './pagination.mjs';

import {authorizeTool,getAssignment,updateAssignment,assignmentReceipts,assignmentCapabilities,assignmentWorkProjection,currentAssignment} from './assignment-tools.mjs';

const defaultResourceRoot=fileURLToPath(new URL('../',import.meta.url));
const ok=(title,output,data)=>({title:`Pulso · ${title}`,output,ok:true,...(data===undefined?{}:{data})});
const fail=(title,error)=>({title:`Pulso · ${title}`,output:`${error?.persistence?.applied?'Aplicado parcialmente; no repitas a ciegas':'No se completó'}: ${String(error?.message||'operación inválida').slice(0,500)}`,ok:false,error:{code:error?.code||'OPERATION_FAILED',message:String(error?.message||'operación inválida').slice(0,500),...(error?.issues?{issues:error.issues}:{}),...(error?.issueCount?{issueCount:error.issueCount}:{}),...(error?.revision?{revision:error.revision}:{}),...recoveryDetails(error)},...(error?.readiness?{data:{readiness:error.readiness}}:{}),...(error?.persistence?{persistence:error.persistence}:{})});
const receipt=(title,data)=>ok(title,formatReceipt(data),data);

function continuityReceipt(value){
  const {contractVersion,continuityId,projectId,workId,cycle,intentId,intentRevision,revision,ownerSessionID}=value;
  return {contractVersion,continuityId,projectId,workId,cycle,intentId,intentRevision,revision,ownerSessionID,...(value.intentSource?{intentSource:value.intentSource}:{}),readWith:{action:'get_continuity',continuityId}};
}

function memorySummary(project,user){
  const primary=project||user;
  const counts=project&&user?`${project.preferences.length} del proyecto, ${user.preferences.length} del usuario`:`${primary.preferences.length} del ${project?'proyecto':'usuario'}`;
  function* lines(){
    yield `Contexto: ${primary.context?primary.context.slice(0,180):'sin notas'} · preferencias: ${counts} · aprendizajes: ${primary.learning.length}`;
    for(const [scope,value] of [['proyecto',project],['usuario',user]]){
      if(!value)continue;
      yield `\nMemoria de ${scope}:\nContexto: ${JSON.stringify(value.context)}`;
      for(const preference of value.preferences)yield `\nPreferencia: ${JSON.stringify({key:preference.key,value:preference.value,source:preference.source})}`;
      for(const lesson of value.learning)yield `\nAprendizaje: ${JSON.stringify({note:lesson.note,source:lesson.source})}`;
    }
  }
  const limit=8000,notice='\n[Contenido truncado; límite total de 8000 caracteres.]';
  let output='';
  for(const line of lines()){
    if(output.length+line.length>limit)return (output+line).slice(0,limit-notice.length)+notice;
    output+=line;
  }
  return output;
}

function workRead(root,args,options){
  const stored=artifacts.readWork(root,args.workId,{files:false}),assignment=options.authorization?.kind==='assignment'?currentAssignment(root,options):null;
  const value=assignment?assignmentWorkProjection(stored,assignment.record):stored,section=args.section||'overview';
  const arrays={tasks:value.tasks,criteria:value.objective.criteria,evidence:value.evidence,results:value.results||[],documents:value.documents,blockers:value.blockers,decisions:value.decisionsPending,acceptanceChanges:value.acceptanceChanges||[],assignmentOperations:value.assignmentOperations||[],evidenceSupersessions:value.evidenceSupersessions||[]};
  const selected=section==='all'?Object.keys(arrays):section==='overview'?['blockers','decisions']:[section];
  const basisSections=section==='overview'?['criteria','tasks']:selected.filter(key=>['criteria','tasks'].includes(key));
  const page=pagination({kind:'work',binding:{projectRoot:root,workId:args.workId,section},snapshot:value,total:Math.max(0,...[...selected,...basisSections].map(key=>arrays[key].length)),limit:args.limit||20,cursor:args.cursor});
  const data={...value,objective:{...value.objective},section,hasMore:page.hasMore,nextCursor:page.nextCursor};
  for(const [key,values] of Object.entries(arrays)){
    const included=selected.includes(key),hasMore=included&&page.offset+page.limit<values.length;
    const result=included?{items:values.slice(page.offset,page.offset+page.limit),total:values.length,hasMore,nextCursor:hasMore?page.nextCursor:null}:{total:values.length,readWith:{section:key}};
    if(key==='criteria')data.objective.criteria=result;
    else data[key==='decisions'?'decisionsPending':key]=result;
  }
  const basisValues=key=>basisSections.includes(key)?arrays[key].slice(page.offset,page.offset+page.limit):[];
  data.acceptanceBasis=artifacts.acceptanceBasis(stored,{criterionIds:basisValues('criteria').map(item=>item.id),taskIds:basisValues('tasks').map(item=>item.id)});
  data.acceptanceBasisPage=Object.fromEntries(['criteria','tasks'].map(key=>[key,basisSections.includes(key)?{total:arrays[key].length,hasMore:page.offset+page.limit<arrays[key].length,nextCursor:page.offset+page.limit<arrays[key].length?page.nextCursor:null}:{total:arrays[key].length,readWith:{section:key}}]));
  data.readiness=assignment?{assessed:false,note:'Proyección de asignación; no evalúa cierre global.'}:artifacts.completionReadiness(root,value);
  if(value.closure?.mode==='user_requested')Object.assign(data,{closed:true,authority:'user',verification:'user_approved',approval:value.closure.userRequest.approval});
  return ok('trabajo',`${value.id} · rev. ${value.revision} · ${value.status}${data.verification==='user_approved'?' · revisado y aprobado por usuario':''} · tareas ${value.tasks.filter(task=>task.status==='done').length}/${value.tasks.length} · siguiente: ${value.nextAction||'sin acción'}`,data);
}

const handlers={
  pulso_workspace(args,{projectRoot:root,homeDir,...options}){
    switch(args.action){
      case 'get_assignment':return ok('asignación','Capacidades limitadas al encargo nativo.',getAssignment(root,args,options));
      case 'bind_continuity':return ok('continuidad','Continuidad vinculada.',continuityReceipt(bindContinuity(root,args,options)));
      case 'get_continuity':return ok('continuidad','Intención y operaciones conservadas.',getContinuity(root,args,options));
      case 'inspect_continuities':return ok('continuidades','Continuidades del Work seleccionado; lectura sin adopción.',inspectContinuities(root,args,options));
      case 'resume_continuity':{
        const {value,duplicate}=resumeContinuity(root,args,options);
        return ok('continuidad',duplicate?'Retoma ya aplicada confirmada; intención y reservas conservadas.':'Continuidad retomada; intención y reservas conservadas.',{...continuityReceipt(value),duplicate,...(args.resumeMode==='automatic'?{resumeMode:'automatic',ownerTransferred:true,physicalCessation:'unknown'}:{})});
      }
      case 'update_intent':return ok('intención','Intención actualizada; no detiene agentes nativos.',continuityReceipt(updateIntent(root,args,options)));
      case 'prepare':{
        const data=prepareWorkspace(root,{homeDir});
        return ok('workspace',data.existingWorkspace?'Ya estaba preparado.':data.legacyMigrated?`Preparado y migrados ${data.migratedWorks} trabajos legacy.`:'Preparado para el encargo actual.',data);
      }
      case 'sync':return receipt('sincronización',mutations.syncWorkOperation(root,{workId:args.workId,expectedRevision:args.expectedRevision}));
      case 'recover':{
        checkContext(options);
        recoverWorkspaceMigration(root,{homeDir});
        if(exists(root,'.pulso/preparation.json'))prepareWorkspace(root,{homeDir});
        const data=mutations.recoverWorkspaceOperation(root);
        return ok('recuperación','Recuperación completada. Consulta status para revisar el índice; no se reanudaron sesiones nativas.',data);
      }
      case 'status':{
        const preparation=workspacePreparation(root);
        const continuity=args.continuityId?getContinuity(root,args,options):null;
        if(!exists(root,'.pulso/state.json')){
          const works=pageItems([],{kind:'status',binding:{projectRoot:root,status:args.status||null},snapshot:null,limit:args.limit||20,cursor:args.cursor});
          return ok('estado','Sin estado Pulso disponible en este workspace.',{...(exists(root,'.pulso')?preparation:{}),prepared:false,works});
        }
        let value;
        try{value=mutations.readStatus(root);}catch(error){
          const saved=readJSON(root,'.pulso/state.json');
          if(saved&&saved.schemaVersion===undefined&&saved.schema_version===1){
            if(args.cursor)throw new Error('CURSOR_OBSOLETO: cambió el estado; volver a leer desde el inicio.');
            return ok('estado','Estado legacy detectado. Usa prepare para migrarlo al contrato actual.',{prepared:false,legacy:true});
          }
          throw error;
        }
        const works=pageItems(value.works.filter(work=>!args.status||work.status===args.status),{kind:'status',binding:{projectRoot:root,status:args.status||null},snapshot:value,limit:args.limit||20,cursor:args.cursor});
        return ok('estado',continuity?`${continuity.continuityId} · intención ${continuity.intentRevision} · ${continuity.objective}`:`${value.works.length} trabajos abiertos · sin continuidad seleccionada`,{...value,...preparation,works,navigationFocusWorkId:value.focusWorkId,focusWorkId:continuity?.workId??null,...(continuity?{continuity}:{})});
      }
      case 'validate':{
        const data=mutations.validateWorkspace(root,{fresh:args.fresh||false});
        return ok('validación',`${data.works} trabajos válidos${args.fresh?' · evidencia vigente comprobada':''}`,data);
      }
    }
  },
  pulso_work(args,{projectRoot:root,...options}){
    const {resourceRoot}=options;
    switch(args.action){
      case 'get_delegation':return ok('encargo','Snapshot, retornos e intentos conservados.',options.authorization?.kind==='assignment'?{...readDelegation(root,args),currentRevision:artifacts.readWork(root,args.workId,{files:false}).revision,capabilities:assignmentCapabilities}:getDelegation(root,args,options));
      case 'reconcile_delegation':return ok('reconciliación','Resolución reportada; no detiene agentes.',reconcileDelegation(root,args,options));
      case 'get':return workRead(root,args,options);
      case 'prepare_delegation':{
        const data=prepareDelegation(root,args,options);
        if(data.contractVersion===2){
          const {delegationId,contractVersion,workId,continuityId,intentRevision,preparedFromRevision,specialistPrompt,state}=data;
          return ok('encargo',`${delegationId} · rev. ${preparedFromRevision} · snapshot conservado; no acredita dispatch`,{delegationId,contractVersion,workId,continuityId,intentRevision,preparedFromRevision,agent:data.delegation.agent,specialistPrompt,state,assignmentCapabilities:options.authorization?.kind==='primary'?{available:true,requires:'native child proof and current permission',actions:assignmentCapabilities}:{available:false,reason:'El adaptador no acredita capacidades de sesión hija'},readWith:{action:'get_delegation',workId,delegationId,continuityId}});
        }
        return ok('encargo',`${data.delegation.id} · rev. ${data.delegation.workRevision} · ${data.contractVersion===2?'snapshot conservado; no acredita dispatch':'preparado sin persistir ni ejecutar'}`,data);
      }
      case 'get_assignment_receipts':return ok('acciones aplicadas','Recibos canónicos; verificar antes de repetir.',assignmentReceipts(root,args,options));
      case 'update_assignment':return ok('asignación','Acciones aplicadas; no acredita aceptación ni cierre.',updateAssignment(root,args,options));
      case 'accept_result':return receipt('resultado',acceptResult(root,args,options));
      case 'accept_delivery':return receipt('aceptación',acceptDelivery(root,args,options));
      case 'supersede_evidence':{
        const {action,...input}=args;
        return receipt('sustitución de evidencia',supersedeEvidence(root,input,options));
      }
      case 'close_by_user':return withWorkspaceLock(root,()=>{
        checkContext(options);
        return receipt('cierre por usuario',mutations.closeByUserOperation(root,args));
      });
      case 'validate_result':{
        const data=artifacts.validateResult(root,args.delegation,args.result,{globalRoot:resourceRoot,catalogPath:'agents/catalog.json'});
        return ok('resultado',data.note,data);
      }
      case 'create':{
        const {action,...input}=args;
        return receipt('trabajo',mutations.createWorkOperation(root,input));
      }
      case 'update':return receipt('trabajo',mutations.applyWorkMutation(root,{workId:args.workId,expectedRevision:args.expectedRevision,actions:args.actions}));
      case 'block':return receipt('trabajo',mutations.applyWorkMutation(root,{workId:args.workId,expectedRevision:args.expectedRevision,actions:[{type:'work.set_overview',status:'blocked',summary:args.summary,blockers:[args.reason],nextAction:'Resolver el bloqueo antes de continuar'}]}));
      case 'close':return withWorkspaceLock(root,()=>{
        checkContext(options);
        return receipt('trabajo',mutations.closeWorkOperation(root,{workId:args.workId,expectedRevision:args.expectedRevision,outcome:args.outcome,summary:args.summary,limitations:args.limitations||[]}));
      });
      case 'reopen':return receipt('trabajo',mutations.reopenWorkOperation(root,{workId:args.workId,expectedRevision:args.expectedRevision,reason:args.reason}));
    }
  },
  pulso_history(args,{projectRoot:root}){
    const snapshot=exists(root,'.pulso/history.jsonl')?artifacts.history(root):[];
    const values=snapshot.filter(value=>(!args.workId||value.workId===args.workId)&&(!args.since||Date.parse(value.closedAt)>=Date.parse(args.since))&&(!args.until||Date.parse(value.closedAt)<=Date.parse(args.until))).reverse();
    const data=pageItems(values,{kind:'history',binding:{projectRoot:root,workId:args.workId||null,since:args.since||null,until:args.until||null},snapshot,limit:args.limit||20,cursor:args.cursor});
    return ok('historial',data.items.length?data.items.map(value=>`${value.workId} · ${value.outcome}${value.mode==='user_requested'?' · user_approved · criterios y tareas revisados y aprobados por usuario; diagnóstico anterior histórico':''} · ${value.summary}`).join('\n'):'Sin cierres para esta consulta.',data);
  },
  pulso_context(args,{projectRoot:root,homeDir}){
    if(args.action==='read'){
      const data=memory.readMemory(root,args,{homeDir});
      return ok('contexto',`${data.entries.length} entradas · consulta revisionada${data.hasMore?' · sigue nextCursor':''}`,data);
    }
    if(args.action!=='summary'){
      const data=memory.updateMemory(root,args,{homeDir});
      return ok('contexto',`${data.scope} · rev. ${data.revision}`,data);
    }
    const project=args.scope==='user'?null:memory.readMemory(root,'project',{homeDir});
    const user=args.scope==='project'?null:memory.readMemory(root,'user',{homeDir});
    return ok('contexto',memorySummary(project,user),{revisions:{...(project?{project:project.revision}:{}),...(user?{user:user.revision}:{})},next:'Usa action=read para obtener contenido completo y procedencia.'});
  }
};

/** All persistence is synchronous; there is no await between final check and write. */
export async function executeTool(name,input,{projectRoot,homeDir=os.homedir(),resourceRoot=defaultResourceRoot,assertContext=()=>{},nativeContext,authorization,automaticRecovery,intentSource}={}){
  const definition=toolDefinitions.find(item=>item.name===name);
  try{
    validateToolInput(name,input);
    for(const [key,value] of Object.entries({projectRoot,homeDir,resourceRoot}))if(typeof value!=='string'||!path.isAbsolute(value))throw new Error(`El adaptador debe proporcionar ${key} absoluto`);
    if(typeof assertContext!=='function')throw new Error('assertContext debe ser una función');
    const checked=assertContext();
    if(checked&&typeof checked.then==='function'){
      // A rejected asynchronous assertion must not escape as an unhandled promise.
      Promise.resolve(checked).catch(()=>{});
      throw new Error('assertContext debe comprobar el contexto síncronamente');
    }
    if(nativeContext!==undefined){
      if(!nativeContext||typeof nativeContext!=='object'||Object.keys(nativeContext).some(k=>!['sessionID','messageID','callID'].includes(k))||Object.values(nativeContext).some(v=>typeof v!=='string'||!v.trim()||v.length>2000))throw new Error('nativeContext confiable inválido');
    }
    const options={projectRoot,homeDir,resourceRoot,assertContext,nativeContext,authorization,automaticRecovery,intentSource};
    authorizeTool(projectRoot,name,input,options);
    return handlers[name](input,options);
  }catch(error){return fail(definition?.displayName.replace('Pulso · ','')||'herramienta',error);}
}
export function createPulsoTools(defaultContext={}){
  return Object.fromEntries(toolDefinitions.map(definition=>[definition.name,{execute:(input,context={})=>executeTool(definition.name,input,{...defaultContext,...context})}]));
}
export {toolDefinitions,validateToolInput,isMutating} from './tool-contracts.mjs';
