import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {adaptPrompt, composeResources, operationSkills, parseFrontmatter, pulsoToolNames, runtimeBoundary, runtimeModules, sourceRoot} from '../src/composition.mjs';
import {build} from '../scripts/build.mjs';
import {check} from '../scripts/check.mjs';
import {assertSchema, schema, validateSchema} from '../../v3-opencode-v1/lib/schema.mjs';

const composed = composeResources();
const text = relative => composed.files.get(relative).toString();
const original = relative => fs.readFileSync(path.join(sourceRoot, relative));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const catalog = JSON.parse(original('agents/catalog.json'));

test('Pulso delegates only to the nine exact specialist IDs and has no product write tools', () => {
  const {metadata, body} = parseFrontmatter(text('agents/pulso.agent.md'));
  assert.equal(metadata.name, 'Pulso');
  assert.deepEqual(metadata.agents, catalog.specialists.map(agent => agent.id));
  assert.deepEqual(metadata.tools, ['agent', 'read', 'search', 'web', 'vscode/askQuestions', ...pulsoToolNames]);
  assert.equal(metadata['user-invocable'], true);
  assert.equal(metadata['disable-model-invocation'], false);
  assert.ok(body.includes(adaptPrompt(original('agents/pulso.md').toString(), 'agents/pulso.agent.md').trim()));
  for (const contract of ['stateless', 'proyecto activo', 'sin herramientas ni escrituras', 'fake scheduler', 'No edites state.json']) assert.ok(body.includes(contract), contract);
});

test('specialists retain common/role contracts, write scoped reports and cannot delegate or mutate metadata', () => {
  assert.equal(composed.chatAgents.length, 10);
  for (const agent of catalog.specialists) {
    const destination = `agents/${agent.id}.agent.md`, {metadata, body} = parseFrontmatter(text(destination));
    assert.equal(metadata.name, agent.id);
    assert.deepEqual(metadata.agents, []);
    assert.equal(metadata['user-invocable'], false);
    assert.equal(metadata['disable-model-invocation'], false);
    assert.ok(metadata.tools.includes('edit'), `${agent.id} must write its assigned report`);
    assert.ok(!metadata.tools.includes('agent'));
    assert.ok(!metadata.tools.some(tool => pulsoToolNames.includes(tool)));
    for (const source of ['agents/common.md', `agents/${agent.id}.md`]) assert.ok(body.includes(adaptPrompt(original(source).toString(), destination).trim()), source);
  }
  for (const id of ['pulso-executor', 'pulso-qa-auditor']) assert.ok(parseFrontmatter(text(`agents/${id}.agent.md`)).metadata.tools.includes('execute'));
  for (const id of ['pulso-researcher', 'pulso-planner', 'pulso-plan-auditor']) assert.ok(!parseFrontmatter(text(`agents/${id}.agent.md`)).metadata.tools.includes('execute'));
});

test('operational slash skills preserve invocation flags and guard selection before workflows', () => {
  for (const name of operationSkills) {
    const relative = `skills/${name}/SKILL.md`, {metadata, body} = parseFrontmatter(text(relative));
    assert.equal(metadata['user-invocable'], true);
    assert.equal(metadata['disable-model-invocation'], true);
    assert.ok(body.indexOf('<pulso_selection_guard>') < body.indexOf('<runtime_boundary'));
    assert.ok(body.includes('seleccionar Pulso y volver a invocar'));
    assert.ok(body.includes(parseFrontmatter(adaptPrompt(original(relative).toString(), relative)).body));
  }
  assert.ok(![...composed.files.keys()].some(file => file.endsWith('.prompt.md')));
});

