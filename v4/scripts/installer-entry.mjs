#!/usr/bin/env node
import {main} from './installer/cli.mjs';

if(Number(process.versions.node.split('.')[0])<22){
  console.error('Pulso requires Node.js 22 or newer.');
  process.exitCode=1;
}else{
  const args=process.argv.slice(2);
  if(args.includes('--targets')){
    console.error('This package installs OpenCode only; --targets is not needed.');
    process.exitCode=1;
  }else await main(['--targets','opencode',...args]).catch(error=>{
    console.error(error.message);
    process.exitCode=1;
  });
}
