import { after } from 'next/server'
import { ApiError, handle, json } from '@/lib/integration-server'
import { brtDay, d1 } from '@/lib/cx360-diagnostics'
import { configured, isCxCron, syncCx, processCx } from '@/lib/cx360-diagnostics-server'
export const runtime='nodejs'
export const maxDuration=300
export async function GET(request:Request){return handle(async()=>{
 if(!isCxCron(request))throw new ApiError(401,'Credencial de agendamento inválida.')
 if(!configured())throw new ApiError(503,'Integração de análise ainda não configurada.')
 const end=d1(),start=new Date(Date.parse(`${brtDay()}T12:00:00Z`)-7*86400000).toISOString().slice(0,10)
 const result=await syncCx(start,end,null)
 const backlogStart=new Date(Date.parse(`${end}T12:00:00Z`)-61*86400000).toISOString().slice(0,10)
 after(async()=>{try{await processCx(backlogStart,end)}catch{console.warn('CX360 daily worker: cycle unavailable')}})
 return json({...result,accepted:true},202)
})}
