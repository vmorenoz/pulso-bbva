import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {toolDefinitions, toolContracts, validateToolInput, validateInput, isMutating} from '../resources/lib/tool-contracts.mjs';
import {executeTool} from '../resources/lib/semantic-tools.mjs';
import {recoveryDetails} from '../resources/lib/receipts.mjs';
import {checkSchemaVocabulary} from '../resources/lib/schema.mjs';
import {exists, readJSON} from '../resources/lib/fs.mjs';
import {readWork} from '../resources/lib/artifacts.mjs';
import {attemptActionSchemas} from './attempt-contracts.mjs';
import {createDelegationObserver, readDelegationAttempts, correlation} from './delegation-observer.mjs';
import {nativeAuthority, sameRoot} from './assignment-authority.mjs';
import {authorizeTool} from '../resources/lib/assignment-tools.mjs';
import {createDurableHooks, nativeContext} from './durable-hooks.mjs';
import {createRecoveryPolicy, nativePrimaryRequest} from './recovery-policy.mjs';
import {createNativeReader} from './native-read.mjs';

const resourceRoot = fileURLToPath(new URL('../resources/', import.meta.url));
const loadedPackage = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
if (typeof loadedPackage.name !== 'string' || !loadedPackage.name || !/^0\.1\.\d+$/.test(loadedPackage.version)) throw new Error('Loaded Pulso package identity/version is unavailable');
const runtime = Object.freeze({adapter:'opencode',packageName:loadedPackage.name,version:loadedPackage.version,hostVersion:'2.1.2'});
const failure = error => ({title:'Pulso · Error',output:String(error?.message || 'Invalid operation').slice(0,500),ok:false,
  error:{code:error?.code || 'OPERATION_FAILED',message:String(error?.message || 'Invalid operation').slice(0,500),
    ...(error?.issues ? {issues:error.issues} : {}),...(error?.issueCount ? {issueCount:error.issueCount} : {}),...recoveryDetails(error)},
  ...(error?.persistence ? {persistence:error.persistence} : {})});
const nativeResult = receipt => ({output:receipt,content:JSON.stringify(receipt),metadata:{pulso:true,ok:receipt.ok,...(receipt.persistence ? {persistence:receipt.persistence} : {})}});
function canonicalDirectory(directory) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw new Error('Native project directory is unavailable');
  const root = fs.realpathSync(directory);
  if (!fs.statSync(root).isDirectory()) throw new Error('Native project root is not a directory');
  return root;
}
export function nativeInputSchema(name) {
  const contract = toolContracts[name];
  if (!contract) throw new Error('Unknown Pulso tool');
  const schema = name === 'pulso_history' ? structuredClone(contract.inputSchema) : {type:'object',properties:{request:{anyOf:Object.values({...contract.actionSchemas,...(name === 'pulso_workspace' ? attemptActionSchemas : {})}).map(value => structuredClone(value))}},required:['request'],additionalProperties:false};
  checkSchemaVocabulary(schema);
  return schema;
}
function correlatedSubagent(directory,args,catalog) {
  if (!catalog.specialists.some(agent => agent.id === args?.agent)) return false;
  const ids = correlation(args.prompt), tasks = ids.taskIds || (ids.taskId ? [ids.taskId] : []);
  if (!ids.workId || !tasks.length || ids.correlationConflicts?.length) return false;
  return tasks.every(id => readWork(directory,ids.workId,{files:false}).tasks.some(task => task.id === id && task.agent === args.agent));
}

