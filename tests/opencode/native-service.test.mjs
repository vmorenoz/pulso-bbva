import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';

// Actual vendored Promise transport, but only disposable loopback HTTP servers.
// These tests neither discover a user service nor call a provider or start a host.
const source=fileURLToPath(new URL('../../',import.meta.url));
const unavailable=error=>error?.code==='NATIVE_AUTHORITY_UNAVAILABLE';
const write=(file,bytes)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);};
async function listen(server){await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});return `http://127.0.0.1:${server.address().port}/`;}
async function close(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
async function fixture(t){
  const host='opencode';
  const base=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'pulso-native-service-'))),project=path.join(base,'project'),otherProject=path.join(base,'other-project'),plugin=path.join(base,'plugin');
  for(const directory of [project,otherProject,plugin])fs.mkdirSync(directory);
  fs.copyFileSync(path.join(source,'harness/plugin/native-read.mjs'),path.join(plugin,'native-read.mjs'));
  fs.cpSync(path.join(source,'harness/vendor'),path.join(plugin,'vendor'),{recursive:true});
  const {createNativeReader}=await import(pathToFileURL(path.join(plugin,'native-read.mjs')).href);
  const version='2.1.2',password='isolated-test-secret',serviceFile=path.join(base,'service.json');
  const requests=[],session={id:'ses_test',projectID:'project_test',parentID:'ses_parent',agent:'pulso-explorer',location:{directory:project}};
  const messages=[{id:'msg_one',type:'user',content:[{type:'text',text:'Before compact'}]},{id:'msg_two',type:'assistant',agent:'pulso-explorer',content:[]}];
  const state={info:{name:host,version,pid:process.pid},native:structuredClone(session),remote:structuredClone(session),messages,active:{ses_test:{type:'running'}},expectedAuth:'Basic '+Buffer.from(`${host}:${password}`).toString('base64')};
  const server=http.createServer((request,response)=>{
    const url=new URL(request.url,'http://127.0.0.1');requests.push({method:request.method,path:url.pathname,query:Object.fromEntries(url.searchParams),authorization:request.headers.authorization});
    response.setHeader('content-type','application/json');
    if(request.headers.authorization!==state.expectedAuth){response.statusCode=401;return response.end(JSON.stringify({type:'UnauthorizedError',message:'Fixture authentication rejected'}));}
    if(state.respond?.(request,response,url))return;
    if(url.pathname==='/api/info')return response.end(JSON.stringify(state.info));
    if(url.pathname==='/api/session/active')return response.end(JSON.stringify({data:state.active}));
    if(url.pathname==='/api/session/ses_test')return response.end(JSON.stringify({data:state.remote}));
    if(url.pathname==='/api/session/ses_test/message')return response.end(JSON.stringify({data:state.messages,cursor:{}}));
    if(url.pathname==='/api/session/ses_test/message/msg_two')return response.end(JSON.stringify({data:state.messages[1]}));
    response.statusCode=404;response.end('{}');
  });
  const url=await listen(server);
  t.after(async()=>{await close(server);fs.rmSync(base,{recursive:true,force:true});});
  const registration={id:'isolated_service',version,pid:process.pid,url,password};write(serviceFile,JSON.stringify(registration));
  const ctx={app:{name:host,version,serviceFile},options:{},session:{get:async()=>structuredClone(state.native)}};
  return {base,project,otherProject,serviceFile,ctx,state,requests,registration,url,password,createNativeReader,server};
}
async function noNetwork(action){
  const original=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;throw new Error('Unexpected network attempt in validation test');};
  try{await action();assert.equal(calls,0,'Validation must precede every network probe');}finally{globalThis.fetch=original;}
}

test(`OpenCode registration uses exact host Basic identity and independently binds full reads`,async t=>{
  const f=await fixture(t),before=fs.readFileSync(f.serviceFile),reader=await f.createNativeReader(f.ctx);
  assert.deepEqual(await reader.getSession('ses_test'),f.state.native);assert.deepEqual(f.requests,[],'Native getSession must not require a replay service');
  assert.deepEqual(await reader.history('ses_test'),f.state.messages);
  assert.deepEqual(await reader.getMessage('ses_test','msg_two'),f.state.messages[1]);
  assert.deepEqual(await reader.status(),f.state.active);
  assert.ok(f.requests.every(request=>request.method==='GET'&&request.authorization===f.state.expectedAuth));
  assert.equal(f.requests.filter(request=>request.path==='/api/info').length,1,'Validated transport is reused');
  assert.equal(f.requests.filter(request=>request.path==='/api/session/ses_test').length,4,'Each read binds before and after');
  assert.ok(!f.requests.some(request=>/context|prompt|generate|pair|connect/.test(request.path)));
  assert.deepEqual(fs.readFileSync(f.serviceFile),before,'Read-only discovery never rewrites registration');
});

