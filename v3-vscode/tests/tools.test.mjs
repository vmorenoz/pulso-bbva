import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createPulsoTools,toolDefinitions,validateInput} from '../src/tools.mjs';

// The build runner can point this same suite at resources/lib after copying core.
const coreDir = process.env.PULSO_TEST_CORE_DIR || fileURLToPath(new URL('../resources/lib/',import.meta.url));
async function fixture(t, options = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(),'pulso-vscode-tools-'));
  t.after(() => fs.rmSync(temp,{recursive:true,force:true}));
  const root = path.join(temp,'workspace'), homeDir = path.join(temp,'home');
  fs.mkdirSync(root); fs.mkdirSync(homeDir);
  const tools = await createPulsoTools({coreDir,homeDir,...options});
  const run = (name,input) => tools[name].execute(input,root);
  return {root,homeDir,tools,run};
}
function snapshot(root) {
  return fs.readdirSync(root,{withFileTypes:true}).sort((a,b) => a.name.localeCompare(b.name)).map(entry => [entry.name,entry.isDirectory() ? snapshot(path.join(root,entry.name)) : fs.readFileSync(path.join(root,entry.name),'utf8')]);
}
async function success(run,name,input) {
  const result = await run(name,input);
  assert.equal(result.ok,true,result.output);
  assert.ok(['ok','output','title'].every(key => Object.hasOwn(result,key)));
  assert.equal(typeof result.output,'string');
  return result;
}
const create = {action:'create',workId:'WORK-1',title:'Objetivo',objective:'Implementar el objetivo',criterion:'Comportamiento correcto',verification:'Revisar evidencia'};

test('four host-neutral definitions and lazy factory/status produce no files',async t => {
  const {root,homeDir,run,tools} = await fixture(t,{coreDir:'/missing/pulso/core'});
  assert.equal(toolDefinitions.length,4);
  assert.deepEqual(Object.keys(tools),toolDefinitions.map(value => value.name));
  for (const def of toolDefinitions) {
    assert.equal(def.toolReferenceName,def.name);
    assert.equal(def.canBeReferencedInPrompt,true);
    assert.equal(typeof def.displayName,'string');
    assert.equal(typeof def.modelDescription,'string');
    assert.equal(def.inputSchema.additionalProperties,false);
  }
  assert.match((await success(run,'pulso_workspace',{action:'status'})).output,/Sin estado/);
  assert.deepEqual(snapshot(root),[]);
  assert.deepEqual(snapshot(homeDir),[]);
});

test('prepare/create/update stale/get/sync/block/close/history/reopen/recover/validate',async t => {
  const {root,homeDir,run} = await fixture(t);
  await success(run,'pulso_workspace',{action:'prepare'});
  assert.match((await success(run,'pulso_workspace',{action:'prepare'})).output,/Ya estaba/);
  await success(run,'pulso_work',create);
  assert.match((await success(run,'pulso_work',{action:'get',workId:'WORK-1'})).output,/rev\. 1/);
  await success(run,'pulso_work',{action:'update',workId:'WORK-1',expectedRevision:1,actions:[{type:'work.set_overview',summary:'Avance',nextAction:'Revisar'}]});
  const before = snapshot(root);
  const stale = await run('pulso_work',{action:'update',workId:'WORK-1',expectedRevision:1,actions:[{type:'work.set_overview',summary:'Obsoleto'}]});
  assert.equal(stale.ok,false);
  assert.match(stale.output,/Revisión obsoleta/);
  assert.deepEqual(snapshot(root),before);
  await success(run,'pulso_workspace',{action:'sync',workId:'WORK-1',expectedRevision:2});
  await success(run,'pulso_work',{action:'block',workId:'WORK-1',expectedRevision:2,summary:'Bloqueado',reason:'Dependencia pendiente'});
  await success(run,'pulso_work',{action:'close',workId:'WORK-1',expectedRevision:3,outcome:'cancelled',summary:'Cancelado por cambio de alcance'});
  assert.match((await success(run,'pulso_history',{workId:'WORK-1',limit:1})).output,/WORK-1 · cancelled/);
  await success(run,'pulso_work',{action:'reopen',workId:'WORK-1',expectedRevision:4,reason:'Retomar alcance'});
  await success(run,'pulso_workspace',{action:'recover'});
  await success(run,'pulso_workspace',{action:'validate',fresh:true});
  const prepared = snapshot(root), home = snapshot(homeDir);
  await success(run,'pulso_workspace',{action:'status'});
  await success(run,'pulso_work',{action:'get',workId:'WORK-1'});
  await success(run,'pulso_history',{});
  assert.deepEqual(snapshot(root),prepared);
  assert.deepEqual(snapshot(homeDir),home);
});

