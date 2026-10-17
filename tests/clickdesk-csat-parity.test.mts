import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { sumChatVoteRows } from '../src/lib/clickdesk-csat.ts'

const source=(path:string)=>readFileSync(new URL('../'+path,import.meta.url),'utf8')

test('Thiago Reis em outubro: 59 positivas e 13 negativas = 81,94%, sem misturar setembro',()=>{
  const october=sumChatVoteRows([{attendances:267,positive_reviews:59,negative_reviews:13}])
  assert.deepEqual(october,{
    attendances:267,positives:59,negatives:13,reviews:72,csat:81.94,reviewPercentage:26.97,
  })
  const day=sumChatVoteRows([{attendances:23,positive_reviews:4,negative_reviews:1}])
  assert.equal(day.csat,80)
  const september=sumChatVoteRows([{attendances:63,positive_reviews:11,negative_reviews:4}])
  assert.equal(september.csat,73.33)
  const both=sumChatVoteRows([
    {attendances:267,positive_reviews:59,negative_reviews:13},
    {attendances:63,positive_reviews:11,negative_reviews:4},
  ])
  assert.equal(both.csat,80.46)
  assert.notEqual(day.csat,october.csat)
  assert.notEqual(both.csat,october.csat)
})

test('Consolidado é calculado pelas avaliações, não pela média simples do CSAT dos analistas',()=>{
  const rows=[
    {attendances:100,positive_reviews:90,negative_reviews:10},
    {attendances:10,positive_reviews:1,negative_reviews:9},
  ]
  const team=sumChatVoteRows(rows)
  assert.equal(team.attendances,110)
  assert.equal(team.positives,91)
  assert.equal(team.negatives,19)
  assert.equal(team.csat,82.73)
  assert.notEqual(team.csat,(90+10)/2)
  assert.deepEqual(sumChatVoteRows([...rows].reverse()),team)
})

test('Zero avaliações é não calculável e totais incoerentes nunca passam',()=>{
  const none=sumChatVoteRows([{attendances:11,positive_reviews:0,negative_reviews:0}])
  assert.equal(none.csat,null)
  assert.equal(none.reviewPercentage,0)
  assert.equal(sumChatVoteRows([]).csat,null)
  assert.throws(()=>sumChatVoteRows([{attendances:1,positive_reviews:2,negative_reviews:0}]),/invalid_chat_vote_totals/)
  assert.throws(()=>sumChatVoteRows([{attendances:-2,positive_reviews:0,negative_reviews:0}]),/invalid_chat_vote_totals/)
})

test('Visões do Chat usam o mesmo período, ledger e cálculo ponderado',()=>{
  const page=source('src/app/page.tsx')
  const api=source('src/app/api/clickdesk/metrics/route.ts')
  const overview=source('src/app/api/clickdesk/overview/route.ts')
  assert.match(page,/const clickDeskAuditPeriodMatches =/)
  assert.match(page,/clickDeskPersistedMetrics\?\.period\?\.start === chatAuditPeriod\.start/)
  assert.match(page,/const visibleMetrics = liveChatAnalysis \? clickDeskAuditMetrics : legacyVisibleMetrics/)
  assert.match(page,/const auditedChatTotals = liveChatAnalysis/)
  assert.match(page,/sumChatVoteRows\(calculationMetrics\.map/)
  assert.match(page,/const chat2VisibleMetrics = chat2SelectedPeriod\.start >= '2026-10-01'/)
  assert.match(page,/const chatReportCurrentClickDeskOnly = chatReportPeriod\.start >= '2026-10-01'/)
  assert.match(page,/const chat2LiveHumanRows = chat2PersistedHumanRows/)
  assert.match(page,/const chat2LiveCandidateCsat = chat2SelectedPersistedAnalyst\?\.csat \?\? null/)
  assert.match(page,/item\.team_id === chat2SelectedPersistedAnalyst\.team_id/)
  assert.match(page,/const chat2CurrentTeamTotals = chat2SelectedPeriod\.start >= '2026-10-01'/)
  assert.match(page,/CSAT consolidado por avaliações/)
  assert.match(page,/O percentual diário pode ser diferente do acumulado desta competência/)
  assert.match(api,/readFinalLedger\(admin, \{ start: filters\.start, end: filters\.end/)
  assert.match(api,/positive_reviews: Number\(ticket\.satisfaction_label === 'positive'\)/)
  assert.match(api,/negative_reviews: Number\(ticket\.satisfaction_label === 'negative'\)/)
  assert.match(overview,/readFinalLedger\(admin/)
  assert.match(overview,/team_summaries: teamSummaries/)
})

test('Telefone permanece separado: nenhuma dependência de seus indicadores no cálculo do Chat',()=>{
  const helper=source('src/lib/clickdesk-csat.ts')
  assert.doesNotMatch(helper,/phone|telefone|55DBX|weekly_individual_metrics|weekly_team_metrics/i)
  assert.doesNotMatch(source('src/app/api/clickdesk/metrics/route.ts'),/weekly_individual_metrics|weekly_team_metrics/)
})
