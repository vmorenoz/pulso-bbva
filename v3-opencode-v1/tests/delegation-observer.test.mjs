import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createDelegationObserver,readDelegationAttempts} from '../lib/delegation-observer.mjs';
import {temp} from './helpers.mjs';

const input={tool:'task',sessionID:'ses_parent',callID:'call_one'};
const args={prompt:'workId: W-1\ntaskId: T-1\nSecret prompt not for storage'};
const part=(status,extra={})=>({event:{type:'message.part.updated',properties:{part:{type:'tool',id:'part_one',messageID:'msg_one',...input,state:{status,input:args,time:{start:1,end:2},...extra}}}}});
const session=(type,properties)=>({event:{type,properties:{sessionID:input.sessionID,...properties}}});
const stored=root=>fs.readdirSync(path.join(root,'.pulso/delegation-attempts')).map(name=>fs.readFileSync(path.join(root,'.pulso/delegation-attempts',name),'utf8')).join('');

test('startup, greetings, unrelated tools and uncorrelated session events write nothing',async t=>{
  const root=temp(t),hooks=createDelegationObserver(root);
  assert.deepEqual(readDelegationAttempts(root),[]);
  await hooks['tool.execute.before']({...input,tool:'bash'},{args});
  await hooks['tool.execute.after']({...input,tool:'read'},{metadata:{},output:'secret'});
  await hooks.event({event:{type:'message.part.updated',properties:{part:{type:'text',text:'Hola'}}}});
  await hooks.event(session('session.status',{status:{type:'idle'}}));
  await hooks.event(session('session.error',{error:{name:'UnknownError',data:{message:'secret'}}}));
  assert.equal(fs.existsSync(path.join(root,'.pulso')),false);
});

test('correlation is explicit, native call identity isolates attempts and data is minimal',async t=>{
  const root=temp(t),hooks=createDelegationObserver(root);
  await hooks['tool.execute.before'](input,{args});
  await hooks['tool.execute.before']({...input,callID:'call_two'},{args:{prompt:'No correlation'}});
  await hooks['tool.execute.before']({...input,sessionID:'ses_other'},{args:{prompt:'workId: W-2'}});
  const values=readDelegationAttempts(root);
  assert.equal(values.length,3);
  assert.equal(readDelegationAttempts(root,{workId:'W-1'})[0].taskId,'T-1');
  assert.equal(readDelegationAttempts(root,{sessionID:'ses_parent'}).length,2);
  assert.equal(readDelegationAttempts(root,{sessionID:'ses_parent',limit:1}).length,1);
  assert.equal(values.find(value=>value.callID==='call_two').workId,undefined);
  assert.ok(values.every(value=>value.liveness==='unknown'&&value.requiresReview));
  assert.equal(stored(root).includes('Secret prompt'),false);
  assert.equal(fs.existsSync(path.join(root,'.pulso/state.json')),false);
});

test('duplicated and reordered tool events persist completion without rewriting or regressions',async t=>{
  const root=temp(t),hooks=createDelegationObserver(root);
  await hooks.event(part('completed',{output:'sensitive result',metadata:{sessionId:'ses_child',token:'secret'}}));
  const before=stored(root);
  await hooks.event(part('completed'));
  await hooks['tool.execute.before'](input,{args});
  await hooks.event(part('running'));
  await hooks['tool.execute.after']({...input,args},{output:'secret',metadata:{sessionId:'ses_child'}});
  assert.equal(stored(root),before);
  const [value]=readDelegationAttempts(root);
  assert.equal(value.status,'completed');
  assert.equal(value.childSessionID,'ses_child');
  assert.equal(value.liveness,'unknown');
  assert.equal(value.requiresReview,false);
  assert.equal(stored(root).includes('secret'),false);
  assert.equal(stored(root).includes('sensitive result'),false);
});

test('tool error beats a late successful after hook, without persisting sensitive errors',async t=>{
  const root=temp(t),hooks=createDelegationObserver(root);
  await hooks.event(part('error',{error:'Bearer credential: '+ 'x'.repeat(100000)}));
  await hooks['tool.execute.after']({...input,args},{metadata:{},output:'not evidence of success'});
  await hooks.event(part('pending'));
  assert.equal(readDelegationAttempts(root)[0].status,'error');
  assert.ok(stored(root).length<1500);
  assert.equal(stored(root).includes('credential'),false);
});

