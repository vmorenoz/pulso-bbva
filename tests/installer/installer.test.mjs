import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {planOpenCode,planInstallation,executePlans} from '../../installer/index.mjs';
import {resolveOpenCodeRoots} from '../../installer/opencode.mjs';
import {sha256,listFiles} from '../../installer/lib/fs.mjs';
import {parseConfig} from '../../installer/lib/install-jsonc.mjs';
import {parseArgs,resolvePackageDefaults} from '../../installer/cli.mjs';
import {build} from '../../scripts/build.mjs';
function write(root,p,value){const f=path.join(root,p);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,value);return f;}
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pulso-install-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const home=path.join(dir,'home');fs.mkdirSync(home);const pkg=path.join(dir,'package');write(pkg,'package.json',JSON.stringify({name:'pulso-opencode',version:'0.1.0',exports:'./plugin/index.mjs',pulso:{host:'opencode',apiVersion:2,hostVersion:'2.1.2'}}));write(pkg,'plugin/index.mjs','export default {};');write(pkg,'server.js',"export {default} from './plugin/index.mjs';\n");write(pkg,'resources/schemas/work.json','{}');write(pkg,'agents/pulso.md','[Schema](../resources/schemas/work.json)');write(pkg,'skills/bbva-example/SKILL.md','Exact BBVA bytes\n');return {dir,home,pkg};}
const options=f=>({home:f.home,packageRoot:f.pkg,env:{}});
test('BBVA consolidation: fresh install and managed migration preserve ownership policy and rollback', async t => {
  const f=fixture(t), next=path.join(f.dir,'next');
  await build('opencode',{outputRoot:next});
  const names=['bbva-apx','bbva-apx-testing','bbva-cells','bbva-cells-testing'];
  const native=name=>`.config/opencode/skills/${name}/SKILL.md`;
  const runtime=name=>`.pulso/runtimes/opencode-v2/skills/${name}/SKILL.md`;
  for(const name of names) write(f.pkg,`skills/${name}/SKILL.md`,`old ${name}`);
  // A matching pre-existing resource is borrowed, never acquired by the installer.
  write(f.home,native(names[1]),`old ${names[1]}`);
  executePlans([planOpenCode(options(f))]);
  write(f.home,native(names[2]),'user modified managed');
  write(f.home,'.agents/skills/bbva-cells/SKILL.md','shared user skill');
  write(f.home,'.config/opencode/skills/bbva-custom/SKILL.md','foreign');
  const opts={...options(f),packageRoot:next};
  assert.throws(()=>planOpenCode(opts),/backup-replace/);
  assert.equal(fs.readFileSync(path.join(f.home,native(names[2])),'utf8'),'user modified managed');
  const p=planOpenCode({...opts,conflict:'backup-replace'});
  executePlans([p],{dryRun:true});
  assert.ok(fs.existsSync(path.join(f.home,native(names[0]))));
  // Fail at publication after obsolete files have been removed, then restore them.
  const rename=fs.renameSync;let injected=false;
  fs.renameSync=(from,to)=>{if(!injected&&to===path.join(f.home,'.pulso/installations/opencode-v2.json')){injected=true;throw new Error('migration publication failure');}return rename(from,to);};
  let result;try{result=executePlans([p]);}finally{fs.renameSync=rename;}
  assert.equal(result.status,'failed');assert.equal(injected,true);
  for(const name of names) assert.ok(fs.existsSync(path.join(f.home,runtime(name))));
  assert.equal(fs.readFileSync(path.join(f.home,native(names[2])),'utf8'),'user modified managed');
  const retry=planOpenCode({...opts,conflict:'backup-replace'});
  assert.equal(executePlans([retry]).status,'complete');
  assert.equal(fs.readFileSync(path.join(f.home,retry.backup,'files',native(names[2])),'utf8'),'user modified managed');
  for(const name of names){assert.equal(fs.existsSync(path.join(f.home,runtime(name))),false);assert.equal(fs.existsSync(path.join(f.home,native(name))),name===names[1]);}
  assert.equal(fs.readFileSync(path.join(f.home,native(names[1])),'utf8'),`old ${names[1]}`);
  assert.equal(fs.readFileSync(path.join(f.home,'.agents/skills/bbva-cells/SKILL.md'),'utf8'),'shared user skill');
  assert.equal(fs.readFileSync(path.join(f.home,'.config/opencode/skills/bbva-custom/SKILL.md'),'utf8'),'foreign');
  assert.equal(planOpenCode(opts).changes.size,0);
  const fresh=path.join(f.dir,'fresh');fs.mkdirSync(fresh);
  assert.equal(executePlans([planOpenCode({...opts,home:fresh})]).status,'complete');
  assert.deepEqual(fs.readdirSync(path.join(fresh,'.config/opencode/skills')).filter(x=>x.startsWith('bbva-')),['bbva-engineering']);
  assert.equal(planOpenCode({...opts,home:fresh}).changes.size,0);
});

