import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const string = maxLength => ({type:'string', ...(maxLength === undefined ? {} : {maxLength})});
const enumeration = values => ({type:'string', enum:values});
const id = {type:'string', pattern:'^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$', minLength:1, maxLength:80};
const integer = (minimum, maximum) => ({type:'integer', minimum, ...(maximum === undefined ? {} : {maximum})});
const schema = (properties, required = []) => ({type:'object', properties, required, additionalProperties:false});
const definition = (name, displayName, modelDescription, inputSchema) => ({name, displayName, modelDescription, canBeReferencedInPrompt:true, toolReferenceName:name, inputSchema});

export const toolDefinitions = [
  definition('pulso_workspace', 'Pulso · Workspace', 'Prepara, consulta, valida, sincroniza o recupera Pulso explícitamente. attempts/reconcile_attempts consultan telemetría sin declarar agentes vivos ni modificar Work.', schema({
    action:enumeration(['prepare','status','validate','sync','recover','attempts','reconcile_attempts']), fresh:{type:'boolean'}, workId:id, expectedRevision:integer(1), sessionID:string(160), limit:integer(1,100)
  }, ['action'])),
  definition('pulso_work', 'Pulso · Trabajo', 'Consulta o actualiza un objetivo de trabajo. create permite omitir workId; las demás acciones requieren ID explícito.', schema({
    action:enumeration(['get','create','update','block','close','reopen','complete_map']), workId:id, title:string(240), objective:string(4000), criterion:string(2000), verification:string(2000), priority:enumeration(['low','normal','high','urgent']), expectedRevision:integer(1),
    actions:{type:'array', minItems:1, maxItems:20, items:{type:'object', additionalProperties:true}}, outcome:enumeration(['done','cancelled']), summary:string(4000), limitations:{type:'array', maxItems:30, items:string(1000)}, reason:string(2000)
  }, ['action'])),
  definition('pulso_history', 'Pulso · Historial', 'Consulta cierres recientes de Pulso con resultado resumido.', schema({workId:id, since:string(), until:string(), limit:integer(1,20)})),
  definition('pulso_context', 'Pulso · Contexto', 'Consulta o registra contexto relevante, preferencias y aprendizajes. summary devuelve contexto, preferencias key/value/source y aprendizajes note/source del ámbito solicitado; sin scope incluye proyecto y usuario. Salida limitada a 8000 caracteres con aviso de truncación. Las preferencias de usuario se conservan entre workspaces y sesiones.', schema({
    action:enumeration(['summary','set_context','set_preference','remove_preference','add_learning']), context:string(4000), key:string(120), value:string(1000), scope:enumeration(['project','user']), note:string(2000), source:enumeration(['user','observed','delegated'])
  }, ['action']))
];

/** Validate the simple JSON Schema subset used above, without host dependencies. */
export function validateInput(schema, value, location = 'input') {
  const invalid = message => {throw new Error(`${location}: ${message}`);};
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype,null].includes(Object.getPrototypeOf(value))) invalid('se requiere objeto');
    for (const key of schema.required || []) if (!Object.hasOwn(value,key)) invalid(`falta ${key}`);
    for (const key of Object.keys(value)) {
      if (Object.hasOwn(schema.properties || {},key)) validateInput(schema.properties[key],value[key],`${location}.${key}`);
      else if (schema.additionalProperties === false) invalid(`campo no admitido: ${key}`);
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(value)) invalid('se requiere lista');
    if (value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? Infinity)) invalid('longitud de lista inválida');
    for (let index = 0; index < value.length; index++) validateInput(schema.items,value[index],`${location}[${index}]`);
  } else if (schema.type === 'string') {
    if (typeof value !== 'string') invalid('se requiere texto');
    if (value.length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? Infinity)) invalid('longitud de texto inválida');
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) invalid('formato inválido');
  } else if (schema.type === 'integer') {
    if (!Number.isSafeInteger(value) || value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity)) invalid('entero fuera de rango');
  } else if (schema.type === 'boolean' && typeof value !== 'boolean') invalid('se requiere booleano');
  if (schema.enum && !schema.enum.includes(value)) invalid('valor no admitido');
  return value;
}

