import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

function fixture(enabled:boolean,environment:string,url:string){
 const source=readFileSync(new URL('../src/lib/clickdesk-final-owner-server.ts',import.meta.url),'utf8')
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
 let calls=0
 const admin={target:'production'}
 const fixtureModule={exports:{}}
 class ApiError extends Error{constructor(public status:number,message:string){super(message)}}
 vm.runInNewContext(compiled,{module:fixtureModule,exports:fixtureModule.exports,Map,Date,process:{env:{}},require:(id:string)=>{
  if(id==='./chat-integration-server')return {ApiError,adminClient:()=>{calls++;return admin}}
  if(id==='./runtime-environment.ts')return {getServerSupabaseConfig:()=>({environment,url})}
  if(id==='./chat-production-gate.ts')return {isChatProductionEnabled:()=>enabled}
  if(id==='next/cache')return {unstable_cache:(fn:unknown)=>fn}
  return {}
 }})
 return {read:(fixtureModule.exports as {productionReadAdmin:()=>unknown}).productionReadAdmin,get calls(){return calls},admin}
}
test('reconciliation can read the production admin after Chat activation',()=>{
 const f=fixture(true,'producao','https://qmetbydkepfdgfqkdkai.supabase.co')
 assert.equal(f.read(),f.admin);assert.equal(f.calls,1)
})
test('disabled Chat cannot create a privileged read client',()=>{
 const f=fixture(false,'producao','https://qmetbydkepfdgfqkdkai.supabase.co')
 assert.throws(f.read,{status:404});assert.equal(f.calls,0)
})
test('HML and any other database are rejected even with the feature flag enabled',()=>{
 for(const [environment,url]of [['homologacao','https://vvtorcvchnqhcredhorv.supabase.co'],['producao','https://vvtorcvchnqhcredhorv.supabase.co'],['producao','https://other.supabase.co'],['homologacao','https://qmetbydkepfdgfqkdkai.supabase.co']]){
  const f=fixture(true,environment,url);assert.throws(f.read,{status:503});assert.equal(f.calls,0)
 }
})