test(`OpenCode explicit servicePassword is separate from URL and uses exact Basic username`,async t=>{
  const f=await fixture(t),ctx={...f.ctx,app:{...f.ctx.app,serviceFile:path.join(f.base,'absent.json')},options:{serviceUrl:f.url,servicePassword:f.password}};
  assert.deepEqual(await(await f.createNativeReader(ctx)).status(),f.state.active);
  assert.ok(f.requests.every(request=>request.authorization===f.state.expectedAuth));
  for(const servicePassword of ['', ' ',null,1,{},[]])await noNetwork(async()=>{
    await assert.rejects((await f.createNativeReader({...ctx,options:{...ctx.options,servicePassword}})).status(),unavailable);
  });
  f.requests.length=0;f.state.expectedAuth=undefined;
  assert.deepEqual(await(await f.createNativeReader({...ctx,options:{serviceUrl:f.url}})).status(),f.state.active);
  assert.ok(f.requests.every(request=>request.authorization===undefined),'Omitted password never invents credentials');
});

test(`OpenCode invalid registration fields fail before authentication or any request`,async t=>{
  const f=await fixture(t);
  const changes=[{id:undefined},{id:''},{id:' '},{id:1},{version:undefined},{version:'2.1.3'},{pid:undefined},{pid:0},{pid:-1},{pid:1.5},{pid:'1'},{password:null},{password:''},{password:' '},{password:3},{password:{}}];
  for(const change of changes){
    write(f.serviceFile,JSON.stringify({...f.registration,...change}));
    await noNetwork(async()=>assert.rejects((await f.createNativeReader(f.ctx)).status(),unavailable));
  }
  assert.deepEqual(f.requests,[]);
});

test(`OpenCode unsafe service URLs are rejected without attempting remote or credential-bearing requests`,async t=>{
  const f=await fixture(t),urls=['https://example.invalid/','http://192.0.2.1/','http://127.0.0.1.example.invalid/','file:///tmp/service','ftp://127.0.0.1/','http://user:secret@127.0.0.1/','http://127.0.0.1/path','http://127.0.0.1/?token=secret','http://127.0.0.1/#secret','not a URL',null];
  for(const url of urls){
    write(f.serviceFile,JSON.stringify({...f.registration,url}));
    await noNetwork(async()=>assert.rejects((await f.createNativeReader(f.ctx)).status(),unavailable));
    if(url!==null)await noNetwork(async()=>assert.rejects((await f.createNativeReader({...f.ctx,options:{serviceUrl:url,servicePassword:f.password}})).status(),unavailable));
  }
  assert.deepEqual(f.requests,[]);
});

test(`OpenCode registration is absolute, regular, nonsymlink and bounded to 64 KiB`,async t=>{
  const f=await fixture(t),link=path.join(f.base,'service-link.json');fs.symlinkSync(f.serviceFile,link);
  for(const serviceFile of ['relative.json',link,f.base,path.join(f.base,'missing.json')])await noNetwork(async()=>{
    await assert.rejects((await f.createNativeReader({...f.ctx,app:{...f.ctx.app,serviceFile}})).status(),unavailable);
  });
  for(const content of ['{broken','null','[]',' '.repeat(65537),JSON.stringify(f.registration)+' '.repeat(65537)]){
    write(f.serviceFile,content);await noNetwork(async()=>assert.rejects((await f.createNativeReader(f.ctx)).status(),unavailable));
  }
  const exact=JSON.stringify(f.registration).padEnd(65536,' ');assert.equal(Buffer.byteLength(exact),65536);write(f.serviceFile,exact);
  assert.deepEqual(await(await f.createNativeReader(f.ctx)).status(),f.state.active);
});

test(`OpenCode probe response must match the registered version and PID before replay`,async t=>{
  const f=await fixture(t),original=structuredClone(f.state.info);
  const changes=[{version:undefined},{version:'wrong'},{pid:undefined},{pid:process.pid+1},{pid:String(process.pid)}];
  for(const change of changes){
    f.requests.length=0;f.state.info={...original,...change};
    await assert.rejects((await f.createNativeReader(f.ctx)).history('ses_test'),unavailable);
    assert.deepEqual(f.requests.map(request=>request.path),['/api/info'],'Rejected service never supplies session/history data');
  }
});

