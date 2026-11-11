import {ApiError,authorizeClickDeskSessionClient,handle,json} from '@/lib/integration-server'
import {getServerSupabaseConfig} from '@/lib/runtime-environment'
export const runtime='nodejs'
export async function GET(request:Request){return handle(async()=>{
 if(getServerSupabaseConfig().environment!=='homologacao')throw new ApiError(404,'Revisão disponível somente em homologação.')
 const access=await authorizeClickDeskSessionClient(request),params=new URL(request.url).searchParams
 const start=params.get('start')||'',end=params.get('end')||'',requested=params.get('analyst_id'),team=params.get('team_id')
 if(!/^20\d{2}-\d{2}-\d{2}$/.test(start)||!/^20\d{2}-\d{2}-\d{2}$/.test(end)||!Number.isFinite(Date.parse(start))||!Number.isFinite(Date.parse(end))||end<start||(Date.parse(end)-Date.parse(start))/86400000>93)throw new ApiError(400,'Período inválido.')
 const uuid=/^[a-f0-9-]{36}$/i
 if(requested&&!uuid.test(requested)||team&&!uuid.test(team))throw new ApiError(400,'Filtro inválido.')
 if(!access.isManagement&&requested&&requested!==access.chatAnalystId)throw new ApiError(403,'Consulta restrita aos próprios tickets.')
 if(!access.isManagement&&!access.chatAnalystId)throw new ApiError(403,'Perfil sem vínculo individual.')
 const analyst=access.isManagement?requested:access.chatAnalystId
 const patternStart=new Date(Date.parse(end+'T12:00:00Z')-13*86400000).toISOString().slice(0,10)
 const from=patternStart<start?patternStart:start
 const rows:Record<string,unknown>[]=[]
 for(let offset=0;offset<10000;offset+=500){
  let query=access.admin.from('clickdesk_event_ratings').select('ticket_id,ticket_number,analyst_id,team_id,occurred_date,original_label,source_hash,review:clickdesk_neutral_reviews(cause,status,attempts,analysis,exclusion_eligible,source_hash,reviewed_at,error_code)').eq('original_label','Neutro').gte('occurred_date',from).lte('occurred_date',end).order('ticket_id')
  if(analyst)query=query.eq('analyst_id',analyst)
  if(access.isManagement&&team)query=query.eq('team_id',team)
  const result=await query.range(offset,offset+499)
  if(result.error)throw new ApiError(503,'Não foi possível consultar os neutros.')
  rows.push(...(result.data??[]))
  if((result.data?.length??0)<500)break
  if(offset===9500)throw new ApiError(503,'Consulta excedeu a paginação segura.')
 }
 const people=await access.admin.from('chat_analysts').select('id,name')
 if(people.error)throw new ApiError(503,'Cadastro de analistas indisponível.')
 const names=new Map((people.data??[]).map(person=>[person.id,person.name]))
 const mapped=rows.map(row=>{
  const nested=Array.isArray(row.review)?row.review[0]:row.review
  const review=(nested&&typeof nested==='object'?nested:{}) as Record<string,unknown>
  const analysis=(review.analysis&&typeof review.analysis==='object'?review.analysis:{}) as Record<string,unknown>
  const fresh=review.source_hash===row.source_hash
  const verified=fresh&&review.status==='verified'
  return {ticket_id:row.ticket_id,ticket_number:row.ticket_number,analyst_id:row.analyst_id,analyst_name:names.get(String(row.analyst_id))??'Analista',date:String(row.occurred_date),
   cause:verified?review.cause:'inconclusive',status:fresh?review.status:'pending',
   excluded:verified&&review.exclusion_eligible===true,
   explanation:typeof analysis.explanation==='string'?analysis.explanation:'Aguardando revisão da conversa.',
   evidence:Array.isArray(analysis.evidence_quotes)?analysis.evidence_quotes:[],
   pattern:analysis.pattern_supported===true?String(analysis.pattern):'none',reviewed_at:review.reviewed_at}
 })
 const selected=mapped.filter(row=>row.date>=start)
 const completed=selected.filter(row=>row.status==='verified'||row.status==='needs_review')
 const inconclusive=completed.filter(row=>row.status==='needs_review')
 const technical=selected.filter(row=>row.status==='technical_failure').length
 const alerts:Array<{kind:string;message:string;tickets:unknown[]}>=[]
 if(access.isManagement){
  const corrections=await access.admin.rpc('get_clickdesk_event_correction_summary')
  if(corrections.error)throw new ApiError(503,'Conferência de movimentações indisponível.')
  if(Number(corrections.data?.historical_changes)>0)alerts.push({kind:'historical_change',message:corrections.data.historical_changes+' movimentação(ões) posteriores foram registradas na base nos últimos 14 dias. Os dias publicados foram preservados e precisam de conferência.',tickets:[]})

  if(inconclusive.length>=5||(completed.length>=10&&inconclusive.length/completed.length>=.2))alerts.push({kind:'inconclusive_volume',message:`${inconclusive.length} de ${completed.length} análises concluídas precisam de revisão da causa.`,tickets:inconclusive.map(row=>row.ticket_number)})
  const groups=new Map<string,typeof mapped>()
  for(const row of mapped.filter(row=>row.date>=patternStart&&row.status==='needs_review'&&row.pattern!=='none')){const key=row.analyst_id+'|'+row.pattern;groups.set(key,[...(groups.get(key)??[]),row])}
  for(const group of groups.values())if(group.length>=3)alerts.push({kind:'possible_human_pattern',message:`${group[0].analyst_name}: ${group.length} casos inconclusivos com um sinal semelhante nos últimos 14 dias. É uma pista para investigar, não falha comprovada.`,tickets:group.map(row=>row.ticket_number)})
  if(technical)alerts.push({kind:'source_or_service_failure',message:`${technical} conversa(s) aguardam recuperação ou nova tentativa técnica. Não são conclusões sobre atendimento.`,tickets:selected.filter(row=>row.status==='technical_failure').map(row=>row.ticket_number)})
 }
 return json({period:{start,end},items:selected,alerts,summary:{total:selected.length,human:selected.filter(row=>['human','mixed'].includes(String(row.cause))).length,external:selected.filter(row=>['system','other_external'].includes(String(row.cause))).length,pending:selected.filter(row=>row.status!=='verified').length,excluded:selected.filter(row=>row.excluded).length}})
})}
