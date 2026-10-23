#!/usr/bin/env node
import path from 'node:path';
import fs from 'node:fs';
import readline from 'node:readline/promises';
import {stdin,stdout} from 'node:process';
import {fileURLToPath} from 'node:url';
import {planInstallation,previewPlans,executePlans} from './index.mjs';
export function parseArgs(args){
  const o={},flags=new Set(['dry-run','yes','clean','help']),values=new Set(['opencode-package','conflict']);
  for(let i=0;i<args.length;i++){
    const a=args[i];if(!a.startsWith('--'))throw new Error(`Unknown argument ${a}`);const k=a.slice(2);
    if(Object.hasOwn(o,k))throw new Error(`Duplicate option ${a}`);
    if(flags.has(k)){o[k]=true;continue;}
    if(!values.has(k)||!args[i+1]||args[i+1].startsWith('--'))throw new Error(`Unknown/missing option ${a}`);
    o[k]=args[++i];
  }
  return o;
}
export function resolvePackageDefaults(options,{root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')}={}){
  const o={...options};
  if(!o['opencode-package']){const candidate=path.join(root,'dist/opencode');if(!fs.existsSync(path.join(candidate,'package.json')))throw new Error('OpenCode package missing. Run npm run build:opencode, or pass --opencode-package /absolute/package/path.');o['opencode-package']=candidate;}
  return o;
}
export async function main(args=process.argv.slice(2)){
  let o=parseArgs(args);
  if(o.help){console.log('Pulso — OpenCode 2.1.2 native plugin installer\n--opencode-package /absolute/dist/opencode\n--clean --conflict abort|backup-replace --dry-run --yes\n--yes confirms the displayed plan only; foreign collisions are never overwritten.');return;}
  let prompt;
  try{
    o=resolvePackageDefaults(o);
    const plans=planInstallation({opencode:{mode:o.clean?'clean':'install',packageRoot:path.resolve(o['opencode-package']),conflict:o.conflict||'abort'}});
    console.log(JSON.stringify(previewPlans(plans),null,2));
    if(!o['dry-run']&&!o.yes){
      if(!stdin.isTTY)throw new Error('Review with --dry-run, then pass --yes to execute');
      prompt=readline.createInterface({input:stdin,output:stdout});
      if((await prompt.question('Apply this plan? [y/N] ')).trim().toLowerCase()!=='y'){console.log('Cancelled. No changes made.');return;}
    }
    const result=executePlans(plans,{dryRun:!!o['dry-run']});console.log(JSON.stringify(result,null,2));
    if(result.status==='failed')process.exitCode=1;
  }finally{prompt?.close();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=1;});
