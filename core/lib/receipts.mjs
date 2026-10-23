import {assertSchema} from './schema.mjs';

/** Forward only the documented recovery variants, never arbitrary error payloads. */
export function recoveryDetails(error){
  if(!error?.recovery)return {};
  try{
    const value=structuredClone(error.recovery);
    assertSchema('tool-error',{code:error.code||'OPERATION_FAILED',message:'',recovery:value});
    return {recovery:value};
  }catch{return {};}
}

export function workReceipt(work,{operation='work.apply',changes=[]}={}) {
  return assertSchema('work-receipt',{
    schemaVersion:1,
    operation,
    workId:work.id,
    revision:work.revision,
    status:work.status,
    ...(work.closure?.mode==='user_requested'?{closed:true,mode:'user_requested',authority:'user',verification:'user_approved',approval:work.closure.userRequest.approval,source:work.closure.userRequest.source,operationId:work.closure.userRequest.operationId}:{}),
    progress:{done:work.tasks.filter(task=>task.status==='done').length,total:work.tasks.length},
    changes:changes.slice(0,12),
    nextAction:work.nextAction
  });
}

export function formatReceipt(receipt) {
  const changes=receipt.changes.length?receipt.changes.join('; '):'sin cambios adicionales';
  const lines=[`${receipt.workId} ${receipt.operation==='work.create'?'creado':'actualizado'} · revisión ${receipt.revision}`,changes];
  if(receipt.verification==='user_approved')lines.push('Revisado y aprobado por el usuario; sin verificaciones pendientes. Autoridad de aprobación: usuario, no ejecución de tests.');
  if(receipt.readiness&&!receipt.readiness.ready)lines.push(`${receipt.closed||['done','cancelled'].includes(receipt.status)?'Diagnóstico técnico conservado':'Cierre pendiente'}: ${receipt.readiness.issues.length} impedimentos; consultar data.readiness.issues.`);
  if(receipt.nextAction)lines.push(`Siguiente paso: ${receipt.nextAction}`);
  return lines.join('\n');
}
