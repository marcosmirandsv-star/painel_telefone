import { ApiError, authorizeManagerSessionClient, handle, json } from '@/lib/integration-server'
import { getServerSupabaseConfig } from '@/lib/runtime-environment'
import { captureFirstHumanAttendance, captureVerifiedHumanContributions, type AnalystIdentity } from '@/lib/clickdesk-human-capture'
import { extractRestRecords, normalizeRestMessage, normalizeRestEvent, unwrapRestTicket } from '@/lib/clickdesk-rest-evidence'
import { buildTicketProductivityEvidence } from '@/lib/clickdesk-ticket-productivity'

export const runtime = 'nodejs'

// Explicit, finite historical controls. No ticket discovery and no database writes.
const CONTROLS = ['1052413','1052418','1052420','1052423','1052426','1052430','1052444','1052445','1052460','1052473','1052476','1052481','1052489','1052493','1052494','1052499','1052559','1052563'] as const
const BASE = 'https://api.desk.click.app/api/v1'
const TIMEOUT_MS = 15000
const str = (v: unknown): string => typeof v === 'string' ? v : ''
async function get(path: string, key: string, account: string): Promise<unknown> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(BASE + path, { method:'GET', headers:{ Authorization:'Bearer ' + key, 'X-Account-Id':account, Accept:'application/json' }, cache:'no-store', signal:controller.signal })
    if (!response.ok) throw new ApiError(503, 'Falha de leitura ClickDesk: HTTP ' + response.status)
    return await response.json()
  } finally { clearTimeout(timeout) }
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
        const ticket = unwrapRestTicket(ticketPayload)
        const [eventsPayload, messagesPayload] = await Promise.all([get('/tickets/' + id + '/events', key, account), get('/tickets/' + id + '/messages', key, account)])
        const events = extractRestRecords(eventsPayload).map(normalizeRestEvent)
        const messages = extractRestRecords(messagesPayload).map(normalizeRestMessage)
        const input = { ticket_id:id, ticket_created_at:str(ticket.created_at), analysts, events, messages }
        const decision = captureFirstHumanAttendance(input)
        const contributions = captureVerifiedHumanContributions(input)
        results.push({ ticket_id:id, ok:decision.ok, ...(decision.ok ? {date:decision.value.human_answered_date,author:decision.value.author,area:decision.value.area_at_answer,first_message_id:decision.value.first_public_human_message_id,productivity_evidence:buildTicketProductivityEvidence(decision.value,ticket)} : {reason:decision.reason}), contributions: contributions.map(item => ({ analyst_id:item.analyst_id,analyst_name:item.author,answered_date:item.human_answered_date,verified_message_id:item.first_public_human_message_id,ticket_id:item.ticket_id })), unique_contributing_analysts:contributions.length, events_count:events.length, messages_count:messages.length })
      } catch (error) { results.push({ticket_id:id,ok:false,reason:'read_failed',detail:error instanceof Error ? error.message.slice(0,100) : 'unexpected_error'}) }
    }
    const accepted = results.filter(r=>r.ok)
    return json({mode:'diagnostic_read_only',database_writes:0,discovery_performed:false,total:results.length,accepted:accepted.length,results})
  })
}
