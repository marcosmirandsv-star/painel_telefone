/**
 * Lote 360º ClickDesk — exclusivamente homologação.
 * A automação busca todo o período em aberto, sem confundir dia da
 * execução com data original de avaliação.
 */
const FIRST_BACKLOG_DATE = '2026-10-01'

function validDate(value: unknown): value is string {
  return typeof value === 'string'
    && /^20\d{2}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value))
    && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value
}

export function resolve360BatchWindow(
  input: { start?: unknown; end?: unknown; limit?: unknown },
  today: string,
) {
  if (!validDate(today)) throw new Error('invalid_today')
  const start = typeof input.start === 'string' && input.start.trim()
    ? input.start.trim() : FIRST_BACKLOG_DATE
  const end = typeof input.end === 'string' && input.end.trim()
    ? input.end.trim() : today
  if (!validDate(start) || !validDate(end) ||
      start < FIRST_BACKLOG_DATE || end > today || start > end) {
    throw new Error('invalid_backlog_period')
  }
  const requestedLimit = typeof input.limit === 'number' && Number.isFinite(input.limit)
    ? Math.trunc(input.limit) : 6
  const limit = Math.max(1, Math.min(requestedLimit, 8))
  return {
    start, end, limit,
    period_source: input.start || input.end ? 'explicit' : 'backlog_october_to_today',
  } as const
}
