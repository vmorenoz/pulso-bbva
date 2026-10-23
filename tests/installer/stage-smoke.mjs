import {createHost} from '../opencode/native-fixture.mjs';
// Staged package + native V2 domain double. No real host or user home is used.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {planOpenCode,executePlans} from '../../installer/index.mjs';
import {listFiles,sha256} from '../../installer/lib/fs.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'pulso-stage-smoke-'));
let fixture;
try {
 const host='opencode';
 const home=path.join(directory,`${host}-home`),project=path.join(directory,`${host}-project`);fs.mkdirSync(home);fs.mkdirSync(project);
 const plan=planOpenCode({home,env:{},packageRoot:path.join(root,'dist/opencode')});assert.equal(executePlans([plan]).status,'complete');
 const runtime=path.join(home,`.pulso/runtimes/${host}-v2`),native=path.join(home,'.config',host);let links=0;
 for(const file of listFiles(native).filter(f=>f.endsWith('.md'))){const text=fs.readFileSync(path.join(native,file),'utf8');for(const [,url] of text.matchAll(/\]\((file:[^)\s]+)\)/g)){assert.ok(fs.existsSync(fileURLToPath(url)),`${file}: missing ${url}`);links++;}}
 assert.ok(links>0,'Actual native resources must contain relocated resource links');
 const module=await import(pathToFileURL(path.join(runtime,'plugin/index.mjs')).href);
 const nativeEntry=await import(pathToFileURL(path.join(runtime,'server.js')).href);assert.equal(nativeEntry.default,module.default);
 assert.equal(module.default.id,'pulso');assert.equal(typeof module.default.setup,'function');
 fixture=createHost({directory:project});
 fixture.host.app={name:'opencode',version:'2.1.2'};
 fixture.dispose=await module.createPulsoPlugin({reader:fixture.reader,homeDir:home}).setup(fixture.host);
 const context={sessionID:'ses_primary',messageID:'msg_primary',agent:'pulso',id:'call_primary',signal:new AbortController().signal};
 fixture.invoke=async(name,input)=>(await fixture.tools[name].execute({request:input},context)).output;
 assert.deepEqual(Object.keys(fixture.tools).sort(),['pulso_context','pulso_history','pulso_work','pulso_workspace']);
 const snapshot=()=>listFiles(home).map(f=>[f,sha256(fs.readFileSync(path.join(home,f)))]),before=snapshot();
 const status=await fixture.invoke('pulso_workspace',{action:'status'});assert.equal(status.ok,true,JSON.stringify(status));
 assert.deepEqual(fs.readdirSync(project),[]);assert.deepEqual(snapshot(),before);
 const prepare=await fixture.invoke('pulso_workspace',{action:'prepare'});assert.equal(prepare.ok,true,JSON.stringify(prepare));
 assert.ok(fs.existsSync(path.join(project,'.pulso')));assert.equal(fixture.requests.length,3);assert.equal(fixture.requests.at(-1).action,'external_directory');assert.deepEqual(fixture.requests.at(-1).resources,[path.join(home,'.pulso')+'/**']);
 const result={status:'PASS',host,installedRuntimeFiles:listFiles(runtime).length,relocatedLinks:links,registeredTools:Object.keys(fixture.tools),statusReadOnly:true,preparePassed:true,contract:'API 2.1.2 native-domain double',nativeConversation:'NOT_RUN'};
 await fixture.dispose();fixture=null;
 console.log(JSON.stringify(result,null,2));
}finally{await fixture?.dispose?.();fs.rmSync(directory,{recursive:true,force:true});}
