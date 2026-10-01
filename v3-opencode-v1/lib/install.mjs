import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {listFiles,safePath,sha256,readJSON,writeJSON,atomicWrite,exists} from './fs.mjs';
import {composeNativeFiles} from './composition.mjs';

const source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const VERSION='3.1.0';
const manifestPath='.pulso/installation.json';
const runtimeName='opencode-v1';
const skillNames=['bbva-engineering','bbva-apx','bbva-apx-testing','bbva-cells','bbva-cells-testing','pulso-init','pulso-status','pulso-resume','pulso-recap','pulso-integration-verification'];

// Files only: no agent processes, no host configuration changes, no registry.
function workspaceFiles(){
  const result=new Map();
  for(const d of ['templates','schemas','docs'])for(const f of listFiles(path.join(source,d)))
    result.set(`.pulso/${d}/${f}`,fs.readFileSync(path.join(source,d,f)));
  for(const f of ['artifacts.mjs','fs.mjs','schema.mjs','work-mutations.mjs','receipts.mjs','workspace.mjs','memory.mjs'])
    result.set(`.pulso/lib/${f}`,fs.readFileSync(path.join(source,'lib',f)));
  result.set('.pulso/catalog.json',fs.readFileSync(path.join(source,'agents/catalog.json')));
  return result;
}
function ensurePlainTarget(target){
  const requested=path.resolve(target);
  let leaf;
  try{leaf=fs.lstatSync(requested);}catch(e){if(e.code!=='ENOENT')throw e;}
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
  const root=path.join(fs.realpathSync(ancestor),...missing);
  const relative=path.relative(fs.realpathSync(source),root);
  if(relative===''||(!path.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith('..'+path.sep)))
    throw new Error('El proyecto actual es la distribución de Pulso. Entra en tu proyecto y ejecuta el instalador de Pulso, o elige Global.');
  return root;
}
function globalOpenCodeDir(root,env){
  const absolute=path.resolve(env.OPENCODE_CONFIG_DIR||path.join(env.XDG_CONFIG_HOME||path.join(root,'.config'),'opencode'));
  const relative=path.relative(root,absolute).split(path.sep).join('/');
  // Never broaden the deletion boundary to / merely to reach external config.
  if(!relative||relative==='..'||relative.startsWith('../')||path.isAbsolute(relative))
    throw new Error(`La configuración OpenCode está fuera de tu carpeta de usuario: ${absolute}. La instalación global no administra rutas externas. Usa una ubicación de configuración dentro de tu carpeta de usuario.`);
  safePath(root,relative);return relative;
}
function pluginConfigPath(oc){return `${oc}/opencode.jsonc`;}
function defaultAgent(source){return /"default_agent"\s*:\s*"([^"\\]*)"/.exec(source)?.[1]??null;}
function configureDefaultAgent(root,config,prior){
  const target=safePath(root,config.path),source=fs.readFileSync(target,'utf8'),current=defaultAgent(source),previous=prior?.previous??current;
  if(current==='pulso')return {...config,defaultAgent:{previous}};
  let next;
  if(current!==null)next=source.replace(/("default_agent"\s*:\s*")[^"\\]*(")/,'$1pulso$2');
  else {const end=source.lastIndexOf('}');if(end<0)throw new Error(`Configuración OpenCode inválida: ${target}`);const before=source.slice(0,end),body=before.slice(before.indexOf('{')+1).replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/.*$/gm,'').replace(/[\s,]/g,'');next=before+(body?',':'')+'\n  "default_agent": "pulso"\n}'+source.slice(end+1);}
  atomicWrite(root,config.path,next);return {...config,defaultAgent:{previous}};
}
function configurePlugin(root,oc){
  const relative=pluginConfigPath(oc),target=safePath(root,relative),entry=pathToFileURL(path.join(root,oc,'plugins/pulso/index.mjs')).href;
  if(!fs.existsSync(target)){
    atomicWrite(root,relative,`{\n  "plugin": ["${entry}"]\n}\n`);
    return {path:relative,entry,created:true};
  }
  const source=fs.readFileSync(target,'utf8');
  if(source.includes(entry))return {path:relative,entry,created:false,existing:true};
  let next;
  const plugins=/"plugin"\s*:\s*\[/.exec(source);
  if(plugins)next=source.slice(0,plugins.index+plugins[0].length)+`\n    "${entry}",`+source.slice(plugins.index+plugins[0].length);
  else {const end=source.lastIndexOf('}');if(end<0)throw new Error(`Configuración OpenCode inválida: ${target}`);const before=source.slice(0,end),body=before.slice(before.indexOf('{')+1).replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/.*$/gm,'').replace(/[\s,]/g,'');next=before+(body?',':'')+`\n  "plugin": ["${entry}"]\n}`+source.slice(end+1);}
  atomicWrite(root,relative,next);
  return {path:relative,entry,created:false};
}
function unconfigurePlugin(root,config){
  if(!config)return;
  const target=safePath(root,config.path);if(!fs.existsSync(target))return;
  let next=fs.readFileSync(target,'utf8');
  if(!config.existing){const entry=JSON.stringify(config.entry).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');next=next.replace(new RegExp(`\\s*,?\\s*${entry}\\s*,?`),'');}
  if(config.defaultAgent&&defaultAgent(next)==='pulso'){
    const previous=config.defaultAgent.previous;
    next=previous===null?next.replace(/\s*,?\s*"default_agent"\s*:\s*"pulso"\s*,?/,''):next.replace(/("default_agent"\s*:\s*")[^"\\]*(")/,`$1${previous}$2`);
  }
  if(config.created&&/^\{\s*"plugin"\s*:\s*\[\s*\]\s*\}\s*$/.test(next))fs.unlinkSync(target);else atomicWrite(root,config.path,next);
}
function nativeOwner(relative,opencodeDir){
  if(relative.startsWith(`${opencodeDir}/`)||relative.startsWith('.agents/skills/'))return runtimeName;
  if(relative.startsWith('.copilot/agents/'))return 'legacy-vscode';
  return null;
}
function permittedManagedPath(relative,oc){
  if(/^\.pulso\/(?:templates|schemas|lib|bin|docs)\/.+/.test(relative)||relative==='.pulso/catalog.json')return true;
  if(skillNames.some(n=>relative.startsWith(`.agents/skills/${n}/`)||relative.startsWith(`${oc}/skills/${n}/`)))return true;
  if(relative.startsWith(`${oc}/plugins/pulso/`))return true;
  if(relative.startsWith(`${oc}/agents/`)||relative.startsWith(`${oc}/commands/`)||relative.startsWith('.copilot/agents/'))
    return /^pulso(?:-[a-z0-9-]+)?(?:\.agent)?\.md$/.test(path.posix.basename(relative));
  return false;
}
function getPrior(root,oc){
  if(!exists(root,manifestPath))return null;
  const p=readJSON(root,manifestPath);
  if(p.schemaVersion!==1||!p.files||typeof p.files!=='object'||Array.isArray(p.files)||!Array.isArray(p.runtimes)||p.runtimes.some(x=>!['opencode','vscode','both','opencode-v2',runtimeName].includes(x))||typeof p.version!=='string')
    throw new Error(`Manifest de instalación no reconocido: ${path.join(root,manifestPath)}`);
  if(p.borrowed&&(!Array.isArray(p.borrowed)||p.borrowed.some(f=>!Object.hasOwn(p.files,f))))throw new Error('Manifest de archivos compartidos no reconocido');
  if(p.scope&&p.scope!=='global')throw new Error('Se encontró una instalación local anterior. Pulso ahora se instala solo globalmente; no se modificará esa instalación automáticamente.');
  const oldOC=p.opencodeDir||oc;
  safePath(root,oldOC);
  for(const [f,h] of Object.entries(p.files)){
    safePath(root,f);
    if(!permittedManagedPath(f,oldOC)||!/^([a-f0-9]{64})$/.test(h))
      throw new Error(`Entrada no administrable en manifest: ${f}. No se borrará ningún archivo.`);
  }
  return {...p,legacyRuntimes:p.runtimes,runtimes:[runtimeName]};
}
function assertKnownInstallation(root,prior){
  if(!prior&&exists(root,'.pulso')&&fs.readdirSync(safePath(root,'.pulso')).length)
    throw new Error(`Existe .pulso sin manifest reconocido en ${root}. No se pueden identificar con seguridad sus archivos (por ejemplo, v2). Conserva esa carpeta y retira su integración antigua antes de instalar. No se borraron datos.`);
}
function installationFiles(root,runtimes,oc){
  const files=workspaceFiles();
  for(const [key,value] of composeNativeFiles({root:source})){
    const dest=key.replace(/^\.opencode\//,`${oc}/`);
    let text=value;
    if(/\/pulso(?:\.agent)?\.md$/.test(key)){
      const resources={globalRoot:path.join(root,'.pulso'),projectTemplate:path.join(root,'.pulso/templates/project.md'),delegationTemplate:path.join(root,'.pulso/templates/delegation.md'),stateSchema:path.join(root,'.pulso/schemas/state.schema.json'),resultSchema:path.join(root,'.pulso/schemas/result.schema.json'),skill:path.join(root,oc,'skills/pulso-init/SKILL.md')};
      text+=`\n<global_installation>\nRecursos globales de Pulso: ${JSON.stringify(resources)}. El workspace activo se obtiene del contexto de OpenCode; nunca uses HOME como raíz del proyecto ni aceptes root de texto/argumentos. Usa pulso_workspace_prepare solo al primer encargo concreto o /pulso-init, nunca al saludar ni consultar estado. El plugin administra metadata de forma síncrona; no uses shell/write/edit para state/work/history ni ejecutes scripts de Pulso.\n</global_installation>\n`;
    }
    files.set(dest,text);
  }
  return files;
}
function checkFiles(root,files,prior){
  const actions=[],conflicts=[];
  for(const [relative,data] of files){
    const dest=safePath(root,relative),hash=sha256(data);
    if(fs.existsSync(dest)){
      if(!fs.statSync(dest).isFile()){conflicts.push(`${relative}: no es archivo`);continue;}
      const current=sha256(fs.readFileSync(dest));
      if(current===hash)actions.push({path:relative,action:'unchanged',hash});
      else if(prior?.files?.[relative]===current&&!prior?.borrowed?.includes(relative))actions.push({path:relative,action:'update',hash});
      else conflicts.push(`${relative}: archivo ajeno o modificado. Renómbralo o conserva tus cambios antes de instalar.`);
    }else actions.push({path:relative,action:'create',hash});
  }
  return {actions,conflicts};
}
function assertNoUnregisteredAgents(root,oc,runtimes,prior,expected=new Map()){
  const dirs=[];
  if(runtimes.includes(runtimeName))dirs.push(`${oc}/agents`,`${oc}/commands`,`${oc}/plugins`,`${oc}/skills`);
  if(runtimes.includes('legacy-vscode'))dirs.push('.copilot/agents');
  for(const dir of dirs){
    if(!exists(root,dir))continue;
    for(const name of fs.readdirSync(safePath(root,dir))){
      const f=`${dir}/${name}`;
      if(/^pulso(?:-[a-z0-9-]+)?(?:\.agent)?\.md$/.test(name)&&!prior?.files?.[f]&&!expected.has(f))
        throw new Error(`Integración anterior no registrada: ${path.join(root,f)}. No se puede comprobar su propiedad; conserva o retira ese archivo antes de continuar. No se borró nada.`);
    }
  }
  if(runtimes.includes(runtimeName)){
    const plugin=`${oc}/plugins/pulso`;
    if(exists(root,plugin))for(const relative of listFiles(safePath(root,plugin),plugin))
      if(!prior?.files?.[relative]&&!expected.has(relative))throw new Error(`Colisión con plugin no administrado: ${path.join(root,relative)}. No se modificó ningún archivo.`);
  }
}
function checkRemovals(root,files,prior){
  for(const file of files){
    const dest=safePath(root,file);
    if(fs.existsSync(dest)&&(!fs.statSync(dest).isFile()||sha256(fs.readFileSync(dest))!==prior.files[file]))
      throw new Error(`Archivo de Pulso modificado: ${dest}. No se borró nada. Conserva tu edición fuera de esta ruta o restáurala antes de continuar.`);
  }
}
export function planInstall({runtime,scope='global',target,homeDir=os.homedir(),env=process.env}={}){
  if(scope!=='global')throw new Error('Pulso solo admite instalación global. Los datos de trabajo siguen separados por proyecto.');
  if(target)throw new Error('La opción target ya no está admitida: Pulso se instala globalmente en la carpeta del usuario.');
  if(runtime&&runtime!==runtimeName)throw new Error('Pulso admite únicamente OpenCode v1.');
  const runtimeVersion='NOT_CHECKED';
  const root=ensurePlainTarget(homeDir);
  const prior=getPrior(root,'.config/opencode');assertKnownInstallation(root,prior);
  const requested=[runtimeName];
  const oc=globalOpenCodeDir(root,env);
  const runtimes=[runtimeName];
  const files=installationFiles(root,runtimes,oc);
  const {actions,conflicts}=checkFiles(root,files,prior);
  assertNoUnregisteredAgents(root,oc,requested,prior,files);
  for(const name of skillNames)for(const dir of ['.copilot/skills','.claude/skills','.agents/skills']){
    const p=`${dir}/${name}/SKILL.md`;
    if(exists(root,p)&&!prior?.files?.[p])conflicts.push(`Skill duplicada ${p}; conserva una única ubicación antes de instalar.`);
  }
  if(conflicts.length)throw new Error(`Instalación cancelada antes de escribir:\n${conflicts.join('\n')}`);
  const replacing=!!prior&&prior.version!==VERSION;
  const borrowed=actions.filter(a=>a.action==='unchanged'&&(!prior?.files?.[a.path]||prior?.borrowed?.includes(a.path))).map(a=>a.path);
  const removals=Object.keys(prior?.files||{}).filter(f=>!prior?.borrowed?.includes(f)&&(!files.has(f)||(replacing&&(!nativeOwner(f,prior.opencodeDir||oc)||requested.includes(nativeOwner(f,prior.opencodeDir||oc))))));
  checkRemovals(root,removals,prior);
  return {root,scope:'global',opencodeDir:oc,runtimes,runtimeVersion,prior,files,actions,removals,replacing,borrowed};
}
// In-memory rollback of owned files. This is not a persistent transaction engine.
function applyFiles(root,files,actions,removals,prior,finish){
  const undo=new Map();
  const remember=f=>{if(!undo.has(f)){const p=safePath(root,f);undo.set(f,fs.existsSync(p)?fs.readFileSync(p):null);}};
  fs.mkdirSync(root,{recursive:true});
  try{
    checkRemovals(root,removals,prior);
    for(const f of removals){remember(f);const p=safePath(root,f);if(fs.existsSync(p))fs.unlinkSync(p);}
    for(const a of actions){
      if(a.action==='unchanged'&&!removals.includes(a.path))continue;
      const p=safePath(root,a.path),original=fs.existsSync(p)?fs.readFileSync(p):null;
      if(original&&sha256(original)!==a.hash&&sha256(original)!==prior?.files?.[a.path])throw new Error(`Archivo cambió durante instalación: ${a.path}`);
      remember(a.path);atomicWrite(root,a.path,files.get(a.path));
    }
    remember(manifestPath);finish();
  }catch(e){
    const rollbackErrors=[];
    for(const [f,original] of [...undo].reverse())try{
      if(original===null){const p=safePath(root,f);if(fs.existsSync(p))fs.unlinkSync(p);}
      else atomicWrite(root,f,original);
    }catch(error){rollbackErrors.push(`${f}: ${error.message}`);}
    throw new Error(`Operación no completada; ${rollbackErrors.length?'hay archivos que no se pudieron restaurar: '+rollbackErrors.join('; '):'archivos gestionados restaurados'}. ${e.message}`,{cause:e});
  }
}
export function install(options={}){
  const p=planInstall(options);
  if(options.dryRun)return {dryRun:true,target:p.root,scope:p.scope,runtimes:p.runtimes,opencodeVersion:p.runtimeVersion,actions:p.actions,removals:p.removals};
  const config=configureDefaultAgent(p.root,configurePlugin(p.root,p.opencodeDir),p.prior?.pluginConfig?.defaultAgent);
  const manifest={schemaVersion:1,version:VERSION,scope:'global',runtimes:p.runtimes,opencodeDir:p.opencodeDir,files:Object.fromEntries(p.actions.map(x=>[x.path,x.hash])),borrowed:p.borrowed,pluginConfig:config};
  applyFiles(p.root,p.files,p.actions,p.removals,p.prior,()=>{
    writeJSON(p.root,manifestPath,manifest);
  });
  return {installed:true,target:p.root,scope:p.scope,runtimes:p.runtimes,opencodeVersion:p.runtimeVersion,version:VERSION,replacedVersion:p.replacing?p.prior.version:null,removed:p.removals.length,created:p.actions.filter(x=>x.action==='create').length,updated:p.actions.filter(x=>x.action==='update').length,unchanged:p.actions.filter(x=>x.action==='unchanged').length,nativeSession:'NOT_RUN'};
}

export function uninstall({runtime,homeDir=os.homedir(),env=process.env,dryRun=false}={}){
  if(runtime&&runtime!==runtimeName)throw new Error('Pulso admite únicamente OpenCode v1.');
  runtime=runtimeName;
  if(!fs.existsSync(path.join(homeDir,manifestPath)))return {uninstalled:false,runtime,targets:[],workPreserved:true,note:'No se encontró una instalación global registrada de ese runtime. No se eliminó nada.'};
  const root=ensurePlainTarget(homeDir),raw=readJSON(root,manifestPath),oc=raw.opencodeDir||globalOpenCodeDir(root,env);
  const prior=getPrior(root,oc);assertNoUnregisteredAgents(root,oc,[runtime],prior);
  if(!prior.runtimes.includes(runtime))return {uninstalled:false,runtime,targets:[],workPreserved:true,note:'El runtime no está registrado en la instalación global. No se eliminó nada.'};
  const remaining=prior.runtimes.filter(x=>x!==runtime);
  const removals=Object.keys(prior.files).filter(f=>!prior.borrowed?.includes(f)&&(!remaining.length||nativeOwner(f,oc)===runtime));
  checkRemovals(root,removals,prior);
  if(dryRun)return {dryRun:true,uninstall:true,runtime,targets:[{target:root,scope:'global',removals}],pluginConfig:prior.pluginConfig};
  const files=Object.fromEntries(Object.entries(prior.files).filter(([f])=>!removals.includes(f)));
  applyFiles(root,new Map(),[],removals,prior,()=>{
    if(remaining.length)writeJSON(root,manifestPath,{...prior,runtimes:remaining,files});
    else fs.unlinkSync(safePath(root,manifestPath));
  });
  unconfigurePlugin(root,prior.pluginConfig);
  return {uninstalled:true,runtime,targets:[{target:root,scope:'global',removed:removals.length,remainingRuntimes:remaining}],workPreserved:true,note:'La instalación global fue actualizada. Los datos de los proyectos no se recorrieron ni modificaron.'};
}
