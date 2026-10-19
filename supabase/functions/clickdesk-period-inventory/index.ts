import {createClient} from 'npm:@supabase/supabase-js@2.110.5'
const HOST='vvtorcvchnqhcredhorv.supabase.co'
const response=(x:unknown,status=200)=>Response.json(x,{status,headers:{'Cache-Control':'no-store'}})
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
const obj=(v:any)=>v&&typeof v==='object'&&!Array.isArray(v)?v:{}
const list=(v:any):any[]=>Array.isArray(v)?v:Array.isArray(v?.data)?v.data:Array.isArray(v?.tickets)?v.tickets:listNested(v)
function listNested(v:any):any[]{return Array.isArray(v?.data?.data)?v.data.data:Array.isArray(v?.data?.tickets)?v.data.tickets:[]}
function outsidePeriod(payload:any,part:any,start:string){
 const items=list(payload),total=Number(payload.total),head=items[0]
 if(!Number.isSafeInteger(total)||total<0)return false
 if(total===0)return items.length===0
 if(items.length!==1||!head||!Number.isFinite(Date.parse(head.updated_at)))return false
 const created=String(head.created_at||'').slice(0,10)
 return created>=part.created_from&&created<=part.created_to&&Date.parse(head.updated_at)<Date.parse(start+'T00:00:00Z')
}
async function hash(v:any){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(v))))).map(x=>x.toString(16).padStart(2,'0')).join('')}
async function scan(admin:any,creds:any,run:any){
 const deadline=Date.now()+85000,base='https://api.desk.click.app/api/v1/tickets'
 const get=async(params:URLSearchParams)=>{
 const remote=await fetch(base+'?'+params,{headers:{Authorization:'Bearer '+creds.api_key,'X-Account-Id':creds.account_id,Accept:'application/json'},signal:AbortSignal.timeout(12000)})
 if(!remote.ok)throw Error('source_http_'+remote.status)
 return await remote.json()
 }
 try{
 if(run.status==='complete'){
 const watermark=run.last_incremental_at||run.started_at,started=new Date().toISOString()
 for(let page=1;Date.now()<deadline-15000;page++){
 const payload=await get(new URLSearchParams({inbox:'all',view:'all',sort:'updated_at',dir:'desc',per_page:'500',page:String(page),created_to:run.cutoff_date}))
 const items=list(payload),total=Number(payload.total),lastPage=Number(payload.last_page)
 if(!Number.isSafeInteger(total)||!Number.isSafeInteger(lastPage)||!items.length)throw Error('pagination_not_proven')
 const candidates=items.filter(t=>Date.parse(t.updated_at)>=Date.parse(watermark)-600000).map(t=>({ticket_id:String(t.id),source_updated_at:t.updated_at}))
 const saved=await admin.rpc('save_clickdesk_inventory_page',{p_period:run.period_key,p_pass:0,p_page:page,p_hash:await hash(items.map(t=>[String(t.id),t.updated_at])),p_count:items.length,p_total:total,p_rows:candidates})
 if(saved.error)throw Error('inventory_save_failed')
 const oldest=Math.min(...items.map(t=>Date.parse(t.updated_at)).filter(Number.isFinite))
 if(oldest<Date.parse(watermark)-600000||page===lastPage&&total<10000){
 await admin.from('clickdesk_period_inventory').update({last_incremental_at:started,lease_until:null,error_code:null}).eq('period_key',run.period_key)
 await admin.rpc('assess_clickdesk_period_inventory',{p_period:run.period_key})
 return
 }
 if(page===lastPage)throw Error('source_interval_limit_requires_partition')
 await new Promise(resolve=>setTimeout(resolve,350))
 }
 await admin.from('clickdesk_period_inventory').update({lease_until:null}).eq('period_key',run.period_key)
 return
 }
 const existing=await admin.from('clickdesk_inventory_partitions').select('id',{count:'exact',head:true}).eq('period_key',run.period_key)
 if(existing.error)throw Error('inventory_save_failed')
 if(!existing.count){
 const first=await get(new URLSearchParams({inbox:'all',view:'all',sort:'created_at',dir:'asc',per_page:'1',page:'1',created_to:run.cutoff_date}))
 const earliest=list(first)[0]?.created_at
 if(!earliest||!Number.isFinite(Date.parse(earliest)))throw Error('earliest_date_not_proven')
 const oldest=new Date(Date.parse(earliest)-86400000).toISOString().slice(0,10)
 const inserted=await admin.from('clickdesk_inventory_partitions').insert({period_key:run.period_key,created_from:oldest,created_to:run.cutoff_date})
 if(inserted.error)throw Error('inventory_save_failed')
 }
 while(Date.now()<deadline-15000){
 const chosen=await admin.from('clickdesk_inventory_partitions').select('*').eq('period_key',run.period_key).in('status',['pending','running']).order('created_to',{ascending:false}).limit(1).maybeSingle()
 if(chosen.error)throw Error('inventory_save_failed')
 const part=chosen.data
 if(!part){
 const errors=await admin.from('clickdesk_inventory_partitions').select('error_code').eq('period_key',run.period_key).eq('status','error').limit(1)
 if(errors.data?.length)throw Error(errors.data[0].error_code||'partition_needs_review')
 const totals=await admin.from('clickdesk_inventory_partitions').select('total_items,total_pages').eq('period_key',run.period_key).eq('status','complete')
 await admin.from('clickdesk_period_inventory').update({status:'complete',total_items:totals.data?.reduce((n:any,p:any)=>n+p.total_items,0)||0,total_pages:totals.data?.reduce((n:any,p:any)=>n+p.total_pages,0)||0,finished_at:new Date().toISOString(),last_incremental_at:run.scan_watermark_at||run.started_at,lease_until:null,error_code:null}).eq('period_key',run.period_key)
 await admin.rpc('set_clickdesk_recovery_cadence',{p_recovering:false})
 await admin.rpc('assess_clickdesk_period_inventory',{p_period:run.period_key})
 return
 }
 if(part.pass===1&&part.next_page===1){
 const probe=await get(new URLSearchParams({inbox:'all',view:'all',sort:'updated_at',dir:'desc',per_page:'1',page:'1',created_from:part.created_from,created_to:part.created_to}))
 if(outsidePeriod(probe,part,run.start_date)){
 const proof=list(probe).map(t=>({ticket_id:String(t.id),created_at:t.created_at,updated_at:t.updated_at}))
 const saved=await admin.from('clickdesk_inventory_partitions').update({status:'complete',total_items:0,total_pages:0,next_page:1,excluded_before_period:true,source_max_updated_at:list(probe)[0]?.updated_at||null,preflight_hash:await hash(proof),preflight_verified_at:new Date().toISOString(),preflight_reported_total:Number(probe.total)}).eq('id',part.id)
 if(saved.error)throw Error('inventory_save_failed')
 await new Promise(resolve=>setTimeout(resolve,350));continue
 }
 }
 const params=new URLSearchParams({inbox:'all',view:'all',sort:'id',dir:'asc',per_page:'500',page:String(part.next_page),created_from:part.created_from,created_to:part.created_to})
 const payload=await get(params),items=list(payload),meta=obj(payload.meta)
 const total=Number(payload.total??meta.total??payload.data?.total),lastPage=Math.max(1,Number(payload.last_page??meta.last_page??payload.data?.last_page))
 if(!Number.isSafeInteger(total)||!Number.isSafeInteger(lastPage)||lastPage<1||part.next_page>lastPage||(!items.length&&total>0))throw Error('pagination_not_proven')
 if(total>=10000 || total>1000 && part.created_from!==part.created_to){
 if(part.created_from===part.created_to)throw Error('source_daily_limit_requires_export')
 const middle=new Date(Math.floor((Date.parse(part.created_from)+Date.parse(part.created_to))/2/86400000)*86400000).toISOString().slice(0,10)
 const after=new Date(Date.parse(middle)+86400000).toISOString().slice(0,10)
 const split=await admin.from('clickdesk_inventory_partitions').upsert([{period_key:run.period_key,created_from:part.created_from,created_to:middle},{period_key:run.period_key,created_from:after,created_to:part.created_to}],{onConflict:'period_key,created_from,created_to',ignoreDuplicates:true})
 if(split.error)throw Error('inventory_save_failed')
 await admin.from('clickdesk_inventory_partitions').update({status:'split'}).eq('id',part.id)
 await new Promise(resolve=>setTimeout(resolve,350));continue
 }
 const ids=items.map(t=>String(t.id))
 if(ids.some(id=>!/^\d{1,25}$/.test(id))||new Set(ids).size!==ids.length)throw Error('invalid_ticket_ids')
 const candidates=items.filter(t=>String(t.updated_at||'').slice(0,10)>=run.start_date).map(t=>({ticket_id:String(t.id),source_updated_at:t.updated_at}))
 const digest=await hash(items.map(t=>String(t.id)))
 const saved=await admin.rpc('save_clickdesk_inventory_partition_page',{p_partition:part.id,p_pass:part.pass,p_page:part.next_page,p_hash:digest,p_count:items.length,p_total:total,p_rows:candidates})
 if(saved.error)throw Error('inventory_save_failed')
 if(part.next_page===lastPage){
 const pages=await admin.from('clickdesk_inventory_partition_pages').select('page,item_count,total_items,page_hash').eq('partition_id',part.id).eq('pass',part.pass).lte('page',lastPage).order('page')
 if(pages.error||pages.data.length!==lastPage||pages.data.reduce((n:any,p:any)=>n+p.item_count,0)!==total||pages.data.some((p:any)=>p.total_items!==total))throw Error('inventory_changed_during_scan')
 if(part.pass===1)await admin.from('clickdesk_inventory_partitions').update({status:'running',pass:2,next_page:1,total_pages:lastPage,total_items:total}).eq('id',part.id)
 else{
 const prior=await admin.from('clickdesk_inventory_partition_pages').select('page,page_hash').eq('partition_id',part.id).eq('pass',1).lte('page',lastPage).order('page')
 if(prior.error||JSON.stringify(prior.data.map((p:any)=>p.page_hash))!==JSON.stringify(pages.data.map((p:any)=>p.page_hash)))throw Error('inventory_changed_between_passes')
 await admin.from('clickdesk_inventory_partitions').update({status:'complete',next_page:lastPage+1,total_pages:lastPage,total_items:total}).eq('id',part.id)
 }
 }else await admin.from('clickdesk_inventory_partitions').update({status:'running',next_page:part.next_page+1,total_pages:lastPage,total_items:total}).eq('id',part.id)
 await new Promise(resolve=>setTimeout(resolve,350))
 }
 await admin.from('clickdesk_period_inventory').update({lease_until:null}).eq('period_key',run.period_key)
 await admin.rpc('assess_clickdesk_period_inventory',{p_period:run.period_key})
 }catch(error){
 await admin.from('clickdesk_inventory_partitions').update({status:'pending',pass:1,next_page:1}).eq('period_key',run.period_key).eq('status','running')
 const code=error instanceof Error&&/^(source_http_\d+|pagination_not_proven|invalid_ticket_ids|inventory_save_failed|inventory_changed_during_scan|inventory_changed_between_passes|source_interval_limit_requires_partition|source_daily_limit_requires_export|earliest_date_not_proven|partition_needs_review)$/.test(error.message)?error.message:'inventory_request_failed'
 await admin.from('clickdesk_period_inventory').update({status:'error',lease_until:null,error_code:code}).eq('period_key',run.period_key)
 }
}

