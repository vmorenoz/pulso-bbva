import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {install,uninstall,planInstall} from '../lib/install.mjs';
import {sha256} from '../lib/fs.mjs';
import {parseConfig} from '../lib/install-jsonc.mjs';
import {applyChanges} from '../lib/install-cleanup.mjs';
import {temp} from './helpers.mjs';

const oc='.config/opencode',manifest='.pulso/installation.json';
const options=homeDir=>({homeDir,env:{PATH:''}});
function put(root,file,value){const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,typeof value==='object'&&!Buffer.isBuffer(value)?JSON.stringify(value):value);return target;}
const read=(root,file)=>fs.readFileSync(path.join(root,file),'utf8');
const config=(root,file=`${oc}/opencode.jsonc`)=>parseConfig(read(root,file));
function snapshot(root){
  const entries={};
  const visit=(dir,prefix='')=>{for(const item of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const relative=prefix?`${prefix}/${item.name}`:item.name;if(item.isDirectory()){entries[relative+'/']='dir';visit(path.join(dir,item.name),relative);}else entries[relative]=fs.readFileSync(path.join(dir,item.name)).toString('base64');}};
  visit(root);return entries;
}
function backupFiles(root,result){
  assert.ok(result.backup);const index=JSON.parse(read(root,`${result.backup}/index.json`));
  return new Map(index.files.map(item=>{const bytes=fs.readFileSync(path.join(root,result.backup,item.backup));assert.equal(sha256(bytes),item.sha256);return [item.path,bytes.toString()];}));
}