test('project and user memory isolated; user preferences persist across workspaces and tool instances',async t => {
  const {root,homeDir,run} = await fixture(t);
  t.mock.method(os,'homedir',() => {throw new Error('Tools must use the injected home');});
  const environment = {...process.env};
  await success(run,'pulso_context',{action:'summary'});
  assert.deepEqual(snapshot(root),[]);
  assert.deepEqual(snapshot(homeDir),[]);
  await success(run,'pulso_context',{action:'set_context',scope:'project',expectedRevision:1,context:' Contexto de prueba '});
  await success(run,'pulso_context',{action:'set_preference',key:'idioma',value:'es',scope:'project',expectedRevision:2,source:'user'});
  await success(run,'pulso_context',{action:'add_learning',note:'Aprendizaje',scope:'project',expectedRevision:3,source:'observed'});
  assert.match((await success(run,'pulso_context',{action:'summary'})).output,/1 del proyecto, 0 del usuario · aprendizajes: 1/);
  await success(run,'pulso_context',{action:'remove_preference',scope:'project',expectedRevision:4,key:'idioma'});
  const before = snapshot(root);
  await success(run,'pulso_context',{action:'set_preference',scope:'user',expectedRevision:1,key:'idioma',value:'es',source:'user'});
  await success(run,'pulso_context',{action:'set_context',scope:'user',expectedRevision:2,context:'Contexto usuario'});
  await success(run,'pulso_context',{action:'add_learning',scope:'user',expectedRevision:3,note:'Aprendizaje usuario',source:'user'});
  const secondRoot = path.join(path.dirname(root),'second-workspace');
  fs.mkdirSync(secondRoot);
  const secondTools = await createPulsoTools({coreDir,homeDir});
  const secondRun = (name,input) => secondTools[name].execute(input,secondRoot);
  const homeBefore = snapshot(homeDir);
  assert.match((await success(secondRun,'pulso_context',{action:'summary',scope:'user'})).output,/preferencias: 1 del usuario/);
  assert.deepEqual(snapshot(secondRoot),[]);
  assert.deepEqual(snapshot(homeDir),homeBefore);
  const saved = JSON.parse(fs.readFileSync(path.join(homeDir,'.pulso','preferences.json'),'utf8'));
  assert.equal(saved.context,'Contexto usuario');
  assert.equal(saved.learning[0].note,'Aprendizaje usuario');
  assert.equal(saved.preferences[0].value,'es');
  await success(secondRun,'pulso_context',{action:'remove_preference',scope:'user',expectedRevision:4,key:'idioma'});
  assert.match((await success(run,'pulso_context',{action:'summary'})).output,/0 del proyecto, 0 del usuario/);
  assert.deepEqual(snapshot(root),before);
  assert.deepEqual(snapshot(secondRoot),[]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(homeDir,'.pulso','preferences.json'),'utf8')).preferences,[]);
  assert.deepEqual({...process.env},environment);
});

test('attempts and reconciliation are read-only and retain unknown liveness',async t => {
  const {root,run} = await fixture(t);
  await success(run,'pulso_workspace',{action:'attempts'});
  assert.deepEqual(snapshot(root),[]);
  const folder = path.join(root,'.pulso','delegation-attempts');
  fs.mkdirSync(folder,{recursive:true});
  const sessionID = 'session-1', callID = 'call-1';
  const name = createHash('sha256').update(JSON.stringify([sessionID,callID])).digest('hex');
  fs.writeFileSync(path.join(folder,`${name}.json`),JSON.stringify({schemaVersion:1,sessionID,callID,workId:'WORK-1',taskId:'TASK-1',status:'in_progress',updatedAt:new Date().toISOString()}));
  const before = snapshot(root);
  for (const action of ['attempts','reconcile_attempts']) {
    const result = await success(run,'pulso_workspace',{action,sessionID,workId:'WORK-1',limit:1});
    assert.match(result.output,/vida desconocida · revisar artefactos/);
  }
  assert.deepEqual(snapshot(root),before);
});

