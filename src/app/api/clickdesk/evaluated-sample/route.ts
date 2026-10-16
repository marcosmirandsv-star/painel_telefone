import {
  ApiError,
  authorizeClickDeskSessionClient,
  handle,
  json,
} from '@/lib/integration-server'
import { getServerSupabaseConfig } from '@/lib/runtime-environment'
import { readFinalLedger } from '@/lib/clickdesk-ledger-server'

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

type EvaluatedRow = {
  clickdesk_ticket_id: string
  occurred_at: string
  occurred_date: string
  area: string
  satisfaction_label: string | null
  journey_status: string | null
  timestamp_source: string | null
}

function pickDistributedAcrossDates(items: EvaluatedRow[], limit: number) {
  if (items.length <= limit) {
    return [...items].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))
  }

  const sorted = [...items].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))
  const byDate = new Map<string, EvaluatedRow[]>()

  for (const item of sorted) {
    const bucket = byDate.get(item.occurred_date) ?? []
    bucket.push(item)
    byDate.set(item.occurred_date, bucket)
  }

  const dates = Array.from(byDate.keys()).sort()
  const selected: EvaluatedRow[] = []
  const selectedIds = new Set<string>()

  const add = (item?: EvaluatedRow) => {
    if (!item || selectedIds.has(item.clickdesk_ticket_id)) return
    selected.push(item)
    selectedIds.add(item.clickdesk_ticket_id)
  }

  if (dates.length >= limit) {
    for (let index = 0; index < limit; index += 1) {
      const position = Math.round((index * (dates.length - 1)) / (limit - 1))
      const bucket = byDate.get(dates[position]) ?? []
      add(bucket[Math.floor((bucket.length - 1) / 2)])
    }
  } else {
    for (const date of dates) {
      const bucket = byDate.get(date) ?? []
      add(bucket[Math.floor((bucket.length - 1) / 2)])
    }
  }

  if (selected.length < limit) {
    const remaining = sorted.filter((item) => !selectedIds.has(item.clickdesk_ticket_id))
    const missing = limit - selected.length

    for (let index = 0; index < missing; index += 1) {
      const position =
        missing <= 1
          ? Math.floor((remaining.length - 1) / 2)
          : Math.round((index * (remaining.length - 1)) / (missing - 1))
      add(remaining[position])
    }
  }

  return selected
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
    .slice(0, limit)
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

    // Same final-owner evidence as manager and individual performance.
    // Incomplete/pending tickets are excluded by readFinalLedger.
    const ledger = await readFinalLedger(access.admin, { start, end, analystId })
    const rows: EvaluatedRow[] = ledger
      .filter((row) => row.satisfaction_label === 'positive' || row.satisfaction_label === 'negative')
      .map((row) => ({
        clickdesk_ticket_id: row.ticket_id,
        occurred_at: row.last_public_at,
        occurred_date: row.occurred_date,
        area: row.area ?? 'Fila histórica não comprovada',
        satisfaction_label: row.satisfaction_label,
        journey_status: 'human_answer_confirmed',
        timestamp_source: 'last_public_human_answer',
      }))
    const negatives = rows.filter((row) => row.satisfaction_label === 'negative')
    const positives = rows.filter((row) => row.satisfaction_label === 'positive')
    const negativeSample = pickDistributedAcrossDates(negatives, 5)
    const positiveSample = pickDistributedAcrossDates(positives, 5)
    const sampled = [...negativeSample, ...positiveSample]

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
      source: 'clickdesk_final_ticket_ledger',
      analyst_id: analystId,
      period: { start, end },
      totals: {
        positive: positives.length,
        negative: negatives.length,
        evaluated: positives.length + negatives.length,
      },
      sample_rule: {
        negative_limit: 5,
        positive_limit: 5,
        strategy: 'distributed_across_dates',
      },
      negative: negativeSample.map(serialize),
      positive: positiveSample.map(serialize),
    })
  })
}
