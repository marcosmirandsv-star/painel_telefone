import 'server-only'
import { adminClient, ApiError } from './integration-server'
import { createHash } from 'node:crypto'
import { unstable_cache } from 'next/cache'
import { finalHumanTicket, object, text, type FinalTicket, type Person } from './clickdesk-final-owner'

type Admin = ReturnType<typeof adminClient>
type Candidate = { ticket_id: string; analyst_id: string | null; occurred_date: string; version: string }
export type FinalSnapshot = { rows: FinalTicket[]; pending: Array<FinalTicket & { candidate_analyst_ids: string[] }>; people: Person[]; candidates: Candidate[]; captured_at: string }
const cache = new Map<string, { expires: number; promise: Promise<FinalSnapshot> }>()
const ticketCache = new Map<string, { expires:number; row:FinalTicket }>()

export function homologationReadAdmin() {
  if (process.env.VERCEL_ENV !== 'preview') throw new ApiError(404, 'Reconciliação exclusiva da homologação.')
  const url = process.env.NEXT_PUBLIC_HOMOLOGATION_SUPABASE_URL ?? 'https://vvtorcvchnqhcredhorv.supabase.co'
  if (new URL(url).hostname !== 'vvtorcvchnqhcredhorv.supabase.co') throw new ApiError(503, 'Projeto de homologação divergente.')
  return adminClient()
}

async function pages(admin: Admin, table: string, columns: string, order: string[]) {
  const rows: Record<string, unknown>[] = []
  for (let offset=0; offset<20000; offset+=500) {
    let query = admin.from(table).select(columns)
    for (const column of order) query = query.order(column, { ascending:true })
    const { data, error } = await query.range(offset, offset+499)
    if (error) throw new ApiError(503, 'Fonte de reconciliação indisponível: '+table)
    rows.push(...((data ?? []) as unknown as Record<string, unknown>[]))
    if ((data ?? []).length<500) return rows
  }
  throw new ApiError(422, 'Paginação da fonte excedeu o limite seguro; nenhum total definitivo foi produzido.')
}

const unwrap = (payload: unknown) => {
  const p = object(payload)
  return object(p.ticket || p.data || p)
}

/** Exposed separately for deterministic transport/pagination tests. Only HTTP GET. */
export async function readTicketHistory(id: string, get: (path:string)=>Promise<unknown>) {
  const ticket = unwrap(await get('/tickets/'+encodeURIComponent(id)))
  if(text(ticket.id)!==id)return {ticket,messages:[],events:[],complete:false}
  async function collection(kind:'messages'|'events') {
    const result: unknown[] = [], seen = new Set<string>()
    for (let page=1;page<=50;page++) {
      const raw=await get('/tickets/'+encodeURIComponent(id)+'/'+kind+'?page='+page+'&per_page=200')
      const payload=object(raw)
      const inner=object(payload.data)
      const values=Array.isArray(raw)?raw:payload[kind] ?? inner[kind] ?? payload.data
      if (!Array.isArray(values)) return { records:result, complete:false }
      const signature=JSON.stringify(values.map(v=>text(object(v).id)))
      if (values.length && seen.has(signature)) return { records:result, complete:false }
      seen.add(signature);result.push(...values)
      const lastPage=Number(payload.last_page || object(payload.meta).last_page || inner.last_page)
      if (Number.isFinite(lastPage) && lastPage>=page) {
        if(page===lastPage)return {records:result,complete:true}
      } else if(values.length<200)return {records:result,complete:true}
    }
    return {records:result,complete:false}
  }
  const [messages, events]=await Promise.all([collection('messages'),collection('events')])
  const embedded=Array.isArray(ticket.messages)?ticket.messages:[]
  const fetched=new Set(messages.records.map(m=>text(object(m).id)))
  // Detail can expose later records omitted by /messages. Never credit a truncated history.
  const detailMatches=Array.isArray(ticket.messages) && embedded.every(m=>fetched.has(text(object(m).id)))
  return { ticket, messages:messages.records, events:events.records,
    complete:messages.complete && events.complete && detailMatches }
}

