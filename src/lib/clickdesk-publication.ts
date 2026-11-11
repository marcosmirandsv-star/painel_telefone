/** Publication follows complete business days in Brasília (D-1). */
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
  day.setUTCDate(day.getUTCDate() - 1)
  return day.toISOString().slice(0, 10)
}

export function publishedClickDeskEnd(end: string, now = new Date()) {
  const cutoff = clickDeskPublicationDay(now)
  return end < cutoff ? end : cutoff
}
