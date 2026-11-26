import {captureReadiness} from './capture-plan.ts'
import {receivedForOwner} from './received.ts'
type RegistryOwner = {
  clickdesk_owner_id: number
  source_owner_name: string
  source_owner_key: string
}

type Aggregate = {
  source_owner_name: string
  source_owner_key: string
  attendances: number
  replies: number
  resolved: number
  positive_reviews: number
  negative_reviews: number
}

function normalized(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function numberValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && Number.isFinite(Number(value))) return Number(value)
  return 0
}

export function assembleCapture(registry:RegistryOwner[],start:string,end:string,parts:Record<string,unknown>){
 const ownerIds=registry.map(owner=>owner.clickdesk_owner_id)
 if(!captureReadiness(start,end,ownerIds,parts).ready)throw Error('capture_not_ready')
 const useReceived=true
 const receivedByOwner=new Map(ownerIds.map(id=>[id,receivedForOwner(parts['owner:'+id],id)]))
 const agentRows=asRecord(parts.group).agents
 if(!Array.isArray(agentRows))throw Error('invalid_group_agents')
 const ratings=[3,12].flatMap(department=>{
  const first=asRecord(parts[`ratings:${department}:1`])
  return Array.from({length:Number(first.last_page)},(_,i)=>asRecord(parts[`ratings:${department}:${i+1}`]).data as unknown[]).flat()
 })
    const known = new Map(registry.map((owner) => [owner.source_owner_key, owner]))
    const aggregate = new Map<string, Aggregate>()
    const ensure = (name: string | null | undefined) => {
      const displayName = name?.trim() || 'Sem responsável ClickDesk'
      const key = normalized(displayName) || 'sem responsavel clickdesk'
      const existing = aggregate.get(key)
      if (existing) return existing
      const registered = known.get(key)
      const canonicalKey = registered?.source_owner_key ?? key
      const canonical = aggregate.get(canonicalKey)
      if (canonical) return canonical
      const row: Aggregate = {
        source_owner_name: registered?.source_owner_name ?? displayName,
        source_owner_key: registered?.source_owner_key ?? key,
        attendances: 0,
        replies: 0,
        resolved: 0,
        positive_reviews: 0,
        negative_reviews: 0,
      }
      aggregate.set(canonicalKey, row)
      return row
    }

    for (const owner of registry) {
      const row = ensure(owner.source_owner_name)
      if (useReceived) row.attendances = receivedByOwner.get(owner.clickdesk_owner_id)!
    }

    for (const raw of agentRows) {
      const row = asRecord(raw)
      const registered = registry.find(owner => owner.clickdesk_owner_id === numberValue(row.id))
      if (!registered) continue
      // Source IDs establish aliases (Carlos Henrique = registered Carlos Lemos).
      if (typeof row.name === 'string') known.set(normalized(row.name), registered)
      const aggregateRow = ensure(registered.source_owner_name)
      if (!useReceived) aggregateRow.attendances += numberValue(row.resolved)
      aggregateRow.replies += numberValue(row.replies)
      aggregateRow.resolved += numberValue(row.resolved)
    }

    const seenRatings = new Map<string, string>()
    const cohortVotes:Record<string,unknown>[]=[]
    for (const raw of ratings) {
      const row = asRecord(raw)
      const ticketId = String(row.ticket_id ?? '')
      if (!/^\d+$/.test(ticketId)) throw new Error('Rating without technical ClickDesk ticket ID')
      const ownerName = typeof row.owner === 'string' ? row.owner : ''
      const registered = known.get(normalized(ownerName))
      if (!registered) continue
      const m=/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(row.rated_at))
      if(!m)throw Error('Rating timestamp missing')
      const ratedAt=`${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6]||'00'}-03:00`
      const eventKey=JSON.stringify([ticketId,registered.source_owner_key,ratedAt])
      const signature=JSON.stringify([row.sentiment,row.label])
      if(seenRatings.has(eventKey)){
        if(seenRatings.get(eventKey)!==signature)throw new Error('Conflicting duplicate rating')
        continue
      }
      seenRatings.set(eventKey,signature)
      const aggregateRow=ensure(registered.source_owner_name)
      if(useReceived)cohortVotes.push({ticket_id:ticketId,ticket_number:String(row.number??''),source_owner_key:registered.source_owner_key,sentiment:row.sentiment,original_label:String(row.label??''),rated_at:ratedAt})
      const sentiment = typeof row.sentiment === 'string' ? row.sentiment.toLowerCase() : ''
      if (sentiment === 'positive') aggregateRow.positive_reviews += 1
      if (sentiment === 'negative') aggregateRow.negative_reviews += 1
    }

    for (const raw of agentRows) {
      const row = asRecord(raw)
      const registered = registry.find(owner => owner.clickdesk_owner_id === numberValue(row.id))
      if (!registered) continue
      const counts = aggregate.get(registered.source_owner_key)
      if (!counts || counts.positive_reviews + counts.negative_reviews !== numberValue(row.csat_total)) {
        throw new Error('Agent CSAT and paginated ratings do not reconcile')
      }
    }
    const capturedAt = new Date().toISOString()
    const records = [...aggregate.values()].map((row) => ({
      period_start: start,
      period_end: end,
      source_owner_name: row.source_owner_name,
      source_owner_key: row.source_owner_key,
      attendances: row.attendances,
      replies: row.replies,
      resolved: row.resolved,
      positive_reviews: row.positive_reviews,
      negative_reviews: row.negative_reviews,
      source_scope: 'suporte_erp_fiscal',
      captured_at: capturedAt,
      attendance_basis: useReceived ? 'received' : 'resolved',
      source_note: useReceived
        ? 'ClickDesk intraday: received tickets from single-owner report headers, reconciled with group header; evaluated-owner ratings scoped to ERP/Fiscal; resolved retained separately.'
        : 'ClickDesk D-1: resolved tickets and evaluated-owner ratings scoped to ERP/Fiscal and approved source owner IDs; deduplicated by technical ticket ID.',
    }))

 return {records,votes:cohortVotes}
}
