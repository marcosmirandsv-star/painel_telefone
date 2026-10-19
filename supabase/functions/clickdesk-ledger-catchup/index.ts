import {createClient} from 'npm:@supabase/supabase-js@2.110.5'
const HOST='vvtorcvchnqhcredhorv.supabase.co'
Deno.serve(async(req:Request)=>{
 if(req.method!=='POST')return Response.json({error:'method_not_allowed'},{status:405})
 const url=Deno.env.get('SUPABASE_URL')??''
 if(!url||new URL(url).hostname!==HOST)return Response.json({error:'homologation_only'},{status:403})
 const token=req.headers.get('authorization')?.replace(/^Bearer\s+/i,'').trim()??''
 if(!token)return Response.json({error:'unauthorized'},{status:401})
 const keys=Deno.env.get('SUPABASE_SECRET_KEYS')
 const key=keys?JSON.parse(keys).default:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
 if(!key)return Response.json({error:'configuration_unavailable'},{status:503})
 const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})
 const auth=await admin.rpc('get_clickdesk_cron_credentials',{p_token:token})
 if(auth.error||!auth.data)return Response.json({error:'unauthorized'},{status:401})
 const lease=await admin.rpc('claim_clickdesk_reconciliation_cycle')
 if(lease.error)return Response.json({error:'lease_unavailable'},{status:503})
 if(!lease.data)return Response.json({ok:true,status:'already_running'},{status:202})
 const leaseToken=lease.data
 EdgeRuntime.waitUntil((async()=>{
  const deadline=Date.now()+85000
  let examined=0,confirmed=0,rounds=0,interrupted=false
  try{
   // Fixed endpoint, fixed batch size, at most 256 tickets per existing five-minute cycle.
   while(rounds<8&&Date.now()<deadline-20000){
    const r=await fetch('https://'+HOST+'/functions/v1/clickdesk-ledger-incremental',{
     method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},
     body:JSON.stringify({dry_run:false,commit_verified:true,limit:32}),
     signal:AbortSignal.timeout(Math.min(25000,deadline-Date.now()))})
    const result=await r.json()
    if(!r.ok||result.ok!==true)throw Error('numeric_batch_failed')
    rounds++;examined+=Number(result.examined)||0;confirmed+=Number(result.confirmed)||0
    const reasons=result.reasons??{}
    if(Object.keys(reasons).some(x=>/clickdesk_http_(429|5\d\d)/.test(x)))break
    if(!result.needs_another_batch||!result.examined)break
    await new Promise(resolve=>setTimeout(resolve,1000))
   }
  }catch{
   interrupted=true
   await admin.from('clickdesk_reconciliation_health').update({status:'attention',error_code:'recovery_cycle_interrupted'}).eq('singleton',true)
  }finally{
   if(!interrupted)await admin.from('clickdesk_reconciliation_cycle').update({lease_token:null,lease_until:null}).eq('singleton',true).eq('lease_token',leaseToken)
  }
 })())
 return Response.json({ok:true,status:'accepted',max_tickets:256,max_seconds:85},{status:202,headers:{'Cache-Control':'no-store'}})
})
