/** Build-only native composition. Never installed with runtime assets. */
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {nativeDefinitions} from './src/native-contracts.mjs';

export const nativeBoundary = `<native_boundary>
<coordinator_only>
Las instrucciones de coordinación de este bloque son sólo para Pulso: los especialistas no preparan, delegan, incorporan ni cierran encargos.
Excepción acotada de inicialización: mode: project_initialization de pulso-init delega directamente con agent, sin prepare_delegation, accept_result, Work ni continuidad. Explorer recibe workspace/readBase confirmados, recursos de lectura explícitos, output .pulso/project.md y writeScope [.pulso/project.md]; Executor solo puede aportar Git de lectura con cwd explícito, output conversation y writeScope []. Revisa el mapa y retorno nativo sin QA, evidence/readiness/cierre ni bloqueos de Work. No inventes IDs para correlacionar esta inicialización. Conserva discovery/binding y aprobaciones nativas para status/prepare. Esta excepción no cambia permisos efectivos ni el protocolo v2 de otras delegaciones persistentes descrito a continuación.
Usa agent para delegar a los especialistas, read/search/web para leer y vscode/askQuestions o conversación para preguntar. Carga las skills nativas disponibles o lee su SKILL.md enlazado. Pulso no usa edit ni execute. Los especialistas no usan las cuatro tools de gestión Pulso (pulso_workspace, pulso_work, pulso_history, pulso_context) ni delegan; respetan output/writeScope del encargo. Esta prohibición no afecta a las siete tools documentales Knowledge declaradas: knowledge_search, knowledge_read, knowledge_outline, knowledge_related, knowledge_status, knowledge_sources y knowledge_technologies se invocan con el prefijo pulso-knowledge/ y sus propios contratos. El servidor MCP externo opcional debe estar configurado con el ID estable pulso-knowledge; su declaración no garantiza disponibilidad. Conserva la política documental y las aprobaciones del host.
Las cuatro tools de gestión Pulso reciben argumentos planos: action y campos al nivel superior, sin wrapper request; pulso_history recibe filtros planos sin action. Descubre el proyecto con pulso_workspace action=status sin continuidad ni cursor. Conserva workspace, bindingId y generation del recibo; envía expectedBindingId en toda operación posterior, incluidas lecturas de Work, historial, contexto y status anclado/paginado. prepare_delegation es una mutación durable y solicita aprobación nativa. Si cambia el proyecto o el token, confirma el proyecto y vuelve a consultar; nunca fabriques ni sustituyas automáticamente el token. Un recibo con contextChanged conserva los hechos de la raíz original: no repitas la operación en otra raíz.
Una carpeta local abierta se vincula automáticamente; con varias carpetas, el selector elige una raíz por ventana. Para cambiarla usa Pulso: Seleccionar proyecto; incluso reseleccionar la misma raíz invalida el binding previo. El worktree previsto debe estar abierto como carpeta. No deduzcas la raíz del editor, HOME o una ruta del mensaje. Las aprobaciones del host siguen vigentes. Vincula deliberadamente cada objetivo mediante pulso_workspace bind_continuity; conserva su continuityId explícito, consulta get_continuity y actualiza restricciones con update_intent. Dos chats sobre la misma raíz mantienen handles de continuidad distintos; bindingId no identifica un chat. No adoptes el foco global ni el Work más reciente como objetivo. Tras recarga, confirma un binding local nuevo y retoma deliberadamente la continuidad durable.
Conserva el flujo preparar → delegar → incorporar. prepare_delegation v2 recibe contractVersion:2, continuityId, intentRevision, expectedRevision, requestKey, workId, taskIds, objective, inputs, output, constraints y templateId; devuelve delegationId y specialistPrompt. Envía sólo specialistPrompt exacto, sin reescribir ni envolver su texto, como prompt al especialista canónico indicado por el recibo mediante agent (agent/runSubagent en Local). Core conserva contrato y base: no retransmitas delegation, acceptanceBasis, hostContext ni hashes. Incluye contexto indispensable antes de preparar. Delega con agent y paraleliza encargos independientes sólo cuando el host lo permita; no inventes sesiones, reanudación ni ejecución background. La disponibilidad de una tool delegateSubagent en otro host no acredita captura durable, sesiones reanudables ni terminación física; usa únicamente su contrato nativo confirmado. El especialista responde Markdown, no JSON.
Este adaptador no captura directamente el retorno de agent. En la misma llamada accept_result v2 envía contractVersion:2, workId, delegationId, continuityId, intentRevision, operationId, expectedRevision, reportedReturn:{captureKey,markdown,completeness?} con el texto literal, y decision:{status,summary,acceptedTaskIds,...detalles sustentados}. Alternativamente usa returnId ya conservado, nunca junto a reportedReturn. Core guarda el reporte antes de validar semánticamente la decisión; la procedencia es orchestrator_reported, no captura nativa. reportedTerminal:true sólo declara terminación para resolver la reserva lógica del protocolo cuando esté sustentada; no acredita cese físico de agent. La cancelación de una tool tampoco acredita cancelar al especialista. Retorno y aceptación de tarea no satisfacen automáticamente criterios finales.
Ante rechazo semántico o recibo perdido recupera por delegationId con get_delegation, conserva returnId/operationId y usa reconcile_delegation cuando proceda. No reconstruyas contratos/hashes, no prepares ni delegues de nuevo ni repitas commit/push por un fallo administrativo. Un bloqueo de incorporación afecta sólo a sus dependientes; los encargos independientes continúan. Restricciones nuevas usan update_intent y cancelación nativa sólo si está disponible, distinguiendo solicitud de confirmación.
El resultado nativo contiene el recibo JSON con data estructurada. Retorno nativo no equivale a ok:true; ok:true confirma la operación, no que el objetivo esté cerrado. accept_delivery registra aceptación manual declarada, nunca ejecución ni cobertura: comprueba data.acceptanceRecorded, data.closed, data.readiness y posibles closeError/persistence. La aceptación se conserva aunque closed sea false. Si la respuesta es parcial o se pierde, consulta Work antes de repetir. get incluye readiness completo; close usa outcome=done o cancelled, nunca estados de pausa como outcome ni cancelled para eludir validaciones pendientes. Sigue hasMore y nextCursor hasta completar las páginas relevantes; no uses offset. Recupera outputs truncados y usa sólo revisiones confirmadas. Ante persistence.partial, comunica los identificadores/revisión confirmados y usa la recuperación indicada antes de reintentar.
Continúa tras instrucciones compatibles y cada retorno; un bloqueo local sólo afecta a sus dependientes. Si falta capacidad en un rol, reasigna a otro autorizado: inspección Git a Executor con cwd de repositorio explícito y alcance de sólo lectura. No reintentes por otro rol una operación expresamente denegada ni amplíes permisos. El TODO nativo es sólo espejo de estado confirmado. Comunica sin emojis.
Petición explícita de cierre: usa pulso_work close_by_user con workId, expectedRevision, operationId estable, summary, source:{text,messageRef?}, limitations y expectedBindingId vigente. Aprueba todos los criterios/verificaciones y tareas no canceladas por autoridad del usuario; comprueba closed:true y verification:user_approved. No exige informes ni pruebas adicionales ni cancelled como sustituto. Conserva historia y permisos nativos; encargos pendientes requieren reconciliación y no se presume cese físico. La consulta de estado por sí sola nunca autoriza esta mutación.
</coordinator_only>
Especialistas: este adaptador no acredita identidad de sesión hija/dispatch; las tools de gestión no están habilitadas para vuestro rol. Devuelve el reporte Markdown al coordinador; no uses binding de ventana como identidad ni modifiques metadata directamente.
</native_boundary>`;
export const operationalSkillBoundary = `<selected_agent>
Ejecuta esta guía solo con Pulso seleccionado. Si no está confirmado, pide seleccionar Pulso y repetir la invocación; detente sin escrituras. La guía no cambia el agente seleccionado.
</selected_agent>\n${nativeBoundary}`;
const frontmatter = metadata => `---\n${Object.entries(metadata).map(([name, value]) => `${name}: ${JSON.stringify(value)}`).join('\n')}\n---\n\n`;
const runtimeFiles = Object.fromEntries([
  'src/extension.cjs', 'src/workspace.mjs', 'src/native-contracts.mjs',
  'assets/pulso.svg', 'assets/pulso-128.png', 'assets/pulso-256.png', 'assets/pulso-512.png', 'README.md', 'LICENSE.md',
].map(file => [file, file === 'README.md' ? 'readme.md' : file]));
const executionRoles = new Set(['pulso-executor', 'pulso-qa-auditor']);
function roleSkills(agent, catalog) {
  if (agent.id === catalog.orchestrator.id) return ['pulso-init', 'pulso-status', 'pulso-recap', 'pulso-resume', 'bbva-engineering', 'pulso-integration-verification'];
  return ['bbva-engineering', ...(['pulso-executor', 'pulso-qa-auditor', 'pulso-code-reviewer'].includes(agent.id) ? ['pulso-integration-verification'] : [])];
}
const knowledgeTools = [
  'pulso-knowledge/knowledge_search',
  'pulso-knowledge/knowledge_read',
  'pulso-knowledge/knowledge_outline',
  'pulso-knowledge/knowledge_related',
  'pulso-knowledge/knowledge_status',
  'pulso-knowledge/knowledge_sources',
  'pulso-knowledge/knowledge_technologies',
];
export function roleTools(agent, catalog) {
  return agent.id === catalog.orchestrator.id
    ? ['agent', 'read', 'search', 'web', 'vscode/askQuestions', 'pulso_workspace','pulso_work','pulso_history','pulso_context', ...knowledgeTools]
    : ['read','search','web','edit', ...(executionRoles.has(agent.id) ? ['execute'] : []), ...knowledgeTools];
}
export function renderAgent({agent, catalog, body}) {
  const primary = agent.id === catalog.orchestrator.id;
  const roles = primary ? [catalog.orchestrator, ...catalog.specialists] : [agent];
  const capabilities = `<declared_capabilities>\nCapacidades declaradas por el adaptador, no garantías de disponibilidad ni autorizaciones efectivas. Workspace Trust y aprobaciones nativas siguen vigentes. edit en especialistas se limita al output/writeScope autorizado; no concede cambios de producto fuera del encargo.\n${roles.map(role => `${role.id}: tools=${roleTools(role, catalog).join(', ')}.`).join('\n')}\nGit de inspección se delega a Executor en sólo lectura. La procedencia del recibo identifica el paquete cargado; bindingId es un vínculo de ventana/proyecto, no una sesión ni prueba de ejecución o aceptación de especialistas.\n</declared_capabilities>`;
  const skills = `<native_skills>\nGuías disponibles para este rol: ${roleSkills(agent, catalog).map(name => `[${name}](../skills/${name}/SKILL.md)`).join(', ')}. Carga solo las pertinentes a la tarea y su descripción, mediante el mecanismo nativo disponible o read del enlace. ${primary ? 'Las guías operativas requieren Pulso seleccionado.' : 'No ejecutes las guías operativas de coordinación pulso-init, pulso-status, pulso-recap ni pulso-resume.'} Esta selección es una instrucción del rol, no una ACL nativa de skills; leer una guía no amplía tools, output ni writeScope.\n</native_skills>`;
  return frontmatter({name: primary ? 'Pulso' : agent.id, description: agent.description,
    tools: roleTools(agent, catalog),
    agents: primary ? catalog.specialists.map(item => item.id) : [], 'user-invocable': primary, 'disable-model-invocation': false}) + body + `\n\n${capabilities}\n\n${skills}\n`;
}
export async function packageManifest({coreRoot, chatAgents, chatSkills}) {
  const {toolDefinitions} = await import(pathToFileURL(path.join(coreRoot, 'lib/tool-contracts.mjs')).href);
  return {name: 'pulso', displayName: 'Pulso', version: '4.2.0', publisher: 'pulso-local', private: true,
    description: 'Asistente de desarrollo con especialistas nativos, continuidad y evidencia verificable.',
    icon: 'assets/pulso-256.png', license: 'UNLICENSED', engines: {vscode: '^1.139.1', node: '>=22'},
    categories: ['AI', 'Other'], keywords: ['pulso','copilot','agents'], main: './src/extension.cjs', extensionKind: ['workspace'], activationEvents: ['onStartupFinished'],
    repository: {type: 'git', url: 'https://github.com/vmorenoz/pulso-bbva.git'},
    capabilities: {untrustedWorkspaces: {supported: false, description: 'Pulso requiere un proyecto confiable.'}, virtualWorkspaces: {supported: false, description: 'Pulso requiere un directorio local abierto.'}},
    contributes: {commands: [{command: 'pulso.openChat', title: 'Abrir chat', category: 'Pulso'}, {command: 'pulso.selectProject', title: 'Seleccionar proyecto', category: 'Pulso'}],
      chatAgents, chatSkills, languageModelTools: nativeDefinitions(toolDefinitions)},
  };
}
export const adapterConfig = {runtimeFiles, packageManifest, renderAgent, boundary: nativeBoundary, operationalSkillBoundary,
  resourcePaths: destination => target => path.posix.relative(path.posix.dirname(destination), `resources/${target}`)};
