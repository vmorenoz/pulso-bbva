import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {safePath,sha256,listFiles} from './lib/fs.mjs';
import {pluginResource,homeRelative,readOptional,inventoryInstallations,knownLegacyPaths,cleanupConfigs,prepareBackups,applyChanges} from './lib/install-cleanup.mjs';
import {parseConfig,editConfig,removePlugins,pluginReference} from './lib/install-jsonc.mjs';
const MANIFEST='.pulso/installations/opencode-v1.json', RUNTIME='.pulso/runtimes/opencode-v1';
const json=x=>Buffer.from(JSON.stringify(x,null,2)+'\n');
function relative(home,p){if(!path.isAbsolute(p))throw new Error(`Global path must be absolute: ${p}`);const r=path.relative(home,p).split(path.sep).join('/');safePath(home,r);if(['.pulso','.vscode','.agents','.copilot','.claude'].some(x=>r===x||r.startsWith(x+'/')))throw new Error(`Unsafe config root: ${p}`);return r;}
export function resolveOpenCodeRoots(home,env={}){const base=relative(home,path.join(env.XDG_CONFIG_HOME||path.join(home,'.config'),'opencode'));const roots=[base];if(env.OPENCODE_CONFIG_DIR){const custom=relative(home,env.OPENCODE_CONFIG_DIR);if(!roots.includes(custom))roots.push(custom);}return {base,roots,active:roots.at(-1)};}
export function relocateLinks(text,asset,runtime){return text.replace(/\]\((\.\.?\/[^)\s]+)\)/g,(whole,url)=>{const target=path.posix.normalize(path.posix.join(path.posix.dirname(asset),url));if(!target.startsWith('resources/'))return whole;return `](${pathToFileURL(path.join(runtime,target)).href})`;});}
export function planOpenCode({home=os.homedir(),env=process.env,packageRoot,mode='install',conflict='abort'}={}){
  home=path.resolve(home);if(!fs.statSync(home).isDirectory()||fs.lstatSync(home).isSymbolicLink())throw new Error('Home must be a plain existing directory');
  if(!['install','clean'].includes(mode)||!['abort','backup-replace'].includes(conflict))throw new Error('Invalid installation mode/conflict choice');
  const {roots,base,active}=resolveOpenCodeRoots(home,env),changes=new Map(),reasons=new Map(),warnings=[],actions=[],borrowed=[];
  const previousBytes=readOptional(home,MANIFEST),previous=previousBytes?JSON.parse(previousBytes):null;
  if(previous&&(previous.schemaVersion!==1||previous.runtime!=='opencode-v1'||!previous.files||!Array.isArray(previous.borrowed)||!Array.isArray(previous.configRoots)))throw new Error('Invalid isolated ownership manifest');
  const dirs=new Set([...roots,...(previous?.configRoots||[])]);
  for(const d of dirs)relative(home,path.join(home,d));
  const native=p=>[...dirs].some(d=>p.startsWith(d+'/')&&/^(agents|skills|commands)\//.test(p.slice(d.length+1)));
  for(const [p,h] of Object.entries(previous?.files||{})){safePath(home,p);if(!(p.startsWith(RUNTIME+'/')||native(p))||!/^[a-f0-9]{64}$/.test(h))throw new Error('Unsafe isolated ownership');}
  if(previous?.borrowed.some(p=>!Object.hasOwn(previous.files,p)))throw new Error('Invalid borrowed ownership');
  const legacy=inventoryInstallations(home,active); for(const d of roots){const extra=inventoryInstallations(home,d);for(const item of extra.installations)if(!legacy.installations.some(i=>i.path===item.path))legacy.installations.push(item);for(const [p,hashes] of extra.owned)legacy.owned.set(p,hashes);for(const p of extra.borrowed)legacy.borrowed.add(p);for(const x of extra.dirs)dirs.add(x);}legacy.dirs=[...dirs];
  const known=new Set([...dirs].flatMap(knownLegacyPaths));
  const ownedHash=p=>previous?.borrowed.includes(p)||legacy.borrowed.has(p)?null:previous?.files[p]||legacy.owned.get(p);
  const checkConflict=(p,bytes)=>{const expected=ownedHash(p),matches=expected instanceof Set?expected.has(sha256(bytes)):expected===sha256(bytes);if(!matches&&conflict!=='backup-replace')throw new Error(`Explicit --conflict backup-replace required for modified or legacy resource: ${p}`);};
  if(!packageRoot)throw new Error('OpenCode package directory required'); packageRoot=path.resolve(packageRoot);
  const files=new Map(),pkg=JSON.parse(fs.readFileSync(safePath(packageRoot,'package.json'),'utf8'));
  if(!fs.existsSync(safePath(packageRoot,'plugin/index.mjs')))throw new Error('Missing packaged plugin');
  for(const p of listFiles(packageRoot)){const bytes=fs.readFileSync(safePath(packageRoot,p));files.set(`${RUNTIME}/${p}`,bytes);if(/^(agents|commands|skills)\//.test(p)){let data=bytes;if(!p.startsWith('skills/bbva-'))data=Buffer.from(relocateLinks(bytes.toString(),p,path.join(home,RUNTIME)));files.set(`${active}/${p}`,data);}}
  for(const [p,data] of files){if(p.startsWith(`${active}/skills/bbva-`)&&readOptional(home,p.replace(active+'/', '.agents/'))!==null){files.delete(p);continue;}const old=readOptional(home,p),owned=ownedHash(p);if(old?.equals(data)){if(!owned)borrowed.push(p);actions.push({path:p,action:'unchanged'});continue;}if(old){if(previous?.borrowed.includes(p)||legacy.borrowed.has(p)){if(p.startsWith(`${active}/skills/bbva-`)){borrowed.push(p);files.set(p,old);actions.push({path:p,action:'borrowed'});continue;}throw new Error(`Borrowed resource cannot be replaced: ${p}`);}if(!owned&&!known.has(p)){if(p.startsWith(`${active}/skills/bbva-`)){borrowed.push(p);files.set(p,old);actions.push({path:p,action:'borrowed'});continue;}throw new Error(`Foreign collision: ${p}`);}checkConflict(p,old);reasons.set(p,'Replaced managed resource');}changes.set(p,data);actions.push({path:p,action:old?'replace':'create'});}
  // Shared historical .pulso resources are deliberately retained for other runtimes.
  const candidates=new Set([...Object.keys(previous?.files||{}),...legacy.owned.keys(),...known]);
  for(const p of candidates){if(files.has(p)||previous?.borrowed.includes(p)||legacy.borrowed.has(p)||p.startsWith('.pulso/')&&!p.startsWith(RUNTIME+'/'))continue;const old=readOptional(home,p);if(!old)continue;checkConflict(p,old);changes.set(p,null);reasons.set(p,'Obsolete owned native resource');actions.push({path:p,action:'remove'});}
  for(const d of dirs){const old=readOptional(home,`${d}/config.json`);if(old){parseConfig(old.toString(),`${d}/config.json`);warnings.push(`Legacy ${d}/config.json is loaded by OpenCode and preserved; check overlapping Pulso registrations.`);}}
  // Historical exact-path registration cleanup is permitted only with ownership or explicit legacy choice.
  const cleanup=new Map();cleanupConfigs(home,legacy,cleanup,{installDir:null});
  if(conflict!=='backup-replace')for(const [p,b] of cleanup){
    const before=parseConfig(readOptional(home,p).toString()).plugin||[],after=new Set((parseConfig(b.toString()).plugin||[]).map(pluginReference));
    for(const item of before){const entry=pluginReference(item);if(after.has(entry))continue;const resource=pluginResource(home,path.posix.dirname(p),entry);
      const recorded=legacy.owned.has(resource)||legacy.current?.pluginConfig?.path===p&&legacy.current.pluginConfig.entry===entry&&!legacy.current.pluginConfig.existing;
      if(!recorded)throw new Error('Legacy config cleanup requires explicit backup-replace choice');
    }
  }
  for(const [p,b] of cleanup){changes.set(p,b);reasons.set(p,'Historical native configuration');}
  const configPaths=[`${active}/opencode.jsonc`,`${active}/opencode.json`];
  const configPath=previous?.pluginConfig?.path&&configPaths.includes(previous.pluginConfig.path)?previous.pluginConfig.path:configPaths.find(p=>readOptional(home,p)!==null)||configPaths[0];
  let old=readOptional(home,configPath),text=changes.get(configPath)?.toString()||old?.toString()||'{}\n';const entry=pathToFileURL(path.join(home,RUNTIME,'plugin/index.mjs')).href;
  // Remove our old entry only at the exact path recorded by the isolated manifest.
  if(previous?.pluginConfig){const c=previous.pluginConfig;if(!dirs.has(path.posix.dirname(c.path))||!['opencode.json','opencode.jsonc'].includes(path.posix.basename(c.path))||c.entry!==entry)throw new Error('Invalid plugin config ownership');if(c.path!==configPath&&!c.existing){const b=readOptional(home,c.path);if(b){let t=removePlugins(b.toString(),x=>x===c.entry);if(parseConfig(t).default_agent==='pulso')t=editConfig(t,['default_agent'],c.defaultAgent?.previous??undefined);changes.set(c.path,Buffer.from(t));reasons.set(c.path,'Previous native configuration');}}}
  const parsed=parseConfig(text,configPath),exists=(parsed.plugin||[]).some(x=>pluginReference(x)===entry),same=previous?.pluginConfig?.path===configPath;
  const pluginConfig={path:configPath,entry,existing:same?previous.pluginConfig.existing:exists,defaultAgent:{previous:same?previous.pluginConfig.defaultAgent?.previous??null:parsed.default_agent??null}};
  if(!exists)text=parsed.plugin===undefined?editConfig(text,['plugin'],[entry]):editConfig(text,['plugin',-1],entry);
  if(!same&&parsed.default_agent!=='pulso')text=editConfig(text,['default_agent'],'pulso');changes.set(configPath,Buffer.from(text));reasons.set(configPath,'Native configuration before installation');
  // Split selected native ownership out of old manifests; retain shared/foreign ownership.
  for(const item of legacy.installations){
    if(item.format==='profile')continue;
    const retained={...item.value,files:{...item.value.files}};
    for(const key of Object.keys(retained.files)){const p=homeRelative(home,key,item.base);if((files.has(p)||changes.has(p))&&!p.startsWith('.pulso/'))delete retained.files[key];}
    if(item.format==='v3'){
      retained.borrowed=(retained.borrowed||[]).filter(p=>Object.hasOwn(retained.files,p));
      retained.runtimes=[...new Set(retained.runtimes.flatMap(x=>x==='both'?['vscode']:['opencode','opencode-v1','opencode-v2'].includes(x)?[]:[x]))];
      delete retained.pluginConfig;
    }
    const bytes=json(retained);if(!bytes.equals(readOptional(home,item.path))){changes.set(item.path,bytes);reasons.set(item.path,'Historical ownership split; shared resources preserved');}
  }
  const manifest={schemaVersion:1,runtime:'opencode-v1',version:pkg.version,configRoots:[...dirs],files:Object.fromEntries([...files].map(([p,b])=>[p,sha256(b)])),borrowed,pluginConfig};changes.set(MANIFEST,json(manifest));reasons.set(MANIFEST,'Previous isolated ownership');
  if(legacy.installations.length)warnings.push('Foreign historical ownership and ambiguous shared distribution files are retained. Selected native ownership was split into the isolated manifest.');
  if(env.OPENCODE_CONFIG)warnings.push('OPENCODE_CONFIG is an additional file override; preserved and never used as a resource directory.');if(env.OPENCODE_CONFIG_CONTENT)warnings.push('OPENCODE_CONFIG_CONTENT may override global settings.');warnings.push('Project and managed settings may override global configuration; native conversation verification has not run.');
  for(const [p,b] of changes){const old=readOptional(home,p);if(b===null?old===null:old?.equals(b))changes.delete(p);}
  const {originals,backup}=prepareBackups(home,changes,reasons);
  return {runtime:'opencode',target:{home,base,roots,active},actions,warnings,backup,changes,execute(){applyChanges(home,changes,originals,{backup});return {status:'configured',version:pkg.version,nativeSession:'NOT_RUN',backup};}};
}
