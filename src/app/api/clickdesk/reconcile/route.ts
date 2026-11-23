import {isChatProductionEnabled} from '@/lib/chat-production-gate'
import { randomUUID } from 'node:crypto'
import { isCxCron } from '@/lib/cx360-diagnostics-server'
import { ApiError, authorizeClickDeskSessionClient, handle, json } from '@/lib/chat-integration-server'
import { productionReadAdmin, readTicketHistory } from '@/lib/clickdesk-final-owner-server'
import { finalHumanTicket, object, text, type FinalTicket, type Person } from '@/lib/clickdesk-final-owner'

export const runtime = 'nodejs'
export const maxDuration = 300

const CLICKDESK_BASE = 'https://api.desk.click.app/api/v1'
const MAX_BATCH = 12
type Candidate = { ticket_id: string; version: string }
type Row = FinalTicket & { source_version: string; conversation_version: string | null }

async function sourceCandidates(cursor: string, limit: number, period: string | null) {
  const {data,error}=await productionReadAdmin().rpc('clickdesk_reconcile_candidate_page',{
    p_cursor:cursor,p_limit:limit,p_period:period,
  })
  if(error || !Array.isArray(data))throw new ApiError(503,'Não foi possível consultar candidatos de reconciliação.')
  const page=data as Candidate[]
  if(page.length>limit+1 || page.some(row=>typeof row.ticket_id!=='string'||typeof row.version!=='string')) {
    throw new ApiError(503,'Página de candidatos inválida.')
  }
  return {selection:page.slice(0,limit),hasMore:page.length>limit}
}

async function sourceCoverage(period: string | null) {
  const {data,error}=await productionReadAdmin().rpc('clickdesk_reconcile_candidate_coverage',{p_period:period})
  const row=Array.isArray(data)?data[0]:null
  if(error || !row)throw new ApiError(503,'Falha ao consultar cobertura de candidatos.')
  const counts=[row.candidate_count,row.confirmed_count,row.pending_count].map(Number)
  if(counts.some(n=>!Number.isSafeInteger(n)||n<0)||counts[1]+counts[2]>counts[0]) {
    throw new ApiError(503,'Contagem de candidatos inválida.')
  }
  return {candidate_count:counts[0],confirmed_count:counts[1],pending_count:counts[2]}
}

async function safeGet(path: string, key: string, account: string, deadline: number): Promise<unknown> {
  const remaining = deadline - Date.now()
  if (remaining <= 0) throw new Error('audit_deadline')
  const response = await fetch(CLICKDESK_BASE + path, {
    method: 'GET',
    headers: { Authorization:'Bearer ' + key, 'X-Account-Id':account, Accept:'application/json' },
    cache:'no-store',
    signal:AbortSignal.timeout(Math.min(12000,remaining)),
  })
  if (!response.ok) throw new Error('clickdesk_http_' + response.status)
  return response.json()
}

async function evaluateBatch(
  candidates: Candidate[], people: Person[], key: string, account: string,
): Promise<Row[]> {
  const deadline = Date.now() + 150000
  const results: Row[] = new Array(candidates.length)
  let cursor = 0
  await Promise.all(Array.from({length:4},async() => {
    while(cursor < candidates.length) {
      const index=cursor++
      const candidate=candidates[index]
      try {
        const evidence=await readTicketHistory(candidate.ticket_id,path=>safeGet(path,key,account,deadline))
        const row=finalHumanTicket(candidate.ticket_id,evidence.messages,evidence.events,evidence.ticket,people,evidence.complete)
        // finalHumanTicket is the existing rule for complete public human evidence.
        // Keep a fail-closed transport assertion without adding attribution rules.
        const ownPublicPresent=evidence.messages.some(m=>text(object(m).id)===row.message_id)
        const checked=row.confirmed && (!evidence.complete || !ownPublicPresent)
          ? finalHumanTicket(candidate.ticket_id,[],[],{},people,false) : row
        const updated=Date.parse(text(evidence.ticket.updated_at))
        results[index]={...checked,source_version:candidate.version,
          conversation_version:Number.isFinite(updated)?new Date(updated).toISOString():null}

      } catch(error) {
        const reason=error instanceof Error && (/^clickdesk_http_\d+$/.test(error.message) || error.message==='audit_deadline')
          ? error.message : 'history_read_failed'
        results[index]={
          ticket_id:candidate.ticket_id,analyst_id:null,analyst_name:null,team_id:null,
          occurred_at:null,occurred_date:null,area:null,message_id:null,satisfaction_label:null,
          confirmed:false,reason,rating_timestamp_warning:false,source_version:candidate.version,conversation_version:null,
        }
      }
    }
  }))
  return results
}

