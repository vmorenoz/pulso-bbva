#!/usr/bin/env node
import path from 'node:path';
import fs from 'node:fs';
import readline from 'node:readline/promises';
import {stdin,stdout} from 'node:process';
import {fileURLToPath} from 'node:url';
import {planInstallation,previewPlans,executePlans} from './index.mjs';
export function parseArgs(args){const o={};const flags=new Set(['dry-run','yes','clean','help']);const values=new Set(['targets','opencode-package','vsix','code','profile','user-data-dir','conflict','previous-vsix','previous-sha256']);for(let i=0;i<args.length;i++){const a=args[i];if(!a.startsWith('--'))throw new Error(`Unknown argument ${a}`);const k=a.slice(2);if(flags.has(k)){o[k]=true;continue;}if(!values.has(k)||!args[i+1]||args[i+1].startsWith('--'))throw new Error(`Unknown/missing option ${a}`);o[k]=args[++i];}return o;}
export function resolvePackageDefaults(options,{root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')}={}){
 const o={...options},targets=(o.targets||'').split(',').map(s=>s.trim());
 const version=JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)),'package.json'),'utf8')).version;
 if(targets.includes('opencode')&&!o['opencode-package']){const candidate=path.join(root,'dist/opencode');if(!fs.existsSync(path.join(candidate,'package.json')))throw new Error('OpenCode package missing. Run npm run build:opencode, or pass --opencode-package /absolute/package/path.');o['opencode-package']=candidate;}
 if(targets.includes('vscode')&&!o.vsix){const candidate=path.join(root,`artifacts/pulso-${version}.vsix`);if(!fs.existsSync(candidate))throw new Error('VS Code package missing. Run npm run package:vscode, or pass --vsix /absolute/package.vsix.');o.vsix=candidate;}
 return o;
}
export async function main(args=process.argv.slice(2)){
 let o=parseArgs(args);if(o.help){console.log('Pulso global installer\n--targets opencode,vscode --opencode-package /absolute/dist/opencode --vsix /absolute/pulso.vsix\n--code code|/absolute/executable --profile NAME --user-data-dir /absolute/path\n--clean --conflict abort|backup-replace --previous-vsix /absolute/old.vsix --previous-sha256 HASH\n--dry-run --yes\n--yes confirms the displayed plan only; foreign collisions are never overwritten.');return;}
 let prompt;try{if(!o.targets){if(!stdin.isTTY)throw new Error('Noninteractive usage requires --targets');prompt=readline.createInterface({input:stdin,output:stdout});const choice=await prompt.question('Choose global integrations: 1 OpenCode, 2 VS Code, 1,2 both: ');const map={'1':'opencode','2':'vscode'};o.targets=choice.split(',').map(s=>map[s.trim()]||s.trim()).join(',');}
 o=resolvePackageDefaults(o);
 const common={mode:o.clean?'clean':'install'};const plans=planInstallation({targets:o.targets.split(',').map(s=>s.trim()),opencode:{...common,packageRoot:o['opencode-package']&&path.resolve(o['opencode-package']),conflict:o.conflict||'abort'},vscode:{...common,packagePath:o.vsix&&path.resolve(o.vsix),executable:o.code||'code',profile:o.profile,userDataDir:o['user-data-dir'],previousVSIX:o['previous-vsix'],previousSHA256:o['previous-sha256']}});
 console.log(JSON.stringify(previewPlans(plans),null,2));if(!o['dry-run']&&!o.yes){if(!stdin.isTTY)throw new Error('Review with --dry-run, then pass --yes to execute');prompt??=readline.createInterface({input:stdin,output:stdout});if((await prompt.question('Apply this plan? [y/N] ')).trim().toLowerCase()!=='y'){console.log('Cancelled. No changes made.');return;}}
 const result=executePlans(plans,{dryRun:!!o['dry-run']});console.log(JSON.stringify(result,null,2));if(['failed','partial'].includes(result.status))process.exitCode=1;else if(result.status==='manual-pending')process.exitCode=2;
 }finally{prompt?.close();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=1;});
