import { after } from 'next/server'
import { ApiError, handle, json } from '@/lib/integration-server'
import { d1 } from '@/lib/cx360-diagnostics'
import { configured, isCxCron, processCx } from '@/lib/cx360-diagnostics-server'
export const runtime='nodejs'
export const maxDuration=300
export async function GET(request:Request){return handle(async()=>{
  if(!isCxCron(request))throw new ApiError(401,'Credencial de agendamento inválida.')
  if(!configured())throw new ApiError(503,'Integração de análise ainda não configurada.')
  const end=d1(),start=new Date(Date.parse(`${end}T12:00:00Z`)-61*86400000).toISOString().slice(0,10)
  after(async()=>{try{const result=await processCx(start,end);console.info('CX360 queue cycle',result)}catch{console.warn('CX360 queue cycle unavailable')}})
  return json({accepted:true,scope:{start,end}},202)
})}
