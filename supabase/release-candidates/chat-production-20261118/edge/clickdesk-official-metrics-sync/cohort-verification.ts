import type {State}from './investigation.ts'
import {assembleCapture}from './capture-assembly.ts'
import {receivedCount,receivedForOwner}from './received.ts'
type Obj=Record<string,unknown>
const object=(v:unknown)=>v&&typeof v==='object'&&!Array.isArray(v)?v as Obj:{}
const key=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()
export function verifiedParts(s:State){return {...Object.fromEntries(Object.entries(s.context.parts).filter(([k])=>!k.startsWith('ratings:'))),...s.verification!.overrides}}
export function verifyCohort(s:State){
 const c=s.context,parts=verifiedParts(s),ids=new Set(s.tickets.map(t=>t.id))
 if(ids.size!==s.tickets.length||s.ownerIndex!==c.owners.length)throw Error('cohort_ids_incomplete')
 for(const id of c.owners)if(receivedForOwner(parts['owner:'+id],id)!==s.tickets.filter(t=>t.owner===id).length)throw Error('cohort_moved_during_verification')
 if(receivedCount(parts.group)!==s.tickets.length)throw Error('cohort_group_changed')
 return assembleCapture(c.registry.map(r=>({clickdesk_owner_id:r.id,source_owner_name:r.name,source_owner_key:key(r.name)})),c.start,c.end,parts)
}
export function restartCohortVerification(s:State,reason:string){
 const cycle=s.verification?.cycle??1
 if(cycle>=2){s.verification={...s.verification!,stage:'done',reason};s.phase='recent';return}
 const headers=Object.fromEntries(Object.entries(s.verification?.overrides??{}).filter(([k])=>k.startsWith('owner:')))
 const times=Object.fromEntries(Object.entries(s.verification?.times??{}).filter(([k])=>k.startsWith('owner:')))
 s.verification={cycle:cycle+1,stage:'headers',changed:[],index:0,departmentIndex:0,page:1,pages:1,total:null,count:0,overrides:headers,times,reason}
 s.phase='owners';s.ownerIndex=0;s.page=1;s.pageTotal=null;s.pageCount=0;s.seen=[];s.tickets=[];s.lastUpdated=null
}
export async function advanceCohortVerification(s:State,fetchPart:(path:string,signal:AbortSignal)=>Promise<unknown>,now:()=>string){
 const c=s.context
 if(!s.verification||s.verification.stage==='headers'&&s.verification.index===0&&s.verification.changed.length===0&&!s.verification.overrides.group){
  const previous=s.verification
  s.verification={cycle:previous?.cycle??1,stage:'group',changed:c.owners.filter(id=>receivedForOwner(previous?.overrides['owner:'+id]??c.parts['owner:'+id],id)!==s.tickets.filter(t=>t.owner===id).length),index:0,departmentIndex:0,page:1,pages:1,total:null,count:0,overrides:previous?.overrides??{},times:previous?.times??{}}
 }
 const v=s.verification!,fetchOne=(p:string)=>fetchPart(p,AbortSignal.timeout(60000))
 // Establish a real source reference matching the ID union, then validate every part against it.
 // This also upgrades an in-flight pass created by the earlier group-last implementation.
 if(v.stage!=='group'&&!v.overrides.group){
  if(v.stage==='ratings'){v.departmentIndex=0;v.page=1;v.pages=1;v.total=null;v.count=0;for(const k of Object.keys(v.overrides))if(k.startsWith('ratings:')){delete v.overrides[k];delete v.times[k]}}
  v.stage='group'
 }
 if(v.stage==='headers'){
  const batch=v.changed.slice(v.index,v.index+2)
  const headers=await Promise.all(batch.map(async id=>{const p=new URLSearchParams({from:c.start,to:c.end});[3,12].forEach(d=>p.append('department_ids[]',String(d)));p.append('owner_ids[]',String(id));return {id,payload:await fetchOne('/support/reports/agents?'+p),at:now()}}))
  for(const h of headers){v.overrides['owner:'+h.id]=h.payload;v.times['owner:'+h.id]=h.at;v.index++}
  if(v.index>=v.changed.length)v.stage='ratings'
 }else if(v.stage==='ratings'){
  const department=[3,12][v.departmentIndex],p=new URLSearchParams({from:c.start,to:c.end,department_id:String(department),per_page:'100',page:String(v.page)}),k=`ratings:${department}:${v.page}`
  const raw=await fetchOne('/support/reports/ratings?'+p),r=object(raw)
  if(!Array.isArray(r.data)||!Number.isSafeInteger(r.total)||Number(r.total)<0||!Number.isSafeInteger(r.last_page)||Number(r.last_page)<1||Number(r.last_page)>500)throw Error('verification_ratings_invalid')
  if(v.total!==null&&(v.total!==Number(r.total)||v.pages!==Number(r.last_page))){restartCohortVerification(s,'verification_ratings_changed');return {state:s,status:'pending' as const,result:{reason:'rechecking_source_changed'}}}
  v.total=Number(r.total);v.pages=Number(r.last_page);v.count+=r.data.length;v.overrides[k]=raw;v.times[k]=now()
  if(v.page<v.pages)v.page++;else{
   if(v.count!==v.total)throw Error('verification_ratings_incomplete')
   v.departmentIndex++;v.page=1;v.pages=1;v.total=null;v.count=0
   if(v.departmentIndex===2){try{verifyCohort(s);v.stage='publish'}catch{restartCohortVerification(s,'cohort_source_still_moving')}}
  }
 }else if(v.stage==='group'){
  const p=new URLSearchParams({from:c.start,to:c.end});[3,12].forEach(d=>p.append('department_ids[]',String(d)));c.owners.forEach(id=>p.append('owner_ids[]',String(id)))
  v.overrides.group=await fetchOne('/support/reports/agents?'+p);v.times.group=now();v.groupAt=v.times.group
  if(receivedCount(v.overrides.group)!==s.tickets.length)restartCohortVerification(s,'cohort_source_still_moving');else v.stage='headers'
 }
 return {state:s,status:'pending' as const,result:{reason:'verifying_current_ticket_ids',phase:s.phase,cycle:v.cycle,stage:s.verification?.stage,enumerated_ids:s.tickets.length}}
}
export async function publishCohortVerification(s:State,publish:(rows:unknown[],votes:unknown[])=>Promise<string|null>){
 if(s.verification?.stage!=='publish')throw Error('cohort_proof_not_ready')
 const output=verifyCohort(s);return await publish(output.records,output.votes)
}
