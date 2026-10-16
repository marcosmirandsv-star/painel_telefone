import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { summarizeVerifiedTeams } from '../src/lib/clickdesk-team-summary.ts'

const source=(path:string)=>readFileSync(new URL('../'+path,import.meta.url),'utf8')
const teams=[
  {id:'notas',name:'Chat Notas',active:true},
  {id:'outros',name:'Chat Outros',active:true},
]
const base=[
  {ticket_id:'1',analyst_id:'a',team_id:'notas',satisfaction_label:'positive' as const,verified_at:'2026-10-16T16:00:00Z'},
  {ticket_id:'2',analyst_id:'a',team_id:'notas',satisfaction_label:'negative' as const,verified_at:'2026-10-16T17:00:00Z'},
  {ticket_id:'3',analyst_id:'b',team_id:'notas',satisfaction_label:null,verified_at:'2026-10-16T18:00:00Z'},
  {ticket_id:'4',analyst_id:'c',team_id:'outros',satisfaction_label:'positive' as const,verified_at:'2026-10-16T18:00:00Z'},
]
test('equipe vem do cadastro, avaliação sem voto não vira negativa',()=>{
  const actual=summarizeVerifiedTeams(teams,base,false)
  assert.equal(actual.length,2)
  const notas=actual.find(t=>t.team_id==='notas')!
  const outros=actual.find(t=>t.team_id==='outros')!
  assert.equal(notas.attendances,3)
  assert.equal(notas.positive_reviews,1)
  assert.equal(notas.negative_reviews,1)
  assert.equal(notas.reviews,2)
  assert.equal(notas.csat_pct,50)
  assert.equal(notas.review_percentage,66.67)
  assert.equal(notas.coverage_status,'partial')
  assert.equal(outros.attendances,1)
  assert.equal(outros.reviews,1)
  assert.equal(outros.csat_pct,100)
  assert.equal(actual.reduce((n,t)=>n+t.attendances,0),base.length)
})

test('sem crédito não é zero oficial; duplicidade e time desconhecido bloqueados',()=>{
  const empty=summarizeVerifiedTeams(teams,[],false)
  assert.equal(empty.every(t=>!t.available&&t.csat_pct===null),true)
  assert.throws(()=>summarizeVerifiedTeams(teams,[...base,base[0]],false),/duplicate_final_ticket_id/)
  assert.throws(()=>summarizeVerifiedTeams(teams,[{...base[0],team_id:'N3'}],false),/confirmed_ticket_without_registered_active_team/)
})

test('visão executiva não mistura report de fila com performance da equipe',()=>{
  const api=source('src/app/api/clickdesk/overview/route.ts')
  const page=source('src/app/page.tsx')
  assert.match(api,/authorizeManager\(request\)/)
  assert.match(api,/readFinalLedger\(admin/)
  assert.match(api,/summarizeVerifiedTeams/)
  assert.match(api,/team_summaries: teamSummaries/)
  assert.match(api,/queue_reports: queueReports/)
  assert.match(api,/queue_report_status:/)
  assert.doesNotMatch(api,/latestByTeam/)
  assert.match(page,/chatOverview\?\.team_summaries/)
  assert.match(page,/chatOverview\?\.queue_reports/)
  assert.match(page,/Créditos verificados/)
  assert.match(page,/Não confundir ausência de leitura com zero atendimentos/)
  assert.match(page,/const chat2OperationTeams/)
  assert.match(page,/const key = item\.team_id \?\? 'sem-vinculo'/)
  assert.doesNotMatch(page,/const chat2OperationAreas/)
  assert.match(page,/Renovação, Suporte N3 e fila não comprovada são históricos de roteamento/)
})
