import {planOpenCode} from './opencode.mjs';
import {planVSCode} from './vscode.mjs';
export {planOpenCode,planVSCode};
export function planInstallation({targets,opencode={},vscode={}}={}){
  if(!Array.isArray(targets)||!targets.length||new Set(targets).size!==targets.length||targets.some(t=>!['opencode','vscode'].includes(t)))throw new Error('Choose one or both distinct targets: opencode, vscode');
  return targets.map(t=>t==='opencode'?planOpenCode(opencode):planVSCode(vscode));
}
export function previewPlans(plans){return plans.map(({runtime,target,actions,warnings,backup})=>({runtime,target,actions,warnings,backup}));}
export function executePlans(plans,{dryRun=false}={}){if(dryRun)return {dryRun:true,plans:previewPlans(plans)};const results=[];for(let i=0;i<plans.length;i++){const p=plans[i];try{results.push({runtime:p.runtime,...p.execute()});}catch(e){results.push({runtime:p.runtime,status:'failed',error:e.message,rollback:e.rollback,backup:e.backup,recoveryPath:e.recoveryPath});for(const rest of plans.slice(i+1))results.push({runtime:rest.runtime,status:'not-started'});return {status:results.some(r=>['installed','configured'].includes(r.status))?'partial':'failed',results};}}return {status:results.some(r=>r.status==='manual-pending')?'manual-pending':'complete',results};}