test('coexisting v1/v2/v3 migration retires exact OpenCode resources and preserves user data and other hosts',t=>{
  const home=temp(t),foreign=temp(t),project=put(foreign,'.pulso/work/KEEP/work.json','project bytes');
  const plugin=pathToFileURL(path.join(home,oc,'plugins/pulso/index.mjs')).href;
  const mcp={type:'local',command:['node',path.join(home,'.pulso/pulso-capabilities-mcp.js')],enabled:true};
  put(home,`${oc}/opencode.jsonc`,`{
    // unrelated comment and escaped JSON-looking text
    "description": "https://host/x // \\\"default_agent\\\": \\\"fake\\\"",
    "plugin": ["foreign-first", "./plugins/pulso-circuit-breaker.mjs", /* keep */ "foreign-middle", "./plugins/pulso-protocol-guard.js", "foreign-last", "${plugin}"],
    "default_agent": "pulso",
    "mcp": {"foreign": {"command": ["custom"]}},
  }`);
  const jsonPath=put(home,`${oc}/opencode.json`,{mcp:{pulso:mcp,foreign:{command:['keep']}},plugin:['one','./plugins/pulso-experience-engine.mjs','two']});
  put(home,`${oc}/bin/pulso-breaker.js`,'modified legacy');
  put(home,`${oc}/plugins/pulso-circuit-breaker.mjs`,'intact v1');
  put(home,`${oc}/.pulso-install.json`,{schema_version:1,managed_by:'pulso',files:{'bin/pulso-breaker.js':sha256('before edit'),'plugins/pulso-circuit-breaker.mjs':sha256('intact v1')}});
  const bridge=put(home,`${oc}/plugins/pulso-protocol-guard.js`,'v2 bridge');
  put(home,`${oc}/.pulso-manifest.json`,{version:5,runtime:'opencode',scope:'global',buildId:'fixture',files:{[bridge]:sha256('v2 bridge')},nativeBridge:{path:bridge,sha256:sha256('v2 bridge'),version:'1.18.32',role:'native-bridge'},configEntries:{[`${jsonPath}#mcp.pulso`]:sha256(JSON.stringify(mcp)),[`${jsonPath}#plugin`]:sha256(JSON.stringify(['one','./plugins/pulso-experience-engine.mjs','two']))}});
  put(home,'.pulso/lib/retired.mjs','modified core');
  put(home,'.copilot/agents/pulso.agent.md','copilot untouched');
  put(home,'.vscode/settings.json','vscode untouched');
  put(home,manifest,{schemaVersion:1,version:'3.0.0',scope:'global',runtimes:['both'],opencodeDir:oc,files:{'.pulso/lib/retired.mjs':sha256('old core'),'.copilot/agents/pulso.agent.md':sha256('copilot untouched')},pluginConfig:{path:`${oc}/opencode.jsonc`,entry:plugin,created:false,existing:false,defaultAgent:{previous:'build'}}});
  put(home,'.pulso/preferences.json','preferences bytes');
  put(home,'.pulso/registry.json',{projects:[foreign]});
  put(home,'.pulso/projects/KEEP/state.json','registry project bytes');
  put(home,`${oc}/plugins/pulso-unknown.mjs`,'unknown remains');
  put(home,`${oc}/agents/pulso-custom.md`,'unknown agent remains');
  put(home,`${oc}/pulso-profile.json`,{managed_by:'pulso',profile:'historical'});
  const before=snapshot(home),result=install(options(home)),archive=backupFiles(home,result);
  for(const file of [`${oc}/bin/pulso-breaker.js`,`${oc}/plugins/pulso-circuit-breaker.mjs`,`${oc}/plugins/pulso-protocol-guard.js`,`${oc}/.pulso-install.json`,`${oc}/.pulso-manifest.json`,`${oc}/pulso-profile.json`,'.pulso/lib/retired.mjs'])assert.equal(fs.existsSync(path.join(home,file)),false,file);
  assert.equal(archive.get(`${oc}/bin/pulso-breaker.js`),'modified legacy');assert.equal(archive.get('.pulso/lib/retired.mjs'),'modified core');
  assert.deepEqual(config(home).plugin,['foreign-first','foreign-middle','foreign-last',plugin]);
  assert.deepEqual(config(home,`${oc}/opencode.json`).plugin,['one','two']);assert.equal(config(home,`${oc}/opencode.json`).mcp.pulso,undefined);assert.deepEqual(config(home,`${oc}/opencode.json`).mcp.foreign,{command:['keep']});
  assert.match(read(home,`${oc}/opencode.jsonc`),/unrelated comment/);assert.match(read(home,`${oc}/opencode.jsonc`),/keep/);
  for(const file of ['.copilot/agents/pulso.agent.md','.vscode/settings.json','.pulso/preferences.json','.pulso/registry.json','.pulso/projects/KEEP/state.json',`${oc}/plugins/pulso-unknown.mjs`,`${oc}/agents/pulso-custom.md`])assert.equal(snapshot(home)[file],before[file],file);
  install(options(home));uninstall(options(home));assert.equal(config(home).default_agent,'build');assert.deepEqual(config(home).plugin,['foreign-first','foreign-middle','foreign-last']);assert.equal(fs.readFileSync(project,'utf8'),'project bytes');assert.equal(read(home,'.copilot/agents/pulso.agent.md'),'copilot untouched');
  assert.ok(JSON.parse(read(home,manifest)).preservedInstallations.length);
});

test('shared BBVA skills, unowned OpenCode skills and preexisting plugin remain borrowed across reinstall/uninstall',t=>{
  const home=temp(t),plugin=pathToFileURL(path.join(home,oc,'plugins/pulso/index.mjs')).href;
  put(home,'.agents/skills/bbva-apx/SKILL.md','shared customized APX');
  put(home,`${oc}/skills/bbva-cells/SKILL.md`,'user customized Cells');
  put(home,`${oc}/opencode.jsonc`,{plugin:['foreign',plugin],default_agent:'build'});
  install(options(home));install(options(home));
  assert.equal(fs.existsSync(path.join(home,oc,'skills/bbva-apx/SKILL.md')),false);
  const owned=JSON.parse(read(home,manifest));assert.equal(owned.pluginConfig.existing,true);assert.equal(owned.pluginConfig.defaultAgent.previous,'build');assert.ok(owned.borrowed.includes(`${oc}/skills/bbva-cells/SKILL.md`));
  uninstall(options(home));assert.equal(read(home,'.agents/skills/bbva-apx/SKILL.md'),'shared customized APX');assert.equal(read(home,`${oc}/skills/bbva-cells/SKILL.md`),'user customized Cells');assert.deepEqual(config(home).plugin,['foreign',plugin]);assert.equal(config(home).default_agent,'build');
});