test('generated init/common/explorer replace implicit roots with receipt-bound delegation paths', () => {
  const initSource = original('skills/pulso-init/SKILL.md').toString();
  const commonSource = original('agents/common.md').toString();
  const explorerSource = original('agents/pulso-explorer.md').toString();
  const implicitInit = 'La raíz es el workspace activo implícito; no la pases como argumento';
  const implicitCommon = 'Por defecto resuelve rutas relativas desde el workspace de la sesión activa';
  // Exercise the actual source contradictions, not just the shared boundary prepended to agents.
  assert.ok(initSource.includes(implicitInit));
  assert.ok(commonSource.includes(implicitCommon));
  const adaptations = [
    adaptPrompt(initSource, 'skills/pulso-init/SKILL.md'),
    adaptPrompt(commonSource, 'agents/pulso-explorer.agent.md'),
    adaptPrompt(explorerSource, 'agents/pulso-explorer.agent.md'),
  ];
  for (const adapted of adaptations) {
    assert.ok(!adapted.includes(implicitInit));
    assert.ok(!adapted.includes(implicitCommon));
    assert.match(adapted, /delegation_path_contract del runtime_boundary/);
    assert.match(adapted, /hostContext/);
    assert.match(adapted, /fuera del JSON canónico/);
    assert.match(adapted, /relativ/);
    assert.ok(!adapted.includes('<delegation_path_contract>'), 'Adaptations refer to the single boundary contract');
    assert.ok(!adapted.includes('output absoluto'));
  }
  assert.match(adaptations[0], /No pases argumentos de raíz a las tools Pulso: esta prohibición no afecta al contexto de rutas obligatorio del prompt nativo delegado/);
  assert.match(adaptations[0], /output canónico `\.pulso\/project\.md` relativo, writeScope exclusivo con esa misma ruta relativa/);
  assert.match(adaptations[2], /output canónico `\.pulso\/project\.md` relativo en su ruta efectiva absoluta resuelta desde hostContext\.projectRoot/);
  for (const relative of ['skills/pulso-init/SKILL.md', 'agents/pulso-explorer.agent.md']) {
    assert.ok(!text(relative).includes(implicitInit));
    assert.ok(!text(relative).includes(implicitCommon));
  }
});

test('multi-root/worktree inputs and writes bind to one explicit root without a cwd fallback', () => {
  const common = adaptPrompt(original('agents/common.md').toString(), 'agents/pulso-executor.agent.md');
  assert.match(common, /hostContext\.projectRoot\/readBase explícitos, fuera del JSON canónico, prevalecen sobre el workspace implícito/);
  assert.match(common, /conserva su representación relativa en el JSON persistido y en el resultado/);
  assert.match(runtimeBoundary, /Resuelve inputs y referencias relativas del repositorio desde ese mismo hostContext\.projectRoot\/readBase, incluidos los de un worktree seleccionado, sin volver al checkout principal/);
  assert.match(runtimeBoundary, /nunca uses HOME ni cwd como sustitutos/);
  assert.match(runtimeBoundary, /comprueba su pertenencia a projectRoot antes de escribir.*sin shell cd ni bypass de aprobaciones/);
  assert.match(runtimeBoundary, /plantillas, schemas y skills empaquetados se resuelven desde sus enlaces de recursos, no desde projectRoot/);
  assert.match(runtimeBoundary, /mode: read_only_review conserva su readBase externa explícita, output: conversation y writeScope: \[\]/);
  for (const specialist of catalog.specialists) {
    const body = text(`agents/${specialist.id}.agent.md`);
    assert.match(body, /hostContext\.projectRoot explícito prevalece sobre el workspace implícito/);
    assert.match(body, /no elijas ni cambies la raíz de metadatos ni invoques tools Pulso/);
  }
});

