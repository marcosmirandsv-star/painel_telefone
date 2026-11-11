import test from 'node:test'
import assert from 'node:assert/strict'
import {reconciledDaily,sliceOfficialDaily} from '../src/lib/clickdesk-official-daily.ts'
const row={occurred_date:'2026-11-01',assignee_name:'Analista',attendances:4,positive_reviews:1,negative_reviews:1}
test('dias completos conciliados preservam contagens e zero comprovado',()=>{
 const daily=[row,{...row,occurred_date:'2026-11-02',attendances:0,positive_reviews:0,negative_reviews:0}]
 assert.equal(reconciledDaily([row],daily,'2026-11-01','2026-11-02'),daily)
})
test('dia ausente, repetido ou divergente nunca produz distribuição diária',()=>{
 assert.equal(reconciledDaily([row],[row],'2026-11-01','2026-11-02'),null)
 assert.equal(reconciledDaily([row],[row,row],'2026-11-01','2026-11-02'),null)
 assert.equal(reconciledDaily([{...row,attendances:8}],[row,{...row,occurred_date:'2026-11-02',attendances:0}],'2026-11-01','2026-11-02'),null)
})

test('recorte semanal usa apenas contagens conciliadas, sem média de percentuais nem alterar o mês',()=>{
 const daily=[row,{...row,occurred_date:'2026-11-02',attendances:6,positive_reviews:3,negative_reviews:0}]
 const source={...row,attendances:10,positive_reviews:4,negative_reviews:1}
 assert.ok(reconciledDaily([source],daily,'2026-11-01','2026-11-02'))
 const selected=sliceOfficialDaily([source],daily,'2026-11-02','2026-11-02')
 assert.deepEqual(selected.rows.map(r=>[r.attendances,r.positive_reviews,r.negative_reviews,r.reviews]),[[6,3,0,3]])
 assert.equal(source.attendances,10)
 assert.equal(selected.dailyRows.length,1)
})
