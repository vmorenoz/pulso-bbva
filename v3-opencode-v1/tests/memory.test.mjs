import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {readMemory,updateMemory} from '../lib/memory.mjs';
import {atomicWrite,now} from '../lib/fs.mjs';
import {temp} from './helpers.mjs';

const preference=(key,value,expectedRevision=1,scope='project')=>({action:'set_preference',scope,expectedRevision,key,value,source:'user'});
const document=()=>({schemaVersion:1,revision:1,updatedAt:now(),context:'',preferences:[],learning:[]});
function snapshot(root,prefix=''){
  const result={};
  for(const name of fs.readdirSync(path.join(root,prefix)).sort()){
    const relative=prefix?`${prefix}/${name}`:name,absolute=path.join(root,relative),stat=fs.lstatSync(absolute);
    if(stat.isDirectory()){result[`${relative}/`]='directory';Object.assign(result,snapshot(root,relative));}
    else result[relative]=stat.isSymbolicLink()?`symlink:${fs.readlinkSync(absolute)}`:fs.readFileSync(absolute,'utf8');
  }
  return result;
}

test('memoria global vuelve completa desde otro proyecto, distingue scope y refleja correcciones',t=>{
  const a=temp(t),b=temp(t),homeDir=temp(t),options={homeDir};
  assert.deepEqual(readMemory(a,{scope:'user'},options).revisions,{user:1});
  assert.deepEqual(snapshot(homeDir),{});
  const first=updateMemory(a,preference('idioma','español',1,'user'),options);
  assert.equal(first.revision,2);assert.equal(first.scope,'user');assert.equal('preferences' in first,false);
  updateMemory(b,preference('idioma','catalán'),options);
  const read=readMemory(b,{scope:'all',section:'preferences',key:'idioma'},options);
  assert.deepEqual(read.entries.map(({scope,value,source,provenance})=>({scope,value,source,provenance})),[
    {scope:'project',value:'catalán',source:'user',provenance:'explicit'},
    {scope:'user',value:'español',source:'user',provenance:'explicit'}
  ]);
  assert.ok(read.entries.every(entry=>entry.date&&entry.revision===2));
  updateMemory(a,preference('idioma','inglés',2,'user'),options);
  assert.equal(readMemory(b,{scope:'user',key:'idioma'},options).entries[0].value,'inglés');
  assert.equal(readMemory(a,'user',options).revision,3);
  assert.equal(fs.existsSync(path.join(a,'.pulso')),false);
});

test('contexto íntegro, aprendizajes completos y paginación con cursor vinculado a revisión',t=>{
  const root=temp(t),homeDir=temp(t),options={homeDir},context='Contexto largo. '.repeat(250);
  updateMemory(root,{action:'set_context',scope:'project',expectedRevision:1,context},options);
  updateMemory(root,preference('a','primero',2),options);
  updateMemory(root,preference('b','segundo',3),options);
  updateMemory(root,{action:'add_learning',scope:'project',expectedRevision:4,note:'Conservar todos los detalles',source:'observed'},options);
  const first=readMemory(root,{action:'read',section:'all',limit:2},options);
  assert.equal(first.entries[0].content,context);assert.equal(first.entries[0].source,'unknown');assert.ok(first.entries[0].date);
  assert.equal(first.hasMore,true);
  const second=readMemory(root,{section:'all',limit:2,cursor:first.nextCursor},options);
  assert.deepEqual(second.entries.map(entry=>entry.section),['preferences','learning']);assert.equal(second.entries[1].note,'Conservar todos los detalles');
  assert.equal(second.hasMore,false);assert.equal(second.nextCursor,null);
  assert.throws(()=>readMemory(root,{section:'preferences',cursor:first.nextCursor},options),/CURSOR_OBSOLETO/);
  updateMemory(root,preference('b','corregido',5),options);
  assert.throws(()=>readMemory(root,{cursor:first.nextCursor},options),/CURSOR_OBSOLETO/);
  assert.throws(()=>readMemory(root,{cursor:'not-a-cursor'},options),/Cursor/);
  assert.equal(readMemory(root,{section:'learning'},options).entries.length,1);
  assert.equal(readMemory(root,{key:'missing'},options).entries.length,0);
});

test('contexto histórico largo sigue legible sin truncar ni certificar procedencia antigua',t=>{
  const root=temp(t),value=document();value.context='x'.repeat(10000);
  value.preferences=[{key:'legado',value:'Dato histórico',scope:'project',source:'user',updatedAt:now()}];
  value.learning=[{note:'Una observación anterior',source:'observed',recordedAt:now()}];
  atomicWrite(root,'.pulso/memory.json',JSON.stringify(value));const before=snapshot(root);
  const read=readMemory(root);
  assert.equal(read.entries[0].content.length,10000);assert.equal(read.entries[0].date,null);
  assert.equal(read.entries[1].source,'user');assert.equal(read.entries[1].provenance,'legacy-unverified');
  assert.equal(read.entries[2].provenance,'legacy-unverified');assert.deepEqual(snapshot(root),before);
  updateMemory(root,preference('nuevo','Declarado',1));
  assert.equal(readMemory(root,{key:'legado'}).entries[0].provenance,'legacy-unverified');
});

