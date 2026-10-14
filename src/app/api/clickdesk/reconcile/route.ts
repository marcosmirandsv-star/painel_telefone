import { randomUUID } from 'node:crypto'
import { ApiError, authorizeClickDeskSessionClient, handle, json } from '@/lib/integration-server'
import { getServerSupabaseConfig } from '@/lib/runtime-environment'
import { homologationReadAdmin, readTicketHistory } from '@/lib/clickdesk-final-owner-server'
import { finalHumanTicket, type FinalTicket, type Person } from '@/lib/clickdesk-final-owner'

export const runtime = 'nodejs'
export const maxDuration = 300

const CLICKDESK_BASE = 'https://api.desk.click.app/api/v1'
const MAX_BATCH = 12
const MAX_SOURCE_ROWS = 20000

type Candidate = { ticket_id: string; version: string }
type Row = FinalTicket & { source_version: string }

async function sourceCandidates() {
  const admin = homologationReadAdmin()
  const candidates = new Map<string, Candidate>()
  for (const [table, idColumn, versionColumn] of [
    ['clickdesk_chat_attendances', 'clickdesk_ticket_id', 'updated_at'],
    ['clickdesk_chat_verified_contributions', 'ticket_id', 'verified_at'],
    // Descoberta mais ampla da rotina corrente. Done significa processado, não humano confirmado.
    ['clickdesk_chat_capture_queue', 'ticket_id', 'source_updated_at'],
  ] as const) {
    for (let offset = 0; offset < MAX_SOURCE_ROWS; offset += 500) {
      const { data, error } = await admin.from(table)
        .select(idColumn + ',' + versionColumn)
        .order(idColumn, { ascending: true })
        .range(offset, offset + 499)
      if (error) throw new ApiError(503, 'Não foi possível consultar candidatos de reconciliação.')
      const page = data ?? []
      for (const item of page as unknown as Record<string, unknown>[]) {
        const id = String(item[idColumn] ?? '').trim()
        const version = String(item[versionColumn] ?? '')
        if (!id) continue
        const previous = candidates.get(id)
        if (!previous || previous.version < version) candidates.set(id, {ticket_id:id,version})
      }
      if (page.length < 500) break
      if (offset + 500 >= MAX_SOURCE_ROWS) throw new ApiError(422, 'Limite seguro de fonte excedido.')
    }
  }
  return [...candidates.values()].sort((a,b)=>a.ticket_id.localeCompare(b.ticket_id,'en'))
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
        results[index]={...row,source_version:candidate.version}
      } catch(error) {
        const reason=error instanceof Error && (/^clickdesk_http_\d+$/.test(error.message) || error.message==='audit_deadline')
          ? error.message : 'history_read_failed'
        results[index]={
          ticket_id:candidate.ticket_id,analyst_id:null,analyst_name:null,team_id:null,
          occurred_at:null,occurred_date:null,area:null,message_id:null,satisfaction_label:null,
          confirmed:false,reason,rating_timestamp_warning:false,source_version:candidate.version,
        }
      }
    }
  }))
  return results
}

