import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {toolDefinitions, toolContracts, validateToolInput, isMutating} from '../resources/lib/tool-contracts.mjs';
import {executeTool} from '../resources/lib/semantic-tools.mjs';
import {checkSchemaVocabulary, validateSchema} from '../resources/lib/schema.mjs';
import {exists, readJSON} from '../resources/lib/fs.mjs';
import {readWork} from '../resources/lib/artifacts.mjs';
import {schemaToZod, nativeToolSchemas} from './schema-converter.mjs';
import {attemptActionSchemas} from './attempt-contracts.mjs';
import {createDelegationObserver, readDelegationAttempts} from './delegation-observer.mjs';

const resourceRoot = fileURLToPath(new URL('../resources/', import.meta.url));
// Read the manifest beside the loaded runtime, never the checkout or a build constant.
const loadedPackage = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
if (typeof loadedPackage.name !== 'string' || !loadedPackage.name || typeof loadedPackage.version !== 'string' || !loadedPackage.version) throw new Error('Loaded Pulso package identity is unavailable');
const runtime = Object.freeze({adapter: 'opencode', packageName: loadedPackage.name, version: loadedPackage.version});
function provenance(context) {
  const host = Object.fromEntries(['sessionID', 'messageID', 'callID'].filter(key => typeof context?.[key] === 'string' && context[key].trim()).map(key => [key, context[key]]));
  return {runtime, ...(Object.keys(host).length ? {host} : {})};
}
const failure = error => ({title: 'Pulso · Error', output: String(error?.message || 'Invalid operation').slice(0, 500), ok: false,
  error: {code: error?.code || 'OPERATION_FAILED', message: String(error?.message || 'Invalid operation').slice(0, 500),
    ...(error?.issues ? {issues: error.issues} : {}), ...(error?.issueCount ? {issueCount: error.issueCount} : {})},
  ...(error?.persistence ? {persistence: error.persistence} : {})});
const nativeResult = receipt => ({title: receipt.title, output: JSON.stringify(receipt),
  metadata: {pulso: true, ok: receipt.ok, ...(receipt.persistence ? {persistence: receipt.persistence} : {})}});
function rootOf(context) {
  if (!context || typeof context.directory !== 'string' || !path.isAbsolute(context.directory)) throw new Error('Native project directory is unavailable');
  const root = fs.realpathSync(context.directory);
  if (!fs.statSync(root).isDirectory()) throw new Error('Native project root is not a directory');
  return root;
}
function invocationContext(context, root, originalDirectory) {
  return () => {
    if (context.abort?.aborted) throw new Error('Native invocation cancelled');
    if (context.directory !== originalDirectory || rootOf(context) !== root) throw new Error('Native project directory changed; no further mutation is allowed');
  };
}
function correlatedTask(directory, args, catalog) {
  if (!catalog.specialists.some(agent => agent.id === args?.subagent_type)) return false;
  const prompt = args.prompt || '';
  if (typeof prompt !== 'string' || prompt.length > 65536) return false;
  const get = label => [...prompt.matchAll(new RegExp(`(?:^|[\\s{,])"?${label}"?\\s*[:=]\\s*"?([A-Za-z0-9][A-Za-z0-9_-]{0,79})(?=["\\s,}]|$)`, 'g'))].map(match => match[1]);
  const works = get('workId'), tasks = get('taskId');
  if (new Set(works).size !== 1 || new Set(tasks).size !== 1) return false;
  return readWork(directory, works[0], {files: false}).tasks.some(task => task.id === tasks[0] && task.agent === args.subagent_type);
}

