import { ApiError, authorizeClickDeskSessionClient, handle, json } from '@/lib/integration-server'
import { getServerSupabaseConfig } from '@/lib/runtime-environment'

export const runtime = 'nodejs'
export const maxDuration = 30

export async function POST(request: Request) {
 return handle(async()=>{
 const config=getServerSupabaseConfig()
 if(config.environment!=='homologacao'||new URL(config.url).hostname!=='vvtorcvchnqhcredhorv.supabase.co')throw new ApiError(404,'Fila disponível somente na homologação.')
 const access=await authorizeClickDeskSessionClient(request)
 if(!access.isManagement)throw new ApiError(403,'Processamento disponível somente para a gestão.')
 const body=await request.json().catch(()=>null) as {start?:string;end?:string;team_id?:string|null;retry_failed?:boolean}|null
 const start=body?.start||'',end=body?.end||''
 if(!/^20\d{2}-\d{2}-\d{2}$/.test(start)||!/^20\d{2}-\d{2}-\d{2}$/.test(end)||end<start)throw new ApiError(400,'Período inválido.')
 const apiKey=process.env.GEMINI_API_KEY?.trim()||process.env.GOOGLE_API_KEY?.trim()
 if(!apiKey)throw new ApiError(503,'Provedor de IA não configurado na homologação.')
 // Credential provisioning stays server-to-server inside this homologation project.
 // Never return or log this payload, and never accept a destination from the client.
 const response=await fetch('https://vvtorcvchnqhcredhorv.supabase.co/functions/v1/clickdesk-360-dispatch',{
 method:'POST',headers:{Authorization:request.headers.get('authorization')||'','Content-Type':'application/json'},
 body:JSON.stringify({action:'start',start,end,team_id:body?.team_id||null,retry_failed:body?.retry_failed===true,provider_key:apiKey,model:process.env.GEMINI_MODEL?.trim()||'gemini-3.5-flash-lite'}),
 signal:AbortSignal.timeout(15000),cache:'no-store'})
 const data=await response.json().catch(()=>null)
 if(!response.ok||!data?.accepted)throw new ApiError(response.status===401?401:503,'Não foi possível iniciar a fila no servidor. Nenhuma nota ou KPI foi alterado.')
 return json(data,202)
 })
}