export async function POST(request: Request) {
  const traceId=randomUUID(), started=Date.now()
  let stage='authorization'
  const response=await handle(async()=>{
    if (getServerSupabaseConfig().environment !== 'homologacao') {
      throw new ApiError(404,'Reconciliação disponível somente na homologação.')
    }
    const access=await authorizeClickDeskSessionClient(request)
    if (!access.isManagement || access.role !== 'master') {
      throw new ApiError(403,'Reconciliação exclusiva do Master.')
    }
    let body: Record<string,unknown>
    try { const input:unknown=await request.json(); body=input && typeof input==='object' && !Array.isArray(input)
      ? input as Record<string,unknown> : {} }
    catch { throw new ApiError(400,'Envie JSON de reconciliação.') }
    if (Object.keys(body).some(key=>!['cursor','limit','dry_run'].includes(key))) {
      throw new ApiError(400,'Parâmetro de reconciliação inválido.')
    }
    const dryRun=body.dry_run !== false
    if (typeof body.dry_run !== 'undefined' && typeof body.dry_run !== 'boolean') {
      throw new ApiError(400,'dry_run deve ser booleano.')
    }
    // Feature previews NÃO podem alterar a base compartilhada da homologação.
    if (!dryRun && process.env.VERCEL_GIT_COMMIT_REF !== 'homologacao') {
      throw new ApiError(403,'Gravação disponível apenas na branch homologacao publicada.')
    }
    const limit=body.limit===undefined ? 6 : Number(body.limit)
    if (!Number.isInteger(limit)||limit<1||limit>MAX_BATCH)throw new ApiError(400,'limit deve ser 1 a 12.')
    const cursor=typeof body.cursor==='string' ? body.cursor : ''
    if (cursor.length>80 || (body.cursor!==undefined && typeof body.cursor!=='string')) {
      throw new ApiError(400,'Cursor inválido.')
    }
    const apiKey=process.env.CLICKDESK_API_KEY?.trim(), account=process.env.CLICKDESK_ACCOUNT_ID?.trim()
    if (!apiKey||!account)throw new ApiError(503,'Credenciais de leitura ClickDesk indisponíveis.')
    stage='candidate_discovery'
    const all=await sourceCandidates()
    const selection=all.filter(item=>item.ticket_id.localeCompare(cursor,'en')>0).slice(0,limit)
    const admin=homologationReadAdmin()
    const roster=await admin.from('chat_analysts').select('id,name,team_id,csat_goal')
    if(roster.error)throw new ApiError(503,'Cadastro de analistas indisponível.')
    const people:Person[]=(roster.data??[]).map(p=>({
      id:p.id,name:p.name,team_id:p.team_id,csat_goal:Number(p.csat_goal),
    }))
    stage='ticket_history'
    const evaluated=await evaluateBatch(selection,people,apiKey,account)
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
      const [ledgerTotal,pendingTotal]=await Promise.all([
        admin.from('clickdesk_final_ticket_ledger').select('ticket_id',{count:'exact',head:true}),
        admin.from('clickdesk_final_ticket_pending').select('ticket_id',{count:'exact',head:true}),
      ])
      if(ledgerTotal.error||pendingTotal.error)throw new ApiError(503,'Falha ao atualizar cobertura.')
      const coverageWrite=await admin.from('clickdesk_final_coverage').upsert({
        source_key:'captured_candidates_reconcile',
        start_date:'2026-09-01',end_date:new Date().toISOString().slice(0,10),
        candidate_count:all.length,
        confirmed_count:Math.min(ledgerTotal.count??0,all.length),
        pending_count:Math.min(pendingTotal.count??0,Math.max(0,all.length-(ledgerTotal.count??0))),
        completeness:'partial',
        verified_at:new Date().toISOString(),
      },{onConflict:'source_key'})
      if(coverageWrite.error)throw new ApiError(503,'Falha ao atualizar cobertura de candidatos.')
    }
    stage='completed'
    return json({
      trace_id:traceId,mode:dryRun?'dry_run':'persisted_homologation',
      source:'stored_candidates_only',candidate_universe:all.length,
      examined:selection.length,confirmed:confirmed.length,pending:pending.length,
      pending_reasons:pending.reduce<Record<string,number>>((acc,row)=>{
        const reason=row.reason??'unspecified';acc[reason]=(acc[reason]??0)+1;return acc
      },{}),
      next_cursor:selection.at(-1)?.ticket_id??null,
      has_more:Boolean(selection.length && all.some(item=>item.ticket_id.localeCompare(selection.at(-1)!.ticket_id,'en')>0)),
      completeness:'partial',
      note:'Um ticket e um último autor humano público confirmado. Não prova descoberta exaustiva do ClickDesk. Nenhum conteúdo de cliente foi retornado.',
    })
  })
  console.info('clickdesk_reconcile_batch',JSON.stringify({
    trace_id:traceId,status:response.status,stage,duration_ms:Date.now()-started,
  }))
  return response
}
