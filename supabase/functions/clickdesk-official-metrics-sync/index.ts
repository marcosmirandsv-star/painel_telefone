import { createClient } from 'npm:@supabase/supabase-js@2'
import { receivedCount, receivedForOwner } from './received.ts'

const CLICKDESK_BASE_URL = 'https://api.desk.click.app/api/v1'
const BUSINESS_TIME_ZONE = 'America/Sao_Paulo'
const REPORT_DEPARTMENTS = [3, 12] as const

type RegistryOwner = {
  clickdesk_owner_id: number
  source_owner_name: string
  source_owner_key: string
}

type Aggregate = {
  source_owner_name: string
  source_owner_key: string
  attendances: number
  replies: number
  resolved: number
  positive_reviews: number
  negative_reviews: number
}

function normalized(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function businessDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${value.year}-${value.month}-${value.day}`
}

function monthStart(date: string) {
  return `${date.slice(0, 7)}-01`
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function numberValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && Number.isFinite(Number(value))) return Number(value)
  return 0
}

async function clickDesk(
  path: string,
  apiKey: string,
  accountId: string,
) {
  const response = await fetch(`${CLICKDESK_BASE_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'X-Account-Id': accountId,
      Accept: 'application/json',
    },
  })
  const raw = await response.text()
  if (!response.ok) throw new Error(`ClickDesk HTTP ${response.status}`)
  return raw ? JSON.parse(raw) : null
}

function query(params: Record<string, string | number | readonly number[]>) {
  const values = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const item of value) values.append(`${key}[]`, String(item))
    } else {
      values.set(key, String(value))
    }
  }
  return values.toString()
}

async function ratingPages(
  departmentId: number,
  start: string,
  end: string,
  apiKey: string,
  accountId: string,
) {
  const first = await clickDesk(
    `/support/reports/ratings?${query({ from: start, to: end, department_id: departmentId, page: 1 })}`,
    apiKey,
    accountId,
  )
  const root = asRecord(first)
  if (!Array.isArray(root.data) || !Number.isInteger(numberValue(root.last_page)) || numberValue(root.last_page) < 1 || numberValue(root.last_page) > 500) throw new Error('Invalid ratings pagination')
  const lastPage = numberValue(root.last_page)
  const pages: unknown[] = [first]
  for (let page = 2; page <= lastPage; page += 6) {
    const batch = Array.from({ length: Math.min(6, lastPage - page + 1) }, (_, i) => page + i)
    pages.push(...await Promise.all(batch.map((current) =>
      clickDesk(
        `/support/reports/ratings?${query({ from: start, to: end, department_id: departmentId, page: current })}`,
        apiKey,
        accountId,
      ),
    )))
  }
  const rows = pages.flatMap((page) => {
    const data = asRecord(page).data
    if (!Array.isArray(data)) throw new Error('Missing ratings page')
    return data
  })
  if (rows.length !== numberValue(root.total)) throw new Error('Incomplete ratings pagination')
  return rows
}

