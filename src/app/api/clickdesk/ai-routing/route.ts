import { createClient } from '@supabase/supabase-js'
import { getServerSupabaseConfig } from '@/lib/runtime-environment'
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

const CLICKDESK_BASE_URL = 'https://api.desk.click.app/api/v1'

type SafeValue = {
  path: string
  value: string
}

type AiSample = {
  ticket_id: string
  list_timestamp: string | null
  list_area: string | null
  detail_available: boolean
  transcript_available: boolean
  detail_area: string | null
  transcript_area: string | null
  detail_keys: string[]
  transcript_keys: string[]
  routing_values: SafeValue[]
  run_correlations: {
    value: string
    ticket_path: string
    run_path: string
  }[]
  error?: string
}

function normalizeRole(role: unknown) {
  if (typeof role !== 'string') return null
  const normalized = role.toLowerCase()
  if (normalized === 'master') return 'master'
  if (normalized === 'coordenadora' || normalized === 'coordinator') return 'coordinator'
  return null
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

function primitiveString(value: unknown) {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

function extractCollection(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload
  if (!payload || typeof payload !== 'object') return []
  const source = payload as Record<string, unknown>
  for (const key of ['data', 'items', 'results', 'tickets', 'conversations', 'agents', 'runs']) {
    if (Array.isArray(source[key])) return source[key] as unknown[]
  }
  return []
}

function readTicketId(value: unknown, fallback: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback
  const source = value as Record<string, unknown>
  for (const key of ['id', 'uuid', 'ticket_id', 'ticketId', 'conversation_id', 'conversationId']) {
    const found = primitiveString(source[key])
    if (found) return found
  }
  return fallback
}

function readTimestamp(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value as Record<string, unknown>
  for (const key of ['closed_at', 'closedAt', 'ended_at', 'endedAt', 'created_at', 'createdAt', 'started_at', 'startedAt', 'updated_at', 'updatedAt']) {
    const found = primitiveString(source[key])
    if (found) return found
  }
  return null
}

function isInMonth(timestamp: string | null, year: number, month: number) {
  if (!timestamp) return true
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return true
  return date.getFullYear() === year && date.getMonth() + 1 === month
}

function findTargetArea(value: unknown, depth = 0): string | null {
  if (!value || typeof value !== 'object' || depth > 6) return null

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

    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
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

function extractRoutingValues(value: unknown) {
  const values: SafeValue[] = []
  const seen = new Set<string>()

  const visit = (current: unknown, depth = 0, path = '$') => {
    if (current === null || current === undefined || depth > 6) return

    if (Array.isArray(current)) {
      current.slice(0, 100).forEach((item, index) => visit(item, depth + 1, `${path}[${index}]`))
      return
    }

    if (typeof current !== 'object') return

    for (const [key, raw] of Object.entries(current as Record<string, unknown>)) {
      const currentPath = `${path}.${key}`
      const routingKey = /(department|team|queue|group|agent|assistant|flow|channel|source|origin|route|routing|handoff|transfer|escalat|attendance|conversation|run|uid|token|pipeline)/i.test(key)
      const sensitiveKey = /(email|phone|telefone|name|nome|requester|customer|visitor|subject|content|body|message|text|comment)/i.test(key)

      if (routingKey && !sensitiveKey && (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean')) {
        const rawValue = String(raw).trim()
        const normalized = normalizeLabel(rawValue)
        const tooGeneric =
          !rawValue ||
          ['true', 'false', 'chat', 'text', 'date', 'multiselect', 'object', 'string', 'number'].includes(normalized)

        if (!tooGeneric) {
          const signature = `${currentPath}::${rawValue}`
          if (!seen.has(signature) && values.length < 80) {
            seen.add(signature)
            values.push({ path: currentPath, value: rawValue.slice(0, 160) })
          }
        }
      }

      if (raw && typeof raw === 'object') visit(raw, depth + 1, currentPath)
    }
  }

  visit(value)
  return values
}

function extractPagination(payload: unknown) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {}
  const out: Record<string, string | number | boolean | null> = {}

  const visit = (value: Record<string, unknown>, prefix = '') => {
    for (const [key, raw] of Object.entries(value)) {
      const path = prefix ? `${prefix}.${key}` : key
      if (/(current_page|last_page|per_page|total|count|next_page|prev_page)/i.test(key)) {
        if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean' || raw === null) {
          out[path] = raw
        }
      }
      if (raw && typeof raw === 'object' && !Array.isArray(raw) && /(meta|pagination|paging|page)/i.test(key)) {
        visit(raw as Record<string, unknown>, path)
      }
    }
  }

  visit(payload as Record<string, unknown>)
  return out
}

function topLevelKeys(payload: unknown) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return []
  return Object.keys(payload as Record<string, unknown>).slice(0, 40)
}

function readDepartmentIds(value: unknown) {
  const ids = new Set<string>()

  const visit = (current: unknown, depth = 0) => {
    if (!current || typeof current !== 'object' || depth > 6) return

    if (Array.isArray(current)) {
      current.slice(0, 100).forEach((item) => visit(item, depth + 1))
      return
    }

    for (const [key, raw] of Object.entries(current as Record<string, unknown>)) {
      if (/^department_?id$/i.test(key) || /^support_department_?id$/i.test(key)) {
        const id = primitiveString(raw)
        if (id) ids.add(id)
      }
      if (raw && typeof raw === 'object') visit(raw, depth + 1)
    }
  }

  visit(value)
  return [...ids]
}

function normalizeDepartments(payload: unknown) {
  return extractCollection(payload)
    .map((item, index) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null
      const source = item as Record<string, unknown>
      const id =
        primitiveString(source.id) ??
        primitiveString(source.department_id) ??
        primitiveString(source.uuid) ??
        String(index + 1)
      const name =
        primitiveString(source.name) ??
        primitiveString(source.title) ??
        primitiveString(source.label) ??
        `Departamento ${id}`
      return { id, name }
    })
    .filter((item): item is { id: string; name: string } => Boolean(item))
}