test('OpenCode default registration remains read-only and foreign hosts fail before discovery',async t=>{
  const f=await fixture(t),state=path.join(f.base,'state'),file=path.join(state,'opencode/service.json');write(file,JSON.stringify(f.registration));
  const previous=process.env.XDG_STATE_HOME;process.env.XDG_STATE_HOME=state;
  try{
    const app={...f.ctx.app};delete app.serviceFile;
    assert.deepEqual(await(await f.createNativeReader({...f.ctx,app})).status(),f.state.active);
    f.requests.length=0;
    for(const app of [{name:'pulso',version:'0.1.0'},{name:'pulso',version:'2.1.2'},{name:'other',version:'2.1.2'},{name:'opencode',version:'2.1.3'},{}])await noNetwork(async()=>{
      await assert.rejects((await f.createNativeReader({...f.ctx,app})).status(),/Unsupported native host/);
      await assert.rejects((await f.createNativeReader({...f.ctx,app,options:{serviceUrl:f.url}})).status(),/Unsupported native host/);
    });
    assert.deepEqual(f.requests,[]);assert.deepEqual(JSON.parse(fs.readFileSync(file)),f.registration);
  }finally{if(previous===undefined)delete process.env.XDG_STATE_HOME;else process.env.XDG_STATE_HOME=previous;}
});

test('loopback probe cannot follow redirects to another endpoint',async t=>{
  const f=await fixture(t),redirected=[];
  const oracle=http.createServer((request,response)=>{redirected.push(request.url);response.setHeader('content-type','application/json');response.end(JSON.stringify(f.state.info));});
  const destination=await listen(oracle);t.after(()=>close(oracle));
  f.state.respond=(request,response,url)=>{if(url.pathname!=='/api/info')return false;response.statusCode=302;response.setHeader('location',`${destination}api/info`);response.end();return true;};
  await assert.rejects((await f.createNativeReader(f.ctx)).status());
  assert.deepEqual(redirected,[],'No redirected network request is authorized by a validated initial origin');
});

test('HTTP full-history and individual message reads reject independently mismatched native identities',async t=>{
  const f=await fixture(t),original=structuredClone(f.state.remote);
  for(const change of [{id:'foreign'},{projectID:'foreign'},{parentID:'different'},{agent:'different'},{location:{directory:f.otherProject}}])for(const method of ['history','getMessage']){
    f.requests.length=0;f.state.remote={...original,...change};
    const reader=await f.createNativeReader(f.ctx);
    await assert.rejects(method==='history'?reader.history('ses_test'):reader.getMessage('ses_test','msg_two'),/does not match/);
    assert.ok(!f.requests.some(request=>request.path.includes('/message')));
  }
  f.requests.length=0;f.state.native={...original,projectID:undefined};
  await noNetwork(async()=>assert.rejects((await f.createNativeReader(f.ctx)).history('ses_test'),/Incomplete native session/));
});

test('complete history accepts native null terminal cursors, avoids compacted context and detects duplicate pages',async t=>{
  const f=await fixture(t);f.ctx.session.context=async()=>{throw new Error('Compacted context is not full history');};
  f.state.respond=(request,response,url)=>{
    if(url.pathname!=='/api/session/ses_test/message')return false;
    const next=url.searchParams.has('cursor');response.end(JSON.stringify({data:[f.state.messages[next?1:0]],cursor:next?{next:null,prev:'previous-page'}:{next:'opaque-cursor',prev:null}}));return true;
  };
  assert.deepEqual(await(await f.createNativeReader(f.ctx)).history('ses_test'),f.state.messages);
  assert.deepEqual(f.requests.filter(request=>request.path.endsWith('/message')).map(request=>request.query),[{limit:'200',order:'asc'},{limit:'200',cursor:'opaque-cursor'}]);
  f.state.respond=(request,response,url)=>{if(!url.pathname.endsWith('/message'))return false;response.end(JSON.stringify({data:[f.state.messages[0]],cursor:{next:'same'}}));return true;};
  await assert.rejects((await f.createNativeReader(f.ctx)).history('ses_test'),/Ambiguous native history/);
});

