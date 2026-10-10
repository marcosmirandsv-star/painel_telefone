/**
 * Official resolved-ticket productivity, independent of ticket origin.
 * This is NOT an attendance or CSAT calculation. It never merges counts
 * into the persisted attendance source or the podium.
 */
export type OfficialResolutionRow = {
  resolved_date: string
  analyst_id: string
  team_id: string
  assignee_name: string
  area: string
  resolved_count: number
  source: string
  updated_at: string | null
}

export type ResolutionDay = { date: string; resolved: number }
export type OfficialResolutionSummary = {
  source: 'clickdesk_support_reports_agents'
  total: number
  today: ResolutionDay
  daily: ResolutionDay[]
  by_analyst: Array<{
    analyst_id: string
    team_id: string
    assignee_name: string
    total: number
    today: number
    daily: ResolutionDay[]
  }>
  last_updated_at: string | null
  has_records: boolean
}

export function isExcludedApprentice(name: string): boolean {
  const normalized = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR').trim().replace(/\s+/g, ' ')
  return /^(ana julia|david)(\s|$)/.test(normalized)
}

export function summarizeOfficialResolutions(
  rows: OfficialResolutionRow[],
  today: string,
): OfficialResolutionSummary {
  const byDay = new Map<string, number>()
  const byAnalyst = new Map<string, {
    analyst_id: string
    team_id: string
    assignee_name: string
    total: number
    today: number
    days: Map<string, number>
  }>()
  let latest: string | null = null
  for (const row of rows) {
    if (row.source !== 'clickdesk_support_reports_agents' ||
        isExcludedApprentice(row.assignee_name) ||
        !/^20\d{2}-\d{2}-\d{2}$/.test(row.resolved_date) ||
        !row.analyst_id || !row.team_id ||
        !Number.isSafeInteger(row.resolved_count) || row.resolved_count < 0) continue

    const key = row.analyst_id
    const entry = byAnalyst.get(key) ?? {
      analyst_id: key,
      team_id: row.team_id,
      assignee_name: row.assignee_name,
      total: 0,
      today: 0,
      days: new Map<string, number>(),
    }
    // Prevent silently grouping the same analyst into a different team.
    if (entry.team_id !== row.team_id) continue
    entry.total += row.resolved_count
    if (row.resolved_date === today) entry.today += row.resolved_count
    entry.days.set(row.resolved_date, (entry.days.get(row.resolved_date) ?? 0) + row.resolved_count)
    byAnalyst.set(key, entry)
    byDay.set(row.resolved_date, (byDay.get(row.resolved_date) ?? 0) + row.resolved_count)
    if (row.updated_at && Number.isFinite(Date.parse(row.updated_at)) &&
        (!latest || Date.parse(row.updated_at) > Date.parse(latest))) latest = row.updated_at
  }
  const daily = [...byDay].sort(([a], [b]) => a.localeCompare(b))
    .map(([date, resolved]) => ({ date, resolved }))
  const analysts = [...byAnalyst.values()].map(({ days, ...item }) => ({
    ...item,
    daily: [...days].sort(([a], [b]) => a.localeCompare(b))
      .map(([date, resolved]) => ({ date, resolved })),
  })).sort((a, b) => b.total - a.total || a.assignee_name.localeCompare(b.assignee_name, 'pt-BR'))

  return {
    source: 'clickdesk_support_reports_agents',
    total: daily.reduce((sum, day) => sum + day.resolved, 0),
    today: { date: today, resolved: byDay.get(today) ?? 0 },
    daily,
    by_analyst: analysts,
    last_updated_at: latest,
    has_records: daily.length > 0,
  }
}
