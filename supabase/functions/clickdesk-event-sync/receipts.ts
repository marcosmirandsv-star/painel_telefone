type Event = {id: string; field: string; old: string | null; new: string | null; created_at: string}
export type ReceiptPerson = {id: string; name: string; team_id: string}
export type TicketReceipt = {
  ticket_id: string; event_id: string; analyst_id: string; team_id: string
  received_at: string; occurred_date: string; department: string
}
const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim().replace(/\s+/g,' ')
const aliases: Record<string,string> = {'carlos henrique':'carlos lemos','joao pedro andrade':'joao pedro vianey'}
const nameKey = (value: string) => aliases[normalize(value)] ?? normalize(value)
const scope = new Set(['suporte - erp','suporte - fiscal'])
const businessDate = (value: string) => new Intl.DateTimeFormat('en-CA', {timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value))

/** One first receipt per ticket/person, dated by the ownership event, including silent email triage. */
export function projectTicketReceipts(ticketId: string, events: Event[], people: ReceiptPerson[], complete: boolean): TicketReceipt[] {
  if (!complete) throw new Error('receipt_history_incomplete')
  const seen = new Map<string,string>()
  for (const event of events) {
    if (!event.id || !Number.isFinite(Date.parse(event.created_at))) throw new Error('receipt_event_invalid')
    const signature = JSON.stringify(event)
    if (seen.has(event.id) && seen.get(event.id)!==signature) throw new Error('receipt_event_conflict')
    seen.set(event.id,signature)
  }
  const ordered = [...new Map(events.map(event=>[event.id,event])).values()].sort((a,b)=>Date.parse(a.created_at)-Date.parse(b.created_at)||a.id.localeCompare(b.id,undefined,{numeric:true}))
  const roster = new Map<string,ReceiptPerson>()
  for (const person of people) {
    const key=nameKey(person.name)
    if (roster.has(key)) throw new Error('receipt_owner_ambiguous')
    roster.set(key,person)
  }
  let department = ordered.find(event=>event.field==='department')?.old ?? null
  let owner: string | null = null
  const received = new Map<string,TicketReceipt>()
  for (const event of ordered) {
    if (event.field==='department') department=event.new
    if (event.field==='owner') owner=event.new
    if (!['owner','department'].includes(event.field)||!owner||!department||!scope.has(normalize(department))) continue
    const person=roster.get(nameKey(owner))
    if (!person||received.has(person.id)) continue
    received.set(person.id,{ticket_id:ticketId,event_id:event.id,analyst_id:person.id,team_id:person.team_id,
      received_at:new Date(event.created_at).toISOString(),occurred_date:businessDate(event.created_at),department})
  }
  return [...received.values()]
}
