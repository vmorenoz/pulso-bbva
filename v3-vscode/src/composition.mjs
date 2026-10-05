import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const extensionRoot = fileURLToPath(new URL('../', import.meta.url));
export const sourceRoot = fileURLToPath(new URL('../../v3-opencode-v1/', import.meta.url));
export const runtimeModules = ['fs', 'identity', 'memory', 'receipts', 'schema', 'work-mutations', 'workspace', 'artifacts', 'delegation-observer'];
export const operationSkills = ['pulso-init', 'pulso-status', 'pulso-recap', 'pulso-resume'];
export const pulsoToolNames = ['pulso_workspace', 'pulso_work', 'pulso_history', 'pulso_context'];
export const nativeReadTools = ['read', 'search', 'web'];

// Illustrative prompt only: no envelope parser, runtime protocol or tool execution.
const exampleDelegation = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'templates/delegation.json'), 'utf8'));
const exampleProjectRoot = '/worktrees/payments';
const exampleResolvedPaths = {
  output: path.posix.join(exampleProjectRoot, exampleDelegation.output),
  writeScope: exampleDelegation.writeScope.map(relative => path.posix.join(exampleProjectRoot, relative)),
  inputs: exampleDelegation.inputs.map(relative => path.posix.join(exampleProjectRoot, relative)),
};
const delegationRootContract = `<delegation_path_contract>
Para una delegación persistente, redacta un prompt nativo autocontenido en prosa/XML con dos partes separadas: hostContext y delegation. Este envelope es contexto del prompt para la delegación nativa disponible, no una nueva API, tool, runtime ni un protocolo de ejecución propio.
hostContext contiene projectRoot y readBase obligatorios, absolutos e iguales al receipt.workspace seleccionado que Pulso conserva del recibo del host. hostContext está fuera del JSON canónico delegation y nunca se persiste dentro de él. No agregues hostContext, projectRoot, readBase, root, workspace ni resolvedPaths al JSON canónico: additionalProperties es false. El hostContext.projectRoot explícito prevalece sobre el workspace implícito de la sesión; nunca uses HOME ni cwd como sustitutos.
delegation es el JSON original conforme al schema canónico y a su plantilla: output, writeScope e inputs conservan rutas relativas, sin convertirlas a absolutas. Resuelve inputs y referencias relativas del repositorio desde ese mismo hostContext.projectRoot/readBase, incluidos los de un worktree seleccionado, sin volver al checkout principal. Para las herramientas nativas del especialista, la ruta efectiva absoluta = hostContext.projectRoot + ruta relativa canónica; resuelve output y cada ruta de writeScope así, comprueba su pertenencia a projectRoot antes de escribir y respeta los permisos efectivos del host, sin shell cd ni bypass de aprobaciones. Una preview resolvedPaths es solo contexto separado del prompt, nunca parte del JSON canónico ni un dato persistido. Nunca conviertas los campos de rutas de delegation, del JSON persistido o del resultado canónico (artifacts, changedFiles y referencias) a absolutos: devuelve las rutas relativas canónicas correspondientes, no los destinos efectivos de las herramientas.
Las plantillas, schemas y skills empaquetados se resuelven desde sus enlaces de recursos, no desde projectRoot; conserva sus referencias canónicas y usa las rutas de recursos proporcionadas aparte en el prompt. Si faltan hostContext.projectRoot/readBase o son distintos, devuelve el bloqueo sin escrituras; no elijas ni cambies la raíz de metadatos ni invoques tools Pulso. La excepción mode: read_only_review conserva su readBase externa explícita, output: conversation y writeScope: [], solo para lectura y sin cambiar la raíz activa; está exenta del JSON persistente y del envelope persistente.
Ejemplo ilustrativo: reemplaza hostContext con receipt.workspace confirmado y delegation con el encargo real validado; las rutas de preview se calculan aparte, no se copian a delegation ni al resultado.
<native_delegation_prompt_example>
<hostContext>${JSON.stringify({projectRoot: exampleProjectRoot, readBase: exampleProjectRoot})}</hostContext>
<delegation canonical="true">
${JSON.stringify(exampleDelegation, null, 2)}
</delegation>
<resolvedPaths preview-only="true">${JSON.stringify(exampleResolvedPaths)}</resolvedPaths>
</native_delegation_prompt_example>
</delegation_path_contract>`;