test('reinstall retains plugin/default ownership and leaves user overrides on uninstall',t=>{
  const home=temp(t);put(home,`${oc}/opencode.jsonc`,'{"default_agent":"build","plugin":["first","last"]}');
  install(options(home));const before=snapshot(home);install(options(home));assert.deepEqual(snapshot(home),before);
  const manifestValue=JSON.parse(read(home,manifest));assert.equal(manifestValue.pluginConfig.existing,false);assert.equal(manifestValue.pluginConfig.defaultAgent.previous,'build');
  put(home,`${oc}/opencode.jsonc`,{...config(home),default_agent:'custom'});uninstall(options(home));assert.equal(config(home).default_agent,'custom');assert.deepEqual(config(home).plugin,['first','last']);
});

test('dry-run migration/install/uninstall are byte-for-byte read-only, including absent home',t=>{
  const home=temp(t);put(home,'.pulso/preferences.json','keep');put(home,`${oc}/plugins/pulso-codegraph.mjs`,'modified no manifest');put(home,`${oc}/opencode.jsonc`,'{/*comment*/"plugin":["a","./plugins/pulso-codegraph.mjs","b",],}');
  const before=snapshot(home);assert.ok(install({...options(home),dryRun:true}).backup);assert.deepEqual(snapshot(home),before);uninstall({...options(home),dryRun:true});assert.deepEqual(snapshot(home),before);
  const absent=path.join(home,'absent');install({...options(absent),dryRun:true});uninstall({...options(absent),dryRun:true});assert.equal(fs.existsSync(absent),false);
});

test('failed install rolls back configs, historical manifests, replaced and removed resources and backup directories',t=>{
  const home=temp(t);put(home,`${oc}/plugins/pulso-codegraph.mjs`,'edited retired');put(home,`${oc}/agents/pulso.md`,'edited agent');put(home,`${oc}/opencode.jsonc`,'{/*keep*/"plugin":["foreign","./plugins/pulso-codegraph.mjs"],"default_agent":"build"}');
  put(home,`${oc}/.pulso-install.json`,{schema_version:1,managed_by:'pulso',files:{'agents/pulso.md':sha256('old agent'),'plugins/pulso-codegraph.mjs':sha256('old plugin')}});
  fs.chmodSync(path.join(home,oc,'agents/pulso.md'),0o740);
  const before=snapshot(home),rename=fs.renameSync;let injected=false;
  fs.renameSync=(from,to)=>{if(to===path.join(fs.realpathSync(home),oc,'opencode.jsonc')&&!injected){injected=true;throw new Error('injected config publication failure');}return rename(from,to);};
  try{assert.throws(()=>install(options(home)),/archivos gestionados restaurados.*injected/);}finally{fs.renameSync=rename;}
  assert.equal(injected,true);assert.deepEqual(snapshot(home),before);assert.equal(fs.statSync(path.join(home,oc,'agents/pulso.md')).mode&0o777,0o740);
});

test('failed uninstall rolls back removals, current manifest, user config and modified-resource backups',t=>{
  const home=temp(t);install(options(home));put(home,`${oc}/agents/pulso.md`,'my edits');const before=snapshot(home),rename=fs.renameSync;let injected=false;
  fs.renameSync=(from,to)=>{if(to===path.join(fs.realpathSync(home),oc,'opencode.jsonc')&&!injected){injected=true;throw new Error('uninstall failure');}return rename(from,to);};
  try{assert.throws(()=>uninstall(options(home)),/archivos gestionados restaurados.*uninstall failure/);}finally{fs.renameSync=rename;}
  assert.equal(injected,true);assert.deepEqual(snapshot(home),before);
  const result=uninstall(options(home));assert.equal(backupFiles(home,result).get(`${oc}/agents/pulso.md`),'my edits');assert.equal(config(home).default_agent,undefined);assert.equal(fs.existsSync(path.join(home,manifest)),false);
});