function readFirstByKeys(value: unknown, keys: RegExp[], depth = 0): string | null {
  if (!value || typeof value !== 'object' || depth > 5) return null

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = readFirstByKeys(item, keys, depth + 1)
      if (found) return found
    }
    return null
  }

  const source = value as Record<string, unknown>
  for (const [key, raw] of Object.entries(source)) {
    if (keys.some((pattern) => pattern.test(key))) {
      const found = primitiveString(raw)
      if (found) return found
    }
  }

  for (const raw of Object.values(source)) {
    const found = readFirstByKeys(raw, keys, depth + 1)
    if (found) return found
  }

  return null
}

function extractSafeScalars(value: unknown) {
  const values: SafeValue[] = []
  const seen = new Set<string>()

  const visit = (current: unknown, depth = 0, path = '$') => {
    if (current === null || current === undefined || depth > 5) return

    if (Array.isArray(current)) {
      current.slice(0, 80).forEach((item, index) => visit(item, depth + 1, `${path}[${index}]`))
      return
    }

    if (typeof current !== 'object') return

    for (const [key, raw] of Object.entries(current as Record<string, unknown>)) {
      const currentPath = `${path}.${key}`
      const sensitive =
        /(email|phone|telefone|name|nome|requester|customer|visitor|subject|content|body|message|text|comment|token|secret|password)/i.test(
          key,
        )

      if (!sensitive && (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean')) {
        const rawValue = String(raw).trim()
        if (rawValue && rawValue.length <= 180) {
          const signature = `${currentPath}::${rawValue}`
          if (!seen.has(signature) && values.length < 120) {
            seen.add(signature)
            values.push({ path: currentPath, value: rawValue })
          }
        }
      }

      if (raw && typeof raw === 'object') visit(raw, depth + 1, currentPath)
    }
  }

  visit(value)
  return values
}

function chooseRunUid(source: Record<string, unknown>) {
  const preferredKeys = [
    'uid',
    'run_uid',
    'runUid',
    'execution_uid',
    'executionUid',
    'run_id',
    'runId',
    'execution_id',
    'executionId',
    'uuid',
    'id',
  ]

  for (const key of preferredKeys) {
    const value = primitiveString(source[key])
    if (value) return { value, source: key }
  }

  const nested = readFirstByKeys(source, [
    /^run_?uid$/i,
    /^execution_?uid$/i,
    /^run_?id$/i,
    /^execution_?id$/i,
    /^uid$/i,
  ])
  if (nested) return { value: nested, source: 'nested' }

  return null
}

function summarizeAgentRuns(payload: unknown) {
  return extractCollection(payload)
    .map((item, index) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null
      const source = item as Record<string, unknown>
      const chosenUid = chooseRunUid(source)
      const uid = chosenUid?.value ?? `run-${index + 1}`
      const agentId = readFirstByKeys(source, [/^agent_?id$/i, /^ai_agent_?id$/i])
      const conversationId = readFirstByKeys(source, [
        /^conversation_?id$/i,
        /^ticket_?id$/i,
        /^conversation$/i,
        /^ticket$/i,
      ])
      const routingValues = extractRoutingValues(source)
      const safeScalars = extractSafeScalars(source)
      const identifierCandidates = safeScalars.filter((item) =>
        /(uid|run|execution|conversation|ticket|agent|id)/i.test(item.path),
      )

      return {
        uid,
        uid_source: chosenUid?.source ?? null,
        uid_is_fallback: !chosenUid,
        agent_id: agentId,
        conversation_id: conversationId,
        top_level_keys: Object.keys(source).slice(0, 60),
        routing_values: routingValues.slice(0, 30),
        safe_scalars: safeScalars.slice(0, 50),
        identifier_candidates: identifierCandidates.slice(0, 30),
      }
    })
    .filter(
      (item): item is {
        uid: string
        uid_source: string | null
        uid_is_fallback: boolean
        agent_id: string | null
        conversation_id: string | null
        top_level_keys: string[]
        routing_values: SafeValue[]
        safe_scalars: SafeValue[]
        identifier_candidates: SafeValue[]
      } => Boolean(item),
    )
}

