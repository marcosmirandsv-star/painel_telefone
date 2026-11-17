// Prepared entry point for homologação. Deploy only after its new RPC migration is verified.
import {createClient} from 'npm:@supabase/supabase-js@2'
import {initialCaptureTasks} from './capture-plan.ts'
import {runCaptureUnit} from './capture-worker.ts'
import {postgresCaptureStore} from './capture-store.ts'
import {finalizeReadyCapture} from './capture-finalizer.ts'
import {postgresFinalizationStore} from './capture-finalization-store.ts'
const HML='https://vvtorcvchnqhcredhorv.supabase.co'
const excluded=[1,12,21,26,57,59,61,77]
Deno.serve(async req=>{
 const token=req.headers.get('authorization')?.replace(/^Bearer\s+/i,'').trim()
 if(!token)return Response.json({error:'Unauthorized'},{status:401})
 // This entry point cannot operate against production even if deployed by mistake.
 if(Deno.env.get('SUPABASE_URL')!==HML)return Response.json({error:'Homologation only'},{status:403})
 try{
  const configured=Deno.env.get('SUPABASE_SECRET_KEYS')
  const key=configured?JSON.parse(configured).default:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if(!key)throw Error('missing_admin_config')
  const admin=createClient(HML,key,{auth:{persistSession:false,autoRefreshToken:false}})
  const auth=await admin.rpc('get_clickdesk_cron_credentials',{p_token:token})
  if(auth.error||!auth.data)return Response.json({error:'Unauthorized'},{status:401})
  const registry=async()=>{
   const result=await admin.from('clickdesk_official_owner_registry').select('clickdesk_owner_id,source_owner_name,source_owner_key').eq('source_scope','suporte_erp_fiscal').eq('active',true)
   if(result.error)throw Error('registry_unavailable')
   return (result.data??[]).filter(owner=>!excluded.includes(owner.clickdesk_owner_id))
  }
  let body:Record<string,unknown>={}
  try{const text=await req.text();if(text)body=JSON.parse(text)}catch{return Response.json({error:'Invalid request'},{status:400})}
  if(body.action==='work'){
   const apiKey=String(auth.data.api_key??''),accountId=String(auth.data.account_id??'')
   if(!apiKey||!accountId)throw Error('missing_source_config')
   const unit=await runCaptureUnit(postgresCaptureStore(admin),async(path,signal)=>{
    const response=await fetch('https://api.desk.click.app/api/v1'+path,{signal,headers:{Authorization:'Bearer '+apiKey,'X-Account-Id':accountId,Accept:'application/json'}})
    if(!response.ok)throw Error('source_unavailable')
    return await response.json()
   })
   const publication=await finalizeReadyCapture(postgresFinalizationStore(admin,registry))
   return Response.json({ok:true,unit,publication})
  }
  if(body.action!==undefined)return Response.json({error:'Invalid action'},{status:400})
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date())
  const date=Object.fromEntries(parts.map(part=>[part.type,part.value]))
  const today=`${date.year}-${date.month}-${date.day}`
  const start=typeof body.start==='string'?body.start:today.slice(0,7)+'-01'
  const end=typeof body.end==='string'?body.end:today
  const owners=(await registry()).map(owner=>owner.clickdesk_owner_id)
  try{initialCaptureTasks(start,end,owners);if(end>today||start<'2026-10-01')throw Error('invalid_period')}
  catch{return Response.json({error:'Invalid period'},{status:400})}
  const queued=await admin.rpc('enqueue_clickdesk_capture',{p_start:start,p_end:end,p_owners:owners})
  if(queued.error)throw Error('enqueue_failed')
  return Response.json({accepted:true,jobId:queued.data,period:{start,end}},{status:202})
 }catch{
  console.error('clickdesk durable capture operation failed')
  return Response.json({error:'Capture operation failed; previous valid data preserved'},{status:500})
 }
})
