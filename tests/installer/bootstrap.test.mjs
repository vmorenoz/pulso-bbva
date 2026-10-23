import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const repository=fileURLToPath(new URL('../../',import.meta.url));
const version=JSON.parse(fs.readFileSync(path.join(repository,'package.json'),'utf8')).version;
const name=`pulso-opencode-installer-${version}`;
const hash=data=>createHash('sha256').update(data).digest('hex');
function write(file,text){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text);}
function fixture(t){
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'pulso-bootstrap-test-'));
  t.after(()=>fs.rmSync(temporary,{recursive:true,force:true}));
  const checkout=path.join(temporary,'checkout with spaces');
  for(const [source,target] of [
    [path.join(repository,'install.mjs'),path.join(checkout,'install.mjs')],
    [path.join(repository,'installer/bootstrap.mjs'),path.join(checkout,'installer/bootstrap.mjs')],
    [path.join(repository,'package.json'),path.join(checkout,'package.json')],
  ])write(target,fs.readFileSync(source));
  const home=path.join(temporary,'home'),tmp=path.join(temporary,'tmp'),other=path.join(temporary,'other');
  for(const directory of [home,tmp,other])fs.mkdirSync(directory);
  write(path.join(tmp,'keep.txt'),'unrelated temporary file');
  const env={HOME:home,USERPROFILE:home,TMPDIR:tmp,PATH:'/usr/bin:/bin'};
  const file=path.join(checkout,'artifacts',`${name}.tar.gz`);
  const seal=()=>write(`${file}.sha256`,`${hash(fs.readFileSync(file))}  ${path.basename(file)}\n`);
  const pack=(script,modify=()=>{})=>{
    const stage=path.join(temporary,'stage');
    write(path.join(stage,name,'install.mjs'),script);
    modify(path.join(stage,name));
    fs.mkdirSync(path.dirname(file),{recursive:true});
    const result=spawnSync('tar',['-czf',file,'-C',stage,name],{env:{...env,COPYFILE_DISABLE:'1'},encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);seal();
  };
  const run=(args=[],cwd=checkout,entry='install.mjs',extraEnv={})=>{
    const result=spawnSync(process.execPath,[entry,...args],{cwd,env:{...env,...extraEnv},encoding:'utf8'});
    assert.ifError(result.error);
    assert.deepEqual(fs.readdirSync(tmp),['keep.txt'],'bootstrap must clean only its temporary folder');
    assert.equal(fs.readFileSync(path.join(tmp,'keep.txt'),'utf8'),'unrelated temporary file');
    return result;
  };
  return {temporary,checkout,home,tmp,other,file,pack,seal,run,env};
}

const probe=`import fs from 'node:fs';
console.log(JSON.stringify({args:process.argv.slice(2),entry:import.meta.url,cwd:process.cwd(),mode:fs.statSync(new URL('../',import.meta.url)).mode&511}));
process.exitCode=Number(process.env.FIXTURE_EXIT||0);`;

test('canonical root entry, foreign cwd, exact flags, unique private extraction and no checkout dependencies',t=>{
  const f=fixture(t);f.pack(probe);
  const entries=[];
  for(const [cwd,entry,args] of [
    [f.checkout,'install.mjs',[]],
    [f.checkout,'install.mjs',['--dry-run']],
    [f.other,path.join(f.checkout,'install.mjs'),['--yes','--conflict','backup-replace']],
    [f.other,path.join(f.checkout,'install.mjs'),['--dry-run','--conflict','backup-replace']],
  ]){
    const result=f.run(args,cwd,entry);assert.equal(result.status,0,result.stderr);
    const output=JSON.parse(result.stdout);
    assert.deepEqual(output.args,args);assert.equal(output.cwd,fs.realpathSync(cwd));assert.equal(output.mode,0o700);
    assert.ok(!fs.existsSync(fileURLToPath(output.entry)));entries.push(output.entry);
    assert.deepEqual(fs.readdirSync(f.home),[]);
  }
  assert.equal(new Set(entries).size,entries.length);
  for(const folder of [f.checkout])for(const name of ['dist','node_modules'])assert.ok(!fs.existsSync(path.join(folder,name)));
});

test('help works without artifacts or tar; absent archive and checksum fail clearly',t=>{
  const f=fixture(t);
  const help=f.run(['--help'],f.checkout,'install.mjs',{PATH:''});
  assert.equal(help.status,0,help.stderr);assert.match(help.stdout,/--dry-run/);assert.match(help.stdout,/confirmación interactiva/);
  const missing=f.run();assert.equal(missing.status,1);assert.match(missing.stderr,/Falta el paquete preparado/);
  f.pack(probe);fs.unlinkSync(`${f.file}.sha256`);
  const checksum=f.run();assert.equal(checksum.status,1);assert.match(checksum.stderr,/\.sha256/);
  assert.deepEqual(fs.readdirSync(f.home),[]);
});

test('never selects a different release when the exact package is absent',t=>{
  const f=fixture(t);f.pack(probe);
  fs.renameSync(f.file,path.join(path.dirname(f.file),'pulso-opencode-installer-99.0.0.tar.gz'));
  const result=f.run();assert.equal(result.status,1);assert.match(result.stderr,new RegExp(version.replaceAll('.','\\.')));
  assert.equal(result.stdout,'');
});

test('hash mismatch is rejected before tar is invoked; malformed checksum fails',t=>{
  const f=fixture(t);f.pack(probe);fs.appendFileSync(f.file,'corrupt');
  const corrupt=f.run([],f.checkout,'install.mjs',{PATH:''});
  assert.equal(corrupt.status,1);assert.match(corrupt.stderr,/SHA-256 no coincide/);assert.equal(corrupt.stdout,'');
  write(`${f.file}.sha256`,'not a checksum');
  const malformed=f.run();assert.equal(malformed.status,1);assert.match(malformed.stderr,/Checksum SHA-256 inválido/);
});