function summarizeAgents(payload: unknown, departmentNames: Map<string, string>) {
  return extractCollection(payload)
    .map((item, index) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null
      const source = item as Record<string, unknown>
      const id =
        primitiveString(source.id) ??
        primitiveString(source.uuid) ??
        primitiveString(source.uid) ??
        `agent-${index + 1}`
      const name =
        primitiveString(source.name) ??
        primitiveString(source.title) ??
        primitiveString(source.label) ??
        id
      const routingValues = extractRoutingValues(source)
      const handoffDepartmentIds = readDepartmentIds(source)
      const handoffDepartments = handoffDepartmentIds.map((departmentId) => ({
        id: departmentId,
        name: departmentNames.get(departmentId) ?? null,
        target: departmentNames.has(departmentId)
          ? isTargetSupportName(departmentNames.get(departmentId) ?? '')
          : false,
      }))
      return {
        id,
        name,
        routing_values: routingValues.slice(0, 12),
        handoff_departments: handoffDepartments,
        target_handoff_departments: handoffDepartments.filter((item) => item.target),
      }
    })
    .filter(
      (
        item,
      ): item is {
        id: string
        name: string
        routing_values: SafeValue[]
        handoff_departments: { id: string; name: string | null; target: boolean }[]
        target_handoff_departments: { id: string; name: string | null; target: boolean }[]
      } => Boolean(item),
    )
}

function collectRunValues(payload: unknown) {
  return extractCollection(payload).flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    return extractRoutingValues(item)
  })
}

function correlateValues(ticketValues: SafeValue[], runValues: SafeValue[]) {
  const byValue = new Map<string, SafeValue[]>()
  runValues.forEach((item) => {
    const normalized = item.value.trim()
    if (normalized.length < 4) return
    const bucket = byValue.get(normalized) ?? []
    bucket.push(item)
    byValue.set(normalized, bucket)
  })

  const matches: { value: string; ticket_path: string; run_path: string }[] = []
  ticketValues.forEach((ticketItem) => {
    const runMatches = byValue.get(ticketItem.value.trim())
    if (!runMatches) return
    runMatches.slice(0, 2).forEach((runItem) => {
      if (matches.length < 12) {
        matches.push({
          value: ticketItem.value,
          ticket_path: ticketItem.path,
          run_path: runItem.path,
        })
      }
    })
  })
  return matches
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
      const source = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
      const message =
        typeof source.message === 'string'
          ? source.message
          : typeof source.error === 'string'
            ? source.error
            : `HTTP ${response.status}`
      throw new Error(`${path}: ${message}`)
    }

    return payload
  } finally {
    clearTimeout(timeout)
  }
}

