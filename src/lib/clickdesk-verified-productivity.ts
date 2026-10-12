/**
 * Verified human productivity and customer evaluations are separate facts:
 * - One service contribution for each (ticket, analyst) with a public human reply.
 * - At most one customer evaluation for each ticket, awarded only to the last
 *   human responder according to the ticket-level evidence.
 * - An unrated attendance is valid productivity: CSAT is null (not 0%) when
 *   no reviews were received, and the review rate is 0% for nonzero volume.
 *
 * This is a supplementary validated capture, NEVER an implicit replacement
 * for the old CSAT or the official resolved-tickets report and podium.
 */
export type VerifiedContributionRow = {
  ticket_id: string
  analyst_id: string
  team_id: string
  analyst_name: string
  occurred_date: string
  verified_at: string | null
  satisfaction_label?: 'positive' | 'negative' | null
}

type ReviewCounts = { positive: number; negative: number }
const emptyReviews = (): ReviewCounts => ({ positive: 0, negative: 0 })
const percentage = (number: number, denominator: number) =>
  denominator > 0 ? Math.round((number / denominator) * 10000) / 100 : null

function reviewStats(reviews: ReviewCounts, attendances: number) {
  const count = reviews.positive + reviews.negative
  return {
    positive_reviews: reviews.positive,
    negative_reviews: reviews.negative,
    reviews: count,
    csat: percentage(reviews.positive, count),
    review_percentage: percentage(count, attendances),
  }
}

type AnalystSummary = {
  analyst_id: string
  team_id: string
  analyst_name: string
  total: number
  days: Map<string, number>
  reviews: ReviewCounts
  reviewsByDay: Map<string, ReviewCounts>
}

function addReview(
  collection: Map<string, ReviewCounts>,
  key: string,
  label: 'positive' | 'negative',
) {
  const current = collection.get(key) ?? emptyReviews()
  current[label]++
  collection.set(key, current)
}

export function summarizeVerifiedContributions(
  rows: VerifiedContributionRow[],
  today: string,
) {
  const seenContributions = new Set<string>()
  const ratedTickets = new Set<string>()
  const byDay = new Map<string, number>()
  const globalReviews = emptyReviews()
  const reviewsByDay = new Map<string, ReviewCounts>()
  const analysts = new Map<string, AnalystSummary>()
  let lastVerifiedAt: string | null = null

  // Prefer a row carrying an explicit evaluation if a batch supplied the same
  // ticket+analyst twice. A duplicate must never become an extra attendance.
  const unique = new Map<string, VerifiedContributionRow>()
  for (const row of rows) {
    if (!row.ticket_id || !row.analyst_id || !row.team_id || !row.occurred_date)
      continue
    const name = row.analyst_name.normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
    if (/^(ana julia|david)( |$)/.test(name)) continue
    const key = row.ticket_id + '::' + row.analyst_id
    const prev = unique.get(key)
    if (!prev || (!prev.satisfaction_label && row.satisfaction_label)) {
      unique.set(key, row)
    }
  }

  for (const row of unique.values()) {
    const key = row.ticket_id + '::' + row.analyst_id
    if (seenContributions.has(key)) continue
    const analyst = analysts.get(row.analyst_id) ?? {
      analyst_id: row.analyst_id,
      team_id: row.team_id,
      analyst_name: row.analyst_name,
      total: 0,
      days: new Map<string, number>(),
      reviews: emptyReviews(),
      reviewsByDay: new Map<string, ReviewCounts>(),
    }
    if (analyst.team_id !== row.team_id) continue
    seenContributions.add(key)
    analyst.total++
    analyst.days.set(row.occurred_date, (analyst.days.get(row.occurred_date) ?? 0) + 1)
    analysts.set(row.analyst_id, analyst)
    byDay.set(row.occurred_date, (byDay.get(row.occurred_date) ?? 0) + 1)

    if ((row.satisfaction_label === 'positive' || row.satisfaction_label === 'negative')
      && !ratedTickets.has(row.ticket_id)) {
      // DB also enforces a partial unique index on rated ticket ID.
      ratedTickets.add(row.ticket_id)
      const label = row.satisfaction_label
      globalReviews[label]++
      analyst.reviews[label]++
      addReview(reviewsByDay, row.occurred_date, label)
      addReview(analyst.reviewsByDay, row.occurred_date, label)
    }
    if (row.verified_at && Number.isFinite(Date.parse(row.verified_at))
      && (!lastVerifiedAt || Date.parse(row.verified_at) > Date.parse(lastVerifiedAt))) {
      lastVerifiedAt = row.verified_at
    }
  }

  const daily = [...byDay]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }))

  return {
    source: 'clickdesk_public_agent_message' as const,
    evaluation_source: 'clickdesk_ticket_rating_last_public_human' as const,
    total: seenContributions.size,
    today: { date: today, count: byDay.get(today) ?? 0 },
    daily,
    evaluations: reviewStats(globalReviews, seenContributions.size),
    // Include dates without ANY evaluation, to distinguish valid unrated work
    // from an absent capture day. Those days have CSAT=null, review rate=0%.
    ratings_daily: daily.map(({ date, count }) => ({
      date, ...reviewStats(reviewsByDay.get(date) ?? emptyReviews(), count),
    })),
    by_analyst: [...analysts.values()].map(({ days, reviews, reviewsByDay: ratedDays, ...analyst }) => ({
      ...analyst,
      evaluations: reviewStats(reviews, analyst.total),
      daily: [...days]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, count]) => ({ date, count })),
      ratings_daily: [...days]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, count]) => ({
          date,
          ...reviewStats(ratedDays.get(date) ?? emptyReviews(), count),
        })),
      today: days.get(today) ?? 0,
    })).sort((a, b) =>
      b.total - a.total || a.analyst_name.localeCompare(b.analyst_name, 'pt-BR')),
    last_verified_at: lastVerifiedAt,
    has_records: daily.length > 0,
    coverage_status: 'partial_until_queue_finished' as const,
  }
}
