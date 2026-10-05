/** Build-only native composition. Never installed with runtime assets. */
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {nativeDefinitions} from './src/native-contracts.mjs';

export const nativeBoundary = `<native_boundary>
Usa agent para delegar a los especialistas, read/search/web para leer y vscode/askQuestions o conversación para preguntar. Carga las skills nativas disponibles o lee su SKILL.md enlazado. Pulso no usa edit ni execute. Los especialistas no usan tools Pulso ni delegan; respetan output/writeScope del encargo.
Las tools Pulso reciben argumentos planos: action y campos al nivel superior, sin request. Consulta pulso_workspace con action=status antes de cualquier escritura. Conserva workspace y bindingId del recibo para el objetivo previsto; envía expectedBindingId en cada mutación, incluidas prepare y preferencias de scope=user. Si cambia el proyecto o el token, detente, confirma el proyecto con el usuario y vuelve a consultar; nunca fabriques ni sustituyas automáticamente el token.
Una carpeta local abierta se vincula automáticamente; con varias carpetas, el selector elige el proyecto de esta ventana. Para cambiarlo usa Pulso: Seleccionar proyecto. El worktree previsto debe estar abierto como carpeta. No deduzcas la raíz del editor, HOME o una ruta del mensaje. Las aprobaciones del host siguen vigentes. Copia receipt.workspace como projectRoot y readBase absolutos en hostContext, fuera del JSON canónico de cada delegación persistente.
Las consultas comparten data estructurada. Sigue hasMore y nextCursor hasta completar las páginas relevantes; no uses offset. Ante persistence.partial, comunica los identificadores/revisión confirmados y usa la recuperación indicada antes de reintentar. Una respuesta de especialista se revisa con sus artefactos y evidencia antes de consolidar.
</native_boundary>`;
export const operationalSkillBoundary = `<selected_agent>
Ejecuta esta guía solo con Pulso seleccionado. Si no está confirmado, pide seleccionar Pulso y repetir la invocación; detente sin escrituras. La guía no cambia el agente seleccionado.
</selected_agent>\n${nativeBoundary}`;
const frontmatter = metadata => `---\n${Object.entries(metadata).map(([name, value]) => `${name}: ${JSON.stringify(value)}`).join('\n')}\n---\n\n`;
const runtimeFiles = Object.fromEntries([
  'src/extension.cjs', 'src/workspace.mjs', 'src/native-contracts.mjs',
  'assets/pulso.svg', 'assets/pulso-128.png', 'assets/pulso-256.png', 'assets/pulso-512.png', 'README.md', 'LICENSE.md',
].map(file => [file, file === 'README.md' ? 'readme.md' : file]));
export function renderAgent({agent, catalog, body}) {
  const primary = agent.id === catalog.orchestrator.id;
  const executable = ['pulso-explorer','pulso-executor','pulso-qa-auditor','pulso-security-auditor','pulso-code-reviewer','pulso-ui-auditor'].includes(agent.id);
  return frontmatter({name: primary ? 'Pulso' : agent.id, description: agent.description,
    tools: primary ? ['agent', 'read', 'search', 'web', 'vscode/askQuestions', 'pulso_workspace','pulso_work','pulso_history','pulso_context'] : ['read','search','web','edit', ...(executable ? ['execute'] : [])],
    agents: primary ? catalog.specialists.map(item => item.id) : [], 'user-invocable': primary, 'disable-model-invocation': false}) + body;
}
export async function packageManifest({coreRoot, chatAgents, chatSkills}) {
  const {toolDefinitions} = await import(pathToFileURL(path.join(coreRoot, 'lib/tool-contracts.mjs')).href);
  return {name: 'pulso', displayName: 'Pulso', version: '4.0.0', publisher: 'pulso-local', private: true,
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