test('session errors and typed abort confirmations are correlated and terminal',async t=>{
  const root=temp(t),hooks=createDelegationObserver(root);
  await hooks.event(part('running',{metadata:{sessionId:'ses_child'}}));
  await hooks.event(session('session.error',{sessionID:'ses_unrelated',error:{name:'MessageAbortedError'}}));
  assert.equal(readDelegationAttempts(root)[0].status,'in_progress');
  await hooks.event(session('session.error',{sessionID:'ses_child',error:{name:'UnknownError',data:{message:'cancelled? secret'}}}));
  assert.equal(readDelegationAttempts(root)[0].status,'error');
  await hooks.event(session('session.error',{sessionID:'ses_child',error:{name:'MessageAbortedError',data:{message:'secret'}}}));
  const before=stored(root);
  await hooks.event(session('session.error',{sessionID:'ses_child',error:{name:'MessageAbortedError'}}));
  await hooks.event(part('error',{error:'other secret'}));
  await hooks['tool.execute.after']({...input,args},{metadata:{}});
  assert.equal(readDelegationAttempts(root)[0].status,'cancelled');
  assert.equal(stored(root),before);
  assert.equal(stored(root).includes('secret'),false);
});

test('idle/retry/busy never complete an attempt; restart and reconciliation keep life unknown',async t=>{
  const root=temp(t),hooks=createDelegationObserver(root);
  await hooks['tool.execute.before'](input,{args});
  for(const type of ['busy','retry','idle'])await hooks.event(session('session.status',{status:{type,message:'sensitive retry detail',attempt:2,next:50}}));
  const before=stored(root);
  createDelegationObserver(root);
  const [value]=readDelegationAttempts(root);
  assert.equal(value.status,'in_progress');
  assert.equal(value.sessionStatus,'idle');
  assert.equal(value.liveness,'unknown');
  assert.equal(value.requiresReview,true);
  assert.equal(stored(root),before);
  assert.equal(stored(root).includes('sensitive'),false);
});

test('session errors do not rewrite completed calls or guess attempts from a missing session ID',async t=>{
  const root=temp(t),hooks=createDelegationObserver(root);
  await hooks['tool.execute.after']({...input,args},{metadata:{}});
  const before=stored(root);
  await hooks.event(session('session.error',{error:{name:'MessageAbortedError'}}));
  await hooks.event(session('session.error',{sessionID:undefined,error:{name:'UnknownError'}}));
  assert.equal(stored(root),before);
});

test('ambiguous/oversized prompts and invalid call IDs do not invent correlation',async t=>{
  const root=temp(t),hooks=createDelegationObserver(root);
  await hooks['tool.execute.before'](input,{args:{prompt:'workId: W-1\nworkId: W-2\ntaskId: T-1'}});
  await hooks['tool.execute.before']({...input,callID:'call_big'},{args:{prompt:'workId: W-3\n'+'x'.repeat(65536)}});
  await hooks['tool.execute.before']({...input,callID:'../escape'},{args});
  const values=readDelegationAttempts(root);
  assert.equal(values.length,2);
  assert.ok(values.every(value=>value.workId===undefined));
  assert.equal(values.find(value=>value.callID==='call_one').taskId,'T-1');
});

test('telemetry filesystem failures never reject hooks or mutate task arguments/output',async t=>{
  const root=temp(t),outside=temp(t);
  fs.symlinkSync(outside,path.join(root,'.pulso'));
  const hooks=createDelegationObserver(root),output={args:structuredClone(args)};
  await assert.doesNotReject(hooks['tool.execute.before'](input,output));
  await assert.doesNotReject(hooks['tool.execute.after']({...input,args},{metadata:{}}));
  await assert.doesNotReject(hooks.event(part('error',{error:'secret'})));
  assert.deepEqual(output,{args});
  assert.deepEqual(fs.readdirSync(outside),[]);
  assert.throws(()=>readDelegationAttempts(root),/Symlink/);
});

test('contradictory explicit correlation on reordered events is not attributed to either Work',async t=>{
  const root=temp(t),hooks=createDelegationObserver(root);
  await hooks.event(part('completed'));
  await hooks['tool.execute.before'](input,{args:{prompt:'workId: W-2\ntaskId: T-1'}});
  await hooks.event(part('running'));
  const [value]=readDelegationAttempts(root);
  assert.equal(value.status,'completed');
  assert.equal(value.workId,undefined);
  assert.deepEqual(value.correlationConflicts,['workId']);
  assert.equal(value.taskId,'T-1');
  assert.deepEqual(readDelegationAttempts(root,{workId:'W-1'}),[]);
  assert.deepEqual(readDelegationAttempts(root,{workId:'W-2'}),[]);
});

