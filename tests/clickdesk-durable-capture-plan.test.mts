import {test} from 'node:test'
import assert from 'node:assert/strict'
import {initialCaptureTasks,remainingRatingTasks,captureReadiness,assertCaptureRoster,captureRetryDelay} from '../supabase/functions/clickdesk-official-metrics-sync/capture-plan.ts'
const start='2026-11-01',end='2026-11-12'
const report=(value:number,id=23)=>({summary:{received:{value}},agents:[{id}]})
const page=(data:unknown[]=[],last_page=1,total=0)=>({data,last_page,total})
const complete=()=>({'group':report(3),'owner:23':report(1,23),'owner:47':report(2,47),'ratings:3:1':page(),'ratings:12:1':page()})
test('plano separa cada responsável e não adiciona attendance=human',()=>{
 const tasks=initialCaptureTasks(start,end,[23,47])
 assert.deepEqual(tasks.map(task=>task.key),['group','owner:23','owner:47','ratings:3:1','ratings:12:1'])
 const owner=new URL('https://example.test'+tasks[1].path)
 assert.deepEqual(owner.searchParams.getAll('owner_ids[]'),['23'])
 assert.equal(tasks.some(task=>task.path.includes('attendance')),false)
 assert.throws(()=>initialCaptureTasks(start,end,[23,23]))
})
test('retomada exige todos os checkpoints e não publica captura parcial',()=>{
 const parts=complete();assert.equal(captureReadiness(start,end,[23,47],parts).ready,true)
 const {['owner:47']:removed,...missing}=parts
 assert.deepEqual(captureReadiness(start,end,[23,47],missing),{ready:false,missing:['owner:47']})
 assert.equal(removed.summary.received.value,2)
})
test('paginação descoberta gera unidades adicionais e exige quantidade integral',()=>{
 const parts:Record<string,unknown>=complete();parts['ratings:3:1']=page([1],2,2)
 assert.deepEqual(remainingRatingTasks(start,end,3,parts['ratings:3:1']).map(task=>task.key),['ratings:3:2'])
 assert.equal(captureReadiness(start,end,[23,47],parts).ready,false)
 parts['ratings:3:2']=page([2],2,2);assert.equal(captureReadiness(start,end,[23,47],parts).ready,true)
 parts['ratings:3:2']=page([],2,2);assert.throws(()=>captureReadiness(start,end,[23,47],parts),/incomplete/)
 parts['ratings:3:2']=page([2],2,3);assert.throws(()=>captureReadiness(start,end,[23,47],parts),/changed/)
})
test('diferença de recebidos e mudança de quadro impedem publicação',()=>{
 assert.throws(()=>captureReadiness(start,end,[23,47],{...complete(),group:report(4)}),/not_reconciled/)
 assert.throws(()=>assertCaptureRoster([23,47],[23,85]),/roster_changed/)
 assert.doesNotThrow(()=>assertCaptureRoster([23,47],[47,23]))
})
test('retentativa tem espera progressiva e limite explícito',()=>{
 assert.ok(captureRetryDelay(2)>captureRetryDelay(1))
 assert.throws(()=>captureRetryDelay(6),/exhausted/)
})

test('datas inexistentes não geram captura e outubro usa o mesmo plano de recebidos',()=>{
 assert.throws(()=>initialCaptureTasks('2026-02-29','2026-02-29',[23]),/invalid_capture_period/)
 assert.throws(()=>initialCaptureTasks('2026-11-01','2026-11-31',[23]),/invalid_capture_period/)
 const tasks=initialCaptureTasks('2026-10-01','2026-10-31',[23])
 assert.equal(tasks.length,4)
 assert.ok(tasks.every(task=>task.path.includes('from=2026-10-01')))
 assert.equal(tasks.some(task=>task.path.includes('resolved')),false)
})
