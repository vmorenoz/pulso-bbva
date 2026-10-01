import fs from 'node:fs';
import path from 'node:path';
import {createWork,initArtifacts,saveWork,status} from './artifacts.mjs';
import {atomicWrite,exists,safePath} from './fs.mjs';

function seed(root){
  initArtifacts(root);
  if(!exists(root,'.pulso/project.md'))atomicWrite(root,'.pulso/project.md','# Proyecto\n\nContexto todavía no levantado. Usa la plantilla global proporcionada por Pulso y evidencia del repositorio.\n');
  if(!exists(root,'.pulso/decisions.md'))atomicWrite(root,'.pulso/decisions.md','# Índice de decisiones\n\nSin decisiones registradas. Añadir referencias; no inventar aprobaciones.\n');
  if(!exists(root,'.pulso/memory.json'))atomicWrite(root,'.pulso/memory.json',JSON.stringify({schemaVersion:1,revision:1,updatedAt:new Date().toISOString(),context:'',preferences:[],learning:[]},null,2)+'\n');
}
function legacyText(value,fallback){return typeof value==='string'&&value.trim()?value.trim():fallback;}
function migrateLegacy(root,folder){
  const tasks=safePath(root,'.pulso/tasks'),state=safePath(root,'.pulso/state.json');
  const records=[];
  if(fs.existsSync(tasks)&&fs.statSync(tasks).isDirectory())for(const entry of fs.readdirSync(tasks,{withFileTypes:true})){
    if(!entry.isFile()||!/^PULSO-[A-Za-z0-9_-]+\.json$/.test(entry.name))continue;
    try{records.push(JSON.parse(fs.readFileSync(path.join(tasks,entry.name),'utf8')));}catch{}
  }
  // Legacy metadata is consumed before creating the current canonical skeleton.
  fs.rmSync(tasks,{recursive:true,force:true});fs.rmSync(state,{force:true});
  for(const entry of fs.readdirSync(folder)){if(entry==='tasks'||entry==='state.json')continue;fs.rmSync(path.join(folder,entry),{recursive:true,force:true});}
  seed(root);
  const used=new Set();let migrated=0;
  for(const [index,legacy] of records.entries()){
    let id=typeof legacy?.id==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(legacy.id)?legacy.id:`LEGACY-${index+1}`;
    while(used.has(id))id=`LEGACY-${index+1}-${used.size}`;used.add(id);
    const title=legacyText(legacy?.title,legacyText(legacy?.objective,`Trabajo legacy ${index+1}`));
    const objective=legacyText(legacy?.objective,title);
    const criterion=Array.isArray(legacy?.acceptance_criteria)&&legacy.acceptance_criteria.find(value=>typeof value==='string'&&value.trim())||'Confirmar alcance y aceptación del contrato legacy.';
    let work=createWork(root,{id,title,objective,criterion,verification:'Revisar el alcance migrado antes de continuar.',priority:'normal'});
    const oldStatus=legacy?.status;
    if(oldStatus==='blocked')work.status='blocked';else if(oldStatus&&oldStatus!=='ready'&&oldStatus!=='draft')work.status='paused';
    const historical=legacy?.execution?.summary;
    work.summary=historical?`Migrado desde legacy: ${legacyText(historical,'sin resumen')}`:'Migrado desde artefacto legacy; requiere revisión.';
    work.blockers=[...(Array.isArray(legacy?.execution?.verification_gaps)?legacy.execution.verification_gaps.filter(value=>typeof value==='string'&&value.trim()):[]),...(oldStatus&&oldStatus!=='ready'&&oldStatus!=='draft'?[`Estado legacy ${oldStatus} preservado; requiere revisión y aceptación actual.`]:[])];
    work.nextAction='Revisar el alcance migrado antes de continuar';saveWork(root,work,1);migrated++;
  }
  return migrated;
}

export function prepareWorkspace(root){
  const folder=safePath(root,'.pulso');
  if(fs.existsSync(folder)&&!fs.statSync(folder).isDirectory())throw new Error(`No es directorio: ${folder}`);
  if(exists(root,'.pulso/state.json')){
    try{status(root);}catch{return {prepared:true,target:root,existingWorkspace:false,legacyMigrated:true,migratedWorks:migrateLegacy(root,folder)};}
    if(!exists(root,'.pulso/history.jsonl')||!fs.existsSync(safePath(root,'.pulso/work'))||!fs.statSync(safePath(root,'.pulso/work')).isDirectory())
      throw new Error(`Workspace Pulso incompleto en ${root}. Conserva sus datos y revisa la instalación; no se reparó automáticamente.`);
    return {prepared:true,target:root,existingWorkspace:true};
  }
  if(fs.existsSync(folder)&&fs.readdirSync(folder).length){
    const migrated=migrateLegacy(root,folder);
    return {prepared:true,target:root,existingWorkspace:false,legacyMigrated:true,migratedWorks:migrated};
  }
  seed(root);
  return {prepared:true,target:root,existingWorkspace:false};
}
