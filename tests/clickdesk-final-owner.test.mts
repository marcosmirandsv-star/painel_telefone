import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { finalHumanTicket, aggregateFinal, finalPodium } from '../src/lib/clickdesk-final-owner.ts'
const people=[{id:'v',name:'Vanessa Silva',team_id:'notas'},{id:'t',name:'Thiago Reis',team_id:'notas'},{id:'k',name:'Karolyne Moreira',team_id:'outros'},{id:'a',name:'Ana Júlia',team_id:'notas'},{id:'d',name:'David Leodoro',team_id:'outros'}]
const message=(id:number,author:string,at='2026-10-06T15:57:32Z')=>({id,author,author_type:'agent',visibility:'public',created_at:at})
const result=(messages:unknown[], ticket={}, complete=true)=>finalHumanTicket('1054367',messages,[],ticket,people,complete)
test('1054367: first Vanessa response never overrides the final Thiago response',()=>{
 const r=result([message(3444841,'Vanessa Silva','2026-10-06T13:53:57Z'),message(3448139,'Thiago Reis')])
 assert.equal(r.analyst_id,'t');assert.equal(r.message_id,'3448139');assert.equal(r.occurred_date,'2026-10-06')
 assert.equal(aggregateFinal([r]).attendances,1);assert.equal(r.satisfaction_label,null)
})
test('closed, unrated tickets remain confirmed without inventing evaluations',()=>{
 const r=result([message(2,'Vanessa Silva')],{status:'closed'})
 assert.equal(r.confirmed,true);assert.deepEqual(aggregateFinal([r]),{attendances:1,positive_reviews:0,negative_reviews:0,reviews:0,csat:null,review_percentage:0})
})
test('current owner, rating and private notes do not determine final human',()=>{
 const r=result([message(1,'Vanessa Silva'),{...message(2,'Thiago Reis','2026-10-06T16:00:00Z'),visibility:'private'}],{owner:'Thiago Reis'})
 assert.equal(r.analyst_id,'v')
})
test('system/AI response is not a human response',()=>assert.equal(result([{...message(1,'Vanessa Silva'),author_type:'system'}]).confirmed,false))
test('unknown, unnamed and simultaneous different authors remain pending',()=>{
 assert.equal(result([message(1,'Unknown')]).reason,'final_author_not_in_eligible_registry')
 assert.equal(result([message(1,'')]).reason,'final_author_ambiguous')
 assert.equal(result([message(1,'Vanessa Silva'),message(2,'Thiago Reis')]).reason,'final_author_ambiguous')
})
test('incomplete and conflicting histories cannot produce credit',()=>{
 assert.equal(result([message(1,'Vanessa Silva')],{},false).reason,'history_incomplete')
 assert.equal(result([message(1,'Vanessa Silva'),message(1,'Thiago Reis')]).reason,'message_id_conflict')
})
test('apprentices are excluded even as final human; previous analyst gets no replacement credit',()=>{
 for(const name of ['Ana Júlia','David Leodoro'])assert.equal(result([message(1,name)]).reason,'final_author_apprentice')
})
test('competence follows final response in Brasilia, not creation or resolution',()=>{
 const r=result([message(1,'Thiago Reis','2026-10-04T02:59:59Z')],{created_at:'2026-10-01',closed_at:'2026-10-05'})
 assert.equal(r.occurred_date,'2026-10-03')
})
test('queue at answer and analyst team are distinct; current department is not historical evidence',()=>{
 const r=finalHumanTicket('1',[message(1,'Karolyne Moreira')],[{field:'department',timestamp:'2026-10-06T14:00:00Z',to:'Suporte - Fiscal'}],{department:'Suporte N3'},people,true)
 assert.equal(r.area,'Suporte - Fiscal');assert.equal(r.team_id,'outros')
 assert.equal(result([message(1,'Vanessa Silva')],{department:'Suporte - Fiscal'}).area,null)
})
test('explicit ticket rating follows final human; chronology warning never changes eligibility',()=>{
 const r=result([message(1,'Thiago Reis')],{satisfaction:{sentiment:'positive',created_at:'2026-10-06T16:00:00Z'}})
 assert.equal(r.satisfaction_label,'positive')
 const earlier=result([message(1,'Thiago Reis')],{satisfaction:{sentiment:'negative',created_at:'2026-10-06T14:00:00Z'}})
 assert.equal(earlier.satisfaction_label,'negative');assert.equal(earlier.rating_timestamp_warning,true)
})
test('existing podium thresholds and team boundaries are preserved',()=>{
 const r=result([message(1,'Thiago Reis')],{satisfaction:{sentiment:'positive',created_at:'2026-10-06T16:00:00Z'}})
 const p=finalPodium([r],people,'t')
 assert.equal(p.criteria.csat_min,90);assert.equal(p.criteria.review_min,25);assert.equal(p.criteria.volume_min,1);assert.equal(p.position,1)
})
test('privileged credentials are server-only and authorization precedes reconciliation',()=>{
 const server=readFileSync(new URL('../src/lib/clickdesk-final-owner-server.ts',import.meta.url),'utf8')
 assert.match(server,/import 'server-only'/);assert.match(server,/vvtorcvchnqhcredhorv/)
 const page=readFileSync(new URL('../src/app/page.tsx',import.meta.url),'utf8')
 assert.doesNotMatch(page,/HOMOLOGATION_SUPABASE_SERVICE_ROLE_KEY|clickdesk-final-owner-server/)
 for(const name of ['metrics','history','tickets']){
 const route=readFileSync(new URL(`../src/app/api/clickdesk/${name}/route.ts`,import.meta.url),'utf8')
 assert.match(route,/await authorizeClickDeskSessionClient\(request\)/)
 assert.match(route,/!access.isManagement/);assert.match(route,/access.chatAnalystId/)
 }
})
