import type {CaptureStore,ClaimedUnit} from './capture-worker.ts'
export type RpcClient={rpc(name:string,args?:Record<string,unknown>):PromiseLike<{data:unknown;error:unknown}>}
export function postgresCaptureStore(client:RpcClient):CaptureStore{
 async function call(name:string,args?:Record<string,unknown>){
  const result=await client.rpc(name,args)
  if(result.error)throw Error('capture_storage_failed')
  return result.data
 }
 function claimArgs(unit:ClaimedUnit){return {p_job_id:unit.jobId,p_key:unit.key,p_token:unit.token}}
 return {
  async claim(){
   const data=await call('claim_clickdesk_capture_unit')
   if(!Array.isArray(data)||data.length>1)throw Error('invalid_capture_claim')
   if(!data.length)return null
   const row=data[0] as Record<string,unknown>
   if(!row||typeof row.job_id!=='string'||typeof row.task_key!=='string'||typeof row.path!=='string'||typeof row.lease_token!=='string'||!Number.isSafeInteger(row.attempt)||Number(row.attempt)<1||Number(row.attempt)>5)throw Error('invalid_capture_claim')
   if(!/^\/support\/reports\/(agents|ratings)\?/.test(row.path))throw Error('invalid_capture_path')
   return {jobId:row.job_id,key:row.task_key,path:row.path,token:row.lease_token,attempt:Number(row.attempt)}
  },
  async complete(unit,payload){
   const data=await call('complete_clickdesk_capture_unit',{...claimArgs(unit),p_payload:payload})
   if(typeof data!=='boolean')throw Error('invalid_checkpoint_result')
   return data
  },
  async retry(unit){
   // The database calculates its own backoff using the claimed attempt and server clock.
   const data=await call('retry_clickdesk_capture_unit',claimArgs(unit))
   if(typeof data!=='boolean')throw Error('invalid_retry_result')
   return data
  },
 }
}
