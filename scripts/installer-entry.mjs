#!/usr/bin/env node
import {main} from './installer/cli.mjs';
if(Number(process.versions.node.split('.')[0])<22){
  console.error('Pulso requires Node.js 22 or newer.');process.exitCode=1;
}else await main().catch(error=>{console.error(error.message);process.exitCode=1;});
