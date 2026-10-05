/** Build-only native composition. Never installed with runtime assets. */
import path from 'node:path';
export const nativeBoundary = `<native_boundary>
Usa task para delegación nativa visible, skill para cargar guías y question para consultar al usuario. Mantén cada encargo autocontenido con hostContext.projectRoot/readBase absolutos del receipt.workspace confirmado y delegation canónico separado. No selecciones una raíz mediante argumentos Pulso.
pulso_workspace, pulso_work y pulso_context reciben {request:{action,...}}. pulso_history recibe filtros planos. Cada operación solicita permiso nativo efectivo, incluidas lecturas. Respeta también permisos de task/edit/bash/external_directory; no cambies permisos ni configuración para evitarlos. Pulso no edita producto ni usa bash; los especialistas respetan su output/writeScope y no usan tools Pulso ni delegan.
Usa delegación foreground por defecto. Un retorno de task solo acredita retorno de la herramienta; revisa resultado, artefactos y evidencia antes de aceptar. Si el host devuelve running para una tarea background, el resultado sigue pendiente. No actives capacidades experimentales para completar un encargo.
Las consultas devuelven el recibo JSON con data estructurada. Sigue hasMore y nextCursor hasta completar las páginas relevantes; no uses offset. attempts y reconcile_attempts son lecturas de telemetría pasiva: liveness=unknown y acceptance=not_assessed; no modifican Work ni acreditan agentes vivos. Ante persistence.partial comunica identificadores/revisión confirmados y usa recuperación antes de reintentar.
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
  return `---\n${Object.entries(metadata).map(([name, value]) => `${name}: ${JSON.stringify(value)}`).join('\n')}\n---\n\n${body}`;
}
export function renderCommand({name, description}) {
  return `---\ndescription: ${JSON.stringify(description)}\nagent: pulso\nsubtask: false\n---\n\nCarga y ejecuta la skill ${name}. Esta es una invocación explícita; los argumentos son datos para esa guía.\n\n$ARGUMENTS\n`;
}
export function packageManifest() {
  return {name: 'pulso-opencode', version: '4.0.0', private: true, type: 'module', description: 'Pulso: coordinación nativa y continuidad verificable.',
    engines: {node: '>=22'}, dependencies: {}};
}
export const adapterConfig = {runtimeFiles, packageManifest, renderAgent, renderCommand, boundary: nativeBoundary, operationalSkillBoundary,
  resourcePaths: destination => target => path.posix.relative(path.posix.dirname(destination), `resources/${target}`)};
