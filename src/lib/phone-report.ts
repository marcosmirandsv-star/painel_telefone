import { calculateAverageCsat, round, type PhoneIndividual } from './indicators.ts'

export const phoneFeedbackHeadings = {
  mimo: ['Momento observado', 'Impacto', 'Melhoria ou manutenção', 'Orientação'],
  sare: ['Situação', 'Alinhamentos Realizados', 'Resultado Esperado', 'Expectativa e Plano de Desenvolvimento'],
} as const

export function getPreviousPhoneCalendarMonth(start: string, end: string) {
  if (!start.endsWith('-01')) return null

  const [year, month] = start.split('-').map(Number)
  const date = (monthIndex: number, day: number) =>
    new Date(Date.UTC(year, monthIndex, day)).toISOString().slice(0, 10)

  if (end !== date(month, 0)) return null
  return { start: date(month - 2, 1), end: date(month - 1, 0) }
}

export function comparePhoneCsat(
  current: { csat: number; reviews: number },
  previous: PhoneIndividual[],
) {
  if (current.reviews <= 0 || !previous.some((metric) => Number(metric.total_reviews) > 0)) return null

  const csat = calculateAverageCsat(previous)
  return { csat, delta: round(current.csat - csat) }
}

export async function loadPhoneMetricPages<Row, ErrorType>(
  loadPage: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: ErrorType | null }>,
) {
  const pageSize = 500
  const rows: Row[] = []

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await loadPage(from, from + pageSize - 1)
    if (error || !data) return { data: null, error }
    rows.push(...data)
    if (data.length < pageSize) return { data: rows, error: null }
  }
}
