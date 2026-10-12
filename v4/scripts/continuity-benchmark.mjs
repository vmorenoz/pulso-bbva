/** Local source comparison: immutable 4.1.1 archive vs current 4.2.0 working tree. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';

const repoRoot=fileURLToPath(new URL('../../',import.meta.url));
const approvedTemp='/var/folders/hx/jjh83n994vsdfxc6s90lr9nh0000gp/T/opencode';
const samplePairs=12,warmupPairs=2;
const hash=data=>createHash('sha256').update(data).digest('hex');
const jsonBytes=value=>Buffer.byteLength(JSON.stringify(value));
const stats=values=>{
  const sorted=[...values].sort((a,b)=>a-b);
  return {samples:values.length,p50:sorted[Math.ceil(sorted.length*0.5)-1],p95:sorted[Math.ceil(sorted.length*0.95)-1]};
};
function sourceIdentity(root) {
  const files=[];
  function visit(relative) {
    for(const entry of fs.readdirSync(path.join(root,relative),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
      const name=path.posix.join(relative,entry.name);
      if(entry.isDirectory())visit(name);
      else {
        assert.ok(entry.isFile(),`Non-regular runtime entry: ${name}`);
        files.push({path:name,sha256:hash(fs.readFileSync(path.join(root,name)))});
      }
    }
  }
  visit('');
  return {fileCount:files.length,treeSha256:hash(JSON.stringify(files))};
}

export async function continuityBenchmark({tempParent=process.env.PULSO_SMOKE_TMP||approvedTemp}={}) {
  assert.ok(fs.statSync(tempParent).isDirectory());
  const sandbox=fs.mkdtempSync(path.join(path.resolve(tempParent),'pulso-continuity-benchmark-'));
  try {
    const git=args=>execFileSync('git',args,{cwd:repoRoot,encoding:'utf8',timeout:30000,maxBuffer:32*1024*1024});
    const commit=git(['rev-parse','--verify','daa72fc^{commit}']).trim();
    assert.match(commit,/^[a-f0-9]{40}$/);
    const oldVersion=JSON.parse(git(['show',`${commit}:v4/package.json`])).version;
    const currentVersion=JSON.parse(fs.readFileSync(path.join(repoRoot,'v4/package.json'),'utf8')).version;
    assert.equal(oldVersion,'4.1.1');assert.equal(currentVersion,'4.2.0');
    // Refuse links/submodules before extracting the known commit; no checkout occurs.
    const entries=git(['ls-tree','-r','-z',commit,'--','v4/core']).split('\0').filter(Boolean);
    assert.ok(entries.length>0);
    for(const entry of entries)assert.match(entry,/^100(?:644|755) blob [a-f0-9]{40}\tv4\/core\//);
    const archive=path.join(sandbox,'baseline.tar'),extraction=path.join(sandbox,'baseline');
    fs.mkdirSync(extraction);
    git(['archive','--format=tar',`--output=${archive}`,commit,'v4/core']);
    execFileSync('tar',['-xf',archive,'-C',extraction],{cwd:sandbox,timeout:30000,stdio:'pipe'});
    const roots={old:path.join(extraction,'v4/core'),current:path.join(repoRoot,'v4/core')};
    const identities={old:sourceIdentity(roots.old),current:sourceIdentity(roots.current)};
    const provenance={
      old:{version:oldVersion,commit,archiveSha256:hash(fs.readFileSync(archive)),...identities.old},
      current:{version:currentVersion,headCommit:git(['rev-parse','HEAD']).trim(),coreGitStatus:git(['status','--porcelain','--untracked-files=all','--','v4/core']).trim(),source:'working tree, not an immutable release archive',...identities.current}
    };
    const runtimes={};
    for(const mode of ['old','current']) {
      const resourceRoot=roots[mode];
      const {executeTool}=await import(pathToFileURL(path.join(resourceRoot,'lib/semantic-tools.mjs')));
      const {assertSchema}=await import(pathToFileURL(path.join(resourceRoot,'lib/schema.mjs')));
      runtimes[mode]={executeTool,assertSchema,resourceRoot};
    }
    const fixture={kind:'metadata-fixture',value:42};
    const fixtureText=JSON.stringify(fixture)+'\n';
    const summary='Script inspected repo/input.json: kind=metadata-fixture, value=42';
    const limitations=['No product tests, command execution, native dispatch, model or host conversation; user acceptance remains pending'];
    const markdown=`## Resultado\n\n${summary}.\n\n## Cambios o hallazgos\n\nNo source changes. The script read the existing fixture JSON.\n\n## Comprobación y pendientes\n\nUser acceptance pending. No technical PASS or executed evidence claimed.\n`;
    async function sample(mode,label) {
      const runtime=runtimes[mode],directory=path.join(sandbox,`${label}-${mode}`);
      const context={projectRoot:path.join(directory,'workspace'),homeDir:path.join(directory,'home'),resourceRoot:runtime.resourceRoot};
      fs.mkdirSync(path.join(context.projectRoot,'repo'),{recursive:true});fs.mkdirSync(context.homeDir);
      fs.writeFileSync(path.join(context.projectRoot,'repo/input.json'),fixtureText);
      async function call(tool,input,measure=false) {
        const sentBytes=measure?jsonBytes(input):0;
        const start=performance.now();
        const response=await runtime.executeTool(tool,input,context);
        const elapsedMs=performance.now()-start;
        assert.equal(response.ok,true,JSON.stringify({mode,input,response}));
        assert.equal(response.persistence,undefined,JSON.stringify(response));
        if(response.data?.operation?.startsWith('work.'))runtime.assertSchema('work-receipt',response.data);
        return {data:response.data,...(measure?{metric:{elapsedMs,sentBytes,receivedBytes:jsonBytes(response),calls:1}}:{})};
      }
      const work=input=>call('pulso_work',input);
      await call('pulso_workspace',{action:'prepare'});
      const {data:created}=await work({action:'create',title:'Metadata protocol fixture',objective:'Inspect one local fixture and preserve its report',criterion:'User explicitly accepts the inspected fixture',verification:'Explicit user acceptance, still pending during this benchmark'});
      const workId=created.workId;
      let {data:before}=await work({action:'get',workId,section:'all'});
      await work({action:'update',workId,expectedRevision:before.revision,actions:[
        {type:'criterion.update',criterionId:'AC-1',acceptanceMode:'user',reason:'User acceptance is explicitly pending in both fixtures'},
        {type:'task.add',task:{id:'T-1',title:'Inspect fixture metadata',criterionIds:['AC-1'],agent:'pulso-executor',status:'in_progress',dependsOn:[],writeScope:[],resources:['repo/input.json'],acceptance:['Read fixture metadata and preserve a factual report'],evidenceIds:[],summary:''}}
      ]});
      ({data:before}=await work({action:'get',workId,section:'all'}));
      let continuity;
      if(mode==='current')({data:continuity}=await call('pulso_workspace',{action:'bind_continuity',workId,requestKey:'bind-fixture',objective:'Inspect fixture metadata',repositories:['repo'],constraints:limitations}));
      const common={action:'prepare_delegation',workId,taskIds:['T-1'],objective:'Inspect fixture metadata',inputs:['repo/input.json'],output:'conversation',constraints:limitations,templateId:'implementation'};
      const prepareInput=mode==='old'?{...common,delegationId:'D-fixture'}:{...common,contractVersion:2,continuityId:continuity.continuityId,intentRevision:continuity.intentRevision,expectedRevision:before.revision,requestKey:'prepare-fixture'};
      const prepared=await call('pulso_work',prepareInput,true);
      // Actual observation, outside metadata timing, identical for both runtimes.
      const observed=fs.readFileSync(path.join(context.projectRoot,'repo/input.json'),'utf8');
      assert.equal(observed,fixtureText);assert.deepEqual(JSON.parse(observed),fixture);
      const fields={status:'completed',summary,artifacts:[],changedFiles:[],checks:[],findings:[],questions:[],limitations,suggestedNextStep:null};
      const acceptInput=mode==='old'?{
        action:'accept_result',workId,expectedRevision:before.revision,delegation:prepared.data.delegation,acceptanceBasis:prepared.data.acceptanceBasis,
        result:{...fields,markdown},acceptedTaskIds:['T-1'],summary
      }:{
        action:'accept_result',contractVersion:2,workId,expectedRevision:before.revision,delegationId:prepared.data.delegationId,
        continuityId:continuity.continuityId,intentRevision:continuity.intentRevision,operationId:'accept-fixture',
        reportedReturn:{captureKey:'inspected-fixture',markdown,completeness:'complete'},decision:{...fields,acceptedTaskIds:['T-1']},reportedTerminal:true
      };
      const accepted=await call('pulso_work',acceptInput,true);
      assert.equal(accepted.data.duplicate,false);assert.deepEqual(accepted.data.acceptedTaskIds,['T-1']);
      const {data:after}=await work({action:'get',workId,section:'all'});
      assert.equal(after.results.items.length,1);assert.equal(after.tasks.items[0].status,'done');
      assert.equal(after.evidence.items.length,0);assert.equal(after.readiness.ready,false);
      assert.ok(after.readiness.issues.some(issue=>issue.code==='USER_ACCEPTANCE_REQUIRED'));
      const report=JSON.parse(fs.readFileSync(path.join(context.projectRoot,accepted.data.report),'utf8'));
      // Explicit snapshot verification AFTER both measured operations. Only the
      // compact prepare response participates in API byte/timing measurements.
      const original=mode==='current'?(await work(prepared.data.readWith)).data:prepared.data;
      assert.equal(report.markdown,markdown);assert.deepEqual(report.acceptanceBasis,original.acceptanceBasis);
      assert.deepEqual(report.delegation,original.delegation);
      const prepare=prepared.metric,accept=accepted.metric;
      return {prepare,accept,cycle:{elapsedMs:prepare.elapsedMs+accept.elapsedMs,sentBytes:prepare.sentBytes+accept.sentBytes,receivedBytes:prepare.receivedBytes+accept.receivedBytes,calls:2}};
    }
    // Balanced warmup pairs, excluded; subsequent pairs reverse order sequentially.
    for(let i=0;i<warmupPairs;i++)for(const mode of i%2?['current','old']:['old','current'])await sample(mode,`warmup-${i}`);
    const samples=[];
    for(let i=0;i<samplePairs;i++) {
      const order=i%2?['current','old']:['old','current'],pair={sample:i+1,order};
      for(const mode of order)pair[mode]=await sample(mode,`sample-${i}`);
      samples.push(pair);
    }
    assert.deepEqual(sourceIdentity(roots.current),identities.current,'Current core changed during benchmark; discard comparison');
    const aggregates={old:{},current:{}},comparison={};
    for(const action of ['prepare','accept','cycle']) {
      for(const mode of ['old','current']) {
        aggregates[mode][action]={};
        for(const metric of ['elapsedMs','sentBytes','receivedBytes'])aggregates[mode][action][metric]=stats(samples.map(pair=>pair[mode][action][metric]));
      }
      comparison[action]={};
      for(const metric of ['elapsedMs','sentBytes','receivedBytes']) {
        comparison[action][metric]=Object.fromEntries(['p50','p95'].map(percentile=>{
          const old=aggregates.old[action][metric][percentile],current=aggregates.current[action][metric][percentile];
          return [percentile,{delta:current-old,ratio:old?current/old:null}];
        }));
      }
      comparison[action].pairedElapsedRatio=stats(samples.map(pair=>pair.current[action].elapsedMs/pair.old[action].elapsedMs));
    }
    const budget=(observed,limit)=>({observed,limit,status:observed<=limit?'PASS':'FAIL',provisional:true,enforced:false});
    return {status:'MEASURED',provenance,environment:{node:process.version,platform:process.platform,arch:process.arch,cpu:os.cpus()[0]?.model,cpuCount:os.cpus().length,tempParent:path.resolve(tempParent)},method:{samplePairs,warmupPairs,order:'sequential paired, alternating old/current; no concurrent samples',percentiles:'nearest-rank',timing:'executeTool wall time only; cycle = prepare + accept, including v2 capture inside accept',excluded:'imports, fixture/work/task setup, v2 bind, observation, verification, serialization for byte accounting, archive extraction and warmup',apiBytes:'UTF-8 JSON tool input/output only; excludes adapter framing, native prompt transport and filesystem I/O'},fixture:{sha256:hash(fixtureText),bytes:Buffer.byteLength(fixtureText),markdownBytes:Buffer.byteLength(markdown),tasks:1,criteria:1,userAcceptance:'PENDING',technicalPass:'NOT_CLAIMED',evidenceRecords:0},samples,aggregates,comparison,provisionalBudgets:{cycleP95Ratio:budget(comparison.cycle.elapsedMs.p95.ratio,1.25),prepareP95Ms:budget(aggregates.current.prepare.elapsedMs.p95,100),acceptP95Ms:budget(aggregates.current.accept.elapsedMs.p95,100)},calls:{measuredPerSamplePerRuntime:{prepare:1,accept:1,total:2},measuredTotal:samplePairs*4,warmupTotal:warmupPairs*4,setupAndVerification:'excluded from measured counts'},limitations:['Local metadata protocol comparison only; v2 durability adds semantics absent from 4.1.1','No model/network, product execution, native host/conversation, contention or historical-volume performance measured','Provisional budgets are observations, not confirmed release policy; exceeding them does not fail the script'],nativeConversation:'NOT_RUN',cleanup:'only the created sandbox removed on return'};
  } finally {
    fs.rmSync(sandbox,{recursive:true,force:true});
  }
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await continuityBenchmark()));
