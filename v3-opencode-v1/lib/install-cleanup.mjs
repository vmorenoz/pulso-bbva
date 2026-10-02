import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {safePath,sha256,atomicWrite} from './fs.mjs';
import {parseConfig,editConfig,removePlugins} from './install-jsonc.mjs';

export const INSTALL_MANIFEST='.pulso/installation.json';
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const digest=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const legacyPlugins=['pulso-circuit-breaker.mjs','pulso-experience-engine.mjs','pulso-codegraph.mjs','pulso-protocol-guard.js'];
const legacyFiles=[
  ...legacyPlugins.map(x=>`plugins/${x}`),
  ...['doctor','dashboard','lease','artifacts','route','skill_digest','agent_contacts','identity','models'].map(x=>`tools/pulso_${x}.ts`),
  ...['circuit-breaker-core','control-core','dashboard-core','experience-core','file-state','agent-contacts','identity','vscode-codegraph','jsonc','lease-core','contract-core','ownership-core'].map(x=>`lib/pulso-${x}.js`),
  ...['breaker','codegraph-mcp','dashboard','lease'].map(x=>`bin/pulso-${x}.js`),
];
const legacyAgents=['pulso','pulso-planner','pulso-challenger','pulso-contact-manager','pulso-config-manager','pulso-executor','pulso-explorer','pulso-verifier','pulso-integration-auditor','pulso-security-auditor','pulso-ui-auditor','pulso-experience-curator','pulso-delivery-reporter','pulso-code-auditor'];
const legacyCommands=['pulso-dashboard','pulso-doctor','pulso-autointegrate','pulso-configure'];
const legacySkills=['pulso-protocol','pulso-adaptive-orchestration','pulso-evidence-inventory','pulso-executable-plans','pulso-human-delivery','pulso-parallel-work','pulso-preferences-capabilities','pulso-quality-review','pulso-safe-recovery'];

export function readOptional(root,relative){
  const target=safePath(root,relative);
  try{if(!fs.statSync(target).isFile())throw new Error(`No es archivo: ${relative}`);return fs.readFileSync(target);}
  catch(e){if(e.code==='ENOENT')return null;throw e;}
}
export function homeRelative(root,value,base=''){
  if(typeof value!=='string')throw new Error('Ruta de manifest inválida');
  let absolute=value;
  if(path.isAbsolute(value)&&path.relative(root,value).startsWith('..')){
    // macOS /var and /private/var may name the same home. Resolve only the
    // ancestor alias; retain every descendant so safePath still rejects links.
    let ancestor=path.dirname(value);
    while(ancestor!==path.dirname(ancestor)){
      try{if(fs.realpathSync(ancestor)===root){absolute=path.join(root,path.relative(ancestor,value));break;}}catch(e){if(e.code!=='ENOENT')throw e;}
      ancestor=path.dirname(ancestor);
    }
  }
  const relative=path.isAbsolute(value)?path.relative(root,absolute).split(path.sep).join('/'):base?`${base}/${value}`:value;
  safePath(root,relative);return relative;
}
const relativePath=homeRelative;
function openCodeDir(root,value){
  const relative=relativePath(root,value);
  // The final directory name cannot authorize cleanup inside data/other hosts.
  if(['.pulso','.copilot','.vscode','.agents','.claude'].some(dir=>relative===dir||relative.startsWith(dir+'/')))throw new Error(`Directorio OpenCode inválido: ${relative}`);
  return relative;
}
const nativePath=(relative,oc)=>relative.startsWith(`${oc}/`)&&/^(agents|commands|skills|plugins|lib|bin|tools)\/.+/.test(relative.slice(oc.length+1));
const corePath=relative=>/^\.pulso\/(templates|schemas|lib|bin|docs)\/.+/.test(relative)||relative==='.pulso/catalog.json';

