import {primaryClient} from '../opencode/native-fixture.mjs';
// Run after building native stages. Exercises only disposable fake homes/projects.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {planOpenCode,executePlans} from '../../installer/index.mjs';
import {listFiles,sha256} from '../../installer/lib/fs.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'pulso-v4-stage-smoke-'));
try {
 const home=path.join(directory,'home'),project=path.join(directory,'project');fs.mkdirSync(home);fs.mkdirSync(project);
 const p=planOpenCode({home,env:{},packageRoot:path.join(root,'dist/opencode')});assert.equal(executePlans([p]).status,'complete');
 const runtime=path.join(home,'.pulso/runtimes/opencode-v1'),native=path.join(home,'.config/opencode');let links=0;
 for(const file of listFiles(native).filter(f=>f.endsWith('.md'))){const text=fs.readFileSync(path.join(native,file),'utf8');for(const [,url] of text.matchAll(/\]\((file:[^)\s]+)\)/g)){assert.ok(fs.existsSync(fileURLToPath(url)),`${file}: missing ${url}`);links++;}}
 assert.ok(links>0,'Actual native resources must contain relocated resource links');
 const {PulsoPlugin}=await import(pathToFileURL(path.join(runtime,'plugin/index.mjs')).href);
 const plugin=await PulsoPlugin({directory:project,homeDir:home,client:primaryClient(project)});assert.deepEqual(Object.keys(plugin.tool).sort(),['pulso_context','pulso_history','pulso_work','pulso_workspace']);
 let approvals=0;const context={directory:project,sessionID:'ses_primary',messageID:'msg_primary',agent:'pulso',ask:async()=>{approvals++;},abort:new AbortController().signal};
 const before=listFiles(home).map(f=>[f,sha256(fs.readFileSync(path.join(home,f)))]);
 const status=JSON.parse((await plugin.tool.pulso_workspace.execute({request:{action:'status'}},context)).output);assert.equal(status.ok,true,JSON.stringify(status));assert.deepEqual(fs.readdirSync(project),[]);assert.deepEqual(listFiles(home).map(f=>[f,sha256(fs.readFileSync(path.join(home,f)))]),before);
 const prepare=JSON.parse((await plugin.tool.pulso_workspace.execute({request:{action:'prepare'}},context)).output);assert.equal(prepare.ok,true,JSON.stringify(prepare));assert.ok(fs.existsSync(path.join(project,'.pulso')));assert.equal(approvals,2);
 console.log(JSON.stringify({status:'PASS',installedRuntimeFiles:listFiles(runtime).length,relocatedLinks:links,registeredTools:Object.keys(plugin.tool),statusReadOnly:true,preparePassed:true,defaultSDKImported:true,nativeConversation:'NOT_RUN'},null,2));
}finally{fs.rmSync(directory,{recursive:true,force:true});}
