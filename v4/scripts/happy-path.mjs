/** Real core smoke: no host, agent, conversation or command doubles. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {hash} from './files.mjs';

export async function happyPath({resourceRoot=fileURLToPath(new URL('../core',import.meta.url)),tempParent=os.tmpdir()}={}) {
  // Imports may point at an extracted package: never fall back to source modules.
  const {prepareWorkspace}=await import(pathToFileURL(path.join(resourceRoot,'lib/workspace.mjs')));
  const {executeTool}=await import(pathToFileURL(path.join(resourceRoot,'lib/semantic-tools.mjs')));
  assert.ok(fs.statSync(tempParent).isDirectory());
  const sandbox=fs.mkdtempSync(path.join(tempParent,'pulso-happy-'));
  const projectRoot=path.join(sandbox,'workspace'),homeDir=path.join(sandbox,'home');
  fs.mkdirSync(projectRoot);fs.mkdirSync(homeDir);
  const context={projectRoot,homeDir,resourceRoot};
  const calls=[];
  async function call(name,input) {
    const response=await executeTool(name,input,context);
    assert.equal(response.ok,true,JSON.stringify({name,input,response}));
    assert.equal(response.persistence,undefined,JSON.stringify(response));
    calls.push(`${name}:${input.action||'read'}`);
    return response.data;
  }
  try {
    assert.equal(prepareWorkspace(projectRoot,{homeDir}).prepared,true);
    const created=await call('pulso_work',{action:'create',title:'Real fixture package verification',objective:'Generate and check a private ESM package fixture',criterion:'The fixture is private, ESM, version 1.0.0 and its exported sum returns 5 for (2,3)',verification:'Execute Node check.mjs against package.json and index.mjs; retain stdout, exit code and hashes'});
    const workId=created.workId;
    const get=()=>call('pulso_work',{action:'get',workId,section:'all'});
    let work=await get();
    await call('pulso_work',{action:'update',workId,expectedRevision:work.revision,actions:[{type:'task.add',task:{id:'T-1',title:'Generate and verify package fixture',criterionIds:['AC-1'],agent:'pulso-executor',status:'in_progress',dependsOn:[],writeScope:['fixture'],resources:[],acceptance:['Generate a private ESM package and execute its check'],evidenceIds:[],summary:'Local script execution; no native specialist invocation'}}]});
    const prepared=await call('pulso_work',{action:'prepare_delegation',workId,taskIds:['T-1'],delegationId:'D-1',objective:'Generate and check the fixture with a real Node process',inputs:[],output:'conversation',constraints:['Script-driven core integration only; no host or conversation acceptance'],templateId:'implementation'});
    assert.equal(prepared.hostContext.cwd,projectRoot);
    assert.equal(prepared.hostContext.readBase,projectRoot);
    assert.equal(prepared.hostContext.paths.output,null);
    // Capture criterion basis through the public read API BEFORE the observation.
    work=await get();
    assert.equal(work.hasMore,false);
    assert.equal(work.objective.criteria.items[0].acceptanceMode||'evidence','evidence');
    const evidenceBasis={criteria:work.acceptanceBasis.criteria,tasks:[]};
    fs.mkdirSync(path.join(projectRoot,'fixture'));
    const write=(name,content)=>fs.writeFileSync(path.join(projectRoot,'fixture',name),content);
    write('package.json',JSON.stringify({name:'pulso-happy-fixture',version:'1.0.0',private:true,type:'module',exports:'./index.mjs',scripts:{check:'node check.mjs'}},null,2)+'\n');
    write('index.mjs','export const sum = (a, b) => a + b;\n');
    write('check.mjs',`import assert from 'node:assert/strict';
import fs from 'node:fs';
const pkg=JSON.parse(fs.readFileSync(new URL('./package.json',import.meta.url)));
assert.equal(pkg.name,'pulso-happy-fixture');
assert.equal(pkg.version,'1.0.0');
assert.equal(pkg.private,true);
assert.equal(pkg.type,'module');
assert.equal(pkg.exports,'./index.mjs');
const {sum}=await import(new URL(pkg.exports,import.meta.url));
assert.equal(sum(2,3),5);
console.log('Verified private ESM package 1.0.0 and sum(2,3)=5');
`);
    const command=JSON.stringify(process.execPath)+' check.mjs';
    const observed=spawnSync(process.execPath,['check.mjs'],{cwd:path.join(projectRoot,'fixture'),encoding:'utf8',env:{...process.env,HOME:homeDir,USERPROFILE:homeDir},timeout:30000});
    const checkedAt=new Date().toISOString();
    if(observed.error)throw observed.error;
    const observation={command,argv:[process.execPath,'check.mjs'],cwd:path.join(projectRoot,'fixture'),checkedAt,exitCode:observed.status,signal:observed.signal,stdout:observed.stdout,stderr:observed.stderr,node:process.version};
    write('observation.json',JSON.stringify(observation,null,2)+'\n');
    assert.equal(observed.status,0,JSON.stringify(observation));
    const files=['package.json','index.mjs','check.mjs','observation.json'].map(name=>({path:`fixture/${name}`,sha256:hash(fs.readFileSync(path.join(projectRoot,'fixture',name)))}));
    const {delegation,acceptanceBasis}=prepared;
    const result={schemaVersion:1,delegationId:delegation.id,workId,workRevision:delegation.workRevision,agent:delegation.agent,status:'completed',summary:'Script generated fixture and real Node check exited 0; no native agent was invoked',artifacts:files.map(file=>file.path),changedFiles:files.map(file=>file.path),checks:[{description:command,status:'pass',evidenceRef:'fixture/observation.json'}],findings:[],questions:[],limitations:['Native agent/conversation NOT_RUN'],suggestedNextStep:null};
    const accepted=await call('pulso_work',{action:'accept_result',workId,expectedRevision:work.revision,delegation,acceptanceBasis,result,acceptedTaskIds:['T-1'],summary:result.summary});
    assert.deepEqual(accepted.acceptedTaskIds,['T-1']);
    work=await get();
    assert.equal(work.tasks.items[0].status,'done');
    assert.ok(work.completedTaskIds.includes('T-1'));
    assert.equal(work.results.items.length,1);
    assert.equal(work.readiness.ready,false,'Accepted task must not automatically satisfy the criterion');
    await call('pulso_work',{action:'update',workId,expectedRevision:work.revision,actions:[{type:'evidence.add',evidence:{id:'EV-1',kind:'executed',status:'pass',checkedAt,criterionIds:['AC-1'],taskIds:[],report:'fixture/observation.json',command,cwd:'fixture',exitCode:observed.status,basis:'Real child process against the generated package; stdout/exit code retained before hashing',files,summary:observed.stdout.trim(),acceptanceBasis:evidenceBasis}}]});
    work=await get();
    assert.equal(work.readiness.ready,true,JSON.stringify(work.readiness));
    assert.deepEqual(work.readiness.issues,[]);
    await call('pulso_work',{action:'close',workId,expectedRevision:work.revision,summary:'Real fixture verification completed',limitations:['Host conversations and manual user acceptance NOT_RUN']});
    const history=await call('pulso_history',{workId});
    assert.equal(history.items.length,1);
    assert.equal(history.items[0].outcome,'done');
    assert.ok(history.items[0].evidenceIds.includes('EV-1'));
    await call('pulso_workspace',{action:'validate',fresh:true});
    return {status:'PASS',node:process.version,resourceRoot,workId,observation,files,calls,history:history.items[0],manualConversation:'NOT_RUN',acceptDelivery:'NOT_RUN',sandbox,cleanup:'removed on return'};
  } finally {
    fs.rmSync(sandbox,{recursive:true,force:true});
  }
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const target=process.argv[2]||'core';
  assert.ok(['core','opencode','vscode'].includes(target),'Select core, opencode or vscode');
  const resourceRoot=fileURLToPath(new URL(target==='core'?'../core':`../dist/${target}/resources`,import.meta.url));
  console.log(JSON.stringify(await happyPath({resourceRoot,tempParent:process.env.PULSO_SMOKE_TMP||os.tmpdir()}),null,2));
}
