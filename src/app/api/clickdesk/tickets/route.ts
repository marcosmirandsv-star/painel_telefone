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

    // Return the analyst's raw day evidence from both captures. The individual
    // view filters this against server-reconciled final ownership. Read-only.
    const [verifiedResult, legacyResult] = await Promise.all([
      access.admin.from('clickdesk_chat_verified_contributions')
        .select('ticket_id,first_answered_at,first_message_id,satisfaction_label,rating_attribution')
        .eq('analyst_id',analystId).eq('occurred_date',date)
        .order('first_answered_at',{ascending:true}).limit(501),
      access.admin.from('clickdesk_chat_attendances')
        .select('clickdesk_ticket_id,occurred_at,area,satisfaction_label,journey_status,timestamp_source')
        .eq('analyst_id',analystId).eq('identity_role','analyst').eq('occurred_date',date)
        .order('occurred_at',{ascending:true}).limit(501),
    ])
    if(verifiedResult.error||legacyResult.error)
      throw new ApiError(503,'Os tickets do dia estão temporariamente indisponíveis.')
    if((verifiedResult.data??[]).length>500||(legacyResult.data??[]).length>500)
      throw new ApiError(422,'Consulta do dia excedeu o limite seguro de registros.')
    const tickets=new Map<string,{
      ticket_id:string
      occurred_at:string|null
      area:string|null
      satisfaction_label:string|null
      journey_status:string|null
      timestamp_source:string|null
      first_message_id?:string|null
      rating_attribution?:string|null
    }>()
    for(const x of legacyResult.data??[])tickets.set(x.clickdesk_ticket_id,{
      ticket_id:x.clickdesk_ticket_id,occurred_at:x.occurred_at,area:x.area,
      satisfaction_label:x.satisfaction_label,journey_status:x.journey_status,
      timestamp_source:x.timestamp_source,
    })
    for(const x of verifiedResult.data??[])tickets.set(x.ticket_id,{
      ticket_id:x.ticket_id,occurred_at:x.first_answered_at,area:null,
      satisfaction_label:x.satisfaction_label,journey_status:null,
      timestamp_source:'first_public_human_message',
      first_message_id:x.first_message_id,rating_attribution:x.rating_attribution,
    })
    const list=[...tickets.values()].sort((a,b)=>(a.occurred_at??'').localeCompare(b.occurred_at??''))
    return json({
      source:'clickdesk_individual_evidence',official_metrics_unchanged:true,
      date,analyst_id:analystId,count:list.length,tickets:list,
    })
  })
}
