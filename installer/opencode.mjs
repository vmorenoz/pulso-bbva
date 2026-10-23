import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {safePath,sha256,listFiles} from './lib/fs.mjs';
import {pluginResource,homeRelative,readOptional,inventoryInstallations,knownLegacyPaths,cleanupConfigs,cleanupAgentPresets,prepareBackups,applyChanges} from './lib/install-cleanup.mjs';
import {parseConfig,editConfig,removePlugins,pluginReference} from './lib/install-jsonc.mjs';
const OLD_RUNTIME='.pulso/runtimes/opencode-v1', OLD_MANIFEST='.pulso/installations/opencode-v1.json';
const json=x=>Buffer.from(JSON.stringify(x,null,2)+'\n');
const entries=config=>[...(config.plugin||[]),...(config.plugins||[])];
function relative(home,p){
  if(!path.isAbsolute(p))throw new Error(`Global path must be absolute: ${p}`);
  const r=path.relative(home,p).split(path.sep).join('/');safePath(home,r);
  if(['.pulso','.vscode','.agents','.copilot','.claude'].some(x=>r===x||r.startsWith(x+'/')))throw new Error(`Unsafe config root: ${p}`);
  return r;
}
export function resolveOpenCodeRoots(home,env={}){
  const base=relative(home,path.join(env.XDG_CONFIG_HOME||path.join(home,'.config'),'opencode')),roots=[base],customDir=env.OPENCODE_CONFIG_DIR;
  if(customDir){const custom=relative(home,customDir);if(base.startsWith(custom+'/'))throw new Error('OpenCode config root cannot contain the global config directory');if(!roots.includes(custom))roots.push(custom);}
  return {base,roots,active:roots.at(-1)};
}
export function relocateLinks(text,asset,runtime){return text.replace(/\]\((\.\.?\/[^)\s]+)\)/g,(whole,url)=>{const target=path.posix.normalize(path.posix.join(path.posix.dirname(asset),url));if(!target.startsWith('resources/'))return whole;return `](${pathToFileURL(path.join(runtime,target)).href})`;});}
function readOwnership(home,manifest,runtime){
  const bytes=readOptional(home,manifest);if(!bytes)return null;
  const value=JSON.parse(bytes),runtimeRoot=`.pulso/runtimes/${runtime}`;
  if(value.schemaVersion!==1||value.runtime!==runtime||!value.files||typeof value.files!=='object'||Array.isArray(value.files)||!Array.isArray(value.borrowed)||!Array.isArray(value.configRoots))throw new Error('Invalid isolated ownership manifest');
  for(const d of value.configRoots)relative(home,path.join(home,d));
  const native=p=>value.configRoots.some(d=>p.startsWith(d+'/')&&/^(agents|skills|commands)\//.test(p.slice(d.length+1)));
  for(const [p,h] of Object.entries(value.files)){safePath(home,p);if(!(p.startsWith(runtimeRoot+'/')||native(p))||!/^[a-f0-9]{64}$/.test(h))throw new Error('Unsafe isolated ownership');}
  if(value.borrowed.some(p=>!Object.hasOwn(value.files,p)))throw new Error('Invalid borrowed ownership');
  if(value.pluginConfig){
    const c=value.pluginConfig,expected=pathToFileURL(path.join(home,runtimeRoot,...(runtime==='opencode-v1'?['plugin/index.mjs']:[]))).href;
    if(!value.configRoots.includes(path.posix.dirname(c.path))||!['opencode.json','opencode.jsonc'].includes(path.posix.basename(c.path))||c.entry!==expected||typeof c.existing!=='boolean'||c.defaultAgent?.previous!=null&&typeof c.defaultAgent.previous!=='string')throw new Error('Invalid plugin config ownership');
  }
  return value;
}
export function planOpenCode({home=os.homedir(),env=process.env,packageRoot,mode='install',conflict='abort'}={}){
  const runtime='opencode-v2',RUNTIME='.pulso/runtimes/opencode-v2',MANIFEST='.pulso/installations/opencode-v2.json';
  home=path.resolve(home);
  if(!fs.statSync(home).isDirectory()||fs.lstatSync(home).isSymbolicLink())throw new Error('Home must be a plain existing directory');
  if(!['install','clean'].includes(mode)||!['abort','backup-replace'].includes(conflict))throw new Error('Invalid installation mode/conflict choice');
  const {roots,base,active}=resolveOpenCodeRoots(home,env),changes=new Map(),reasons=new Map(),warnings=[],actions=[],borrowed=[];
  const previous=readOwnership(home,MANIFEST,runtime),old=readOwnership(home,OLD_MANIFEST,'opencode-v1');
  const dirs=new Set([...roots,...(previous?.configRoots||[]),...(old?.configRoots||[])]);
  const legacy=inventoryInstallations(home,active);
  for(const d of dirs){
    const extra=inventoryInstallations(home,d);
    for(const item of extra.installations)if(!legacy.installations.some(i=>i.path===item.path))legacy.installations.push(item);
    for(const [p,hashes] of extra.owned){const existing=legacy.owned.get(p)||new Set();for(const h of hashes)existing.add(h);legacy.owned.set(p,existing);}
    for(const p of extra.borrowed)legacy.borrowed.add(p);for(const x of extra.dirs)dirs.add(x);
  }
  legacy.dirs=[...dirs];
  const known=new Set([...dirs].flatMap(knownLegacyPaths));
  const isBorrowed=p=>previous?.borrowed.includes(p)||old?.borrowed.includes(p)||legacy.borrowed.has(p);
  const ownedHash=p=>isBorrowed(p)?null:previous?.files[p]||old?.files[p]||legacy.owned.get(p);
  const checkConflict=(p,bytes)=>{const expected=ownedHash(p),matches=expected instanceof Set?expected.has(sha256(bytes)):expected===sha256(bytes);if(!matches&&conflict!=='backup-replace')throw new Error(`Explicit --conflict backup-replace required for modified or legacy resource: ${p}`);};
  if(!packageRoot)throw new Error('Native plugin package directory required');packageRoot=path.resolve(packageRoot);
  const files=new Map(),pkg=JSON.parse(fs.readFileSync(safePath(packageRoot,'package.json'),'utf8'));
  if(!/^0\.1\.\d+$/.test(pkg.version)||pkg.exports!=='./plugin/index.mjs'||pkg.pulso?.host!=='opencode'||pkg.pulso.apiVersion!==2||pkg.pulso.hostVersion!=='2.1.2')throw new Error('Expected a Pulso 0.1.* native OpenCode 2.1.2 package');
  for(const entrypoint of ['plugin/index.mjs','server.js']){
    const file=safePath(packageRoot,entrypoint);
    if(!fs.existsSync(file)||!fs.statSync(file).isFile())throw new Error(`Missing packaged native plugin entrypoint: ${entrypoint}`);
  }
  for(const p of listFiles(packageRoot)){
    const bytes=fs.readFileSync(safePath(packageRoot,p));files.set(`${RUNTIME}/${p}`,bytes);
    if(/^(agents|commands|skills)\//.test(p)){const data=p.startsWith('skills/bbva-')?bytes:Buffer.from(relocateLinks(bytes.toString(),p,path.join(home,RUNTIME)));files.set(`${active}/${p}`,data);}
  }
  for(const [p,data] of files){
    if(p.startsWith(`${active}/skills/bbva-`)&&readOptional(home,p.replace(active+'/', '.agents/'))!==null){files.delete(p);continue;}
    const before=readOptional(home,p),owned=ownedHash(p);
    if(before?.equals(data)){if(!owned)borrowed.push(p);actions.push({path:p,action:'unchanged'});continue;}
    if(before){
      if(isBorrowed(p)){if(p.startsWith(`${active}/skills/bbva-`)){borrowed.push(p);files.set(p,before);actions.push({path:p,action:'borrowed'});continue;}throw new Error(`Borrowed resource cannot be replaced: ${p}`);}
      if(!owned&&!known.has(p)){if(p.startsWith(`${active}/skills/bbva-`)){borrowed.push(p);files.set(p,before);actions.push({path:p,action:'borrowed'});continue;}throw new Error(`Foreign collision: ${p}`);}
      checkConflict(p,before);reasons.set(p,'Replaced managed resource');
    }
    changes.set(p,data);actions.push({path:p,action:before?'replace':'create'});
  }
  // Old isolated runtime files are removable only through their validated inventory.
  // Unknown files and shared historical .pulso resources remain untouched.
  const candidates=new Set([...Object.keys(previous?.files||{}),...Object.keys(old?.files||{}),...legacy.owned.keys(),...known]);
  for(const p of candidates){
    if(files.has(p)||isBorrowed(p)||p.startsWith('.pulso/')&&!p.startsWith(RUNTIME+'/')&&!p.startsWith(OLD_RUNTIME+'/'))continue;
    const before=readOptional(home,p);if(!before)continue;
    checkConflict(p,before);changes.set(p,null);reasons.set(p,'Obsolete owned native resource');actions.push({path:p,action:'remove'});
  }
  for(const d of dirs){const before=readOptional(home,`${d}/config.json`);if(before){parseConfig(before.toString(),`${d}/config.json`);warnings.push(`Legacy ${d}/config.json is preserved; review overlapping Pulso registrations.`);}}
  const cleanup=new Map();cleanupConfigs(home,legacy,cleanup,{installDir:null});
  if(conflict!=='backup-replace')for(const [p,b] of cleanup){
    const before=entries(parseConfig(readOptional(home,p).toString())),after=new Set(entries(parseConfig(b.toString())).map(pluginReference));
    for(const item of before){const entry=pluginReference(item);if(after.has(entry))continue;const resource=pluginResource(home,path.posix.dirname(p),entry);
      const recorded=legacy.owned.has(resource)||legacy.current?.pluginConfig?.path===p&&legacy.current.pluginConfig.entry===entry&&!legacy.current.pluginConfig.existing;
      if(!recorded)throw new Error('Legacy config cleanup requires explicit backup-replace choice');
    }
  }
  for(const [p,b] of cleanup){changes.set(p,b);reasons.set(p,'Historical native configuration');}
  const configPaths=[`${active}/opencode.jsonc`,`${active}/opencode.json`];
  const configPath=previous?.pluginConfig?.path&&configPaths.includes(previous.pluginConfig.path)?previous.pluginConfig.path:configPaths.find(p=>readOptional(home,p)!==null)||configPaths[0];
  const entry=pathToFileURL(path.join(home,RUNTIME)).href;
  // Migrate only registrations identified by isolated ownership. Borrowed V1
  // registrations cannot be silently changed into a different host contract.
  for(const [ownership,obsolete] of [[old,true],[previous,false]]){
    const c=ownership?.pluginConfig;if(!c)continue;
    const before=changes.get(c.path)??readOptional(home,c.path);if(!before)continue;
    let text=before.toString();const config=parseConfig(text);
    const registered=entries(config).some(item=>pluginReference(item)===c.entry);
    if(obsolete&&c.existing&&registered)throw new Error('Borrowed OpenCode V1 registration requires explicit owner migration before installing V2');
    if((obsolete||c.path!==configPath)&&!c.existing){
      text=removePlugins(text,x=>x===c.entry);
      if(c.path!==configPath&&parseConfig(text).default_agent==='pulso')text=editConfig(text,['default_agent'],c.defaultAgent?.previous??undefined);
      changes.set(c.path,Buffer.from(text));reasons.set(c.path,'Previous native configuration');
    }
  }
  // Both JSON/JSONC files and additive global roots participate in host config.
  // A borrowed/aliased entry elsewhere must not be duplicated in the active file.
  for(const dir of dirs)for(const name of ['opencode.json','opencode.jsonc']){
    const otherPath=`${dir}/${name}`;if(otherPath===configPath)continue;
    const bytes=changes.get(otherPath)??readOptional(home,otherPath);if(!bytes)continue;
    if(entries(parseConfig(bytes.toString(),otherPath)).some(item=>pluginResource(home,dir,item)===RUNTIME))throw new Error(`Native Pulso registration exists in another config file: ${otherPath}; resolve ownership before installing`);
  }
  let text=(changes.get(configPath)??readOptional(home,configPath))?.toString()||'{}\n';
  let parsed=parseConfig(text,configPath);
  // A previous native entry manually moved to the legacy field is migrated as
  // an owned reference; foreign legacy plugins and tuples retain exact bytes.
  if(previous?.pluginConfig?.path===configPath&&!previous.pluginConfig.existing){text=removePlugins(text,x=>x===entry,{fields:['plugin']});parsed=parseConfig(text);}
  const equivalent=x=>pluginResource(home,path.posix.dirname(configPath),pluginReference(x))===RUNTIME;
  if((parsed.plugin||[]).some(equivalent))throw new Error('Borrowed legacy Pulso registration requires explicit native plugins migration');
  const matches=(parsed.plugins||[]).filter(equivalent);
  if(matches.length>1)throw new Error('Duplicate native Pulso registrations; resolve ambiguity before installing');
  const exists=matches.length===1,same=previous?.pluginConfig?.path===configPath;
  const former=old?.pluginConfig?.path===configPath?old.pluginConfig:undefined;
  const pluginConfig={path:configPath,entry,existing:same?previous.pluginConfig.existing:exists,defaultAgent:{previous:same?previous.pluginConfig.defaultAgent?.previous??null:former?former.defaultAgent?.previous??null:parsed.default_agent??null}};
  if(!exists)text=parsed.plugins===undefined?editConfig(text,['plugins'],[entry]):editConfig(text,['plugins',-1],entry);
  if(!same&&parsed.default_agent!=='pulso')text=editConfig(text,['default_agent'],'pulso');
  changes.set(configPath,Buffer.from(text));reasons.set(configPath,'Native configuration before installation');
  for(const item of legacy.installations){
    if(item.format==='profile')continue;
    const retained={...item.value,files:{...item.value.files}};
    for(const key of Object.keys(retained.files)){const p=homeRelative(home,key,item.base);if((files.has(p)||changes.has(p))&&!p.startsWith('.pulso/'))delete retained.files[key];}
    if(item.format==='v3'){
      retained.borrowed=(retained.borrowed||[]).filter(p=>Object.hasOwn(retained.files,p));
      retained.runtimes=[...new Set(retained.runtimes.flatMap(x=>x==='both'?['vscode']:['opencode','opencode-v1','opencode-v2'].includes(x)?[]:[x]))];delete retained.pluginConfig;
    }
    const bytes=json(retained);if(!bytes.equals(readOptional(home,item.path))){changes.set(item.path,bytes);reasons.set(item.path,'Historical ownership split; shared resources preserved');}
  }
  if(old){
    const retained=Object.fromEntries(Object.entries(old.files).filter(([p])=>isBorrowed(p)&&!files.has(p)));
    changes.set(OLD_MANIFEST,Object.keys(retained).length?json({...old,files:retained,borrowed:old.borrowed.filter(p=>Object.hasOwn(retained,p)),pluginConfig:undefined}):null);
    reasons.set(OLD_MANIFEST,'Previous isolated OpenCode ownership');
  }
  const manifest={schemaVersion:1,runtime,version:pkg.version,configRoots:[...dirs],files:Object.fromEntries([...files].map(([p,b])=>[p,sha256(b)])),borrowed,pluginConfig};
  changes.set(MANIFEST,json(manifest));reasons.set(MANIFEST,'Previous isolated ownership');
  if(old||legacy.installations.length)warnings.push('Owned OpenCode registrations are migrated; unknown, borrowed and shared historical resources are retained.');
  if(env.OPENCODE_CONFIG)warnings.push(`OPENCODE_CONFIG is an additional file override; preserved and never used as a resource directory. Agent preset cleanup is limited to opencode.json/opencode.jsonc in inventoried global roots; this override may still supply presets.`);
  if(env.OPENCODE_CONFIG_CONTENT)warnings.push(`OPENCODE_CONFIG_CONTENT may override global settings.`);
  warnings.push(`Requires OpenCode 2.1.2. Project and managed settings may override global configuration; native conversation verification has not run.`);
  for(const p of cleanupAgentPresets(home,legacy,changes)){const reason='Removed Pulso agent model/variant presets';reasons.set(p,reasons.has(p)?`${reasons.get(p)}; ${reason}`:reason);actions.push({path:p,action:'agent-presets'});}
  for(const [p,b] of changes){const before=readOptional(home,p);if(b===null?before===null:before?.equals(b))changes.delete(p);}
  const {originals,backup}=prepareBackups(home,changes,reasons,{runtime:'opencode'});
  return {runtime:'opencode',target:{home,base,roots,active},actions,warnings,backup,changes,execute(){applyChanges(home,changes,originals,{backup});return {status:'configured',version:pkg.version,nativeSession:'NOT_RUN',backup};}};
}