test('failed install, update and uninstall retain verified backups when resource restoration also fails',t=>{
  for(const operation of ['install','update','uninstall']){
    const home=temp(t),agent=`${oc}/agents/pulso.md`,configuration=`${oc}/opencode.jsonc`;
    if(operation!=='install')install(options(home));
    put(home,agent,'only customized copy');
    if(operation!=='uninstall')put(home,configuration,{...(operation==='update'?config(home):{}),default_agent:'build'});
    const rename=fs.renameSync;let injected=false,error;
    fs.renameSync=(from,to)=>{
      if(to===path.join(fs.realpathSync(home),configuration)&&!injected){injected=true;throw new Error('initial publication failure');}
      if(injected&&to===path.join(fs.realpathSync(home),agent))throw new Error('persistent restore failure');
      return rename(from,to);
    };
    try{assert.throws(()=>operation==='uninstall'?uninstall(options(home)):install(options(home)),failure=>{error=failure;return /rollback incompleto.*persistent restore failure/.test(failure.message);});}
    finally{fs.renameSync=rename;}
    assert.equal(injected,true,operation);assert.match(error.message,/Respaldo conservado: .*index\.json/);
    assert.equal(backupFiles(home,error).get(agent),'only customized copy',operation);
  }
});

test('invalid JSONC, duplicate keys, invalid manifests and symlinks fail before writes',t=>{
  for(const text of ['{"plugin":["one" "two"]}','{"plugin":[],"plugin":["x"]}','{"mcp":[]}','{"default_agent":{"custom":true}}']){
    const home=temp(t);put(home,`${oc}/opencode.jsonc`,text);const before=snapshot(home);assert.throws(()=>install(options(home)),/inválid|duplicadas/);assert.deepEqual(snapshot(home),before);
  }
  const home=temp(t);put(home,`${oc}/.pulso-install.json`,{schema_version:99,managed_by:'pulso',files:{}});const before=snapshot(home);assert.throws(()=>install(options(home)),/no reconocido/);assert.deepEqual(snapshot(home),before);
  const linked=temp(t),external=temp(t);fs.mkdirSync(path.join(linked,'.config/opencode'),{recursive:true});fs.symlinkSync(external,path.join(linked,oc,'agents'));assert.throws(()=>install(options(linked)),/Symlink/);assert.deepEqual(snapshot(external),{});
});

test('historical manifests cannot turn OpenCode data or dependencies into cleanup resources',t=>{
  const home=temp(t),files={'data/session.json':'session bytes','node_modules/foreign/index.js':'foreign dependency','package.json':'foreign package'};
  for(const [file,bytes] of Object.entries(files))put(home,`${oc}/${file}`,bytes);
  put(home,`${oc}/.pulso-install.json`,{schema_version:1,managed_by:'pulso',files:Object.fromEntries(Object.entries(files).map(([file,bytes])=>[file,sha256(bytes)]))});
  install(options(home));uninstall(options(home));
  for(const [file,bytes] of Object.entries(files))assert.equal(read(home,`${oc}/${file}`),bytes);
  assert.deepEqual(JSON.parse(read(home,`${oc}/.pulso-install.json`)).files,Object.fromEntries(Object.entries(files).map(([file,bytes])=>[file,sha256(bytes)])));
});

test('MCP removal requires the exact recorded payload; local/project and VS Code manifests are untouched',t=>{
  const home=temp(t),file=put(home,`${oc}/opencode.json`,{mcp:{pulso:{command:['user']},other:{command:['other']}}});
  put(home,`${oc}/.pulso-manifest.json`,{version:1,runtime:'opencode',scope:'global',buildId:'fixture',files:{},configEntries:{[file]:sha256(JSON.stringify({command:['old-pulso']}))}});
  put(home,'.pulso/install-manifest.json','vscode manifest bytes');put(home,'.pulso/runtime-manifest.json','shared runtime bytes');put(home,'.opencode/.pulso-manifest.json','local project bytes');
  uninstall(options(home));assert.deepEqual(config(home,`${oc}/opencode.json`).mcp.pulso,{command:['user']});for(const [relative,bytes] of [['.pulso/install-manifest.json','vscode manifest bytes'],['.pulso/runtime-manifest.json','shared runtime bytes'],['.opencode/.pulso-manifest.json','local project bytes']])assert.equal(read(home,relative),bytes);
});

