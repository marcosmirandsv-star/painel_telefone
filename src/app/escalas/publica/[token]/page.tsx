'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { scheduleSupabase } from '@/lib/schedule-supabase'

type TeamChange = {
  id: string
  target_date: string
  affected_dates: string[]
  summary: string
  created_at: string
}

type Snapshot = {
  team: { id: string; name: string }
  year: number
  month: number
  people: Array<{ id: string; name: string; active: boolean }>
  memberships: Array<{
    person_id: string
    team_id: string
    start_date: string
    end_date: string | null
    participates_in_schedule?: boolean
    participates_hybrid?: boolean
    participates_lunch?: boolean
    participates_snack?: boolean
    participates_extended?: boolean
  }>
  entries: Array<{
    person_id: string
    team_id: string
    date: string
    entry_type: string
    value: string
    metadata?: { return_time?: string | null; shift_end?: string | null }
  }>
  changes: TeamChange[]
}

const MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']
const WEEKDAY_LABEL = ['DOM','SEG','TER','QUA','QUI','SEX','SÁB']

function scheduleCellTone(value?: string) {
  const key = (value ?? '').toLowerCase().replaceAll('_', '-')
  if (key === 'p') return 'schedule-status-p'
  if (key === 'ho') return 'schedule-status-ho'
  if (key === 'click-day') return 'schedule-status-click-day'
  if (key === 'feriado') return 'schedule-status-feriado'
  if (key === 'ferias') return 'schedule-status-ferias'
  if (key === 'day-off') return 'schedule-status-day-off'
  if (key === 'folga') return 'schedule-status-folga'
  if (key === 'premiacao') return 'schedule-status-premiacao'
  if (key === 'banco-horas') return 'schedule-status-banco-horas'
  if (key === 'senac') return 'schedule-status-senac'
  return 'schedule-status-default'
}

function changeSeenKey(token: string) {
  return `schedule-change-seen:${token}`
}

function seenChangeIds(token: string) {
  if (typeof window === 'undefined') return new Set<string>()
  try {
    return new Set(JSON.parse(window.localStorage.getItem(changeSeenKey(token)) ?? '[]'))
  } catch {
    return new Set<string>()
  }
}

function browserNotifyChange(change: TeamChange) {
  if (typeof window === 'undefined' || !('Notification' in window)) return
  if (window.Notification.permission !== 'granted') return
  try {
    new window.Notification('Escala atualizada', { body: change.summary, tag: change.id })
  } catch {
    // O aviso visual continua ativo.
  }
}

function businessDays(year: number, month: number) {
  const total = new Date(year, month, 0).getDate()
  return Array.from({ length: total }, (_, i) => i + 1)
    .map((day) => {
      const value = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      return { day, value, dow: new Date(`${value}T12:00:00`).getDay() }
    })
    .filter((item) => item.dow >= 1 && item.dow <= 5)
}

