import test from 'node:test';
import {legacyResult} from './contract-fixtures.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {executeTool,createPulsoTools} from '../../core/lib/semantic-tools.mjs';
import {validateToolInput} from '../../core/lib/tool-contracts.mjs';
import {readMemory,updateMemory} from '../../core/lib/memory.mjs';
import * as artifacts from '../../core/lib/artifacts.mjs';
import {temp,atomicWrite} from './helpers.mjs';

const resourceRoot=fileURLToPath(new URL('../../core/',import.meta.url));
const creation={action:'create',workId:'WORK-1',title:'Objetivo',objective:'Entrega comprobada',criterion:'Aceptación inicial',verification:'Revisar informe',priority:'critical'};
function snapshot(root){return fs.readdirSync(root,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).map(item=>[item.name,item.isDirectory()?snapshot(path.join(root,item.name)):fs.readFileSync(path.join(root,item.name),'utf8')]);}
function fixture(t){
  const projectRoot=temp(t),homeDir=temp(t),context={projectRoot,homeDir,resourceRoot};
  const tools=createPulsoTools({homeDir,resourceRoot});
  const run=(name,input,extra={})=>executeTool(name,input,{...context,...extra});
  const success=async(name,input,extra={})=>{const result=await run(name,input,extra);assert.equal(result.ok,true,result.output);return result;};
  return {projectRoot,homeDir,context,tools,run,success};
}
async function prepared(t){const f=fixture(t);await f.success('pulso_workspace',{action:'prepare'});await f.success('pulso_work',creation);return f;}

test('factory and direct tools share semantic handlers and untouched empty reads',async t=>{
  const f=fixture(t);assert.equal(Object.keys(f.tools).length,4);
  for(const [name,input] of [['pulso_workspace',{action:'status'}],['pulso_history',{}],['pulso_context',{action:'read',scope:'all'}]]){
    const direct=await f.success(name,input),factory=await f.tools[name].execute(input,{projectRoot:f.projectRoot});
    // An absent memory document has no persisted timestamp; compare the meaningful fields.
    if(name==='pulso_context'){delete direct.data.updatedAt;delete factory.data.updatedAt;}
    assert.deepEqual(factory,direct);
  }
  assert.deepEqual(snapshot(f.projectRoot),[]);assert.deepEqual(snapshot(f.homeDir),[]);
});
test('all semantic mutations return structured receipts, reject stale writes, and allow explicit recovery',async t=>{
  const f=await prepared(t);
  const update=await f.success('pulso_work',{action:'update',workId:'WORK-1',expectedRevision:1,actions:[{type:'work.set_overview',summary:'Avance',nextAction:'Revisar'}]});
  assert.equal(update.data.revision,2);assert.equal(update.data.operation,'work.apply');
  const before=snapshot(f.projectRoot);
  assert.equal((await f.run('pulso_work',{action:'update',workId:'WORK-1',expectedRevision:1,actions:[{type:'work.set_overview',summary:'Obsoleto'}]})).ok,false);
  assert.deepEqual(snapshot(f.projectRoot),before);
  assert.equal((await f.success('pulso_workspace',{action:'sync',workId:'WORK-1',expectedRevision:2})).data.revision,2);
  assert.equal((await f.success('pulso_work',{action:'block',workId:'WORK-1',expectedRevision:2,summary:'Bloqueado',reason:'Entorno'})).data.revision,3);
  const closed=await f.success('pulso_work',{action:'close',workId:'WORK-1',expectedRevision:3,outcome:'cancelled',summary:'Alcance retirado',limitations:['Sin ejecución']});
  assert.equal(closed.data.operation,'work.close');assert.equal(closed.data.revision,4);
  assert.equal((await f.success('pulso_history',{})).data.items[0].limitations[0],'Sin ejecución');
  assert.equal((await f.success('pulso_work',{action:'reopen',workId:'WORK-1',expectedRevision:4,reason:'Nuevo encargo'})).data.revision,5);
  assert.equal((await f.success('pulso_workspace',{action:'recover'})).data.recovered,true);
  assert.equal((await f.success('pulso_workspace',{action:'validate',fresh:true})).data.valid,true);
  assert.deepEqual(await f.run('pulso_work',{action:'get',workId:'WORK-1'}),await f.tools.pulso_work.execute({action:'get',workId:'WORK-1'},{projectRoot:f.projectRoot}));
});
test('trusted invocation context is separate, required, and checked immediately before synchronous operations',async t=>{
  const f=fixture(t);
  for(const [name,input] of [['pulso_workspace',{action:'prepare'}],['pulso_context',{action:'set_preference',scope:'user',expectedRevision:1,key:'a',value:'b',source:'user'}]]){
    let checked=0;
    const result=await f.run(name,input,{assertContext:()=>{checked++;throw new Error('contexto invalidado');}});
    assert.equal(result.ok,false);assert.match(result.output,/contexto invalidado/);assert.equal(checked,1);
  }
  for(const assertContext of [async()=>{},async()=>{throw new Error('async context invalid');}])assert.equal((await f.run('pulso_workspace',{action:'prepare'},{assertContext})).ok,false);
  for(const projectRoot of [undefined,'relative',''])assert.equal((await f.run('pulso_workspace',{action:'prepare'},{projectRoot})).ok,false);
  for(const key of ['projectRoot','root','homeDir','resourceRoot','bindingId','expectedBindingId'])assert.equal((await f.run('pulso_workspace',{action:'prepare',[key]:'/arbitrary'})).ok,false);
  assert.deepEqual(snapshot(f.projectRoot),[]);assert.deepEqual(snapshot(f.homeDir),[]);
});

