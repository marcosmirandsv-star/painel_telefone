import { ApiError, authorizeManagerSessionClient, handle, json } from '@/lib/integration-server'
import { getServerSupabaseConfig } from '@/lib/runtime-environment'

export const runtime = 'nodejs'

const CLICKDESK_BASE_URL = 'https://api.desk.click.app/api/v1'
const MAX_HUMAN_PAGES = 100
const BUSINESS_TIME_ZONE = 'America/Sao_Paulo'

type TicketRow = {
  id: string
  area: string | null
  assignee: string | null
  timestamp: string | null
  timestampSource: string
  satisfaction: string | null
}

type AnalystRow = {
  id: string
  team_id: string
  name: string
  active: boolean
}

type LinkRow = {
  assignee_key: string
  assignee_name: string
  analyst_id: string
  link_source: 'auto_name_match' | 'manual'
  confirmed: boolean
}

function sanitizeMessage(message: string) {
  return message
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer ***')
    .replace(/[A-Za-z0-9_-]{32,}/g, '***')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeLabel(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function isTargetSupportName(name: string) {
  const normalized = normalizeLabel(name)
  return (
    (normalized.includes('suporte') && normalized.includes('erp')) ||
    (normalized.includes('suporte') && normalized.includes('fiscal'))
  )
}

function extractCollection(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload
  if (!payload || typeof payload !== 'object') return []
  const source = payload as Record<string, unknown>
  for (const key of ['data', 'items', 'results', 'tickets', 'conversations']) {
    if (Array.isArray(source[key])) return source[key] as unknown[]
  }
  return []
}

function primitiveString(value: unknown) {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number') return String(value)
  return null
}

function findFirstByKeyPattern(value: unknown, pattern: RegExp, depth = 0): string | null {
  if (!value || typeof value !== 'object' || depth > 4) return null

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFirstByKeyPattern(item, pattern, depth + 1)
      if (found) return found
    }
    return null
  }

  const source = value as Record<string, unknown>
  for (const [key, raw] of Object.entries(source)) {
    if (!pattern.test(key)) continue

    const direct = primitiveString(raw)
    if (direct) return direct

    if (raw && typeof raw === 'object') {
      const nested = raw as Record<string, unknown>
      for (const candidate of ['name', 'label', 'title', 'email', 'id']) {
        const nestedValue = primitiveString(nested[candidate])
        if (nestedValue) return nestedValue
      }
    }
  }

  for (const raw of Object.values(source)) {
    const found = findFirstByKeyPattern(raw, pattern, depth + 1)
    if (found) return found
  }

  return null
}

function findTargetArea(value: unknown, depth = 0): string | null {
  if (!value || typeof value !== 'object' || depth > 4) return null

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findTargetArea(item, depth + 1)
      if (found) return found
    }
    return null
  }

  const source = value as Record<string, unknown>
  for (const [key, raw] of Object.entries(source)) {
    if (!/(department|team|queue|group|support|area)/i.test(key)) continue

    const direct = primitiveString(raw)
    if (direct && isTargetSupportName(direct)) return direct

    if (raw && typeof raw === 'object') {
      const nested = raw as Record<string, unknown>
      for (const candidate of ['name', 'label', 'title']) {
        const nestedValue = primitiveString(nested[candidate])
        if (nestedValue && isTargetSupportName(nestedValue)) return nestedValue
      }
    }
  }

  for (const raw of Object.values(source)) {
    const found = findTargetArea(raw, depth + 1)
    if (found) return found
  }

  return null
}

function readTicketId(source: Record<string, unknown>, index: number) {
  for (const key of ['id', 'uuid', 'ticket_id', 'ticketId', 'conversation_id', 'conversationId']) {
    const value = primitiveString(source[key])
    if (value) return value
  }
  return `row-${index + 1}`
}

function readTimestamp(source: Record<string, unknown>) {
  const directKeys = [
    'closed_at',
    'closedAt',
    'ended_at',
    'endedAt',
    'created_at',
    'createdAt',
    'started_at',
    'startedAt',
    'updated_at',
    'updatedAt',
  ]

  for (const key of directKeys) {
    const value = primitiveString(source[key])
    if (value) return { value, source: key }
  }

  const fallback = findTimestampByKeyPattern(source, /(closed|ended|created|started|updated).*at/i)
  return fallback ?? { value: null, source: 'unknown' }
}

function findTimestampByKeyPattern(
  value: unknown,
  pattern: RegExp,
  depth = 0,
): { value: string; source: string } | null {
  if (!value || typeof value !== 'object' || depth > 4) return null

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findTimestampByKeyPattern(item, pattern, depth + 1)
      if (found) return found
    }
    return null
  }

  const source = value as Record<string, unknown>
  for (const [key, raw] of Object.entries(source)) {
    if (!pattern.test(key)) continue
    const direct = primitiveString(raw)
    if (direct) return { value: direct, source: key }
  }

  for (const raw of Object.values(source)) {
    const found = findTimestampByKeyPattern(raw, pattern, depth + 1)
    if (found) return found
  }

  return null
}

