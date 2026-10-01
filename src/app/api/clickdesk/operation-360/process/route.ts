import {
  ApiError,
  authorizeClickDeskSessionClient,
  handle,
  json,
} from '@/lib/integration-server'
import { getServerSupabaseConfig } from '@/lib/runtime-environment'

export const runtime = 'nodejs'
export const maxDuration = 300

type QueueItem = {
  ticket_id?: string
}

type Operation360Payload = {
  queues?: {
    negative_unanalyzed?: QueueItem[]
    positive_unanalyzed?: QueueItem[]
  }
}

type ProcessRequest = {
  start?: string
  end?: string
  team_id?: string | null
  limit?: number
}

function validDate(value: string) {
  return /^20\d{2}-\d{2}-\d{2}$/.test(value)
}

function validUuid(value: string) {
  return /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)
}

async function readJson(response: Response) {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return { error: text.slice(0, 500) }
  }
}

export async function POST(request: Request) {
  return handle(async () => {
    const { environment } = getServerSupabaseConfig()
    if (environment !== 'homologacao') {
      throw new ApiError(404, 'Processamento 360º disponível somente na homologação.')
    }

    const access = await authorizeClickDeskSessionClient(request)
    if (!access.isManagement) {
      throw new ApiError(403, 'Processamento 360º disponível somente para a gestão.')
    }

    const body = (await request.json().catch(() => null)) as ProcessRequest | null
    const start = body?.start?.trim() ?? ''
    const end = body?.end?.trim() ?? ''
    const teamId = body?.team_id?.trim() || null
    const limit = Math.max(1, Math.min(Math.trunc(body?.limit ?? 20), 30))

    if (!validDate(start) || !validDate(end) || start > end) {
      throw new ApiError(400, 'Período inválido.')
    }
    if (teamId && !validUuid(teamId)) {
      throw new ApiError(400, 'team_id inválido.')
    }

    const baseUrl = new URL(request.url).origin
    const authorization = request.headers.get('authorization') ?? ''
    const cookie = request.headers.get('cookie') ?? ''
    const forwardHeaders: Record<string, string> = {}
    if (authorization) forwardHeaders.Authorization = authorization
    if (cookie) forwardHeaders.cookie = cookie

    const query = new URLSearchParams({ start, end })
    if (teamId) query.set('team_id', teamId)

    // Reutiliza a própria rota 360º como fonte única da fila. Assim a população
    // processada é exatamente a mesma exibida no painel (somente operação válida).
    const queueResponse = await fetch(
      `${baseUrl}/api/clickdesk/operation-360?${query.toString()}`,
      { headers: forwardHeaders, cache: 'no-store' },
    )
    const queuePayload = (await readJson(queueResponse)) as Operation360Payload | null
    if (!queueResponse.ok || !queuePayload?.queues) {
      throw new ApiError(503, 'Não foi possível carregar a fila pendente do 360º.')
    }

    const negative = queuePayload.queues.negative_unanalyzed ?? []
    const positive = queuePayload.queues.positive_unanalyzed ?? []
    // Prioriza negativas, mas não deixa as positivas paradas indefinidamente.
    const selected: QueueItem[] = []
    let ni = 0
    let pi = 0
    while (selected.length < limit && (ni < negative.length || pi < positive.length)) {
      if (ni < negative.length) selected.push(negative[ni++])
      if (selected.length < limit && pi < positive.length) selected.push(positive[pi++])
    }

    const processed: string[] = []
    const failed: { ticket_id: string; error: string }[] = []

    // Sequencial de propósito: evita rajadas no ClickDesk e no provedor de IA.
    for (const item of selected) {
      const ticketId = item.ticket_id?.trim()
      if (!ticketId) continue
      try {
        const response = await fetch(`${baseUrl}/api/clickdesk/qualitative`, {
          method: 'POST',
          headers: {
            ...forwardHeaders,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ ticket_id: ticketId, force: false }),
          cache: 'no-store',
        })
        const payload = await readJson(response)
        if (!response.ok) {
          const message =
            payload && typeof payload === 'object' && 'error' in payload
              ? String((payload as { error?: unknown }).error ?? `HTTP ${response.status}`)
              : `HTTP ${response.status}`
          failed.push({ ticket_id: ticketId, error: message.slice(0, 240) })
          continue
        }
        processed.push(ticketId)
      } catch (error) {
        failed.push({
          ticket_id: ticketId,
          error: (error instanceof Error ? error.message : String(error)).slice(0, 240),
        })
      }
    }

    const afterResponse = await fetch(
      `${baseUrl}/api/clickdesk/operation-360?${query.toString()}`,
      { headers: forwardHeaders, cache: 'no-store' },
    )
    const afterPayload = (await readJson(afterResponse)) as Operation360Payload | null
    const afterNegative = afterPayload?.queues?.negative_unanalyzed ?? []
    const afterPositive = afterPayload?.queues?.positive_unanalyzed ?? []

    return json({
      source: 'clickdesk_operation_360_processor',
      requested: selected.length,
      processed: processed.length,
      failed: failed.length,
      processed_ticket_ids: processed,
      failures: failed,
      remaining_before_batch: {
        negative: negative.length,
        positive: positive.length,
        total: negative.length + positive.length,
      },
      remaining_after_batch: {
        negative: afterNegative.length,
        positive: afterPositive.length,
        total: afterNegative.length + afterPositive.length,
      },
      has_more: afterNegative.length + afterPositive.length > 0,
      batch_limit: limit,
    })
  })
}
