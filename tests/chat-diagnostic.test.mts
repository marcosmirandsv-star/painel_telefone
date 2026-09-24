import assert from 'node:assert/strict'
import test from 'node:test'
import { buildChatPerformanceDiagnostic } from '../src/lib/chat-diagnostic.ts'

test('diagnóstico explica atenção quando somente avaliações atingem a meta', () => {
  const diagnostic = buildChatPerformanceDiagnostic({
    csat: 57.14,
    csatGoal: 86,
    reviewPercentage: 30.43,
    reviewGoal: 25,
    positiveReviews: 4,
    negativeReviews: 3,
    attendances: 23,
  })

  assert.equal(diagnostic.status, 'attention')
  assert.equal(diagnostic.statusLabel, 'Atenção')
  assert.equal(diagnostic.goalsMet, 1)
  assert.equal(diagnostic.goalsEvaluated, 2)
  assert.equal(diagnostic.csatDelta, -28.86)
  assert.equal(diagnostic.reviewDelta, 5.43)
  assert.equal(diagnostic.strength.title, 'Participação nas avaliações')
  assert.equal(diagnostic.attention.title, 'Satisfação do cliente')
  assert.match(diagnostic.priority.detail, /3 avaliações negativas/)
})

test('diagnóstico sinaliza sucesso quando as duas metas são atingidas', () => {
  const diagnostic = buildChatPerformanceDiagnostic({
    csat: 92,
    csatGoal: 90,
    reviewPercentage: 31,
    reviewGoal: 25,
    positiveReviews: 20,
    negativeReviews: 2,
    attendances: 70,
  })

  assert.equal(diagnostic.status, 'success')
  assert.equal(diagnostic.statusLabel, 'Dentro das metas')
  assert.equal(diagnostic.goalsMet, 2)
  assert.equal(diagnostic.attention.title, 'Nenhum indicador abaixo da meta')
})

test('diagnóstico sinaliza prioridade quando nenhuma meta é atingida', () => {
  const diagnostic = buildChatPerformanceDiagnostic({
    csat: 80,
    csatGoal: 90,
    reviewPercentage: 20,
    reviewGoal: 25,
    negativeReviews: 2,
    attendances: 50,
  })

  assert.equal(diagnostic.status, 'priority')
  assert.equal(diagnostic.statusLabel, 'Prioridade')
  assert.equal(diagnostic.goalsMet, 0)
  assert.equal(diagnostic.attention.title, 'CSAT e participação nas avaliações')
})

test('diagnóstico não inventa conclusão quando a base está incompleta', () => {
  const diagnostic = buildChatPerformanceDiagnostic({
    csat: null,
    csatGoal: 90,
    reviewPercentage: 30,
    reviewGoal: 25,
    attendances: 10,
  })

  assert.equal(diagnostic.status, 'partial')
  assert.equal(diagnostic.statusLabel, 'Leitura parcial')
  assert.equal(diagnostic.goalsEvaluated, 1)
  assert.match(diagnostic.summary, /ainda não há avaliações suficientes/)
})
