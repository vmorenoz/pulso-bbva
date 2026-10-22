import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {readAgentBody,renderPrompt} from '../../scripts/prompts.mjs';
test('renderer substitutes authored slots only and resolves output-relative resources',()=>{
  const text=renderPrompt('{{ADAPTER_BOUNDARY}} {{RESOURCE_CATALOG}} ordinary prose',{boundary:'native instructions',destination:'resources/agents/pulso.agent.md'});
  assert.equal(text,'native instructions [catálogo](catalog.json) ordinary prose');
});
test('unknown, malformed, and recursively unresolved slots fail closed',()=>{
  for(const text of ['{{UNKNOWN}}','{{RESOURCE_CATALOG','{{{{RESOURCE_CATALOG}}']) assert.throws(()=>renderPrompt(text,{boundary:'native',destination:'agents/a.md'}));
  assert.throws(()=>renderPrompt('{{ADAPTER_BOUNDARY}}',{boundary:'{{FORBIDDEN}}',destination:'agents/a.md'}));
});
test('renderer requires explicit native boundary and safe destination',()=>{
  assert.throws(()=>renderPrompt('body',{destination:'agents/a.md'}));
  assert.throws(()=>renderPrompt('body',{boundary:'native',destination:'../outside'}));
});
const coreRoot=fileURLToPath(new URL('../../core/',import.meta.url));
const catalog=JSON.parse(fs.readFileSync(new URL('../../core/agents/catalog.json',import.meta.url)));

