import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

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

test('perfis individuais nao consultam cobertura organizacional de acesso gerencial', () => {
  const ledger = read('src/lib/clickdesk-ledger-server.ts')
  const metrics = read('src/app/api/clickdesk/metrics/route.ts')
  const history = read('src/app/api/clickdesk/history/route.ts')
  const tickets = read('src/app/api/clickdesk/tickets/route.ts')
  assert.match(ledger, /if \(isManagement\) return readLedgerCoverage\(admin\)/)
  assert.match(ledger, /complete: false,\s*entries: \[\],\s*verified_at: null/)
  assert.match(metrics, /readLedgerCoverageForAccess\(admin, isManagement\)/)
  assert.match(history, /readLedgerCoverageForAccess\(admin, access\.isManagement\)/)
  assert.match(tickets, /readLedgerCoverageForAccess\(admin, access\.isManagement\)/)
  assert.doesNotMatch(history, /readLedgerCoverage\(admin\)/)
  assert.doesNotMatch(tickets, /readLedgerCoverage\(admin\)/)
})

test('historico e tickets recusam consultas cruzadas e preservam titularidade', () => {
  const history = read('src/app/api/clickdesk/history/route.ts')
  const tickets = read('src/app/api/clickdesk/tickets/route.ts')
  const qualitative = read('src/app/api/clickdesk/qualitative/route.ts')
  for (const route of [history, tickets]) {
    assert.match(route, /requestedAnalystId !== access\.chatAnalystId/)
    assert.match(route, /new ApiError\(403/)
    assert.match(route, /analystId: access\.chatAnalystId/)
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
