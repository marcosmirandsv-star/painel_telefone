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
  assert.match(synthesis.result_read, /tempo de espera/)
  assert.equal(synthesis.recommended_focus, synthesis.result_read)
  assert.doesNotMatch(synthesis.result_read, /Priorize|Complete a cobertura|ação gerencial|transforme/)
  assert.match(synthesis.caveat, /Recorrência não prova causalidade/)
})

test('síntese descreve processo quando a cobertura é suficiente e o contexto é da empresa', () => {
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
  assert.match(synthesis.result_read, /processo/)
  assert.match(synthesis.result_read, /empresa ou processo interno/)
  assert.equal(synthesis.recommended_focus, synthesis.result_read)
  assert.match(synthesis.positive_read, /qualidade da resolução/)
  assert.doesNotMatch(JSON.stringify(synthesis), /Priorize|Complete a cobertura|ação gerencial|transforme/)
})


test('funil permanece estável quando não há avaliações negativas', () => {
  const rows = [
    ...Array.from({ length: 80 }, (_, index) => ({
      clickdesk_ticket_id: `u-${index}`,
      satisfaction_label: null,
    })),
    ...Array.from({ length: 20 }, (_, index) => ({
      clickdesk_ticket_id: `p-${index}`,
      satisfaction_label: 'positive',
    })),
  ]

  const result = calculateOperation360Totals(rows)

  assert.equal(result.attendances, 100)
  assert.equal(result.evaluated, 20)
  assert.equal(result.positive, 20)
  assert.equal(result.negative, 0)
  assert.equal(result.csat, 100)
  assert.equal(result.review_percentage, 20)
})

test('síntese sem negativas explica ausência de impacto negativo no recorte', () => {
  const analysis = buildOperation360Analysis([], 'approved')
  const synthesis = buildOperation360Synthesis({
    negativeTotal: 0,
    positiveTotal: 20,
    analysis,
  })

  assert.equal(synthesis.coverage_level, 'none')
  assert.match(synthesis.headline, /Não há avaliações negativas/)
})

test('agregação preserva rastreabilidade dos tickets por padrão', () => {
  const makeAnalysis = (summary: string) => ({
    primary_cause: {
      category: 'resolution_quality',
      summary,
    },
    human_influence: {
      classification: 'worsened',
      summary: 'A condução não levou à resolução.',
    },
    controllability: {
      classification: 'analyst',
      summary: 'Havia ação possível no atendimento.',
    },
    analyst_takeaway: {
      kind: 'develop',
      summary: 'Confirmar a resolução antes do encerramento.',
    },
  })

  const result = buildOperation360Analysis(
    [
      {
        clickdesk_ticket_id: 'neg-101',
        satisfaction_label: 'negative',
        validation_status: 'approved',
        analysis: makeAnalysis('A solução não ficou confirmada.'),
      },
      {
        clickdesk_ticket_id: 'neg-102',
        satisfaction_label: 'negative',
        validation_status: 'approved',
        analysis: makeAnalysis('O atendimento terminou sem resolução clara.'),
      },
    ],
    'approved',
  )

  assert.equal(result.negative.causes[0]?.key, 'resolution_quality')
  assert.equal(result.negative.causes[0]?.count, 2)
  assert.deepEqual(result.negative.causes[0]?.ticket_ids, ['neg-101', 'neg-102'])
  assert.equal(result.negative.causes[0]?.examples.length, 2)
})

test('grande volume mantém percentuais e limita evidências expostas por padrão', () => {
  const rows = Array.from({ length: 120 }, (_, index) => ({
    clickdesk_ticket_id: `neg-${index + 1}`,
    satisfaction_label: 'negative',
    validation_status: 'approved' as const,
    analysis: {
      primary_cause: {
        category: 'process',
        summary: `Processo observado ${index + 1}.`,
      },
      human_influence: {
        classification: 'neutral',
        summary: 'Sem influência humana demonstrável.',
      },
      controllability: {
        classification: 'company',
        summary: 'Fator de processo interno.',
      },
      analyst_takeaway: {
        kind: 'context',
        summary: 'Contextualizar limitação operacional.',
      },
    },
  }))

  const result = buildOperation360Analysis(rows, 'approved')

  assert.equal(result.negative.analyzed, 120)
  assert.equal(result.negative.causes[0]?.count, 120)
  assert.equal(result.negative.causes[0]?.percentage, 100)
  assert.equal(result.negative.causes[0]?.ticket_ids.length, 8)
  assert.equal(result.negative.causes[0]?.examples.length, 3)
})

