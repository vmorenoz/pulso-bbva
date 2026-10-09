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

function run(command,args,cwd) {
  const result=spawnSync(command,args,{cwd,encoding:'utf8',timeout:120000});
  if(result.error)throw result.error;
  assert.equal(result.status,0,JSON.stringify({command,args,exitCode:result.status,stderr:result.stderr}));
  return result.stdout;
}

const targets=process.argv[2]?[process.argv[2]]:['opencode','vscode'];
const tempParent=process.env.PULSO_SMOKE_TMP||os.tmpdir();
assert.ok(fs.statSync(tempParent).isDirectory());
for(const target of targets) {
  let sandbox;
  try {
    assert.ok(['opencode','vscode'].includes(target),'Select opencode or vscode');
    const staged=path.join(sourceRoot,'dist',target);
    verifyPackage(target,staged);
    const file=path.join(sourceRoot,'artifacts',target==='opencode'?`pulso-opencode-${releaseVersion}.tar.gz`:`pulso-${releaseVersion}.vsix`);
    const sha256=hash(fs.readFileSync(file));
    assert.equal(fs.readFileSync(`${file}.sha256`,'utf8').trim(),`${sha256}  ${path.basename(file)}`);
    sandbox=fs.mkdtempSync(path.join(tempParent,'pulso-package-'));
    // Check the local archive's entry paths before extraction.
    const listing=run(target==='opencode'?'tar':'unzip',target==='opencode'?['-tzf',file]:['-Z1',file],sandbox);
    for(const entry of listing.trim().split('\n'))assert.ok(!path.isAbsolute(entry)&&!entry.split('/').includes('..')&&!entry.includes('\\'),`Unsafe archive entry: ${entry}`);
    run(target==='opencode'?'tar':'unzip',target==='opencode'?['-xzf',file,'-C',sandbox]:['-q',file,'-d',sandbox],sandbox);
    const root=target==='opencode'?sandbox:path.join(sandbox,'extension');
    const inventory=verifyPackage(target,root);
    // Reject a previously generated archive even when its own manifest is internally valid.
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'pulso-package.json'))),JSON.parse(fs.readFileSync(path.join(staged,'pulso-package.json'))),'Archive differs from current build');
    const resourceRoot=path.join(root,'resources');
    const {toolContracts,toolDefinitions,isMutating}=await import(pathToFileURL(path.join(resourceRoot,'lib/tool-contracts.mjs')));
    assert.equal(toolDefinitions.length,4);
    for(const action of ['prepare_delegation','accept_result','accept_delivery']) {
      assert.ok(toolContracts.pulso_work.actionSchemas[action]);
      assert.equal(isMutating('pulso_work',{action}),action!=='prepare_delegation');
    }
    const runtime=JSON.parse(fs.readFileSync(path.join(root,'package.json')));
    let adapterLoad;
    if(target==='opencode') {
      const plugin=await import(pathToFileURL(path.join(root,'plugin/index.mjs')));
      assert.equal(typeof plugin.PulsoPlugin,'function');
      // Load the real bundled SDK, without constructing or invoking a synthetic host.
      const sdk=await import(pathToFileURL(path.join(root,'plugin/vendor/sdk/index.js')));
      const {nativeToolSchemas}=await import(pathToFileURL(path.join(root,'plugin/schema-converter.mjs')));
      const validator=await import(pathToFileURL(path.join(resourceRoot,'lib/schema.mjs')));
      const schemas=nativeToolSchemas(toolContracts,sdk.tool.schema,validator);
      assert.equal(Object.keys(schemas).length,4);
      adapterLoad='Plugin module, bundled SDK and native schemas loaded; host activation NOT_RUN';
    } else {
      const {nativeDefinitions}=await import(pathToFileURL(path.join(root,'src/native-contracts.mjs')));
      const definitions=nativeDefinitions(toolDefinitions);
      assert.ok(definitions.find(item=>item.name==='pulso_work').inputSchema.properties.expectedBindingId);
      run(process.execPath,['--check',path.join(root,'src/extension.cjs')],sandbox);
      adapterLoad='Native descriptors loaded and extension syntax checked; VS Code host activation NOT_RUN';
    }
    const smoke=await happyPath({resourceRoot,tempParent});
    console.log(JSON.stringify({target,status:'PASS',file,sha256,inventory,runtime:{name:runtime.name,version:runtime.version},adapterLoad,smoke},null,2));
  } catch(error) {
    console.error(JSON.stringify({target,status:'FAIL',error:error.message}));
    process.exitCode=1;
  } finally {
    if(sandbox)fs.rmSync(sandbox,{recursive:true,force:true});
  }
}
