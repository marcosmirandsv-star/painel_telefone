export type Person = { id: string; name: string; team_id: string; csat_goal?: number }
export type RecordValue = Record<string, unknown>
export const object = (x: unknown): RecordValue => x && typeof x === 'object' && !Array.isArray(x) ? x as RecordValue : {}
export const text = (x: unknown): string => typeof x === 'string' || typeof x === 'number' ? String(x) : ''
export const normalize = (x: string) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' ')
export const apprentice = (x: string) => /^(ana julia|david)( |$)/.test(normalize(x))
export const businessDate = (x: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(x))

export type FinalTicket = {
  ticket_id: string; analyst_id: string | null; analyst_name: string | null; team_id: string | null
  occurred_at: string | null; occurred_date: string | null; area: string | null
  message_id: string | null; satisfaction_label: 'positive' | 'negative' | null
  confirmed: boolean; reason: string | null; rating_timestamp_warning: boolean
}

/** Never infer final authorship from an owner, a first response, or a rating. */
export function finalHumanTicket(id: string, messages: unknown[], events: unknown[], ticket: RecordValue, people: Person[], complete: boolean): FinalTicket {
  const base: FinalTicket = { ticket_id: id, analyst_id: null, analyst_name: null, team_id: null, occurred_at: null, occurred_date: null, area: null, message_id: null, satisfaction_label: null, confirmed: false, reason: null, rating_timestamp_warning: false }
  const pending = (reason: string) => ({ ...base, reason })
  if (!complete) return pending('history_incomplete')
  const identities = new Map<string, string>()
  for (const item of messages.map(object)) {
    const key = text(item.id)
    const signature = JSON.stringify([item.author,item.author_type,item.created_at,item.timestamp,item.visibility])
    if (key && identities.has(key) && identities.get(key) !== signature) return pending('message_id_conflict')
    if (key) identities.set(key, signature)
  }
  const human = messages.map(object).filter(m => {
    const visibility = text(m.visibility).toLowerCase()
    const publicMessage = visibility === 'public' || m.public === true || m.is_public === true
    return publicMessage && m.public !== false && m.is_public !== false && !['private', 'internal'].includes(visibility)
      && text(m.author_type || object(m.author).type).toLowerCase() === 'agent'
  })
  if (!human.length) return pending('no_public_human_answer')
  const timestamp = (m: RecordValue) => text(m.created_at || m.timestamp)
  if (human.some(m => !Number.isFinite(Date.parse(timestamp(m))))) return pending('human_timestamp_missing')
  const latestAt = Math.max(...human.map(m => Date.parse(timestamp(m))))
  const latest = human.filter(m => Date.parse(timestamp(m)) === latestAt)
  const author = (m: RecordValue) => text(object(m.author).name || m.author_name || (typeof m.author === 'string' ? m.author : ''))
  const names = [...new Set(latest.map(m => normalize(author(m))))]
  if (names.length !== 1 || !names[0]) return pending('final_author_ambiguous')
  const found = people.filter(p => normalize(p.name) === names[0])
  if (found.length !== 1) return pending('final_author_not_in_eligible_registry')
  const person = found[0]
  if (apprentice(person.name)) return pending('final_author_apprentice')
  const last = latest[0]
  if (!text(last.id)) return pending('final_message_id_missing')
  const at = new Date(latestAt).toISOString()
  const departmentEvents = events.map(object).filter(e => text(e.field) === 'department' && Number.isFinite(Date.parse(text(e.created_at || e.timestamp))))
  const before = departmentEvents.filter(e => Date.parse(text(e.created_at || e.timestamp)) <= latestAt).sort((a,b) => Date.parse(text(b.created_at || b.timestamp)) - Date.parse(text(a.created_at || a.timestamp)))
  const after = departmentEvents.filter(e => Date.parse(text(e.created_at || e.timestamp)) > latestAt).sort((a,b) => Date.parse(text(a.created_at || a.timestamp)) - Date.parse(text(b.created_at || b.timestamp)))
  const area = before.length ? text(before[0].to || before[0].new) : after.length ? text(after[0].from || after[0].old) : ''
  const satisfaction = object(ticket.satisfaction)
  const sentiment = text(satisfaction.sentiment).toLowerCase()
  const score = ['positive','negative'].includes(sentiment) ? sentiment as 'positive'|'negative' : null
  const ratedAt = text(satisfaction.rated_at || satisfaction.created_at)
  const ratingTimeKnown = Number.isFinite(Date.parse(ratedAt))
  // Official rule: the ticket's explicit evaluation follows its proven final human.
  // Keep chronology warnings visible; never introduce a new rating eligibility rule.
  const ratingPending = score !== null && (!ratingTimeKnown || Date.parse(ratedAt) < latestAt)
  return { ...base, analyst_id: person.id, analyst_name: person.name, team_id: person.team_id, occurred_at: at, occurred_date: businessDate(at), area: area || null,
    message_id: text(last.id), confirmed: true, satisfaction_label: score, rating_timestamp_warning: ratingPending }
}

export function aggregateFinal(rows: FinalTicket[]) {
  const attendances = new Set(rows.map(r => r.ticket_id)).size
  const positive_reviews = rows.filter(r => r.satisfaction_label === 'positive').length
  const negative_reviews = rows.filter(r => r.satisfaction_label === 'negative').length
  const reviews = positive_reviews + negative_reviews
  return { attendances, positive_reviews, negative_reviews, reviews,
    csat: reviews ? Math.round(positive_reviews / reviews * 10000) / 100 : null,
    review_percentage: attendances ? Math.round(reviews / attendances * 10000) / 100 : null }
}

/** Matches the existing self-podium SQL thresholds, ordering and team-average denominator. */
export function finalPodium(rows: FinalTicket[], people: Person[], id: string) {
  const person = people.find(p => p.id === id)
  const team = people.filter(p => p.team_id === person?.team_id && !apprentice(p.name)).map(p => ({ id: p.id, ...aggregateFinal(rows.filter(r => r.analyst_id === p.id)) })).filter(p => p.attendances > 0)
  const average = team.length ? Math.round(team.reduce((s,p) => s + p.attendances, 0) / team.length * 100) / 100 : 0
  const eligible = (p: typeof team[number]) => (p.csat ?? 0) >= 90 && (p.review_percentage ?? 0) >= 25 && p.attendances >= average
  team.sort((a,b) => Number(eligible(b))-Number(eligible(a)) || (b.csat??0)-(a.csat??0) || (b.review_percentage??0)-(a.review_percentage??0) || b.attendances-a.attendances || a.id.localeCompare(b.id))
  const own = team.find(p => p.id === id)
  const csat_met = (own?.csat ?? 0) >= 90, review_met = (own?.review_percentage ?? 0) >= 25, volume_met = (own?.attendances ?? 0) >= average
  return { team_average_attendances: average, team_analysts_with_data: team.length, total_ranked: team.length,
    position: own ? team.findIndex(p => p.id === id)+1 : null, eligible: own ? eligible(own) : false,
    criteria: { csat_min:90, review_min:25, volume_min:average, csat_met, review_met, volume_met, completed:Number(csat_met)+Number(review_met)+Number(volume_met) } }
}
