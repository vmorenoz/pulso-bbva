#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {install,uninstall,VERSION} from './lib/install.mjs';
import {select} from './lib/terminal.mjs';
const runtimes=[{value:'opencode',label:'OpenCode'},{value:'vscode',label:'Visual Studio Code (Copilot)'}];
const HELP=`Pulso — instalación y desinstalación
  node /ruta/pulso-v3/install.mjs             Runtime → instalar globalmente
  node /ruta/pulso-v3/install.mjs uninstall   Runtime → desinstalar

Flechas o Tab para seleccionar, Enter para continuar, Esc/Ctrl+C para cancelar.
No requiere npm install ni sudo. Los trabajos permanecen separados en cada proyecto.

Automatización: --runtime opencode|vscode [--dry-run]
No modifica credenciales, modelos, permisos, MCP ni otros agentes.
`;
export async function main(args=process.argv.slice(2)){
  if(Number(process.versions.node.split('.')[0])<22)throw new Error('Pulso requiere Node.js 22 o superior. Actualiza Node y vuelve a ejecutar el comando.');
  const o={};let remove=false;
  if(args[0]==='uninstall'){remove=true;args=args.slice(1);}
  for(let i=0;i<args.length;i++){
    const a=args[i];if(a==='--help'){console.log(HELP);return;}
    if(a==='--uninstall')remove=true;
    else if(a==='--dry-run')o.dryRun=true;
    else if(a==='--runtime'){
      if(!args[i+1]||args[i+1].startsWith('--'))throw new Error(`Falta valor para ${a}. Consulta --help.`);
      if(o.runtime)throw new Error(`Opción repetida: ${a}`);o.runtime=args[++i];
    }else throw new Error(`Opción desconocida: ${a}. Consulta --help.`);
  }
  if(o.runtime&&!runtimes.some(x=>x.value===o.runtime))throw new Error('Selecciona --runtime opencode o vscode.');
  if(!process.stdin.isTTY&&!o.runtime)throw new Error('En modo no interactivo usa --runtime.');
  console.log(`\nPulso ${VERSION} · ${remove?'Desinstalación':'Instalación'}\n`);
  if(remove)console.log('Se retirará ese runtime de la instalación global. No se recorren proyectos.');
  if(!o.runtime){console.log('Usa flechas o Tab y Enter. Esc/Ctrl+C cancela sin cambios.');o.runtime=await select('Runtime',runtimes);}
  console.log(remove?'\nComprobando la instalación global…':'\nComprobando instalación global anterior e instalando Pulso…');
  const r=remove?uninstall(o):install(o);
  if(o.dryRun){console.log('\n[OK] Vista previa. No se modificó ningún archivo.');console.log(JSON.stringify(r,null,2));return r;}
  if(remove){
    if(!r.uninstalled){console.log(`\n[INFO] ${r.note}`);return r;}
    console.log('\n[OK] Desinstalación exitosa.');
    for(const t of r.targets)console.log(`  Global: ${t.target} (${t.removed} archivos de Pulso retirados)`);
    console.log('  Trabajos, planes, contexto e históricos conservados.');
    console.log('  La instalación del otro runtime y los proyectos no se modifican.');
  }else{
    console.log('\n[OK] Instalación exitosa.');
    console.log(`  Runtime: ${runtimes.find(x=>x.value===o.runtime).label}`);
    console.log('  Ámbito: Global');
    console.log(`  Destino: ${r.target}`);
    if(r.replacedVersion)console.log(`  Versión anterior ${r.replacedVersion} retirada; instalada ${VERSION}.`);
    else console.log(`  Versión: ${VERSION}`);
    console.log('\nAbre el runtime y selecciona pulso como agente principal.');
    console.log('Los datos .pulso/ se prepararán por proyecto al usar Pulso; agentes y recursos permanecen globales.');
    console.log('Las configuraciones nativas y los datos de trabajo se conservaron.');
  }
  return r;
}
export function reportError(e){
  if(e.code==='CANCELLED'){console.log(`\n[INFO] ${e.message}`);process.exitCode=130;return;}
  console.error(`\n[ERROR] No se pudo completar la operación.\n\n${e.message}`);
  const code=e.code||e.cause?.code;
  if(['EACCES','EPERM'].includes(code))console.error('\nComprueba permisos de esa carpeta y cierra procesos que bloqueen archivos. No ejecutes como administrador para forzar la instalación.');
  else if(code==='ENOSPC')console.error('\nLibera espacio en disco y vuelve a ejecutar el mismo comando.');
  console.error('\nNo se eliminan archivos ajenos ni datos de trabajo. Corrige la causa indicada y vuelve a ejecutar el comando.');process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(fs.realpathSync(path.resolve(process.argv[1]))).href)main().catch(reportError);
