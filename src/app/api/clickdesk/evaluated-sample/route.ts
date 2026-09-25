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

function pickSpread<T>(items: T[], limit: number) {
  if (items.length <= limit) return items
  if (limit <= 1) return [items[0]]

  const picked: T[] = []
  const used = new Set<number>()

  for (let index = 0; index < limit; index += 1) {
    const position = Math.round((index * (items.length - 1)) / (limit - 1))
    if (!used.has(position)) {
      picked.push(items[position])
      used.add(position)
    }
  }

  return picked
}

export async function GET(request: Request) {
  return handle(async () => {
    const { environment } = getServerSupabaseConfig()
    if (environment !== 'homologacao') {
      throw new ApiError(404, 'Amostra qualitativa disponível somente na homologação.')
    }

    const access = await authorizeClickDeskSessionClient(request)
    const params = new URL(request.url).searchParams
    const allowed = new Set(['start', 'end', 'analyst_id'])

    for (const key of params.keys()) {
      if (!allowed.has(key) || params.getAll(key).length !== 1) {
        throw new ApiError(400, 'Parâmetro desconhecido ou repetido.')
      }
    }

    const start = params.get('start')?.trim() ?? ''
    const end = params.get('end')?.trim() ?? ''
    const requestedAnalystId = params.get('analyst_id')?.trim() || null

    if (!validDate(start) || !validDate(end) || start > end) {
      throw new ApiError(400, 'Informe start e end válidos no formato AAAA-MM-DD.')
    }

    if (requestedAnalystId && !validUuid(requestedAnalystId)) {
      throw new ApiError(400, 'analyst_id inválido.')
    }

    if (
      !access.isManagement &&
      requestedAnalystId &&
      requestedAnalystId !== access.chatAnalystId
    ) {
      throw new ApiError(403, 'O analista só pode consultar a própria amostra.')
    }

    const analystId = access.isManagement
      ? requestedAnalystId
      : access.chatAnalystId

    if (!analystId) {
      throw new ApiError(400, 'Informe analyst_id para consultar a amostra.')
    }

    const result = await access.admin
      .from('clickdesk_chat_attendances')
      .select(
        'clickdesk_ticket_id,occurred_at,occurred_date,area,satisfaction_label,journey_status,timestamp_source',
      )
      .eq('analyst_id', analystId)
      .eq('identity_role', 'analyst')
      .gte('occurred_date', start)
      .lte('occurred_date', end)
      .in('satisfaction_label', ['positive', 'negative'])
      .order('occurred_at', { ascending: true })
      .limit(1000)

    if (result.error) {
      throw new ApiError(503, 'Não foi possível carregar as avaliações do período.')
    }

    const rows = result.data ?? []
    const negatives = rows.filter((row) => row.satisfaction_label === 'negative')
    const positives = rows.filter((row) => row.satisfaction_label === 'positive')
    const sampled = [
      ...pickSpread(negatives, 3),
      ...pickSpread(positives, 5),
    ]

    const ticketIds = sampled.map((row) => row.clickdesk_ticket_id)
    const cachedIds = new Set<string>()

    if (ticketIds.length) {
      const cache = await access.admin
        .from('clickdesk_qualitative_analyses')
        .select('clickdesk_ticket_id')
        .in('clickdesk_ticket_id', ticketIds)

      if (!cache.error) {
        for (const row of cache.data ?? []) {
          cachedIds.add(row.clickdesk_ticket_id)
        }
      }
    }

    const serialize = (row: (typeof rows)[number]) => ({
      ticket_id: row.clickdesk_ticket_id,
      occurred_at: row.occurred_at,
      occurred_date: row.occurred_date,
      area: row.area,
      satisfaction_label: row.satisfaction_label,
      journey_status: row.journey_status,
      timestamp_source: row.timestamp_source,
      has_analysis: cachedIds.has(row.clickdesk_ticket_id),
    })

    return json({
      source: 'clickdesk_persisted',
      analyst_id: analystId,
      period: { start, end },
      totals: {
        positive: positives.length,
        negative: negatives.length,
        evaluated: positives.length + negatives.length,
      },
      sample_rule: {
        negative_limit: 3,
        positive_limit: 5,
        strategy: 'distributed_across_period',
      },
      negative: pickSpread(negatives, 3).map(serialize),
      positive: pickSpread(positives, 5).map(serialize),
    })
  })
}
