import { createClient } from '@supabase/supabase-js'
import { getServerSupabaseConfig } from '@/lib/runtime-environment'
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

const CLICKDESK_BASE_URL = 'https://api.desk.click.app/api/v1'

type Mode = 'ai' | 'human'

type ConversationSummary = {
  id: string
  mode: Mode
  area: string | null
  assignee: string | null
  timestamp: string | null
  satisfaction: string | null
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

function findFirstByKeyPattern(
  value: unknown,
  pattern: RegExp,
  depth = 0,
): string | null {
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
    if (pattern.test(key)) {
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
  for (const key of [
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
  ]) {
    const value = primitiveString(source[key])
    if (value) return value
  }
  return findFirstByKeyPattern(source, /(closed|ended|created|started|updated).*at/i)
}

function readSatisfaction(source: Record<string, unknown>) {
  const satisfaction = source.satisfaction
  if (typeof satisfaction === 'string') return satisfaction
  if (satisfaction && typeof satisfaction === 'object') {
    const block = satisfaction as Record<string, unknown>
    for (const key of ['sentiment', 'rating', 'score', 'value', 'label']) {
      const value = primitiveString(block[key])
      if (value) return value
    }
  }
  return null
}

function summarizeRows(payload: unknown, mode: Mode): ConversationSummary[] {
  return extractCollection(payload)
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null
      const source = item as Record<string, unknown>
      return {
        id: readTicketId(source, index),
        mode,
        area: findTargetArea(source),
        assignee: findFirstByKeyPattern(source, /(assignee|attendant|agent|owner|assigned.*user|responsible)/i),
        timestamp: readTimestamp(source),
        satisfaction: readSatisfaction(source),
      }
    })
    .filter((item): item is ConversationSummary => Boolean(item))
}

function isInMonth(timestamp: string | null, year: number, month: number) {
  if (!timestamp) return true
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return true
  return date.getFullYear() === year && date.getMonth() + 1 === month
}

