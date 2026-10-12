import test from 'node:test'
import assert from 'node:assert/strict'
import {reconcileLiveTeam,type HumanTicket} from '../src/lib/clickdesk-live-reconciliation.ts'
const make=(ticket_id:string,analyst_id:string,satisfaction_label:string|null,source:'legacy'|'verified'='verified',final=false):HumanTicket=>({
 ticket_id,analyst_id,occurred_date:'2026-10-09',satisfaction_label,source,
 rating_attribution:final?'last_public_human_answer':null,
})
const people=[{id:'joao',name:'João Pedro'},{id:'vanessa',name:'Vanessa Silva'},{id:'ana',name:'Ana Júlia'}]
test('transfer credits the final human only, with the evaluation',()=>{
 const rows=[make('1','joao',null),make('1','vanessa','positive','verified',true)]
 const x=reconcileLiveTeam(people,rows,'vanessa')
 const y=reconcileLiveTeam(people,rows,'joao')
 assert.equal(x?.attendances,1);assert.equal(x?.reviews,1);assert.equal(x?.positive_reviews,1)
 assert.equal(y?.attendances,0);assert.equal(y?.transferred_to_another_human,1)
})
test('unrated ticket with a single known human counts one service but no rating',()=>{
 const r=reconcileLiveTeam(people,[make('2','vanessa',null)],'vanessa')
 assert.equal(r?.attendances,1);assert.equal(r?.reviews,0);assert.equal(r?.csat,null)
})
test('multi human unrated is pending: first answer is not last answer',()=>{
 const rows=[make('3','joao',null),make('3','vanessa',null)]
 for(const person of ['vanessa','joao']){
  const r=reconcileLiveTeam(people,rows,person)
  assert.equal(r?.attendances,0);assert.equal(r?.pending_owner_tickets,1)
 }
})
test('legacy rating alone does not establish final human after a transfer',()=>{
 const r=reconcileLiveTeam(people,[make('4','joao','negative','legacy'),make('4','vanessa',null)],'joao')
 assert.equal(r?.attendances,0);assert.equal(r?.pending_owner_tickets,1)
})
test('same ticket in legacy and verified is not double counted',()=>{
 const r=reconcileLiveTeam(people,[make('5','vanessa','positive','legacy'),make('5','vanessa',null)],'vanessa')
 assert.equal(r?.attendances,1);assert.equal(r?.positive_reviews,1)
})
test('exclude apprentices from individual metrics',()=>{
 const r=reconcileLiveTeam(people,[make('6','ana',null),make('7','vanessa',null)],'vanessa')
 assert.equal(r?.attendances,1);assert.equal(r?.podium.team_average_attendances,1)
})
test('team volume reference counts final owner only',()=>{
 const rows=[...Array.from({length:3},(_,i)=>make('v'+i,'vanessa',null)),
 ...Array.from({length:5},(_,i)=>make('j'+i,'joao',null))]
 const r=reconcileLiveTeam(people,rows,'vanessa')
 assert.equal(r?.podium.team_average_attendances,4);assert.equal(r?.podium.criteria.volume_met,false)
})