test('mutaciones incompletas, vacías, fuentes ausentes y extras fallan antes de escribir',t=>{
  const root=temp(t),homeDir=temp(t),options={homeDir};
  const invalid=[
    {},{action:'unknown',scope:'project',expectedRevision:1},
    {action:'set_preference',scope:'project',expectedRevision:1},
    {action:'set_preference',scope:'project',expectedRevision:1,key:'key',value:'value'},
    {...preference('key','value'),source:''},{...preference('key','value'),source:'invented'},
    preference('  ','value'),preference('key','  '),{...preference('key','value'),scope:'all'},
    {...preference('key','value'),expectedRevision:0},{...preference('key','value'),expectedRevision:1.5},
    {...preference('key','value'),extra:true},
    {action:'set_context',scope:'project',expectedRevision:1},
    {action:'set_context',scope:'project',expectedRevision:1,context:7},
    {action:'remove_preference',scope:'project',expectedRevision:1,key:''},
    {action:'add_learning',scope:'project',expectedRevision:1,note:'note'},
    {action:'add_learning',scope:'project',expectedRevision:1,note:' ',source:'observed'},
    {action:'add_learning',scope:'project',expectedRevision:1,note:'note',source:'user',key:'extra'}
  ];
  for(const input of invalid){assert.throws(()=>updateMemory(root,input,options));assert.deepEqual(snapshot(root),{});assert.deepEqual(snapshot(homeDir),{});}
  assert.throws(()=>updateMemory(root,preference('a','b',2,'user'),options),/CONFLICTO/);assert.deepEqual(snapshot(homeDir),{});
  assert.throws(()=>updateMemory(root,preference('a','b',1,'user')),/homeDir/);
  assert.throws(()=>readMemory(root,{scope:'user'}),/homeDir/);
});

test('cada registro corrupto se conserva y bloquea lecturas y escrituras de cualquier sección',t=>{
  const corrupt=[
    null,{}, {...document(),revision:0},{...document(),updatedAt:'2026-02-30T00:00:00Z'},
    {...document(),context:12},{...document(),extra:true},
    {...document(),preferences:[{}]},
    {...document(),preferences:[{key:'k',value:'v',scope:'user',updatedAt:now()}]},
    {...document(),preferences:[{key:'k',value:'v',scope:'project',source:'user',updatedAt:now()}]},
    {...document(),preferences:[{key:'k',value:'',scope:'user',source:'user',updatedAt:now()}]},
    {...document(),preferences:[{key:'k',value:'v',scope:'user',source:'user',updatedAt:'yesterday'}]},
    {...document(),preferences:[{key:'k',value:'v',scope:'user',source:'user',updatedAt:now(),provenance:'verified'}]},
    {...document(),learning:[{}]},
    {...document(),learning:[{note:'n',recordedAt:now()}]},
    {...document(),learning:[{note:'n',source:'observed',recordedAt:'never'}]}
  ];
  for(const value of corrupt){
    const root=temp(t),homeDir=temp(t),options={homeDir};atomicWrite(homeDir,'.pulso/preferences.json',JSON.stringify(value));const before=snapshot(homeDir);
    assert.throws(()=>readMemory(root,{scope:'user',section:'context'},options),/MEMORIA_INVALIDA/);
    assert.throws(()=>updateMemory(root,preference('new','value',1,'user'),options),/MEMORIA_INVALIDA/);
    assert.deepEqual(snapshot(homeDir),before);assert.deepEqual(snapshot(root),{});
  }
  const root=temp(t),homeDir=temp(t);atomicWrite(homeDir,'.pulso/preferences.json','{"secret": "private text" broken');
  assert.throws(()=>readMemory(root,{scope:'user'},{homeDir}),error=>/MEMORIA_INVALIDA/.test(error.message)&&!/private text/.test(error.message));
});

test('scope user usa solamente el homeDir inyectado y rechaza symlinks sin seguirlos',t=>{
  const root=temp(t),homeDir=temp(t),outside=temp(t);
  fs.mkdirSync(path.join(homeDir,'.pulso'));fs.symlinkSync(path.join(outside,'secret'),path.join(homeDir,'.pulso/preferences.json'));
  const before=snapshot(homeDir);
  assert.throws(()=>readMemory(root,{scope:'user'},{homeDir}),/Symlink/);
  assert.throws(()=>updateMemory(root,preference('key','value',1,'user'),{homeDir}),/Symlink/);
  assert.deepEqual(snapshot(homeDir),before);assert.deepEqual(snapshot(outside),{});
});