test('invalid tar with valid hash and missing tar produce clear errors and clean up',t=>{
  const f=fixture(t);write(f.file,'not a tar');f.seal();
  const invalid=f.run();assert.equal(invalid.status,1);assert.match(invalid.stderr,/Archivo de instalación inválido/);
  const missing=f.run([],f.checkout,'install.mjs',{PATH:''});assert.equal(missing.status,1);assert.match(missing.stderr,/No se pudo ejecutar tar/);
});

test('bundle without its entry point is rejected before launch',t=>{
  const f=fixture(t);f.pack(probe,stage=>fs.unlinkSync(path.join(stage,'install.mjs')));
  const result=f.run();assert.equal(result.status,1);assert.match(result.stderr,/falta install.mjs/);assert.equal(result.stdout,'');
});

test('bundle nonzero exit and termination status propagate with cleanup',t=>{
  const f=fixture(t);f.pack(probe);
  const failed=f.run(['--yes'],f.checkout,'install.mjs',{FIXTURE_EXIT:'37'});assert.equal(failed.status,37,failed.stderr);
  f.pack("process.kill(process.pid,'SIGTERM');");
  assert.equal(f.run().status,143);
});

test('symlinks and hardlinks are rejected before extraction',t=>{
  for(const hard of [false,true]){
    const f=fixture(t);f.pack(probe,stage=>{
      if(hard)fs.linkSync(path.join(stage,'install.mjs'),path.join(stage,'linked.mjs'));
      else fs.symlinkSync(f.home,path.join(stage,'outside'));
    });
    const result=f.run();assert.equal(result.status,1);assert.match(result.stderr,/sin enlaces/);assert.equal(result.stdout,'');
    assert.deepEqual(fs.readdirSync(f.home),[]);
  }
});

// Build a minimal USTAR member directly so traversal tests are portable across BSD/GNU tar.
function tarMember(name){
  const header=Buffer.alloc(512);
  header.write(name);header.write('0000644\0',100);header.write('0000000\0',108);header.write('0000000\0',116);
  header.write('00000000000\0',124);header.write('00000000000\0',136);header.fill(32,148,156);header.write('0',156);
  header.write('ustar\0',257);header.write('00',263);
  const sum=header.reduce((a,b)=>a+b,0);header.write(`${sum.toString(8).padStart(6,'0')}\0 `,148);
  return Buffer.concat([header,Buffer.alloc(1024)]);
}
test('absolute paths, traversal and unexpected top-level folders are rejected',async t=>{
  const {gzipSync}=await import('node:zlib');
  for(const kind of ['traversal','absolute','unexpected']){
    const f=fixture(t);
    const member=kind==='traversal'?`${name}/../../escape`:kind==='absolute'?path.join(f.home,'escape'):'other/install.mjs';
    write(f.file,gzipSync(tarMember(member)));f.seal();
    const result=f.run();assert.equal(result.status,1);assert.match(result.stderr,/Ruta insegura|Archivo de instalación inválido/);
    assert.equal(result.stdout,'');assert.deepEqual(fs.readdirSync(f.home),[]);
  }
});

test('real prepared bundle: dry run preserves config, install preserves JSONC and conflict controls',{
  skip:!process.env.PULSO_INSTALLER_ARCHIVE && 'Provide PULSO_INSTALLER_ARCHIVE to test a developer-prepared bundle',
},t=>{
  const f=fixture(t),archive=path.resolve(process.env.PULSO_INSTALLER_ARCHIVE);
  write(f.file,fs.readFileSync(archive));write(`${f.file}.sha256`,fs.readFileSync(`${archive}.sha256`));
  const config=path.join(f.home,'.config/opencode/opencode.jsonc');
  write(config,'{\n // Keep my config\n "theme":"system",\n}\n');
  const original=fs.readFileSync(config,'utf8');
  const preview=f.run(['--dry-run']);assert.equal(preview.status,0,preview.stderr);assert.match(preview.stdout,/"dryRun": true/);
  assert.equal(fs.readFileSync(config,'utf8'),original);assert.ok(!fs.existsSync(path.join(f.home,'.pulso')));
  const unconfirmed=f.run();assert.equal(unconfirmed.status,1);assert.match(unconfirmed.stderr,/pass --yes/);
  assert.equal(fs.readFileSync(config,'utf8'),original);
  const install=f.run(['--yes'],f.checkout);assert.equal(install.status,0,install.stderr);
  assert.match(fs.readFileSync(config,'utf8'),/Keep my config/);
  const manifest=JSON.parse(fs.readFileSync(path.join(f.home,'.pulso/installations/opencode-v2.json'),'utf8'));
  assert.equal(manifest.version,version);
  const agent=Object.keys(manifest.files).find(p=>p.includes('/agents/')&&p.endsWith('.md'));
  assert.ok(agent);write(path.join(f.home,agent),'customized agent');
  const conflict=f.run(['--yes']);assert.equal(conflict.status,1);assert.match(conflict.stderr,/backup-replace/);
  assert.equal(fs.readFileSync(path.join(f.home,agent),'utf8'),'customized agent');
  const replace=f.run(['--yes','--conflict','backup-replace']);assert.equal(replace.status,0,replace.stderr);
  assert.notEqual(fs.readFileSync(path.join(f.home,agent),'utf8'),'customized agent');
});
