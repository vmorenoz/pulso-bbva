/** Opt-in real native host acceptance with an HTTP-only local scripted provider.
 * No model credentials, network provider, global configuration, or self-orchestration.
 * Run after build: PULSO_NATIVE_BINARY=/path/to/opencode npm run smoke:native
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
const source=fileURLToPath(new URL('../../',import.meta.url));
const binary=process.env.PULSO_NATIVE_BINARY;
const host='opencode',providerID='fixture',modelID='fixture';
if(!binary||!path.isAbsolute(binary))throw Error('Set PULSO_NATIVE_BINARY to an existing absolute OpenCode 2.1.2 executable; this test never installs a host.');
fs.accessSync(binary,fs.constants.X_OK);
const base=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'pulso-native-host-')));
for(const d of ['home','config','data','state','cache','project'])fs.mkdirSync(path.join(base,d));
const project=path.join(base,'project'),password='isolated-fixture-not-a-secret';
const headers={authorization:'Basic '+Buffer.from(host+':'+password).toString('base64')};
const permissions=['pulso_workspace','pulso_work','pulso_history','pulso_context','subagent'].map(action=>({action,resource:'*',effect:'allow'}));
const requests=[],errors=[];let mainStep=0,sequence=0,server,log='',passed=false;
let continuity,foreground,background;
const task=id=>({id,title:id,criterionIds:['AC-1'],agent:'pulso-explorer',status:'pending',dependsOn:[],writeScope:[],resources:[],acceptance:['Report']});
const envelope=(name,input)=>[name,name==='pulso_history'||name==='subagent'?input:{request:input}];
const primarySteps=[
 ()=>envelope('pulso_workspace',{action:'prepare'}),
 ()=>envelope('pulso_work',{action:'create',workId:'NATIVE',title:'Native fixture',objective:'Verify native transport',criterion:'Four tools and child correlation',verification:'Native transcript'}),
 ()=>envelope('pulso_history',{}),
 ()=>envelope('pulso_context',{action:'read',scope:'project'}),
 ()=>envelope('pulso_work',{action:'update',workId:'NATIVE',expectedRevision:1,actions:['FG','BG'].map(id=>({type:'task.add',task:task(id)}))}),
 ()=>envelope('pulso_workspace',{action:'bind_continuity',workId:'NATIVE',requestKey:'native-bind',objective:'Verify native transport',repositories:['.'],constraints:[]}),
 ()=>envelope('pulso_work',{action:'prepare_delegation',contractVersion:2,workId:'NATIVE',expectedRevision:2,continuityId:continuity.continuityId,intentRevision:continuity.intentRevision,requestKey:'native-FG',taskIds:['FG'],objective:'NATIVE_FG report',inputs:[],output:'conversation',constraints:[],templateId:'exploration'}),
 ()=>envelope('subagent',{agent:foreground.agent,prompt:foreground.specialistPrompt,description:'Native foreground fixture'}),
 ()=>envelope('pulso_work',{action:'prepare_delegation',contractVersion:2,workId:'NATIVE',expectedRevision:2,continuityId:continuity.continuityId,intentRevision:continuity.intentRevision,requestKey:'native-BG',taskIds:['BG'],objective:'NATIVE_BG report',inputs:[],output:'conversation',constraints:[],templateId:'exploration'}),
 ()=>envelope('subagent',{agent:background.agent,prompt:background.specialistPrompt,description:'Native background fixture',background:true}),
];
function receiptMessages(messages){return messages.filter(m=>m.role==='tool').map(m=>{try{return JSON.parse(m.content);}catch{return null;}}).filter(Boolean);}
const provider=http.createServer(async(req,res)=>{
 try{
  assert.equal(req.url,'/v1/chat/completions');let raw='';for await(const chunk of req)raw+=chunk;
  const body=JSON.parse(raw),messages=body.messages;requests.push(body);
  const child=messages.some(m=>m.role==='system'&&m.content.includes('NATIVE_CHILD'));
  const special=messages.find(m=>m.role==='user'&&/^NATIVE_(DENY|CANCEL)/.test(m.content))?.content;
  let step,text='NATIVE_DONE';
  if(messages.some(m=>typeof m.content==='string'&&m.content.includes('You MUST summarize the conversation above'))){text='## Objective\nVerify native transport.\n## Requirements\nIsolated fixture only.\n## Decisions\nDo not redispatch.\n## Work State\n### Completed\nTwo child reports captured.\n### Active\nNone.\n### Blocked\nNone.\n## Next Move\nRead existing records.\n## Relevant Files\nNone.\n## Important Context\nPreserve durable IDs.';}
  else if(child){
   const receipts=receiptMessages(messages);
   if(!receipts.length)step=envelope('pulso_workspace',{action:'get_assignment'});
   else {assert.equal(receipts.at(-1).ok,true,JSON.stringify(receipts.at(-1)));text='Native child verified its assigned scope.';if(messages.some(m=>typeof m.content==='string'&&m.content.includes('NATIVE_BG')))await delay(350);}
  }else if(special){if(!messages.some(m=>m.role==='tool'))step=envelope('pulso_work',{action:'create',workId:special,title:special,objective:'Must not write',criterion:'Denied',verification:'No artifact'});}
  else{
   for(const receipt of receiptMessages(messages)){
    assert.equal(receipt.ok,true,JSON.stringify(receipt));
    if(receipt.data?.continuityId&&receipt.data?.intentRevision&&!receipt.data?.specialistPrompt)continuity=receipt.data;
    if(receipt.data?.specialistPrompt){if(receipt.data.taskIds?.includes('BG')||receipt.data.specialistPrompt.includes('NATIVE_BG report'))background=receipt.data;else foreground=receipt.data;}
   }
   step=primarySteps[mainStep++]?.();
  }
  const id=sequence++,delta=step?{role:'assistant',tool_calls:[{index:0,id:`fixture_${id}`,type:'function',function:{name:step[0],arguments:JSON.stringify(step[1])}}]}:{role:'assistant',content:text};
  res.writeHead(200,{'content-type':'text/event-stream'});
  const chunk=(delta,finish_reason)=>({id:'fixture-'+id,object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta,finish_reason}]});
  res.end(`data: ${JSON.stringify(chunk(delta,null))}\n\ndata: ${JSON.stringify({...chunk({},step?'tool_calls':'stop'),usage:{prompt_tokens:10,completion_tokens:10,total_tokens:20}})}\n\ndata: [DONE]\n\n`);
 }catch(error){errors.push(error);res.writeHead(500);res.end(JSON.stringify({error:{message:error.message}}));}
});
const listen=socket=>new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));
await listen(provider);const providerURL=`http://127.0.0.1:${provider.address().port}`;
const probe=http.createServer();await listen(probe);const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));const url=`http://127.0.0.1:${port}`;
fs.writeFileSync(path.join(project,host+'.json'),JSON.stringify({plugins:[{package:path.join(source,'dist/opencode'),options:{serviceUrl:url,servicePassword:password}}],update:'disable',snapshots:false,compaction:{keep:{tokens:0}},model:providerID+'/'+modelID,providers:{[providerID]:{package:'@opencode/ai/providers/openai/chat',settings:{baseURL:providerURL+'/v1',apiKey:'isolated-fixture-not-a-secret'},models:{[modelID]:{name:'Local scripted fixture',capabilities:{tools:true},limit:{context:200000,output:4096}}}}},agents:{pulso:{mode:'primary',system:'NATIVE_PRIMARY controlled fixture.',permissions:[{action:'*',resource:'*',effect:'deny'},...permissions,{action:'external_directory',resource:path.join(base,'home','.pulso')+'/**',effect:'allow'}]},'pulso-explorer':{mode:'subagent',system:'NATIVE_CHILD controlled fixture.',permissions:[{action:'*',resource:'*',effect:'deny'},...permissions.filter(p=>p.action!=='subagent')]}},permissions:[{action:'external_directory',resource:'*',effect:'deny'}]}));
const env={HOME:path.join(base,'home'),XDG_CONFIG_HOME:path.join(base,'config'),XDG_DATA_HOME:path.join(base,'data'),XDG_CACHE_HOME:path.join(base,'cache'),XDG_STATE_HOME:path.join(base,'state'),PATH:'/usr/bin:/bin',[host.toUpperCase()+'_SERVER_PASSWORD']:password,[host.toUpperCase()+'_DISABLE_AUTOUPDATE']:'1',[host.toUpperCase()+'_DISABLE_MODELS_FETCH']:'1',[host.toUpperCase()+'_DISABLE_TELEMETRY']:'1'};
async function start(){let spawnError;server=spawn(binary,['serve','--hostname','127.0.0.1','--port',String(port)],{cwd:project,env,stdio:['ignore','pipe','pipe']});server.on('error',error=>{spawnError=error;});server.stdout.on('data',value=>log+=value);server.stderr.on('data',value=>log+=value);await until(async()=>{if(spawnError)throw spawnError;try{return(await fetch(url+'/api/info',{headers})).ok;}catch{return false;}},'host startup');}
async function stop(){if(!server?.pid||server.exitCode!==null)return;server.kill('SIGTERM');await Promise.race([new Promise(resolve=>server.once('exit',resolve)),delay(3000).then(()=>server.kill('SIGKILL'))]);}
async function until(check,label){const end=Date.now()+30000;while(Date.now()<end){if(await check())return;if(errors.length)throw errors[0];await delay(50);}throw Error(`Timed out: ${label}`);}
const tools=history=>history.flatMap(message=>message.type==='assistant'?message.content.filter(part=>part.type==='tool'):[]);
const parsed=part=>JSON.parse(part.state.content.map(c=>c.text??'').join(''));
try{
 await start();
 const {OpenCode}=await import(pathToFileURL(path.join(source,'adapters/opencode/vendor/client/promise/index.js')));
 const client=OpenCode.make({baseUrl:url,headers});const info=await client.server.info();assert.equal(info.version,'2.1.2');
 const session=await client.session.create({title:'Native acceptance',agent:'pulso',model:{providerID,id:modelID},location:{directory:project}});
 await client.session.prompt({sessionID:session.id,text:'NATIVE_HAPPY: Run only the isolated fixture.'});
 await client.session.wait({sessionID:session.id},{signal:AbortSignal.timeout(30000)});
 await until(async()=>{const active=await client.session.active();return !Object.keys(active).length;},'all native children idle');
 const history=(await client.message.list({sessionID:session.id,limit:200,order:'asc'})).data,parts=tools(history);
 for(const name of ['pulso_workspace','pulso_work','pulso_history','pulso_context']){const part=parts.find(p=>p.name===name);assert.equal(part?.state.status,'completed',JSON.stringify(part));assert.equal(parsed(part).ok,true);assert.equal(parsed(part).provenance.host.sessionID,session.id);assert.equal(parsed(part).workspace,project);}
 const children=parts.filter(p=>p.name==='subagent');assert.equal(children.length,2,JSON.stringify(parts));
 assert.deepEqual(children.map(p=>p.state.metadata.status),['completed','running']);
 for(const part of children){assert.equal(part.executed,false);const childID=part.state.metadata.sessionID;const child=await client.session.get({sessionID:childID});assert.equal(child.parentID,session.id);const scoped=tools((await client.message.list({sessionID:childID,limit:200,order:'asc'})).data).find(p=>p.name==='pulso_workspace');assert.equal(parsed(scoped).ok,true,JSON.stringify(scoped));assert.equal(parsed(scoped).data.taskIds.length,1);}
 const {readDelegation}=await import(pathToFileURL(path.join(source,'dist/opencode/resources/lib/delegation-registry.mjs')));
 const records=()=>[foreground,background].map(d=>readDelegation(project,{workId:'NATIVE',delegationId:d.delegationId}));
 await until(()=>records().every(r=>r.returns.length===1),'durable foreground and background captures');
 for(const record of records()){assert.equal(record.attempts.length,1);assert.equal(record.returns[0].provenance,'host_capture');assert.equal(record.accepted,null);}
 const before=records().map(r=>JSON.stringify(r));await stop();await start();
 assert.equal((await client.message.list({sessionID:session.id,limit:200,order:'asc'})).data.length,history.length);
 assert.deepEqual(records().map(r=>JSON.stringify(r)),before,'restart must not duplicate durable effects');
 await client.session.compact({sessionID:session.id});
 await client.session.wait({sessionID:session.id},{signal:AbortSignal.timeout(30000)});
 const full=(await client.message.list({sessionID:session.id,limit:200,order:'asc'})).data;
 assert.ok(full.some(message=>message.type==='compaction'&&message.status==='completed'),'native compaction must finish');
 const window=await client.session.context({sessionID:session.id});
 assert.ok(window.length < full.length,'compacted context must be smaller than complete native history');
 const {createNativeReader}=await import(pathToFileURL(path.join(source,'dist/opencode/plugin/native-read.mjs')));
 const nativeReader=await createNativeReader({app:{name:'cli',version:'2.1.2'},options:{serviceUrl:url,servicePassword:password},session:{get:({sessionID})=>client.session.get({sessionID})}});
 const replayHistory=await nativeReader.history(session.id);assert.equal(replayHistory.length,full.length);
 const {createDurableHooks}=await import(pathToFileURL(path.join(source,'dist/opencode/plugin/durable-hooks.mjs')));
 const replay=createDurableHooks({directory:project,reader:nativeReader});
 for(const part of children){
  const completion=part.state.metadata.status==='running'?replayHistory.find(message=>message.type==='synthetic'&&message.metadata?.childID===part.state.metadata.sessionID):undefined;
  const owner=replayHistory.find(message=>message.type==='assistant'&&message.content.some(p=>p.type==='tool'&&p.id===part.id));
  assert.equal((await replay.replay({sessionID:session.id,messageID:owner.id,part,completion})).capture,'stored');
 }
 assert.deepEqual(records().map(r=>JSON.stringify(r)),before,'native replay after compact must not duplicate effects');
 for(const mode of ['DENY','CANCEL']){
  const denied=await client.session.create({title:'Native '+mode,agent:'pulso',model:{providerID,id:modelID},location:{directory:project},permissions:[{action:'pulso_work',resource:'*',effect:'ask'}]});
  await client.session.prompt({sessionID:denied.id,text:'NATIVE_'+mode});
  let pending;await until(async()=>{pending=(await client.permission.list({sessionID:denied.id}))[0];return !!pending;},'native permission request '+mode);
  assert.equal(pending.action,'pulso_work');
  if(mode==='DENY')await client.permission.reply({sessionID:denied.id,requestID:pending.id,decision:'reject'});else await client.session.interrupt({sessionID:denied.id});
  await client.session.wait({sessionID:denied.id},{signal:AbortSignal.timeout(30000)});
  if(mode==='CANCEL'){const remaining=await client.permission.list({sessionID:denied.id});for(const request of remaining)await client.permission.reply({sessionID:denied.id,requestID:request.id,decision:'once'});await delay(100);}
  assert.equal(fs.existsSync(path.join(project,'.pulso/work','NATIVE_'+mode)),false);
 }
 assert.equal(errors.length,0);passed=true;
 console.log(JSON.stringify({host,version:info.version,provider:'local scripted HTTP, no billed model calls',fourTools:'PASS',nativeChildScope:'PASS',foregroundCapture:'PASS',backgroundCapture:'PASS',restartNoDuplicates:'PASS',permissionDenial:'PASS',cancellation:'PASS',providerRequests:requests.length,compactFullHistoryReplay:'PASS (native compact + real transport, replay driver; no duplicate effects)'}));
}finally{await stop();provider.closeAllConnections();await new Promise(resolve=>provider.close(resolve));if(!passed||process.env.PULSO_KEEP_NATIVE_FIXTURE){fs.writeFileSync(path.join(base,'server.log'),log);fs.writeFileSync(path.join(base,'provider.json'),JSON.stringify(requests,null,2));console.error('Native fixture evidence:',base);}else fs.rmSync(base,{recursive:true,force:true});}
