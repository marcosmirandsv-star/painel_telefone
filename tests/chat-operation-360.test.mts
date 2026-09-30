import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildOperation360Analysis,
  calculateOperation360Totals,
} from '../src/lib/chat-operation-360.ts'

test('calcula funil e CSAT sobre avaliações, não sobre atendimentos', () => {
  const rows = [
    ...Array.from({ length: 374 }, (_, index) => ({
      clickdesk_ticket_id: `n-${index}`,
      satisfaction_label: null,
    })),
    ...Array.from({ length: 132 }, (_, index) => ({
      clickdesk_ticket_id: `p-${index}`,
      satisfaction_label: 'positive',
    })),
    ...Array.from({ length: 39 }, (_, index) => ({
      clickdesk_ticket_id: `m-${index}`,
      satisfaction_label: 'negative',
    })),
  ]

  const result = calculateOperation360Totals(rows)

  assert.equal(result.attendances, 545)
  assert.equal(result.evaluated, 171)
  assert.equal(result.positive, 132)
  assert.equal(result.negative, 39)
  assert.equal(result.csat, 77.19)
  assert.equal(result.review_percentage, 31.38)
})

test('consolidação validada ignora pending e rejected', () => {
  const baseAnalysis = {
    initial_sentiment: 'negative',
    final_sentiment: 'negative',
    primary_cause: {
      category: 'communication',
      summary: 'Faltou alinhar o próximo passo.',
      confidence: 'high',
    },
    human_influence: {
      classification: 'worsened',
      summary: 'A condução aumentou a ambiguidade.',
      confidence: 'medium',
    },
    controllability: {
      classification: 'analyst',
      summary: 'Havia ação possível no atendimento.',
    },
    coaching_signal: {
      available: true,
      summary: 'Confirmar entendimento antes do encerramento.',
    },
    analyst_takeaway: {
      kind: 'develop',
      summary: 'Confirmar entendimento e próximo passo.',
      confidence: 'high',
    },
    evidence_summary: ['Cliente pediu confirmação do próximo passo.'],
    limitations: [],
  }

  const rows = [
    {
      clickdesk_ticket_id: 'approved-1',
      satisfaction_label: 'negative',
      validation_status: 'approved' as const,
      analysis: baseAnalysis,
    },
    {
      clickdesk_ticket_id: 'pending-1',
      satisfaction_label: 'negative',
      validation_status: 'pending' as const,
      analysis: baseAnalysis,
    },
    {
      clickdesk_ticket_id: 'rejected-1',
      satisfaction_label: 'negative',
      validation_status: 'rejected' as const,
      analysis: baseAnalysis,
    },
  ]

  const result = buildOperation360Analysis(rows, 'approved')

  assert.equal(result.total, 1)
  assert.equal(result.negative.analyzed, 1)
  assert.equal(result.negative.causes[0]?.key, 'communication')
  assert.equal(result.negative.causes[0]?.count, 1)
  assert.deepEqual(result.negative.causes[0]?.ticket_ids, ['approved-1'])
})
