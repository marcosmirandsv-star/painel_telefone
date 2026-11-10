'use client'
import { useState, type FormEvent } from 'react'
import { supabase } from '@/lib/supabase'
import type { sourceReportRows } from '@/lib/clickdesk-source-report'

type Report = { scope: { start: string; end: string; department_id: number }; rows: ReturnType<typeof sourceReportRows>; captured_at: string; note: string }
const pct = (n: number | null) => n === null ? '—' : `${n.toLocaleString('pt-BR')}%`
const duration = (n: number | null) => n === null ? '—' : n < 60 ? `${Math.round(n)}s` : `${Math.round(n / 60)}min`
export default function ClickDeskSourceReport({ start, end }: { start: string; end: string }) {
  const [from, setFrom] = useState(start), [to, setTo] = useState(end), [department, setDepartment] = useState('12')
  const [data, setData] = useState<Report | null>(null), [busy, setBusy] = useState(false), [message, setMessage] = useState('')
  async function load(event: FormEvent) {
    event.preventDefault(); setBusy(true); setData(null); setMessage('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Entre novamente no painel.')
      const params = new URLSearchParams({ start: from, end: to, department_id: department })
      const response = await fetch(`/api/clickdesk/source-report?${params}`, {
        headers: { Authorization: `Bearer ${session.access_token}` }, cache: 'no-store', signal: AbortSignal.timeout(30000),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.erro || 'Relatório indisponível.')
      setData(result)
    } catch (error) { setMessage((error as Error).message) } finally { setBusy(false) }
  }
  const clear = () => { setData(null); setMessage('') }
  return <details className="rounded-lg border border-cyan-300/20 p-4">
    <summary className="cursor-pointer font-semibold text-cyan-200">Conferir com o relatório de atendentes do ClickDesk</summary>
    <p className="mt-3 text-sm text-slate-300">Use a mesma fila e as mesmas datas da origem. Esta consulta é independente do filtro por time e não modifica seus indicadores.</p>
    <form onSubmit={load} className="mt-3"><fieldset disabled={busy} className="flex flex-wrap items-end gap-3">
      <label>Início da conferência<input type="date" className="form-input mt-1" value={from} required onChange={e => { clear(); setFrom(e.target.value) }} /></label>
      <label>Fim da conferência<input type="date" className="form-input mt-1" value={to} required onChange={e => { clear(); setTo(e.target.value) }} /></label>
      <label>Fila da conferência<select className="form-input mt-1" value={department} onChange={e => { clear(); setDepartment(e.target.value) }}><option value="12">Suporte Fiscal</option><option value="3">Suporte ERP</option></select></label>
      <button className="secondary-button" type="submit">{busy ? 'Consultando fonte…' : 'Conferir fonte'}</button>
    </fieldset></form>
    {message && <p role="alert" className="mt-3 text-amber-200">{message}</p>}
    {data && <><p className="mt-3 text-sm text-slate-300">{data.note} Recorte: {data.scope.start} a {data.scope.end}. Consulta: {new Date(data.captured_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.</p>
      <div className="mt-3 overflow-x-auto"><table className="min-w-full text-left text-sm"><thead><tr>{['Atendente', 'Respondidos', 'Resolvidos', 'Transferidos', '1ª resposta', 'Tempo atend.', 'No prazo', '1º contato', 'Reabertos', 'Satisfação'].map(h => <th key={h} className="whitespace-nowrap p-3">{h}</th>)}</tr></thead>
        <tbody>{data.rows.map(r => <tr key={r.id} className="border-t border-slate-700">{[r.name, r.responded, r.resolved, r.transferred, duration(r.first_response_seconds), duration(r.handle_seconds), pct(r.sla_pct), pct(r.first_contact_pct), pct(r.reopened_pct), `${pct(r.csat_pct)} (${r.reviews})`].map((value, i) => <td key={i} className="whitespace-nowrap p-3">{value}</td>)}</tr>)}</tbody>
      </table></div>{!data.rows.length && <p className="mt-3">A fonte não retornou atendentes para este recorte.</p>}</>}
  </details>
}
