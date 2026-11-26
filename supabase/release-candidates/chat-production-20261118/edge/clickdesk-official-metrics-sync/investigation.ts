import {receivedCount,receivedForOwner} from './received.ts'
import type {RpcClient} from './capture-store.ts'
import {advanceCohortVerification,publishCohortVerification,restartCohortVerification} from './cohort-verification.ts'

type Obj=Record<string,unknown>
type Ticket={id:number;number:number;owner:number|null;department:number|null;channel:string;created_at:string;updated_at:string}
type Event={id:string;field:string;old:string|null;new:string|null;actor:string|null;created_at:string}
export type Context={id:string;start:string;end:string;owners:number[];parts:Record<string,unknown>;times:Record<string,string>;registry:{id:number;name:string}[];verifyCurrent?:boolean}
export type State={phase:'owners'|'verify'|'recent'|'events'|'group'|'finish';context:Context;ownerIndex:number;ownerReadRetries?:number;page:number;pageTotal:number|null;pageCount:number;seen:number[];tickets:Ticket[];recent:Ticket[];events:Record<string,Event[]>;eventIndex:number;lastUpdated:number|null;freshGroup:number|null;freshGroupAt:string|null;verification?:{cycle:number;stage:'headers'|'ratings'|'group'|'publish'|'done';changed:number[];index:number;headerRechecks?:number;departmentIndex:number;page:number;pages:number;total:number|null;count:number;overrides:Record<string,unknown>;times:Record<string,string>;groupAt?:string;recoveredBy?:string;reason?:string}}
export type Claim={jobId:string;token:string;attempt:number;state:State|Obj}
type Outcome={state:State;status:'pending'|'explained'|'inconclusive';result:Obj}
export class InvestigationSourceError extends Error {
 constructor(public status:number,public retryAfter=30){super('investigation_source_unavailable')}
}
class EvidenceError extends Error {}
class VerificationBudget extends Error {}
function obj(v:unknown):Obj{if(!v||typeof v!=='object'||Array.isArray(v))throw new EvidenceError('invalid_source_shape');return v as Obj}
function integer(v:unknown):number{if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0)throw new EvidenceError('invalid_source_identifier');return v}
function timestamp(v:unknown):string{if(typeof v!=='string'||!Number.isFinite(Date.parse(v)))throw new EvidenceError('invalid_source_timestamp');return v}
function normalized(v:string){return v.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()}
function eligible(t:Pick<Ticket,'owner'|'department'>,owners:number[]){return t.owner!==null&&owners.includes(t.owner)&&[3,12].includes(t.department??-1)}
function ticket(raw:unknown,c:Context):Ticket{
 const r=obj(raw),owner=r.owner===null?null:integer(obj(r.owner).id),department=r.department===null?null:integer(obj(r.department).id)
 const created=timestamp(r.created_at),updated=timestamp(r.updated_at)
 const day=new Date(Date.parse(created)-10800000).toISOString().slice(0,10)
 if(day<c.start||day>c.end)throw new EvidenceError('ticket_outside_created_period')
 return {id:integer(r.id),number:integer(r.number),owner,department,channel:typeof r.channel==='string'?r.channel.slice(0,40):'unknown',created_at:created,updated_at:updated}
}
function page(raw:unknown,s:State){
 const r=obj(raw),total=integer(r.total),pages=integer(r.last_page),current=integer(r.current_page)
 if(!Array.isArray(r.data)||pages<1||pages>100||current!==s.page||total>100000||r.data.length>1000)throw new EvidenceError('invalid_list_pagination')
 if(s.pageTotal!==null&&s.pageTotal!==total)throw new EvidenceError('list_pagination_changed')
 s.pageTotal=total;s.pageCount+=r.data.length
 return {rows:r.data.map(v=>ticket(v,s.context)),total,pages}
}
function nextPage(s:State){s.page=1;s.pageTotal=null;s.pageCount=0;s.seen=[];s.lastUpdated=null}
function cutoff(c:Context){return Math.min(...[c.times.group,...c.owners.map(id=>c.times['owner:'+id])].map(v=>Date.parse(v)))}
function listPath(s:State,owner?:number){
 const p=new URLSearchParams({inbox:'all',view:'all',created_from:s.context.start,created_to:s.context.end,per_page:'1000',page:String(s.page),sort:'updated_at',dir:'desc'})
 if(owner!==undefined){p.set('assigned','yes');p.set('owner_id',String(owner))}
 return '/tickets?'+p
}
function initial(c:Context):State{
 if(!c||!Array.isArray(c.owners)||!c.owners.length||new Set(c.owners).size!==c.owners.length||!Array.isArray(c.registry))throw new EvidenceError('invalid_investigation_context')
 if(!c.parts?.group||c.owners.some(id=>!c.parts['owner:'+id]))throw new EvidenceError('capture_incomplete_no_id_reconciliation')
 if(c.registry.length!==c.owners.length||c.owners.some(id=>!c.registry.some(r=>r.id===id)))throw new EvidenceError('investigation_roster_changed')
 const range=obj(obj(c.parts.group).range)
 if(range.timezone!=='America/Sao_Paulo'||Date.parse(String(range.from))!==Date.parse(c.start+'T00:00:00-03:00')||Date.parse(String(range.to))!==Date.parse(c.end+'T00:00:00-03:00')+86400000||c.owners.some(id=>{const r=obj(obj(c.parts['owner:'+id]).range);return r.from!==range.from||r.to!==range.to||r.timezone!==range.timezone}))throw new EvidenceError('capture_report_ranges_differ')
 const expected=c.owners.reduce((n,id)=>n+receivedForOwner(c.parts['owner:'+id],id),0)
 if(expected===receivedCount(c.parts.group))throw new EvidenceError('failure_is_not_received_difference')
 if(!Number.isFinite(cutoff(c)))throw new EvidenceError('capture_times_missing')
 // Retain only report headers/aliases needed for attribution, never customer ratings/messages.
 const group=obj(c.parts.group)
 const aliases=Array.isArray(group.agents)?group.agents.map(v=>{const a=obj(v);return {id:a.id,name:a.name}}):[]
 c={...c,parts:Object.fromEntries([['group',{summary:group.summary,agents:aliases}],...c.owners.map(id=>['owner:'+id,{summary:obj(c.parts['owner:'+id]).summary,range:obj(c.parts['owner:'+id]).range,agents:obj(c.parts['owner:'+id]).agents}])])}
 return {phase:'owners',context:c,ownerIndex:0,page:1,pageTotal:null,pageCount:0,seen:[],tickets:[],recent:[],events:{},eventIndex:0,lastUpdated:null,freshGroup:null,freshGroupAt:null}
}
function events(raw:unknown):Event[]{
 if(!Array.isArray(raw)||raw.length>=1000)throw new EvidenceError('event_history_incomplete')
 const kept:Event[]=[]
 for(const value of raw){const r=obj(value);if(!['owner','department','status'].includes(String(r.field)))continue
  for(const key of ['old','new','actor'])if(r[key]!==null&&(typeof r[key]!=='string'||String(r[key]).length>250))throw new EvidenceError('invalid_event_value')
  kept.push({id:String(integer(r.id)),field:String(r.field),old:r.old as string|null,new:r.new as string|null,actor:r.actor as string|null,created_at:timestamp(r.created_at)})
 }
 return kept.sort((a,b)=>Date.parse(a.created_at)-Date.parse(b.created_at)||Number(a.id)-Number(b.id))
}
function nameMap(c:Context){
 const aliases=new Map<string,number>()
 const add=(name:unknown,id:number)=>{if(typeof name!=='string')return;const key=normalized(name);if(aliases.has(key)&&aliases.get(key)!==id)throw new EvidenceError('ambiguous_owner_name');aliases.set(key,id)}
 c.registry.forEach(r=>add(r.name,r.id))
 const agents=obj(c.parts.group).agents
 if(Array.isArray(agents))for(const v of agents){const a=obj(v);if(c.owners.includes(Number(a.id)))add(a.name,Number(a.id))}
 return aliases
}
function stateAt(t:Ticket,es:Event[],at:number,aliases:Map<string,number>){
 let owner=t.owner,department=t.department
 const ownerValue=(v:string|null)=>v===null?null:aliases.get(normalized(v))??-1
 const departmentValue=(v:string|null)=>v===null?null:({'suporte erp':3,'suporte fiscal':12} as Record<string,number>)[normalized(v)]??-1
 for(const e of [...es].reverse()){
  if(Date.parse(e.created_at)<=at)continue
  if(e.field==='owner'){
   const expected=ownerValue(e.new)
   if((owner!==null&&owner>=0&&aliasesHasId(aliases,owner)?owner:owner===null?null:-1)!==expected)throw new EvidenceError('event_owner_chain_changed')
   owner=ownerValue(e.old)
  }
  if(e.field==='department'){
   const expected=departmentValue(e.new)
   if(([3,12].includes(department??-1)?department:department===null?null:-1)!==expected)throw new EvidenceError('event_department_chain_changed')
   department=departmentValue(e.old)
  }
 }
 return {owner,department}
}
function aliasesHasId(map:Map<string,number>,id:number){return [...map.values()].includes(id)}
export function explainInvestigation(s:State):Outcome{
 const c=s.context,aliases=nameMap(c),counts=new Map(c.owners.map(id=>[id,s.tickets.filter(t=>t.owner===id).length]))
 const expectedOwners=new Map(c.owners.map(id=>[id,receivedForOwner(c.parts['owner:'+id],id)]))
 const expectedGroup=receivedCount(c.parts.group),originalSum=[...expectedOwners.values()].reduce((a,b)=>a+b,0)
 let groupReconstructed=s.tickets.length
 const individualReconstructed=new Map(counts),findings:Obj[]=[]
 for(const t of s.recent){
  const es=s.events[String(t.id)]
  if(!es)throw new EvidenceError('event_history_missing')
  const enumerated=s.tickets.find(v=>v.id===t.id)
  if(eligible(t,c.owners)!==Boolean(enumerated)||(enumerated&&(enumerated.owner!==t.owner||enumerated.department!==t.department||enumerated.updated_at!==t.updated_at)))throw new EvidenceError('source_changed_during_investigation')
  const current=eligible(t,c.owners),groupAt=stateAt(t,es,Date.parse(c.times.group),aliases),inGroup=eligible(groupAt,c.owners)
  groupReconstructed+=Number(inGroup)-Number(current)
  let historicalIndividual=0
  for(const id of c.owners){const prior=stateAt(t,es,Date.parse(c.times['owner:'+id]),aliases);const included=eligible(prior,c.owners)&&prior.owner===id;historicalIndividual+=Number(included);individualReconstructed.set(id,individualReconstructed.get(id)!+Number(included)-Number(current&&t.owner===id))}
  const delta=historicalIndividual-Number(inGroup)
  if(delta){
   const relevant=es.filter(e=>e.field==='owner'||e.field==='department')
   // The whole claimed capture unit must finish inside its 90s lease. Never guess across that request window.
   for(const e of relevant){
    const time=Date.parse(e.created_at),ids=e.field==='owner'?[e.old,e.new].filter((v):v is string=>typeof v==='string').map(v=>aliases.get(normalized(v))).filter((v):v is number=>v!==undefined):[stateAt(t,es,time,aliases).owner]
    const times=[c.times.group,...ids.filter((id):id is number=>id!==null&&c.owners.includes(id)).map(id=>c.times['owner:'+id])]
    if(times.some(v=>time<=Date.parse(v)&&time>=Date.parse(v)-90000))throw new EvidenceError('event_inside_report_request_window')
   }
   findings.push({ticket_id:t.id,ticket_number:t.number,channel:t.channel,delta,group_state:groupAt,current_state:{owner:t.owner,department:t.department},events:es})
  }
 }
 const reconciled=groupReconstructed===expectedGroup&&c.owners.every(id=>individualReconstructed.get(id)===expectedOwners.get(id))&&s.freshGroup===s.tickets.length&&findings.reduce((n,f)=>n+Number(f.delta),0)===originalSum-expectedGroup
 return {state:s,status:reconciled?'explained':'inconclusive',result:{reason:reconciled?'source_changed_during_capture':'difference_not_fully_explained',original_group:expectedGroup,original_individual_sum:originalSum,current_unique_ids:s.tickets.length,fresh_group:s.freshGroup,fresh_group_at:s.freshGroupAt,group_reconstructed:groupReconstructed,individuals:[...expectedOwners].map(([id,n])=>({owner_id:id,original:n,enumerated:counts.get(id),reconstructed:individualReconstructed.get(id)})),findings,publication:'blocked_original_capture_preserved',historical_sets:'reconstructed_from_current_ids_and_events',capture_times:c.times}}
}
export async function advanceInvestigation(s:State,fetchPart:(path:string,signal:AbortSignal)=>Promise<unknown>,now=()=>new Date().toISOString()):Promise<Outcome>{
 const fetchOne=(p:string)=>fetchPart(p,AbortSignal.timeout(60000))
 if(s.phase==='owners'){
  const owner=s.context.owners[s.ownerIndex],p=page(await fetchOne(listPath(s,owner)),s)
  if(p.total>=10000)throw new EvidenceError('owner_list_source_cap')
  for(const t of p.rows){if(t.owner!==owner)throw new EvidenceError('owner_filter_not_applied');if(s.seen.includes(t.id)||s.tickets.some(v=>v.id===t.id))throw new EvidenceError('duplicate_or_moving_ticket');s.seen.push(t.id);if(eligible(t,s.context.owners))s.tickets.push(t)}
  if(s.tickets.length>100000)throw new EvidenceError('investigation_ticket_budget')
  if(s.page<p.pages)s.page++;else{if(s.pageCount!==p.total)throw new EvidenceError('owner_list_incomplete');s.ownerIndex++;s.ownerReadRetries=0;nextPage(s);if(s.ownerIndex===s.context.owners.length)s.phase=s.context.verifyCurrent&&s.verification?.stage!=='done'?'verify':'recent'}
 }else if(s.phase==='verify'){
  return await advanceCohortVerification(s,fetchPart,now)
 }else if(s.phase==='recent'){
  const p=page(await fetchOne(listPath(s)),s);let past=false
  for(const t of p.rows){const updated=Date.parse(t.updated_at);if(s.lastUpdated!==null&&updated>s.lastUpdated)throw new EvidenceError('recent_list_not_sorted');s.lastUpdated=updated
   if(updated<cutoff(s.context)){past=true;break}
   if(s.recent.some(v=>v.id===t.id))throw new EvidenceError('duplicate_recent_ticket');s.recent.push(t)
  }
  if(s.recent.length>50)throw new EvidenceError('recent_ticket_budget_exhausted')
  if(past||(s.page===p.pages&&p.total<10000)){s.phase='events';nextPage(s)}else if(s.page>=10)throw new EvidenceError('recent_list_source_cap');else s.page++
 }else if(s.phase==='events'){
  if(s.eventIndex<s.recent.length){const t=s.recent[s.eventIndex];s.events[String(t.id)]=events(await fetchOne('/tickets/'+t.id+'/events'));s.eventIndex++}
  if(s.eventIndex===s.recent.length)s.phase='group'
 }else if(s.phase==='group'){
  const p=new URLSearchParams({from:s.context.start,to:s.context.end});[3,12].forEach(v=>p.append('department_ids[]',String(v)));s.context.owners.forEach(v=>p.append('owner_ids[]',String(v)))
  s.freshGroup=receivedCount(await fetchOne('/support/reports/agents?'+p));s.freshGroupAt=now();s.phase='finish'
 }else return explainInvestigation(s)
 return {state:s,status:'pending',result:{reason:'investigating_received_difference',phase:s.phase,enumerated_ids:s.tickets.length,candidates:s.recent.length}}
}
export function postgresInvestigationStore(client:RpcClient){
 async function rpc(name:string,args?:Record<string,unknown>){const r=await client.rpc(name,args);if(r.error)throw Error('investigation_storage_failed');return r.data}
 return {
  async claim(){return await rpc('claim_clickdesk_capture_investigation') as Claim|null},
  async context(id:string){return await rpc('load_clickdesk_investigation_context',{p_job_id:id}) as Context},
  async save(claim:Claim,state:Obj|State,result:Obj,status:string,retry=0){return await rpc('save_clickdesk_capture_investigation',{p_job_id:claim.jobId,p_token:claim.token,p_state:state,p_result:result,p_status:status,p_retry_seconds:retry})===true}
  ,async recover(claim:Claim,rows:unknown[],votes:unknown[]){return await rpc('publish_clickdesk_verified_cohort',{p_job_id:claim.jobId,p_token:claim.token,p_rows:rows,p_votes:votes}) as string|null}
 }
}
export async function runInvestigation(store:Omit<ReturnType<typeof postgresInvestigationStore>,'recover'>&{recover?:ReturnType<typeof postgresInvestigationStore>['recover']},fetchPart:(path:string,signal:AbortSignal)=>Promise<unknown>,verifyCurrent=false){
 const claim=await store.claim();if(!claim)return {status:'idle'}
 if(!claim.jobId||!claim.token||!Number.isInteger(claim.attempt)||claim.attempt<1||claim.attempt>5)throw Error('invalid_investigation_claim')
 // Never persist a partially mutated step after a failed request or validation.
 let state=claim.state as State
 try{
  if(!('phase' in state))state=initial(await store.context(claim.jobId))
  if(verifyCurrent&&['owners','verify'].includes(state.phase)){
   if(!state.context.verifyCurrent&&state.phase==='owners'){state.ownerIndex=0;state.page=1;state.pageTotal=null;state.pageCount=0;state.seen=[];state.tickets=[]}
   state.context.verifyCurrent=true
  }
  if(state.phase==='verify'&&state.verification?.stage==='publish'&&store.recover){
   try{const id=await publishCohortVerification(state,(rows,votes)=>store.recover!(claim,rows,votes));if(!id)throw Error('cohort_publication_stale');state.verification.recoveredBy=id;state.verification.stage='done';state.phase='recent'}
   catch{restartCohortVerification(state,'cohort_verification_rejected')}
   const accepted=await store.save(claim,state,{reason:'investigating_received_difference',recovered_by:state.verification?.recoveredBy??null},'pending')
   return {status:accepted?'pending':'stale',jobId:claim.jobId}
  }
  const deadline=Date.now()+65000
  const bounded=async(path:string,signal:AbortSignal)=>{
   const remaining=deadline-Date.now();if(remaining<1000)throw new VerificationBudget()
   try{return await fetchPart(path,AbortSignal.any([signal,AbortSignal.timeout(remaining)]))}
   catch(error){if(Date.now()>=deadline-500)throw new VerificationBudget();throw error}
  }
  const source=verifyCurrent?bounded:fetchPart
  const outcome=await advanceInvestigation(structuredClone(state),source)
  // Drain cheap ID/pagination work within one bounded lease; never wait a minute per owner.
  const accepted=await store.save(claim,outcome.state,outcome.result,outcome.status)
  return {status:accepted?outcome.status:'stale',jobId:claim.jobId}
 }catch(error){
  if(error instanceof VerificationBudget){const accepted=await store.save(claim,state,{reason:'verifying_current_ticket_ids',phase:state.phase},'pending');return {status:accepted?'pending':'stale',jobId:claim.jobId}}
  if(verifyCurrent&&state.phase==='owners'&&error instanceof EvidenceError&&error.message==='duplicate_or_moving_ticket'&&(state.verification?.cycle??1)<2){restartCohortVerification(state,'owner_changed_during_id_read');const accepted=await store.save(claim,state,{reason:'verifying_current_ticket_ids'},'pending');return {status:accepted?'pending':'stale',jobId:claim.jobId}}
  if(verifyCurrent&&state.phase==='owners'&&error instanceof EvidenceError&&['owner_list_incomplete','list_pagination_changed'].includes(error.message)&&(state.ownerReadRetries??0)<2){
   const owner=state.context.owners[state.ownerIndex];state.tickets=state.tickets.filter(t=>t.owner!==owner);state.ownerReadRetries=(state.ownerReadRetries??0)+1;state.page=1;state.pageTotal=null;state.pageCount=0;state.seen=[]
   const accepted=await store.save(claim,state,{reason:'source_list_changed_retry',owner_id:owner},'pending',5)
   return {status:accepted?'retry':'stale',jobId:claim.jobId}
  }
  const permanent=error instanceof EvidenceError
  const done=permanent||claim.attempt>=5
  const retry=error instanceof InvestigationSourceError?Math.min(600,Math.max(30,Math.ceil(error.retryAfter))):Math.min(600,30*2**(claim.attempt-1))
  const reason=permanent?error.message:error instanceof InvestigationSourceError?'source_http_'+error.status:'investigation_source_unavailable'
  const accepted=await store.save(claim,state,{reason,publication:'blocked_original_capture_preserved'},done?'inconclusive':'pending',done?0:retry)
  return {status:accepted?(done?'inconclusive':'retry'):'stale',jobId:claim.jobId}
 }
}
