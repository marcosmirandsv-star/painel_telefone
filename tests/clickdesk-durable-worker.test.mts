import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
const source=(p:string)=>readFileSync(new URL('../'+p,import.meta.url),'utf8')
function reader(fetcher:(url:string,init:RequestInit)=>Promise<Response>){
 const worker=source('supabase/functions/clickdesk-360-dispatch/index.ts')
 const helper=worker.slice(worker.indexOf('class WorkError'),worker.indexOf('async function work('))
 const compiled=ts.transpileModule(helper,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
 return runInNewContext(compiled+'\n({requestJson})',{fetch:fetcher,AbortSignal}) as {requestJson:(url:string,init:RequestInit,ms:number,service?:string)=>Promise<unknown>}
}
test('transcript em texto simples e JSON são lidos sem fabricar ausência de conteúdo',async()=>{
 const plain=reader(async()=>new Response('Cliente: emissão falhou. Analista: vamos verificar.'))
 assert.equal(await plain.requestJson('https://example.invalid',{},1000),'Cliente: emissão falhou. Analista: vamos verificar.')
 const json=reader(async()=>Response.json({transcript:'atendimento'}))
 assert.equal(JSON.stringify(await json.requestJson('https://example.invalid',{},1000)),JSON.stringify({transcript:'atendimento'}))
})
test('limite de API distingue origem e provedor e não devolve conteúdo sensível',async()=>{
 const client=reader(async()=>Response.json({error:'sensitive provider detail'},{status:429}))
 await assert.rejects(client.requestJson('https://example.invalid',{},1000,'provider'),(error:unknown)=>(error as {code:string}).code==='provider_http_429')
 await assert.rejects(client.requestJson('https://example.invalid',{},1000),/source_http_429/)
})
test('inventário aceita IDs reais e recusa duplicação ou identificador inválido',()=>{
 const inventory=source('supabase/functions/clickdesk-period-inventory/index.ts')
 const start=inventory.indexOf(' const ids=items.map'),end=inventory.indexOf(' const candidates=',start)
 assert.ok(start>=0&&end>start)
 const code='function verify(items:any[]){'+inventory.slice(start,end)+'return ids}'
 const verify=runInNewContext(ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText+'\nverify',{}) as (rows:unknown[])=>string[]
 assert.equal(JSON.stringify(verify([{id:10016},{id:1061138}])),JSON.stringify(['10016','1061138']))
 assert.throws(()=>verify([{id:10016},{id:10016}]),/invalid_ticket_ids/)
 assert.throws(()=>verify([{id:'not-a-ticket'}]),/invalid_ticket_ids/)
})
test('teto de dez mil nunca é confundido com inventário completo',()=>{
 const inventory=source('supabase/functions/clickdesk-period-inventory/index.ts')
 const condition=inventory.match(/if\((total>=10000[^\n]+)\)\{/)
 assert.ok(condition)
 const split=runInNewContext('(total,part)=>'+condition[1],{}) as (total:number,part:{created_from:string;created_to:string})=>boolean
 assert.equal(split(10000,{created_from:'2026-10-01',created_to:'2026-10-19'}),true)
 assert.equal(split(500,{created_from:'2026-10-01',created_to:'2026-10-19'}),false)
 assert.equal(split(10000,{created_from:'2026-10-01',created_to:'2026-10-01'}),true)
 assert.match(inventory,/source_daily_limit_requires_export/)
 assert.doesNotMatch(inventory,/stage:'team'/)
})
test('chaves ficam no servidor e nunca podem escolher uma URL de destino pelo cliente',()=>{
 const jobs=source('src/app/api/clickdesk/operation-360/jobs/route.ts')
 const worker=source('supabase/functions/clickdesk-360-dispatch/index.ts')
 assert.match(jobs,/if\(!access.isManagement\)/)
 assert.match(jobs,/https:\/\/vvtorcvchnqhcredhorv.supabase.co\/functions\/v1\/clickdesk-360-dispatch/)
 assert.match(jobs,/return json\(data,202\)/)
 assert.doesNotMatch(jobs,/return json\(.*apiKey/)
 assert.match(worker,/lease_token/)
 assert.match(worker,/cooldown_until/)
 assert.doesNotMatch(worker,/vercel.app|x-vercel-protection-bypass/)
})

async function recoveryHarness(options:{host?:string;lease?:boolean;reasons?:Record<string,number>;failed?:boolean}={}){
 let handler:(request:Request)=>Promise<Response>=async()=>new Response()
 const background:Promise<unknown>[]=[]
 const urls:string[]=[]
 let releases=0
 const chain:any={eq(){return this},then(resolve:(value:unknown)=>void){resolve({error:null})}}
 const admin={rpc:async(name:string)=>({data:name==='get_clickdesk_cron_credentials'?{api_key:'unused-test-placeholder'}:options.lease===false?null:'test-lease',error:null}),
 from:(table:string)=>({update:()=>{if(table==='clickdesk_reconciliation_cycle')releases++;return chain}})}
 const code=source('supabase/functions/clickdesk-ledger-catchup/index.ts').replace(/^import[^\n]+\n/,'')
 runInNewContext(ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,{
  Deno:{env:{get:(key:string)=>key==='SUPABASE_URL'?'https://'+(options.host??'vvtorcvchnqhcredhorv.supabase.co'):key==='SUPABASE_SERVICE_ROLE_KEY'?'test-placeholder':undefined},serve:(fn:typeof handler)=>{handler=fn}},
  createClient:()=>admin,EdgeRuntime:{waitUntil:(task:Promise<unknown>)=>background.push(task)},
  URL,Response,AbortSignal,setTimeout:(fn:()=>void)=>{fn();return 0},
  fetch:async(url:string)=>{urls.push(url);return options.failed?Response.json({error:'failed'},{status:503}):Response.json({ok:true,examined:32,confirmed:0,needs_another_batch:true,reasons:options.reasons??{}})}
 })
 const response=await handler(new Request('https://example.invalid',{method:'POST',headers:{Authorization:'Bearer test-placeholder'}}))
 await Promise.all(background)
 return {response,urls,releases}
}
test('recuperação é limitada a 24 lotes e 85 segundos e usa apenas o endpoint fixo de homologação',async()=>{
 const r=await recoveryHarness()
 assert.equal(r.response.status,202)
 assert.equal((await r.response.json()).max_seconds,85)
 assert.equal(r.urls.length,24)
 assert.ok(r.urls.every(url=>url==='https://vvtorcvchnqhcredhorv.supabase.co/functions/v1/clickdesk-ledger-incremental'))
 assert.equal(r.releases,1)
})
test('recuperação para ao receber limite da origem e preserva lease após interrupção',async()=>{
 const rate=await recoveryHarness({reasons:{clickdesk_http_429:32}})
 assert.equal(rate.urls.length,1)
 const failed=await recoveryHarness({failed:true})
 assert.equal(failed.urls.length,1)
 assert.equal(failed.releases,0)
})
test('recuperação não inicia em outro projeto nem durante ciclo já reservado',async()=>{
 const host=await recoveryHarness({host:'other-project.supabase.co'})
 assert.equal(host.response.status,403);assert.equal(host.urls.length,0)
 const busy=await recoveryHarness({lease:false})
 assert.equal(busy.response.status,202);assert.equal(busy.urls.length,0)
})

test('retentativas preservam o início real da captura para conciliar alterações feitas durante a varredura',()=>{
 const inventory=source('supabase/functions/clickdesk-period-inventory/index.ts')
 assert.match(inventory,/last_incremental_at:run.scan_watermark_at\|\|run.started_at/)
 const retry=inventory.slice(inventory.indexOf("if(state.data.status==='error')"),inventory.indexOf("if(state.data.status==='complete'"))
 assert.doesNotMatch(retry,/scan_watermark_at:/)
 assert.match(inventory,/scan_watermark_at:new Date\(\).toISOString\(\)/)
})

test('somente máximo documentado anterior ao período permite excluir um intervalo sem enumerar seus tickets',()=>{
 const sourceCode=source('supabase/functions/clickdesk-period-inventory/index.ts')
 const code=sourceCode.slice(sourceCode.indexOf('function outsidePeriod('),sourceCode.indexOf('async function hash'))
 const verify=runInNewContext(ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText+'\noutsidePeriod',{list:(x:any)=>x.data}) as (payload:any,part:any,start:string)=>boolean
 const part={created_from:'2024-01-01',created_to:'2024-12-31'}
 const old={total:10000,data:[{id:1,created_at:'2024-05-01T00:00:00Z',updated_at:'2026-09-30T23:59:00Z'}]}
 assert.equal(verify(old,part,'2026-10-01'),true)
 assert.equal(verify({...old,data:[{...old.data[0],updated_at:'2026-10-01T00:00:00Z'}]},part,'2026-10-01'),false)
 assert.equal(verify({...old,data:[{...old.data[0],created_at:'2025-01-01T00:00:00Z'}]},part,'2026-10-01'),false)
 assert.equal(verify({...old,data:[{...old.data[0],updated_at:'invalid'}]},part,'2026-10-01'),false)
 assert.equal(verify({...old,data:[]},part,'2026-10-01'),false)
 assert.equal(verify({total:0,data:[]},part,'2026-10-01'),true)
})