async function detailedFixture(t){
  const f=await prepared(t);let work=artifacts.readWork(f.projectRoot,'WORK-1');
  work.objective.criteria=Array.from({length:37},(_,index)=>({id:`AC-${index+1}`,description:`Criterio ${index+1} ${'c'.repeat(300)}`,verification:`Verificar ${index+1}`,evidenceIds:[]}));
  work.tasks=Array.from({length:51},(_,index)=>({id:`T-${index+1}`,title:`Tarea ${index+1}`,criterionIds:[`AC-${index%37+1}`],agent:null,status:'pending',dependsOn:[],writeScope:[],resources:[],acceptance:['Resultado comprobado'],evidenceIds:[],summary:'Contexto completo'}));
  work.blockers=Array.from({length:57},(_,index)=>`Bloqueo ${index+1} ${'b'.repeat(200)}`);
  work.decisionsPending=Array.from({length:31},(_,index)=>`Decisión ${index+1}`);
  work.documents=Array.from({length:23},(_,index)=>({kind:'research',path:`doc-${index}.md`,templateVersion:'research@1.0'}));
  for(const doc of work.documents)atomicWrite(f.projectRoot,doc.path,'Contenido');
  work.acceptanceChanges=Array.from({length:29},(_,index)=>({at:new Date().toISOString(),entity:'criterion',entityId:'AC-1',before:{description:'Antes',verification:'Comprobar'},after:{description:`Después ${index}`,verification:'Comprobar'},reason:`Motivo ${index}`}));
  work=artifacts.saveWork(f.projectRoot,work,1);
  return {...f,work};
}
test('all Work pages preserve every criterion, task, blocker, decision, document and acceptance change',async t=>{
  const f=await detailedFixture(t),collected={tasks:[],criteria:[],evidence:[],documents:[],blockers:[],decisionsPending:[],acceptanceChanges:[]},bases={criteria:[],tasks:[]};
  let cursor;
  do{
    const input={action:'get',workId:'WORK-1',section:'all',limit:7,...(cursor?{cursor}:{})};
    const result=await f.success('pulso_work',input),data=result.data;
    for(const key of Object.keys(collected)){
      const value=key==='criteria'?data.objective.criteria:data[key];
      assert.ok(value.items.length<=7);collected[key].push(...value.items);
    }
    bases.criteria.push(...data.acceptanceBasis.criteria);bases.tasks.push(...data.acceptanceBasis.tasks);
    cursor=data.nextCursor;assert.equal(Boolean(cursor),data.hasMore);
  }while(cursor);
  for(const [key,values] of Object.entries(collected))assert.deepEqual(values,key==='criteria'?f.work.objective.criteria:f.work[key],key);
  assert.deepEqual(bases,artifacts.acceptanceBasis(f.work));
});
test('every advertised readWith section is accepted and reaches the canonical data',async t=>{
  const f=await detailedFixture(t),overview=(await f.success('pulso_work',{action:'get',workId:'WORK-1',limit:5})).data;
  for(const [field,value] of [['criteria',overview.objective.criteria],...Object.entries(overview).filter(([,value])=>value?.readWith)]){
    const request={action:'get',workId:'WORK-1',...value.readWith,limit:5};
    assert.doesNotThrow(()=>validateToolInput('pulso_work',request));
    const response=await f.success('pulso_work',request),page=field==='criteria'?response.data.objective.criteria:response.data[field];
    assert.equal(page.items.length,Math.min(5,value.total));
  }
  for(const value of Object.values(overview.acceptanceBasisPage))if(value.readWith)assert.doesNotThrow(()=>validateToolInput('pulso_work',{action:'get',workId:'WORK-1',...value.readWith}));
  const blocked=(await f.success('pulso_work',{action:'get',workId:'WORK-1',section:'blockers',limit:5})).data;
  assert.deepEqual(blocked.blockers.items,f.work.blockers.slice(0,5));
});
test('Work continuation rejects changed section, work, revision and same-revision content edits',async t=>{
  const f=await detailedFixture(t),input={action:'get',workId:'WORK-1',section:'tasks',limit:2},first=await f.success('pulso_work',input);
  const cursor=first.data.nextCursor;
  assert.match((await f.run('pulso_work',{...input,section:'criteria',cursor})).output,/CURSOR_OBSOLETO/);
  artifacts.createWork(f.projectRoot,{id:'WORK-2',title:'Otro',objective:'Otro',criterion:'Otro',verification:'Otro'});
  assert.match((await f.run('pulso_work',{...input,workId:'WORK-2',cursor})).output,/CURSOR_OBSOLETO/);
  const file=path.join(f.projectRoot,'.pulso/work/WORK-1/work.json');
  fs.writeFileSync(file,JSON.stringify({...f.work,title:'Cambio externo sin revisión'}));
  assert.match((await f.run('pulso_work',{...input,cursor})).output,/CURSOR_OBSOLETO/);
  fs.writeFileSync(file,JSON.stringify(f.work));
  await f.success('pulso_work',{action:'update',workId:'WORK-1',expectedRevision:f.work.revision,actions:[{type:'work.set_overview',summary:'Nueva revisión'}]});
  assert.match((await f.run('pulso_work',{...input,cursor})).output,/CURSOR_OBSOLETO/);
});
test('status pages reach all works and reject changed filters/index content',async t=>{
  const f=await prepared(t);
  for(let index=2;index<=26;index++)await f.success('pulso_work',{...creation,workId:`WORK-${index}`});
  const all=[];let cursor;
  do{const response=await f.success('pulso_workspace',{action:'status',limit:4,...(cursor?{cursor}:{})});all.push(...response.data.works.items);cursor=response.data.works.nextCursor;}while(cursor);
  assert.equal(all.length,26);assert.equal(new Set(all.map(value=>value.id)).size,26);
  const first=(await f.success('pulso_workspace',{action:'status',limit:4})).data.works.nextCursor;
  assert.match((await f.run('pulso_workspace',{action:'status',status:'pending',cursor:first})).output,/CURSOR_OBSOLETO/);
  const file=path.join(f.projectRoot,'.pulso/state.json'),value=JSON.parse(fs.readFileSync(file));value.works[0].lastProgress='Cambio externo';fs.writeFileSync(file,JSON.stringify(value));
  assert.match((await f.run('pulso_workspace',{action:'status',cursor:first})).output,/CURSOR_OBSOLETO/);
});
test('history pages retain every closure cycle and full historical limitations',async t=>{
  const f=await prepared(t),limitations=Array.from({length:30},(_,index)=>`Limitación ${index} ${'x'.repeat(900)}`);let revision=1;
  for(let cycle=1;cycle<=24;cycle++){
    const result=await f.success('pulso_work',{action:'close',workId:'WORK-1',expectedRevision:revision,outcome:'cancelled',summary:`Ciclo ${cycle} ${'s'.repeat(3000)}`,limitations});revision=result.data.revision;
    if(cycle<24)revision=(await f.success('pulso_work',{action:'reopen',workId:'WORK-1',expectedRevision:revision,reason:'Otro ciclo'})).data.revision;
  }
  const all=[];let cursor,first;
  do{const response=await f.success('pulso_history',{limit:3,...(cursor?{cursor}:{})});all.push(...response.data.items);cursor=response.data.nextCursor;first??=cursor;}while(cursor);
  assert.deepEqual(all.map(item=>item.cycle),Array.from({length:24},(_,index)=>24-index));
  for(const item of all){assert.deepEqual(item.limitations,limitations);assert.ok(item.summary.length>3000);}
  assert.match((await f.run('pulso_history',{workId:'WORK-1',cursor:first})).output,/CURSOR_OBSOLETO/);
  const file=path.join(f.projectRoot,'.pulso/history.jsonl'),entries=artifacts.history(f.projectRoot);entries[0].limitations.push('Cambio histórico');fs.writeFileSync(file,entries.map(value=>JSON.stringify(value)).join('\n')+'\n');
  assert.match((await f.run('pulso_history',{cursor:first})).output,/CURSOR_OBSOLETO/);
});

