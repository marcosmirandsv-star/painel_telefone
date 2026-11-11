'use client'
import { chatTimeRange, type ChatTimeMode } from '@/lib/chat-time-filter'
export default function ChatTimeFilter({month,mode,reference,onChange}:{month:string;mode:ChatTimeMode;reference:string;onChange:(mode:ChatTimeMode,reference:string)=>void}) {
 const range=chatTimeRange(month,mode,reference)
 const noClosedDays=range.end<range.start
 const max=chatTimeRange(month,'month',reference).end
 const value=reference>=month+'-01'&&reference<=max?reference:max
 const date=(s:string)=>s.split('-').reverse().join('/')
 return <fieldset disabled={noClosedDays} className="mt-4 rounded-lg border border-white/10 p-3"><legend className="px-1 text-sm font-semibold text-cyan-200">Intervalo dos indicadores</legend><div className="flex flex-wrap items-end gap-3">
 <label className="text-sm">Visualizar<select className="form-input mt-1" value={mode} onChange={e=>onChange(e.target.value as ChatTimeMode,value)}><option value="month">Mês</option><option value="week">Semana</option><option value="day">Dia</option></select></label>
 {mode!=='month'&&<label className="text-sm">{mode==='week'?'Data dentro da semana':'Dia do atendimento'}<input className="form-input mt-1" type="date" value={value} min={month+'-01'} max={max} onInput={e=>{if(e.currentTarget.validity.valid&&e.currentTarget.value)onChange(mode,e.currentTarget.value)}} onChange={e=>{if(e.currentTarget.validity.valid&&e.currentTarget.value)onChange(mode,e.currentTarget.value)}} /></label>}
 <p className="pb-2 text-sm text-slate-300" role="status">{noClosedDays?'Esta competência ainda não tem dias fechados.':`${date(range.start)} a ${date(range.end)} · até o último dia fechado`}</p></div>
 {mode==='week'&&<p className="mt-2 text-xs text-slate-400">Semana de segunda a domingo, limitada à competência selecionada e aos dias já fechados.</p>}</fieldset>
}
