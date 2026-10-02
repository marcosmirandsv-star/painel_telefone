import {
  ApiError,
  authorizeClickDeskAutomation,
  handle,
  json,
} from '@/lib/integration-server'
import { getServerSupabaseConfig } from '@/lib/runtime-environment'
import {
  qualitativeAnalysisVersion,
  QUALITATIVE_ANALYSIS_VERSION,
} from '@/lib/clickdesk-qualitative'

export const runtime = 'nodejs'
export const maxDuration = 300

const BUSINESS_TIME_ZONE = 'America/Sao_Paulo'

type AttendanceRow = {
  clickdesk_ticket_id: string
  satisfaction_label: string | null
  occurred_at: string
  team_id: string | null
}

type AnalysisRow = {
  clickdesk_ticket_id: string
  validation_status: string | null
  analysis: unknown
}

type AutoProcessRequest = {
  start?: string
  end?: string
  team_id?: string | null
  limit?: number
}

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

    const access = await authorizeClickDeskAutomation(request)
    const body = (await request.json().catch(() => ({}))) as AutoProcessRequest
    const today = businessDate()
    const start = typeof body.start === 'string' && body.start.trim() ? body.start.trim() : today
    const end = typeof body.end === 'string' && body.end.trim() ? body.end.trim() : start
    const teamId =
      typeof body.team_id === 'string' && body.team_id.trim()
        ? body.team_id.trim()
        : null
    const requestedLimit =
      typeof body.limit === 'number' && Number.isFinite(body.limit)
        ? Math.trunc(body.limit)
        : 6
    const limit = Math.max(1, Math.min(requestedLimit, 8))

    if (!validDate(start) || !validDate(end) || start > end) {
      throw new ApiError(400, 'Período inválido.')
    }
    if (teamId && !validUuid(teamId)) {
      throw new ApiError(400, 'team_id inválido.')
    }

    let attendanceQuery = access.admin
      .from('clickdesk_chat_attendances')
      .select('clickdesk_ticket_id,satisfaction_label,occurred_at,team_id')
      .eq('identity_role', 'analyst')
      .in('satisfaction_label', ['negative', 'positive'])
      .gte('occurred_date', start)
      .lte('occurred_date', end)
      .order('occurred_at', { ascending: true })

    if (teamId) attendanceQuery = attendanceQuery.eq('team_id', teamId)

    const attendanceResult = await attendanceQuery
    if (attendanceResult.error) {
      throw new ApiError(503, 'Não foi possível carregar a fila automática do 360º.')
    }

    const attendances = (attendanceResult.data ?? []) as AttendanceRow[]
    const attendanceIds = new Set(attendances.map((row) => row.clickdesk_ticket_id))

    const analysisResult = await access.admin
      .from('clickdesk_qualitative_analyses')
      .select('clickdesk_ticket_id,validation_status,analysis')
      .gte('occurred_date', start)
      .lte('occurred_date', end)

    if (analysisResult.error) {
      throw new ApiError(503, 'Não foi possível conferir as análises qualitativas existentes.')
    }

    const currentIds = new Set(
      ((analysisResult.data ?? []) as AnalysisRow[])
        .filter(
          (row) =>
            attendanceIds.has(row.clickdesk_ticket_id) &&
            row.validation_status !== 'rejected' &&
            qualitativeAnalysisVersion(row.analysis) >= QUALITATIVE_ANALYSIS_VERSION,
        )
        .map((row) => row.clickdesk_ticket_id),
    )

    const negative = attendances.filter(
      (row) =>
        row.satisfaction_label === 'negative' &&
        !currentIds.has(row.clickdesk_ticket_id),
    )
    const positive = attendances.filter(
      (row) =>
        row.satisfaction_label === 'positive' &&
        !currentIds.has(row.clickdesk_ticket_id),
    )

    const selected: AttendanceRow[] = []
    let ni = 0
    let pi = 0
    while (selected.length < limit && (ni < negative.length || pi < positive.length)) {
      if (ni < negative.length) selected.push(negative[ni++])
      if (selected.length < limit && pi < positive.length) selected.push(positive[pi++])
    }

    const authorization = request.headers.get('authorization') ?? ''
    const shareToken = new URL(request.url).searchParams.get('_vercel_share')?.trim() ?? ''
    const qualitativeUrl = new URL('/api/clickdesk/qualitative', request.url)
    if (shareToken) qualitativeUrl.searchParams.set('_vercel_share', shareToken)

    const processed: string[] = []
    const failed: { ticket_id: string; error: string }[] = []

    async function processTicket(row: AttendanceRow) {
      try {
        const response = await fetch(qualitativeUrl, {
          method: 'POST',
          headers: {
            Authorization: authorization,
            'Content-Type': 'application/json',
            'X-Central-Automation': 'clickdesk-sync',
          },
          body: JSON.stringify({
            ticket_id: row.clickdesk_ticket_id,
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
          const message = source.erro ?? source.error ?? `HTTP ${response.status}`
          failed.push({
            ticket_id: row.clickdesk_ticket_id,
            error: String(message).slice(0, 220),
          })
          return
        }
        processed.push(row.clickdesk_ticket_id)
      } catch (error) {
        failed.push({
          ticket_id: row.clickdesk_ticket_id,
          error: (error instanceof Error ? error.message : String(error)).slice(0, 220),
        })
      }
    }

    // Duas análises por vez equilibram vazão e proteção contra rajadas nos provedores.
    for (let index = 0; index < selected.length; index += 2) {
      await Promise.all(selected.slice(index, index + 2).map(processTicket))
    }

    const remainingBefore = negative.length + positive.length
    const remainingAfter = Math.max(0, remainingBefore - processed.length)

    return json({
      source: 'clickdesk_operation_360_auto_processor',
      period: { start, end },
      scope: { team_id: teamId },
      requested: selected.length,
      processed: processed.length,
      failed: failed.length,
      failures: failed,
      remaining_before_batch: {
        negative: negative.length,
        positive: positive.length,
        total: remainingBefore,
      },
      remaining_after_batch_estimate: remainingAfter,
      has_more: remainingAfter > 0,
      batch_limit: limit,
    })
  })
}
