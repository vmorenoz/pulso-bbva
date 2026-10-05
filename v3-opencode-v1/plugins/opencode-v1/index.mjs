import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {contracts} from './contracts.mjs';
const ok=(title,value)=>({title:`Pulso · ${title}`,output:typeof value==='string'?value:JSON.stringify(value),metadata:{pulso:true,ok:true}});
const fail=(title,error)=>({title:`Pulso · ${title}`,output:`No se completó: ${String(error?.message||'operación inválida').slice(0,400)}`,metadata:{pulso:true,ok:false}});
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function page(values,{limit=20,cursor}={},identity){
  const signature=digest(identity),decode=()=>{try{return JSON.parse(Buffer.from(cursor,'base64url').toString());}catch{throw new Error('Cursor inválido');}};
  const state=cursor?decode():{signature,offset:0};
  if(state.signature!==signature||!Number.isSafeInteger(state.offset)||state.offset<0||state.offset>values.length)throw new Error('Cursor obsoleto; releer desde la primera página');
  const entries=values.slice(state.offset,state.offset+limit),offset=state.offset+entries.length,hasMore=offset<values.length;
  return {entries,total:values.length,hasMore,nextCursor:hasMore?Buffer.from(JSON.stringify({signature,offset})).toString('base64url'):null};
}
export async function PulsoPlugin({directory,homeDir=os.homedir(),coreDir=path.join(homeDir,'.pulso','lib')}){
  const core=name=>import(pathToFileURL(path.join(coreDir,name)).href),globalRoot=path.dirname(coreDir);
  const {tool}=await import('@opencode-ai/plugin'),{z}=await import('zod'),schemas=contracts(z);
  // Every request, including reads, participates in effective native permissions.
  const run=(name,schema,handler)=>async(input,context)=>{
    let args;
    try{
      if(input.request&&Object.keys(input).some(key=>key!=='request'))throw new Error('Campo fuera de request no admitido');
      args=schema.parse(input.request??input);
      if(typeof context.ask!=='function')throw new Error('Aprobación nativa no disponible; operación bloqueada');
    }catch(error){return fail(name,error);}
    const action=args.action||'read',resource=args.scope||args.workId||'workspace';
    // Native denial/cancellation is not converted into a normal tool result or retried.
    await context.ask({permission:name,patterns:[`${action}:${resource}`],always:[`${action}:${resource}`],metadata:{action,resource}});
    try{return await handler(args,context);}catch(error){return fail(name,error);}
  };
  let observer;
  const observedCalls=new Set();
  const observe=hook=>async(...args)=>{try{
    // Do not instantiate telemetry for unrelated task tools or unprepared projects.
    const {exists,readJSON}=await core('fs.mjs');
    if(!exists(directory,'.pulso/state.json'))return;
    const catalog=readJSON(globalRoot,'catalog.json');
    if(hook!=='event'){
      if(args[0]?.tool!=='task')return;
      const taskArgs=hook==='tool.execute.before'?args[1]?.args:args[0]?.args;
      if(!catalog.specialists.some(a=>a.id===taskArgs?.subagent_type))return;
      const prompt=taskArgs?.prompt||'',match=label=>[...prompt.matchAll(new RegExp(`(?:^|[\\s{,])"?${label}"?\\s*[:=]\\s*"?([A-Za-z0-9][A-Za-z0-9_-]{0,79})(?=["\\s,}]|$)`,'g'))].map(m=>m[1]);
      const works=match('workId'),tasks=match('taskId');
      if(new Set(works).size!==1||new Set(tasks).size!==1)return;
      const {readWork}=await core('artifacts.mjs'),work=readWork(directory,works[0],{files:false});
      if(!work.tasks.some(t=>t.id===tasks[0]&&t.agent===taskArgs.subagent_type))return;
      observedCalls.add(JSON.stringify([args[0].sessionID,args[0].callID]));
    }else {
      if(!observer)return;
      const event=args[0]?.event;
      if(event?.type==='message.part.updated'){
        const part=event.properties?.part;
        if(!observedCalls.has(JSON.stringify([part?.sessionID,part?.callID])))return;
      }
    }
    observer??=(await core('delegation-observer.mjs')).createDelegationObserver(directory);
    await observer[hook](...args);
  }catch{}};
  return {'tool.execute.before':observe('tool.execute.before'),'tool.execute.after':observe('tool.execute.after'),event:observe('event'),tool:{
    pulso_workspace:tool({description:'Consulta todos los Work y sus bloqueos; prepara/migra, valida, sincroniza o recupera explícitamente. request discrimina cada acción; las lecturas no preparan el proyecto.',args:{request:schemas.workspace},execute:run('pulso_workspace',schemas.workspace,async(args,context)=>{
      const mutations=await core('work-mutations.mjs');
      if(['attempts','reconcile_attempts'].includes(args.action)){const {readDelegationAttempts}=await core('delegation-observer.mjs');return ok('intentos',readDelegationAttempts(context.directory,args));}
      if(args.action==='sync'){const {formatReceipt}=await core('receipts.mjs');return ok('sincronización',formatReceipt(mutations.syncWorkOperation(context.directory,args)));}
      if(args.action==='recover'){
        const {exists}=await core('fs.mjs');
        if(exists(context.directory,'.pulso/preparation.json')){const {prepareWorkspace}=await core('workspace.mjs');prepareWorkspace(context.directory,{homeDir});}
        return ok('recuperación',mutations.recoverWorkspaceOperation(context.directory));
      }
      if(args.action==='prepare'){const {prepareWorkspace}=await core('workspace.mjs');return ok('workspace',prepareWorkspace(context.directory,{homeDir}));}
      if(args.action==='status'){
        const {exists,readJSON}=await core('fs.mjs');
        if(!exists(context.directory,'.pulso/state.json'))return ok('estado','Sin estado Pulso disponible en este workspace.');
        const saved=readJSON(context.directory,'.pulso/state.json');
        if(saved?.schemaVersion===undefined&&saved?.schema_version===1)return ok('estado','Estado legacy detectado. Usa prepare para migrarlo al contrato actual.');
        const value=mutations.readStatus(context.directory),values=value.works.filter(w=>!args.status||w.status===args.status);
        return ok('estado',{revision:value.revision,focusWorkId:value.focusWorkId,...page(values,args,[value,args.status])});
      }
      return ok('validación',mutations.validateWorkspace(context.directory,{fresh:args.fresh||false}));
    })}),
    pulso_work:tool({description:'Consulta Work completo o por sección, con acceptanceBasis para una NUEVA observación. Actualizaciones tipadas y revisión esperada. validate_result comprueba correlación/plantilla global; nunca certifica semántica.',args:{request:schemas.work},execute:run('pulso_work',schemas.work,async(args,context)=>{
      const mutations=await core('work-mutations.mjs'),receipts=await core('receipts.mjs'),artifacts=await core('artifacts.mjs');
      if(args.action==='validate_result')return ok('resultado',artifacts.validateResult(context.directory,args.delegation,args.result,{globalRoot}));
      if(args.action==='get'){
        const value=artifacts.readWork(context.directory,args.workId,{files:false}),section=args.section||'all';
        const {objective,tasks,documents,evidence,acceptanceChanges=[],...overview}=value;
        const sections={criteria:objective.criteria,tasks,documents,evidence,acceptanceChanges};
        const values=section==='overview'?[]:Object.entries(sections).filter(([name])=>section==='all'||section===name).flatMap(([section,items])=>items.map(value=>({section,value})));
        return ok('trabajo',{...overview,objective:{id:objective.id,outcome:objective.outcome},acceptanceBasis:artifacts.acceptanceBasis(value),...page(values,args,[value.id,value.revision,section])});
      }
      if(args.action==='create'){const {action,...input}=args;return ok('trabajo',receipts.formatReceipt(mutations.createWorkOperation(context.directory,input)));}
      if(args.action==='update')return ok('trabajo',receipts.formatReceipt(mutations.applyWorkMutation(context.directory,{workId:args.workId,expectedRevision:args.expectedRevision,actions:args.actions})));
      if(args.action==='block')return ok('trabajo',receipts.formatReceipt(mutations.applyWorkMutation(context.directory,{workId:args.workId,expectedRevision:args.expectedRevision,actions:[{type:'work.set_overview',status:'blocked',summary:args.summary,blockers:[args.reason],nextAction:'Resolver el bloqueo antes de continuar'}]})));
      if(args.action==='close')return ok('trabajo',receipts.formatReceipt(mutations.closeWorkOperation(context.directory,args)));
      return ok('trabajo',receipts.formatReceipt(mutations.reopenWorkOperation(context.directory,args)));
    })}),
    pulso_history:tool({description:'Cierres con fecha, resultado, limitaciones y cursor estable; no prepara ni modifica.',args:schemas.history.shape,execute:run('pulso_history',schemas.history,async(args,context)=>{
      const {history}=await core('artifacts.mjs');
      const entries=history(context.directory).filter(e=>(!args.workId||e.workId===args.workId)&&(!args.since||Date.parse(e.closedAt)>=Date.parse(args.since))&&(!args.until||Date.parse(e.closedAt)<=Date.parse(args.until))).sort((a,b)=>b.closedAt.localeCompare(a.closedAt)||b.closureId.localeCompare(a.closureId));
      return ok('historial',page(entries,args,[entries,args.workId,args.since,args.until]));
    })}),
    pulso_context:tool({description:'Lee contenido real por scope/sección y páginas. Mutaciones requieren scope, expectedRevision y procedencia explícita para preferencias/aprendizajes; conflicto exige releer.',args:{request:schemas.context},execute:run('pulso_context',schemas.context,async(args,context)=>{
      const memory=await core('memory.mjs');
      if(args.action==='read')return ok('contexto',memory.readMemory(context.directory,args,{homeDir}));
      if(args.action==='summary'){
        const project=memory.readMemory(context.directory,'project',{homeDir}),user=memory.readMemory(context.directory,'user',{homeDir});
        return ok('contexto',{project:{revision:project.revision,preferences:project.preferences.length,learning:project.learning.length},user:{revision:user.revision,preferences:user.preferences.length,learning:user.learning.length},next:'Usa request.action=read para recuperar valores, contexto y procedencia.'});
      }
      return ok('contexto',memory.updateMemory(context.directory,args,{homeDir}));
    })})
  }};
}
