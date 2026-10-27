import assert from 'node:assert/strict'
import test from 'node:test'
import { buildClickDeskMetricRows } from '../src/lib/clickdesk-import.ts'

test('atribui avaliações ao time de lotação do responsável e ignora linhas sem responsável', () => {
  const rows = buildClickDeskMetricRows({
    evaluationRows: [
      { Responsável: 'João Vitor Almeida', Sentimento: 'Positivo', Equipe: 'Suporte - ERP' },
      { Responsável: 'João Vitor Almeida', Sentimento: 'Negativo', Equipe: 'Suporte - Fiscal' },
      { Responsável: '', Sentimento: 'Negativo', Equipe: 'Suporte - Fiscal' },
    ],
    attendanceRows: [{ Atendente: 'João Vitor Almeida', Resolvidas: '10' }],
    analysts: [{ id: 'joao', name: 'João Vitor Almeida', team_id: 'fiscal', csat_goal: 90, active: true }],
    year: 2026,
    monthNumber: 10,
    monthLabel: 'Outubro 2026',
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
  })

  assert.equal(rows.length, 1)
  assert.equal(rows[0].team_id, 'fiscal')
  assert.equal(rows[0].positive_reviews, 1)
  assert.equal(rows[0].negative_reviews, 1)
  assert.equal(rows[0].reviews, 2)
  assert.equal(rows[0].total_tickets, 10)
  assert.equal(rows[0].csat, 50)
})