test('historical BBVA owned skills are removed but borrowed and unowned legacy names survive',t=>{
  const f=fixture(t),oc='.config/opencode',owned=`${oc}/skills/bbva-apx/SKILL.md`,borrowed=`${oc}/skills/bbva-cells/SKILL.md`,foreign=`${oc}/skills/bbva-apx-testing/SKILL.md`;
  for(const p of [owned,borrowed,foreign])write(f.home,p,p);
  write(f.home,'.pulso/installation.json',JSON.stringify({schemaVersion:1,version:'3.0.0',scope:'global',runtimes:['opencode'],opencodeDir:oc,files:{[owned]:sha256(owned),[borrowed]:sha256(borrowed)},borrowed:[borrowed]}));
  assert.equal(executePlans([planOpenCode(options(f))]).status,'complete');
  assert.equal(fs.existsSync(path.join(f.home,owned)),false);
  for(const p of [borrowed,foreign])assert.equal(fs.readFileSync(path.join(f.home,p),'utf8'),p);
  assert.equal(planOpenCode(options(f)).changes.size,0);
});
test('global dry run creates no directories and package resources relocate',t=>{const f=fixture(t),p=planOpenCode(options(f));assert.deepEqual(fs.readdirSync(f.home),[]);executePlans([p],{dryRun:true});assert.deepEqual(fs.readdirSync(f.home),[]);assert.equal(executePlans([p]).status,'complete');assert.match(fs.readFileSync(path.join(f.home,'.config/opencode/agents/pulso.md'),'utf8'),/file:.*runtimes\/opencode-v2\/resources\/schemas/);assert.equal(fs.readFileSync(path.join(f.home,'.config/opencode/skills/bbva-example/SKILL.md'),'utf8'),'Exact BBVA bytes\n');assert.equal(planOpenCode(options(f)).changes.size,0);});
test('XDG and additive CONFIG_DIR roots; CONFIG never a directory; relative and outside rejected',t=>{const f=fixture(t),r=resolveOpenCodeRoots(f.home,{XDG_CONFIG_HOME:path.join(f.home,'cfg'),OPENCODE_CONFIG_DIR:path.join(f.home,'extra')});assert.deepEqual(r.roots,['cfg/opencode','extra']);assert.throws(()=>resolveOpenCodeRoots(f.home,{OPENCODE_CONFIG_DIR:'relative'}),/absolute/);assert.throws(()=>resolveOpenCodeRoots(f.home,{OPENCODE_CONFIG_DIR:'/outside'}));const p=planOpenCode({...options(f),env:{OPENCODE_CONFIG:'/arbitrary/config.json'}});assert.ok(p.warnings.some(x=>x.includes('file override')));});
test('foreign collision remains unchanged even with explicit backup choice',t=>{const f=fixture(t);write(f.home,'.pulso/runtimes/opencode-v2/plugin/index.mjs','foreign');assert.throws(()=>planOpenCode({...options(f),conflict:'backup-replace'}),/Foreign/);assert.equal(fs.readFileSync(path.join(f.home,'.pulso/runtimes/opencode-v2/plugin/index.mjs'),'utf8'),'foreign');});
test('changed owned files default abort; explicit choice creates verified backup',t=>{const f=fixture(t);executePlans([planOpenCode(options(f))]);write(f.home,'.config/opencode/agents/pulso.md','custom');assert.throws(()=>planOpenCode(options(f)),/backup-replace/);const p=planOpenCode({...options(f),conflict:'backup-replace'});executePlans([p]);assert.equal(fs.readFileSync(path.join(f.home,p.backup,'files/.config/opencode/agents/pulso.md'),'utf8'),'custom');});
test('native plugin options comments and borrowed registrations are preserved',t=>{const f=fixture(t),entry=pathToFileURL(path.join(f.home,'.pulso/runtimes/opencode-v2')).href;write(f.home,'.config/opencode/opencode.jsonc',`{ // keep comment\n"plugins":[{"package":${JSON.stringify(entry)},"options":{"ownedBy":"user"}},"foreign"],"theme":"dark"}`);executePlans([planOpenCode(options(f))]);const text=fs.readFileSync(path.join(f.home,'.config/opencode/opencode.jsonc'),'utf8'),value=parseConfig(text);assert.match(text,/keep comment/);assert.deepEqual(value.plugins[0],{package:entry,options:{ownedBy:'user'}});assert.equal(value.theme,'dark');assert.equal(JSON.parse(fs.readFileSync(path.join(f.home,'.pulso/installations/opencode-v2.json'))).pluginConfig.existing,true);});
test('invalid JSONC duplicate keys and symlink collisions fail preflight',t=>{const f=fixture(t);write(f.home,'.config/opencode/opencode.jsonc','{"x":1,"x":2}');assert.throws(()=>planOpenCode(options(f)),/duplicadas/);fs.unlinkSync(path.join(f.home,'.config/opencode/opencode.jsonc'));fs.symlinkSync(f.pkg,path.join(f.home,'.config/opencode/agents'));assert.throws(()=>planOpenCode(options(f)),/Symlink/);});
test('legacy config.json preserved and warned; shared user/work data untouched',t=>{const f=fixture(t);const paths=['.config/opencode/config.json','.pulso/preferences.json','.pulso/identity.json','.pulso/registry.json','.pulso/projects/a/work.json'];for(const p of paths)write(f.home,p,'{}');const p=planOpenCode(options(f));assert.ok(p.warnings.some(x=>x.includes('config.json')));executePlans([p]);for(const q of paths)assert.equal(fs.readFileSync(path.join(f.home,q),'utf8'),'{}');});
test('exact pre-manifest legacy file needs explicit choice, foreign lookalike survives',t=>{const f=fixture(t);write(f.home,'.config/opencode/plugins/pulso-circuit-breaker.mjs','old');write(f.home,'.config/opencode/plugins/pulso-circuit-breaker-custom.mjs','foreign');assert.throws(()=>planOpenCode(options(f)),/backup-replace/);executePlans([planOpenCode({...options(f),conflict:'backup-replace'})]);assert.ok(!fs.existsSync(path.join(f.home,'.config/opencode/plugins/pulso-circuit-breaker.mjs')));assert.ok(fs.existsSync(path.join(f.home,'.config/opencode/plugins/pulso-circuit-breaker-custom.mjs')));});
test('CLI rejects host selection and unsupported options; yes does not imply conflict override',()=>{assert.deepEqual(parseArgs(['--yes']),{yes:true});for(const args of [['--targets','opencode'],['--vsix','x'],['--code','x'],['--overwrite-foreign'],['--yes','--yes'],['--host','opencode'],['--host','pulso']])assert.throws(()=>parseArgs(args));});
test('planned OpenCode changed file aborts before writes',t=>{const f=fixture(t),p=planOpenCode(options(f));write(f.home,'.config/opencode/agents/pulso.md','raced');assert.equal(executePlans([p]).status,'failed');assert.ok(!fs.existsSync(path.join(f.home,'.pulso/installations/opencode-v2.json')));});
test('malformed isolated manifest cannot authorize data deletion',t=>{const f=fixture(t);write(f.home,'.pulso/installations/opencode-v2.json',JSON.stringify({schemaVersion:1,runtime:'opencode-v2',files:{'.pulso/preferences.json':'a'.repeat(64)},borrowed:[],configRoots:['.config/opencode']}));assert.throws(()=>planOpenCode(options(f)),/Unsafe isolated ownership/);});
test('historical coexisting manifests split native ownership but retain shared core/foreign data',t=>{const f=fixture(t),oc='.config/opencode';write(f.home,`${oc}/plugins/pulso-codegraph.mjs`,'old plugin');write(f.home,'.pulso/lib/shared.mjs','shared');write(f.home,'.copilot/agents/pulso.md','foreign');write(f.home,'.pulso/installation.json',JSON.stringify({schemaVersion:1,version:'3.0.0',scope:'global',runtimes:['both'],opencodeDir:oc,files:{[`${oc}/plugins/pulso-codegraph.mjs`]:sha256('old plugin'),'.pulso/lib/shared.mjs':sha256('shared'),'.copilot/agents/pulso.md':sha256('foreign')}}));executePlans([planOpenCode(options(f))]);const old=JSON.parse(fs.readFileSync(path.join(f.home,'.pulso/installation.json')));assert.deepEqual(old.runtimes,['vscode']);assert.ok(!Object.hasOwn(old.files,`${oc}/plugins/pulso-codegraph.mjs`));assert.equal(fs.readFileSync(path.join(f.home,'.pulso/lib/shared.mjs'),'utf8'),'shared');assert.equal(fs.readFileSync(path.join(f.home,'.copilot/agents/pulso.md'),'utf8'),'foreign');});
test('shared BBVA skill is preserved without duplicate native installation',t=>{const f=fixture(t);write(f.home,'.agents/skills/bbva-example/SKILL.md','custom shared');executePlans([planOpenCode(options(f))]);assert.ok(!fs.existsSync(path.join(f.home,'.config/opencode/skills/bbva-example/SKILL.md')));assert.equal(fs.readFileSync(path.join(f.home,'.agents/skills/bbva-example/SKILL.md'),'utf8'),'custom shared');});
test('persistent native file restoration failure retains verified only backup',t=>{const f=fixture(t),agent='.config/opencode/agents/pulso.md',config='.config/opencode/opencode.jsonc';write(f.home,agent,'only customized bytes');write(f.home,config,'{}');const p=planOpenCode({...options(f),conflict:'backup-replace'}),rename=fs.renameSync;let injected=false;fs.renameSync=(from,to)=>{if(to===path.join(f.home,config)&&!injected){injected=true;throw new Error('initial failure');}if(injected&&to===path.join(f.home,agent))throw new Error('persistent restore failure');return rename(from,to);};let result;try{result=executePlans([p]);}finally{fs.renameSync=rename;}assert.equal(result.status,'failed');assert.match(result.results[0].error,/rollback incompleto/);assert.equal(fs.readFileSync(path.join(f.home,p.backup,'files',agent),'utf8'),'only customized bytes');});
test('v2 MCP cleanup only exact payload hash and tuple foreign comments preserved',t=>{for(let version=1;version<=5;version++){const f=fixture(t),oc='.config/opencode',mcp={command:['old']};write(f.home,`${oc}/opencode.json`,JSON.stringify({mcp:{pulso:mcp,other:{command:['keep']}}}));write(f.home,`${oc}/.pulso-manifest.json`,JSON.stringify({version,runtime:'opencode',scope:'global',files:{},configEntries:{[version===1?'opencode.json':'opencode.json#mcp.pulso']:sha256(JSON.stringify(mcp))}}));executePlans([planOpenCode(options(f))]);assert.deepEqual(parseConfig(fs.readFileSync(path.join(f.home,oc,'opencode.json'),'utf8')).mcp,{other:{command:['keep']}});}});
test('JSONC tuple exact removal covers outer commas and preserves comments',t=>{const owned='["./plugins/pulso-codegraph.mjs",{"nested":[1,2]}]',foreign='["foreign",{"nested":[3,4]}]';for(const array of [`${owned},/* first */${foreign}`,`${foreign},/* last */${owned}`,`/* sole */${owned},`]){const f=fixture(t);write(f.home,'.config/opencode/opencode.jsonc',`{"plugin":[${array}],}`);executePlans([planOpenCode({...options(f),conflict:'backup-replace'})]);const text=fs.readFileSync(path.join(f.home,'.config/opencode/opencode.jsonc'),'utf8'),plugins=parseConfig(text).plugin;assert.ok(!plugins.some(x=>Array.isArray(x)&&x[0].includes('codegraph')));assert.match(text,/\/\* (first|last|sole) \*\//);if(array.includes('foreign'))assert.deepEqual(plugins[0],['foreign',{nested:[3,4]}]);}});
test('borrowed managed filename is never replaced even with conflict backup-replace',t=>{const f=fixture(t),agent='.config/opencode/agents/pulso.md';const data=fs.readFileSync(path.join(f.pkg,'agents/pulso.md'),'utf8').replace('../resources/schemas/work.json',pathToFileURL(path.join(f.home,'.pulso/runtimes/opencode-v2/resources/schemas/work.json')).href);write(f.home,agent,data);executePlans([planOpenCode(options(f))]);write(f.home,agent,'custom user revision');assert.throws(()=>planOpenCode({...options(f),conflict:'backup-replace'}),/Borrowed resource/);assert.equal(fs.readFileSync(path.join(f.home,agent),'utf8'),'custom user revision');});
test('reinstall preserves a user-selected default agent and original restoration value',t=>{const f=fixture(t),p='.config/opencode/opencode.jsonc';write(f.home,p,'{"default_agent":"build"}');executePlans([planOpenCode(options(f))]);const value=parseConfig(fs.readFileSync(path.join(f.home,p),'utf8'));write(f.home,p,JSON.stringify({...value,default_agent:'custom'}));executePlans([planOpenCode(options(f))]);assert.equal(parseConfig(fs.readFileSync(path.join(f.home,p),'utf8')).default_agent,'custom');assert.equal(JSON.parse(fs.readFileSync(path.join(f.home,'.pulso/installations/opencode-v2.json'))).pluginConfig.defaultAgent.previous,'build');});
test('unrelated historical ownership does not authorize unowned legacy plugin config cleanup',t=>{const f=fixture(t),oc='.config/opencode';write(f.home,`${oc}/opencode.jsonc`,'{"plugin":["./plugins/pulso-codegraph.mjs"]}');write(f.home,`${oc}/.pulso-install.json`,JSON.stringify({schema_version:1,managed_by:'pulso',files:{}}));assert.throws(()=>planOpenCode(options(f)),/Legacy config cleanup requires/);assert.equal(parseConfig(fs.readFileSync(path.join(f.home,oc,'opencode.jsonc'),'utf8')).plugin.length,1);});

test('CLI defaults resolve existing native package; explicit paths win and missing guides build',t=>{
  const f=fixture(t);write(f.dir,'dist/opencode/package.json','{}');
  assert.equal(resolvePackageDefaults({},{root:f.dir})['opencode-package'],path.join(f.dir,'dist/opencode'));
  assert.equal(resolvePackageDefaults({'opencode-package':'/chosen/oc'},{root:'/absent'})['opencode-package'],'/chosen/oc');
  assert.throws(()=>resolvePackageDefaults({},{root:'/absent'}),/build:opencode/);
});
test('unsupported installation targets cannot silently select or change another host',t=>{
 const f=fixture(t);assert.throws(()=>planInstallation({targets:['opencode'],opencode:options(f)}),/Only OpenCode installation/);
 assert.throws(()=>planInstallation({opencode:options(f),pulso:options(f)}),/Only OpenCode installation/);
 assert.throws(()=>planInstallation({pulso:options(f)}),/Only OpenCode installation/);
 assert.deepEqual(fs.readdirSync(f.home),[]);
});

function oldInstallation(f,{borrowedPlugin=false,borrowedSkill=false}={}){
 const root='.pulso/runtimes/opencode-v1',agent='.config/opencode/agents/pulso.md',skill='.config/opencode/skills/bbva-old/SKILL.md';
 const inventory={[`${root}/plugin/index.mjs`]:'export const PulsoPlugin = async () => ({});',[`${root}/package.json`]:'{"version":"4.2.0"}',[agent]:'previous agent',[skill]:'old borrowed skill'};
 for(const [p,bytes] of Object.entries(inventory))write(f.home,p,bytes);
 write(f.home,`${root}/user-notes.txt`,'foreign runtime notes');
 const config='.config/opencode/opencode.jsonc',entry=pathToFileURL(path.join(f.home,root,'plugin/index.mjs')).href;
 const source=`{ // prior config\n"plugin":[["foreign",{"x":[1,2]}],${JSON.stringify(entry)}],"plugins":[{"package":"native-foreign","options":{"x":2}}],"default_agent":"pulso","model":"keep/model"}`;
 write(f.home,config,source);
 write(f.home,'.pulso/installations/opencode-v1.json',JSON.stringify({schemaVersion:1,runtime:'opencode-v1',version:'4.2.0',configRoots:['.config/opencode'],files:Object.fromEntries(Object.entries(inventory).map(([p,bytes])=>[p,sha256(bytes)])),borrowed:borrowedSkill?[skill]:[],pluginConfig:{path:config,entry,existing:borrowedPlugin,defaultAgent:{previous:'build'}}}));
 return {root,agent,skill,config,entry,source,inventory};
}
test('managed V1 upgrade removes only inventoried runtime, keeps foreign configuration and is idempotent',t=>{
 const f=fixture(t),old=oldInstallation(f);
 const before=Object.fromEntries(listFiles(f.home).map(p=>[p,fs.readFileSync(path.join(f.home,p),'utf8')]));
 const plan=planOpenCode(options(f));assert.equal(executePlans([plan],{dryRun:true}).dryRun,true);
 assert.deepEqual(Object.fromEntries(listFiles(f.home).map(p=>[p,fs.readFileSync(path.join(f.home,p),'utf8')])),before);
 assert.equal(executePlans([plan]).status,'complete');
 const config=parseConfig(fs.readFileSync(path.join(f.home,old.config),'utf8'));
 assert.deepEqual(config.plugin,[['foreign',{x:[1,2]}]]);
 assert.deepEqual(config.plugins,[{package:'native-foreign',options:{x:2}},pathToFileURL(path.join(f.home,'.pulso/runtimes/opencode-v2')).href]);
 assert.equal(config.model,'keep/model');assert.equal(config.default_agent,'pulso');
 assert.match(fs.readFileSync(path.join(f.home,old.config),'utf8'),/prior config/);
 assert.equal(fs.existsSync(path.join(f.home,old.root,'plugin/index.mjs')),false);
 assert.equal(fs.readFileSync(path.join(f.home,old.root,'user-notes.txt'),'utf8'),'foreign runtime notes');
 assert.equal(fs.existsSync(path.join(f.home,'.pulso/installations/opencode-v1.json')),false);
 assert.equal(JSON.parse(fs.readFileSync(path.join(f.home,'.pulso/installations/opencode-v2.json'))).pluginConfig.defaultAgent.previous,'build');
 for(const [p,bytes] of Object.entries(old.inventory))assert.equal(fs.readFileSync(path.join(f.home,plan.backup,'files',p),'utf8'),bytes);
 assert.equal(planOpenCode(options(f)).changes.size,0);
});
test('V1 upgrade rollback restores old runtime and registration before retry; modified files require backup choice',t=>{
 const f=fixture(t),old=oldInstallation(f);write(f.home,old.agent,'user modified old agent');
 assert.throws(()=>planOpenCode(options(f)),/backup-replace/);
 const snapshot=()=>Object.fromEntries(listFiles(f.home).map(p=>[p,sha256(fs.readFileSync(path.join(f.home,p)))]));
 const before=snapshot(),plan=planOpenCode({...options(f),conflict:'backup-replace'}),rename=fs.renameSync;let injected=false;
 fs.renameSync=(a,b)=>{if(!injected&&b===path.join(f.home,'.pulso/installations/opencode-v2.json')){injected=true;throw new Error('new publication failed');}return rename(a,b);};
 let result;try{result=executePlans([plan]);}finally{fs.renameSync=rename;}
 assert.equal(result.status,'failed');assert.equal(injected,true);assert.deepEqual(snapshot(),before);
 assert.equal(executePlans([planOpenCode({...options(f),conflict:'backup-replace'})]).status,'complete');
 assert.equal(planOpenCode(options(f)).changes.size,0);
});
test('V1 borrowed registrations block upgrade without touching foreign ownership',t=>{
 const f=fixture(t),old=oldInstallation(f,{borrowedPlugin:true});
 for(const conflict of ['abort','backup-replace'])assert.throws(()=>planOpenCode({...options(f),conflict}),/Borrowed OpenCode V1 registration/);
 assert.equal(fs.readFileSync(path.join(f.home,old.config),'utf8'),old.source);
 assert.equal(fs.existsSync(path.join(f.home,'.pulso/runtimes/opencode-v2')),false);
});
test('V1 borrowed obsolete skill remains owned by original user and survives repeated upgrade',t=>{
 const f=fixture(t),old=oldInstallation(f,{borrowedSkill:true});
 assert.equal(executePlans([planOpenCode(options(f))]).status,'complete');
 assert.equal(fs.readFileSync(path.join(f.home,old.skill),'utf8'),'old borrowed skill');
 const retained=JSON.parse(fs.readFileSync(path.join(f.home,'.pulso/installations/opencode-v1.json')));
 assert.deepEqual(Object.keys(retained.files),[old.skill]);assert.equal(retained.pluginConfig,undefined);
 assert.equal(planOpenCode(options(f)).changes.size,0);
});
test('installer rejects incompatible, mis-versioned and file-entrypoint payloads before any write',t=>{
 for(const change of [{version:'4.2.0'},{version:'0.2.0'},{exports:'./plugin/other.mjs'},{pulso:{host:'opencode',apiVersion:1,hostVersion:'1.18.2'}}]){
  const f=fixture(t),pkg=JSON.parse(fs.readFileSync(path.join(f.pkg,'package.json')));write(f.pkg,'package.json',JSON.stringify({...pkg,...change}));
  assert.throws(()=>planOpenCode(options(f)),/native OpenCode 2.1.2/);assert.deepEqual(fs.readdirSync(f.home),[]);
 }
});
test('native duplicate path aliases and borrowed legacy directory references fail without duplicate installation',t=>{
 for(const legacy of [false,true]){
  const f=fixture(t),absolute=path.join(f.home,'.pulso/runtimes/opencode-v2'),entry=pathToFileURL(absolute).href;
  write(f.home,'.config/opencode/opencode.jsonc',JSON.stringify(legacy?{plugin:[entry]}:{plugins:[entry,{package:absolute}]}));
  assert.throws(()=>planOpenCode(options(f)),legacy?/Borrowed legacy Pulso/:/Duplicate native/);
  assert.equal(fs.existsSync(absolute),false);
 }
});


test('OpenCode installation leaves unrelated profiles and inventories unread and unchanged',t=>{
 const f=fixture(t),paths=['.config/other/other.jsonc','.config/other/agents/pulso.md','.pulso/installations/other-v2.json','.pulso/runtimes/other-v2/plugin/index.mjs'];
 for(const p of paths)write(f.home,p,`unrelated unparsed bytes ${p}`);
 const before=Object.fromEntries(paths.map(p=>[p,fs.readFileSync(path.join(f.home,p),'utf8')]));
 assert.equal(executePlans([planOpenCode(options(f))]).status,'complete');
 assert.deepEqual(Object.fromEntries(paths.map(p=>[p,fs.readFileSync(path.join(f.home,p),'utf8')])),before);
 assert.equal(planOpenCode(options(f)).changes.size,0);
});

test('custom OpenCode roots cannot contain the entire global config directory',t=>{
 const f=fixture(t);
 for(const env of [{OPENCODE_CONFIG_DIR:path.join(f.home,'.config')},{XDG_CONFIG_HOME:path.join(f.home,'cfg'),OPENCODE_CONFIG_DIR:path.join(f.home,'cfg')}]){
  assert.throws(()=>planOpenCode({...options(f),env}),/cannot contain the global config directory/);
  assert.deepEqual(fs.readdirSync(f.home),[]);
 }
});

test('OpenCode native config cleanup preserves comments, permissions and file overrides',t=>{
 const f=fixture(t),config='.config/opencode/opencode.jsonc',source='{ // keep\n"agents":{"pulso":{"model":"old","variant":"fast","permission":{"shell":"deny"}},"other":{"model":"keep"}},"model":"global"}';
 write(f.home,config,source);write(f.home,'override.json',source);
 const plan=planOpenCode({...options(f),env:{OPENCODE_CONFIG:path.join(f.home,'override.json')}});
 assert.equal(executePlans([plan]).status,'complete');assert.ok(plan.backup.startsWith('.pulso/backups/opencode-'));
 const text=fs.readFileSync(path.join(f.home,config),'utf8'),parsed=parseConfig(text);
 assert.match(text,/keep/);assert.deepEqual(parsed.agents.pulso,{permission:{shell:'deny'}});assert.equal(parsed.agents.other.model,'keep');assert.equal(parsed.model,'global');
 assert.equal(fs.readFileSync(path.join(f.home,plan.backup,'files',config),'utf8'),source);
 assert.equal(fs.readFileSync(path.join(f.home,'override.json'),'utf8'),source);
});

test('OpenCode rollback restores its inventory and modified resources',t=>{
 const f=fixture(t);executePlans([planOpenCode(options(f))]);
 write(f.home,'.config/opencode/agents/pulso.md','custom Pulso bytes');
 assert.throws(()=>planOpenCode(options(f)),/backup-replace/);
 const snapshot=()=>Object.fromEntries(listFiles(f.home).map(p=>[p,sha256(fs.readFileSync(path.join(f.home,p)))])),before=snapshot();
 const plan=planOpenCode({...options(f),conflict:'backup-replace'}),rename=fs.renameSync;let injected=false;
 fs.renameSync=(from,to)=>{if(!injected&&to===path.join(f.home,'.config/opencode/agents/pulso.md')){injected=true;throw new Error('Pulso update failure');}return rename(from,to);};
 let result;try{result=executePlans([plan]);}finally{fs.renameSync=rename;}
 assert.equal(result.status,'failed');assert.equal(injected,true);assert.deepEqual(snapshot(),before);
 assert.equal(executePlans([planOpenCode({...options(f),conflict:'backup-replace'})]).status,'complete');
 assert.equal(planOpenCode(options(f)).changes.size,0);
});


test('registration aliases across global config files never create duplicate native loads',t=>{
 for(const borrowed of [false,true]){
  const f=fixture(t),planner=planOpenCode,entry=pathToFileURL(path.join(f.home,'.pulso/runtimes/opencode-v2')).href;
  const root='.config/opencode',prior=`${root}/opencode.json`;
  if(borrowed){write(f.home,prior,JSON.stringify({plugins:[{package:entry,options:{ownedBy:'user'}}]}));executePlans([planner(options(f))]);}
  else {write(f.home,prior,JSON.stringify({plugins:[entry]}));write(f.home,`${root}/opencode.jsonc`,'{}');}
  const snapshot=()=>Object.fromEntries(listFiles(f.home).map(p=>[p,sha256(fs.readFileSync(path.join(f.home,p)))])),before=snapshot();
  const env=borrowed?{OPENCODE_CONFIG_DIR:path.join(f.home,'next')}:{};
  for(const conflict of ['abort','backup-replace'])assert.throws(()=>planner({...options(f),env,conflict}),/registration exists in another config file/);
  assert.deepEqual(snapshot(),before);
 }
});

test('OpenCode managed config-directory change migrates only its owned entry and restores former default',t=>{
 const f=fixture(t),old='.config/opencode/opencode.jsonc';write(f.home,old,'{"default_agent":"build","plugins":["foreign"]}');
 executePlans([planOpenCode(options(f))]);
 const env={OPENCODE_CONFIG_DIR:path.join(f.home,'custom-opencode')},plan=planOpenCode({...options(f),env});
 assert.equal(executePlans([plan]).status,'complete');
 const previous=parseConfig(fs.readFileSync(path.join(f.home,old),'utf8')),next=parseConfig(fs.readFileSync(path.join(f.home,'custom-opencode/opencode.jsonc'),'utf8'));
 assert.deepEqual(previous.plugins,['foreign']);assert.equal(previous.default_agent,'build');
 assert.deepEqual(next.plugins,[pathToFileURL(path.join(f.home,'.pulso/runtimes/opencode-v2')).href]);assert.equal(next.default_agent,'pulso');
 assert.equal(fs.existsSync(path.join(f.home,'.config/opencode/agents/pulso.md')),false);
 assert.equal(planOpenCode({...options(f),env}).changes.size,0);
});


test('native loader facade is required before planning installation',t=>{
 const f=fixture(t);fs.unlinkSync(path.join(f.pkg,'server.js'));
 assert.throws(()=>planOpenCode(options(f)),/native plugin entrypoint: server\.js/);
 assert.deepEqual(fs.readdirSync(f.home),[]);
});
