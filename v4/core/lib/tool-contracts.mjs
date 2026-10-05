/** One runtime-neutral contract source. Adapters only translate these descriptors. */
import {schema as persistedSchema, validateSchema, checkSchemaVocabulary} from './schema.mjs';

const text = (maxLength=4000,{blank=false}={}) => ({type:'string',maxLength,...(blank?{}:{minLength:1,pattern:'\\S'})});
const enumeration = values => ({type:'string',enum:values});
const id = {type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$',minLength:1,maxLength:80};
const integer = (minimum,maximum) => ({type:'integer',minimum,...(maximum===undefined?{}:{maximum})});
const object = (properties,required=[]) => ({type:'object',properties,required,additionalProperties:false});
const clone = value => structuredClone(value);
const action = (name,properties={},required=[]) => object({action:{type:'string',const:name},...properties},['action',...required]);
const readPage = {limit:integer(1,100),cursor:text(4000)};
const workRef = {workId:id,expectedRevision:integer(1)};
const memoryRef = {scope:enumeration(['project','user']),expectedRevision:integer(1)};
const source = enumeration(['user','observed','delegated']);
const atLeastOne = (shape,fields) => ({anyOf:fields.map(field=>({...clone(shape),required:[...new Set([...(shape.required||[]),field])]}))});

// Advertise the same execution rules enforced by the core without tightening
// historical persisted schemas. Each anyOf branch must be a complete shape:
// the bundled validator deliberately treats alternatives independently.
function observedEvidenceSchema(shape){
  const variant=(kind,status,exitCode,command)=>{
    const value=clone(shape);
    Object.assign(value.properties,{kind,status,exitCode,command});
    return value;
  };
  return {description:'Evidencia observada completa. static/manual/not_run requieren exitCode:null. Una revisión estática usa command:null; calcular SHA-256 no convierte la revisión en executed. executed con status:pass requiere comando no vacío y exitCode:0. files incluye el SHA-256 real del informe y acceptanceBasis procede de get antes de observar.',anyOf:[
    variant(enumeration(['static','manual']),clone(shape.properties.status),{type:'null'},clone(shape.properties.command)),
    variant({const:'not_run'},enumeration(['not_run','blocked']),{type:'null'},clone(shape.properties.command)),
    variant({const:'executed'},{const:'pass'},{type:'integer',const:0},clone(shape.properties.command.anyOf.find(item=>item.type==='string'))),
    variant({const:'executed'},enumeration(['fail','blocked','not_run']),clone(shape.properties.exitCode),clone(shape.properties.command))
  ]};
}

// Reuse persisted contracts, adding native non-empty and execution checks.
const mutationInput = clone(persistedSchema('work-update'));
mutationInput.properties.actions.items.anyOf = mutationInput.properties.actions.items.anyOf.map(shape=>{
  if(shape.properties.type.const==='evidence.add')shape.properties.evidence=observedEvidenceSchema(shape.properties.evidence);
  if(shape.properties.type.const==='work.set_overview')return atLeastOne(shape,Object.keys(shape.properties).filter(key=>key!=='type'));
  if(shape.properties.type.const==='task.update')shape.properties.patch=atLeastOne(shape.properties.patch,Object.keys(shape.properties.patch.properties));
  if(shape.properties.type.const==='criterion.update')return atLeastOne(shape,['description','verification']);
  return shape;
});
export const mutationSchema = mutationInput.properties.actions.items;
const createInput = persistedSchema('work-create');
const workspaceActions = {
  prepare:action('prepare'),
  status:action('status',{...readPage,status:enumeration(['pending','in_progress','blocked','paused'])}),
  validate:action('validate',{fresh:{type:'boolean'}}),
  sync:action('sync',workRef,['workId','expectedRevision']),
  recover:action('recover')
};
const workActions = {
  get:action('get',{workId:id,section:enumeration(['overview','tasks','criteria','evidence','documents','blockers','decisions','acceptanceChanges','all']),...readPage},['workId']),
  validate_result:action('validate_result',{delegation:clone(persistedSchema('delegation')),result:clone(persistedSchema('result'))},['delegation','result']),
  create:action('create',clone(createInput.properties),clone(createInput.required)),
  update:action('update',mutationInput.properties,mutationInput.required),
  block:action('block',{...workRef,summary:text(2000),reason:text(500)},['workId','expectedRevision','summary','reason']),
  close:action('close',{...workRef,outcome:enumeration(['done','cancelled']),summary:text(4000),limitations:{type:'array',items:text(1000),maxItems:30}},['workId','expectedRevision','summary']),
  reopen:action('reopen',{...workRef,reason:text(2000)},['workId','expectedRevision','reason'])
};
const contextActions = {
  read:action('read',{scope:enumeration(['project','user','all']),section:enumeration(['context','preferences','learning','all']),key:text(120),...readPage}),
  summary:action('summary',{scope:enumeration(['project','user','all'])}),
  set_context:action('set_context',{...memoryRef,context:text(4000,{blank:true})},['scope','expectedRevision','context']),
  set_preference:action('set_preference',{...memoryRef,key:text(120),value:text(1000),source},['scope','expectedRevision','key','value','source']),
  remove_preference:action('remove_preference',{...memoryRef,key:text(120)},['scope','expectedRevision','key']),
  add_learning:action('add_learning',{...memoryRef,note:text(2000),source},['scope','expectedRevision','note','source'])
};
const historySchema=object({workId:id,since:{type:'string',format:'date-time'},until:{type:'string',format:'date-time'},...readPage});

/** Derive the flat advertised superset from strict action descriptors. */
function flatSchema(actions){
  const variants=new Map();
  for(const shape of Object.values(actions))for(const [key,value] of Object.entries(shape.properties)){
    if(key==='action')continue;
    const items=variants.get(key)||[];
    if(!items.some(item=>JSON.stringify(item)===JSON.stringify(value)))items.push(value);
    variants.set(key,items);
  }
  return object({action:enumeration(Object.keys(actions)),...Object.fromEntries([...variants].map(([key,values])=>[key,values.length===1?values[0]:{anyOf:values}]))},['action']);
}
function descriptor(name,displayName,modelDescription,actions,mutatingActions=[],inputSchema){
  return {name,displayName:`Pulso · ${displayName}`,modelDescription,canBeReferencedInPrompt:true,toolReferenceName:name,inputSchema:inputSchema||flatSchema(actions),actionSchemas:actions,mutatingActions};
}
export const toolContracts={
  pulso_workspace:descriptor('pulso_workspace','Workspace','Prepara, consulta, valida, sincroniza o recupera metadatos Pulso. status devuelve data.works con items completos y nextCursor; sigue hasMore. Los cursores caducan al cambiar el índice o los filtros.',workspaceActions,['prepare','sync','recover']),
  pulso_work:descriptor('pulso_work','Trabajo','Consulta o actualiza un objetivo. get devuelve data completo por section, con páginas limit/cursor y acceptanceBasis; sigue data.hasMore y data.nextCursor. Los cursores caducan al cambiar Work o section. validate_result valida sin escribir. create permite omitir workId y crea el criterio AC-1; las demás mutaciones requieren ID y revisión. evidence.add exige evidencia completa: static/manual/not_run usan exitCode:null; la revisión estática usa command:null, files con SHA-256 reales y acceptanceBasis obtenida antes de observar. Calcular una huella no es una prueba executed.',workActions,['create','update','block','close','reopen']),
  pulso_history:descriptor('pulso_history','Historial','Consulta cierres con fechas, ciclos, resumen completo, limitaciones y referencias. data.items se pagina con limit/cursor; sigue hasMore y nextCursor. Cambiar historial o filtros invalida el cursor.',null,[],historySchema),
  pulso_context:descriptor('pulso_context','Contexto','Consulta o registra contexto, preferencias y aprendizajes. read devuelve entradas completas, revisions y nextCursor. Las escrituras exigen scope y expectedRevision; preferencias y aprendizajes requieren source explícito. summary es una vista limitada a 8000 caracteres.',contextActions,['set_context','set_preference','remove_preference','add_learning'])
};
function freeze(value){if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
for(const descriptor of Object.values(toolContracts)){
  checkSchemaVocabulary(descriptor.inputSchema);
  for(const shape of Object.values(descriptor.actionSchemas||{}))checkSchemaVocabulary(shape);
}
freeze(toolContracts);
export const toolDefinitions=Object.freeze(Object.values(toolContracts).map(({actionSchemas,mutatingActions,...definition})=>Object.freeze(definition)));
export function isMutating(name,input){return Boolean(toolContracts[name]?.mutatingActions.includes(input?.action));}

function assertJSON(value,at='input',seen=new Set()){
  if(value===null||typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))return;
  if(!value||typeof value!=='object'||!Array.isArray(value)&&![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw new Error(`${at}: se requiere un valor JSON simple`);
  if(seen.has(value))throw new Error(`${at}: referencia circular no admitida`);
  seen.add(value);
  for(const [key,item] of Object.entries(value))assertJSON(item,`${at}.${key}`,seen);
  seen.delete(value);
}
export function validateInput(shape,input){
  assertJSON(input);
  const errors=validateSchema(shape,input);
  if(errors.length)throw new Error(`input: ${errors.join('; ')}`);
  return input;
}
/** Throws before native context resolution or writes. Returns the original input. */
export function validateToolInput(definitionOrName,input){
  const name=typeof definitionOrName==='string'?definitionOrName:definitionOrName?.name;
  const descriptor=toolContracts[name];
  if(!descriptor)throw new Error(`Herramienta no admitida: ${String(name)}`);
  validateInput(descriptor.inputSchema,input);
  if(descriptor.actionSchemas){
    const shape=descriptor.actionSchemas[input.action];
    if(!shape)throw new Error(`Acción no admitida: ${String(input.action)}`);
    validateInput(shape,input);
  }
  if(name==='pulso_history'&&input.since&&input.until&&Date.parse(input.since)>Date.parse(input.until))throw new Error('since debe ser anterior o igual a until');
  return input;
}
