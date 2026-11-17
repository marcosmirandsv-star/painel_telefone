import type {RpcClient} from './capture-store.ts'
import type {FinalizationStore,CaptureSnapshot,RegistryOwner} from './capture-finalizer.ts'
export function postgresFinalizationStore(client:RpcClient,registry:()=>Promise<RegistryOwner[]>):FinalizationStore{
 return {
  registry,
  async fail(id){
   const result=await client.rpc('fail_clickdesk_capture_finalization',{p_job_id:id})
   if(result.error)throw Error('capture_failure_checkpoint_failed')
  },
  async ready(){
   const result=await client.rpc('load_clickdesk_ready_capture')
   if(result.error)throw Error('capture_snapshot_failed')
   if(result.data===null)return null
   const job=result.data as CaptureSnapshot
   if(!job||typeof job.id!=='string'||typeof job.start!=='string'||typeof job.end!=='string'||!Array.isArray(job.owners)||!job.parts||typeof job.parts!=='object'||Array.isArray(job.parts))throw Error('invalid_capture_snapshot')
   return job
  },
  async publish(id,rows,votes){
   const result=await client.rpc('finalize_clickdesk_capture',{p_job_id:id,p_rows:rows,p_votes:votes})
   if(result.error)throw Error('capture_finalization_failed')
   if(typeof result.data!=='boolean')throw Error('invalid_finalization_result')
   return result.data
  },
 }
}
