import { createClient } from 'npm:@supabase/supabase-js@2'

// Homologação only. Reuse the canonical public-human-last-author rule and
// historical message/event pagination. No production token, no transcripts stored.
const HOMO = 'vvtorcvchnqhcredhorv.supabase.co'
const BASE = 'https://api.desk.click.app/api/v1'
const MAX_BATCH = 128
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
  const ticketRequest = get('/tickets/'+encodeURIComponent(id))
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
  const [ticketPayload,messages,events]=await Promise.all([ticketRequest,collection('messages'),collection('events')])
  const ticket=unwrap(ticketPayload)
  if(text(ticket.id)!==id)return {ticket,messages:[],events:[],complete:false}
  const embedded=Array.isArray(ticket.messages)?ticket.messages:[]
  const fetched=new Set(messages.records.map(m=>text(object(m).id)))
  // Detail can expose later records omitted by /messages. Never credit a truncated history.
  const detailMatches=Array.isArray(ticket.messages) && embedded.every(m=>fetched.has(text(object(m).id)))
  if(events.complete && embedded.length>messages.records.length && messages.records.length>=200) {
    // The messages endpoint can ignore page and cap results at 200. Accept
    // the full detail only when a separately generated transcript corroborates
    // every message timestamp, human author and visibility, in the same order.
    const ids=embedded.map(value=>text(object(value).id))
    const unique=ids.every(Boolean)&&new Set(ids).size===ids.length
    const byId=new Map(embedded.map(value=>[text(object(value).id),object(value)]))
    const author=(m:Record<string,unknown>)=>text(object(m.author).name||m.author_name||(typeof m.author==='string'?m.author:'')).normalize('NFKC').trim().toLowerCase()
    const consistent=messages.records.every(value=>{
      const m=object(value),d=byId.get(text(m.id))
      return d&&text(d.created_at||d.timestamp)===text(m.created_at||m.timestamp)&&author(d)===author(m)&&text(d.visibility)===text(m.visibility)&&text(d.author_type)===text(m.author_type)
    })
    if(unique&&consistent) {
      const raw=await get('/tickets/'+encodeURIComponent(id)+'/transcript')
      const transcript=typeof raw==='string'?raw:text(object(raw).transcript||object(raw).text)
      const headers=Array.from(transcript.matchAll(/^\[(\d{2}\/\d{2}\/\d{4} \d{2}:\d{2})\] ([^\r\n]+):\s*$/gm))
      const corroborated=headers.length===embedded.length&&embedded.every((value,index)=>{
        const m=object(value),header=headers[index],at=new Date(text(m.created_at||m.timestamp))
        if(!Number.isFinite(at.getTime()))return false
        const iso=at.toISOString(),stamp=iso.slice(8,10)+'/'+iso.slice(5,7)+'/'+iso.slice(0,4)+' '+iso.slice(11,16)
        const internal=['private','internal'].includes(text(m.visibility).toLowerCase())||m.public===false||m.is_public===false
        if(header[1]!==stamp||internal!==/ \[nota interna\]$/i.test(header[2]))return false
        return text(m.author_type||object(m.author).type).toLowerCase()!=='agent'||Boolean(author(m)&&author(m)===header[2].replace(/ \[nota interna\]$/i,'').normalize('NFKC').trim().toLowerCase())
      })
      if(corroborated)return {ticket,messages:embedded,events:events.records,complete:true,history_source:'detail_and_transcript'}
    }
  }
  return { ticket, messages:messages.records, events:events.records,
    complete:messages.complete && events.complete && detailMatches }
}


