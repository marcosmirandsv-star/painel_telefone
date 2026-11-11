import {createClient} from 'npm:@supabase/supabase-js@2.110.5'
import {projectTicketReceipts} from './receipts.ts'
const HOST='vvtorcvchnqhcredhorv.supabase.co'
const BASE='https://api.desk.click.app/api/v1'
const obj=(value:any)=>value&&typeof value==='object'&&!Array.isArray(value)?value:{}
const day=(value=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(value)
const normalize=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase().replace(/\s+/g,' ')
 const aliases:Record<string,string>={'carlos henrique':'carlos lemos','joao pedro andrade':'joao pedro vianey'}
 const canonical=(value:string)=>aliases[normalize(value)]??normalize(value)
async function digest(value:unknown){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))).map(x=>x.toString(16).padStart(2,'0')).join('')}
async function run(admin:any,credentials:any,body:any){
 const today=day(),period=body.period||today.slice(0,7),start=period+'-01',end=period===today.slice(0,7)?today:new Date(Date.UTC(Number(period.slice(0,4)),Number(period.slice(5,7)),0)).toISOString().slice(0,10)
 const deadline=Date.now()+100000
 const get=async(path:string)=>{const response=await fetch(BASE+path,{headers:{Authorization:'Bearer '+credentials.api_key,'X-Account-Id':credentials.account_id,Accept:'application/json'},signal:AbortSignal.timeout(18000)});if(!response.ok)throw Error('source_http_'+response.status);return response.json()}
 let deletedPromise:Promise<Map<string,string>>|null=null
 const deletedTickets=()=>deletedPromise??=(async()=>{
  const index=new Map<string,string>()
  for(let page=1;page<=100;page++){
   const payload=await get('/tickets?inbox=all&view=deleted&per_page=100&page='+page)
   if(!Array.isArray(payload.data))throw Error('deletion_evidence_invalid')
   for(const row of payload.data)if(Number.isFinite(Date.parse(row.deleted_at)))index.set(String(row.id),row.deleted_at)
   if(Number.isInteger(payload.last_page)&&page>=payload.last_page)break
  }
  return index
 })()
 try {
 const [registry,roster]=await Promise.all([admin.from('clickdesk_official_owner_registry').select('source_owner_key').eq('active',true).eq('source_scope','suporte_erp_fiscal'),admin.from('chat_analysts').select('id,name,team_id').eq('active',true)])
 if(registry.error||roster.error)throw Error('roster_unavailable')
 const allowed=new Set(registry.data.map((r:any)=>r.source_owner_key))
 const people=roster.data.filter((p:any)=>allowed.has(canonical(p.name)))
 await admin.from('clickdesk_event_sync_health').upsert({singleton:true,started_at:new Date().toISOString(),status:'capturing',error_code:null})
 if(body.ratings!==false){
  const rows:any[]=[];let expected:number|null=null
  for(let page=1;page<=100;page++){
   const payload=await get('/support/reports/ratings?'+new URLSearchParams({from:start,to:end,attendance:'human','department_ids[0]':'3','department_ids[1]':'12',per_page:'100',page:String(page)}))
   if(!Array.isArray(payload.data)||!Number.isInteger(payload.total)||!Number.isInteger(payload.last_page))throw Error('rating_pagination_invalid')
   if(expected===null)expected=payload.total
   if(expected!==payload.total)throw Error('ratings_changed_during_capture')
   rows.push(...payload.data)
   if(page===payload.last_page)break
   if(Date.now()>deadline-20000)throw Error('rating_capture_deadline')
  }
  if(rows.length!==expected)throw Error('rating_pagination_incomplete')
  const seen=new Map<string,string>()
  for(const row of rows){
   const id=String(row.ticket_id||''),person=people.find((p:any)=>canonical(p.name)===canonical(String(row.owner||'')))
   if(!person)continue
   if(!/^\d+$/.test(id)||!['positive','negative'].includes(row.sentiment))throw Error('rating_invalid')
   const match=/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(row.rated_at))
   if(!match)throw Error('rating_date_invalid')
   const at=`${match[3]}-${match[2]}-${match[1]}T${match[4]}:${match[5]}:${match[6]||'00'}-03:00`
   if(!Number.isFinite(Date.parse(at))||day(new Date(at))<start||day(new Date(at))>end)throw Error('rating_date_outside_period')
   const source={ticket_id:id,ticket_number:String(row.number||''),analyst_id:person.id,team_id:person.team_id,rated_at:at,occurred_date:day(new Date(at)),sentiment:row.sentiment,original_label:String(row.label||'')}
   const hash=await digest(source)
   if(seen.has(id)&&seen.get(id)!==hash)throw Error('rating_conflict')
   if(seen.has(id))continue
   seen.set(id,hash)
   const saved=await admin.rpc('save_clickdesk_event_rating',{p_row:{...source,source_hash:hash}})
   if(saved.error)throw Error('rating_write_failed')
  }
  await admin.from('clickdesk_event_sync_health').update({ratings_start:start,ratings_end:end,ratings_complete:true}).eq('singleton',true)
 }
 while(Date.now()<deadline-20000){
 const claim=await admin.rpc('claim_clickdesk_event_capture',{p_period:period,p_limit:Math.min(128,Math.max(1,Number(body.batch_size)||128))})
 if(claim.error)throw Error('event_claim_failed')
 if(!claim.data?.length)break
 let cursor=0,paused=false
 await Promise.all(Array.from({length:8},async()=>{
  while(cursor<claim.data.length&&!paused&&Date.now()<deadline-20000){
   const item=claim.data[cursor++]
   try {
    const events:any[]=[];const pages=new Set<string>();let complete=false
    for(let page=1;page<=50;page++){
     const payload=await get(`/tickets/${encodeURIComponent(item.ticket_id)}/events?page=${page}&per_page=200`)
     const rows=Array.isArray(payload)?payload:payload.data
     if(!Array.isArray(rows))throw Error('event_payload_invalid')
     const signature=JSON.stringify(rows.map((e:any)=>e.id))
     if(rows.length&&pages.has(signature))throw Error('event_pagination_repeated')
     pages.add(signature);events.push(...rows)
     const last=Number(obj(payload).last_page||obj(obj(payload).meta).last_page)
     if((Number.isInteger(last)&&last===page)||(!Number.isInteger(last)&&rows.length<200)){complete=true;break}
     if(Date.now()>deadline-15000)throw Error('event_capture_deadline')
    }
    const safe=events.map(e=>({id:String(e.id||''),field:String(e.field||''),old:typeof e.old==='string'?e.old:null,new:typeof e.new==='string'?e.new:null,created_at:String(e.created_at||'')}))
    // Only ownership/queue/timestamp evidence is persisted; no conversation or requester data.
    const receipts=projectTicketReceipts(item.ticket_id,safe,people,complete)
    const minimal=safe.filter(e=>['created','owner','department'].includes(e.field))
    const saved=await admin.rpc('finish_clickdesk_event_capture',{p_ticket:item.ticket_id,p_lease:item.lease_token,p_events:minimal,p_receipts:receipts})
    if(saved.error||saved.data!==true)throw Error('event_write_failed')
   }catch(error){
    const code=error instanceof Error?error.message:'event_capture_failed'
    if(code==='source_http_404'){
     try{
      const at=(await deletedTickets()).get(item.ticket_id)
      if(at){const proof=await admin.rpc('record_clickdesk_event_source_deletion',{p_ticket:item.ticket_id,p_lease:item.lease_token,p_deleted_at:at});if(!proof.error&&proof.data===true)continue}
     }catch{/* A missing ID without positive deletion evidence remains pending. */}
    }
    if(/source_http_(429|5\d\d)/.test(code))paused=true
    await admin.from('clickdesk_event_capture_queue').update({status:item.attempts>=4?'failed':'pending',lease_until:null,lease_token:null,error_code:/^[a-z_0-9]+$/.test(code)?code:'event_capture_failed',next_attempt_at:new Date(Date.now()+300000).toISOString()}).eq('ticket_id',item.ticket_id).eq('lease_token',item.lease_token)
   }
  }
 }))
 if(paused)break
 }
 const published=await admin.rpc('publish_clickdesk_event_days',{p_start:start,p_end:end})
 if(published.error)throw Error('event_publication_failed')
 if(!published.data)await admin.from('clickdesk_event_sync_health').update({status:'backfill_pending'}).eq('singleton',true)
 }catch(error){
  const message=error instanceof Error?error.message:'event_sync_failed'
  await admin.from('clickdesk_event_sync_health').upsert({singleton:true,status:'attention',error_code:/^[a-z_0-9]+$/.test(message)?message:'event_sync_failed'})
 }
}
Deno.serve(async(req:Request)=>{
 if(req.method!=='POST')return Response.json({error:'method_not_allowed'},{status:405})
 const url=Deno.env.get('SUPABASE_URL')||''
 if(!url||new URL(url).hostname!==HOST)return Response.json({error:'homologation_only'},{status:403})
 const raw=Deno.env.get('SUPABASE_SECRET_KEYS'),key=raw?JSON.parse(raw).default:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
 if(!key)return Response.json({error:'configuration_unavailable'},{status:503})
 const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})
 const token=req.headers.get('authorization')?.replace(/^Bearer\s+/i,'').trim()||''
 const credentials=await admin.rpc('get_clickdesk_cron_credentials',{p_token:token})
 if(credentials.error||!credentials.data)return Response.json({error:'unauthorized'},{status:401})
 let body:any={};try{body=await req.json()}catch{return Response.json({error:'invalid_body'},{status:400})}
 if(body.period&&(!/^20\d{2}-\d{2}$/.test(body.period)||body.period>day().slice(0,7)||body.period<'2026-11'))return Response.json({error:'invalid_period'},{status:400})
 EdgeRuntime.waitUntil(run(admin,credentials.data,body))
 return Response.json({ok:true,accepted:true,execution:'event_capture'},{status:202})
})
