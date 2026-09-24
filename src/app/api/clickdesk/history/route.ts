import {
  ApiError,
  authorizeManagerSessionClient,
  handle,
  json,
} from '@/lib/integration-server'
import { getServerSupabaseConfig } from '@/lib/runtime-environment'

export const runtime = 'nodejs'

type ClosureAnalyst = {
  analyst_id?: string
  name?: string
  team_id?: string | null
  team_name?: string | null
  csat_goal?: number | null
  review_goal?: number | null
  attendances?: number
  positive_reviews?: number
  negative_reviews?: number
  reviews?: number
  csat?: number | null
  review_percentage?: number | null
}

type ClosurePayload = {
  fonte?: string
  regras?: string
  mes?: string
  analistas?: ClosureAnalyst[]
}

type HistoryPoint = {
  month: string
  label: string
  source: 'official' | 'live'
  status: 'closed' | 'open'
  closure_id: string | null
  closed_at: string | null
  team_id: string | null
  team_name: string | null
  csat_goal: number | null
  review_goal: number
  attendances: number
  positive_reviews: number
  negative_reviews: number
  reviews: number
  csat: number | null
  review_percentage: number | null
}

type AttendanceRow = {
  satisfaction_label: string | null
}

function round(value: number) {
  return Math.round(value * 100) / 100
}

function aggregate(rows: AttendanceRow[]) {
  const positive = rows.filter(
    (row) => String(row.satisfaction_label ?? '').toLowerCase() === 'positive',
  ).length
  const negative = rows.filter(
    (row) => String(row.satisfaction_label ?? '').toLowerCase() === 'negative',
  ).length
  const reviews = positive + negative
  const attendances = rows.length

  return {
    attendances,
    positive_reviews: positive,
    negative_reviews: negative,
    reviews,
    csat: reviews > 0 ? round((positive / reviews) * 100) : null,
    review_percentage:
      attendances > 0 ? round((reviews / attendances) * 100) : null,
  }
}

function businessToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function monthBounds(month: string) {
  const [yearText, monthText] = month.split('-')
  const year = Number(yearText)
  const monthNumber = Number(monthText)

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(monthNumber) ||
    monthNumber < 1 ||
    monthNumber > 12
  ) {
    throw new ApiError(500, 'Competência inválida no histórico.')
  }

  const start = `${year}-${String(monthNumber).padStart(2, '0')}-01`
  const end = new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10)
  return { start, end }
}

