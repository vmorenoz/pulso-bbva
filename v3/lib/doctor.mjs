import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {readJSON,safePath,sha256,exists} from './fs.mjs';
import {status} from './artifacts.mjs';
export function doctor(root,{probeVersions=true}={}) {
  const findings=[];let m=null,kind='workspace';
  if(exists(root,'.pulso/installation.json')){
    try{m=readJSON(root,'.pulso/installation.json');kind=m.scope==='global'?'global-installation':'legacy-installation';}catch(e){return {installation:'FAIL',findings:[e.message],nativeSession:'NOT_RUN'};}
    for(const [file,hash] of Object.entries(m.files||{})){
      try {if(sha256(fs.readFileSync(safePath(root,file)))!==hash)findings.push(`Archivo instalado modificado: ${file}`);}
      catch(e){findings.push(`Archivo no disponible: ${file}: ${e.message}`);}
    }
  }else try{status(root);}catch(e){findings.push(e.message);}
  const versions={node:process.version};
  if(probeVersions)for(const [binary,args] of [['opencode',['--version']],['code',['--version']]]){
    const r=spawnSync(binary,args,{cwd:root,encoding:'utf8',timeout:8000,windowsHide:true});
    versions[binary]=r.status===0?r.stdout.trim().split('\n')[0]:'NOT_DETECTED';
  }
  const old=[];
  if(kind==='workspace')for(const dir of ['.opencode/agents','.github/agents'])if(exists(root,dir))for(const file of fs.readdirSync(safePath(root,dir))){
    const relative=`${dir}/${file}`;if(/pulso/i.test(file))old.push(relative);
  }
  return {installation:findings.length?'REVIEW_REQUIRED':'PASS',kind,version:m?.version??null,runtimes:m?.runtimes??[],vscodeHarness:m?.vscodeHarness??null,versions,findings,possibleLegacyAgents:old,nativeSession:'NOT_RUN',permissions:'INHERITED_NOT_INSPECTED',note:'La existencia o lista de agentes no demuestra cuál está activo. Confirmar agente, herramientas y delegación en la sesión real.'};
}
