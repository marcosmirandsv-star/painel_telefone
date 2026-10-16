import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { partitionChatLedgerByActiveRoster } from '../src/lib/clickdesk-active-analysts.ts'
import { summarizeVerifiedTeams } from '../src/lib/clickdesk-team-summary.ts'

const read = (name: string) => readFileSync(new URL('../' + name, import.meta.url), 'utf8')

const people = [
  { id: 'vanessa', active: true },
  { id: 'ana-claudia', active: false },
  { id: 'ismael', active: false },
  { id: 'karolyne', active: true },
]
const tickets = [
  { ticket_id: '101', analyst_id: 'vanessa', team_id: 'notas', satisfaction_label: 'positive' as const, verified_at: '2026-10-16T17:00:00Z' },
  { ticket_id: '102', analyst_id: 'ana-claudia', team_id: 'notas', satisfaction_label: 'negative' as const, verified_at: '2026-10-16T17:30:00Z' },
  { ticket_id: '103', analyst_id: 'ana-claudia', team_id: 'notas', satisfaction_label: null, verified_at: '2026-10-16T17:35:00Z' },
  { ticket_id: '104', analyst_id: 'ismael', team_id: 'outros', satisfaction_label: null, verified_at: '2026-10-16T17:40:00Z' },
  { ticket_id: '105', analyst_id: 'karolyne', team_id: 'outros', satisfaction_label: 'negative' as const, verified_at: '2026-10-16T17:45:00Z' },
]

test('Ana Cláudia e outros inativos deixam a visão atual sem apagar crédito histórico', () => {
  const original = structuredClone(tickets)
  const { active, inactive } = partitionChatLedgerByActiveRoster(tickets, people)
  assert.deepEqual(active.map(t => t.ticket_id), ['101', '105'])
  assert.deepEqual(inactive.map(t => t.ticket_id), ['102', '103', '104'])
  assert.deepEqual(tickets, original)
  const summaries = summarizeVerifiedTeams([
    { id: 'notas', name: 'Chat Notas', active: true },
    { id: 'outros', name: 'Chat Outros', active: true },
  ], active, false)
  assert.deepEqual(summaries.map(x => x.attendances), [1, 1])
  assert.deepEqual(summaries.map(x => x.reviews), [1, 1])
  assert.equal(summaries[0].csat_pct, 100)
  assert.equal(summaries[1].csat_pct, 0)
})

test('cadastro desconhecido falha e nunca desconsidera silenciosamente um crédito', () => {
  assert.throws(
    () => partitionChatLedgerByActiveRoster([...tickets, { ...tickets[0], analyst_id: 'unknown' }], people),
    /ledger_author_without_registered_analyst/,
  )
})

test('endpoint central reutiliza sessão verificada e RLS da API de desempenho', () => {
  const overview = read('src/app/api/clickdesk/overview/route.ts')
  const metrics = read('src/app/api/clickdesk/metrics/route.ts')
  assert.match(overview, /authorizeManagerSessionClient\(request\)/)
  assert.doesNotMatch(overview, /authorizeManager\(request\)/)
  assert.match(overview, /partitionChatLedgerByActiveRoster\(tickets, analystsResult\.data \?\? \[\]\)/)
  assert.match(overview, /excluded_inactive_analyst_tickets: excludedInactive/)
  assert.match(overview, /console\.info\('clickdesk_overview'/)
  assert.match(metrics, /partitionChatLedgerByActiveRoster\(tickets, people\.data \?\? \[\]\)/)
  assert.match(metrics, /filters\.analystId \? tickets : partition\.active/)
  assert.match(metrics, /excluded_inactive_analyst_attendances: excludedInactive/)
  assert.doesNotMatch(overview, /SUPABASE_SERVICE_ROLE_KEY/)
  assert.doesNotMatch(metrics, /SUPABASE_SERVICE_ROLE_KEY/)
})
