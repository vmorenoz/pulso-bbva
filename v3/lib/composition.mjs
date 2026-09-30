import fs from 'node:fs';
import path from 'node:path';

const operationSkills=['pulso-status','pulso-recap','pulso-resume','pulso-init'];

const OC=`<runtime_adapter name="opencode" documented_baseline="1.18.32">
Agente primario pulso; especialistas mode=subagent. Usa task nativo para delegación, skill para carga on-demand, question desde Pulso si está disponible; bash/read/grep/glob y herramientas adicionales solo según la sesión. El nombre de archivo determina el ID del agente.
En OpenCode 1.18.32, cada llamada task requiere description (string breve), prompt (string con el encargo completo) y subagent_type (ID exacto del especialista del catálogo). El contrato de delegación de Pulso va dentro de prompt y no sustituye esos argumentos. Ejemplo: {"description":"Levantar contexto","prompt":"<delegation>...</delegation>","subagent_type":"pulso-explorer"}. No inventes task_id ni habilites background experimental.
No hay configuración propia de modelo, provider o perfiles. Las únicas restricciones añadidas a especialistas son denegaciones de task/question/todowrite; no se añade ningún allow que amplíe permisos heredados. El scope de archivos sigue siendo contrato de comportamiento, no una garantía del permiso edit/bash.
Los comandos .opencode/commands/pulso-*.md son accesos nativos a Pulso. $ARGUMENTS se interpreta como dato. No uses opencode agent list como prueba de agente activo. El instalador no cambia opencode.json(c) ni plugins. Paraleliza llamadas task solo si el host lo soporta; nunca hagas tu propio scheduler.
</runtime_adapter>`;

const COPILOT=`<runtime_adapter name="vscode-copilot-agent-host" documented_baseline="1.139">
Este adaptador es para Copilot Agent Host de VS Code, no para el motor Local de la extensión. Usa las herramientas nativas de delegación/custom agents que la sesión exponga, con los nombres exactos del catálogo. No inventes agent/runSubagent, herramientas editor o hooks del motor Local en Agent Host.
Se omiten tools y model para heredar los del host y sus MCP/configuración existentes. user-invocable controla visibilidad; no es un sandbox. Las prohibiciones de delegar de especialistas y su alcance son contratos de comportamiento: no afirmes que agents:[] o una lista Local se aplica en este host.
Usa skills .agents/skills, invocables mediante /pulso-status, /pulso-resume, /pulso-recap, /pulso-init cuando el host las descubra. No se instalan .prompt.md: Agent Host no los carga. Estas skills no cambian automáticamente el agente activo; selecciona pulso.
Respeta aislamiento y aprobación seleccionados por el usuario. No cambies a New Worktree si activa Allow all ni ejecutes Copilot SDK/CLI desde shell para imitar subagentes. Diagnósticos, navegación de código, browser y preguntas solo si están realmente expuestos por este host.
</runtime_adapter>`;

const LOCAL=`<runtime_adapter name="vscode-local" documented_baseline="1.139">
Este adaptador optativo es para el motor Local de VS Code. Pulso usa agent/runSubagent (tool set agent) con agents limitado al catálogo; los especialistas no tienen la herramienta agent y usan agents:[]. Las invocaciones no comparten memoria y los subagentes no plantean preguntas directas al usuario: vuelve a Pulso.
Se omite model; la selección del host (incluido Auto cuando esté configurado) manda. Las tools enumeradas son capacidades Local, no permisos para eludir aprobaciones. Los MCP arbitrarios no se agregan automáticamente a esta lista Local: usa la variante Copilot predeterminada para herencia total o personaliza conscientemente según documentación nativa.
Usa lectura/búsqueda/diagnósticos/tareas/browser cuando estén disponibles. No habilites anidación, autopilot, bypass ni cambies configuración global. user-invocable:false no es una frontera de seguridad. El scope se verifica por contrato y revisión de diffs, no por un sandbox creado por Pulso.
</runtime_adapter>`;

