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
  const first = publicHuman[0]
  if (!first.author?.trim() || !String(first.id).trim()) return { ok: false, reason: 'missing_author_or_message_id' }
  if (time(first.created_at) < time(input.ticket_created_at))
    return { ok: false, reason: 'message_before_ticket_creation' }
  const candidates = input.analysts.filter(a =>
    a.active !== false && normalizeName(a.name) === normalizeName(first.author!) && a.identity_role === 'analyst')
  if (candidates.length !== 1) return { ok: false, reason: 'unconfirmed_or_ambiguous_analyst' }
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
