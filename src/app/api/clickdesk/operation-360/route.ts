import {
  ApiError,
  authorizeClickDeskSessionClient,
  handle,
  json,
} from '@/lib/integration-server'
import { getServerSupabaseConfig } from '@/lib/runtime-environment'
import { readFinalLedger, readLedgerCoverage } from '@/lib/clickdesk-ledger-server'
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
  // Fonte única com Equipe e produtividade: um ticket, último autor humano confirmado.
  const [ledger, analystsResult] = await Promise.all([
    readFinalLedger(admin, { start: filters.start, end: filters.end, teamId: filters.teamId }),
    admin.from('chat_analysts').select('id,name,active'),
  ])
  if (analystsResult.error) {
    throw new ApiError(503, 'Cadastro dos analistas indisponível para o 360º.')
  }
  const names = new Map((analystsResult.data ?? []).map(item => [item.id, item.name]))
  // O retrato operacional considera somente os analistas ativos.
  // Tickets de ex-integrantes permanecem preservados no banco para auditoria.
  const activeIds = new Set((analystsResult.data ?? []).filter(item => item.active).map(item => item.id))
  return ledger.filter(row => activeIds.has(row.analyst_id)).map(row => {
    const name = names.get(row.analyst_id)
    if (!name) throw new ApiError(503, 'Titular verificado ausente do cadastro.')
    return {
      clickdesk_ticket_id: row.ticket_id,
      analyst_id: row.analyst_id,
      assignee_name: name,
      team_id: row.team_id,
      area: row.area ?? 'Fila histórica não comprovada',
      satisfaction_label: row.satisfaction_label,
      occurred_date: row.occurred_date,
      occurred_at: row.last_public_at,
    }
  })
}

async function loadAnalyses(
  admin: Awaited<ReturnType<typeof authorizeClickDeskSessionClient>>['admin'],
  filters: ReturnType<typeof parseFilters>,
) {
  const rows: Array<Operation360AnalysisRow & { analyst_id: string | null }> = []

  for (let offset = 0; offset < 10000; offset += 500) {
    const result = await admin
      .from('clickdesk_qualitative_analyses')
      .select('clickdesk_ticket_id,analyst_id,satisfaction_label,validation_status,analysis')
      .gte('occurred_date', filters.start)
      .lte('occurred_date', filters.end)
      .order('updated_at', { ascending: false })
      .range(offset, offset + 499)

    if (result.error) {
      throw new ApiError(503, 'Não foi possível carregar as análises qualitativas preservadas.')
    }

    rows.push(...((result.data ?? []) as Array<Operation360AnalysisRow & { analyst_id: string | null }>))
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
    const currentOwner = new Map(attendances.map(row => [row.clickdesk_ticket_id, row]))
    const analyses = (await loadAnalyses(access.admin, filters)).filter(row => {
      const owner = currentOwner.get(row.clickdesk_ticket_id)
      return Boolean(owner && row.analyst_id === owner.analyst_id
        && row.satisfaction_label === owner.satisfaction_label)
    })
    const [ledgerCoverage, workerStatus] = await Promise.all([readLedgerCoverage(access.admin), access.admin.rpc('get_clickdesk_360_queue_status', {p_start:filters.start,p_end:filters.end,p_team:filters.teamId})])
    const totals = calculateOperation360Totals(attendances)
    const currentAnalyses = analyses.filter(
      (row) =>
        qualitativeAnalysisVersion(row.analysis) >= QUALITATIVE_ANALYSIS_VERSION,
    )

    // Cobertura técnica inclui descartadas. A seleção editorial só controla o feedback.
    const analyzedIds = new Set(currentAnalyses.map((row) => row.clickdesk_ticket_id))
    const retainedIds = new Set(analyses.filter(row => row.validation_status === 'rejected')
      .map(row => row.clickdesk_ticket_id))

    const approvedIds = new Set(
      currentAnalyses
        .filter((row) => row.validation_status === 'approved')
        .map((row) => row.clickdesk_ticket_id),
    )

    const negativeRows = attendances.filter((row) => row.satisfaction_label === 'negative')
    const positiveRows = attendances.filter((row) => row.satisfaction_label === 'positive')
    const unanalyzedNegative = negativeRows.filter((row) => !analyzedIds.has(row.clickdesk_ticket_id) && !retainedIds.has(row.clickdesk_ticket_id))
    const unanalyzedPositive = positiveRows.filter((row) => !analyzedIds.has(row.clickdesk_ticket_id) && !retainedIds.has(row.clickdesk_ticket_id))

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
      background: workerStatus.error ? null : workerStatus.data,
      period: { start: filters.start, end: filters.end },
      scope: { team_id: filters.teamId },
      source_coverage: {
        status: ledgerCoverage.complete ? 'complete' : 'audit_sample_only',
        verified_at: ledgerCoverage.verified_at,
        note: ledgerCoverage.complete
          ? 'Tickets com autoria final confirmada na competência.'
          : 'OUTUBRO CLICKDESK EM CONCILIAÇÃO: a IA usa tickets avaliados com autoria final confirmada. As avaliações recebidas já entram no CSAT, mesmo sem análise 360º ou aprovação gerencial.',
      },
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
          'A fila 360º acompanha a qualidade dos atendimentos e não valida notas para o CSAT. A seleção para feedback não altera CSAT nem cobertura técnica. Descartadas não retornam à fila automática; reanálise é uma ação explícita. O recorte considera apenas analistas ativos e tickets de outubro com autoria comprovada.',
        causality:
          'Recorrência não prova causalidade. A leitura deve ser apresentada como padrão observado, com confiança e evidências rastreáveis. A seleção editorial para feedback permanece sob controle da gestão.',
      },
    })
  })
}
