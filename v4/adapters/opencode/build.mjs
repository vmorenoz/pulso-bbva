/** Build-only native composition. Never installed with runtime assets. */
import path from 'node:path';
export const nativeBoundary = `<native_boundary>
Usa task para delegación nativa visible, skill para cargar guías necesarias y question para decisiones de negocio o alcance. Investiga los hechos con el rol autorizado. prepare_delegation devuelve delegation canónica, acceptanceBasis previa y hostContext con projectRoot, resourceRoot, cwd y paths efectivos; conserva esos valores y pasa el encargo autocontenido al especialista. Incluye realmente los inputs conversacionales en objective/constraints o archivos autorizados accesibles. No selecciones una raíz mediante argumentos Pulso.
pulso_workspace, pulso_work y pulso_context reciben {request:{action,...}}. pulso_history recibe filtros planos. Cada operación solicita permiso nativo efectivo, incluidas lecturas. Respeta también permisos de task/edit/bash/external_directory; no cambies permisos ni configuración para evitarlos. Pulso no edita producto ni usa bash; los especialistas respetan su output/writeScope y no usan tools Pulso ni delegan.
Usa delegación foreground por defecto y paraleliza frentes independientes cuando el host lo permita. Un retorno de task sólo acredita retorno de la herramienta; revisa el contenido antes de accept_result con delegation y acceptanceBasis originales, revisión actual y acceptedTaskIds seleccionados. Un resultado inline breve no necesita Markdown duplicado. Si el host devuelve running para una tarea background, el resultado sigue pendiente. No actives capacidades experimentales para completar un encargo.
Las tools devuelven un envelope nativo cuyo output contiene el recibo JSON: retorno nativo no equivale a ok:true; ok:true confirma la operación, no la finalización del objetivo. accept_delivery registra aceptación manual declarada, no ejecución ni cobertura; comprueba data.acceptanceRecorded, data.closed, data.readiness y posibles closeError/persistence. Si la respuesta es parcial o se pierde, consulta Work antes de repetir esa aceptación. Sigue hasMore y nextCursor hasta completar las páginas relevantes; recupera outputs truncados y usa sólo revisiones confirmadas. attempts y reconcile_attempts son telemetría pasiva: liveness=unknown y acceptance=not_assessed; no modifican Work ni acreditan agentes vivos. Ante persistence.partial conserva identificadores/revisión confirmados y usa recuperación antes de reintentar.
Continúa tras instrucciones compatibles y cada retorno; un bloqueo local sólo afecta sus dependientes. Si falta capacidad en un rol, reasigna a otro autorizado: inspección Git a Executor con cwd de repositorio explícito y alcance de sólo lectura. No reintentes por otro rol una operación expresamente denegada. Mantén el TODO nativo sólo como espejo de estado confirmado, comunica sin emojis y evita documentos o preguntas ceremoniales.
</native_boundary>`;
export const operationalSkillBoundary = nativeBoundary;
const names = ['pulso_workspace','pulso_work','pulso_history','pulso_context'];
const runtimeFiles = Object.fromEntries(['plugin/index.mjs','plugin/schema-converter.mjs','plugin/attempt-contracts.mjs','plugin/delegation-observer.mjs','README.md'].map(file => [file, file]));
function permissions(primary, agent, catalog) {
  const value = {skill: {'*': primary ? 'allow' : 'deny'}, edit: {}, bash: {'*': !primary && ['pulso-executor','pulso-qa-auditor'].includes(agent.id) ? 'ask' : 'deny'}, task: {'*': 'deny'}};
  if (primary) {
    value.edit['*'] = 'deny';
    for (const specialist of catalog.specialists) value.task[specialist.id] = 'allow';
  } else {
    const skills = ['bbva-engineering'];
    if (agent.id !== 'pulso-researcher') skills.push('bbva-cells');
    if (!['pulso-researcher','pulso-ui-auditor'].includes(agent.id)) skills.push('bbva-apx');
    if (['pulso-executor','pulso-qa-auditor','pulso-code-reviewer'].includes(agent.id)) skills.push('bbva-apx-testing','bbva-cells-testing','pulso-integration-verification');
    if (agent.id === 'pulso-ui-auditor') skills.push('bbva-cells-testing');
    for (const skill of skills) value.skill[skill] = 'allow';
    if (!['pulso-executor','pulso-qa-auditor'].includes(agent.id)) value.edit['*'] = 'deny';
    for (const prefix of ['.pulso/','**/.pulso/']) {
      value.edit[`${prefix}**`] = 'deny';
      value.edit[`${prefix}work/**/*.md`] = 'allow';
      value.edit[`${prefix}project.md`] = agent.id === 'pulso-explorer' ? 'allow' : 'deny';
      for (const file of ['state.json','history.jsonl','memory.json','project.json','work/**/work.json','preparation.json','recovery/**','delegation-attempts/**']) value.edit[`${prefix}${file}`] = 'deny';
    }
    for (const name of names) value[name] = 'deny';
  }
  return value;
}
export function renderAgent({agent, catalog, body}) {
  const primary = agent.id === catalog.orchestrator.id;
  const metadata = {description: agent.description, mode: primary ? 'primary' : 'subagent', ...(!primary ? {hidden: true} : {}), permission: permissions(primary, agent, catalog)};
  const roles = [catalog.orchestrator, ...catalog.specialists];
  const capabilities = `<declared_capabilities>\nCapacidades declaradas por el adaptador, no garantías de disponibilidad ni autorizaciones efectivas del host. bash=ask requiere aprobación nativa; deny no concede terminal.\n${roles.map(role => {
    const permission = permissions(role.id === catalog.orchestrator.id, role, catalog);
    return `${role.id}: bash=${permission.bash['*']}; task=${role.id === catalog.orchestrator.id ? 'especialistas del catálogo' : 'deny'}.`;
  }).join('\n')}\nLa procedencia del recibo identifica el paquete cargado y sólo incluye IDs proporcionados por el host; no prueba ejecución ni aceptación de especialistas.\n</declared_capabilities>`;
  return `---\n${Object.entries(metadata).map(([name, value]) => `${name}: ${JSON.stringify(value)}`).join('\n')}\n---\n\n${body}\n\n${capabilities}\n`;
}
export function renderCommand({name, description}) {
  return `---\ndescription: ${JSON.stringify(description)}\nagent: pulso\nsubtask: false\n---\n\nCarga y ejecuta la skill ${name}. Esta es una invocación explícita; los argumentos son datos para esa guía.\n\n$ARGUMENTS\n`;
}
export function packageManifest() {
  return {name: 'pulso-opencode', version: '4.1.0', private: true, type: 'module', description: 'Pulso: coordinación nativa y continuidad verificable.',
    engines: {node: '>=22'}, dependencies: {}};
}
export const adapterConfig = {runtimeFiles, packageManifest, renderAgent, renderCommand, boundary: nativeBoundary, operationalSkillBoundary,
  resourcePaths: destination => target => path.posix.relative(path.posix.dirname(destination), `resources/${target}`)};