export async function GET(request: NextRequest) {
  try {
    const { url: supabaseUrl, publishableKey, environment } = getServerSupabaseConfig()
    if (environment !== 'homologacao') {
      return NextResponse.json({ error: 'Recurso disponível somente na homologação.' }, { status: 404 })
    }

    const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim()
    if (!token) return NextResponse.json({ error: 'Sessão não encontrada.' }, { status: 401 })

    const client = createClient(supabaseUrl, publishableKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    })

    const {
      data: { user },
      error: userError,
    } = await client.auth.getUser(token)

    if (userError || !user) {
      return NextResponse.json({ error: 'Sessão inválida.' }, { status: 401 })
    }

    const { data: profile, error: profileError } = await client
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle()

    if (profileError || !normalizeRole(profile?.role)) {
      return NextResponse.json({ error: 'Recurso disponível apenas para a gestão.' }, { status: 403 })
    }

    const apiKey = process.env.CLICKDESK_API_KEY?.trim()
    const accountId = process.env.CLICKDESK_ACCOUNT_ID?.trim()
    if (!apiKey || !accountId) {
      return NextResponse.json({ error: 'Credenciais ClickDesk não configuradas.' }, { status: 503 })
    }

    const now = new Date()
    const year = Number(request.nextUrl.searchParams.get('year')) || now.getFullYear()
    const month = Number(request.nextUrl.searchParams.get('month')) || now.getMonth() + 1

    const pagePayloads: unknown[] = []
    const pageErrors: string[] = []
    for (let page = 1; page <= 5; page += 1) {
      try {
        pagePayloads.push(
          await fetchClickDesk(
            `/tickets?inbox=conversations&attendance=ai&page=${page}`,
            apiKey,
            accountId,
          ),
        )
      } catch (error) {
        pageErrors.push(sanitizeMessage(error instanceof Error ? error.message : String(error)))
      }
    }

    const listed = pagePayloads
      .flatMap((payload) => extractCollection(payload))
      .map((item, index) => ({
        raw: item,
        id: readTicketId(item, `row-${index + 1}`),
        timestamp: readTimestamp(item),
        list_area: findTargetArea(item),
      }))
      .filter((item, index, rows) => rows.findIndex((candidate) => candidate.id === item.id) === index)
      .filter((item) => isInMonth(item.timestamp, year, month))

    const sampleRows = listed.slice(0, 12)

    const [agentsResult, runsResult, departmentsResult] = await Promise.allSettled([
      fetchClickDesk('/ai/agents', apiKey, accountId),
      fetchClickDesk('/agent-runs', apiKey, accountId),
      fetchClickDesk('/support-departments', apiKey, accountId),
    ])

    const agentsPayload = agentsResult.status === 'fulfilled' ? agentsResult.value : null
    const runsPayload = runsResult.status === 'fulfilled' ? runsResult.value : null
    const departmentsPayload = departmentsResult.status === 'fulfilled' ? departmentsResult.value : null
    const departments = departmentsPayload ? normalizeDepartments(departmentsPayload) : []
    const targetDepartments = departments.filter((item) => isTargetSupportName(item.name))
    const departmentNames = new Map(targetDepartments.map((item) => [item.id, item.name]))
    const agentSummaries = agentsPayload ? summarizeAgents(agentsPayload, departmentNames) : []
    const runSummaries = runsPayload ? summarizeAgentRuns(runsPayload) : []
    const runValues = runsPayload ? collectRunValues(runsPayload) : []

    const runsForDetail = runSummaries.filter((run) => !run.uid_is_fallback).slice(0, 5)
    const runDetailResults = await Promise.allSettled(
      runsForDetail.map((run) =>
        fetchClickDesk(`/agent-runs/${encodeURIComponent(run.uid)}`, apiKey, accountId),
      ),
    )
    const runDetails = runDetailResults.map((result, index) => {
      const run = runsForDetail[index]
      if (!run) return null
      if (result.status === 'rejected') {
        return {
          uid: run.uid,
          ok: false,
          uid_source: run.uid_source,
          agent_id: run.agent_id,
          conversation_id: run.conversation_id,
          top_level_keys: run.top_level_keys,
          routing_values: run.routing_values,
          safe_scalars: run.safe_scalars,
          identifier_candidates: run.identifier_candidates,
          detail_keys: [],
          detail_routing_values: [],
          detail_safe_scalars: [],
          error: sanitizeMessage(
            result.reason instanceof Error ? result.reason.message : String(result.reason),
          ),
        }
      }
      return {
        uid: run.uid,
        ok: true,
        uid_source: run.uid_source,
        agent_id: run.agent_id,
        conversation_id: run.conversation_id,
        top_level_keys: run.top_level_keys,
        routing_values: run.routing_values,
        safe_scalars: run.safe_scalars,
        identifier_candidates: run.identifier_candidates,
        detail_keys: topLevelKeys(result.value),
        detail_routing_values: extractRoutingValues(result.value).slice(0, 30),
        detail_safe_scalars: extractSafeScalars(result.value).slice(0, 60),
      }
    }).filter((item): item is NonNullable<typeof item> => Boolean(item))

    const agentById = new Map(agentSummaries.map((agent) => [agent.id, agent]))
    const enrichedRunSummaries = runSummaries.map((run) => {
      const agent = run.agent_id ? agentById.get(run.agent_id) ?? null : null
      return {
        ...run,
        agent_name: agent?.name ?? null,
        target_handoff_departments: agent?.target_handoff_departments ?? [],
      }
    })

    const sampleTicketIds = new Set(sampleRows.map((row) => row.id))
    const exactRunTicketMatches = enrichedRunSummaries.flatMap((run) =>
      run.safe_scalars
        .filter((item) => sampleTicketIds.has(item.value))
        .map((item) => ({
          run_uid: run.uid,
          run_path: item.path,
          ticket_id: item.value,
          agent_id: run.agent_id,
          agent_name: run.agent_name,
          target_handoff_departments: run.target_handoff_departments,
        })),
    )

    const sampleResults = await Promise.all(
      sampleRows.map(async (row): Promise<AiSample> => {
        const [detailResult, transcriptResult] = await Promise.allSettled([
          fetchClickDesk(`/tickets/${encodeURIComponent(row.id)}`, apiKey, accountId),
          fetchClickDesk(`/tickets/${encodeURIComponent(row.id)}/transcript`, apiKey, accountId),
        ])

        const detail = detailResult.status === 'fulfilled' ? detailResult.value : null
        const transcript = transcriptResult.status === 'fulfilled' ? transcriptResult.value : null
        const routingValues = [
          ...extractRoutingValues(row.raw),
          ...extractRoutingValues(detail),
          ...extractRoutingValues(transcript),
        ].filter(
          (item, index, rows) =>
            rows.findIndex((candidate) => candidate.path === item.path && candidate.value === item.value) === index,
        )

        return {
          ticket_id: row.id,
          list_timestamp: row.timestamp,
          list_area: row.list_area,
          detail_available: detailResult.status === 'fulfilled',
          transcript_available: transcriptResult.status === 'fulfilled',
          detail_area: findTargetArea(detail),
          transcript_area: findTargetArea(transcript),
          detail_keys: topLevelKeys(detail),
          transcript_keys: topLevelKeys(transcript),
          routing_values: routingValues.slice(0, 30),
          run_correlations: correlateValues(routingValues, runValues),
          error:
            detailResult.status === 'rejected' && transcriptResult.status === 'rejected'
              ? sanitizeMessage(
                  detailResult.reason instanceof Error
                    ? detailResult.reason.message
                    : String(detailResult.reason),
                )
              : undefined,
        }
      }),
    )

    const signalCounts = new Map<string, { path: string; value: string; count: number }>()
    sampleResults.forEach((sample) => {
      sample.routing_values.forEach((item) => {
        const key = `${item.path}::${item.value}`
        const current = signalCounts.get(key)
        signalCounts.set(key, {
          path: item.path,
          value: item.value,
          count: (current?.count ?? 0) + 1,
        })
      })
    })

    const repeatedSignals = [...signalCounts.values()]
      .filter((item) => item.count >= 2)
      .sort((a, b) => b.count - a.count || a.path.localeCompare(b.path))
      .slice(0, 30)

    const areaResolved = sampleResults.filter((sample) =>
      [sample.list_area, sample.detail_area, sample.transcript_area].some((area) => area && isTargetSupportName(area)),
    )

    return NextResponse.json({
      connected: true,
      period: { year, month },
      scope: ['Suporte ERP', 'Suporte Fiscal'],
      pages_scanned: pagePayloads.length,
      page_errors: pageErrors,
      listed_in_period: listed.length,
      sampled: sampleResults.length,
      detail_available: sampleResults.filter((item) => item.detail_available).length,
      transcript_available: sampleResults.filter((item) => item.transcript_available).length,
      area_resolved: areaResolved.length,
      samples: sampleResults,
      repeated_signals: repeatedSignals,
      departments: {
        ok: departmentsResult.status === 'fulfilled',
        targets: targetDepartments,
        error:
          departmentsResult.status === 'rejected'
            ? sanitizeMessage(
                departmentsResult.reason instanceof Error
                  ? departmentsResult.reason.message
                  : String(departmentsResult.reason),
              )
            : undefined,
      },
      ai_agents: {
        ok: agentsResult.status === 'fulfilled',
        count: agentSummaries.length,
        items: agentSummaries.slice(0, 20),
        error:
          agentsResult.status === 'rejected'
            ? sanitizeMessage(agentsResult.reason instanceof Error ? agentsResult.reason.message : String(agentsResult.reason))
            : undefined,
      },
      agent_runs: {
        ok: runsResult.status === 'fulfilled',
        count: runSummaries.length,
        pagination: runsPayload ? extractPagination(runsPayload) : {},
        correlation_count:
          sampleResults.reduce((sum, sample) => sum + sample.run_correlations.length, 0) +
          exactRunTicketMatches.length,
        fallback_uid_count: runSummaries.filter((run) => run.uid_is_fallback).length,
        exact_ticket_matches: exactRunTicketMatches,
        items: enrichedRunSummaries.slice(0, 20),
        detail_samples: runDetails,
        error:
          runsResult.status === 'rejected'
            ? sanitizeMessage(runsResult.reason instanceof Error ? runsResult.reason.message : String(runsResult.reason))
            : undefined,
      },
      conclusion:
        exactRunTicketMatches.length > 0
          ? 'Encontramos uma ligação exata entre conversa e agent-run. Agora já podemos validar o agente responsável e usar seu handoff configurado como sinal de roteamento.'
          : areaResolved.length > 0
            ? 'Encontramos ao menos uma conversa IA cuja área pode ser resolvida por metadados e já conhecemos os IDs reais de ERP/Fiscal. Falta confirmar uma ligação estável entre as demais conversas e o agente/execução.'
            : agentSummaries.some((agent) => agent.target_handoff_departments.length > 0)
              ? 'A conversa ainda não expõe ERP/Fiscal diretamente, mas já conseguimos mapear agentes de IA que possuem handoff configurado para as áreas-alvo. Agora precisamos ligar cada conversa ao agente ou execução correspondente.'
              : 'Ainda não encontramos ERP/Fiscal diretamente na amostra IA nem um handoff de agente mapeado para as áreas-alvo. O próximo diagnóstico deve usar a estrutura detalhada dos agent-runs.',
      tested_at: new Date().toISOString(),
    })
  } catch (error) {
    const message = error instanceof Error ? sanitizeMessage(error.message) : 'Erro inesperado.'
    return NextResponse.json({ error: `Falha no diagnóstico de roteamento da IA: ${message}` }, { status: 503 })
  }
}
) => {
    if (current === null || current === undefined || depth > 5) return

    if (Array.isArray(current)) {
      current.slice(0, 80).forEach((item, index) => visit(item, depth + 1, `${path}[${index}]`))
      return
    }

    if (typeof current !== 'object') return

    for (const [key, raw] of Object.entries(current as Record<string, unknown>)) {
      const currentPath = `${path}.${key}`
      const sensitive =
        /(email|phone|telefone|name|nome|requester|customer|visitor|subject|content|body|message|text|comment|token|secret|password)/i.test(
          key,
        )

      if (!sensitive && (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean')) {
        const rawValue = String(raw).trim()
        if (rawValue && rawValue.length <= 180) {
          const signature = `${currentPath}::${rawValue}`
          if (!seen.has(signature) && values.length < 120) {
            seen.add(signature)
            values.push({ path: currentPath, value: rawValue })
          }
        }
      }

      if (raw && typeof raw === 'object') visit(raw, depth + 1, currentPath)
    }
  }

  visit(value)
  return values
}

