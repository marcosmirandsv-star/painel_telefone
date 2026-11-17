import {test} from 'node:test'
import assert from 'node:assert/strict'
import {assembleCapture} from '../supabase/functions/clickdesk-official-metrics-sync/capture-assembly.ts'
const registry=[{clickdesk_owner_id:23,source_owner_name:'Carlos Lemos',source_owner_key:'carlos lemos'}]
const report={summary:{received:{value:2}},agents:[{id:23,name:'Carlos Henrique',replies:3,resolved:1,csat_total:1}]}
const vote={ticket_id:42,number:100,owner:'Carlos Henrique',sentiment:'positive',label:'Bom',rated_at:'02/10/2026 10:00'}
const parts=()=>({group:report,'owner:23':report,'ratings:3:1':{data:[vote],last_page:1,total:1},'ratings:12:1':{data:[],last_page:1,total:0}})
test('October assembly uses received header and retains original rating with source alias',()=>{
 const result=assembleCapture(registry,'2026-10-01','2026-10-31',parts())
 assert.equal(result.records[0].attendances,2)
 assert.equal(result.records[0].resolved,1)
 assert.equal(result.records[0].attendance_basis,'received')
 assert.equal(result.records[0].positive_reviews,1)
 assert.equal(result.votes[0].original_label,'Bom')
 assert.equal(result.votes[0].ticket_id,'42')
 assert.equal(result.votes[0].source_owner_key,'carlos lemos')
})
test('incomplete checkpoints or conflicting ratings cannot reach publication assembly',()=>{
 const p:Record<string,unknown>=parts();delete p['owner:23']
 assert.throws(()=>assembleCapture(registry,'2026-10-01','2026-10-31',p),/not_ready/)
 const conflict={...parts(),'ratings:12:1':{data:[{...vote,sentiment:'negative'}],last_page:1,total:1}}
 assert.throws(()=>assembleCapture(registry,'2026-10-01','2026-10-31',conflict),/Conflicting duplicate/)
})
