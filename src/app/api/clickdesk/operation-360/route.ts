import {
  ApiError,
  authorizeClickDeskSessionClient,
  handle,
  json,
} from '@/lib/integration-server'
import { getServerSupabaseConfig } from '@/lib/runtime-environment'
import {
  normalizeQualitativeAnalysis,
  qualitativeAnalysisVersion,
  QUALITATIVE_ANALYSIS_VERSION,
} from '@/lib/clickdesk-qualitative'
import {
  buildOperation360Analysis,
  buildOperation360Synthesis,
  calculateOperation360Totals,
  operation360Percentage,
  type Operation360AnalysisRow,
} from '@/lib/chat-operation-360'

export const runtime = 'nodejs'

type AttendanceRow = {
  clickdesk_ticket_id: string
  analyst_id: string | null
  assignee_name: string
  team_id: string | null
  area: string
  satisfaction_label: string | null
  occurred_date: string
  occurred_at: string
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
  return (
    Math.round(
      (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) /
        86400000,
    ) + 1
  )
}

function parseFilters(request: Request) {
  const params = new URL(request.url).searchParams
  const allowed = new Set(['start', 'end', 'team_id'])

  for (const key of params.keys()) {
    if (!allowed.has(key) || params.getAll(key).length !== 1) {
      throw new ApiError(400, 'Parâmetro desconhecido ou repetido.')
    }
  }

  const start = params.get('start')?.trim() ?? ''
  const end = params.get('end')?.trim() ?? ''
  const teamId = params.get('team_id')?.trim() || null

  if (!validDate(start) || !validDate(end) || start > end || inclusiveDays(start, end) > 93) {
    throw new ApiError(400, 'Período inválido. Use até 93 dias no formato AAAA-MM-DD.')
  }

  if (teamId && !validUuid(teamId)) {
    throw new ApiError(400, 'team_id inválido.')
  }

  return { start, end, teamId }
}

async function loadAttendances(
  admin: Awaited<ReturnType<typeof authorizeClickDeskSessionClient>>['admin'],
  filters: ReturnType<typeof parseFilters>,
) {
  const rows: AttendanceRow[] = []

  for (let offset = 0; offset < 10000; offset += 500) {
    let query = admin
      .from('clickdesk_chat_attendances')
      .select(
        'clickdesk_ticket_id,analyst_id,assignee_name,team_id,area,satisfaction_label,occurred_date,occurred_at',
      )
      .eq('identity_role', 'analyst')
      .gte('occurred_date', filters.start)
      .lte('occurred_date', filters.end)
      .order('occurred_at', { ascending: true })
      .range(offset, offset + 499)

    if (filters.teamId) query = query.eq('team_id', filters.teamId)

    const result = await query
    if (result.error) {
      throw new ApiError(503, 'Não foi possível carregar os atendimentos da operação.')
    }

    rows.push(...((result.data ?? []) as AttendanceRow[]))
    if ((result.data ?? []).length < 500) return rows
  }

  throw new ApiError(422, 'O volume da operação excedeu o limite de 10.000 atendimentos.')
}

async function loadAnalyses(
  admin: Awaited<ReturnType<typeof authorizeClickDeskSessionClient>>['admin'],
  filters: ReturnType<typeof parseFilters>,
) {
  const rows: Operation360AnalysisRow[] = []

  for (let offset = 0; offset < 10000; offset += 500) {
    const result = await admin
      .from('clickdesk_qualitative_analyses')
      .select('clickdesk_ticket_id,satisfaction_label,validation_status,analysis')
      .gte('occurred_date', filters.start)
      .lte('occurred_date', filters.end)
      .order('updated_at', { ascending: false })
      .range(offset, offset + 499)

    if (result.error) {
      throw new ApiError(503, 'Não foi possível carregar as análises qualitativas preservadas.')
    }

    rows.push(...((result.data ?? []) as Operation360AnalysisRow[]))
    if ((result.data ?? []).length < 500) return rows
  }

  throw new ApiError(422, 'O volume de análises qualitativas excedeu o limite de consulta.')
}

