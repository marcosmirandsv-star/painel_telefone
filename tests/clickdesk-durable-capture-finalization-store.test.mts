import {test} from 'node:test'
import assert from 'node:assert/strict'
import {postgresFinalizationStore} from '../supabase/functions/clickdesk-official-metrics-sync/capture-finalization-store.ts'
test('finalization adapter distinguishes no ready capture from database failure',async()=>{
 const empty=postgresFinalizationStore({async rpc(){return {data:null,error:null}}},async()=>[])
 assert.equal(await empty.ready(),null)
 const failed=postgresFinalizationStore({async rpc(){return {data:null,error:{}}}},async()=>[])
 await assert.rejects(failed.ready(),/snapshot_failed/)
 await assert.rejects(failed.publish('job',[],[]),/finalization_failed/)
})
test('finalization adapter sends rows and original votes to a single atomic RPC',async()=>{
 const calls:unknown[]=[]
 const store=postgresFinalizationStore({async rpc(name,args){calls.push({name,args});return {data:true,error:null}}},async()=>[])
 const votes=[{ticket_id:'42',original_label:'Neutro'}]
 assert.equal(await store.publish('job',[{attendances:2}],votes),true)
 assert.deepEqual(calls,[{name:'finalize_clickdesk_capture',args:{p_job_id:'job',p_rows:[{attendances:2}],p_votes:votes}}])
})
