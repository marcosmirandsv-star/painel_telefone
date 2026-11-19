import test from 'node:test'
import assert from 'node:assert/strict'
import {runInvestigation,InvestigationSourceError} from '../supabase/release-candidates/chat-production-20261118/edge/clickdesk-official-metrics-sync/investigation.ts'

const range={from:'2026-10-01T03:00:00+00:00',to:'2026-11-01T03:00:00+00:00',timezone:'America/Sao_Paulo'}
const received=(n:number,id?:number)=>({range,summary:{received:{value:n}},agents:id?[{id,name:id===39?'Igor Siqueira':'Carlos Lemos'}]:[{id:39,name:'Igor Siqueira'},{id:23,name:'Carlos Henrique'}]})
const ticket=(id:number,owner:number|null=39,department:number|null=3,updated='2026-10-30T12:00:00Z')=>({id,number:id===1075973?1131861:id+100,owner:owner===null?null:{id:owner,name:'person'},department:department===null?null:{id:department},channel:'whatsapp',created_at:'2026-10-26T18:07:17Z',updated_at:updated,client:{email:'never-store@example.test'},last_customer_text:'never store this'})
const incoming=ticket(1075973,39,3,'2026-11-19T12:17:25Z')
const ev=(id:number,field:string,old:string|null,next:string|null,at:string,actor:string|null=null)=>({id,field,old,new:next,created_at:at,actor})
const incomingEvents=[
 ev(268228,'department','Suporte - ERP','Renovação','2026-11-19T10:44:33Z','IA'),
 ev(268553,'owner',null,'Ingred Silva','2026-11-19T11:49:45Z','Ingred Silva'),
 ev(268645,'owner','Ingred Silva',null,'2026-11-19T11:57:59Z','Ingred Silva'),
 ev(268646,'department','Renovação','Suporte - ERP','2026-11-19T11:57:59Z','Ingred Silva'),
 ev(268686,'owner',null,'Igor Siqueira','2026-11-19T12:00:27Z','Igor Siqueira'),
 ev(268897,'status','Aberto','Pendente','2026-11-19T12:17:25Z','Igor Siqueira'),
 ev(1,'requester',null,'private customer','2026-10-26T18:07:17Z')
]
const context=()=>({id:'job',start:'2026-10-01',end:'2026-10-31',owners:[23,39],registry:[{id:23,name:'Carlos Lemos'},{id:39,name:'Igor Siqueira'}],parts:{group:received(2),'owner:23':received(1,23),'owner:39':received(2,39)},times:{group:'2026-11-19T11:54:22Z','owner:23':'2026-11-19T11:56:00Z','owner:39':'2026-11-19T12:05:48Z'}})
const list=(rows:unknown[],page=1,total=rows.length,pages=1)=>({data:rows,current_page:page,total,last_page:pages,per_page:1000})
type Json=Record<string,unknown>
function fixture(){
 let state:Json={},terminal='',result:Json={},retry=0,attempt=1
 const paths:string[]=[]
 const c=context()
 const store={claim:async()=>terminal?null:{jobId:'job',token:'token',attempt,state},context:async()=>c,
  save:async(_claim:unknown,next:Json,r:Json,status:string,delay=0)=>{state=next;result=r;terminal=['explained','inconclusive'].includes(status)?status:'';retry=delay;return true}}
 const fetchPart=async(path:string)=>{paths.push(path);const u=new URL('https://example.test'+path)
  if(u.pathname.endsWith('/events'))return incomingEvents
  if(u.pathname==='/support/reports/agents')return received(3)
  if(u.searchParams.get('owner_id')==='23')return list([ticket(1,23)])
  if(u.searchParams.get('owner_id')==='39')return list([incoming,ticket(2)])
  return list([incoming,ticket(1,23),ticket(2)])
 }
 return {store,fetchPart,c,paths,get result(){return result},get state(){return state},get terminal(){return terminal},get retry(){return retry},set attempt(n:number){attempt=n}}
}
async function finish(f:ReturnType<typeof fixture>,fetchPart=f.fetchPart){for(let i=0;i<20&&!f.terminal;i++)await runInvestigation(f.store,fetchPart);return f}

