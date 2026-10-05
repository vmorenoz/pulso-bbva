import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {install,uninstall} from '../lib/install.mjs';
import {temp} from './helpers.mjs';

async function installed(t){
  const dependencies=process.env.PULSO_TEST_PLUGIN_NODE_MODULES||path.join(os.homedir(),'.config/opencode/node_modules');
  if(!fs.existsSync(path.join(dependencies,'@opencode-ai/plugin'))){t.skip('Local OpenCode v1 dependencies unavailable; installed-plugin checks NOT_RUN');return null;}
  const homeDir=temp(t),directory=temp(t),options={homeDir,env:{}};
  install(options);
  fs.symlinkSync(dependencies,path.join(homeDir,'.config/opencode/node_modules'));
  const {PulsoPlugin}=await import(pathToFileURL(path.join(homeDir,'.config/opencode/plugins/pulso/index.mjs')).href);
  const plugin=await PulsoPlugin({directory,homeDir}),asks=[],context={directory,ask:async request=>{asks.push(request);}};
  return {homeDir,directory,options,PulsoPlugin,plugin,context,asks};
}
const call=(fixture,name,request,context=fixture.context)=>fixture.plugin.tool[name].execute(name==='pulso_history'?request:{request},context);
function success(result){assert.equal(result.metadata.ok,true,result.output);return result;}
const json=result=>JSON.parse(success(result).output);
const createRequest=(workId,extra={})=>({action:'create',...(workId?{workId}:{}),title:`Work ${workId||'automatic'}`,objective:'Deliver the specified contract',criterion:'Preserve the contract',verification:'Check the resulting artifact',...extra});
const task=(id='T-1',extra={})=>({id,title:`Task ${id}`,criterionIds:['AC-1'],agent:'pulso-planner',status:'pending',dependsOn:[],writeScope:[],resources:[],acceptance:['Review the assigned output'],evidenceIds:[],summary:'',...extra});
function snapshot(root){
  const entries={};
  function visit(relative=''){
    const location=path.join(root,relative),stat=fs.lstatSync(location);
    if(stat.isSymbolicLink()){entries[relative]={symlink:fs.readlinkSync(location)};return;}
    if(stat.isDirectory()){entries[relative]={directory:true};for(const name of fs.readdirSync(location).sort())visit(path.join(relative,name));return;}
    entries[relative]={bytes:fs.readFileSync(location).toString('base64'),mode:stat.mode};
  }
  visit();return entries;
}

