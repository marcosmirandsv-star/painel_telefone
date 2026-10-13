import test from 'node:test'
import assert from 'node:assert/strict'
import {reconcileLiveTeam, type HumanTicket} from '../src/lib/clickdesk-live-reconciliation.ts'

const left=[{id:'marcos-analyst',name:'Analista do especializado'}]
const right=[{id:'polyana-analyst',name:'Analista de outros'}]
const one=(ticket_id:string,analyst_id:string,score:string|null,final=false):HumanTicket=>({
 ticket_id,analyst_id,occurred_date:'2026-10-08',source:'verified',
 satisfaction_label:score,rating_attribution:final?'last_public_human_answer':null,
})
test('one ticket transferred between teams is credited only to verified final owner',()=>{
 const full=[one('t1','marcos-analyst',null),one('t1','polyana-analyst','positive',true)]
 const specialized=reconcileLiveTeam(left,full,'marcos-analyst')
 const others=reconcileLiveTeam(right,full,'polyana-analyst')
 assert.equal(specialized?.attendances,0)
 assert.equal(others?.attendances,1)
 assert.equal(others?.positive_reviews,1)
})
test('two roles reading the same analyst via the same ledger obtain identical indicators',()=>{
 const full=[one('t1','marcos-analyst','negative',true),one('t2','marcos-analyst',null)]
 const first=reconcileLiveTeam(left,full,'marcos-analyst')
 const second=reconcileLiveTeam(left,full,'marcos-analyst')
 assert.deepEqual({att:first?.attendances,csat:first?.csat,review:first?.review_percentage,podium:first?.podium},
 {att:second?.attendances,csat:second?.csat,review:second?.review_percentage,podium:second?.podium})
})
test('unrated cross-team transfer is pending, not guessed by either manager',()=>{
 const rows=[one('t1','marcos-analyst',null),one('t1','polyana-analyst',null)]
 const a=reconcileLiveTeam(left,rows,'marcos-analyst')
 const b=reconcileLiveTeam(right,rows,'polyana-analyst')
 assert.equal(a?.attendances,0); assert.equal(b?.attendances,0)
 assert.equal(a?.pending_owner_tickets,1);assert.equal(b?.pending_owner_tickets,1)
})
