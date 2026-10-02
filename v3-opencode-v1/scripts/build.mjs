import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {composeNativeFiles} from '../lib/composition.mjs';
import {planInstall} from '../lib/install.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const files=composeNativeFiles({root});
const homeDir=fs.mkdtempSync(path.join(os.tmpdir(),'pulso-build-'));
try{
  const distribution=planInstall({homeDir,env:{}}).files;
  for(const name of ['workspace.mjs','identity.mjs','delegation-observer.mjs'])assert.ok(distribution.has(`.pulso/lib/${name}`));
  for(const [file,bytes] of distribution)if(file.startsWith('.pulso/lib/')){
    for(const [,specifier] of bytes.toString().matchAll(/\bfrom\s*['"](\.\/[^'"]+)['"]/g))assert.ok(distribution.has(path.posix.join(path.posix.dirname(file),specifier)),`${file}: falta ${specifier}`);
  }
  console.log(`Distribución válida en memoria: ${distribution.size} recursos, incluidos ${files.size} archivos OpenCode v1; imports del core resueltos. No se escribieron salidas generadas.`);
}finally{fs.rmSync(homeDir,{recursive:true,force:true});}