test('installed plugin prepares identity, migrates legacy and observes only correlated Pulso tasks',async t=>{
  const fixture=await installed(t);if(!fixture)return;
  const {homeDir,directory,options,plugin}=fixture;
  success(await call(fixture,'pulso_workspace',{action:'status'}));
  assert.equal(fs.existsSync(path.join(directory,'.pulso')),false);
  const unrelated={tool:'task',sessionID:'ses_unrelated',callID:'call_unrelated'},generic={subagent_type:'general',prompt:'workId: PULSO-001\ntaskId: T-1'};
  await plugin['tool.execute.before'](unrelated,{args:generic});
  await plugin['tool.execute.after']({...unrelated,args:generic},{metadata:{},output:'not a Pulso task'});
  assert.equal(fs.existsSync(path.join(directory,'.pulso')),false);
  fs.mkdirSync(path.join(directory,'.pulso/tasks'),{recursive:true});
  fs.writeFileSync(path.join(directory,'.pulso/state.json'),JSON.stringify({schema_version:1}));
  fs.writeFileSync(path.join(directory,'.pulso/tasks/PULSO-001.json'),JSON.stringify({id:'PULSO-001',title:'Legacy',objective:'Preserve scope',status:'implemented',acceptance_criteria:['Review legacy result']}));
  assert.match(success(await call(fixture,'pulso_workspace',{action:'status'})).output,/legacy detectado/);
  const prepared=json(await call(fixture,'pulso_workspace',{action:'prepare'}));
  assert.equal(prepared.legacyMigrated,true);assert.equal(prepared.migratedWorks,1);
  const identity=JSON.parse(fs.readFileSync(path.join(directory,'.pulso/project.json'),'utf8')),registry=path.join(homeDir,'.pulso/projects',`${identity.projectId}.json`);
  assert.deepEqual(JSON.parse(fs.readFileSync(registry,'utf8')).locations,[directory]);
  assert.equal(json(await call(fixture,'pulso_workspace',{action:'prepare'})).projectId,identity.projectId);
  assert.match(success(await call(fixture,'pulso_work',createRequest())).output,/PULSO-[0-9a-f]{8}-/);
  const legacy=json(await call(fixture,'pulso_work',{action:'get',workId:'PULSO-001',section:'overview'}));
  success(await call(fixture,'pulso_work',{action:'update',workId:legacy.id,expectedRevision:legacy.revision,actions:[{type:'task.add',task:task('T-1',{agent:'pulso-qa-auditor'})}]}));
  const before=snapshot(directory);
  await plugin['tool.execute.before'](unrelated,{args:generic});
  await plugin['tool.execute.before']({...unrelated,callID:'call_unknown_task'},{args:{subagent_type:'pulso-qa-auditor',prompt:'workId: PULSO-001\ntaskId: T-99'}});
  await plugin.event({event:{type:'message.part.updated',properties:{part:{...unrelated,type:'tool',state:{status:'completed',input:generic}}}}});
  assert.deepEqual(snapshot(directory),before);
  const input={tool:'task',sessionID:'ses_installed',callID:'call_installed'},args={subagent_type:'pulso-qa-auditor',prompt:'workId: PULSO-001\ntaskId: T-1\nsecret not stored'};
  await plugin['tool.execute.before'](input,{args});
  await plugin['tool.execute.after']({...input,args},{metadata:{sessionId:'ses_child'},output:'secret output'});
  await plugin['tool.execute.before'](input,{args});
  const attempts=json(await call(fixture,'pulso_workspace',{action:'attempts'}));
  assert.equal(attempts.length,1);assert.equal(attempts[0].workId,'PULSO-001');assert.equal(attempts[0].taskId,'T-1');
  assert.equal(attempts[0].status,'completed');assert.equal(attempts[0].liveness,'unknown');assert.equal(attempts[0].childSessionID,'ses_child');assert.doesNotMatch(JSON.stringify(attempts),/secret/);
  const state=fs.readFileSync(path.join(directory,'.pulso/state.json')),registered=fs.readFileSync(registry);
  uninstall(options);
  assert.deepEqual(fs.readFileSync(path.join(directory,'.pulso/state.json')),state);assert.deepEqual(fs.readFileSync(registry),registered);
  assert.ok(fs.existsSync(path.join(homeDir,'.config/opencode/node_modules/@opencode-ai/plugin/package.json')));
});

test('all four installed tools ask once and reject or miss ask without writes',async t=>{
  const fixture=await installed(t);if(!fixture)return;
  const {homeDir,directory}=fixture;
  success(await call(fixture,'pulso_workspace',{action:'prepare'}));success(await call(fixture,'pulso_work',createRequest('PERMISSIONS')));
  const probes=[
    ['pulso_workspace',{action:'prepare'}],['pulso_workspace',{action:'recover'}],['pulso_workspace',{action:'status'}],
    ['pulso_work',createRequest('DENIED')],['pulso_work',{action:'get',workId:'PERMISSIONS'}],
    ['pulso_context',{action:'set_preference',scope:'user',expectedRevision:1,key:'private-key',value:'private note contents',source:'user'}],
    ['pulso_context',{action:'read',scope:'all'}],['pulso_history',{}]
  ];
  const before={home:snapshot(homeDir),project:snapshot(directory)};
  for(const [name,request] of probes){
    const asks=[],rejection=new Error('native permission denied');
    await assert.rejects(call(fixture,name,request,{directory,ask:async permission=>{asks.push(permission);throw rejection;}}),error=>error===rejection);
    assert.equal(asks.length,1);
    assert.equal(asks[0].permission,name);assert.deepEqual(asks[0].always,asks[0].patterns);
    assert.deepEqual(asks[0].patterns,[`${request.action||'read'}:${request.scope||request.workId||'workspace'}`]);
    assert.doesNotMatch(JSON.stringify(asks),/private note contents|private-key/);
    const missing=await call(fixture,name,request,{directory});assert.equal(missing.metadata.ok,false);assert.match(missing.output,/Aprobación nativa no disponible/);
    assert.deepEqual({home:snapshot(homeDir),project:snapshot(directory)},before);
  }
  const fresh=temp(t),freshBefore=snapshot(fresh);
  for(const reason of ['native permission denied','native permission cancelled']){
    let count=0;const rejection=new Error(reason);
    await assert.rejects(call(fixture,'pulso_workspace',{action:'prepare'},{directory:fresh,ask:async()=>{count++;throw rejection;}}),error=>error===rejection);
    assert.equal(count,1);assert.deepEqual(snapshot(fresh),freshBefore);assert.deepEqual(snapshot(homeDir),before.home);
  }
  const missingFresh=await call(fixture,'pulso_workspace',{action:'prepare'},{directory:fresh});
  assert.equal(missingFresh.metadata.ok,false);assert.deepEqual(snapshot(fresh),freshBefore);assert.deepEqual(snapshot(homeDir),before.home);
  for(const [name,request] of [['pulso_workspace',{action:'status'}],['pulso_work',{action:'get',workId:'PERMISSIONS'}],['pulso_context',{action:'read',scope:'all'}],['pulso_history',{}]]){
    const count=fixture.asks.length;success(await call(fixture,name,request));assert.equal(fixture.asks.length,count+1);
  }
});