export async function loadFinalSnapshot(admin: Admin): Promise<FinalSnapshot> {
  for (const [key,entry] of ticketCache) if(entry.expires<=Date.now())ticketCache.delete(key)
  const [legacy, verified, roster] = await Promise.all([
    pages(admin,'clickdesk_chat_attendances','clickdesk_ticket_id,analyst_id,occurred_date,updated_at',['clickdesk_ticket_id']),
    pages(admin,'clickdesk_chat_verified_contributions','ticket_id,analyst_id,occurred_date,verified_at',['ticket_id','analyst_id']),
    pages(admin,'chat_analysts','id,name,team_id,csat_goal',['id']),
  ])
  const candidates: Candidate[] = [
    ...legacy.map(r=>({ticket_id:text(r.clickdesk_ticket_id),analyst_id:text(r.analyst_id)||null,occurred_date:text(r.occurred_date),version:text(r.updated_at)})),
    ...verified.map(r=>({ticket_id:text(r.ticket_id),analyst_id:text(r.analyst_id)||null,occurred_date:text(r.occurred_date),version:text(r.verified_at)})),
  ]
  const people: Person[]=roster.map(r=>({id:text(r.id),name:text(r.name),team_id:text(r.team_id),csat_goal:Number(r.csat_goal)}))
  const key=createHash('sha256').update(JSON.stringify({candidates,people})).digest('hex')
  const existing=cache.get(key)
  if(existing && existing.expires>Date.now())return existing.promise
  const promise=(async()=>{
    const apiKey=process.env.CLICKDESK_API_KEY?.trim(), account=process.env.CLICKDESK_ACCOUNT_ID?.trim()
    if(!apiKey || !account)throw new ApiError(503,'Credenciais de leitura ClickDesk ausentes na homologação.')
    const deadline=Date.now()+240000
    const get=async(path:string)=>{
      if(Date.now()>deadline)throw new Error('audit_deadline')
      const response=await fetch('https://api.desk.click.app/api/v1'+path,{method:'GET',headers:{Authorization:'Bearer '+apiKey,'X-Account-Id':account,Accept:'application/json'},cache:'no-store',signal:AbortSignal.timeout(Math.min(15000,Math.max(1,deadline-Date.now())))})
      if(!response.ok)throw new Error('clickdesk_http_'+response.status)
      return response.json()
    }
    const ids=[...new Set(candidates.map(c=>c.ticket_id).filter(Boolean))].sort()
    const rosterVersion=createHash('sha256').update(JSON.stringify(people)).digest('hex')
    const rows: FinalTicket[]=[],pending: FinalSnapshot['pending']=[]
    let cursor=0
    await Promise.all(Array.from({length:12},async()=>{
      while(cursor<ids.length){
        const id=ids[cursor++]
        const version=candidates.filter(c=>c.ticket_id===id).map(c=>c.version).sort().at(-1) ?? ''
        const ticketKey=id+':'+version+':'+rosterVersion
        const cached=ticketCache.get(ticketKey)
        let row:FinalTicket
        try {
          if(cached && cached.expires>Date.now())row=cached.row
          else {
            // Private Next Data Cache shares minimal evidence between route instances.
            // No secrets, transcripts, Supabase writes or client authorization are cached.
            row=await unstable_cache(async()=>{
              const evidence=await readTicketHistory(id,get)
              return finalHumanTicket(id,evidence.messages,evidence.events,evidence.ticket,people,evidence.complete)
            },['hml-final-human-v1',account,ticketKey],{revalidate:300})()
            ticketCache.set(ticketKey,{expires:Date.now()+300000,row})
          }
        }
        catch(error){ row=finalHumanTicket(id,[],[],{},people,false);row.reason=error instanceof Error && /^clickdesk_http_\d+$|^audit_deadline$/.test(error.message)?error.message:'history_read_failed' }
        if(row.confirmed)rows.push(row)
        else pending.push({...row,candidate_analyst_ids:[...new Set(candidates.filter(c=>c.ticket_id===id).map(c=>c.analyst_id).filter((id):id is string=>Boolean(id)))]})
      }
    }))
    rows.sort((a,b)=>a.ticket_id.localeCompare(b.ticket_id));pending.sort((a,b)=>a.ticket_id.localeCompare(b.ticket_id))
    return {rows,pending,people,candidates,captured_at:new Date().toISOString()}
  })()
  // Ephemeral server memory only; no database writes, no persistent cache, no browser secrets.
  cache.clear();cache.set(key,{expires:Date.now()+300000,promise})
  try{const result=await promise; if(result.pending.some(p=>p.reason==='audit_deadline'))cache.delete(key);return result}catch(error){cache.delete(key);throw error}
}

export function scopedPending(snapshot: FinalSnapshot, id: string|null, team: string|null, start: string, end: string) {
  return snapshot.pending.filter(p=>snapshot.candidates.some(c=>c.ticket_id===p.ticket_id && c.occurred_date>=start && c.occurred_date<=end
    && (!id || c.analyst_id===id) && (!team || snapshot.people.some(a=>a.id===c.analyst_id && a.team_id===team))))
    .map(p=>({ticket_id:p.ticket_id,reason:p.reason}))
}

export function scopedExclusions(snapshot: FinalSnapshot, id:string|null, team:string|null, start:string, end:string) {
  return snapshot.rows.filter(row=>snapshot.candidates.some(c=>c.ticket_id===row.ticket_id && c.occurred_date>=start && c.occurred_date<=end
    && (!id || c.analyst_id===id) && (!team || snapshot.people.some(p=>p.id===c.analyst_id && p.team_id===team))))
    .filter(row=>(id && row.analyst_id!==id) || (team && row.team_id!==team) || row.occurred_date!<start || row.occurred_date!>end)
    .map(row=>({ticket_id:row.ticket_id,reason:row.occurred_date!<start || row.occurred_date!>end?'final_answer_outside_period':'credited_to_final_other_analyst'}))
}