async function officialPOST(request: Request) {
  const traceId=randomUUID(), started=Date.now()
  let stage='authorization'
  const response=await handle(async()=>{
    if (!isChatProductionEnabled()) {
      throw new ApiError(404,'Reconciliação disponível somente na homologação.')
    }
    const internal=isCxCron(request)
    let body: Record<string,unknown>
    try { const input:unknown=await request.json(); body=input && typeof input==='object' && !Array.isArray(input)
      ? input as Record<string,unknown> : {} }
    catch { throw new ApiError(400,'Envie JSON de reconciliação.') }
    if (Object.keys(body).some(key=>!['cursor','limit','dry_run','period'].includes(key))) {
      throw new ApiError(400,'Parâmetro de reconciliação inválido.')
    }
    const dryRun=body.dry_run !== false
    if (typeof body.dry_run !== 'undefined' && typeof body.dry_run !== 'boolean') {
      throw new ApiError(400,'dry_run deve ser booleano.')
    }
    // Feature previews NÃO podem alterar a base compartilhada da homologação.
    if (!dryRun && process.env.VERCEL_GIT_COMMIT_REF !== 'main') {
      throw new ApiError(403,'Gravação disponível apenas na branch homologacao publicada.')
    }
    const limit=body.limit===undefined ? 6 : Number(body.limit)
    if (!Number.isInteger(limit)||limit<1||limit>MAX_BATCH)throw new ApiError(400,'limit deve ser 1 a 12.')
    const cursor=typeof body.cursor==='string' ? body.cursor : ''
    if (cursor.length>80 || (body.cursor!==undefined && typeof body.cursor!=='string')) {
      throw new ApiError(400,'Cursor inválido.')
    }
    const period=body.period===undefined ? null : body.period
    if(period!==null && (typeof period!=='string'||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(period))) {
      throw new ApiError(400,'Período inválido; use AAAA-MM.')
    }
    if(internal) {
      if(period!=='2026-11')throw new ApiError(403,'Agendamento restrito ao inventário de Novembro de 2026.')
    } else {
      const access=await authorizeClickDeskSessionClient(request)
      if(!access.isManagement || access.role!=='master')throw new ApiError(403,'Reconciliação exclusiva do Master.')
    }
    const apiKey=process.env.CLICKDESK_API_KEY?.trim(), account=process.env.CLICKDESK_ACCOUNT_ID?.trim()
    if (!apiKey||!account)throw new ApiError(503,'Credenciais de leitura ClickDesk indisponíveis.')
    stage='candidate_discovery'
    const {selection,hasMore}=await sourceCandidates(cursor,limit,period as string|null)
    const admin=productionReadAdmin()
    const roster=await admin.from('chat_analysts').select('id,name,team_id,csat_goal,active')
    if(roster.error)throw new ApiError(503,'Cadastro de analistas indisponível.')
    const people:Person[]=(roster.data??[]).filter(p=>p.active===true).map(p=>({
      id:p.id,name:p.name,team_id:p.team_id,csat_goal:Number(p.csat_goal),
    }))
    stage='ticket_history'
    const evaluated=await evaluateBatch(selection,people,apiKey,account)
    if(!dryRun) {
      stage='version_verification'
      // A current detail read immediately before the write prevents crediting a
      // conversation that changed while its messages/events were being read.
      const deadline=Date.now()+45000
      let index=0
      await Promise.all(Array.from({length:4},async()=>{
        while(index<evaluated.length) {
          const row=evaluated[index++]
          if(!row.confirmed)continue
          let reason:string|null=null
          if(!row.conversation_version)reason='history_version_missing'
          else try {
            const raw=object(await safeGet('/tickets/'+encodeURIComponent(row.ticket_id),apiKey,account,deadline))
            const latest=object(raw.ticket||raw.data||raw)
            const updated=Date.parse(text(latest.updated_at))
            if(text(latest.id)!==row.ticket_id || !Number.isFinite(updated))reason='history_version_missing'
            else if(new Date(updated).toISOString()!==row.conversation_version)reason='history_changed_since_read'
          } catch { reason='history_version_check_failed' }
          if(reason) {
            const pending=finalHumanTicket(row.ticket_id,[],[],{},people,false)
            Object.assign(row,pending,{reason})
          }
        }
      }))
    }
    const confirmed=evaluated.filter(row=>row.confirmed)
    const pending=evaluated.filter(row=>!row.confirmed)
    stage='validation'
    if(confirmed.some(row=>!row.analyst_id||!row.team_id||!row.message_id||!row.occurred_at||!row.occurred_date)) {
      throw new ApiError(422,'Evidência confirmada sem identidade ou mensagem; lote rejeitado.')
    }
    if(!dryRun && selection.length) {
      stage='persist_ledger'
      const confirmedRows=confirmed.map(row=>({
        ticket_id:row.ticket_id,analyst_id:row.analyst_id,team_id:row.team_id,
        last_public_message_id:row.message_id,last_public_at:row.occurred_at,
        occurred_date:row.occurred_date,area:row.area,satisfaction_label:row.satisfaction_label,
        rating_timestamp_warning:row.rating_timestamp_warning,
        evidence_source:'clickdesk_incremental',
        evidence_version:row.source_version,
        verified_at:new Date().toISOString(),updated_at:new Date().toISOString(),
      }))
      if(confirmedRows.length) {
        const write=await admin.from('clickdesk_final_ticket_ledger').upsert(confirmedRows,{onConflict:'ticket_id'})
        if(write.error)throw new ApiError(503,'Falha ao atualizar ledger da homologação.')
      }
      // Pendência prevalece sobre crédito anterior até comprovação da autoria final.
      if(pending.length) {
        const saved=await admin.from('clickdesk_final_ticket_pending').upsert(pending.map(row=>({
          ticket_id:row.ticket_id,reason:row.reason||'history_incomplete',
          evidence_source:'clickdesk_incremental',checked_at:new Date().toISOString(),
        })),{onConflict:'ticket_id'})
        if(saved.error)throw new ApiError(503,'Falha ao registrar pendências da homologação.')
      }
      if(confirmed.length) {
        const clean=await admin.from('clickdesk_final_ticket_pending').delete().in('ticket_id',confirmed.map(r=>r.ticket_id))
        if(clean.error)throw new ApiError(503,'Falha ao liberar pendências anteriormente confirmadas.')
      }
      stage='persist_coverage'
      const coverage=await sourceCoverage(period as string|null)
      const coverageWrite=await admin.from('clickdesk_final_coverage').upsert({
        source_key:period ? 'inventory_reconcile:'+period : 'captured_candidates_reconcile',
        start_date:period ? period+'-01' : '2026-09-01',end_date:new Date().toISOString().slice(0,10),
        ...coverage,
        completeness:'partial',
        verified_at:new Date().toISOString(),
      },{onConflict:'source_key'})
      if(coverageWrite.error)throw new ApiError(503,'Falha ao atualizar cobertura de candidatos.')
    }
    const coverage=await sourceCoverage(period as string|null)
    stage='completed'
    return json({
      trace_id:traceId,mode:dryRun?'dry_run':'persisted_homologation',
      source:period?'period_inventory_candidates':'stored_candidates_only',period,candidate_universe:coverage.candidate_count,
      examined:selection.length,confirmed:confirmed.length,pending:pending.length,
      pending_reasons:pending.reduce<Record<string,number>>((acc,row)=>{
        const reason=row.reason??'unspecified';acc[reason]=(acc[reason]??0)+1;return acc
      },{}),
      next_cursor:selection.at(-1)?.ticket_id??null,
      has_more:hasMore,
      completeness:'partial',
      note:'Um ticket e um último autor humano público confirmado. Não prova descoberta exaustiva do ClickDesk. Nenhum conteúdo de cliente foi retornado.',
    })
  })
  console.info('clickdesk_reconcile_batch',JSON.stringify({
    trace_id:traceId,status:response.status,stage,duration_ms:Date.now()-started,
  }))
  return response
}

export async function POST(request:Request){if(!isChatProductionEnabled())return Response.json({erro:'Chat oficial ainda não habilitado.'},{status:404});return officialPOST(request)}
