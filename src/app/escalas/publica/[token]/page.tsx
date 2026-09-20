'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { scheduleSupabase } from '@/lib/schedule-supabase'

type TeamChange = {
  id: string
  target_date: string
  affected_dates: string[]
  summary: string
  details: Record<string, unknown> | null
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

  useEffect(() => {
    fetch(`/api/schedule/public/${params.token}`, { cache: 'no-store' })
      .then(async (response) => {
        const body = await response.json()
        if (!response.ok) throw new Error(body.error || 'Não foi possível carregar a escala.')
        setSnapshot(body)
        const seen = seenChangeIds(params.token)
        const unseen = (body.changes ?? []).find((item: TeamChange) => !seen.has(item.id))
        if (unseen) setChangePopup(unseen)
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Erro ao carregar escala.'))
  }, [params.token])

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
          try {
            const response = await fetch(`/api/schedule/public/${params.token}`, { cache: 'no-store' })
            const body = await response.json()
            if (response.ok) setSnapshot(body)
          } catch {
            // Mantém a escala atual e o aviso; o usuário pode atualizar manualmente.
          }
        },
      )
      .subscribe()

    return () => {
      scheduleSupabase.removeChannel(channel)
    }
  }, [params.token, snapshot?.team?.id])

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

  if (error) return <main className="min-h-screen bg-slate-950 p-8 text-white"><div className="mx-auto max-w-xl rounded-2xl border border-red-400/30 bg-red-950/30 p-6">{error}</div></main>
  if (!snapshot) return <main className="min-h-screen bg-slate-950 p-8 text-white">Carregando escala...</main>

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
    <main className="min-h-screen bg-slate-950 p-4 text-white sm:p-7">
      {changePopup && (
        <div className="fixed right-4 top-4 z-50 w-[min(460px,calc(100vw-2rem))] rounded-2xl border border-amber-400/50 bg-slate-900 p-5 shadow-2xl">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-300">⚠️ Escala atualizada</p>
          <h2 className="mt-2 text-lg font-bold">Confira novamente sua escala</h2>
          <p className="mt-2 text-sm text-slate-300">{changePopup.summary}</p>
          <button className="primary-button mt-4" onClick={() => acknowledgeChange(changePopup)}>Entendi</button>
        </div>
      )}
      <section className="mx-auto max-w-[1600px]">
        <header className="border-b border-white/10 pb-5">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-300">Escala publicada</p>
          <h1 className="mt-2 text-3xl font-bold">{snapshot.team.name}</h1>
          <p className="mt-2 text-slate-400">{MONTHS[snapshot.month - 1]} de {snapshot.year}</p>
          <button className="secondary-button mt-4" onClick={enableTeamAlerts}>Ativar alertas desta escala</button>
        </header>
        {snapshot.changes.length > 0 && (
          <section className="mt-5 rounded-2xl border border-amber-400/30 bg-amber-950/20 p-4">
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
        <div className="mt-5 flex flex-wrap gap-2">
          {[['hybrid','Híbrido'],['lunch','Almoço'],['snack','Lanche'],['extended','Estendido']].map(([value,label]) => (
            <button key={value} className={entryType === value ? 'primary-button' : 'secondary-button'} onClick={() => setEntryType(value)}>{label}</button>
          ))}
        </div>
        <section className="mt-5 overflow-x-auto rounded-2xl border border-white/10 bg-slate-900/60">
          <table className="min-w-max border-collapse text-sm">
            <thead className="bg-slate-900"><tr>
              <th className="sticky left-0 z-10 min-w-48 border-b border-r border-white/10 bg-slate-900 px-4 py-3 text-left">Colaborador</th>
              {days.map((day) => <th key={day.value} className={`min-w-16 border-b border-r px-2 py-3 text-center ${changedDates.has(day.value) ? 'border-amber-400/50 bg-amber-950/40 text-amber-200' : 'border-white/10'}`}>{day.day}{changedDates.has(day.value) ? <span className="ml-1">●</span> : null}</th>)}
            </tr></thead>
            <tbody>
              {visiblePeople.map((person) => (
                <tr key={person.id}>
                  <td className="sticky left-0 border-b border-r border-white/10 bg-slate-950 px-4 py-3 font-semibold">{person.name}</td>
                  {days.map((day) => {
                    const membership = snapshot.memberships.find((item) => item.person_id === person.id && item.start_date <= day.value && (!item.end_date || item.end_date >= day.value))
                    if (!membershipAllows(membership, entryType)) return <td key={day.value} className="border-b border-r border-white/10 text-center text-slate-600">—</td>
                    const entry = snapshot.entries.find((item) => item.person_id === person.id && item.date === day.value && item.entry_type === entryType)
                    const lunchDetail = entryType === 'lunch' && entry?.metadata?.return_time
                      ? `${entry.value}–${entry.metadata.return_time}`
                      : entry?.value ?? '—'
                    return <td key={day.value} className={`border-b border-r px-2 py-3 text-center ${changedDates.has(day.value) ? 'border-amber-400/30 bg-amber-950/10' : 'border-white/10'}`}>
                      <span>{lunchDetail}</span>
                      {entryType === 'lunch' && entry?.metadata?.shift_end ? <span className="block text-[10px] text-slate-500">saída {entry.metadata.shift_end}</span> : null}
                    </td>
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="mt-6 rounded-2xl border border-white/10 bg-slate-900/60 p-5">
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
