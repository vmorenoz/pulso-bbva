/** Refresh only the pinned official Promise client closure. Run after npm ci. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {hash,listFiles} from './files.mjs';

const sourceRoot=fileURLToPath(new URL('../',import.meta.url));
const installedEntry=fileURLToPath(import.meta.resolve('@opencode/client'));
const installedRoot=path.resolve(path.dirname(installedEntry),'../..');
const manifest=JSON.parse(fs.readFileSync(path.join(installedRoot,'package.json'),'utf8'));
const lock=JSON.parse(fs.readFileSync(path.join(sourceRoot,'package-lock.json'),'utf8')).packages['node_modules/@opencode/client'];
if(manifest.name!=='@opencode/client'||manifest.version!=='2.1.2'||lock.version!==manifest.version||lock.integrity!=='sha512-c7FqI/zMy6HrdVGHynzouiz3y1smokGuimh2+Is2iVWz8I8VzJEty9eTrvQkQzXG1Hj5K2FL1K5fytQ7yJEd9w==')throw new Error('Unexpected official client package identity');
const upstream=path.join(installedRoot,'dist');
const pending=['promise/index.js'],files=new Map();
while(pending.length){
  const file=pending.pop();
  if(files.has(file))continue;
  if(file.startsWith('../')||path.isAbsolute(file)||!file.endsWith('.js'))throw new Error(`Unsupported client dependency: ${file}`);
  const bytes=fs.readFileSync(path.join(upstream,file));
  files.set(file,bytes);
  for(const match of bytes.toString().matchAll(/(?:\sfrom\s+|\bimport\s*\(\s*|^\s*import\s*)["']([^"']+)["']/gm)){
    const imported=match[1];
    if(imported.startsWith('node:'))continue;
    if(!imported.startsWith('.'))throw new Error(`Non-native dependency in Promise closure: ${file} -> ${imported}`);
    pending.push(path.posix.normalize(path.posix.join(path.posix.dirname(file),imported)));
  }
}
const vendor=path.join(sourceRoot,'adapters/opencode/vendor'),destination=path.join(vendor,'client');
fs.rmSync(vendor,{recursive:true,force:true});
for(const [file,bytes] of files){const to=path.join(destination,file);fs.mkdirSync(path.dirname(to),{recursive:true});fs.writeFileSync(to,bytes);}
fs.writeFileSync(path.join(destination,'package.json'),JSON.stringify({name:'@opencode/client',version:manifest.version,type:'module',license:'MIT',private:true},null,2)+'\n');
// Exact license bytes from the immutable v2.1.2 source tag (not included by the npm publisher).
fs.writeFileSync(path.join(destination,'LICENSE'),`MIT License

Copyright (c) 2025 opencode

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`);
fs.writeFileSync(path.join(vendor,'provenance.json'),JSON.stringify({package:manifest.name,version:manifest.version,source:lock.resolved,integrity:lock.integrity,git:{tag:'v2.1.2',commit:'a517687fde98a7329ada3ae644a01a9fc6c4e99e',license:'https://github.com/anomalyco/opencode/blob/v2.1.2/LICENSE'},entrypoints:['client/promise/index.js'],note:'Unmodified import-reachable official Promise client runtime; metadata and license copied separately. Pulso only calls read-only APIs. Native registration is bounded and validated before probing; no service lifecycle helpers are called.'},null,2)+'\n');
const inventory=Object.fromEntries(listFiles(vendor).sort().map(file=>[file,hash(fs.readFileSync(path.join(vendor,file)))]));
fs.writeFileSync(path.join(sourceRoot,'scripts/vendor-integrity.json'),JSON.stringify(inventory,null,2)+'\n');
console.log(JSON.stringify({package:manifest.name,version:manifest.version,files:Object.keys(inventory).length,bytes:[...files.values()].reduce((total,bytes)=>total+bytes.length,0)}));
