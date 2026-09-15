"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const experience = require("./pulso-experience-core.js");

function databasePath() {
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "opencode", "pulso", "experience.sqlite");
}

function parseJSON(value) {
  try { return JSON.parse(value); } catch { return []; }
}

function elapsedMilliseconds(startedAt, finishedAt, generatedAt) {
  const start = Date.parse(startedAt);
  const end = Date.parse(finishedAt || generatedAt);
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : 0;
}

function aggregateRuns(runs, generatedAt) {
  const groups = new Map();
  for (const run of runs) {
    const current = groups.get(run.agent) || { agent: run.agent, runs: 0, tokens: 0, duration_ms: 0, available_source: false, unavailable_source: false };
    current.runs += 1;
    const unavailable = String(run.session_id || "").startsWith("copilot:");
    if (unavailable) current.unavailable_source = true;
    else { current.available_source = true; current.tokens += Number(run.tokens) || 0; }
    current.duration_ms += elapsedMilliseconds(run.started_at, run.finished_at, generatedAt);
    groups.set(run.agent, current);
  }
  return [...groups.values()].map(({ available_source, unavailable_source, ...run }) => ({ ...run, token_tracking: unavailable_source ? (available_source ? "mixed" : "unavailable") : "available" })).sort((left, right) => right.tokens - left.tokens || left.agent.localeCompare(right.agent));
}

function objectiveTitle(directory, objective) {
  if (/^PULSO-\d+$/.test(objective.id)) {
    const file = path.join(directory, ".pulso", "tasks", `${objective.id}.json`);
    try {
      const stat = fs.lstatSync(file);
      if (stat.isFile() && !stat.isSymbolicLink()) {
        const task = JSON.parse(fs.readFileSync(file, "utf8"));
        if (typeof task.title === "string" && task.title.trim()) return task.title.trim();
      }
    } catch {
      // Historical task state is optional; use the persisted title when unavailable.
    }
  }
  if (objective.title === objective.id) return String(objective.id).startsWith("SESSION-") ? "Pulso session" : "Pulso task";
  return objective.title;
}

function loadTaskDetails(directory) {
  const taskDirectory = path.join(directory, ".pulso", "tasks");
  const byID = new Map();
  const byTitle = new Map();
  const tasks = [];
  try {
    for (const name of fs.readdirSync(taskDirectory).filter((entry) => /^PULSO-\d+\.json$/.test(entry)).slice(0, 500)) {
      const file = path.join(taskDirectory, name);
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink()) continue;
      const task = JSON.parse(fs.readFileSync(file, "utf8"));
      tasks.push(task);
      if (typeof task.id === "string") byID.set(task.id, task);
      if (typeof task.title === "string" && task.title.trim()) byTitle.set(task.title.trim(), task);
    }
  } catch {
    // Project-local task history is optional.
  }
  return { byID, byTitle, tasks };
}

