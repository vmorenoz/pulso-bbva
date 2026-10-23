import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {build,sourceRoot,releaseVersion} from './build.mjs';
import {verifyPackage} from './check.mjs';
import {hash} from './files.mjs';

export async function packageTarget(target='opencode',{root=sourceRoot}={}) {
  const {output}=await build(target,{root});
  verifyPackage(target,output,{coreRoot:path.join(root,'core')});
  const artifacts=path.join(root,'artifacts');fs.mkdirSync(artifacts,{recursive:true});
  const file=path.join(artifacts,`pulso-opencode-${releaseVersion}.tar.gz`);
  // BSD tar ships with macOS; identical archive bytes across platforms are not promised.
  const metadata=process.platform==='darwin'?[]:['--sort=name','--mtime=@0','--owner=0','--group=0','--numeric-owner'];
  const result=spawnSync('tar',[...metadata,'-czf',file,'-C',output,'.'],{cwd:output,encoding:'utf8',env:{...process.env,COPYFILE_DISABLE:'1'}});
  if(result.error)throw result.error;
  if(result.status!==0)throw new Error(`Package failed: ${result.stderr||result.stdout}`);
  const sha256=hash(fs.readFileSync(file));
  fs.writeFileSync(`${file}.sha256`,`${sha256}  ${path.basename(file)}\n`);
  return {target,file,sha256};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await packageTarget(process.argv[2])));