test('installed status rejects external and broken symlinks before target reads and redacts invalid JSON',async t=>{
  const fixture=await installed(t);if(!fixture)return;
  const external=temp(t),secret=path.join(external,'state.json'),state=path.join(fixture.directory,'.pulso/state.json');
  fs.mkdirSync(path.dirname(state),{recursive:true});fs.writeFileSync(secret,'PRIVATE_EXTERNAL_CONTENT');
  for(const target of [secret,path.join(external,'absent.json')]){
    fs.symlinkSync(target,state);
    const reads=[],readFileSync=fs.readFileSync;
    fs.readFileSync=(file,...args)=>{reads.push(file instanceof URL?file.pathname:String(file));return readFileSync(file,...args);};
    let result;try{result=await call(fixture,'pulso_workspace',{action:'status'});}finally{fs.readFileSync=readFileSync;}
    assert.equal(result.metadata.ok,false);assert.match(result.output,/Symlink no permitido/);assert.doesNotMatch(result.output,/PRIVATE_EXTERNAL_CONTENT/);
    assert.equal(reads.includes(state)||reads.includes(target),false,'No state or external target content may be opened');
    assert.equal(fs.readlinkSync(state),target);fs.unlinkSync(state);
  }
  fs.writeFileSync(state,'{"PRIVATE_STATE_CONTENT":');
  const malformed=await call(fixture,'pulso_workspace',{action:'status'});
  assert.equal(malformed.metadata.ok,false);assert.doesNotMatch(malformed.output,/PRIVATE_STATE_CONTENT/);assert.equal(fs.readFileSync(state,'utf8'),'{"PRIVATE_STATE_CONTENT":');
});

test('installed context returns scoped values and revision-bound pages across projects and sessions',async t=>{
  const fixture=await installed(t);if(!fixture)return;
  success(await call(fixture,'pulso_workspace',{action:'prepare'}));
  const context='Long context preserved in full. '.repeat(100);
  assert.equal(json(await call(fixture,'pulso_context',{action:'set_context',scope:'project',expectedRevision:1,context})).revision,2);
  assert.equal(json(await call(fixture,'pulso_context',{action:'set_preference',scope:'project',expectedRevision:2,key:'format',value:'Project-local format',source:'observed'})).revision,3);
  assert.equal(json(await call(fixture,'pulso_context',{action:'set_preference',scope:'user',expectedRevision:1,key:'format',value:'User-global format',source:'user'})).revision,2);
  assert.equal(json(await call(fixture,'pulso_context',{action:'add_learning',scope:'user',expectedRevision:2,note:'Confirm each observed acceptance basis',source:'delegated'})).revision,3);
  const all=[],cursors=new Set();let cursor;
  do{
    const page=json(await call(fixture,'pulso_context',{action:'read',scope:'all',limit:1,...(cursor?{cursor}:{})}));
    assert.deepEqual(page.revisions,{project:3,user:3});all.push(...page.entries);assert.equal(page.hasMore,Boolean(page.nextCursor));
    if(page.nextCursor){assert.equal(cursors.has(page.nextCursor),false);cursors.add(page.nextCursor);}cursor=page.nextCursor;
  }while(cursor);
  assert.equal(all.length,4);assert.equal(all.find(entry=>entry.section==='context').content,context);
  const local=all.find(entry=>entry.scope==='project'&&entry.key==='format'),global=all.find(entry=>entry.scope==='user'&&entry.key==='format');
  assert.equal(local.value,'Project-local format');assert.equal(local.source,'observed');assert.equal(global.value,'User-global format');assert.equal(global.source,'user');assert.equal(global.provenance,'explicit');assert.ok(Number.isFinite(Date.parse(global.date)));
  const directory=temp(t),plugin=await fixture.PulsoPlugin({directory,homeDir:fixture.homeDir}),other={...fixture,directory,plugin,context:{directory,ask:async()=>{}}};
  assert.equal(json(await call(other,'pulso_context',{action:'read',scope:'user',section:'preferences',key:'format'})).entries[0].value,'User-global format');
  assert.equal(fs.existsSync(path.join(directory,'.pulso')),false);
  const first=json(await call(other,'pulso_context',{action:'read',scope:'user',limit:1}));
  json(await call(other,'pulso_context',{action:'set_preference',scope:'user',expectedRevision:3,key:'format',value:'Corrected global format',source:'user'}));
  const stale=await call(other,'pulso_context',{action:'read',scope:'user',limit:1,cursor:first.nextCursor});assert.equal(stale.metadata.ok,false);assert.match(stale.output,/CURSOR_OBSOLETO/);
  assert.equal(json(await call(fixture,'pulso_context',{action:'read',scope:'user',key:'format'})).entries[0].value,'Corrected global format');
  assert.equal(json(await call(fixture,'pulso_context',{action:'read',scope:'project',key:'format'})).entries[0].value,'Project-local format');
});