export default function PublicSchedulePage() {
  const params = useParams<{ token: string }>()
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [error, setError] = useState('')
  const [entryType, setEntryType] = useState('hybrid')
  const [requesterPersonId, setRequesterPersonId] = useState('')
  const [requesterEmail, setRequesterEmail] = useState('')
  const [requestDate, setRequestDate] = useState('')
  const [requestType, setRequestType] = useState('Troca de escala')
  const [requestedValue, setRequestedValue] = useState('')
  const [requestReason, setRequestReason] = useState('')
  const [changePopup, setChangePopup] = useState<TeamChange | null>(null)
  const [requestMessage, setRequestMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const refreshSnapshot = useCallback(async () => {
    try {
      const response = await fetch(`/api/schedule/public/${params.token}`, { cache: 'no-store' })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Não foi possível carregar a escala.')
      setSnapshot(body)
      const seen = seenChangeIds(params.token)
      const unseen = (body.changes ?? []).find((item: TeamChange) => !seen.has(item.id))
      if (unseen) setChangePopup(unseen)
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Erro ao carregar escala.')
    }
  }, [params.token])

  useEffect(() => {
    refreshSnapshot()
  }, [refreshSnapshot])

  useEffect(() => {
    const onFocus = () => refreshSnapshot()
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refreshSnapshot()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [refreshSnapshot])

  const days = useMemo(() => snapshot ? businessDays(snapshot.year, snapshot.month) : [], [snapshot])
  const changedDates = useMemo(
    () => new Set((snapshot?.changes ?? []).flatMap((change) => change.affected_dates ?? [])),
    [snapshot?.changes],
  )

  useEffect(() => {
    if (!requestDate && days[0]) setRequestDate(days[0].value)
  }, [days, requestDate])

  useEffect(() => {
    if (!snapshot?.team?.id) return
    const channel = scheduleSupabase
      .channel(`public-schedule-changes-${snapshot.team.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'schedule_change_events',
          filter: `team_id=eq.${snapshot.team.id}`,
        },
        async (payload) => {
          const change = payload.new as TeamChange
          setChangePopup(change)
          browserNotifyChange(change)
          refreshSnapshot()
        },
      )
      .subscribe()

    return () => {
      scheduleSupabase.removeChannel(channel)
    }
  }, [refreshSnapshot, snapshot?.team?.id])

  async function enableTeamAlerts() {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setRequestMessage('Este navegador não oferece notificações do sistema.')
      return
    }
    const permission = await window.Notification.requestPermission()
    setRequestMessage(
      permission === 'granted'
        ? 'Alertas desta escala ativados neste navegador.'
        : 'O navegador não autorizou notificações. Os avisos dentro da escala continuam ativos.',
    )
  }

  function acknowledgeChange(change: TeamChange) {
    const seen = seenChangeIds(params.token)
    seen.add(change.id)
    window.localStorage.setItem(changeSeenKey(params.token), JSON.stringify([...seen]))
    setChangePopup(null)
  }

  async function submitRequest() {
    if (!requesterPersonId || !requestDate || !requestType) {
      setRequestMessage('Selecione seu nome, a data e o tipo da solicitação.')
      return
    }
    setSubmitting(true)
    setRequestMessage('')
    try {
      const response = await fetch(`/api/schedule/public/${params.token}/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requesterPersonId,
          requesterEmail,
          targetDate: requestDate,
          requestType,
          requestedValue,
          reason: requestReason,
        }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Não foi possível enviar a solicitação.')
      setRequestMessage(body.message || 'Solicitação enviada.')
      setRequestReason('')
    } catch (reason) {
      setRequestMessage(reason instanceof Error ? reason.message : 'Erro ao enviar solicitação.')
    } finally {
      setSubmitting(false)
    }
  }

  if (error) return <main className="schedule-shell p-8"><div className="schedule-card mx-auto max-w-xl border-red-400/30 p-6">{error}</div></main>
  if (!snapshot) return <main className="schedule-shell p-8">Carregando escala...</main>

  const visiblePeople = snapshot.people.filter((person) =>
    snapshot.memberships.some((membership) => membership.person_id === person.id),
  )

  function membershipAllows(
    membership: Snapshot['memberships'][number] | undefined,
    type: string,
  ) {
    if (!membership || membership.participates_in_schedule === false) return false
    if (type === 'hybrid') return membership.participates_hybrid !== false
    if (type === 'lunch') return membership.participates_lunch !== false
    if (type === 'snack') return membership.participates_snack !== false
    if (type === 'extended') return membership.participates_extended !== false
    return true
  }

  return (
    <main className="schedule-shell p-4 sm:p-7">
      {changePopup && (
        <div className="fixed right-4 top-4 z-50 w-[min(460px,calc(100vw-2rem))] rounded-2xl border border-amber-400/50 bg-slate-900 p-5 shadow-2xl">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-300">⚠️ Escala atualizada</p>
          <h2 className="mt-2 text-lg font-bold">Confira novamente sua escala</h2>
          <p className="mt-2 text-sm text-slate-300">{changePopup.summary}</p>
          <button className="primary-button mt-4" onClick={() => acknowledgeChange(changePopup)}>Entendi</button>
        </div>
      )}
      <section className="mx-auto max-w-[1600px]">
        <header className="schedule-topbar flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="schedule-kicker">Escala publicada</p>
            <h1 className="schedule-heading mt-2 text-3xl font-bold">{snapshot.team.name}</h1>
            <p className="schedule-subtitle mt-2">{MONTHS[snapshot.month - 1]} de {snapshot.year}</p>
          </div>
          <button className="secondary-button self-start" onClick={enableTeamAlerts}>Ativar alertas</button>
        </header>
        {snapshot.changes.length > 0 && (
          <section className="schedule-change-banner mt-5 rounded-xl p-4">
            <h2 className="font-bold text-amber-200">Atualizações recentes da escala</h2>
            <div className="mt-3 grid gap-2">
              {snapshot.changes.slice(0, 5).map((change) => (
                <div key={change.id} className="rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-sm">
                  <strong>{new Date(`${change.target_date}T12:00:00`).toLocaleDateString('pt-BR')}</strong> — {change.summary}
                </div>
              ))}
            </div>
          </section>
        )}
        <div className="mt-5">
          <div className="schedule-segmented">
            {[['hybrid','Híbrido'],['lunch','Almoço'],['snack','Café'],['extended','Estendido']].map(([value,label]) => (
              <button key={value} className={entryType === value ? 'is-active' : ''} onClick={() => setEntryType(value)}>{label}</button>
            ))}
          </div>
        </div>
        <section className="schedule-table-wrap mt-5">
          <table className="schedule-table">
            <thead className="sticky top-0 z-20"><tr>
              <th className="schedule-person-cell px-4 py-3 text-left">Colaborador</th>
              {days.map((day) => (
                <th key={day.value} className={`schedule-day-head ${changedDates.has(day.value) ? 'bg-amber-950/50 text-amber-200' : ''}`}>
                  <span>{String(day.day).padStart(2,'0')}{changedDates.has(day.value) ? ' •' : ''}</span>
                  <span className="weekday">{WEEKDAY_LABEL[day.dow]}</span>
                </th>
              ))}
            </tr></thead>
            <tbody>
              {visiblePeople.map((person) => (
                <tr key={person.id}>
                  <td className="schedule-person-cell px-4 py-3 font-semibold">{person.name}</td>
                  {days.map((day) => {
                    const membership = snapshot.memberships.find((item) => item.person_id === person.id && item.start_date <= day.value && (!item.end_date || item.end_date >= day.value))
                    if (!membershipAllows(membership, entryType)) return <td key={day.value} className="px-2 py-3 text-center text-slate-600">—</td>
                    const entry = snapshot.entries.find((item) => item.person_id === person.id && item.date === day.value && item.entry_type === entryType)
                    const lunchDetail = entryType === 'lunch' && entry?.metadata?.return_time
                      ? `${entry.value}–${entry.metadata.return_time}`
                      : entry?.value ?? '—'
                    return <td key={day.value} className={`p-1.5 text-center ${changedDates.has(day.value) ? 'bg-amber-950/10' : ''}`}>
                      <div className={`schedule-cell-button cursor-default ${scheduleCellTone(entry?.value)}`}>
                        <span>{lunchDetail}</span>
                        {entryType === 'lunch' && entry?.metadata?.shift_end ? <span className="mt-1 block text-[10px] font-medium opacity-70">saída {entry.metadata.shift_end}</span> : null}
                      </div>
                    </td>
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="schedule-card mt-6 p-5">
          <h2 className="text-xl font-bold">Solicitar alteração</h2>
          <p className="mt-2 text-sm text-slate-400">
            A solicitação vai para a gestão responsável e gera alerta no painel.
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <select className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2" value={requesterPersonId} onChange={(event) => setRequesterPersonId(event.target.value)}>
              <option value="">Selecione seu nome</option>
              {visiblePeople.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
            </select>
            <input className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2" placeholder="Seu e-mail corporativo (opcional)" type="email" value={requesterEmail} onChange={(event) => setRequesterEmail(event.target.value)} />
            <input className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2" type="date" value={requestDate} min={days[0]?.value} max={days.at(-1)?.value} onChange={(event) => setRequestDate(event.target.value)} />
            <select className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2" value={requestType} onChange={(event) => { setRequestType(event.target.value); setRequestedValue('') }}>
              <option>Troca de escala</option>
              <option>Day Off</option>
              <option>Premiação</option>
              <option>Banco de horas</option>
              <option>Folga</option>
              <option>Alteração de Home Office</option>
              <option>Alteração de almoço</option>
              <option>Alteração de lanche</option>
              <option>Outro</option>
            </select>
            {requestType === 'Alteração de Home Office' && (
              <select className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2" value={requestedValue} onChange={(event) => setRequestedValue(event.target.value)}>
                <option value="">Selecione a modalidade desejada</option>
                <option value="HO">Home Office</option>
                <option value="P">Presencial</option>
              </select>
            )}
          </div>
          <textarea className="mt-3 min-h-28 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2" placeholder="Explique o que precisa ser alterado" value={requestReason} onChange={(event) => setRequestReason(event.target.value)} />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button className="primary-button" disabled={submitting} onClick={submitRequest}>
              {submitting ? 'Enviando...' : 'Enviar solicitação'}
            </button>
            {requestMessage && <span className="text-sm text-slate-300">{requestMessage}</span>}
          </div>
        </section>
        <p className="mt-4 text-xs text-slate-500">Link de consulta e solicitação. Regras e funções de gestão não são expostas.</p>
      </section>
    </main>
  )
}
