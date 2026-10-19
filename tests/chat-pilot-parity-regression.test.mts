import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const read = (name: string) => readFileSync(new URL('../' + name, import.meta.url), 'utf8')

test('gestão e piloto consultam o mesmo ledger e a mesma regra de métricas', () => {
  const metrics = read('src/app/api/clickdesk/metrics/route.ts')
  const ledger = read('src/lib/clickdesk-ledger-server.ts')
  assert.match(metrics, /readFinalLedger\(admin, \{ start: filters\.start, end: filters\.end, analystId: filters\.analystId, teamId: filters\.teamId \}\)/)
  assert.match(metrics, /const filters = access\.isManagement\s*\? requestedFilters\s*:\s*\{[\s\S]*?analystId: access\.chatAnalystId/)
  assert.match(metrics, /loadRows\(access\.admin, filters, access\.isManagement\)/)
  assert.match(metrics, /positive_reviews: Number\(ticket\.satisfaction_label === 'positive'\)/)
  assert.match(metrics, /negative_reviews: Number\(ticket\.satisfaction_label === 'negative'\)/)
  assert.match(ledger, /\.eq\('analyst_id', filters\.analystId\)/)
  assert.match(ledger, /\.eq\('team_id', filters\.teamId\)/)
})

test('perfis individuais recebem somente atestado do período, sem acessar a cobertura gerencial', async () => {
  const ledger=read('src/lib/clickdesk-ledger-server.ts')
  const start=ledger.indexOf('export async function readLedgerCoverageForAccess('),end=ledger.indexOf('export function asFinalTicket',start)
  const code=ts.transpileModule(ledger.slice(start,end).replace(/^export /,''),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
  const fn=runInNewContext(code+'\nreadLedgerCoverageForAccess',{
    readLedgerCoverage:()=>{throw Error('global coverage read forbidden for personal access')},
    scopeLedgerCoverage:()=>{throw Error('global counts must not reach personal scope')}
  }) as (admin:unknown,management:boolean,period?:{start:string;end:string})=>Promise<{complete:boolean;entries:unknown[];verified_at:string|null}>
  const calls:Array<{name:string;args:unknown}>=[]
  const result=await fn({
    from:()=>{throw Error('direct table read forbidden')},
    rpc:async(name:string,args:unknown)=>{calls.push({name,args});return {data:{complete:true,verified_at:'2026-10-19T12:00:00Z',global_count:1234},error:null}}
  },false,{start:'2026-10-01',end:'2026-10-19'})
  assert.equal(result.complete,true)
  assert.equal(JSON.stringify(result.entries),'[]')
  assert.equal(Object.keys(result).sort().join(','),'complete,entries,note,verified_at')
  assert.equal(calls[0].name,'get_clickdesk_period_attestation')
  assert.equal(JSON.stringify(calls[0].args),JSON.stringify({p_start:'2026-10-01',p_end:'2026-10-19'}))
  const denied=await fn({rpc:async()=>({error:{code:'42501'},data:{complete:true}})},false,{start:'2026-10-01',end:'2026-10-19'})
  assert.equal(denied.complete,false)
  for(const route of ['history','tickets']){
    const source=read('src/app/api/clickdesk/'+route+'/route.ts')
    assert.match(source,/readLedgerCoverageForAccess\(admin, access\.isManagement, \{/)
    assert.doesNotMatch(source,/readLedgerCoverage\(admin\)/)
  }
})

test('historico e tickets recusam consultas cruzadas e preservam titularidade', () => {
  const history = read('src/app/api/clickdesk/history/route.ts')
  const tickets = read('src/app/api/clickdesk/tickets/route.ts')
  const qualitative = read('src/app/api/clickdesk/qualitative/route.ts')
  for (const route of [history, tickets]) {
    assert.match(route, /requestedAnalystId !== access\.chatAnalystId/)
    assert.match(route, /new ApiError\(403/)
    assert.match(route, /access\.chatAnalystId/)
  }
  assert.match(history, /get_clickdesk_self_closed_history/)
  assert.match(qualitative, /final\.analyst_id !== sessionAccess\.chatAnalystId/)
  assert.match(qualitative, /clickdesk_final_ticket_pending/)
})

test('visao geral usa login RLS da gestao e aplica a regra de colaboradores ativos', () => {
  const overview = read('src/app/api/clickdesk/overview/route.ts')
  const metrics = read('src/app/api/clickdesk/metrics/route.ts')
  assert.match(overview, /authorizeManagerSessionClient\(request\)/)
  assert.match(overview, /partitionChatLedgerByActiveRoster\(/)
  assert.match(metrics, /partitionChatLedgerByActiveRoster\(/)
  assert.match(overview, /team_summaries: teamSummaries/)
  assert.match(overview, /ledger_coverage: coverage\.complete \? 'complete' : 'partial'/)
})
