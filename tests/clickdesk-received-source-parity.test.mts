import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
import * as daily from '../src/lib/clickdesk-official-daily.ts'
test('November reads exact ClickDesk Recebidos and original votes instead of assignment-event totals',async()=>{
 const source=readFileSync(new URL('../src/lib/clickdesk-official-metrics.ts',import.meta.url),'utf8')
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
 const calls:string[]=[]
 const person={id:'joao',name:'João Pedro Vianey',team_id:'fiscal',active:true}
 const snapshot={source_owner_key:'joao pedro vianey',source_owner_name:person.name,attendances:190,positive_reviews:87,negative_reviews:3,captured_at:'2026-11-12T13:00:00Z'}
 const admin={rpc:async(name:string)=>{calls.push(name);return {data:name==='get_scoped_clickdesk_official_period_metrics'?[snapshot]:[],error:null}},from:()=>({select:async()=>({data:[person],error:null})})}
 const exports:Record<string,unknown>={}
 runInNewContext(compiled,{exports,require:(name:string)=>{
  if(name==='./integration-server')return {ApiError:class extends Error {constructor(_s:number,message:string){super(message)}}}
  if(name==='./clickdesk-official-daily')return daily
  if(name==='./clickdesk-publication')return {publishedClickDeskEnd:(end:string)=>end}
  throw Error('Unexpected source '+name)
 },Date,console})
 const load=exports.loadOfficialPeriodRows as (admin:unknown,filters:unknown)=>Promise<{metricSource:string;rows:{attendances:number;positive_reviews:number;negative_reviews:number;reviews:number}[]}>
 const result=await load(admin,{start:'2026-11-01',end:'2026-11-11',analystId:'joao'})
 assert.equal(result.rows[0].attendances,190)
 assert.notEqual(result.rows[0].attendances,311)
 assert.equal(result.rows[0].positive_reviews,87)
 assert.equal(result.rows[0].negative_reviews,3)
 assert.equal(result.rows[0].reviews,90)
 assert.equal(result.metricSource,'clickdesk_official_period_metrics')
 assert.ok(calls.includes('get_scoped_clickdesk_official_neutral_counts'))
})
