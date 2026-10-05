#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {install,uninstall} from './lib/install.mjs';

const HELP=`Pulso · instalación global para OpenCode v1
  node install.mjs [--dry-run]
  node install.mjs uninstall [--dry-run]

Requiere Node.js 22+. Diseñado para OpenCode v1; no valida el binario en PATH. No instala VS Code ni OpenCode v2.
Registra el plugin y default_agent en la configuración del host; preserva entradas ajenas y respalda cambios.`;

export function main(args=process.argv.slice(2)){
  if(Number(process.versions.node.split('.')[0])<22)throw new Error('Pulso requiere Node.js 22 o superior.');
  const remove=args[0]==='uninstall';if(remove)args=args.slice(1);
  let dryRun=false;
  for(const arg of args){if(arg==='--help'){console.log(HELP);return;}if(arg==='--dry-run')dryRun=true;else throw new Error(`Opción desconocida: ${arg}. Consulta --help.`);}
  const result=remove?uninstall({dryRun}):install({dryRun});
  if(dryRun){console.log('[OK] Vista previa. No se modificó ningún archivo.');console.log(JSON.stringify(result,null,2));return result;}
  console.log(remove?'[OK] Integración OpenCode v1 de Pulso retirada. Los datos del proyecto se conservaron.':'[OK] Pulso instalado para OpenCode v1. Reinicia OpenCode y selecciona pulso como agente principal.');
  if(result.backup)console.log(`Respaldo: ${JSON.stringify(result.backup)}`);
  console.log(remove?'Configuración: integración retirada; default_agent previo restaurado cuando procede.':'Configuración: plugin registrado y default_agent=pulso.');
  return result;
}
export function reportError(error){console.error(`[ERROR] ${error.message}`);process.exitCode=1;}
if(process.argv[1]&&import.meta.url===pathToFileURL(fs.realpathSync(path.resolve(process.argv[1]))).href)try{main();}catch(error){reportError(error);}
