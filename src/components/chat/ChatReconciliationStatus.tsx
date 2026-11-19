'use client'
import {useEffect,useState} from 'react'
import {supabase} from '@/lib/supabase'

type Finding={ticket_id:number;ticket_number:number;channel:string;delta:number;events:{id:string;field:string;old:string|null;new:string|null;actor:string|null;created_at:string}[]}
type Row={job_id:string;status:string;updated_at:string;recovered_by_job_id:string|null;result:{reason?:string;original_group?:number;original_individual_sum?:number;current_unique_ids?:number;fresh_group?:number;findings?:Finding[]}}
const date=(value:string)=>new Date(value).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})
export default function ChatReconciliationStatus({start,end}:{start:string;end:string}){
 const [loaded,setLoaded]=useState<{period:string;row:Row|null;failed:boolean}|null>(null)
 const period=start+':'+end
 const enabled=process.env.NEXT_PUBLIC_CHAT_OFFICIAL_ENABLED==='true'
 useEffect(()=>{
  if(!enabled)return
  let alive=true,timer:ReturnType<typeof setTimeout>|undefined
  async function load(){
   try{
    const response=await supabase.from('clickdesk_capture_investigations').select('job_id,status,result,updated_at,recovered_by_job_id').eq('period_start',start).eq('period_end',end).order('created_at',{ascending:false}).limit(1).maybeSingle()
    if(!alive)return
    const row=response.error?null:response.data as Row|null
    setLoaded({period,row,failed:Boolean(response.error)})
    if(row&&['pending','running'].includes(row.status))timer=setTimeout(load,30000)
   }catch{if(alive)setLoaded({period,row:null,failed:true})}
  }
  void load()
  return()=>{alive=false;if(timer)clearTimeout(timer)}
 },[enabled,start,end,period])
 if(!enabled||loaded?.period!==period||(!loaded.failed&&!loaded.row))return null
 if(loaded.failed)return <p className="panel text-sm">Não foi possível consultar a investigação da captura. Os indicadores anteriores permanecem preservados.</p>
 const row=loaded.row!
 const pending=['pending','running'].includes(row.status)
 return <section className="panel" aria-live="polite">
  <h3 className="section-title">Conferência automática dos atendimentos</h3>
  <p className="mt-2 text-sm">{pending?'Existe uma diferença na captura. O sistema está buscando os IDs e o histórico dos tickets.':row.status==='explained'?'A diferença foi explicada por mudanças registradas durante a coleta.':'A busca terminou sem evidência suficiente para explicar toda a diferença.'}</p>
  <p className="mt-2 text-sm">{row.recovered_by_job_id?'Uma nova captura conciliada já atualizou os indicadores. A coleta anterior permanece preservada para investigação.':'A captura com diferença permanece bloqueada. Uma nova captura precisa passar por todas as conferências antes de atualizar os indicadores.'}</p>
  {typeof row.result.original_group==='number'&&<p className="mt-2 text-sm">Consulta coletiva: {row.result.original_group.toLocaleString('pt-BR')} · Soma individual: {row.result.original_individual_sum?.toLocaleString('pt-BR')} · IDs distintos na busca: {row.result.current_unique_ids?.toLocaleString('pt-BR')}</p>}
  {row.result.findings?.map(f=><details className="mt-3" key={f.ticket_id}>
   <summary>Atendimento #{f.ticket_number} · {f.channel} · diferença {f.delta>0?'+':''}{f.delta}</summary>
   <p className="mt-2 text-xs">ID técnico: {f.ticket_id}</p>
   <ul className="mt-2 space-y-1 text-sm">{f.events.map(e=><li key={e.id}>{date(e.created_at)} — {e.field==='owner'?'Responsável':e.field==='department'?'Fila':'Situação'}: {e.old??'sem atribuição'} → {e.new??'sem atribuição'}{e.actor?` (${e.actor})`:''}</li>)}</ul>
  </details>)}
  <p className="mt-3 text-xs">Última atualização: {date(row.updated_at)} (Brasília).</p>
 </section>
}
