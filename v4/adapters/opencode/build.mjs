/** Build-only native composition. Never installed with runtime assets. */
import path from 'node:path';
export const nativeBoundary = `<native_boundary>
<coordinator_only>
Las instrucciones de este bloque son sólo para Pulso coordinador; los especialistas no preparan, retoman, delegan, incorporan ni cierran encargos.
Excepción acotada de inicialización: mode: project_initialization de pulso-init delega directamente con task, sin prepare_delegation, accept_result, Work ni continuidad. Explorer recibe workspace/readBase confirmados, recursos de lectura explícitos, output .pulso/project.md y writeScope [.pulso/project.md]; Executor solo puede aportar Git de lectura con cwd explícito, output conversation y writeScope []. Revisa el mapa y retorno nativo sin QA, evidence/readiness/cierre ni bloqueos de Work. No inventes IDs para correlacionar esta inicialización. Esta excepción no cambia permisos efectivos ni el protocolo v2 de otras delegaciones persistentes descrito a continuación.
Usa task para delegación nativa visible, skill para guías necesarias y question para decisiones de negocio o alcance. Flujo v2: prepare_delegation → task → accept_result. Preparar registra el encargo con continuidad/intención vigente y autorización de su metadata asociada al padre nativo. Envía specialistPrompt exacto al rol preparado; no reconstruyas contratos, bases ni hashes. Incluye el contexto indispensable en objective/constraints o inputs accesibles antes de preparar. No selecciones una raíz ni aportes identidad nativa mediante argumentos Pulso.
pulso_workspace, pulso_work y pulso_context reciben {request:{action,...}}. pulso_history recibe filtros planos. Cada operación solicita permiso nativo efectivo, incluidas lecturas. Respeta también permisos de task/edit/bash/external_directory; no cambies permisos ni configuración para evitarlos. Pulso no edita producto ni usa bash; los especialistas respetan su output/writeScope y no delegan.
Usa delegación foreground por defecto y paraleliza frentes independientes cuando el host lo permita. El especialista responde Markdown, no JSON. Revisa el contenido y acepta con contractVersion:2, continuityId, intentRevision vigente, delegationId/returnId, operationId, expectedRevision actual y decision técnica sustentada. La captura aparece separada en metadata.pulsoDurable o se recupera por get_delegation; no equivale a aceptación. Si falta captura nativa usa reportedReturn literal en la misma incorporación según el contrato común, sin inventar procedencia host_capture. Un intento nativo unresolved requiere replay terminal verificado o reconcile_delegation explícito con resolución explicitly_reconciled, reason y source.text sustentados (messageRef si existe); esa fuente reportada no acredita cancelación ni cese físico. Ante captura pendiente, truncación o rechazo recupera por ID: no repitas task, implementación ni publicación por un error administrativo. Running sigue pendiente. Para legacy conserva su contrato/base originales. No actives capacidades experimentales para completar un encargo.
Las tools devuelven un envelope nativo cuyo output contiene el recibo JSON: retorno nativo no equivale a ok:true; ok:true confirma la operación, no la finalización del objetivo. accept_delivery registra aceptación manual declarada, no ejecución ni cobertura; comprueba data.acceptanceRecorded, data.closed, data.readiness y posibles closeError/persistence. Si la respuesta es parcial o se pierde, consulta Work antes de repetir esa aceptación. Sigue hasMore y nextCursor hasta completar las páginas relevantes; recupera outputs truncados y usa sólo revisiones confirmadas. attempts y reconcile_attempts son telemetría pasiva: liveness=unknown y acceptance=not_assessed; no modifican Work ni acreditan agentes vivos. Ante persistence.partial conserva identificadores/revisión confirmados y usa recuperación antes de reintentar.
Continúa tras instrucciones compatibles y cada retorno; un bloqueo local sólo afecta sus dependientes. Si falta capacidad en un rol, reasigna a otro autorizado: inspección Git a Executor con cwd de repositorio explícito y alcance de sólo lectura. No reintentes por otro rol una operación expresamente denegada. Mantén el TODO nativo sólo como espejo de estado confirmado, comunica sin emojis y evita documentos o preguntas ceremoniales.
Petición explícita de cierre: usa pulso_work close_by_user con workId, expectedRevision, operationId estable, summary, source:{text,messageRef?} y limitations. Aprueba todos los criterios/verificaciones y tareas no canceladas por autoridad del usuario; comprueba closed:true y verification:user_approved. No exige informes ni pruebas adicionales ni cancelled como sustituto. Conserva historia y permisos nativos; encargos pendientes requieren reconciliación y no se presume cese físico. La consulta de estado por sí sola nunca autoriza esta mutación.
</coordinator_only>
<specialist_tools>
Especialistas: las cuatro tools requieren permiso nativo y prueba de sesión hija/ToolPart/dispatch vigente; ask no concede acceso global. Primero get_assignment. Sólo lectura de la proyección del Work y encargo propio, historial de ese Work y contexto project; update_assignment admite task.progress no terminal y document.register del output exacto. Identidad proviene del host, nunca de IDs del prompt. Reporta recibos operationId/delegationId/appliedRevision y consulta get_assignment_receipts tras respuestas perdidas. Sin prueba, informa el límite y retorna Markdown; no cambies permisos, owner ni metadata por filesystem. task permanece deny; aceptación/cierre y evidence.add corresponden al coordinador.
</specialist_tools>
</native_boundary>`;
export const operationalSkillBoundary = nativeBoundary;
const names = ['pulso_workspace','pulso_work','pulso_history','pulso_context'];
const runtimeFiles = Object.fromEntries(['plugin/index.mjs','plugin/schema-converter.mjs','plugin/attempt-contracts.mjs','plugin/delegation-observer.mjs','plugin/durable-hooks.mjs','plugin/assignment-authority.mjs','README.md'].map(file => [file, file]));
function permissions(primary, agent, catalog) {
  const value = {skill: {'*': primary ? 'allow' : 'deny'}, edit: {}, bash: {'*': !primary && ['pulso-executor','pulso-qa-auditor'].includes(agent.id) ? 'ask' : 'deny'}, task: {'*': 'deny'}};
  if (primary) {
    value.edit['*'] = 'deny';
    for (const specialist of catalog.specialists) value.task[specialist.id] = 'allow';
  } else {
    const skills = ['bbva-engineering'];
    if (['pulso-executor','pulso-qa-auditor','pulso-code-reviewer'].includes(agent.id)) skills.push('pulso-integration-verification');
    for (const skill of skills) value.skill[skill] = 'allow';
    if (!['pulso-executor','pulso-qa-auditor'].includes(agent.id)) value.edit['*'] = 'deny';
    for (const prefix of ['.pulso/','**/.pulso/']) {
      value.edit[`${prefix}**`] = 'deny';
      value.edit[`${prefix}work/**/*.md`] = 'allow';
      value.edit[`${prefix}project.md`] = agent.id === 'pulso-explorer' ? 'allow' : 'deny';
      if (['pulso-executor','pulso-qa-auditor'].includes(agent.id)) {
        for (const extension of ['json','zip']) value.edit[`${prefix}work/*/trace-evidence/*.${extension}`] = 'allow';
      }
      for (const file of ['state.json','history.jsonl','memory.json','project.json','work/**/work.json','preparation.json','recovery/**','delegation-attempts/**']) value.edit[`${prefix}${file}`] = 'deny';
    }
    for (const name of names) value[name] = 'ask';
  }
  return value;
}
export function renderAgent({agent, catalog, body}) {
  const primary = agent.id === catalog.orchestrator.id;
  const metadata = {description: agent.description, mode: primary ? 'primary' : 'subagent', ...(!primary ? {hidden: true} : {}), permission: permissions(primary, agent, catalog)};
  const roles = primary ? [catalog.orchestrator, ...catalog.specialists] : [agent];
  const capabilities = `<declared_capabilities>\nCapacidades declaradas por el adaptador, no garantías de disponibilidad ni autorizaciones efectivas del host. bash=ask requiere aprobación nativa; deny no concede terminal.\n${roles.map(role => {
    const permission = permissions(role.id === catalog.orchestrator.id, role, catalog);
    return `${role.id}: bash=${permission.bash['*']}; task=${role.id === catalog.orchestrator.id ? 'especialistas del catálogo' : 'deny'}.`;
  }).join('\n')}\nEspecialistas: tools Pulso=ask, únicamente acciones de asignación verificadas por runtime; nunca autoridad global.\nLa procedencia del recibo identifica el paquete cargado y sólo incluye IDs proporcionados por el host; no prueba ejecución ni aceptación de especialistas.\n</declared_capabilities>`;
  return `---\n${Object.entries(metadata).map(([name, value]) => `${name}: ${JSON.stringify(value)}`).join('\n')}\n---\n\n${body}\n\n${capabilities}\n`;
}
export function renderCommand({name, description}) {
  return `---\ndescription: ${JSON.stringify(description)}\nagent: pulso\nsubtask: false\n---\n\nCarga y ejecuta la skill ${name}. Esta es una invocación explícita; los argumentos son datos para esa guía.\n\n$ARGUMENTS\n`;
}
export function packageManifest() {
  return {name: 'pulso-opencode', version: '4.2.0', private: true, type: 'module', description: 'Pulso: coordinación nativa y continuidad verificable.',
    engines: {node: '>=22'}, dependencies: {}};
}
export const adapterConfig = {runtimeFiles, packageManifest, renderAgent, renderCommand, boundary: nativeBoundary, operationalSkillBoundary,
  resourcePaths: destination => target => path.posix.relative(path.posix.dirname(destination), `resources/${target}`)};