function chooseRunUid(source: Record<string, unknown>) {
  const preferredKeys = [
    'uid',
    'run_uid',
    'runUid',
    'execution_uid',
    'executionUid',
    'run_id',
    'runId',
    'execution_id',
    'executionId',
    'uuid',
    'id',
  ]

  for (const key of preferredKeys) {
    const value = primitiveString(source[key])
    if (value) return { value, source: key }
  }

  const nested = readFirstByKeys(source, [
    /^run_?uid$/i,
    /^execution_?uid$/i,
    /^run_?id$/i,
    /^execution_?id$/i,
    /^uid$/i,
  ])
  if (nested) return { value: nested, source: 'nested' }

  return null
}

function summarizeAgentRuns(payload: unknown) {
  return extractCollection(payload)
    .map((item, index) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null
      const source = item as Record<string, unknown>
      const chosenUid = chooseRunUid(source)
      const uid = chosenUid?.value ?? `run-${index + 1}`
      const agentId = readFirstByKeys(source, [/^agent_?id$/i, /^ai_agent_?id$/i])
      const conversationId = readFirstByKeys(source, [
        /^conversation_?id$/i,
        /^ticket_?id$/i,
        /^conversation$/i,
        /^ticket$/i,
      ])
      const routingValues = extractRoutingValues(source)
      const safeScalars = extractSafeScalars(source)
      const identifierCandidates = safeScalars.filter((item) =>
        /(uid|run|execution|conversation|ticket|agent|id)/i.test(item.path),
      )

      return {
        uid,
        uid_source: chosenUid?.source ?? null,
        uid_is_fallback: !chosenUid,
        agent_id: agentId,
        conversation_id: conversationId,
        top_level_keys: Object.keys(source).slice(0, 60),
        routing_values: routingValues.slice(0, 30),
        safe_scalars: safeScalars.slice(0, 50),
        identifier_candidates: identifierCandidates.slice(0, 30),
      }
    })
    .filter(
      (item): item is {
        uid: string
        uid_source: string | null
        uid_is_fallback: boolean
        agent_id: string | null
        conversation_id: string | null
        top_level_keys: string[]
        routing_values: SafeValue[]
        safe_scalars: SafeValue[]
        identifier_candidates: SafeValue[]
      } => Boolean(item),
    )
}

