import { createClient } from 'npm:@supabase/supabase-js@2'

// Homologação only. Reuse the canonical public-human-last-author rule and
// historical message/event pagination. No production token, no transcripts stored.
const HOMO = 'vvtorcvchnqhcredhorv.supabase.co'
const BASE = 'https://api.desk.click.app/api/v1'
const MAX_BATCH = 16
const MAX_SOURCE_ROWS = 20000
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


// Exact payload-unwrapping dependency of the canonical history reader.
const unwrap = (payload: unknown) => {
  const p = object(payload)
  return object(p.ticket || p.data || p)
}

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


type Candidate = { id:string; version:string; sourceDay:string; origin:string }
const str=(x:unknown)=>typeof x==='string'?x:''
async function sourceRows(admin:any,table:string,columns:string,order:string) {
  const all:Record<string,unknown>[]=[]
  for(let offset=0;offset<MAX_SOURCE_ROWS;offset+=500) {
    const result=await admin.from(table).select(columns).order(order,{ascending:true}).range(offset,offset+499)
    if(result.error)throw Error('candidate_source_unavailable_'+table)
    const items=(result.data??[]) as Record<string,unknown>[]
    all.push(...items)
    if(items.length<500)return all
  }
  throw Error('candidate_source_exceeded_safe_limit_'+table)
}
async function clickdeskGet(path:string,key:string,account:string) {
  const ctl=new AbortController()
  const timer=setTimeout(()=>ctl.abort(),12000)
  try {
    const r=await fetch(BASE+path,{headers:{Authorization:'Bearer '+key,'X-Account-Id':account,Accept:'application/json'},signal:ctl.signal})
    if(!r.ok)throw Error('clickdesk_http_'+r.status)
    return await r.json()
  } finally {clearTimeout(timer)}
}
Deno.serve(async(req:Request)=>{
  if(req.method!=='POST')return Response.json({error:'method_not_allowed'},{status:405})
  const url=Deno.env.get('SUPABASE_URL')??''
  if(!url || new URL(url).hostname!==HOMO)return Response.json({error:'homologation_only'},{status:403})
  const token=req.headers.get('authorization')?.replace(/^Bearer\s+/i,'').trim()??''
  if(!token)return Response.json({error:'unauthorized'},{status:401})
  const secretRaw=Deno.env.get('SUPABASE_SECRET_KEYS')
  const secret=secretRaw?JSON.parse(secretRaw).default:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if(!secret)return Response.json({error:'admin_config_unavailable'},{status:503})
  const admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}})
  // Token verified server-side by Vault RPC, never logged or returned.
  const creds=await admin.rpc('get_clickdesk_cron_credentials',{p_token:token})
  if(creds.error||!creds.data)return Response.json({error:'unauthorized'},{status:401})
  const key=str(creds.data.api_key),account=str(creds.data.account_id)
  if(!key||!account)return Response.json({error:'clickdesk_config_unavailable'},{status:503})
  let body:Record<string,unknown>={}
  try{const v:unknown=await req.json();body=object(v)}catch{return Response.json({error:'invalid_body'},{status:400})}
  if(Object.keys(body).some(k=>!['dry_run','commit_verified','limit','refresh_existing'].includes(k)))
    return Response.json({error:'unsupported_parameter'},{status:400})
  const dry=body.dry_run!==false
  if(!dry && body.commit_verified!==true)return Response.json({error:'commit_verified_required'},{status:403})
  const batch=body.limit===undefined?12:Number(body.limit)
  if(!Number.isSafeInteger(batch)||batch<1||batch>MAX_BATCH)return Response.json({error:'invalid_batch'},{status:400})
  const refresh=body.refresh_existing===true
  try {
    const [verified,legacy,capture,ledger,pending,roster]=await Promise.all([
      sourceRows(admin,'clickdesk_chat_verified_contributions','ticket_id,occurred_date,verified_at','ticket_id'),
      sourceRows(admin,'clickdesk_chat_attendances','clickdesk_ticket_id,occurred_date,updated_at','clickdesk_ticket_id'),
      sourceRows(admin,'clickdesk_chat_capture_queue','ticket_id,period_end,source_updated_at','ticket_id'),
      sourceRows(admin,'clickdesk_final_ticket_ledger','ticket_id,evidence_version,verified_at','ticket_id'),
      sourceRows(admin,'clickdesk_final_ticket_pending','ticket_id,checked_at,reason','ticket_id'),
      admin.from('chat_analysts').select('id,name,team_id,csat_goal'),
    ])
    if(roster.error)throw Error('roster_unavailable')
    const people:Person=(roster.data??[]).map((p:any)=>({id:p.id,name:p.name,team_id:p.team_id,csat_goal:Number(p.csat_goal)}))
    const map=new Map<string,Candidate>()
    const add=(id:unknown,version:unknown,day:unknown,origin:string)=>{
      const ticketId=text(id).trim()
      if(!/^\d{1,25}$/.test(ticketId))return
      const v=str(version), d=str(day)
      const prev=map.get(ticketId)
      if(!prev || v>prev.version || (d>prev.sourceDay && origin==='verified'))
        map.set(ticketId,{id:ticketId,version:v,sourceDay:d,origin})
    }
    for(const x of capture)add(x.ticket_id,x.source_updated_at,x.period_end,'capture')
    for(const x of legacy)add(x.clickdesk_ticket_id,x.updated_at,x.occurred_date,'legacy')
    for(const x of verified)add(x.ticket_id,x.verified_at,x.occurred_date,'verified')
    const done=new Set(ledger.map(x=>str(x.ticket_id)))
    const blocked=new Map(pending.map(x=>[str(x.ticket_id),{checked_at:str(x.checked_at),reason:str(x.reason)}]))
    // Pending authorship can become decidable after a new verified message,
    // analyst registration, or a transient transport failure. Retry only when
    // source evidence changed, or a narrow cooldown elapsed.
    const eligible=(candidate:Candidate)=>{
      if(refresh)return true
      if(done.has(candidate.id))return false
      const previous=blocked.get(candidate.id)
      if(!previous)return true
      const checked=Date.parse(previous.checked_at)
      const changed=Number.isFinite(checked)&&Number.isFinite(Date.parse(candidate.version))
        && Date.parse(candidate.version)>checked
      const age=Number.isFinite(checked)?Date.now()-checked:0
      const rosterRetry=previous.reason==='final_author_not_in_eligible_registry'&&age>86400000
      const transportRetry=/^(clickdesk_http_|history_read_failed|deadline)/.test(previous.reason)&&age>1800000
      return changed||rosterRetry||transportRetry
    }
    // Newest candidate first; previously confirmed historical evidence is
    // preserved until an explicitly requested refresh, not blindly overwritten.
    const remaining=[...map.values()].filter(eligible)
      .sort((a,b)=>b.sourceDay.localeCompare(a.sourceDay)||b.id.localeCompare(a.id))
    const candidates=remaining.slice(0,batch)
    const deadline=Date.now()+110000
    const evaluated: Array<FinalTicket&{version:string}> = new Array(candidates.length)
    let cursor=0
    await Promise.all(Array.from({length:4},async()=>{
      while(cursor<candidates.length){
        const index=cursor++,candidate=candidates[index]
        try{
          const evidence=await readTicketHistory(candidate.id,path=>{
            if(Date.now()>deadline)throw Error('deadline')
            return clickdeskGet(path,key,account)
          })
          const row=finalHumanTicket(candidate.id,evidence.messages,evidence.events,evidence.ticket,people,evidence.complete)
          evaluated[index]={...row,version:candidate.version}
        }catch(e){
          const reason=e instanceof Error && (/^clickdesk_http_\d+$|^deadline$/.test(e.message))?e.message:'history_read_failed'
          evaluated[index]={ticket_id:candidate.id,analyst_id:null,analyst_name:null,team_id:null,occurred_at:null,
            occurred_date:null,area:null,message_id:null,satisfaction_label:null,confirmed:false,
            reason,rating_timestamp_warning:false,version:candidate.version}
        }
      }
    }))
    const confirmed=evaluated.filter(x=>x.confirmed)
    const unresolved=evaluated.filter(x=>!x.confirmed)
    if(confirmed.some(x=>!x.analyst_id||!x.team_id||!x.message_id||!x.occurred_at||!x.occurred_date))
      throw Error('invalid_confirmed_evidence')
    if(!dry){
      const now=new Date().toISOString()
      if(confirmed.length){
        const rows=confirmed.map(x=>({ticket_id:x.ticket_id,analyst_id:x.analyst_id,team_id:x.team_id,
          last_public_message_id:x.message_id,last_public_at:x.occurred_at,occurred_date:x.occurred_date,
          area:x.area,satisfaction_label:x.satisfaction_label,rating_timestamp_warning:x.rating_timestamp_warning,
          evidence_source:'clickdesk_incremental_edge',evidence_version:x.version,
          verified_at:now,updated_at:now}))
        const result=await admin.from('clickdesk_final_ticket_ledger').upsert(rows,{onConflict:'ticket_id'})
        if(result.error)throw Error('ledger_write_failed')
        const clear=await admin.from('clickdesk_final_ticket_pending').delete().in('ticket_id',confirmed.map(x=>x.ticket_id))
        if(clear.error)throw Error('pending_clear_failed')
      }
      if(unresolved.length){
        const result=await admin.from('clickdesk_final_ticket_pending').upsert(
          unresolved.map(x=>({ticket_id:x.ticket_id,reason:x.reason??'history_incomplete',
            evidence_source:'clickdesk_incremental_edge',checked_at:now})),{onConflict:'ticket_id'})
        if(result.error)throw Error('pending_write_failed')
      }
      const [ledgerCount,pendingCount]=await Promise.all([
        admin.from('clickdesk_final_ticket_ledger').select('ticket_id',{count:'exact',head:true}),
        admin.from('clickdesk_final_ticket_pending').select('ticket_id',{count:'exact',head:true}),
      ])
      if(ledgerCount.error||pendingCount.error)throw Error('coverage_count_failed')
      const candidateCount=map.size, confirmedCount=Math.min(candidateCount,ledgerCount.count??0)
      const result=await admin.from('clickdesk_final_coverage').upsert({
        source_key:'captured_candidates_reconcile',start_date:'2026-09-01',end_date:new Date().toISOString().slice(0,10),
        candidate_count:candidateCount,confirmed_count:confirmedCount,
        pending_count:Math.min(pendingCount.count??0,Math.max(0,candidateCount-confirmedCount)),
        completeness:'partial',verified_at:now,
      },{onConflict:'source_key'})
      if(result.error)throw Error('coverage_write_failed')
    }
    // No names, ticket IDs, content, credentials or session identifiers returned.
    const reasons:Record<string,number>={}
    for(const x of unresolved){const r=x.reason??'unspecified';reasons[r]=(reasons[r]??0)+1}
    return Response.json({ok:true,mode:dry?'dry_run':'homologation_persisted',candidate_count:map.size,
      backlog_before:remaining.length,
      examined:evaluated.length,confirmed:confirmed.length,pending:unresolved.length,reasons,
      uncovered_cumulative:true,needs_another_batch:remaining.length>evaluated.length})
  }catch(e){
    const msg=e instanceof Error?e.message:'unknown'
    const safe=/^(candidate_source_|roster_unavailable|ledger_write_failed|pending_clear_failed|pending_write_failed|coverage_count_failed|coverage_write_failed|invalid_confirmed_evidence)/.test(msg)
    return Response.json({ok:false,error:safe?msg:'reconciliation_failed'},{status:503})
  }
})
