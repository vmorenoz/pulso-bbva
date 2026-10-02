import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {listFiles,sha256} from '../lib/fs.mjs';
import {assertSchema,checkSchemaVocabulary} from '../lib/schema.mjs';
import {composeNativeFiles,pulsoToolNames} from '../lib/composition.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const checks=[];
const test=(name,fn)=>{fn();checks.push(name);};
try{
  test('Sintaxis JavaScript de módulos distribuibles',()=>{for(const p of listFiles(root).filter(f=>f.endsWith('.mjs'))){const result=spawnSync(process.execPath,['--check',path.join(root,p)],{encoding:'utf8'});assert.equal(result.status,0,`${p}: ${result.stderr}`);}});
  test('Schemas y ejemplos de datos',()=>{for(const file of fs.readdirSync(path.join(root,'schemas')))checkSchemaVocabulary(JSON.parse(read('schemas/'+file)));for(const name of ['work','objective','task','delegation','result','evidence','state','history-entry'])assertSchema(name,JSON.parse(read(`templates/${name}.json`)));});
  test('Composición exclusivamente OpenCode v1',()=>{
    const catalog=JSON.parse(read('agents/catalog.json')),files=composeNativeFiles({root});
    for(const agent of [catalog.orchestrator,...catalog.specialists]){const value=files.get(`.opencode/agents/${agent.id}.md`);assert.ok(value);assert.match(value,/<runtime_boundary>/);assert.doesNotMatch(value,/OpenCode v[12]|opencode-v[12]|CodeGraph/);assert.match(value,/permission:/);assert.doesNotMatch(value,/permissions:/);for(const tool of pulsoToolNames)assert.match(value,new RegExp(`${tool}: ${agent.id==='pulso'?'allow':'deny'}`));}
    for(const name of ['pulso-status','pulso-recap','pulso-resume','pulso-init'])assert.ok(files.has(`.opencode/commands/${name}.md`));
    const plugin=read('plugins/opencode-v1/index.mjs');for(const tool of pulsoToolNames)assert.match(plugin,new RegExp(tool));assert.match(plugin,/@opencode-ai\/plugin/);assert.match(plugin,/Sin estado Pulso disponible/);assert.match(plugin,/createWorkOperation\(context\.directory,input\)/);assert.match(plugin,/completeMapOperation/);assert.doesNotMatch(plugin,/ctx\.tool\.transform|editor\.add|opencode-v2/);assert.ok(files.has('.opencode/plugins/pulso/index.mjs'));
  });
  test('Core local sin dependencias externas; jsonc-parser solo en instalador',()=>{
    const installer=new Set(['install.mjs','install-cleanup.mjs','install-jsonc.mjs']);
    for(const file of listFiles(path.join(root,'lib')).filter(file=>file.endsWith('.mjs'))){
      const imports=[...read(`lib/${file}`).matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"]([^'"]+)['"]/g)].map(match=>match[1]);
      for(const specifier of imports){
        assert.ok(/^(?:node:|\.\/|\.\.\/)/.test(specifier)||file==='install-jsonc.mjs'&&specifier==='jsonc-parser',`${file}: dependencia externa ${specifier}`);
        if(!installer.has(file)&&specifier.startsWith('.'))assert.ok(!installer.has(path.relative(path.join(root,'lib'),path.resolve(root,'lib',specifier))),`${file}: el core importa el instalador`);
      }
    }
  });
  test('Composición reproducible en memoria',()=>{const render=()=>Object.fromEntries([...composeNativeFiles({root})].map(([p,text])=>[p,sha256(text)]));assert.deepEqual(render(),render());});
  console.log(JSON.stringify({status:'PASS',checks,nativeRuntime:'NOT_RUN',note:'Validación estructural; requiere smoke test en OpenCode v1 real.'},null,2));
}catch(error){console.error(`CHECK FAIL: ${error.message}`);process.exitCode=1;}
