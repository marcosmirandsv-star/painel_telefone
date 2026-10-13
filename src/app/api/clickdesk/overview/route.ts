import { ApiError, authorizeManagerSessionClient, handle, json } from '@/lib/integration-server'
import { getServerSupabaseConfig } from '@/lib/runtime-environment'

export const runtime = 'nodejs'

type ReportSnapshotRow = {
  period_date: string
  department_id: number
  department_name: string
  team_id: string | null
  report_created: number
  report_resolved: number
  report_open_now: number
  report_waiting_now: number
  agent_received: number
  agent_resolved: number
  agent_transferred: number
  ai_handled: number
  ai_escalated: number
  csat_pct: number | null
  csat_total: number
  captured_at: string
}

export async function GET(request: Request) {
  return handle(async () => {
    const { environment } = getServerSupabaseConfig()
    if (environment !== 'homologacao') {
      throw new ApiError(404, 'Visão operacional do ClickDesk disponível somente na homologação.')
    }

    const { admin } = await authorizeManagerSessionClient(request)

    const snapshotsResult = await admin
      .from('clickdesk_chat_report_snapshots')
      .select(
        'period_date,department_id,department_name,team_id,report_created,report_resolved,report_open_now,report_waiting_now,agent_received,agent_resolved,agent_transferred,ai_handled,ai_escalated,csat_pct,csat_total,captured_at',
      )
      .order('captured_at', { ascending: false })
      .limit(100)

    if (snapshotsResult.error) {
      throw new ApiError(503, 'Não foi possível consultar os indicadores oficiais do ClickDesk.')
    }

    const latestByTeam = new Map<string, ReportSnapshotRow>()
    for (const row of (snapshotsResult.data ?? []) as ReportSnapshotRow[]) {
      if (!row.team_id || latestByTeam.has(row.team_id)) continue
      latestByTeam.set(row.team_id, row)
    }

    const latestSyncResult = await admin
      .from('clickdesk_chat_sync_runs')
      .select('id,status,period_start,period_end,trigger_mode,finished_at')
      .eq('status', 'completed')
      .order('finished_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (latestSyncResult.error) {
      throw new ApiError(503, 'Não foi possível consultar o status da sincronização do ClickDesk.')
    }

    return json({
      source: 'clickdesk_official_report_snapshots',
      snapshots: [...latestByTeam.values()].map((row) => ({
        team_id: row.team_id,
        period_date: row.period_date,
        department_id: row.department_id,
        department_name: row.department_name,
        report_created: Number(row.report_created) || 0,
        report_resolved: Number(row.report_resolved) || 0,
        open_now: Number(row.report_open_now) || 0,
        waiting_now: Number(row.report_waiting_now) || 0,
        agent_received: Number(row.agent_received) || 0,
        agent_resolved: Number(row.agent_resolved) || 0,
        agent_transferred: Number(row.agent_transferred) || 0,
        ai_handled: Number(row.ai_handled) || 0,
        ai_escalated: Number(row.ai_escalated) || 0,
        csat_pct: row.csat_pct === null ? null : Number(row.csat_pct),
        csat_total: Number(row.csat_total) || 0,
        captured_at: row.captured_at,
      })),
      latest_sync: latestSyncResult.data ?? null,
      semantics: {
        source: 'Relatório oficial agregado do ClickDesk.',
        current_state: ['open_now', 'waiting_now'],
        historical_detail_status:
          'Esta resposta não usa clickdesk_chat_attendances nem prova autoria individual histórica.',
      },
    })
  })
}
