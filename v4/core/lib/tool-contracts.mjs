/** One runtime-neutral contract source. Adapters only translate these descriptors. */
import {schema as persistedSchema, validateSchema, checkSchemaVocabulary, schemaError} from './schema.mjs';

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
// task.add inherits optional evidenceIds/summary from work-update; core fills
// their defaults before validating Work against the complete persisted task shape.
const mutationInput = clone(persistedSchema('work-update'));
mutationInput.properties.actions.items.anyOf = mutationInput.properties.actions.items.anyOf.map(shape=>{
  if(shape.properties.type.const==='evidence.add')shape.properties.evidence=observedEvidenceSchema(shape.properties.evidence);
  if(shape.properties.type.const==='work.set_overview')return atLeastOne(shape,Object.keys(shape.properties).filter(key=>key!=='type'));
  if(shape.properties.type.const==='task.update')shape.properties.patch=atLeastOne(shape.properties.patch,Object.keys(shape.properties.patch.properties));
  if(shape.properties.type.const==='criterion.update')return atLeastOne(shape,['description','verification','acceptanceMode']);
  return shape;
});
export const mutationSchema = mutationInput.properties.actions.items;
const createInput = persistedSchema('work-create');
const resultInput = clone(persistedSchema('result'));
const compactResultInput = object({
  ...Object.fromEntries(['status','summary','artifacts','changedFiles','checks','findings','questions','limitations','suggestedNextStep'].map(key=>[key,clone(resultInput.properties[key])])),
  markdown:{type:'string',minLength:1,pattern:'\\S'}
},['status','summary','markdown']);
const strings={type:'array',items:text(2000),maxItems:50};
const ids={type:'array',items:id,maxItems:50};
const continuityRef={continuityId:id,intentRevision:integer(1)};
const v2={contractVersion:{const:2}};
const reportedReturn=object({captureKey:id,markdown:text(1000000),completeness:enumeration(['complete','truncated','unknown'])},['captureKey','markdown']);
const decisionSchema=object({...Object.fromEntries(Object.entries(compactResultInput.properties).filter(([key])=>key!=='markdown')),acceptedTaskIds:ids},['status','summary']);
export function validateDecision(value){
  validateInput(decisionSchema,value);
  if(value.status==='completed'&&!Object.hasOwn(value,'acceptedTaskIds'))throw new Error('completed requiere acceptedTaskIds explícitos');
  if(value.status!=='completed'&&value.acceptedTaskIds?.length)throw new Error('Sólo completed admite acceptedTaskIds no vacío');
  return value;
}
const workspaceActions = {
  prepare:action('prepare'),
  bind_continuity:action('bind_continuity',{workId:id,requestKey:id,continuityId:id,objective:text(),repositories:strings,constraints:strings,sourceText:text(8000)},['workId','requestKey','objective','repositories','constraints']),
  get_continuity:action('get_continuity',{continuityId:id},['continuityId']),
  update_intent:action('update_intent',{continuityId:id,expectedRevision:integer(1),objective:text(),constraints:strings,repositories:strings,compatibleDelegationIds:ids},['continuityId','expectedRevision','objective','constraints']),
  status:action('status',{...readPage,continuityId:id,status:enumeration(['pending','in_progress','blocked','paused'])}),
  validate:action('validate',{fresh:{type:'boolean'}}),
  sync:action('sync',workRef,['workId','expectedRevision']),
  recover:action('recover')
};
const workActions = {
  get:action('get',{workId:id,section:enumeration(['overview','tasks','criteria','evidence','results','documents','blockers','decisions','acceptanceChanges','all']),...readPage},['workId']),
  get_delegation:action('get_delegation',{workId:id,delegationId:id,continuityId:id},['workId','delegationId']),
  reconcile_delegation:action('reconcile_delegation',{workId:id,delegationId:id,...continuityRef,reason:text(2000),source:object({text:text(8000),messageRef:text(2000)},['text']),resolution:enumeration(['not_dispatched','reported_terminal','retired','explicitly_reconciled'])},['workId','delegationId','continuityId','intentRevision','reason','resolution']),
  prepare_delegation:action('prepare_delegation',{
    workId:id,taskIds:{type:'array',items:id,minItems:1,maxItems:50},delegationId:id,objective:text(),
    inputs:clone(persistedSchema('delegation').properties.inputs),output:clone(persistedSchema('delegation').properties.output),
    constraints:clone(persistedSchema('delegation').properties.constraints),templateId:clone(persistedSchema('delegation').properties.templateId)
  },['workId','taskIds','delegationId','objective','inputs','output','constraints','templateId']),
  accept_result:action('accept_result',{
    ...workRef,delegation:clone(persistedSchema('delegation')),acceptanceBasis:clone(persistedSchema('evidence').properties.acceptanceBasis),
    result:{anyOf:[resultInput,compactResultInput]},acceptedTaskIds:{type:'array',items:id,minItems:0,maxItems:50,description:'Selección explícita obligatoria para completed; para otros estados se omite o es [].'},summary:text(2000)
  },['workId','expectedRevision','delegation','acceptanceBasis','result','summary']),
  accept_delivery:action('accept_delivery',{
    ...workRef,operationId:id,summary:text(2000),criterionIds:{type:'array',items:id,minItems:1,maxItems:50},
    source:object({text:text(8000),messageRef:text(2000)},['text']),limitations:{type:'array',items:text(1000),maxItems:30}
  },['workId','expectedRevision','summary','criterionIds','source','limitations']),
  validate_result:action('validate_result',{delegation:clone(persistedSchema('delegation')),result:clone(persistedSchema('result'))},['delegation','result']),
  create:action('create',clone(createInput.properties),clone(createInput.required)),
  update:action('update',mutationInput.properties,mutationInput.required),
  block:action('block',{...workRef,summary:text(2000),reason:text(500)},['workId','expectedRevision','summary','reason']),
  close:action('close',{...workRef,outcome:enumeration(['done','cancelled']),summary:text(4000),limitations:{type:'array',items:text(1000),maxItems:30}},['workId','expectedRevision','summary']),
  close_by_user:action('close_by_user',{
    ...workRef,operationId:id,summary:text(4000),
    source:{...object({text:text(8000),messageRef:text(2000)},['text']),description:'Petición explícita de cierre del usuario: aprueba todos los criterios y tareas no canceladas por autoridad del usuario. El host suministra la declaración; core no autentica autoría ni intención del texto. No inferir autorización desde tests/evidencia ni validar lenguaje con regex.'},
    limitations:{type:'array',items:text(1000),maxItems:30}
  },['workId','expectedRevision','operationId','summary','source','limitations']),
  reopen:action('reopen',{...workRef,reason:text(2000)},['workId','expectedRevision','reason'])
};
const legacyPrepare=workActions.prepare_delegation,legacyAccept=workActions.accept_result;
workActions.prepare_delegation={anyOf:[legacyPrepare,action('prepare_delegation',{
  ...v2,...workRef,...continuityRef,requestKey:id,
  ...Object.fromEntries(['taskIds','objective','inputs','output','constraints','templateId'].map(key=>[key,legacyPrepare.properties[key]])),
  integrationResources:strings,stableReadScope:strings
},['contractVersion','workId','expectedRevision','continuityId','intentRevision','requestKey','taskIds','objective','inputs','output','constraints','templateId'])]};
workActions.accept_result={anyOf:[legacyAccept,...['returnId','reportedReturn'].map(transport=>action('accept_result',{
  ...v2,...workRef,...continuityRef,delegationId:id,operationId:id,
  [transport]:transport==='returnId'?id:reportedReturn,
  decision:{type:'object',additionalProperties:true},reportedTerminal:{type:'boolean'}
},['contractVersion','workId','expectedRevision','continuityId','intentRevision','delegationId','operationId',transport,'decision']))]};
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
  for(const shape of Object.values(actions).flatMap(shape=>shape.anyOf||[shape]))for(const [key,value] of Object.entries(shape.properties)){
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
  pulso_workspace:descriptor('pulso_workspace','Workspace','Prepara, consulta, valida, sincroniza o recupera metadatos Pulso. bind_continuity vincula un objetivo; continuityId explícito permite retomar en otra sesión. get_continuity devuelve la cápsula; update_intent preserva sólo compatibleDelegationIds explícitos. status admite continuityId sin adoptar foco global. status devuelve data.works con items completos y nextCursor; sigue hasMore.',workspaceActions,['prepare','sync','recover','bind_continuity','update_intent']),
  pulso_work:descriptor('pulso_work','Trabajo','Consulta o actualiza un objetivo. get devuelve readiness, páginas y acceptanceBasis. prepare_delegation es mutación: contractVersion:2 conserva snapshot/base/prompt por requestKey y devuelve delegationId y specialistPrompt. get_delegation recupera contrato, retornos e intentos. accept_result v2 recibe IDs, operationId y returnId XOR reportedReturn; captura Markdown antes de validar decision. decision contiene status, summary, acceptedTaskIds explícitos para completed y detalles result opcionales. reportedTerminal resuelve sólo una reserva reportada; no prueba cese físico. reconcile_delegation no detiene agentes. Legacy sigue admitido. accept_delivery conserva aceptación manual declarada e intenta cierre; no completa tareas. validate_result valida sin escribir. Ningún retorno satisface criterios automáticamente ni prueba ejecución.',workActions,['create','update','block','close','reopen','prepare_delegation','reconcile_delegation','accept_result','accept_delivery']),
  pulso_history:descriptor('pulso_history','Historial','Consulta cierres con fechas, ciclos, resumen completo, limitaciones y referencias. data.items se pagina con limit/cursor; sigue hasMore y nextCursor. Cambiar historial o filtros invalida el cursor.',null,[],historySchema),
  pulso_context:descriptor('pulso_context','Contexto','Consulta o registra contexto, preferencias y aprendizajes. read devuelve entradas completas, revisions y nextCursor. Las escrituras exigen scope y expectedRevision; preferencias y aprendizajes requieren source explícito. summary es una vista limitada a 8000 caracteres.',contextActions,['set_context','set_preference','remove_preference','add_learning'])
};
toolContracts.pulso_work.mutatingActions.push('close_by_user');
toolContracts.pulso_work.modelDescription+=' close_by_user cierra done con verificación user_approved: todos los criterios y tareas no canceladas revisados y aprobados por usuario, readiness true y sin bloqueos pendientes. Conserva diagnóstico anterior como histórico, evidencia/resultados intactos y cancelaciones legítimas. No acredita ejecución de tests ni cese de agentes. Requiere source declarada por el host (core no autentica el texto), operationId y revisión; no inferir petición desde evidencia. Encargos pendientes requieren reconciliación previa.';
function freeze(value){if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
for(const descriptor of Object.values(toolContracts)){
  checkSchemaVocabulary(descriptor.inputSchema);
  for(const shape of Object.values(descriptor.actionSchemas||{}))checkSchemaVocabulary(shape);
}
freeze(toolContracts);
export const toolDefinitions=Object.freeze(Object.values(toolContracts).map(({actionSchemas,mutatingActions,...definition})=>Object.freeze(definition)));
export function isMutating(name,input){return Boolean(toolContracts[name]?.mutatingActions.includes(input?.action));}

function assertJSON(value,at='input',seen=new Set(),depth=0){
  if(depth>64)throw new Error('JSON demasiado profundo');
  if(value===null||typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))return;
  if(!value||typeof value!=='object'||!Array.isArray(value)&&![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw new Error(`${at}: se requiere un valor JSON simple`);
  if(seen.has(value))throw new Error(`${at}: referencia circular no admitida`);
  seen.add(value);
  for(const [key,item] of Object.entries(value))assertJSON(item,`${at}.${key}`,seen,depth+1);
  seen.delete(value);
}
export function validateInput(shape,input){
  assertJSON(input);
  const errors=validateSchema(shape,input);
  if(errors.length)throw schemaError('input',errors);
  return input;
}
/** Throws before native context resolution or writes. Returns the original input. */
export function validateToolInput(definitionOrName,input){
  const name=typeof definitionOrName==='string'?definitionOrName:definitionOrName?.name;
  const descriptor=toolContracts[name];
  if(!descriptor)throw new Error(`Herramienta no admitida: ${String(name)}`);
  if(descriptor.actionSchemas){
    validateInput({type:'object',properties:{action:enumeration(Object.keys(descriptor.actionSchemas))},required:['action'],additionalProperties:true},input);
    const shape=descriptor.actionSchemas[input.action];
    if(!shape)throw new Error(`Acción no admitida: ${String(input.action)}`);
    validateInput(shape,input);
  }else validateInput(descriptor.inputSchema,input);
  if(input.contractVersion===2&&JSON.stringify(input).length>1100000)throw new Error('Transporte v2 demasiado grande');
  if(input.contractVersion===2&&input.decision&&JSON.stringify(input.decision).length>64000)throw new Error('decision demasiado grande');
  if(name==='pulso_work'&&input.action==='reconcile_delegation'&&input.resolution==='explicitly_reconciled'&&!input.source)throw new Error('explicitly_reconciled requiere source');
  if(name==='pulso_work'&&input.action==='accept_result'&&input.contractVersion!==2){
    if(input.result.status==='completed'&&!Object.hasOwn(input,'acceptedTaskIds'))throw new Error('completed requiere acceptedTaskIds explícitos');
    if(input.result.status!=='completed'&&input.acceptedTaskIds?.length)throw new Error('Sólo completed admite acceptedTaskIds no vacío');
  }
  if(name==='pulso_history'&&input.since&&input.until&&Date.parse(input.since)>Date.parse(input.until))throw new Error('since debe ser anterior o igual a until');
  return input;
}
