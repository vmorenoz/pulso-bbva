import test from 'node:test';
import assert from 'node:assert/strict';
import {pagination,pageItems,snapshotSignature} from '../../core/lib/pagination.mjs';

test('cursor binding is deterministic across object order and limit changes',()=>{
  assert.equal(snapshotSignature({b:2,a:1}),snapshotSignature({a:1,b:2}));
  const items=Array.from({length:7},(_,index)=>({id:index,full:'x'.repeat(4000)}));
  const query={kind:'work',binding:{root:'/trusted',filter:'pending'},snapshot:{revision:2,items},limit:2};
  let result=pageItems(items,query),all=[...result.items];
  while(result.hasMore){result=pageItems(items,{...query,limit:3,cursor:result.nextCursor});all.push(...result.items);}
  assert.deepEqual(all,items);assert.equal(result.nextCursor,null);assert.equal(result.total,7);
});
test('changed snapshot, query kind, root, filter, or revision rejects stale continuation',()=>{
  const query={kind:'status',binding:{projectRoot:'/trusted',status:null},snapshot:{revision:3,items:['a','b']},total:2,limit:1};
  const cursor=pagination(query).nextCursor;
  for(const patch of [{kind:'history'},{binding:{projectRoot:'/other',status:null}},{binding:{projectRoot:'/trusted',status:'pending'}},{snapshot:{...query.snapshot,revision:4}},{snapshot:{...query.snapshot,items:['a','c']}}])assert.throws(()=>pagination({...query,...patch,cursor}),/CURSOR_OBSOLETO/);
});
test('malformed, unsafe-offset, extra-field and out-of-bounds cursors reject',()=>{
  const query={kind:'work',binding:{id:'W-1'},snapshot:{revision:1},total:5,limit:1};
  const cursor=pagination(query).nextCursor,valid=JSON.parse(Buffer.from(cursor,'base64url'));
  for(const input of ['',null,'$','e30','x'.repeat(4001),...[-1,6,1.5,Number.MAX_SAFE_INTEGER+1].map(offset=>Buffer.from(JSON.stringify({...valid,offset})).toString('base64url')),Buffer.from(JSON.stringify({...valid,extra:1})).toString('base64url')])assert.throws(()=>pagination({...query,cursor:input}),/CURSOR_INVALIDO/);
  assert.deepEqual(pageItems([],{kind:'history',binding:{},snapshot:[]}),{items:[],total:0,hasMore:false,nextCursor:null});
});
