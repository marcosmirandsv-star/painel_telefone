import test from 'node:test'
import assert from 'node:assert/strict'
import { captureVerifiedHumanContributions } from '../src/lib/clickdesk-human-capture.ts'

const analysts = [
  {id:'outros',team_id:'other-team',name:'João Pedro Santana',identity_role:'analyst'},
  {id:'carlos',team_id:'fiscal-team',name:'Carlos Lemos',identity_role:'analyst'},
  {id:'junior',team_id:'fiscal-team',name:'Ana Júlia',identity_role:'apprentice'},
]
const input = {
  ticket_id:'1057001',
  ticket_created_at:'2026-10-09T12:00:00Z',
  analysts,
  events:[
    {id:'101',created_at:'2026-10-09T12:02:00Z',field:'department',new:'Outros'},
    {id:'103',created_at:'2026-10-09T12:16:00Z',field:'department',new:'Suporte - Fiscal'},
  ],
  messages:[
    {id:'m0',created_at:'2026-10-09T12:03:00Z',author_type:'bot',visibility:'public',author:'IA'},
    {id:'m1',created_at:'2026-10-09T12:05:00Z',author_type:'agent',visibility:'public',author:'João Pedro Santana'},
    {id:'m2',created_at:'2026-10-09T12:20:00Z',author_type:'agent',visibility:'public',author:'Carlos Lemos'},
    {id:'m3',created_at:'2026-10-09T12:21:00Z',author_type:'agent',visibility:'public',author:'Carlos Lemos'},
    {id:'m4',created_at:'2026-10-09T12:22:00Z',author_type:'agent',visibility:'private',author:'Carlos Lemos'},
    {id:'m5',created_at:'2026-10-09T12:23:00Z',author_type:'agent',visibility:'public',author:'Ana Júlia'},
    {id:'m6',created_at:'2026-10-09T12:24:00Z',author_type:'agent',visibility:'public',author:'Carlos Lemos'},
  ],
}
test('credits each verified analyst once, no matter where the ticket started',()=>{
  const result=captureVerifiedHumanContributions(input)
  assert.equal(result.length,2)
  assert.deepEqual(result.map(x=>x.analyst_id),['outros','carlos'])
  assert.deepEqual(result.map(x=>x.first_public_human_message_id),['m1','m2'])
  assert.deepEqual(result.map(x=>x.area_at_answer),['Outros','Suporte - Fiscal'])
})
test('ignores prior human contributions from outside the registered team and counts Carlos',()=>{
  const result=captureVerifiedHumanContributions({
    ...input,
    messages:[{id:'prior',created_at:'2026-10-09T12:04:00Z',author_type:'agent',visibility:'public',author:'Financeiro'}, input.messages[2]],
    events:[],
  })
  assert.deepEqual(result.map(x=>x.analyst_id),['carlos'])
  assert.equal(result[0].area_at_answer,null)
})
test('rejects ambiguous registered identity and inactive staff',()=>{
  const result=captureVerifiedHumanContributions({
    ...input, analysts:[...analysts,{id:'duplicado',team_id:'x',name:'Carlos Lemos',identity_role:'analyst'}],
  })
  assert.deepEqual(result.map(x=>x.analyst_id),['outros'])
  const inactive=captureVerifiedHumanContributions({
    ...input, analysts:[{...analysts[1],active:false}],
  })
  assert.deepEqual(inactive,[])
})
test('one historical ticket spanning dates is credited on the analyst response day',()=>{
  const result=captureVerifiedHumanContributions({
    ...input, ticket_created_at:'2026-10-03T15:00:00Z', messages:[{
      id:55,created_at:'2026-10-09T12:20:00Z',author_type:'agent',visibility:'public',author:'Carlos Lemos',
    }],
  })
  assert.equal(result[0].ticket_created_date,'2026-10-03')
  assert.equal(result[0].human_answered_date,'2026-10-09')
})