// Actual plugin/tool registration against the installed v1 package, in an isolated fixture.
test('an ambiguous late prompt invalidates earlier correlation permanently',async t=>{
  const root=temp(t),hooks=createDelegationObserver(root);
  await hooks['tool.execute.before'](input,{args});
  await hooks.event(part('completed',{input:{prompt:'workId: W-1\nworkId: W-2\ntaskId: T-1'}}));
  await hooks['tool.execute.before'](input,{args});
  const [value]=readDelegationAttempts(root);
  assert.equal(value.workId,undefined);assert.equal(value.taskId,'T-1');
  assert.deepEqual(value.correlationConflicts,['workId']);assert.equal(value.status,'completed');
});

test('contradictory child bindings cannot attribute unrelated session errors',async t=>{
  const root=temp(t),hooks=createDelegationObserver(root);
  await hooks.event(part('running',{metadata:{sessionId:'ses_child_one'}}));
  await hooks.event(part('running',{metadata:{sessionId:'ses_child_two'}}));
  await hooks.event(part('running',{metadata:{sessionId:'ses_child_one'}}));
  for(const sessionID of ['ses_child_one','ses_child_two'])await hooks.event(session('session.error',{sessionID,error:{name:'MessageAbortedError'}}));
  const [value]=readDelegationAttempts(root);
  assert.equal(value.childSessionID,undefined);assert.equal(value.childSessionConflict,true);assert.equal(value.status,'in_progress');assert.equal(value.liveness,'unknown');
});

test('plugin registers real hooks and routes optional create, explicit sync/recover and attempt reads',async t=>{
  const dependencies=process.env.PULSO_TEST_PLUGIN_NODE_MODULES||path.join(os.homedir(),'.config/opencode/node_modules');
  if(!fs.existsSync(path.join(dependencies,'@opencode-ai/plugin')))return t.skip('Local OpenCode v1 dependencies unavailable');
  const root=temp(t),runtime=temp(t),lib=path.join(runtime,'lib');
  fs.mkdirSync(lib);
  fs.symlinkSync(dependencies,path.join(runtime,'node_modules'));
  for(const name of ['delegation-observer.mjs','fs.mjs'])fs.copyFileSync(new URL(`../lib/${name}`,import.meta.url),path.join(lib,name));
  fs.writeFileSync(path.join(lib,'work-mutations.mjs'),`
    export const createWorkOperation=(root,args)=>({operation:'create',...args,workId:args.workId||'AUTO-1'});
    export const syncWorkOperation=(root,args)=>({operation:'sync',...args});
    export const recoverWorkspaceOperation=root=>({operation:'recover'});
    export const readStatus=()=>{throw new Error('Invalid current index, not legacy');};
  `);
  fs.writeFileSync(path.join(lib,'artifacts.mjs'),'export {};');
  fs.writeFileSync(path.join(lib,'receipts.mjs'),'export const formatReceipt=value=>JSON.stringify(value);');
  const source=fs.readFileSync(new URL('../plugins/opencode-v1/index.mjs',import.meta.url),'utf8');
  fs.writeFileSync(path.join(runtime,'plugin.mjs'),source);
  fs.copyFileSync(new URL('../plugins/opencode-v1/contracts.mjs',import.meta.url),path.join(runtime,'contracts.mjs'));
  const {PulsoPlugin}=await import(pathToFileURL(path.join(runtime,'plugin.mjs')).href);
  const plugin=await PulsoPlugin({directory:root,homeDir:runtime,coreDir:lib});
  for(const name of ['tool.execute.before','tool.execute.after','event'])assert.equal(typeof plugin[name],'function');
  assert.equal(fs.existsSync(path.join(root,'.pulso')),false);
  const work=plugin.tool.pulso_work,workspace=plugin.tool.pulso_workspace,context={directory:root,ask:async()=>{}};
  assert.equal(work.args.request.safeParse({action:'create',title:'Fixture'}).success,false);
  assert.equal(work.args.request.safeParse({action:'get',workId:'../bad'}).success,false);
  const created=await work.execute({request:{action:'create',title:'Fixture',objective:'Check',criterion:'Valid',verification:'Fixture'}},context);
  assert.equal(JSON.parse(created.output).workId,'AUTO-1');
  assert.equal((await work.execute({action:'get'},context)).metadata.ok,false);
  assert.equal((await workspace.execute({action:'sync'},context)).metadata.ok,false);
  const synced=await workspace.execute({action:'sync',workId:'W-1',expectedRevision:3},context);
  assert.deepEqual(JSON.parse(synced.output),{operation:'sync',action:'sync',workId:'W-1',expectedRevision:3});
  assert.equal(JSON.parse((await workspace.execute({action:'recover'},context)).output).operation,'recover');
  await plugin['tool.execute.before'](input,{args});
  await plugin.event(part('error',{error:'secret'}));
  const read=await workspace.execute({request:{action:'reconcile_attempts'}},context);
  assert.deepEqual(JSON.parse(read.output),[]);
  assert.equal(fs.existsSync(path.join(root,'.pulso')),false);
  fs.mkdirSync(path.join(root,'.pulso'));
  fs.writeFileSync(path.join(root,'.pulso/state.json'),JSON.stringify({schemaVersion:1,works:'corrupt'}));
  assert.equal((await workspace.execute({action:'status'},context)).metadata.ok,false);
  fs.writeFileSync(path.join(root,'.pulso/state.json'),'{broken');
  assert.equal((await workspace.execute({action:'status'},context)).metadata.ok,false);
  fs.writeFileSync(path.join(root,'.pulso/state.json'),JSON.stringify({schema_version:1}));
  assert.match((await workspace.execute({action:'status'},context)).output,/legacy detectado/);
  fs.writeFileSync(path.join(root,'.pulso/state.json'),JSON.stringify({schema_version:2}));
  assert.equal((await workspace.execute({action:'status'},context)).metadata.ok,false);
});

