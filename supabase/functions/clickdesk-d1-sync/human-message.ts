/** An explicitly public message authored by the listed human agent.
 * No inference from ticket assignment, private notes, AI or updated_at.
 * Conservative: missing/ambiguous authorship means no confirmed attendance.
 */
function norm(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toLocaleLowerCase('pt-BR').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ')
}
function record(value: unknown): Record<string,unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string,unknown> : {}
}
function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() :
    typeof value === 'number' && Number.isFinite(value) ? String(value) : ''
}
export type VerifiedAssigneeReply = { messageId:string; timestamp:string; author:string }

export function firstPublicReplyByAssignee(messages: unknown[], assigneeName: string): VerifiedAssigneeReply | null {
  const wanted = norm(assigneeName)
  if (!wanted) return null
  const matches: VerifiedAssigneeReply[] = []
  for (const value of messages) {
    const m = record(value)
    const a = record(m.author)
    const author = str(m.author_name) || str(m.author) || str(a.name)
    const kind = str(m.author_type) || str(a.type)
    const visibility = str(m.visibility).toLowerCase()
    const publicMessage = visibility === 'public' ||
      (!visibility && (m.public === true || m.is_public === true))
    const timestamp = str(m.created_at) || str(m.createdAt) ||
      str(m.sent_at) || str(m.timestamp)
    const id = str(m.id) || str(m.message_id)
    if (kind.toLowerCase() !== 'agent' || !publicMessage || !id ||
      !author || norm(author) !== wanted || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(timestamp) ||
      !Number.isFinite(Date.parse(timestamp))) continue
    matches.push({messageId:id,timestamp,author})
  }
  matches.sort((a,b)=>Date.parse(a.timestamp)-Date.parse(b.timestamp) ||
    a.messageId.localeCompare(b.messageId))
  return matches[0] ?? null
}
