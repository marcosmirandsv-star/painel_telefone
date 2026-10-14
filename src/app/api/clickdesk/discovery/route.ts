import { randomUUID } from 'node:crypto'
import { ApiError, authorizeClickDeskSessionClient, handle, json } from '@/lib/integration-server'
import { getServerSupabaseConfig } from '@/lib/runtime-environment'

export const runtime = 'nodejs'
export const maxDuration = 60

const BASE = 'https://api.desk.click.app/api/v1'

type Probe = {
  source: string
  http_status: number | null
  elapsed_ms: number
  page_items: number | null
  last_page: number | null
  response_keys: string[]
  error: string | null
}

function collection(data: unknown): unknown[] | null {
  if (Array.isArray(data)) return data
  if (!data || typeof data !== 'object') return null
  const record = data as Record<string, unknown>
  for (const name of ['tickets', 'items', 'results', 'data', 'reports']) {
    if (Array.isArray(record[name])) return record[name] as unknown[]
    const nested = record[name]
    if (nested && typeof nested === 'object') {
      const result = collection(nested)
      if (result) return result
    }
  }
  return null
}

async function probe(name: string, path: string, apiKey: string, account: string): Promise<Probe> {
  const started = Date.now()
  try {
    const response = await fetch(BASE + path, {
      method: 'GET',
      headers: {
        Authorization: 'Bearer ' + apiKey,
        'X-Account-Id': account,
        Accept: 'application/json',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(12000),
    })
    if (!response.ok) {
      return {source:name,http_status:response.status,elapsed_ms:Date.now()-started,
        page_items:null,last_page:null,response_keys:[],error:'clickdesk_http_'+response.status}
    }
    const value: unknown = await response.json()
    const obj = value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown> : {}
    const meta = obj.meta && typeof obj.meta === 'object' ? obj.meta as Record<string, unknown> : {}
    const rawPage = obj.last_page ?? meta.last_page
    const page = Number(rawPage)
    return {
      source:name,http_status:response.status,elapsed_ms:Date.now()-started,
      page_items:collection(value)?.length ?? null,
      last_page:Number.isFinite(page) && page > 0 ? page : null,
      response_keys:Object.keys(obj).slice(0,15),
      error:null,
    }
  } catch {
    return {source:name,http_status:null,elapsed_ms:Date.now()-started,
      page_items:null,last_page:null,response_keys:[],error:'request_failed_or_timeout'}
  }
}

/**
 * Comparação de superfície, não é sincronização e não calcula tickets humanos.
 * Retorna somente forma, páginas e contagens da primeira página (não payload).
 */
export async function GET(request: Request) {
  const traceId = randomUUID()
  const started = Date.now()
  let stage = 'authorization'
  const response = await handle(async () => {
    if (getServerSupabaseConfig().environment !== 'homologacao') {
      throw new ApiError(404, 'Descoberta ClickDesk restrita à homologação.')
    }
    const access = await authorizeClickDeskSessionClient(request)
    if (!access.isManagement || access.role !== 'master') {
      throw new ApiError(403, 'Diagnóstico de descoberta exclusivo do Master.')
    }
    const apiKey = process.env.CLICKDESK_API_KEY?.trim()
    const account = process.env.CLICKDESK_ACCOUNT_ID?.trim()
    if (!apiKey || !account) throw new ApiError(503, 'Credenciais ClickDesk não disponíveis.')
    stage = 'remote'
    const date = new URL(request.url).searchParams.get('date') ?? ''
    if (!/^20\d{2}-\d{2}-\d{2}$/.test(date)) {
      throw new ApiError(400, 'Informe date no formato AAAA-MM-DD.')
    }
    const from = encodeURIComponent(date + 'T00:00:00')
    const to = encodeURIComponent(date + 'T23:59:59')
    const sources = await Promise.all([
      probe('human_filter', '/tickets?inbox=conversations&attendance=human&page=1', apiKey, account),
      probe('tickets_unfiltered', '/tickets?page=1', apiKey, account),
      probe('support_reports_fiscal', '/support/reports?from='+from+'&to='+to+'&department_id=12', apiKey, account),
      probe('support_reports_erp', '/support/reports?from='+from+'&to='+to+'&department_id=3', apiKey, account),
    ])
    stage = 'completed'
    return json({trace_id:traceId,date,discovery_status:'first_page_probe_only',sources,
      note:'Amostra de resposta da primeira página. Nenhum ticket foi criado, alterado ou gravado.'})
  })
  console.info('clickdesk_discovery_probe',JSON.stringify({
    trace_id:traceId,status:response.status,stage,duration_ms:Date.now()-started,
  }))
  return response
}