export const runtimeBoundary = `<runtime_boundary host="VS Code GitHub Copilot">
La delegación Local es stateless: incluye inputs y referencias suficientes; no presupongas memoria ni sesiones reanudables. La delegación nativa de Copilot sigue el comportamiento y las capacidades reales del host, sin afirmar que también sea stateless ni inventar APIs de reanudación. No construyas un fake scheduler, procesos de agentes, sesiones sintéticas ni un runtime paralelo. Solo usa capacidades realmente disponibles del host y respeta sus aprobaciones.
La selección del agente corresponde al usuario/host. Las skills slash operativas solo se ejecutan con el agente Pulso seleccionado; si hay otro agente seleccionado, pide seleccionar Pulso y detente sin herramientas ni escrituras. No finjas un cambio de agente.
La raíz es el proyecto activo determinado por el host: una carpeta local única se usa automáticamente, sin picker; con varias carpetas se selecciona una vez y se conserva en memoria por ventana. El binding se comparte entre sesiones de esa ventana, no hay una API de raíz por sesión. Para trabajar en otro proyecto usa Pulso: Seleccionar proyecto (pulso.selectProject) o una ventana separada. Un worktree debe estar abierto como carpeta. Recargar la ventana requiere seleccionar de nuevo en multi-root; cualquier cambio del listado o de las raíces del workspace invalida el binding. No infieras la raíz desde HOME, cwd, un state.json o una ruta del mensaje. Una readBase externa solo concede el alcance de lectura delegado, no cambia la raíz activa. Las aprobaciones normales de VS Code son independientes de la selección de proyecto y siguen vigentes.
Pulso conserva la ruta absoluta receipt.workspace del recibo del selector del host como raíz seleccionada del objetivo. No pases root, projectRoot, readBase ni workspace como argumentos de raíz a las tools Pulso: esa raíz la resuelve el host. En cambio, copia receipt.workspace como projectRoot y readBase explícitos en hostContext fuera del JSON canónico de cada encargo persistente; delegar rutas de lectura/escritura no autoriza delegar selección o cambios de la raíz de metadatos.
Antes de cualquier mutación, consulta pulso_workspace status sin escribir. Conserva receipt.workspace y receipt.bindingId para el objetivo; envía ese bindingId opaco como expectedBindingId en todas las mutaciones (incluidas prepare y preferencias globales). No fabriques el token ni lo cambies automáticamente para reintentar. Si la raíz o binding cambia, detente y confirma con el usuario el proyecto previsto antes de volver a consultar y continuar. El host rechaza tokens ausentes u obsoletos antes de cualquier escritura. Una consulta no autoriza cambiar el proyecto de la conversación.
El contrato VS Code usa action y los demás campos en el nivel superior, sin wrapper request. pulso_context action=read devuelve entries, revisions y nextCursor; sigue hasMore y usa scope, expectedRevision y source explícitos al escribir. pulso_work action=validate_result valida delegation/result sin escribir; no sustituye revisar evidencia. get devuelve acceptanceBasis: consérvala antes de observar y no recalcules una base posterior para aprobar evidencia antigua. No existe complete_map: el mapeo usa tareas, observaciones explícitas de evidencia y close; un marcador de plantilla nunca acredita aceptación. priority usa low/normal/high/critical; urgent no está admitido. Las consultas devuelven output humano y data estructurada. status enumera works paginados; sigue nextOffset mientras hasMore. get permite section overview/tasks/criteria/evidence/documents/decisions/acceptanceChanges y offset/limit; consulta las secciones necesarias hasta hasMore=false. history conserva fechas, ciclos, limitaciones y nextOffset. Nunca interpretes una página como el total. Ante persistence.partial, comunica workId/revision y sigue recovery; no repitas mutaciones a ciegas.
${delegationRootContract}
Saludo o consulta no inicializa, migra, repara ni escribe archivos. Consultas de estado/historial solo leen lo existente. Un error de raíz, permisos o tools se comunica con su causa; no se corrige editando JSON manualmente. Solo las cuatro tools Pulso mutan metadatos canónicos; especialistas no las usan ni delegan. No edites state.json, history.jsonl, memory.json o work.json directamente.
Skills se cargan mediante las capacidades nativas de Copilot o lectura de sus SKILL.md empaquetados; no existe una tool OpenCode skill/task/question. Usa agent para delegación y vscode/askQuestions o conversación para preguntas. Pulso no dispone de edit ni terminal; especialistas solo escriben dentro del output/writeScope asignado.
</runtime_boundary>`;

