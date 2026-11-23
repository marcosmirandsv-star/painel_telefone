import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readCompleteHistory,runPilot} from '../src/lib/neutral-pilot/pilot-runner.ts'
const message={id:'1',created_at:'2026-11-17T18:00:00Z',author:{name:'Diego Machado',type:'agent'},visibility:'public',body:'O sistema está indisponível neste momento.',attachments:[]}
const page=(rows:unknown[],current=1,last=1)=>({data:rows,meta:{current_page:current,last_page:last,total:rows.length}})
const record=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{}
test('explicit complete pagination covers detail messages and attachments',async()=>{
 const history=await readCompleteHistory('1098085',async path=>path.includes('/messages?')?page([message]):path.includes('/events?')?page([]):{id:'1098085',updated_at:'2026-11-17T20:00:00Z',messages:[message]})
 assert.equal(history.complete,true)
})
test('short page without pagination is not complete',async()=>{
 const history=await readCompleteHistory('1098085',async path=>path.includes('?')?[message]:{id:'1098085',updated_at:'2026-11-17T20:00:00Z',messages:[message]})
 assert.equal(history.complete,false);assert.ok(history.gaps.includes('messages_pagination_unverified'))
})
test('missing attachments metadata is a coverage gap',async()=>{
 const without=Object.fromEntries(Object.entries(message).filter(([key])=>key!=='attachments'))
 const history=await readCompleteHistory('1098085',async path=>path.includes('/messages?')?page([without]):path.includes('/events?')?page([]):{id:'1098085',updated_at:'2026-11-17T20:00:00Z',messages:[without]})
 assert.ok(history.gaps.includes('attachment_coverage_unknown'))
})
test('ignored page and duplicate ids cannot establish coverage',async()=>{
 const history=await readCompleteHistory('1098085',async path=>path.includes('?')?page([message],1,2):{id:'1098085',updated_at:'2026-11-17T20:00:00Z',messages:[message]})
 assert.equal(history.complete,false)
})
const env={CLICKDESK_API_KEY:'secret-source',CLICKDESK_ACCOUNT_ID:'account',GOOGLE_API_KEY:'secret-provider'}
test('allowlist blocks network before any request',async()=>{
 let calls=0;await assert.rejects(runPilot({env,ticketIds:['32'],fetchImpl:(async()=>{calls++;return new Response()}) as typeof fetch}),/allowlisted/);assert.equal(calls,0)
})
test('history gaps prevent provider calls and redact errors',async()=>{
 let provider=0
 const result=await runPilot({env,ticketIds:['1098085'],fetchImpl:(async input=>{if(String(input).includes('googleapis'))provider++;return Response.json({id:'1098085',updated_at:'2026-11-17T20:00:00Z',messages:[]})}) as typeof fetch})
 assert.equal(provider,0);assert.equal(record(result.results[0]).status,'gap');assert.ok(!JSON.stringify(result).includes('secret'))
})
test('complete history makes exactly two independent provider calls and never excludes',async()=>{
 let provider=0,detailReads=0
 const result=await runPilot({env,ticketIds:['1098085'],fetchImpl:(async input=>{
  const url=String(input)
  if(url.includes('googleapis')){provider++;return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({cause:'system',confidence:'high',explanation:'A mensagem pública descreve indisponibilidade concreta do sistema.',human_contribution:false,evidences:[{message_id:'1',quote:message.body}]})}]}}]})}
  if(!url.includes('?'))detailReads++
  return Response.json(url.includes('/messages?')?page([message]):url.includes('/events?')?page([]):{id:'1098085',updated_at:'2026-11-17T20:00:00Z',messages:[message]})
 }) as typeof fetch})
 assert.equal(provider,2);assert.equal(detailReads,2);const analysis=record(record(result.results[0]).analysis);assert.equal(analysis.cause,'system');assert.equal(analysis.exclusion_eligible,false);assert.equal(analysis.pattern,'none');assert.ok(!JSON.stringify(result).includes('secret'))
})

for(const mode of ['missing','changed'] as const){
 test('conversation version '+mode+' prevents Gemini',async()=>{
  let provider=0,detailReads=0
  const result=await runPilot({env,ticketIds:['1098085'],fetchImpl:(async input=>{
   const url=String(input)
   if(url.includes('googleapis')){provider++;throw Error('unexpected_provider_call')}
   if(url.includes('/messages?'))return Response.json(page([message]))
   if(url.includes('/events?'))return Response.json(page([]))
   detailReads++
   return Response.json({id:'1098085',messages:[message],...(mode==='missing'?{}:{updated_at:detailReads===1?'2026-11-17T20:00:00Z':'2026-11-17T20:01:00Z'})})
  }) as typeof fetch})
  assert.equal(provider,0);assert.equal(detailReads,2)
  const row=record(result.results[0]);assert.equal(row.status,'gap')
  assert.ok(Array.isArray(row.gaps)&&row.gaps.includes(mode==='missing'?'conversation_version_unknown':'conversation_changed_during_read'))
 })
}

