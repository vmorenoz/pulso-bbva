import {planOpenCode} from './opencode.mjs';
export {planOpenCode};
export function planInstallation(options={}){
  if(Object.keys(options).some(key=>key!=='opencode'))throw new Error('Only OpenCode installation is supported');
  return [planOpenCode(options.opencode)];
}
export function previewPlans(plans){return plans.map(({runtime,target,actions,warnings,backup})=>({runtime,target,actions,warnings,backup}));}
export function executePlans(plans,{dryRun=false}={}){
  if(dryRun)return {dryRun:true,plans:previewPlans(plans)};
  const results=[];
  for(const p of plans){
    try{results.push({runtime:p.runtime,...p.execute()});}
    catch(e){results.push({runtime:p.runtime,status:'failed',error:e.message,rollback:e.rollback,backup:e.backup});return {status:'failed',results};}
  }
  return {status:'complete',results};
}