function loadDashboardData(directory) {
  const file = databasePath();
  const projectKey = experience.projectKey(directory);
  const empty = {
    project: { name: path.basename(directory), key: projectKey },
    generated_at: new Date().toISOString(),
    summary: { objectives: 0, active: 0, tokens: 0, runs: 0, agents: 0, repairs: 0, human_interventions: 0, average_duration_ms: 0, verified_rate: 0 },
    objectives: [], agent_runs: [], memories: [], preferences: [],
  };
  if (!fs.existsSync(file)) return empty;

  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const hasObjectives = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'objectives'").get();
    if (!hasObjectives) return empty;
    const objectiveColumns = db.prepare("PRAGMA table_info(objectives)").all().map((column) => column.name);
    const modern = objectiveColumns.includes("objective_key");
    const closureFields = [
      objectiveColumns.includes("summary") ? "summary" : "NULL AS summary",
      objectiveColumns.includes("evidence") ? "evidence" : "'[]' AS evidence",
      objectiveColumns.includes("verification_gaps") ? "verification_gaps" : "'[]' AS verification_gaps",
      objectiveColumns.includes("curation_status") ? "curation_status" : "'not_requested' AS curation_status",
      objectiveColumns.includes("curation_result") ? "curation_result" : "NULL AS curation_result",
    ].join(", ");
    const objectives = db.prepare(`SELECT ${modern ? "objective_key," : ""} id, title, status, started_at, finished_at, tokens, human_interventions, repair_cycles, ${closureFields}
      FROM objectives WHERE project_key = ? ORDER BY started_at DESC LIMIT 100`).all(projectKey);
    const runs = modern
      ? db.prepare(`SELECT r.objective_key, r.agent, r.session_id, r.tokens, r.started_at, r.finished_at
          FROM agent_runs r JOIN objectives o ON o.objective_key = r.objective_key
          WHERE o.project_key = ? ORDER BY r.started_at`).all(projectKey)
      : db.prepare(`SELECT r.objective_id AS objective_key, r.agent, r.session_id, r.tokens, r.started_at, r.finished_at
          FROM agent_runs r JOIN objectives o ON o.id = r.objective_id
          WHERE o.project_key = ? ORDER BY r.started_at`).all(projectKey);
    const hasMemories = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'memories'").get();
    const memories = hasMemories
      ? db.prepare(`SELECT id, scope, status, context, trap, rule, tags, evidence, updated_at
          FROM memories WHERE project_key = ? OR scope = 'global' ORDER BY updated_at DESC LIMIT 100`).all(projectKey)
        .map((row) => ({ ...row, tags: parseJSON(row.tags), evidence: parseJSON(row.evidence) }))
      : [];
    const hasPreferences = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'profile_candidates'").get();
    const preferences = hasPreferences
      ? db.prepare(`SELECT id, status, observation, proposed_rule, evidence, created_at,
          CASE WHEN project_key = ? THEN 'project' ELSE 'global' END AS scope
          FROM profile_candidates WHERE project_key = ? OR status = 'approved' ORDER BY created_at DESC LIMIT 100`).all(projectKey, projectKey)
        .map((row) => ({ ...row, evidence: parseJSON(row.evidence) }))
      : [];
    const taskDetails = loadTaskDetails(directory);
    const enrichedObjectives = objectives.map((objective) => {
      const objectiveKey = modern ? objective.objective_key : objective.id;
      const objectiveRuns = runs.filter((run) => run.objective_key === objectiveKey);
      const agents = aggregateRuns(objectiveRuns, empty.generated_at);
      const measuredTokens = agents.reduce((total, agent) => total + agent.tokens, 0);
      const title = objectiveTitle(directory, objective);
      const directTask = taskDetails.byID.get(objective.id) || taskDetails.byTitle.get(title);
      const objectiveStart = Date.parse(objective.started_at);
      const objectiveEnd = Date.parse(objective.finished_at || empty.generated_at);
      const relatedTasks = directTask ? [directTask] : taskDetails.tasks.filter((task) => {
        const updated = Date.parse(task?.execution?.updated_at || task?.integration?.updated_at);
        return Number.isFinite(updated) && updated >= objectiveStart && updated <= objectiveEnd;
      });
      const persistedEvidence = parseJSON(objective.evidence);
      const persistedGaps = parseJSON(objective.verification_gaps);
      const taskResults = relatedTasks.flatMap((task) => Array.isArray(task?.execution?.results) ? task.execution.results : []);
      const taskDeviations = relatedTasks.flatMap((task) => Array.isArray(task?.execution?.deviations) ? task.execution.deviations : []);
      const inferredGaps = taskDeviations.length ? taskDeviations : taskResults.filter((result) => /unverified|could not|blocked|failed|no pudo|bloquead/i.test(result));
      return {
        ...objective,
        tokens: measuredTokens,
        title,
        summary: objective.summary || directTask?.objective || null,
        duration_ms: elapsedMilliseconds(objective.started_at, objective.finished_at, empty.generated_at),
        run_count: objectiveRuns.length,
        agent_count: agents.length,
        agents,
        token_tracking: objectiveRuns.some((run) => String(run.session_id || "").startsWith("copilot:"))
          ? (objectiveRuns.some((run) => !String(run.session_id || "").startsWith("copilot:")) ? "mixed" : "unavailable")
          : "available",
        evidence: persistedEvidence.length ? persistedEvidence : taskResults,
        verification_gaps: persistedGaps.length ? persistedGaps : inferredGaps,
      };
    });
    const finishedObjectives = enrichedObjectives.filter((objective) => objective.finished_at);
    const verifiedObjectives = finishedObjectives.filter((objective) => ["verified", "integrated"].includes(objective.status));
    return {
      ...empty,
      summary: {
        objectives: enrichedObjectives.length,
        active: enrichedObjectives.filter((objective) => !objective.finished_at).length,
        tokens: enrichedObjectives.reduce((total, objective) => total + (objective.token_tracking === "unavailable" ? 0 : Number(objective.tokens) || 0), 0),
        token_tracking: enrichedObjectives.some((objective) => objective.token_tracking === "mixed") || (enrichedObjectives.some((objective) => objective.token_tracking === "unavailable") && enrichedObjectives.some((objective) => objective.token_tracking === "available")) ? "mixed" : enrichedObjectives.some((objective) => objective.token_tracking === "unavailable") ? "unavailable" : "available",
        runs: runs.length,
        agents: new Set(runs.map((run) => run.agent)).size,
        repairs: enrichedObjectives.reduce((total, objective) => total + (Number(objective.repair_cycles) || 0), 0),
        human_interventions: enrichedObjectives.reduce((total, objective) => total + (Number(objective.human_interventions) || 0), 0),
        average_duration_ms: finishedObjectives.length
          ? Math.round(finishedObjectives.reduce((total, objective) => total + objective.duration_ms, 0) / finishedObjectives.length)
          : 0,
        verified_rate: finishedObjectives.length ? Math.round((verifiedObjectives.length / finishedObjectives.length) * 100) : 0,
      },
      objectives: enrichedObjectives,
      agent_runs: aggregateRuns(runs, empty.generated_at),
      memories,
      preferences,
    };
  } finally {
    db.close();
  }
}

