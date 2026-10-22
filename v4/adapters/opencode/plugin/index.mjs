import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {toolDefinitions, toolContracts, validateToolInput, isMutating} from '../resources/lib/tool-contracts.mjs';
import {executeTool} from '../resources/lib/semantic-tools.mjs';
import {recoveryDetails} from '../resources/lib/receipts.mjs';
import {checkSchemaVocabulary, validateSchema} from '../resources/lib/schema.mjs';
import {exists, readJSON} from '../resources/lib/fs.mjs';
import {readWork} from '../resources/lib/artifacts.mjs';
import {schemaToZod, nativeToolSchemas} from './schema-converter.mjs';
import {attemptActionSchemas} from './attempt-contracts.mjs';
import {createDelegationObserver, readDelegationAttempts, correlation} from './delegation-observer.mjs';
import {nativeAuthority} from './assignment-authority.mjs';
import {authorizeTool} from '../resources/lib/assignment-tools.mjs';
import {createDurableHooks, nativeContext} from './durable-hooks.mjs';
import {createRecoveryPolicy, nativePrimaryRequest} from './recovery-policy.mjs';

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
    ...(error?.issues ? {issues: error.issues} : {}), ...(error?.issueCount ? {issueCount: error.issueCount} : {}), ...recoveryDetails(error)},
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
  const identity=Object.fromEntries(['sessionID','messageID','agent'].map(key=>[key,context[key]]));
  return () => {
    if(Object.entries(identity).some(([key,value])=>context[key]!==value))throw new Error('Native invocation identity changed; operation blocked');
    if (context.abort?.aborted) throw new Error('Native invocation cancelled');
    if (context.directory !== originalDirectory || rootOf(context) !== root) throw new Error('Native project directory changed; no further mutation is allowed');
  };
}
function correlatedTask(directory, args, catalog) {
  if (!catalog.specialists.some(agent => agent.id === args?.subagent_type)) return false;
  const ids = correlation(args.prompt);
  const tasks = ids.taskIds || (ids.taskId ? [ids.taskId] : []);
  if (!ids.workId || !tasks.length || ids.correlationConflicts?.length) return false;
  const work = readWork(directory, ids.workId, {files: false});
  return tasks.every(id => work.tasks.some(task => task.id === id && task.agent === args.subagent_type));
}

export async function PulsoPlugin({directory, client, homeDir = os.homedir()}, native = {}) {
  const {tool} = native.tool ? native : await import('./vendor/sdk/index.js');
  const z = native.z || tool.schema;
  if (!z) throw new Error('Native Zod API unavailable');
  const validator = {checkSchemaVocabulary, validateSchema};
  const schemas = nativeToolSchemas(toolContracts, z, validator, {pulso_workspace: attemptActionSchemas});
  const registered = {};
  const recovery = createRecoveryPolicy({directory, client});
  const durable = createDurableHooks({directory});
  for (const definition of toolDefinitions) {
    const wrapped = definition.name !== 'pulso_history';
    const args = wrapped ? {request: schemas[definition.name]} : Object.fromEntries(Object.entries(definition.inputSchema.properties).map(([name, descriptor]) => {
      const schema = schemaToZod(descriptor, z, validator);
      return [name, (definition.inputSchema.required || []).includes(name) ? schema : schema.optional()];
    }));
    registered[definition.name] = tool({description: definition.modelDescription
      + (wrapped ? ' Envelope nativo: {request:{action,...}}.' : ' Filtros planos, sin request.')
      + ' output contiene el recibo JSON: retorno nativo no equivale a ok:true; ok:true no implica objetivo cerrado.'
       + (definition.name === 'pulso_work' ? ' accept_delivery: comprobar data.closed/readiness. Encargos v2: preparar, task con specialistPrompt exacto, accept_result por delegationId/returnId; recuperar por ID ante error administrativo. La preparación autoriza el registro asociado al mismo padre nativo.' : '')
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
        let receipt,authorization,automaticRecovery,intentSource,automaticProof;
        try{
          authorization=await nativeAuthority(client,context,root);
          assertContext();
          authorizeTool(root,definition.name,semantic,{authorization,nativeContext:nativeContext(context),assertContext});
          if(definition.name==='pulso_workspace'&&['bind_continuity','update_intent'].includes(semantic.action)){
            // Optional provenance enriches new intent snapshots; unavailable legacy
            // source APIs do not become a new requirement for explicit operations.
            try{const {request}=await nativePrimaryRequest(client,context,root);const {text,...reference}=request;intentSource={provenance:'native_user_request',...reference};}catch{/* No fabricated source. */}
            assertContext();
          }
          if(definition.name==='pulso_workspace'&&semantic.action==='resume_continuity'&&semantic.resumeMode==='automatic'){
            // The model selects this mode after semantic review; it is not authority.
            // ask has already completed. Do not await again before synchronous core CAS.
            automaticProof=await recovery.proveAutomaticResume(context,semantic,{disposition:'compatible'});
            automaticRecovery={proof:automaticProof,assertProof:(proof,args)=>recovery.assertProof(proof,args,context)};
          }
        }catch(error){return respond(failure(error));}
        if (definition.name === 'pulso_workspace' && attemptActionSchemas[semantic.action]) {
          receipt = {title: 'Pulso · Intentos', output: 'Telemetría pasiva; no confirma actividad ni aceptación.', ok: true,
            data: {items: readDelegationAttempts(root, semantic), liveness: 'unknown', acceptance: 'not_assessed'}};
        } else receipt = await executeTool(definition.name, semantic, {projectRoot: root, homeDir, resourceRoot, assertContext, nativeContext: nativeContext(context), authorization, automaticRecovery, intentSource});
        if(automaticProof&&receipt.ok){
          try{
            const captures=await recovery.replayStoredReturns(automaticProof,receipt,part=>durable.event({event:{type:'message.part.updated',properties:{part}}}));
            receipt={...receipt,data:{...receipt.data,recovery:{...captures,capturePending:captures.pending.length>0}},output:`${receipt.output} ${captures.pending.length?'Captura pendiente: inspeccionar efectos y señales concretas antes de reconciliar; no redisparar ni pedir liberación genérica de administrador.':'Capturas históricas comprobadas; aún requieren revisión y aceptación.'}`};
          }catch(error){receipt={...receipt,data:{...receipt.data,recovery:{ownerTransferred:true,capturePending:true,stored:[],pending:[{reason:error.code||'CAPTURE_PENDING'}],physicalCessation:'unknown'}},output:`${receipt.output} Owner aplicado; captura pendiente. Recuperar por IDs, no repetir ejecución.`};}
        }
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
  return {tool: registered,
    'experimental.chat.messages.transform': recovery['experimental.chat.messages.transform'],
    'tool.execute.before': async (input, output) => {await durable['tool.execute.before'](input, output); await observe('tool.execute.before')(input, output);},
    'tool.execute.after': async (input, output) => {await durable['tool.execute.after'](input, output); await observe('tool.execute.after')(input, output);},
    event: async input => {const receipt = await durable.event(input); await observe('event')(input); return receipt;}};
}
