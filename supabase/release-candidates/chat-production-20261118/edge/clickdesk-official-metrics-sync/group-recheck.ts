import {assembleCapture}from './capture-assembly.ts'
import {assertCaptureRoster}from './capture-plan.ts'
import type {RegistryOwner,CaptureSnapshot}from './capture-finalizer.ts'
import type {RpcClient}from './capture-store.ts'
export type Recheck=CaptureSnapshot&{token:string;attempt:number;group:unknown}
export interface RecheckStore{
 claim():Promise<Recheck|null>
 reject(check:Recheck):Promise<boolean>
 publish(check:Recheck,rows:unknown[],votes:unknown[]):Promise<string|null>
}
export async function runGroupRecheck(store:RecheckStore,registry:()=>Promise<RegistryOwner[]>){
 const check=await store.claim();if(!check)return {status:'idle' as const}
 try{
  const owners=await registry();assertCaptureRoster(check.owners,owners.map(x=>x.clickdesk_owner_id))
  // A separate checkpoint, never a rewrite of the failed capture's payloads.
  const output=assembleCapture(owners,check.start,check.end,{...check.parts,group:check.group})
  const id=await store.publish(check,output.records,output.votes)
  return {status:id?'published' as const:'stale' as const,id,sourceJobId:check.id}
 }catch{
  const accepted=await store.reject(check)
  return {status:accepted?'rejected' as const:'stale' as const,sourceJobId:check.id}
 }
}
export function postgresGroupRecheckStore(client:RpcClient):RecheckStore{
 async function rpc(name:string,args?:Record<string,unknown>){const r=await client.rpc(name,args);if(r.error)throw Error('group_recheck_storage_failed');return r.data}
 const args=(c:Recheck)=>({p_job_id:c.id,p_attempt:c.attempt,p_token:c.token})
 return {
  async claim(){const c=await rpc('claim_clickdesk_group_recheck')as Recheck|null;if(c&&(!c.id||!c.token||![1,2].includes(c.attempt)||!c.parts||!c.group))throw Error('invalid_group_recheck_claim');return c},
  async reject(c){return await rpc('reject_clickdesk_group_recheck',args(c))===true},
  async publish(c,rows,votes){const id=await rpc('publish_clickdesk_rechecked_capture',{...args(c),p_rows:rows,p_votes:votes});if(id!==null&&typeof id!=='string')throw Error('invalid_group_recheck_result');return id as string|null}
 }
}
