import {captureRetryDelay} from './capture-plan.ts'

export type ClaimedUnit={jobId:string;key:string;path:string;token:string;attempt:number}
/** Storage must claim atomically and accept writes only for the current unexpired token. */
export interface CaptureStore {
 claim():Promise<ClaimedUnit|null>
 complete(unit:ClaimedUnit,payload:unknown):Promise<boolean>
 retry(unit:ClaimedUnit,error:string,nextAttemptAt:string|null):Promise<boolean>
}
export async function runCaptureUnit(store:CaptureStore,fetchPart:(path:string,signal:AbortSignal)=>Promise<unknown>,now=()=>Date.now()){
 const unit=await store.claim()
 if(!unit)return {status:'idle' as const}
 if(!Number.isSafeInteger(unit.attempt)||unit.attempt<1||unit.attempt>5)throw Error('invalid_claim_attempt')
 try {
  const payload=await fetchPart(unit.path,AbortSignal.timeout(60000))
  if(payload===null||typeof payload!=='object')throw Error('invalid_source_payload')
  const accepted=await store.complete(unit,payload)
  return {status:accepted?'checkpointed' as const:'stale' as const,key:unit.key}
 }catch(error){
  console.warn('clickdesk_capture_unit',error instanceof Error&&['AbortError','TimeoutError','SyntaxError'].includes(error.name)?error.name:'operation_failed')
  // Persist only a fixed code: upstream errors can contain credentials or customer data.
  const next=unit.attempt<5?new Date(now()+captureRetryDelay(unit.attempt)).toISOString():null
  const accepted=await store.retry(unit,'capture_unit_failed',next)
  return {status:accepted?(next?'retry' as const:'exhausted' as const):'stale' as const,key:unit.key}
 }
}

/** Claim a bounded set atomically through the existing store; never duplicate one unit. */
export async function runCaptureBatch(store:CaptureStore,fetchPart:(path:string,signal:AbortSignal)=>Promise<unknown>,limit=3){
 if(!Number.isSafeInteger(limit)||limit<1||limit>3)throw Error('invalid_capture_batch')
 return await Promise.all(Array.from({length:limit},()=>runCaptureUnit(store,fetchPart)))
}
