'use client'

import {useEffect,useState,type ReactNode} from 'react'
import {supabase} from '@/lib/supabase'

type Item={ticket_id:string;ticket_number:string;rated_at:string;sentiment:string;original_label:string;can_analyze:boolean}
type Data={items:Item[];totals:{total:number;positive:number;negative:number}}

export default function AnalystReviews({start,end,analystId,onAnalyze,loadingTicketId,renderAnalysis}:{
  start:string;end:string;analystId:string;onAnalyze:(id:string)=>void;loadingTicketId:string;renderAnalysis:(id:string)=>ReactNode
}) {
  const [data,setData]=useState<Data|null>(null),[error,setError]=useState(''),[filter,setFilter]=useState('all')
  const [page,setPage]=useState(0),[open,setOpen]=useState<string|null>(null),[conversation,setConversation]=useState(''),[opening,setOpening]=useState(false)
  const [retry,setRetry]=useState(0)
  useEffect(()=>{
    let cancelled=false
    void (async()=>{
      try {
        const {data:{session}}=await supabase.auth.getSession()
        if(!session)throw new Error('Sua sessão expirou. Entre novamente.')
        const params=new URLSearchParams({start,end,analyst_id:analystId})
        const response=await fetch('/api/clickdesk/my-reviews?'+params,{headers:{Authorization:'Bearer '+session.access_token},cache:'no-store'})
        const result=await response.json()
        if(!response.ok)throw new Error(result.erro||result.error||'Não foi possível carregar suas avaliações.')
        if(!cancelled)setData(result)
      }catch(error){if(!cancelled)setError(error instanceof Error?error.message:'Consulta indisponível.')}
    })()
    return()=>{cancelled=true}
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
  return <section className="panel" aria-label="Minhas avaliações">
    <h3 className="text-xl font-bold">Minhas avaliações</h3>
    <p className="mt-1 text-sm text-slate-400">Boas e ruins do período selecionado. Abra uma conversa ou peça uma análise da IA.</p>
    {error?<div role="status" className="mt-4 text-sm text-amber-100">{error} <button type="button" className="small-button" onClick={()=>{setData(null);setError('');setRetry(value=>value+1)}}>Tentar novamente</button></div>:!data?<p role="status" className="mt-4 text-sm text-slate-400">Carregando avaliações...</p>:<>
      <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Filtrar avaliações">
        {[['all','Todas',data.totals.total],['positive','Boas',data.totals.positive],['negative','Ruins',data.totals.negative]].map(([value,label,count])=><button key={value} type="button" aria-pressed={filter===value} onClick={()=>{setFilter(String(value));setPage(0);setOpen(null)}} className={`rounded-lg border px-4 py-2 text-sm ${filter===value?'border-cyan-300/50 bg-cyan-300/10 text-cyan-100':'border-white/10 text-slate-300'}`}>{label} <strong>{count}</strong></button>)}
      </div>
      <p className="mt-2 text-xs text-slate-500">Ruins incluem neutros. A nota original permanece aqui mesmo quando há ajuste no CSAT.</p>
      {!filtered.length?<p className="mt-4 text-sm text-slate-400">Nenhuma avaliação neste filtro.</p>:<div className="mt-4 space-y-3">{filtered.slice(page*20,page*20+20).map(item=><div key={item.ticket_id} className="rounded-lg border border-white/10 bg-slate-950/35 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><strong>#{item.ticket_number}</strong><span className={`ml-3 text-xs ${item.sentiment==='positive'?'text-emerald-200':'text-amber-100'}`}>{item.sentiment==='positive'?'Boa':'Ruim'} · {item.original_label}</span><p className="mt-1 text-xs text-slate-500">{new Date(item.rated_at).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})}</p></div>
        <div className="flex flex-wrap gap-2"><button type="button" className="small-button" aria-expanded={open===item.ticket_id} onClick={()=>{setConversation('');setOpening(true);setOpen(value=>value===item.ticket_id?null:item.ticket_id)}}>{open===item.ticket_id?'Fechar conversa':'Abrir ticket'}</button><button type="button" className="small-button" disabled={!item.can_analyze||Boolean(loadingTicketId)} onClick={()=>onAnalyze(item.ticket_id)}>{loadingTicketId===item.ticket_id?'Analisando...':'Analisar com IA'}</button></div></div>
        {!item.can_analyze&&<p className="mt-2 text-xs text-slate-500">A análise aguarda a conferência de autoria deste ticket.</p>}
        {open===item.ticket_id&&<div className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-950/60 p-3 text-sm text-slate-300" role="region" aria-label={'Conversa do ticket '+item.ticket_number}>{opening?'Carregando conversa...':conversation}</div>}
        {renderAnalysis(item.ticket_id)}
      </div>)}</div>}
      {filtered.length>20&&<div className="mt-4 flex items-center gap-3 text-sm"><button type="button" className="small-button" disabled={page===0} onClick={()=>setPage(value=>value-1)}>Anterior</button><span>Página {page+1} de {Math.ceil(filtered.length/20)}</span><button type="button" className="small-button" disabled={(page+1)*20>=filtered.length} onClick={()=>setPage(value=>value+1)}>Próxima</button></div>}
    </>}
  </section>
}