for(const method of ['history','getMessage'])test(`${method} rejects shared local/remote rebind during a read`,async t=>{
  const f=await fixture(t),initial=structuredClone(f.state.native);
  for(const change of [{projectID:'project_other'},{parentID:'ses_other'},{agent:'pulso-executor'},{location:{directory:f.otherProject}}]){
    let session=structuredClone(initial);
    const mutate=()=>{session={...session,...change};};
    const ctx={...f.ctx,session:{get:async()=>structuredClone(session)}};
    const client={session:{get:async()=>structuredClone(session),message:{get:async()=>{mutate();return f.state.messages[1];}}},message:{list:async()=>{mutate();return {data:f.state.messages,cursor:{}};}}};
    const reader=await f.createNativeReader(ctx,{client});
    await assert.rejects(method==='history'?reader.history('ses_test'):reader.getMessage('ses_test','msg_two'),/moved or rebound/);
  }
});


test('nonregular FIFO registration is rejected without blocking the host process',{skip:process.platform==='win32'},async t=>{
  const f=await fixture(t),fifo=path.join(f.base,'service-fifo');
  const created=spawnSync('mkfifo',[fifo],{encoding:'utf8'});assert.equal(created.status,0,created.stderr||created.error?.message);
  const ctx={app:{...f.ctx.app,serviceFile:fifo},options:{}};
  const script=`import {createNativeReader} from ${JSON.stringify(pathToFileURL(path.join(f.base,'plugin/native-read.mjs')).href)};
    globalThis.fetch=async()=>{throw new Error('Unexpected network request');};
    try{await(await createNativeReader(${JSON.stringify(ctx)})).status();process.exitCode=2;}
    catch(error){if(error.code!=='NATIVE_AUTHORITY_UNAVAILABLE')throw error;console.log('REJECTED');}`;
  const child=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',timeout:1500,env:{HOME:f.base,USERPROFILE:f.base,PATH:'',TMPDIR:f.base}});
  assert.equal(child.error?.code,undefined,'Opening a FIFO must not hang before the regular-file check');
  assert.equal(child.status,0,child.stderr);assert.match(child.stdout,/REJECTED/);assert.deepEqual(f.requests,[]);
});


async function liveFixture(t){
  const f=await fixture(t),part={type:'tool',name:'subagent',id:'call_child',executed:false,state:{status:'running',input:{agent:'pulso-explorer',description:'Fixture assignment',prompt:'Fixture prompt'},metadata:{}}};
  // Native V2 persists the running parent ToolPart with empty metadata. Its
  // child sessionID first arrives as ephemeral session.tool.progress metadata.
  const message={id:'msg_parent',type:'assistant',agent:'pulso',content:[part]},messages=[message];
  const client={session:{get:async()=>structuredClone(f.state.native)},message:{list:async()=>({data:messages,cursor:{next:null,prev:null}})}};
  const reader=await f.createNativeReader(f.ctx,{client});
  const progress=(change={})=>({type:'session.tool.progress',data:{sessionID:'ses_test',assistantMessageID:'msg_parent',id:'call_child',metadata:{sessionID:'ses_child',status:'running',private:'must-not-be-cached'},...change}});
  const history=options=>reader.history('ses_test',options),metadata=result=>result[0].content[0].state.metadata;
  return {...f,part,message,messages,client,reader,progress,history,metadata};
}

test('native live progress overlays only explicit current-authority reads and never changes durable history',async t=>{
  const f=await liveFixture(t),before=structuredClone(f.messages);
  assert.deepEqual(f.metadata(await f.history({includeLive:true})),{});
  f.reader.observe(f.progress());
  assert.deepEqual(f.metadata(await f.history()),{});
  assert.deepEqual(f.metadata(await f.history({includeLive:false})),{});
  assert.deepEqual(f.metadata(await f.history({includeLive:true})),{sessionID:'ses_child',status:'running'});
  assert.deepEqual(f.messages,before,'Overlay must not mutate the durable parent parts returned by the client');
  const restarted=await f.createNativeReader(f.ctx,{client:f.client});
  assert.deepEqual(f.metadata(await restarted.history('ses_test',{includeLive:true})),{},'Restart cannot reconstruct ephemeral authority from a prior process');
  assert.deepEqual(f.requests,[],'Injected read-only client uses no host/provider HTTP');
});

