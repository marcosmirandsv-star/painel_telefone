'use client'
import { chatTimeRange, type ChatTimeMode } from '@/lib/chat-time-filter'

type Props={
  month:string
  mode:ChatTimeMode
  reference:string
  onChange:(mode:ChatTimeMode,reference:string)=>void
  dailyAvailable?:boolean
}

const options: Array<{value:ChatTimeMode;label:string}> = [
  {value:'month',label:'Mês'},
  {value:'week',label:'Semana'},
  {value:'day',label:'Dia'},
  {value:'custom',label:'Personalizado'},
]
const displayDate=(value:string)=>value.split('-').reverse().join('/')

export default function ChatTimeFilter({month,mode,reference,onChange,dailyAvailable=true}:Props) {
  const range=chatTimeRange(month,mode,reference)
  const monthRange=chatTimeRange(month,'month',reference)
  const supportsPeriod=month>='2026-10'
  const noClosedDays=range.end<range.start
  const latest=monthRange.end
  const referenceDay=reference.includes('/')?reference.split('/')[1]:reference
  const dayValue=referenceDay>=month+'-01'&&referenceDay<=latest?referenceDay:latest

  function selectMode(next:ChatTimeMode) {
    if(next!=='month'&&!supportsPeriod)return
    onChange(next,next==='custom'?month+'-01/'+latest:dayValue)
  }

  return <section className="chat-period-picker" aria-label="Selecionar intervalo dos indicadores">
    <div className="chat-period-header">
      <div>
        <span className="chat-period-eyebrow">Período de análise</span>
        <p className="chat-period-caption" role="status">
          {noClosedDays?'Esta competência ainda não começou.':
            `${displayDate(range.start)} a ${displayDate(range.end)}`}
          {!noClosedDays&&range.end===monthRange.end&&range.end===new Intl.DateTimeFormat('en-CA',{
            timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit',
          }).format(new Date())&&<span className="chat-period-current">Hoje em andamento</span>}
        </p>
      </div>
      <div className="chat-period-actions">
        <div className="chat-period-tabs" role="group" aria-label="Tipo de intervalo">
          {options.map(item=>(
            <button type="button" key={item.value} disabled={noClosedDays||(item.value!=='month'&&!supportsPeriod)}
              aria-pressed={mode===item.value} className={mode===item.value?'chat-period-tab chat-period-tab-selected':'chat-period-tab'}
              onClick={()=>selectMode(item.value)}>{item.label}</button>
          ))}
        </div>
        {(mode==='day'||mode==='week')&&(
          <label className="chat-period-date-control">
            <span>{mode==='week'?'Semana que contém':'Data'}</span>
            <input className="form-input" type="date" value={dayValue} min={month+'-01'} max={latest}
              onChange={event=>{
                if(event.currentTarget.validity.valid&&event.currentTarget.value)
                  onChange(mode,event.currentTarget.value)
              }}/>
          </label>
        )}
      </div>
    </div>
    {mode==='custom'&&supportsPeriod&&(
      <div className="chat-period-custom">
        <label><span>De</span><input className="form-input" type="date" value={range.start}
          min={month+'-01'} max={range.end} onChange={event=>{
            if(event.currentTarget.validity.valid&&event.currentTarget.value)
              onChange(mode,event.currentTarget.value+'/'+range.end)
          }}/></label>
        <label><span>Até</span><input className="form-input" type="date" value={range.end}
          min={range.start} max={latest} onChange={event=>{
            if(event.currentTarget.validity.valid&&event.currentTarget.value)
              onChange(mode,range.start+'/'+event.currentTarget.value)
          }}/></label>
      </div>
    )}
    {!supportsPeriod&&<p className="chat-period-helper">
      Os meses anteriores a outubro de 2026 têm apenas histórico mensal. Para comparar essas competências,
      consulte a seção de evolução histórica.
    </p>}
    {supportsPeriod&&mode!=='month'&&!dailyAvailable&&<p className="chat-period-helper">
      A captura oficial do intervalo será consultada ao ClickDesk. Se ainda estiver em preparação,
      os números deste recorte aparecerão após a conclusão, sem estimativas.
    </p>}
    {mode==='week'&&<p className="chat-period-helper">Semana de segunda a domingo, limitada à competência selecionada.</p>}
  </section>
}
