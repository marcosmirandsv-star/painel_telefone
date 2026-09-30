import { normalizeQualitativeAnalysis } from '@/lib/clickdesk-qualitative'

export type Operation360Attendance = {
  clickdesk_ticket_id: string
  satisfaction_label: string | null
}

export type Operation360AnalysisRow = {
  clickdesk_ticket_id: string
  satisfaction_label: string | null
  validation_status: 'pending' | 'approved' | 'rejected'
  analysis: unknown
}

export type Operation360Pattern = {
  key: string
  count: number
  percentage: number
  ticket_ids: string[]
  examples: string[]
}

export function operation360Percentage(part: number, total: number) {
  return total > 0 ? Math.round((part / total) * 10000) / 100 : 0
}

export function calculateOperation360Totals(rows: Operation360Attendance[]) {
  const positive = rows.filter((row) => row.satisfaction_label === 'positive').length
  const negative = rows.filter((row) => row.satisfaction_label === 'negative').length
  const evaluated = positive + negative

  return {
    attendances: rows.length,
    evaluated,
    positive,
    negative,
    csat: evaluated > 0 ? operation360Percentage(positive, evaluated) : null,
    review_percentage:
      rows.length > 0 ? operation360Percentage(evaluated, rows.length) : null,
  }
}

function buildPatterns(
  rows: Array<{
    ticket_id: string
    key: string
    example: string
  }>,
): Operation360Pattern[] {
  const total = rows.length
  const grouped = new Map<string, { count: number; ticketIds: string[]; examples: string[] }>()

  for (const row of rows) {
    const current = grouped.get(row.key) ?? { count: 0, ticketIds: [], examples: [] }
    current.count += 1

    if (current.ticketIds.length < 8 && !current.ticketIds.includes(row.ticket_id)) {
      current.ticketIds.push(row.ticket_id)
    }

    if (
      row.example &&
      current.examples.length < 3 &&
      !current.examples.includes(row.example)
    ) {
      current.examples.push(row.example)
    }

    grouped.set(row.key, current)
  }

  return [...grouped.entries()]
    .map(([key, value]) => ({
      key,
      count: value.count,
      percentage: operation360Percentage(value.count, total),
      ticket_ids: value.ticketIds,
      examples: value.examples,
    }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
}

export function buildOperation360Analysis(
  rows: Operation360AnalysisRow[],
  status: 'approved' | 'analyzed' = 'approved',
) {
  const eligible =
    status === 'approved'
      ? rows.filter((row) => row.validation_status === 'approved')
      : rows.filter((row) => row.validation_status !== 'rejected')

  const normalized = eligible.map((row) => ({
    ticket_id: row.clickdesk_ticket_id,
    satisfaction_label: row.satisfaction_label,
    analysis: normalizeQualitativeAnalysis(row.analysis),
  }))

  const summarize = (satisfaction: 'positive' | 'negative') => {
    const scoped = normalized.filter((row) => row.satisfaction_label === satisfaction)

    return {
      analyzed: scoped.length,
      causes: buildPatterns(
        scoped.map((row) => ({
          ticket_id: row.ticket_id,
          key: row.analysis.primary_cause.category,
          example: row.analysis.primary_cause.summary,
        })),
      ),
      controllability: buildPatterns(
        scoped.map((row) => ({
          ticket_id: row.ticket_id,
          key: row.analysis.controllability.classification,
          example: row.analysis.controllability.summary,
        })),
      ),
      human_influence: buildPatterns(
        scoped.map((row) => ({
          ticket_id: row.ticket_id,
          key: row.analysis.human_influence.classification,
          example: row.analysis.human_influence.summary,
        })),
      ),
      takeaways: buildPatterns(
        scoped.map((row) => ({
          ticket_id: row.ticket_id,
          key: row.analysis.analyst_takeaway.kind,
          example: row.analysis.analyst_takeaway.summary,
        })),
      ),
    }
  }

  return {
    status,
    total: normalized.length,
    negative: summarize('negative'),
    positive: summarize('positive'),
  }
}
