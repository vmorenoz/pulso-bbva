import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createWork,emptyState,initArtifacts,saveWork,status,history,validateProject} from './artifacts.mjs';
import {atomicWrite,exists,safePath,readJSON,writeJSON,idOK,listFiles} from './fs.mjs';
import {planProjectIdentity} from './identity.mjs';

const preparationFile='.pulso/preparation.json';
const json=value=>JSON.stringify(value,null,2)+'\n';
function seedFiles(at){return new Map([
  ['.pulso/state.json',json({...emptyState(),updatedAt:at})],
  ['.pulso/history.jsonl',''],
  ['.pulso/project.md','# Proyecto\n\nContexto todavía no levantado. Usa la plantilla global proporcionada por Pulso y evidencia del repositorio.\n'],
  ['.pulso/decisions.md','# Índice de decisiones\n\nSin decisiones registradas. Añadir referencias; no inventar aprobaciones.\n'],
  ['.pulso/memory.json',json({schemaVersion:1,revision:1,updatedAt:at,context:'',preferences:[],learning:[]})],
]);}
function seed(root){
  initArtifacts(root);
  for(const [file,bytes] of seedFiles(new Date().toISOString()))if(!exists(root,file))atomicWrite(root,file,bytes);
}
function finishBootstrap(root,identity){
  const marker=readJSON(root,preparationFile),files=seedFiles(marker?.startedAt);
  if(marker?.schemaVersion!==1||marker.kind!=='bootstrap'||typeof marker.startedAt!=='string'||!Number.isFinite(Date.parse(marker.startedAt))||
    !Array.isArray(marker.files)||new Set(marker.files).size!==marker.files.length||marker.files.some(file=>!files.has(file))||
    !['.pulso/state.json','.pulso/history.jsonl'].every(file=>marker.files.includes(file)))throw new Error('Marcador de preparación inválido; datos conservados');
  if(exists(root,'.pulso/tasks'))throw new Error('Preparación mezclada con datos legacy; datos conservados');
  const work=safePath(root,'.pulso/work');
  if(fs.existsSync(work)&&(!fs.statSync(work).isDirectory()||fs.readdirSync(work).length))throw new Error('Preparación con trabajo existente; datos conservados');
  // Only untouched seed bytes establish ownership; never repair arbitrary partial data.
  for(const [file,bytes] of files){
    const target=safePath(root,file),present=fs.existsSync(target),owned=marker.files.includes(file);
    if(!present&&!owned||present&&(!fs.statSync(target).isFile()||owned&&fs.readFileSync(target,'utf8')!==bytes))throw new Error(`Preparación modificada o incompleta: ${file}; datos conservados`);
  }
  for(const file of marker.files)if(!exists(root,file))atomicWrite(root,file,files.get(file));
  fs.mkdirSync(work,{recursive:true});
  identity.commit();
  fs.unlinkSync(safePath(root,preparationFile));
}
function startBootstrap(root,identity){
  const startedAt=new Date().toISOString(),files=[...seedFiles(startedAt).keys()];
  for(const file of files)if(exists(root,file)&&!fs.statSync(safePath(root,file)).isFile())throw new Error(`No es archivo: ${file}`);
  writeJSON(root,preparationFile,{schemaVersion:1,kind:'bootstrap',startedAt,files:files.filter(file=>!exists(root,file))});
  finishBootstrap(root,identity);
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
  if(exists(root,preparationFile)){
    finishBootstrap(root,identity);
    return {prepared:true,target:root,existingWorkspace:false,projectId:identity.projectId,bootstrapRecovered:true};
  }
  let legacyState=false;
  if(exists(root,'.pulso/state.json')){
    const saved=readJSON(root,'.pulso/state.json');
    legacyState=saved?.schemaVersion===undefined&&saved?.schema_version===1;
    if(!legacyState){
      // Invalid current state is never evidence of a legacy workspace.
      status(root);history(root);
      if(!fs.existsSync(safePath(root,'.pulso/work'))||!fs.statSync(safePath(root,'.pulso/work')).isDirectory())
        throw new Error(`Workspace Pulso incompleto en ${root}; datos conservados. Restaura los archivos ausentes desde un respaldo.`);
      for(const file of ['.pulso/project.md','.pulso/decisions.md','.pulso/memory.json'])if(!exists(root,file)||!fs.statSync(safePath(root,file)).isFile())
        throw new Error(`Workspace Pulso incompleto: ${file}; sin marcador propio no se reconstruye. Restaura el archivo desde un respaldo.`);
      identity.commit();
      return {prepared:true,target:root,existingWorkspace:true,projectId:identity.projectId};
    }
  }
  if(exists(root,'.pulso/work')||exists(root,'.pulso/history.jsonl'))throw new Error('Workspace actual incompleto; sin marcador propio no se reconstruye. Restaura los archivos ausentes desde un respaldo.');
  const records=legacyRecords(root);
  if(records){
    const result=migrateLegacy(root,records,{legacyState});identity.commit();
    return {prepared:true,target:root,existingWorkspace:false,projectId:identity.projectId,legacyMigrated:true,...result};
  }
  if(exists(root,'.pulso/tasks'))throw new Error('Formato legacy no reconocido; datos conservados');
  if(legacyState)throw new Error('Estado legacy sin tareas reconocidas; datos conservados');
  startBootstrap(root,identity);
  return {prepared:true,target:root,existingWorkspace:false,projectId:identity.projectId};
}
