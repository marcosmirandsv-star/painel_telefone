import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
test('histórico atual usa o mesmo relatório conciliado, mesmo se o ledger divergir',async()=>{
 const source=readFileSync(new URL('../src/app/api/clickdesk/history/route.ts',import.meta.url),'utf8')
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
 const admin={from:(name:string)=>{
  const result={data:name==='chat_analysts'?{id:'analyst-id',name:'Karolyne Moreira',team_id:'team-id',csat_goal:86,active:true}:name==='chat_teams'?{id:'team-id',name:'Equipe'}:[],error:null}
  const chain:Record<string,unknown>={};const proxy=new Proxy(chain,{get(_t,k){if(k==='then')return (resolve:(r:unknown)=>unknown)=>Promise.resolve(result).then(resolve);return()=>proxy}});return proxy
 }}
 const exports:Record<string,unknown>={}
 const mocks:Record<string,unknown>={
  '@/lib/integration-server':{authorizeClickDeskSessionClient:async()=>({admin,isManagement:true}),handle:async(f:()=>unknown)=>f(),json:(value:unknown)=>Response.json(value),ApiError:Error},
  '@/lib/runtime-environment':{getServerSupabaseConfig:()=>({environment:'homologacao'})},
  '@/lib/clickdesk-ledger-server':{readFinalLedger:async()=>Array.from({length:131},()=>({satisfaction_label:'positive'})),readLedgerCoverageForAccess:async()=>({complete:true})},
  '@/lib/clickdesk-official-metrics':{loadOfficialPeriodRows:async()=>({rows:[{attendances:107,positive_reviews:38,negative_reviews:2}]})},
  '@/lib/clickdesk-publication':{clickDeskPublicationDay:()=>new Date(Date.now()-86400000).toISOString().slice(0,10)}
 }
 runInNewContext(compiled,{exports,require:(id:string)=>{if(!(id in mocks))throw Error('Unexpected dependency '+id);return mocks[id]},Date,URL,console})
 const response=await (exports.GET as (r:Request)=>Promise<Response>)(new Request('https://test.local/history?analyst_id=analyst-id'))
 const body=await response.json();const point=body.points.find((p:{status:string})=>p.status==='open')
 assert.equal(point.attendances,107);assert.equal(point.reviews,40);assert.equal(point.csat,95);assert.equal(point.review_percentage,37.38)
 assert.equal(point.metric_source,'clickdesk_official_period_metrics');assert.equal(point.status,'open');assert.equal(point.closure_id,null)
})