test('revisión requerida también para proyecto; quitar preferencia y limpiar contexto conservan la revisión',t=>{
  const root=temp(t);updateMemory(root,preference('key','value'));
  const before=snapshot(root);assert.throws(()=>updateMemory(root,preference('other','value')),/CONFLICTO/);assert.deepEqual(snapshot(root),before);
  assert.equal(updateMemory(root,{action:'remove_preference',scope:'project',expectedRevision:2,key:'key'}).revision,3);
  assert.equal(updateMemory(root,{action:'set_context',scope:'project',expectedRevision:3,context:''}).revision,4);
  assert.deepEqual(readMemory(root).entries,[]);
});

test('lock ajeno informa MEMORIA_OCUPADA, conserva token y no se elimina por antigüedad',t=>{
  const root=temp(t),homeDir=temp(t),lock=path.join(homeDir,'.pulso/preferences.lock');
  fs.mkdirSync(lock,{recursive:true});fs.writeFileSync(path.join(lock,'owner.json'),JSON.stringify({token:'foreign',pid:999999999,createdAt:'2000-01-01T00:00:00Z'}));
  const before=snapshot(homeDir);
  assert.throws(()=>updateMemory(root,preference('a','b',1,'user'),{homeDir}),error=>/MEMORIA_OCUPADA/.test(error.message)&&error.message.includes(lock)&&/propietario/.test(error.message));
  assert.deepEqual(snapshot(homeDir),before);
});

test('fallo de escritura libera el lock propio y conserva la memoria anterior',t=>{
  const root=temp(t),homeDir=temp(t),options={homeDir};updateMemory(root,preference('a','first',1,'user'),options);
  const before=snapshot(homeDir),rename=fs.renameSync;
  fs.renameSync=(from,to)=>{if(to===path.join(homeDir,'.pulso/preferences.json'))throw new Error('fallo de escritura inyectado');return rename(from,to);};
  try{assert.throws(()=>updateMemory(root,preference('b','second',2,'user'),options),/fallo de escritura/);}finally{fs.renameSync=rename;}
  assert.deepEqual(snapshot(homeDir),before);
  assert.equal(updateMemory(root,preference('b','second',2,'user'),options).revision,3);
});

test('fallo al publicar token libera solamente su directorio vacío',t=>{
  const root=temp(t),homeDir=temp(t),rename=fs.renameSync;
  fs.renameSync=(from,to)=>{if(to.endsWith('/preferences.lock/owner.json'))throw new Error('fallo del token');return rename(from,to);};
  try{assert.throws(()=>updateMemory(root,preference('a','b',1,'user'),{homeDir}),/fallo del token/);}finally{fs.renameSync=rename;}
  assert.equal(fs.existsSync(path.join(homeDir,'.pulso/preferences.lock')),false);
  assert.equal(fs.existsSync(path.join(homeDir,'.pulso/preferences.json')),false);
});

test('un token reemplazado durante fallo nunca elimina el lock de otro propietario',t=>{
  const root=temp(t),homeDir=temp(t),rename=fs.renameSync,lock=path.join(homeDir,'.pulso/preferences.lock');
  fs.renameSync=(from,to)=>{
    if(to===path.join(homeDir,'.pulso/preferences.json')){fs.writeFileSync(path.join(lock,'owner.json'),JSON.stringify({token:'replacement'}));throw new Error('propietario reemplazado');}
    return rename(from,to);
  };
  try{assert.throws(()=>updateMemory(root,preference('a','b',1,'user'),{homeDir}),/propietario reemplazado/);}finally{fs.renameSync=rename;}
  assert.equal(JSON.parse(fs.readFileSync(path.join(lock,'owner.json'),'utf8')).token,'replacement');
  assert.equal(fs.existsSync(path.join(homeDir,'.pulso/preferences.json')),false);
});