const selectionGuard = `<pulso_selection_guard>
Antes de ejecutar esta skill slash, comprueba el agente seleccionado por el host. Solo continúa si es Pulso. Si es otro o no está confirmado, pide al usuario seleccionar Pulso y volver a invocar la skill; detente sin herramientas, delegaciones ni escrituras. Esta skill no cambia la identidad del agente.
</pulso_selection_guard>`;

export function listFiles(directory) {
  return fs.readdirSync(directory, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    if (entry.isSymbolicLink()) throw new Error(`Recurso symlink no permitido: ${path.join(directory, entry.name)}`);
    if (entry.isDirectory()) return listFiles(path.join(directory, entry.name)).map(file => `${entry.name}/${file}`);
    return entry.isFile() ? [entry.name] : [];
  });
}

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const frontmatter = metadata => `---\n${Object.entries(metadata).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n')}\n---\n\n`;

export function parseFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (!match) throw new Error('Frontmatter ausente');
  const metadata = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = /^([\w-]+):\s*(.*)$/.exec(line);
    if (!field) throw new Error(`Frontmatter no soportado: ${line}`);
    try { metadata[field[1]] = JSON.parse(field[2]); }
    catch { metadata[field[1]] = field[2]; }
  }
  return {metadata, body: text.slice(match[0].length)};
}

