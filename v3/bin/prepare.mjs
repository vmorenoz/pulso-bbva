#!/usr/bin/env node
import {prepareWorkspace} from '../lib/install.mjs';
const args=process.argv.slice(2);
try{
  if(args.length!==2||args[0]!=='--root'||!args[1])throw new Error('Uso: node prepare.mjs --root /ruta/del/proyecto');
  console.log(JSON.stringify(prepareWorkspace(args[1]),null,2));
}catch(e){console.error(`Pulso: ${e.message}`);process.exitCode=1;}