function summarizeAgents(payload: unknown, departmentNames: Map<string, string>) {
  return extractCollection(payload)
    .map((item, index) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null
      const source = item as Record<string, unknown>
      const id =
        primitiveString(source.id) ??
        primitiveString(source.uuid) ??
        primitiveString(source.uid) ??
        `agent-${index + 1}`
      const name =
        primitiveString(source.name) ??
        primitiveString(source.title) ??
        primitiveString(source.label) ??
        id
      const routingValues = extractRoutingValues(source)
      const handoffDepartmentIds = readDepartmentIds(source)
      const handoffDepartments = handoffDepartmentIds.map((departmentId) => ({
        id: departmentId,
        name: departmentNames.get(departmentId) ?? null,
        target: departmentNames.has(departmentId)
          ? isTargetSupportName(departmentNames.get(departmentId) ?? '')
          : false,
      }))
      return {
        id,
        name,
        routing_values: routingValues.slice(0, 12),
        handoff_departments: handoffDepartments,
        target_handoff_departments: handoffDepartments.filter((item) => item.target),
      }
    })
    .filter(
      (
        item,
      ): item is {
        id: string
        name: string
        routing_values: SafeValue[]
        handoff_departments: { id: string; name: string | null; target: boolean }[]
        target_handoff_departments: { id: string; name: string | null; target: boolean }[]
      } => Boolean(item),
    )
}

function collectRunValues(payload: unknown) {
  return extractCollection(payload).flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    return extractRoutingValues(item)
  })
}

function correlateValues(ticketValues: SafeValue[], runValues: SafeValue[]) {
  const byValue = new Map<string, SafeValue[]>()
  runValues.forEach((item) => {
    const normalized = item.value.trim()
    if (normalized.length < 4) return
    const bucket = byValue.get(normalized) ?? []
    bucket.push(item)
    byValue.set(normalized, bucket)
  })

  const matches: { value: string; ticket_path: string; run_path: string }[] = []
  ticketValues.forEach((ticketItem) => {
    const runMatches = byValue.get(ticketItem.value.trim())
    if (!runMatches) return
    runMatches.slice(0, 2).forEach((runItem) => {
      if (matches.length < 12) {
        matches.push({
          value: ticketItem.value,
          ticket_path: ticketItem.path,
          run_path: runItem.path,
        })
      }
    })
  })
  return matches
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
      const source = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
      const message =
        typeof source.message === 'string'
          ? source.message
          : typeof source.error === 'string'
            ? source.error
            : `HTTP ${response.status}`
      throw new Error(`${path}: ${message}`)
    }

    return payload
  } finally {
    clearTimeout(timeout)
  }
}

