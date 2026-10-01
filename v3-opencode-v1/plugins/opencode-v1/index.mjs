import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const root=path.join(os.homedir(),'.pulso','lib');
const core=name=>import(pathToFileURL(path.join(root,name)).href);
const ok=(title,output)=>({title:`Pulso · ${title}`,output,metadata:{pulso:true,ok:true}});
const fail=(title,error)=>({title:`Pulso · ${title}`,output:`No se completó: ${String(error?.message||'operación inválida').slice(0,240)}`,metadata:{pulso:true,ok:false}});
const memorySummary=(project,user)=>`Contexto: ${project.context?project.context.slice(0,180):'sin notas'} · preferencias: ${project.preferences.length} del proyecto, ${user.preferences.length} del usuario · aprendizajes: ${project.learning.length}`;

export async function PulsoPlugin(){
  const {tool}=await import('@opencode-ai/plugin');
  const {z}=await import('zod');
  const id=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/);
  return {tool:{
    pulso_workspace:tool({description:'Prepara, consulta o valida el espacio persistente Pulso. `prepare` migra formatos legacy conocidos. Devuelve un recibo breve.',args:{action:z.enum(['prepare','status','validate']),fresh:z.boolean().optional()},execute:async(args,context)=>{try{
      if(args.action==='prepare'){const {prepareWorkspace}=await core('workspace.mjs');const result=prepareWorkspace(context.directory);return ok('workspace',result.existingWorkspace?'Ya estaba preparado.':result.legacyMigrated?`Preparado y migrados ${result.migratedWorks} trabajos legacy.`:'Preparado para el encargo actual.');}
       if(args.action==='status'){if(!fs.existsSync(path.join(context.directory,'.pulso','state.json')))return ok('estado','Sin estado Pulso disponible en este workspace.');const {readStatus}=await core('work-mutations.mjs');let value;try{value=readStatus(context.directory);}catch{return ok('estado','Estado legacy detectado. Usa prepare para migrarlo automáticamente al contrato actual.');}const focus=value.works.find(work=>work.id===value.focusWorkId);return ok('estado',focus?`${focus.id} · ${focus.status} · ${focus.progress.done}/${focus.progress.total} · siguiente: ${focus.nextAction||'sin acción'}`:`${value.works.length} trabajos abiertos · sin foco`);}
      const {validateWorkspace}=await core('work-mutations.mjs');const value=validateWorkspace(context.directory,{fresh:args.fresh||false});return ok('validación',`${value.works} trabajos válidos${args.fresh?' · evidencia vigente comprobada':''}`);
    }catch(error){return fail('workspace',error);}}}),
    pulso_work:tool({description:'Consulta o actualiza un objetivo de trabajo. Crea, bloquea o completa mapeos con acciones de alto nivel; agrupa cambios internos solo cuando sean necesarios.',args:{action:z.enum(['get','create','update','block','close','reopen','complete_map']),workId:id,title:z.string().max(240).optional(),objective:z.string().max(4000).optional(),criterion:z.string().max(2000).optional(),verification:z.string().max(2000).optional(),priority:z.enum(['low','normal','high','urgent']).optional(),expectedRevision:z.number().int().positive().optional(),actions:z.array(z.record(z.string(),z.unknown())).min(1).max(20).optional(),outcome:z.enum(['done','cancelled']).optional(),summary:z.string().max(4000).optional(),limitations:z.array(z.string().max(1000)).max(30).optional(),reason:z.string().max(2000).optional()},execute:async(args,context)=>{try{
      const mutations=await core('work-mutations.mjs'),receipts=await core('receipts.mjs');
      if(args.action==='get'){const {readWork}=await core('artifacts.mjs');const value=readWork(context.directory,args.workId,{files:false});return ok('trabajo',`${value.id} · rev. ${value.revision} · ${value.status} · tareas ${value.tasks.filter(task=>task.status==='done').length}/${value.tasks.length} · siguiente: ${value.nextAction||'sin acción'}`);}
      if(args.action==='create'){const {workId,title,objective,criterion,verification,priority}=args;return ok('trabajo',receipts.formatReceipt(mutations.createWorkOperation(context.directory,{workId,title,objective,criterion,verification,priority})));}
      if(args.action==='update')return ok('trabajo',receipts.formatReceipt(mutations.applyWorkMutation(context.directory,{workId:args.workId,expectedRevision:args.expectedRevision,actions:args.actions})));
      if(args.action==='block'){const receipt=mutations.applyWorkMutation(context.directory,{workId:args.workId,expectedRevision:args.expectedRevision,actions:[{type:'work.set_overview',status:'blocked',summary:args.summary,blockers:[args.reason],nextAction:'Resolver el bloqueo antes de continuar'}]});return ok('trabajo',receipts.formatReceipt(receipt));}
      if(args.action==='close')return ok('trabajo',receipts.formatReceipt(mutations.closeWorkOperation(context.directory,{workId:args.workId,expectedRevision:args.expectedRevision,outcome:args.outcome,summary:args.summary,limitations:args.limitations||[]})));
      if(args.action==='complete_map'){const value=mutations.completeMapOperation(context.directory,{workId:args.workId,expectedRevision:args.expectedRevision,summary:args.summary,limitations:args.limitations||[]});return ok('mapeo',`${value.id} cerrado · rev. ${value.revision}`);}
      return ok('trabajo',receipts.formatReceipt(mutations.reopenWorkOperation(context.directory,{workId:args.workId,expectedRevision:args.expectedRevision,reason:args.reason})));
    }catch(error){return fail('trabajo',error);}}}),
    pulso_history:tool({description:'Consulta cierres recientes de Pulso con resultado resumido.',args:{workId:id.optional(),since:z.string().optional(),until:z.string().optional(),limit:z.number().int().min(1).max(20).optional()},execute:async(args,context)=>{try{const {readHistory}=await core('work-mutations.mjs');const values=readHistory(context.directory,args);return ok('historial',values.length?values.map(value=>`${value.workId} · ${value.outcome} · ${value.summary.slice(0,160)}`).join('\n'):'Sin cierres para esta consulta.');}catch(error){return fail('historial',error);}}}),
    pulso_context:tool({description:'Consulta o registra contexto relevante, preferencias y aprendizajes. Las preferencias de usuario se conservan entre workspaces y sesiones.',args:{action:z.enum(['summary','set_context','set_preference','remove_preference','add_learning']),context:z.string().max(4000).optional(),key:z.string().max(120).optional(),value:z.string().max(1000).optional(),scope:z.enum(['project','user']).optional(),note:z.string().max(2000).optional(),source:z.enum(['user','observed','delegated']).optional()},execute:async(args,context)=>{try{const memory=await core('memory.mjs');if(args.action!=='summary')memory.updateMemory(context.directory,args);return ok('contexto',memorySummary(memory.readMemory(context.directory),memory.readMemory(context.directory,'user')));}catch(error){return fail('contexto',error);}}})
  }};
}