test('plugin integrates with actual core create/sync/recover without guessing IDs or exposing state',async t=>{
  const dependencies=process.env.PULSO_TEST_PLUGIN_NODE_MODULES||path.join(os.homedir(),'.config/opencode/node_modules');
  if(!fs.existsSync(path.join(dependencies,'@opencode-ai/plugin')))return t.skip('Local OpenCode v1 dependencies unavailable');
  const root=temp(t),runtime=temp(t),lib=fileURLToPath(new URL('../lib/',import.meta.url));
  fs.symlinkSync(dependencies,path.join(runtime,'node_modules'));
  const source=fs.readFileSync(new URL('../plugins/opencode-v1/index.mjs',import.meta.url),'utf8');
  fs.writeFileSync(path.join(runtime,'plugin.mjs'),source);
  fs.copyFileSync(new URL('../plugins/opencode-v1/contracts.mjs',import.meta.url),path.join(runtime,'contracts.mjs'));
  const {initArtifacts,status}=await import('../lib/artifacts.mjs');
  initArtifacts(root);
  const {PulsoPlugin}=await import(pathToFileURL(path.join(runtime,'plugin.mjs')).href);
  const plugin=await PulsoPlugin({directory:root,homeDir:runtime,coreDir:lib}),context={directory:root,ask:async()=>{}};
  const created=await plugin.tool.pulso_work.execute({action:'create',title:'Fixture',objective:'Exercise adapter integration',criterion:'Actual core accepts optional ID',verification:'Temporary test'},context);
  assert.equal(created.metadata.ok,true,created.output);
  const work=status(root).works[0];
  assert.match(work.id,/^PULSO-/);
  assert.match(created.output,new RegExp(work.id));
  const workFile=path.join(root,'.pulso/work',work.id,'work.json'),canonical=fs.readFileSync(workFile,'utf8');
  const synced=await plugin.tool.pulso_workspace.execute({action:'sync',workId:work.id,expectedRevision:work.workRevision},context);
  assert.equal(synced.metadata.ok,true,synced.output);
  const stale=await plugin.tool.pulso_workspace.execute({action:'sync',workId:work.id,expectedRevision:work.workRevision+1},context);
  assert.equal(stale.metadata.ok,false);
  fs.writeFileSync(path.join(root,'.pulso/state.json'),'{broken');
  assert.equal((await plugin.tool.pulso_workspace.execute({action:'status'},context)).metadata.ok,false);
  const recovered=await plugin.tool.pulso_workspace.execute({action:'recover'},context);
  assert.equal(recovered.metadata.ok,true,recovered.output);
  assert.equal(status(root).works[0].id,work.id);
  assert.equal(fs.readFileSync(workFile,'utf8'),canonical);
  assert.equal(JSON.parse(recovered.output).recovered,true);
  assert.equal(fs.existsSync(path.join(root,'.pulso/delegation-attempts')),false);
});
