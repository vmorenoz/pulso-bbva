/** Build-only native composition. Never installed with runtime assets. */
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {nativeDefinitions} from './src/native-contracts.mjs';

export const nativeBoundary = `<native_boundary>
Usa agent para delegar a los especialistas, read/search/web para leer y vscode/askQuestions o conversación para preguntar. Carga las skills nativas disponibles o lee su SKILL.md enlazado. Pulso no usa edit ni execute. Los especialistas no usan tools Pulso ni delegan; respetan output/writeScope del encargo.
Todas las tools Pulso reciben argumentos planos: action y campos al nivel superior, sin wrapper request; pulso_history recibe filtros planos sin action. Consulta pulso_workspace con action=status antes de cualquier escritura. Conserva workspace y bindingId del recibo para el objetivo previsto; envía expectedBindingId en cada mutación, incluidas pulso_workspace.prepare, accept_result, accept_delivery y preferencias de scope=user. prepare_delegation es lectura. Si cambia el proyecto o el token, detente, confirma el proyecto con el usuario y vuelve a consultar; nunca fabriques ni sustituyas automáticamente el token.
Una carpeta local abierta se vincula automáticamente; con varias carpetas, el selector elige el proyecto de esta ventana. Para cambiarlo usa Pulso: Seleccionar proyecto. El worktree previsto debe estar abierto como carpeta. No deduzcas la raíz del editor, HOME o una ruta del mensaje. Las aprobaciones del host siguen vigentes. prepare_delegation devuelve delegation canónica, acceptanceBasis previa y hostContext con projectRoot, resourceRoot, cwd y paths efectivos desde el contexto confiable. Conserva estos valores fuera del JSON canónico y pasa el encargo autocontenido al especialista. Incluye inputs conversacionales reales en objective/constraints o archivos autorizados accesibles.
Delega con agent y paraleliza sólo cuando el host lo permita de forma nativa; no inventes sesiones, reanudación ni ejecución background. Un retorno nativo no acredita éxito: revisa el resultado y sus artefactos antes de accept_result con delegation y acceptanceBasis originales, revisión actual y acceptedTaskIds seleccionados. Un resultado inline breve no requiere Markdown duplicado. La aceptación del resultado no satisface automáticamente criterios finales.
El resultado nativo contiene el recibo JSON con data estructurada. Retorno nativo no equivale a ok:true; ok:true confirma la operación, no que el objetivo esté cerrado. accept_delivery registra aceptación manual declarada, nunca ejecución ni cobertura: comprueba data.acceptanceRecorded, data.closed, data.readiness y posibles closeError/persistence. La aceptación se conserva aunque closed sea false. Si la respuesta es parcial o se pierde, consulta Work antes de repetir. get incluye readiness completo; close usa outcome=done o cancelled, nunca estados de pausa como outcome ni cancelled para eludir validaciones pendientes. Sigue hasMore y nextCursor hasta completar las páginas relevantes; no uses offset. Recupera outputs truncados y usa sólo revisiones confirmadas. Ante persistence.partial, comunica los identificadores/revisión confirmados y usa la recuperación indicada antes de reintentar.
Continúa tras instrucciones compatibles y cada retorno; un bloqueo local sólo afecta a sus dependientes. Si falta capacidad en un rol, reasigna a otro autorizado: inspección Git a Executor con cwd de repositorio explícito y alcance de sólo lectura. No reintentes por otro rol una operación expresamente denegada ni amplíes permisos. El TODO nativo es sólo espejo de estado confirmado. Comunica sin emojis.
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
export function roleTools(agent, catalog) {
  return agent.id === catalog.orchestrator.id
    ? ['agent', 'read', 'search', 'web', 'vscode/askQuestions', 'pulso_workspace','pulso_work','pulso_history','pulso_context']
    : ['read','search','web','edit', ...(executionRoles.has(agent.id) ? ['execute'] : [])];
}
export function renderAgent({agent, catalog, body}) {
  const primary = agent.id === catalog.orchestrator.id;
  const capabilities = `<declared_capabilities>\nCapacidades declaradas por el adaptador, no garantías de disponibilidad ni autorizaciones efectivas. Workspace Trust y aprobaciones nativas siguen vigentes. edit en especialistas se limita al output/writeScope autorizado; no concede cambios de producto fuera del encargo.\n${[catalog.orchestrator, ...catalog.specialists].map(role => `${role.id}: tools=${roleTools(role, catalog).join(', ')}.`).join('\n')}\nGit de inspección se delega a Executor en sólo lectura. La procedencia del recibo identifica el paquete cargado; bindingId es un vínculo de ventana/proyecto, no una sesión ni prueba de ejecución o aceptación de especialistas.\n</declared_capabilities>`;
  return frontmatter({name: primary ? 'Pulso' : agent.id, description: agent.description,
    tools: roleTools(agent, catalog),
    agents: primary ? catalog.specialists.map(item => item.id) : [], 'user-invocable': primary, 'disable-model-invocation': false}) + body + `\n\n${capabilities}\n`;
}
export async function packageManifest({coreRoot, chatAgents, chatSkills}) {
  const {toolDefinitions} = await import(pathToFileURL(path.join(coreRoot, 'lib/tool-contracts.mjs')).href);
  return {name: 'pulso', displayName: 'Pulso', version: '4.1.0', publisher: 'pulso-local', private: true,
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
