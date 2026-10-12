import test from 'node:test'
import assert from 'node:assert/strict'
import { lastHumanRatingOwner } from '../supabase/functions/clickdesk-verified-capture/last-human-rating.ts'

function reply(id:string, author:string, at:string, visibility='public',role='agent') {
  return { id,author_type:role,visibility,author,created_at:at }
}

test('customer rating goes to the last public human, even when the first came from a different team',()=>{
  const result=lastHumanRatingOwner([
    reply('m1','João Pedro Santana','2026-10-08T11:00:00Z'),
    reply('m2','Carlos Lemos','2026-10-08T11:10:00Z'),
    reply('m3','João Pedro Santana','2026-10-08T11:03:00Z'),
    reply('m4','Carlos Lemos','2026-10-08T11:15:00Z'),
    reply('m5','IA','2026-10-08T11:16:00Z','public','bot'),
  ])
  assert.deepEqual(result,{ok:true,message_id:'m4',author_name:'Carlos Lemos',answered_at:'2026-10-08T11:15:00Z'})
})
test('never award earlier specialist the rating when the final agent belongs to another team',()=>{
  assert.equal(lastHumanRatingOwner([
    reply('10','Carlos Lemos','2026-10-08T10:00:00Z'),
    reply('11','Pessoa do Financeiro','2026-10-08T10:05:00Z'),
  ]).ok,true)
  const choice=lastHumanRatingOwner([
    reply('10','Carlos Lemos','2026-10-08T10:00:00Z'),
    reply('11','Pessoa do Financeiro','2026-10-08T10:05:00Z'),
  ])
  if(choice.ok) assert.equal(choice.author_name,'Pessoa do Financeiro')
})
test('private notes and bot interactions are not human service',()=>{
  const owner=lastHumanRatingOwner([
    reply('1','Paulo Victor','2026-10-08T15:05:00Z'),
    reply('2','Outro Analista','2026-10-08T15:08:00Z','private'),
    reply('3','IA','2026-10-08T15:09:00Z','public','bot'),
  ])
  assert.equal(owner.ok,true)
  if(owner.ok)assert.equal(owner.author_name,'Paulo Victor')
})
test('tie by timestamp across different agents must remain unassigned',()=>{
 const choice=lastHumanRatingOwner([
   reply('1','João Pedro','2026-10-08T13:00:00Z'),
   reply('2','Thiago Reis','2026-10-08T13:00:00Z'),
 ])
 assert.deepEqual(choice,{ok:false,reason:'simultaneous_last_authors'})
})
test('malformed public agent history must not assign customer rating',()=>{
 const choice=lastHumanRatingOwner([
  reply('1','Carlos Lemos','2026-10-08T13:00:00Z'),
  reply('2','Thiago Reis','invalid'),
 ])
 assert.deepEqual(choice,{ok:false,reason:'ambiguous_public_agent_history'})
})
test('unknown message author cannot credit another earlier agent',()=>{
 assert.deepEqual(lastHumanRatingOwner([
  reply('1','Carlos Lemos','2026-10-08T13:00:00Z'),
  {id:'2',author_type:'agent',visibility:'public',created_at:'2026-10-08T14:00:00Z'},
 ]),{ok:false,reason:'ambiguous_public_agent_history'})
})
test('nested ClickDesk author and explicit public visibility supported',()=>{
 assert.deepEqual(lastHumanRatingOwner([{
  id:3489019,author:{name:'Diego Machado',type:'agent'},visibility:'public',
  timestamp:'2026-10-08T20:43:04.000000Z',
 }]),{ok:true,message_id:'3489019',author_name:'Diego Machado',answered_at:'2026-10-08T20:43:04.000000Z'})
})
test('no public message has no rating owner',()=>{
 assert.deepEqual(lastHumanRatingOwner([]),{ok:false,reason:'no_public_agent_message'})
})
