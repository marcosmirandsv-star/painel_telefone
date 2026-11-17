import {ApiError, authorizeClickDeskSessionClient, handle, json} from '@/lib/integration-server'
import {getServerSupabaseConfig} from '@/lib/runtime-environment'
import {extractTranscriptText} from '@/lib/clickdesk-qualitative'
import {readFinalLedger} from '@/lib/clickdesk-ledger-server'

export const runtime = 'nodejs'
export const maxDuration = 60

function validDate(value:string) {
  return /^20\d{2}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) &&
    new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value
}

export async function GET(request:Request) {return handle(async()=>{
  if(getServerSupabaseConfig().environment!=='homologacao') throw new ApiError(404,'Recurso disponível somente em homologação.')
  const access=await authorizeClickDeskSessionClient(request)
  const params=new URL(request.url).searchParams
  for(const key of params.keys()) if(!['start','end','analyst_id','ticket_id'].includes(key)||params.getAll(key).length!==1) throw new ApiError(400,'Parâmetro desconhecido ou repetido.')
  const start=params.get('start')||'',end=params.get('end')||'',requested=params.get('analyst_id')
  if(!validDate(start)||!validDate(end)||end<start||Date.parse(end)-Date.parse(start)>31*86400000) throw new ApiError(400,'Período inválido. Selecione até um mês.')
  if(requested&&!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(requested)) throw new ApiError(400,'Analista inválido.')
  if(!access.isManagement&&requested&&requested!==access.chatAnalystId) throw new ApiError(403,'Consulta restrita aos próprios tickets.')
  const analystId=access.isManagement?requested:access.chatAnalystId
  if(!analystId) throw new ApiError(403,'Perfil sem vínculo individual.')
  type Item={ticket_id:string;ticket_number:string;rated_at:string;sentiment:string;original_label:string;can_analyze:boolean}
  const items:Item[]=[]
  if(start>='2026-11-01') {
    const capture=await access.admin.rpc('get_scoped_clickdesk_official_period_metrics',{p_start:start,p_end:end})
    if(capture.error||!capture.data?.length) throw new ApiError(503,'As avaliações deste intervalo ainda estão em preparação.')
    for(let offset=0;offset<10000;offset+=500) {
      const result=await access.admin.from('clickdesk_official_period_votes')
        .select('ticket_id,ticket_number,rated_at,sentiment,original_label')
        .eq('period_start',start).eq('period_end',end).eq('analyst_id',analystId)
        .order('rated_at',{ascending:false}).order('ticket_id').range(offset,offset+499)
      if(result.error) throw new ApiError(503,'Não foi possível carregar suas avaliações.')
      items.push(...(result.data??[]).map(row=>({...row,can_analyze:false})))
      if((result.data?.length??0)<500)break
      if(offset===9500)throw new ApiError(503,'Consulta excedeu o limite seguro.')
    }
  } else {
    const rows=await readFinalLedger(access.admin,{start,end,analystId})
    items.push(...rows.filter(row=>['positive','negative'].includes(row.satisfaction_label??'')).map(row=>({ticket_id:row.ticket_id,ticket_number:row.ticket_id,rated_at:row.last_public_at,sentiment:row.satisfaction_label!,original_label:row.satisfaction_label==='positive'?'Boa':'Ruim',can_analyze:true})))
  }
  // Keep the same proven-ownership guard as the existing qualitative endpoint.
  for(let offset=0;offset<items.length;offset+=200) {
    const ids=items.slice(offset,offset+200).map(item=>item.ticket_id)
    const [ledger,pending]=await Promise.all([
      access.admin.from('clickdesk_final_ticket_ledger').select('ticket_id').eq('analyst_id',analystId).in('ticket_id',ids),
      access.admin.from('clickdesk_final_ticket_pending').select('ticket_id').in('ticket_id',ids),
    ])
    if(ledger.error||pending.error)throw new ApiError(503,'Não foi possível conferir a autoria dos tickets.')
    const eligible=new Set((ledger.data??[]).map(row=>row.ticket_id)),blocked=new Set((pending.data??[]).map(row=>row.ticket_id))
    for(const item of items.slice(offset,offset+200))item.can_analyze=eligible.has(item.ticket_id)&&!blocked.has(item.ticket_id)
  }
  const ticketId=params.get('ticket_id')
  if(ticketId) {
    // Never fetch a transcript until this session's exact-period ownership is proven.
    if(!items.some(item=>item.ticket_id===ticketId))throw new ApiError(404,'Ticket não encontrado para este acesso e período.')
    const apiKey=process.env.CLICKDESK_API_KEY?.trim(),account=process.env.CLICKDESK_ACCOUNT_ID?.trim()
    if(!apiKey||!account)throw new ApiError(503,'Conversa temporariamente indisponível.')
    const response=await fetch('https://api.desk.click.app/api/v1/tickets/'+encodeURIComponent(ticketId)+'/transcript',{
      headers:{Authorization:'Bearer '+apiKey,'X-Account-Id':account,Accept:'application/json'},cache:'no-store',signal:AbortSignal.timeout(20000),
    }).catch(()=>null)
    if(!response?.ok)throw new ApiError(503,'Não foi possível abrir a conversa. Tente novamente.')
    const transcript=extractTranscriptText(await response.json())
    return json({ticket_id:ticketId,transcript:transcript||'Conversa sem texto disponível.'})
  }
  return json({items,totals:{total:items.length,positive:items.filter(item=>item.sentiment==='positive').length,negative:items.filter(item=>item.sentiment==='negative').length}})
})}
