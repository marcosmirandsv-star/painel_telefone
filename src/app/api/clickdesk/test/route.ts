import { createClient } from '@supabase/supabase-js'
import { getServerSupabaseConfig } from '@/lib/runtime-environment'
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

const CLICKDESK_BASE_URL = 'https://api.desk.click.app/api/v1'

type ClickDeskItem = {
  id: string
  name: string
  email?: string
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

function extractCollection(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload
  if (!payload || typeof payload !== 'object') return []

  const source = payload as Record<string, unknown>
  for (const key of ['data', 'items', 'results', 'users', 'attendants', 'departments', 'views', 'ticket_views', 'ticketViews']) {
    if (Array.isArray(source[key])) return source[key] as unknown[]
  }

  return []
}

function readString(source: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number') return String(value)
  }
  return ''
}

function normalizeItems(payload: unknown): ClickDeskItem[] {
  return extractCollection(payload)
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null
      const source = item as Record<string, unknown>
      const id =
        readString(source, ['id', 'uuid', 'uid', 'user_id', 'userId', 'attendant_id', 'department_id', 'ticket_view_id', 'ticketViewId']) ||
        String(index + 1)
      const email = readString(source, ['email', 'email_address', 'emailAddress'])
      const name =
        readString(source, [
          'name',
          'full_name',
          'fullName',
          'display_name',
          'displayName',
          'title',
          'label',
          'email',
        ]) || `Registro ${index + 1}`

      return email ? { id, name, email } : { id, name }
    })
    .filter((item): item is ClickDeskItem => Boolean(item))
}

async function fetchClickDesk(path: string, apiKey: string, accountId: string) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12000)

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
      const apiMessage =
        typeof source.message === 'string'
          ? source.message
          : typeof source.error === 'string'
            ? source.error
            : `HTTP ${response.status}`
      throw new Error(`${path}: ${apiMessage}`)
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
    if (!supabaseUrl || !publishableKey) {
      return NextResponse.json({ error: 'Validação de acesso da homologação não configurada.' }, { status: 500 })
    }

    const client = createClient(supabaseUrl, publishableKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    })

    const {
      data: { user },
      error: userError,
    } = await client.auth.getUser(token)

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
      return NextResponse.json(
        {
          configured: false,
          error: 'Configure CLICKDESK_API_KEY e CLICKDESK_ACCOUNT_ID no ambiente Preview da Vercel.',
        },
        { status: 503 },
      )
    }

    const [usersResult, attendantsResult, departmentsResult, queuesResult] = await Promise.allSettled([
      fetchClickDesk('/users', apiKey, accountId),
      fetchClickDesk('/channel-attendants', apiKey, accountId),
      fetchClickDesk('/support-departments', apiKey, accountId),
      fetchClickDesk('/ticket-views', apiKey, accountId),
    ])

    const getResult = (result: PromiseSettledResult<unknown>) =>
      result.status === 'fulfilled'
        ? { ok: true as const, items: normalizeItems(result.value) }
        : { ok: false as const, items: [], error: sanitizeMessage(result.reason instanceof Error ? result.reason.message : String(result.reason)) }

    const users = getResult(usersResult)
    const attendants = getResult(attendantsResult)
    const departments = getResult(departmentsResult)
    const queues = getResult(queuesResult)

    const wantedQueueNames = ['suporte erp', 'suporte fiscal']
    const targetQueues = {
      ...queues,
      items: queues.items.filter((item) => wantedQueueNames.includes(item.name.trim().toLocaleLowerCase('pt-BR'))),
    }

    return NextResponse.json({
      configured: true,
      connected: users.ok || attendants.ok || departments.ok || queues.ok,
      tested_at: new Date().toISOString(),
      account_id: accountId,
      scope: ['Suporte ERP', 'Suporte Fiscal'],
      users,
      attendants,
      departments,
      queues: targetQueues,
    })
  } catch (error) {
    const message = error instanceof Error ? sanitizeMessage(error.message) : 'Erro inesperado.'
    return NextResponse.json({ error: `Falha ao testar o ClickDesk: ${message}` }, { status: 503 })
  }
}
