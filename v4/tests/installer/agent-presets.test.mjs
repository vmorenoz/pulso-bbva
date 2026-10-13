import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {planOpenCode} from '../../installer/opencode.mjs';
import {executePlans} from '../../installer/index.mjs';
import {parseConfig,removeAgentPresets} from '../../installer/lib/install-jsonc.mjs';
import {presetAgentNames,cleanupAgentPresets,prepareBackups,applyChanges} from '../../installer/lib/install-cleanup.mjs';

function write(root,p,value){const target=path.join(root,p);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,value);return target;}
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pulso-presets-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const home=path.join(dir,'home'),pkg=path.join(dir,'pkg');fs.mkdirSync(home);write(pkg,'package.json','{"version":"4.0.0"}');write(pkg,'plugin/index.mjs','export default {};');return {home,pkg};}
const source=`{ // global comment
  "model":"global/model", "variant":"global-variant",
  "agent": {
    "pulso": { /* before */ "model":"old", /* between */ "variant":"high", /* after */ "prompt":"keep", "permission":{"edit":"ask"}, "temperature":0.2 },
    "pulso-researcher": {"model":"old", "variant":"low"},
    "pulso-challenger": {"variant":"old"},
    "pulso-custom": {"model":"custom", "variant":"custom"},
    "build": {"model":"build", "variant":"build"}
  }
}`;
function check(text){const value=parseConfig(text);assert.equal(value.model,'global/model');assert.equal(value.variant,'global-variant');assert.deepEqual(value.agent.pulso,{prompt:'keep',permission:{edit:'ask'},temperature:0.2});assert.deepEqual(value.agent['pulso-researcher'],{});assert.deepEqual(value.agent['pulso-challenger'],{});assert.deepEqual(value.agent['pulso-custom'],{model:'custom',variant:'custom'});assert.deepEqual(value.agent.build,{model:'build',variant:'build'});for(const comment of ['global comment','before','between','after'])assert.ok(text.includes(comment));}

test('exact catalog and legacy names; property positions, comments and idempotence',()=>{
  const catalog=JSON.parse(fs.readFileSync(new URL('../../core/agents/catalog.json',import.meta.url),'utf8'));
  for(const id of [catalog.orchestrator.id,...catalog.specialists.map(x=>x.id)])assert.ok(presetAgentNames.includes(id));
  check(removeAgentPresets(source,presetAgentNames));
  for(const properties of ['"model":"m","variant":"v",','"variant":"v",/* retain */"model":"m"','"prompt":"p","model":"m"','"model":"m","prompt":"p"','"variant":"v"']){
    const text=`{"agent":{"pulso":{${properties}}}}`,next=removeAgentPresets(text,presetAgentNames);
    assert.equal(parseConfig(next).agent.pulso.model,undefined);assert.equal(parseConfig(next).agent.pulso.variant,undefined);
    if(text.includes('retain'))assert.ok(next.includes('retain'));
    assert.equal(removeAgentPresets(next,presetAgentNames),next);
  }
  for(const text of ['{}','{"agent":{"pulso":"prompt","pulso-custom":{"model":"m"}}}'])assert.equal(removeAgentPresets(text,presetAgentNames),text);
});

test('installation cleans coexisting JSON/JSONC across roots, backs up bytes, dry run and reinstall',t=>{
  const {home,pkg}=fixture(t),dirs=['.config/opencode','xdg/opencode','extra'];
  const paths=dirs.flatMap(dir=>['opencode.json','opencode.jsonc'].map(name=>`${dir}/${name}`));
  for(const p of paths)write(home,p,source);
  const options={home,packageRoot:pkg,env:{XDG_CONFIG_HOME:path.join(home,'xdg'),OPENCODE_CONFIG_DIR:path.join(home,'extra')}};
  const plan=planOpenCode(options);executePlans([plan],{dryRun:true});
  assert.deepEqual(plan.actions.filter(x=>x.action==='agent-presets').map(x=>x.path).sort(),[...paths].sort());
  assert.ok(plan.actions.some(x=>x.action==='create'));
  for(const p of paths)assert.equal(fs.readFileSync(path.join(home,p),'utf8'),source);
  assert.equal(executePlans([plan]).status,'complete');
  for(const p of paths){check(fs.readFileSync(path.join(home,p),'utf8'));assert.equal(fs.readFileSync(path.join(home,plan.backup,'files',p),'utf8'),source);}
  const again=planOpenCode(options);assert.equal(again.changes.size,0);assert.ok(!again.actions.some(x=>x.action==='agent-presets'));
  const receipt=JSON.parse(fs.readFileSync(path.join(home,plan.backup,'index.json'),'utf8'));
  for(const p of paths)assert.match(receipt.files.find(x=>x.path===p).reason,/model\/variant presets/);
});