export async function GET(request: NextRequest) {
  try {
    const { url: supabaseUrl, publishableKey, environment } = getServerSupabaseConfig()
    if (environment !== 'homologacao') {
      return NextResponse.json({ error: 'Recurso disponível somente na homologação.' }, { status: 404 })
    }

    const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim()
    if (!token) return NextResponse.json({ error: 'Sessão não encontrada.' }, { status: 401 })

    const client = createClient(supabaseUrl, publishableKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    })

    const {
      data: { user },
      error: userError,
    } = await client.auth.getUser(token)

    if (userError || !user) {
      return NextResponse.json({ error: 'Sessão inválida.' }, { status: 401 })
    }

    const { data: profile, error: profileError } = await client
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle()

    if (profileError || !normalizeRole(profile?.role)) {
      return NextResponse.json({ error: 'Recurso disponível apenas para a gestão.' }, { status: 403 })
    }

    const apiKey = process.env.CLICKDESK_API_KEY?.trim()
    const accountId = process.env.CLICKDESK_ACCOUNT_ID?.trim()
    if (!apiKey || !accountId) {
      return NextResponse.json({ error: 'Credenciais ClickDesk não configuradas.' }, { status: 503 })
    }

    const now = new Date()
    const year = Number(request.nextUrl.searchParams.get('year')) || now.getFullYear()
    const month = Number(request.nextUrl.searchParams.get('month')) || now.getMonth() + 1

    const pagePayloads: unknown[] = []
    const pageErrors: string[] = []
    for (let page = 1; page <= 5; page += 1) {
      try {
        pagePayloads.push(
          await fetchClickDesk(
            `/tickets?inbox=conversations&attendance=ai&page=${page}`,
            apiKey,
            accountId,
          ),
        )
      } catch (error) {
        pageErrors.push(sanitizeMessage(error instanceof Error ? error.message : String(error)))
      }
    }

    const listed = pagePayloads
      .flatMap((payload) => extractCollection(payload))
      .map((item, index) => ({
        raw: item,
        id: readTicketId(item, `row-${index + 1}`),
        timestamp: readTimestamp(item),
        list_area: findTargetArea(item),
      }))
      .filter((item, index, rows) => rows.findIndex((candidate) => candidate.id === item.id) === index)
      .filter((item) => isInMonth(item.timestamp, year, month))

    const sampleRows = listed.slice(0, 12)

    const [agentsResult, runsResult, departmentsResult] = await Promise.allSettled([
      fetchClickDesk('/ai/agents', apiKey, accountId),
      fetchClickDesk('/agent-runs', apiKey, accountId),
      fetchClickDesk('/support-departments', apiKey, accountId),
    ])

    const agentsPayload = agentsResult.status === 'fulfilled' ? agentsResult.value : null
    const runsPayload = runsResult.status === 'fulfilled' ? runsResult.value : null
    const departmentsPayload = departmentsResult.status === 'fulfilled' ? departmentsResult.value : null
    const departments = departmentsPayload ? normalizeDepartments(departmentsPayload) : []
    const targetDepartments = departments.filter((item) => isTargetSupportName(item.name))
    const departmentNames = new Map(targetDepartments.map((item) => [item.id, item.name]))
    const agentSummaries = agentsPayload ? summarizeAgents(agentsPayload, departmentNames) : []
    const runSummaries = runsPayload ? summarizeAgentRuns(runsPayload) : []
    const runValues = runsPayload ? collectRunValues(runsPayload) : []

    const runDetailResults = await Promise.allSettled(
      runSummaries.slice(0, 5).map((run) =>
        fetchClickDesk(`/agent-runs/${encodeURIComponent(run.uid)}`, apiKey, accountId),
      ),
    )
    const runDetails = runDetailResults.map((result, index) => {
      const run = runSummaries[index]
      if (!run) return null
      if (result.status === 'rejected') {
        return {
          uid: run.uid,
          ok: false,
          agent_id: run.agent_id,
          conversation_id: run.conversation_id,
          top_level_keys: run.top_level_keys,
          routing_values: run.routing_values,
          detail_keys: [],
          detail_routing_values: [],
          error: sanitizeMessage(
            result.reason instanceof Error ? result.reason.message : String(result.reason),
          ),
        }
      }
      return {
        uid: run.uid,
        ok: true,
        agent_id: run.agent_id,
        conversation_id: run.conversation_id,
        top_level_keys: run.top_level_keys,
        routing_values: run.routing_values,
        detail_keys: topLevelKeys(result.value),
        detail_routing_values: extractRoutingValues(result.value).slice(0, 30),
      }
    }).filter((item): item is NonNullable<typeof item> => Boolean(item))

    const sampleResults = await Promise.all(
      sampleRows.map(async (row): Promise<AiSample> => {
        const [detailResult, transcriptResult] = await Promise.allSettled([
          fetchClickDesk(`/tickets/${encodeURIComponent(row.id)}`, apiKey, accountId),
          fetchClickDesk(`/tickets/${encodeURIComponent(row.id)}/transcript`, apiKey, accountId),
        ])

        const detail = detailResult.status === 'fulfilled' ? detailResult.value : null
        const transcript = transcriptResult.status === 'fulfilled' ? transcriptResult.value : null
        const routingValues = [
          ...extractRoutingValues(row.raw),
          ...extractRoutingValues(detail),
          ...extractRoutingValues(transcript),
        ].filter(
          (item, index, rows) =>
            rows.findIndex((candidate) => candidate.path === item.path && candidate.value === item.value) === index,
        )

        return {
          ticket_id: row.id,
          list_timestamp: row.timestamp,
          list_area: row.list_area,
          detail_available: detailResult.status === 'fulfilled',
          transcript_available: transcriptResult.status === 'fulfilled',
          detail_area: findTargetArea(detail),
          transcript_area: findTargetArea(transcript),
          detail_keys: topLevelKeys(detail),
          transcript_keys: topLevelKeys(transcript),
          routing_values: routingValues.slice(0, 30),
          run_correlations: correlateValues(routingValues, runValues),
          error:
            detailResult.status === 'rejected' && transcriptResult.status === 'rejected'
              ? sanitizeMessage(
                  detailResult.reason instanceof Error
                    ? detailResult.reason.message
                    : String(detailResult.reason),
                )
              : undefined,
        }
      }),
    )

    const signalCounts = new Map<string, { path: string; value: string; count: number }>()
    sampleResults.forEach((sample) => {
      sample.routing_values.forEach((item) => {
        const key = `${item.path}::${item.value}`
        const current = signalCounts.get(key)
        signalCounts.set(key, {
          path: item.path,
          value: item.value,
          count: (current?.count ?? 0) + 1,
        })
      })
    })

    const repeatedSignals = [...signalCounts.values()]
      .filter((item) => item.count >= 2)
      .sort((a, b) => b.count - a.count || a.path.localeCompare(b.path))
      .slice(0, 30)

    const areaResolved = sampleResults.filter((sample) =>
      [sample.list_area, sample.detail_area, sample.transcript_area].some((area) => area && isTargetSupportName(area)),
    )

    return NextResponse.json({
      connected: true,
      period: { year, month },
      scope: ['Suporte ERP', 'Suporte Fiscal'],
      pages_scanned: pagePayloads.length,
      page_errors: pageErrors,
      listed_in_period: listed.length,
      sampled: sampleResults.length,
      detail_available: sampleResults.filter((item) => item.detail_available).length,
      transcript_available: sampleResults.filter((item) => item.transcript_available).length,
      area_resolved: areaResolved.length,
      samples: sampleResults,
      repeated_signals: repeatedSignals,
      departments: {
        ok: departmentsResult.status === 'fulfilled',
        targets: targetDepartments,
        error:
          departmentsResult.status === 'rejected'
            ? sanitizeMessage(
                departmentsResult.reason instanceof Error
                  ? departmentsResult.reason.message
                  : String(departmentsResult.reason),
              )
            : undefined,
      },
      ai_agents: {
        ok: agentsResult.status === 'fulfilled',
        count: agentSummaries.length,
        items: agentSummaries.slice(0, 20),
        error:
          agentsResult.status === 'rejected'
            ? sanitizeMessage(agentsResult.reason instanceof Error ? agentsResult.reason.message : String(agentsResult.reason))
            : undefined,
      },
      agent_runs: {
        ok: runsResult.status === 'fulfilled',
        count: runSummaries.length,
        pagination: runsPayload ? extractPagination(runsPayload) : {},
        correlation_count: sampleResults.reduce((sum, sample) => sum + sample.run_correlations.length, 0),
        items: runSummaries.slice(0, 20),
        detail_samples: runDetails,
        error:
          runsResult.status === 'rejected'
            ? sanitizeMessage(runsResult.reason instanceof Error ? runsResult.reason.message : String(runsResult.reason))
            : undefined,
      },
      conclusion:
        areaResolved.length > 0
          ? 'Encontramos ao menos uma conversa IA cuja área pode ser resolvida por metadados. O próximo passo é transformar o sinal estável em regra de classificação.'
          : agentSummaries.some((agent) => agent.target_handoff_departments.length > 0)
            ? 'A conversa ainda não expõe ERP/Fiscal diretamente, mas já conseguimos mapear agentes de IA que possuem handoff configurado para as áreas-alvo. Agora precisamos ligar cada conversa ao agente ou execução correspondente.'
            : 'Ainda não encontramos ERP/Fiscal diretamente na amostra IA nem um handoff de agente mapeado para as áreas-alvo. O próximo diagnóstico deve usar a estrutura detalhada dos agent-runs.',
      tested_at: new Date().toISOString(),
    })
  } catch (error) {
    const message = error instanceof Error ? sanitizeMessage(error.message) : 'Erro inesperado.'
    return NextResponse.json({ error: `Falha no diagnóstico de roteamento da IA: ${message}` }, { status: 503 })
  }
}
