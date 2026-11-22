import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { reconciledDaily, sliceOfficialDaily } from '../src/lib/clickdesk-official-daily.ts'

const period = [{ occurred_date:'2026-11-02', assignee_name:'Ana', attendances:5, positive_reviews:3, negative_reviews:2, excluded_neutrals:1, neutral_human:0, neutral_external:1, neutral_pending:1 }]
const daily = [
 { ...period[0], occurred_date:'2026-11-01', attendances:2, positive_reviews:1, negative_reviews:1, excluded_neutrals:0, neutral_external:0, neutral_pending:1 },
 { ...period[0], occurred_date:'2026-11-02', attendances:3, positive_reviews:2, negative_reviews:1, excluded_neutrals:1, neutral_external:1, neutral_pending:0 },
]
test('seleciona somente neutros do dia após conciliação', () => {
 assert.ok(reconciledDaily(period,daily,'2026-11-01','2026-11-02'))
 const {rows} = sliceOfficialDaily(period,daily,'2026-11-01','2026-11-01')
 assert.equal(rows[0].excluded_neutrals,0)
 assert.equal(rows[0].neutral_external,0)
 assert.equal(rows[0].neutral_pending,1)
 assert.equal(rows[0].reviews,2)
})
test('recusa calendário quando neutros diários não conferem com período', () => {
 const mismatch = [{...daily[0],neutral_pending:0},daily[1]]
 assert.equal(reconciledDaily(period,mismatch,'2026-11-01','2026-11-02'),null)
})
test('recusa dia ausente sem tratá-lo como zero', () => {
 assert.equal(reconciledDaily(period,[daily[0]],'2026-11-01','2026-11-02'),null)
})
