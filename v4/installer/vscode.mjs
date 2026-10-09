import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {inflateRawSync} from 'node:zlib';
import {safePath,sha256} from './lib/fs.mjs';
import {readOptional,prepareBackups,applyChanges} from './lib/install-cleanup.mjs';
export const EXTENSION_ID='pulso-local.pulso';
const json=x=>Buffer.from(JSON.stringify(x,null,2)+'\n');
export function readVSIX(file){
  const b=fs.readFileSync(file);let end=-1;for(let i=b.length-22;i>=Math.max(0,b.length-65557);i--)if(b.readUInt32LE(i)===0x06054b50){end=i;break;}if(end<0)throw new Error('Invalid VSIX ZIP');
  let offset=b.readUInt32LE(end+16),found;
  for(let n=0;n<b.readUInt16LE(end+10);n++){
    if(b.readUInt32LE(offset)!==0x02014b50)throw new Error('Invalid VSIX directory');const method=b.readUInt16LE(offset+10),size=b.readUInt32LE(offset+20),rawSize=b.readUInt32LE(offset+24),len=b.readUInt16LE(offset+28),extra=b.readUInt16LE(offset+30),comment=b.readUInt16LE(offset+32),local=b.readUInt32LE(offset+42),name=b.subarray(offset+46,offset+46+len).toString();
    if(name==='extension/package.json'){if(found||rawSize>1024*1024||b.readUInt32LE(local)!==0x04034b50)throw new Error('Unsafe VSIX manifest');const start=local+30+b.readUInt16LE(local+26)+b.readUInt16LE(local+28),compressed=b.subarray(start,start+size);const data=method===0?compressed:method===8?inflateRawSync(compressed,{maxOutputLength:1024*1024}):null;if(!data||data.length!==rawSize)throw new Error('Invalid VSIX compression');found=JSON.parse(data);}
    offset+=46+len+extra+comment;
  }
  if(!found||`${found.publisher}.${found.name}`!==EXTENSION_ID||typeof found.version!=='string')throw new Error('VSIX must contain pulso-local.pulso');return {version:found.version,sha256:sha256(b),bytes:b};
}
export function defaultRunner(executable,args){const r=spawnSync(executable,args,{encoding:'utf8',timeout:120000,maxBuffer:4*1024*1024,windowsHide:true});if(r.error)throw r.error;if(r.status!==0)throw new Error(`CLI failed (${r.status}): ${r.stderr||r.stdout}`);return r.stdout;}
function resolveExecutable(executable,env){if(path.isAbsolute(executable))return fs.existsSync(executable)?fs.realpathSync(executable):null;if(executable.includes('/')||executable.includes('\\'))throw new Error('CLI path must be absolute or a PATH command');for(const dir of (env.PATH||'').split(path.delimiter)){if(!dir)continue;for(const suffix of process.platform==='win32'?['','.cmd','.exe']:['']){const candidate=path.join(dir,executable+suffix);if(fs.existsSync(candidate)&&fs.statSync(candidate).isFile())return fs.realpathSync(candidate);}}return null;}
export function planVSCode({home=os.homedir(),env=process.env,packagePath,executable='code',profile,userDataDir,mode='install',runner=defaultRunner,previousVSIX,previousSHA256}={}){
  home=path.resolve(home);if(fs.lstatSync(home).isSymbolicLink())throw new Error('Home may not be a symlink');if(!['install','clean'].includes(mode))throw new Error('Invalid install mode');
  if(!packagePath||!path.isAbsolute(packagePath))throw new Error('Absolute VSIX path required');const next=readVSIX(packagePath),resolved=runner===defaultRunner?resolveExecutable(executable,env):executable;
  if(profile!==undefined&&(!profile.trim()||profile.startsWith('-')))throw new Error('Explicit nonempty local profile required');if(userDataDir&&!path.isAbsolute(userDataDir))throw new Error('User data directory must be absolute');
  const target={executable:resolved||executable,profile:profile??'default',userDataDir:userDataDir??'default',scope:'selected local profile only'};
  const args=[...(profile?['--profile',profile]:[]),...(userDataDir?['--user-data-dir',userDataDir]:[])];
  const fingerprint=sha256(JSON.stringify(target)).slice(0,24),manifestPath=`.pulso/installations/vscode-${fingerprint}.json`,cachePath=`.pulso/cache/vsix/${next.sha256}.vsix`;
  const warnings=['Installation applies only to this local product/profile; remote hosts are not verified.','An explicitly selected missing profile can be created by the native CLI.'];
  if(!resolved)return {runtime:'vscode',target,warnings,actions:[{action:'manual-install',path:packagePath,sha256:next.sha256}],execute:()=>({status:'manual-pending',version:next.version,packagePath,sha256:next.sha256,instructions:'Install the code CLI in PATH, or use Extensions: Install from VSIX in the intended local profile.'})};
  const run=extra=>runner(resolved,[...args,...extra]);const hostVersion=run(['--version']).trim();
  const query=()=>{const lines=run(['--list-extensions','--show-versions']).trim().split(/\r?\n/);const entries=lines.filter(x=>x.toLowerCase().startsWith(EXTENSION_ID+'@'));if(entries.length>1)throw new Error('Ambiguous installed extension');return entries.length?entries[0].slice(EXTENSION_ID.length+1):null;};
  const installed=query(),receiptBytes=readOptional(home,manifestPath),receipt=receiptBytes?JSON.parse(receiptBytes):null;
  if(receipt&&(receipt.schemaVersion!==1||receipt.runtime!=='vscode'||JSON.stringify(receipt.target)!==JSON.stringify(target)||!/^[a-f0-9]{64}$/.test(receipt.sha256)||receipt.cachePath!==`.pulso/cache/vsix/${receipt.sha256}.vsix`))throw new Error('Invalid VS Code ownership receipt');
  let recovery=null;
  const recoverFile=previousVSIX||(receipt&&path.join(home,receipt.cachePath));const recoverHash=previousVSIX?previousSHA256:receipt?.sha256;
  if(installed&&recoverFile){if(!path.isAbsolute(recoverFile)||!/^[a-f0-9]{64}$/.test(recoverHash||''))throw new Error('Previous VSIX requires absolute path and explicit SHA-256');const old=readVSIX(recoverFile);if(old.sha256!==recoverHash||old.version!==installed)throw new Error('Previous VSIX hash/version does not match installed extension');recovery={...old,path:recoverFile};}
  if(mode==='clean'&&installed&&!recovery)throw new Error('Clean reinstall needs the exact previous VSIX and verified SHA-256 before uninstall. Use safe in-place install or supply a recovery VSIX.');
  if(installed&&!recovery)warnings.push('No exact previous VSIX is available; an in-place failure cannot promise rollback. No clean uninstall will run.');
  // Preflight metadata and cache paths before any host command that mutates state.
  const newReceipt={schemaVersion:1,runtime:'vscode',target,version:next.version,sha256:next.sha256,cachePath};const changes=new Map([[cachePath,next.bytes],[manifestPath,json(newReceipt)]]),reasons=new Map([[manifestPath,'Previous VS Code receipt']]);
  if(recovery){const p=`.pulso/cache/vsix/${recovery.sha256}.vsix`;changes.set(p,recovery.bytes);recovery.cached=path.join(home,p);}
  for(const [p,b] of changes){const old=readOptional(home,p);if(p!==manifestPath&&old&&!old.equals(b))throw new Error(`Cache hash collision: ${p}`);if(old?.equals(b))changes.delete(p);}
  const {originals,backup}=prepareBackups(home,changes,reasons,{runtime:'vscode'});
  return {runtime:'vscode',target:{...target,hostVersion,installedVersion:installed},warnings,actions:[{action:mode==='clean'&&installed?'uninstall-and-install':'install',id:EXTENSION_ID,version:next.version}],backup,execute(){
    if(sha256(fs.readFileSync(packagePath))!==next.sha256)throw new Error('VSIX changed after preflight');if(query()!==installed)throw new Error('Installed extension changed after preflight');
    if(recovery&&sha256(fs.readFileSync(recovery.path))!==recovery.sha256)throw new Error('Recovery VSIX changed after preflight');
    // Cache recovery bytes durably before uninstall. Receipts commit only after native verification.
    const cacheChanges=new Map([...changes].filter(([p])=>p.includes('/cache/'))),cacheOriginals=new Map([...originals].filter(([p])=>cacheChanges.has(p)));applyChanges(home,cacheChanges,cacheOriginals);
    let attempted=false;
    try{if(mode==='clean'&&installed){attempted=true;run(['--uninstall-extension',EXTENSION_ID]);if(query()!==null)throw new Error('Native uninstall did not remove the extension');}
      attempted=true;run(['--install-extension',packagePath,'--force']);if(query()!==next.version)throw new Error('Native installation version verification failed');
      const meta=new Map([...changes].filter(([p])=>!cacheChanges.has(p))),orig=new Map([...originals].filter(([p])=>meta.has(p)));applyChanges(home,meta,orig,{backup});return {status:'installed',version:next.version,nativeSession:'NOT_RUN',backup};
    }catch(error){let state,rollback='not-needed';try{state=query();}catch(e){state='UNKNOWN';rollback=`query-failed: ${e.message}`;}
      if(attempted){if(recovery){try{run(['--install-extension',recovery.cached,'--force']);if(query()!==installed)throw new Error('Recovered version mismatch');rollback='restored';}catch(e){rollback=`incomplete: ${e.message}`;}}else if(installed===null&&state!==null&&state!=='UNKNOWN'){try{run(['--uninstall-extension',EXTENSION_ID]);if(query()!==null)throw new Error('Fresh extension remained installed');rollback='restored';}catch(e){rollback=`incomplete: ${e.message}`;}}else rollback='unavailable; installed state retained';}
      const failure=new Error(`${error.message}; rollback ${rollback}${recovery?`; recovery VSIX retained: ${recovery.cached}`:''}`,{cause:error});failure.backup=error.backup;failure.rollback=rollback;failure.recoveryPath=recovery?.cached;throw failure;
    }
  }};
}
