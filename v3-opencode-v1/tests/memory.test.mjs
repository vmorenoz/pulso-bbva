import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {readMemory,updateMemory} from '../lib/memory.mjs';

function fixture(t) {
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'pulso-memory-'));
  t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  const root=path.join(temp,'workspace'),otherRoot=path.join(temp,'other-workspace'),homeDir=path.join(temp,'home');
  for(const folder of [root,otherRoot,homeDir])fs.mkdirSync(folder);
  return {root,otherRoot,homeDir,options:{homeDir}};
}

test('empty reads create no files in project or injected user home',t=>{
  const {root,homeDir,options}=fixture(t);
  assert.deepEqual(readMemory(root,'project',options).preferences,[]);
  assert.deepEqual(readMemory(root,'user',options).preferences,[]);
  assert.deepEqual(fs.readdirSync(root),[]);
  assert.deepEqual(fs.readdirSync(homeDir),[]);
});

test('user updates and removal share only the injected home between workspaces',t=>{
  const {root,otherRoot,homeDir,options}=fixture(t);
  t.mock.method(os,'homedir',()=>{throw new Error('Injected memory must not resolve the real home');});
  const environment={...process.env};
  updateMemory(root,{action:'set_preference',scope:'user',key:'language',value:'es'},options);
  updateMemory(otherRoot,{action:'set_preference',scope:'user',key:'language',value:'en'},options);
  const value=readMemory(root,'user',options);
  assert.equal(value.preferences.length,1);
  assert.equal(value.preferences[0].value,'en');
  assert.equal(value.revision,3);
  updateMemory(otherRoot,{action:'remove_preference',scope:'user',key:'language'},options);
  assert.deepEqual(readMemory(root,'user',options).preferences,[]);
  assert.equal(readMemory(root,'user',options).revision,4);
  assert.ok(fs.existsSync(path.join(homeDir,'.pulso','preferences.json')));
  assert.deepEqual(fs.readdirSync(root),[]);
  assert.deepEqual(fs.readdirSync(otherRoot),[]);
  assert.deepEqual({...process.env},environment);
});

test('context and learning honor injected user home on every save path',t=>{
  const {root,otherRoot,options}=fixture(t);
  t.mock.method(os,'homedir',()=>{throw new Error('Injected memory must not resolve the real home');});
  updateMemory(root,{action:'set_context',scope:'user',context:' User context '},options);
  updateMemory(otherRoot,{action:'add_learning',scope:'user',note:'User lesson',source:'delegated'},options);
  const value=readMemory(root,'user',options);
  assert.equal(value.context,'User context');
  assert.equal(value.learning[0].note,'User lesson');
  assert.equal(value.learning[0].source,'delegated');
  assert.equal(value.revision,3);
  assert.deepEqual(fs.readdirSync(root),[]);
  assert.deepEqual(fs.readdirSync(otherRoot),[]);
});

test('project calls without options remain compatible and separate from user memory',t=>{
  const {root,otherRoot,homeDir,options}=fixture(t);
  updateMemory(root,{action:'set_context',context:' Project context '});
  updateMemory(root,{action:'set_preference',key:'language',value:'es'});
  updateMemory(root,{action:'add_learning',note:'Project lesson'});
  assert.equal(readMemory(root).context,'Project context');
  assert.equal(readMemory(root,'project',options).preferences[0].value,'es');
  assert.equal(readMemory(root).learning[0].note,'Project lesson');
  assert.equal(readMemory(otherRoot).context,'');
  updateMemory(root,{action:'remove_preference',key:'language'});
  assert.deepEqual(readMemory(root).preferences,[]);
  assert.deepEqual(readMemory(root,'user',options).preferences,[]);
  assert.deepEqual(fs.readdirSync(homeDir),[]);
});

test('malformed actions fail before storage resolution and never create memory',t=>{
  const {root,homeDir,options}=fixture(t);
  const cases=[
    [null,/Input/], [[],/Input/], [{action:'unknown'},/Acción/],
    [{action:'set_context'},/context/], [{action:'set_context',context:1},/context/], [{action:'set_context',context:'x'.repeat(4001)},/context/],
    [{action:'set_preference',value:'es'},/key/], [{action:'set_preference',key:' ' ,value:'es'},/key/],
    [{action:'set_preference',key:'x'.repeat(121),value:'es'},/key/], [{action:'set_preference',key:'language'},/value/],
    [{action:'set_preference',key:'language',value:null},/value/], [{action:'set_preference',key:'language',value:'x'.repeat(1001)},/value/],
    [{action:'remove_preference'},/key/], [{action:'remove_preference',key:''},/key/],
    [{action:'add_learning'},/note/], [{action:'add_learning',note:'  '},/note/], [{action:'add_learning',note:'x'.repeat(2001)},/note/],
    [{action:'set_context',context:'ok',scope:'other'},/scope/], [{action:'add_learning',note:'ok',source:'other'},/source/]
  ];
  const unreadableOptions={get homeDir(){throw new Error('Storage resolution must not happen');}};
  for(const [input,error] of cases){
    assert.throws(()=>updateMemory(root,input,unreadableOptions),error);
    for(const scope of ['project','user'])assert.throws(()=>updateMemory(root,input&&{...input,scope:input.scope??scope},options));
  }
  assert.deepEqual(fs.readdirSync(root),[]);
  assert.deepEqual(fs.readdirSync(homeDir),[]);
});

test('valid boundary inputs persist complete preferences; rejected updates preserve existing bytes',t=>{
  const {root,homeDir,options}=fixture(t);
  for(const scope of ['project','user']){
    updateMemory(root,{action:'set_context',scope,context:'x'.repeat(4000)},options);
    updateMemory(root,{action:'set_preference',scope,key:'k'.repeat(120),value:'v'.repeat(1000),source:'user'},options);
    updateMemory(root,{action:'set_preference',scope,key:'empty-value',value:'',source:'observed'},options);
    updateMemory(root,{action:'add_learning',scope,note:'n'.repeat(2000),source:'delegated'},options);
    const file=scope==='project'?path.join(root,'.pulso','memory.json'):path.join(homeDir,'.pulso','preferences.json');
    const before=fs.readFileSync(file,'utf8');
    for(const action of ['set_preference','remove_preference','add_learning','set_context'])assert.throws(()=>updateMemory(root,{action,scope},options));
    assert.equal(fs.readFileSync(file,'utf8'),before);
    for(const preference of readMemory(root,scope,options).preferences){
      assert.equal(typeof preference.key,'string');
      assert.equal(typeof preference.value,'string');
      assert.equal(typeof preference.source,'string');
    }
  }
});