const ok = (title,output) => ({title:`Pulso · ${title}`, output, ok:true});
const fail = (title,error) => ({title:`Pulso · ${title}`, output:`No se completó: ${String(error?.message || 'operación inválida').slice(0,240)}`, ok:false});

function memorySummary(project,user) {
  const primary = project || user;
  const counts = project && user ? `${project.preferences.length} del proyecto, ${user.preferences.length} del usuario` : `${primary.preferences.length} del ${project ? 'proyecto' : 'usuario'}`;
  const prefix = `Contexto: ${primary.context ? primary.context.slice(0,180) : 'sin notas'} · preferencias: ${counts} · aprendizajes: ${primary.learning.length}`;
  function* lines() {
    yield prefix;
    for (const [scope,value] of [['proyecto',project],['usuario',user]]) {
      if (!value) continue;
      yield `\nMemoria de ${scope}:\nContexto: ${JSON.stringify(value.context)}`;
      for (const preference of value.preferences) yield `\nPreferencia: ${JSON.stringify({key:preference?.key,value:preference?.value,source:preference?.source})}`;
      for (const lesson of value.learning) yield `\nAprendizaje: ${JSON.stringify({note:lesson?.note,source:lesson?.source})}`;
    }
  }
  const limit = 8000, notice = '\n[Contenido truncado; límite total de 8000 caracteres.]';
  let output = '';
  for (const line of lines()) {
    if (output.length + line.length > limit) return (output + line).slice(0,limit - notice.length) + notice;
    output += line;
  }
  return output;
}