for(const operation of ['create','update','close','reopen'])test(`${operation} projection failure preserves committed work identity and revision in tool error`,async t=>{
  const f=fixture(t);await f.success('pulso_workspace',{action:'prepare'});
  if(operation!=='create')await f.success('pulso_work',creation);
  if(operation==='reopen')await f.success('pulso_work',{action:'close',workId:'WORK-1',expectedRevision:1,outcome:'cancelled',summary:'Cancelado'});
  const rename=fs.renameSync;
  const mocked=t.mock.method(fs,'renameSync',(from,to)=>{if(String(to).endsWith('/.pulso/state.json'))throw new Error('injected projection failure');return rename(from,to);});
  const input={create:creation,update:{action:'update',workId:'WORK-1',expectedRevision:1,actions:[{type:'work.set_overview',summary:'Persistido'}]},close:{action:'close',workId:'WORK-1',expectedRevision:1,outcome:'cancelled',summary:'Cancelado'},reopen:{action:'reopen',workId:'WORK-1',expectedRevision:2,reason:'Nuevo ciclo'}}[operation];
  const result=await f.run('pulso_work',input);mocked.mock.restore();
  const work=artifacts.readWork(f.projectRoot,'WORK-1',{files:false});
  assert.equal(result.ok,false);assert.equal(result.persistence.applied,true);assert.equal(result.persistence.partial,true);assert.equal(result.persistence.workId,work.id);assert.equal(result.persistence.revision,work.revision);assert.match(result.output,/Aplicado parcialmente/);
  await f.success('pulso_workspace',{action:'sync',workId:'WORK-1',expectedRevision:work.revision});
  assert.equal((await f.success('pulso_workspace',{action:'validate'})).data.valid,true);
});

