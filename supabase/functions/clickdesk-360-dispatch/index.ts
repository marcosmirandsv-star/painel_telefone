import { createClient } from 'npm:@supabase/supabase-js@2.110.5'
import { extractTranscriptText, isQualitativeTranscriptSufficient, normalizeQualitativeAnalysis, QUALITATIVE_ANALYSIS_VERSION, shouldReuseQualitativeCache, qualitativeAnalysisVersion } from './qualitative.ts'
import { buildQualitativePrompt } from './prompt.ts'

const HOMO = 'vvtorcvchnqhcredhorv.supabase.co'
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}})
const day=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
const validDate=(s:string)=>/^20\d{2}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s
class WorkError extends Error { constructor(public code:string){super(code)} }
async function requestJson(url:string,init:RequestInit,ms:number,service='source'){
 const response=await fetch(url,{...init,signal:AbortSignal.timeout(ms)})
 const raw=await response.text()
 let data:any
 try{data=raw?JSON.parse(raw):null}catch{data=raw}
 if(!response.ok)throw new WorkError(service+'_http_'+response.status)
 return data
}
async function work(admin:any,config:any){
 const deadline=Date.now()+100000
 let completed=0,failed=0,throttled=false
 const state=await admin.from('clickdesk_360_worker_health').select('cooldown_until').eq('singleton',true).single()
 if(state.data?.cooldown_until && Date.parse(state.data.cooldown_until)>Date.now())return
 await admin.from('clickdesk_360_worker_health').upsert({singleton:true,status:'running',last_started_at:new Date().toISOString(),error_code:null})
 try{
 while(Date.now()<deadline-35000){
 const claim=await admin.rpc('claim_clickdesk_360_work',{p_limit:2})
 if(claim.error)throw new WorkError('queue_claim_failed')
 if(!claim.data?.length)break
 await Promise.all(claim.data.map(async(item:any)=>{
 try{
 const ledger=await admin.from('clickdesk_final_ticket_ledger').select('ticket_id,analyst_id,satisfaction_label,occurred_date,area').eq('ticket_id',item.ticket_id).single()
 if(ledger.error||!ledger.data)throw new WorkError('ledger_unavailable')
 const l=ledger.data
 const cache=await admin.from('clickdesk_qualitative_analyses').select('analyst_id,occurred_date,satisfaction_label,analysis,validation_status').eq('clickdesk_ticket_id',item.ticket_id).maybeSingle()
 const q=cache.data
 if(q&&q.analyst_id===l.analyst_id&&q.occurred_date===l.occurred_date&&q.satisfaction_label===l.satisfaction_label&&shouldReuseQualitativeCache(q.validation_status,qualitativeAnalysisVersion(q.analysis))){
 await admin.from('clickdesk_360_work_queue').update({status:'done',completed_at:new Date().toISOString(),lease_token:null,lease_until:null,error_code:null,updated_at:new Date().toISOString()}).eq('ticket_id',item.ticket_id).eq('lease_token',item.lease_token)
 completed++;return
 }
 const raw=await requestJson('https://api.desk.click.app/api/v1/tickets/'+encodeURIComponent(item.ticket_id)+'/transcript',{
 headers:{Authorization:'Bearer '+config.api_key,'X-Account-Id':config.account_id,Accept:'application/json'}},15000)
 const transcript=extractTranscriptText(raw)
 if(!isQualitativeTranscriptSufficient(transcript))throw new WorkError('transcript_insufficient')
 const prompt=buildQualitativePrompt({transcript,satisfaction:l.satisfaction_label,area:l.area,occurredDate:l.occurred_date})
 const result=await requestJson('https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(config.model||'gemini-3.5-flash-lite')+':generateContent',{
 method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':config.google_api_key},
 body:JSON.stringify({systemInstruction:{parts:[{text:'Analise atendimento de forma conservadora. Evidência insuficiente deve resultar em unclear, nunca em invenção.'}]},
 contents:[{role:'user',parts:[{text:prompt}]}],
 generationConfig:{maxOutputTokens:1800,responseMimeType:'application/json',thinkingConfig:{thinkingLevel:'low'}}})},40000,'provider')
 const content=result?.candidates?.[0]?.content?.parts?.map((p:any)=>p.text||'').join('').trim()
 if(!content)throw new WorkError('provider_empty')
 let parsed:unknown
 try{parsed=JSON.parse(content.replace(/^\s*```(?:json)?\s*/i,'').replace(/\s*```\s*$/i,''))}catch{throw new WorkError('provider_invalid_json')}
 const normalized=normalizeQualitativeAnalysis(parsed,l.satisfaction_label)
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(transcript)))).map(x=>x.toString(16).padStart(2,'0')).join('')
 const saved=await admin.rpc('finish_clickdesk_360_work',{p_ticket:item.ticket_id,p_lease:item.lease_token,
 p_analysis:{...normalized,_analysis_version:QUALITATIVE_ANALYSIS_VERSION},p_model:config.model||'gemini-3.5-flash-lite',p_hash:hash,p_characters:transcript.length})
 if(saved.error||saved.data!==true)throw new WorkError('result_not_saved')
 completed++
 }catch(error){
 const code=error instanceof WorkError?error.code:(error instanceof Error&&/Timeout|Abort/.test(error.name)?'request_timeout':'worker_error')
 const rateLimited=code.endsWith('_http_429')
 if(rateLimited){throttled=true;await admin.from('clickdesk_360_worker_health').update({status:'cooldown',cooldown_until:new Date(Date.now()+300000).toISOString(),error_code:code}).eq('singleton',true)}
 const terminal=!rateLimited&&(item.attempts>=3||['transcript_insufficient','authorship_changed'].includes(code))
 await admin.from('clickdesk_360_work_queue').update({status:terminal?'failed':'pending',error_code:code,attempts:rateLimited?Math.max(0,item.attempts-1):item.attempts,
 next_attempt_at:new Date(Date.now()+(rateLimited?300000:Math.pow(2,item.attempts-1)*60000)).toISOString(),lease_token:null,lease_until:null,updated_at:new Date().toISOString()})
 .eq('ticket_id',item.ticket_id).eq('lease_token',item.lease_token)
 failed++
 }
 }))
 if(throttled)break
 await new Promise(resolve=>setTimeout(resolve,10000))
 }
 await admin.from('clickdesk_360_worker_health').upsert({singleton:true,status:throttled?'cooldown':failed?'attention':'ready',last_finished_at:new Date().toISOString(),processed:completed,failed,error_code:null})
 }catch{
 await admin.from('clickdesk_360_worker_health').upsert({singleton:true,status:'error',last_finished_at:new Date().toISOString(),processed:completed,failed,error_code:'worker_cycle_failed'})
 }
}
Deno.serve(async(req:Request)=>{
 if(req.method!=='POST')return json({error:'method_not_allowed'},405)
 const url=Deno.env.get('SUPABASE_URL')||''
 if(!url||new URL(url).hostname!==HOMO)return json({error:'homologation_only'},403)
 const raw=Deno.env.get('SUPABASE_SECRET_KEYS')
 const key=raw?JSON.parse(raw).default:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
 if(!key)return json({error:'configuration_unavailable'},503)
 const token=req.headers.get('authorization')?.replace(/^Bearer\s+/i,'').trim()||''
 if(!token)return json({error:'unauthorized'},401)
 const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})
 const cron=await admin.rpc('get_clickdesk_cron_credentials',{p_token:token})
 let managerId:string|null=null
 if(cron.error||!cron.data){
 const user=await admin.auth.getUser(token)
 if(user.error||!user.data.user)return json({error:'unauthorized'},401)
 const profile=await admin.from('profiles').select('role').eq('id',user.data.user.id).maybeSingle()
 if(profile.error||!['master','coordinator','coordenadora'].includes(String(profile.data?.role).toLowerCase()))return json({error:'management_only'},403)
 managerId=user.data.user.id
 }
 let body:any={}
 try{body=await req.json()}catch{return json({error:'invalid_body'},400)}
 if(managerId&&body.action!=='start')return json({error:'invalid_action'},400)
 if(managerId&&body.provider_key){
 if(typeof body.provider_key!=='string'||typeof body.model!=='string'||!/^[-a-zA-Z0-9.]{1,100}$/.test(body.model))return json({error:'invalid_provider_configuration'},400)
 const setup=await admin.rpc('configure_clickdesk_360_worker',{p_api_key:body.provider_key,p_model:body.model})
 if(setup.error)return json({error:'provider_setup_failed'},503)
 }
 const today=day(),start=typeof body.start==='string'?body.start:today.slice(0,8)+'01',requestedEnd=typeof body.end==='string'?body.end:today,end=requestedEnd>today?today:requestedEnd
 const team=typeof body.team_id==='string'&&body.team_id?body.team_id:null
 if(!validDate(start)||!validDate(end)||end<start||end>today||(Date.parse(end)-Date.parse(start))/86400000>92
 ||team&&!/^[a-f0-9-]{36}$/i.test(team))return json({error:'invalid_scope'},400)
 const config=await admin.rpc('get_clickdesk_360_worker_config')
 if(config.error||!config.data?.google_api_key||!config.data?.api_key||!config.data?.account_id)return json({error:'provider_not_configured'},503)
 const refreshed=await admin.rpc('refresh_clickdesk_360_queue',{p_start:start,p_end:end,p_team:team})
 if(refreshed.error)return json({error:'queue_refresh_failed'},503)
 if(managerId&&body.retry_failed===true){
 let retry=admin.from('clickdesk_360_work_queue').update({status:'pending',attempts:0,error_code:null,next_attempt_at:new Date().toISOString()}).eq('status','failed').gte('occurred_date',start).lte('occurred_date',end)
 if(team)retry=retry.eq('team_id',team)
 const retried=await retry
 if(retried.error)return json({error:'retry_not_saved'},503)
 }
 if(managerId){
 const record=await admin.from('clickdesk_360_requests').insert({start_date:start,end_date:end,team_id:team,requested_by:managerId}).select('id').single()
 if(record.error)return json({error:'request_not_saved'},503)
 EdgeRuntime.waitUntil(work(admin,config.data))
 return json({ok:true,accepted:true,request_id:record.data.id,scope:{start,end,team_id:team},execution:'supabase_background',csat_changed:false},202)
 }
 EdgeRuntime.waitUntil(work(admin,config.data))
 return json({ok:true,accepted:true,execution:'supabase_background',scope:{start,end,team_id:team}},202)
})
