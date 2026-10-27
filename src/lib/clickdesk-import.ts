export type SheetRow = Record<string, string | number | null>

export type ClickDeskAnalyst = {
  id: string
  name: string
  team_id: string
  csat_goal: number
  active: boolean
}

export type ClickDeskMetricRow = {
  team_id: string
  analyst_id: string
  month_label: string
  year: number
  month_number: number
  period_start: string
  period_end: string
  csat: number
  review_percentage: number
  sending_percentage: number
  total_tickets: number
  inactive_tickets: number
  valid_tickets: number
  reviews: number
  positive_reviews: number
  negative_reviews: number
  csat_goal: number
  csat_delta: number
  general_review_goal: number
  status: string
}

const round = (value: number) => Math.round(value * 100) / 100

function normalizeText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

function normalizeColumn(value: string) {
  return normalizeText(value).replace(/[^a-z0-9]/g, '')
}

function findColumn(rows: SheetRow[], candidates: string[]) {
  const headers = Object.keys(rows[0] ?? {})
  const normalizedCandidates = candidates.map(normalizeColumn)
  const directMatch = headers.find((header) => normalizedCandidates.includes(normalizeColumn(header)))
  if (directMatch) return directMatch

  return headers.find((header) => {
    const normalizedHeader = normalizeColumn(header)
    return normalizedCandidates.some((candidate) => normalizedHeader.includes(candidate) || candidate.includes(normalizedHeader))
  })
}

function valueOf(row: SheetRow, column: string) {
  return String(row[column] ?? '').trim()
}

function countNumber(value: string) {
  const normalized = value.replace(/\./g, '').replace(',', '.').replace(/[^0-9.-]/g, '')
  const parsed = Number(normalized)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

function metricStatus(csat: number, reviewPercentage: number, csatGoal: number, reviewGoal = 25) {
  if (csat >= csatGoal && reviewPercentage >= reviewGoal) return 'Meta Superada'
  if (csat >= csatGoal || reviewPercentage >= reviewGoal) return 'Atenção'
  return 'Em acompanhamento'
}

/**
 * ClickDesk measures the queue operationally. Performance is intentionally
 * attributed to the responsible person and their allocated team. Rows without
 * a responsible person are not returned and never influence human performance.
 */
export function buildClickDeskMetricRows({
  evaluationRows,
  attendanceRows,
  analysts,
  year,
  monthNumber,
  monthLabel,
  periodStart,
  periodEnd,
}: {
  evaluationRows: SheetRow[]
  attendanceRows: SheetRow[]
  analysts: ClickDeskAnalyst[]
  year: number
  monthNumber: number
  monthLabel: string
  periodStart: string
  periodEnd: string
}): ClickDeskMetricRow[] {
  const responsibleColumn = findColumn(evaluationRows, ['Responsável', 'Responsavel', 'Atendente', 'Analista'])
  const sentimentColumn = findColumn(evaluationRows, ['Sentimento', 'Avaliação', 'Avaliacao'])
  const attendanceAnalystColumn = findColumn(attendanceRows, ['Atendente', 'Responsável', 'Responsavel', 'Analista'])
  const resolvedColumn = findColumn(attendanceRows, ['Resolvidas', 'Resolvidos', 'Conversas resolvidas'])

  if (!responsibleColumn) throw new Error('Não encontrei a coluna “Responsável” no arquivo de avaliações do ClickDesk.')
  if (!sentimentColumn) throw new Error('Não encontrei a coluna “Sentimento” no arquivo de avaliações do ClickDesk.')
  if (!attendanceAnalystColumn || !resolvedColumn) throw new Error('Não encontrei as colunas “Atendente” e “Resolvidas” no relatório de atendimentos do ClickDesk.')

  const attendanceByAnalyst = new Map<string, number>()
  for (const row of attendanceRows) {
    const name = normalizeText(valueOf(row, attendanceAnalystColumn))
    if (!name) continue
    attendanceByAnalyst.set(name, countNumber(valueOf(row, resolvedColumn)))
  }

  return analysts
    .filter((analyst) => analyst.active)
    .map((analyst): ClickDeskMetricRow | null => {
      const analystName = normalizeText(analyst.name)
      const evaluations = evaluationRows.filter((row) => normalizeText(valueOf(row, responsibleColumn)) === analystName)
      const positiveReviews = evaluations.filter((row) => normalizeText(valueOf(row, sentimentColumn)) === 'positivo').length
      const negativeReviews = evaluations.filter((row) => normalizeText(valueOf(row, sentimentColumn)) === 'negativo').length
      const reviews = positiveReviews + negativeReviews
      const reportedResolved = attendanceByAnalyst.get(analystName) ?? 0
      const totalTickets = Math.max(reportedResolved, reviews)
      if (!totalTickets) return null

      const validTickets = totalTickets
      const csat = reviews ? round((positiveReviews / reviews) * 100) : 0
      const reviewPercentage = validTickets ? round((reviews / validTickets) * 100) : 0
      const sendingPercentage = validTickets ? round(((validTickets - reviews) / validTickets) * 100) : 0
      const csatGoal = Number(analyst.csat_goal) || 86
      const generalReviewGoal = 25

      return {
        team_id: analyst.team_id,
        analyst_id: analyst.id,
        month_label: monthLabel,
        year,
        month_number: monthNumber,
        period_start: periodStart,
        period_end: periodEnd,
        csat,
        review_percentage: reviewPercentage,
        sending_percentage: sendingPercentage,
        total_tickets: totalTickets,
        inactive_tickets: 0,
        valid_tickets: validTickets,
        reviews,
        positive_reviews: positiveReviews,
        negative_reviews: negativeReviews,
        csat_goal: csatGoal,
        csat_delta: round(csat - csatGoal),
        general_review_goal: generalReviewGoal,
        status: metricStatus(csat, reviewPercentage, csatGoal, generalReviewGoal),
      }
    })
    .filter((record): record is ClickDeskMetricRow => Boolean(record))
}
