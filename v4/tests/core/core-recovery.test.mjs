import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {prepareWorkspace} from '../../core/lib/workspace.mjs';
import {syncWorkOperation,recoverWorkspaceOperation} from '../../core/lib/work-mutations.mjs';
import {status,history,closeWork,validateProject} from '../../core/lib/artifacts.mjs';
import {temp,repo,create,ready,readWork,writeJSON,atomicWrite} from './helpers.mjs';

const legacy={id:'PULSO-001',title:'Entrega anterior',objective:'Conservar alcance',status:'implemented',acceptance_criteria:['Resultado revisado','Alcance conservado'],execution:{summary:'Implementación',verification_gaps:['Falta verificar']}};
function legacyRepo(t){const root=temp(t);writeJSON(root,'.pulso/tasks/PULSO-001.json',legacy);return root;}
test('migración reconoce legacy, conserva IDs/docs y deja backup íntegro',t=>{
  const root=legacyRepo(t),homeDir=temp(t);atomicWrite(root,'.pulso/project.md','Contexto confirmado');atomicWrite(root,'.pulso/tasks/unknown.md','No borrar');atomicWrite(root,'.pulso/custom/data.txt','Datos desconocidos');
  const result=prepareWorkspace(root,{homeDir}),work=readWork(root,'PULSO-001');
  assert.equal(result.migratedWorks,1);assert.equal(work.status,'paused');assert.match(work.blockers.join(' '),/Falta verificar/);
  assert.deepEqual(work.objective.criteria.map(c=>c.description),legacy.acceptance_criteria);
  for(const file of ['project.md','tasks/unknown.md','custom/data.txt'])assert.equal(fs.readFileSync(path.join(root,'.pulso',file),'utf8'),fs.readFileSync(path.join(root,result.backupPath,file),'utf8'));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,result.backupPath,'tasks/PULSO-001.json'))),legacy);
  assert.equal(fs.existsSync(path.join(root,'.pulso/tasks/PULSO-001.json')),false);
  assert.equal(validateProject(root).valid,true);
});
test('legacy corrupto o no reconocido impide toda migración',t=>{
  for(const content of ['{broken','{}',JSON.stringify({...legacy,acceptance_criteria:[]})]){
    const root=legacyRepo(t),homeDir=temp(t);atomicWrite(root,'.pulso/tasks/PULSO-002.json',content);
    assert.throws(()=>prepareWorkspace(root,{homeDir}));
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'.pulso/tasks/PULSO-001.json'))),legacy);
    assert.equal(fs.readFileSync(path.join(root,'.pulso/tasks/PULSO-002.json'),'utf8'),content);
    assert.equal(fs.existsSync(path.join(root,'.pulso/state.json')),false);assert.deepEqual(fs.readdirSync(homeDir),[]);
  }
});
test('fallo al persistir un Work en staging conserva fuente y limpia staging',t=>{
  const root=legacyRepo(t),homeDir=temp(t),rename=fs.renameSync;
  fs.renameSync=(source,dest)=>{if(String(dest).includes('.pulso-migration-')&&dest.endsWith('/work.json'))throw new Error('Fallo staging inyectado');return rename(source,dest);};
  try{assert.throws(()=>prepareWorkspace(root,{homeDir}),/inyectado/);}finally{fs.renameSync=rename;}
  assert.deepEqual(fs.readdirSync(root),['.pulso']);assert.equal(fs.existsSync(path.join(root,'.pulso/tasks/PULSO-001.json')),true);
});
test('fallo al publicar staging restaura backup mediante rollback',t=>{
  const root=legacyRepo(t),homeDir=temp(t),rename=fs.renameSync;
  fs.renameSync=(source,dest)=>{if(String(source).includes('.pulso-migration-')&&source.endsWith('/.pulso'))throw new Error('Fallo de publicación inyectado');return rename(source,dest);};
  try{assert.throws(()=>prepareWorkspace(root,{homeDir}),/inyectado/);}finally{fs.renameSync=rename;}
  assert.deepEqual(fs.readdirSync(root),['.pulso']);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'.pulso/tasks/PULSO-001.json'))),legacy);
});
test('prepare nunca interpreta corrupción actual como legacy aunque haya tasks',t=>{
  const root=legacyRepo(t),homeDir=temp(t);atomicWrite(root,'.pulso/state.json','{broken');atomicWrite(root,'.pulso/custom.md','Conservar');
  assert.throws(()=>prepareWorkspace(root,{homeDir}));
  assert.equal(fs.readFileSync(path.join(root,'.pulso/state.json'),'utf8'),'{broken');assert.equal(fs.readFileSync(path.join(root,'.pulso/custom.md'),'utf8'),'Conservar');assert.deepEqual(fs.readdirSync(homeDir),[]);
});
test('docs desconocidos sin state se conservan al preparar workspace nuevo',t=>{
  const root=temp(t),homeDir=temp(t);atomicWrite(root,'.pulso/custom.md','Conservar');prepareWorkspace(root,{homeDir});assert.equal(fs.readFileSync(path.join(root,'.pulso/custom.md'),'utf8'),'Conservar');
});
test('prepare resumes its own bootstrap after every initial file publication',t=>{
  for(const file of ['preparation.json','state.json','history.jsonl','project.md','decisions.md','memory.json','project.json']){
    const root=temp(t),homeDir=temp(t),rename=fs.renameSync;let interrupted=false;
    atomicWrite(root,'.pulso/custom.md','Conservar');
    fs.renameSync=(source,dest)=>{const result=rename(source,dest);if(dest===path.join(root,'.pulso',file)&&!interrupted){interrupted=true;throw new Error('bootstrap interrupted');}return result;};
    try{assert.throws(()=>prepareWorkspace(root,{homeDir}),/bootstrap interrupted/);}finally{fs.renameSync=rename;}
    const result=prepareWorkspace(root,{homeDir});assert.equal(interrupted,true,file);assert.equal(result.bootstrapRecovered,true,file);
    assert.equal(validateProject(root).valid,true);assert.equal(fs.existsSync(path.join(root,'.pulso/preparation.json')),false);
    for(const name of ['project.md','decisions.md','memory.json','project.json'])assert.equal(fs.statSync(path.join(root,'.pulso',name)).isFile(),true);
    assert.equal(fs.readFileSync(path.join(root,'.pulso/custom.md'),'utf8'),'Conservar');
    assert.equal(prepareWorkspace(root,{homeDir}).projectId,result.projectId);
  }
});
test('bootstrap resumes across directory and identity registration failures while preserving prior context',t=>{
  const root=temp(t),homeDir=temp(t),mkdir=fs.mkdirSync;
  atomicWrite(root,'.pulso/project.md','Contexto confirmado');atomicWrite(root,'.pulso/decisions.md','Decisión previa');
  fs.mkdirSync=(target,...options)=>{if(target===path.join(root,'.pulso/work'))throw new Error('work directory interrupted');return mkdir(target,...options);};
  try{assert.throws(()=>prepareWorkspace(root,{homeDir}),/work directory interrupted/);}finally{fs.mkdirSync=mkdir;}
  const rename=fs.renameSync;fs.renameSync=(source,dest)=>{if(dest.startsWith(homeDir+path.sep))throw new Error('registry interrupted');return rename(source,dest);};
  try{assert.throws(()=>prepareWorkspace(root,{homeDir}),/registry interrupted/);}finally{fs.renameSync=rename;}
  const identity=JSON.parse(fs.readFileSync(path.join(root,'.pulso/project.json')));
  assert.equal(prepareWorkspace(root,{homeDir}).projectId,identity.projectId);
  assert.equal(fs.readFileSync(path.join(root,'.pulso/project.md'),'utf8'),'Contexto confirmado');
  assert.equal(fs.readFileSync(path.join(root,'.pulso/decisions.md'),'utf8'),'Decisión previa');
});
test('bootstrap marker never authorizes overwriting changed seed data or mixed legacy/work content',t=>{
  for(const [file,bytes] of [['state.json','{broken'],['project.md','User changes'],['tasks/PULSO-001.json',JSON.stringify(legacy)],['work/KEEP/work.json','keep']]){
    const root=temp(t),homeDir=temp(t),rename=fs.renameSync;
    fs.renameSync=(source,dest)=>{if(dest===path.join(root,'.pulso/history.jsonl'))throw new Error('bootstrap interrupted');return rename(source,dest);};
    try{assert.throws(()=>prepareWorkspace(root,{homeDir}),/bootstrap interrupted/);}finally{fs.renameSync=rename;}
    atomicWrite(root,`.pulso/${file}`,bytes);
    assert.throws(()=>prepareWorkspace(root,{homeDir}),/datos conservados/);
    assert.equal(fs.readFileSync(path.join(root,'.pulso',file),'utf8'),bytes);assert.equal(fs.existsSync(path.join(root,'.pulso/history.jsonl')),false);
  }
});
test('unmarked partial workspaces are not claimed as bootstrap and missing context is reported',t=>{
  const root=repo(t),homeDir=temp(t),before=fs.readFileSync(path.join(root,'.pulso/state.json'),'utf8');
  assert.throws(()=>prepareWorkspace(root,{homeDir}),/sin marcador propio/);
  assert.equal(fs.readFileSync(path.join(root,'.pulso/state.json'),'utf8'),before);assert.equal(fs.existsSync(path.join(root,'.pulso/preparation.json')),false);assert.deepEqual(fs.readdirSync(homeDir),[]);
  fs.unlinkSync(path.join(root,'.pulso/history.jsonl'));assert.throws(()=>prepareWorkspace(root,{homeDir}));assert.equal(fs.existsSync(path.join(root,'.pulso/history.jsonl')),false);
});
test('recognized legacy state migrates with tasks and keeps original state in backup',t=>{
  const root=legacyRepo(t),homeDir=temp(t),original=JSON.stringify({schema_version:1,custom:'retain legacy state'});
  atomicWrite(root,'.pulso/state.json',original);
  const result=prepareWorkspace(root,{homeDir});
  assert.equal(result.legacyMigrated,true);assert.equal(result.migratedWorks,1);
  assert.equal(status(root).schemaVersion,1);assert.equal(readWork(root,'PULSO-001').status,'paused');
  assert.equal(fs.readFileSync(path.join(root,result.backupPath,'state.json'),'utf8'),original);
  assert.equal(prepareWorkspace(root,{homeDir}).projectId,result.projectId);
});
test('unknown legacy state versions or state without recognized tasks remain untouched',t=>{
  for(const [version,withTasks] of [[2,true],[1,false]]){
    const root=withTasks?legacyRepo(t):temp(t),homeDir=temp(t),original=JSON.stringify({schema_version:version});
    atomicWrite(root,'.pulso/state.json',original);
    assert.throws(()=>prepareWorkspace(root,{homeDir}));
    assert.equal(fs.readFileSync(path.join(root,'.pulso/state.json'),'utf8'),original);assert.deepEqual(fs.readdirSync(homeDir),[]);
    assert.deepEqual(fs.readdirSync(root),['.pulso']);
  }
});
test('sync exige revisión vigente y recupera archivado interrumpido sin cambiar Work',t=>{
  const root=repo(t);ready(root);const old=status(root),closed=closeWork(root,'DEMO-1',{summary:'Listo'});
  atomicWrite(root,'.pulso/history.jsonl','');writeJSON(root,'.pulso/state.json',old);
  assert.throws(()=>syncWorkOperation(root,{workId:'DEMO-1',expectedRevision:closed.revision-1}),/obsoleta/);assert.equal(history(root).length,0);
  assert.throws(()=>syncWorkOperation(root,{workId:'DEMO-1'}),/obsoleta/);
  assert.equal(syncWorkOperation(root,{workId:'DEMO-1',expectedRevision:closed.revision}).operation,'work.apply');
  syncWorkOperation(root,{workId:'DEMO-1',expectedRevision:closed.revision});assert.equal(history(root).length,1);assert.equal(status(root).works.length,0);assert.deepEqual(readWork(root,'DEMO-1'),closed);
});
test('recover explícito reconstruye índice corrupto y conserva copia',t=>{
  const root=repo(t);create(root);atomicWrite(root,'.pulso/state.json','{broken');
  const result=recoverWorkspaceOperation(root);assert.equal(result.recovered,true);assert.equal(result.validation.valid,true);
  const copies=fs.readdirSync(path.join(root,'.pulso/recovery'));assert.equal(copies.length,1);assert.equal(fs.readFileSync(path.join(root,'.pulso/recovery',copies[0]),'utf8'),'{broken');
});
test('recover preflight rechaza historia/canónico corruptos sin modificar proyecciones',t=>{
  for(const file of ['.pulso/history.jsonl','.pulso/work/DEMO-1/work.json']){
    const root=repo(t);create(root);const before=fs.readFileSync(path.join(root,'.pulso/state.json'),'utf8');atomicWrite(root,file,'{broken');
    assert.throws(()=>recoverWorkspaceOperation(root));assert.equal(fs.readFileSync(path.join(root,'.pulso/state.json'),'utf8'),before);assert.equal(fs.readFileSync(path.join(root,file),'utf8'),'{broken');
  }
});
test('recover valida todos los cierres antes de completar cualquier archivado',t=>{
  const root=repo(t);create(root,'A');create(root,'B');closeWork(root,'A',{outcome:'cancelled',summary:'A'});closeWork(root,'B',{outcome:'cancelled',summary:'B'});
  const entries=history(root);entries[1].summary='Divergente';const broken=JSON.stringify(entries[1])+'\n';atomicWrite(root,'.pulso/history.jsonl',broken);
  const before=fs.readFileSync(path.join(root,'.pulso/state.json'),'utf8');assert.throws(()=>recoverWorkspaceOperation(root),/diferente/);
  assert.equal(fs.readFileSync(path.join(root,'.pulso/history.jsonl'),'utf8'),broken);assert.equal(fs.readFileSync(path.join(root,'.pulso/state.json'),'utf8'),before);
});
test('recover rechaza documentos ausentes antes de reconstruir índice',t=>{
  const root=repo(t),work=ready(root);fs.unlinkSync(path.join(root,work.evidence[0].report));atomicWrite(root,'.pulso/state.json','{broken');
  assert.throws(()=>recoverWorkspaceOperation(root),/Informe no existe/);
  assert.equal(fs.readFileSync(path.join(root,'.pulso/state.json'),'utf8'),'{broken');assert.equal(fs.existsSync(path.join(root,'.pulso/recovery')),false);
});
