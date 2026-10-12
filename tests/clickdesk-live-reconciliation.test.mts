import test from 'node:test'
import assert from 'node:assert/strict'
import {reconcileLiveTeam,type HumanTicket} from '../src/lib/clickdesk-live-reconciliation.ts'
const r=(ticket_id:string,analyst_id:string,satisfaction_label:string|null,source:'legacy'|'verified'='verified'):HumanTicket=>({ticket_id,analyst_id,occurred_date:'2026-10-09',satisfaction_label,source,rating_attribution:source==='verified'&&satisfaction_label?'last_public_human_answer':null})
const team=[{id:'vanessa',name:'Vanessa Silva'},{id:'joao',name:'João Pedro'},{id:'ana',name:'Ana Júlia'}]
test('multi-agent volume per analyst; rating solely on last agent',()=>{
 const a=reconcileLiveTeam(team,[r('1','vanessa',null),r('1','joao','positive'),r('2','vanessa','negative'),r('3','vanessa',null),r('4','ana','positive')],'vanessa')
 assert.equal(a?.attendances,3);assert.equal(a?.reviews,1);assert.equal(a?.csat,0);assert.equal(a?.review_percentage,33.33);assert.equal(a?.podium.total_ranked,2)
})
test('deduplicate same ticket+analyst across legacy and verified',()=>{
 const a=reconcileLiveTeam(team,[r('1','vanessa','positive','legacy'),r('1','vanessa','positive')],'vanessa')
 assert.equal(a?.attendances,1);assert.equal(a?.positive_reviews,1)
})
test('unrated is valid, never inferred negative or inactivity',()=>{
 const a=reconcileLiveTeam(team,[r('1','vanessa',null)],'vanessa')
 assert.equal(a?.csat,null);assert.equal(a?.review_percentage,0);assert.equal(a?.inactivity_not_identified,true)
})
test('team mean considers all volume, not evaluated tickets',()=>{
 const a=reconcileLiveTeam(team,[...Array.from({length:3},(_,i)=>r('v'+i,'vanessa',null)),...Array.from({length:5},(_,i)=>r('j'+i,'joao',null))],'vanessa')
 assert.equal(a?.podium.team_average_attendances,4);assert.equal(a?.podium.criteria.volume_met,false)
})
test('ambiguous ratings withheld',()=>{
 const a=reconcileLiveTeam(team,[r('1','vanessa','positive','legacy'),r('1','joao','negative','legacy')],'vanessa')
 assert.equal(a?.reviews,0);assert.equal(a?.ambiguous_rated_tickets,1)
})
