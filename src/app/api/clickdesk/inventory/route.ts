import {isChatProductionEnabled} from '@/lib/chat-production-gate'
import {ApiError,authorizeClickDeskSessionClient,handle,json} from '@/lib/chat-integration-server'
import {getServerSupabaseConfig} from '@/lib/runtime-environment'
export const runtime='nodejs'
export const maxDuration=30
async function officialPOST(request:Request){
 return handle(async()=>{
 if(!isChatProductionEnabled())throw new ApiError(404,'Disponível somente na homologação.')
 const access=await authorizeClickDeskSessionClient(request)
 if(!access.isManagement)throw new ApiError(403,'Conferência disponível somente para a gestão.')
 const body=await request.json().catch(()=>null) as {month?:string}|null
 if(!body?.month||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(body.month))throw new ApiError(400,'Competência inválida.')
 const response=await fetch('https://qmetbydkepfdgfqkdkai.supabase.co/functions/v1/clickdesk-period-inventory',{
 method:'POST',headers:{Authorization:request.headers.get('authorization')||'','Content-Type':'application/json'},
 body:JSON.stringify({month:body.month,restart:true}),signal:AbortSignal.timeout(15000),cache:'no-store'})
 const data=await response.json().catch(()=>null)
 if(!response.ok||!data?.accepted)throw new ApiError(503,'A captura não pôde ser iniciada. Confira o diagnóstico da competência.')
 return json(data,202)
 })
}

export async function POST(request:Request){if(!isChatProductionEnabled())return Response.json({erro:'Chat oficial ainda não habilitado.'},{status:404});return officialPOST(request)}
