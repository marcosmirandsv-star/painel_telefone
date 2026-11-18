import {isChatProductionEnabled} from '@/lib/chat-production-gate'
import {ApiError,authorizeManagerSessionClient,handle,json} from '@/lib/chat-integration-server'
import {clickDeskPublicationDay} from '@/lib/clickdesk-publication'
export const runtime='nodejs'
export const maxDuration=30
export async function POST(request:Request){return handle(async()=>{
 if(!isChatProductionEnabled())throw new ApiError(404,'Chat oficial ainda não habilitado.')
 const {admin}=await authorizeManagerSessionClient(request)
 const body=await request.json().catch(()=>null)
 const start=typeof body?.start==='string'?body.start:'',end=typeof body?.end==='string'?body.end:''
 const valid=(s:string)=>/^20\d{2}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s
 if(!valid(start)||!valid(end)||start<'2026-10-01'||end<start||end>clickDeskPublicationDay()||start.slice(0,7)!==end.slice(0,7))throw new ApiError(400,'Selecione um intervalo válido dentro da competência.')
 const result=await admin.rpc('request_clickdesk_official_period',{p_start:start,p_end:end})
 if(result.error)throw new ApiError(503,'Não foi possível solicitar a captura oficial. A última captura válida foi preservada.')
 return json({accepted:true,requested:result.data===true,period:{start,end}},202)
})}