test('installed status and get expose nonfocused blockers, task acceptance and stale pagination',async t=>{
  const fixture=await installed(t);if(!fixture)return;
  success(await call(fixture,'pulso_workspace',{action:'prepare'}));success(await call(fixture,'pulso_work',createRequest('BLOCKED')));
  success(await call(fixture,'pulso_work',{action:'update',workId:'BLOCKED',expectedRevision:1,actions:[{type:'work.set_overview',status:'blocked',blockers:['Need API owner decision'],decisionsPending:['Choose migration boundary'],nextAction:'Ask the API owner'}]}));
  success(await call(fixture,'pulso_work',createRequest('FOCUSED')));
  const first=json(await call(fixture,'pulso_workspace',{action:'status',limit:1})),second=json(await call(fixture,'pulso_workspace',{action:'status',limit:1,cursor:first.nextCursor}));
  assert.equal(first.focusWorkId,'FOCUSED');assert.equal(first.total,2);assert.equal(first.hasMore,true);assert.equal(second.hasMore,false);assert.equal(second.nextCursor,null);
  const works=[...first.entries,...second.entries];assert.deepEqual(works.map(work=>work.id),['BLOCKED','FOCUSED']);
  assert.deepEqual(works[0].decisionsPending,['Choose migration boundary']);assert.deepEqual(works[0].blockers,['Need API owner decision']);assert.equal(works[0].nextAction,'Ask the API owner');assert.equal(works[0].objective,'Deliver the specified contract');assert.equal(works[0].workRevision,2);
  success(await call(fixture,'pulso_work',{action:'update',workId:'FOCUSED',expectedRevision:1,actions:[{type:'task.add',task:task()},{type:'task.add',task:task('T-2',{dependsOn:['T-1'],acceptance:['Review dependent output']})},{type:'criterion.add',criterion:{id:'AC-2',description:'Second acceptance criterion',verification:'Check the second output'}}]}));
  const pages=[],entries=[];let cursor;
  do{const page=json(await call(fixture,'pulso_work',{action:'get',workId:'FOCUSED',limit:1,...(cursor?{cursor}:{})}));pages.push(page);entries.push(...page.entries);cursor=page.nextCursor;}while(cursor);
  assert.equal(entries.length,4);assert.equal(new Set(entries.map(entry=>`${entry.section}:${entry.value.id}`)).size,4);assert.equal(pages[0].objective.outcome,'Deliver the specified contract');assert.equal(pages[0].total,4);
  assert.equal(pages[0].acceptanceBasis.criteria.length,2);assert.equal(pages[0].acceptanceBasis.tasks.length,2);
  const tasks=json(await call(fixture,'pulso_work',{action:'get',workId:'FOCUSED',section:'tasks'}));
  assert.deepEqual(tasks.entries.map(entry=>entry.section),['tasks','tasks']);assert.deepEqual(tasks.entries[1].value.dependsOn,['T-1']);assert.deepEqual(tasks.entries[1].value.acceptance,['Review dependent output']);
  const oldStatus=await call(fixture,'pulso_workspace',{action:'status',limit:1,cursor:first.nextCursor});assert.equal(oldStatus.metadata.ok,false);assert.match(oldStatus.output,/Cursor obsoleto/);
  success(await call(fixture,'pulso_work',{action:'update',workId:'FOCUSED',expectedRevision:2,actions:[{type:'work.set_overview',summary:'Changed between pages'}]}));
  const stale=await call(fixture,'pulso_work',{action:'get',workId:'FOCUSED',limit:1,cursor:pages[0].nextCursor});assert.equal(stale.metadata.ok,false);assert.match(stale.output,/Cursor obsoleto/);
});

