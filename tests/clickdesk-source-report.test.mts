import assert from 'node:assert/strict'
import test from 'node:test'
import { sourceReportRows, sourceReportScope } from '../src/lib/clickdesk-source-report.ts'

test('conferência da fila mantém datas fechadas e recusa parâmetros que ampliem o escopo', () => {
  const params = new URLSearchParams({ start: '2026-11-01', end: '2026-11-30', department_id: '12' })
  assert.deepEqual(sourceReportScope(params, '2026-11-09'), { start: '2026-11-01', end: '2026-11-09', department_id: 12 })
  for (const value of ['start=2026-11-31&end=2026-11-30&department_id=12', 'start=2026-11-10&end=2026-11-10&department_id=12', 'start=2026-11-01&end=2026-11-09&department_id=51', 'start=2026-11-01&end=2026-11-09&department_id=12&owner=1']) {
    assert.throws(() => sourceReportScope(new URLSearchParams(value), '2026-11-09'))
  }
})
test('respondidos, resolvidos e avaliações não se confundem e indicadores ausentes não viram zero', () => {
  const row = { id: 47, name: 'João Pedro Vianey', conversations: 230, resolved: 145, csat_total: 77, csat_pct: 96,
    transfers_out: 25, first_response_seconds: 29, handle_seconds: 1769, sla_pct: null, first_contact_pct: 94, reopened_pct: 1 }
  const [result] = sourceReportRows({ agents: [row] })
  assert.equal(result.responded, 230); assert.equal(result.resolved, 145); assert.equal(result.reviews, 77)
  assert.equal(result.sla_pct, null); assert.equal(result.csat_pct, 96)
  assert.throws(() => sourceReportRows({ agents: [row, row] }))
  assert.throws(() => sourceReportRows({ agents: [{ ...row, resolved: undefined }] }))
  assert.throws(() => sourceReportRows({ agents: [{ ...row, csat_pct: 101 }] }))
})
