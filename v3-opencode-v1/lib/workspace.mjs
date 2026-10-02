import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createWork,initArtifacts,saveWork,status,history,validateProject} from './artifacts.mjs';
import {atomicWrite,exists,safePath,readJSON,idOK,listFiles} from './fs.mjs';
import {planProjectIdentity} from './identity.mjs';

function seed(root){
  initArtifacts(root);
  if(!exists(root,'.pulso/project.md'))atomicWrite(root,'.pulso/project.md','# Proyecto\n\nContexto todavía no levantado. Usa la plantilla global proporcionada por Pulso y evidencia del repositorio.\n');
  if(!exists(root,'.pulso/decisions.md'))atomicWrite(root,'.pulso/decisions.md','# Índice de decisiones\n\nSin decisiones registradas. Añadir referencias; no inventar aprobaciones.\n');
  if(!exists(root,'.pulso/memory.json'))atomicWrite(root,'.pulso/memory.json',JSON.stringify({schemaVersion:1,revision:1,updatedAt:new Date().toISOString(),context:'',preferences:[],learning:[]},null,2)+'\n');
}
const nonempty=value=>typeof value==='string'&&Boolean(value.trim());
function legacyRecords(root){
  const tasks=safePath(root,'.pulso/tasks');
  if(!fs.existsSync(tasks))return null;
  if(!fs.statSync(tasks).isDirectory())throw new Error('tasks legacy no es directorio');
  const records=[];
  for(const entry of fs.readdirSync(tasks,{withFileTypes:true})){
    if(!/^PULSO-[A-Za-z0-9_-]+\.json$/.test(entry.name))continue;
    if(!entry.isFile())throw new Error(`Tarea legacy inválida: ${entry.name}`);
    const legacy=readJSON(root,`.pulso/tasks/${entry.name}`);
    if(!legacy||!idOK(legacy.id)||`${legacy.id}.json`!==entry.name||!nonempty(legacy.title)||!nonempty(legacy.objective)||
      !['draft','ready','in_progress','blocked','implemented','verified','done','cancelled','paused'].includes(legacy.status)||
      !Array.isArray(legacy.acceptance_criteria)||!legacy.acceptance_criteria.length||legacy.acceptance_criteria.some(v=>!nonempty(v))||
      (legacy.execution!==undefined&&(!legacy.execution||typeof legacy.execution!=='object'||Array.isArray(legacy.execution)))||
      (legacy.execution?.summary!==undefined&&typeof legacy.execution.summary!=='string')||
      (legacy.execution?.verification_gaps!==undefined&&(!Array.isArray(legacy.execution.verification_gaps)||legacy.execution.verification_gaps.some(v=>!nonempty(v)))))
      throw new Error(`Formato legacy no reconocido: ${entry.name}; datos conservados`);
    records.push({file:entry.name,legacy});
  }
  // A folder with only unknown files is not positive recognition.
  return records.length||!fs.readdirSync(tasks).length?records:null;
}
function migrateLegacy(root,records,{legacyState=false}={}){
  const token=randomUUID(),stage=safePath(root,`.pulso-migration-${token}`),backupPath=`.pulso-legacy-${token}`,backup=safePath(root,backupPath);
  const folder=safePath(root,'.pulso');
  listFiles(folder); // Reject symlinks before copying or replacing any source data.
  let moved=false,published=false;
  try{
    fs.mkdirSync(stage);
    fs.cpSync(folder,path.join(stage,'.pulso'),{recursive:true,errorOnExist:true,force:false});
    if(legacyState)fs.unlinkSync(safePath(stage,'.pulso/state.json'));
    for(const {file} of records)fs.unlinkSync(safePath(stage,`.pulso/tasks/${file}`));
    const tasks=safePath(stage,'.pulso/tasks');if(!fs.readdirSync(tasks).length)fs.rmdirSync(tasks);
    seed(stage);
    for(const {legacy} of records){
      const work=createWork(stage,{id:legacy.id,title:legacy.title,objective:legacy.objective,criterion:legacy.acceptance_criteria[0],verification:'Revisar el alcance migrado antes de continuar.'});
      work.objective.criteria=legacy.acceptance_criteria.map((description,index)=>({id:`AC-${index+1}`,description,verification:'Revisar el alcance migrado antes de continuar.',evidenceIds:[]}));
      if(legacy.status==='blocked')work.status='blocked';else if(!['ready','draft'].includes(legacy.status))work.status='paused';
      work.summary=nonempty(legacy.execution?.summary)?`Migrado desde legacy: ${legacy.execution.summary}`:'Migrado desde artefacto legacy; requiere revisión.';
      work.blockers=[...(Array.isArray(legacy.execution?.verification_gaps)?legacy.execution.verification_gaps.filter(nonempty):[]),...(!['ready','draft'].includes(legacy.status)?[`Estado legacy ${legacy.status} preservado; requiere revisión y aceptación actual.`]:[])];
      work.nextAction='Revisar el alcance migrado antes de continuar';saveWork(stage,work,1);
    }
    validateProject(stage);
    fs.renameSync(folder,backup);moved=true;
    fs.renameSync(path.join(stage,'.pulso'),folder);published=true;
    return {migratedWorks:records.length,backupPath};
  }catch(error){
    if(moved&&!published)fs.renameSync(backup,folder);
    throw error;
  }finally{fs.rmSync(stage,{recursive:true,force:true});}
}

export function prepareWorkspace(root,options={}){
  const folder=safePath(root,'.pulso');
  if(fs.existsSync(folder)&&!fs.statSync(folder).isDirectory())throw new Error(`No es directorio: ${folder}`);
  const identity=planProjectIdentity(root,options);
  let legacyState=false;
  if(exists(root,'.pulso/state.json')){
    const saved=readJSON(root,'.pulso/state.json');
    legacyState=saved?.schemaVersion===undefined&&saved?.schema_version===1;
    if(!legacyState){
      // Invalid current state is never evidence of a legacy workspace.
      status(root);history(root);
      if(!fs.existsSync(safePath(root,'.pulso/work'))||!fs.statSync(safePath(root,'.pulso/work')).isDirectory())
        throw new Error(`Workspace Pulso incompleto en ${root}; datos conservados. Usa recuperación explícita.`);
      identity.commit();
      return {prepared:true,target:root,existingWorkspace:true,projectId:identity.projectId};
    }
  }
  if(exists(root,'.pulso/work')||exists(root,'.pulso/history.jsonl'))throw new Error('Workspace actual incompleto; usa recuperación explícita');
  const records=legacyRecords(root);
  if(records){
    const result=migrateLegacy(root,records,{legacyState});identity.commit();
    return {prepared:true,target:root,existingWorkspace:false,projectId:identity.projectId,legacyMigrated:true,...result};
  }
  if(exists(root,'.pulso/tasks'))throw new Error('Formato legacy no reconocido; datos conservados');
  if(legacyState)throw new Error('Estado legacy sin tareas reconocidas; datos conservados');
  seed(root);identity.commit();
  return {prepared:true,target:root,existingWorkspace:false,projectId:identity.projectId};
}
