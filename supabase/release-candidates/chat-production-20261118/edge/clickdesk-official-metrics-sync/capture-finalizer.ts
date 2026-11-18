import {assembleCapture} from './capture-assembly.ts'
import {assertCaptureRoster} from './capture-plan.ts'
export type RegistryOwner={clickdesk_owner_id:number;source_owner_name:string;source_owner_key:string}
export type CaptureSnapshot={id:string;start:string;end:string;owners:number[];parts:Record<string,unknown>}
export interface FinalizationStore{
 ready():Promise<CaptureSnapshot|null>
 registry():Promise<RegistryOwner[]>
 publish(id:string,rows:unknown[],votes:unknown[]):Promise<boolean>
 fail(id:string):Promise<void>
}
/** No publication on partial capture, changed roster or invalid source. SQL repeats its gate under lock. */
export async function finalizeReadyCapture(store:FinalizationStore){
 const job=await store.ready()
 if(!job)return {status:'idle' as const}
 try{
 const registry=await store.registry()
 assertCaptureRoster(job.owners,registry.map(owner=>owner.clickdesk_owner_id))
 const output=assembleCapture(registry,job.start,job.end,job.parts)
 const accepted=await store.publish(job.id,output.records,output.votes)
 return {status:accepted?'published' as const:'pending' as const,id:job.id}
 }catch{
  await store.fail(job.id)
  return {status:'failed' as const,id:job.id}
 }
}