test('malformed model input is rejected before importing core, including root injection',async t => {
  const {root,homeDir,run} = await fixture(t,{coreDir:'/missing/core'});
  const cases = [
    ['pulso_workspace',null], ['pulso_workspace',[]], ['pulso_workspace',{}],
    ['pulso_workspace',{action:'status',root:'/tmp'}], ['pulso_workspace',{action:'invalid'}],
    ['pulso_workspace',{action:'status',fresh:'true'}], ['pulso_workspace',{action:'sync',expectedRevision:0}],
    ['pulso_workspace',{action:'attempts',limit:1.5}], ['pulso_workspace',{action:'attempts',sessionID:'x'.repeat(161)}],
    ['pulso_work',{action:'get',workId:'../escape'}], ['pulso_work',{action:'create',title:'x'.repeat(241)}],
    ['pulso_work',{action:'update',actions:[]}], ['pulso_work',{action:'update',actions:[null]}],
    ['pulso_work',{action:'close',limitations:[false]}], ['pulso_history',{limit:21}],
    ['pulso_context',{action:'summary',scope:'global'}], ['pulso_context',{action:'summary',extra:true}]
  ];
  for (const [name,input] of cases) {
    const result = await run(name,input);
    assert.equal(result.ok,false,JSON.stringify(input));
    assert.match(result.output,/input(?:[.\[]|:)/);
    assert.doesNotMatch(result.output,/Cannot find/);
  }
  assert.throws(() => validateInput({type:'string',minLength:2},'x'),/longitud/);
  assert.deepEqual(snapshot(root),[]);
  assert.deepEqual(snapshot(homeDir),[]);
});

test('core semantic validation and missing revisions remain errors',async t => {
  const {root,run} = await fixture(t);
  await success(run,'pulso_workspace',{action:'prepare'});
  await success(run,'pulso_work',create);
  const before = snapshot(root);
  for (const [name,input] of [
    ['pulso_work',{action:'get'}], ['pulso_workspace',{action:'sync',workId:'WORK-1'}],
    ['pulso_work',{action:'update',workId:'WORK-1',expectedRevision:1,actions:[{type:'work.set_overview',unknown:true}]}],
    ['pulso_work',{action:'complete_map',workId:'WORK-1',expectedRevision:999,summary:'Mapeo'}],
    ['pulso_history',{since:'not a date'}]
  ]) assert.equal((await run(name,input)).ok,false);
  assert.deepEqual(snapshot(root),before);
});

test('context rejection precedes input validation for every tool',async t => {
  let calls = 0;
  const {root,homeDir,run} = await fixture(t,{
    coreDir:'/missing/core',
    assertContext:() => {calls++; throw new Error('Contexto cancelado');}
  });
  assert.equal(calls,0);
  for (const def of toolDefinitions) {
    const result = await run(def.name,null);
    assert.equal(result.ok,false);
    assert.match(result.output,/Contexto cancelado/);
    assert.doesNotMatch(result.output,/input|Cannot find/);
  }
  assert.equal(calls,4);
  assert.deepEqual(snapshot(root),[]);
  assert.deepEqual(snapshot(homeDir),[]);
});

test('context rejection before or after lazy imports prevents workspace and memory writes',async t => {
  for (const [name,input] of [
    ['pulso_workspace',{action:'prepare'}],
    ['pulso_context',{action:'set_context',scope:'project',expectedRevision:1,context:'No escribir'}],
    ['pulso_context',{action:'set_preference',scope:'user',expectedRevision:1,key:'idioma',value:'es',source:'user'}]
  ]) {
    for (const rejectAt of [2,3]) {
      let calls = 0;
      const {root,homeDir,run} = await fixture(t,{
        // Before-import rejection must win even when the module is unavailable.
        ...(rejectAt === 2 ? {coreDir:'/missing/core'} : {}),
        assertContext:() => {if (++calls === rejectAt) throw new Error('Contexto revocado durante carga');}
      });
      assert.equal(calls,0);
      const result = await run(name,input);
      assert.equal(result.ok,false);
      assert.match(result.output,/Contexto revocado durante carga/);
      assert.equal(calls,rejectAt);
      assert.deepEqual(snapshot(root),[]);
      assert.deepEqual(snapshot(homeDir),[]);
    }
  }
});

test('memory summaries expose applicable fields only for the requested scope without writes',async t => {
  const {root,homeDir,run} = await fixture(t);
  for (const scope of ['project','user']) {
    await success(run,'pulso_context',{action:'summary',scope});
    assert.deepEqual(snapshot(root),[]);
    assert.deepEqual(snapshot(homeDir),[]);
  }
  for (const scope of ['project','user']) {
    await success(run,'pulso_context',{action:'set_context',scope,expectedRevision:1,context:`${scope}-context-secret`});
    await success(run,'pulso_context',{action:'set_preference',scope,expectedRevision:2,key:`${scope}-key`,value:`${scope}-value`,source:'delegated'});
    await success(run,'pulso_context',{action:'add_learning',scope,expectedRevision:3,note:`${scope}-lesson`,source:'observed'});
  }
  const before = snapshot(root), homeBefore = snapshot(homeDir);
  for (const scope of ['project','user']) {
    const {output} = await success(run,'pulso_context',{action:'summary',scope});
    for (const text of [`${scope}-context-secret`,`${scope}-key`,`${scope}-value`,`${scope}-lesson`,'"source":"delegated"','"source":"observed"']) assert.ok(output.includes(text),text);
    assert.ok(!output.includes(`${scope === 'user' ? 'project' : 'user'}-`));
  }
  const {output} = await success(run,'pulso_context',{action:'summary'});
  assert.match(output,/1 del proyecto, 1 del usuario · aprendizajes: 1/);
  assert.ok(output.includes('project-value') && output.includes('user-value'));
  assert.deepEqual(snapshot(root),before);
  assert.deepEqual(snapshot(homeDir),homeBefore);
  // An excluded scope is not even read: corrupt project memory cannot affect user-only summary.
  fs.writeFileSync(path.join(root,'.pulso','memory.json'),'invalid JSON');
  await success(run,'pulso_context',{action:'summary',scope:'user'});
});

test('memory summary enforces a global content limit and reports truncation',async t => {
  const {root,homeDir,run} = await fixture(t);
  for (const scope of ['project','user']) {
    await success(run,'pulso_context',{action:'set_context',scope,expectedRevision:1,context:'c'.repeat(4000)});
    for (let index = 0; index < 6; index++) await success(run,'pulso_context',{action:'set_preference',scope,expectedRevision:index+2,source:'user',key:`key-${index}`,value:'v'.repeat(1000)});
  }
  const before = snapshot(root), homeBefore = snapshot(homeDir);
  for (const scope of [undefined,'project','user']) {
    const {output} = await success(run,'pulso_context',{action:'summary',...(scope ? {scope} : {})});
    assert.ok(output.length <= 8000);
    assert.match(output,/Contenido truncado; límite total de 8000 caracteres/);
  }
  assert.deepEqual(snapshot(root),before);
  assert.deepEqual(snapshot(homeDir),homeBefore);
});

test('missing memory action fields are errors without creating project or user files',async t => {
  const {root,homeDir,run} = await fixture(t);
  for (const scope of ['project','user']) {
    for (const input of [
      {action:'set_context'}, {action:'set_preference'}, {action:'set_preference',key:'language'},
      {action:'set_preference',value:'es'}, {action:'set_preference',key:' ',value:'es'},
      {action:'remove_preference'}, {action:'add_learning'}, {action:'add_learning',note:' '}
    ]) {
      const result = await run('pulso_context',{...input,scope});
      assert.equal(result.ok,false,JSON.stringify(input));
    }
  }
  assert.deepEqual(snapshot(root),[]);
  assert.deepEqual(snapshot(homeDir),[]);
});

test('same tools suite passes against core generated by build in an isolated extension',{skip:Boolean(process.env.PULSO_TEST_CORE_DIR)},async t => {
  const {root} = await fixture(t);
  const extensionRoot = path.join(path.dirname(root),'extension');
  fs.mkdirSync(path.join(extensionRoot,'src'),{recursive:true});
  fs.copyFileSync(fileURLToPath(new URL('../src/tools.mjs',import.meta.url)),path.join(extensionRoot,'src','tools.mjs'));
  fs.writeFileSync(path.join(extensionRoot,'package.json'),JSON.stringify({name:'pulso-tools-build-fixture'}));
  const {build} = await import('../scripts/build.mjs');
  await build({root:extensionRoot,sourceRoot:fileURLToPath(new URL('../../v3-opencode-v1/',import.meta.url))});
  const generatedCore = path.join(extensionRoot,'resources','lib');
  assert.equal(fs.readFileSync(path.join(generatedCore,'memory.mjs'),'utf8'),fs.readFileSync(path.join(coreDir,'memory.mjs'),'utf8'));
  // Start a standalone runner, rather than inheriting node:test's child protocol.
  const environment = {...process.env,PULSO_TEST_CORE_DIR:generatedCore};
  delete environment.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath,['--test',fileURLToPath(import.meta.url)],{
    env:environment,encoding:'utf8'
  });
  assert.equal(result.status,0,`${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout,/fail 0/);
});



test('VSC-03 queries preserve unfocused works, detailed sections and paginated closure cycles',async t => {
  const {run} = await fixture(t);
  await success(run,'pulso_workspace',{action:'prepare'});
  for(let i=0;i<3;i++) await success(run,'pulso_work',{...create,workId:`W-${i}`,title:`Title ${i}`});
  await success(run,'pulso_work',{action:'close',workId:'W-2',expectedRevision:1,outcome:'cancelled',summary:'A full closure summary beyond the old truncation. '.repeat(5),limitations:['Not executed']});
  const first=await run('pulso_workspace',{action:'status',limit:1});
  assert.equal(first.data.focusWorkId,null);
  assert.equal(first.data.works.items[0].title,'Title 0');
  assert.equal(first.data.works.hasMore,true);
  const second=await run('pulso_workspace',{action:'status',limit:1,offset:first.data.works.nextOffset});
  assert.equal(second.data.works.items[0].id,'W-1');
  assert.equal(second.data.works.hasMore,false);
  const details=await run('pulso_work',{action:'get',workId:'W-0',section:'criteria'});
  assert.equal(details.data.objective.criteria.items[0].description,create.criterion);
  assert.ok(details.data.objective.outcome);
  await success(run,'pulso_work',{action:'reopen',workId:'W-2',expectedRevision:2,reason:'Again'});
  await success(run,'pulso_work',{action:'close',workId:'W-2',expectedRevision:3,outcome:'cancelled',summary:'Second cycle'});
  const history=await run('pulso_history',{workId:'W-2',limit:1});
  assert.equal(history.data.items[0].cycle,2);
  assert.ok(history.data.items[0].closedAt);
  assert.equal(history.data.hasMore,true);
  const older=await run('pulso_history',{workId:'W-2',limit:1,offset:history.data.nextOffset});
  assert.equal(older.data.items[0].cycle,1);
  assert.ok(older.data.items[0].summary.length>160);
  assert.deepEqual(older.data.items[0].limitations,['Not executed']);
  assert.equal(older.data.hasMore,false);
});

test('canonical memory read pages retain provenance, scope and CAS; binding is host-only',async t => {
  const {root,homeDir,run}=await fixture(t);
  const empty=await success(run,'pulso_context',{action:'read',scope:'all',section:'preferences',limit:1});
  assert.deepEqual(empty.data.revisions,{project:1,user:1});
  assert.deepEqual(snapshot(root),[]);assert.deepEqual(snapshot(homeDir),[]);
  await success(run,'pulso_context',{action:'set_preference',scope:'project',expectedRevision:1,expectedBindingId:'host-only',key:'language',value:'es',source:'user'});
  await success(run,'pulso_context',{action:'set_preference',scope:'user',expectedRevision:1,key:'tone',value:'brief',source:'observed'});
  const before=snapshot(root),homeBefore=snapshot(homeDir);
  const first=await success(run,'pulso_context',{action:'read',scope:'all',section:'preferences',limit:1});
  assert.equal(first.data.entries[0].provenance,'explicit');assert.equal(first.data.hasMore,true);
  const second=await success(run,'pulso_context',{action:'read',scope:'all',section:'preferences',limit:1,cursor:first.data.nextCursor});
  assert.equal(second.data.entries[0].scope,'user');assert.equal(second.data.hasMore,false);
  for(const input of [
    {action:'set_preference',scope:'project',expectedRevision:1,key:'language',value:'fr',source:'user'},
    {action:'set_preference',scope:'project',expectedRevision:2,key:'language',value:'fr'},
    {action:'set_context',expectedRevision:2,context:'implicit scope'},
    {action:'read',scope:'project',source:'user'},
    {request:{action:'read'}}
  ])assert.equal((await run('pulso_context',input)).ok,false);
  assert.deepEqual(snapshot(root),before);assert.deepEqual(snapshot(homeDir),homeBefore);
  await success(run,'pulso_context',{action:'set_context',scope:'project',expectedRevision:2,context:'Changed'});
  const stale=await run('pulso_context',{action:'read',scope:'all',section:'preferences',limit:1,cursor:first.data.nextCursor});
  assert.equal(stale.ok,false);assert.match(stale.output,/CURSOR_OBSOLETO/);
});

test('evidence requires observed report hashes and acceptance; no automatic PASS or hash backfill',async t => {
  const {root,run}=await fixture(t);
  await success(run,'pulso_workspace',{action:'prepare'});await success(run,'pulso_work',create);
  fs.writeFileSync(path.join(root,'report.txt'),'Observed PASS');
  const view=await success(run,'pulso_work',{action:'get',workId:'WORK-1'});
  assert.equal(view.data.acceptanceBasis.criteria[0].id,'AC-1');
  const observed={id:'E-1',kind:'static',status:'pass',criterionIds:['AC-1'],taskIds:[],report:'report.txt',command:null,exitCode:null,cwd:'.',basis:'Reviewed report',files:[{path:'report.txt',sha256:createHash('sha256').update('Observed PASS').digest('hex')}],acceptanceBasis:view.data.acceptanceBasis,checkedAt:new Date().toISOString(),summary:'Observed result'};
  const before=snapshot(root);
  for(const evidence of [{...observed,files:['report.txt']},{...observed,files:[{path:'report.txt',sha256:'0'.repeat(64)}]},Object.fromEntries(Object.entries(observed).filter(([key])=>key!=='acceptanceBasis'))]){
    assert.equal((await run('pulso_work',{action:'update',workId:'WORK-1',expectedRevision:1,actions:[{type:'evidence.add',evidence}]})).ok,false);
    assert.deepEqual(snapshot(root),before);
  }
  assert.equal((await run('pulso_work',{action:'complete_map',workId:'WORK-1',expectedRevision:1,summary:'Template is not evidence'})).ok,false);
  assert.deepEqual(snapshot(root),before);
  await success(run,'pulso_work',{action:'update',workId:'WORK-1',expectedRevision:1,actions:[{type:'evidence.add',evidence:observed}]});
  const saved=await success(run,'pulso_work',{action:'get',workId:'WORK-1',section:'evidence'});
  assert.deepEqual(saved.data.evidence.items[0],observed);
});

test('validate_result uses packaged catalog, validates canonical JSON and never writes',async t => {
  const {root,homeDir,run}=await fixture(t);
  await success(run,'pulso_workspace',{action:'prepare'});await success(run,'pulso_work',create);
  const output='.pulso/work/WORK-1/plan.md';
  await success(run,'pulso_work',{action:'update',workId:'WORK-1',expectedRevision:1,actions:[{type:'task.add',task:{id:'T-1',title:'Plan',criterionIds:['AC-1'],agent:'pulso-planner',status:'pending',dependsOn:[],writeScope:[output],resources:[],acceptance:['Plan reviewed'],evidenceIds:[],summary:''}}]});
  const resourceRoot=path.dirname(coreDir);
  const delegation={...JSON.parse(fs.readFileSync(path.join(resourceRoot,'templates/delegation.json'),'utf8')),workId:'WORK-1',workRevision:2,inputs:['.pulso/work/WORK-1/work.json'],output,writeScope:[output]};
  const result={...JSON.parse(fs.readFileSync(path.join(resourceRoot,'templates/result.json'),'utf8')),workId:'WORK-1',workRevision:2};
  const before=snapshot(root),homeBefore=snapshot(homeDir);
  const validated=await success(run,'pulso_work',{action:'validate_result',delegation,result});
  assert.equal(validated.data.valid,true);assert.equal(validated.data.semanticAcceptance,'PENDING_REVIEW');
  for(const invalid of [{...result,workRevision:1},{...result,agent:'pulso-executor'},{...result,status:'completed',artifacts:[]}])assert.equal((await run('pulso_work',{action:'validate_result',delegation,result:invalid})).ok,false);
  assert.deepEqual(snapshot(root),before);assert.deepEqual(snapshot(homeDir),homeBefore);
});