function renderDashboard(token, nonce) {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pulso Bbva</title>
<style nonce="${nonce}">
:root{color-scheme:light;--bg:#f7f7f8;--ink:#09090b;--muted:#71717a;--panel:#fff;--line:#e4e4e7;--brand:#18181b;--accent:#18181b;--button:#fff;--subtle:#f4f4f5;--card:#fafafa;--shadow:0 1px 2px rgba(0,0,0,.04),0 4px 14px rgba(0,0,0,.025)}
:root[data-theme="dark"]{color-scheme:dark;--bg:#09090b;--ink:#fafafa;--muted:#a1a1aa;--panel:#111113;--line:#27272a;--brand:#fafafa;--accent:#fafafa;--button:#18181b;--subtle:#1c1c1f;--card:#18181b;--shadow:0 1px 2px rgba(0,0,0,.35)}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 Outfit,ui-sans-serif,system-ui,-apple-system,sans-serif;min-height:100vh}main{width:min(1440px,calc(100% - 40px));margin:auto;padding:36px 0 56px}
header{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;padding:6px 2px 24px}.eyebrow{color:var(--muted);letter-spacing:.14em;font:650 10px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;text-transform:uppercase}h1{margin:6px 0 0;font:650 clamp(28px,4vw,42px)/1.05 Outfit,ui-sans-serif,system-ui,sans-serif;letter-spacing:-.035em}.subtitle{margin:9px 0 0;color:var(--muted);font-size:14px}.project-status{display:flex;align-items:center;gap:8px;color:var(--muted);border:1px solid var(--line);background:var(--panel);border-radius:999px;padding:7px 11px;box-shadow:var(--shadow)}.dot{width:7px;height:7px;border-radius:50%;background:#22c55e}
button{border:1px solid var(--line);border-radius:8px;background:var(--button);color:var(--ink);padding:8px 12px;font:600 13px/1.4 Outfit,ui-sans-serif,system-ui,sans-serif;cursor:pointer;box-shadow:0 1px 2px rgba(0,0,0,.03)}button:hover{background:var(--subtle)}button:focus-visible{outline:2px solid var(--ink);outline-offset:2px}#stop{background:var(--ink);border-color:var(--ink);color:var(--bg)}#stop:hover{opacity:.86}.toolbar{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;justify-content:flex-end}
.metrics{display:grid;grid-template-columns:repeat(6,1fr);gap:12px;margin:0 0 18px}.metric{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:18px;min-height:112px;box-shadow:var(--shadow)}.metric span{display:block;color:var(--muted);font-size:12px}.metric strong{display:block;margin-top:18px;font:650 clamp(23px,3vw,30px)/1 Outfit,ui-sans-serif,system-ui,sans-serif;letter-spacing:-.025em}
.layout{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(300px,.45fr);gap:18px}.panel{border:1px solid var(--line);border-radius:14px;background:var(--panel);min-width:0;box-shadow:var(--shadow);overflow:hidden}.panel.wide{grid-column:1/-1}.panel-head{display:flex;justify-content:space-between;align-items:center;padding:17px 18px;border-bottom:1px solid var(--line)}.panel h2{margin:0;font-size:15px;letter-spacing:-.01em}.count{color:var(--muted);font-size:12px}.scroll{overflow:auto;max-height:500px}
table{width:100%;border-collapse:collapse;min-width:800px}th,td{padding:13px 16px;text-align:left;border-bottom:1px solid var(--line);vertical-align:middle}th{color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:.08em;position:sticky;top:0;background:var(--panel);z-index:1}tbody tr[data-objective-id]{cursor:pointer;transition:background .15s}tbody tr[data-objective-id]:hover,tbody tr[data-objective-id]:focus-visible{background:var(--subtle);outline:none}tbody tr:last-child td{border-bottom:0}td:first-child{white-space:nowrap}td.title-cell{min-width:220px;font-weight:550}
.pill{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:4px 9px;font-size:11px;font-weight:650;white-space:nowrap}.pill::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}.pill[data-status="active"],.pill[data-status="in_progress"]{color:#075985;background:#e0f2fe}.pill[data-status="implemented"],.pill[data-status="partially_verified"]{color:#92400e;background:#fef3c7}.pill[data-status="verified"]{color:#166534;background:#dcfce7}.pill[data-status="integrated"]{color:#6b21a8;background:#f3e8ff}.pill[data-status="blocked"],.pill[data-status="failed"]{color:#991b1b;background:#fee2e2}.pill[data-status="cancelled"],.pill[data-status="draft"],.pill[data-status="ready"]{color:#52525b;background:#f4f4f5}:root[data-theme="dark"] .pill{filter:saturate(.65) brightness(.82)}
.stack{padding:14px 18px 18px}.bar-row{margin:10px 0 18px}.bar-label{display:flex;justify-content:space-between;gap:14px;margin-bottom:8px}.bar-label span:first-child{font-weight:550}.bar-label span:last-child{color:var(--muted);font-size:12px;text-align:right}progress{appearance:none;width:100%;height:6px;border:0;border-radius:999px;overflow:hidden;background:var(--subtle)}progress::-webkit-progress-bar{background:var(--subtle)}progress::-webkit-progress-value{background:var(--brand)}progress::-moz-progress-bar{background:var(--brand)}.cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;padding:14px}.card{border:1px solid var(--line);padding:17px;background:var(--card);border-radius:12px}.card small{color:var(--muted);text-transform:uppercase;font-weight:650;font-size:10px;letter-spacing:.07em}.card h3{margin:9px 0;font:650 15px/1.35 Outfit,ui-sans-serif,system-ui,sans-serif}.card p{margin:7px 0 0;color:var(--muted)}.tags{display:flex;flex-wrap:wrap;gap:5px;margin-top:11px}.tag{color:var(--muted);border:1px solid var(--line);border-radius:999px;padding:2px 8px;font-size:10px;background:var(--panel)}.empty{color:var(--muted);padding:32px 18px;text-align:center}footer{color:var(--muted);margin-top:18px;font-size:11px}
dialog{width:min(780px,calc(100% - 24px));max-height:88vh;overflow:auto;color:var(--ink);background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:0;box-shadow:0 24px 80px rgba(0,0,0,.2)}dialog::backdrop{background:rgba(0,0,0,.48);backdrop-filter:blur(2px)}.dialog-head{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;padding:24px;border-bottom:1px solid var(--line)}.dialog-head h2{margin:5px 0 9px;font-size:22px;line-height:1.25;letter-spacing:-.02em}.dialog-body{padding:22px 24px 26px}.status-copy{color:var(--muted);margin:9px 0 0}.facts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-bottom:22px}.fact{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:13px}.fact span{color:var(--muted);display:block;font-size:10px;text-transform:uppercase;letter-spacing:.07em}.fact strong{display:block;margin-top:7px;font-size:14px;overflow-wrap:anywhere}.closure{border:1px solid var(--line);border-radius:12px;background:var(--card);padding:14px 15px;margin:0 0 12px}.closure.gaps{border-color:#f0cf91;background:#fffbeb}:root[data-theme="dark"] .closure.gaps{border-color:#713f12;background:#261b0a}.closure p{margin:0;color:var(--muted)}.closure ul{margin:8px 0 0;padding-left:20px}.closure li+li{margin-top:5px}.detail-title{margin:0 0 8px;font-size:11px;letter-spacing:.08em;text-transform:uppercase}.detail-table{min-width:600px}
@media(max-width:1100px){.metrics{grid-template-columns:repeat(3,1fr)}.layout{grid-template-columns:1fr}.panel.wide{grid-column:auto}}@media(max-width:700px){main{width:min(100% - 18px,1500px);padding-top:9px}.metrics{grid-template-columns:repeat(2,1fr)}.cards,.facts{grid-template-columns:1fr}header{align-items:flex-start;flex-direction:column;padding:19px}.toolbar{justify-content:flex-start}.metric{min-height:94px;padding:15px}.dialog-head{padding:17px}.dialog-body{padding:16px}}
</style></head><body><main>
<header><div><div class="eyebrow">Control room</div><h1>Pulso Bbva</h1><p class="subtitle">Métricas de entrega, actividad y experiencia del proyecto.</p></div><div><div class="project-status"><i class="dot"></i><span id="project">Cargando proyecto</span></div><div class="toolbar"><button id="theme" aria-pressed="false">Tema oscuro</button><button id="refresh">Actualizar</button><button id="stop">Detener servidor</button></div></div></header>
<section class="metrics" aria-label="Métricas de entrega"><div class="metric"><span>Objetivos</span><strong id="objective-total">0</strong></div><div class="metric"><span>En curso</span><strong id="active-total">0</strong></div><div class="metric"><span>Tokens</span><strong id="token-total">0</strong></div><div class="metric"><span>Tiempo medio</span><strong id="duration-average">0 s</strong></div><div class="metric"><span>Tasa verificada</span><strong id="verified-rate">0%</strong></div><div class="metric"><span>Ejecuciones</span><strong id="run-total">0</strong></div></section>
<div class="layout"><section class="panel"><div class="panel-head"><h2>Objetivos</h2><span class="count" id="objective-count"></span></div><div class="scroll"><table><thead><tr><th>ID</th><th>Título</th><th>Estado</th><th>Duración</th><th>Tokens</th><th>Agentes</th><th>Finalización</th></tr></thead><tbody id="objectives"></tbody></table></div></section><section class="panel"><div class="panel-head"><h2>Actividad por agente</h2><span class="count" id="agent-count"></span></div><div class="stack" id="agents"></div></section><section class="panel wide"><div class="panel-head"><h2>Memorias verificadas</h2><span class="count" id="memory-count"></span></div><div class="cards" id="memories"></div></section><section class="panel wide"><div class="panel-head"><h2>Preferencias de perfil</h2><span class="count" id="preference-count"></span></div><div class="cards" id="preferences"></div></section></div><footer id="updated"></footer>
</main><dialog id="objective-detail" aria-labelledby="detail-title"><div class="dialog-head"><div><div class="eyebrow" id="detail-id"></div><h2 id="detail-title"></h2><div id="detail-status"></div><p class="status-copy" id="detail-status-copy"></p></div><button id="detail-close" aria-label="Cerrar detalle">Cerrar</button></div><div class="dialog-body"><div class="facts" id="detail-facts"></div><section class="closure"><h3 class="detail-title">Resumen de cierre</h3><p id="detail-summary"></p></section><section class="closure gaps"><h3 class="detail-title">Qué falta verificar</h3><div id="detail-gaps"></div></section><section class="closure"><h3 class="detail-title">Evidencia registrada</h3><div id="detail-evidence"></div></section><section class="closure"><h3 class="detail-title">Resultado de curación</h3><p id="detail-curation"></p></section><h3 class="detail-title">Agentes que intervinieron</h3><div class="scroll"><table class="detail-table"><thead><tr><th>Agente</th><th>Ejecuciones</th><th>Tokens</th><th>Tiempo acumulado</th></tr></thead><tbody id="detail-agents"></tbody></table></div></div></dialog>
<script nonce="${nonce}">
const token=${JSON.stringify(token)},number=new Intl.NumberFormat('es-PE'),date=new Intl.DateTimeFormat('es-PE',{dateStyle:'medium',timeStyle:'short'}),el=id=>document.getElementById(id),text=(node,value)=>{node.textContent=value;return node};
const statusInfo={active:['En curso','El objetivo sigue recibiendo trabajo.'],in_progress:['En ejecución','Un agente está ejecutando trabajo del objetivo.'],implemented:['Implementado','La implementación terminó, pero aún no cuenta con verificación completa.'],partially_verified:['Verificación parcial','Existe evidencia favorable, con alguna validación pendiente.'],verified:['Verificado','Los criterios fueron comprobados con evidencia suficiente.'],integrated:['Integrado','El cambio verificado fue integrado en el repositorio.'],blocked:['Bloqueado','El objetivo necesita resolver un impedimento antes de continuar.'],failed:['Fallido','La ejecución terminó sin alcanzar el resultado esperado.'],cancelled:['Cancelado','El objetivo fue cerrado sin continuar.'],draft:['Borrador','El alcance todavía se está definiendo.'],ready:['Listo','El objetivo está preparado para ejecución.']};
function statusMeta(status){return statusInfo[status]||[status,'Estado registrado por Pulso.']}function pill(status){const node=document.createElement('span');node.className='pill';node.dataset.status=status;node.textContent=statusMeta(status)[0];return node}function duration(milliseconds){const seconds=Math.max(0,Math.round(Number(milliseconds||0)/1000));if(seconds<60)return seconds+' s';const minutes=Math.round(seconds/60);if(minutes<60)return minutes+' min';const hours=Math.round(minutes/60);if(hours<48)return hours+' h';return Math.round(hours/24)+' d'}function instant(value){return value?date.format(new Date(value)):'En curso'}function empty(label){const node=document.createElement('div');node.className='empty';node.textContent=label;return node}function fact(label,value){const node=document.createElement('div');const name=document.createElement('span');const data=document.createElement('strong');node.className='fact';name.textContent=label;data.textContent=value;node.append(name,data);return node}
 function curation(status){return({not_requested:'No solicitada',pending:'En proceso',completed:'Memoria creada',no_candidate:'Sin candidato',failed:'Fallida'})[status]||status}function tokens(value,tracking){return tracking==='unavailable'?'N/D':number.format(value||0)+(tracking==='mixed'?'+':'')}
function card(item,type){const node=document.createElement('article');node.className='card';const scope=document.createElement('small');scope.textContent=(item.scope==='global'?'Global':'Proyecto')+' / '+item.status;node.append(scope);const title=document.createElement('h3');title.textContent=type==='memory'?item.context:item.proposed_rule;node.append(title);if(type==='memory'){const trap=document.createElement('p'),rule=document.createElement('p');trap.textContent='TRAMPA: '+item.trap;rule.textContent='REGLA: '+item.rule;node.append(trap,rule)}else{const observation=document.createElement('p');observation.textContent=item.observation;node.append(observation)}if(item.tags?.length){const tags=document.createElement('div');tags.className='tags';for(const value of item.tags){const tag=document.createElement('span');tag.className='tag';tag.textContent=value;tags.append(tag)}node.append(tags)}return node}
function renderList(target,items,emptyMessage){const root=el(target);root.replaceChildren();if(!items?.length){root.append(empty(emptyMessage));return}const list=document.createElement('ul');for(const value of items){const item=document.createElement('li');item.textContent=value;list.append(item)}root.append(list)}
 function openObjective(objective){text(el('detail-id'),objective.id);text(el('detail-title'),objective.title);el('detail-status').replaceChildren(pill(objective.status));text(el('detail-status-copy'),statusMeta(objective.status)[1]);el('detail-facts').replaceChildren(fact('Inicio',instant(objective.started_at)),fact('Finalización',instant(objective.finished_at)),fact('Duración',duration(objective.duration_ms)),fact('Tokens',tokens(objective.tokens,objective.token_tracking)),fact('Ejecuciones',number.format(objective.run_count||0)),fact('Agentes',number.format(objective.agent_count||0)),fact('Intervenciones humanas',number.format(objective.human_interventions||0)),fact('Ciclos de reparación',number.format(objective.repair_cycles||0)),fact('Curación de memoria',curation(objective.curation_status)));text(el('detail-summary'),objective.summary||'No se registró un resumen de cierre para este objetivo histórico.');renderList('detail-gaps',objective.verification_gaps,objective.status==='partially_verified'?'No se registró qué verificación quedó pendiente en este objetivo histórico.':'No hay verificaciones pendientes registradas.');renderList('detail-evidence',objective.evidence,'No hay evidencia de cierre registrada para este objetivo histórico.');text(el('detail-curation'),objective.curation_result||'La curación todavía no registró un resultado para este objetivo.');const body=el('detail-agents');body.replaceChildren();for(const agent of objective.agents||[]){const row=document.createElement('tr');for(const value of [agent.agent,number.format(agent.runs),tokens(agent.tokens,agent.token_tracking),duration(agent.duration_ms)]){const cell=document.createElement('td');cell.textContent=value;row.append(cell)}body.append(row)}if(!objective.agents?.length){const row=document.createElement('tr'),cell=document.createElement('td');cell.colSpan=4;cell.textContent='No hay ejecuciones asociadas';row.append(cell);body.append(row)}const dialog=el('objective-detail');if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','')}
 function renderObjectives(items){const body=el('objectives');body.replaceChildren();for(const objective of items){const row=document.createElement('tr');row.tabIndex=0;row.setAttribute('role','button');row.dataset.objectiveId=objective.id;row.setAttribute('aria-label','Ver detalle de '+objective.id);for(const [index,value] of [objective.id,objective.title].entries()){const cell=document.createElement('td');cell.textContent=value;if(index===1)cell.className='title-cell';row.append(cell)}const state=document.createElement('td');state.append(pill(objective.status));row.append(state);for(const value of [duration(objective.duration_ms),tokens(objective.tokens,objective.token_tracking),number.format(objective.agent_count||0),instant(objective.finished_at)]){const cell=document.createElement('td');cell.textContent=value;row.append(cell)}row.addEventListener('click',()=>openObjective(objective));row.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();openObjective(objective)}});body.append(row)}if(!items.length){const row=document.createElement('tr'),cell=document.createElement('td');cell.colSpan=7;cell.append(empty('No hay objetivos registrados para este proyecto'));row.append(cell);body.append(row)}}
 function renderAgents(items){text(el('agent-count'),items.length+' agentes');const root=el('agents');root.replaceChildren();const maximum=Math.max(1,...items.map(item=>Number(item.tokens||0)));for(const agent of items){const row=document.createElement('div');row.className='bar-row';const label=document.createElement('div');label.className='bar-label';text(label.appendChild(document.createElement('span')),agent.agent);text(label.appendChild(document.createElement('span')),tokens(agent.tokens,agent.token_tracking)+' tokens · '+agent.runs+' ejec. · '+duration(agent.duration_ms));const progress=document.createElement('progress');progress.max=maximum;progress.value=agent.token_tracking==='unavailable'?0:Number(agent.tokens||0);row.append(label,progress);root.append(row)}if(!items.length)root.append(empty('No hay ejecuciones de agentes'))}
 async function load(){const response=await fetch('/api/data?token='+encodeURIComponent(token));if(!response.ok)throw new Error('No se pudo cargar el dashboard');const data=await response.json();text(el('project'),data.project.name+' / '+data.project.key.slice(0,8));text(el('objective-total'),number.format(data.summary.objectives));text(el('active-total'),number.format(data.summary.active));text(el('token-total'),tokens(data.summary.tokens,data.summary.token_tracking));text(el('duration-average'),duration(data.summary.average_duration_ms));text(el('verified-rate'),data.summary.verified_rate+'%');text(el('run-total'),number.format(data.summary.runs));text(el('objective-count'),data.objectives.length+' registros · '+data.summary.repairs+' reparaciones · '+data.summary.human_interventions+' intervenciones');renderObjectives(data.objectives);renderAgents(data.agent_runs);for(const [id,countId,items,type] of [['memories','memory-count',data.memories,'memory'],['preferences','preference-count',data.preferences,'preference']]){text(el(countId),items.length+' registros');const root=el(id),message=id==='memories'?'Aún no hay memorias verificadas. La curación se ejecuta tras una entrega verificada o integrada.':'No hay preferencias registradas';root.replaceChildren(...(items.length?items.map(item=>card(item,type)):[empty(message)]))}text(el('updated'),'Vista read-only actualizada el '+date.format(new Date(data.generated_at)))}
const savedTheme=localStorage.getItem('pulso-theme')||'light';document.documentElement.dataset.theme=savedTheme;function syncTheme(){const dark=document.documentElement.dataset.theme==='dark';el('theme').textContent=dark?'Tema claro':'Tema oscuro';el('theme').setAttribute('aria-pressed',String(dark))}syncTheme();el('theme').addEventListener('click',()=>{document.documentElement.dataset.theme=document.documentElement.dataset.theme==='dark'?'light':'dark';localStorage.setItem('pulso-theme',document.documentElement.dataset.theme);syncTheme()});el('refresh').addEventListener('click',()=>load().catch(error=>text(el('updated'),error.message)));el('stop').addEventListener('click',async()=>{await fetch('/api/stop?token='+encodeURIComponent(token),{method:'POST'});document.body.innerHTML='<main><h1>Dashboard detenido</h1><p>Ya puedes cerrar esta pestaña.</p></main>'});el('detail-close').addEventListener('click',()=>el('objective-detail').close());el('objective-detail').addEventListener('click',event=>{if(event.target===event.currentTarget)event.currentTarget.close()});load().catch(error=>text(el('updated'),error.message));
</script></body></html>`;
}

module.exports = { databasePath, loadDashboardData, renderDashboard };