test('final library pass composes pending edits and uses transaction backups',t=>{
  const {home}=fixture(t),p='global/opencode.jsonc';write(home,p,source);
  const changes=new Map([[p,Buffer.from(source.replace('global/model','changed/global'))]]);
  assert.deepEqual(cleanupAgentPresets(home,{dirs:['global']},changes),[p]);
  assert.equal(parseConfig(changes.get(p).toString()).model,'changed/global');
  const {originals,backup}=prepareBackups(home,changes,new Map([[p,'Native configuration before installation']]));
  applyChanges(home,changes,originals,{backup});
  assert.equal(fs.readFileSync(path.join(home,backup,'files',p),'utf8'),source);
  const again=new Map();cleanupAgentPresets(home,{dirs:['global']},again);assert.equal(again.size,0);
});

test('file overrides inside/outside home and relative paths remain preserved without new failures',t=>{
  for(const kind of ['inside','outside','relative']){
    const {home,pkg}=fixture(t),override=kind==='outside'?write(path.dirname(home),'external.jsonc',source):write(home,'overrides/custom.jsonc',source);
    const global='.config/opencode/opencode.jsonc';write(home,global,source);
    const env={OPENCODE_CONFIG:kind==='relative'?'overrides/custom.jsonc':override};
    const plan=planOpenCode({home,packageRoot:pkg,env});
    assert.ok(plan.warnings.some(x=>x.includes('file override; preserved')&&x.includes('may still supply presets')));
    assert.equal(executePlans([plan]).status,'complete');
    assert.equal(fs.readFileSync(override,'utf8'),source);check(fs.readFileSync(path.join(home,global),'utf8'));
  }
});

test('migration composes historical cleanup and final presets in both old and active configs',t=>{
  const {home,pkg}=fixture(t),oldDir='.config/opencode',newDir='new-global';
  const oldPath=`${oldDir}/opencode.jsonc`,newPath=`${newDir}/opencode.jsonc`;
  write(home,oldPath,source);
  assert.equal(executePlans([planOpenCode({home,packageRoot:pkg,env:{}})]).status,'complete');
  // Reinstate presets on the previously registered config, alongside a legacy plugin.
  const entry=pathToFileURL(path.join(home,'.pulso/runtimes/opencode-v1/plugin/index.mjs')).href;
  const beforeOld=JSON.stringify({...parseConfig(source),plugin:[entry,'./plugins/pulso-codegraph.mjs','foreign'],default_agent:'pulso'});
  write(home,oldPath,beforeOld);write(home,newPath,source);
  const beforeJson=JSON.stringify(parseConfig(source));write(home,`${oldDir}/opencode.json`,beforeJson);
  const options={home,packageRoot:pkg,env:{OPENCODE_CONFIG_DIR:path.join(home,newDir)},conflict:'backup-replace'};
  const plan=planOpenCode(options);
  assert.equal(executePlans([plan]).status,'complete');
  const old=parseConfig(fs.readFileSync(path.join(home,oldPath),'utf8'));
  assert.deepEqual(old.plugin,['foreign']);assert.equal(old.default_agent,undefined);
  assert.equal(old.agent.pulso.model,undefined);assert.equal(old.agent.pulso.variant,undefined);assert.equal(old.agent.pulso.prompt,'keep');
  check(fs.readFileSync(path.join(home,newPath),'utf8'));
  assert.deepEqual(parseConfig(fs.readFileSync(path.join(home,newPath),'utf8')).plugin,[entry]);
  for(const [p,original] of [[oldPath,beforeOld],[newPath,source],[`${oldDir}/opencode.json`,beforeJson]]){
    assert.ok(plan.actions.some(x=>x.path===p&&x.action==='agent-presets'));
    assert.equal(fs.readFileSync(path.join(home,plan.backup,'files',p),'utf8'),original);
    assert.equal(parseConfig(fs.readFileSync(path.join(home,p),'utf8')).agent.pulso.model,undefined);
  }
  assert.equal(planOpenCode(options).changes.size,0);
});

test('later transaction failure restores both cleaned configurations byte for byte',t=>{
  const {home,pkg}=fixture(t),paths=['.config/opencode/opencode.json','.config/opencode/opencode.jsonc'];
  for(const p of paths)write(home,p,source);
  const plan=planOpenCode({home,packageRoot:pkg,env:{}}),rename=fs.renameSync;let failed=false;
  fs.renameSync=(from,to)=>{if(!failed&&to===path.join(home,'.pulso/installations/opencode-v1.json')){failed=true;throw new Error('injected publication failure');}return rename(from,to);};
  let result;try{result=executePlans([plan]);}finally{fs.renameSync=rename;}
  assert.ok(failed);assert.equal(result.status,'failed');
  for(const p of paths)assert.equal(fs.readFileSync(path.join(home,p),'utf8'),source);
});
