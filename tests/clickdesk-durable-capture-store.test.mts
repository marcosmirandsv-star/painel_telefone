import {test} from 'node:test'
import assert from 'node:assert/strict'
import {postgresCaptureStore} from '../supabase/functions/clickdesk-official-metrics-sync/capture-store.ts'
const row={job_id:'job',task_key:'owner:23',path:'/support/reports/agents?owner_ids[]=23',lease_token:'lease',attempt:2}
test('storage adapter passes the exact fencing token and respects rejected stale writes',async()=>{
 const calls:unknown[]=[]
 const store=postgresCaptureStore({async rpc(name,args){calls.push({name,args});return {data:name==='claim_clickdesk_capture_unit'?[row]:false,error:null}}})
 const unit=(await store.claim())!
 assert.equal(unit.attempt,2)
 assert.equal(await store.complete(unit,{summary:{}}),false)
 assert.equal(await store.retry(unit,'ignored',null),false)
 assert.deepEqual(calls[2],{name:'retry_clickdesk_capture_unit',args:{p_job_id:'job',p_key:'owner:23',p_token:'lease'}})
})
test('storage failures and malformed/multiple claims never become empty queue success',async()=>{
 const error=postgresCaptureStore({async rpc(){return {data:null,error:{message:'sensitive'}}}})
 await assert.rejects(error.claim(),/^Error: capture_storage_failed$/)
 for(const data of [null,[row,row],[{...row,path:'https://other.example/'}],[{...row,attempt:0}]]){
  const store=postgresCaptureStore({async rpc(){return {data,error:null}}})
  await assert.rejects(store.claim())
 }
 const empty=postgresCaptureStore({async rpc(){return {data:[],error:null}}})
 assert.equal(await empty.claim(),null)
})
