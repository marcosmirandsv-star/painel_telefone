'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { readCxResponse, withCxDeadline } from '@/lib/cx360-client'
import { d1, factorLabels, serviceLabels, serviceVerdict, type DiagnosticRow, type Evidence } from '@/lib/cx360-diagnostics'

type Source={team_id:string;display_name:string;source_name:string}
type Review={id:string;analysis_hash:string;decision:string;notes:string;created_at:string}
type Detail={row:DiagnosticRow;reviews:Review[]}
type Payload={scope:{start:string;end:string;cutoff:string};configured:boolean;sources:Source[];rows:DiagnosticRow[];excluded:number;total:number;coverage:{eligible:number;analyzed:number;inconclusive:number;pending:number;failed:number;validated:number;rejected:number};sync:{status:string;created_at:string|null;composed?:boolean;captures?:number;missing_days?:string[]}|null;policy_note:string}
const box='rounded-xl border border-slate-700 bg-slate-900 p-4'
const input='mt-1 block w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-slate-100'
const button='rounded-lg bg-cyan-800 px-4 py-2 text-white disabled:opacity-50'
const date=(value:string)=>new Date(value).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})
const statusLabels:Record<string,string>={pending:'Pendente',processing:'Em análise',analyzed:'Analisado',inconclusive:'Conduta não avaliável',failed:'Erro · pode retomar'}

