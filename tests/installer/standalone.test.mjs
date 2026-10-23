import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {packageInstaller} from '../../scripts/package-installer.mjs';
import {listFiles,sha256} from '../../installer/lib/fs.mjs';

test('extracted installer configures OpenCode offline, preserves JSONC and loads its isolated runtime',()=>{
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'pulso-standalone-test-'));
  try {
    const existing=process.env.PULSO_INSTALLER_ARCHIVE;
    const {file,sha256:digest}=existing
      ? {file:path.resolve(existing),sha256:fs.readFileSync(`${path.resolve(existing)}.sha256`,'utf8').slice(0,64)}
      : packageInstaller({artifacts:temporary});
    assert.equal(sha256(fs.readFileSync(file)),digest);
    assert.equal(fs.readFileSync(`${file}.sha256`,'utf8'),`${digest}  ${path.basename(file)}\n`);
    const extract=spawnSync('tar',['-xzf',file,'-C',temporary],{encoding:'utf8'});
    assert.equal(extract.status,0,extract.stderr);
    const stage=path.join(temporary,path.basename(file,'.tar.gz'));
    for(const line of fs.readFileSync(path.join(stage,'CONTENTS.sha256'),'utf8').trim().split('\n')){
      assert.equal(sha256(fs.readFileSync(path.join(stage,line.slice(66)))),line.slice(0,64));
    }
    const home=path.join(temporary,'home'),project=path.join(temporary,'project');
    fs.mkdirSync(path.join(home,'.config','opencode'),{recursive:true});fs.mkdirSync(project);
    const config=path.join(home,'.config','opencode','opencode.jsonc');
    fs.writeFileSync(config,'{\n  // Keep my settings\n  "theme": "system",\n}\n');
    const snapshot=()=>listFiles(home).map(p=>[p,sha256(fs.readFileSync(path.join(home,p)))]);
    const before=snapshot();
    // No inherited OpenCode overrides, module paths, NODE_OPTIONS, or npm on PATH.
    const env={HOME:home,USERPROFILE:home,PATH:'',TMPDIR:temporary};
    const run=args=>{
      const result=spawnSync(process.execPath,args,{cwd:project,env,encoding:'utf8',maxBuffer:10*1024*1024});
      assert.equal(result.status,0,result.stderr||result.stdout);
      return result.stdout;
    };
    const entry=path.join(stage,'install.mjs');
    for(const target of ['pulso','opencode']){
      const rejected=spawnSync(process.execPath,[entry,'--host',target,'--yes'],{cwd:project,env,encoding:'utf8'});
      assert.equal(rejected.status,1,rejected.stdout);
      assert.match(rejected.stderr,/Unknown\/missing option --host/);
      assert.deepEqual(snapshot(),before,'Unsupported host selection must not change the profile');
    }
    assert.match(run([entry,'--dry-run']),/"dryRun": true/);
    assert.deepEqual(snapshot(),before);
    assert.match(run([entry,'--yes']),/"status": "complete"/);
    const manifest=JSON.parse(fs.readFileSync(path.join(home,'.pulso/installations/opencode-v2.json'),'utf8'));
    assert.equal(manifest.version,'0.1.0');
    assert.match(fs.readFileSync(config,'utf8'),/Keep my settings/);
    assert.match(fs.readFileSync(config,'utf8'),/"theme": "system"/);
    for(const [p,h] of Object.entries(manifest.files))assert.equal(sha256(fs.readFileSync(path.join(home,p))),h,p);
    const installed=snapshot();
    assert.match(run([entry,'--yes']),/"status": "complete"/);
    assert.deepEqual(snapshot(),installed,'Second install must be idempotent');
    // The installed runtime must still work after removing the extracted installer.
    fs.rmSync(stage,{recursive:true,force:true});
    const plugin=pathToFileURL(path.join(home,'.pulso/runtimes/opencode-v2/server.js')).href;
    // Load the actual default entrypoint using only native registration-domain
    // doubles; no service discovery, model request or fake user identity is needed.
    run(['--input-type=module','-e',`import assert from 'node:assert/strict';
      const {default:plugin}=await import(${JSON.stringify(plugin)}),tools=[];
      assert.equal(plugin.id,'pulso');assert.equal(typeof plugin.setup,'function');
      const dispose=await plugin.setup({app:${JSON.stringify({name:'opencode',version:'2.1.2'})},location:{directory:${JSON.stringify(project)}},options:{},
        permission:{assert:async()=>{}},tool:{transform:async callback=>callback({add:tool=>tools.push(tool)}),hook:async()=>{}},
        session:{hook:async()=>{},get:async()=>{throw new Error('Unexpected identity lookup during setup');}},
        event:{async *subscribe({signal}){await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));}}});
      assert.deepEqual(tools.map(tool=>tool.name).sort(),['pulso_context','pulso_history','pulso_work','pulso_workspace']);
      await dispose();`]);
    assert.deepEqual(fs.readdirSync(project),[]);
  } finally {fs.rmSync(temporary,{recursive:true,force:true});}
});