test('real 5396/5397 pattern traces WhatsApp/AI transfer by technical ID and keeps original capture blocked',async()=>{
 const f=await finish(fixture())
 assert.equal(f.terminal,'explained');assert.equal(f.result.reason,'source_changed_during_capture')
 assert.equal(f.result.original_group,2);assert.equal(f.result.original_individual_sum,3);assert.equal(f.result.current_unique_ids,3)
 const findings=f.result.findings as Json[];assert.equal(findings.length,1);assert.equal(findings[0].ticket_id,1075973);assert.equal(findings[0].ticket_number,1131861)
 assert.equal(findings[0].delta,1);assert.equal(f.result.publication,'blocked_original_capture_preserved')
 assert.equal(f.paths.filter(p=>p.endsWith('/events')).length,1)
 assert.ok(!JSON.stringify(f.state).includes('never-store'));assert.ok(!JSON.stringify(f.state).includes('private customer'))
 assert.ok(f.paths.every(p=>p.startsWith('/tickets')||p.startsWith('/support/reports/agents?')))
})
test('source total equality alone cannot explain a historical discrepancy',async()=>{
 const f=fixture();await finish(f,async p=>p.includes('owner_id=39')?list([ticket(2),ticket(3)]):p.includes('owner_id=23')?list([ticket(1,23)]):p.startsWith('/tickets?')?list([ticket(1,23),ticket(2),ticket(3)]):received(3))
 assert.equal(f.terminal,'inconclusive');assert.equal(f.result.reason,'difference_not_fully_explained')
})
test('outgoing tickets outside current roster are included in recent-source search',async()=>{
 const f=fixture();f.c.parts.group=received(4)
 const outgoing=ticket(1075973,null,3,'2026-11-19T12:00:27Z')
 await finish(f,async p=>p.endsWith('/events')?[ev(20,'owner','Igor Siqueira',null,'2026-11-19T12:00:27Z')]:p.includes('owner_id=39')?list([ticket(2),ticket(3)]):p.includes('owner_id=23')?list([ticket(1,23)]):p.startsWith('/tickets?')?list([outgoing,ticket(1,23),ticket(2),ticket(3)]):received(3))
 assert.equal(f.terminal,'explained');assert.equal((f.result.findings as Json[])[0].delta,-1)
})
test('an ignored owner filter fails closed',async()=>{
 const f=fixture();await finish(f,async()=>list([ticket(1,39)]));assert.equal(f.terminal,'inconclusive');assert.equal(f.result.reason,'owner_filter_not_applied')
})
test('duplicate ID on mutable pagination fails closed',async()=>{
 const f=fixture();await finish(f,async()=>list([ticket(1,23),ticket(1,23)]));assert.equal(f.result.reason,'duplicate_or_moving_ticket')
})
test('known source cap is never interpreted as complete enumeration',async()=>{
 const f=fixture();await finish(f,async()=>list([ticket(1,23)],1,10000,10));assert.equal(f.result.reason,'owner_list_source_cap')
})
test('a transfer inside the possible report request window remains inconclusive',async()=>{
 const f=fixture();await finish(f,async p=>p.endsWith('/events')?incomingEvents.map(e=>e.id===268686?{...e,created_at:'2026-11-19T12:05:00Z'}:e):f.fetchPart(p));assert.equal(f.result.reason,'event_inside_report_request_window')
})
test('incomplete histories and changed event chains cannot fabricate an attribution',async()=>{
 const f=fixture();await finish(f,async p=>p.endsWith('/events')?incomingEvents.filter(e=>e.id!==268686):f.fetchPart(p));assert.equal(f.terminal,'inconclusive');assert.equal(f.result.reason,'event_owner_chain_changed')
})
test('rate limits preserve checkpoint and honor source backoff',async()=>{
 const f=fixture();const r=await runInvestigation(f.store,async()=>{throw new InvestigationSourceError(429,36)})
 assert.equal(r.status,'retry');assert.equal(f.retry,36);assert.equal((f.state as Json).ownerIndex,0);assert.equal((f.state as Json).tickets instanceof Array,true)
 await finish(f);assert.equal(f.terminal,'explained')
})
test('retry exhaustion terminates with fixed error and no source contents',async()=>{
 const f=fixture();f.attempt=5;await runInvestigation(f.store,async()=>{throw Error('secret customer payload')});assert.equal(f.terminal,'inconclusive');assert.equal(f.result.reason,'investigation_source_unavailable');assert.ok(!JSON.stringify(f.result).includes('secret'))
})
test('stale worker cannot claim a successful checkpoint',async()=>{
 const f=fixture();f.store.save=async()=>false;const r=await runInvestigation(f.store,f.fetchPart);assert.equal(r.status,'stale')
})
test('incomplete captures stop without fetching guessed ticket cohorts',async()=>{
 const f=fixture();delete (f.c.parts as Json)['owner:39'];await finish(f);assert.equal(f.result.reason,'capture_incomplete_no_id_reconciliation');assert.equal(f.paths.length,0)
})
test('different report periods are not reconciled',async()=>{
 const f=fixture();f.c.parts['owner:39'].range={...range,to:'2026-11-02T03:00:00+00:00'};await finish(f);assert.equal(f.result.reason,'capture_report_ranges_differ');assert.equal(f.paths.length,0)
})

test('a changing owner list is reread with a bounded retry, never accepted as complete',async()=>{
 const f=fixture();let first=true
 const fetch=async(p:string)=>{if(p.includes('owner_id=23')&&first){first=false;return list([ticket(1,23)],1,2)}if(p.includes('/support/reports/ratings'))return {total:0,last_page:1,data:[]};return f.fetchPart(p)}
 assert.equal((await runInvestigation(f.store,fetch,true)).status,'retry');assert.equal(f.terminal,'');assert.equal(f.state.ownerReadRetries,1)
 await runInvestigation(f.store,fetch,true)
 assert.equal((f.state.verification as Json).stage,'publish');assert.equal((f.state.context as {parts:{group:{summary:{received:{value:number}}}}}).parts.group.summary.received.value,2)
})
test('persistently incomplete owner lists stop after the two extra reads',async()=>{
 const f=fixture(),fetch=async()=>list([ticket(1,23)],1,2)
 await runInvestigation(f.store,fetch,true);await runInvestigation(f.store,fetch,true);await runInvestigation(f.store,fetch,true)
 assert.equal(f.terminal,'inconclusive');assert.equal(f.result.reason,'owner_list_incomplete');assert.equal(f.state.ownerReadRetries,2)
})
