const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const vm=require('node:vm');
const ts=require('typescript');
const source=fs.readFileSync(__dirname+'/../src/app/api/clickdesk/reconcile/route.ts','utf8');
function harness({count=20840,role='master',confirmed=false,internal=false,changed=false,complete=true,roster=[]}={}) {
 const calls=[],writes=[],finalRosters=[],rosterSelections=[];
 const ids=Array.from({length:count},(_,i)=>String(i+1)).sort();
 const admin={rpc:async(name,args)=>{
  calls.push({name,args});
  if(name==='clickdesk_reconcile_candidate_page')return {data:ids.filter(id=>id>args.p_cursor).slice(0,args.p_limit+1).map(id=>({ticket_id:id,version:'2026-11-23T12:00:00.000000Z'})),error:null};
  return {data:[{candidate_count:count,confirmed_count:0,pending_count:0}],error:null};
 },from(table){return {
  select:async columns=>{if(table==='chat_analysts')rosterSelections.push(columns);return {data:table==='chat_analysts'?roster:[],error:null}},
  upsert:async(rows)=>{writes.push({table,rows});return {error:null}},
  delete:()=>({in:async()=>({error:null})}),
 }}};
 class ApiError extends Error {constructor(status,message){super(message);this.status=status}}
 const mocked={
  '@/lib/cx360-diagnostics-server':{isCxCron:()=>internal},
  '@/lib/chat-production-gate':{isChatProductionEnabled:()=>true},
  '@/lib/chat-integration-server':{ApiError,authorizeClickDeskSessionClient:async()=>({isManagement:true,role}),
   json:data=>Response.json(data),handle:async f=>{try{return await f()}catch(e){return Response.json({error:e.message},{status:e.status||500})}}},
  '@/lib/clickdesk-final-owner-server':{productionReadAdmin:()=>admin,readTicketHistory:async id=>({messages:[{id:'msg'}],events:[],ticket:{id,updated_at:'2026-11-23T12:00:00Z'},complete})},
  '@/lib/clickdesk-final-owner':{object:v=>v&&typeof v==='object'?v:{},text:v=>typeof v==='string'||typeof v==='number'?String(v):'',finalHumanTicket:(id,m,e,t,p,historyComplete)=>(finalRosters.push(p),{ticket_id:id,confirmed:confirmed&&historyComplete,reason:'no_public_human',analyst_id:confirmed?'analyst':null,team_id:confirmed?'team':null,message_id:confirmed?'msg':null,occurred_at:confirmed?'2026-11-23T12:00:00Z':null,occurred_date:confirmed?'2026-11-23':null})},
 };
 const exports={};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
 {exports,AbortSignal,fetch:async url=>Response.json({id:url.split('/').at(-1),updated_at:changed?'2026-11-23T12:01:00Z':'2026-11-23T12:00:00Z'}),require:n=>mocked[n]||require(n),Response,Request,console:{info(){}},process:{env:{CLICKDESK_API_KEY:'test',CLICKDESK_ACCOUNT_ID:'test',VERCEL_GIT_COMMIT_REF:'main'}}});
 return {calls,writes,finalRosters,rosterSelections,post:async body=>exports.POST(new Request('https://test/api/clickdesk/reconcile',{method:'POST',body:JSON.stringify(body)}))};
}
test('20840 candidates return bounded page and cursor; no cap or source table download',async()=>{
 const h=harness();const res=await h.post({limit:12,period:'2026-11'});assert.equal(res.status,200);
 const b=await res.json();assert.equal(b.candidate_universe,20840);assert.equal(b.examined,12);assert.equal(b.has_more,true);assert.equal(b.period,'2026-11');assert.equal(b.confirmed,0);assert.equal(h.writes.length,0);
 const res2=await h.post({limit:12,period:'2026-11',cursor:b.next_cursor});const b2=await res2.json();assert.notEqual(b.next_cursor,b2.next_cursor);assert.equal(b2.examined,12);
 assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0].args)),{p_cursor:'',p_limit:12,p_period:'2026-11'});
});
test('exactly 20000 candidates do not fail and final page has no successor',async()=>{
 const h=harness({count:20000});const res=await h.post({cursor:'9998',limit:12});const b=await res.json();assert.equal(res.status,200);assert.equal(b.examined,1);assert.equal(b.next_cursor,'9999');assert.equal(b.has_more,false);
});
test('empty candidate universe returns stable terminal cursor',async()=>{
 const h=harness({count:0});const b=await (await h.post({})).json();assert.equal(b.examined,0);assert.equal(b.next_cursor,null);assert.equal(b.has_more,false);
});
test('write preserves pending distinction and period scoped coverage',async()=>{
 const h=harness();const res=await h.post({period:'2026-11',limit:1,dry_run:false});assert.equal(res.status,200);
 assert.equal(h.writes.some(x=>x.table==='clickdesk_final_ticket_ledger'),false);
 const c=h.writes.find(x=>x.table==='clickdesk_final_coverage').rows;assert.equal(c.source_key,'inventory_reconcile:2026-11');assert.equal(c.completeness,'partial');assert.equal(c.start_date,'2026-11-01');
});
test('confirmed ownership persists the candidate source version',async()=>{
 const h=harness({confirmed:true});assert.equal((await h.post({limit:1,dry_run:false})).status,200);
 assert.equal(h.writes.find(x=>x.table==='clickdesk_final_ticket_ledger').rows[0].evidence_version,'2026-11-23T12:00:00.000000Z');
});
test('invalid periods rejected and analyst cannot reconcile',async()=>{
 for(const period of ['2026-13','2026-00','bad',false])assert.equal((await harness().post({period})).status,400);
 assert.equal((await harness({role:'analyst'}).post({})).status,403);
});
test('SQL candidate is read-only, invoker, restricted, keyset, deduplicated and inventory scoped',()=>{
 const sql=fs.readFileSync(__dirname+'/../supabase/migrations/20261123210000_clickdesk_reconcile_candidate_pages.sql','utf8');
 assert.doesNotMatch(sql,/security definer|offset|20000/i);assert.match(sql,/max\(s.source_updated_at\)/);assert.match(sql,/i.period_key=p_period/);assert.match(sql,/limit p_limit\+1/);assert.match(sql,/p_cursor collate "C"/);assert.match(sql,/from public,anon,authenticated/);assert.match(sql,/to service_role/);
});

