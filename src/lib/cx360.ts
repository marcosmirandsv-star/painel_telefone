export const caseStates = ['identificado', 'em_investigacao', 'aguardando_validacao', 'acao_definida', 'em_acompanhamento', 'concluido', 'inconclusivo'] as const
export type CaseState = typeof caseStates[number]
export const stateLabels: Record<CaseState, string> = {
  identificado: 'Identificado', em_investigacao: 'Em investigação', aguardando_validacao: 'Aguardando validação',
  acao_definida: 'Ação definida', em_acompanhamento: 'Em acompanhamento', concluido: 'Concluído', inconclusivo: 'Inconclusivo',
}
export const transitions: Record<CaseState, readonly CaseState[]> = {
  identificado: ['em_investigacao', 'inconclusivo'],
  em_investigacao: ['aguardando_validacao', 'inconclusivo'],
  aguardando_validacao: ['em_investigacao', 'acao_definida', 'inconclusivo'],
  acao_definida: ['em_acompanhamento', 'em_investigacao', 'inconclusivo'],
  em_acompanhamento: ['concluido', 'em_investigacao', 'inconclusivo'],
  concluido: [], inconclusivo: ['em_investigacao'],
}
export function validDate(value: string) {
  return /^20\d{2}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
}
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)
}
export type CxCase = {
  id: string; ticket_source: 'clickdesk' | 'zendesk' | 'telefone'; ticket_id: string; team_id: string; title: string; status: CaseState;
  observation: string; evidence: string; hypothesis: string; impact: string;
  action: string; review_date: string | null; owner_id: string; decision_notes: string; outcome: string;
  approved_by: string | null; approved_at: string | null; version: number; created_at: string; updated_at: string;
}
export function validateCaseUpdate(previous: CxCase, input: Record<string, unknown>) {
  if (previous.status === 'concluido') throw new Error('Acompanhamentos concluídos não podem ser alterados.')
  const status = input.status as CaseState
  if (!caseStates.includes(status) || (status !== previous.status && !transitions[previous.status].includes(status))) throw new Error('Transição de acompanhamento inválida.')
  const text = (key: string, max: number) => {
    if (typeof input[key] !== 'string' || (input[key] as string).length > max) throw new Error(`Campo ${key} inválido.`)
    return (input[key] as string).trim()
  }
  const action = text('action', 3000), decision_notes = text('decision_notes', 3000), outcome = text('outcome', 3000)
  const review_date = input.review_date === null || input.review_date === '' ? null : input.review_date
  if (review_date !== null && (typeof review_date !== 'string' || !validDate(review_date))) throw new Error('Data de revisão inválida.')
  if (!isUuid(input.owner_id)) throw new Error('Responsável inválido.')
  if (status === 'acao_definida' && (!action || !review_date || !decision_notes || input.approve !== true)) throw new Error('Aprovar uma ação exige ação, revisão, justificativa e confirmação explícita.')
  if (['concluido', 'inconclusivo'].includes(status) && !outcome) throw new Error('Registre o resultado ou a justificativa do encerramento.')
  if (previous.approved_by && status !== 'em_investigacao' && (action !== previous.action || review_date !== previous.review_date || input.owner_id !== previous.owner_id)) throw new Error('Retorne à investigação antes de alterar uma ação aprovada.')
  return { status, action, review_date: review_date as string | null, owner_id: input.owner_id, decision_notes, outcome }
}
