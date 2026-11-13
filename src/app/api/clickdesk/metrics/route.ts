import { loadOfficialPeriodRows } from '@/lib/clickdesk-official-metrics'
import { ApiError, authorizeClickDeskSessionClient, handle, json } from '@/lib/integration-server'
import { getServerSupabaseConfig } from '@/lib/runtime-environment'
import { readFinalLedger, readLedgerCoverageForAccess, scopeLedgerCoverage } from '@/lib/clickdesk-ledger-server'
import { randomUUID } from 'node:crypto'
import { partitionChatLedgerByActiveRoster } from '@/lib/clickdesk-active-analysts'
import { clickDeskPublicationDay, publishedClickDeskEnd, nextChatSyncAt, isOfficialClickDeskSource } from '@/lib/clickdesk-publication'
import { chatMetricTotals } from '@/lib/chat-metric-totals'

export const runtime = 'nodejs'
export const maxDuration = 300

const BUSINESS_TIME_ZONE = 'America/Sao_Paulo'
const CLICKDESK_SYNC_INTERVAL_MINUTES = 30

function getNextClickDeskSyncAt(now = new Date()) {
  return nextChatSyncAt(now)
}

type DailyMetricRow = {
  occurred_date: string
  team_id: string | null
  analyst_id: string | null
  area: string
  assignee_name: string
  identity_role: 'analyst' | 'management' | 'unmapped' | 'apprentice'
  attendances: number
  positive_reviews: number
  negative_reviews: number
  reviews: number
  csat: number | null
  review_percentage: number | null
  excluded_neutrals?: number
  neutral_human?: number
  neutral_external?: number
  neutral_pending?: number
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
  const publicationDay = clickDeskPublicationDay()
  const defaultStart = `${publicationDay.slice(0, 8)}01`
  const start = params.get('start') || defaultStart
  const requestedEnd = params.get('end') || today
  const end = publishedClickDeskEnd(requestedEnd)
  const analystId = params.get('analyst_id')
  const teamId = params.get('team_id')

  const emptyCurrentDay = start === today && requestedEnd === publicationDay
  if (!validDate(start) || !validDate(requestedEnd) || (start > requestedEnd && !emptyCurrentDay) || inclusiveDays(start, requestedEnd) > 93) {
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

async function loadRowsFallback(
  admin: Awaited<ReturnType<typeof authorizeClickDeskSessionClient>>['admin'],
  filters: ReturnType<typeof parseFilters>,
  isManagement: boolean,
) {
  const [tickets, coverage, people] = await Promise.all([
    readFinalLedger(admin, { start: filters.start, end: filters.end, analystId: filters.analystId, teamId: filters.teamId }),
    readLedgerCoverageForAccess(admin, isManagement, filters),
    admin.from('chat_analysts').select('id,name,team_id,active'),
  ])
  if (people.error) throw new ApiError(503, 'Cadastro de analistas da homologação indisponível.')
  const roster = new Map((people.data ?? []).map(person => [person.id, person]))
  let partition: ReturnType<typeof partitionChatLedgerByActiveRoster<typeof tickets[number]>>
  try {
    partition = partitionChatLedgerByActiveRoster(tickets, people.data ?? [])
  } catch {
    throw new ApiError(503, 'Titular do ledger ausente do cadastro. Revisar a conciliação.')
  }
  // Consultas operacionais do time excluem inativos. Histórico de um
  // analista explicitamente selecionado continua consultável pelo gestor.
  const currentTickets = filters.analystId ? tickets : partition.active
  const excludedInactive = filters.analystId ? 0 : partition.inactive.length
  const rows: DailyMetricRow[] = currentTickets.map(ticket => {
    const analyst = roster.get(ticket.analyst_id)
    if (!analyst) throw new ApiError(503, 'Titular confirmado ausente do cadastro. Revisar conciliação.')
    return {
      occurred_date: ticket.occurred_date,
      team_id: ticket.team_id,
      analyst_id: ticket.analyst_id,
      area: ticket.area ?? 'Fila histórica não comprovada',
      assignee_name: analyst.name,
      identity_role: 'analyst' as const,
      attendances: 1,
      positive_reviews: Number(ticket.satisfaction_label === 'positive'),
      negative_reviews: Number(ticket.satisfaction_label === 'negative'),
      reviews: Number(ticket.satisfaction_label !== null),
      csat: null,
      review_percentage: null,
    }
  })
  return { rows, coverage: isManagement ? scopeLedgerCoverage(coverage, filters) : coverage, admin, excludedInactive, lastReconciledAt: null as string | null, metricSource: 'clickdesk_final_ticket_ledger' as const }
}

async function loadRows(
 admin: Awaited<ReturnType<typeof authorizeClickDeskSessionClient>>['admin'],
 filters: ReturnType<typeof parseFilters>, isManagement: boolean,
) {
 if (filters.start > filters.end) return { rows: [] as DailyMetricRow[], coverage: {complete:false,verified_at:null,entries:[]},admin,excludedInactive:0,lastReconciledAt:null,metricSource:'clickdesk_final_ticket_ledger' as const }
 let official
 try {
   official = await loadOfficialPeriodRows(admin, filters)
 } catch (error) {
   console.error('clickdesk_official_metrics_read_failed', {
     message: error instanceof Error ? error.message : 'unexpected',
   })
   throw error
 }
 if (official) return official

 const [result,coverage]=await Promise.all([
 admin.rpc('get_clickdesk_metric_rows',{p_start:filters.start,p_end:filters.end,p_analyst:filters.analystId,p_team:filters.teamId}),
 readLedgerCoverageForAccess(admin,isManagement,filters),
 ])
 // Compatibility only while a migration is being rolled out; normal reads are one SQL aggregate.
 if(result.error?.code==='PGRST202')return loadRowsFallback(admin,filters,isManagement)
 if(result.error||!result.data)throw new ApiError(503,'Não foi possível calcular os indicadores da base conciliada.')
 return {rows:result.data.rows as DailyMetricRow[],coverage:isManagement?scopeLedgerCoverage(coverage,filters):coverage,admin,excludedInactive:Number(result.data.excludedInactive)||0,lastReconciledAt:typeof result.data.last_reconciled_at==='string'?result.data.last_reconciled_at:null,metricSource:'clickdesk_final_ticket_ledger' as const}
}

function aggregate(rows: DailyMetricRow[]): Aggregate {
  return chatMetricTotals(rows)
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
  const started = Date.now()
  const traceId = randomUUID()
  let stage = 'environment'
  const response = await handle(async () => {
    const { environment } = getServerSupabaseConfig()
    if (environment !== 'homologacao') {
      throw new ApiError(404, 'Métricas ClickDesk disponíveis somente na homologação.')
    }

    stage = 'authorization'
    const access = await authorizeClickDeskSessionClient(request)
    const requestedFilters = parseFilters(request)

    if (
      !access.isManagement &&
      requestedFilters.analystId &&
      requestedFilters.analystId !== access.chatAnalystId
    ) {
      throw new ApiError(403, 'O analista só pode consultar os próprios indicadores.')
    }

    const filters = access.isManagement
      ? requestedFilters
      : {
          ...requestedFilters,
          analystId: access.chatAnalystId,
          teamId: null,
        }

    stage = 'ledger_read'
    const loaded = await loadRows(access.admin, filters, access.isManagement)
    const { rows, coverage, admin, excludedInactive, lastReconciledAt, metricSource } = loaded
    const officialDaily = 'dailyRows' in loaded ? loaded.dailyRows : null
    const dailyRows = isOfficialClickDeskSource(metricSource) ? officialDaily : rows
    const dailyAvailable = dailyRows !== null

    stage = 'sync_status'
    const latestSync = await admin
      .from('clickdesk_chat_sync_runs')
      .select('id,status,period_start,period_end,trigger_mode,pages_scanned,rows_upserted,matched_rows,unmatched_rows,finished_at')
      .eq('status', 'completed')
      .lte('period_start', filters.end)
      .gte('period_end', filters.start)
      .order('finished_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (latestSync.error) throw new ApiError(503, 'Não foi possível consultar o status da sincronização.')

    let visibleSyncFinishedAt = latestSync.data?.finished_at ?? null
    {
      // Retorna apenas o horário da verificação; não atesta cobertura nem expõe linhas globais.
      const clock = await access.admin.rpc('get_clickdesk_sync_clock', {
        p_start: filters.start, p_end: filters.end,
      })
      visibleSyncFinishedAt = !clock.error && typeof clock.data === 'string' ? clock.data : null
      if (clock.error) console.warn('clickdesk_sync_clock_unavailable', { code: clock.error.code })
    }

    if (lastReconciledAt && (!visibleSyncFinishedAt || lastReconciledAt > visibleSyncFinishedAt)) visibleSyncFinishedAt = lastReconciledAt
    if(isOfficialClickDeskSource(metricSource))visibleSyncFinishedAt=lastReconciledAt

    const apprenticeRows = rows.filter((row) => row.identity_role === 'apprentice')
    const includedRows = rows.filter((row) => row.identity_role !== 'apprentice')
    const todayRows = (dailyRows ?? []).filter((row) => row.occurred_date === clickDeskPublicationDay() && row.identity_role !== 'apprentice')
    const performanceRows = includedRows.filter((row) => row.identity_role === 'analyst')
    const managementRows = includedRows.filter((row) => row.identity_role === 'management')
    const unmatchedRows = includedRows.filter((row) => row.identity_role === 'unmapped')

    // Uma coorte parcial jamais autoriza pódio, avaliação conclusiva ou fechamento.
    const coverageComplete = coverage.complete
    const timestampSources = { last_public_human_answer: rows.reduce((n,row) => n+row.attendances,0) }
    const dateBasisNeedsValidation = !coverageComplete
    const selfPodiumContext = null
    stage = 'completed'

    return json({
      source: metricSource,
      reconciliation: {
        captured_at: coverage.verified_at,
        cache_window_minutes: 0,
        coverage: coverageComplete ? 'complete' : 'audit_sample_only',
        coverage_complete: coverageComplete,
        coverage_sources: access.isManagement ? coverage.entries : [],
        pending: [],
        pending_count: 0,
        pending_note: 'Pendências globais não podem ser atribuídas a um analista/equipe sem autoria comprovada.',
        unique_ticket_rule: true,
        retry_needed: false,
        excluded: [],
      },
      period: {
        start: filters.start,
        end: filters.end,
        business_time_zone: BUSINESS_TIME_ZONE,
      },
      today: {
        date: clickDeskPublicationDay(),
        included_in_period:
          clickDeskPublicationDay() >= filters.start && clickDeskPublicationDay() <= filters.end,
        ...aggregate(todayRows),
      },
      accumulated: aggregate(includedRows),
      performance_accumulated: aggregate(performanceRows),
      management_support: aggregate(managementRows),
      daily: groupDaily((dailyRows ?? []).filter(row=>row.identity_role!=='apprentice')),
      performance_daily: groupDaily((dailyRows ?? []).filter(row=>row.identity_role==='analyst')),
      by_analyst: groupAnalysts(performanceRows, clickDeskPublicationDay()).map(row => {
        const own=(dailyRows ?? []).filter(d=>d.analyst_id===row.analyst_id)
        return {...row,daily:groupDaily(own),today:aggregate(own.filter(d=>d.occurred_date===clickDeskPublicationDay()))}
      }),
      publication: { mode: 'intraday', available_through: clickDeskPublicationDay(), daily_available: dailyAvailable, current_day_in_progress:filters.end===filters.today },
      self_podium_context: selfPodiumContext,
      data_quality: {
        grouped_rows: includedRows.length,
        excluded_inactive_analyst_attendances: excludedInactive,
        unmatched_grouped_rows: unmatchedRows.length,
        unmatched_attendances: aggregate(unmatchedRows).attendances,
        excluded_apprentice_grouped_rows: apprenticeRows.length,
        excluded_apprentice_attendances: aggregate(apprenticeRows).attendances,
      },
      latest_sync: visibleSyncFinishedAt
        ? access.isManagement && latestSync.data?.finished_at === visibleSyncFinishedAt
          ? latestSync.data
          : { finished_at: visibleSyncFinishedAt, source: 'canonical_background_check' }
        : null,
      sync_schedule: {
        interval_minutes: CLICKDESK_SYNC_INTERVAL_MINUTES,
        window_brt: '00:00-23:30',
        next_sync_at: getNextClickDeskSyncAt(),
      },
      date_basis: {
        sources: timestampSources,
        status: dateBasisNeedsValidation ? 'needs_validation' : 'validated',
        note: dateBasisNeedsValidation
          ? 'AMOSTRA PARCIAL: somente tickets com autoria final auditada. Não usar estes valores como fechamento oficial, ranking ou confirmação de metas.'
          : metricSource === 'clickdesk_event_receipts'
            ? 'Atendimentos pela data do recebimento por cada analista. Transferências posteriores ficam no dia do evento. Avaliações pela data da resposta; CSAT ajustado exclui somente neutros externos verificados.'
          : metricSource === 'clickdesk_official_period_metrics'
            ? filters.start >= '2026-11-01'
              ? 'ClickDesk: Recebidos por responsável nas filas ERP e Fiscal, avaliações pelo atendente avaliado, time de lotação e atualização a cada 30 minutos. Resolvidos não são somados aos recebidos. O calendário diário exige conciliação com o período.'
              : 'Fotografia histórica do período ClickDesk: resolvidos por responsável e avaliações pelo atendente avaliado; filas ERP e Fiscal, time de lotação e corte D-1.'
            : 'Data operacional: última resposta pública humana, em Brasília. Cobertura validada conforme fontes documentadas.',
      },
    })
  })
  console.info('clickdesk_metrics', JSON.stringify({
    trace_id: traceId, stage, duration_ms: Date.now()-started, status: response.status,
  }))
  return response
}
