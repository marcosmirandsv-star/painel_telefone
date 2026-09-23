import { ApiError, authorizeManagerSessionClient, handle, json } from '@/lib/integration-server'
import { getServerSupabaseConfig } from '@/lib/runtime-environment'

export const runtime = 'nodejs'

const BUSINESS_TIME_ZONE = 'America/Sao_Paulo'

type DailyMetricRow = {
  occurred_date: string
  team_id: string | null
  analyst_id: string | null
  area: string
  assignee_name: string
  attendances: number
  positive_reviews: number
  negative_reviews: number
  reviews: number
  csat: number | null
  review_percentage: number | null
}

type Aggregate = {
  attendances: number
  positive_reviews: number
  negative_reviews: number
  reviews: number
  csat: number | null
  review_percentage: number | null
}

function businessDate(timestamp: string) {
  const date = new Date(timestamp)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function validDate(value: string) {
  return (
    /^20\d{2}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  )
}

function validUuid(value: string) {
  return /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)
}

function inclusiveDays(start: string, end: string) {
  return Math.round(
    (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000,
  ) + 1
}

function parseFilters(request: Request) {
  const params = new URL(request.url).searchParams
  const allowed = new Set(['start', 'end', 'analyst_id', 'team_id'])

  for (const key of params.keys()) {
    if (!allowed.has(key) || params.getAll(key).length !== 1) {
      throw new ApiError(400, 'Parâmetro desconhecido ou repetido.')
    }
  }

  const today = businessDate(new Date().toISOString())
  const defaultStart = `${today.slice(0, 8)}01`
  const start = params.get('start') || defaultStart
  const requestedEnd = params.get('end') || today
  const end = requestedEnd > today ? today : requestedEnd
  const analystId = params.get('analyst_id')
  const teamId = params.get('team_id')

  if (!validDate(start) || !validDate(end) || start > end || inclusiveDays(start, end) > 93) {
    throw new ApiError(400, 'Período inválido. Use até 93 dias no formato AAAA-MM-DD.')
  }

  if (analystId && !validUuid(analystId)) {
    throw new ApiError(400, 'analyst_id inválido.')
  }

  if (teamId && !validUuid(teamId)) {
    throw new ApiError(400, 'team_id inválido.')
  }

  return { start, end, analystId, teamId, today }
}

async function loadRows(
  admin: Awaited<ReturnType<typeof authorizeManagerSessionClient>>['admin'],
  filters: ReturnType<typeof parseFilters>,
) {
  const result: DailyMetricRow[] = []

  for (let offset = 0; offset < 10000; offset += 500) {
    let query = admin
      .from('clickdesk_chat_daily_metrics')
      .select(
        'occurred_date,team_id,analyst_id,area,assignee_name,attendances,positive_reviews,negative_reviews,reviews,csat,review_percentage',
      )
      .gte('occurred_date', filters.start)
      .lte('occurred_date', filters.end)
      .order('occurred_date', { ascending: true })
      .range(offset, offset + 499)

    if (filters.analystId) query = query.eq('analyst_id', filters.analystId)
    if (filters.teamId) query = query.eq('team_id', filters.teamId)

    const { data, error } = await query
    if (error) throw new ApiError(503, `Base ClickDesk indisponível: ${error.message}`)

    result.push(...((data ?? []) as DailyMetricRow[]))
    if ((data ?? []).length < 500) return result
  }

  throw new ApiError(422, 'O volume de métricas excedeu o limite de consulta.')
}

function aggregate(rows: DailyMetricRow[]): Aggregate {
  const totals = rows.reduce(
    (acc, row) => {
      acc.attendances += Number(row.attendances) || 0
      acc.positive_reviews += Number(row.positive_reviews) || 0
      acc.negative_reviews += Number(row.negative_reviews) || 0
      acc.reviews += Number(row.reviews) || 0
      return acc
    },
    { attendances: 0, positive_reviews: 0, negative_reviews: 0, reviews: 0 },
  )

  return {
    ...totals,
    csat:
      totals.reviews > 0
        ? Math.round((totals.positive_reviews / totals.reviews) * 10000) / 100
        : null,
    review_percentage:
      totals.attendances > 0
        ? Math.round((totals.reviews / totals.attendances) * 10000) / 100
        : null,
  }
}

function groupDaily(rows: DailyMetricRow[]) {
  const grouped = new Map<string, DailyMetricRow[]>()
  rows.forEach((row) => {
    const current = grouped.get(row.occurred_date) ?? []
    current.push(row)
    grouped.set(row.occurred_date, current)
  })

  return [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, dayRows]) => ({
      date,
      ...aggregate(dayRows),
    }))
}

function groupAnalysts(rows: DailyMetricRow[], today: string) {
  const grouped = new Map<
    string,
    {
      analyst_id: string | null
      assignee_name: string
      area: string
      team_id: string | null
      rows: DailyMetricRow[]
    }
  >()

  rows.forEach((row) => {
    const key = row.analyst_id ?? `unmatched::${row.area}::${row.assignee_name}`
    const current = grouped.get(key) ?? {
      analyst_id: row.analyst_id,
      assignee_name: row.assignee_name,
      area: row.area,
      team_id: row.team_id,
      rows: [],
    }
    current.rows.push(row)
    grouped.set(key, current)
  })

  return [...grouped.values()]
    .map((item) => ({
      analyst_id: item.analyst_id,
      assignee_name: item.assignee_name,
      area: item.area,
      team_id: item.team_id,
      ...aggregate(item.rows),
      today: aggregate(item.rows.filter((row) => row.occurred_date === today)),
      daily: groupDaily(item.rows),
    }))
    .sort(
      (a, b) =>
        b.attendances - a.attendances ||
        a.assignee_name.localeCompare(b.assignee_name, 'pt-BR'),
    )
}

export async function GET(request: Request) {
  return handle(async () => {
    const { environment } = getServerSupabaseConfig()
    if (environment !== 'homologacao') {
      throw new ApiError(404, 'Métricas ClickDesk disponíveis somente na homologação.')
    }

    const { admin } = await authorizeManagerSessionClient(request)
    const filters = parseFilters(request)
    const rows = await loadRows(admin, filters)

    const latestSync = await admin
      .from('clickdesk_chat_sync_runs')
      .select(
        'id,status,period_start,period_end,trigger_mode,pages_scanned,rows_upserted,matched_rows,unmatched_rows,finished_at',
      )
      .eq('status', 'completed')
      .lte('period_start', filters.end)
      .gte('period_end', filters.start)
      .order('finished_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (latestSync.error) {
      throw new ApiError(503, 'Não foi possível consultar o status da sincronização.')
    }

    const todayRows = rows.filter((row) => row.occurred_date === filters.today)
    const unmatchedRows = rows.filter((row) => !row.analyst_id)

    return json({
      source: 'clickdesk_persisted',
      period: {
        start: filters.start,
        end: filters.end,
        business_time_zone: BUSINESS_TIME_ZONE,
      },
      today: {
        date: filters.today,
        included_in_period:
          filters.today >= filters.start && filters.today <= filters.end,
        ...aggregate(todayRows),
      },
      accumulated: aggregate(rows),
      daily: groupDaily(rows),
      by_analyst: groupAnalysts(rows, filters.today),
      data_quality: {
        grouped_rows: rows.length,
        unmatched_grouped_rows: unmatchedRows.length,
        unmatched_attendances: aggregate(unmatchedRows).attendances,
      },
      latest_sync: latestSync.data ?? null,
    })
  })
}