export async function GET(request: Request) {
  return handle(async () => {
    const { environment } = getServerSupabaseConfig()
    if (environment !== 'homologacao') {
      throw new ApiError(404, 'Análise 360º disponível somente na homologação.')
    }

    const access = await authorizeClickDeskSessionClient(request)
    if (!access.isManagement) {
      throw new ApiError(403, 'Análise 360º disponível somente para a gestão.')
    }

    const filters = parseFilters(request)
    const attendances = await loadAttendances(access.admin, filters)
    const attendanceIds = new Set(attendances.map((row) => row.clickdesk_ticket_id))
    const analyses = (await loadAnalyses(access.admin, filters)).filter((row) =>
      attendanceIds.has(row.clickdesk_ticket_id),
    )
    const normalizedAnalyses = analyses.map((row) => ({
      ...row,
      analysis: normalizeQualitativeAnalysis(row.analysis),
    }))

    const totals = calculateOperation360Totals(attendances)
    const currentAnalyses = analyses.filter(
      (row) =>
        qualitativeAnalysisVersion(row.analysis) >= QUALITATIVE_ANALYSIS_VERSION,
    )

    const analyzedIds = new Set(
      currentAnalyses
        .filter((row) => row.validation_status !== 'rejected')
        .map((row) => row.clickdesk_ticket_id),
    )

    const approvedIds = new Set(
      currentAnalyses
        .filter((row) => row.validation_status === 'approved')
        .map((row) => row.clickdesk_ticket_id),
    )

    const negativeRows = attendances.filter((row) => row.satisfaction_label === 'negative')
    const positiveRows = attendances.filter((row) => row.satisfaction_label === 'positive')
    const unanalyzedNegative = negativeRows.filter((row) => !analyzedIds.has(row.clickdesk_ticket_id))
    const unanalyzedPositive = positiveRows.filter((row) => !analyzedIds.has(row.clickdesk_ticket_id))

    const serializeQueue = (row: AttendanceRow) => ({
      ticket_id: row.clickdesk_ticket_id,
      analyst_id: row.analyst_id,
      analyst_name: row.assignee_name,
      area: row.area,
      occurred_date: row.occurred_date,
      occurred_at: row.occurred_at,
      satisfaction_label: row.satisfaction_label,
    })

    const approvedNegative = negativeRows.filter((row) => approvedIds.has(row.clickdesk_ticket_id)).length
    const approvedPositive = positiveRows.filter((row) => approvedIds.has(row.clickdesk_ticket_id)).length
    const analyzedNegative = negativeRows.filter((row) => analyzedIds.has(row.clickdesk_ticket_id)).length
    const analyzedPositive = positiveRows.filter((row) => analyzedIds.has(row.clickdesk_ticket_id)).length

    const normalizedCurrentAnalyses = currentAnalyses.map((row) => ({
      ...row,
      analysis: normalizeQualitativeAnalysis(row.analysis),
    }))
    const preliminaryPatterns = buildOperation360Analysis(normalizedCurrentAnalyses, 'analyzed')
    const validatedPatterns = buildOperation360Analysis(normalizedCurrentAnalyses, 'approved')
    const preliminarySynthesis = buildOperation360Synthesis({
      negativeTotal: totals.negative,
      positiveTotal: totals.positive,
      analysis: preliminaryPatterns,
    })
    const validatedSynthesis = buildOperation360Synthesis({
      negativeTotal: totals.negative,
      positiveTotal: totals.positive,
      analysis: validatedPatterns,
    })

    return json({
      source: 'clickdesk_operation_360',
      period: { start: filters.start, end: filters.end },
      scope: { team_id: filters.teamId },
      totals,
      coverage: {
        analyzed: analyzedIds.size,
        approved: approvedIds.size,
        analyzed_percentage: operation360Percentage(analyzedIds.size, totals.evaluated),
        approved_percentage: operation360Percentage(approvedIds.size, totals.evaluated),
        negative: {
          analyzed: analyzedNegative,
          approved: approvedNegative,
          total: totals.negative,
          analyzed_percentage: operation360Percentage(analyzedNegative, totals.negative),
          approved_percentage: operation360Percentage(approvedNegative, totals.negative),
        },
        positive: {
          analyzed: analyzedPositive,
          approved: approvedPositive,
          total: totals.positive,
          analyzed_percentage: operation360Percentage(analyzedPositive, totals.positive),
          approved_percentage: operation360Percentage(approvedPositive, totals.positive),
        },
      },
      preliminary_patterns: preliminaryPatterns,
      preliminary_synthesis: preliminarySynthesis,
      validated_patterns: validatedPatterns,
      validated_synthesis: validatedSynthesis,
      analysis_status: {
        pending: currentAnalyses.filter((row) => row.validation_status === 'pending').length,
        approved: currentAnalyses.filter((row) => row.validation_status === 'approved').length,
        rejected: currentAnalyses.filter((row) => row.validation_status === 'rejected').length,
        stale: analyses.length - currentAnalyses.length,
      },
      queues: {
        negative_unanalyzed: unanalyzedNegative.map(serializeQueue),
        positive_unanalyzed: unanalyzedPositive.map(serializeQueue),
      },
      interpretation_rule: {
        message:
          'O diagnóstico 360º usa somente análises na versão qualitativa atual. Aprovadas e pendentes atuais são reaproveitadas; rejeitadas e análises de versões antigas voltam para reanálise; tickets sem leitura entram na fila até completar o universo do filtro.',
        causality:
          'Recorrência não prova causalidade. A leitura deve ser apresentada como padrão observado, com confiança e evidências rastreáveis. A governança de aprovação/rejeição permanece no menu próprio.',
      },
    })
  })
}