export async function PulsoPlugin({directory, homeDir = os.homedir()}, native = {}) {
  const {tool} = native.tool ? native : await import('./vendor/sdk/index.js');
  const z = native.z || tool.schema;
  if (!z) throw new Error('Native Zod API unavailable');
  const validator = {checkSchemaVocabulary, validateSchema};
  const schemas = nativeToolSchemas(toolContracts, z, validator, {pulso_workspace: attemptActionSchemas});
  const registered = {};
  for (const definition of toolDefinitions) {
    const wrapped = definition.name !== 'pulso_history';
    const args = wrapped ? {request: schemas[definition.name]} : Object.fromEntries(Object.entries(definition.inputSchema.properties).map(([name, descriptor]) => {
      const schema = schemaToZod(descriptor, z, validator);
      return [name, (definition.inputSchema.required || []).includes(name) ? schema : schema.optional()];
    }));
    registered[definition.name] = tool({description: definition.modelDescription
      + (wrapped ? ' Envelope nativo: {request:{action,...}}.' : ' Filtros planos, sin request.')
      + ' output contiene el recibo JSON: retorno nativo no equivale a ok:true; ok:true no implica objetivo cerrado.'
      + (definition.name === 'pulso_work' ? ' accept_delivery: comprobar data.closed/readiness; aceptación guardada puede quedar pendiente de cierre. Conservar delegation y acceptanceBasis originales para accept_result.' : '')
      + (definition.name === 'pulso_workspace' ? ' attempts/reconcile_attempts consultan telemetría pasiva sin confirmar actividad ni aceptación.' : ''), args,
      async execute(input, context) {
        let semantic, root, assertContext;
        const origin = provenance(context);
        const respond = receipt => nativeResult({...receipt, provenance: origin, ...(root ? {workspace: root} : {})});
        try {
          if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Expected an object');
          if (wrapped && (Object.keys(input).length !== 1 || !Object.hasOwn(input, 'request'))) throw new Error('Only the native request envelope is allowed');
          semantic = structuredClone(wrapped ? input.request : input);
          if (definition.name === 'pulso_workspace' && Object.hasOwn(attemptActionSchemas, semantic?.action)) semantic = schemas[definition.name].parse(semantic);
          else validateToolInput(definition.name, semantic);
          if (typeof context?.ask !== 'function') throw new Error('Native approval is unavailable; operation blocked');
          root = rootOf(context);
          assertContext = invocationContext(context, root, context.directory);
          assertContext();
        } catch (error) { return respond(failure(error)); }
        const action = semantic.action || 'read', resource = semantic.scope || semantic.workId || 'workspace';
        // Denial/cancellation remains a host rejection, never normal success.
        await context.ask({permission: definition.name, patterns: [`${action}:${resource}`], always: [`${action}:${resource}`], metadata: {action, resource, mutating: isMutating(definition.name, semantic)}});
        assertContext();
        let receipt;
        if (definition.name === 'pulso_workspace' && attemptActionSchemas[semantic.action]) {
          receipt = {title: 'Pulso · Intentos', output: 'Telemetría pasiva; no confirma actividad ni aceptación.', ok: true,
            data: {items: readDelegationAttempts(root, semantic), liveness: 'unknown', acceptance: 'not_assessed'}};
        } else receipt = await executeTool(definition.name, semantic, {projectRoot: root, homeDir, resourceRoot, assertContext});
        try { assertContext(); } catch (error) {
          receipt = {...receipt, ok: false, contextChanged: true, output: `${receipt.output}\nContext changed after invocation: ${error.message}`};
        }
        return respond(receipt);
      },
    });
  }
  let observer;
  const observed = new Set();
  const observe = hook => async (...args) => {try {
    if (!directory || !exists(directory, '.pulso/state.json')) return;
    if (hook !== 'event') {
      if (args[0]?.tool !== 'task') return;
      const task = hook === 'tool.execute.before' ? args[1]?.args : args[0]?.args;
      if (!correlatedTask(directory, task, readJSON(resourceRoot, 'agents/catalog.json'))) return;
      observed.add(JSON.stringify([args[0].sessionID, args[0].callID]));
    } else {
      if (!observer) return;
      const event = args[0]?.event;
      if (event?.type === 'message.part.updated') {
        const part = event.properties?.part;
        if (!observed.has(JSON.stringify([part?.sessionID, part?.callID]))) return;
      }
    }
    observer ??= createDelegationObserver(directory);
    await observer[hook](...args);
  } catch { /* Passive observation cannot prevent native task execution. */ }};
  return {tool: registered, 'tool.execute.before': observe('tool.execute.before'), 'tool.execute.after': observe('tool.execute.after'), event: observe('event')};
}