test('one native prompt envelope keeps original canonical delegation valid and previews absolute paths separately', () => {
  const envelope = /<native_delegation_prompt_example>([\s\S]*?)<\/native_delegation_prompt_example>/.exec(runtimeBoundary)?.[1];
  assert.ok(envelope);
  const hostContext = JSON.parse(/<hostContext>([\s\S]*?)<\/hostContext>/.exec(envelope)[1]);
  const delegation = JSON.parse(/<delegation canonical="true">([\s\S]*?)<\/delegation>/.exec(envelope)[1]);
  const preview = JSON.parse(/<resolvedPaths preview-only="true">([\s\S]*?)<\/resolvedPaths>/.exec(envelope)[1]);
  assert.deepEqual(delegation, JSON.parse(original('templates/delegation.json')));
  assert.equal(assertSchema('delegation', delegation), delegation);
  assert.deepEqual(validateSchema(schema('delegation'), delegation), []);
  assert.ok(path.posix.isAbsolute(hostContext.projectRoot));
  assert.equal(hostContext.readBase, hostContext.projectRoot);
  assert.equal(preview.output, path.posix.resolve(hostContext.projectRoot, delegation.output));
  assert.deepEqual(preview.writeScope, delegation.writeScope.map(relative => path.posix.resolve(hostContext.projectRoot, relative)));
  assert.deepEqual(preview.inputs, delegation.inputs.map(relative => path.posix.resolve(hostContext.readBase, relative)));
  for (const effective of [preview.output, ...preview.writeScope, ...preview.inputs]) {
    assert.ok(path.posix.isAbsolute(effective));
    assert.ok(effective.startsWith(`${hostContext.projectRoot}/`));
  }
  for (const canonical of [delegation.output, ...delegation.writeScope, ...delegation.inputs]) assert.ok(!path.posix.isAbsolute(canonical));
  assert.match(runtimeBoundary, /hostContext está fuera del JSON canónico delegation y nunca se persiste dentro de él/);
  assert.match(runtimeBoundary, /no una nueva API, tool, runtime ni un protocolo de ejecución propio/);
  assert.match(runtimeBoundary, /Nunca conviertas los campos de rutas de delegation, del JSON persistido o del resultado canónico/);
  for (const relative of [...composed.chatAgents.map(agent => agent.path.slice('resources/'.length)), ...operationSkills.map(name => `skills/${name}/SKILL.md`)]) {
    assert.equal(text(relative).split('<delegation_path_contract>').length - 1, 1, relative);
    assert.ok(!text(relative).includes('output y cada ruta de writeScope deben ser absolutos'));
  }
});

test('core schema rejects host fields and absolute tool paths inside canonical delegation/result', () => {
  const canonical = JSON.parse(original('templates/delegation.json'));
  const root = '/worktrees/payments', resolvedOutput = path.posix.resolve(root, canonical.output);
  const hostContext = {projectRoot: root, readBase: root};
  for (const [field, value] of Object.entries({...hostContext, hostContext, root, workspace: root, resolvedPaths: {output: resolvedOutput}})) {
    const invalid = {...canonical, [field]: value};
    assert.ok(validateSchema(schema('delegation'), invalid).some(error => error.includes(`$.${field}: campo desconocido`)), field);
    assert.throws(() => assertSchema('delegation', invalid), /campo desconocido/);
  }
  for (const field of ['output', 'writeScope', 'inputs']) {
    for (const absolute of [resolvedOutput, 'C:/worktrees/payments/plan.md']) {
      const invalid = {...canonical, [field]: field === 'output' ? absolute : [absolute]};
      assert.ok(validateSchema(schema('delegation'), invalid).some(error => error.includes(`$.${field}`) && error.includes('patrón inválido')), field);
    }
  }
  const result = {...JSON.parse(original('templates/result.json')), artifacts: [canonical.output], changedFiles: [canonical.output]};
  assert.equal(assertSchema('result', result), result);
  for (const field of ['artifacts', 'changedFiles']) {
    assert.throws(() => assertSchema('result', {...result, [field]: [resolvedOutput]}), /patrón inválido/);
  }
  assert.deepEqual(canonical, JSON.parse(original('templates/delegation.json')), 'Resolution must not mutate the persisted contract');
});