export default function CxDiagnostics({onCaseCreated}:{onCaseCreated:()=>void}){
 const [start,setStart]=useState(()=>d1().slice(0,8)+'01'),[end,setEnd]=useState(()=>d1()),[team,setTeam]=useState('')
 const [data,setData]=useState<Payload|null>(null),[detail,setDetail]=useState<Detail|null>(null)
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('Carregando a cobertura das avaliações…'),[state,setState]=useState('all')
 const [notes,setNotes]=useState(''),[confirm,setConfirm]=useState(false),[owner,setOwner]=useState('')
 const version=useRef(0),detailVersion=useRef(0),pollUntil=useRef(0)
 const api=useCallback(async(path:string,body?:unknown)=>{
   const {data:{session}}=await withCxDeadline(supabase.auth.getSession())
   if(!session)throw new Error('Sua sessão terminou. Entre novamente no painel.')
   const controller=new AbortController()
   return await withCxDeadline((async()=>readCxResponse(await fetch(`/api/gestao-inteligente/diagnosticos${path}`,{method:body?'POST':'GET',body:body?JSON.stringify(body):undefined,cache:'no-store',signal:controller.signal,headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`}})))(),body?180000:20000,()=>controller.abort())
 },[])
 const load=useCallback(async(showBusy=true)=>{
   const request=++version.current
   if(showBusy)setBusy(true)
   try{
    const query=new URLSearchParams({start,end,...(team?{team_id:team}:{})})
    const payload=await api(`?${query}`) as Payload
    if(request!==version.current)return
    setData(payload)
    if(showBusy)setMessage(payload.sync?.status==='complete'?'Fonte consultada. Confira a cobertura antes de interpretar os padrões.':'Este período ainda não tem uma sincronização completa. Use “Sincronizar e analisar”.')
   }catch(error){if(request===version.current)setMessage((error as Error).message)}finally{if(request===version.current&&showBusy)setBusy(false)}
 },[api,start,end,team])
 useEffect(()=>{
   const requests=version,details=detailVersion
   ++requests.current;++details.current
   const timer=setTimeout(()=>{setData(null);setDetail(null);setOwner('');void load()},0)
   return()=>{clearTimeout(timer);++requests.current;++details.current}
 },[load])
 useEffect(()=>{const timer=setInterval(()=>{if(Date.now()<pollUntil.current)void load(false)},10000);return()=>clearInterval(timer)},[load])
 async function work(action:string){
   setBusy(true);setMessage(action==='sync'?'Conferindo todas as páginas na fonte ClickDesk…':'Solicitando processamento dos casos pendentes…')
   try{
     await api('',{action,start,end,team_id:team||null});pollUntil.current=Date.now()+240000
     await load(false);setMessage('Solicitação aceita. A fila continua no servidor; a cobertura será atualizada nesta tela. Fechar a página não cancela o processamento.')
   }catch(error){setMessage((error as Error).message)}finally{setBusy(false)}
 }
 async function open(row:DiagnosticRow){
   const request=++detailVersion.current;setDetail(null);setNotes('');setConfirm(false);setMessage('Carregando histórico e evidências…')
   try{const result=await api(`?id=${encodeURIComponent(row.id)}`) as Detail;if(request===detailVersion.current){setDetail(result);setMessage('Leitura anterior à nota. Confira as evidências antes de validar ou iniciar uma ação.')}}catch(error){if(request===detailVersion.current)setMessage((error as Error).message)}
 }
 async function review(decision:string){
   if(!detail)return;setBusy(true)
   try{await api('',{action:'review',id:detail.row.id,analysis_hash:detail.row.analysis_hash,decision,notes});await open(detail.row);await load(false);setMessage('Validação registrada com autor e versão da análise. Os indicadores oficiais não foram alterados.')}catch(error){setMessage((error as Error).message)}finally{setBusy(false)}
 }
 async function createCase(){
   if(!detail)return;setBusy(true)
   try{await api('',{action:'case',id:detail.row.id,analysis_hash:detail.row.analysis_hash,confirm});setMessage('Investigação iniciada com referência e evidências do diagnóstico.');onCaseCreated()}catch(error){setMessage((error as Error).message)}finally{setBusy(false)}
 }
 const rows=(data?.rows??[]).filter(r=>(!owner||r.owner_name===owner)&&(state==='all'||(state==='pending'?['pending','processing'].includes(r.status):r.status===state)))
 const assessed=(data?.rows??[]).filter(r=>r.analysis&&r.review_decision!=='rejected')
 const unknownCause=assessed.filter(r=>r.analysis?.factor==='inconclusivo').length
 const causeReviewAlert=assessed.length>=10&&unknownCause/assessed.length>=0.25
 const analysis=detail?.row.analysis
 const latestReview=detail?.reviews.find(r=>r.analysis_hash===detail.row.analysis_hash)
 const evidence=detail?.row.evidence??[]
 return <section className="space-y-5" aria-label="Análise dos atendimentos">
  <div className={box}><h2 className="text-2xl font-semibold">Análise 360º dos atendimentos</h2><p className="mt-2 text-slate-300">Avaliações negativas do ClickDesk, incluindo Neutro. Resultados até D-1. A análise propõe melhorias e precisa de validação da gestão.</p><p className="mt-2 text-sm text-amber-100">Sem conclusão automática sobre culpa ou desempenho individual. Critérios internos ainda não documentados neste módulo.</p></div>
  <form onSubmit={event=>{event.preventDefault();void load()}} className={`${box} flex flex-wrap items-end gap-3`}><fieldset disabled={busy} className="contents">
   <label>De<input className={input} type="date" value={start} max={d1()} onChange={e=>setStart(e.target.value)} required/></label>
   <label>Até D-1<input className={input} type="date" value={end} max={d1()} onChange={e=>setEnd(e.target.value)} required/></label>
   <label>Equipe da análise<select className={input} value={team} onChange={e=>setTeam(e.target.value)}><option value="">ERP e Fiscal</option>{data?.sources.map(s=><option key={s.team_id} value={s.team_id}>{s.display_name}</option>)}</select></label>
   <button className={button}>Atualizar cobertura</button>
  </fieldset></form>
  <p role="status" aria-live="polite" className={box}>{message}</p>
  {data&&<>
   <div className={box}><h3 className="text-lg font-semibold">Cobertura do período {data.scope.start} a {data.scope.end}</h3><div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">{[['No recorte aprovado',data.coverage.eligible],['Analisados',data.coverage.analyzed],['Conduta não avaliável',data.coverage.inconclusive],['Pendentes / em análise',data.coverage.pending],['Com erro',data.coverage.failed]].map(([label,value])=><div key={label} className="rounded-lg bg-slate-800 p-3"><strong className="block text-2xl">{value}</strong><span className="text-sm text-slate-300">{label}</span></div>)}</div>
    <p className="mt-3 text-sm text-slate-300">{data.total} avaliações negativas de suporte importadas neste recorte; {data.excluded} fora do quadro individual aprovado, incluindo aprendizes, IA e sem responsável. Excluídos não entram nos padrões individuais.</p>
    <p className="mt-2 text-sm">{data.sync?.status==='complete'&&data.sync.created_at?`Cobertura por ${data.sync.captures??1} captura(s) completa(s). A mais antiga usada foi realizada em ${date(data.sync.created_at)}.`:'Nenhuma cobertura completa encontrada. Ausência de registros não significa ausência de avaliações negativas.'}</p>
    <p className="mt-2 text-sm text-cyan-200">Revisão da gestão: {data.coverage.validated??0} leituras validadas e {data.coverage.rejected??0} rejeitadas na versão atual. Leituras rejeitadas não entram nos padrões abaixo.</p>
    <div className="mt-4 flex flex-wrap gap-3"><button disabled={busy||!data.configured} className={button} onClick={()=>void work('sync')}>Sincronizar e analisar</button><button disabled={busy||!data.configured||!data.coverage.pending} className={button} onClick={()=>void work('process')}>Continuar pendentes</button><button disabled={busy||!data.configured||!data.coverage.failed} className={button} onClick={()=>void work('retry')}>Retomar casos com erro</button></div>
    {!data.configured&&<p className="mt-3 text-amber-100">A integração requer configuração segura no servidor antes da primeira sincronização.</p>}
   </div>
   <div className={box}><h3 className="text-lg font-semibold">Duas leituras independentes</h3><p className="mt-2 text-sm text-slate-300">Conduta não avaliável: faltam evidências para avaliar o atendimento humano. Motivo desconhecido: o atendimento pode ser avaliado, mas a causa da nota não foi demonstrada.</p><p className="mt-2">Motivo da nota desconhecido: <strong>{unknownCause} de {assessed.length}</strong> leituras disponíveis, sem incluir rejeitadas.</p>{causeReviewAlert&&<p role="status" className="mt-3 rounded-lg border border-amber-500/40 p-3 text-sm text-amber-100">Revisão recomendada: pelo menos 25% das causas permanecem desconhecidas em uma amostra de dez ou mais leituras. Confira histórico, transferências, anexos e possíveis condutas recorrentes. Este alerta não comprova falha humana.</p>}</div>
   <div className={box}><h3 className="text-lg font-semibold">Padrões observados nas análises disponíveis</h3><p className="mt-2 text-sm text-slate-300">Contagens de hipóteses da IA no recorte, sujeitas à revisão. Não equivalem a percentuais comprovados de causas das notas. A leitura é parcial enquanto houver pendentes ou erros.</p><ul className="mt-3 grid gap-2 sm:grid-cols-3">{Object.entries(factorLabels).map(([key,label])=><li key={key}>{label}: <strong>{data.rows.filter(r=>r.analysis?.factor===key&&r.review_decision!=='rejected').length}</strong></li>)}</ul></div>
   <div className={box}><div className="flex flex-wrap gap-3"><label>Estado da leitura<select className={input} value={state} onChange={e=>setState(e.target.value)}><option value="all">Todos</option><option value="analyzed">Analisados</option><option value="inconclusive">Conduta não avaliável</option><option value="pending">Pendentes / em análise</option><option value="failed">Com erro</option></select></label><label>Pessoa avaliada na fonte<select className={input} value={owner} onChange={e=>setOwner(e.target.value)}><option value="">Todas do quadro aprovado</option>{[...new Set(data.rows.map(r=>r.owner_name))].sort().map(name=><option key={name}>{name}</option>)}</select></label></div>
    <p className="my-3 text-sm text-slate-300">{rows.length} de {data.coverage.eligible} avaliações do quadro aprovado. A pessoa exibida é a avaliada na fonte; não prova autoria de todas as mensagens ou causa da nota.</p>
    <div className="max-h-[560px] space-y-2 overflow-auto">{rows.map(row=><button key={row.id} disabled={busy} onClick={()=>void open(row)} className="block w-full rounded-lg border border-slate-600 p-3 text-left hover:border-cyan-500"><strong>#{row.number} · {row.subject}</strong><span className="mt-1 block text-sm text-slate-300">{row.owner_name} · {row.source_team} · {date(row.rated_at)} · {row.label}</span><span className="mt-1 block text-sm text-cyan-200">{statusLabels[row.status]}{row.analysis?` · ${serviceVerdict(row.analysis)} · Motivo da nota: ${factorLabels[row.analysis.factor]}`:''}</span></button>)}{!rows.length&&<p>Nenhuma avaliação exibida neste filtro. Confira a sincronização e a cobertura acima.</p>}</div>
   </div>
  </>}
  {detail&&<article className={`${box} space-y-4`} aria-label="Leitura do atendimento">
   <header><h3 className="text-xl font-semibold">#{detail.row.number} · {detail.row.subject}</h3><p className="mt-2 text-sm text-slate-300">Avaliado em {date(detail.row.rated_at)} · {statusLabels[detail.row.status]}. Histórico limitado às mensagens anteriores ao minuto da nota.</p></header>
   {analysis?<>
    <section className="space-y-3"><h4 className="font-semibold text-cyan-200">Avaliação do atendimento humano</h4><p>{serviceVerdict(analysis)}</p><p className="text-sm text-slate-300">O motivo da nota pode permanecer desconhecido mesmo quando a conduta pode ser avaliada. Boas práticas sujeitas à validação da gestão.</p>{analysis.service_assessment?.map(c=><div key={c.criterion} className="rounded-lg bg-slate-800 p-3"><strong>{serviceLabels[c.criterion]} · {({adequado:'Adequado',melhoria:'Oportunidade de melhoria',falha:'Falha demonstrada',nao_observavel:'Não observável'})[c.result]}</strong><p className="mt-1">{c.finding}</p>{evidence.filter(e=>c.evidence_ids.includes(e.id)).map(e=><blockquote key={e.id} className="mt-2 border-l-2 border-cyan-700 pl-3 text-sm"><p>Mensagem {e.id} · {date(e.at)} · {e.author||e.role}</p><p>{e.text}</p></blockquote>)}</div>)}</section>
    <p className="text-cyan-200">Hipótese sobre o motivo da nota: {factorLabels[analysis.factor]} · sustentação {analysis.confidence}</p>
    <dl className="grid gap-4 md:grid-cols-2">{[['Fato observado',analysis.observation],['Hipótese da avaliação',analysis.hypothesis],['Impacto na experiência',analysis.impact],['Condução humana observada',analysis.behavior],['Prática para manter ou desenvolver',analysis.practice],['Exemplo de comunicação',analysis.suggested_phrase],['Como conferir nos próximos atendimentos',analysis.verification]].map(([title,text])=><div key={title}><dt className="font-semibold text-cyan-200">{title}</dt><dd className="mt-1 whitespace-pre-wrap text-slate-200">{text}</dd></div>)}</dl>
    <p className="text-sm text-slate-300"><strong>Falha humana sustentada nas mensagens: </strong>{analysis.human_gap || 'Não demonstrada pelas referências citadas. Uma sugestão de melhoria não comprova causa humana da nota.'}</p>
    <h4 className="font-semibold">Mensagens que sustentam a leitura</h4>{evidence.filter(e=>analysis.evidence_ids.includes(e.id)).map(e=><blockquote key={e.id} className="rounded-lg border-l-4 border-cyan-700 bg-slate-800 p-3"><p className="text-xs text-slate-300">Mensagem {e.id} · {date(e.at)} · {e.role}{e.author ? ` · ${e.author}` : ''}</p><p className="mt-2 whitespace-pre-wrap">{e.text}</p></blockquote>)}
    <div><h4 className="font-semibold text-amber-100">Limites desta conclusão</h4><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-300">{analysis.limitations.map((v,i)=><li key={i}>{v}</li>)}</ul></div>
    <section className="space-y-3 border-t border-slate-700 pt-4"><h4 className="font-semibold">Validação da gestão</h4>{latestReview&&<p className="text-sm text-cyan-200">Versão atual: {latestReview.decision==='confirmed'?'validada':'rejeitada'} em {date(latestReview.created_at)}. Justificativa: {latestReview.notes}</p>}<label className="block">Justificativa da revisão<textarea className={input} rows={3} minLength={10} maxLength={3000} value={notes} onChange={e=>setNotes(e.target.value)}/></label><div className="flex flex-wrap gap-3"><button className={button} disabled={busy||notes.trim().length<10} onClick={()=>void review('confirmed')}>Validar esta leitura</button><button className={button} disabled={busy||notes.trim().length<10} onClick={()=>void review('rejected')}>Rejeitar esta leitura</button></div>
     <label className="block text-sm"><input type="checkbox" checked={confirm} onChange={e=>setConfirm(e.target.checked)}/> Conferi as evidências e quero iniciar uma investigação. A ação de melhoria ainda dependerá de aprovação.</label>{latestReview?.decision==='rejected'&&<p className="text-sm text-amber-100">Esta leitura foi rejeitada. Revise as evidências antes de confirmar uma nova validação ou registre uma investigação manual.</p>}<button className={button} disabled={busy||!confirm||latestReview?.decision==='rejected'} onClick={()=>void createCase()}>Iniciar acompanhamento deste achado</button>
    </section>
   </>:<p className="text-amber-100">{detail.row.status==='failed'?'A leitura não foi concluída. Retome o caso na cobertura do período.':detail.row.status==='inconclusive'?'Evidência insuficiente para análise. Não há conclusão atribuível ao analista.':'Esta avaliação ainda está na fila de leitura. Não há conclusão publicada.'}</p>}
   <details><summary className="cursor-pointer font-semibold">Histórico anterior à nota ({evidence.length} mensagens)</summary><ol className="mt-3 max-h-[600px] space-y-3 overflow-auto">{evidence.map((e:Evidence)=><li key={e.id} className="rounded-lg bg-slate-800 p-3"><p className="text-xs text-slate-300">{date(e.at)} · {e.role}{e.author ? ` · ${e.author}` : ''} · mensagem {e.id}</p><p className="mt-2 whitespace-pre-wrap text-sm">{e.text}</p>{e.attachments>0&&<p className="mt-2 text-xs text-amber-100">{e.attachments} anexo(s) não inspecionado(s).</p>}</li>)}</ol></details>
   {!!detail.reviews.length&&<details><summary className="cursor-pointer">Histórico das validações ({detail.reviews.length})</summary><ul className="mt-3 space-y-2">{detail.reviews.map(r=><li key={r.id} className="rounded-lg bg-slate-800 p-3 text-sm">{date(r.created_at)} · {r.decision==='confirmed'?'Validada':'Rejeitada'}{r.analysis_hash!==detail.row.analysis_hash?' · versão anterior':''}<p>{r.notes}</p></li>)}</ul></details>}
  </article>}
 </section>
}
