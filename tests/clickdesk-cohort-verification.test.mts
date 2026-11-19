import test from 'node:test'
import assert from 'node:assert/strict'
import {advanceCohortVerification,publishCohortVerification}from '../supabase/release-candidates/chat-production-20261118/edge/clickdesk-official-metrics-sync/cohort-verification.ts'
import type{State}from '../supabase/release-candidates/chat-production-20261118/edge/clickdesk-official-metrics-sync/investigation.ts'
const report=(count:number,votes=2)=>({range:{from:'2026-11-01T03:00:00Z',to:'2026-11-20T03:00:00Z'},summary:{received:{value:count}},agents:[{id:23,name:'Carlos Henrique',csat_total:votes,replies:3,resolved:1}]})
const vote=(id:number)=>({ticket_id:id,number:id+100,owner:'Carlos Henrique',sentiment:'positive',label:'Boa',rated_at:'10/11/2026 14:23'})
function fixture(count=2):State{return {phase:'verify',context:{id:'parent',start:'2026-11-01',end:'2026-11-19',owners:[23],registry:[{id:23,name:'Carlos Lemos'}],parts:{group:report(1),'owner:23':report(1)},times:{group:'2026-11-19T14:00:00Z','owner:23':'2026-11-19T14:01:00Z'},verifyCurrent:true},ownerIndex:1,page:1,pageTotal:null,pageCount:0,seen:[],tickets:Array.from({length:count},(_,i)=>({id:42+i,number:142+i,owner:23,department:3,channel:'whatsapp',created_at:'2026-11-10T12:00:00Z',updated_at:'2026-11-19T14:10:00Z'})),recent:[],events:{},eventIndex:0,lastUpdated:null,freshGroup:null,freshGroupAt:null}}
function source(count=2,csat=count){return async(path:string)=>{const u=new URL('https://example.test'+path);if(u.pathname.endsWith('/agents'))return report(count,csat);const department=u.searchParams.get('department_id');return {total:department==='3'?count:0,last_page:1,data:department==='3'?Array.from({length:count},(_,i)=>vote(42+i)):[]}}}
const now=()=> '2026-11-19T14:15:00Z'
async function ready(s:State,fetchPart=source()){for(let n=0;n<10&&s.phase==='verify'&&s.verification?.stage!=='publish';n++)await advanceCohortVerification(s,fetchPart,now);return s}
test('fresh owner IDs select real report refreshes; all original source parts stay unchanged',async()=>{
 const s=fixture(),original=JSON.stringify(s.context.parts),paths:string[]=[]
 await ready(s,async p=>{paths.push(p);return source()(p)});assert.equal(s.verification?.stage,'publish')
 let sent=0;const id=await publishCohortVerification(s,async(rows,votes)=>{sent++;assert.equal((rows[0]as{attendances:number}).attendances,2);assert.equal(votes.length,2);return 'successor'})
 assert.equal(id,'successor');assert.equal(sent,1);assert.equal(JSON.stringify(s.context.parts),original)
 assert.equal(paths.filter(p=>p.includes('/agents')).length,2)
})
test('unchanged owner totals avoid unnecessary heavy individual report calls',async()=>{
 const s=fixture(1),paths:string[]=[];await ready(s,async p=>{paths.push(p);return source(1)(p)})
 assert.equal(s.verification?.stage,'publish');assert.equal(paths.filter(p=>p.includes('/agents')).length,1)
})
test('a changed collective cannot be forced to equal the ID union',async()=>{
 const s=fixture();await ready(s,async p=>p.includes('/agents')?report(3):source()(p))
 assert.equal(s.phase,'owners');assert.equal(s.verification?.cycle,2);assert.equal(s.tickets.length,0)
})
test('a changed CSAT still blocks publication even when Received and IDs agree',async()=>{
 const s=fixture();await ready(s,source(2,3));assert.equal(s.phase,'owners');assert.equal(s.verification?.cycle,2)
})
test('an independent report that differs from the ID witness is never synthesized',async()=>{
 const s=fixture();await ready(s,source(3));assert.equal(s.phase,'owners');assert.equal(s.verification?.cycle,2)
})
test('two inconsistent verification passes stop and preserve the investigation',async()=>{
 const s=fixture();await ready(s,source(3));s.phase='verify';s.ownerIndex=1;s.tickets=fixture().tickets
 await ready(s,source(3));assert.equal(s.phase,'recent');assert.equal(s.verification?.stage,'done');assert.equal(s.verification?.cycle,2)
})
test('publication cannot be requested before all fresh source checks finish',async()=>{
 let called=false;await assert.rejects(()=>publishCohortVerification(fixture(),async()=>{called=true;return 'bad'}));assert.equal(called,false)
})
test('a duplicated technical ID cannot validate an otherwise equal total',async()=>{
 const s=fixture();s.tickets[1].id=s.tickets[0].id;await ready(s);assert.equal(s.phase,'owners');assert.equal(s.verification?.cycle,2)
})