function extractPaginationDiagnostic(payload: unknown) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {}
  const source = payload as Record<string, unknown>
  const out: Record<string, string | number | boolean | null> = {}

  const collect = (obj: Record<string, unknown>, prefix = '') => {
    for (const [key, raw] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}.${key}` : key
      if (/(page|per_page|total|count|limit|offset|cursor|next|last)/i.test(key)) {
        if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean' || raw === null) {
          out[fullKey] = raw
        }
      }
      if (
        raw &&
        typeof raw === 'object' &&
        !Array.isArray(raw) &&
        /(meta|pagination|paging|links|page)/i.test(key)
      ) {
        collect(raw as Record<string, unknown>, fullKey)
      }
    }
  }

  collect(source)
  return out
}

function timestampDiagnostic(rows: ConversationSummary[]) {
  const parsed = rows
    .map((row) => row.timestamp)
    .filter((value): value is string => Boolean(value))
    .map((value) => ({ value, time: new Date(value).getTime() }))
    .filter((item) => !Number.isNaN(item.time))
    .sort((a, b) => a.time - b.time)

  return {
    with_timestamp: parsed.length,
    without_timestamp: rows.length - parsed.length,
    earliest: parsed[0]?.value ?? null,
    latest: parsed.at(-1)?.value ?? null,
  }
}

type JourneySignal = {
  ai_marker: boolean
  human_marker: boolean
  transfer_marker: boolean
  signal_keys: string[]
  payload_kind: 'null' | 'string' | 'array' | 'object' | 'other'
  top_level_keys: string[]
  candidate_paths: string[]
}

function detectJourneySignals(payload: unknown): JourneySignal {
  const signalKeys = new Set<string>()
  const candidatePaths = new Set<string>()
  let aiMarker = false
  let humanMarker = false
  let transferMarker = false

  const payloadKind: JourneySignal['payload_kind'] =
    payload === null
      ? 'null'
      : typeof payload === 'string'
        ? 'string'
        : Array.isArray(payload)
          ? 'array'
          : typeof payload === 'object'
            ? 'object'
            : 'other'
  const topLevelKeys =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? Object.keys(payload as Record<string, unknown>).slice(0, 30)
      : []

  if (typeof payload === 'string') {
    const normalized = normalizeLabel(payload.slice(0, 200000))
    if (/(^| )ai($| )|bot|assistant|assistente virtual/.test(normalized)) aiMarker = true
    if (/human|humano|attendant|atendente|analista/.test(normalized)) humanMarker = true
    if (/transfer|handoff|escalat|encaminh|transbord/.test(normalized)) transferMarker = true
  }

  const visit = (value: unknown, depth = 0, path = '    if (!value || typeof value !== 'object' || depth > 6) return
    if (Array.isArray(value)) {
      value.slice(0, 100).forEach((item, index) => visit(item, depth + 1, `${path}[${index}]`))
      return
    }

    const source = value as Record<string, unknown>
    for (const [key, raw] of Object.entries(source)) {
      const currentPath = `${path}.${key}`
      const normalizedKey = normalizeLabel(key)
      const interestingKey = /(role|type|author|sender|actor|attendance|event|action|transfer|handoff|escalat|agent|bot|human|ai|participant|source|origin|department|team|queue)/i.test(key)
      if (interestingKey) {
        signalKeys.add(key)
        candidatePaths.add(currentPath)
      }

      if (/(^| )ai($| )|bot|assistant/.test(normalizedKey)) aiMarker = true
      if (/human|humano|attendant|atendente/.test(normalizedKey)) humanMarker = true
      if (/transfer|handoff|escalat|encaminh|transbord/.test(normalizedKey)) transferMarker = true

      if (interestingKey && (typeof raw === 'string' || typeof raw === 'number')) {
        const normalizedValue = normalizeLabel(String(raw))
        if (/(^| )ai($| )|bot|assistant|assistente virtual/.test(normalizedValue)) aiMarker = true
        if (/human|humano|attendant|atendente|analista/.test(normalizedValue)) humanMarker = true
        if (/transfer|handoff|escalat|encaminh|transbord/.test(normalizedValue)) transferMarker = true
      }

      if (raw && typeof raw === 'object') visit(raw, depth + 1, currentPath)
    }
  }

  visit(payload)
  return {
    ai_marker: aiMarker,
    human_marker: humanMarker,
    transfer_marker: transferMarker,
    signal_keys: [...signalKeys].slice(0, 30),
    payload_kind: payloadKind,
    top_level_keys: topLevelKeys,
    candidate_paths: [...candidatePaths].slice(0, 40),
  }
}

async function validateJourneySample(
  row: ConversationSummary,
  apiKey: string,
  accountId: string,
) {
  try {
    const [transcriptResult, detailResult] = await Promise.allSettled([
      fetchClickDesk(
        `/tickets/${encodeURIComponent(row.id)}/transcript`,
        apiKey,
        accountId,
      ),
      fetchClickDesk(
        `/tickets/${encodeURIComponent(row.id)}`,
        apiKey,
        accountId,
      ),
    ])

    const transcriptAvailable = transcriptResult.status === 'fulfilled'
    const detailAvailable = detailResult.status === 'fulfilled'
    const transcriptSignals = detectJourneySignals(
      transcriptResult.status === 'fulfilled' ? transcriptResult.value : null,
    )
    const detailSignals = detectJourneySignals(
      detailResult.status === 'fulfilled' ? detailResult.value : null,
    )

    return {
      id: row.id,
      classified_as: row.mode,
      assignee: row.assignee,
      transcript_available: transcriptAvailable,
      detail_available: detailAvailable,
      transcript: transcriptSignals,
      detail: detailSignals,
      detail_area:
        detailResult.status === 'fulfilled' ? findTargetArea(detailResult.value) : null,
      error:
        transcriptResult.status === 'rejected'
          ? sanitizeMessage(transcriptResult.reason instanceof Error ? transcriptResult.reason.message : String(transcriptResult.reason))
          : undefined,
    }
  } catch (error) {
    return {
      id: row.id,
      classified_as: row.mode,
      assignee: row.assignee,
      transcript_available: false,
      detail_available: false,
      transcript: {
        ai_marker: false,
        human_marker: false,
        transfer_marker: false,
        signal_keys: [],
        payload_kind: 'null' as const,
        top_level_keys: [],
        candidate_paths: [],
      },
      detail: {
        ai_marker: false,
        human_marker: false,
        transfer_marker: false,
        signal_keys: [],
        payload_kind: 'null' as const,
        top_level_keys: [],
        candidate_paths: [],
      },
      detail_area: null,
      error: sanitizeMessage(error instanceof Error ? error.message : String(error)),
    }
  }
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
    const { data: { user }, error: userError } = await client.auth.getUser(token)
    if (userError || !user) return NextResponse.json({ error: 'Sessão inválida.' }, { status: 401 })

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
    const requestedYear = Number(request.nextUrl.searchParams.get('year')) || now.getFullYear()
    const requestedMonth = Number(request.nextUrl.searchParams.get('month')) || now.getMonth() + 1

    const [aiResult, humanResult, queuesResult] = await Promise.allSettled([
      fetchClickDesk('/tickets?inbox=conversations&attendance=ai', apiKey, accountId),
      fetchClickDesk('/tickets?inbox=conversations&attendance=human', apiKey, accountId),
      fetchClickDesk('/tickets/queues', apiKey, accountId),
    ])

    const failure = [aiResult, humanResult].find((result) => result.status === 'rejected')
    if (failure?.status === 'rejected') {
      throw failure.reason
    }

    const aiRows = summarizeRows(aiResult.status === 'fulfilled' ? aiResult.value : [], 'ai')
      .filter((row) => isInMonth(row.timestamp, requestedYear, requestedMonth))
    const humanRows = summarizeRows(humanResult.status === 'fulfilled' ? humanResult.value : [], 'human')
      .filter((row) => isInMonth(row.timestamp, requestedYear, requestedMonth))

    const allRows = [...aiRows, ...humanRows]
    const rowsWithTargetArea = allRows.filter((row) => row.area && isTargetSupportName(row.area))
    const targetAreaDetected = rowsWithTargetArea.length > 0

    const filteredAi = aiRows.filter((row) => row.area && isTargetSupportName(row.area))
    const filteredHuman = humanRows.filter((row) => row.area && isTargetSupportName(row.area))
    const aiWithoutArea = aiRows.filter((row) => !row.area)
    const humanWithoutArea = humanRows.filter((row) => !row.area)

    const aiIds = new Set(filteredAi.map((row) => row.id))
    const humanIds = new Set(filteredHuman.map((row) => row.id))
    const overlapIds = [...aiIds].filter((id) => humanIds.has(id))

    const assigneeCounts = new Map<string, number>()
    filteredHuman.forEach((row) => {
      const name = row.assignee?.trim()
      if (!name) return
      assigneeCounts.set(name, (assigneeCounts.get(name) ?? 0) + 1)
    })

    const journeySampleRows = [
      ...filteredHuman.slice(0, 3),
      ...filteredAi.slice(0, 1),
      ...aiWithoutArea.slice(0, 1),
    ].filter((row, index, rows) => rows.findIndex((candidate) => candidate.id === row.id) === index)
    const journeyValidation = await Promise.all(
      journeySampleRows.map((row) => validateJourneySample(row, apiKey, accountId)),
    )

    return NextResponse.json({
      connected: true,
      period: { year: requestedYear, month: requestedMonth },
      scope: ['Suporte ERP', 'Suporte Fiscal'],
      classification_rule:
        'Neste diagnóstico, attendance=ai e attendance=human são classificações devolvidas pelo ClickDesk. Como toda conversa da operação começa na IA, a hipótese de que human representa transferência é validada separadamente pelo transcript antes de virar regra oficial.',
      target_area_detected_in_payload: targetAreaDetected,
      page_diagnostic_only: true,
      counts: {
        ai: filteredAi.length,
        transferred_to_human: filteredHuman.length,
        overlap: overlapIds.length,
      },
      raw_counts: {
        ai: aiRows.length,
        human: humanRows.length,
      },
      area_coverage: {
        ai_with_target_area: filteredAi.length,
        ai_without_area: aiWithoutArea.length,
        human_with_target_area: filteredHuman.length,
        human_without_area: humanWithoutArea.length,
      },
      pagination: {
        ai: extractPaginationDiagnostic(aiResult.status === 'fulfilled' ? aiResult.value : null),
        human: extractPaginationDiagnostic(humanResult.status === 'fulfilled' ? humanResult.value : null),
      },
      timestamps: {
        ai: timestampDiagnostic(filteredAi),
        human: timestampDiagnostic(filteredHuman),
      },
      journey_validation: journeyValidation,
      human_by_assignee: [...assigneeCounts.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count),
      samples: {
        ai: filteredAi.slice(0, 8),
        human: filteredHuman.slice(0, 12),
      },
      queues_status:
        queuesResult.status === 'fulfilled'
          ? 'ok'
          : sanitizeMessage(queuesResult.reason instanceof Error ? queuesResult.reason.message : String(queuesResult.reason)),
      warning:
        'Os números com área confirmada consideram somente registros em que a própria resposta identifica Suporte ERP ou Suporte Fiscal. Registros de IA sem área não são atribuídos ao suporte para evitar misturar outras operações. O transcript e o detalhe de uma pequena amostra são consultados apenas para entender a estrutura da jornada sem expor o conteúdo das mensagens.',
      tested_at: new Date().toISOString(),
    })
  } catch (error) {
    const message = error instanceof Error ? sanitizeMessage(error.message) : 'Erro inesperado.'
    return NextResponse.json({ error: `Falha ao ler conversas do ClickDesk: ${message}` }, { status: 503 })
  }
}
) => {
    if (!value || typeof value !== 'object' || depth > 6) return
    if (Array.isArray(value)) {
      value.slice(0, 100).forEach((item) => visit(item, depth + 1))
      return
    }

    const source = value as Record<string, unknown>
    for (const [key, raw] of Object.entries(source)) {
      const normalizedKey = normalizeLabel(key)
      const interestingKey = /(role|type|author|sender|actor|attendance|event|action|transfer|handoff|escalat|agent|bot|human|ai)/i.test(key)
      if (interestingKey) signalKeys.add(key)

      if (/(^| )ai($| )|bot|assistant/.test(normalizedKey)) aiMarker = true
      if (/human|humano|attendant|atendente/.test(normalizedKey)) humanMarker = true
      if (/transfer|handoff|escalat/.test(normalizedKey)) transferMarker = true

      if (interestingKey && (typeof raw === 'string' || typeof raw === 'number')) {
        const normalizedValue = normalizeLabel(String(raw))
        if (/(^| )ai($| )|bot|assistant/.test(normalizedValue)) aiMarker = true
        if (/human|humano|attendant|atendente/.test(normalizedValue)) humanMarker = true
        if (/transfer|handoff|escalat/.test(normalizedValue)) transferMarker = true
      }

      if (raw && typeof raw === 'object') visit(raw, depth + 1)
    }
  }

  visit(payload)
  return {
    ai_marker: aiMarker,
    human_marker: humanMarker,
    transfer_marker: transferMarker,
    signal_keys: [...signalKeys].slice(0, 30),
  }
}

async function validateJourneySample(
  row: ConversationSummary,
  apiKey: string,
  accountId: string,
) {
  try {
    const transcript = await fetchClickDesk(
      `/tickets/${encodeURIComponent(row.id)}/transcript`,
      apiKey,
      accountId,
    )
    return {
      id: row.id,
      classified_as: row.mode,
      assignee: row.assignee,
      transcript_available: true,
      ...detectJourneySignals(transcript),
    }
  } catch (error) {
    return {
      id: row.id,
      classified_as: row.mode,
      assignee: row.assignee,
      transcript_available: false,
      ai_marker: false,
      human_marker: false,
      transfer_marker: false,
      signal_keys: [],
      error: sanitizeMessage(error instanceof Error ? error.message : String(error)),
    }
  }
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
    const { data: { user }, error: userError } = await client.auth.getUser(token)
    if (userError || !user) return NextResponse.json({ error: 'Sessão inválida.' }, { status: 401 })

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
    const requestedYear = Number(request.nextUrl.searchParams.get('year')) || now.getFullYear()
    const requestedMonth = Number(request.nextUrl.searchParams.get('month')) || now.getMonth() + 1

    const [aiResult, humanResult, queuesResult] = await Promise.allSettled([
      fetchClickDesk('/tickets?inbox=conversations&attendance=ai', apiKey, accountId),
      fetchClickDesk('/tickets?inbox=conversations&attendance=human', apiKey, accountId),
      fetchClickDesk('/tickets/queues', apiKey, accountId),
    ])

    const failure = [aiResult, humanResult].find((result) => result.status === 'rejected')
    if (failure?.status === 'rejected') {
      throw failure.reason
    }

    const aiRows = summarizeRows(aiResult.status === 'fulfilled' ? aiResult.value : [], 'ai')
      .filter((row) => isInMonth(row.timestamp, requestedYear, requestedMonth))
    const humanRows = summarizeRows(humanResult.status === 'fulfilled' ? humanResult.value : [], 'human')
      .filter((row) => isInMonth(row.timestamp, requestedYear, requestedMonth))

    const allRows = [...aiRows, ...humanRows]
    const rowsWithTargetArea = allRows.filter((row) => row.area && isTargetSupportName(row.area))
    const targetAreaDetected = rowsWithTargetArea.length > 0

    const filteredAi = targetAreaDetected
      ? aiRows.filter((row) => row.area && isTargetSupportName(row.area))
      : aiRows
    const filteredHuman = targetAreaDetected
      ? humanRows.filter((row) => row.area && isTargetSupportName(row.area))
      : humanRows

    const aiIds = new Set(filteredAi.map((row) => row.id))
    const humanIds = new Set(filteredHuman.map((row) => row.id))
    const overlapIds = [...aiIds].filter((id) => humanIds.has(id))

    const assigneeCounts = new Map<string, number>()
    filteredHuman.forEach((row) => {
      const name = row.assignee?.trim()
      if (!name) return
      assigneeCounts.set(name, (assigneeCounts.get(name) ?? 0) + 1)
    })

    const journeySampleRows = [...filteredHuman.slice(0, 3), ...filteredAi.slice(0, 1)]
    const journeyValidation = await Promise.all(
      journeySampleRows.map((row) => validateJourneySample(row, apiKey, accountId)),
    )

    return NextResponse.json({
      connected: true,
      period: { year: requestedYear, month: requestedMonth },
      scope: ['Suporte ERP', 'Suporte Fiscal'],
      classification_rule:
        'Neste diagnóstico, attendance=ai e attendance=human são classificações devolvidas pelo ClickDesk. Como toda conversa da operação começa na IA, a hipótese de que human representa transferência é validada separadamente pelo transcript antes de virar regra oficial.',
      target_area_detected_in_payload: targetAreaDetected,
      page_diagnostic_only: true,
      counts: {
        ai: filteredAi.length,
        transferred_to_human: filteredHuman.length,
        overlap: overlapIds.length,
      },
      pagination: {
        ai: extractPaginationDiagnostic(aiResult.status === 'fulfilled' ? aiResult.value : null),
        human: extractPaginationDiagnostic(humanResult.status === 'fulfilled' ? humanResult.value : null),
      },
      timestamps: {
        ai: timestampDiagnostic(filteredAi),
        human: timestampDiagnostic(filteredHuman),
      },
      journey_validation: journeyValidation,
      human_by_assignee: [...assigneeCounts.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count),
      samples: {
        ai: filteredAi.slice(0, 8),
        human: filteredHuman.slice(0, 12),
      },
      queues_status:
        queuesResult.status === 'fulfilled'
          ? 'ok'
          : sanitizeMessage(queuesResult.reason instanceof Error ? queuesResult.reason.message : String(queuesResult.reason)),
      warning:
        'Os números acima são da página retornada pela API e das classificações attendance=ai|human. Eles ainda não significam, por si só, resolvido pela IA ou transferido para humano. O transcript de uma pequena amostra é consultado apenas para validar sinais de jornada sem expor o conteúdo das mensagens.',
      tested_at: new Date().toISOString(),
    })
  } catch (error) {
    const message = error instanceof Error ? sanitizeMessage(error.message) : 'Erro inesperado.'
    return NextResponse.json({ error: `Falha ao ler conversas do ClickDesk: ${message}` }, { status: 503 })
  }
}