/** Native V2 definition. Injection is an explicit test seam, never a model argument. */
export function createPulsoPlugin({reader:providedReader,homeDir=os.homedir()}={}) {
  return {id:'pulso',async setup(ctx) {
    const supportedHost = ['cli', 'opencode'].includes(ctx.app?.name) && ctx.app.version === '2.1.2';
    if (!supportedHost) throw new Error(`Pulso requires OpenCode 2.1.2 (received ${ctx.app?.name}/${ctx.app?.version}); no other host or V1 plugin API is supported`);
    const directory = canonicalDirectory(ctx.location?.directory);
    if (typeof ctx.permission?.assert !== 'function' || typeof ctx.tool?.transform !== 'function' || typeof ctx.tool?.hook !== 'function' || typeof ctx.session?.hook !== 'function' || typeof ctx.event?.subscribe !== 'function') throw new Error('Native OpenCode V2 domains unavailable');
    const reader = providedReader || await createNativeReader(ctx);
    const recovery = createRecoveryPolicy({directory,reader});
    const durable = createDurableHooks({directory,reader});
    const moved = new Map();
    let disposed = false, observer;
    function guard(context) {
      if (!context?.signal || typeof context.signal.aborted !== 'boolean' || typeof context.signal.addEventListener !== 'function') throw new Error('Native cancellation signal unavailable');
      const identity = Object.fromEntries(['sessionID','messageID','agent','id'].map(key => [key,context?.[key]]));
      if (Object.values(identity).some(value => typeof value !== 'string' || !value.trim())) throw new Error('Native invocation identity unavailable');
      const generation = moved.get(context.sessionID) || 0;
      return () => {
        if (disposed || context.signal?.aborted) throw new Error('Native invocation cancelled');
        if (Object.entries(identity).some(([key,value]) => context[key] !== value)) throw new Error('Native invocation identity changed; operation blocked');
        if (canonicalDirectory(ctx.location.directory) !== directory || (moved.get(context.sessionID) || 0) !== generation) throw new Error('Native project directory changed; operation blocked');
      };
    }
    async function assertSession(context,assertContext) {
      if (typeof reader?.getSession !== 'function') throw Object.assign(new Error('Native session API unavailable'),{code:'NATIVE_AUTHORITY_UNAVAILABLE'});
      const session = await reader.getSession(context.sessionID);
      assertContext();
      if (session?.id !== context.sessionID || !sameRoot(session.location?.directory,directory)) throw new Error('Native session project directory changed or differs from plugin location');
    }
    const definitions = toolDefinitions.map(definition => ({name:definition.name,description:definition.modelDescription
      + (definition.name === 'pulso_history' ? ' Filtros planos, sin request.' : ' Envelope nativo: {request:{action,...}}.')
      + ' output es el recibo estructurado y content conserva su JSON. ok:true confirma la operación, no el cierre del objetivo.',
      input:nativeInputSchema(definition.name),output:{type:'object',properties:{ok:{type:'boolean'},title:{type:'string'},output:{type:'string'},provenance:{type:'object'},workspace:{type:'string'}},required:['ok','title','output','provenance','workspace'],additionalProperties:true},options:{codemode:false,permission:definition.name},
      async execute(input,context) {
        const origin = {runtime,host:nativeContext(context)};
        let semantic,assertContext;
        const respond = receipt => nativeResult({...receipt,provenance:origin,workspace:directory});
        try {
          validateInput(nativeInputSchema(definition.name),input);
          semantic = structuredClone(definition.name === 'pulso_history' ? input : input.request);
          if (definition.name === 'pulso_workspace' && attemptActionSchemas[semantic.action]) validateInput(attemptActionSchemas[semantic.action],semantic);
          else validateToolInput(definition.name,semantic);
          assertContext = guard(context);
          assertContext();
          await assertSession(context,assertContext);
        } catch(error) {return respond(failure(error));}
        const action = semantic.action || 'read', resource = semantic.scope || semantic.workId || 'workspace';
        // Denials and cancellation are host rejections, never a successful tool receipt.
        await ctx.permission.assert({sessionID:context.sessionID,agent:context.agent,action:definition.name,resources:[`${action}:${resource}`],save:[`${action}:${resource}`],source:{type:'tool',messageID:context.messageID,id:context.id},metadata:{action,resource,mutating:isMutating(definition.name,semantic)}});
        assertContext();
        await assertSession(context,assertContext);
        let authorization,automaticRecovery,intentSource,automaticProof;
        try {
          authorization = await nativeAuthority(reader,context,directory);
          await assertSession(context,assertContext);
          authorizeTool(directory,definition.name,semantic,{authorization,nativeContext:nativeContext(context),assertContext});
          if (definition.name === 'pulso_workspace' && ['bind_continuity','update_intent'].includes(semantic.action)) {
            try {const {request} = await nativePrimaryRequest(reader,context,directory);const {text,...reference} = request;intentSource = {provenance:'native_user_request',...reference};} catch { /* Optional provenance never invents a user request. */ }
            await assertSession(context,assertContext);
          }
          if (definition.name === 'pulso_workspace' && semantic.action === 'resume_continuity' && semantic.resumeMode === 'automatic') {
            automaticProof = await recovery.proveAutomaticResume(context,semantic,{disposition:'compatible'});
            automaticRecovery = {proof:automaticProof,assertProof:(proof,args) => recovery.assertProof(proof,args,context)};
          }
          assertContext();
        } catch(error) {return respond(failure(error));}
        const usesHome = definition.name === 'pulso_workspace' && ['prepare','recover'].includes(semantic.action)
          || definition.name === 'pulso_context' && (['user','all'].includes(semantic.scope) || semantic.action === 'summary' && semantic.scope === undefined);
        const relativeHome = path.relative(directory,path.resolve(homeDir));
        if (usesHome && (relativeHome === '..' || relativeHome.startsWith('..'+path.sep) || path.isAbsolute(relativeHome))) {
          const external = path.join(path.resolve(homeDir),'.pulso') + '/**';
          await ctx.permission.assert({sessionID:context.sessionID,agent:context.agent,action:'external_directory',resources:[external],save:[external],source:{type:'tool',messageID:context.messageID,id:context.id},metadata:{tool:definition.name,action,scope:'user_metadata',mutating:isMutating(definition.name,semantic)}});
          assertContext();await assertSession(context,assertContext);
        }
        let receipt;
        if (definition.name === 'pulso_workspace' && attemptActionSchemas[semantic.action]) receipt = {title:'Pulso · Intentos',output:'Observación pasiva; no confirma actividad ni aceptación.',ok:true,data:{items:readDelegationAttempts(directory,semantic),liveness:'unknown',acceptance:'not_assessed'}};
        else receipt = await executeTool(definition.name,semantic,{projectRoot:directory,homeDir,resourceRoot,assertContext,nativeContext:nativeContext(context),authorization,automaticRecovery,intentSource});
        if (automaticProof && receipt.ok) {
          try {
            const captures = await recovery.replayStoredReturns(automaticProof,receipt,entry => durable.replay(entry));
            receipt = {...receipt,data:{...receipt.data,recovery:{...captures,capturePending:captures.pending.length>0}}};
          } catch(error) {receipt = {...receipt,data:{...receipt.data,recovery:{ownerTransferred:true,capturePending:true,stored:[],pending:[{reason:error.code || 'CAPTURE_PENDING'}],physicalCessation:'unknown'}}};}
        }
        try {assertContext();} catch(error) {receipt = {...receipt,ok:false,contextChanged:true,output:`${receipt.output}\nContext changed after invocation: ${error.message}`};}
        return respond(receipt);
      },
    }));
    await ctx.tool.transform(editor => {for (const definition of definitions) editor.add(definition);});
    async function observe(kind,event) {
      try {
        if (!exists(directory,'.pulso/state.json') || event.tool !== 'subagent') return;
        if (!correlatedSubagent(directory,event.input,readJSON(resourceRoot,'agents/catalog.json'))) return;
        observer ??= createDelegationObserver(directory);
        await observer[kind](event);
      } catch { /* Passive observation never controls execution. */ }
    }
    await ctx.tool.hook('execute.before',async event => {await durable.before(event);await observe('before',event);});
    await ctx.tool.hook('execute.after',async event => {await durable.after(event);await observe('after',event);});
    await ctx.session.hook('context',event => recovery.context(event));
    const controller = new AbortController();
    // Live authority must not queue behind replay network reads. This subscriber
    // performs no I/O and carries no durable/restart authority.
    const liveEvents = (async () => {
      try {for await (const event of ctx.event.subscribe({signal:controller.signal})) {
        reader.observe?.(event);
        if (event.type === 'session.moved' && event.data?.sessionID) moved.set(event.data.sessionID,(moved.get(event.data.sessionID) || 0)+1);
      }} catch { /* Missing live proof fails closed. */ }
    })();
    const events = (async () => {
      try {
        for await (const event of ctx.event.subscribe({signal:controller.signal})) {
          try {await durable.event(event);} catch { /* Missing replay evidence remains pending; never retry dispatch. */ }
          if (observer) await observer.event(event);
        }
      } catch { /* Public event stream is volatile. Durable replay is authoritative. */ }
    })();
    return async () => {disposed=true;controller.abort();await Promise.all([events,liveEvents]);};
  }};
}
export default createPulsoPlugin();