test('live child identity requires the exact parent session, message and call, plus native running metadata',async t=>{
  const f=await liveFixture(t);
  for(const change of [{sessionID:'other-session'},{assistantMessageID:'other-message'},{id:'other-call'},{sessionID:''},{assistantMessageID:''},{id:''},{metadata:{}},{metadata:{sessionID:'ses_child',status:'completed'}},{metadata:{sessionID:'',status:'running'}}]){
    f.reader.observe(f.progress(change));
    assert.deepEqual(f.metadata(await f.history({includeLive:true})),{},JSON.stringify(change));
  }
  for(const event of [null,{}, {type:'session.tool.progress'}, {type:'session.unknown',data:f.progress().data}]){
    assert.doesNotThrow(()=>f.reader.observe(event));assert.deepEqual(f.metadata(await f.history({includeLive:true})),{});
  }
  f.reader.observe(f.progress());assert.equal(f.metadata(await f.history({includeLive:true})).sessionID,'ses_child');
});

test('live overlay applies only to running assistant subagent parts, never terminal or unrelated tools',async t=>{
  const f=await liveFixture(t);f.reader.observe(f.progress());
  for(const status of ['completed','error','pending','cancelled']){
    f.part.state.status=status;assert.deepEqual(f.metadata(await f.history({includeLive:true})),{});
  }
  f.part.state.status='running';
  for(const name of ['shell','pulso_work','task']){
    f.part.name=name;assert.deepEqual(f.metadata(await f.history({includeLive:true})),{});
  }
  f.part.name='subagent';f.message.type='user';assert.deepEqual(f.metadata(await f.history({includeLive:true})),{});
  f.message.type='assistant';assert.equal(f.metadata(await f.history({includeLive:true})).sessionID,'ses_child');
});

for(const eventType of ['session.tool.success','session.tool.failed','session.moved'])test(`${eventType} removes cached child progress without modifying durable parent history`,async t=>{
  const f=await liveFixture(t);f.reader.observe(f.progress());
  assert.equal(f.metadata(await f.history({includeLive:true})).sessionID,'ses_child');
  const data=eventType==='session.moved'?{sessionID:'ses_test'}:{sessionID:'ses_test',assistantMessageID:'msg_parent',id:'call_child'};
  f.reader.observe({type:eventType,data});
  assert.deepEqual(f.metadata(await f.history({includeLive:true})),{});assert.deepEqual(f.part.state.metadata,{});
});

test('unrelated terminal and moved events cannot erase another native call identity',async t=>{
  const f=await liveFixture(t);f.reader.observe(f.progress());
  for(const event of [
    {type:'session.tool.success',data:{sessionID:'ses_test',assistantMessageID:'wrong',id:'call_child'}},
    {type:'session.tool.failed',data:{sessionID:'ses_test',assistantMessageID:'msg_parent',id:'wrong'}},
    {type:'session.moved',data:{sessionID:'other-session'}},
  ]){f.reader.observe(event);assert.equal(f.metadata(await f.history({includeLive:true})).sessionID,'ses_child');}
});

test('live child cache is bounded to 256 entries; eviction cannot invent or persist lost authority',async t=>{
  const f=await liveFixture(t);f.message.content=[];
  for(let i=0;i<257;i++){
    f.message.content.push({...structuredClone(f.part),id:`call_${i}`});
    f.reader.observe(f.progress({id:`call_${i}`,metadata:{sessionID:`ses_child_${i}`,status:'running'}}));
  }
  const result=await f.history({includeLive:true}),parts=result[0].content;
  assert.deepEqual(parts[0].state.metadata,{});
  assert.equal(parts.filter(part=>part.state.metadata.sessionID).length,256);
  assert.equal(parts.at(-1).state.metadata.sessionID,'ses_child_256');
  assert.ok((await f.history())[0].content.every(part=>Object.keys(part.state.metadata).length===0));
  f.reader.observe({type:'session.moved',data:{sessionID:'ses_test'}});
  assert.ok((await f.history({includeLive:true}))[0].content.every(part=>Object.keys(part.state.metadata).length===0));
});

test('conflicting persisted/live child metadata fails safely and never contaminates durable replay',async t=>{
  const f=await liveFixture(t);f.reader.observe(f.progress());
  f.part.state.metadata={sessionID:'ses_different',status:'running',nativeField:'keep'};
  await assert.rejects(f.history({includeLive:true}),error=>unavailable(error)&&/Conflicting native live child identity/.test(error.message));
  assert.deepEqual(f.metadata(await f.history()),{sessionID:'ses_different',status:'running',nativeField:'keep'});
  f.part.state.metadata.sessionID='ses_child';
  assert.deepEqual(f.metadata(await f.history({includeLive:true})),{sessionID:'ses_child',status:'running',nativeField:'keep'});
});