test('custom config migration inventories the default and prior OpenCode directories',t=>{
  const home=temp(t),custom='.settings/opencode';install(options(home));
  const result=install({homeDir:home,env:{OPENCODE_CONFIG_DIR:path.join(home,custom)}});assert.equal(result.installed,true);assert.equal(fs.existsSync(path.join(home,oc,'agents/pulso.md')),false);assert.equal(config(home).default_agent,undefined);
  assert.ok(fs.existsSync(path.join(home,custom,'agents/pulso.md')));uninstall({homeDir:home,env:{OPENCODE_CONFIG_DIR:path.join(home,custom)}});assert.equal(config(home,`${custom}/opencode.jsonc`).default_agent,undefined);
});

test('planned transaction rejects files changed since preflight',t=>{
  const home=temp(t);put(home,`${oc}/opencode.jsonc`,'{}');const p=planInstall(options(home));put(home,`${oc}/opencode.jsonc`,'{"theme":"user"}');const before=snapshot(home);assert.throws(()=>applyChanges(p.root,p.changes,p.originals),/cambió durante instalación/);assert.deepEqual(snapshot(home),before);
});

test('v2 manifest versions 1–5 support historical config hash keys and relative asset paths',t=>{
  for(let version=1;version<=5;version++){
    const home=temp(t),mcp={type:'local',command:['node','fixture-pulso.js']};
    put(home,`${oc}/opencode.json`,{plugin:['first','./plugins/pulso-protocol-guard.js','last'],mcp:{pulso:mcp,other:{command:['keep']}}});
    put(home,`${oc}/plugins/pulso-protocol-guard.js`,'bridge');
    put(home,`${oc}/.pulso-manifest.json`,{version,runtime:'opencode',scope:'global',buildId:'fixture',files:{'plugins/pulso-protocol-guard.js':sha256('bridge')},configEntries:{[version===1?'opencode.json':'opencode.json#mcp.pulso']:sha256(JSON.stringify(mcp))}});
    uninstall(options(home));assert.deepEqual(config(home,`${oc}/opencode.json`).plugin,['first','last']);assert.deepEqual(config(home,`${oc}/opencode.json`).mcp,{other:{command:['keep']}});assert.equal(fs.existsSync(path.join(home,oc,'plugins/pulso-protocol-guard.js')),false);
  }
});

