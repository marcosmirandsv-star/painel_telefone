import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildOperation360Analysis,
  buildOperation360Synthesis,
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


test('síntese não generaliza quando a cobertura negativa ainda é inicial', () => {
  const analysis = {
    status: 'analyzed',
    total: 2,
    negative: {
      analyzed: 2,
      causes: [
        {
          key: 'wait_time',
          count: 2,
          percentage: 100,
          ticket_ids: ['n-1', 'n-2'],
          examples: ['Houve espera antes da continuidade.'],
        },
      ],
      controllability: [
        {
          key: 'company',
          count: 2,
          percentage: 100,
          ticket_ids: ['n-1', 'n-2'],
          examples: ['O fator observado dependeu de processo interno.'],
        },
      ],
      human_influence: [],
      takeaways: [],
    },
    positive: {
      analyzed: 0,
      causes: [],
      controllability: [],
      human_influence: [],
      takeaways: [],
    },
  }

  const synthesis = buildOperation360Synthesis({
    negativeTotal: 39,
    positiveTotal: 132,
    analysis,
  })

  assert.equal(synthesis.coverage_level, 'initial')
  assert.match(synthesis.headline, /2 de 39/)
  assert.match(synthesis.recommended_focus, /Complete a cobertura/)
  assert.match(synthesis.caveat, /Recorrência não prova causalidade/)
})

test('síntese orienta processo quando a cobertura é suficiente e o contexto é da empresa', () => {
  const analysis = {
    status: 'analyzed',
    total: 30,
    negative: {
      analyzed: 24,
      causes: [
        {
          key: 'process',
          count: 14,
          percentage: 58.33,
          ticket_ids: ['n-1'],
          examples: ['O fluxo interno impediu a continuidade.'],
        },
      ],
      controllability: [
        {
          key: 'company',
          count: 15,
          percentage: 62.5,
          ticket_ids: ['n-1'],
          examples: ['O principal fator dependia da empresa.'],
        },
      ],
      human_influence: [],
      takeaways: [],
    },
    positive: {
      analyzed: 6,
      causes: [
        {
          key: 'resolution_quality',
          count: 5,
          percentage: 83.33,
          ticket_ids: ['p-1'],
          examples: ['A orientação levou à resolução.'],
        },
      ],
      controllability: [],
      human_influence: [],
      takeaways: [
        {
          key: 'maintain',
          count: 5,
          percentage: 83.33,
          ticket_ids: ['p-1'],
          examples: ['Manter orientação passo a passo.'],
        },
      ],
    },
  }

  const synthesis = buildOperation360Synthesis({
    negativeTotal: 30,
    positiveTotal: 20,
    analysis,
  })

  assert.equal(synthesis.coverage_level, 'strong')
  assert.match(synthesis.negative_read, /processo/)
  assert.match(synthesis.control_read, /empresa ou processo interno/)
  assert.match(synthesis.recommended_focus, /processo, regra interna, sistema ou produto/)
  assert.match(synthesis.positive_read, /prática a manter/)
})
