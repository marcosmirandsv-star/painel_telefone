import test from 'node:test'
import assert from 'node:assert/strict'
import { summarizeVerifiedContributions } from '../src/lib/clickdesk-verified-productivity.ts'

const rows=[
 {ticket_id:'1',analyst_id:'carlos',team_id:'notas',analyst_name:'Carlos Lemos',occurred_date:'2026-10-07',verified_at:'2026-10-09T15:30:00Z'},
 {ticket_id:'1',analyst_id:'carlos',team_id:'notas',analyst_name:'Carlos Lemos',occurred_date:'2026-10-07',verified_at:'2026-10-09T15:30:00Z'},
 {ticket_id:'1',analyst_id:'paulo',team_id:'notas',analyst_name:'Paulo Victor',occurred_date:'2026-10-08',verified_at:'2026-10-09T15:33:00Z'},
 {ticket_id:'2',analyst_id:'carlos',team_id:'notas',analyst_name:'Carlos Lemos',occurred_date:'2026-10-08',verified_at:'2026-10-09T15:34:00Z'},
 {ticket_id:'3',analyst_id:'ana',team_id:'notas',analyst_name:'Ana Júlia',occurred_date:'2026-10-08',verified_at:'2026-10-09T15:34:00Z'},
]
test('one attendance per ticket and human analyst; separate analysts each get their own real activity',()=>{
 const summary=summarizeVerifiedContributions(rows,'2026-10-08')
 assert.equal(summary.total,3)
 assert.deepEqual(summary.daily,[{date:'2026-10-07',count:1},{date:'2026-10-08',count:2}])
 assert.equal(summary.by_analyst.find(x=>x.analyst_id==='carlos')?.total,2)
 assert.equal(summary.by_analyst.find(x=>x.analyst_id==='paulo')?.total,1)
 assert.equal(summary.by_analyst.some(x=>x.analyst_id==='ana'),false)
 assert.equal(summary.last_verified_at,'2026-10-09T15:34:00Z')
})
test('missing dates are absent, never invented as zero attendance',()=>{
 const summary=summarizeVerifiedContributions(rows.slice(0,1),'2026-10-09')
 assert.equal(summary.today.count,0)
 assert.equal(summary.daily.length,1)
 assert.equal(summary.coverage_status,'partial_until_queue_finished')
})
