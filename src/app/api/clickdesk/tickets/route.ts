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

    // Verified human contributions are supplementary evidence. The existing
    // attendance table remains untouched and is used only on days where this
    // analyst has no recovered contribution, never summed with verified rows.
    const verifiedResult = await access.admin
      .from('clickdesk_chat_verified_contributions')
      .select(
        'ticket_id,analyst_id,team_id,first_answered_at,first_message_id,occurred_date,satisfaction_label,rating_attribution',
      )
      .eq('analyst_id', analystId)
      .eq('occurred_date', date)
      .order('first_answered_at', { ascending: true })
      .limit(501)

    if (verifiedResult.error) {
      throw new ApiError(503, 'Não foi possível consultar a captura humana verificada.')
    }
    if ((verifiedResult.data ?? []).length > 500) {
      throw new ApiError(422, 'O dia excedeu o limite seguro de 500 registros. Verifique a paginação antes de exibir um total incompleto.')
    }

    if ((verifiedResult.data ?? []).length > 0) {
      return json({
        source: 'clickdesk_verified_contributions',
        evidence: 'first_public_human_message',
        official_metrics_unchanged: true,
        date,
        analyst_id: analystId,
        count: verifiedResult.data!.length,
        tickets: verifiedResult.data!.map((row) => ({
          ticket_id: row.ticket_id,
          occurred_at: row.first_answered_at,
          area: 'Fila não identificada na captura verificada',
          satisfaction_label: row.satisfaction_label,
          journey_status: null,
          timestamp_source: 'first_public_human_message',
          first_message_id: row.first_message_id,
          rating_attribution: row.rating_attribution,
        })),
      })
    }

    const legacyResult = await access.admin
      .from('clickdesk_chat_attendances')
      .select(
        'clickdesk_ticket_id,occurred_at,occurred_date,area,satisfaction_label,journey_status,timestamp_source',
      )
      .eq('analyst_id', analystId)
      .eq('identity_role', 'analyst')
      .eq('occurred_date', date)
      .order('occurred_at', { ascending: true })
      .limit(201)

    if (legacyResult.error) {
      throw new ApiError(503, 'Não foi possível consultar os tickets da base anterior.')
    }
    if ((legacyResult.data ?? []).length > 200) {
      throw new ApiError(422, 'A base anterior excedeu o limite seguro de 200 registros. Não será exibido um total incompleto.')
    }

    return json({
      source: (legacyResult.data ?? []).length > 0 ? 'clickdesk_persisted' : 'no_daily_evidence',
      evidence: (legacyResult.data ?? []).length > 0 ? 'legacy_capture' : 'unavailable',
      official_metrics_unchanged: true,
      date,
      analyst_id: analystId,
      count: legacyResult.data?.length ?? 0,
      tickets: (legacyResult.data ?? []).map((row) => ({
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
