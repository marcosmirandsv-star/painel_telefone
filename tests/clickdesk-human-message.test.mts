import test from 'node:test'
import assert from 'node:assert/strict'
import { firstPublicReplyByAssignee } from '../supabase/functions/clickdesk-d1-sync/human-message.ts'

const author='Carlos Lemos'
test('human productivity requires verified public response by the named analyst',()=>{
 const result=firstPublicReplyByAssignee([
   {id:2,created_at:'2026-10-09T13:02:00Z',author_type:'agent',visibility:'private',author},
   {id:3,created_at:'2026-10-09T13:01:00Z',author_type:'bot',visibility:'public',author},
   {id:4,created_at:'2026-10-09T13:04:00Z',author_type:'agent',visibility:'public',author:'Outro Analista'},
   {id:6,created_at:'2026-10-09T13:10:00Z',author_type:'agent',visibility:'public',author},
   {id:5,created_at:'2026-10-09T13:05:00Z',author_type:'agent',visibility:'public',author},
 ],author)
 assert.deepEqual(result,{messageId:'5',timestamp:'2026-10-09T13:05:00Z',author})
})
test('a prior public Commercial response never prevents later credited Fiscal agent',()=>{
 const result=firstPublicReplyByAssignee([
   {id:13,created_at:'2026-10-09T13:03:00Z',author_type:'agent',visibility:'public',author:'Pessoa do Comercial'},
   {id:14,created_at:'2026-10-09T13:13:00Z',author_type:'agent',visibility:'public',author:'Carlos Lemos'},
 ],'CARLOS LEMOS')
 assert.equal(result?.messageId,'14')
})
test('unknown identity, private and timeline fallbacks cannot become productivity',()=>{
 const bad=[
   {id:15,created_at:'2026-10-09T13:03:00Z',author_type:'agent',visibility:'private',author},
   {id:16,created_at:'2026-10-09T13:05:00Z',author_type:'bot',visibility:'public',author},
   {id:17,created_at:'2026-10-09T13:06:00Z',author_type:'agent',visibility:'public',author:'Outro Analista'},
   {id:18,created_at:'2026-10-09T13:07:00',author_type:'agent',visibility:'public',author},
   {id:19,created_at:'2026-10-09T13:07:00Z',author_type:'agent',visibility:'unknown',author},
 ]
 assert.equal(firstPublicReplyByAssignee(bad,author),null)
 assert.equal(firstPublicReplyByAssignee([],'Carlos Lemos'),null)
})
test('nested author and explicit is_public flag are accepted',()=>{
 const result=firstPublicReplyByAssignee([{
   id:'m44',timestamp:'2026-10-09T14:02:00-03:00',
   author:{name:'Carlos Lemos',type:'agent'},is_public:true,
 }], author)
 assert.equal(result?.messageId,'m44')
})
