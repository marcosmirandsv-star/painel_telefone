import test from 'node:test'
import assert from 'node:assert/strict'
import {summarizeIdentifiedTickets} from '../src/lib/clickdesk-identified-tickets.ts'
test('unique total and chronological daily count',()=>{
 const old=[{ticket_id:'1',occurred_date:'2026-10-01'},{ticket_id:'2',occurred_date:'2026-10-01'}]
 const recovered=[{ticket_id:'3',occurred_date:'2026-10-09'},{ticket_id:'2',occurred_date:'2026-10-09'}]
 const r=summarizeIdentifiedTickets(old,recovered)
 assert.equal(r.total,3)
 assert.equal(r.overlap_count,1)
 assert.deepEqual(r.daily.map(x=>[x.date,x.count]),[['2026-10-01',1],['2026-10-09',2]])
 assert.equal(r.official,false)
})
test('unrated recovered tickets are counted normally',()=>{
 const r=summarizeIdentifiedTickets([],[{ticket_id:'1058500',occurred_date:'2026-10-09'}])
 assert.equal(r.total,1)
})
