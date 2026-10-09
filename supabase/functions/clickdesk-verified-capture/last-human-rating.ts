/**
 * A customer rating belongs to the LAST human who served the ticket.
 * "Served" is proven by an explicit PUBLIC agent-authored message.
 * Never infer the last human from current owner, queue, AI hand-off or status.
 * This helper deliberately considers all agents, not just the local registry:
 * an external last agent must not transfer the rating to an earlier colleague.
 */
type R = Record<string, unknown>
const obj = (v: unknown): R =>
  v && typeof v === 'object' && !Array.isArray(v) ? v as R : {}
const str = (v: unknown): string =>
  typeof v === 'string' ? v.trim() :
  typeof v === 'number' && Number.isFinite(v) ? String(v) : ''
const explicitTimestamp = (value: string): boolean =>
  /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) && Number.isFinite(Date.parse(value))

export type LastHumanRatingOwner =
  | { ok: true; message_id: string; author_name: string; answered_at: string }
  | { ok: false; reason: 'no_public_agent_message' | 'ambiguous_public_agent_history' | 'simultaneous_last_authors' }

export function lastHumanRatingOwner(messages: unknown[]): LastHumanRatingOwner {
  const replies: Array<{ message_id: string; author_name: string; answered_at: string }> = []
  let incomplete = false
  for (const item of messages) {
    const m = obj(item), author = obj(m.author)
    const role = (str(m.author_type) || str(author.type)).toLowerCase()
    if (role !== 'agent') continue
    const visibility = str(m.visibility).toLowerCase()
    const publiclyVisible = visibility === 'public' ||
      (!visibility && (m.public === true || m.is_public === true))
    if (!publiclyVisible) continue
    const message_id = str(m.id) || str(m.message_id)
    const author_name = str(m.author_name) || str(m.author) || str(author.name)
    const answered_at = str(m.created_at) || str(m.createdAt) ||
      str(m.sent_at) || str(m.timestamp)
    if (!message_id || !author_name || !explicitTimestamp(answered_at)) {
      incomplete = true
      continue
    }
    replies.push({ message_id, author_name, answered_at })
  }
  if (incomplete) return { ok: false, reason: 'ambiguous_public_agent_history' }
  if (!replies.length) return { ok: false, reason: 'no_public_agent_message' }
  const latestTime = Math.max(...replies.map(r => Date.parse(r.answered_at)))
  const latest = replies.filter(r => Date.parse(r.answered_at) === latestTime)
  const names = new Set(latest.map(r => r.author_name.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()))
  if (names.size > 1) return { ok: false, reason: 'simultaneous_last_authors' }
  latest.sort((a,b)=>a.message_id.localeCompare(b.message_id,undefined,{numeric:true}))
  const winner = latest.at(-1)!
  return { ok:true, ...winner }
}
