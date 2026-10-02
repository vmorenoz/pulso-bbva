import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
// Resolve the local package before replacing HOME; dependencies are read-only.
const dependencies=process.env.PULSO_TEST_PLUGIN_NODE_MODULES||path.join(os.homedir(),'.config/opencode/node_modules');
const home=fs.mkdtempSync(path.join(os.tmpdir(),'pulso-suite-home-'));
try{
  const available=fs.existsSync(path.join(dependencies,'@opencode-ai/plugin/package.json'));
  console.log(`Home temporal: ${home}; paquete plugin local: ${available?dependencies:'no disponible'}`);
  const result=spawnSync('npm',['test'],{cwd:root,stdio:'inherit',env:{...process.env,HOME:home,USERPROFILE:home,XDG_CONFIG_HOME:path.join(home,'.config'),OPENCODE_CONFIG_DIR:path.join(home,'.config/opencode'),PULSO_TEST_PLUGIN_NODE_MODULES:available?dependencies:path.join(home,'unavailable')}});
  if(result.error)throw result.error;
  process.exitCode=result.status??1;
}finally{fs.rmSync(home,{recursive:true,force:true});}
