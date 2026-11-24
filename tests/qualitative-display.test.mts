import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
import {qualitativeDisplayStatus,qualitativeReviewReadiness} from '../src/lib/qualitative-display.ts'

test('unconfirmed authorship stays pending even without an AI queue entry',()=>{
 assert.deepEqual(qualitativeReviewReadiness([
  {can_analyze:false,analysis_available:false},
  {can_analyze:false,analysis_available:true},
  {can_analyze:true,analysis_available:false},
  {can_analyze:true,analysis_available:true},
 ]),{available:1,awaitingAuthorship:2,awaitingAnalysis:1,pending:3})
 assert.deepEqual(qualitativeReviewReadiness([]),{available:0,awaitingAuthorship:0,awaitingAnalysis:0,pending:0})
})

const identity={analyst_id:'own',occurred_date:'2026-11-17',satisfaction_label:'positive'}
const cache={...identity,analysis:{_analysis_version:3},validation_status:'pending'}
test('pending own coherent analyses are preliminary; approval remains a human state',()=>{
 assert.equal(qualitativeDisplayStatus(cache,identity),'preliminary')
 assert.equal(cache.validation_status,'pending')
 assert.equal(qualitativeDisplayStatus({...cache,validation_status:'approved'},identity),'approved')
})
test('rejected or mismatched authorship, day, label and missing analyses are unavailable',()=>{
 for(const c of [null,{...cache,analyst_id:'other'},{...cache,occurred_date:'2026-11-18'},{...cache,satisfaction_label:'negative'},{...cache,analysis:null},{...cache,validation_status:'rejected'},{...cache,analysis:{_analysis_version:2}}])assert.equal(qualitativeDisplayStatus(c,identity),'unavailable')
 assert.equal(qualitativeDisplayStatus({...cache,validation_status:'rejected'},identity,true),'rejected')
})
const source=readFileSync(new URL('../src/app/api/clickdesk/qualitative/route.ts',import.meta.url),'utf8')
const getSource=source.slice(source.indexOf('export async function GET(')).replace('export async function GET','async function GET')
const compiled=ts.transpileModule(getSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText
function harness({owner='own',pending=false,cached:stored=cache,management=false}:{owner?:string;pending?:boolean;cached?:typeof cache|null;management?:boolean}={}){
 let queries=0,externalCalls=0
 const db={from:(table:string)=>{
  queries++;const chain={select(){return chain},eq(){return chain},maybeSingle:async()=>({error:null,data:table==='clickdesk_final_ticket_ledger'?{ticket_id:'1098006',...identity,analyst_id:owner}:table==='clickdesk_final_ticket_pending'?pending?{ticket_id:'1098006'}:null:stored?{...stored,clickdesk_ticket_id:'1098006'}:null})};return chain
 }}
 class ApiError extends Error{status:number;constructor(status:number,message:string){super(message);this.status=status}}
 const context={Request,Response,URL,ApiError,isChatProductionEnabled:()=>true,authorizeClickDeskSessionClient:async()=>({admin:db,isManagement:management,chatAnalystId:'own'}),validTicketId:(id:string)=>/^\d+$/.test(id),qualitativeDisplayStatus,normalizeQualitativeAnalysis:(value:unknown)=>value,json:(body:unknown)=>Response.json(body),handle:async(fn:()=>Promise<Response>)=>{try{return await fn()}catch(e){return Response.json({error:e instanceof Error?e.message:'failure'},{status:e instanceof ApiError?e.status:500})}},fetch:()=>{externalCalls++;throw Error('Unexpected external call')}}
 const GET=runInNewContext(compiled+';GET',context) as (r:Request)=>Promise<Response>
 return {run:()=>GET(new Request('https://example.test/api?ticket_id=1098006')),stats:()=>({queries,externalCalls})}
}
test('GET displays coherent own pending cache without provider, source or write',async()=>{
 const h=harness(),response=await h.run(),data=await response.json()
 assert.equal(response.status,200);assert.equal(data.available,true);assert.equal(data.display_status,'preliminary');assert.equal(data.validation_status,'pending');assert.equal(h.stats().externalCalls,0)
})
test('GET refuses another analyst before reading cached analysis',async()=>{
 const h=harness({owner:'other'}),response=await h.run();assert.equal(response.status,404);assert.equal(h.stats().queries,2);assert.equal(h.stats().externalCalls,0)
})
test('GET gaps and no cache never trigger a new analysis',async()=>{
 assert.equal((await harness({pending:true}).run()).status,422)
 const h=harness({cached:null}),response=await h.run(),data=await response.json();assert.equal(response.status,200);assert.equal(data.available,false);assert.equal(h.stats().externalCalls,0)
 const rejected=harness({cached:{...cache,validation_status:'rejected'}});assert.equal((await(await rejected.run()).json()).available,false)
})
