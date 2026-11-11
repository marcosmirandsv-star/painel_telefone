import { loadOfficialPeriodRows } from '@/lib/clickdesk-official-metrics'
import { ApiError, authorizeManagerSessionClient, handle, json } from '@/lib/integration-server'
import { getServerSupabaseConfig } from '@/lib/runtime-environment'
import { readFinalLedger, readLedgerCoverage, scopeLedgerCoverage } from '@/lib/clickdesk-ledger-server'
import { summarizeVerifiedTeams } from '@/lib/clickdesk-team-summary'
import { partitionChatLedgerByActiveRoster } from '@/lib/clickdesk-active-analysts'
import { clickDeskPublicationDay } from '@/lib/clickdesk-publication'
import { chatMetricTotals } from '@/lib/chat-metric-totals'

export const runtime = 'nodejs'

// Fila e equipe são dimensões diferentes. Um relatório Fiscal/ERP
// NÃO pode ser atribuído integralmente ao time de um gestor.
type ReportSnapshotRow = {
  period_date: string
  department_id: number
  department_name: string
  report_created: number
  report_resolved: number
  report_open_now: number
  report_waiting_now: number
  csat_pct: number | null
  csat_total: number
  captured_at: string
}

export async function GET(request: Request) {
  const started = Date.now()
  let stage = 'runtime'
  const response = await handle(async () => {
    const { environment } = getServerSupabaseConfig()
    if (environment !== 'homologacao') {
      throw new ApiError(404, 'Visão operacional do ClickDesk disponível somente na homologação.')
    }
    stage = 'authorization'
    // Reuse the same JWT/session and RLS authorization path as /api/clickdesk/metrics.
    const { admin } = await authorizeManagerSessionClient(request)
    const today = clickDeskPublicationDay()
    const monthStart = today.slice(0, 7) + '-01'

    stage = 'ledger_and_teams'
    const [tickets, coverage, rosterResult, analystsResult, snapshotsResult, latestSyncResult, numericClock, official] = await Promise.all([
      readFinalLedger(admin, { start: monthStart, end: today }),
      readLedgerCoverage(admin).then(coverage=>scopeLedgerCoverage(coverage,{start:monthStart,end:today})),
      admin.from('chat_teams').select('id,name,active').eq('active', true),
      admin.from('chat_analysts').select('id,active'),
      admin.from('clickdesk_chat_report_snapshots')
        .select('period_date,department_id,department_name,report_created,report_resolved,report_open_now,report_waiting_now,csat_pct,csat_total,captured_at')
        .lte('period_date', today)
        .order('captured_at', { ascending: false })
        .limit(100),
      admin.from('clickdesk_chat_sync_runs')
        .select('id,status,period_start,period_end,trigger_mode,finished_at')
        .eq('status', 'completed')
        .order('finished_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin.rpc('get_clickdesk_sync_clock',{p_start:monthStart,p_end:today}),
      loadOfficialPeriodRows(admin,{start:monthStart,end:today}),
    ])
    if (rosterResult.error) throw new ApiError(503, 'Cadastro de equipes indisponível.')
    if (analystsResult.error) throw new ApiError(503, 'Cadastro de analistas indisponível.')
    stage = 'active_membership'
    let teamSummaries: ReturnType<typeof summarizeVerifiedTeams>
    let excludedInactive = 0
    try {
      const filtered = partitionChatLedgerByActiveRoster(tickets, analystsResult.data ?? [])
      excludedInactive = filtered.inactive.length
      teamSummaries = summarizeVerifiedTeams(
        rosterResult.data ?? [], filtered.active, coverage.complete,
      )
    } catch {
      throw new ApiError(503, 'Conferência de vínculo ou duplicidade do ledger falhou.')
    }
    if (official) {
      teamSummaries = teamSummaries.map(team => {
        const rows = official.rows.filter(row => row.team_id === team.team_id && row.identity_role === 'analyst')
        const totals = chatMetricTotals(rows)
        const reviews = totals.positive_reviews + totals.negative_reviews
        return {...team,...totals,reviews,csat_pct:totals.csat,
          review_percentage:totals.attendances?Math.round(reviews/totals.attendances*10000)/100:null,
          available:rows.length>0,coverage_status:'complete',latest_verified_at:official.lastReconciledAt}
      })
    }
    const lastReconciledAt=tickets.reduce<string|null>((latest,row)=>!latest||row.verified_at>latest?row.verified_at:latest,null)
    const visibleCheckAt=official?.lastReconciledAt ?? [lastReconciledAt,latestSyncResult.data?.finished_at,!numericClock.error&&typeof numericClock.data==='string'?numericClock.data:null].filter((value):value is string=>Boolean(value)).sort((a,b)=>Date.parse(b)-Date.parse(a))[0]??null

    stage = 'serialize'

    const latestByDepartment = new Map<number, ReportSnapshotRow>()
    if (!snapshotsResult.error) {
      for (const row of (snapshotsResult.data ?? []) as ReportSnapshotRow[]) {
        if (!latestByDepartment.has(row.department_id)) latestByDepartment.set(row.department_id, row)
      }
    }
    // Esses são indicadores oficiais das filas. Nunca somá-los por gestor.
    const queueReports = [...latestByDepartment.values()].map(row => ({
      department_id: row.department_id,
      department_name: row.department_name,
      period_date: row.period_date,
      report_created: Number(row.report_created) || 0,
      report_resolved: Number(row.report_resolved) || 0,
      open_now: Number(row.report_open_now) || 0,
      waiting_now: Number(row.report_waiting_now) || 0,
      csat_pct: row.csat_pct === null ? null : Number(row.csat_pct),
      csat_total: Number(row.csat_total) || 0,
      captured_at: row.captured_at,
    }))

    return json({
      source: official?.metricSource ?? 'clickdesk_final_ticket_ledger',
      period: { start: monthStart, end: today, timezone: 'America/Sao_Paulo' },
      team_summaries: teamSummaries,
      excluded_inactive_analyst_tickets: excludedInactive,
      queue_reports: queueReports,
      queue_report_status: snapshotsResult.error
        ? 'unavailable' : queueReports.length ? 'available' : 'not_captured',
      ledger_coverage: coverage.complete ? 'complete' : 'partial',
      metric_coverage: official ? 'official_period' : 'ledger_sample',
      publication: {mode:'intraday',available_through:today},
      latest_sync: visibleCheckAt ? {finished_at:visibleCheckAt,source:'canonical_background_check'} : null,
      sync_status: latestSyncResult.error ? 'unavailable' : 'available',
      semantics: {
        teams: official ? 'Recebimentos por data do evento e avaliações por data da pesquisa nas filas ERP/Fiscal, agrupados pelo time de lotação. CSAT ajustado exclui apenas neutros externos comprovados.' : 'Contagem de um ticket por ultimo autor publico humano verificado e ativo, agrupado pelo vinculo cadastral.',
        inactive: 'Creditos de autores inativos mantidos no ledger para auditoria, mas excluidos da visao operacional atual.',
        queues: 'Criados, resolvidos e CSAT dos relatorios oficiais Fiscal/ERP; nao representam exclusivamente a equipe.',
        incomplete: 'Cobertura parcial nao pode ser usada como fechamento nem pontuacao final.',
      },
    })
  })
  console.info('clickdesk_overview', JSON.stringify({ stage, status: response.status, duration_ms: Date.now() - started }))
  return response
}
