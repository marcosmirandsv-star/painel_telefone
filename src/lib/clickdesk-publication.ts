/** Current business day is visible; stable event dates protect previous days. */
export function clickDeskDailyAvailable(metrics?: {source?:string;publication?:{daily_available?:boolean}} | null) {
  if(!metrics)return false
  return metrics.publication?.daily_available ?? metrics.source !== 'clickdesk_official_period_metrics'
}
export function clickDeskPublicationDay(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now)
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  const today = `${values.year}-${values.month}-${values.day}`
  const day = new Date(`${today}T12:00:00Z`)
  return day.toISOString().slice(0, 10)
}

export function isOfficialClickDeskSource(source?:string) {
 return source==='clickdesk_official_period_metrics'||source==='clickdesk_event_receipts'
}

export function nextChatSyncAt(now=new Date()) {
 const next=new Date(now)
 next.setUTCSeconds(0,0)
 next.setUTCMinutes(Math.floor(next.getUTCMinutes()/30)*30+30)
 return next.toISOString()
}

export function publishedClickDeskEnd(end: string, now = new Date()) {
  const cutoff = clickDeskPublicationDay(now)
  return end < cutoff ? end : cutoff
}
