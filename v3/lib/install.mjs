import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {listFiles,safePath,sha256,readJSON,writeJSON,atomicWrite,exists} from './fs.mjs';
import {initArtifacts,status as workspaceStatus} from './artifacts.mjs';
import {composeNativeFiles} from './composition.mjs';

const source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const VERSION='3.0.4';
const manifestPath='.pulso/installation.json';
const runtimeNames=['opencode','vscode'];
const skillNames=['bbva-engineering','bbva-apx','bbva-apx-testing','bbva-cells','bbva-cells-testing','pulso-init','pulso-status','pulso-resume','pulso-recap','pulso-integration-verification'];

// Files only: no agent processes, no host configuration changes, no registry.
function workspaceFiles(){
  const result=new Map();
  for(const d of ['templates','schemas','lib','bin','docs'])for(const f of listFiles(path.join(source,d)))
    result.set(`.pulso/${d}/${f}`,fs.readFileSync(path.join(source,d,f)));
  result.delete('.pulso/lib/terminal.mjs');
  const catalog=fs.existsSync(path.join(source,'agents/catalog.json'))?'agents/catalog.json':'catalog.json';
  result.set('.pulso/catalog.json',fs.readFileSync(path.join(source,catalog)));
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
    throw new Error('El proyecto actual es la distribución de Pulso. Entra en tu proyecto y ejecuta node /ruta/pulso-v3/install.mjs, o elige Global.');
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
function nativeOwner(relative,opencodeDir){
  if(relative.startsWith(`${opencodeDir}/`))return 'opencode';
  if(relative.startsWith('.copilot/agents/'))return 'vscode';
  return null;
}
function permittedManagedPath(relative,oc){
  if(/^\.pulso\/(?:templates|schemas|lib|bin|docs)\/.+/.test(relative)||relative==='.pulso/catalog.json')return true;
  if(skillNames.some(n=>relative.startsWith(`.agents/skills/${n}/`)))return true;
  if(relative.startsWith(`${oc}/agents/`)||relative.startsWith(`${oc}/commands/`)||relative.startsWith('.copilot/agents/'))
    return /^pulso(?:-[a-z0-9-]+)?(?:\.agent)?\.md$/.test(path.posix.basename(relative));
  return false;
}
function getPrior(root,oc){
  if(!exists(root,manifestPath))return null;
  const p=readJSON(root,manifestPath);
  if(p.schemaVersion!==1||!p.files||typeof p.files!=='object'||Array.isArray(p.files)||!Array.isArray(p.runtimes)||p.runtimes.some(x=>!runtimeNames.includes(x))||typeof p.version!=='string')
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
  return p;
}
function assertKnownInstallation(root,prior){
  if(!prior&&exists(root,'.pulso')&&fs.readdirSync(safePath(root,'.pulso')).length)
    throw new Error(`Existe .pulso sin manifest reconocido en ${root}. No se pueden identificar con seguridad sus archivos (por ejemplo, v2). Conserva esa carpeta y retira su integración antigua antes de instalar. No se borraron datos.`);
}
function installationFiles(root,runtimes,oc){
  const files=workspaceFiles();
  for(const f of listFiles(path.join(source,'skills')))files.set(`.agents/skills/${f}`,fs.readFileSync(path.join(source,'skills',f)));
  const runtime=runtimes.length===2?'both':runtimes[0];
  for(const [key,value] of composeNativeFiles({root:source,runtime,vscodeHarness:'copilot'})){
    const dest=key.replace(/^\.opencode\//,`${oc}/`).replace(/^\.github\/agents\//,'.copilot/agents/');
    let text=value;
    if(/\/pulso(?:\.agent)?\.md$/.test(key)){
      const args=[path.join(root,'.pulso/bin/prepare.mjs').split(path.sep).join('/'),'--root','<raíz real del proyecto activo>'];
      const resources={prepare:path.join(root,'.pulso/bin/prepare.mjs'),cli:path.join(root,'.pulso/bin/pulso.mjs'),projectTemplate:path.join(root,'.pulso/templates/project.md'),delegationTemplate:path.join(root,'.pulso/templates/delegation.md'),stateSchema:path.join(root,'.pulso/schemas/state.schema.json'),resultSchema:path.join(root,'.pulso/schemas/result.schema.json'),skill:path.join(root,'.agents/skills/pulso-init/SKILL.md')};
      text+=`\n<global_installation>\nEsta definición y sus recursos son globales: ${JSON.stringify(resources)}. La carpeta ${JSON.stringify(path.join(root,'.pulso'))} contiene utilidades, no estado de proyecto. Todo state/work/history/project pertenece a la raíz real del workspace activo. No busques bin/templates/schemas/agentes/skills dentro del proyecto.\nUn saludo o charla no inicializa. Solo al primer encargo concreto o /pulso-init aplica la receta global indicada. Pasa al especialista la raíz real del proyecto y estas rutas observadas. El Explorador inspecciona compatibilidad; si el workspace es nuevo, delega al Ejecutor el helper con ejecutable node y argumentos literales ${JSON.stringify(args)}. Tú no ejecutas prepare ni haces el mapeo. No uses HOME como proyecto, no migres legacy y no ejecutes runtimes desde shell. Las consultas de estado/historial no inicializan.\nPara metadatos usa el CLI global con --root apuntando al workspace. Plantillas y schemas de delegación son globales; outputs y datos siguen bajo el workspace.\n</global_installation>\n`;
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
  if(runtimes.includes('opencode'))dirs.push(`${oc}/agents`,`${oc}/commands`);
  if(runtimes.includes('vscode'))dirs.push('.copilot/agents');
  for(const dir of dirs){
    if(!exists(root,dir))continue;
    for(const name of fs.readdirSync(safePath(root,dir))){
      const f=`${dir}/${name}`;
      if(/^pulso(?:-[a-z0-9-]+)?(?:\.agent)?\.md$/.test(name)&&!prior?.files?.[f]&&!expected.has(f))
        throw new Error(`Integración anterior no registrada: ${path.join(root,f)}. No se puede comprobar su propiedad; conserva o retira ese archivo antes de continuar. No se borró nada.`);
    }
  }
}
function checkRemovals(root,files,prior){
  for(const file of files){
    const dest=safePath(root,file);
    if(fs.existsSync(dest)&&(!fs.statSync(dest).isFile()||sha256(fs.readFileSync(dest))!==prior.files[file]))
      throw new Error(`Archivo de Pulso modificado: ${dest}. No se borró nada. Conserva tu edición fuera de esta ruta o restáurala antes de continuar.`);
  }
}
export function planInstall({runtime,scope='global',target,vscodeHarness,homeDir=os.homedir(),env=process.env}){
  if(scope!=='global')throw new Error('Pulso solo admite instalación global. Los datos de trabajo siguen separados por proyecto.');
  if(target)throw new Error('La opción target ya no está admitida: Pulso se instala globalmente en la carpeta del usuario.');
  if(vscodeHarness&&vscodeHarness!=='copilot')throw new Error('La instalación global de Visual Studio Code usa Copilot Agent Host.');
  if(!['opencode','vscode','both'].includes(runtime))throw new Error('Runtime: opencode, vscode o both');
  const root=ensurePlainTarget(homeDir);
  const prior=getPrior(root,'.config/opencode');assertKnownInstallation(root,prior);
  const requested=runtime==='both'?runtimeNames:[runtime];
  const oc=requested.includes('opencode')?globalOpenCodeDir(root,env):(prior?.opencodeDir||'.config/opencode');
  const runtimes=[...new Set([...(prior?.runtimes||[]),...requested])].sort();
  const files=installationFiles(root,runtimes,oc);
  const {actions,conflicts}=checkFiles(root,files,prior);
  assertNoUnregisteredAgents(root,prior?.opencodeDir||oc,requested,prior,files);
  for(const name of skillNames)for(const dir of ['.copilot/skills',`${oc}/skills`,'.claude/skills']){
    const p=`${dir}/${name}/SKILL.md`;
    if(exists(root,p))conflicts.push(`Skill duplicada ${p}; conserva una única ubicación antes de instalar.`);
  }
  if(conflicts.length)throw new Error(`Instalación cancelada antes de escribir:\n${conflicts.join('\n')}`);
  const replacing=!!prior&&prior.version!==VERSION;
  const borrowed=actions.filter(a=>a.action==='unchanged'&&(!prior?.files?.[a.path]||prior?.borrowed?.includes(a.path))).map(a=>a.path);
  const removals=Object.keys(prior?.files||{}).filter(f=>!prior?.borrowed?.includes(f)&&(!files.has(f)||(replacing&&(!nativeOwner(f,prior.opencodeDir||oc)||requested.includes(nativeOwner(f,prior.opencodeDir||oc))))));
  checkRemovals(root,removals,prior);
  return {root,scope:'global',opencodeDir:oc,runtimes,vscodeHarness:'copilot',prior,files,actions,removals,replacing,borrowed};
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
function seed(root){
  initArtifacts(root);
  if(!exists(root,'.pulso/project.md'))atomicWrite(root,'.pulso/project.md','# Proyecto\n\nContexto todavía no levantado. Usa la plantilla global proporcionada por Pulso y evidencia del repositorio.\n');
  if(!exists(root,'.pulso/decisions.md'))atomicWrite(root,'.pulso/decisions.md','# Índice de decisiones\n\nSin decisiones registradas. Añadir referencias; no inventar aprobaciones.\n');
}
export function install(options){
  const p=planInstall(options);
  if(options.dryRun)return {dryRun:true,target:p.root,scope:p.scope,runtimes:p.runtimes,vscodeHarness:p.vscodeHarness,actions:p.actions,removals:p.removals};
  const manifest={schemaVersion:1,version:VERSION,scope:'global',runtimes:p.runtimes,vscodeHarness:'copilot',opencodeDir:p.opencodeDir,files:Object.fromEntries(p.actions.map(x=>[x.path,x.hash])),borrowed:p.borrowed};
  applyFiles(p.root,p.files,p.actions,p.removals,p.prior,()=>{
    writeJSON(p.root,manifestPath,manifest);
  });
  return {installed:true,target:p.root,scope:p.scope,runtimes:p.runtimes,vscodeHarness:p.vscodeHarness,version:VERSION,replacedVersion:p.replacing?p.prior.version:null,removed:p.removals.length,created:p.actions.filter(x=>x.action==='create').length,updated:p.actions.filter(x=>x.action==='update').length,unchanged:p.actions.filter(x=>x.action==='unchanged').length,nativeSession:'NOT_RUN'};
}

export function prepareWorkspace(target){
  const root=ensurePlainTarget(target),folder=safePath(root,'.pulso');
  if(fs.existsSync(folder)&&!fs.statSync(folder).isDirectory())throw new Error(`No es directorio: ${folder}`);
  if(exists(root,'.pulso/state.json')){
    workspaceStatus(root);
    if(!exists(root,'.pulso/history.jsonl')||!fs.existsSync(safePath(root,'.pulso/work'))||!fs.statSync(safePath(root,'.pulso/work')).isDirectory())
      throw new Error(`Workspace Pulso incompleto en ${root}. Conserva sus datos y revisa la instalación; no se reparó automáticamente.`);
    return {prepared:true,target:root,existingWorkspace:true,nativeAgentsInstalled:false};
  }
  if(fs.existsSync(folder)&&fs.readdirSync(folder).length)throw new Error(`Existe .pulso sin estado v3 reconocido en ${root}. Conserva esa carpeta y retira su integración antigua antes de preparar. No se borraron datos.`);
  seed(root);
  return {prepared:true,target:root,existingWorkspace:false,nativeAgentsInstalled:false};
}

export function uninstall({runtime,homeDir=os.homedir(),env=process.env,dryRun=false}){
  if(!runtimeNames.includes(runtime))throw new Error('Runtime: opencode o vscode');
  if(!fs.existsSync(path.join(homeDir,manifestPath)))return {uninstalled:false,runtime,targets:[],workPreserved:true,note:'No se encontró una instalación global registrada de ese runtime. No se eliminó nada.'};
  const root=ensurePlainTarget(homeDir),raw=readJSON(root,manifestPath),oc=raw.opencodeDir||globalOpenCodeDir(root,env);
  const prior=getPrior(root,oc);assertNoUnregisteredAgents(root,oc,[runtime],prior);
  if(!prior.runtimes.includes(runtime))return {uninstalled:false,runtime,targets:[],workPreserved:true,note:'El runtime no está registrado en la instalación global. No se eliminó nada.'};
  const remaining=prior.runtimes.filter(x=>x!==runtime);
  const removals=Object.keys(prior.files).filter(f=>!prior.borrowed?.includes(f)&&(!remaining.length||nativeOwner(f,oc)===runtime));
  checkRemovals(root,removals,prior);
  if(dryRun)return {dryRun:true,uninstall:true,runtime,targets:[{target:root,scope:'global',removals}]};
  const files=Object.fromEntries(Object.entries(prior.files).filter(([f])=>!removals.includes(f)));
  applyFiles(root,new Map(),[],removals,prior,()=>writeJSON(root,manifestPath,{...prior,runtimes:remaining,files}));
  return {uninstalled:true,runtime,targets:[{target:root,scope:'global',removed:removals.length,remainingRuntimes:remaining}],workPreserved:true,note:'La instalación global fue actualizada. Los datos de los proyectos no se recorrieron ni modificaron.'};
}
