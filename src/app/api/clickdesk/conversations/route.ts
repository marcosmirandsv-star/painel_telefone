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

    return NextResponse.json({
      connected: true,
      period: { year: requestedYear, month: requestedMonth },
      scope: ['Suporte ERP', 'Suporte Fiscal'],
      classification_rule:
        'Pela regra operacional informada, toda conversa começa na IA; registros classificados pelo ClickDesk como human são tratados neste diagnóstico como transferidos para humano.',
      target_area_detected_in_payload: targetAreaDetected,
      page_diagnostic_only: true,
      counts: {
        ai: filteredAi.length,
        transferred_to_human: filteredHuman.length,
        overlap: overlapIds.length,
      },
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
        'Este é um diagnóstico da página retornada pela API, ainda não um total oficial do mês. Depois de confirmarmos paginação, campos de data e vínculo de área, a sincronização mensal/D-1 será consolidada.',
      tested_at: new Date().toISOString(),
    })
  } catch (error) {
    const message = error instanceof Error ? sanitizeMessage(error.message) : 'Erro inesperado.'
    return NextResponse.json({ error: `Falha ao ler conversas do ClickDesk: ${message}` }, { status: 503 })
  }
}