function readSatisfaction(source: Record<string, unknown>) {
  const satisfaction = source.satisfaction
  if (typeof satisfaction === 'string') return satisfaction.trim() || null

  if (satisfaction && typeof satisfaction === 'object') {
    const block = satisfaction as Record<string, unknown>
    for (const key of ['sentiment', 'rating', 'score', 'value', 'label']) {
      const value = primitiveString(block[key])
      if (value) return value
    }
  }

  return null
}

function summarizePayload(payload: unknown): TicketRow[] {
  return extractCollection(payload)
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null
      const source = item as Record<string, unknown>
      const timestamp = readTimestamp(source)
      return {
        id: readTicketId(source, index),
        area: findTargetArea(source),
        assignee: findFirstByKeyPattern(
          source,
          /(assignee|attendant|agent|owner|assigned.*user|responsible)/i,
        ),
        timestamp: timestamp.value,
        timestampSource: timestamp.source,
        satisfaction: readSatisfaction(source),
      }
    })
    .filter((item): item is TicketRow => Boolean(item))
}

function readPaginationNumber(payload: unknown, wantedKey: string, depth = 0): number | null {
  if (!payload || typeof payload !== 'object' || depth > 4) return null

  if (Array.isArray(payload)) {
    for (const item of payload) {
      const found = readPaginationNumber(item, wantedKey, depth + 1)
      if (found !== null) return found
    }
    return null
  }

  const source = payload as Record<string, unknown>
  for (const [key, raw] of Object.entries(source)) {
    if (key !== wantedKey) continue
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw
    if (typeof raw === 'string' && /^\d+$/.test(raw)) return Number(raw)
  }

  for (const raw of Object.values(source)) {
    if (!raw || typeof raw !== 'object') continue
    const found = readPaginationNumber(raw, wantedKey, depth + 1)
    if (found !== null) return found
  }

  return null
}