test('expected binding precedes mutations and guards session continuity', () => {
  assert.match(runtimeBoundary,/expectedBindingId/);
  assert.match(runtimeBoundary,/antes de cualquier escritura/);
  assert.match(runtimeBoundary,/No fabriques el token ni lo cambies automáticamente/);
  assert.match(runtimeBoundary, /No pases root, projectRoot, readBase ni workspace como argumentos de raíz a las tools Pulso/);
  assert.match(runtimeBoundary, /copia receipt\.workspace como projectRoot y readBase explícitos en hostContext fuera del JSON canónico/);
  assert.match(runtimeBoundary, /una carpeta local única se usa automáticamente, sin picker/);
  assert.match(runtimeBoundary, /con varias carpetas se selecciona una vez y se conserva en memoria por ventana/);
  assert.match(runtimeBoundary, /binding se comparte entre sesiones de esa ventana, no hay una API de raíz por sesión/);
  assert.match(runtimeBoundary, /Pulso: Seleccionar proyecto \(pulso\.selectProject\) o una ventana separada/);
  assert.match(runtimeBoundary, /Un worktree debe estar abierto como carpeta/);
  assert.match(runtimeBoundary, /Recargar la ventana requiere seleccionar de nuevo en multi-root/);
  assert.match(runtimeBoundary, /cualquier cambio del listado o de las raíces del workspace invalida el binding/);
  assert.match(runtimeBoundary, /aprobaciones normales de VS Code son independientes/);
  for (const relative of [...composed.chatAgents.map(agent => agent.path.slice('resources/'.length)), ...operationSkills.map(name => `skills/${name}/SKILL.md`)]) {
    assert.ok(!text(relative).includes('Antes de cada llamada Pulso, confirma con el usuario/host'));
    assert.ok(!text(relative).includes('cada picker puede elegir otro proyecto'));
  }
  assert.match(runtimeBoundary, /La delegación Local es stateless/);
  assert.match(runtimeBoundary, /delegación nativa de Copilot sigue el comportamiento y las capacidades reales del host, sin afirmar que también sea stateless/);
  assert.ok(!runtimeBoundary.includes('Cada delegación es stateless'));
});

test('runtime allowlist and source parity exclude installation dependencies and preserve priority aliases', () => {
  assert.deepEqual([...composed.files.keys()].filter(file => file.startsWith('lib/')).sort(), runtimeModules.map(name => `lib/${name}.mjs`).sort());
  for (const module of runtimeModules.filter(name => !['artifacts','work-mutations','memory'].includes(name))) assert.ok(composed.files.get(`lib/${module}.mjs`).equals(original(`lib/${module}.mjs`)));
  for (const file of ['work.schema.json', 'state.schema.json']) {
    const source = JSON.parse(original(`schemas/${file}`));
    const built = JSON.parse(text(`schemas/${file}`));
    if (file === 'work.schema.json') { assert.ok(built.properties.acceptanceChanges); delete built.properties.acceptanceChanges; }
    assert.deepEqual(built, source);
    assert.ok(text(`schemas/${file}`).includes('"urgent"'));
    assert.ok(text(`schemas/${file}`).includes('"critical"'));
  }
  assert.ok(text('schemas/result.schema.json').includes('"critical"'));
  for (const [file, bytes] of composed.files) {
    if ((file.startsWith('templates/') && !file.endsWith('.md')) || (file.startsWith('schemas/') && !['schemas/work.schema.json', 'schemas/state.schema.json'].includes(file))) assert.ok(bytes.equals(original(file)), file);
    assert.ok(!/(?:^|\/)(?:node_modules|\.pulso|install[^/]*)(?:\/|\.|$)/.test(file), file);
  }
});

