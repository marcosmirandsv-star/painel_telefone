'use client'
import {useEffect,useState} from 'react'
import {supabase} from '@/lib/supabase'
type Result={summary:{total:number;human:number;external:number;pending:number;excluded:number};alerts:Array<{kind:string;message:string;tickets:string[]}>;items:Array<{ticket_id:string;ticket_number:string;analyst_name:string;date:string;cause:string;status:string;excluded:boolean;explanation:string;evidence:string[]}>}
const labels:Record<string,string>={human:'Atendimento humano',mixed:'Humano e outros fatores',system:'Sistema',other_external:'Outro fator externo',inconclusive:'Em revisão'}
export default function ChatNeutralReviews({start,end,analystId,teamId}:{start:string;end:string;analystId?:string|null;teamId?:string|null}){
 const [refresh,setRefresh]=useState(0)
 useEffect(()=>{const timer=window.setInterval(()=>setRefresh(value=>value+1),30*60*1000);return()=>window.clearInterval(timer)},[])
 const [data,setData]=useState<Result|null>(null),[error,setError]=useState('')
 useEffect(()=>{
  let active=true;const controller=new AbortController()
  setData(null);setError('')
  void(async()=>{try{
   const session=await supabase.auth.getSession();if(!session.data.session)throw Error('Sessão indisponível.')
   const params=new URLSearchParams({start,end});if(analystId)params.set('analyst_id',analystId);if(teamId)params.set('team_id',teamId)
   const response=await fetch('/api/clickdesk/neutral-reviews?'+params,{headers:{Authorization:'Bearer '+session.data.session.access_token},signal:controller.signal})
   const result=await response.json();if(!response.ok)throw Error(result.error||result.erro||'Revisão indisponível.')
   if(active)setData(result)
  }catch(reason){if(active)setError(reason instanceof Error?reason.message:'Revisão indisponível.')}})()
  return()=>{active=false;controller.abort()}
 },[start,end,analystId,teamId,refresh])
 return <div className="mt-3 text-sm">
  {data?.alerts.map((alert,index)=><p key={index} role="status" className="mb-2 rounded-lg border border-amber-300/20 bg-amber-300/5 p-3 text-amber-100">{alert.message} {alert.tickets.length>0&&<span className="text-xs">Tickets: {alert.tickets.map(ticket=>'#'+ticket).join(', ')}</span>}</p>)}
  <details className="rounded-lg border border-white/10 p-3"><summary className="cursor-pointer text-slate-300">{data?`Neutros: ${data.summary.human} humanos/mistos · ${data.summary.external} externos · ${data.summary.pending} em revisão`:'Conferir avaliações neutras'}</summary>
   <p className="mt-3 text-xs leading-5 text-slate-400">Falha humana ou causa mista permanece negativa. Fator externo comprovado sai apenas do CSAT ajustado e continua nas avaliações recebidas. Casos em revisão não geram exclusão automática.</p>
   {error&&<p role="status" className="mt-3 text-amber-200">{error}</p>}
   {!data&&!error&&<p className="mt-3 text-slate-400">Consultando revisões...</p>}
   {data?.items.map(item=><details key={item.ticket_id} className="mt-3 border-t border-white/10 pt-3"><summary className="cursor-pointer text-slate-200">#{item.ticket_number} · {item.analyst_name} · {labels[item.cause]??'Em revisão'}{item.excluded?' · excluído do CSAT ajustado':''}</summary><p className="mt-2 text-slate-400">{item.explanation}</p>{item.evidence.map((quote,index)=><blockquote key={index} className="mt-2 border-l border-cyan-300/30 pl-3 text-xs text-slate-400">{quote}</blockquote>)}</details>)}
   {data?.summary.total===0&&<p className="mt-3 text-slate-400">Nenhuma avaliação identificada como neutra neste recorte.</p>}
  </details>
 </div>
}
