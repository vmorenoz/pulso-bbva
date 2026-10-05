import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {listFiles,hash} from './files.mjs';
import {sourceRoot,runtimeModules,verifyBBVA} from './build.mjs';

const coreFolders={schemas:new Set(),templates:new Set()};
const foreign={vscode:/opencode|@opencode-ai|delegation-observer|delegation-attempts|reconcile_attempts|tool\.execute\.(?:before|after)/i,opencode:/\bvscode\b|\bcopilot\b|@vscode|LanguageModelToolResult|chatAgents|toolInvocationToken/i};
export function verifyPackage(target,root,{coreRoot=path.join(sourceRoot,'core')}={}) {
  if(!Object.hasOwn(foreign,target)) throw new Error('Unknown target');
  verifyBBVA(coreRoot);
  const integrity=JSON.parse(fs.readFileSync(new URL('./bbva-integrity.json',import.meta.url)));
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'pulso-package.json')));
  const actual=listFiles(root);
  const expected=[...manifest.files.map(x=>x.path),'pulso-package.json'].sort();
  if(new Set(expected).size!==expected.length||JSON.stringify(actual.sort())!==JSON.stringify(expected)) throw new Error('Package inventory mismatch');
  const allow=new Set(['package.json','pulso-package.json','README.md','readme.md','LICENSE.md','resources/agents/catalog.json']);
  for(const name of runtimeModules) allow.add(`resources/lib/${name}.mjs`);
  for(const folder of ['schemas','templates']) for(const file of listFiles(path.join(coreRoot,folder))) allow.add(`resources/${folder}/${file}`);
  const catalog=JSON.parse(fs.readFileSync(path.join(coreRoot,'agents/catalog.json')));
  for(const agent of [catalog.orchestrator,...catalog.specialists]) allow.add(target==='vscode'?`resources/agents/${agent.id}.agent.md`:`agents/${agent.id}.md`);
  for(const file of listFiles(path.join(coreRoot,'skills'))) allow.add(target==='vscode'?`resources/skills/${file}`:`skills/${file}`);
  const native=target==='vscode'?['src/extension.cjs','src/workspace.mjs','src/native-contracts.mjs','assets/pulso.svg','assets/pulso-128.png','assets/pulso-256.png','assets/pulso-512.png']:['plugin/index.mjs','plugin/schema-converter.mjs','plugin/attempt-contracts.mjs','plugin/delegation-observer.mjs',...['init','status','recap','resume'].map(name=>`commands/pulso-${name}.md`)];
  for(const file of native)allow.add(file);
  if(target==='opencode')for(const file of Object.keys(JSON.parse(fs.readFileSync(new URL('./vendor-integrity.json',import.meta.url)))))allow.add(`plugin/vendor/${file}`);
  for(const file of actual) {
    if(!allow.has(file))throw new Error(`Unallowlisted package file: ${file}`);
    const bytes=fs.readFileSync(path.join(root,file));
    const recorded=manifest.files.find(x=>x.path===file);
    if(recorded&&hash(bytes)!==recorded.sha256)throw new Error(`Package hash mismatch: ${file}`);
    if(/\.(?:png|jpe?g|gif|woff2?)$/.test(file))continue;
    const text=bytes.toString('utf8');
    if(foreign[target].test(text)||/v3-opencode-v1|v3-vscode|adapters\/(?:vscode|opencode)|\.\.\/.*adapters\//i.test(text))throw new Error(`Foreign/source implementation leaked: ${file}`);
    if(!file.startsWith('resources/templates/')&&/\{\{(?:ADAPTER_|RESOURCE_)/.test(text))throw new Error(`Unexpanded slot: ${file}`);
    if(/\.(?:mjs|cjs|js)$/.test(file)) for(const match of text.matchAll(/(?:from\s*|import\s*\(|require\s*\()(['"])(\.[^'"]+)\1/g)) {
      const resolved=path.resolve(path.dirname(path.join(root,file)),match[2]);
      if(!resolved.startsWith(path.resolve(root)+path.sep)||!fs.existsSync(resolved))throw new Error(`Unresolved package import: ${file} -> ${match[2]}`);
    }
    if(file.endsWith('.md'))for(const match of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const link=match[1];if(/^(?:https?:|mailto:|#)/.test(link)||link.includes('{{'))continue;
      const resolved=path.resolve(path.dirname(path.join(root,file)),decodeURIComponent(link.split('#')[0]));
      if(!resolved.startsWith(path.resolve(root)+path.sep)||!fs.existsSync(resolved))throw new Error(`Unresolved package resource: ${file} -> ${link}`);
    }
  }
  for(const [file,expectedHash]of Object.entries(integrity)) {
    const destination=target==='vscode'?`resources/skills/${file}`:`skills/${file}`;
    if(hash(fs.readFileSync(path.join(root,destination)))!==expectedHash)throw new Error(`Packaged BBVA changed: ${file}`);
  }
  const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json')));
  if(pkg.version!=='4.0.0')throw new Error('Wrong artifact version');
  if(target==='vscode') {
    if(pkg.enabledApiProposals?.length)throw new Error('Proposed API in native package');
    if(pkg.contributes.chatAgents.length!==10||pkg.contributes.chatSkills.length!==10||pkg.contributes.languageModelTools.length!==4)throw new Error('Incomplete native contributions');
    for(const entry of [...pkg.contributes.chatAgents,...pkg.contributes.chatSkills])if(!fs.existsSync(path.join(root,entry.path)))throw new Error('Missing contributed resource');
  }
  return {target,files:actual.length,bbvaFiles:Object.keys(integrity).length};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))for(const target of process.argv[2]?[process.argv[2]]:['opencode','vscode'])console.log(JSON.stringify(verifyPackage(target,path.join(sourceRoot,'dist',target))));
