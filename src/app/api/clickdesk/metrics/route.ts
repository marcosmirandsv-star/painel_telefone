import { ApiError, authorizeClickDeskSessionClient, handle, json } from '@/lib/integration-server'
import { getServerSupabaseConfig } from '@/lib/runtime-environment'
import { readFinalLedger, readLedgerCoverageForAccess } from '@/lib/clickdesk-ledger-server'
import { randomUUID } from 'node:crypto'
import { partitionChatLedgerByActiveRoster } from '@/lib/clickdesk-active-analysts'

export const runtime = 'nodejs'
export const maxDuration = 300

const BUSINESS_TIME_ZONE = 'America/Sao_Paulo'
const CLICKDESK_SYNC_INTERVAL_MINUTES = 60
const CLICKDESK_SYNC_START_UTC_HOUR = 12
const CLICKDESK_SYNC_END_UTC_HOUR = 22

function getNextClickDeskSyncAt(now = new Date()) {
  for (
    let hour = CLICKDESK_SYNC_START_UTC_HOUR;
    hour <= CLICKDESK_SYNC_END_UTC_HOUR;
    hour += 1
  ) {
    const candidate = new Date(now)
    candidate.setUTCHours(hour, 0, 0, 0)
    if (candidate.getTime() > now.getTime()) return candidate.toISOString()
  }

  const nextDay = new Date(now)
  nextDay.setUTCDate(nextDay.getUTCDate() + 1)
  nextDay.setUTCHours(CLICKDESK_SYNC_START_UTC_HOUR, 0, 0, 0)
  return nextDay.toISOString()
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

async function loadRowsFallback(
  admin: Awaited<ReturnType<typeof authorizeClickDeskSessionClient>>['admin'],
  filters: ReturnType<typeof parseFilters>,
  isManagement: boolean,
) {
  const [tickets, coverage, people] = await Promise.all([
    readFinalLedger(admin, { start: filters.start, end: filters.end, analystId: filters.analystId, teamId: filters.teamId }),
    readLedgerCoverageForAccess(admin, isManagement),
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
  return { rows, coverage, admin, excludedInactive }
}

async function loadRows(
 admin: Awaited<ReturnType<typeof authorizeClickDeskSessionClient>>['admin'],
 filters: ReturnType<typeof parseFilters>, isManagement: boolean,
) {
 const [result,coverage]=await Promise.all([
 admin.rpc('get_clickdesk_metric_rows',{p_start:filters.start,p_end:filters.end,p_analyst:filters.analystId,p_team:filters.teamId}),
 readLedgerCoverageForAccess(admin,isManagement),
 ])
 // Compatibility only while a migration is being rolled out; normal reads are one SQL aggregate.
 if(result.error?.code==='PGRST202')return loadRowsFallback(admin,filters,isManagement)
 if(result.error||!result.data)throw new ApiError(503,'Não foi possível calcular os indicadores da base conciliada.')
 return {rows:result.data.rows as DailyMetricRow[],coverage,admin,excludedInactive:Number(result.data.excludedInactive)||0}
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
    const { rows, coverage, admin, excludedInactive } = await loadRows(access.admin, filters, access.isManagement)

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
    if (!access.isManagement) {
      // A sessão só pode obter o horário, nunca as linhas globais de sincronização.
      const clock = await access.admin.rpc('get_clickdesk_sync_clock', {
        p_start: filters.start, p_end: filters.end,
      })
      visibleSyncFinishedAt = !clock.error && typeof clock.data === 'string' ? clock.data : null
      if (clock.error) console.warn('clickdesk_sync_clock_unavailable', { code: clock.error.code })
    }

    const apprenticeRows = rows.filter((row) => row.identity_role === 'apprentice')
    const includedRows = rows.filter((row) => row.identity_role !== 'apprentice')
    const todayRows = includedRows.filter((row) => row.occurred_date === filters.today)
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
      source: 'clickdesk_final_ticket_ledger',
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
        date: filters.today,
        included_in_period:
          filters.today >= filters.start && filters.today <= filters.end,
        ...aggregate(todayRows),
      },
      accumulated: aggregate(includedRows),
      performance_accumulated: aggregate(performanceRows),
      management_support: aggregate(managementRows),
      daily: groupDaily(includedRows),
      performance_daily: groupDaily(performanceRows),
      by_analyst: groupAnalysts(performanceRows, filters.today),
      self_podium_context: selfPodiumContext,
      data_quality: {
        grouped_rows: includedRows.length,
        excluded_inactive_analyst_attendances: excludedInactive,
        unmatched_grouped_rows: unmatchedRows.length,
        unmatched_attendances: aggregate(unmatchedRows).attendances,
        excluded_apprentice_grouped_rows: apprenticeRows.length,
        excluded_apprentice_attendances: aggregate(apprenticeRows).attendances,
      },
      latest_sync: access.isManagement
        ? latestSync.data ?? null
        : visibleSyncFinishedAt
          ? { finished_at: visibleSyncFinishedAt }
          : null,
      sync_schedule: {
        interval_minutes: CLICKDESK_SYNC_INTERVAL_MINUTES,
        window_brt: '09:00-19:00',
        next_sync_at: getNextClickDeskSyncAt(),
      },
      date_basis: {
        sources: timestampSources,
        status: dateBasisNeedsValidation ? 'needs_validation' : 'validated',
        note: dateBasisNeedsValidation
          ? 'AMOSTRA PARCIAL: somente tickets com autoria final auditada. Não usar estes valores como fechamento oficial, ranking ou confirmação de metas.'
          : 'Data operacional: última resposta pública humana, em Brasília. Cobertura validada conforme fontes documentadas.',
      },
    })
  })
  console.info('clickdesk_metrics', JSON.stringify({
    trace_id: traceId, stage, duration_ms: Date.now()-started, status: response.status,
  }))
  return response
}