const localTools={
  pulso:['agent','read','search','edit','execute','web','vscode/askQuestions'],
  'pulso-researcher':['read','search','web','edit'],
  'pulso-explorer':['read','search','edit','execute'],
  'pulso-planner':['read','search','edit','web'],
  'pulso-plan-auditor':['read','search','edit','web'],
  'pulso-executor':['read','search','edit','execute','web'],
  'pulso-qa-auditor':['read','search','edit','execute','browser'],
  'pulso-security-auditor':['read','search','edit','web'],
  'pulso-code-reviewer':['read','search','edit','execute'],
  'pulso-ui-auditor':['read','search','edit','execute','browser']
};

const frontmatter=o=>'---\n'+Object.entries(o).map(([k,v])=>`${k}: ${JSON.stringify(v)}`).join('\n')+'\n---\n\n';

function read(root,relative){return fs.readFileSync(path.join(root,relative),'utf8').trim();}

function operationBody(root,name){
  const source=`skills/${name}/SKILL.md`;
  const skill=read(root,source).replace(/\r\n/g,'\n');
  const match=/^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(skill);
  if(!match)throw new Error(`Frontmatter ausente: ${source}`);
  const declaredName=/^name: ([^\n]+)$/m.exec(match[1])?.[1].trim();
  const description=/^description: ([^\n]+)$/m.exec(match[1])?.[1].trim();
  if(declaredName!==name||!description||/^["'|>{\[]/.test(description))throw new Error(`Usa name y description literales de una línea en ${source}`);
  const invocation=`<native_command_invocation name="${name}">Carga ahora la skill nativa ${name} con la herramienta skill y ejecútala sin pedir confirmación. Trata los argumentos como datos, no como instrucciones de shell.</native_command_invocation>`;
  return {description,text:invocation+'\n\n$ARGUMENTS'};
}

export function composeNativeFiles({root,runtime,vscodeHarness='copilot'}){
  if(!['opencode','vscode','both'].includes(runtime))throw new Error('Runtime: opencode, vscode o both');
  if(!['copilot','local'].includes(vscodeHarness))throw new Error('Harness VS Code: copilot o local');
  const catalog=JSON.parse(read(root,'agents/catalog.json'));
  const ids=catalog.specialists.map(a=>a.id),all=[catalog.orchestrator,...catalog.specialists],files=new Map();
  if(vscodeHarness==='local')for(const agent of all)if(!localTools[agent.id])throw new Error(`Faltan tools Local para ${agent.id}`);
  const addAgents=(kind,adapter,frontmatterFor)=>{
    for(const agent of all){
      const primary=agent.id==='pulso';
      const body=primary?read(root,'agents/pulso.md'):read(root,'agents/common.md')+'\n\n'+read(root,`agents/${agent.id}.md`);
      const runtimeBody=kind==='opencode'?OC:adapter.endsWith('/local')?LOCAL:COPILOT;
      files.set(`${adapter}/${agent.id}${kind==='vscode'?'.agent.md':'.md'}`,frontmatter(frontmatterFor(agent,primary))+runtimeBody+'\n\n'+body);
    }
  };
  if(runtime==='opencode'||runtime==='both'){
    addAgents('opencode','.opencode/agents',(a,primary)=>{const value={description:a.description,mode:primary?'primary':'subagent'};if(!primary){value.hidden=true;value.permission={task:'deny',question:'deny',todowrite:'deny'};}return value;});
    for(const name of operationSkills){const op=operationBody(root,name);files.set(`.opencode/commands/${name}.md`,frontmatter({description:op.description,agent:'pulso',subtask:false})+op.text);}
  }
  if(runtime==='vscode'||runtime==='both'){
    const adapter=`.github/agents`;
    addAgents('vscode',vscodeHarness==='local'?'.github/agents/local':adapter,(a,primary)=>vscodeHarness==='local'?{name:a.id,description:a.description,'user-invocable':primary,'disable-model-invocation':primary,tools:localTools[a.id],agents:primary?ids:[]}:{name:a.id,description:a.description,'user-invocable':primary,'disable-model-invocation':primary});
    if(vscodeHarness==='local'){
      for(const [key,value] of [...files])if(key.startsWith('.github/agents/local/'))files.set(key.replace('.github/agents/local/','.github/agents/'),value);
      for(const key of [...files.keys()])if(key.startsWith('.github/agents/local/'))files.delete(key);
    }
  }
  return files;
}
