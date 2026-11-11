import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
import {clickDeskDailyAvailable,clickDeskPublicationDay,publishedClickDeskEnd} from '../src/lib/clickdesk-publication.ts'
import {receivedCount,receivedForOwner} from '../supabase/functions/clickdesk-official-metrics-sync/received.ts'

test('daily display follows reconciled availability, not the source name',()=>{
 assert.equal(clickDeskDailyAvailable({source:'clickdesk_official_period_metrics',publication:{daily_available:true}}),true)
 assert.equal(clickDeskDailyAvailable({source:'clickdesk_official_period_metrics',publication:{daily_available:false}}),false)
 assert.equal(clickDeskDailyAvailable({source:'clickdesk_official_period_metrics'}),false)
 assert.equal(clickDeskDailyAvailable(null),false)
})

test('Current day respects Brasília midnight, month and leap-year boundaries',()=>{
  assert.equal(clickDeskPublicationDay(new Date('2026-11-03T02:59:59Z')),'2026-11-02')
  assert.equal(clickDeskPublicationDay(new Date('2026-11-03T03:00:00Z')),'2026-11-03')
  assert.equal(clickDeskPublicationDay(new Date('2026-11-01T12:00:00Z')),'2026-11-01')
  assert.equal(clickDeskPublicationDay(new Date('2024-03-01T12:00:00Z')),'2024-03-01')
  assert.equal(publishedClickDeskEnd('2026-10-31',new Date('2026-11-03T12:00:00Z')),'2026-10-31')
  assert.equal(publishedClickDeskEnd('2026-12-31',new Date('2026-11-03T12:00:00Z')),'2026-11-03')
})

async function runCapture({conflict=false,incomplete=false,token=true,november=false,mismatch=false}={}) {
  const source=readFileSync(new URL('../supabase/functions/clickdesk-official-metrics-sync/index.ts',import.meta.url),'utf8')
  const registry=[
    {clickdesk_owner_id:23,source_owner_name:'Carlos Lemos',source_owner_key:'carlos lemos'},
    {clickdesk_owner_id:47,source_owner_name:'João Pedro Vianey',source_owner_key:'joao pedro vianey'},
    {clickdesk_owner_id:12,source_owner_name:'Ana Julia',source_owner_key:'ana julia'},
  ]
  let saved: Record<string,unknown>[]=[]
  let handler: (r:Request)=>Promise<Response>
  const queries:URL[]=[]
  const db={rpc:async()=>({data:{api_key:'fixture',account_id:'fixture'},error:null}),from:(name:string)=>{
    if(name==='clickdesk_official_owner_registry') {
      const chain={select(){return chain},eq(){return chain},then(resolve:(r:unknown)=>unknown){return Promise.resolve({data:registry,error:null}).then(resolve)}}
      return chain
    }
    return {upsert:async(rows:typeof saved)=>{saved=rows;return {error:null}}}
  }}
  const compiled=ts.transpileModule(source.replace(/^import[^\r\n]*\r?\n/gm,''),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText
  const context={createClient:()=>db,receivedCount,receivedForOwner,Date,URLSearchParams,Response,console:{error(){}},
    Deno:{env:{get:(name:string)=>name==='SUPABASE_URL'?'https://example.test':name==='SUPABASE_SERVICE_ROLE_KEY'?'fixture':undefined},serve:(fn:typeof handler)=>{handler=fn}},
    fetch:async(input:string)=>{
      const url=new URL(input);queries.push(url)
      if(url.pathname.endsWith('/agents')) {
        const owners=url.searchParams.getAll('owner_ids[]').map(Number)
        return Response.json({summary:{received:{value:owners.length===1?(owners[0]===23?112:175):(mismatch?288:287)}},agents:[
        {id:23,name:'Carlos Henrique',conversations:454,resolved:352,replies:3872,csat_total:1},
        {id:47,name:'João Pedro Vianey',conversations:732,resolved:621,replies:7608,csat_total:1},
        {id:12,name:'Ana Julia',conversations:42,resolved:26,replies:433,csat_total:12},
      ].filter(row=>owners.includes(row.id))})
      }
      const page=Number(url.searchParams.get('page'))
      const department=Number(url.searchParams.get('department_id'))
      const carlos={ticket_id:1059718,number:1115616,owner:'Carlos Henrique',sentiment:'positive'}
      const joao={ticket_id:1081062,number:1136950,owner:'João Pedro Vianey',sentiment:'negative'}
      if(department===3)return Response.json({data:page===1?[carlos]:[joao],last_page:2,total:incomplete?3:2})
      return Response.json({data:[{...carlos,sentiment:conflict?'negative':'positive'}],last_page:1,total:1})
    }}
  runInNewContext(compiled,context)
  const response=await handler!(new Request('https://example.test',{method:'POST',headers:token?{authorization:'Bearer fixture'}:{},body:JSON.stringify(november?{start:'2026-11-01',end:'2026-11-10'}:{start:'2026-10-01',end:'2026-10-31'})}))
  return {response,saved,queries}
}

test('capture matches queue scope, uses resolved counts, canonical owner ID and technical ticket deduplication',async()=>{
  const {response,saved,queries}=await runCapture()
  assert.equal(response.status,200)
  assert.equal(saved.length,2)
  const carlos=saved.find(r=>r.source_owner_key==='carlos lemos')!
  assert.equal(carlos.attendances,352)
  assert.equal(carlos.positive_reviews,1)
  assert.equal(carlos.negative_reviews,0)
  const joao=saved.find(r=>r.source_owner_key==='joao pedro vianey')!
  assert.equal(joao.attendances,621)
  assert.equal(joao.negative_reviews,1)
  const query=queries.find(u=>u.pathname.endsWith('/agents'))!.searchParams
  assert.deepEqual(query.getAll('department_ids[]'),['3','12'])
  assert.deepEqual(query.getAll('owner_ids[]'),['23','47'])
})

test('conflicting duplicated votes and incomplete pages never overwrite published data',async()=>{
  for(const scenario of [{conflict:true},{incomplete:true}]){
    const result=await runCapture(scenario)
    assert.equal(result.response.status,500)
    assert.equal(result.saved.length,0)
  }
})

test('capture rejects unauthenticated requests before reading ClickDesk',async()=>{
  const result=await runCapture({token:false})
  assert.equal(result.response.status,401)
  assert.equal(result.queries.length,0)
  assert.equal(result.saved.length,0)
})

test('November received volume uses individual headers, reconciles the group and retains resolved separately',async()=>{
  const result=await runCapture({november:true})
  assert.equal(result.response.status,200)
  const carlos=result.saved.find(row=>row.source_owner_key==='carlos lemos')!
  assert.equal(carlos.attendances,112)
  assert.equal(carlos.resolved,352)
  assert.equal(carlos.attendance_basis,'received')
  assert.equal(carlos.positive_reviews,1)
  const mismatch=await runCapture({november:true,mismatch:true})
  assert.equal(mismatch.response.status,500)
  assert.equal(mismatch.saved.length,0)
})
