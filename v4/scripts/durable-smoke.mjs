/** Real v2 core integration. No host simulation, model, network or native dispatch. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const bytes=value=>Buffer.byteLength(JSON.stringify(value));

export async function durableSmoke({resourceRoot=fileURLToPath(new URL('../core',import.meta.url)),tempParent=process.env.PULSO_SMOKE_TMP||os.tmpdir()}={}) {
  resourceRoot=path.resolve(resourceRoot);
  // An extracted target supplies ALL runtime code and schemas. No source fallback.
  const runtimeURL=pathToFileURL(path.join(resourceRoot,'lib/semantic-tools.mjs')).href;
  const {executeTool}=await import(runtimeURL);
  const {assertSchema}=await import(pathToFileURL(path.join(resourceRoot,'lib/schema.mjs')));
  assert.ok(fs.statSync(tempParent).isDirectory());
  const sandbox=fs.mkdtempSync(path.join(tempParent,'pulso-durable-smoke-'));
  const projectRoot=path.join(sandbox,'workspace'),homeDir=path.join(sandbox,'home');
  const context={projectRoot,homeDir,resourceRoot};
  const env={...process.env,HOME:homeDir,USERPROFILE:homeDir};
  const operations={};
  let fixtureExecutions=0,typedReceipts=0;
  const started=performance.now();
  function record(tool,input,response,elapsedMs) {
    const key=`${tool}:${input.action||'read'}`;
    const metric=operations[key]??={calls:0,ok:0,rejected:0,elapsedMs:0,inputBytes:0,outputBytes:0};
    metric.calls++;metric[response.ok?'ok':'rejected']++;
    metric.elapsedMs+=elapsedMs;metric.inputBytes+=bytes(input);metric.outputBytes+=bytes(response);
    if(response.ok&&response.data?.operation?.startsWith('work.')) {
      assertSchema('work-receipt',response.data);typedReceipts++;
    }
  }
  async function invoke(tool,input) {
    const start=performance.now(),response=await executeTool(tool,input,context);
    record(tool,input,response,performance.now()-start);
    return response;
  }
  async function call(tool,input) {
    const response=await invoke(tool,input);
    assert.equal(response.ok,true,JSON.stringify({tool,input,response}));
    assert.equal(response.persistence,undefined,JSON.stringify(response));
    return response.data;
  }
  const workCall=input=>call('pulso_work',input);
  const workspace=input=>call('pulso_workspace',input);
  const get=workId=>workCall({action:'get',workId,section:'all'});
  const create=title=>workCall({action:'create',title,objective:'Verify durable integration with real Node and disk',criterion:'Node fixture returns the correct total and runs exactly once',verification:'Retained Node stdout, exit code, file hashes and pre-observation basis'});
  async function addTask(workId,repo) {
    const work=await get(workId);
    await workCall({action:'update',workId,expectedRevision:work.revision,actions:[{type:'task.add',task:{id:'T-1',title:'Verify repository fixture',criterionIds:['AC-1'],agent:'pulso-executor',status:'in_progress',dependsOn:[],writeScope:[repo],resources:[],acceptance:['Observe a real Node check exactly once']}}]});
  }
  const bind=(workId,repo)=>workspace({action:'bind_continuity',workId,requestKey:`bind-${repo}`,objective:`Verify ${repo}`,repositories:[repo],constraints:['Native conversation NOT_RUN']});
  const preparation=(workId,continuity,revision,requestKey)=>({action:'prepare_delegation',contractVersion:2,workId,expectedRevision:revision,continuityId:continuity.continuityId,intentRevision:continuity.intentRevision,requestKey,taskIds:['T-1'],objective:'Execute and preserve a scoped fixture check',inputs:[],output:'conversation',constraints:['No native host execution is claimed'],templateId:'implementation'});
  // Separate OS processes import the selected runtime and contend on its real writer.
  async function writer(input) {
    const source=`import {executeTool} from ${JSON.stringify(runtimeURL)};
const start=performance.now();
const response=await executeTool('pulso_work',JSON.parse(process.argv[1]),JSON.parse(process.argv[2]));
console.log(JSON.stringify({response,elapsedMs:performance.now()-start}));`;
    const result=await new Promise((resolve,reject)=>{
      const child=spawn(process.execPath,['--input-type=module','-e',source,JSON.stringify(input),JSON.stringify(context)],{cwd:projectRoot,env,stdio:['ignore','pipe','pipe']});
      let stdout='',stderr='';
      const timer=setTimeout(()=>child.kill('SIGKILL'),30000);
      child.stdout.on('data',data=>stdout+=data);child.stderr.on('data',data=>stderr+=data);
      child.on('error',error=>{clearTimeout(timer);reject(error);});
      child.on('close',(code,signal)=>{
        clearTimeout(timer);
        try {assert.equal(code,0,JSON.stringify({stderr,signal}));resolve(JSON.parse(stdout));}catch(error){reject(error);}
      });
    });
    record('pulso_work',input,result.response,result.elapsedMs);
    return result.response;
  }
  try {
    fs.mkdirSync(projectRoot);fs.mkdirSync(homeDir);
    fs.mkdirSync(path.join(projectRoot,'repo-a'));fs.mkdirSync(path.join(projectRoot,'repo-b'));
    await workspace({action:'prepare'});
    const {workId}=await create('Durable smoke A');
    await addTask(workId,'repo-a');
    const continuity=await bind(workId,'repo-a');
    const original=await get(workId);
    const prep=preparation(workId,continuity,original.revision,'prepare-a');
    const prepStart=performance.now();
    const prepared=await workCall({...prep,integrationResources:['repo-a']});
    const prepareMs=performance.now()-prepStart;
    assert.equal(prepared.contractVersion,2);
    for(const field of ['delegation','acceptanceBasis','hostContext','nativeContext'])assert.equal(Object.hasOwn(prepared,field),false);
    const selected=()=>workCall({action:'get_delegation',workId,delegationId:prepared.delegationId,continuityId:continuity.continuityId});
    // Explicit white-box verification outside prepare timing/response bytes.
    const preparedSnapshot=await selected();
    assert.equal(preparedSnapshot.hostContext.cwd,projectRoot);
    assert.deepEqual(preparedSnapshot.hostContext.paths.writeScope,[path.join(projectRoot,'repo-a')]);
    assert.deepEqual(preparedSnapshot.acceptanceBasis,original.acceptanceBasis);
    const snapshotPath=path.join(projectRoot,'.pulso/delegations-v2',prepared.delegationId,'snapshot.json');
    const snapshot=fs.readFileSync(snapshotPath);
    const assertOriginal=record=>{
      assert.deepEqual(record.delegation,preparedSnapshot.delegation);
      assert.deepEqual(record.acceptanceBasis,preparedSnapshot.acceptanceBasis);
      assert.equal(record.specialistPrompt,prepared.specialistPrompt);
      assert.deepEqual(fs.readFileSync(snapshotPath),snapshot);
    };
    await workCall({action:'update',workId,expectedRevision:original.revision,actions:[{type:'work.set_overview',summary:'Independent metadata after immutable preparation'}]});
    for(const expectedRevision of [1,999999]){
      const repeated=await workCall({...prep,integrationResources:['repo-a'],expectedRevision});
      assert.equal(repeated.delegationId,prepared.delegationId);assert.equal(repeated.specialistPrompt,prepared.specialistPrompt);
      assertOriginal(await workCall(repeated.readWith));
    }

    // A second Work/repository can proceed while A still owns its reservation.
    const {workId:otherWorkId}=await create('Durable smoke B');
    await addTask(otherWorkId,'repo-b');
    const navigationBefore=await workspace({action:'status'});
    const otherContinuity=await bind(otherWorkId,'repo-b');
    const other=await get(otherWorkId);
    const otherPrep=preparation(otherWorkId,otherContinuity,other.revision,'writer-a');
    const writers=await Promise.allSettled([writer(otherPrep),writer({...otherPrep,requestKey:'writer-b'})]);
    for(const result of writers)if(result.status==='rejected')throw result.reason;
    const responses=writers.map(result=>result.value);
    assert.equal(responses.filter(response=>response.ok).length,1,JSON.stringify(responses));
    const rejected=responses.find(response=>!response.ok);
    assert.match(`${rejected.error.code} ${rejected.error.message}`,/Reserva|METADATA_BUSY/);
    const conflicting=await invoke('pulso_work',{...otherPrep,requestKey:'writer-conflict'});
    assert.equal(conflicting.ok,false);assert.match(conflicting.error.message,/Reserva/);
    const otherPrepared=responses.find(response=>response.ok).data;
    const focus=await workspace({action:'status',continuityId:continuity.continuityId});
    assert.equal(focus.continuity.workId,workId);
    assert.equal(focus.continuity.objective,'Verify repo-a');
    assert.equal(focus.continuity.intentRevision,continuity.intentRevision);
    assert.ok(focus.continuity.pending.some(item=>item.delegationId===prepared.delegationId));
    const navigationAfter=await workspace({action:'status'});
    assert.equal(navigationAfter.navigationFocusWorkId,navigationBefore.navigationFocusWorkId);
    assert.equal(navigationAfter.focusWorkId,null);
    await workCall({action:'reconcile_delegation',workId:otherWorkId,delegationId:otherPrepared.delegationId,continuityId:otherContinuity.continuityId,intentRevision:otherContinuity.intentRevision,reason:'Writer contention check only; no specialist dispatched',resolution:'not_dispatched'});

    // Basis retained BEFORE observation. The only fixture execution is below.
    let work=await get(workId);
    const evidenceBasis={criteria:structuredClone(work.acceptanceBasis.criteria),tasks:[]};
    const cwd=path.join(projectRoot,'repo-a');
    const write=(name,content)=>fs.writeFileSync(path.join(cwd,name),content);
    write('package.json',JSON.stringify({name:'durable-smoke-fixture',private:true,type:'module',exports:'./index.mjs'})+'\n');
    write('index.mjs','export const total = rows => rows.reduce((sum, row) => sum + row.quantity * row.price, 0);\n');
    write('check.mjs',`import assert from 'node:assert/strict';
import fs from 'node:fs';
const pkg=JSON.parse(fs.readFileSync(new URL('./package.json',import.meta.url)));
assert.equal(pkg.private,true);assert.equal(pkg.type,'module');
const {total}=await import(new URL(pkg.exports,import.meta.url));
assert.equal(total([{quantity:2,price:7},{quantity:3,price:4}]),26);
assert.equal(total([]),0);
fs.appendFileSync(new URL('./executions.txt',import.meta.url),'run\\n');
assert.equal(fs.readFileSync(new URL('./executions.txt',import.meta.url),'utf8'),'run\\n');
console.log('Verified total=26, empty=0, executions=1');
`);
    const command=`${JSON.stringify(process.execPath)} check.mjs`,fixtureStart=performance.now();
    fixtureExecutions++;
    const observed=spawnSync(process.execPath,['check.mjs'],{cwd,env,encoding:'utf8',timeout:30000});
    const observation={command,argv:[process.execPath,'check.mjs'],cwd,checkedAt:new Date().toISOString(),elapsedMs:performance.now()-fixtureStart,exitCode:observed.status,signal:observed.signal,stdout:observed.stdout,stderr:observed.stderr,node:process.version};
    if(observed.error)throw observed.error;
    write('observation.json',JSON.stringify(observation,null,2)+'\n');
    assert.equal(observed.status,0,JSON.stringify(observation));
    assert.equal(observed.signal,null);
    assert.equal(observed.stdout,'Verified total=26, empty=0, executions=1\n');
    const files=['package.json','index.mjs','check.mjs','executions.txt','observation.json'].map(name=>({path:`repo-a/${name}`,sha256:hash(fs.readFileSync(path.join(cwd,name)))}));
    const markdown=`## Resultado\n\nCompletado: comprobación real de Node.\n\n## Cambios o hallazgos\n\n${files.map(file=>`- ${file.path}`).join('\n')}\n\n## Comprobación y pendientes\n\n${command}\nCwd: ${cwd}\nExit: ${observed.status}\n${observed.stdout}\nNative conversation NOT_RUN.\n`;
    const envelope={action:'accept_result',contractVersion:2,workId,delegationId:prepared.delegationId,continuityId:continuity.continuityId,intentRevision:continuity.intentRevision,operationId:'accept-a',expectedRevision:work.revision,reportedTerminal:true};
    const captureStart=performance.now();
    const failed=await invoke('pulso_work',{...envelope,reportedReturn:{captureKey:'observed-a',markdown,completeness:'complete'},decision:{status:'invalid'}});
    const captureMs=performance.now()-captureStart;
    assert.equal(failed.ok,false);assert.equal(failed.persistence.captured,true);
    const returnId=failed.persistence.returnId;
    assert.equal(typeof returnId,'string');
    const recovered=await selected();assertOriginal(recovered);
    assert.equal(recovered.returns.length,1);
    const capture=recovered.returns[0];
    assert.equal(capture.returnId,returnId);assert.equal(capture.markdown,markdown);
    assert.equal(capture.provenance,'orchestrator_reported');assert.equal(capture.completeness,'complete');
    assert.equal(capture.sha256,hash(markdown));assert.equal(capture.length,Buffer.byteLength(markdown));
    assert.equal(recovered.attempts.length,0);
    work=await get(workId);assert.equal(work.results.items.length,0);assert.equal(work.evidence.items.length,0);
    const noRepeat=await invoke('pulso_work',{...prep,requestKey:'must-not-rerun',expectedRevision:work.revision});
    assert.equal(noRepeat.ok,false);assert.match(noRepeat.error.message,/Reserva/);
    const decision={status:'completed',summary:'Real Node fixture passed once',acceptedTaskIds:['T-1'],artifacts:files.map(file=>file.path),changedFiles:files.map(file=>file.path),checks:[{description:command,status:'pass',evidenceRef:'repo-a/observation.json'}],limitations:['Native conversation NOT_RUN']};
    const acceptArgs={...envelope,returnId,decision};
    const acceptStart=performance.now(),accepted=await workCall(acceptArgs),acceptMs=performance.now()-acceptStart;
    assert.equal(accepted.applied,true);assert.equal(accepted.duplicate,false);
    assert.deepEqual(accepted.acceptedTaskIds,['T-1']);
    const reportBytes=fs.readFileSync(path.join(projectRoot,accepted.report)),report=JSON.parse(reportBytes);
    assert.deepEqual(report.delegation,preparedSnapshot.delegation);assert.deepEqual(report.acceptanceBasis,preparedSnapshot.acceptanceBasis);
    assert.equal(report.markdown,markdown);assert.equal(report.result.workRevision,preparedSnapshot.delegation.workRevision);
    work=await get(workId);
    await workCall({action:'update',workId,expectedRevision:work.revision,actions:[{type:'work.set_overview',summary:'Accepted; recover historical receipt without another execution'}]});
    work=await get(workId);
    const canonicalPath=path.join(projectRoot,'.pulso/work',workId,'work.json');
    const canonical=fs.readFileSync(canonicalPath);
    for(const expectedRevision of [1,999999]) {
      const retry=await workCall({...acceptArgs,expectedRevision});
      assert.equal(retry.resultId,accepted.resultId);assert.equal(retry.returnId,returnId);
      assert.equal(retry.duplicate,true);assert.equal(retry.appliedRevision,accepted.appliedRevision);
      assert.equal(retry.currentRevision,work.revision);assert.equal(retry.currentIntent,true);
      assert.equal(retry.currentBasis,true);assert.equal(retry.currentPass,false);
      assert.deepEqual(fs.readFileSync(canonicalPath),canonical);
    }
    assertOriginal(await selected());
    work=await get(workId);
    assert.equal(work.results.items.length,1);assert.equal(work.results.items[0].sha256,hash(reportBytes));
    assert.equal(work.tasks.items[0].status,'done');assert.equal(work.evidence.items.length,0);
    assert.equal(work.readiness.ready,false,'Reported completion is not executed evidence');
    await workCall({action:'update',workId,expectedRevision:work.revision,actions:[{type:'evidence.add',evidence:{id:'EV-1',kind:'executed',status:'pass',checkedAt:observation.checkedAt,criterionIds:['AC-1'],taskIds:[],report:'repo-a/observation.json',command,cwd:'repo-a',exitCode:0,basis:'Real Node child observed once; basis captured before execution',files,summary:observed.stdout.trim(),acceptanceBasis:evidenceBasis}}]});
    work=await get(workId);assert.equal(work.readiness.ready,true,JSON.stringify(work.readiness));
    assert.deepEqual(work.readiness.issues,[]);
    await workCall({action:'close',workId,expectedRevision:work.revision,summary:'Durable smoke verified',limitations:['Native conversation NOT_RUN']});
    const history=await call('pulso_history',{workId});
    assert.equal(history.items.length,1);assert.equal(history.items[0].outcome,'done');
    assert.ok(history.items[0].evidenceIds.includes('EV-1'));
    const registryPath=path.join(projectRoot,'.pulso/delegations-v2.json'),registry=fs.readFileSync(registryPath);
    await workspace({action:'recover'});
    assert.deepEqual(fs.readFileSync(registryPath),registry);assertOriginal(await selected());
    assert.deepEqual(await call('pulso_history',{workId}),history);
    await workspace({action:'validate',fresh:true});
    assert.equal(fs.readFileSync(path.join(cwd,'executions.txt'),'utf8'),'run\n');
    assert.equal(fixtureExecutions,1);
    for(const metric of Object.values(operations))metric.elapsedMs=Number(metric.elapsedMs.toFixed(3));
    return {status:'PASS',resourceRoot,node:process.version,platform:process.platform,arch:process.arch,workId,delegationId:prepared.delegationId,returnId,resultId:accepted.resultId,observation,files,snapshotSha256:hash(snapshot),resultSha256:hash(reportBytes),captureSha256:capture.sha256,selectedBytes:{prepare:bytes(prepared),getDelegation:bytes(recovered),accept:bytes(accepted),snapshot:snapshot.length,result:reportBytes.length,registry:registry.length},timingsMs:{prepare:prepareMs,captureRejectedDecision:captureMs,accept:acceptMs,total:performance.now()-started},operations,counts:{fixtureExecutions,writerProcesses:2,results:1,captures:1,typedReceipts,nativeDispatches:0},checks:{snapshotAndBasis:'PASS',persistedInvalidDecision:'PASS',returnIdRecovery:'PASS',staleAndFutureIdempotency:'PASS',writerContention:'PASS',continuityIsolation:'PASS',evidenceReadinessHistory:'PASS',publicRecovery:'PASS'},nativeConversation:'NOT_RUN',benchmark:'NOT_RUN; single-cycle timings only, no legacy or 4.1.1 comparison; selected bytes are not filesystem I/O totals',cleanup:'removed on return'};
  } finally {
    fs.rmSync(sandbox,{recursive:true,force:true});
  }
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const target=process.argv[2]||'core';
  assert.ok(['core','opencode','vscode'].includes(target),'Select core, opencode or vscode');
  const resourceRoot=fileURLToPath(new URL(target==='core'?'../core':`../dist/${target}/resources`,import.meta.url));
  console.log(JSON.stringify(await durableSmoke({resourceRoot})));
}
