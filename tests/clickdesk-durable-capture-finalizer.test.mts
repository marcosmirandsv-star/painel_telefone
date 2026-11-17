import {test} from 'node:test'
import assert from 'node:assert/strict'
import {finalizeReadyCapture,type FinalizationStore} from '../supabase/functions/clickdesk-official-metrics-sync/capture-finalizer.ts'
const registry=[{clickdesk_owner_id:23,source_owner_name:'Carlos Lemos',source_owner_key:'carlos lemos'}]
const report={summary:{received:{value:2}},agents:[{id:23,name:'Carlos Henrique',replies:0,resolved:1,csat_total:0}]}
const snapshot={id:'job',start:'2026-10-01',end:'2026-10-31',owners:[23],parts:{group:report,'owner:23':report,'ratings:3:1':{data:[],last_page:1,total:0},'ratings:12:1':{data:[],last_page:1,total:0}}}
test('only a complete reconciled snapshot reaches atomic publisher',async()=>{
 let writes=0
 const store:FinalizationStore={async fail(){},async ready(){return snapshot},async registry(){return registry},async publish(id,rows,votes){writes++;assert.equal(id,'job');assert.equal(rows.length,1);assert.equal(votes.length,0);return true}}
 assert.equal((await finalizeReadyCapture(store)).status,'published');assert.equal(writes,1)
 const {['owner:23']:ignored,...partial}=snapshot.parts
 assert.equal((await finalizeReadyCapture({...store,async ready(){return {...snapshot,parts:partial}}})).status,'failed')
 assert.equal((await finalizeReadyCapture({...store,async registry(){return []}})).status,'failed')
 assert.equal(writes,1);assert.ok(ignored)
})
test('lost publication race and empty queue do not report a new publication',async()=>{
 const store:FinalizationStore={async fail(){},async ready(){return snapshot},async registry(){return registry},async publish(){return false}}
 assert.equal((await finalizeReadyCapture(store)).status,'pending')
 assert.equal((await finalizeReadyCapture({...store,async ready(){return null}})).status,'idle')
})
