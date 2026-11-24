export const VISION360_FALLBACK_MODELS=['gemini-3.5-flash-lite','gemini-3.8-flash','gemini-3.6-flash'] as const
/** Only availability/model-routing failures may switch models; invalid requests and evidence never do. */
export async function withModelFallback<T>(primary:string,run:(model:string)=>Promise<T>,retryable:(error:unknown)=>boolean){
 const models=[...new Set([primary,...VISION360_FALLBACK_MODELS])].slice(0,3)
 const attempts:Array<{model:string;status:'failed'|'succeeded'}>=[]
 for(let index=0;index<models.length;index++){
  const model=models[index]
  try{const value=await run(model);attempts.push({model,status:'succeeded'});return {value,model,attempts}}
  catch(error){attempts.push({model,status:'failed'});if(!retryable(error)||index===models.length-1)throw error}
 }
 throw Error('provider_unavailable')
}

