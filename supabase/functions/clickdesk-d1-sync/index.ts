import { createClient } from 'npm:@supabase/supabase-js@2'

const CLICKDESK_BASE_URL = 'https://api.desk.click.app/api/v1'
const BUSINESS_TIME_ZONE = 'America/Sao_Paulo'
const MAX_HUMAN_PAGES = 100

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

function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
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
  const timeout = setTimeout(() => controller.abort(), 15000)
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

async function fetchAllHumanPages(apiKey: string, accountId: string) {
  const first = await fetchClickDesk(
    '/tickets?inbox=conversations&attendance=human&page=1',
    apiKey,
    accountId,
  )
  const lastPage = Math.max(1, readPaginationNumber(first, 'last_page') ?? 1)
  if (lastPage > MAX_HUMAN_PAGES) throw new Error('Volume humano acima do limite seguro.')

  const payloads: unknown[] = [first]
  for (let start = 2; start <= lastPage; start += 5) {
    const pages = Array.from(
      { length: Math.min(5, lastPage - start + 1) },
      (_, index) => start + index,
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
  const rows = payloads.flatMap(summarizePayload).filter((row) => {
    if (seen.has(row.id)) return false
    seen.add(row.id)
    return true
  })
  return { rows, pagesScanned: payloads.length }
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

  const today = businessDate(new Date().toISOString())
  if (!today) return Response.json({ error: 'Business date unavailable' }, { status: 500 })
  const end = shiftDate(today, -1)
  const start = shiftDate(end, -6)

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
    const [{ rows, pagesScanned }, analystsResult, linksResult, areaLinksResult, teamsResult] =
      await Promise.all([
        fetchAllHumanPages(apiKey, accountId),
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

    const operational = await resolveOperationalRows(
      targetCandidates,
      apiKey,
      accountId,
      start,
      end,
    )
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
        team_id: areaLink?.team_id ?? null,
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
        team_id: areaLink?.team_id ?? linked?.team_id ?? analyst?.team_id ?? null,
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
          window_days: 7,
          start,
          end,
        },
        finished_at: new Date().toISOString(),
      })
      .eq('id', runId)

    if (updateError) throw new Error(updateError.message)

    return Response.json({
      ok: true,
      run_id: runId,
      period: { start, end },
      rows_received: rows.length,
      rows_persisted: attendanceRows.length,
      analyst_rows: analystRows,
      management_rows: managementRows,
      unmapped_rows: unmappedRows,
      timestamp_audit: operational.audit,
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

    return Response.json({ error: 'ClickDesk D-1 sync failed' }, { status: 500 })
  }
})