function section(text,name) {
  const matches=[...text.matchAll(new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`,'g'))];
  assert.equal(matches.length,1,`one ${name} contract per rendered context`);
  return matches[0][1];
}
function contracts(text,rules) {
  for(const [name,pattern] of rules) assert.match(text,pattern,name);
}

// These are structural instruction checks, not an LLM behavior evaluation.
// Assert scoped obligations and API identifiers, not complete narrative sentences
// or a fixed ordering of every example/role in an enumeration.
function assertKnowledgePolicy(policy,{primary=false}={}) {
  for(const name of ['search','read','outline','related','status','sources','technologies']) assert.ok(policy.includes(`knowledge_${name}`),name);
  const study=/Antes de[^.]*estudi[^.]*/.exec(policy)?.[0];
  assert.ok(study,'study precedes dependent work');
  for(const phase of [/diseñar/,/planificar/,/implementar/,/revisar/,/preparar/,/ejecutar pruebas/,/migrar/]) assert.match(study,phase,'study covers each engineering phase');
  assert.match(study,/tecnología cubierta y confirmada/,'study follows dynamic coverage and observed project context');
  contracts(policy,[
    ['dynamic coverage',/CELLS, APX, ASO[^.\n]*catálogo dinámico/],
    ['catalog before availability claims',/Antes de afirmar disponibilidad[^.\n]*knowledge_technologies/],
    ['host exposes knowledge alias',/pulso-knowledge[^.\n]*alias[^.\n]*host/],
    ['prompts and skills do not prove installation',/no deduzcas disponibilidad[^.\n]*prompts[^.\n]*skills/],
    ['keywords do not activate policy',/keywords[^.\n]*pistas[^.\n]*no[^.\n]*activación/],
    ['weak web signal',/web[^.\n]*señal débil/],
    ['APX subtypes',/APX Online[^.\n]*APX Batch[^.\n]*jobs\/steps[^.\n]*utilitarios/],
    ['ASO qualifiers require context',/TSEC[^.\n]*AAP[^.\n]*SMC[^.\n]*ASO confirmado/],
    ['generic backend terms insufficient',/Java\/backend\/REST[^.\n]*insuficientes/],
    ['repository-based technology selection',/contexto real[^.\n]*manifiestos[^.\n]*configuración[^.\n]*estructura[^.\n]*versiones/],
    ['no project-name inference',/nombre del proyecto[^.\n]*mención aislada[^.\n]*no bastan/],
    ['read-only initial orientation',/orientación inicial[^.\n]*solo de lectura autorizada/],
    ['orientation identifies question before docs',/identificar stack[^.\n]*versiones[^.\n]*pregunta[^.\n]*antes[^.\n]*documentación/],
    ['separate coexisting technologies',/coexisten[^.\n]*tecnologías[^.\n]*separa[^.\n]*consultas/],
    ['catalog-derived search filter',/knowledge_search[^.\n]*technology[^.\n]*ID[^.\n]*catálogo/],
    ['source narrowing',/sourceId[^.\n]*fuentes o versiones[^.\n]*acotar o desambiguar/],
    ['no invented source identifiers',/no inventes IDs[^.\n]*mezcles fuentes\/versiones/],
    ['original query preserved',/query original sin traducción[^.\n]*idioma[^.\n]*APIs[^.\n]*versiones/],
    ['retrieved content not instructions',/documentos recuperados[^.\n]*referencias no instrucciones[^.\n]*roles[^.\n]*permisos/],
    ['all relevant roles',/todos los roles relevantes[^.\n]*alcance/],
    ['catalog is not study',/disponibilidad del MCP[^.\n]*catálogo no satisface/],
    ['original sections rather than snippets',/originales[^.\n]*knowledge_read[^.\n]*knowledge_outline[^.\n]*knowledge_related[^.\n]*snippet no basta/],
    ['documentary provenance',/referencias sourceId[^.\n]*path[^.\n]*sección[^.\n]*versión/],
    ['prerequisites and verification',/prerrequisitos[^.\n]*contratos[^.\n]*proceso[^.\n]*excepciones[^.\n]*límites[^.\n]*verificación/],
    ['ASO decision-specific study',/ASO[^.\n]*fronteras[^.\n]*seguridad[^.\n]*conectores/],
    ['proportional study',/sin barrido completo[^.\n]*ceremonia[^.\n]*informe extra/],
    ['reuse current accessible documentation',/Reutiliza evidencia documental[^.\n]*accesible[^.\n]*alcance[^.\n]*versión[^.\n]*vigentes/],
    ['refresh changed or insufficient documentation',/cambio de alcance o versión[^.\n]*laguna documental[^.\n]*actualizar/],
    ['official sources and issue status',/documentación oficial[^.\n]*guías[^.\n]*contratos[^.\n]*issues[^.\n]*estado\/resolución/],
    ['no fixed search paths',/(?:No restrinjas[^.\n]*paths fijos|sin forzar paths fijos)/],
    ['honest incomplete search results',/diagnósticos[^.\n]*vacíos[^.\n]*truncados[^.\n]*faltantes[^.\n]*honestamente/],
    ['missing docs do not prove API absence',/ninguno demuestra ausencia de una API o compatibilidad/],
    ['compare docs against observed implementation',/(?:Contrasta|contraste)[^.\n]*código[^.\n]*dependencias[^.\n]*configuración[^.\n]*runtime/],
    ['versioned authorized fallback',/MCP no está disponible[^.\n]*cobertura[^.\n]*fuentes oficiales o locales autorizadas[^.\n]*versionadas/],
    ['fallback limitation and sources',/explicita(?:r)? la limitación[^.\n]*referencias/],
    ['no unsupported implementation',/Sin evidencia suficiente, no[^.\n]*implement[^.\n]*memoria[^.\n]*snippets[^.\n]*finjas aprobación/],
    ['block only affected decision',/bloquea únicamente la decisión afectada[^.\n]*continúa[^.\n]*independiente sustentado/],
    ['document scopes are not compatibility',/current\/historical\/all[^.\n]*ubicación documental[^.\n]*no compatibilidad/],
    ['skill complements, not replaces documentation',/bbva-engineering[^.\n]*complementaria[^.\n]*no reemplaza el MCP/],
    ['skill loading is contextual',/tarea encaje[^.\n]*descripción[^.\n]*no solo por palabras clave/],
    ['validate skill examples',/snippets y contratos[^.\n]*versión del proyecto[^.\n]*documentación consultada/],
  ]);
  assert.ok(policy.includes('https://github.com/vmorenoz/pulso-knowledge'));
  assert.doesNotMatch(policy,/cells-knowledge|cells_(search|read|outline|related|status)|bbva-(?:apx|cells)(?:-testing)?|predominantemente inglés|idioma original de la documentación/);
  if(primary) contracts(policy,[
    ['coordinator delegates study',/delega el estudio documental[^.\n]*no investigues tú/],
    ['same specialist can study and execute',/mismo especialista[^.\n]*sin pipeline fijo/],
    ['dependent assignments receive sources',/Transmite fuentes y decisiones[^.\n]*inputs accesibles/],
    ['check study sufficiency before accepting',/suficiencia documental[^.\n]*antes de aceptar/],
  ]);
}

async function renderedAgents(target) {
  const {adapterConfig}=await import(`../../adapters/${target}/build.mjs`);
  return [catalog.orchestrator,...catalog.specialists].map(agent=>{
    const destination=target==='opencode'?`agents/${agent.id}.md`:`resources/agents/${agent.id}.agent.md`;
    const body=renderPrompt(readAgentBody(coreRoot,agent.id),{boundary:adapterConfig.boundary,destination});
    return {agent,text:adapterConfig.renderAgent({agent,catalog,body})};
  });
}

for(const target of ['opencode','vscode']) test(`${target}: every rendered role retains one complete dynamic Knowledge policy`,async()=>{
  for(const {agent,text} of await renderedAgents(target)) {
    assertKnowledgePolicy(section(text,'technology_knowledge_policy'),{primary:agent.id===catalog.orchestrator.id});
    assert.doesNotMatch(text,/póliza|p[oó]lizas?|\bpolis\b|identificadores\/importes|skills legacy complementarias|no usan tools Pulso/i);
    assert.doesNotMatch(text,/herramientas `pulso_\*`|<\/?cells_knowledge_policy>/);
    assert.ok(!text.includes('{{'),`${agent.id}: expanded slots`);
  }
});

test('Knowledge contract checks reject missing gates and reversed evidence safeguards',()=>{
  const policy=section(readAgentBody(coreRoot,'pulso-executor'),'technology_knowledge_policy');
  assertKnowledgePolicy(policy);
  for(const [label,remove,replace] of [
    ['catalog discovery','knowledge_technologies','unverified_catalog'],
    ['study prerequisite','Antes de diseñar','Después de diseñar'],
    ['original reading','un snippet no basta','un snippet basta'],
    ['source compatibility','no compatibilidad verificada','compatibilidad verificada'],
    ['fallback','fuentes oficiales o locales autorizadas','fuentes sin procedencia'],
    ['unsupported implementation','Sin evidencia suficiente, no implementes','Sin evidencia suficiente, implementa'],
  ]) {
    const altered=policy.replace(remove,replace);
    assert.notEqual(altered,policy,label);
    assert.throws(()=>assertKnowledgePolicy(altered),{code:'ERR_ASSERTION'},label);
  }
});

for(const target of ['opencode','vscode']) test(`${target}: generic investigation, inherited evidence and role-specific publication`,async()=>{
  const rendered=await renderedAgents(target);
  for(const {agent,text} of rendered) {
    assert.doesNotMatch(text,/(?:Para|En) SQL|clave de query|query activa|fuente activa de queries|descriptor de conexión|deduplic|cardinalidad|\bjoins?\b|mi mapper/i);
    if(agent.id===catalog.orchestrator.id) continue;
    const method=section(text,'technical_method_and_safety');
    contracts(method,[
      ['trace to effective source',/llamadas y transformaciones[^.\n]*fuente efectiva/],
      ['field semantics rather than names',/semántica[^.\n]*tipos[^.\n]*usos[^.\n]*comportamiento[^.\n]*no únicamente[^.\n]*nombres/],
      ['observed version and configuration',/versión y configuración examinadas/],
      ['local and runtime distinction',/material suministrado[^.\n]*código local[^.\n]*ejecución observada[^.\n]*entornos no comprobados/],
      ['verify against assignment',/Verifica el resultado[^.\n]*objetivo del encargo/],
      ['executor owns publication',/Solo Executor[^.\n]*integración Git[^.\n]*autorización vigente[^.\n]*ticket Jira válido/],
    ]);
    const evidence=section(text,'evidence_and_recovery');
    contracts(evidence,[
      ['explicit acceptance modes',/acceptanceMode[^.\n]*evidence[^.\n]*user[^.\n]*both/],
      ['no fake execution',/Tests preparados no son ejecutados[^.\n]*textual[^.\n]*build no es test funcional[^.\n]*mock no prueba conexión real/],
      ['failed environment not PASS',/skip[^.\n]*timeout[^.\n]*entorno fallido[^.\n]*no es PASS/],
      ['formal evidence only when required',/evidencia formal[^.\n]*cuando lo requiere el criterio[^.\n]*no por cada retorno/],
      ['non-executed exit code',/static\/manual\/not_run[^.\n]*exitCode:null/],
      ['static command absence',/estática sin comando command:null/],
      ['real pre/post snapshots',/snapshots auténticos[^.\n]*antes y después/],
      ['real evidence fingerprints',/files[^.\n]*huellas reales[^.\n]*absent:true/],
      ['hashes and exit code alone are not execution',/Hashes y exitCode[^.\n]*no acreditan ejecución/],
      ['no evidence renewal',/Nunca renueves un PASS antiguo[^.\n]*fechas o huellas actuales/],
    ]);
    const authority=section(text,'role_and_permissions'),returns=section(text,'return_contract');
    contracts(authority,[
      ['native child proof',/adaptador acredita tu sesión hija y dispatch/],
      ['assignment-only progress',/get_assignment[^.\n]*proyección[^.\n]*update_assignment[^.\n]*no terminal/],
      ['no specialist self-approval',/No delegues ni aceptes resultados[^.\n]*evidence.add[^.\n]*criterios[^.\n]*cierres/],
    ]);
    contracts(returns,[
      ['receipt reporting',/operationId[^.\n]*delegationId[^.\n]*appliedRevision/],
      ['recover uncertain actions',/respuesta perdida[^.\n]*get_assignment_receipts/],
      ['no specialist terminal acceptance',/no marcas tareas como done\/cancelled[^.\n]*apruebas criterios/],
    ]);
  }
  const qa=rendered.find(({agent})=>agent.id==='pulso-qa-auditor').text;
  const qaRole=qa.match(/<specialist id="pulso-qa-auditor"[^>]*>([\s\S]*?)<\/specialist>/)[1];
  assert.match(qaRole,/evidence_and_recovery de common/);
  assert.match(qaRole,/harness no demuestra orquestación LLM real/);
  assert.doesNotMatch(qaRole,/exitCode:null|command:null|acceptanceBasis/,'observation definitions belong to the inherited common contract');
  for(const id of ['pulso','pulso-executor']) {
    const text=rendered.find(({agent})=>agent.id===id).text;
    assert.ok(text.includes('^[A-Z][A-Z0-9]+-[0-9]+$'),'Jira identity validation');
    contracts(text,[
      ['bounded publication authority',/mismo cambio\/ticket\/repositorio\/rama/],
      ['explicit paths only',/(?:Stage|stage) solo de rutas explícitas/],
      ['no broad staging',/git add \.[^\n]*git add -A/],
      ['separate invasive authorization',/[Ff]orce-push[^.\n]*amend[^.\n]*reset[^.\n]*restore[^.\n]*clean[^.\n]*stash[^.\n]*despliegue[^.\n]*autorización específica/],
    ]);
    assert.ok(text.includes('<type>(<scope>): <mensaje> [<JIRA-TICKET>]'));
  }
});

for(const target of ['opencode','vscode']) test(`${target}: reported verification remains scoped ordinary evidence, not remote execution or blanket closure`,async()=>{
  const text=(await renderedAgents(target)).find(({agent})=>agent.id==='pulso').text;
  contracts(section(text,'decision_policy'),[
    ['outcome-based criteria',/criterios por el resultado[^.\n]*no por un método accidental/],
    ['local and CI are not automatically cumulative',/ejecución local y CI[^.\n]*no[^.\n]*acumulativas[^.\n]*requisito explícito/],
    ['repair invented criteria with history and reevaluation',/criterion.update[^.\n]*reason[^.\n]*conserva historia[^.\n]*reevalúa[^.\n]*nueva base/],
    ['do not reuse obsolete acceptance',/nunca reutilices aceptación obsoleta/],
  ]);
  contracts(section(text,'reported_verification'),[
    ['scoped ordinary user report',/evidencia ordinaria[^.\n]*evidence.add[^.\n]*kind:manual[^.\n]*status:pass[^.\n]*command:null[^.\n]*exitCode:null[^.\n]*Work[^.\n]*cambio[^.\n]*criterionIds/],
    ['literal attributed source',/declaración literal[^.\n]*procedencia reportada[^.\n]*informe y basis/],
    ['no fabricated CI access',/no afirmes consulta de CI ni ejecución propia/],
    ['no unnecessary run identifiers',/No exijas URL, runID o SHA[^.\n]*contexto/],
    ['no unrelated criteria or failures',/no resuelve[^.\n]*otros criterios[^.\n]*fallo distinto/],
    ['explicit local requirements survive',/ni sustituye[^.\n]*local exigida explícitamente/],
    ['basis precedes current observation',/acceptanceBasis de get antes de observar/],
    ['time is observation not remote run',/checkedAt[^.\n]*observación actual[^.\n]*no[^.\n]*ejecución remota/],
    ['no retroactive snapshots',/No reconstruyas snapshots[^.\n]*ejecución remota[^.\n]*renueves un PASS antiguo/],
    ['reported verification is not user acceptance',/accept_delivery[^.\n]*aceptación del usuario[^.\n]*no sustituye[^.\n]*evidencia ordinaria/],
    ['current positive replacement only',/PASS ordinaria vigente[^.\n]*misma comprobación[^.\n]*not_run\/blocked/],
    ['supersession operation and exact scope',/action:supersede_evidence[^.\n]*workId[^.\n]*expectedRevision[^.\n]*operationId[^.\n]*evidenceId[^.\n]*replacementEvidenceId[^.\n]*criterionIds[^.\n]*reason/],
    ['immutable attempt history',/únicamente esos vínculos[^.\n]*conserva el intento histórico/],
    ['no erased failures or changed acceptance',/no retira un FAIL real[^.\n]*requisitos[^.\n]*acceptanceMode[^.\n]*tareas/],
    ['supersession does not clear blockers',/no[^.\n]*limpia blockers/],
    ['reconcile only the supported validation task',/taskIds[^.\n]*base pertinente[^.\n]*evidencia[^.\n]*reconcilia solo esa tarea/],
    ['existing task and overview operations',/task.set_status[^.\n]*work.set_overview/],
    ['preserve unrelated pending work',/no canceles ni ocultes pendientes ajenos/],
    ['natural readiness closure',/recibo y readiness vigente[^.\n]*cierra[^.\n]*cuando ready[^.\n]*pendiente concreto/],
    ['no age-based or cross-Work closure',/No cierres por antigüedad o silencio[^.\n]*Work[^.\n]*demás/],
  ]);
});
