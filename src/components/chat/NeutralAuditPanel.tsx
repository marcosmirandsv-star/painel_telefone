'use client'

import {useEffect,useMemo,useState} from 'react'
import {supabase} from '@/lib/supabase'

type Case = {
 ticket_id:string; ticket_number:string; analyst_id:string; analyst_name:string; team_name?:string; date:string;
 cause:string; status:string; excluded:boolean; explanation:string;
 evidence:string[]; reviewed_at?:string|null;
}
type ResponseData = {
 items:Case[];
 summary:{total:number;human:number;external:number;pending:number;excluded:number};
 alerts:Array<{kind:string;message:string;tickets:string[]}>;
}
const causeLabels:Record<string,string>={
 human:'Condução humana comprovada',
 mixed:'Causa mista',
 system:'Falha de sistema comprovada',
 other_external:'Outro fator externo comprovado',
 inconclusive:'Não comprovada',
}
const day=(value:string)=>value.slice(0,10).split('-').reverse().join('/')
const decision=(item:Case)=>item.status==='verified'
 ? (item.excluded?'Excluído somente do CSAT ajustado':'Mantido no CSAT')
 : 'Mantido no CSAT · análise pendente'

export default function NeutralAuditPanel({
 start,end,teamId,
}:{start:string;end:string;teamId?:string|null}) {
 const [data,setData]=useState<ResponseData|null>(null)
 const [error,setError]=useState('')
 const [loading,setLoading]=useState(true)
 const [refresh,setRefresh]=useState(0)
 const [search,setSearch]=useState('')
 const [filter,setFilter]=useState<'all'|'pending'|'verified'>('all')
 const [page,setPage]=useState(0)
 const [openTranscript,setOpenTranscript]=useState<string|null>(null)
 const [transcript,setTranscript]=useState('')
 const [transcriptError,setTranscriptError]=useState('')
 const [transcriptLoading,setTranscriptLoading]=useState(false)
 async function toggleTranscript(item:Case) {
  if(openTranscript===item.ticket_id){setOpenTranscript(null);return}
  setOpenTranscript(item.ticket_id)
  setTranscript('')
  setTranscriptError('')
  setTranscriptLoading(true)
  try {
   const {data:{session}}=await supabase.auth.getSession()
   if(!session)throw Error('Sua sessão expirou. Entre novamente.')
   const query=new URLSearchParams({
    start,end,analyst_id:item.analyst_id,ticket_id:item.ticket_id
   })
   const response=await fetch('/api/clickdesk/my-reviews?'+query.toString(),{
    cache:'no-store',headers:{Authorization:'Bearer '+session.access_token}
   })
   const body=await response.json()
   if(!response.ok)throw Error(body.erro||body.error||'Conversa indisponível.')
   setTranscript(String(body.transcript||'Conversa não disponível na fonte.'))
  }catch(cause){
   setTranscriptError(cause instanceof Error?cause.message:'Não foi possível abrir a conversa.')
  }finally{setTranscriptLoading(false)}
 }
 useEffect(()=>{
  let active=true
  const controller=new AbortController()
  setData(null);setError('');setLoading(true);setPage(0);setOpenTranscript(null);setTranscript('');setTranscriptError('')
  void(async()=>{
   try {
    const {data:{session}}=await supabase.auth.getSession()
    if(!session)throw Error('Sessão expirada. Entre novamente.')
    const query=new URLSearchParams({start,end})
    if(teamId)query.set('team_id',teamId)
    const response=await fetch('/api/clickdesk/neutral-reviews?'+query.toString(),{
     headers:{Authorization:'Bearer '+session.access_token},
     signal:controller.signal,cache:'no-store'
    })
    const body=await response.json()
    if(!response.ok)throw Error(body.erro||body.error||'Consulta indisponível.')
    if(active)setData(body as ResponseData)
   }catch(cause) {
    if(active)setError(cause instanceof Error?cause.message:'Erro ao consultar os tickets.')
   }finally {
    if(active)setLoading(false)
   }
  })()
  return()=>{active=false;controller.abort()}
 },[start,end,teamId,refresh])
 const items=useMemo(()=>(data?.items??[]).filter(item=>{
  if(filter==='pending'&&item.status==='verified')return false
  if(filter==='verified'&&item.status!=='verified')return false
  const term=search.trim().toLocaleLowerCase('pt-BR')
  return !term||[item.ticket_id,item.ticket_number,item.analyst_name]
   .some(value=>value.toLocaleLowerCase('pt-BR').includes(term))
 }),[data,search,filter])
 const reviewed=data?data.summary.total-data.summary.pending:0
 return <div className="space-y-5">
  <section className="rounded-2xl border border-cyan-300/20 bg-slate-950/35 p-5">
   <div className="flex flex-wrap items-start justify-between gap-4">
    <div>
     <p className="text-xs font-bold uppercase tracking-[0.14em] text-teal-200">Auditoria da qualidade · ClickDesk</p>
     <h2 className="mt-2 text-xl font-bold text-slate-100">Análise de avaliações neutras</h2>
     <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
      Identifique os tickets nota 3 de {day(start)} até {day(end)}, confira
      a autoria, o estado da análise e as evidências. Uma nota neutra não prova falha
      humana nem autoriza exclusão automática do CSAT.
     </p>
    </div>
    <button type="button" className="small-button" disabled={loading}
     onClick={()=>setRefresh(value=>value+1)}>{loading?'Consultando...':'Atualizar auditoria'}</button>
   </div>
   <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
    {[
     {label:'Tickets nota 3',value:data?.summary.total,desc:'Origem oficial do ClickDesk'},
     {label:'Pareceres verificados',value:data?reviewed:null,desc:'Com conclusão registrada'},
     {label:'Aguardando revisão',value:data?.summary.pending,desc:'Sem exclusão autorizada'},
     {label:'Exclusões comprovadas',value:data?.summary.excluded,desc:'Somente no CSAT ajustado'},
    ].map(card=><div key={card.label} className="rounded-xl border border-white/10 bg-slate-900/60 p-4">
     <span className="text-xs text-slate-400">{card.label}</span>
     <strong className="mt-2 block text-2xl font-bold tabular-nums text-slate-100">{card.value==null?'—':card.value.toLocaleString('pt-BR')}</strong>
     <span className="mt-1 block text-xs text-slate-500">{card.desc}</span>
    </div>)}
   </div>
   {data&&data.summary.pending>0&&<p role="status"
    className="mt-4 rounded-lg border border-amber-300/20 bg-amber-300/5 p-3 text-sm leading-6 text-amber-100">
    {data.summary.pending} ticket(s) identificado(s), mas ainda sem parecer verificado.
    Não é possível atribuir causa ou retirar avaliações do CSAT com base apenas na nota.
   </p>}
  </section>
  <details open className="rounded-xl border border-white/10 bg-slate-950/25 p-4">
   <summary className="cursor-pointer font-semibold text-cyan-100">Critérios da análise e regras de decisão</summary>
   <div className="mt-4 grid gap-3 md:grid-cols-2">
    {[
     ['1. Autoria e histórico','Confirmar o último atendente humano, data, transferências e etapas anteriores com a IA.'],
     ['2. Qualidade de CX','Avaliar acolhimento, entendimento, clareza, diligência, continuidade, esforço do cliente e encerramento.'],
     ['3. Desfecho e responsabilidade','Identificar o resultado comprovado e separar falhas humanas, problemas de sistema, causas mistas e fatores externos.'],
     ['4. Evidência e orientação','Citar o que a conversa realmente mostra, declarar os limites e propor uma melhoria prática para o analista e a gestão.'],
    ].map(([title,description])=><div key={title} className="rounded-lg border border-white/10 bg-slate-900/50 p-3">
     <strong className="text-sm text-slate-100">{title}</strong>
     <p className="mt-2 text-xs leading-6 text-slate-400">{description}</p>
    </div>)}
   </div>
   <p className="mt-4 text-sm leading-6 text-slate-300">
    <strong>Regra do CSAT:</strong> falha humana ou causa mista mantém a nota no cálculo.
    Fator externo comprovado, sem falha humana atribuível, pode sair apenas do CSAT
    ajustado. Inconclusivo permanece até a confirmação. A nota original continua registrada
    e conta na quantidade de avaliações recebidas.
   </p>
   <p className="mt-2 text-xs leading-6 text-amber-100">
    A falta de prova de erro do analista não comprova uma causa externa.
    Nenhuma ação desta tela altera o CSAT ou aprova automaticamente um parecer.
   </p>
  </details>
  {data?.alerts.map((alert,index)=><div role="status" key={index}
   className="rounded-lg border border-amber-300/20 bg-amber-300/5 p-3 text-sm text-amber-100">
   {alert.message}
  </div>)}
  {error&&<div role="alert" className="rounded-lg border border-rose-300/20 bg-rose-300/5 p-4 text-sm text-rose-100">
   {error} <button type="button" className="small-button ml-2" onClick={()=>setRefresh(value=>value+1)}>Tentar novamente</button>
  </div>}
  {loading&&!data&&<p role="status" className="rounded-lg border border-white/10 p-4 text-sm text-slate-400">Consultando a lista de tickets...</p>}
  {data&&<section className="rounded-xl border border-white/10 bg-slate-950/25 p-4">
   <div className="flex flex-wrap items-center justify-between gap-3">
    <div><h3 className="text-lg font-bold">Tickets e pareceres</h3>
     <p className="mt-1 text-xs text-slate-400">Abra um ticket para conferir a classificação, o motivo e as evidências disponíveis.</p>
    </div>
    <span className="text-sm font-semibold text-cyan-100">{items.length} de {data.items.length}</span>
   </div>
   <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_220px]">
    <label className="text-xs font-semibold text-slate-300">Buscar ticket ou responsável
     <input type="search" className="form-input mt-1 w-full" placeholder="Número ou nome"
      value={search} onChange={event=>{setSearch(event.target.value);setPage(0)}}/>
    </label>
    <label className="text-xs font-semibold text-slate-300">Situação
     <select className="form-input mt-1 w-full" value={filter}
      onChange={event=>{setFilter(event.target.value as 'all'|'pending'|'verified');setPage(0)}}>
      <option value="all">Todas</option>
      <option value="pending">Pendentes</option>
      <option value="verified">Verificadas</option>
     </select>
    </label>
   </div>
   <div className="mt-4 space-y-2">
    {items.slice(page*15,page*15+15).map(item=><details key={item.ticket_id}
     className="rounded-lg border border-white/10 bg-slate-900/40">
     <summary className="cursor-pointer p-3 text-sm">
      <span className="flex flex-wrap items-center justify-between gap-3">
       <span><strong className="text-slate-100">#{item.ticket_number}</strong>
        <span className="ml-2 text-slate-400">{day(item.date)} · {item.analyst_name}</span>
        {item.team_name&&<span className="ml-2 text-xs text-slate-500">· {item.team_name}</span>}</span>
       <span className={'rounded-full border px-2 py-1 text-xs '+
        (item.status==='verified'?'border-teal-300/25 text-teal-100':'border-amber-300/25 text-amber-100')}>
        {item.status==='verified'?'Parecer verificado':'Análise pendente'}
       </span>
      </span>
     </summary>
     <div className="space-y-3 border-t border-white/10 p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
       <div><span className="text-xs text-slate-500">Identificador de origem</span>
        <p className="font-mono text-slate-200">{item.ticket_id}</p></div>
       <button type="button" className="small-button"
        onClick={()=>void toggleTranscript(item)}>
        {openTranscript===item.ticket_id?'Fechar conversa':'Consultar conversa'}
       </button>
      </div>
      {openTranscript===item.ticket_id&&<div className="rounded-lg border border-white/10 bg-slate-950/60 p-3">
       <p className="mb-2 text-xs text-slate-400">Leitura textual sob permissão da gestão. Anexos não são exibidos aqui.</p>
       {transcriptLoading?<p role="status" className="text-sm text-slate-400">Carregando a conversa...</p>:
        transcriptError?<p role="alert" className="text-sm text-amber-100">{transcriptError}</p>:
        <pre className="max-h-[460px] overflow-auto whitespace-pre-wrap break-words font-sans text-xs leading-6 text-slate-300">{transcript}</pre>}
      </div>}
      <div><span className="text-xs text-slate-500">Causa identificada</span>
       <p className="text-slate-200">{item.status==='verified'
        ?causeLabels[item.cause]||'Causa verificada':'Ainda não existe causa comprovada'}</p></div>
      <div><span className="text-xs text-slate-500">Tratamento no CSAT</span>
       <p className="text-slate-200">{decision(item)}</p></div>
      {item.status==='verified'?<>
       <div><strong className="text-slate-100">Parecer registrado</strong>
        <p className="mt-1 leading-6 text-slate-300">{item.explanation}</p></div>
       <div><strong className="text-slate-100">Evidências</strong>
        {item.evidence.length?item.evidence.map((quote,index)=>
         <blockquote key={index} className="mt-2 border-l border-cyan-300/30 pl-3 text-xs leading-6 text-slate-300">{quote}</blockquote>):
         <p className="mt-1 text-amber-100">Não há trechos anexados ao parecer. A gestão deve conferir antes de utilizá-lo.</p>}
       </div>
      </>:<p className="rounded-lg border border-amber-300/15 bg-amber-300/5 p-3 text-xs leading-6 text-amber-100">
       Ticket identificado na avaliação oficial, mas ainda sem análise de CX concluída.
       Não há justificativa para exclusão automática do CSAT.
      </p>}
     </div>
    </details>)}
    {!items.length&&<p className="p-3 text-sm text-slate-400">Nenhum ticket encontrado neste filtro.</p>}
   </div>
   {items.length>15&&<div className="mt-4 flex items-center gap-3 text-sm">
    <button type="button" className="small-button" disabled={page===0}
     onClick={()=>setPage(v=>v-1)}>Anterior</button>
    <span>Página {page+1} de {Math.ceil(items.length/15)}</span>
    <button type="button" className="small-button" disabled={(page+1)*15>=items.length}
     onClick={()=>setPage(v=>v+1)}>Próxima</button>
   </div>}
  </section>}
 </div>
}
