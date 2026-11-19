/** Painel executivo: equipe é vínculo cadastral, nunca a fila do ticket.
 *  Os totais referem-se exclusivamente a tickets com autoria final auditada.
 *  A contagem do relatório oficial da fila deve ser apresentada separadamente.
 */
export type VerifiedTeamTicket = {
  ticket_id: string
  analyst_id: string
  team_id: string
  satisfaction_label: 'positive' | 'negative' | null
  verified_at: string
}
export type RegisteredChatTeam = { id: string; name: string; active: boolean }

export function summarizeVerifiedTeams(
  teams: RegisteredChatTeam[],
  tickets: VerifiedTeamTicket[],
  coverageComplete: boolean,
) {
  const byTeam = new Map(teams.filter(t => t.active).map(t => [t.id, {
    team_id: t.id,
    team_name: t.name,
    attendances: 0,
    positive_reviews: 0,
    negative_reviews: 0,
    reviews: 0,
    csat_pct: null as number | null,
    review_percentage: null as number | null,
    latest_verified_at: null as string | null,
    coverage_status: coverageComplete ? 'complete' : 'partial',
    available: false,
  }]))
  const seen = new Set<string>()
  for (const ticket of tickets) {
    if (seen.has(ticket.ticket_id)) throw new Error('duplicate_final_ticket_id')
    seen.add(ticket.ticket_id)
    const team = byTeam.get(ticket.team_id)
    if (!team) throw new Error('confirmed_ticket_without_registered_active_team')
    team.attendances++
    if (ticket.satisfaction_label === 'positive') team.positive_reviews++
    if (ticket.satisfaction_label === 'negative') team.negative_reviews++
    if (!team.latest_verified_at || ticket.verified_at > team.latest_verified_at) {
      team.latest_verified_at = ticket.verified_at
    }
  }
  for (const team of byTeam.values()) {
    team.reviews = team.positive_reviews + team.negative_reviews
    team.csat_pct = team.reviews
      ? Math.round(team.positive_reviews / team.reviews * 10000) / 100 : null
    team.review_percentage = team.attendances
      ? Math.round(team.reviews / team.attendances * 10000) / 100 : null
    team.available = team.attendances > 0
  }
  return [...byTeam.values()]
}