test('installed history pages retain closure dates, outcomes and limitations without duplication',async t=>{
  const fixture=await installed(t);if(!fixture)return;
  success(await call(fixture,'pulso_workspace',{action:'prepare'}));
  for(const workId of ['HISTORY-A','HISTORY-B']){
    success(await call(fixture,'pulso_work',createRequest(workId)));
    success(await call(fixture,'pulso_work',{action:'close',workId,expectedRevision:1,outcome:'cancelled',summary:`Cancelled ${workId} in fixture`,limitations:[`No live execution for ${workId}`]}));
  }
  const first=json(await call(fixture,'pulso_history',{limit:1})),second=json(await call(fixture,'pulso_history',{limit:1,cursor:first.nextCursor}));
  assert.equal(first.total,2);assert.equal(first.hasMore,true);assert.equal(second.hasMore,false);assert.equal(second.nextCursor,null);
  const entries=[...first.entries,...second.entries];assert.equal(new Set(entries.map(entry=>entry.closureId)).size,2);
  for(const entry of entries){assert.equal(entry.outcome,'cancelled');assert.ok(Number.isFinite(Date.parse(entry.closedAt)));assert.deepEqual(entry.limitations,[`No live execution for ${entry.workId}`]);}
  assert.equal(json(await call(fixture,'pulso_history',{workId:'HISTORY-A'})).entries[0].workId,'HISTORY-A');
  success(await call(fixture,'pulso_work',createRequest('HISTORY-C')));success(await call(fixture,'pulso_work',{action:'close',workId:'HISTORY-C',expectedRevision:1,outcome:'cancelled',summary:'New closure changes pages'}));
  const stale=await call(fixture,'pulso_history',{limit:1,cursor:first.nextCursor});assert.equal(stale.metadata.ok,false);assert.match(stale.output,/Cursor obsoleto/);
});

test('installed validate_result reads the real global template and leaves semantic acceptance pending',async t=>{
  const fixture=await installed(t);if(!fixture)return;
  success(await call(fixture,'pulso_workspace',{action:'prepare'}));success(await call(fixture,'pulso_work',createRequest('RESULT')));
  const output='.pulso/work/RESULT/plan.md',template=path.join(fixture.homeDir,'.pulso/templates/plan.md');
  fs.writeFileSync(path.join(fixture.directory,output),'# Synthetic plan\nNo live specialist run.\n');
  success(await call(fixture,'pulso_work',{action:'update',workId:'RESULT',expectedRevision:1,actions:[{type:'task.add',task:task('T-1',{writeScope:[output]})}]}));
  const delegation={schemaVersion:1,id:'D-1',workId:'RESULT',workRevision:2,taskIds:['T-1'],agent:'pulso-planner',objective:'Review this synthetic plan',inputs:['.pulso/project.md'],templateId:'plan',output,writeScope:[output],resources:[],constraints:['No metadata writes'],acceptance:['Review the plan'],questions:[]};
  const result={schemaVersion:1,delegationId:'D-1',workId:'RESULT',workRevision:2,agent:'pulso-planner',status:'completed',summary:'Synthetic plan exists',artifacts:[output],changedFiles:[output],checks:[],findings:[],questions:[],limitations:['No live execution'],suggestedNextStep:'Review semantics'};
  const before=snapshot(fixture.directory),reads=[],readFileSync=fs.readFileSync;
  fs.readFileSync=(file,...args)=>{reads.push(String(file));return readFileSync(file,...args);};
  let validated;try{validated=json(await call(fixture,'pulso_work',{action:'validate_result',delegation,result}));}finally{fs.readFileSync=readFileSync;}
  assert.equal(validated.valid,true);assert.equal(validated.templateId,'plan');assert.equal(validated.semanticAcceptance,'PENDING_REVIEW');assert.ok(reads.includes(template));
  const work=json(await call(fixture,'pulso_work',{action:'get',workId:'RESULT'}));assert.equal(work.status,'pending');assert.equal(work.closure,null);assert.equal(work.entries.some(entry=>entry.section==='evidence'),false);
  for(const request of [{delegation,result:{...result,delegationId:'D-other'}},{delegation:{...delegation,taskIds:['T-unknown']},result},{delegation:{...delegation,workRevision:1},result:{...result,workRevision:1}},{delegation,result:{...result,changedFiles:['.pulso/project.md']}}]){
    assert.equal((await call(fixture,'pulso_work',{action:'validate_result',...request})).metadata.ok,false);
  }
  assert.deepEqual(snapshot(fixture.directory),before);
  fs.unlinkSync(template);
  const absent=await call(fixture,'pulso_work',{action:'validate_result',delegation,result});assert.equal(absent.metadata.ok,false);assert.match(absent.output,/ENOENT/);
});

