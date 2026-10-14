import {
  ApiError,
  authorizeClickDeskSessionClient,
  handle,
  json,
} from '@/lib/integration-server'
import { getServerSupabaseConfig } from '@/lib/runtime-environment'
import { homologationReadAdmin } from '@/lib/clickdesk-final-owner-server'
import { readFinalLedger, readLedgerCoverage } from '@/lib/clickdesk-ledger-server'

export const runtime = 'nodejs'
export const maxDuration = 300

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

export async function GET(request: Request) {
  return handle(async () => {
    const { environment } = getServerSupabaseConfig()
    if (environment !== 'homologacao') {
      throw new ApiError(404, 'Detalhes ClickDesk disponíveis somente na homologação.')
    }

    const access = await authorizeClickDeskSessionClient(request)
    const params = new URL(request.url).searchParams
    const allowed = new Set(['date', 'analyst_id'])

    for (const key of params.keys()) {
      if (!allowed.has(key) || params.getAll(key).length !== 1) {
        throw new ApiError(400, 'Parâmetro desconhecido ou repetido.')
      }
    }

    const date = params.get('date')?.trim() ?? ''
    const requestedAnalystId = params.get('analyst_id')?.trim() || null

    if (!validDate(date)) {
      throw new ApiError(400, 'Informe date no formato AAAA-MM-DD.')
    }

    if (requestedAnalystId && !validUuid(requestedAnalystId)) {
      throw new ApiError(400, 'analyst_id inválido.')
    }

    if (
      !access.isManagement &&
      requestedAnalystId &&
      requestedAnalystId !== access.chatAnalystId
    ) {
      throw new ApiError(403, 'O analista só pode consultar os próprios tickets.')
    }

    const analystId = access.isManagement
      ? requestedAnalystId
      : access.chatAnalystId

    if (!analystId) {
      throw new ApiError(400, 'Informe analyst_id para consultar os tickets.')
    }

    const admin = homologationReadAdmin()
    const [rows, coverage] = await Promise.all([
      readFinalLedger(admin, { start: date, end: date, analystId }),
      readLedgerCoverage(admin),
    ])

    return json({
      source: 'clickdesk_final_ticket_ledger',
      reconciliation: {
        captured_at: coverage.verified_at, pending: [], pending_count: 0,
        coverage: coverage.complete ? 'complete' : 'audit_sample_only',
        note: 'Amostra parcial: pendências globais sem autoria não são atribuíveis por analista.',
      },
      date,
      analyst_id: analystId,
      tickets: rows.map((row) => ({
        ticket_id: row.ticket_id,
        occurred_at: row.last_public_at,
        area: row.area,
        satisfaction_label: row.satisfaction_label,
        journey_status: 'human_answer_confirmed',
        timestamp_source: 'last_public_human_answer',
        final_message_id: row.last_public_message_id,
      })),
    })
  })
}
