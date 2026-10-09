import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {build,sourceRoot,releaseVersion} from './build.mjs';
import {verifyPackage} from './check.mjs';
import {hash} from './files.mjs';

export async function packageTarget(target,{root=sourceRoot,vscePath=process.env.PULSO_VSCE_PATH}={}) {
  const {output}=await build(target,{root});
  verifyPackage(target,output,{coreRoot:path.join(root,'core')});
  const artifacts=path.join(root,'artifacts');fs.mkdirSync(artifacts,{recursive:true});
  const file=path.join(artifacts,target==='vscode'?`pulso-${releaseVersion}.vsix`:`pulso-opencode-${releaseVersion}.tar.gz`);
  const command=target==='vscode'?process.execPath:'tar';
  // BSD tar ships with macOS; do not require GNU tar or promise identical archive bytes there.
  const tarMetadata=process.platform==='darwin'?[]:['--sort=name','--mtime=@0','--owner=0','--group=0','--numeric-owner'];
  const args=target==='vscode'?[vscePath||path.join(root,'node_modules/@vscode/vsce/vsce'),'package','--no-dependencies','--allow-missing-repository','--out',file]:[...tarMetadata,'-czf',file,'-C',output,'.'];
  const result=spawnSync(command,args,{cwd:output,encoding:'utf8',env:{...process.env,COPYFILE_DISABLE:'1'}});
  if(result.error)throw result.error;
  if(result.status!==0)throw new Error(`Package failed: ${result.stderr||result.stdout}`);
  fs.writeFileSync(`${file}.sha256`,`${hash(fs.readFileSync(file))}  ${path.basename(file)}\n`);
  return {target,file,sha256:hash(fs.readFileSync(file))};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await packageTarget(process.argv[2])));
