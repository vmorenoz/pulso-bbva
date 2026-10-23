import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {build,assertReleaseVersion} from '../../scripts/build.mjs';
import {verifyPackage} from '../../scripts/check.mjs';
import {hash} from '../../scripts/files.mjs';

test('product versions are patch-only within 0.1.*',()=>{
  for(const value of ['0.1.0','0.1.42']) assert.equal(assertReleaseVersion(value),value);
  for(const value of ['0.2.0','1.0.0','0.1.01','0.1.0-beta.1','0.1.0+build','0.1',' 0.1.0']) assert.throws(()=>assertReleaseVersion(value),/0\.1\.\*/);
});

test('build refuses removed targets instead of silently emitting another runtime',async()=>{
  for(const target of ['vscode','all','v1','v4']) await assert.rejects(build(target),/Only the opencode target/);
});

test('positive package inventory rejects concealed missing files, external imports and unsupported host contracts',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pulso-package-contract-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  await build('opencode',{outputRoot:root});
  const manifestPath=path.join(root,'pulso-package.json');
  const originalManifest=fs.readFileSync(manifestPath);
  function rewrite(file,edit) {
    const full=path.join(root,file),bytes=fs.readFileSync(full),next=Buffer.from(edit(bytes.toString()));
    fs.writeFileSync(full,next);
    const manifest=JSON.parse(originalManifest);manifest.files.find(entry=>entry.path===file).sha256=hash(next);
    fs.writeFileSync(manifestPath,JSON.stringify(manifest));
    return ()=>{fs.writeFileSync(full,bytes);fs.writeFileSync(manifestPath,originalManifest);};
  }
  const file='commands/pulso-status.md',bytes=fs.readFileSync(path.join(root,file));
  fs.unlinkSync(path.join(root,file));
  const missing=JSON.parse(originalManifest);missing.files=missing.files.filter(entry=>entry.path!==file);
  fs.writeFileSync(manifestPath,JSON.stringify(missing));
  assert.throws(()=>verifyPackage('opencode',root),/Missing required package file/);
  fs.writeFileSync(path.join(root,file),bytes);fs.writeFileSync(manifestPath,originalManifest);
  let restore=rewrite('plugin/index.mjs',text=>`${text}\nimport 'unrecognized-runtime-dependency';\n`);
  assert.throws(()=>verifyPackage('opencode',root),/External runtime import/);restore();
  for(const mutate of [
    pkg=>({...pkg,dependencies:{'unexpected-package':'1.0.0'}}),
    pkg=>({...pkg,exports:'./missing.mjs'}),
    pkg=>({...pkg,pulso:{...pkg.pulso,hostVersion:'1.18.2'}}),
  ]) {
    restore=rewrite('package.json',text=>JSON.stringify(mutate(JSON.parse(text))));
    assert.throws(()=>verifyPackage('opencode',root),/Runtime must be self-contained|Invalid native OpenCode v2 package contract/);restore();
  }
  assert.equal(verifyPackage('opencode',root).target,'opencode');
});
