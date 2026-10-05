import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {build,sourceRoot} from './build.mjs';
import {verifyPackage} from './check.mjs';
import {hash} from './files.mjs';

export async function packageTarget(target,{root=sourceRoot,vscePath=process.env.PULSO_VSCE_PATH}={}) {
  const {output}=await build(target,{root});
  verifyPackage(target,output,{coreRoot:path.join(root,'core')});
  const artifacts=path.join(root,'artifacts');fs.mkdirSync(artifacts,{recursive:true});
  const file=path.join(artifacts,target==='vscode'?'pulso-4.0.0.vsix':'pulso-opencode-4.0.0.tar.gz');
  const command=target==='vscode'?process.execPath:'tar';
  const args=target==='vscode'?[vscePath||path.join(root,'node_modules/@vscode/vsce/vsce'),'package','--no-dependencies','--allow-missing-repository','--out',file]:['--sort=name','--mtime=@0','--owner=0','--group=0','--numeric-owner','-czf',file,'-C',output,'.'];
  const result=spawnSync(command,args,{cwd:output,encoding:'utf8'});
  if(result.error)throw result.error;
  if(result.status!==0)throw new Error(`Package failed: ${result.stderr||result.stdout}`);
  fs.writeFileSync(`${file}.sha256`,`${hash(fs.readFileSync(file))}  ${path.basename(file)}\n`);
  return {target,file,sha256:hash(fs.readFileSync(file))};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await packageTarget(process.argv[2])));
