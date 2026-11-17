import {test} from 'node:test'
import assert from 'node:assert/strict'
import {runCaptureUnit,type CaptureStore,type ClaimedUnit} from '../supabase/functions/clickdesk-official-metrics-sync/capture-worker.ts'
const unit:ClaimedUnit={jobId:'job',key:'owner:23',path:'/report',token:'lease',attempt:1}
function fixture(value:ClaimedUnit|null=unit){
 const completed:unknown[]=[],retries:unknown[][]=[]
 let current=value
 const store:CaptureStore={
  async claim(){const result=current;current=null;return result},
  async complete(claim,payload){completed.push(payload);return claim.token==='lease'},
  async retry(claim,error,next){retries.push([error,next]);return claim.token==='lease'},
 }
 return {store,completed,retries}
}
test('one invocation checkpoints one unit and does not publish a partial capture',async()=>{
 const f=fixture();let calls=0
 const result=await runCaptureUnit(f.store,async(path,signal)=>{calls++;assert.equal(path,'/report');assert.equal(signal.aborted,false);return {summary:{}}})
 assert.equal(result.status,'checkpointed');assert.equal(calls,1);assert.equal(f.completed.length,1)
 assert.equal((await runCaptureUnit(f.store,async()=>{throw Error('should not fetch')})).status,'idle')
})
test('source failure schedules bounded retry without leaking provider text',async()=>{
 const f=fixture()
 assert.equal((await runCaptureUnit(f.store,async()=>{throw Error('secret customer text')},()=>0)).status,'retry')
 assert.deepEqual(f.retries,[['capture_unit_failed','1970-01-01T00:00:30.000Z']]);assert.equal(f.completed.length,0)
 const last=fixture({...unit,attempt:5})
 assert.equal((await runCaptureUnit(last.store,async()=>null)).status,'exhausted')
 assert.deepEqual(last.retries,[['capture_unit_failed',null]])
})
test('expired lease result cannot become a successful checkpoint',async()=>{
 const f=fixture({...unit,token:'expired'})
 assert.equal((await runCaptureUnit(f.store,async()=>({data:[]}))).status,'stale')
})
