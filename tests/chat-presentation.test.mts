import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chatBusinessDate, chatPeriodBounds, selectChatPresentationRow } from '../src/lib/chat-presentation.ts'

test('manager and analyst select the identical API record without recalculation', () => {
  for (const analyst_id of ['vanessa', 'thiago', 'karolyne']) {
    const row = { analyst_id, attendances: 27, csat: 93.45, positive_reviews: 15, negative_reviews: 1, reviews: 16, review_percentage: 59.26 }
    const rows = [{ ...row, analyst_id: 'someone-else' }, row]
    const manager = selectChatPresentationRow(rows, analyst_id)
    const analyst = selectChatPresentationRow(rows.filter(r => r.analyst_id === analyst_id), analyst_id)
    assert.strictEqual(manager.row, row)
    assert.deepEqual(manager, analyst)
  }
})
test('missing identity never falls back to another professional', () => {
  const rows = [{ analyst_id: 'vanessa', attendances: 10 }]
  assert.equal(selectChatPresentationRow(rows, 'thiago').row, null)
  assert.equal(selectChatPresentationRow(rows, null).row, null)
})
test('multiple queue records are flagged, never summed or selected arbitrarily', () => {
  const result = selectChatPresentationRow([
    { analyst_id: 'thiago', area: 'Fiscal', attendances: 5 },
    { analyst_id: 'thiago', area: 'ERP', attendances: 4 },
  ], 'thiago')
  assert.deepEqual(result, { row: null, ambiguous: true })
})
test('Brazilian date is independent of UTC day and host timezone', () => {
  assert.equal(chatBusinessDate(new Date('2026-10-04T02:59:59Z')), '2026-10-03')
  assert.equal(chatBusinessDate(new Date('2026-10-04T03:00:00Z')), '2026-10-04')
  assert.deepEqual(chatPeriodBounds('2026-10'), { start: '2026-10-01', end: '2026-10-31' })
  assert.deepEqual(chatPeriodBounds('2028-02'), { start: '2028-02-01', end: '2028-02-29' })
  assert.throws(() => chatPeriodBounds('2026-13'))
})
test('both interfaces reuse the same summary and explicitly warn about partial capture', () => {
  const page = readFileSync(new URL('../src/app/page.tsx', import.meta.url), 'utf8')
  assert.equal((page.match(/<ChatSharedPerformanceSummary /g) ?? []).length, 2)
  assert.match(page, /sincronização concluída ou ausência de registros não comprova cobertura completa/i)
  assert.match(page, /Competência do meu desempenho/)
  assert.match(page, /Visões principais do Chat/)
})
