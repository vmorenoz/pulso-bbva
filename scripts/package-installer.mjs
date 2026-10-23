import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {listFiles,sha256} from '../installer/lib/fs.mjs';
import {verifyPackage} from './check.mjs';
import {assertReleaseVersion} from './build.mjs';

const sourceRoot=fileURLToPath(new URL('../',import.meta.url));
const snapshot=root=>Object.fromEntries(listFiles(root).sort().map(p=>[p,sha256(fs.readFileSync(path.join(root,p)))]));
export function packageInstaller({root=sourceRoot,artifacts=path.join(root,'artifacts')}={}) {
  const installer=path.join(root,'installer'),payload=path.join(root,'dist/opencode');
  const pkg=JSON.parse(fs.readFileSync(path.join(installer,'package.json'),'utf8'));
  const runtime=JSON.parse(fs.readFileSync(path.join(payload,'package.json'),'utf8'));
  assertReleaseVersion(pkg.version);
  verifyPackage('opencode',payload,{coreRoot:path.join(root,'core')});
  if(runtime.version!==pkg.version)throw new Error('Installer/runtime version mismatch; wait for the OpenCode build to finish');
  if(Object.keys(runtime.dependencies||{}).length)throw new Error('OpenCode runtime must be self-contained');
  if(!fs.existsSync(path.join(payload,'plugin/index.mjs')))throw new Error('Missing built OpenCode plugin');
  const require=createRequire(path.join(installer,'package.json'));
  const dependency=path.dirname(require.resolve('jsonc-parser/package.json'));
  const dep=JSON.parse(fs.readFileSync(path.join(dependency,'package.json'),'utf8'));
  if(dep.version!==pkg.dependencies['jsonc-parser']||Object.keys(dep.dependencies||{}).length)throw new Error('Unexpected jsonc-parser dependency version/tree');
  const before=snapshot(payload),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'pulso-installer-package-'));
  try {
    const name=`pulso-opencode-installer-${pkg.version}`,stage=path.join(temporary,name);
    fs.mkdirSync(stage);
    fs.cpSync(installer,path.join(stage,'installer'),{recursive:true,filter:p=>path.basename(p)!=='node_modules'});
    fs.cpSync(payload,path.join(stage,'dist/opencode'),{recursive:true});
    fs.cpSync(dependency,path.join(stage,'installer/node_modules/jsonc-parser'),{recursive:true,dereference:true});
    fs.copyFileSync(path.join(root,'scripts/installer-entry.mjs'),path.join(stage,'install.mjs'));
    fs.copyFileSync(path.join(installer,'STANDALONE.md'),path.join(stage,'README.md'));
    if(JSON.stringify(before)!==JSON.stringify(snapshot(payload))||JSON.stringify(before)!==JSON.stringify(snapshot(path.join(stage,'dist/opencode'))))throw new Error('OpenCode build changed during packaging; retry after build completion');
    fs.writeFileSync(path.join(stage,'CONTENTS.sha256'),Object.entries(snapshot(stage)).map(([p,h])=>`${h}  ${p}\n`).join(''));
    fs.mkdirSync(artifacts,{recursive:true});
    const file=path.join(artifacts,`${name}.tar.gz`),packed=path.join(temporary,`${name}.tar.gz`);
    const result=spawnSync('tar',['-czf',packed,'-C',temporary,name],{encoding:'utf8',env:{...process.env,COPYFILE_DISABLE:'1'}});
    if(result.error)throw result.error;
    if(result.status!==0)throw new Error(result.stderr||'tar failed');
    fs.copyFileSync(packed,file);
    const digest=sha256(fs.readFileSync(file));
    fs.writeFileSync(`${file}.sha256`,`${digest}  ${path.basename(file)}\n`);
    return {file,sha256:digest,runtimeFiles:Object.keys(before).length,dependency:`jsonc-parser@${dep.version}`};
  } finally {fs.rmSync(temporary,{recursive:true,force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(packageInstaller(),null,2));