/** Inventory only explicit historical global OpenCode manifests; never project registries. */
export function inventoryInstallations(root,oc){
  const installations=[],dirs=new Set([oc,'.config/opencode']);
  const current=readOptional(root,INSTALL_MANIFEST);
  if(current){
    const value=JSON.parse(current);
    if(value.schemaVersion!==1||!record(value.files)||!Array.isArray(value.runtimes)||typeof value.version!=='string'||value.scope&&value.scope!=='global'||value.runtimes.some(x=>!['opencode','opencode-v2','opencode-v1','vscode','both'].includes(x)))throw new Error('Manifest de instalación no reconocido');
    if(value.borrowed&&(!Array.isArray(value.borrowed)||value.borrowed.some(x=>!Object.hasOwn(value.files,x))))throw new Error('Ownership compartido inválido');
    const oldOC=openCodeDir(root,value.opencodeDir||'.config/opencode');dirs.add(oldOC);
    if(value.pluginConfig){
      const config=value.pluginConfig;
      if(!record(config)||![`${oldOC}/opencode.json`,`${oldOC}/opencode.jsonc`].includes(config.path)||typeof config.entry!=='string'||pluginResource(root,oldOC,config.entry)!==`${oldOC}/plugins/pulso/index.mjs`||config.defaultAgent&&(!record(config.defaultAgent)||config.defaultAgent.previous!==null&&typeof config.defaultAgent.previous!=='string'))throw new Error('Ownership de configuración no reconocido');
    }
    if(value.preservedInstallations&&!Array.isArray(value.preservedInstallations))throw new Error('Ownership histórico no reconocido');
    installations.push({path:INSTALL_MANIFEST,value,base:'',oc:oldOC,format:'v3'});
  }
  for(const dir of dirs){
    for(const name of ['.pulso-install.json','.pulso-manifest.json','pulso-profile.json']){
      const relative=`${dir}/${name}`,bytes=readOptional(root,relative);if(!bytes)continue;
      const value=JSON.parse(bytes);
      if(name==='pulso-profile.json'){
        if(value.managed_by!=='pulso')continue;
        installations.push({path:relative,value,base:dir,oc:dir,format:'profile'});continue;
      }
      const valid=name==='.pulso-install.json'?value.schema_version===1&&value.managed_by==='pulso':Number.isInteger(value.version)&&value.version>=1&&value.version<=5&&value.runtime==='opencode'&&value.scope==='global'&&record(value.configEntries);
      if(!valid||!record(value.files))throw new Error(`Manifest histórico no reconocido: ${relative}`);
      installations.push({path:relative,value,base:dir,oc:dir,format:name==='.pulso-install.json'?'v1':'v2'});
    }
  }
  const owned=new Map(),borrowed=new Set(),foreign=[];
  for(const item of installations){
    const kept={};
    for(const [file,hash] of Object.entries(item.value.files||{})){
      if(!digest(hash))throw new Error(`Hash de manifest inválido: ${item.path}#${file}`);
      const relative=relativePath(root,file,item.base);
      if(item.format==='v3'&&item.value.borrowed?.includes(file)){borrowed.add(relative);continue;}
      if(nativePath(relative,item.oc)||(item.format==='v3'&&corePath(relative))){
        if(!owned.has(relative))owned.set(relative,new Set());owned.get(relative).add(hash);
      }else kept[file]=hash;
    }
    if(Object.keys(kept).length)foreign.push({path:item.path,manifest:{...item.value,files:kept}});
  }
  return {installations,dirs:[...dirs],owned,borrowed,foreign,current:installations.find(x=>x.format==='v3')?.value||null};
}

/** Exact catalog fallback for pre-manifest leftovers. No prefix or directory glob deletion. */
export function knownLegacyPaths(oc){
  return [...legacyFiles,...legacyAgents.map(x=>`agents/${x}.md`),...legacyCommands.map(x=>`commands/${x}.md`),...legacySkills.map(x=>`skills/${x}/SKILL.md`)].map(x=>`${oc}/${x}`);
}
function pluginEntries(root,dir){
  return new Set([...legacyPlugins.map(x=>`plugins/${x}`),'plugins/pulso/index.mjs'].flatMap(x=>[`./${x}`,path.join(root,dir,x),pathToFileURL(path.join(root,dir,x)).href]));
}
export function pluginResource(root,dir,entry){
  try{
    if(entry.startsWith('file:'))return homeRelative(root,fileURLToPath(entry));
    if(path.isAbsolute(entry))return homeRelative(root,entry);
    if(entry.startsWith('./'))return homeRelative(root,entry.slice(2),dir);
  }catch{return null;}
  return null;
}

