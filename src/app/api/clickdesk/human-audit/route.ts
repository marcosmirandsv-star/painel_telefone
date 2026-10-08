import { ApiError, authorizeManagerSessionClient, handle, json } from '@/lib/integration-server'
import { getServerSupabaseConfig } from '@/lib/runtime-environment'
import { captureFirstHumanAttendance, type AnalystIdentity, type HumanMessage, type DepartmentEvent } from '@/lib/clickdesk-human-capture'

export const runtime = 'nodejs'

// Explicit, finite historical controls. No ticket discovery and no database writes.
const CONTROLS = ['1052413','1052418','1052420','1052423','1052426','1052430','1052444','1052445','1052460','1052473','1052476','1052481','1052489','1052493','1052494','1052499','1052559','1052563'] as const
const BASE = 'https://api.desk.click.app/api/v1'
const TIMEOUT_MS = 15000
const asRecord = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
const str = (v: unknown): string => typeof v === 'string' ? v : ''
const collection = (v: unknown): unknown[] => {
  if (Array.isArray(v)) return v
  const r = asRecord(v)
  for (const k of ['data','items','results','events','messages']) if (Array.isArray(r[k])) return r[k] as unknown[]
  return []
}
const iso = (v: unknown): string => str(v)

async function get(path: string, key: string, account: string): Promise<unknown> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(BASE + path, { method:'GET', headers:{ Authorization:'Bearer ' + key, 'X-Account-Id':account, Accept:'application/json' }, cache:'no-store', signal:controller.signal })
    if (!response.ok) throw new ApiError(503, 'Falha de leitura ClickDesk: HTTP ' + response.status)
    return await response.json()
  } finally { clearTimeout(timeout) }
}

function normalizeMessage(v: unknown): HumanMessage {
  const r = asRecord(v)
  return { id: str(r.id) || String(r.id ?? ''), created_at: iso(r.created_at), author_type: str(r.author_type), visibility: str(r.visibility), author: str(r.author) || null }
}
function normalizeEvent(v: unknown): DepartmentEvent {
  const r = asRecord(v)
  return { id: str(r.id) || String(r.id ?? ''), created_at: iso(r.created_at), field: str(r.field), new: str(r.new) || null }
}

/** POST read-only audit: authenticated manager; no request body or arbitrary ticket IDs accepted. */
export async function POST(request: Request) {
  return handle(async () => {
    const { environment } = getServerSupabaseConfig()
    if (environment !== 'homologacao') throw new ApiError(404, 'Somente homologação')
    const { admin } = await authorizeManagerSessionClient(request)
    const key = process.env.CLICKDESK_API_KEY?.trim()
    const account = process.env.CLICKDESK_ACCOUNT_ID?.trim()
    if (!key || !account) throw new ApiError(503, 'ClickDesk não configurado')
    const { data: people, error } = await admin.from('chat_analysts').select('id,team_id,name,active')
    if (error) throw new ApiError(503, 'Cadastro de analistas indisponível')
    const analysts: AnalystIdentity[] = (people ?? []).map((p: Record<string, unknown>) => ({ id:str(p.id), team_id:str(p.team_id), name:str(p.name), identity_role: /^(ana julia|ana júlia|david)(\\s|$)/i.test(str(p.name)) ? 'apprentice' : 'analyst', active:p.active !== false }))
    const results: Array<Record<string, unknown>> = []
    for (const id of CONTROLS) {
      try {
        const ticketPayload = await get('/tickets/' + id, key, account)
        const ticket = asRecord(asRecord(ticketPayload).data ?? ticketPayload)
        const [eventsPayload, messagesPayload] = await Promise.all([get('/tickets/' + id + '/events', key, account), get('/tickets/' + id + '/messages', key, account)])
        const events = collection(eventsPayload).map(normalizeEvent)
        const messages = collection(messagesPayload).map(normalizeMessage)
        const decision = captureFirstHumanAttendance({ ticket_id:id, ticket_created_at:iso(ticket.created_at), analysts, events, messages })
        results.push({ ticket_id:id, ok:decision.ok, ...(decision.ok ? {date:decision.value.human_answered_date,author:decision.value.author,area:decision.value.area_at_answer,first_message_id:decision.value.first_public_human_message_id} : {reason:decision.reason}), events_count:events.length, messages_count:messages.length })
      } catch { results.push({ticket_id:id,ok:false,reason:'read_failed'}) }
    }
    const accepted = results.filter(r=>r.ok)
    return json({mode:'diagnostic_read_only',database_writes:0,discovery_performed:false,total:results.length,accepted:accepted.length,results})
  })
}
