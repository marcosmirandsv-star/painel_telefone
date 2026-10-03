import { createClient } from 'npm:@supabase/supabase-js@2'

const CLICKDESK_BASE_URL = 'https://api.desk.click.app/api/v1'
const BUSINESS_TIME_ZONE = 'America/Sao_Paulo'
const MAX_INTRADAY_HUMAN_PAGES = 30
const CLICKDESK_FETCH_TIMEOUT_MS = 30000

const CLICKDESK_REPORT_DEPARTMENTS = [
  { departmentId: 12, departmentName: 'Suporte - Fiscal' },
  { departmentId: 3, departmentName: 'Suporte - ERP' },
] as const

function reportObject(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {}
  const source = payload as Record<string, unknown>
  const data = source.data
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    return data as Record<string, unknown>
  }
  return source
}

function readPath(source: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = source
  for (const key of path) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return null
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

function numericValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
    return Number(value)
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return numericValue((value as Record<string, unknown>).value)
  }
  return null
}

function numberAt(source: Record<string, unknown>, path: string[]) {
  return numericValue(readPath(source, path))
}

function stringArrayAt(source: Record<string, unknown>, path: string[]) {
  const value = readPath(source, path)
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function numericDelta(left: number | null, right: number | null) {
  return left === null || right === null ? null : left - right
}

type TicketRow = {
  id: string
  area: string | null
  assignee: string | null
  satisfaction: string | null
  updatedAt: string | null
}

type OperationalRow = TicketRow & {
  operationalTimestamp: string
  operationalTimestampSource: string
  occurredDate: string
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

function isTargetArea(name: string) {
  const normalized = normalizeLabel(name)
  return (
    (normalized.includes('suporte') && normalized.includes('erp')) ||
    (normalized.includes('suporte') && normalized.includes('fiscal'))
  )
}

function primitiveString(value: unknown) {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number') return String(value)
  return null
}

function extractCollection(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload
  if (!payload || typeof payload !== 'object') return []
  const source = payload as Record<string, unknown>
  for (const key of ['data', 'items', 'results', 'tickets', 'conversations', 'messages']) {
    if (Array.isArray(source[key])) return source[key] as unknown[]
  }
  return []
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
    if (direct && isTargetArea(direct)) return direct
    if (raw && typeof raw === 'object') {
      const nested = raw as Record<string, unknown>
      for (const candidate of ['name', 'label', 'title']) {
        const nestedValue = primitiveString(nested[candidate])
        if (nestedValue && isTargetArea(nestedValue)) return nestedValue
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

function readUpdatedAt(source: Record<string, unknown>) {
  for (const key of ['updated_at', 'updatedAt', 'closed_at', 'closedAt', 'created_at', 'createdAt']) {
    const value = primitiveString(source[key])
    if (value && !Number.isNaN(Date.parse(value))) return value
  }
  return null
}

function summarizePayload(payload: unknown): TicketRow[] {
  return extractCollection(payload)
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null
      const source = item as Record<string, unknown>
      return {
        id: readTicketId(source, index),
        area: findTargetArea(source),
        assignee: findFirstByKeyPattern(
          source,
          /(assignee|attendant|agent|owner|assigned.*user|responsible)/i,
        ),
        satisfaction: readSatisfaction(source),
        updatedAt: readUpdatedAt(source),
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
  return values.year && values.month && values.day
    ? `${values.year}-${values.month}-${values.day}`
    : null
}

function readMessageTimestamp(source: Record<string, unknown>) {
  for (const key of [
    'created_at',
    'createdAt',
    'sent_at',
    'sentAt',
    'occurred_at',
    'occurredAt',
    'timestamp',
    'date',
    'updated_at',
    'updatedAt',
  ]) {
    const value = primitiveString(source[key])
    if (value && !Number.isNaN(Date.parse(value))) return value
  }
  return null
}

function containsAssigneeIdentity(value: unknown, assigneeKey: string, depth = 0): boolean {
  if (!value || typeof value !== 'object' || depth > 5) return false
  if (Array.isArray(value)) {
    return value.some((item) => containsAssigneeIdentity(item, assigneeKey, depth + 1))
  }
  const source = value as Record<string, unknown>
  for (const [key, raw] of Object.entries(source)) {
    if (!/(author|sender|agent|attendant|assignee|responsible|user|owner|name)/i.test(key)) {
      continue
    }
    const direct = primitiveString(raw)
    if (direct && normalizeLabel(direct) === assigneeKey) return true
    if (raw && typeof raw === 'object' && containsAssigneeIdentity(raw, assigneeKey, depth + 1)) {
      return true
    }
  }
  return false
}

function detectsHumanRole(value: unknown, depth = 0): boolean {
  if (!value || typeof value !== 'object' || depth > 5) return false
  if (Array.isArray(value)) return value.some((item) => detectsHumanRole(item, depth + 1))
  const source = value as Record<string, unknown>
  for (const [key, raw] of Object.entries(source)) {
    if (!/(role|type|source|author|sender|actor)/i.test(key)) continue
    const direct = primitiveString(raw)
    if (direct) {
      const normalized = normalizeLabel(direct)
      if (/(^| )(human|agent|attendant|atendente|analista|support)( |$)/.test(normalized)) {
        return true
      }
    }
    if (raw && typeof raw === 'object' && detectsHumanRole(raw, depth + 1)) return true
  }
  return false
}

async function fetchClickDesk(path: string, apiKey: string, accountId: string) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), CLICKDESK_FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(`${CLICKDESK_BASE_URL}${path}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'X-Account-Id': accountId,
        Accept: 'application/json',
      },
      signal: controller.signal,
    })
    const text = await response.text()
    const payload = text ? JSON.parse(text) : null
    if (!response.ok) throw new Error(`ClickDesk HTTP ${response.status}`)
    return payload
  } finally {
    clearTimeout(timeout)
  }
}


async function collectReportSnapshotRows(params: {
  admin: any
  apiKey: string
  accountId: string
  periodDate: string
  runId: string
  areaLinkByKey: Map<string, any>
}) {
  const { admin, apiKey, accountId, periodDate, runId, areaLinkByKey } = params
  const rows: Record<string, unknown>[] = []

  for (const department of CLICKDESK_REPORT_DEPARTMENTS) {
    const query =
      `from=${encodeURIComponent(periodDate)}&to=${encodeURIComponent(periodDate)}&department_id=${department.departmentId}`

    const [generalPayload, agentsPayload, aiPayload] = await Promise.all([
      fetchClickDesk(`/support/reports?${query}`, apiKey, accountId),
      fetchClickDesk(`/support/reports/agents?${query}`, apiKey, accountId),
      fetchClickDesk(`/support/reports/ai?${query}`, apiKey, accountId),
    ])

    const general = reportObject(generalPayload)
    const agents = reportObject(agentsPayload)
    const ai = reportObject(aiPayload)

    const teamId =
      areaLinkByKey.get(normalizeLabel(department.departmentName))?.team_id ?? null

    let humanAnswered: number | null = null
    if (teamId) {
      const countResult = await admin
        .from('clickdesk_chat_attendances')
        .select('clickdesk_ticket_id', { count: 'exact', head: true })
        .eq('occurred_date', periodDate)
        .eq('team_id', teamId)
        .eq('attendance_mode', 'human')

      if (countResult.error) throw new Error(countResult.error.message)
      humanAnswered = countResult.count ?? 0
    }

    const reportCreated = numberAt(general, ['totals', 'created', 'value'])
    const reportResolved = numberAt(general, ['totals', 'resolved', 'value'])
    const agentReceived = numberAt(agents, ['summary', 'received', 'value'])
    const agentResolved = numberAt(agents, ['summary', 'resolved'])
    const aiEscalated = numberAt(ai, ['handoff', 'escalated'])

    if (reportCreated === null && agentReceived === null && aiEscalated === null) {
      throw new Error(
        `ClickDesk reports returned no recognized summary fields for department ${department.departmentId}`,
      )
    }

    const timezone =
      findFirstByKeyPattern(generalPayload, /^(timezone|time_zone)$/i) ??
      BUSINESS_TIME_ZONE

    rows.push({
      sync_run_id: runId,
      period_date: periodDate,
      department_id: department.departmentId,
      department_name: department.departmentName,
      team_id: teamId,
      report_created: reportCreated,
      report_resolved: reportResolved,
      report_open_now: numberAt(general, ['totals', 'open_now']),
      report_waiting_now: numberAt(general, ['totals', 'waiting_now']),
      agent_received: agentReceived,
      agent_resolved: agentResolved,
      agent_transferred: numberAt(agents, ['summary', 'transferred']),
      ai_handled: numberAt(ai, ['containment', 'handled']),
      ai_decided: numberAt(ai, ['containment', 'decided']),
      ai_resolved_alone: numberAt(ai, ['containment', 'resolved_alone']),
      ai_escalated: aiEscalated,
      ai_abandoned: numberAt(ai, ['handoff', 'abandoned']),
      human_answered: humanAnswered,
      csat_pct: numberAt(general, ['csat', 'score_pct', 'value']),
      csat_total: numberAt(general, ['csat', 'total']),
      human_csat_pct: numberAt(ai, ['csat', 'human', 'value']),
      human_csat_total: numberAt(ai, ['csat', 'human', 'total']),
      report_first_response_seconds: numberAt(general, [
        'speed',
        'first_response_seconds',
        'value',
      ]),
      human_response_seconds: numberAt(general, [
        'speed',
        'human_response_seconds',
        'value',
      ]),
      agent_first_response_seconds: numberAt(agents, [
        'summary',
        'first_response_seconds',
        'value',
      ]),
      agent_handle_seconds: numberAt(agents, [
        'summary',
        'handle_seconds',
        'value',
      ]),
      resolution_seconds:
        numberAt(general, ['speed', 'resolution_seconds', 'value']) ??
        numberAt(agents, ['summary', 'resolution_seconds', 'value']),
      ai_time_to_escalate_seconds: numberAt(ai, [
        'handoff',
        'time_to_escalate_seconds',
        'value',
      ]),
      ai_wait_after_seconds: numberAt(ai, [
        'handoff',
        'wait_after_seconds',
        'value',
      ]),
      source_timezone: timezone,
      diagnostics: {
        requested_from: periodDate,
        requested_to: periodDate,
        report_series_labels: stringArrayAt(general, ['series', 'labels']),
        created_minus_agent_received: numericDelta(reportCreated, agentReceived),
        report_resolved_minus_agent_resolved: numericDelta(reportResolved, agentResolved),
        ai_escalated_minus_human_answered: numericDelta(aiEscalated, humanAnswered),
        human_answered_definition:
          'Accumulated attendance rows for the same date/team after the current sync cycle.',
      },
    })
  }
  return rows
}

async function fetchRecentHumanPages(
  apiKey: string,
  accountId: string,
  periodStart: string,
) {
  const first = await fetchClickDesk(
    '/tickets?inbox=conversations&attendance=human&page=1',
    apiKey,
    accountId,
  )
  const lastPage = Math.max(1, readPaginationNumber(first, 'last_page') ?? 1)
  const pagesToScan = Math.min(lastPage, MAX_INTRADAY_HUMAN_PAGES)

  const payloads: unknown[] = [first]
  for (let startPage = 2; startPage <= pagesToScan; startPage += 5) {
    const pages = Array.from(
      { length: Math.min(5, pagesToScan - startPage + 1) },
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

  const boundaryRows = summarizePayload(payloads[payloads.length - 1] ?? null)
  const boundaryDates = boundaryRows
    .map((row) => row.updatedAt ? businessDate(row.updatedAt) : null)
    .filter((value): value is string => Boolean(value))
    .sort()
  const boundaryOldestDate = boundaryDates[0] ?? null
  const boundaryNewestDate = boundaryDates.at(-1) ?? null
  const reachedOlderPeriod = boundaryDates.some((date) => date < periodStart)

  if (lastPage > pagesToScan && !reachedOlderPeriod) {
    throw new Error(
      `Janela recente insuficiente: ${pagesToScan} páginas ainda não alcançaram registros anteriores a ${periodStart}.`,
    )
  }

  const seen = new Set<string>()
  const rows = payloads.flatMap(summarizePayload).filter((row) => {
    if (seen.has(row.id)) return false
    seen.add(row.id)
    return true
  })

  return {
    rows,
    pagesScanned: payloads.length,
    totalPagesAvailable: lastPage,
    paginationAudit: {
      total_pages_available: lastPage,
      pages_scanned: payloads.length,
      page_cap: MAX_INTRADAY_HUMAN_PAGES,
      capped: lastPage > pagesToScan,
      boundary_rows: boundaryRows.length,
      boundary_oldest_date: boundaryOldestDate,
      boundary_newest_date: boundaryNewestDate,
      reached_older_period: reachedOlderPeriod,
      coverage_status:
        rows.length === 0
          ? 'empty_collection'
          : lastPage <= pagesToScan
            ? 'all_pages_scanned'
            : reachedOlderPeriod
              ? 'boundary_reached_older_period'
              : 'uncertain',
    },
  }
}

async function resolveOperationalRows(
  candidates: TicketRow[],
  apiKey: string,
  accountId: string,
  start: string,
  end: string,
) {
  const result: OperationalRow[] = []
  let firstAssignee = 0
  let firstHuman = 0
  let fallback = 0

  for (let index = 0; index < candidates.length; index += 8) {
    const batch = candidates.slice(index, index + 8)
    const resolved = await Promise.all(
      batch.map(async (row): Promise<OperationalRow | null> => {
        let timestamp: string | null = null
        let source = 'unknown'
        try {
          const payload = await fetchClickDesk(
            `/tickets/${encodeURIComponent(row.id)}/messages`,
            apiKey,
            accountId,
          )
          const messages = extractCollection(payload)
          const assigneeKey = normalizeLabel(row.assignee ?? '')
          const assigneeTimes: string[] = []
          const humanTimes: string[] = []

          for (const message of messages) {
            if (!message || typeof message !== 'object') continue
            const msg = message as Record<string, unknown>
            const time = readMessageTimestamp(msg)
            if (!time) continue
            if (assigneeKey && containsAssigneeIdentity(msg, assigneeKey)) assigneeTimes.push(time)
            if (detectsHumanRole(msg)) humanTimes.push(time)
          }

          assigneeTimes.sort((a, b) => Date.parse(a) - Date.parse(b))
          humanTimes.sort((a, b) => Date.parse(a) - Date.parse(b))

          if (assigneeTimes[0]) {
            timestamp = assigneeTimes[0]
            source = 'first_assignee_message'
            firstAssignee += 1
          } else if (humanTimes[0]) {
            timestamp = humanTimes[0]
            source = 'first_human_role_message'
            firstHuman += 1
          }
        } catch {
          // fallback explícito abaixo
        }

        if (!timestamp && row.updatedAt) {
          timestamp = row.updatedAt
          source = 'fallback_updated_at'
          fallback += 1
        }

        if (!timestamp) return null
        const occurredDate = businessDate(timestamp)
        if (!occurredDate || occurredDate < start || occurredDate > end) return null

        return {
          ...row,
          operationalTimestamp: timestamp,
          operationalTimestampSource: source,
          occurredDate,
        }
      }),
    )
    result.push(...resolved.filter((row): row is OperationalRow => Boolean(row)))
  }

  return {
    rows: result,
    audit: {
      rule: 'first_assignee_message -> first_human_role_message -> explicit_fallback',
      first_assignee_message: firstAssignee,
      first_human_role_message: firstHuman,
      fallback,
      validated: fallback === 0,
    },
  }
}

Deno.serve(async (req: Request) => {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim()
  if (!token) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const secretKeysRaw = Deno.env.get('SUPABASE_SECRET_KEYS')
  const legacyServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const secretKey = secretKeysRaw
    ? JSON.parse(secretKeysRaw)['default']
    : legacyServiceKey

  if (!supabaseUrl || !secretKey) {
    return Response.json({ error: 'Supabase admin config unavailable' }, { status: 500 })
  }

  const admin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const credentialsResult = await admin.rpc('get_clickdesk_cron_credentials', {
    p_token: token,
  })
  if (credentialsResult.error || !credentialsResult.data) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const apiKey = String(credentialsResult.data.api_key ?? '')
  const accountId = String(credentialsResult.data.account_id ?? '')
  if (!apiKey || !accountId) {
    return Response.json({ error: 'ClickDesk credentials unavailable' }, { status: 500 })
  }

  let requestBody: { mode?: unknown } = {}
  try {
    requestBody = await req.json()
  } catch {
    requestBody = {}
  }

  const today = businessDate(new Date().toISOString())
  if (!today) return Response.json({ error: 'Business date unavailable' }, { status: 500 })

  const requestedMode =
    typeof requestBody.mode === 'string' && requestBody.mode.trim()
      ? requestBody.mode.trim()
      : 'intraday'

  if (requestedMode !== 'intraday') {
    return Response.json(
      {
        error: 'Modo D-1 desativado. A sincronização automática opera somente em ciclo intradiário.',
      },
      { status: 400 },
    )
  }

  const mode = 'intraday' as const
  const start = today
  const end = today
  const windowDays = 1

  const runInsert = await admin
    .from('clickdesk_chat_sync_runs')
    .insert({
      period_start: start,
      period_end: end,
      trigger_mode: 'automatic',
      status: 'running',
    })
    .select('id')
    .single()

  if (runInsert.error || !runInsert.data) {
    return Response.json({ error: 'Unable to create sync run' }, { status: 500 })
  }
  const runId = runInsert.data.id as string

  try {
    const [{ rows, pagesScanned, totalPagesAvailable, paginationAudit }, analystsResult, linksResult, areaLinksResult, teamsResult] =
      await Promise.all([
        fetchRecentHumanPages(apiKey, accountId, start),
        admin.from('chat_analysts').select('id,team_id,name,active'),
        admin
          .from('clickdesk_chat_analyst_links')
          .select(
            'assignee_key,assignee_name,area_key,area_name,analyst_id,team_id,person_role,link_source,confirmed',
          ),
        admin
          .from('clickdesk_chat_area_links')
          .select('area_key,area_name,team_id,active')
          .eq('active', true),
        admin.from('chat_teams').select('id,manager_name'),
      ])

    for (const result of [analystsResult, linksResult, areaLinksResult, teamsResult]) {
      if (result.error) throw new Error(result.error.message)
    }

    const analysts = analystsResult.data ?? []
    const areaLinks = areaLinksResult.data ?? []
    const teams = teamsResult.data ?? []
    const analystById = new Map(analysts.map((item) => [item.id, item]))
    const analystCandidates = new Map<string, typeof analysts>()
    for (const analyst of analysts) {
      const key = normalizeLabel(analyst.name)
      const current = analystCandidates.get(key) ?? []
      current.push(analyst)
      analystCandidates.set(key, current)
    }
    const areaLinkByKey = new Map(areaLinks.map((item) => [item.area_key, item]))
    const identityKey = (assigneeKey: string, areaKey: string) =>
      `${assigneeKey}::${areaKey}`
    const linkByKey = new Map(
      (linksResult.data ?? []).map((link) => [
        identityKey(link.assignee_key, link.area_key),
        link,
      ]),
    )

    const targetCandidates = rows.filter(
      (row) =>
        Boolean(row.area && isTargetArea(row.area)) &&
        Boolean(row.assignee?.trim()) &&
        (!row.updatedAt || (businessDate(row.updatedAt) ?? today) >= start),
    )

    let operational: {
      rows: OperationalRow[]
      audit: {
        rule: string
        first_assignee_message: number
        first_human_role_message: number
        fallback: number
        validated: boolean
        reused_existing_timestamp?: number
        new_timestamp_lookups?: number
      }
    }

    if (mode === 'intraday' && targetCandidates.length > 0) {
      const existingByTicket = new Map<
        string,
        { occurred_at: string; occurred_date: string; timestamp_source: string | null }
      >()

      for (let index = 0; index < targetCandidates.length; index += 200) {
        const ids = targetCandidates.slice(index, index + 200).map((row) => row.id)
        const existingResult = await admin
          .from('clickdesk_chat_attendances')
          .select('clickdesk_ticket_id,occurred_at,occurred_date,timestamp_source')
          .in('clickdesk_ticket_id', ids)

        if (existingResult.error) throw new Error(existingResult.error.message)

        for (const item of existingResult.data ?? []) {
          if (!item.clickdesk_ticket_id || !item.occurred_at || !item.occurred_date) continue
          existingByTicket.set(item.clickdesk_ticket_id, {
            occurred_at: item.occurred_at,
            occurred_date: item.occurred_date,
            timestamp_source: item.timestamp_source,
          })
        }
      }

      const reusedRows: OperationalRow[] = []
      const newCandidates: TicketRow[] = []

      for (const row of targetCandidates) {
        const existing = existingByTicket.get(row.id)
        if (
          existing &&
          existing.occurred_date >= start &&
          existing.occurred_date <= end
        ) {
          reusedRows.push({
            ...row,
            operationalTimestamp: existing.occurred_at,
            operationalTimestampSource: existing.timestamp_source || 'persisted_timestamp',
            occurredDate: existing.occurred_date,
          })
        } else {
          newCandidates.push(row)
        }
      }

      const resolved = await resolveOperationalRows(
        newCandidates,
        apiKey,
        accountId,
        start,
        end,
      )

      operational = {
        rows: [...reusedRows, ...resolved.rows],
        audit: {
          ...resolved.audit,
          reused_existing_timestamp: reusedRows.length,
          new_timestamp_lookups: newCandidates.length,
        },
      }
    } else {
      operational = await resolveOperationalRows(
        targetCandidates,
        apiKey,
        accountId,
        start,
        end,
      )
    }

    const targetRows = operational.rows

    const identities = new Map<
      string,
      { assigneeName: string; assigneeKey: string; areaName: string; areaKey: string }
    >()
    for (const row of targetRows) {
      const assigneeName = row.assignee?.trim() ?? ''
      const areaName = row.area?.trim() ?? ''
      const assigneeKey = normalizeLabel(assigneeName)
      const areaKey = normalizeLabel(areaName)
      identities.set(identityKey(assigneeKey, areaKey), {
        assigneeName,
        assigneeKey,
        areaName,
        areaKey,
      })
    }

    const autoLinks: Record<string, unknown>[] = []
    for (const [compositeKey, identity] of identities.entries()) {
      if (linkByKey.has(compositeKey)) continue
      const candidates = analystCandidates.get(identity.assigneeKey) ?? []
      const analyst = candidates.length === 1 ? candidates[0] : null
      const areaLink = areaLinkByKey.get(identity.areaKey) ?? null
      const managerMatch = teams.some(
        (team) =>
          team.manager_name &&
          normalizeLabel(team.manager_name) === identity.assigneeKey,
      )
      const personRole = analyst ? 'analyst' : managerMatch ? 'management' : 'unmapped'
      const linkSource = analyst ? 'auto_name_match' : managerMatch ? 'manager_match' : 'unmatched'
      const link = {
        assignee_key: identity.assigneeKey,
        assignee_name: identity.assigneeName,
        area_key: identity.areaKey,
        area_name: identity.areaName,
        analyst_id: analyst?.id ?? null,
        team_id: analyst?.team_id ?? areaLink?.team_id ?? null,
        person_role: personRole,
        link_source: linkSource,
        confirmed: false,
        updated_at: new Date().toISOString(),
      }
      linkByKey.set(compositeKey, link)
      autoLinks.push(link)
    }

    if (autoLinks.length) {
      const { error } = await admin
        .from('clickdesk_chat_analyst_links')
        .upsert(autoLinks, { onConflict: 'assignee_key,area_key' })
      if (error) throw new Error(error.message)
    }

    const now = new Date().toISOString()
    const attendanceRows = targetRows.map((row) => {
      const assigneeName = row.assignee?.trim() ?? ''
      const areaName = row.area?.trim() ?? ''
      const assigneeKey = normalizeLabel(assigneeName)
      const areaKey = normalizeLabel(areaName)
      const linked = linkByKey.get(identityKey(assigneeKey, areaKey)) ?? null
      const analyst = linked?.analyst_id
        ? analystById.get(linked.analyst_id) ?? null
        : null
      const areaLink = areaLinkByKey.get(areaKey) ?? null

      return {
        clickdesk_ticket_id: row.id,
        attendance_mode: 'human',
        occurred_at: row.operationalTimestamp,
        occurred_date: row.occurredDate,
        area: areaName,
        assignee_name: assigneeName,
        assignee_key: assigneeKey,
        analyst_id: analyst?.id ?? null,
        team_id: analyst?.team_id ?? linked?.team_id ?? areaLink?.team_id ?? null,
        identity_role: linked?.person_role ?? 'unmapped',
        satisfaction_label: row.satisfaction,
        timestamp_source: row.operationalTimestampSource,
        journey_status: 'ai_to_human',
        last_seen_at: now,
        updated_at: now,
      }
    })

    if (attendanceRows.length) {
      const { error } = await admin
        .from('clickdesk_chat_attendances')
        .upsert(attendanceRows, { onConflict: 'clickdesk_ticket_id' })
      if (error) throw new Error(error.message)
    }

    let reportSnapshots = 0
    let reportSnapshotError: string | null = null
    try {
      const reportRows = await collectReportSnapshotRows({
        admin,
        apiKey,
        accountId,
        periodDate: start,
        runId,
        areaLinkByKey,
      })
      if (reportRows.length) {
        const reportResult = await admin
          .from('clickdesk_chat_report_snapshots')
          .upsert(reportRows, { onConflict: 'sync_run_id,department_id' })
        if (reportResult.error) throw new Error(reportResult.error.message)
        reportSnapshots = reportRows.length
      }
    } catch (error) {
      reportSnapshotError =
        error instanceof Error ? error.message.slice(0, 500) : 'Unexpected report snapshot error'
    }

    const analystRows = attendanceRows.filter((row) => row.identity_role === 'analyst').length
    const managementRows = attendanceRows.filter((row) => row.identity_role === 'management').length
    const unmappedRows = attendanceRows.filter((row) => row.identity_role === 'unmapped').length
    const unmatchedNames = [
      ...new Set(
        attendanceRows
          .filter((row) => row.identity_role === 'unmapped')
          .map((row) => row.assignee_name),
      ),
    ].sort((a, b) => a.localeCompare(b, 'pt-BR'))

    const { error: updateError } = await admin
      .from('clickdesk_chat_sync_runs')
      .update({
        status: 'completed',
        pages_scanned: pagesScanned,
        rows_received: rows.length,
        rows_in_period: targetRows.length,
        rows_target_scope: targetRows.length,
        rows_upserted: attendanceRows.length,
        matched_rows: analystRows + managementRows,
        unmatched_rows: unmappedRows,
        analyst_rows: analystRows,
        management_rows: managementRows,
        unmapped_rows: unmappedRows,
        unmatched_assignees: unmatchedNames,
        timestamp_audit: {
          ...operational.audit,
          version: 2,
          total_candidates: targetRows.length,
          window_days: windowDays,
          sync_mode: mode,
          start,
          end,
          total_pages_available: totalPagesAvailable,
          pagination: paginationAudit,
          report_snapshots: reportSnapshots,
          report_snapshot_error: reportSnapshotError,
        },
        finished_at: new Date().toISOString(),
      })
      .eq('id', runId)

    if (updateError) throw new Error(updateError.message)

    return Response.json({
      ok: true,
      run_id: runId,
      mode,
      period: { start, end },
      rows_received: rows.length,
      rows_persisted: attendanceRows.length,
      pagination: paginationAudit,
      analyst_rows: analystRows,
      management_rows: managementRows,
      unmapped_rows: unmappedRows,
      timestamp_audit: operational.audit,
      report_snapshots: reportSnapshots,
      report_snapshot_error: reportSnapshotError,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected sync error'
    await admin
      .from('clickdesk_chat_sync_runs')
      .update({
        status: 'failed',
        error_message: message.slice(0, 500),
        finished_at: new Date().toISOString(),
      })
      .eq('id', runId)

    return Response.json({ error: 'ClickDesk automatic sync failed' }, { status: 500 })
  }
})
