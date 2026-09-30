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
function frontmatter(text){
  const match=/^---\n([\s\S]*?)\n---\n/.exec(text);assert.ok(match,'Falta frontmatter');const result={};
  for(const line of match[1].split('\n')){const i=line.indexOf(':');assert.ok(i>0,'Frontmatter emitido inválido');const key=line.slice(0,i);assert.ok(!Object.hasOwn(result,key),'Campo duplicado');result[key]=JSON.parse(line.slice(i+1).trim());}return result;
}
try{
  test('Sintaxis JavaScript de todos los módulos',()=>{for(const p of listFiles(root).filter(f=>f.endsWith('.mjs'))){const r=spawnSync(process.execPath,['--check',path.join(root,p)],{encoding:'utf8'});assert.equal(r.status,0,`${p}: ${r.stderr}`);}});
  test('Schemas y ejemplos de datos',()=>{for(const file of fs.readdirSync(path.join(root,'schemas')))checkSchemaVocabulary(JSON.parse(read('schemas/'+file)));for(const name of ['work','objective','task','delegation','result','evidence','state','history-entry'])assertSchema(name,JSON.parse(read(`templates/${name}.json`)));assertSchema('work-create',{workId:'CHECK-1',title:'Título',objective:'Resultado',criterion:'Criterio',verification:'Verificación'});assertSchema('work-update',{workId:'CHECK-1',expectedRevision:1,actions:[{type:'task.set_status',taskId:'T-1',status:'done'}]});});
  test('Cinco skills BBVA conservadas según procedencia',()=>{const p=JSON.parse(read('docs/bbva-provenance.json'));assert.equal(p.files.length,5);for(const f of p.files){const bytes=fs.readFileSync(path.join(root,f.file));assert.equal(bytes.length,f.bytes);assert.equal(sha256(bytes),f.sha256);}});
  test('Composición exclusivamente OpenCode v2',()=>{
    const catalog=JSON.parse(read('agents/catalog.json')),ids=[catalog.orchestrator,...catalog.specialists].map(a=>a.id),files=composeNativeFiles({root});
    assert.equal(ids.length,10);assert.equal(new Set(ids).size,10);assert.equal(fs.existsSync(path.join(root,'adapters')),false);
    for(const agentId of ids){const file=files.get(`.opencode/agents/${agentId}.md`);assert.ok(file);const meta=frontmatter(file),primary=agentId==='pulso';assert.equal(meta.mode,primary?'primary':'subagent');assert.ok(Array.isArray(meta.permissions));assert.equal(meta.permission,undefined);if(!primary){assert.equal(meta.hidden,true);assert.ok(meta.permissions.some(rule=>rule.action==='subagent'&&rule.effect==='deny'));for(const tool of pulsoToolNames)assert.ok(meta.permissions.some(rule=>rule.action===tool&&rule.effect==='deny'));}else for(const tool of pulsoToolNames)assert.ok(meta.permissions.some(rule=>rule.action===tool&&rule.effect==='allow'));assert.match(file,/opencode-v2/);assert.doesNotMatch(file,/subagent_type|task nativo|permission:/);}
    assert.equal([...files.keys()].some(file=>file.includes('.github/')||file.includes('.copilot/')),false);
    for(const name of ['pulso-status','pulso-recap','pulso-resume','pulso-init']){const command=files.get(`.opencode/commands/${name}.md`),meta=frontmatter(command);assert.equal(meta.agent,'pulso');assert.equal(meta.subagent,false);assert.ok(command.includes('Carga la skill nativa'));}
    const plugin=read('plugins/opencode-v2/index.ts');for(const tool of pulsoToolNames)assert.ok(plugin.includes(`"${tool}"`));assert.match(plugin,/context\.sessionID/);assert.match(plugin,/ctx\.session\.get\(\{ sessionID: context\.sessionID \}\)/);assert.doesNotMatch(plugin,/properties:.*root/);
    assert.ok(files.has('.opencode/plugins/pulso/index.ts'));assert.ok(files.has('.opencode/plugins/pulso/package.json'));
  });
  test('Catálogo, templates y skills nativas referenciadas existen',()=>{const catalog=JSON.parse(read('agents/catalog.json'));for(const a of catalog.specialists){assert.ok(fs.existsSync(path.join(root,'templates',a.template)));assert.ok(read(`agents/${a.id}.md`).includes(`id="${a.id}"`));}for(const f of listFiles(path.join(root,'templates')).filter(x=>x.endsWith('.md')&&x!=='README.md'))assert.match(read('templates/'+f),/template: .+@1\.0/);for(const dir of fs.readdirSync(path.join(root,'skills'))){const skill=read(`skills/${dir}/SKILL.md`);assert.match(skill,new RegExp(`^---\nname: ${dir}\n`));assert.match(skill,/\ndescription: .+/);}});
  test('No operational Pulso CLI remains in distribution',()=>{assert.equal(fs.existsSync(path.join(root,'bin/pulso.mjs')),false);assert.equal(fs.existsSync(path.join(root,'bin/prepare.mjs')),false);for(const file of listFiles(root).filter(f=>/\.(mjs|md)$/.test(f)&&f!=='scripts/check.mjs')){const content=read(file);assert.doesNotMatch(content,/node\s+[^\n]*pulso\.mjs|prepare\.mjs --root|CLI global con --root/);}});
  test('Core y plugin sin dependencias externas de resolución',()=>{const pkg=JSON.parse(read('package.json'));assert.equal(Object.keys(pkg.dependencies||{}).length,0);assert.equal(Object.keys(pkg.devDependencies||{}).length,0);for(const f of listFiles(path.join(root,'lib')).filter(x=>x.endsWith('.mjs')))for(const line of read('lib/'+f).split('\n').filter(x=>x.startsWith('import ')))assert.match(line,/from ['"](?:node:|\.\/|\.\.\/)/);const plugin=JSON.parse(read('plugins/opencode-v2/package.json'));assert.equal(Object.keys(plugin.dependencies||{}).length,0);assert.equal(plugin.exports['.'],'./index.ts');assert.doesNotMatch(read('plugins/opencode-v2/index.ts'),/from ["']@opencode\/plugin/);});
  test('Composición reproducible en memoria',()=>{const render=()=>Object.fromEntries([...composeNativeFiles({root})].map(([p,text])=>[p,sha256(text)]));assert.deepEqual(render(),render());});
  console.log(JSON.stringify({status:'PASS',checks,nativeRuntime:'NOT_RUN',note:'Validación estructural de core, schemas, agentes y plugin; no smoke live de OpenCode.'},null,2));
}catch(e){console.error(`CHECK FAIL: ${e.message}`);process.exitCode=1;}
