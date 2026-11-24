import {isCxCron} from '@/lib/cx360-diagnostics-server'
import {syntheticAnalysisProbe} from '@/lib/vision360-activation/synthetic-probe'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export const maxDuration=240
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}})
export async function POST(request:Request){
 if(!isCxCron(request))return json({error:'unauthorized'},401)
 if(process.env.VERCEL_ENV!=='production'||process.env.NEXT_PUBLIC_SUPABASE_URL!=='https://qmetbydkepfdgfqkdkai.supabase.co')return json({error:'production_only'},403)
 let body:unknown
 try{body=await request.json()}catch{return json({error:'invalid_request'},400)}
 if(JSON.stringify(body)==='{"action":"synthetic_analysis"}')return json(await syntheticAnalysisProbe(process.env))
 if(JSON.stringify(body)!=='{"action":"synthetic_probe"}')return json({error:'invalid_request'},400)
 const key=process.env.GEMINI_API_KEY?.trim(),model=process.env.CX360_MODEL?.trim()||'gemini-3.5-flash-lite'
 if(!key)return json({configured:false,error:'missing_gemini_api_key'},503)
 const results=[]
 for(const mode of ['model_metadata','plain','structured'] as const){
  const started=Date.now()
  try{
   const url='https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(model)+(mode==='model_metadata'?'':':generateContent')
   const response=await fetch(url,{method:mode==='model_metadata'?'GET':'POST',headers:{'x-goog-api-key':key,'Content-Type':'application/json'},cache:'no-store',signal:AbortSignal.timeout(45000),...(mode==='model_metadata'?{}:{body:JSON.stringify({contents:[{role:'user',parts:[{text:'Synthetic connectivity test. Return {"ok":true}. No customer data.'}]}],generationConfig:{maxOutputTokens:128,...(mode==='structured'?{responseMimeType:'application/json',responseJsonSchema:{type:'object',properties:{ok:{type:'boolean'}},required:['ok'],additionalProperties:false}}:{})}})})})
   const payload=await response.json().catch(()=>null)
   const error=payload?.error
   const message=typeof error?.message==='string'?error.message.split(key).join('[REDACTED]').replace(/AIza[\w-]+/g,'[REDACTED]').slice(0,1200):null
   results.push({mode,http_status:response.status,elapsed_ms:Date.now()-started,provider_status:error?.status??null,message,...(mode==='model_metadata'&&response.ok?{name:payload?.name,supported_methods:payload?.supportedGenerationMethods}:{}),...(mode!=='model_metadata'&&response.ok?{generated:Boolean(payload?.candidates?.length),finish_reason:payload?.candidates?.[0]?.finishReason??null}:{})})
  }catch(error){results.push({mode,error:error instanceof Error&&error.name==='TimeoutError'?'timeout':'request_failed',elapsed_ms:Date.now()-started})}
 }
 return json({configured:true,model,model_source:process.env.CX360_MODEL?.trim()?'CX360_MODEL':'code_default',results,customer_data_sent:false,database_mutations:0})
}

