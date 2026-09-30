import {assertSchema} from './schema.mjs';

export function workReceipt(work,{operation='work.apply',changes=[]}={}) {
  return assertSchema('work-receipt',{
    schemaVersion:1,
    operation,
    workId:work.id,
    revision:work.revision,
    status:work.status,
    progress:{done:work.tasks.filter(task=>task.status==='done').length,total:work.tasks.length},
    changes:changes.slice(0,12),
    nextAction:work.nextAction
  });
}

export function formatReceipt(receipt) {
  const changes=receipt.changes.length?receipt.changes.join('; '):'sin cambios adicionales';
  const lines=[`✓ ${receipt.workId} ${receipt.operation==='work.create'?'creado':'actualizado'} · revisión ${receipt.revision}`,changes];
  if(receipt.nextAction)lines.push(`Siguiente paso: ${receipt.nextAction}`);
  return lines.join('\n');
}
