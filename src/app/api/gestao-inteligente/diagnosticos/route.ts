import { after } from 'next/server'
import { authorizeCx, cxBody } from '@/lib/cx360-server'
import { ApiError, adminClient, handle, json } from '@/lib/integration-server'
import { d1, scopeDates, type DiagnosticRow, type Evidence } from '@/lib/cx360-diagnostics'
import { configured, syncCx, processCx, readAllCx, evidenceForCase } from '@/lib/cx360-diagnostics-server'
import { isUuid } from '@/lib/cx360'

export const runtime='nodejs'
export const maxDuration=300
export async function GET(request:Request){return handle(async()=>{
  const {client}=await authorizeCx(request),params=new URL(request.url).searchParams
  if(params.has('id')){
    if([...params.keys()].some(k=>k!=='id') || params.getAll('id').length!==1)throw new ApiError(400,'Consulta inválida.')
    const id=params.get('id')||''
    if(id.length>150)throw new ApiError(400,'Identificador inválido.')
    const [row,reviews]=await Promise.all([client.from('cx360_ratings').select('*').eq('id',id).eq('active',true).lte('rated_day',d1()).maybeSingle(),client.from('cx360_reviews').select('id,analysis_hash,decision,notes,created_at').eq('rating_id',id).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(30)])
    if(row.error||reviews.error)throw new ApiError(503,'Histórico indisponível.')
    if(!row.data)throw new ApiError(404,'Avaliação não encontrada na fonte atual.')
    return json({row:row.data,reviews:reviews.data})
  }
  for(const key of params.keys())if(!['start','end','team_id'].includes(key)||params.getAll(key).length!==1)throw new ApiError(400,'Filtro inválido.')
  let scope;try{scope=scopeDates(params.get('start'),params.get('end'))}catch(error){throw new ApiError(400,(error as Error).message)}
  const team=params.get('team_id')||null;if(team&&!isUuid(team))throw new ApiError(400,'Equipe inválida.')
  const [rows,sources,sync]=await Promise.all([readAllCx(client,scope.start,scope.end,team),client.from('cx360_sources').select('*').order('display_name'),client.from('cx360_sync_runs').select('*').lte('start_date',scope.start).gte('end_date',scope.end).order('created_at',{ascending:false}).limit(1)])
  if(sources.error||sync.error)throw new ApiError(503,'Cobertura da fonte indisponível.')
  const eligible=rows.filter(r=>r.eligible)
  return json({scope,configured:configured(),sources:sources.data,rows:eligible,excluded:rows.length-eligible.length,total:rows.length,coverage:{eligible:eligible.length,analyzed:eligible.filter(r=>r.status==='analyzed').length,inconclusive:eligible.filter(r=>r.status==='inconclusive').length,pending:eligible.filter(r=>['pending','processing'].includes(r.status)).length,failed:eligible.filter(r=>r.status==='failed').length,validated:eligible.filter(r=>r.review_decision==='confirmed').length,rejected:eligible.filter(r=>r.review_decision==='rejected').length},sync:sync.data?.[0]??null,policy_note:'Políticas internas não documentadas neste módulo. Sugestões dependem de validação da gestão.'})
})}
export async function POST(request:Request){return handle(async()=>{
  const {client,userId}=await authorizeCx(request),body=await cxBody(request)
  if(['sync','process','retry'].includes(String(body.action))){
    if(!configured())throw new ApiError(503,'Configure a integração ClickDesk e o provedor de análise no servidor antes de processar.')
    let scope;try{scope=scopeDates(body.start,body.end)}catch(error){throw new ApiError(400,(error as Error).message)}
    const team=typeof body.team_id==='string'&&body.team_id?body.team_id:null;if(team&&!isUuid(team))throw new ApiError(400,'Equipe inválida.')
    if(body.action==='sync'){
      const result=await syncCx(scope.start,scope.end,userId)
      after(async()=>{try{await processCx(scope.start,scope.end,team)}catch{console.warn('CX360 worker: cycle unavailable')}})
      return json({...result,accepted:true},202)
    }
    if(body.action==='retry'){
      let query=adminClient().from('cx360_ratings').update({status:'pending',attempts:0,error_code:null,next_attempt_at:new Date().toISOString()}).eq('status','failed').eq('active',true).eq('eligible',true).gte('rated_day',scope.start).lte('rated_day',scope.end)
      if(team)query=query.eq('team_id',team)
      const reset=await query;if(reset.error)throw new ApiError(503,'Não foi possível retomar os casos com erro.')
    }
    after(async()=>{try{await processCx(scope.start,scope.end,team)}catch{console.warn('CX360 worker: cycle unavailable')}})
    return json({accepted:true,scope},202)
  }
  if(!['review','case'].includes(String(body.action))||typeof body.id!=='string'||typeof body.analysis_hash!=='string')throw new ApiError(400,'Ação inválida.')
  const result=await client.from('cx360_ratings').select('*').eq('id',body.id).eq('active',true).eq('eligible',true).lte('rated_day',d1()).maybeSingle()
  const row=result.data as DiagnosticRow|null
  if(result.error)throw new ApiError(503,'Diagnóstico indisponível.')
  if(!row||!row.analysis||!row.analysis_hash||row.analysis_hash!==body.analysis_hash)throw new ApiError(409,'A análise mudou ou está pendente. Atualize e confira as evidências.')
  if(body.action==='review'){
    if(!['confirmed','rejected'].includes(String(body.decision))||typeof body.notes!=='string'||body.notes.trim().length<10||body.notes.length>3000)throw new ApiError(400,'Informe a decisão e uma justificativa de pelo menos 10 caracteres.')
    const saved=await adminClient().from('cx360_reviews').insert({rating_id:row.id,analysis_hash:row.analysis_hash,decision:body.decision,notes:body.notes.trim(),reviewed_by:userId})
    if(saved.error)throw new ApiError(503,'Validação não registrada.')
    return json({saved:true})
  }
  if(body.confirm!==true)throw new ApiError(400,'Confirme a conferência das evidências para iniciar a investigação.')
  const latest=await client.from('cx360_reviews').select('decision').eq('rating_id',row.id).eq('analysis_hash',row.analysis_hash).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(1)
  if(latest.error)throw new ApiError(503,'Não foi possível conferir a validação deste diagnóstico.')
  if(latest.data?.[0]?.decision==='rejected')throw new ApiError(409,'Esta leitura foi rejeitada. Confira as evidências para uma nova validação ou registre uma investigação manual.')
  const record=await client.from('cx360_cases').insert({ticket_source:'clickdesk',ticket_id:row.ticket_id,team_id:row.team_id,title:`Revisar experiência — ClickDesk #${row.number}`,observation:row.analysis.observation,evidence:evidenceForCase(row,row.evidence as Evidence[],row.analysis),hypothesis:row.analysis.hypothesis,impact:row.analysis.impact,owner_id:userId,diagnostic_id:row.id,diagnostic_hash:row.analysis_hash}).select('id').single()
  if(record.error)throw new ApiError(record.error.code==='23505'?409:422,record.error.code==='23505'?'Este chamado já tem um acompanhamento. Consulte a aba Acompanhamentos.':'Não foi possível iniciar o acompanhamento.')
  return json({case_id:record.data.id},201)
})}