test('JSONC array removal handles first, middle, last and sole entries with trailing commas and comments',t=>{
  for(const array of ['"./plugins/pulso-codegraph.mjs", /* first */ "a", "b"','"a", /* middle */ "./plugins/pulso-codegraph.mjs", "b",','"a", "b", /* last */ "./plugins/pulso-codegraph.mjs"','/* sole */ "./plugins/pulso-codegraph.mjs",']){
    const home=temp(t);put(home,`${oc}/opencode.jsonc`,`{"plugin":[${array}],"description":"commas, // braces }",}`);
    uninstall(options(home));const value=config(home);assert.deepEqual(value.plugin,array.includes('"a"')?['a','b']:[]);assert.equal(value.description,'commas, // braces }');assert.match(read(home,`${oc}/opencode.jsonc`),/\/\* (first|middle|last|sole) \*\//);
  }
});

test('manifest traversal and an external configuration are rejected without changes',t=>{
  const home=temp(t),external=temp(t);put(external,'keep.js','external');
  put(home,`${oc}/.pulso-install.json`,{schema_version:1,managed_by:'pulso',files:{'../../keep.js':sha256('external')}});const before=snapshot(home);
  assert.throws(()=>uninstall(options(home)),/Ruta no normalizada/);assert.deepEqual(snapshot(home),before);
  assert.throws(()=>install({homeDir:home,env:{OPENCODE_CONFIG_DIR:external}}),/Ruta|fuera/);assert.equal(read(external,'keep.js'),'external');
});

test('an OpenCode suffix in a historical config directory never authorizes cleanup of data or other hosts',t=>{
  for(const opencodeDir of ['.pulso/projects/KEEP/opencode','.copilot/opencode','.vscode/opencode','.agents/opencode','.claude/opencode']){
    const home=temp(t),file=`${opencodeDir}/agents/pulso.md`;
    put(home,file,'foreign data');
    put(home,manifest,{schemaVersion:1,version:'3.0.4',scope:'global',runtimes:['opencode-v1'],opencodeDir,files:{[file]:sha256('foreign data')}});
    const before=snapshot(home);assert.throws(()=>uninstall(options(home)),/Directorio OpenCode inválido/);assert.deepEqual(snapshot(home),before);
  }
});

test('install appends to JSONC without dropping array comments or mistaking nested keys for the default agent',t=>{
  const home=temp(t),previous='agent "quoted" \\ name';
  put(home,`${oc}/opencode.jsonc`,`{
    "agent": {"custom": {"default_agent": "nested"}},
    "default_agent": ${JSON.stringify(previous)},
    "plugin": ["first", /* preserve inside array */ "last",],
  }`);
  install(options(home));assert.match(read(home,`${oc}/opencode.jsonc`),/preserve inside array/);assert.equal(config(home).agent.custom.default_agent,'nested');
  uninstall(options(home));assert.match(read(home,`${oc}/opencode.jsonc`),/preserve inside array/);assert.equal(config(home).default_agent,previous);assert.deepEqual(config(home).plugin,['first','last']);
});

test('plugin tuples preserve foreign options and comments through install and uninstall',t=>{
  const home=temp(t),tuple='["foreign", {"items": [1, 2], /* nested options */ "enabled": true}]';
  put(home,`${oc}/opencode.jsonc`,`{"plugin":[${tuple},"other",],}`);
  install(options(home));assert.ok(read(home,`${oc}/opencode.jsonc`).includes(tuple));
  uninstall(options(home));assert.ok(read(home,`${oc}/opencode.jsonc`).includes(tuple));
  assert.deepEqual(config(home).plugin,[['foreign',{items:[1,2],enabled:true}],'other']);
});

test('tuple cleanup uses outer commas for first, middle, last and sole plugin entries',t=>{
  const owned='["./plugins/pulso-codegraph.mjs", {"nested": {"a": 1, "b": [2, 3]}}]';
  const foreign='["foreign", {"values": [1, 2], "nested": {"keep": true}}]';
  for(const array of [`${owned}, /* first */ ${foreign}, "other"`,`${foreign}, /* middle */ ${owned}, "other",`,`${foreign}, "other", /* last */ ${owned}`,`/* sole */ ${owned},`]){
    const home=temp(t);put(home,`${oc}/opencode.jsonc`,`{"plugin":[${array}],}`);
    uninstall(options(home));assert.deepEqual(config(home).plugin,array.includes('foreign')?[['foreign',{values:[1,2],nested:{keep:true}}],'other']:[]);
    assert.match(read(home,`${oc}/opencode.jsonc`),/\/\* (first|middle|last|sole) \*\//);
  }
});

test('a preexisting Pulso tuple remains borrowed without duplicate insertion or option changes',t=>{
  const home=temp(t),plugin=['./plugins/pulso/index.mjs',{custom:{values:[1,2]}}];
  put(home,`${oc}/opencode.jsonc`,{plugin:[plugin]});
  install(options(home));install(options(home));
  assert.deepEqual(config(home).plugin,[plugin]);assert.equal(JSON.parse(read(home,manifest)).pluginConfig.entry,plugin[0]);
  uninstall(options(home));assert.deepEqual(config(home).plugin,[plugin]);
});

test('malformed plugin tuples still fail before changing any files',t=>{
  for(const plugin of [[['foreign']], [['foreign',null]], [['foreign',[]]], [[1,{}]], [['foreign',{},'extra']]]){
    const home=temp(t);put(home,`${oc}/opencode.jsonc`,{plugin});const before=snapshot(home);
    assert.throws(()=>install(options(home)),/plugin inválido/);assert.deepEqual(snapshot(home),before);
  }
});
