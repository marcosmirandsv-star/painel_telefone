import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as received from '../supabase/functions/clickdesk-official-metrics-sync/received.ts'
const compiled=ts.transpileModule(readFileSync(new URL('../supabase/functions/clickdesk-official-metrics-sync/index.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText
function harness(fail=false){
 const registry=Array.from({length:15},(_,i)=>({clickdesk_owner_id:100+i,source_owner_name:'Analista '+(100+i),source_owner_key:'analista '+(100+i)}))
 let handle!:(r:Request)=>Promise<Response>,active=0,maximum=0,published=0,signals=0
 const admin={from:()=>({select:()=>({eq:()=>({eq:async()=>({data:registry,error:null})})})}),rpc:async(name:string,args:unknown)=>{
  if(name==='get_clickdesk_cron_credentials')return {data:{api_key:'test-only',account_id:'test-account'},error:null}
  if(name==='publish_clickdesk_official_capture'){published++;assert.equal((args as {p_rows:unknown[]}).p_rows.length,15);return {data:true,error:null}}
  throw Error('Unexpected RPC '+name)
 }}
 vm.runInNewContext(compiled,{exports:{},require:(name:string)=>name==='./received.ts'?received:{createClient:()=>admin},Deno:{env:{get:(key:string)=>key==='SUPABASE_URL'?'https://vvtorcvchnqhcredhorv.supabase.co':key==='SUPABASE_SERVICE_ROLE_KEY'?'test-service':undefined},serve:(handler:typeof handle)=>{handle=handler}},Request,Response,AbortSignal,URL,URLSearchParams,Date,Intl,Map,Set,console:{error:()=>{}},fetch:async(url:string,options:RequestInit)=>{
  assert.ok(options.signal);signals++
  if(fail)throw new DOMException('test timeout','TimeoutError')
  const ownerRequest=new URL(url).searchParams.getAll('owner_ids[]').length===1; if(ownerRequest){active++;maximum=Math.max(maximum,active)};await new Promise(resolve=>setTimeout(resolve,1));if(ownerRequest)active--
  const parsed=new URL(url),ids=parsed.searchParams.getAll('owner_ids[]').map(Number)
  const body=parsed.pathname.endsWith('/agents')?{summary:{received:{value:ids.length}},agents:registry.filter(r=>ids.includes(r.clickdesk_owner_id)).map(r=>({id:r.clickdesk_owner_id,name:r.source_owner_name,resolved:0,replies:0,csat_total:0}))}:{data:[],total:0,last_page:1,page:1}
  return new Response(JSON.stringify(body),{status:200})
 }})
 return {run:()=>handle(new Request('https://example.test',{method:'POST',headers:{Authorization:'Bearer test-token'},body:JSON.stringify({start:'2026-11-01',end:'2026-11-11'})})),stats:()=>({maximum,published,signals})}
}
test('captura mensal usa lotes limitados de três e publica somente após conciliar os quinze responsáveis',async()=>{
 const h=harness(),response=await h.run();assert.equal(response.status,200);assert.equal((await response.json()).totals.attendances,15);assert.equal(h.stats().maximum,3);assert.equal(h.stats().published,1);assert.equal(h.stats().signals,18)
})
test('timeout da origem não publica captura parcial nem substitui valores anteriores',async()=>{
 const h=harness(true),response=await h.run();assert.equal(response.status,500);assert.equal(h.stats().published,0)
})