/** root is supplied by the trusted host adapter, never by model input. */
export async function createPulsoTools({coreDir,homeDir = os.homedir(),assertContext = () => {}} = {}) {
  const directory = coreDir || fileURLToPath(new URL('../resources/lib/',import.meta.url));
  const core = async name => {
    assertContext();
    const module = await import(pathToFileURL(path.join(directory,name)).href);
    assertContext();
    return module;
  };
  const handlers = {
    async pulso_workspace(args,root) {
      if (['attempts','reconcile_attempts'].includes(args.action)) {
        const {readDelegationAttempts} = await core('delegation-observer.mjs');
        const values = readDelegationAttempts(root,args);
        return ok('intentos',values.length ? values.map(value => `${value.sessionID}/${value.callID} · workId=${value.workId || 'sin correlación'} · taskId=${value.taskId || 'sin correlación'} · ${value.status} · vida desconocida${value.requiresReview ? ' · revisar artefactos y cambios manuales antes de retomar' : ''}`).join('\n') : 'Sin intentos observados.');
      }
      if (args.action === 'sync') {
        if (!args.workId || !args.expectedRevision) throw new Error('sync requiere workId y expectedRevision');
        const mutations = await core('work-mutations.mjs'), {formatReceipt} = await core('receipts.mjs');
        return ok('sincronización',formatReceipt(await mutations.syncWorkOperation(root,{workId:args.workId,expectedRevision:args.expectedRevision})));
      }
      if (args.action === 'recover') {
        const mutations = await core('work-mutations.mjs');
        await mutations.recoverWorkspaceOperation(root);
        return ok('recuperación','Recuperación completada. Consulta status para revisar el índice; no se reanudaron sesiones nativas.');
      }
      if (args.action === 'prepare') {
        const {prepareWorkspace} = await core('workspace.mjs');
        const result = prepareWorkspace(root,{homeDir});
        return ok('workspace',result.existingWorkspace ? 'Ya estaba preparado.' : result.legacyMigrated ? `Preparado y migrados ${result.migratedWorks} trabajos legacy.` : 'Preparado para el encargo actual.');
      }
      if (args.action === 'status') {
        const statePath = path.join(root,'.pulso','state.json');
        if (!fs.existsSync(statePath)) return ok('estado','Sin estado Pulso disponible en este workspace.');
        const {readStatus} = await core('work-mutations.mjs');
        let value;
        try {value = readStatus(root);} catch (error) {
          const saved = JSON.parse(fs.readFileSync(statePath,'utf8'));
          if (saved && saved.schemaVersion === undefined && saved.schema_version === 1) return ok('estado','Estado legacy detectado. Usa prepare para migrarlo al contrato actual.');
          throw error;
        }
        const focus = value.works.find(work => work.id === value.focusWorkId);
        return ok('estado',focus ? `${focus.id} · ${focus.status} · ${focus.progress.done}/${focus.progress.total} · siguiente: ${focus.nextAction || 'sin acción'}` : `${value.works.length} trabajos abiertos · sin foco`);
      }
      const {validateWorkspace} = await core('work-mutations.mjs');
      const value = validateWorkspace(root,{fresh:args.fresh || false});
      return ok('validación',`${value.works} trabajos válidos${args.fresh ? ' · evidencia vigente comprobada' : ''}`);
    },
    async pulso_work(args,root) {
      if (args.action !== 'create' && !args.workId) throw new Error(`${args.action} requiere workId`);
      const mutations = await core('work-mutations.mjs'), receipts = await core('receipts.mjs');
      if (args.action === 'get') {
        const {readWork} = await core('artifacts.mjs');
        const value = readWork(root,args.workId,{files:false});
        return ok('trabajo',`${value.id} · rev. ${value.revision} · ${value.status} · tareas ${value.tasks.filter(task => task.status === 'done').length}/${value.tasks.length} · siguiente: ${value.nextAction || 'sin acción'}`);
      }
      if (args.action === 'create') {
        const input = Object.fromEntries(['workId','title','objective','criterion','verification','priority'].filter(key => args[key] !== undefined).map(key => [key,args[key]]));
        return ok('trabajo',receipts.formatReceipt(mutations.createWorkOperation(root,input)));
      }
      if (args.action === 'update') return ok('trabajo',receipts.formatReceipt(mutations.applyWorkMutation(root,{workId:args.workId,expectedRevision:args.expectedRevision,actions:args.actions})));
      if (args.action === 'block') return ok('trabajo',receipts.formatReceipt(mutations.applyWorkMutation(root,{workId:args.workId,expectedRevision:args.expectedRevision,actions:[{type:'work.set_overview',status:'blocked',summary:args.summary,blockers:[args.reason],nextAction:'Resolver el bloqueo antes de continuar'}]})));
      if (args.action === 'close') return ok('trabajo',receipts.formatReceipt(mutations.closeWorkOperation(root,{workId:args.workId,expectedRevision:args.expectedRevision,outcome:args.outcome,summary:args.summary,limitations:args.limitations || []})));
      if (args.action === 'complete_map') {
        const value = mutations.completeMapOperation(root,{workId:args.workId,expectedRevision:args.expectedRevision,summary:args.summary,limitations:args.limitations || []});
        return ok('mapeo',`${value.id} cerrado · rev. ${value.revision}`);
      }
      return ok('trabajo',receipts.formatReceipt(mutations.reopenWorkOperation(root,{workId:args.workId,expectedRevision:args.expectedRevision,reason:args.reason})));
    },
    async pulso_history(args,root) {
      const {exists} = await core('fs.mjs');
      if (!exists(root,'.pulso/history.jsonl')) return ok('historial','Sin cierres para esta consulta.');
      const {readHistory} = await core('work-mutations.mjs');
      const values = readHistory(root,args);
      return ok('historial',values.length ? values.map(value => `${value.workId} · ${value.outcome} · ${value.summary.slice(0,160)}`).join('\n') : 'Sin cierres para esta consulta.');
    },
    async pulso_context(args,root) {
      const memory = await core('memory.mjs');
      if (args.action !== 'summary') memory.updateMemory(root,args,{homeDir});
      const project = args.scope === 'user' ? null : memory.readMemory(root,'project',{homeDir});
      const user = args.scope === 'project' ? null : memory.readMemory(root,'user',{homeDir});
      return ok('contexto',memorySummary(project,user));
    }
  };
  return Object.fromEntries(toolDefinitions.map(def => [def.name,{execute:async (input,root) => {
    try {
      assertContext();
      validateInput(def.inputSchema,input);
      if (typeof root !== 'string' || !path.isAbsolute(root)) throw new Error('El adaptador debe proporcionar root absoluto');
      return await handlers[def.name](input,root);
    } catch (error) {return fail(def.displayName.replace('Pulso · ',''),error);}
  }}]));
}
