import { randomUUID } from 'node:crypto'
import { ApiError, authorizeClickDeskSessionClient, handle, json } from '@/lib/integration-server'
import { getServerSupabaseConfig } from '@/lib/runtime-environment'
import { homologationReadAdmin } from '@/lib/clickdesk-final-owner-server'

export const runtime = 'nodejs'

/**
 * Diagnóstico constante, sem REST ClickDesk, sem conteúdo de clientes e sem secrets.
 * Somente gestores autenticados; serviço administrativo isolado na homologação.
 */
export async function GET(request: Request) {
  const traceId = randomUUID()
  const started = Date.now()
  let stage = 'environment'
  const response = await handle(async () => {
    if (getServerSupabaseConfig().environment !== 'homologacao') {
      throw new ApiError(404, 'Diagnóstico somente na homologação.')
    }
    stage = 'authorization'
    const access = await authorizeClickDeskSessionClient(request)
    if (!access.isManagement) throw new ApiError(403, 'Diagnóstico exclusivo da gestão.')
    stage = 'database'
    const admin = homologationReadAdmin()
    const [legacy, verified, daily, snapshots, sync, lastGood] = await Promise.all([
      admin.from('clickdesk_chat_attendances').select('id', { count: 'exact', head: true }),
      admin.from('clickdesk_chat_verified_contributions').select('ticket_id', { count: 'exact', head: true }),
      admin.from('clickdesk_chat_daily_metrics').select('occurred_date').order('occurred_date', { ascending: false }).limit(1),
      admin.from('clickdesk_chat_report_snapshots').select('captured_at,period_date,department_id,report_created,human_answered').order('captured_at', { ascending: false }).limit(2),
      admin.from('clickdesk_chat_sync_runs').select('finished_at,status,rows_received,rows_upserted,period_start,period_end,error_message').order('started_at', { ascending: false }).limit(1),
      admin.from('clickdesk_chat_sync_runs').select('finished_at,rows_upserted').gt('rows_upserted',0).order('finished_at', { ascending: false }).limit(1),
    ])
    if (legacy.error || verified.error || daily.error || snapshots.error || sync.error || lastGood.error) {
      throw new ApiError(503, 'Fontes de monitoramento indisponíveis na homologação.')
    }
    stage = 'completed'
    const latest = sync.data?.[0] ?? null
    const stalled = Boolean(latest?.status === 'completed' && latest.rows_received === 0
      && verified.count && verified.count > 0)
    return json({
      trace_id: traceId,
      environment: 'homologacao',
      status: stalled ? 'capture_gap' : 'available',
      note: 'Contagens de candidatos não são atendimentos finais. Snapshot da operação não é prova de autoria individual.',
      sources: {
        legacy_candidates: legacy.count,
        verified_participations: verified.count,
        last_legacy_daily_date: daily.data?.[0]?.occurred_date ?? null,
        last_human_sync_with_rows: lastGood.data?.[0]?.finished_at ?? null,
        last_sync: latest ? {
          finished_at: latest.finished_at,
          status: latest.status,
          rows_received: latest.rows_received,
          rows_upserted: latest.rows_upserted,
          period_start: latest.period_start,
          period_end: latest.period_end,
        } : null,
        latest_department_reports: snapshots.data ?? [],
      },
      elapsed_ms: Date.now() - started,
    })
  })
  console.info('clickdesk_health', JSON.stringify({
    trace_id: traceId, duration_ms: Date.now() - started, status: response.status, stage,
  }))
  return response
}