export function cleanupConfigs(root,inventory,changes,{keepCurrent=false,installDir=null}={}){
  for(const dir of inventory.dirs)for(const name of ['opencode.json','opencode.jsonc']){
    const relative=`${dir}/${name}`,bytes=readOptional(root,relative);if(!bytes)continue;
    let text=bytes.toString('utf8');const entries=pluginEntries(root,dir);
    const ownedConfig=inventory.current?.pluginConfig;
    if(dir===installDir)entries.delete(pathToFileURL(path.join(root,dir,'plugins/pulso/index.mjs')).href);
    if(keepCurrent&&ownedConfig?.path===relative)entries.delete(ownedConfig.entry);
    // An entry that predated our installation remains borrowed on uninstall.
    if(ownedConfig?.existing&&ownedConfig.path===relative)entries.delete(ownedConfig.entry);
    text=removePlugins(text,x=>{
      const resource=pluginResource(root,dir,x);
      if(resource===`${dir}/plugins/pulso/index.mjs`&&(dir===installDir||keepCurrent&&ownedConfig?.path===relative||ownedConfig?.existing&&ownedConfig.path===relative))return false;
      return entries.has(x)||resource&&[...legacyPlugins.map(name=>`${dir}/plugins/${name}`),`${dir}/plugins/pulso/index.mjs`].includes(resource);
    });
    for(const item of inventory.installations.filter(x=>x.format==='v2')){
      for(const [key,hash] of Object.entries(item.value.configEntries)){
        const split=key.lastIndexOf('#'),location=split<0?key:key.slice(0,split),field=split<0?(item.value.version===1?'mcp.pulso':'plugin'):key.slice(split+1);
        const configPath=relativePath(root,location,item.base);
        if(configPath!==relative||field!=='mcp.pulso')continue;
        if(!digest(hash))throw new Error('Hash de configuración inválido');
        const mcp=parseConfig(text).mcp?.pulso;
        if(mcp!==undefined&&sha256(JSON.stringify(mcp))===hash)text=editConfig(text,['mcp','pulso'],undefined);
      }
    }
    if(!keepCurrent&&ownedConfig?.path===relative&&ownedConfig.defaultAgent&&parseConfig(text).default_agent==='pulso')text=editConfig(text,['default_agent'],ownedConfig.defaultAgent.previous??undefined);
    parseConfig(text,relative);
    if(text!==bytes.toString('utf8'))changes.set(relative,Buffer.from(text));
  }
}

/** One transaction for configs, resources, manifests and recoverable backups. */
export function applyChanges(root,changes,originals){
  const undo=new Map(),createdDirs=new Set();
  const noteDirs=relative=>{
    let dir=path.dirname(safePath(root,relative));
    while(!fs.existsSync(dir)){createdDirs.add(dir);const parent=path.dirname(dir);if(parent===dir)break;dir=parent;}
  };
  for(const [relative] of changes){
    const current=readOptional(root,relative),expected=originals.get(relative)??null;
    if((current===null)!==(expected===null)||current&&!current.equals(expected))throw new Error(`Archivo cambió durante instalación: ${relative}`);
  }
  try{
    for(const [relative,value] of changes){
      const original=originals.get(relative)??null,target=safePath(root,relative);
      undo.set(relative,{bytes:original,mode:original===null?null:fs.statSync(target).mode});
      if(value===null){if(original!==null)fs.unlinkSync(target);}
      else{noteDirs(relative);atomicWrite(root,relative,value);if(original!==null)fs.chmodSync(target,undo.get(relative).mode);}
    }
  }catch(error){
    const failures=[];
    for(const [relative,original] of [...undo].reverse())try{
      const target=safePath(root,relative);
      if(original.bytes===null){if(fs.existsSync(target))fs.unlinkSync(target);}
      else{atomicWrite(root,relative,original.bytes);fs.chmodSync(target,original.mode);}
    }catch(e){failures.push(`${relative}: ${e.message}`);}
    for(const dir of [...createdDirs].sort((a,b)=>b.length-a.length))try{fs.rmdirSync(dir);}catch(e){if(!['ENOENT','ENOTEMPTY'].includes(e.code))failures.push(`${dir}: ${e.message}`);}
    throw new Error(`Operación no completada; ${failures.length?'rollback incompleto: '+failures.join('; '):'archivos gestionados restaurados'}. ${error.message}`,{cause:error});
  }
}

export function prepareBackups(root,changes,reasons){
  const originals=new Map(),backups=[];
  for(const [relative,value] of changes){
    const bytes=readOptional(root,relative);originals.set(relative,bytes);
    if(bytes&&reasons.has(relative)&&(!value||!bytes.equals(value)))backups.push({path:relative,sha256:sha256(bytes),mode:fs.statSync(safePath(root,relative)).mode&0o777,reason:reasons.get(relative),bytes});
  }
  let backup=null;
  if(backups.length){
    backup=`.pulso/backups/opencode-${randomUUID()}`;
    for(const item of backups){const relative=`${backup}/files/${item.path}`;changes.set(relative,item.bytes);originals.set(relative,null);}
    const receipt=`${backup}/index.json`;
    changes.set(receipt,Buffer.from(JSON.stringify({schemaVersion:1,files:backups.map(({bytes,...item})=>({...item,backup:`files/${item.path}`}))},null,2)+'\n'));originals.set(receipt,null);
    // Backups must be durable before any removal or overwrite.
    const ordered=[...changes].sort(([a],[b])=>Number(b.startsWith(backup+'/'))-Number(a.startsWith(backup+'/')));
    changes.clear();for(const [key,value] of ordered)changes.set(key,value);
  }
  return {originals,backup};
}