test('observed evidence stays immutable, complete, and required for positive closure',async t=>{
  const f=await prepared(t);atomicWrite(f.projectRoot,'report.txt','Observed PASS');
  const view=await f.success('pulso_work',{action:'get',workId:'WORK-1'});
  assert.equal(view.data.acceptanceBasis.criteria[0].id,'AC-1');
  const observed={id:'E-1',kind:'static',status:'pass',criterionIds:['AC-1'],taskIds:[],report:'report.txt',command:null,exitCode:null,cwd:'.',basis:'Reviewed report',files:[{path:'report.txt',sha256:createHash('sha256').update('Observed PASS').digest('hex')}],acceptanceBasis:view.data.acceptanceBasis,checkedAt:new Date().toISOString(),summary:'Observed result'};
  const before=snapshot(f.projectRoot);
  for(const evidence of [{...observed,files:['report.txt']},{...observed,files:[{path:'report.txt',sha256:'0'.repeat(64)}]},Object.fromEntries(Object.entries(observed).filter(([key])=>key!=='acceptanceBasis'))]){
    assert.equal((await f.run('pulso_work',{action:'update',workId:'WORK-1',expectedRevision:1,actions:[{type:'evidence.add',evidence}]})).ok,false);assert.deepEqual(snapshot(f.projectRoot),before);
  }
  assert.equal((await f.run('pulso_work',{action:'complete_map',workId:'WORK-1',expectedRevision:1,summary:'Template is not evidence'})).ok,false);
  await f.success('pulso_work',{action:'update',workId:'WORK-1',expectedRevision:1,actions:[{type:'evidence.add',evidence:observed}]});
  assert.deepEqual((await f.success('pulso_work',{action:'get',workId:'WORK-1',section:'evidence'})).data.evidence.items[0],observed);
  const closed=await f.success('pulso_work',{action:'close',workId:'WORK-1',expectedRevision:2,summary:'Verificado'});assert.equal(closed.data.status,'done');
});
test('validate_result uses neutral resource catalog and preserves read-only semantic acceptance',async t=>{
  const f=await prepared(t),output='.pulso/work/WORK-1/plan.md';
  await f.success('pulso_work',{action:'update',workId:'WORK-1',expectedRevision:1,actions:[{type:'task.add',task:{id:'T-1',title:'Plan',criterionIds:['AC-1'],agent:'pulso-planner',status:'pending',dependsOn:[],writeScope:[output],resources:['.pulso/work/WORK-1/work.json'],acceptance:['Plan reviewed'],evidenceIds:[],summary:''}}]});
  const delegation={...JSON.parse(fs.readFileSync(path.join(resourceRoot,'templates/delegation.json'),'utf8')),workId:'WORK-1',workRevision:2,inputs:['.pulso/work/WORK-1/work.json'],resources:['.pulso/work/WORK-1/work.json'],output,writeScope:[output]};
  const result=legacyResult({workId:'WORK-1',workRevision:2});
  const before=snapshot(f.projectRoot),homeBefore=snapshot(f.homeDir);
  const validated=await f.success('pulso_work',{action:'validate_result',delegation,result});
  assert.equal(validated.data.valid,true);assert.equal(validated.data.semanticAcceptance,'PENDING_REVIEW');
  for(const invalid of [{...result,workRevision:1},{...result,agent:'pulso-executor'},{...result,status:'completed',artifacts:[]},{...result,root:'/tmp'}])assert.equal((await f.run('pulso_work',{action:'validate_result',delegation,result:invalid})).ok,false);
  assert.deepEqual(snapshot(f.projectRoot),before);assert.deepEqual(snapshot(f.homeDir),homeBefore);
});
test('memory scopes/provenance persist, compact summaries are bounded, and read returns full data',async t=>{
  const f=fixture(t);let revision=1;
  await f.success('pulso_context',{action:'set_context',scope:'project',expectedRevision:revision++,context:'p'.repeat(4000)});
  for(let index=0;index<12;index++)await f.success('pulso_context',{action:'set_preference',scope:'project',expectedRevision:revision++,key:`key-${index}`,value:'v'.repeat(1000),source:'user'});
  const summary=await f.success('pulso_context',{action:'summary',scope:'project'});assert.ok(summary.output.length<=8000);assert.match(summary.output,/truncado/);
  let cursor;const entries=[];
  do{const value=await f.success('pulso_context',{action:'read',scope:'all',limit:2,...(cursor?{cursor}:{})});entries.push(...value.data.entries);cursor=value.data.nextCursor;}while(cursor);
  assert.equal(entries.length,13);assert.equal(entries[0].content.length,4000);assert.equal(entries[12].value.length,1000);assert.equal(entries[12].provenance,'explicit');
  await f.success('pulso_context',{action:'set_preference',scope:'user',expectedRevision:1,key:'idioma',value:'es',source:'user'});
  assert.equal((await f.success('pulso_context',{action:'read',scope:'user'})).data.entries[0].source,'user');
});
test('memory cursors bind the actual scoped roots and snapshot, retaining shared user-source reads',t=>{
  const a=temp(t),b=temp(t),homeDir=temp(t),otherHome=temp(t),options={homeDir};
  for(const root of [a,b])for(let i=0;i<3;i++)updateMemory(root,{action:'set_preference',scope:'project',expectedRevision:i+1,key:`k${i}`,value:'value',source:'user'},options);
  const first=readMemory(a,{limit:1},options);
  assert.throws(()=>readMemory(b,{cursor:first.nextCursor},options),/CURSOR_OBSOLETO/);
  const file=path.join(a,'.pulso/memory.json'),saved=JSON.parse(fs.readFileSync(file));saved.preferences[1].value='External same-revision edit';fs.writeFileSync(file,JSON.stringify(saved));
  assert.throws(()=>readMemory(a,{cursor:first.nextCursor},options),/CURSOR_OBSOLETO/);
  for(let i=0;i<3;i++)updateMemory(a,{action:'add_learning',scope:'user',expectedRevision:i+1,note:`User note ${i}`,source:'user'},options);
  fs.cpSync(path.join(homeDir,'.pulso'),path.join(otherHome,'.pulso'),{recursive:true});
  const user=readMemory(a,{scope:'user',limit:1},options);
  assert.equal(readMemory(b,{scope:'user',cursor:user.nextCursor},options).entries.length,2);
  assert.throws(()=>readMemory(a,{scope:'user',cursor:user.nextCursor},{homeDir:otherHome}),/CURSOR_OBSOLETO/);
});