async function fetchClickDesk(path: string, apiKey: string, accountId: string) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)

  try {
    const response = await fetch(`${CLICKDESK_BASE_URL}${path}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'X-Account-Id': accountId,
        Accept: 'application/json',
      },
      cache: 'no-store',
      signal: controller.signal,
    })

    const text = await response.text()
    let payload: unknown = null

    try {
      payload = text ? JSON.parse(text) : null
    } catch {
      payload = { message: text.slice(0, 500) }
    }

    if (!response.ok) {
      const source =
        payload && typeof payload === 'object'
          ? (payload as Record<string, unknown>)
          : {}
      const message =
        typeof source.message === 'string'
          ? source.message
          : typeof source.error === 'string'
            ? source.error
            : `HTTP ${response.status}`
      throw new ApiError(response.status >= 500 ? 503 : 422, `ClickDesk: ${message}`)
    }

    return payload
  } finally {
    clearTimeout(timeout)
  }
}

async function fetchAllHumanPages(apiKey: string, accountId: string) {
  const first = await fetchClickDesk(
    '/tickets?inbox=conversations&attendance=human&page=1',
    apiKey,
    accountId,
  )
  const lastPage = Math.max(1, readPaginationNumber(first, 'last_page') ?? 1)

  if (lastPage > MAX_HUMAN_PAGES) {
    throw new ApiError(
      422,
      `A leitura humana retornou ${lastPage} páginas, acima do limite seguro de ${MAX_HUMAN_PAGES}.`,
    )
  }

  const payloads: unknown[] = [first]
  for (let startPage = 2; startPage <= lastPage; startPage += 5) {
    const pages = Array.from(
      { length: Math.min(5, lastPage - startPage + 1) },
      (_, index) => startPage + index,
    )
    const batch = await Promise.all(
      pages.map((page) =>
        fetchClickDesk(
          `/tickets?inbox=conversations&attendance=human&page=${page}`,
          apiKey,
          accountId,
        ),
      ),
    )
    payloads.push(...batch)
  }

  const seen = new Set<string>()
  const rows = payloads
    .flatMap(summarizePayload)
    .filter((row) => {
      if (seen.has(row.id)) return false
      seen.add(row.id)
      return true
    })

  return { rows, pagesScanned: payloads.length, lastPage }
}

function businessDate(timestamp: string) {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return null

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  if (!values.year || !values.month || !values.day) return null
  return `${values.year}-${values.month}-${values.day}`
}

function validDate(value: string) {
  return (
    /^20\d{2}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  )
}

function inclusiveDays(start: string, end: string) {
  return Math.round(
    (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000,
  ) + 1
}

async function parsePeriod(request: Request) {
  let body: { start?: unknown; end?: unknown; trigger_mode?: unknown } = {}
  try {
    body = await request.json()
  } catch {
    body = {}
  }

  const today = businessDate(new Date().toISOString())
  if (!today) throw new ApiError(503, 'Não foi possível determinar a data operacional.')

  const defaultStart = `${today.slice(0, 8)}01`
  const start = typeof body.start === 'string' && body.start ? body.start : defaultStart
  const requestedEnd = typeof body.end === 'string' && body.end ? body.end : today
  const end = requestedEnd > today ? today : requestedEnd
  const triggerMode = body.trigger_mode === 'automatic' ? 'automatic' : 'manual'

  if (!validDate(start) || !validDate(end) || start > end) {
    throw new ApiError(400, 'Período inválido. Use datas no formato AAAA-MM-DD.')
  }

  if (start > today) {
    throw new ApiError(400, 'O início da sincronização não pode estar no futuro.')
  }

  if (inclusiveDays(start, end) > 93) {
    throw new ApiError(400, 'A sincronização aceita no máximo 93 dias por execução.')
  }

  return { start, end, triggerMode }
}

async function upsertInBatches(
  admin: Awaited<ReturnType<typeof authorizeManagerSessionClient>>['admin'],
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string,
) {
  for (let index = 0; index < rows.length; index += 500) {
    const batch = rows.slice(index, index + 500)
    const { error } = await admin.from(table).upsert(batch, { onConflict })
    if (error) throw new ApiError(503, `Falha ao gravar ${table}: ${error.message}`)
  }
}

export async function POST(request: Request) {
  return handle(async () => {
    const { environment } = getServerSupabaseConfig()
    if (environment !== 'homologacao') {
      throw new ApiError(404, 'Sincronização ClickDesk disponível somente na homologação.')
    }

    const { admin, userId } = await authorizeManagerSessionClient(request)
    const { start, end, triggerMode } = await parsePeriod(request)

    const apiKey = process.env.CLICKDESK_API_KEY?.trim()
    const accountId = process.env.CLICKDESK_ACCOUNT_ID?.trim()
    if (!apiKey || !accountId) {
      throw new ApiError(503, 'Credenciais ClickDesk não configuradas.')
    }

    const runInsert = await admin
      .from('clickdesk_chat_sync_runs')
      .insert({
        period_start: start,
        period_end: end,
        trigger_mode: triggerMode,
        status: 'running',
        triggered_by: userId,
      })
      .select('id')
      .single()

    if (runInsert.error || !runInsert.data) {
      throw new ApiError(503, 'Não foi possível iniciar o registro da sincronização.')
    }

    const runId = runInsert.data.id as string

    try {
      const [{ rows, pagesScanned }, analystsResult, linksResult] = await Promise.all([
        fetchAllHumanPages(apiKey, accountId),
        admin.from('chat_analysts').select('id,team_id,name,active'),
        admin
          .from('clickdesk_chat_analyst_links')
          .select('assignee_key,assignee_name,analyst_id,link_source,confirmed'),
      ])

      if (analystsResult.error) {
        throw new ApiError(503, 'Não foi possível carregar o cadastro de analistas.')
      }
      if (linksResult.error) {
        throw new ApiError(503, 'Não foi possível carregar os vínculos do ClickDesk.')
      }

      const analysts = (analystsResult.data ?? []) as AnalystRow[]
      const links = (linksResult.data ?? []) as LinkRow[]
      const analystById = new Map(analysts.map((analyst) => [analyst.id, analyst]))
      const analystCandidates = new Map<string, AnalystRow[]>()

      analysts.forEach((analyst) => {
        const key = normalizeLabel(analyst.name)
        const current = analystCandidates.get(key) ?? []
        current.push(analyst)
        analystCandidates.set(key, current)
      })

      const linkByKey = new Map(links.map((link) => [link.assignee_key, link]))
      const withDates = rows
        .map((row) => ({
          ...row,
          occurredDate: row.timestamp ? businessDate(row.timestamp) : null,
        }))
        .filter(
          (row): row is TicketRow & { occurredDate: string } =>
            Boolean(row.timestamp && row.occurredDate),
        )
      const inPeriod = withDates.filter(
        (row) => row.occurredDate >= start && row.occurredDate <= end,
      )
      const targetRows = inPeriod.filter(
        (row) =>
          Boolean(row.area && isTargetSupportName(row.area)) &&
          Boolean(row.assignee?.trim()),
      )

      const distinctAssignees = new Map<string, string>()
      targetRows.forEach((row) => {
        const name = row.assignee?.trim()
        if (!name) return
        distinctAssignees.set(normalizeLabel(name), name)
      })

      const autoLinks: Record<string, unknown>[] = []
      distinctAssignees.forEach((assigneeName, assigneeKey) => {
        if (linkByKey.has(assigneeKey)) return
        const candidates = analystCandidates.get(assigneeKey) ?? []
        if (candidates.length !== 1) return

        const analyst = candidates[0]
        const link: LinkRow = {
          assignee_key: assigneeKey,
          assignee_name: assigneeName,
          analyst_id: analyst.id,
          link_source: 'auto_name_match',
          confirmed: false,
        }
        linkByKey.set(assigneeKey, link)
        autoLinks.push({
          ...link,
          updated_at: new Date().toISOString(),
        })
      })

      if (autoLinks.length) {
        await upsertInBatches(
          admin,
          'clickdesk_chat_analyst_links',
          autoLinks,
          'assignee_key',
        )
      }

      const now = new Date().toISOString()
      const attendanceRows = targetRows.map((row) => {
        const assigneeName = row.assignee?.trim() ?? ''
        const assigneeKey = normalizeLabel(assigneeName)
        const linked = linkByKey.get(assigneeKey)
        const analyst = linked ? analystById.get(linked.analyst_id) ?? null : null

        return {
          clickdesk_ticket_id: row.id,
          attendance_mode: 'human',
          occurred_at: row.timestamp,
          occurred_date: row.occurredDate,
          area: row.area,
          assignee_name: assigneeName,
          assignee_key: assigneeKey,
          analyst_id: analyst?.id ?? null,
          team_id: analyst?.team_id ?? null,
          satisfaction_label: row.satisfaction,
          timestamp_source: row.timestampSource,
          journey_status: 'ai_to_human',
          last_seen_at: now,
          updated_at: now,
        }
      })

      if (attendanceRows.length) {
        await upsertInBatches(
          admin,
          'clickdesk_chat_attendances',
          attendanceRows,
          'clickdesk_ticket_id',
        )
      }

      const unmatchedNames = [
        ...new Set(
          attendanceRows
            .filter((row) => !row.analyst_id)
            .map((row) => row.assignee_name)
            .filter(Boolean),
        ),
      ].sort((a, b) => a.localeCompare(b, 'pt-BR'))

      const matchedRows = attendanceRows.filter((row) => Boolean(row.analyst_id)).length
      const unmatchedRows = attendanceRows.length - matchedRows

      const updateRun = await admin
        .from('clickdesk_chat_sync_runs')
        .update({
          status: 'completed',
          pages_scanned: pagesScanned,
          rows_received: rows.length,
          rows_in_period: inPeriod.length,
          rows_target_scope: targetRows.length,
          rows_upserted: attendanceRows.length,
          matched_rows: matchedRows,
          unmatched_rows: unmatchedRows,
          unmatched_assignees: unmatchedNames,
          finished_at: new Date().toISOString(),
        })
        .eq('id', runId)

      if (updateRun.error) {
        throw new ApiError(503, 'Os dados foram gravados, mas o log da sincronização não foi finalizado.')
      }

      const daily = new Map<
        string,
        { date: string; attendances: number; positive: number; negative: number; reviews: number }
      >()

      attendanceRows.forEach((row) => {
        const current = daily.get(row.occurred_date) ?? {
          date: row.occurred_date,
          attendances: 0,
          positive: 0,
          negative: 0,
          reviews: 0,
        }
        current.attendances += 1
        const satisfaction = String(row.satisfaction_label ?? '').trim().toLowerCase()
        if (satisfaction === 'positive') {
          current.positive += 1
          current.reviews += 1
        } else if (satisfaction === 'negative') {
          current.negative += 1
          current.reviews += 1
        }
        daily.set(row.occurred_date, current)
      })

      return json({
        synced: true,
        run_id: runId,
        period: { start, end },
        source: 'clickdesk_human',
        journey_rule: 'attendance=human + Suporte ERP/Fiscal + responsável identificado',
        pages_scanned: pagesScanned,
        rows_received: rows.length,
        rows_in_period: inPeriod.length,
        rows_persisted: attendanceRows.length,
        matched_rows: matchedRows,
        unmatched_rows: unmatchedRows,
        unmatched_assignees: unmatchedNames,
        auto_links_created: autoLinks.length,
        daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)),
        synced_at: new Date().toISOString(),
      })
    } catch (error) {
      await admin
        .from('clickdesk_chat_sync_runs')
        .update({
          status: 'failed',
          finished_at: new Date().toISOString(),
          error_message: sanitizeMessage(
            error instanceof Error ? error.message : 'Falha inesperada na sincronização.',
          ),
        })
        .eq('id', runId)

      throw error
    }
  })
}
