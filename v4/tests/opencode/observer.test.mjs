import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
const runtime=fs.mkdtempSync(path.join(os.tmpdir(),'pulso-v4-observer-runtime-'));
fs.mkdirSync(path.join(runtime,'plugin'));
fs.mkdirSync(path.join(runtime,'resources/lib'),{recursive:true});
fs.copyFileSync(new URL('../../adapters/opencode/plugin/delegation-observer.mjs',import.meta.url),path.join(runtime,'plugin/delegation-observer.mjs'));
fs.copyFileSync(new URL('../../core/lib/fs.mjs',import.meta.url),path.join(runtime,'resources/lib/fs.mjs'));
const {createDelegationObserver,readDelegationAttempts}=await import(pathToFileURL(path.join(runtime,'plugin/delegation-observer.mjs')).href);
test.after(()=>fs.rmSync(runtime,{recursive:true,force:true}));
function temp(t){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'pulso-v4-observer-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));return directory;}

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

test('duplicated and reordered tool events persist only native tool return without rewriting or regressions',async t=>{
  const root=temp(t),hooks=createDelegationObserver(root);
  await hooks.event(part('completed',{output:'sensitive result',metadata:{sessionId:'ses_child',token:'secret'}}));
  const before=stored(root);
  await hooks.event(part('completed'));
  await hooks['tool.execute.before'](input,{args});
  await hooks.event(part('running'));
  await hooks['tool.execute.after']({...input,args},{output:'secret',metadata:{sessionId:'ses_child'}});
  assert.equal(stored(root),before);
  const [value]=readDelegationAttempts(root);
  assert.equal(value.status,'tool_returned');
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
  assert.equal(value.status,'tool_returned');
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
  assert.deepEqual(value.correlationConflicts,['workId']);assert.equal(value.status,'tool_returned');
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

test('background tool return remains running/unknown and never becomes child completion or acceptance',async t=>{
  const root=temp(t),hooks=createDelegationObserver(root),background={...args,background:true};
  await hooks['tool.execute.before'](input,{args:background});
  await hooks['tool.execute.after']({...input,args:background},{metadata:{sessionId:'ses_child',status:'running'},output:'background started'});
  await hooks.event(part('completed',{input:background,metadata:{sessionId:'ses_child',status:'running'}}));
  for(const type of ['busy','idle'])await hooks.event(session('session.status',{sessionID:'ses_child',status:{type}}));
  const before=stored(root),[value]=readDelegationAttempts(root);
  assert.equal(value.status,'background_running');
  assert.equal(value.liveness,'unknown');
  assert.equal(value.acceptance,'not_assessed');
  assert.equal(value.requiresReview,true);
  createDelegationObserver(root);
  assert.equal(readDelegationAttempts(root)[0].status,'background_running');
  assert.equal(stored(root),before);
  assert.equal(fs.existsSync(path.join(root,'.pulso/work')),false);
});

test('late metadata revealing background mode conservatively corrects earlier tool-return observation',async t=>{
  const root=temp(t),hooks=createDelegationObserver(root);
  await hooks['tool.execute.after']({...input,args},{metadata:{}});
  assert.equal(readDelegationAttempts(root)[0].status,'tool_returned');
  await hooks.event(part('completed',{metadata:{status:'running',sessionId:'ses_child'}}));
  assert.equal(readDelegationAttempts(root)[0].status,'background_running');
  await hooks.event(session('session.error',{sessionID:'ses_child',error:{name:'MessageAbortedError'}}));
  assert.equal(readDelegationAttempts(root)[0].status,'cancelled');
  await hooks['tool.execute.after']({...input,args:{...args,background:true}},{metadata:{status:'running'}});
  assert.equal(readDelegationAttempts(root)[0].status,'cancelled');
});

test('historical completed records are read as tool return without rewriting or inferring acceptance',async t=>{
  const root=temp(t),hooks=createDelegationObserver(root);
  await hooks['tool.execute.after']({...input,args},{metadata:{}});
  const directory=path.join(root,'.pulso/delegation-attempts'),file=path.join(directory,fs.readdirSync(directory)[0]);
  const saved=JSON.parse(fs.readFileSync(file,'utf8'));saved.status='completed';fs.writeFileSync(file,JSON.stringify(saved)+'\n');
  const before=stored(root),[value]=readDelegationAttempts(root);
  assert.equal(value.status,'tool_returned');
  assert.equal(value.acceptance,'not_assessed');
  assert.equal(value.liveness,'unknown');
  assert.equal(stored(root),before);
});
