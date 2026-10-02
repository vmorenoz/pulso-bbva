import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {listFiles,safePath,sha256} from './fs.mjs';
import {composeNativeFiles} from './composition.mjs';
import {parseConfig,editConfig} from './install-jsonc.mjs';
import {INSTALL_MANIFEST,homeRelative,pluginResource,readOptional,inventoryInstallations,knownLegacyPaths,cleanupConfigs,prepareBackups,applyChanges} from './install-cleanup.mjs';

const source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const VERSION='3.1.0';
const runtimeName='opencode-v1';
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');

function workspaceFiles(){
  const result=new Map();
  for(const d of ['templates','schemas','docs'])for(const f of listFiles(path.join(source,d)))result.set(`.pulso/${d}/${f}`,fs.readFileSync(path.join(source,d,f)));
  for(const f of ['artifacts.mjs','fs.mjs','schema.mjs','work-mutations.mjs','receipts.mjs','workspace.mjs','memory.mjs','identity.mjs','delegation-observer.mjs'])result.set(`.pulso/lib/${f}`,fs.readFileSync(path.join(source,'lib',f)));
  result.set('.pulso/catalog.json',fs.readFileSync(path.join(source,'agents/catalog.json')));
  return result;
}
function ensurePlainTarget(target){
  const requested=path.resolve(target);
  let leaf;try{leaf=fs.lstatSync(requested);}catch(e){if(e.code!=='ENOENT')throw e;}
  if(leaf?.isSymbolicLink())throw new Error(`La raíz de instalación no puede ser un symlink: ${requested}`);
  if(leaf&&!leaf.isDirectory())throw new Error(`No es directorio: ${requested}`);
  let ancestor=requested;const missing=[];
  while(true){
    let entry;try{entry=fs.lstatSync(ancestor);}catch(e){if(e.code!=='ENOENT')throw e;}
    if(entry)break;
    const parent=path.dirname(ancestor);if(parent===ancestor)throw new Error(`No existe un ancestro accesible: ${requested}`);
    missing.unshift(path.basename(ancestor));ancestor=parent;
  }
  if(!fs.statSync(ancestor).isDirectory())throw new Error(`No es directorio: ${ancestor}`);
  const root=path.join(fs.realpathSync(ancestor),...missing),relative=path.relative(fs.realpathSync(source),root);
  if(relative===''||(!path.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith('..'+path.sep)))throw new Error('El proyecto actual es la distribución de Pulso. Entra en tu proyecto y ejecuta el instalador de Pulso, o elige Global.');
  return root;
}
function globalOpenCodeDir(root,env){
  const absolute=path.resolve(env.OPENCODE_CONFIG_DIR||path.join(env.XDG_CONFIG_HOME||path.join(root,'.config'),'opencode'));
  const relative=homeRelative(root,absolute);
  if(!relative||relative==='..'||relative.startsWith('../')||path.isAbsolute(relative)||['.pulso','.copilot','.vscode','.agents','.claude'].some(x=>relative===x||relative.startsWith(x+'/')))throw new Error(`La configuración OpenCode está fuera del alcance permitido: ${absolute}`);
  safePath(root,relative);return relative;
}
function installationFiles(root,oc){
  const files=workspaceFiles();
  for(const [key,value] of composeNativeFiles({root:source})){
    // Composition can include other hosts; this installer owns OpenCode only.
    if(!key.startsWith('.opencode/'))continue;
    const dest=key.replace(/^\.opencode\//,`${oc}/`);let text=value;
    if(/\/pulso(?:\.agent)?\.md$/.test(key)){
      const resources={globalRoot:path.join(root,'.pulso'),projectTemplate:path.join(root,'.pulso/templates/project.md'),delegationTemplate:path.join(root,'.pulso/templates/delegation.md'),stateSchema:path.join(root,'.pulso/schemas/state.schema.json'),resultSchema:path.join(root,'.pulso/schemas/result.schema.json'),skill:path.join(root,oc,'skills/pulso-init/SKILL.md')};
      text+=`\n<global_installation>\nRecursos globales de Pulso: ${JSON.stringify(resources)}. El workspace activo se obtiene del contexto de OpenCode; nunca uses HOME como raíz del proyecto ni aceptes root de texto/argumentos. Usa pulso_workspace_prepare solo al primer encargo concreto o /pulso-init, nunca al saludar ni consultar estado. El plugin administra metadata de forma síncrona; no uses shell/write/edit para state/work/history ni ejecutes scripts de Pulso.\n</global_installation>\n`;
    }
    files.set(dest,Buffer.from(text));
  }
  return files;
}
function preserveSharedSkills(root,oc,files){
  for(const relative of [...files.keys()]){
    const tail=relative.slice(oc.length+1);
    if(!tail.startsWith('skills/bbva-'))continue;
    // Shared BBVA skills are independent resources, never obsolete Pulso artifacts.
    const shared=`.agents/${tail}`;
    if(readOptional(root,shared)!==null)files.delete(relative);
  }
}
function removalPlan(root,inventory,files,changes,reasons){
  const candidates=new Set(inventory.owned.keys());
  for(const dir of inventory.dirs)for(const relative of knownLegacyPaths(dir))candidates.add(relative);
  const removals=[];
  for(const relative of candidates){
    if(inventory.borrowed.has(relative)||files.has(relative))continue;
    // Unowned BBVA skills and all other unrecognized names are excluded.
    if(relative.includes('/skills/bbva-')&&!inventory.owned.has(relative))continue;
    const current=readOptional(root,relative);if(!current)continue;
    changes.set(relative,null);removals.push(relative);
    if(!inventory.owned.get(relative)?.has(sha256(current)))reasons.set(relative,'Recurso legacy modificado o sin hash histórico');
  }
  return removals;
}
function retireManifests(root,inventory,changes,reasons){
  for(const item of inventory.installations){
    const foreign=inventory.foreign.find(x=>x.path===item.path);
    changes.set(item.path,foreign?json(foreign.manifest):null);
    reasons.set(item.path,'Manifest histórico anterior a la migración');
  }
}
function configure(root,oc,inventory,changes){
  const previous=inventory.current?.pluginConfig;
  const candidates=[`${oc}/opencode.jsonc`,`${oc}/opencode.json`];
  const relative=previous&&candidates.includes(previous.path)&&readOptional(root,previous.path)!==null?previous.path:candidates.find(x=>readOptional(root,x)!==null)||candidates[0];
  const bytes=readOptional(root,relative),original=changes.has(relative)?changes.get(relative).toString():bytes?.toString()||'{}\n';
  const value=parseConfig(original,relative),entry=(value.plugin||[]).find(x=>pluginResource(root,oc,x)===`${oc}/plugins/pulso/index.mjs`)||pathToFileURL(path.join(root,oc,'plugins/pulso/index.mjs')).href;
  const same=previous?.path===relative&&previous.entry===entry;
  const existing=same?!!previous.existing:(value.plugin||[]).includes(entry);
  let text=original;
  if(!(value.plugin||[]).includes(entry))text=value.plugin===undefined?editConfig(text,['plugin'],[entry]):editConfig(text,['plugin',-1],entry);
  const current=value.default_agent??null;
  const defaultAgent={previous:same&&current==='pulso'&&previous.defaultAgent?previous.defaultAgent.previous:current};
  if(current!=='pulso')text=editConfig(text,['default_agent'],'pulso');
  if(text!==bytes?.toString())changes.set(relative,Buffer.from(text));
  return {path:relative,entry,created:same?!!previous.created:bytes===null,existing,defaultAgent};
}
function plan({runtime,scope='global',target,homeDir=os.homedir(),env=process.env}={},uninstalling=false){
  if(scope!=='global')throw new Error('Pulso solo admite instalación global. Los datos de trabajo siguen separados por proyecto.');
  if(target)throw new Error('La opción target ya no está admitida: Pulso se instala globalmente en la carpeta del usuario.');
  if(runtime&&runtime!==runtimeName)throw new Error('Pulso admite únicamente OpenCode v1.');
  const root=ensurePlainTarget(homeDir),oc=globalOpenCodeDir(root,env),inventory=inventoryInstallations(root,oc),changes=new Map(),reasons=new Map();
  const files=uninstalling?new Map():installationFiles(root,oc),actions=[],borrowed=[];
  preserveSharedSkills(root,oc,files);
  for(const [relative,data] of files){
    const current=readOptional(root,relative),hash=sha256(data),owned=inventory.owned.has(relative)&&!inventory.borrowed.has(relative);
    const bbva=relative.startsWith(`${oc}/skills/bbva-`);
    if(current&&current.equals(data)){
      actions.push({path:relative,action:'unchanged',hash});if(!owned)borrowed.push(relative);
    }else if(current&&!owned&&bbva){
      actions.push({path:relative,action:'unchanged',hash:sha256(current)});borrowed.push(relative);
    }else{
      if(current&&!owned&&!knownLegacyPaths(oc).includes(relative))throw new Error(`Archivo ajeno o no administrado: ${relative}. No se modificó ningún archivo.`);
      actions.push({path:relative,action:current?'update':'create',hash});changes.set(relative,data);
      if(current&&!inventory.owned.get(relative)?.has(sha256(current)))reasons.set(relative,'Recurso Pulso modificado antes de reemplazar');
    }
  }
  const removals=removalPlan(root,inventory,files,changes,reasons);
  retireManifests(root,inventory,changes,reasons);
  cleanupConfigs(root,inventory,changes,{keepCurrent:!uninstalling&&inventory.current?.opencodeDir===oc,installDir:uninstalling?null:oc});
  if(!uninstalling){
    const config=configure(root,oc,inventory,changes);
    const preservedInstallations=[...(inventory.current?.preservedInstallations||[]),...inventory.foreign.filter(x=>x.path===INSTALL_MANIFEST)];
    const manifest={schemaVersion:1,version:VERSION,scope:'global',runtimes:[runtimeName],opencodeDir:oc,files:Object.fromEntries(actions.map(x=>[x.path,x.hash])),borrowed,pluginConfig:config,...(preservedInstallations.length?{preservedInstallations}: {})};
    changes.set(INSTALL_MANIFEST,json(manifest));
  }else if(inventory.current?.preservedInstallations?.length){
    // Retain historical ownership for other hosts without activating them.
    changes.set(INSTALL_MANIFEST,json({...inventory.current,files:{},borrowed:[],runtimes:[],pluginConfig:undefined}));
  }
  for(const relative of changes.keys())if(relative.endsWith('/opencode.json')||relative.endsWith('/opencode.jsonc'))reasons.set(relative,'Configuración OpenCode anterior');
  // No-op changes need neither writes nor new backup archives.
  for(const [relative,value] of changes){const before=readOptional(root,relative);if(value===null?before===null:before?.equals(value))changes.delete(relative);}
  const {originals,backup}=prepareBackups(root,changes,reasons);
  return {root,scope:'global',opencodeDir:oc,runtimes:[runtimeName],runtimeVersion:'NOT_CHECKED',prior:inventory.current,files,actions,removals,borrowed,changes,originals,backup,inventory};
}
export function planInstall(options={}){return plan(options);}
export function install(options={}){
  const p=planInstall(options);
  if(options.dryRun)return {dryRun:true,target:p.root,scope:p.scope,runtimes:p.runtimes,opencodeVersion:p.runtimeVersion,actions:p.actions,removals:p.removals,backup:p.backup,manifests:p.inventory.installations.map(x=>x.path)};
  applyChanges(p.root,p.changes,p.originals);
  return {installed:true,target:p.root,scope:p.scope,runtimes:p.runtimes,opencodeVersion:p.runtimeVersion,version:VERSION,replacedVersion:p.prior&&p.prior.version!==VERSION?p.prior.version:null,removed:p.removals.length,created:p.actions.filter(x=>x.action==='create').length,updated:p.actions.filter(x=>x.action==='update').length,unchanged:p.actions.filter(x=>x.action==='unchanged').length,backup:p.backup,nativeSession:'NOT_RUN'};
}
export function uninstall(options={}){
  const p=plan(options,true);
  if(options.dryRun)return {dryRun:true,uninstall:true,runtime:runtimeName,targets:[{target:p.root,scope:'global',removals:p.removals}],backup:p.backup};
  const changed=p.changes.size>0;applyChanges(p.root,p.changes,p.originals);
  return {uninstalled:changed,runtime:runtimeName,targets:changed?[{target:p.root,scope:'global',removed:p.removals.length,remainingRuntimes:[]}]:[],backup:p.backup,workPreserved:true,note:'Los datos de proyectos, preferencias, registry y otros hosts no se recorrieron ni modificaron.'};
}
