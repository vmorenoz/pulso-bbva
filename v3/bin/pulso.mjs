#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {assertSchema} from '../lib/schema.mjs';
import {readJSON,safePath,fingerprint} from '../lib/fs.mjs';
import {status,history,createWork,saveWork,syncWork,closeWork,reopenWork,repair,validateProject,validateResult} from '../lib/artifacts.mjs';
import {doctor} from '../lib/doctor.mjs';
const HELP=`Pulso v3 — utilidades de artefactos; no ejecuta agentes.
Uso: node /ruta/global/.pulso/bin/pulso.mjs [--root RUTA] COMANDO [opciones]
  status                            Lee solo el índice confirmado del proyecto
  history [--since ISO8601]          Resúmenes de cierres, no actividad diaria
  new ID --title TEXTO --objective TEXTO --criterion TEXTO --verification TEXTO
  save ARCHIVO --expected-revision N Lee candidato JSON; incrementa revisión y actualiza índice
  sync ID [--focus]                  Reconcilia un trabajo e historial de cierre
  close ID --outcome done|cancelled --summary TEXTO [--limitation TEXTO ...]
  reopen ID --reason TEXTO           Conserva cierre previo y abre nuevo ciclo
  validate [--fresh]                 Esquemas, referencias e índice; fresh comprueba hashes
  validate --schema NOMBRE --file RUTA
  validate-result --delegation RUTA --result RUTA
  repair                            Reconstruye índice; solo uso explícito
  fingerprint RUTA [RUTA ...]        SHA256 de archivos relativos al proyecto
  doctor [--no-probe]                Integridad local y versiones; nunca afirma éxito live
Opciones generales: --root RUTA (raíz explícita), --help
Requiere un único Pulso escritor por checkout. No bloqueará otro proceso concurrente.
`;
export function parse(argv){
  const pos=[],options={};
  const bool=new Set(['help','focus','fresh','no-probe']);
  for(let i=0;i<argv.length;i++){
    const a=argv[i];if(a==='--'){pos.push(...argv.slice(i+1));break;}
    if(a.startsWith('--')){const key=a.slice(2);if(bool.has(key))options[key]=true;else{if(!argv[i+1]||argv[i+1].startsWith('--'))throw new Error(`Falta valor: ${a}`);const v=argv[++i];if(key==='limitation')(options[key]??=[]).push(v);else if(Object.hasOwn(options,key))throw new Error(`Opción duplicada: ${a}`);else options[key]=v;}}
    else pos.push(a);
  }
  return {pos,options};
}
function discoverRoot(explicit){
  if(explicit)return path.resolve(explicit);
  let p=process.cwd();while(true){if(fs.existsSync(path.join(p,'.pulso','state.json')))return p;const parent=path.dirname(p);if(parent===p)throw new Error('No se encontró .pulso/state.json. Instala Pulso o usa --root.');p=parent;}
}
export function main(argv=process.argv.slice(2)){
  const {pos,options:o}=parse(argv);if(o.help||!pos.length)return HELP;
  const allowed={status:[],history:['since'],new:['title','objective','criterion','verification'],save:['expected-revision'],sync:['focus'],close:['outcome','summary','limitation'],reopen:['reason'],validate:['fresh','schema','file'],'validate-result':['delegation','result'],repair:[],fingerprint:[],doctor:['no-probe']};
  const command=pos.shift();if(!allowed[command])throw new Error(`Comando desconocido: ${command}`);
  for(const key of Object.keys(o))if(!['root',...allowed[command]].includes(key))throw new Error(`Opción desconocida para ${command}: --${key}`);
  const fixed={status:0,history:0,new:1,save:1,sync:1,close:1,reopen:1,validate:0,'validate-result':0,repair:0,doctor:0};
  if(Object.hasOwn(fixed,command)&&pos.length!==fixed[command])throw new Error(`Número de argumentos inválido para ${command}`);
  const root=discoverRoot(o.root);
  switch(command){
    case 'status':return status(root);
    case 'history':{if(o.since&&!Number.isFinite(Date.parse(o.since)))throw new Error('Fecha --since inválida');return history(root).filter(x=>!o.since||Date.parse(x.closedAt)>=Date.parse(o.since));}
    case 'new':return createWork(root,{id:pos[0],title:o.title,objective:o.objective,criterion:o.criterion,verification:o.verification});
    case 'save':return saveWork(root,readJSON(root,pos[0]),Number(o['expected-revision']));
    case 'sync':return syncWork(root,pos[0],{focus:!!o.focus});
    case 'close':return closeWork(root,pos[0],{outcome:o.outcome||'done',summary:o.summary,limitations:o.limitation||[]});
    case 'reopen':return reopenWork(root,pos[0],o.reason);
    case 'validate':if(o.schema||o.file){if(!o.schema||!o.file)throw new Error('--schema y --file son necesarios juntos');assertSchema(o.schema,readJSON(root,o.file));return {valid:true,schema:o.schema,semanticAcceptance:'NOT_EVALUATED'};}return validateProject(root,{fresh:!!o.fresh});
    case 'validate-result':return validateResult(root,readJSON(root,o.delegation),readJSON(root,o.result));
    case 'repair':return repair(root);
    case 'fingerprint':if(!pos.length)throw new Error('Indicar al menos un archivo');return pos.map(p=>fingerprint(root,p));
    case 'doctor':return doctor(root,{probeVersions:!o['no-probe']});
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(fs.realpathSync(path.resolve(process.argv[1]))).href){
  try{const result=main();process.stdout.write(typeof result==='string'?result:JSON.stringify(result,null,2)+'\n');if(result?.installation==='REVIEW_REQUIRED'||result?.installation==='FAIL')process.exitCode=1;}
  catch(e){console.error(`Pulso: ${e.message}`);process.exitCode=1;}
}
