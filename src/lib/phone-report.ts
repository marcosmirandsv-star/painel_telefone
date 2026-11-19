import { calculateAverageCsat, round, type PhoneIndividual } from './indicators.ts'

export const phoneFeedbackHeadings = {
  mimo: ['Momento observado', 'Impacto', 'Melhoria ou manutenção', 'Orientação'],
  sare: ['Situação', 'Alinhamentos Realizados', 'Resultado Esperado', 'Expectativa e Plano de Desenvolvimento'],
} as const

export const phoneFeedbackActions = {
  csat: 'Explique uma etapa por vez e confirme o resultado com o cliente antes de avançar. Antes de encerrar a ligação, confirme se a demanda foi resolvida e recapitule a orientação. Se houver pendência, informe o próximo passo e como acompanhar.',
  reviews: 'Ao concluir a orientação e confirmar o resultado, convide o cliente a avaliar o atendimento. Acompanhe semanalmente a proporção de avaliações recebidas sobre os atendimentos realizados.',
  volume: 'Mantenha seu status de disponibilidade atualizado e volte à fila ao concluir o registro de cada ligação. Sinalize os impedimentos no momento em que ocorrerem para facilitar a retomada dos atendimentos.',
  maintenance: 'Continue confirmando a resolução antes de encerrar cada ligação e convidando o cliente a avaliar o atendimento. Acompanhe o CSAT e a proporção de avaliações ao longo do próximo ciclo.',
} as const

export type PhoneFeedbackFocus = keyof typeof phoneFeedbackActions
export type PhoneCsatBenchmark = { analystName: string; csat: number; gap: number }

export function getPhoneCsatBenchmark(
  ranking: { analystName: string; averageCsat: number; eligible: boolean }[],
  position: number,
): PhoneCsatBenchmark | null {
  const current = ranking[position - 1]
  const thirdPlace = ranking.filter((result) => result.eligible)[2]
  if (position <= 3 || !current?.eligible || !thirdPlace) return null

  const gap = round(thirdPlace.averageCsat - current.averageCsat)
  return gap > 0 ? { analystName: thirdPlace.analystName, csat: thirdPlace.averageCsat, gap } : null
}

export function getPhoneFeedbackFocus({
  csat, csatGoal, podiumCsatGoal, reviewPercentage, reviewGoal, totalTickets, averageTickets,
  benchmarkGap, csatDelta,
}: {
  csat: number
  csatGoal: number
  podiumCsatGoal: number
  reviewPercentage: number
  reviewGoal: number
  totalTickets: number
  averageTickets: number
  benchmarkGap?: number
  csatDelta?: number | null
}): PhoneFeedbackFocus {
  if (reviewPercentage === 0) return 'reviews'
  if (csat < Math.max(csatGoal, podiumCsatGoal)) return 'csat'
  if (reviewPercentage < reviewGoal) return 'reviews'
  if (averageTickets > 0 && totalTickets < averageTickets) return 'volume'
  if ((benchmarkGap ?? 0) > 0 || (csatDelta ?? 0) < 0) return 'csat'
  return 'maintenance'
}

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
