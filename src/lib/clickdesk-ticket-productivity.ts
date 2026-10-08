import type { HumanCaptureResult } from './clickdesk-human-capture'

export type TicketSatisfaction = 'positive' | 'negative' | null

/**
 * The legacy management report needs only ticket ID, human analyst and
 * optional binary evaluation. Incoming channel/AI origin is not a condition.
 * Do not fabricate an evaluation when it was only offered to a customer.
 */
export function normalizeTicketSatisfaction(value: unknown): TicketSatisfaction {
  if (!value) return null
  const object = typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : { sentiment: value }
  for (const field of ['sentiment','label','rating','glyph']) {
    const raw = object[field]
    if (typeof raw !== 'string') continue
    const normalized = raw.normalize('NFD').replace(/[\u0300-\u036f]/g,'')
      .toLowerCase().trim()
    if (['positive','good','boa','bom','positiva','positivo'].includes(normalized)) return 'positive'
    if (['negative','bad','ruim','negativa','negativo'].includes(normalized)) return 'negative'
  }
  return null
}

export function buildTicketProductivityEvidence(
  verifiedAnswer: HumanCaptureResult,
  rawTicket: unknown,
) {
  const ticket = rawTicket && typeof rawTicket === 'object' && !Array.isArray(rawTicket)
    ? rawTicket as Record<string, unknown> : {}
  return {
    ticket_id: verifiedAnswer.ticket_id,
    analyst_id: verifiedAnswer.analyst_id,
    analyst_name: verifiedAnswer.author,
    human_answered_date: verifiedAnswer.human_answered_date,
    first_public_human_message_id: verifiedAnswer.first_public_human_message_id,
    satisfaction_label: normalizeTicketSatisfaction(ticket.satisfaction),
    // Source department and AI handoff deliberately do not decide productivity.
    verification: 'public_human_author',
  } as const
}
