import {
  ApiError,
  authorizeClickDeskSessionClient,
  handle,
  json,
} from '@/lib/integration-server'
import { getServerSupabaseConfig } from '@/lib/runtime-environment'

export const runtime = 'nodejs'

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

    const result = await access.admin
      .from('clickdesk_chat_attendances')
      .select(
        'clickdesk_ticket_id,occurred_at,occurred_date,area,satisfaction_label,journey_status,timestamp_source',
      )
      .eq('analyst_id', analystId)
      .eq('identity_role', 'analyst')
      .eq('occurred_date', date)
      .order('occurred_at', { ascending: true })
      .limit(200)

    if (result.error) {
      throw new ApiError(503, 'Não foi possível carregar os tickets do dia.')
    }

    return json({
      source: 'clickdesk_persisted',
      date,
      analyst_id: analystId,
      tickets: (result.data ?? []).map((row) => ({
        ticket_id: row.clickdesk_ticket_id,
        occurred_at: row.occurred_at,
        area: row.area,
        satisfaction_label: row.satisfaction_label,
        journey_status: row.journey_status,
        timestamp_source: row.timestamp_source,
      })),
    })
  })
}