// Transform copies only. Links are relative to the generated file, not the user's HOME.
export function adaptPrompt(text, destination) {
  const relative = target => path.posix.relative(path.posix.dirname(destination), target);
  return text.replace(/\r\n/g, '\n')
    .replace(/request\.action/g, 'action')
    .replace('reciben un único request discriminado por action', 'reciben argumentos planos discriminados por action (sin wrapper request)')
    .replace('Usa exclusivamente el workspace activo proporcionado por el host y los recursos disponibles de Pulso.', 'Usa exclusivamente la raíz absoluta receipt.workspace confirmada en el recibo del host y los recursos disponibles de Pulso. Conserva esa raíz para todas las llamadas y delegaciones del objetivo; no la envíes como argumento de raíz a las tools Pulso.')
    .replace('Lee `.pulso/project.md` si existe.', 'Lee project.md en la ruta absoluta resuelta dentro de receipt.workspace (`.pulso/project.md`) si existe.')
    .replace('output `.pulso/project.md`, writeScope exclusivo', 'output canónico `.pulso/project.md` relativo, writeScope exclusivo con esa misma ruta relativa; ruta efectiva absoluta resuelta desde hostContext.projectRoot solo para herramientas nativas, conforme a delegation_path_contract')
    .replace('La raíz es el workspace activo implícito; no la pases como argumento ni permitas que el agente elija otra.', 'Incluye hostContext con projectRoot y readBase absolutos iguales al receipt.workspace confirmado, fuera del JSON canónico, conforme a delegation_path_contract del runtime_boundary. Vincula los inputs relativos a esa raíz sin modificar su representación canónica. No pases argumentos de raíz a las tools Pulso: esta prohibición no afecta al contexto de rutas obligatorio del prompt nativo delegado.')
    .replace('Por defecto resuelve rutas relativas desde el workspace de la sesión activa, nunca HOME ni una raíz inferida por el modelo.', 'Aplica delegation_path_contract del runtime_boundary: hostContext.projectRoot/readBase explícitos, fuera del JSON canónico, prevalecen sobre el workspace implícito. Resuelve las rutas relativas canónicas para herramientas nativas desde esa raíz y conserva su representación relativa en el JSON persistido y en el resultado.')
    .replace('En ese caso inspecciona lo necesario y redacta `.pulso/project.md` usando la plantilla global indicada;', 'En ese caso aplica delegation_path_contract del runtime_boundary con hostContext.projectRoot/readBase vinculados al receipt.workspace seleccionado, fuera del JSON canónico. Inspecciona los inputs relativos desde esa raíz. Redacta el output canónico `.pulso/project.md` relativo en su ruta efectiva absoluta resuelta desde hostContext.projectRoot, dentro del writeScope canónico resuelto para herramientas nativas, usando la plantilla global indicada;')
    .replace('Puede validarse con validate-result guardando encargo/resultado en su work.', 'Valida con pulso_work action="validate_result", delegation y result; además revisa evidencia y diff.')
    .replace('Usa fingerprint para obtener SHA256 reales.', 'Obtén SHA256 reales mediante las herramientas de ejecución disponibles del host (por ejemplo sha256sum o shasum -a 256); si no están disponibles, declara la evidencia pendiente.')
    .replace('`docs/EXAMPLES.md` en la instalación global', '[ejemplos empaquetados](../docs/EXAMPLES.md)')
    .replace(/~\/\.pulso\/(templates|schemas|skills)\/([\w./-]+)/g, (_, folder, file) => `[${file}](${relative(`${folder}/${file}`)})`)
    .replace(/\.pulso\/catalog\.json/g, `[catálogo empaquetado](${relative('agents/catalog.json')})`)
    .replace(/`task`/g, '`agent`')
    .replace(/(?:la herramienta nativa|la tool|la herramienta) `skill`/g, 'la capacidad nativa de skills de Copilot (lectura de SKILL.md)')
    .replace(/`skill`/g, 'skills nativas de Copilot')
    .replace(/`question`/g, '`vscode/askQuestions`')
    .replace(/external_directory/g, 'acceso externo autorizado por el host')
    .replace(/\bOpenCode\b/g, 'VS Code GitHub Copilot')
    .replace(/\.opencode\/skills\//g, `${relative('skills')}/`)
    .replace(/\.opencode\/agents\//g, `${relative('agents')}/`);
}

export function composeResources({root = sourceRoot, toolNames = pulsoToolNames} = {}) {
  const files = new Map(), provenance = [];
  const read = relative => fs.readFileSync(relative.startsWith('vscode:') ? path.join(extensionRoot, relative.slice(7)) : path.join(root, relative));
  const local = (folder, file) => fs.existsSync(path.join(extensionRoot,folder,file)) ? `vscode:${folder}/${file}` : `${folder === 'core' ? 'lib' : folder}/${file}`;
  function add(destination, content, sources) {
    const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
    files.set(destination, bytes);
    provenance.push({path: destination, sha256: sha256(bytes), modified: sources.length !== 1 || !read(sources[0]).equals(bytes), sources: sources.map(source => {
      const original = read(source);
      return {path: source.startsWith('vscode:') ? `v3-vscode/${source.slice(7)}` : `v3-opencode-v1/${source}`, sha256: sha256(original), modified: !original.equals(bytes)};
    })});
  }
  for (const module of runtimeModules) { const source = local('core',`${module}.mjs`); add(`lib/${module}.mjs`, read(source), [source]); }
  for (const folder of ['schemas', 'templates']) {
    for (const file of listFiles(path.join(root, folder))) {
      const destination = `${folder}/${file}`, source = folder === 'schemas' ? local(folder,file) : destination;
      const bytes = read(source);
      add(destination, file.endsWith('.md') ? adaptPrompt(bytes.toString(), destination) : bytes, [source]);
    }
  }
  add('docs/EXAMPLES.md', adaptPrompt(read('docs/EXAMPLES.md').toString(),'docs/EXAMPLES.md'), ['docs/EXAMPLES.md']);
  const catalog = JSON.parse(read('agents/catalog.json'));
  if (catalog.orchestrator.id !== 'pulso' || catalog.specialists.length !== 9 || new Set(catalog.specialists.map(agent => agent.id)).size !== 9) {
    throw new Error('Catálogo v3-opencode-v1 inválido: se esperan Pulso y nueve especialistas distintos');
  }
  add('agents/catalog.json', read('agents/catalog.json'), ['agents/catalog.json']);
  add('catalog.json', read('agents/catalog.json'), ['agents/catalog.json']);
  const chatAgents = [];
  for (const agent of [catalog.orchestrator, ...catalog.specialists]) {
    const primary = agent.id === 'pulso', destination = `agents/${agent.id}.agent.md`;
    const sources = primary ? ['agents/pulso.md'] : ['agents/common.md', `agents/${agent.id}.md`];
    const metadata = {
      name: primary ? 'Pulso' : agent.id,
      description: agent.description,
      tools: primary ? ['agent', ...nativeReadTools, 'vscode/askQuestions', ...toolNames] : [...nativeReadTools, 'edit', ...(['pulso-explorer', 'pulso-executor', 'pulso-qa-auditor', 'pulso-security-auditor', 'pulso-code-reviewer', 'pulso-ui-auditor'].includes(agent.id) ? ['execute'] : [])],
      agents: primary ? catalog.specialists.map(specialist => specialist.id) : [],
      'user-invocable': primary,
      'disable-model-invocation': false,
    };
    const links = ['templates/delegation.md', 'schemas/delegation.schema.json', 'schemas/result.schema.json', `templates/${primary ? 'project.md' : agent.template}`, 'skills/pulso-init/SKILL.md'].map(target => `[${path.posix.basename(target)}](${path.posix.relative('agents', target)})`).join(', ');
    const body = sources.map(source => adaptPrompt(read(source).toString(), destination).trim()).join('\n\n');
    add(destination, `${frontmatter(metadata)}${runtimeBoundary}\n\nRecursos empaquetados: ${links}.\n\n${body}\n`, ['agents/catalog.json', ...sources, 'templates/delegation.json']);
    chatAgents.push({path: `resources/${destination}`});
  }
  const chatSkills = [];
  for (const file of listFiles(path.join(root, 'skills'))) {
    const source = `skills/${file}`, original = read(source);
    let text = adaptPrompt(original.toString(), source);
    if (file.endsWith('/SKILL.md')) {
      const {metadata, body} = parseFrontmatter(text);
      const name = file.split('/')[0];
      if (metadata.name !== name || !metadata.description) throw new Error(`Skill inválida: ${source}`);
      if (operationSkills.includes(name)) {
        if (metadata['user-invocable'] !== true || metadata['disable-model-invocation'] !== true) throw new Error(`Flags slash inválidos: ${source}`);
        text = `${frontmatter(metadata)}${selectionGuard}\n\n${runtimeBoundary}\n\n${body}`;
      }
      chatSkills.push({path: `resources/skills/${name}/SKILL.md`});
    }
    add(source, text, file.endsWith('/SKILL.md') && operationSkills.includes(file.split('/')[0]) ? [source, 'templates/delegation.json'] : [source]);
  }
  files.set('provenance.json', Buffer.from(`${JSON.stringify({schemaVersion: 1, source: 'v3-opencode-v1', adaptations: ['VS Code native capabilities and relative resource links', 'Pulso agent selection guard for operational slash skills'], files: provenance}, null, 2)}\n`));
  return {files, chatAgents, chatSkills};
}