Deno.serve(async(req:Request)=>{
 if(req.method!=='POST')return response({error:'post_only'},405)
 const url=Deno.env.get('SUPABASE_URL')||''
 if(!url||new URL(url).hostname!==HOST)return response({error:'homologation_only'},403)
 const raw=Deno.env.get('SUPABASE_SECRET_KEYS'),key=raw?JSON.parse(raw).default:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
 if(!key)return response({error:'configuration_missing'},503)
 const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})
 const token=req.headers.get('authorization')?.replace(/^Bearer\s+/i,'').trim()||''
 if(!token)return response({error:'unauthorized'},401)
 let cr=await admin.rpc('get_clickdesk_cron_credentials',{p_token:token})
 if(cr.error||!cr.data){
 const user=await admin.auth.getUser(token)
 if(user.error||!user.data.user)return response({error:'unauthorized'},401)
 const profile=await admin.from('profiles').select('role').eq('id',user.data.user.id).maybeSingle()
 if(profile.error||!['master','coordinator','coordenadora'].includes(String(profile.data?.role).toLowerCase()))return response({error:'management_only'},403)
 cr=await admin.rpc('get_clickdesk_360_worker_config')
 }
 if(cr.error||!cr.data?.api_key||!cr.data?.account_id)return response({error:'credentials_unavailable'},503)
 const body=await req.json().catch(()=>({})),date=today(),period=typeof body.month==='string'?body.month:date.slice(0,7)
 if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(period)||period<'2026-10'||period>date.slice(0,7))return response({error:'invalid_period'},400)
 const end=new Date(Date.UTC(Number(period.slice(0,4)),Number(period.slice(5)),0)).toISOString().slice(0,10)
 const cutoff=end>date?date:end
 let state=await admin.from('clickdesk_period_inventory').select('*').eq('period_key',period).maybeSingle()
 if(state.error)return response({error:'inventory_unavailable'},503)
 if(!state.data){const ins=await admin.from('clickdesk_period_inventory').insert({period_key:period,start_date:period+'-01',end_date:end,cutoff_date:cutoff,status:'running'}).select('*').single();state=ins}
 if(!state.data)return response({error:'inventory_unavailable'},503)
 if(state.data.lease_until&&Date.parse(state.data.lease_until)>Date.now())return response({ok:true,accepted:true,status:'already_running'},202)
 if(state.data.status==='error'){
 const transient=/^(source_http_(429|5\\d\\d)|inventory_request_failed|inventory_changed_)/.test(state.data.error_code||'')
 if(!body.restart&&(!transient||state.data.retry_count>=3||state.data.next_retry_at&&Date.parse(state.data.next_retry_at)>Date.now()))return response({error:'inventory_needs_review',reason:state.data.error_code},409)
 const reset=await admin.from('clickdesk_period_inventory').update({status:'running',pass:1,next_page:1,error_code:null,retry_count:body.restart?0:state.data.retry_count+1,next_retry_at:new Date(Date.now()+300000).toISOString(),cutoff_date:cutoff,started_at:new Date().toISOString()}).eq('period_key',period).select('*').single();state=reset
 }
 if(state.data.status==='complete'&&period<date.slice(0,7)&&(!state.data.finished_at||state.data.finished_at.slice(0,10)<=end)){
 const reset=await admin.from('clickdesk_inventory_partitions').update({status:'pending',pass:1,next_page:1,error_code:null}).eq('period_key',period).eq('status','complete')
 if(reset.error)return response({error:'inventory_reset_failed'},503)
 if(state.data.cutoff_date<cutoff){
 const tailStart=new Date(Date.parse(state.data.cutoff_date)+86400000).toISOString().slice(0,10)
 await admin.from('clickdesk_inventory_partitions').upsert({period_key:period,created_from:tailStart,created_to:cutoff},{onConflict:'period_key,created_from,created_to',ignoreDuplicates:true})
 }
 const restarted=await admin.from('clickdesk_period_inventory').update({status:'running',cutoff_date:cutoff,scan_watermark_at:new Date().toISOString(),started_at:new Date().toISOString(),finished_at:null,error_code:null}).eq('period_key',period).select('*').single()
 state=restarted
 }
 if(state.data.status==='complete'&&state.data.cutoff_date<cutoff){
 const updated=await admin.from('clickdesk_period_inventory').update({cutoff_date:cutoff}).eq('period_key',period).select('*').single();state=updated
 }
 const lease=await admin.from('clickdesk_period_inventory').update({lease_until:new Date(Date.now()+110000).toISOString()}).eq('period_key',period).or('lease_until.is.null,lease_until.lt.'+new Date().toISOString()).select('*').maybeSingle()
 if(lease.error)return response({error:'inventory_lease_failed'},503)
 if(!lease.data)return response({ok:true,accepted:true,status:'already_running'},202)
 EdgeRuntime.waitUntil(scan(admin,cr.data,lease.data))
 return response({ok:true,accepted:true,month:period,execution:'supabase_inventory',no_kpi_formula_change:true},202)
})