test('provenance records original hashes, output hashes and modification flags accurately', () => {
  const provenance = JSON.parse(text('provenance.json'));
  assert.equal(provenance.source, 'v3-opencode-v1');
  assert.equal(provenance.files.length, composed.files.size - 1);
  const sourceBytes = source => fs.readFileSync(new URL(`../../${source}`,import.meta.url));
  for (const record of provenance.files) {
    const generated = composed.files.get(record.path);
    assert.equal(record.sha256, hash(generated));
    assert.equal(record.modified, record.sources.length !== 1 || !sourceBytes(record.sources[0].path).equals(generated));
    for (const source of record.sources) {
      assert.ok(/^v3-(?:opencode-v1|vscode)\//.test(source.path));
      const bytes = sourceBytes(source.path);
      assert.equal(source.sha256, hash(bytes));
      assert.equal(source.modified, !bytes.equals(generated));
    }
  }
  assert.equal(JSON.stringify(composeResources().chatAgents), JSON.stringify(composed.chatAgents));
  assert.ok(composeResources().files.get('provenance.json').equals(composed.files.get('provenance.json')));
});

test('host contributions use paths only; metadata stays in agent/skill frontmatter', () => {
  for (const contribution of [...composed.chatAgents, ...composed.chatSkills]) {
    assert.deepEqual(Object.keys(contribution), ['path']);
    assert.ok(contribution.path.startsWith('resources/'));
    const {metadata} = parseFrontmatter(text(contribution.path.slice('resources/'.length)));
    assert.ok(metadata.name && metadata.description);
  }
});

test('OpenCode capabilities and HOME templates become native capabilities and relative links', () => {
  const input = 'Usa `task`, la herramienta nativa `skill` y `question`; ~/.pulso/templates/project.md ~/.pulso/schemas/result.schema.json';
  const output = adaptPrompt(input, 'agents/pulso.agent.md');
  assert.ok(output.includes('`agent`'));
  assert.ok(output.includes('skills de Copilot'));
  assert.ok(output.includes('`vscode/askQuestions`'));
  assert.ok(output.includes('[project.md](../templates/project.md)'));
  assert.ok(output.includes('[result.schema.json](../schemas/result.schema.json)'));
  assert.equal(adaptPrompt('~/.pulso/templates/project.md', 'skills/pulso-init/SKILL.md'), '[project.md](../../templates/project.md)');
  for (const agent of composed.chatAgents) {
    const body = text(agent.path.slice('resources/'.length));
    for (const match of body.matchAll(/\]\(([^)]+)\)/g)) assert.ok(composed.files.has(path.posix.normalize(path.posix.join('agents', match[1]))), match[1]);
  }
});

test('build preserves other manifest fields, replaces stale resources and check detects tampering', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pulso-vscode-composition-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const manifest = {name: 'fixture', displayName: 'Pulso', version: '0.0.0', custom: {keep: true}, contributes: {commands: [{command: 'fixture.keep', title: 'Keep'}], configuration: {title: 'Keep'}, chatAgents: [{path: 'stale.agent.md'}]}};
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(manifest));
  fs.mkdirSync(path.join(root, 'src'));
  fs.mkdirSync(path.join(root, 'scripts'));
  // An isolated host contract fixture, not the delegated tools implementation.
  const definitions = pulsoToolNames.map(name => ({name, toolReferenceName: name, displayName: name, modelDescription: 'Fixture', inputSchema: {type: 'object'}}));
  fs.writeFileSync(path.join(root, 'src/tools.mjs'), `export const toolDefinitions = ${JSON.stringify(definitions)};\n`);
  fs.mkdirSync(path.join(root, 'resources/node_modules'), {recursive: true});
  fs.writeFileSync(path.join(root, 'resources/old.prompt.md'), 'stale');
  await build({root});
  const generated = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
  const retained = structuredClone(generated);
  for (const field of ['chatAgents', 'chatSkills', 'languageModelTools']) delete retained.contributes[field];
  const expectedRetained = structuredClone(manifest);
  delete expectedRetained.contributes.chatAgents;
  assert.deepEqual(retained, expectedRetained);
  assert.deepEqual(generated.contributes.languageModelTools, definitions);
  assert.ok(!fs.existsSync(path.join(root, 'resources/node_modules')));
  assert.ok(!fs.existsSync(path.join(root, 'resources/old.prompt.md')));
  assert.ok(!fs.existsSync(path.join(root, '.pulso')));
  await check({root});
  const before = fs.readFileSync(path.join(root, 'package.json'));
  await build({root});
  assert.ok(fs.readFileSync(path.join(root, 'package.json')).equals(before));
  fs.appendFileSync(path.join(root, 'resources/agents/pulso.agent.md'), '\nTampered\n');
  await assert.rejects(check({root}), /Recurso desactualizado o alterado/);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({...generated, displayName: 'Wrong'}));
  await assert.rejects(check({root}), /displayName público debe ser Pulso/);
});

