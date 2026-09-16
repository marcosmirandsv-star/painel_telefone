// Pure calculation rules shared by the dashboard and the integration API.
export const round = (value: number) => Math.round(value * 100) / 100
export type PhoneIndividual = { csat: number; total_reviews: number; total_tickets: number }
export type PhoneTeam = { answered_calls: number; abandoned_calls: number; total_calls: number; overall_csat: number | null }
export type ChatIndicator = { csat: number; review_percentage: number; sending_percentage: number; total_tickets: number; valid_tickets: number; reviews: number; positive_reviews: number; negative_reviews: number; inactive_tickets: number }

export function calculateAverageCsat(metrics: PhoneIndividual[]) {
  if (!metrics.length) return 0
  const reviews = metrics.reduce((sum, row) => sum + Number(row.total_reviews), 0)
  return reviews > 0
    ? round(metrics.reduce((sum, row) => sum + Number(row.csat) * Number(row.total_reviews), 0) / reviews)
    : round(metrics.reduce((sum, row) => sum + Number(row.csat), 0) / metrics.length)
}

export function calculateTeamPerformance(metrics: Pick<PhoneTeam, 'answered_calls' | 'total_calls'>[]) {
  const total = metrics.reduce((sum, row) => sum + Number(row.total_calls), 0)
  return total ? round(metrics.reduce((sum, row) => sum + Number(row.answered_calls), 0) / total * 100) : 0
}

export function calculateChatAverage(metrics: Pick<ChatIndicator, 'csat' | 'review_percentage' | 'sending_percentage'>[], field: 'csat' | 'review_percentage' | 'sending_percentage') {
  return metrics.length ? round(metrics.reduce((sum, row) => sum + Number(row[field]), 0) / metrics.length) : 0
}

export function phoneSummary(individual: PhoneIndividual[], team: PhoneTeam[]) {
  const tickets = individual.reduce((sum, row) => sum + Number(row.total_tickets), 0)
  const reviews = individual.reduce((sum, row) => sum + Number(row.total_reviews), 0)
  const overall = team.filter(row => row.overall_csat !== null)
  return {
    registros_individuais: individual.length, registros_equipe: team.length,
    atendimentos: tickets, avaliacoes: reviews,
    csat_n1: individual.length ? calculateAverageCsat(individual) : null,
    percentual_avaliacoes: tickets ? round(reviews / tickets * 100) : null,
    chamadas_atendidas: team.reduce((sum, row) => sum + Number(row.answered_calls), 0),
    chamadas_abandonadas: team.reduce((sum, row) => sum + Number(row.abandoned_calls), 0),
    chamadas_totais: team.reduce((sum, row) => sum + Number(row.total_calls), 0),
    performance: team.some(row => Number(row.total_calls) > 0) ? calculateTeamPerformance(team) : null,
    csat_geral: overall.length ? round(overall.reduce((sum, row) => sum + Number(row.overall_csat), 0) / overall.length) : null,
  }
}

export function chatSummary(metrics: ChatIndicator[], excludedCount: number) {
  return {
    registros_considerados: metrics.length, registros_excluidos: excludedCount,
    atendimentos: metrics.reduce((sum, row) => sum + Number(row.total_tickets), 0),
    atendimentos_validos: metrics.reduce((sum, row) => sum + Number(row.valid_tickets), 0),
    avaliacoes: metrics.reduce((sum, row) => sum + Number(row.reviews), 0),
    avaliacoes_positivas: metrics.reduce((sum, row) => sum + Number(row.positive_reviews), 0),
    avaliacoes_negativas: metrics.reduce((sum, row) => sum + Number(row.negative_reviews), 0),
    inativos: metrics.reduce((sum, row) => sum + Number(row.inactive_tickets), 0),
    csat: metrics.length ? calculateChatAverage(metrics, 'csat') : null,
    percentual_avaliacoes: metrics.length ? calculateChatAverage(metrics, 'review_percentage') : null,
    percentual_sem_avaliacao: metrics.length ? calculateChatAverage(metrics, 'sending_percentage') : null,
  }
}