test('dos procesos y proyectos comparten HOME sin pérdida silenciosa, con reconciliación explícita',{timeout:10000},async t=>{
  const homeDir=temp(t),a=temp(t),b=temp(t),moduleURL=new URL('../lib/memory.mjs',import.meta.url).href;
  const code=`import {readMemory,updateMemory} from ${JSON.stringify(moduleURL)};
    const [root,homeDir,key]=process.argv.slice(1),options={homeDir};
    const expectedRevision=readMemory(root,{scope:'user'},options).revisions.user;
    console.log('READY');
    process.stdin.once('data',()=>{try{const result=updateMemory(root,{action:'set_preference',scope:'user',expectedRevision,key,value:key,source:'user'},options);console.log(JSON.stringify({key,ok:true,result}));}catch(error){console.log(JSON.stringify({key,ok:false,error:error.message}));}process.stdin.pause();});`;
  function start(root,key){
    const child=spawn(process.execPath,['--input-type=module','-e',code,root,homeDir,key],{stdio:['pipe','pipe','pipe']});
    t.after(()=>{if(child.exitCode===null)child.kill();});
    let output='',errors='',readyResolve;const ready=new Promise(resolve=>{readyResolve=resolve;});
    child.stdout.on('data',data=>{output+=data; if(output.includes('READY\n'))readyResolve();});child.stderr.on('data',data=>{errors+=data;});
    const closed=once(child,'close').then(([exitCode])=>{assert.equal(exitCode,0,errors);return JSON.parse(output.trim().split('\n').at(-1));});
    return {child,ready,closed};
  }
  const one=start(a,'one'),two=start(b,'two');await Promise.all([one.ready,two.ready]);one.child.stdin.end('GO\n');two.child.stdin.end('GO\n');
  const results=await Promise.all([one.closed,two.closed]),successful=results.filter(result=>result.ok),failed=results.filter(result=>!result.ok);
  assert.equal(successful.length,1);assert.equal(failed.length,1);assert.match(failed[0].error,/MEMORIA_OCUPADA|CONFLICTO/);
  const latest=readMemory(a,{scope:'user'},{homeDir});assert.equal(latest.entries.length,1);
  updateMemory(b,preference(failed[0].key,failed[0].key,latest.revisions.user,'user'),{homeDir});
  const final=readMemory(a,{scope:'user'},{homeDir});assert.equal(final.revisions.user,3);
  assert.deepEqual(final.entries.map(entry=>entry.key).sort(),['one','two']);
  assert.equal(fs.existsSync(path.join(homeDir,'.pulso/preferences.lock')),false);
});


test('consultas estrictas inválidas no crean archivos',t=>{
  const root=temp(t),homeDir=temp(t);
  for(const query of [null,[],{action:'summary'},{scope:'everywhere'},{scope:null},{section:'notes'},{key:''},{key:null},{limit:0},{limit:101},{limit:'1'},{cursor:7},{unknown:true}]){
    assert.throws(()=>readMemory(root,query,{homeDir}));assert.deepEqual(snapshot(root),{});assert.deepEqual(snapshot(homeDir),{});
  }
});

test('contexto y aprendizaje globales son legibles completos y las notas no se descartan a las 50',t=>{
  const a=temp(t),b=temp(t),homeDir=temp(t),options={homeDir};
  updateMemory(a,{action:'set_context',scope:'user',expectedRevision:1,context:'Contexto entre proyectos'},options);
  const value=document();value.revision=2;
  value.context='Contexto entre proyectos';value.contextUpdatedAt=now();
  value.learning=Array.from({length:50},(_,index)=>({note:`Nota ${index}`,source:'observed',recordedAt:now()}));
  atomicWrite(homeDir,'.pulso/preferences.json',JSON.stringify(value));
  updateMemory(a,{action:'add_learning',scope:'user',expectedRevision:2,note:'Nota nueva',source:'delegated'},options);
  assert.equal(readMemory(b,{scope:'user',section:'context'},options).entries[0].content,'Contexto entre proyectos');
  const first=readMemory(b,{scope:'user',section:'learning'},options);assert.equal(first.entries.length,50);assert.equal(first.hasMore,true);
  const last=readMemory(b,{scope:'user',section:'learning',cursor:first.nextCursor},options);assert.equal(last.entries.length,1);assert.equal(last.entries[0].note,'Nota nueva');assert.equal(last.entries[0].source,'delegated');
});

test('revisión se vuelve a comprobar dentro del lock tras una actualización entre preflight y adquisición',t=>{
  const root=temp(t),homeDir=temp(t),rename=fs.renameSync,preferences=path.join(homeDir,'.pulso/preferences.json');
  fs.renameSync=(from,to)=>{
    if(to.endsWith('/preferences.lock/owner.json')){
      const prior=document();prior.revision=2;prior.preferences=[{key:'concurrente',value:'preservar',scope:'user',source:'observed',updatedAt:now()}];
      fs.writeFileSync(preferences,JSON.stringify(prior));
    }
    return rename(from,to);
  };
  try{assert.throws(()=>updateMemory(root,preference('otro','valor',1,'user'),{homeDir}),/CONFLICTO/);}finally{fs.renameSync=rename;}
  const read=readMemory(root,{scope:'user'},{homeDir});assert.equal(read.revisions.user,2);assert.deepEqual(read.entries.map(entry=>entry.key),['concurrente']);
  assert.equal(fs.existsSync(path.join(homeDir,'.pulso/preferences.lock')),false);
});
