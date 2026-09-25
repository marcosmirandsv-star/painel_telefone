import {
  ApiError,
  authorizeClickDeskSessionClient,
  handle,
  json,
} from '@/lib/integration-server'
import { getServerSupabaseConfig } from '@/lib/runtime-environment'
import { normalizeQualitativeAnalysis } from '@/lib/clickdesk-qualitative'

export const runtime = 'nodejs'

type AttendanceRow = {
  clickdesk_ticket_id: string
  analyst_id: string | null
  assignee_name: string
  satisfaction_label: string | null
  occurred_date: string
  occurred_at: string
  area: string
}

type AnalysisRow = {
  clickdesk_ticket_id: string
  analyst_id: string
  satisfaction_label: string | null
  analysis: unknown
  updated_at: string
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

function countValues(items: string[]) {
  const counts: Record<string, number> = {}

  for (const item of items) {
    counts[item] = (counts[item] ?? 0) + 1
  }

  return Object.keys(counts)
    .map((key) => ({ key, count: counts[key] }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
}

function percentage(part: number, total: number) {
  return total > 0 ? Math.round((part / total) * 10000) / 100 : 0
}

export async function GET(request: Request) {
  return handle(async () => {
    const { environment } = getServerSupabaseConfig()
    if (environment !== 'homologacao') {
      throw new ApiError(404, 'Resumo qualitativo disponível somente na homologação.')
    }

    const access = await authorizeClickDeskSessionClient(request)
    if (!access.isManagement) {
      throw new ApiError(403, 'Resumo qualitativo disponível somente para a gestão.')
    }

    const params = new URL(request.url).searchParams
    const allowed = new Set(['start', 'end', 'team_id', 'analyst_id'])

    for (const key of params.keys()) {
      if (!allowed.has(key) || params.getAll(key).length !== 1) {
        throw new ApiError(400, 'Parâmetro desconhecido ou repetido.')
      }
    }

    const start = params.get('start')?.trim() ?? ''
    const end = params.get('end')?.trim() ?? ''
    const teamId = params.get('team_id')?.trim() || null
    const analystId = params.get('analyst_id')?.trim() || null

    if (!validDate(start) || !validDate(end) || start > end) {
      throw new ApiError(400, 'Informe start e end válidos no formato AAAA-MM-DD.')
    }
    if (teamId && !validUuid(teamId)) throw new ApiError(400, 'team_id inválido.')
    if (analystId && !validUuid(analystId)) throw new ApiError(400, 'analyst_id inválido.')

    let attendanceQuery = access.admin
      .from('clickdesk_chat_attendances')
      .select('clickdesk_ticket_id,analyst_id,assignee_name,satisfaction_label,occurred_date,occurred_at,area')
      .eq('identity_role', 'analyst')
      .gte('occurred_date', start)
      .lte('occurred_date', end)
      .in('satisfaction_label', ['positive', 'negative'])
      .order('occurred_at', { ascending: false })

    if (teamId) attendanceQuery = attendanceQuery.eq('team_id', teamId)
    if (analystId) attendanceQuery = attendanceQuery.eq('analyst_id', analystId)

    const attendanceResult = await attendanceQuery
    if (attendanceResult.error) {
      throw new ApiError(503, 'Não foi possível calcular a cobertura das avaliações.')
    }

    const evaluated = (attendanceResult.data ?? []) as AttendanceRow[]
    const evaluatedTicketIds = new Set(evaluated.map((item) => item.clickdesk_ticket_id))
    const analystNames = new Map<string, string>()

    for (const item of evaluated) {
      if (item.analyst_id && !analystNames.has(item.analyst_id)) {
        analystNames.set(item.analyst_id, item.assignee_name)
      }
    }

    let analysisQuery = access.admin
      .from('clickdesk_qualitative_analyses')
      .select('clickdesk_ticket_id,analyst_id,satisfaction_label,analysis,updated_at')
      .gte('occurred_date', start)
      .lte('occurred_date', end)
      .order('updated_at', { ascending: false })

    if (analystId) analysisQuery = analysisQuery.eq('analyst_id', analystId)

    const analysisResult = await analysisQuery
    if (analysisResult.error) {
      throw new ApiError(503, 'Não foi possível carregar as análises qualitativas preservadas.')
    }

    const allAnalyses = (analysisResult.data ?? []) as AnalysisRow[]
    const analyses =
      teamId || analystId
        ? allAnalyses.filter((item) => evaluatedTicketIds.has(item.clickdesk_ticket_id))
        : allAnalyses

    const evaluatedPositive = evaluated.filter((item) => item.satisfaction_label === 'positive').length
    const evaluatedNegative = evaluated.filter((item) => item.satisfaction_label === 'negative').length
    const analyzedPositive = analyses.filter((item) => item.satisfaction_label === 'positive').length
    const analyzedNegative = analyses.filter((item) => item.satisfaction_label === 'negative').length

    const normalized = analyses.map((item) => ({
      ...item,
      normalized: normalizeQualitativeAnalysis(item.analysis),
    }))

    const analystAggregation = new Map<
      string,
      {
        analyst_id: string
        analyst_name: string
        analyzed: number
        positive: number
        negative: number
        coaching_signals: number
        causes: string[]
      }
    >()

    for (const item of normalized) {
      const current = analystAggregation.get(item.analyst_id) ?? {
        analyst_id: item.analyst_id,
        analyst_name: analystNames.get(item.analyst_id) ?? 'Analista',
        analyzed: 0,
        positive: 0,
        negative: 0,
        coaching_signals: 0,
        causes: [],
      }

      current.analyzed += 1
      if (item.satisfaction_label === 'positive') current.positive += 1
      if (item.satisfaction_label === 'negative') current.negative += 1
      if (item.normalized.coaching_signal.available) current.coaching_signals += 1
      current.causes.push(item.normalized.primary_cause.category)
      analystAggregation.set(item.analyst_id, current)
    }

    const analysts = Array.from(analystAggregation.values())
      .map((item) => ({
        analyst_id: item.analyst_id,
        analyst_name: item.analyst_name,
        analyzed: item.analyzed,
        positive: item.positive,
        negative: item.negative,
        coaching_signals: item.coaching_signals,
        top_causes: countValues(item.causes).slice(0, 3),
      }))
      .sort((a, b) => b.analyzed - a.analyzed || a.analyst_name.localeCompare(b.analyst_name))

    const analyzedTicketIds = new Set(analyses.map((item) => item.clickdesk_ticket_id))
    const validationQueue = evaluated
      .filter(
        (item) =>
          item.satisfaction_label === 'negative' &&
          !analyzedTicketIds.has(item.clickdesk_ticket_id),
      )
      .slice(0, 5)
      .map((item) => ({
        ticket_id: item.clickdesk_ticket_id,
        analyst_id: item.analyst_id,
        analyst_name: item.assignee_name,
        occurred_date: item.occurred_date,
        occurred_at: item.occurred_at,
        area: item.area,
        satisfaction_label: item.satisfaction_label,
      }))

    return json({
      source: 'clickdesk_qualitative_cache',
      period: { start, end },
      scope: { team_id: teamId, analyst_id: analystId },
      totals: {
        evaluated: evaluated.length,
        positive: evaluatedPositive,
        negative: evaluatedNegative,
        analyzed: analyses.length,
        analyzed_positive: analyzedPositive,
        analyzed_negative: analyzedNegative,
      },
      coverage: {
        evaluated_percentage: percentage(analyses.length, evaluated.length),
        positive_percentage: percentage(analyzedPositive, evaluatedPositive),
        negative_percentage: percentage(analyzedNegative, evaluatedNegative),
      },
      causes: countValues(
        normalized.map((item) => item.normalized.primary_cause.category),
      ),
      human_influence: countValues(
        normalized.map((item) => item.normalized.human_influence.classification),
      ),
      controllability: countValues(
        normalized.map((item) => item.normalized.controllability.classification),
      ),
      sentiment_change: countValues(
        normalized.map(
          (item) =>
            `${item.normalized.initial_sentiment}->${item.normalized.final_sentiment}`,
        ),
      ),
      coaching_signals: normalized.filter(
        (item) => item.normalized.coaching_signal.available,
      ).length,
      analysts,
      validation_queue: validationQueue,
    })
  })
}
