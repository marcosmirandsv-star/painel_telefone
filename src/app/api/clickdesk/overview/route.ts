import { ApiError, authorizeManager, handle, json } from '@/lib/integration-server'
import { getServerSupabaseConfig } from '@/lib/runtime-environment'
import { readFinalLedger, readLedgerCoverage } from '@/lib/clickdesk-ledger-server'
import { summarizeVerifiedTeams } from '@/lib/clickdesk-team-summary'

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

function businessDay() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  const p = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${p.year}-${p.month}-${p.day}`
}

export async function GET(request: Request) {
  return handle(async () => {
    const { environment } = getServerSupabaseConfig()
    if (environment !== 'homologacao') {
      throw new ApiError(404, 'Visão operacional do ClickDesk disponível somente na homologação.')
    }
    const { admin } = await authorizeManager(request)
    const today = businessDay()
    const monthStart = today.slice(0, 7) + '-01'

    const [tickets, coverage, rosterResult, snapshotsResult, latestSyncResult] = await Promise.all([
      readFinalLedger(admin, { start: monthStart, end: today }),
      readLedgerCoverage(admin),
      admin.from('chat_teams').select('id,name,active').eq('active', true),
      admin.from('clickdesk_chat_report_snapshots')
        .select('period_date,department_id,department_name,report_created,report_resolved,report_open_now,report_waiting_now,csat_pct,csat_total,captured_at')
        .order('captured_at', { ascending: false })
        .limit(100),
      admin.from('clickdesk_chat_sync_runs')
        .select('id,status,period_start,period_end,trigger_mode,finished_at')
        .eq('status', 'completed')
        .order('finished_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])
    if (rosterResult.error) throw new ApiError(503, 'Cadastro de equipes indisponível.')
    let teamSummaries: ReturnType<typeof summarizeVerifiedTeams>
    try {
      teamSummaries = summarizeVerifiedTeams(
        rosterResult.data ?? [], tickets, coverage.complete,
      )
    } catch {
      throw new ApiError(503, 'Ledger contém vínculo de equipe inválido ou ticket duplicado.')
    }

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
      source: 'clickdesk_final_ticket_ledger',
      period: { start: monthStart, end: today, timezone: 'America/Sao_Paulo' },
      team_summaries: teamSummaries,
      queue_reports: queueReports,
      queue_report_status: snapshotsResult.error
        ? 'unavailable' : queueReports.length ? 'available' : 'not_captured',
      ledger_coverage: coverage.complete ? 'complete' : 'partial',
      latest_sync: latestSyncResult.error ? null : latestSyncResult.data ?? null,
      sync_status: latestSyncResult.error ? 'unavailable' : 'available',
      semantics: {
        teams: 'Contagem de um ticket por ultimo autor publico humano verificado, agrupado pelo vinculo cadastral.',
        queues: 'Criados, resolvidos e CSAT dos relatorios oficiais Fiscal/ERP; nao representam exclusivamente a equipe.',
        incomplete: 'Cobertura parcial nao pode ser usada como fechamento nem pontuacao final.',
      },
    })
  })
}
