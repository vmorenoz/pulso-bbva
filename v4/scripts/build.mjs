import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {listFiles,writeFile,hash} from './files.mjs';
import {readAgentBody,renderPrompt,renderSkill} from './prompts.mjs';

export const sourceRoot=fileURLToPath(new URL('../',import.meta.url));
export const releaseVersion=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url))).version;
export const runtimeModules=['artifacts','acceptance','continuity','continuity-discovery','delegation-registry','assignment-tools','evidence-supersession','fs','identity','memory','receipts','schema','work-mutations','workspace','semantic-tools','tool-contracts','pagination'];
export const operationSkills=['pulso-init','pulso-status','pulso-recap','pulso-resume'];
const integrity=JSON.parse(fs.readFileSync(new URL('./bbva-integrity.json',import.meta.url)));

export function verifyBBVA(coreRoot) {
  const actual=listFiles(path.join(coreRoot,'skills')).filter(file=>file.startsWith('bbva-'));
  if(JSON.stringify(actual.sort())!==JSON.stringify(Object.keys(integrity).sort())) throw new Error('BBVA file inventory changed');
  for(const file of actual) if(hash(fs.readFileSync(path.join(coreRoot,'skills',file)))!==integrity[file]) throw new Error(`BBVA bytes changed: ${file}`);
}

/** Selected adapter is the only adapter ever loaded or read. */
export async function build(target,{root=sourceRoot,outputRoot}={}) {
  if(!['opencode','vscode'].includes(target)) throw new Error('Select opencode or vscode');
  const coreRoot=path.join(root,'core'),adapterRoot=path.join(root,'adapters',target);
  const output=outputRoot||path.join(root,'dist',target);
  if(!path.isAbsolute(output)) throw new Error('Output root must be absolute');
  verifyBBVA(coreRoot);
  const {adapterConfig:config}=await import(pathToFileURL(path.join(adapterRoot,'build.mjs')).href);
  const catalog=JSON.parse(fs.readFileSync(path.join(coreRoot,'agents/catalog.json')));
  if(catalog.orchestrator.id!=='pulso'||catalog.specialists.length!==9||new Set(catalog.specialists.map(x=>x.id)).size!==9) throw new Error('Invalid canonical catalog');
  // Clean only the designated generated target, never a sibling or source directory.
  const safeDist=path.join(root,'dist',target);
  if(output!==safeDist&&fs.existsSync(output)&&fs.readdirSync(output).length) throw new Error('Custom output directory must be empty');
  if(output===safeDist) fs.rmSync(output,{recursive:true,force:true});
  fs.mkdirSync(output,{recursive:true});
  const inventory=[];
  function add(destination,bytes,source,sourceBytes=bytes) {
    if(inventory.some(item=>item.path===destination)) throw new Error(`Duplicate output: ${destination}`);
    const data=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes);
    writeFile(output,destination,data);
    inventory.push({path:destination,sha256:hash(data),source,sourceSha256:hash(sourceBytes)});
  }
  function copy(source,destination,label) { const bytes=fs.readFileSync(source);add(destination,bytes,label); }
  for(const name of runtimeModules) copy(path.join(coreRoot,'lib',`${name}.mjs`),`resources/lib/${name}.mjs`,`core/lib/${name}.mjs`);
  for(const folder of ['schemas','templates']) for(const file of listFiles(path.join(coreRoot,folder))) copy(path.join(coreRoot,folder,file),`resources/${folder}/${file}`,`core/${folder}/${file}`);
  copy(path.join(coreRoot,'agents/catalog.json'),'resources/agents/catalog.json','core/agents/catalog.json');
  const chatAgents=[],chatSkills=[];
  for(const agent of [catalog.orchestrator,...catalog.specialists]) {
    const destination=target==='vscode'?`resources/agents/${agent.id}.agent.md`:`agents/${agent.id}.md`;
    const sourceBody=readAgentBody(coreRoot,agent.id);
    const body=renderPrompt(sourceBody,{boundary:config.boundary,resourceBase:'resources',destination});
    add(destination,config.renderAgent({agent,catalog,body}),`core/agents/${agent.id}.md`,sourceBody);
    chatAgents.push({path:destination});
  }
  for(const file of listFiles(path.join(coreRoot,'skills'))) {
    const destination=target==='vscode'?`resources/skills/${file}`:`skills/${file}`;
    const bytes=fs.readFileSync(path.join(coreRoot,'skills',file));
    const operational=operationSkills.includes(file.split('/')[0]);
    // Auxiliary skills retain their core instructions without coordinator-only guidance.
    const text=operational?bytes.toString('utf8'):bytes.toString('utf8').replaceAll('{{ADAPTER_BOUNDARY}}','');
    const result=file.startsWith('bbva-')?bytes:renderSkill(text,{boundary:config.operationalSkillBoundary,resourceBase:'resources',destination});
    add(destination,result,`core/skills/${file}`,bytes);
    if(file.endsWith('/SKILL.md')) chatSkills.push({path:destination});
  }
  if(config.renderCommand) for(const name of operationSkills) {
    const text=fs.readFileSync(path.join(coreRoot,'skills',name,'SKILL.md'),'utf8');
    const description=/^description: (.+)$/m.exec(text)?.[1];
    if(!description) throw new Error(`Missing skill description: ${name}`);
    add(`commands/${name}.md`,config.renderCommand({name,description}),`core/skills/${name}/SKILL.md`,text);
  }
  for(const [source,destination] of Object.entries(config.runtimeFiles)) copy(path.join(adapterRoot,source),destination,`adapter/${source}`);
  if(target==='opencode') {
    const vendor=JSON.parse(fs.readFileSync(path.join(root,'scripts/vendor-integrity.json')));
    const vendorRoot=path.join(adapterRoot,'vendor');
    if(JSON.stringify(listFiles(vendorRoot).sort())!==JSON.stringify(Object.keys(vendor).sort())) throw new Error('Vendor closure inventory changed');
    for(const [file,digest]of Object.entries(vendor)) {
      const bytes=fs.readFileSync(path.join(vendorRoot,file));
      if(hash(bytes)!==digest)throw new Error(`Vendor integrity changed: ${file}`);
      add(`plugin/vendor/${file}`,bytes,`adapter/vendor/${file}`);
    }
  }
  const manifest=await config.packageManifest({coreRoot,chatAgents,chatSkills});
  if(manifest.version!==releaseVersion) throw new Error('Wrong package version');
  add('package.json',JSON.stringify(manifest,null,2)+'\n','adapter/package-manifest');
  inventory.sort((a,b)=>a.path.localeCompare(b.path,'en'));
  writeFile(output,'pulso-package.json',JSON.stringify({version:releaseVersion,files:inventory},null,2)+'\n');
  return {target,output,files:inventory.length+1};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const selected=process.argv[2]||'all';
  for(const target of selected==='all'?['opencode','vscode']:[selected]) console.log(JSON.stringify(await build(target)));
}