function monthLabel(month: string) {
  const [yearText, monthText] = month.split('-')
  const date = new Date(Date.UTC(Number(yearText), Number(monthText) - 1, 1))
  const label = new Intl.DateTimeFormat('pt-BR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
  return label.charAt(0).toUpperCase() + label.slice(1)
}

function numericOrNull(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

export async function GET(request: Request) {
  return handle(async () => {
    const { environment } = getServerSupabaseConfig()
    if (environment !== 'homologacao') {
      throw new ApiError(404, 'Histórico ClickDesk disponível somente na homologação.')
    }

    const { admin } = await authorizeManagerSessionClient(request)
    const url = new URL(request.url)
    const analystId = url.searchParams.get('analyst_id')?.trim()

    if (!analystId) {
      throw new ApiError(400, 'Informe analyst_id para consultar o histórico.')
    }

    const [analystResult, closuresResult] = await Promise.all([
      admin
        .from('chat_analysts')
        .select('id,name,team_id,csat_goal,active')
        .eq('id', analystId)
        .maybeSingle(),
      admin
        .from('integration_closures')
        .select('id,month,team,created_at,payload')
        .eq('channel', 'chat')
        .order('month', { ascending: true }),
    ])

    if (analystResult.error) {
      throw new ApiError(503, 'Cadastro do analista indisponível.')
    }
    if (!analystResult.data) {
      throw new ApiError(404, 'Analista não encontrado.')
    }
    if (closuresResult.error) {
      throw new ApiError(503, 'Fechamentos oficiais indisponíveis.')
    }

    const officialByMonth = new Map<
      string,
      {
        priority: number
        point: HistoryPoint
      }
    >()

    for (const closure of closuresResult.data ?? []) {
      const payload = closure.payload as ClosurePayload | null
      if (
        !payload ||
        payload.fonte !== 'clickdesk_persisted' ||
        payload.regras !== 'clickdesk-human-v1'
      ) {
        continue
      }

      const analyst = (payload.analistas ?? []).find(
        (item) => item.analyst_id === analystId,
      )
      if (!analyst) continue

      const month = closure.month
      const priority = closure.team === 'all' ? 2 : 1
      const current = officialByMonth.get(month)
      if (current && current.priority >= priority) continue

      officialByMonth.set(month, {
        priority,
        point: {
          month,
          label: monthLabel(month),
          source: 'official',
          status: 'closed',
          closure_id: closure.id,
          closed_at: closure.created_at,
          team_id: analyst.team_id ?? null,
          team_name: analyst.team_name ?? null,
          csat_goal: numericOrNull(analyst.csat_goal),
          review_goal: numericOrNull(analyst.review_goal) ?? 25,
          attendances: Number(analyst.attendances ?? 0),
          positive_reviews: Number(analyst.positive_reviews ?? 0),
          negative_reviews: Number(analyst.negative_reviews ?? 0),
          reviews: Number(analyst.reviews ?? 0),
          csat: numericOrNull(analyst.csat),
          review_percentage: numericOrNull(analyst.review_percentage),
        },
      })
    }

    const today = businessToday()
    const currentMonth = today.slice(0, 7)

    if (!officialByMonth.has(currentMonth)) {
      const { start } = monthBounds(currentMonth)
      const [liveRowsResult, teamResult] = await Promise.all([
        admin
          .from('clickdesk_chat_attendances')
          .select('satisfaction_label')
          .eq('analyst_id', analystId)
          .eq('identity_role', 'analyst')
          .gte('occurred_date', start)
          .lte('occurred_date', today),
        admin
          .from('chat_teams')
          .select('id,name')
          .eq('id', analystResult.data.team_id)
          .maybeSingle(),
      ])

      if (liveRowsResult.error) {
        throw new ApiError(503, 'Base viva do ClickDesk indisponível.')
      }
      if (teamResult.error) {
        throw new ApiError(503, 'Equipe do analista indisponível.')
      }

      const totals = aggregate((liveRowsResult.data ?? []) as AttendanceRow[])

      officialByMonth.set(currentMonth, {
        priority: 3,
        point: {
          month: currentMonth,
          label: monthLabel(currentMonth),
          source: 'live',
          status: 'open',
          closure_id: null,
          closed_at: null,
          team_id: analystResult.data.team_id,
          team_name: teamResult.data?.name ?? null,
          csat_goal: numericOrNull(analystResult.data.csat_goal),
          review_goal: 25,
          ...totals,
        },
      })
    }

    const points = [...officialByMonth.values()]
      .map((item) => item.point)
      .sort((a, b) => String(a.month).localeCompare(String(b.month)))

    const withDeltas = points.map((point, index) => {
      const previous = index > 0 ? points[index - 1] : null
      const currentCsat = numericOrNull(point.csat)
      const previousCsat = previous ? numericOrNull(previous.csat) : null
      const currentReview = numericOrNull(point.review_percentage)
      const previousReview = previous ? numericOrNull(previous.review_percentage) : null
      const currentAttendances = Number(point.attendances ?? 0)
      const previousAttendances = previous ? Number(previous.attendances ?? 0) : null

      return {
        ...point,
        delta: {
          csat_pp:
            currentCsat !== null && previousCsat !== null
              ? round(currentCsat - previousCsat)
              : null,
          review_percentage_pp:
            currentReview !== null && previousReview !== null
              ? round(currentReview - previousReview)
              : null,
          attendances:
            previousAttendances !== null
              ? currentAttendances - previousAttendances
              : null,
        },
      }
    })

    return json({
      source: 'clickdesk_history',
      analyst: {
        id: analystResult.data.id,
        name: analystResult.data.name,
        current_team_id: analystResult.data.team_id,
        active: analystResult.data.active,
      },
      current_month: currentMonth,
      points: withDeltas,
      official_months: withDeltas.filter((item) => item.source === 'official').length,
      live_month_included: withDeltas.some((item) => item.source === 'live'),
    })
  })
}
