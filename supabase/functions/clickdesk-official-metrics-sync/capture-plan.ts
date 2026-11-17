import {receivedCount,receivedForOwner} from './received.ts'

export type CaptureTask={key:string;path:string}
type Payload=Record<string,unknown>
const departments=[3,12] as const
function validDate(value:string){
 const parsed=new Date(value+'T12:00:00Z')
 return /^20\d{2}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===value
}
function params(start:string,end:string,extra:Record<string,string|number|number[]>){
 const query=new URLSearchParams({from:start,to:end})
 for(const [key,value] of Object.entries(extra))for(const part of Array.isArray(value)?value:[value])query.append(Array.isArray(value)?key+'[]':key,String(part))
 return query.toString()
}
export function initialCaptureTasks(start:string,end:string,owners:number[]):CaptureTask[]{
 if(!owners.length||new Set(owners).size!==owners.length||owners.some(id=>!Number.isSafeInteger(id)||id<=0))throw Error('invalid_capture_roster')
 if(!validDate(start)||!validDate(end)||start>end||start.slice(0,7)!==end.slice(0,7))throw Error('invalid_capture_period')
 return [
  {key:'group',path:'/support/reports/agents?'+params(start,end,{department_ids:[...departments],owner_ids:owners})},
  ...owners.map(owner=>({key:'owner:'+owner,path:'/support/reports/agents?'+params(start,end,{department_ids:[...departments],owner_ids:[owner]})})),
  ...departments.map(department=>ratingTask(start,end,department,1)),
 ]
}
function ratingTask(start:string,end:string,department:number,page:number):CaptureTask{
 return {key:`ratings:${department}:${page}`,path:'/support/reports/ratings?'+params(start,end,{department_id:department,per_page:100,page})}
}
function pagination(payload:unknown){
 const value=payload as Payload|null
 if(!value||!Array.isArray(value.data)||!Number.isSafeInteger(value.last_page)||Number(value.last_page)<1||Number(value.last_page)>500||!Number.isSafeInteger(value.total)||Number(value.total)<0)throw Error('invalid_capture_pagination')
 return {pages:Number(value.last_page),total:Number(value.total)}
}
export function remainingRatingTasks(start:string,end:string,department:number,first:unknown){
 if(!departments.some(id=>id===department))throw Error('invalid_capture_department')
 return Array.from({length:pagination(first).pages-1},(_,index)=>ratingTask(start,end,department,index+2))
}
/** Each unit is persisted independently. This gate precedes the existing atomic publisher. */
export function captureReadiness(start:string,end:string,owners:number[],parts:Record<string,unknown>){
 const tasks=initialCaptureTasks(start,end,owners)
 for(const department of departments){
  const first=parts[`ratings:${department}:1`]
  if(first!==undefined)tasks.push(...remainingRatingTasks(start,end,department,first))
 }
 const missing=tasks.filter(task=>parts[task.key]===undefined).map(task=>task.key)
 if(missing.length)return {ready:false,missing}
 for(const department of departments){
  const first=parts[`ratings:${department}:1`],meta=pagination(first)
  let total=0
  for(let page=1;page<=meta.pages;page++){
   const part=parts[`ratings:${department}:${page}`] as Payload
   const current=pagination(part)
   if(current.pages!==meta.pages||current.total!==meta.total)throw Error('capture_pagination_changed')
   total+=(part.data as unknown[]).length
  }
  if(total!==meta.total)throw Error('capture_ratings_incomplete')
 }
 const received=owners.reduce((sum,owner)=>sum+receivedForOwner(parts['owner:'+owner],owner),0)
 if(received!==receivedCount(parts.group))throw Error('received_counts_not_reconciled')
 return {ready:true,missing:[]}
}
export function assertCaptureRoster(initial:number[],current:number[]){
 if(initial.length!==current.length||initial.some(id=>!current.includes(id)))throw Error('capture_roster_changed')
}
export function captureRetryDelay(attempt:number){
 if(!Number.isSafeInteger(attempt)||attempt<1||attempt>5)throw Error('capture_retry_exhausted')
 return Math.min(600000,30000*2**(attempt-1))
}
