/**
 * Pure, read-only ClickDesk human attendance classifier.
 * Does not discover tickets, fetch network data, or persist results.
 * Inputs are normalized REST evidence; ambiguous evidence is rejected.
 */
export type HumanMessage = {
  id: string | number
  created_at: string
  author_type: string
  visibility: string
  author: string | null
}
export type DepartmentEvent = {
  id: string | number
  created_at: string
  field: string
  new: string | null
}
export type AnalystIdentity = {
  id: string
  team_id: string
  name: string
  identity_role: string
  active?: boolean
}
export type HumanCaptureInput = {
  ticket_id: string
  ticket_created_at: string
  messages: HumanMessage[]
  events: DepartmentEvent[]
  analysts: AnalystIdentity[]
}
export type HumanCaptureResult = {
  ticket_id: string
  ticket_created_at: string
  ticket_created_date: string
  first_public_human_message_id: string
  human_answered_at: string
  human_answered_date: string
  analyst_id: string
  team_id: string
  author: string
  area_at_answer: string | null
  department_event_id: string | null
}
export type CaptureDecision =
  | { ok: true; value: HumanCaptureResult }
  | { ok: false; reason: string }

function time(value: string): number {
  // Reject ambiguous timezone-free dates: ClickDesk timestamps must be absolute.
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return NaN
  return Date.parse(value)
}
function localDate(value: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(value))
  const get = (part: string) => parts.find(p => p.type === part)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}
function normalizeName(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ')
}
export function captureFirstHumanAttendance(input: HumanCaptureInput): CaptureDecision {
  if (!input.ticket_id || !Number.isFinite(time(input.ticket_created_at)))
    return { ok: false, reason: 'invalid_ticket' }
  const publicHuman = input.messages
    .filter(m => m.author_type === 'agent' && m.visibility === 'public' && Number.isFinite(time(m.created_at)))
    .sort((a, b) => time(a.created_at) - time(b.created_at) || String(a.id).localeCompare(String(b.id)))
  if (!publicHuman.length) return { ok: false, reason: 'no_public_human_message' }
  // A ticket may have received a public response in Comercial/Financeiro
  // before reaching our team. Credit the first verified response written by
  // a registered, non-apprentice analyst, not necessarily the first human
  // response on the entire ticket.
  const verified = publicHuman
    .filter(m => m.author?.trim() && String(m.id).trim() &&
      time(m.created_at) >= time(input.ticket_created_at))
    .map(message => ({
      message,
      analysts: input.analysts.filter(a =>
        a.active !== false && a.identity_role === 'analyst' &&
        normalizeName(a.name) === normalizeName(message.author!)),
    }))
    .find(candidate => candidate.analysts.length === 1)
  if (!verified) return { ok: false, reason: 'unconfirmed_or_ambiguous_analyst' }
  const first = verified.message
  const candidates = verified.analysts
  // Department is optional context: a human answer counts regardless of source queue.
  // Never infer historical area from the ticket's current department.
  const events = input.events
    .filter(e => e.field === 'department' && Number.isFinite(time(e.created_at)) && time(e.created_at) <= time(first.created_at))
    .sort((a, b) => time(b.created_at) - time(a.created_at) || String(b.id).localeCompare(String(a.id)))
  const department = events[0]
  return { ok: true, value: {
    ticket_id: input.ticket_id,
    ticket_created_at: new Date(input.ticket_created_at).toISOString(),
    ticket_created_date: localDate(input.ticket_created_at),
    first_public_human_message_id: String(first.id),
    human_answered_at: new Date(first.created_at).toISOString(),
    human_answered_date: localDate(first.created_at),
    analyst_id: candidates[0].id,
    team_id: candidates[0].team_id,
    author: candidates[0].name,
    area_at_answer: department?.new ?? null,
    department_event_id: department ? String(department.id) : null,
  } }
}

/**
 * One verified human attendance per (ticket ID, analyst ID), regardless of
 * ticket origin, prior IA, or department changes. Distinct human agents may
 * each contribute to the same ticket, but repeat messages/cycles by one agent
 * must never multiply their ticket count.
 *
 * These are contributions, NOT resolved counts, customer evaluations or CSAT.
 * Resolution is credited from the independent official agents report.
 */
export function captureVerifiedHumanContributions(input: HumanCaptureInput): HumanCaptureResult[] {
  if (!input.ticket_id || !Number.isFinite(time(input.ticket_created_at))) return []
  const analysts = new Map<string, AnalystIdentity[]>()
  for (const analyst of input.analysts) {
    if (analyst.identity_role !== 'analyst' || analyst.active === false) continue
    const key = normalizeName(analyst.name)
    analysts.set(key, [...(analysts.get(key) ?? []), analyst])
  }
  const messages = input.messages
    .filter(m => m.author_type === 'agent' && m.visibility === 'public' &&
      !!m.author?.trim() && !!String(m.id).trim() &&
      Number.isFinite(time(m.created_at)) &&
      time(m.created_at) >= time(input.ticket_created_at))
    .sort((a,b) => time(a.created_at) - time(b.created_at) ||
      String(a.id).localeCompare(String(b.id)))
  const departments = input.events
    .filter(e => e.field === 'department' && Number.isFinite(time(e.created_at)))
    .sort((a,b) => time(a.created_at) - time(b.created_at) ||
      String(a.id).localeCompare(String(b.id)))
  const seen = new Set<string>()
  const results: HumanCaptureResult[] = []
  for (const message of messages) {
    const candidate = analysts.get(normalizeName(message.author!)) ?? []
    if (candidate.length !== 1 || seen.has(candidate[0].id)) continue
    const analyst = candidate[0]
    seen.add(analyst.id)
    const areaEvent = departments.filter(e => time(e.created_at) <= time(message.created_at)).at(-1)
    results.push({
      ticket_id: input.ticket_id,
      ticket_created_at: new Date(input.ticket_created_at).toISOString(),
      ticket_created_date: localDate(input.ticket_created_at),
      first_public_human_message_id: String(message.id),
      human_answered_at: new Date(message.created_at).toISOString(),
      human_answered_date: localDate(message.created_at),
      analyst_id: analyst.id,
      team_id: analyst.team_id,
      author: analyst.name,
      area_at_answer: areaEvent?.new ?? null,
      department_event_id: areaEvent ? String(areaEvent.id) : null,
    })
  }
  return results
}