test('installed recover resumes an interrupted owned preparation marker and preserves identity',async t=>{
  const fixture=await installed(t);if(!fixture)return;
  const {directory,homeDir}=fixture;
  fs.mkdirSync(path.join(directory,'.pulso'));fs.writeFileSync(path.join(directory,'.pulso/project.md'),'Existing project context');
  const renameSync=fs.renameSync;
  fs.renameSync=(source,target)=>{if(target===path.join(directory,'.pulso/history.jsonl'))throw new Error('injected bootstrap interruption');return renameSync(source,target);};
  let interrupted;try{interrupted=await call(fixture,'pulso_workspace',{action:'prepare'});}finally{fs.renameSync=renameSync;}
  assert.equal(interrupted.metadata.ok,false);assert.match(interrupted.output,/injected bootstrap interruption/);
  assert.equal(fs.existsSync(path.join(directory,'.pulso/preparation.json')),true);assert.equal(fs.existsSync(path.join(directory,'.pulso/history.jsonl')),false);
  const recovered=json(await call(fixture,'pulso_workspace',{action:'recover'}));
  assert.equal(recovered.recovered,true);assert.equal(recovered.validation.valid,true);assert.equal(fs.existsSync(path.join(directory,'.pulso/preparation.json')),false);
  assert.equal(fs.readFileSync(path.join(directory,'.pulso/project.md'),'utf8'),'Existing project context');assert.equal(json(await call(fixture,'pulso_workspace',{action:'status'})).total,0);
  const identity=JSON.parse(fs.readFileSync(path.join(directory,'.pulso/project.json'),'utf8'));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(homeDir,'.pulso/projects',`${identity.projectId}.json`),'utf8')).locations,[directory]);
  assert.equal(json(await call(fixture,'pulso_workspace',{action:'prepare'})).projectId,identity.projectId);
});

test('installed request contracts reject missing, extra and obsolete fields before permission or writes',async t=>{
  const fixture=await installed(t);if(!fixture)return;
  success(await call(fixture,'pulso_workspace',{action:'prepare'}));
  const before={home:snapshot(fixture.homeDir),project:snapshot(fixture.directory)},count=fixture.asks.length;
  const {criterion,...missing}=createRequest('INVALID');
  for(const [name,request] of [
    ['pulso_work',missing],['pulso_work',createRequest('INVALID',{priority:'urgent'})],['pulso_work',createRequest('INVALID',{extra:'unsupported'})],
    ['pulso_work',{action:'update',workId:'INVALID',expectedRevision:1,actions:[{type:'task.add'}]}],
    ['pulso_context',{action:'set_preference',scope:'user',expectedRevision:1,key:'format',value:'Missing provenance'}],['pulso_workspace',{action:'complete_map'}]
  ])assert.equal((await call(fixture,name,request)).metadata.ok,false);
  const extra=await fixture.plugin.tool.pulso_work.execute({request:createRequest('INVALID'),root:fixture.directory},fixture.context);assert.equal(extra.metadata.ok,false);
  assert.equal(fixture.asks.length,count);assert.deepEqual({home:snapshot(fixture.homeDir),project:snapshot(fixture.directory)},before);
});
