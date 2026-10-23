import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {listFiles,hash} from './files.mjs';
import {sourceRoot,releaseVersion,runtimeModules,verifyBBVA,assertReleaseVersion} from './build.mjs';

const foreign=/\bvscode\b|\bcopilot\b|@vscode|LanguageModelToolResult|chatAgents|toolInvocationToken|@opencode-ai\/plugin/i;
export function verifyPackage(target,root,{coreRoot=path.join(sourceRoot,'core')}={}) {
  if(target!=='opencode') throw new Error('Only the opencode target is supported');
  verifyBBVA(coreRoot);
  const integrity=JSON.parse(fs.readFileSync(new URL('./bbva-integrity.json',import.meta.url)));
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'pulso-package.json')));
  const actual=listFiles(root);
  const expected=[...manifest.files.map(x=>x.path),'pulso-package.json'].sort();
  if(new Set(expected).size!==expected.length||JSON.stringify(actual.sort())!==JSON.stringify(expected)) throw new Error('Package inventory mismatch');
  const allow=new Set(['package.json','pulso-package.json','README.md','LICENSE.md','resources/agents/catalog.json']);
  for(const name of runtimeModules) allow.add(`resources/lib/${name}.mjs`);
  for(const folder of ['schemas','templates']) for(const file of listFiles(path.join(coreRoot,folder))) allow.add(`resources/${folder}/${file}`);
  const catalog=JSON.parse(fs.readFileSync(path.join(coreRoot,'agents/catalog.json')));
  for(const agent of [catalog.orchestrator,...catalog.specialists]) allow.add(`agents/${agent.id}.md`);
  for(const file of listFiles(path.join(coreRoot,'skills'))) allow.add(`skills/${file}`);
  const native=['server.js','plugin/index.mjs','plugin/attempt-contracts.mjs','plugin/delegation-observer.mjs','plugin/durable-hooks.mjs','plugin/assignment-authority.mjs','plugin/recovery-policy.mjs','plugin/native-read.mjs',...['init','status','recap','resume'].map(name=>`commands/pulso-${name}.md`)];
  for(const file of native)allow.add(file);
  const vendor=JSON.parse(fs.readFileSync(new URL('./vendor-integrity.json',import.meta.url)));
  for(const file of Object.keys(vendor))allow.add(`plugin/vendor/${file}`);
  for(const file of allow) if(file!=='LICENSE.md'&&!actual.includes(file))throw new Error(`Missing required package file: ${file}`);
  for(const file of actual) {
    if(!allow.has(file))throw new Error(`Unallowlisted package file: ${file}`);
    const bytes=fs.readFileSync(path.join(root,file));
    const recorded=manifest.files.find(x=>x.path===file);
    if(recorded&&hash(bytes)!==recorded.sha256)throw new Error(`Package hash mismatch: ${file}`);
    if(file.startsWith('plugin/vendor/')&&hash(bytes)!==vendor[file.slice('plugin/vendor/'.length)])throw new Error(`Vendor integrity changed: ${file}`);
    if(/\.(?:png|jpe?g|gif|woff2?)$/.test(file))continue;
    const text=bytes.toString('utf8');
    // Upstream client implementation is pinned byte-for-byte, not Pulso's runtime integration.
    if(!file.startsWith('plugin/vendor/')&&(foreign.test(text)||/v3-opencode-v1|v3-vscode|adapters\/(?:vscode|opencode)|\.\.\/.*adapters\//i.test(text)))throw new Error(`Foreign/source implementation leaked: ${file}`);
    if(!file.startsWith('resources/templates/')&&/\{\{(?:ADAPTER_|RESOURCE_)/.test(text))throw new Error(`Unexpanded slot: ${file}`);
    if(/\.(?:mjs|cjs|js)$/.test(file)) for(const match of text.matchAll(/(?:\sfrom\s+|\bimport\s*\(\s*|^\s*import\s*)(['"])([^'"]+)\1/gm)) {
      if(match[2].startsWith('node:'))continue;
      if(!match[2].startsWith('.'))throw new Error(`External runtime import: ${file} -> ${match[2]}`);
      const resolved=path.resolve(path.dirname(path.join(root,file)),match[2]);
      if(!resolved.startsWith(path.resolve(root)+path.sep)||!fs.existsSync(resolved))throw new Error(`Unresolved package import: ${file} -> ${match[2]}`);
    }
    if(file.endsWith('.md'))for(const match of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const link=match[1];if(/^(?:https?:|mailto:|#)/.test(link)||link.includes('{{'))continue;
      const resolved=path.resolve(path.dirname(path.join(root,file)),decodeURIComponent(link.split('#')[0]));
      if(!resolved.startsWith(path.resolve(root)+path.sep)||!fs.existsSync(resolved))throw new Error(`Unresolved package resource: ${file} -> ${link}`);
    }
  }
  for(const [file,expectedHash]of Object.entries(integrity)) if(hash(fs.readFileSync(path.join(root,'skills',file)))!==expectedHash)throw new Error(`Packaged BBVA changed: ${file}`);
  const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json')));
  assertReleaseVersion(pkg.version);
  if(pkg.version!==releaseVersion||manifest.version!==releaseVersion)throw new Error('Wrong artifact version');
  if(pkg.type!=='module'||pkg.exports!=='./plugin/index.mjs'||pkg.pulso?.host!=='opencode'||pkg.pulso?.apiVersion!==2||pkg.pulso?.hostVersion!=='2.1.2')throw new Error('Invalid native OpenCode v2 package contract');
  if(pkg.compatibleHosts!==undefined)throw new Error('Only the OpenCode 2.1.2 target is supported');
  if(Object.keys(pkg.dependencies||{}).length)throw new Error('Runtime must be self-contained');
  return {target,files:actual.length,bbvaFiles:Object.keys(integrity).length};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const target=process.argv[2]||'opencode';
  console.log(JSON.stringify(verifyPackage(target,path.join(sourceRoot,'dist',target))));
}
