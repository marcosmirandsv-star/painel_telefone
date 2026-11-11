import {createClient} from 'npm:@supabase/supabase-js@2.110.5'
import {readTicketHistory} from './history.ts'
import {validateNeutralAttribution,neutralAttributionPrompt,isOriginalNeutral} from './review.ts'
const HOST='vvtorcvchnqhcredhorv.supabase.co'
const object=(x:any)=>x&&typeof x==='object'&&!Array.isArray(x)?x:{}
const text=(x:any)=>typeof x==='string'?x:''
async function hash(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(x=>x.toString(16).padStart(2,'0')).join('')}
async function run(admin:any,config:any){
 const claim=await admin.rpc('claim_clickdesk_neutral_reviews',{p_limit:2})
 if(claim.error||!claim.data?.length)return
 await Promise.all(claim.data.map(async(item:any)=>{
  try{
   const rating=await admin.from('clickdesk_event_ratings').select('*').eq('ticket_id',item.ticket_id).single()
   if(rating.error||!rating.data||rating.data.source_hash!==item.source_hash||!isOriginalNeutral(rating.data.original_label))throw Error('rating_source_changed')
   const person=await admin.from('chat_analysts').select('name').eq('id',rating.data.analyst_id).single()
   if(person.error)throw Error('analyst_missing')
   const get=async(path:string)=>{
    const response=await fetch('https://api.desk.click.app/api/v1'+path,{headers:{Authorization:'Bearer '+config.api_key,'X-Account-Id':config.account_id,Accept:'application/json'},signal:AbortSignal.timeout(18000)})
    if(!response.ok)throw Error('source_http_'+response.status)
    const raw=await response.text();try{return JSON.parse(raw)}catch{return raw}
   }
   const history=await readTicketHistory(item.ticket_id,get)
   if(!history.complete)throw Error('history_incomplete')
   if(history.messages.some((m:any)=>!Number.isFinite(Date.parse(text(object(m).created_at||object(m).timestamp)))))throw Error('history_timestamp_missing')
   const at=Date.parse(rating.data.rated_at)
   const messages=history.messages.map(object).filter((m:any)=>Date.parse(text(m.created_at||m.timestamp))<=at)
     .sort((a:any,b:any)=>Date.parse(text(a.created_at||a.timestamp))-Date.parse(text(b.created_at||b.timestamp)))
   const transcript=messages.map((m:any)=>`[${m.created_at||m.timestamp}] ${typeof m.author==='string'?m.author:text(object(m.author).name)} (${m.author_type}; ${m.visibility}): ${text(m.body||m.content||m.text).replace(/<[^>]+>/g,' ')}`).join('\n')
   if(transcript.trim().length<40)throw Error('transcript_before_rating_insufficient')
   const transcriptHash=await hash(transcript)
   const model=config.model||'gemini-3.5-flash-lite'
   const evaluate=async(secondPass:boolean)=>{
    const prompt=`Analista avaliado: ${person.data.name}. Avaliação registrada em ${rating.data.rated_at}. Abaixo estão todas as mensagens disponíveis ATÉ a nota, em ordem. Julgue apenas condutas desse analista; outros autores são contexto. Notas internas não são falas vistas pelo cliente. Não conclua omissão apenas por uma recomendação de boa prática.\n`+neutralAttributionPrompt(transcript,secondPass)
    const response=await fetch('https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(model)+':generateContent',{
     method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':config.google_api_key},signal:AbortSignal.timeout(40000),
     body:JSON.stringify({contents:[{role:'user',parts:[{text:prompt}]}],generationConfig:{maxOutputTokens:2000,responseMimeType:'application/json',thinkingConfig:{thinkingLevel:'low'}}})
    })
    if(!response.ok)throw Error('provider_http_'+response.status)
    const result=await response.json(),raw=result?.candidates?.[0]?.content?.parts?.map((p:any)=>p.text||'').join('').trim()
    if(!raw)throw Error('provider_empty')
    let parsed:any;try{parsed=JSON.parse(raw.replace(/^\s*```(?:json)?\s*/i,'').replace(/\s*```\s*$/i,''))}catch{throw Error('provider_invalid_json')}
    return validateNeutralAttribution(parsed,transcript)
   }
   // Independent second reading: both must agree before a classification or CSAT exclusion.
   const first=await evaluate(false),second=await evaluate(true)
   const agreement=first.cause===second.cause&&first.confidence==='high'&&second.confidence==='high'
   const analysis={...second,cause:agreement?second.cause:'inconclusive',
    explanation:agreement?second.explanation:'As duas leituras não demonstraram a mesma causa com segurança. '+second.explanation,
    exclusion_eligible:agreement&&first.exclusion_eligible&&second.exclusion_eligible,
    two_pass_agreement:agreement,
    pattern:second.pattern_supported?second.pattern:first.pattern_supported?first.pattern:'none',
    pattern_supported:second.pattern_supported||first.pattern_supported,
    first_pass:first,second_pass:second,analysis_version:1}
   const saved=await admin.rpc('finish_clickdesk_neutral_review',{p_ticket:item.ticket_id,p_lease:item.lease_token,p_hash:transcriptHash,
    p_conversation_version:history.ticket.updated_at,p_analysis:analysis,p_model:model})
   if(saved.error||saved.data!==true)throw Error('neutral_result_not_saved')
  }catch(error){
   const raw=error instanceof Error?error.message:'neutral_worker_error'
   const code=/^[a-z_0-9]+$/.test(raw)?raw:'neutral_worker_error'
   const retryMs=code==='provider_http_429'?600000:Math.min(21600000,Math.pow(2,Math.min(item.attempts,8))*60000)
   await admin.from('clickdesk_neutral_review_attempts').insert({ticket_id:item.ticket_id,source_hash:item.source_hash,error_code:code})
   await admin.from('clickdesk_neutral_reviews').update({status:'technical_failure',error_code:code,exclusion_eligible:false,lease_token:null,lease_until:null,next_attempt_at:new Date(Date.now()+retryMs).toISOString()}).eq('ticket_id',item.ticket_id).eq('lease_token',item.lease_token)
  }
 }))

}
Deno.serve(async(req:Request)=>{
 if(req.method!=='POST')return Response.json({error:'method_not_allowed'},{status:405})
 const url=Deno.env.get('SUPABASE_URL')||''
 if(!url||new URL(url).hostname!==HOST)return Response.json({error:'homologation_only'},{status:403})
 const raw=Deno.env.get('SUPABASE_SECRET_KEYS'),key=raw?JSON.parse(raw).default:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
 if(!key)return Response.json({error:'configuration_unavailable'},{status:503})
 const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})
 const token=req.headers.get('authorization')?.replace(/^Bearer\s+/i,'').trim()||''
 const auth=await admin.rpc('get_clickdesk_cron_credentials',{p_token:token})
 if(auth.error||!auth.data)return Response.json({error:'unauthorized'},{status:401})
 const config=await admin.rpc('get_clickdesk_360_worker_config')
 if(config.error||!config.data?.google_api_key)return Response.json({error:'provider_not_configured'},{status:503})
 EdgeRuntime.waitUntil(run(admin,config.data))
 return Response.json({ok:true,accepted:true},{status:202})
})
