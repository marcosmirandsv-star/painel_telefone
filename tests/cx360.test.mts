import test from 'node:test'
import assert from 'node:assert/strict'
import { validateCaseUpdate, validDate, caseStates, transitions, type CxCase } from '../src/lib/cx360.ts'

const base = { id: 'b6652876-caf3-414c-bd25-9a7516ca5777', status: 'identificado', action: '', owner_id: 'b6652876-caf3-414c-bd25-9a7516ca5777', review_date: null, decision_notes: '', outcome: '', approved_by: null } as CxCase
const input = (extra: Record<string, unknown>) => ({ ...base, ...extra })
test('investigação não pode saltar diretamente para ação ou conclusão', () => {
  for (const status of ['acao_definida', 'concluido', 'em_acompanhamento']) assert.throws(() => validateCaseUpdate(base, input({ status })), /Transição/)
  assert.equal(validateCaseUpdate(base, input({ status: 'em_investigacao' })).status, 'em_investigacao')
})
test('aprovação exige confirmação, plano, data e justificativa', () => {
  const previous = { ...base, status: 'aguardando_validacao' as const }
  const complete = input({ status: 'acao_definida', action: 'Revisar fluxo técnico', review_date: '2026-11-13', decision_notes: 'Evidência revisada', approve: true })
  assert.equal(validateCaseUpdate(previous, complete).status, 'acao_definida')
  for (const [key, value] of [['approve', false], ['action', ''], ['review_date', null], ['decision_notes', '']]) assert.throws(() => validateCaseUpdate(previous, { ...complete, [key as string]: value }))
})
test('não aceitar fechamento sem resultado nem reescrever ação aprovada', () => {
  const previous = { ...base, status: 'em_acompanhamento' as const, approved_by: base.owner_id, action: 'Plano aprovado', review_date: '2026-11-13' }
  assert.throws(() => validateCaseUpdate(previous, { ...previous, status: 'concluido' }), /justificativa/)
  assert.throws(() => validateCaseUpdate(previous, { ...previous, action: 'Outra ação' }), /investigação/)
  assert.equal(validateCaseUpdate(previous, { ...previous, status: 'concluido', outcome: 'Conferidos os tickets e registrada a limitação da amostra' }).status, 'concluido')
})
test('inconclusivo exige justificativa e pode voltar à investigação', () => {
  assert.throws(() => validateCaseUpdate(base, input({ status: 'inconclusivo' })), /justificativa/)
  assert.equal(validateCaseUpdate(base, input({ status: 'inconclusivo', outcome: 'Conversa incompleta' })).status, 'inconclusivo')
  assert.equal(validateCaseUpdate({ ...base, status: 'inconclusivo' }, input({ status: 'em_investigacao' })).status, 'em_investigacao')
})
test('datas impossíveis e responsáveis inválidos são rejeitados', () => {
  assert.equal(validDate('2026-02-30'), false)
  assert.equal(validDate('2028-02-29'), true)
  assert.throws(() => validateCaseUpdate(base, input({ owner_id: 'inexistente' })))
})

test('todas as etapas seguem o fluxo e casos concluídos recusam até edição sem troca de etapa', () => {
  for (const from of caseStates) for (const to of caseStates) {
    const previous = { ...base, status: from }
    const update = input({ status: to, action: 'Plano sintético de teste', review_date: '2026-11-13', decision_notes: 'Evidências verificadas', outcome: 'Resultado registrado', approve: true })
    if (from !== 'concluido' && (from === to || transitions[from].includes(to))) assert.equal(validateCaseUpdate(previous, update).status, to)
    else assert.throws(() => validateCaseUpdate(previous, update))
  }
})
