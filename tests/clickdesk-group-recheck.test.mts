import test from 'node:test'
import assert from 'node:assert/strict'
import {runGroupRecheck,type Recheck,type RecheckStore}from '../supabase/release-candidates/chat-production-20261118/edge/clickdesk-official-metrics-sync/group-recheck.ts'
const registry=[{clickdesk_owner_id:23,source_owner_name:'Carlos Lemos',source_owner_key:'carlos lemos'}]
const group=(count:number,csat=1)=>({range:{from:'2026-11-01T03:00:00Z',to:'2026-11-20T03:00:00Z'},summary:{received:{value:count}},agents:[{id:23,name:'Carlos Henrique',csat_total:csat,replies:2,resolved:1}]})
function fixture(){
 const check:Recheck={id:'original',start:'2026-11-01',end:'2026-11-19',owners:[23],token:'lease',attempt:1,group:group(1),parts:{
  group:group(0),'owner:23':group(1),
  'ratings:3:1':{total:1,last_page:1,data:[{ticket_id:42,number:124,owner:'Carlos Henrique',sentiment:'positive',label:'Boa',rated_at:'10/11/2026 14:23'}]},
  'ratings:12:1':{total:0,last_page:1,data:[]}
 }}
 const snapshot=JSON.stringify(check.parts);let published=0,rejected=0,rows:unknown[]=[],votes:unknown[]=[]
 const store:RecheckStore={claim:async()=>check,reject:async()=>{rejected++;return true},publish:async(_c,r,v)=>{published++;rows=r;votes=v;return 'successor'}}
 return {check,store,snapshot,get published(){return published},get rejected(){return rejected},get rows(){return rows},get votes(){return votes}}
}
test('real source reread can reconcile a successor without mutating any original source part',async()=>{
 const f=fixture();const result=await runGroupRecheck(f.store,async()=>registry)
 assert.equal(result.status,'published');assert.equal(f.published,1);assert.equal(f.rejected,0)
 assert.equal(JSON.stringify(f.check.parts),f.snapshot);assert.equal(f.votes.length,1)
 assert.equal((f.rows[0]as{attendances:number}).attendances,1)
})
test('an unequal reread cannot publish by tolerance or arithmetic adjustment',async()=>{
 const f=fixture();f.check.group=group(2);const result=await runGroupRecheck(f.store,async()=>registry)
 assert.equal(result.status,'rejected');assert.equal(f.published,0);assert.equal(f.rejected,1);assert.equal(JSON.stringify(f.check.parts),f.snapshot)
})
test('Received equality does not bypass CSAT and paginated vote checks',async()=>{
 const f=fixture();f.check.group=group(1,2);await runGroupRecheck(f.store,async()=>registry);assert.equal(f.published,0);assert.equal(f.rejected,1)
})
test('changed pagination remains blocked after a source reread',async()=>{
 const f=fixture();(f.check.parts['ratings:3:1']as{total:number}).total=2;await runGroupRecheck(f.store,async()=>registry);assert.equal(f.published,0);assert.equal(f.rejected,1)
})
test('a changed roster cannot reuse an earlier capture',async()=>{
 const f=fixture();await runGroupRecheck(f.store,async()=>[]);assert.equal(f.published,0);assert.equal(f.rejected,1)
})
test('a stale database lease is reported without retrying publication',async()=>{
 const f=fixture();f.store.publish=async()=>null;const result=await runGroupRecheck(f.store,async()=>registry);assert.equal(result.status,'stale');assert.equal(f.rejected,0)
})
test('database refusal keeps source parts and metrics unchanged',async()=>{
 const f=fixture();f.store.publish=async()=>{throw Error('database refusal')};const result=await runGroupRecheck(f.store,async()=>registry)
 assert.equal(result.status,'rejected');assert.equal(JSON.stringify(f.check.parts),f.snapshot)
})
test('empty queue is idle and never loads a roster or publishes',async()=>{
 const f=fixture();f.store.claim=async()=>null;assert.equal((await runGroupRecheck(f.store,async()=>{throw Error('must not run')})).status,'idle');assert.equal(f.published,0)
})
