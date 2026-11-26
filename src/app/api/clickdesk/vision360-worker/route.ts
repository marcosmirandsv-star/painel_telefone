import {adminClient} from '@/lib/integration-server'
import {isCxCron} from '@/lib/cx360-diagnostics-server'
import {runActivation,type Work,type Store,record} from '@/lib/vision360-activation/runner'

export const runtime='nodejs'
export const maxDuration=300
export const dynamic='force-dynamic'
const SCOPE={
 "1083324": {
  "name": "Thiago Reis",
  "ratedAt": "2026-11-04T13:17:00.000Z",
  "hash": "46e05da9bf9a8f642b1d7c82c9abc1df1b77b57661bd1fa501c31000edc9a419",
  "lastMessage": "3847454",
  "label": "negative"
 },
 "1085038": {
  "name": "Karolyne Moreira",
  "ratedAt": "2026-11-04T19:38:00.000Z",
  "hash": "94336f2ee8cf7bf02f894fcd1ed7d5191193a48508bfc220b2da5ade7f20c0f6",
  "lastMessage": "3867307",
  "label": "negative"
 },
 "1085727": {
  "name": "Thiago Reis",
  "ratedAt": "2026-11-05T18:30:00.000Z",
  "hash": "d0d4cc9e2f36440df99520df397028e8b7c4fd6b6112d32fc4391cc6596e9d4a",
  "lastMessage": "3874641",
  "label": "negative"
 },
 "1086522": {
  "name": "Thiago Reis",
  "ratedAt": "2026-11-05T14:34:00.000Z",
  "hash": "4f8e9bdc62acab52b241c99f129b06e81adc82db5b6e80c05421b4b4ceaee5f9",
  "lastMessage": "3886596",
  "label": "negative"
 },
 "1088556": {
  "name": "Thiago Reis",
  "ratedAt": "2026-11-06T14:30:00.000Z",
  "hash": "5725f758902379c074ddf85014270870af9b4a5d1a87d3631e4a1d3a9ba870f3",
  "lastMessage": "3919781",
  "label": "negative"
 },
 "1092484": {
  "name": "Karolyne Moreira",
  "ratedAt": "2026-11-11T13:17:00.000Z",
  "hash": "b6fa77fd7665b1c573a06d7308ef1457d8417a1eb64fb70f3f7f09cb30bd5720",
  "lastMessage": "3979274",
  "label": "negative"
 },
 "1092857": {
  "name": "Thiago Reis",
  "ratedAt": "2026-11-12T13:21:00.000Z",
  "hash": "c8cf622a063ed6feedc55a3642cbaec8a86b0e3c14e3adc862b94a302cb76033",
  "lastMessage": "3999221",
  "label": "negative"
 },
 "1093401": {
  "name": "Karolyne Moreira",
  "ratedAt": "2026-11-16T12:36:00.000Z",
  "hash": "d5d400262b1d93e2268058c2255137018bc53fe93e6fb51ad9dee9868609cb6f",
  "lastMessage": "4026434",
  "label": "negative"
 },
 "1094762": {
  "name": "Karolyne Moreira",
  "ratedAt": "2026-11-13T14:42:00.000Z",
  "hash": "652a27e689bd1eec03baa2eab0ae963a77026c45c24be44c605d0ce6a72d705f",
  "lastMessage": "4020684",
  "label": "negative"
 },
 "1095970": {
  "name": "Karolyne Moreira",
  "ratedAt": "2026-11-16T19:00:00.000Z",
  "hash": "a60db62b032218599df05501b0837baef60adef3ec9a1465331bf77568875f38",
  "lastMessage": "4048349",
  "label": "positive"
 },
 "1096509": {
  "name": "Karolyne Moreira",
  "ratedAt": "2026-11-16T15:59:00.000Z",
  "hash": "d4a4bb242e4fd48480a6b9cb30b84eaba200a96b626cdf4ae9528a27865977a4",
  "lastMessage": "4042948",
  "label": "positive"
 },
 "1096736": {
  "name": "Karolyne Moreira",
  "ratedAt": "2026-11-16T19:20:00.000Z",
  "hash": "a549ddb3855b611a93ae82d1c2c00fd0c08de0582b01dc03123acd764536b625",
  "lastMessage": "4049160",
  "label": "positive"
 },
 "1097337": {
  "name": "Karolyne Moreira",
  "ratedAt": "2026-11-17T13:48:00.000Z",
  "hash": "65f5e7eb0b085364f97a1af7394cde84a22a2578a863c81698baaba9f5e504ad",
  "lastMessage": "4056943",
  "label": "positive"
 },
 "1097741": {
  "name": "Karolyne Moreira",
  "ratedAt": "2026-11-17T16:33:00.000Z",
  "hash": "ce69a8075d77b58b3f0fe67b8375d4bc9dff27b7b3084b62179d01340cf8e0a8",
  "lastMessage": "4061517",
  "label": "positive"
 },
 "1097756": {
  "name": "Karolyne Moreira",
  "ratedAt": "2026-11-17T20:09:00.000Z",
  "hash": "03703be06bc09a8504554d115b726dc2233917e7d1b977cb476c83f9229e31f7",
  "lastMessage": "4063193",
  "label": "positive"
 },
 "1098046": {
  "name": "Thiago Reis",
  "ratedAt": "2026-11-18T21:01:00.000Z",
  "hash": "64328f1881d3e0cc8c3b218f0ef62ff662e7dd5b989139909346f0f4a2c77969",
  "lastMessage": "4087268",
  "label": "positive"
 },
 "1098236": {
  "name": "Thiago Reis",
  "ratedAt": "2026-11-18T20:24:00.000Z",
  "hash": "bd3ecd72bbfb29e0421f3aea7353b87cef8de048d9a1f2677187386a184320bf",
  "lastMessage": "4086386",
  "label": "positive"
 },
 "1098478": {
  "name": "Thiago Reis",
  "ratedAt": "2026-11-18T12:25:00.000Z",
  "hash": "79602fdb8e47efa27a8d26b32fc305e2df5fea12e8fe9c1310abdc4c1870f924",
  "lastMessage": "4071861",
  "label": "positive"
 },
 "1098548": {
  "name": "Thiago Reis",
  "ratedAt": "2026-11-18T13:35:00.000Z",
  "hash": "40e162f98ac682c9d4a774b5f2f7ab2991a4bfe99dafd05ae61040ea9c7d631c",
  "lastMessage": "4074233",
  "label": "positive"
 },
 "1098557": {
  "name": "Thiago Reis",
  "ratedAt": "2026-11-18T13:15:00.000Z",
  "hash": "5334df14eef8f55b2e1fe8af34e1da753ecc7118e8b7d5293d355981e1b2e67e",
  "lastMessage": "4073525",
  "label": "positive"
 }
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
   const candidate=await admin.from('clickdesk_360_work_queue').select('*').eq('ticket_id',id).single()
   if(candidate.error||!candidate.data||!(await context(candidate.data as Work)).ledgerMatches)return null
   const claimed=await admin.rpc('claim_vision360_batch20_work',{p_ticket:id,p_rating_hash:SCOPE[id].hash})
   if(claimed.error)throw Error('claim_unavailable')
   if(!Array.isArray(claimed.data)||claimed.data.length!==1)return null
   return claimed.data[0] as Work
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