type Candidate = { id:string; version:string; sourceDay:string; origin:string }
const str=(x:unknown)=>typeof x==='string'?x:''
async function clickdeskGet(path:string,key:string,account:string) {
  const ctl=new AbortController()
  const timer=setTimeout(()=>ctl.abort(),12000)
  try {
    const r=await fetch(BASE+path,{headers:{Authorization:'Bearer '+key,'X-Account-Id':account,Accept:'application/json'},signal:ctl.signal})
    if(!r.ok)throw Error('clickdesk_http_'+r.status)
    const raw=await r.text()
    try{return JSON.parse(raw)}catch{return raw}
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
  if(Object.keys(body).some(k=>!['dry_run','commit_verified','limit','refresh_existing','target_start','target_end','retry_history_exceptions'].includes(k)))
    return Response.json({error:'unsupported_parameter'},{status:400})
  const dry=body.dry_run!==false
  if(!dry && body.commit_verified!==true)return Response.json({error:'commit_verified_required'},{status:403})
  const batch=body.limit===undefined?12:Number(body.limit)
  if(!Number.isSafeInteger(batch)||batch<1||batch>MAX_BATCH)return Response.json({error:'invalid_batch'},{status:400})
  const refresh=body.refresh_existing===true
  // Reconciliar primeiro um período com lacuna comprovada, sem usar a data
  // do candidato como data final de crédito. Esta vem da última mensagem humana.
  const targetStart=typeof body.target_start==='string'?body.target_start:''
  const targetEnd=typeof body.target_end==='string'?body.target_end:''
  const targeted=Boolean(targetStart || targetEnd)
  const validDate=(value:string)=>/^20\d{2}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value))
    && new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value
  if(targeted && (!validDate(targetStart)||!validDate(targetEnd)||targetEnd<targetStart
      ||targetStart<'2026-09-01'||targetEnd>businessDate(new Date().toISOString())
      ||(Date.parse(targetEnd)-Date.parse(targetStart))>31*86400000))
    return Response.json({error:'invalid_target_date_window'},{status:400})
  // Never allow a scoped recovery job to refresh historical audited credits.
  if(targeted&&refresh)return Response.json({error:'scoped_refresh_not_supported'},{status:400})
  try {
    if(!dry)await admin.from('clickdesk_reconciliation_health').upsert({singleton:true,status:'running',last_started_at:new Date().toISOString(),error_code:null})
    const [selection,roster]=await Promise.all([
      body.retry_history_exceptions===true ? admin.rpc('get_clickdesk_reconciliation_exceptions',{p_limit:batch}) : admin.rpc('get_clickdesk_reconciliation_batch',{p_limit:batch,p_refresh:refresh,p_start:targeted?targetStart:null,p_end:targeted?targetEnd:null}),
      admin.from('chat_analysts').select('id,name,team_id,csat_goal'),
    ])
    if(selection.error||!selection.data)throw Error('candidate_source_unavailable_sql_batch')
    if(roster.error)throw Error('roster_unavailable')
    const people:Person[]=(roster.data??[]).map((p:any)=>({id:p.id,name:p.name,team_id:p.team_id,csat_goal:Number(p.csat_goal)}))
    const candidates:Candidate[]=selection.data.candidates??[]
    const candidateCount=Number(selection.data.candidate_count)
    const backlogBefore=Number(selection.data.backlog_before)
    const scopedCount=selection.data.discovered_in_target_period
    const deadline=Date.now()+110000
    const results: Array<FinalTicket&{version:string}> = new Array(candidates.length)
    let cursor=0,sourcePaused=false
    await Promise.all(Array.from({length:8},async()=>{
      while(cursor<candidates.length&&!sourcePaused){
        const index=cursor++,candidate=candidates[index]
        try{
          const evidence=await readTicketHistory(candidate.id,path=>{
            if(Date.now()>deadline)throw Error('deadline')
            return clickdeskGet(path,key,account)
          })
          const row=finalHumanTicket(candidate.id,evidence.messages,evidence.events,evidence.ticket,people,evidence.complete)
          results[index]={...row,version:candidate.version}
        }catch(e){
          if(e instanceof Error&&/^clickdesk_http_(429|5\d\d)$/.test(e.message))sourcePaused=true
          const reason=e instanceof Error && (/^clickdesk_http_\d+$|^deadline$/.test(e.message))?e.message:'history_read_failed'
          results[index]={ticket_id:candidate.id,analyst_id:null,analyst_name:null,team_id:null,occurred_at:null,
            occurred_date:null,area:null,message_id:null,satisfaction_label:null,confirmed:false,
            reason,rating_timestamp_warning:false,version:candidate.version}
        }
      }
    }))
    const evaluated=results.filter(Boolean)
    const confirmed=evaluated.filter(x=>x.confirmed)
    const unresolved=evaluated.filter(x=>!x.confirmed)
    if(confirmed.some(x=>!x.analyst_id||!x.team_id||!x.message_id||!x.occurred_at||!x.occurred_date))
      throw Error('invalid_confirmed_evidence')
    if(!dry&&unresolved.some(row=>row.reason==='clickdesk_http_404')){
      const missing=new Set(unresolved.filter(row=>row.reason==='clickdesk_http_404').map(row=>row.ticket_id))
      const deleted:Array<{ticket_id:string;deleted_at:string}>=[]
      try{
        for(let page=1;page<=20&&missing.size;page++){
          const result=await clickdeskGet('/tickets?inbox=all&view=deleted&sort=id&dir=asc&per_page=500&page='+page,key,account)
          const payload=object(result),items=Array.isArray(payload.data)?payload.data:Array.isArray(payload.tickets)?payload.tickets:[]
          for(const raw of items){const item=object(raw),id=text(item.id),at=text(item.deleted_at);if(missing.has(id)&&Number.isFinite(Date.parse(at))){deleted.push({ticket_id:id,deleted_at:at});missing.delete(id)}}
          const last=Number(payload.last_page)
          if(!Number.isSafeInteger(last)||page>=last||!items.length)break
        }
        if(deleted.length){
          const proven=new Set<string>()
          for(let offset=0;offset<deleted.length;offset+=32){
            const chunk=deleted.slice(offset,offset+32)
            const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(chunk))))).map(x=>x.toString(16).padStart(2,'0')).join('')
            const saved=await admin.rpc('record_clickdesk_source_deletions',{p_rows:chunk,p_hash:digest})
            if(!saved.error&&Array.isArray(saved.data))for(const id of saved.data)proven.add(id)
          }
          for(const row of unresolved)if(proven.has(row.ticket_id))row.reason='deleted_in_source'
        }
      }catch{/* An unproven deletion remains an explicit HTTP failure. */}
    }
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
      const confirmedCount=Math.min(candidateCount,ledgerCount.count??0)
      const result=await admin.from('clickdesk_final_coverage').upsert({
        source_key:'captured_candidates_reconcile',start_date:'2026-09-01',end_date:new Date().toISOString().slice(0,10),
        candidate_count:candidateCount,confirmed_count:confirmedCount,
        pending_count:Math.min(pendingCount.count??0,Math.max(0,candidateCount-confirmedCount)),
        completeness:'partial',verified_at:now,
      },{onConflict:'source_key'})
      if(result.error)throw Error('coverage_write_failed')
    }
    if(!dry) await admin.rpc('assess_clickdesk_period_inventory',{p_period:businessDate(new Date().toISOString()).slice(0,7)})
    if(!dry)await admin.from('clickdesk_reconciliation_health').upsert({singleton:true,status:'ready',last_finished_at:new Date().toISOString(),examined:evaluated.length,confirmed:confirmed.length,pending:unresolved.length,error_code:null})
    // No names, ticket IDs, content, credentials or session identifiers returned.
    const reasons:Record<string,number>={}
    for(const x of unresolved){const r=x.reason??'unspecified';reasons[r]=(reasons[r]??0)+1}
    return Response.json({ok:true,mode:dry?'dry_run':'homologation_persisted',candidate_count:candidateCount,
      backlog_before:backlogBefore,
      examined:evaluated.length,confirmed:confirmed.length,pending:unresolved.length,reasons,
      uncovered_cumulative:true,needs_another_batch:backlogBefore>evaluated.length,
      target_period:targeted?{start:targetStart,end:targetEnd}:null,
      discovered_in_target_period:scopedCount??null,
      confirmed_by_final_day:evaluated.filter(x=>x.confirmed).reduce<Record<string,number>>((acc,x)=>{
        const d=x.occurred_date??'unknown';acc[d]=(acc[d]??0)+1;return acc
      },{}),
    })
  }catch(e){
    const msg=e instanceof Error?e.message:'unknown'
    if(!dry)await admin.from('clickdesk_reconciliation_health').update({status:'error',error_code:'reconciliation_failed'}).eq('singleton',true)
    const safe=/^(candidate_source_|roster_unavailable|ledger_write_failed|pending_clear_failed|pending_write_failed|coverage_count_failed|coverage_write_failed|invalid_confirmed_evidence)/.test(msg)
    return Response.json({ok:false,error:safe?msg:'reconciliation_failed'},{status:503})
  }
})
