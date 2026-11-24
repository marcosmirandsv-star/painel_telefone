import {randomUUID} from 'node:crypto'
import {adminClient} from '@/lib/integration-server'
import {isCxCron} from '@/lib/cx360-diagnostics-server'
import {runActivation,activationClaimPlan,type Work,type Store,record} from '@/lib/vision360-activation/runner'

export const runtime='nodejs'
export const maxDuration=300
export const dynamic='force-dynamic'
const SCOPE={
 '1098006':{name:'Thiago Reis',ratedAt:'2026-11-17T18:39:00Z',hash:'ab63b611c58d4af4065212da642afa2cf8d4b67e221c9fd04efdab81c022fea2',lastMessage:'4064774',label:'positive'},
 '1082449':{name:'João Pedro Vianey',ratedAt:'2026-11-03T12:48:00Z',hash:'547c4124df4c459a2a72abf177a52dff499d823cb9ace71ea3a3b680220eeb35',lastMessage:'3822304',label:'negative'},
} as const
type Allowed=keyof typeof SCOPE
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}})
export async function POST(request:Request){
 if(!isCxCron(request))return json({error:'unauthorized'},401)
 if(process.env.VERCEL_ENV!=='production'||process.env.NEXT_PUBLIC_SUPABASE_URL!=='https://qmetbydkepfdgfqkdkai.supabase.co')return json({error:'production_only'},403)
 let input:Record<string,unknown>
 try{input=record(await request.json())}catch{return json({error:'invalid_request'},400)}
 if(Object.keys(input).length!==1||typeof input.ticket_id!=='string'||!Object.hasOwn(SCOPE,input.ticket_id))return json({error:'scope_invalid'},400)
 const id=input.ticket_id as Allowed,admin=adminClient()
 const context=async(work:Work)=>{
  const spec=SCOPE[id]
  const [ledger,rating,person,pending,existing]=await Promise.all([
   admin.from('clickdesk_final_ticket_ledger').select('*').eq('ticket_id',id).single(),
   admin.from('clickdesk_event_ratings').select('*').eq('ticket_id',id).single(),
   admin.from('chat_analysts').select('name,active,team_id').eq('id',work.analyst_id).single(),
   admin.from('clickdesk_final_ticket_pending').select('ticket_id').eq('ticket_id',id).maybeSingle(),
   admin.from('clickdesk_qualitative_analyses').select('id').eq('clickdesk_ticket_id',id).maybeSingle(),
  ])
  const l=record(ledger.data),r=record(rating.data),p=record(person.data)
  const matches=!ledger.error&&!rating.error&&!person.error&&!pending.error&&!pending.data&&!existing.error&&!existing.data&&p.active===true&&p.name===spec.name&&p.team_id===work.team_id&&l.analyst_id===work.analyst_id&&l.team_id===work.team_id&&l.occurred_date===work.occurred_date&&l.satisfaction_label===spec.label&&work.satisfaction_label===spec.label&&l.last_public_message_id===spec.lastMessage&&l.rating_timestamp_warning===false&&r.analyst_id===work.analyst_id&&r.source_hash===spec.hash&&Date.parse(String(r.rated_at))===Date.parse(spec.ratedAt)
  return {analystName:spec.name,ratedAt:spec.ratedAt,area:typeof l.area==='string'?l.area:null,ledgerMatches:matches}
 }
 const store:Store={
  async claim(ticketId){
   if(ticketId!==id)return null
   const q=await admin.from('clickdesk_360_work_queue').select('*').eq('ticket_id',id).single()
   if(q.error||!q.data)return null
   const plan=activationClaimPlan(id,q.data)
   if(!plan)return null
   const candidate=q.data as Work
   if(!(await context(candidate)).ledgerMatches)return null
   const now=new Date(),lease=randomUUID()
   let claim=admin.from('clickdesk_360_work_queue').update({status:'processing',attempts:plan.nextAttempt,lease_token:lease,lease_until:new Date(now.getTime()+300000).toISOString(),updated_at:now.toISOString()}).eq('ticket_id',id).eq('status',plan.status).eq('attempts',plan.attempts).is('lease_token',null).eq('analyst_id',candidate.analyst_id).eq('team_id',candidate.team_id).eq('occurred_date',candidate.occurred_date).eq('satisfaction_label',candidate.satisfaction_label).lte('next_attempt_at',now.toISOString())
   if(plan.errorCode)claim=claim.eq('error_code',plan.errorCode)
   const result=await claim.select('*').maybeSingle()
   if(result.error||!result.data)return null
   return result.data as Work
  },context,
  async finish(work,analysis,model,hash,characters){
   if(!(await context(work)).ledgerMatches)return false
   const lease=await admin.from('clickdesk_360_work_queue').select('ticket_id').eq('ticket_id',id).eq('status','processing').eq('lease_token',work.lease_token).gt('lease_until',new Date().toISOString()).maybeSingle()
   if(lease.error||!lease.data)return false
   const result=await admin.rpc('finish_clickdesk_360_activation',{p_ticket:id,p_lease:work.lease_token,p_analysis:analysis,p_model:model,p_hash:hash,p_characters:characters,p_rating_hash:SCOPE[id].hash})
   return !result.error&&result.data===true
  },
  async fail(work,code){
   const result=await admin.from('clickdesk_360_work_queue').update({status:'failed',error_code:code,lease_token:null,lease_until:null,updated_at:new Date().toISOString()}).eq('ticket_id',id).eq('status','processing').eq('lease_token',work.lease_token)
   if(result.error)throw Error('result_not_saved')
  },
 }
 try{return json(await runActivation({ids:[id],allowlist:Object.keys(SCOPE),store,env:{...process.env,GEMINI_MODEL:process.env.CX360_MODEL?.trim()||'gemini-3.5-flash-lite'}}))}catch{return json({error:'activation_unavailable'},503)}
}
