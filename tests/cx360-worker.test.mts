import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'
import * as core from '../src/lib/cx360-diagnostics.ts'
const require=createRequire(import.meta.url)
class ApiError extends Error {constructor(public status:number,message:string){super(message)}}
const body=await readFile(new URL('../src/lib/cx360-diagnostics-server.ts',import.meta.url),'utf8')
const compiled=ts.transpileModule(body,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText
type Call={kind:string;name:string;args:unknown[]}
function harness(responder:(url:string,options:RequestInit)=>unknown,claims:unknown[][]=[]){
 const calls:Call[]=[]
 const admin={
  from(name:string){
   let action='';const entry={kind:'table',name,args:[] as unknown[]};calls.push(entry)
   const query:Record<string,unknown>={}
   const proxy=new Proxy(query,{get(_target,key){
    if(key==='then')return(resolve:(v:unknown)=>unknown,reject:(e:unknown)=>unknown)=>Promise.resolve({error:null,data:name==='cx360_sources'?[{team_id:'fiscal-id',source_name:'Suporte - Fiscal'},{team_id:'erp-id',source_name:'Suporte - ERP'}]:action==='update'?[{id:'saved'}]:[]}).then(resolve,reject)
    return(...args:unknown[])=>{entry.args.push([String(key),...args]);if(['insert','update'].includes(String(key))||!action)action=String(key);return proxy}
   }})
   return proxy
  },
  async rpc(name:string,args:Record<string,unknown>){calls.push({kind:'rpc',name,args:[args]});return {error:null,data:name==='cx360_claim'?(claims.shift()??[]):Array.isArray(args.p_rows)?args.p_rows.length:true}}
 }
 const vmModule={exports:{}}
 vm.runInNewContext(compiled,{exports:vmModule.exports,module:vmModule,require:(id:string)=>id==='server-only'?{}:id==='./cx360-diagnostics'?core:id==='./integration-server'?{ApiError,adminClient:()=>admin}:require(id),process:{env:{NEXT_PUBLIC_SUPABASE_URL:'https://qmetbydkepfdgfqkdkai.supabase.co',CLICKDESK_API_KEY:'test-only',CLICKDESK_ACCOUNT_ID:'test-account',GEMINI_API_KEY:'test-provider',SUPABASE_SERVICE_ROLE_KEY:'test-only',CRON_SECRET:'test-cron-token'}},URLSearchParams,AbortSignal,Buffer,Date,console,fetch:async(url:string,options:RequestInit)=>{calls.push({kind:'http',name:url,args:[]});const result=await responder(url,options);const status=(result as {http_status?:number})?.http_status??200;return {ok:status<400,status,json:async()=>result}}})
 return {api:vmModule.exports as {syncCx:(s:string,e:string,u:null)=>Promise<Record<string,unknown>>;processCx:(s:string,e:string,t:null,b:number)=>Promise<Record<string,number>>;isCxCron:(r:Request)=>boolean},calls}
}
const rating=(id:number)=>({ticket_id:id,number:id+100,team:'Suporte - Fiscal',sentiment:'negative',rated_at:'05/10/2026 10:00',owner:'Carlos Henrique',attendance:'human',label:'Ruim',subject:'Erro na emissão',comment:null})
test('importação só grava após ler e conciliar todas as páginas, preservando elegibilidade',async()=>{
 const first=Array.from({length:100},(_,i)=>rating(i+1))
 const last=[{...rating(101),owner:'Ana Julia'},{...rating(102),team:'Comercial'}]
 const h=harness(url=>new URL(url).searchParams.get('page')==='1'?{data:first,total:102,page:1,last_page:2}:{data:last,total:102,page:2,last_page:2})
 const result=await h.api.syncCx('2026-10-01','2026-10-31',null)
 assert.equal(result.imported,101);assert.equal(result.eligible,100)
 const rpc=h.calls.find(c=>c.name==='cx360_ingest')!
 const rows=(rpc.args[0] as {p_rows:Record<string,unknown>[]}).p_rows
 assert.equal(rows[100].eligible,false)
 assert.ok(h.calls.findIndex(c=>c.kind==='rpc')>h.calls.findLastIndex(c=>c.kind==='http'))
})
test('mudança de total ou duplicação na fonte não publica recorte parcial',async()=>{
 for(const mode of ['changed','duplicate']){
  const h=harness(url=>new URL(url).searchParams.get('page')==='1'?{data:[rating(1)],total:2,page:1,last_page:2}:{data:[rating(mode==='duplicate'?1:2)],total:mode==='changed'?3:2,page:2,last_page:2})
  await assert.rejects(h.api.syncCx('2026-10-01','2026-10-31',null),/Nenhum resultado parcial/)
  assert.equal(h.calls.some(c=>c.name==='cx360_ingest'),false)
 }
})
test('tipo de atendimento ausente não exclui pessoa avaliada do quadro aprovado',async()=>{
 const h=harness(()=>({data:[{...rating(1),attendance:null,rated_at:'05/11/2026 10:00'}],total:1,page:1,last_page:1}))
 const result=await h.api.syncCx('2026-11-01','2026-11-09',null)
 assert.equal(result.eligible,1)
})
const analysis={factor:'produto',confidence:'media',observation:'Cliente relata erro na emissão.',hypothesis:'Hipótese: erro ainda não resolvido contribuiu para a nota.',impact:'A emissão pode ter permanecido pendente.',behavior:'O analista verificou a rejeição relatada.',practice:'Combinar o próximo retorno de acompanhamento.',suggested_phrase:'Vou conferir o resultado deste teste com você.',verification:'Conferir o próximo passo registrado no histórico.',limitations:['Anexos não inspecionados.'],evidence_ids:['10']}
const job={id:'rating-1',ticket_id:'123',owner_name:'Carlos Henrique',rated_at:'2026-10-05T13:00:00Z',label:'Ruim',source_team:'Suporte - Fiscal',comment:'',source_hash:'source-v1',lease_token:'lease-1',attempts:1}
test('processamento cita mensagens anteriores à nota e salva com trava da fonte e da concessão',async()=>{
 const h=harness(url=>url.includes('googleapis')?{candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(analysis)}]}}]}:{messages:[{id:10,created_at:'2026-10-05T12:59:00Z',author_type:'agent',visibility:'public',body:'Vou verificar a rejeição informada.',attachments:[]},{id:11,created_at:'2026-10-05T13:01:00Z',author_type:'agent',visibility:'public',body:'Esta resposta veio depois da nota.',attachments:[]}]},[[job],[]])
 const result=await h.api.processCx('2026-10-01','2026-10-31',null,71000)
 assert.equal(result.completed,1)
 const saved=h.calls.find(c=>c.kind==='table'&&c.args.some(a=>Array.isArray(a)&&a[0]==='update'&&typeof a[1]==='object'&&a[1]?.analysis))!
 const update=(saved.args.find(a=>Array.isArray(a)&&a[0]==='update') as unknown[])[1] as {evidence:core.Evidence[]}
 assert.deepEqual(update.evidence.map(e=>e.id),['10'])
 assert.ok(saved.args.some(a=>Array.isArray(a)&&a[0]==='eq'&&a[1]==='lease_token'&&a[2]==='lease-1'))
 assert.ok(saved.args.some(a=>Array.isArray(a)&&a[0]==='eq'&&a[1]==='source_hash'&&a[2]==='source-v1'))
})
test('resposta incompleta da IA não vira análise publicada',async()=>{
 const h=harness(url=>url.includes('googleapis')?{candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:'{}'}]}}]}:{messages:[{id:10,created_at:'2026-10-05T12:59:00Z',author_type:'agent',visibility:'public',body:'Vou verificar a rejeição informada.'}]},[[job],[]])
 const result=await h.api.processCx('2026-10-01','2026-10-31',null,71000)
 assert.equal(result.completed,0);assert.equal(result.failed,1)
 assert.equal(h.calls.some(c=>c.kind==='table'&&c.args.some(a=>Array.isArray(a)&&a[0]==='update'&&typeof a[1]==='object'&&a[1]?.analysis)),false)
})
test('agendamento não aceita chamada sem o segredo específico de cron',()=>{
 const h=harness(()=>({}))
 assert.equal(h.api.isCxCron(new Request('https://local.test')),false)
 assert.equal(h.api.isCxCron(new Request('https://local.test',{headers:{authorization:'Bearer wrong'}})),false)
 assert.equal(h.api.isCxCron(new Request('https://local.test',{headers:{authorization:'Bearer test-cron-token'}})),true)
})
test('limite temporário do provedor retoma depois sem esgotar tentativas do caso',async()=>{
 const h=harness(url=>{
  if(url.includes('googleapis'))return {http_status:429}
  return {messages:[{id:10,created_at:'2026-10-05T12:59:00Z',author_type:'agent',visibility:'public',body:'Vou verificar a rejeição informada.'}]}
 },[[{...job,attempts:3}]])
 const result=await h.api.processCx('2026-10-01','2026-10-31',null,71000)
 assert.equal(result.failed,1)
 const retry=h.calls.flatMap(c=>c.args).find(a=>Array.isArray(a)&&a[0]==='update'&&a[1]?.error_code==='provider_rate_limit') as unknown[]
 const update=retry[1] as {status:string;attempts:number;next_attempt_at:string}
 assert.equal(update.status,'pending');assert.equal(update.attempts,2)
 assert.ok(Date.parse(update.next_attempt_at)>Date.now()+240000)
})
