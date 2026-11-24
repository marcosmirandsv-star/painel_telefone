'use client'

import {useEffect,useState,type ReactNode} from 'react'
import {supabase} from '@/lib/supabase'
import {qualitativeReviewReadiness} from '@/lib/qualitative-display'

type Item={ticket_id:string;ticket_number:string;rated_at:string;sentiment:string;original_label:string;can_analyze:boolean;analysis_available?:boolean;analysis_status?:string}
type Data={items:Item[];totals:{total:number;positive:number;negative:number}}

export default function AnalystReviews({start,end,analystId,onAnalyze,loadingTicketId,renderAnalysis}:{
  start:string;end:string;analystId:string;onAnalyze:(id:string)=>void;loadingTicketId:string;renderAnalysis:(id:string)=>ReactNode
}) {
  const [data,setData]=useState<Data|null>(null),[error,setError]=useState(''),[filter,setFilter]=useState('all')
  const [page,setPage]=useState(0),[open,setOpen]=useState<string|null>(null),[conversation,setConversation]=useState(''),[opening,setOpening]=useState(false)
  const [retry,setRetry]=useState(0)
  const [pendingCapture,setPendingCapture]=useState(false)
  const [expanded,setExpanded]=useState(false)
  const contentId='analyst-reviewed-tickets-'+analystId
  useEffect(()=>{
    let cancelled=false
    let timer:ReturnType<typeof setTimeout>|undefined
    // Never display a previous interval's reviews under the newly selected dates.
    setData(null)
    setError('')
    setPendingCapture(false)
    setPage(0)
    setOpen(null)
    setConversation('')
    async function load(attempt=0){
      try {
        const {data:{session}}=await supabase.auth.getSession()
        if(!session)throw new Error('Sua sessão expirou. Entre novamente.')
        const params=new URLSearchParams({start,end,analyst_id:analystId})
        const response=await fetch('/api/clickdesk/my-reviews?'+params,{headers:{Authorization:'Bearer '+session.access_token},cache:'no-store'})
        const result=await response.json()
        if(cancelled)return
        if(!response.ok){
          const reason=String(result.erro||result.error||'Não foi possível carregar suas avaliações.')
          if(response.status===503&&/avaliações deste intervalo ainda estão em preparação/i.test(reason)&&attempt<12){
            setPendingCapture(true)
            timer=setTimeout(()=>{if(!cancelled)void load(attempt+1)},15000)
            return
          }
          throw new Error(reason)
        }
        setPendingCapture(false)
        setError('')
        setData(result)
      }catch(error){
        if(!cancelled){setPendingCapture(false);setError(error instanceof Error?error.message:'Consulta indisponível.')}
      }
    }
    void load()
    return()=>{cancelled=true;if(timer)clearTimeout(timer)}
  },[start,end,analystId,retry])

  // An obsolete conversation request cannot display text under a new period or ticket.
  useEffect(()=>{
    if(!open)return
    let cancelled=false
    void(async()=>{
      try {
        const {data:{session}}=await supabase.auth.getSession()
        if(!session)throw new Error('Sua sessão expirou.')
        const params=new URLSearchParams({start,end,analyst_id:analystId,ticket_id:open})
        const response=await fetch('/api/clickdesk/my-reviews?'+params,{headers:{Authorization:'Bearer '+session.access_token},cache:'no-store'})
        const result=await response.json()
        if(!response.ok)throw new Error(result.erro||result.error||'Conversa indisponível.')
        if(!cancelled)setConversation(result.transcript)
      }catch(error){if(!cancelled)setConversation(error instanceof Error?error.message:'Conversa indisponível.')}
      finally{if(!cancelled)setOpening(false)}
    })()
    return()=>{cancelled=true}
  },[open,start,end,analystId])

  const filtered=(data?.items??[]).filter(item=>filter==='all'||item.sentiment===filter)
  const readiness=qualitativeReviewReadiness(data?.items??[])
  return <section className="panel" aria-label="Minhas avaliações">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="text-xl font-bold">Minhas avaliações</h3>
      <div className="flex flex-wrap gap-2"><button type="button" className="small-button" onClick={()=>setRetry(value=>value+1)}>Atualizar leituras</button><button type="button" className="small-button" aria-expanded={expanded} aria-controls={contentId} onClick={()=>setExpanded(value=>!value)}>{expanded?'Recolher tickets':'Expandir tickets avaliados'}</button></div>
    </div>
    <p className="mt-1 text-sm text-slate-400">Boas e ruins do período selecionado. Abra a conversa ou consulte uma leitura da Visão 360º já disponível.</p>
    {pendingCapture&&<p className="mt-2 text-sm text-amber-200" role="status">O ClickDesk está preparando as avaliações do período selecionado. A lista será atualizada automaticamente.</p>}
    {data&&<p className="mt-2 text-sm text-slate-300">{data.totals.total} avaliações · {data.totals.positive} boas · {data.totals.negative} ruins</p>}
    {data&&<p className="mt-2 text-sm text-slate-400" role="status">Visão 360º: {readiness.available} leituras disponíveis · {readiness.awaitingAuthorship} aguardando conferência de autoria · {readiness.awaitingAnalysis} com autoria conferida, aguardando leitura. A ausência de uma tarefa na fila não significa que todas as avaliações foram analisadas.</p>}
    {!expanded&&error&&<p role="status" className="mt-2 text-sm text-amber-100">Não foi possível carregar as avaliações. Expanda para tentar novamente.</p>}
    <div id={contentId} hidden={!expanded}>
    {error?<div role="status" className="mt-4 text-sm text-amber-100">{error} <button type="button" className="small-button" onClick={()=>{setData(null);setError('');setRetry(value=>value+1)}}>Tentar novamente</button></div>:!data?<p role="status" className="mt-4 text-sm text-slate-400">Carregando avaliações...</p>:<>
      <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Filtrar avaliações">
        {[['all','Todas',data.totals.total],['positive','Boas',data.totals.positive],['negative','Ruins',data.totals.negative]].map(([value,label,count])=><button key={value} type="button" aria-pressed={filter===value} onClick={()=>{setFilter(String(value));setPage(0);setOpen(null)}} className={`rounded-lg border px-4 py-2 text-sm ${filter===value?'border-cyan-300/50 bg-cyan-300/10 text-cyan-100':'border-white/10 text-slate-300'}`}>{label} <strong>{count}</strong></button>)}
      </div>
      <p className="mt-2 text-xs text-slate-500">Ruins incluem neutros. A nota original permanece aqui mesmo quando há ajuste no CSAT.</p>
      {!filtered.length?<p className="mt-4 text-sm text-slate-400">Nenhuma avaliação neste filtro.</p>:<div className="mt-4 space-y-3">{filtered.slice(page*20,page*20+20).map(item=><div key={item.ticket_id} className="rounded-lg border border-white/10 bg-slate-950/35 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><strong>#{item.ticket_number}</strong><span className={`ml-3 text-xs ${item.sentiment==='positive'?'text-emerald-200':'text-amber-100'}`}>{item.sentiment==='positive'?'Boa':'Ruim'} · {item.original_label}</span><p className="mt-1 text-xs text-slate-500">{new Date(item.rated_at).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})}</p></div>
        <div className="flex flex-wrap gap-2"><button type="button" className="small-button" aria-expanded={open===item.ticket_id} onClick={()=>{setConversation('');setOpening(true);setOpen(value=>value===item.ticket_id?null:item.ticket_id)}}>{open===item.ticket_id?'Fechar conversa':'Abrir ticket'}</button><button type="button" className="small-button" disabled={!item.can_analyze||!item.analysis_available||Boolean(loadingTicketId)} onClick={()=>onAnalyze(item.ticket_id)}>{loadingTicketId===item.ticket_id?'Carregando leitura...':'Abrir leitura 360º'}</button></div></div>
        {!item.can_analyze&&<p className="mt-2 text-xs text-slate-500">A análise aguarda a conferência de autoria deste ticket.</p>}
        {item.can_analyze&&!item.analysis_available&&<p className="mt-2 text-xs text-slate-500">Autoria conferida; leitura ainda não disponível. Este estado não confirma que a análise esteja na fila. Abrir esta lista não inicia uma nova análise.</p>}
        {item.analysis_available&&<p className="mt-2 text-xs text-slate-400">{item.analysis_status==='approved'?'Selecionada pela gestão para feedback.':'Leitura preliminar, ainda não selecionada pela gestão para feedback.'}</p>}
        {open===item.ticket_id&&<div className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-950/60 p-3 text-sm text-slate-300" role="region" aria-label={'Conversa do ticket '+item.ticket_number}>{opening?'Carregando conversa...':conversation}</div>}
        {renderAnalysis(item.ticket_id) && <div className="mt-3"><button type="button" className="small-button" onClick={()=>onAnalyze(item.ticket_id)}>Fechar análise</button>{renderAnalysis(item.ticket_id)}</div>}
      </div>)}</div>}
      {filtered.length>20&&<div className="mt-4 flex items-center gap-3 text-sm"><button type="button" className="small-button" disabled={page===0} onClick={()=>setPage(value=>value-1)}>Anterior</button><span>Página {page+1} de {Math.ceil(filtered.length/20)}</span><button type="button" className="small-button" disabled={(page+1)*20>=filtered.length} onClick={()=>setPage(value=>value+1)}>Próxima</button></div>}
    </>}
    </div>
  </section>
}