test('internal valid credential is restricted to November and bounded limit',async()=>{
 assert.equal((await harness({internal:true,role:'analyst'}).post({period:'2026-11',limit:12})).status,200);
 for(const body of [{},{period:'2026-10'},{period:'2026-12'}])assert.equal((await harness({internal:true}).post(body)).status,403);
 assert.equal((await harness({internal:true}).post({period:'2026-11',limit:13})).status,400);
});
test('changed conversation becomes pending and does not enter ledger',async()=>{
 const h=harness({confirmed:true,changed:true});const res=await h.post({limit:1,dry_run:false});const b=await res.json();assert.equal(res.status,200);assert.equal(b.confirmed,0);assert.equal(b.pending_reasons.history_changed_since_read,1);assert.equal(h.writes.some(x=>x.table==='clickdesk_final_ticket_ledger'),false);
});

test('incomplete history remains pending even if transport returns a message',async()=>{
 const h=harness({confirmed:true,complete:false});const b=await (await h.post({limit:1,dry_run:false})).json();assert.equal(b.confirmed,0);assert.equal(h.writes.some(x=>x.table==='clickdesk_final_ticket_ledger'),false);
});

test('only explicitly active analysts reach finalHumanTicket attribution',async()=>{
 const roster=[
  {id:'active-analyst',name:'Analista Ativo',team_id:'team',csat_goal:90,active:true},
  {id:'inactive-analyst',name:'Luan Inativo',team_id:'team',csat_goal:90,active:false},
  {id:'unknown-activity',name:'Status Ausente',team_id:'team',csat_goal:90},
 ];
 const h=harness({count:1,roster});
 const response=await h.post({period:'2026-11',limit:1});
 assert.equal(response.status,200);
 assert.equal(h.finalRosters.length,1);
 assert.match(h.rosterSelections[0],/(^|,)active(,|$)/);
 for(const received of h.finalRosters){
  assert.equal(received.length,1);
  assert.equal(received[0].id,'active-analyst');
  assert.equal(received.some(person=>person.id==='inactive-analyst'||person.id==='unknown-activity'),false);
 }
});
