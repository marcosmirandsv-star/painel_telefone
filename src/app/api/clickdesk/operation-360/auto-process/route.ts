import {
  ApiError,
  authorizeClickDeskAutomation,
  callClickDeskAutomationDb,
  handle,
  json,
} from '@/lib/integration-server'
import { getServerSupabaseConfig } from '@/lib/runtime-environment'

export const runtime = 'nodejs'
export const maxDuration = 300

const BUSINESS_TIME_ZONE = 'America/Sao_Paulo'

type QueueItem = {
  clickdesk_ticket_id?: string
}

type QueueResponse = {
  items?: QueueItem[]
  remaining?: {
    negative?: number
    positive?: number
    total?: number
  }
}

type AutoProcessRequest = {
  start?: string
  end?: string
  limit?: number
}

function validDate(value: string) {
  return (
    /^20\d{2}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  )
}

function businessDate() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

async function readJson(response: Response) {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return { erro: text.slice(0, 300) }
  }
}

export async function POST(request: Request) {
  return handle(async () => {
    const { environment } = getServerSupabaseConfig()
    if (environment !== 'homologacao') {
      throw new ApiError(404, 'Automação 360º disponível somente na homologação.')
    }

    const automation = await authorizeClickDeskAutomation(request)
    const body = (await request.json().catch(() => ({}))) as AutoProcessRequest
    const today = businessDate()
    const start =
      typeof body.start === 'string' && body.start.trim()
        ? body.start.trim()
        : today
    const end =
      typeof body.end === 'string' && body.end.trim()
        ? body.end.trim()
        : start
    const requestedLimit =
      typeof body.limit === 'number' && Number.isFinite(body.limit)
        ? Math.trunc(body.limit)
        : 6
    const limit = Math.max(1, Math.min(requestedLimit, 8))

    if (!validDate(start) || !validDate(end) || start > end) {
      throw new ApiError(400, 'Período inválido.')
    }

    const queuePayload = (await callClickDeskAutomationDb(automation.token, {
      action: 'queue',
      start,
      end,
      limit,
    })) as QueueResponse

    const selected = Array.isArray(queuePayload.items)
      ? queuePayload.items
      : []
    const remaining = queuePayload.remaining ?? {}
    const authorization = request.headers.get('authorization') ?? ''
    const cookie = request.headers.get('cookie') ?? ''
    const baseUrl = new URL(request.url).origin

    const processed: string[] = []
    const failed: { ticket_id: string; error: string }[] = []

    async function processTicket(item: QueueItem) {
      const ticketId = item.clickdesk_ticket_id?.trim()
      if (!ticketId) return

      try {
        const response = await fetch(`${baseUrl}/api/clickdesk/qualitative`, {
          method: 'POST',
          headers: {
            Authorization: authorization,
            'Content-Type': 'application/json',
            'X-Central-Automation': 'clickdesk-sync',
            ...(cookie ? { Cookie: cookie } : {}),
          },
          body: JSON.stringify({
            ticket_id: ticketId,
            force: false,
          }),
          cache: 'no-store',
        })
        const payload = await readJson(response)

        if (!response.ok) {
          const source =
            payload && typeof payload === 'object'
              ? (payload as { erro?: unknown; error?: unknown })
              : {}
          const message =
            source.erro ?? source.error ?? `HTTP ${response.status}`
          failed.push({
            ticket_id: ticketId,
            error: String(message).slice(0, 220),
          })
          return
        }

        processed.push(ticketId)
      } catch (error) {
        failed.push({
          ticket_id: ticketId,
          error: (
            error instanceof Error ? error.message : String(error)
          ).slice(0, 220),
        })
      }
    }

    // Duas análises por vez equilibram vazão e proteção contra rajadas.
    for (let index = 0; index < selected.length; index += 2) {
      await Promise.all(selected.slice(index, index + 2).map(processTicket))
    }

    const beforeNegative = Number(remaining.negative ?? 0)
    const beforePositive = Number(remaining.positive ?? 0)
    const beforeTotal = Number(
      remaining.total ?? beforeNegative + beforePositive,
    )
    const afterEstimate = Math.max(0, beforeTotal - processed.length)

    return json({
      source: 'clickdesk_operation_360_auto_processor',
      period: { start, end },
      requested: selected.length,
      processed: processed.length,
      failed: failed.length,
      processed_ticket_ids: processed,
      failures: failed,
      remaining_before_batch: {
        negative: beforeNegative,
        positive: beforePositive,
        total: beforeTotal,
      },
      remaining_after_batch_estimate: afterEstimate,
      has_more: afterEstimate > 0,
      batch_limit: limit,
    })
  })
}
