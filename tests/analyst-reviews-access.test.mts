import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'

const own='97f0071d-ae22-4d90-8c4d-1545e00b4a7d',other='24e897bb-80c4-4710-be3f-b5a71efabe41'
const source=readFileSync(new URL('../src/app/api/clickdesk/my-reviews/route.ts',import.meta.url),'utf8')
const compiled=ts.transpileModule(source.replace(/^import[^\r\n]*\r?\n/gm,'').replace(/export /g,''),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText
function harness({environment='homologacao',capture=true,management=false}={}) {
  let fetches=0,queries=0
  const rows=[{ticket_id:'100',ticket_number:'111',rated_at:'2026-11-04T15:00:00Z',sentiment:'positive',original_label:'Ótimo',analyst_id:own},{ticket_id:'101',ticket_number:'112',rated_at:'2026-11-05T15:00:00Z',sentiment:'negative',original_label:'Neutro',analyst_id:own},{ticket_id:'102',ticket_number:'113',rated_at:'2026-11-06T15:00:00Z',sentiment:'negative',original_label:'Ruim',analyst_id:other}]
  const db={rpc:async()=>({data:capture?[{}]:[],error:null}),from:(name:string)=>{
    queries++;const filters:Record<string,unknown>={}
    const chain={select(){return chain},eq(key:string,value:unknown){filters[key]=value;return chain},in(){return chain},order(){return chain},range(){return chain},then(resolve:(r:unknown)=>unknown){
      const data=name==='clickdesk_official_period_votes'?rows.filter(row=>row.analyst_id===filters.analyst_id):name==='clickdesk_final_ticket_ledger'?[{ticket_id:'100'}]:[]
      return Promise.resolve({data,error:null}).then(resolve)
    }};return chain
  }}
  class ApiError extends Error{constructor(public status:number,message:string){super(message)}}
  const GET=runInNewContext(compiled+'\nGET',{ApiError,URL,Date,Set,AbortSignal,
    getServerSupabaseConfig:()=>({environment}),authorizeClickDeskSessionClient:async()=>({isManagement:management,chatAnalystId:own,admin:db}),
    handle:async(fn:()=>Promise<Response>)=>{try{return await fn()}catch(error){return Response.json({erro:(error as Error).message},{status:(error as ApiError).status||503})}},json:Response.json,
    extractTranscriptText:()=> 'Conversa de teste',readFinalLedger:async()=>[],
    process:{env:{CLICKDESK_API_KEY:'fixture',CLICKDESK_ACCOUNT_ID:'fixture'}},fetch:async()=>{fetches++;return Response.json({fixture:true})},
  }) as (r:Request)=>Promise<Response>
  return {run:(query='')=>GET(new Request('https://example.test/api?start=2026-11-01&end=2026-11-11'+query)),stats:()=>({fetches,queries})}
}

test('notas originais próprias incluem neutro como ruim e preservam elegibilidade de autoria',async()=>{
  const h=harness(),response=await h.run(),data=await response.json()
  assert.equal(response.status,200);assert.deepEqual(data.totals,{total:2,positive:1,negative:1})
  assert.deepEqual(data.items.map((item:{ticket_id:string})=>item.ticket_id),['100','101'])
  assert.equal(data.items[0].can_analyze,true);assert.equal(data.items[1].can_analyze,false)
  assert.equal(h.stats().fetches,0)
})
test('outro analista e ambiente de produção são recusados antes de consultar tickets',async()=>{
  const h=harness();assert.equal((await h.run('&analyst_id='+other)).status,403);assert.equal(h.stats().queries,0)
  const production=harness({environment:'producao'});assert.equal((await production.run()).status,404);assert.equal(production.stats().queries,0)
})
test('conversa de ticket alheio não é enviada à API; própria abre sem disparar IA',async()=>{
  const h=harness();assert.equal((await h.run('&ticket_id=102')).status,404);assert.equal(h.stats().fetches,0)
  const response=await h.run('&ticket_id=100');assert.equal(response.status,200);assert.equal((await response.json()).transcript,'Conversa de teste');assert.equal(h.stats().fetches,1)
})
test('captura ausente e datas inválidas não aparecem como zero avaliações',async()=>{
  assert.equal((await harness({capture:false}).run()).status,503)
  assert.equal((await harness().run('&start=2026-11-02')).status,400)
})