Deno.serve(async (req) => {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim()
  if (!token) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const secretKeys = Deno.env.get('SUPABASE_SECRET_KEYS')
  const legacyKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const serviceKey = secretKeys ? JSON.parse(secretKeys).default : legacyKey
  if (!supabaseUrl || !serviceKey) {
    return Response.json({ error: 'Supabase admin config unavailable' }, { status: 500 })
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const credentials = await admin.rpc('get_clickdesk_cron_credentials', { p_token: token })
  if (credentials.error || !credentials.data) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const apiKey = String(credentials.data.api_key ?? '')
  const accountId = String(credentials.data.account_id ?? '')
  if (!apiKey || !accountId) {
    return Response.json({ error: 'ClickDesk credentials unavailable' }, { status: 500 })
  }

  const today = businessDate()
  const yesterday = new Date(`${today}T12:00:00Z`)
  yesterday.setUTCDate(yesterday.getUTCDate() - 1)
  let end = yesterday.toISOString().slice(0, 10)
  let start = monthStart(end)
  // Explicit historical refreshes use the same authenticated capture path.
  try {
    const body = await req.json()
    if (body.start || body.end) {
      if (!/^20\d{2}-\d{2}-\d{2}$/.test(body.start ?? '') || !/^20\d{2}-\d{2}-\d{2}$/.test(body.end ?? '') ||
          body.start > body.end || body.end > end || (monthStart(body.end) !== body.start && body.start !== body.end) ||
          new Date(body.start+'T12:00:00Z').toISOString().slice(0,10)!==body.start ||
          new Date(body.end+'T12:00:00Z').toISOString().slice(0,10)!==body.end) {
        return Response.json({error:'Período inválido; somente dias encerrados em Brasília.'},{status:400})
      }
      start = body.start
      end = body.end
    }
  } catch { /* Scheduled requests may have no JSON body. */ }

  try {
    const registryResult = await admin
      .from('clickdesk_official_owner_registry')
      .select('clickdesk_owner_id,source_owner_name,source_owner_key')
      .eq('source_scope', 'suporte_erp_fiscal')
      .eq('active', true)

    if (registryResult.error) throw new Error(registryResult.error.message)
    const excludedOwnerIds = new Set([1, 12, 21, 26, 57, 59, 61, 77])
    const registry = ((registryResult.data ?? []) as RegistryOwner[]).filter(owner => !excludedOwnerIds.has(owner.clickdesk_owner_id))
    if (!registry.length) throw new Error('Official owner registry is empty')

    const ownerIds = registry.map((owner) => owner.clickdesk_owner_id)
    const agentsPayload = await clickDesk(
      `/support/reports/agents?${query({ from: start, to: end, department_ids: REPORT_DEPARTMENTS, owner_ids: ownerIds })}`,
      apiKey,
      accountId,
    )
    const agentRows = Array.isArray(asRecord(agentsPayload).agents)
      ? asRecord(agentsPayload).agents as unknown[]
      : []

    // Preserve historical captures; the coordinator's received-volume rule starts in November.
    const useReceived = start >= '2026-11-01'
    const receivedByOwner = new Map<number, number>()
    if (useReceived) {
      // Bounded concurrency keeps the reporting API from receiving a request burst.
      for (let offset = 0; offset < ownerIds.length; offset += 3) {
        const batch = ownerIds.slice(offset, offset + 3)
        const values = await Promise.all(batch.map(async ownerId => {
          const payload = await clickDesk(
            `/support/reports/agents?${query({ from: start, to: end, department_ids: REPORT_DEPARTMENTS, owner_ids: [ownerId] })}`,
            apiKey, accountId,
          )
          return [ownerId, receivedForOwner(payload, ownerId)] as const
        }))
        for (const [ownerId, value] of values) receivedByOwner.set(ownerId, value)
      }
      const groupReceived = receivedCount(agentsPayload)
      if ([...receivedByOwner.values()].reduce((n, value) => n + value, 0) !== groupReceived) {
        throw new Error('Individual received counts do not reconcile with the owner-group report')
      }
    }

    const [erpRatings, fiscalRatings] = await Promise.all(
      REPORT_DEPARTMENTS.map((departmentId) =>
        ratingPages(departmentId, start, end, apiKey, accountId),
      ),
    )
    const ratings = [...erpRatings, ...fiscalRatings]

    const known = new Map(registry.map((owner) => [owner.source_owner_key, owner]))
    const aggregate = new Map<string, Aggregate>()
    const ensure = (name: string | null | undefined) => {
      const displayName = name?.trim() || 'Sem responsável ClickDesk'
      const key = normalized(displayName) || 'sem responsavel clickdesk'
      const existing = aggregate.get(key)
      if (existing) return existing
      const registered = known.get(key)
      const canonicalKey = registered?.source_owner_key ?? key
      const canonical = aggregate.get(canonicalKey)
      if (canonical) return canonical
      const row: Aggregate = {
        source_owner_name: registered?.source_owner_name ?? displayName,
        source_owner_key: registered?.source_owner_key ?? key,
        attendances: 0,
        replies: 0,
        resolved: 0,
        positive_reviews: 0,
        negative_reviews: 0,
      }
      aggregate.set(canonicalKey, row)
      return row
    }

    for (const owner of registry) {
      const row = ensure(owner.source_owner_name)
      if (useReceived) row.attendances = receivedByOwner.get(owner.clickdesk_owner_id)!
    }

    for (const raw of agentRows) {
      const row = asRecord(raw)
      const registered = registry.find(owner => owner.clickdesk_owner_id === numberValue(row.id))
      if (!registered) continue
      // Source IDs establish aliases (Carlos Henrique = registered Carlos Lemos).
      if (typeof row.name === 'string') known.set(normalized(row.name), registered)
      const aggregateRow = ensure(registered.source_owner_name)
      if (!useReceived) aggregateRow.attendances += numberValue(row.resolved)
      aggregateRow.replies += numberValue(row.replies)
      aggregateRow.resolved += numberValue(row.resolved)
    }

    const seenRatings = new Map<string, string>()
    for (const raw of ratings) {
      const row = asRecord(raw)
      const ticketId = String(row.ticket_id ?? '')
      if (!/^\d+$/.test(ticketId)) throw new Error('Rating without technical ClickDesk ticket ID')
      const signature = JSON.stringify([row.owner, row.sentiment])
      if (seenRatings.has(ticketId)) {
        if (seenRatings.get(ticketId) !== signature) throw new Error('Conflicting duplicate rating')
        continue
      }
      seenRatings.set(ticketId, signature)
      const ownerName = typeof row.owner === 'string' ? row.owner : ''
      const registered = known.get(normalized(ownerName))
      if (!registered) continue
      const aggregateRow = ensure(registered.source_owner_name)
      const sentiment = typeof row.sentiment === 'string' ? row.sentiment.toLowerCase() : ''
      if (sentiment === 'positive') aggregateRow.positive_reviews += 1
      if (sentiment === 'negative') aggregateRow.negative_reviews += 1
    }

    for (const raw of agentRows) {
      const row = asRecord(raw)
      const registered = registry.find(owner => owner.clickdesk_owner_id === numberValue(row.id))
      if (!registered) continue
      const counts = aggregate.get(registered.source_owner_key)
      if (!counts || counts.positive_reviews + counts.negative_reviews !== numberValue(row.csat_total)) {
        throw new Error('Agent CSAT and paginated ratings do not reconcile')
      }
    }
    const capturedAt = new Date().toISOString()
    const records = [...aggregate.values()].map((row) => ({
      period_start: start,
      period_end: end,
      source_owner_name: row.source_owner_name,
      source_owner_key: row.source_owner_key,
      attendances: row.attendances,
      replies: row.replies,
      resolved: row.resolved,
      positive_reviews: row.positive_reviews,
      negative_reviews: row.negative_reviews,
      source_scope: 'suporte_erp_fiscal',
      captured_at: capturedAt,
      attendance_basis: useReceived ? 'received' : 'resolved',
      source_note: useReceived
        ? 'ClickDesk D-1: received tickets from single-owner report headers, reconciled with group header; evaluated-owner ratings scoped to ERP/Fiscal; resolved retained separately.'
        : 'ClickDesk D-1: resolved tickets and evaluated-owner ratings scoped to ERP/Fiscal and approved source owner IDs; deduplicated by technical ticket ID.',
    }))

    const save = await admin
      .from('clickdesk_official_period_metrics')
      .upsert(records, { onConflict: 'period_start,period_end,source_owner_key,source_scope' })
    if (save.error) throw new Error(save.error.message)

    const totals = records.reduce((sum, row) => ({
      attendances: sum.attendances + row.attendances,
      replies: sum.replies + row.replies,
      resolved: sum.resolved + row.resolved,
      positive_reviews: sum.positive_reviews + row.positive_reviews,
      negative_reviews: sum.negative_reviews + row.negative_reviews,
    }), { attendances: 0, replies: 0, resolved: 0, positive_reviews: 0, negative_reviews: 0 })

    return Response.json({
      ok: true,
      period: { start, end },
      owners: records.length,
      ratings: totals.positive_reviews + totals.negative_reviews,
      totals,
    })
  } catch (error) {
    console.error('clickdesk official metrics sync failed', error instanceof Error ? error.message : 'unexpected')
    return Response.json({ error: 'Official ClickDesk metrics sync failed' }, { status: 500 })
  }
})