test('consolidação preliminar usa pending e approved e exclui rejected', () => {
  const analysis = {
    primary_cause: { category: 'process', summary: 'Processo observado.' },
    human_influence: { classification: 'neutral', summary: 'Sem influência demonstrável.' },
    controllability: { classification: 'company', summary: 'Fator de processo.' },
    analyst_takeaway: { kind: 'context', summary: 'Contexto operacional.' },
  }

  const result = buildOperation360Analysis(
    [
      {
        clickdesk_ticket_id: 'approved-1',
        satisfaction_label: 'negative',
        validation_status: 'approved',
        analysis,
      },
      {
        clickdesk_ticket_id: 'pending-1',
        satisfaction_label: 'negative',
        validation_status: 'pending',
        analysis,
      },
      {
        clickdesk_ticket_id: 'rejected-1',
        satisfaction_label: 'negative',
        validation_status: 'rejected',
        analysis,
      },
    ],
    'analyzed',
  )

  assert.equal(result.negative.analyzed, 2)
  assert.equal(result.negative.causes[0]?.count, 2)
  assert.deepEqual(
    result.negative.causes[0]?.ticket_ids,
    ['approved-1', 'pending-1'],
  )
})


test('síntese aprofunda expectativa do cliente com exemplos concretos dos tickets', () => {
  const analysis = {
    status: 'analyzed',
    total: 6,
    negative: {
      analyzed: 4,
      causes: [
        {
          key: 'customer_expectation',
          count: 3,
          percentage: 75,
          ticket_ids: ['n-1', 'n-2', 'n-3'],
          examples: [
            'Cliente esperava que a correção fiscal fosse feita diretamente pelo suporte.',
            'Cliente esperava conclusão imediata mesmo dependendo de validação externa.',
            'Cliente esperava continuidade do atendimento sem nova etapa de confirmação.',
          ],
        },
      ],
      controllability: [
        {
          key: 'mixed',
          count: 3,
          percentage: 75,
          ticket_ids: ['n-1', 'n-2', 'n-3'],
          examples: ['Parte da expectativa dependia do cliente e parte da condução do atendimento.'],
        },
      ],
      human_influence: [],
      takeaways: [],
    },
    positive: {
      analyzed: 2,
      causes: [
        {
          key: 'resolution_quality',
          count: 2,
          percentage: 100,
          ticket_ids: ['p-1', 'p-2'],
          examples: ['A orientação passo a passo levou à resolução.'],
        },
      ],
      controllability: [],
      human_influence: [],
      takeaways: [],
    },
  }

  const synthesis = buildOperation360Synthesis({
    negativeTotal: 6,
    positiveTotal: 10,
    analysis,
  })

  assert.match(synthesis.negative_read, /expectativa do cliente/)
  assert.match(synthesis.negative_read, /correção fiscal/)
  assert.match(synthesis.negative_read, /validação externa/)
  assert.match(synthesis.result_read, /expectativa do cliente/)
  assert.match(synthesis.result_read, /O que aparece nos tickets/)
  assert.match(synthesis.positive_read, /orientação passo a passo/)
})

test('síntese sem cobertura informa processamento pendente em vez de sugerir padrão insuficiente', () => {
  const analysis = buildOperation360Analysis([], 'analyzed')
  const synthesis = buildOperation360Synthesis({
    negativeTotal: 5,
    positiveTotal: 15,
    analysis,
  })

  assert.equal(synthesis.coverage_level, 'none')
  assert.match(synthesis.coverage_label, /Análise pendente/)
  assert.match(synthesis.headline, /nenhuma delas foi processada qualitativamente/)
  assert.match(synthesis.negative_read, /aguardam processamento qualitativo/)
  assert.match(synthesis.result_read, /análise qualitativa ainda não foi executada/)
  assert.doesNotMatch(synthesis.result_read, /padrão seguro|base suficiente/)
})
