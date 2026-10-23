/** Validate existing local archives, without installs, downloads or host doubles. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {sourceRoot,releaseVersion} from './build.mjs';
import {verifyPackage} from './check.mjs';
import {hash} from './files.mjs';
import {happyPath} from './happy-path.mjs';
import {durableSmoke} from './durable-smoke.mjs';

function run(command,args,cwd) {
  const result=spawnSync(command,args,{cwd,encoding:'utf8',timeout:120000});
  if(result.error)throw result.error;
  assert.equal(result.status,0,JSON.stringify({command,args,exitCode:result.status,stderr:result.stderr}));
  return result.stdout;
}

const targets=process.argv[2]?[process.argv[2]]:['opencode'];
const tempParent=process.env.PULSO_SMOKE_TMP||os.tmpdir();
assert.ok(fs.statSync(tempParent).isDirectory());
for(const target of targets) {
  let sandbox;
  try {
    assert.ok(['opencode'].includes(target),'Only the opencode target is supported');
    const staged=path.join(sourceRoot,'dist',target);
    verifyPackage(target,staged);
    const file=path.join(sourceRoot,'artifacts',`pulso-opencode-${releaseVersion}.tar.gz`);
    const sha256=hash(fs.readFileSync(file));
    assert.equal(fs.readFileSync(`${file}.sha256`,'utf8').trim(),`${sha256}  ${path.basename(file)}`);
    sandbox=fs.mkdtempSync(path.join(tempParent,'pulso-package-'));
    // Check the local archive's entry paths before extraction.
    const listing=run('tar',['-tzf',file],sandbox);
    for(const entry of listing.trim().split('\n'))assert.ok(!path.isAbsolute(entry)&&!entry.split('/').includes('..')&&!entry.includes('\\'),`Unsafe archive entry: ${entry}`);
    run('tar',['-xzf',file,'-C',sandbox],sandbox);
    const root=sandbox;
    const inventory=verifyPackage(target,root);
    // Reject a previously generated archive even when its own manifest is internally valid.
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'pulso-package.json'))),JSON.parse(fs.readFileSync(path.join(staged,'pulso-package.json'))),'Archive differs from current build');
    const resourceRoot=path.join(root,'resources');
    const {toolContracts,toolDefinitions,isMutating}=await import(pathToFileURL(path.join(resourceRoot,'lib/tool-contracts.mjs')));
    assert.equal(toolDefinitions.length,4);
    for(const action of ['prepare_delegation','accept_result','accept_delivery']) {
      assert.ok(toolContracts.pulso_work.actionSchemas[action]);
      assert.equal(isMutating('pulso_work',{action}),true);
    }
    const runtime=JSON.parse(fs.readFileSync(path.join(root,'package.json')));
    const plugin=await import(pathToFileURL(path.join(root,'plugin/index.mjs')));
    assert.equal(plugin.default?.id,'pulso');
    assert.equal(typeof plugin.default?.setup,'function');
    assert.equal(plugin.default.server,undefined,'V1 entrypoints must not be packaged');
    const client=await import(pathToFileURL(path.join(root,'plugin/vendor/client/promise/index.js')));
    assert.equal(typeof client.OpenCode?.make,'function');
    assert.equal(fs.existsSync(path.join(root,'plugin/vendor/client/promise/service.js')),false,'No service lifecycle helpers are needed');
    assert.equal((await import(pathToFileURL(path.join(root,'server.js')))).default.id,'pulso');
    const adapterLoad='Native V2 plugin and pinned read-only client modules loaded; no host or provider invoked';
    const smoke=await happyPath({resourceRoot,tempParent});
    const durable=await durableSmoke({resourceRoot,tempParent});
    console.log(JSON.stringify({target,status:'PASS',file,sha256,inventory,runtime:{name:runtime.name,version:runtime.version},adapterLoad,smoke,durable},null,2));
  } catch(error) {
    console.error(JSON.stringify({target,status:'FAIL',error:error.message}));
    process.exitCode=1;
  } finally {
    if(sandbox)fs.rmSync(sandbox,{recursive:true,force:true});
  }
}
