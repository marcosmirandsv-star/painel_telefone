'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { scheduleSupabase as supabase } from '@/lib/schedule-supabase'
import { generateMonthlySchedule } from '@/lib/schedule-engine'
import type {
  ScheduleAbsence,
  ScheduleEntry,
  ScheduleMembership,
  ScheduleMonthContext,
  SchedulePerson,
  ScheduleRule,
  ScheduleTeam,
  ScheduleValidation,
} from '@/lib/schedule-types'

type Profile = { id: string; full_name: string | null; role: string | null }
type Notification = {
  id: string
  title: string
  message: string
  seen_at: string | null
  created_at: string
  request_id: string | null
}

const MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']
const STATUS = [
  ['P','Presencial'],
  ['HO','Home Office'],
  ['EST','Estendido'],
  ['FOLGA','Folga'],
  ['DAY_OFF','Day Off'],
  ['PREMIACAO','Premiação'],
  ['FERIAS','Férias'],
  ['CLICK_DAY','Click Day'],
  ['SENAC','Senac'],
] as const

function beep() {
  try {
    const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextCtor) return
    const context = new AudioContextCtor()
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.frequency.value = 880
    gain.gain.value = 0.05
    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.start()
    oscillator.stop(context.currentTime + 0.14)
  } catch {
    // Som é um reforço; a notificação visual continua funcionando.
  }
}

function ymd(year: number, month: number) {
  return `${year}-${String(month).padStart(2, '0')}`
}

function daysInMonth(year: number, month: number) {
  const total = new Date(year, month, 0).getDate()
  return Array.from({ length: total }, (_, index) => {
    const day = index + 1
    const value = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    const dow = new Date(`${value}T12:00:00`).getDay()
    return { value, day, dow, business: dow >= 1 && dow <= 5 }
  })
}

export default function EscalasPage() {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [teams, setTeams] = useState<ScheduleTeam[]>([])
  const [people, setPeople] = useState<SchedulePerson[]>([])
  const [memberships, setMemberships] = useState<ScheduleMembership[]>([])
  const [rules, setRules] = useState<ScheduleRule[]>([])
  const [absences, setAbsences] = useState<ScheduleAbsence[]>([])
  const [entries, setEntries] = useState<ScheduleEntry[]>([])
  const [context, setContext] = useState<ScheduleMonthContext>({ year, month, holidays: [], optional_days: [] })
  const [selectedTeamId, setSelectedTeamId] = useState('')
  const [section, setSection] = useState<'scale'|'people'|'rules'|'requests'>('scale')
  const [entryType, setEntryType] = useState<'hybrid'|'lunch'|'snack'|'extended'>('hybrid')
  const [validations, setValidations] = useState<ScheduleValidation[]>([])
  const [message, setMessage] = useState('')
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [popup, setPopup] = useState<Notification | null>(null)
  const [loading, setLoading] = useState(true)
  const [personName, setPersonName] = useState('')
  const [personEmail, setPersonEmail] = useState('')
  const [memberTeamId, setMemberTeamId] = useState('')
  const [memberPersonId, setMemberPersonId] = useState('')
  const [memberStart, setMemberStart] = useState(`${ymd(year, month)}-01`)
  const [requestDate, setRequestDate] = useState(`${ymd(year, month)}-01`)
  const [requestType, setRequestType] = useState('Troca de escala')
  const [requestReason, setRequestReason] = useState('')
  const latestNotificationIds = useRef(new Set<string>())

  const isManagement = ['master','coordenadora','coordinator'].includes((profile?.role ?? '').toLowerCase())
  const selectedTeam = teams.find((team) => team.id === selectedTeamId) ?? null
  const monthDays = useMemo(() => daysInMonth(year, month), [year, month])
  const monthPrefix = ymd(year, month)

  const loadAll = useCallback(async () => {
    setLoading(true)
    const { data: userData } = await supabase.auth.getUser()
    const user = userData.user
    const [
      profileResult,
      teamResult,
      peopleResult,
      membershipsResult,
      rulesResult,
      absencesResult,
      entriesResult,
      contextResult,
      notificationResult,
    ] = await Promise.all([
      user
        ? supabase.from('profiles').select('id,full_name,role').eq('id', user.id).maybeSingle()
        : supabase.from('profiles').select('id,full_name,role').eq('full_name', 'Marcos Miranda').maybeSingle(),
      supabase.from('schedule_teams').select('*').eq('active', true).order('name'),
      supabase.from('schedule_people').select('*').order('name'),
      supabase.from('schedule_memberships').select('*').order('start_date'),
      supabase.from('schedule_rules').select('*').eq('active', true).order('start_date'),
      supabase.from('schedule_absences').select('*').lte('start_date', `${monthPrefix}-31`).gte('end_date', `${monthPrefix}-01`),
      supabase.from('schedule_entries').select('*').gte('date', `${monthPrefix}-01`).lte('date', `${monthPrefix}-31`),
      supabase.from('schedule_month_contexts').select('*').eq('year', year).eq('month', month).maybeSingle(),
      supabase.from('schedule_notifications').select('*').order('created_at', { ascending: false }).limit(30),
    ])

    setProfile((profileResult.data as Profile | null) ?? { id: 'homologacao', full_name: 'Marcos Miranda', role: 'master' })
    const loadedTeams = (teamResult.data ?? []) as ScheduleTeam[]
    setTeams(loadedTeams)
    setSelectedTeamId((current) => current || loadedTeams[0]?.id || '')
    setPeople((peopleResult.data ?? []) as SchedulePerson[])
    setMemberships((membershipsResult.data ?? []) as ScheduleMembership[])
    setRules((rulesResult.data ?? []) as ScheduleRule[])
    setAbsences((absencesResult.data ?? []) as ScheduleAbsence[])
    setEntries((entriesResult.data ?? []) as ScheduleEntry[])
    setContext(
      contextResult.data
        ? {
            id: contextResult.data.id,
            year,
            month,
            holidays: contextResult.data.holidays ?? [],
            optional_days: contextResult.data.optional_days ?? [],
            notes: contextResult.data.notes,
          }
        : { year, month, holidays: [], optional_days: [] },
    )
    const loadedNotifications = (notificationResult.data ?? []) as Notification[]
    setNotifications(loadedNotifications)
    latestNotificationIds.current = new Set(loadedNotifications.map((item) => item.id))
    setLoading(false)
  }, [month, monthPrefix, year])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  useEffect(() => {
    if (!profile?.id) return
    const channel = supabase
      .channel(`schedule-notifications-${profile.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'schedule_notifications', filter: `profile_id=eq.${profile.id}` },
        (payload) => {
          const item = payload.new as Notification
          if (latestNotificationIds.current.has(item.id)) return
          latestNotificationIds.current.add(item.id)
          setNotifications((current) => [item, ...current])
          setPopup(item)
          beep()
          document.title = '🔔 Nova solicitação de escala'
        },
      )
      .subscribe()

    const onFocus = async () => {
      const { data } = await supabase.from('schedule_notifications').select('*').is('seen_at', null).order('created_at', { ascending: false }).limit(1)
      const unseen = (data?.[0] ?? null) as Notification | null
      if (unseen && !popup) {
        setPopup(unseen)
        beep()
      }
    }
    window.addEventListener('focus', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
      supabase.removeChannel(channel)
    }
  }, [popup, profile?.id])

  async function markSeen(item: Notification) {
    await supabase.from('schedule_notifications').update({ seen_at: new Date().toISOString() }).eq('id', item.id)
    setNotifications((current) => current.map((notification) => notification.id === item.id ? { ...notification, seen_at: new Date().toISOString() } : notification))
    setPopup(null)
    document.title = 'Escalas | Performance'
  }

  async function addPerson() {
    if (!personName.trim()) return
    const { data, error } = await supabase.from('schedule_people').insert({
      name: personName.trim(),
      email: personEmail.trim().toLowerCase() || null,
    }).select('*').single()
    if (error) return setMessage(error.message)
    setPeople((current) => [...current, data as SchedulePerson].sort((a,b) => a.name.localeCompare(b.name)))
    setPersonName('')
    setPersonEmail('')
    setMessage('Pessoa incluída com sucesso.')
  }

  async function togglePerson(person: SchedulePerson) {
    const { error } = await supabase.from('schedule_people').update({ active: !person.active }).eq('id', person.id)
    if (error) return setMessage(error.message)
    setPeople((current) => current.map((item) => item.id === person.id ? { ...item, active: !person.active } : item))
  }

  async function addMembership() {
    if (!memberPersonId || !memberTeamId || !memberStart) return
    const { data, error } = await supabase.from('schedule_memberships').insert({
      person_id: memberPersonId,
      team_id: memberTeamId,
      start_date: memberStart,
      participates_in_schedule: true,
    }).select('*').single()
    if (error) return setMessage(error.message)
    setMemberships((current) => [...current, data as ScheduleMembership])
    setMessage('Vínculo criado com vigência definida.')
  }

  async function closeMembership(membership: ScheduleMembership, endDate: string) {
    const { error } = await supabase.from('schedule_memberships').update({ end_date: endDate }).eq('id', membership.id)
    if (error) return setMessage(error.message)
    setMemberships((current) => current.map((item) => item.id === membership.id ? { ...item, end_date: endDate } : item))
  }

  async function saveContextAndGenerate() {
    if (!selectedTeam || !isManagement) return
    const { data: auth } = await supabase.auth.getUser()
    const contextPayload = {
      year,
      month,
      holidays: context.holidays,
      optional_days: context.optional_days,
      notes: context.notes ?? null,
      created_by: auth.user?.id ?? null,
    }
    const { data: savedContext, error: contextError } = await supabase
      .from('schedule_month_contexts')
      .upsert(contextPayload, { onConflict: 'year,month' })
      .select('*')
      .single()
    if (contextError) return setMessage(contextError.message)

    const currentEntries = entries.filter((entry) => entry.team_id === selectedTeam.id)
    const result = generateMonthlySchedule({
      team: selectedTeam,
      people,
      memberships,
      absences,
      rules,
      context: {
        id: savedContext.id,
        year,
        month,
        holidays: savedContext.holidays ?? [],
        optional_days: savedContext.optional_days ?? [],
        notes: savedContext.notes,
      },
      year,
      month,
      existingEntries: currentEntries,
    })

    const payload = result.entries.map((entry) => ({
      person_id: entry.person_id,
      team_id: entry.team_id,
      date: entry.date,
      entry_type: entry.entry_type,
      value: entry.value,
      source: entry.source,
      locked: entry.locked ?? false,
      metadata: entry.metadata ?? {},
      updated_by: auth.user?.id ?? null,
      updated_at: new Date().toISOString(),
    }))
    const { error } = await supabase.from('schedule_entries').upsert(payload, { onConflict: 'person_id,team_id,date,entry_type' })
    if (error) return setMessage(error.message)
    setValidations(result.validations)
    setEntries((current) => [
      ...current.filter((entry) => entry.team_id !== selectedTeam.id || !entry.date.startsWith(monthPrefix)),
      ...result.entries,
    ])
    setMessage(result.validations.some((item) => item.level === 'error') ? 'Escala gerada com alertas para revisão.' : 'Escala gerada e validada sem conflitos obrigatórios.')
  }

  async function cycleCell(personId: string, date: string) {
    if (!selectedTeam || !isManagement) return
    const current = entries.find((entry) => entry.person_id === personId && entry.team_id === selectedTeam.id && entry.date === date && entry.entry_type === entryType)
    let value = current?.value ?? ''
    if (entryType === 'hybrid') {
      const values = STATUS.map(([key]) => key)
      const index = values.indexOf(value as typeof values[number])
      value = values[(index + 1) % values.length]
    } else if (entryType === 'lunch') value = value === '12:00' ? '13:00' : value === '13:00' ? '11:30' : '12:00'
    else if (entryType === 'snack') {
      const values = ['15:45','16:15','16:30','16:45','17:00','17:15']
      value = values[(values.indexOf(value) + 1) % values.length]
    } else {
      value = value === '09:00-18:30' ? '09:30-19:00' : '09:00-18:30'
    }
    const { data: auth } = await supabase.auth.getUser()
    const payload = {
      person_id: personId,
      team_id: selectedTeam.id,
      date,
      entry_type: entryType,
      value,
      source: 'manual',
      locked: true,
      updated_by: auth.user?.id ?? null,
      updated_at: new Date().toISOString(),
    }
    const { data, error } = await supabase.from('schedule_entries').upsert(payload, { onConflict: 'person_id,team_id,date,entry_type' }).select('*').single()
    if (error) return setMessage(error.message)
    setEntries((currentEntries) => [
      ...currentEntries.filter((item) => !(item.person_id === personId && item.team_id === selectedTeam.id && item.date === date && item.entry_type === entryType)),
      data as ScheduleEntry,
    ])
  }

  async function releaseMonth() {
    if (!selectedTeam) return
    const { data: auth } = await supabase.auth.getUser()
    const { error } = await supabase.from('schedule_publications').upsert({
      team_id: selectedTeam.id,
      year,
      month,
      released: true,
      released_at: new Date().toISOString(),
      released_by: auth.user?.id ?? null,
    }, { onConflict: 'team_id,year,month' })
    setMessage(error ? error.message : `${MONTHS[month - 1]} liberado para visualização.`)
  }

  async function submitRequest() {
    if (!selectedTeam || !profile) return
    const { error } = await supabase.from('schedule_requests').insert({
      requester_name: profile.full_name ?? 'Colaborador',
      team_id: selectedTeam.id,
      target_date: requestDate,
      request_type: requestType,
      reason: requestReason.trim() || null,
    })
    if (error) return setMessage(error.message)
    setRequestReason('')
    setMessage('Solicitação enviada. A gestão foi notificada.')
  }

  const activeTeamPeople = useMemo(() => {
    if (!selectedTeam) return []
    return people.filter((person) =>
      memberships.some((membership) =>
        membership.person_id === person.id &&
        membership.team_id === selectedTeam.id &&
        membership.participates_in_schedule &&
        membership.start_date <= `${monthPrefix}-31` &&
        (!membership.end_date || membership.end_date >= `${monthPrefix}-01`),
      ),
    )
  }, [memberships, monthPrefix, people, selectedTeam])

  if (loading) return <main className="min-h-screen bg-slate-950 p-8 text-white">Carregando módulo de escalas...</main>

  return (
    <main className="min-h-screen bg-slate-950 p-4 text-white sm:p-7">
      {popup && (
        <div className="fixed right-4 top-4 z-50 w-[min(420px,calc(100vw-2rem))] rounded-2xl border border-cyan-400/50 bg-slate-900 p-5 shadow-2xl shadow-cyan-950/50">
          <div className="flex items-start gap-3">
            <div className="animate-bounce text-2xl">🔔</div>
            <div className="flex-1">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-300">Nova solicitação</p>
              <h2 className="mt-1 text-lg font-bold">{popup.title}</h2>
              <p className="mt-2 text-sm text-slate-300">{popup.message}</p>
              <div className="mt-4 flex gap-2">
                <button className="primary-button" onClick={() => { setSection('requests'); markSeen(popup) }}>Ver agora</button>
                <button className="secondary-button" onClick={() => markSeen(popup)}>Dispensar</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <section className="mx-auto max-w-[1600px]">
        <div className="mb-4 rounded-xl border border-amber-400/40 bg-amber-950/30 px-4 py-3 text-sm text-amber-100">
          🧪 <strong>Ambiente de homologação.</strong> Este módulo está isolado da produção até aprovação da gestão.
        </div>

        <header className="flex flex-col gap-4 border-b border-white/10 pb-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-300">Central de Performance</p>
            <h1 className="mt-2 text-3xl font-bold">Painel de Escalas</h1>
            <p className="mt-2 text-slate-400">Composição do time, geração, validação, publicação e solicitações em um único fluxo.</p>
          </div>
          <div className="flex items-center gap-3">
            <button className="relative rounded-xl border border-white/10 bg-slate-900 px-4 py-3" onClick={() => setSection('requests')}>
              🔔
              {notifications.filter((item) => !item.seen_at).length > 0 && (
                <span className="absolute -right-2 -top-2 rounded-full bg-red-500 px-2 py-0.5 text-xs font-bold">
                  {notifications.filter((item) => !item.seen_at).length}
                </span>
              )}
            </button>
            <Link className="secondary-button" href="/">Voltar ao Performance</Link>
          </div>
        </header>

        <div className="mt-5 flex flex-wrap gap-2">
          <button className={section === 'scale' ? 'primary-button' : 'secondary-button'} onClick={() => setSection('scale')}>Escalas</button>
          {isManagement && <button className={section === 'people' ? 'primary-button' : 'secondary-button'} onClick={() => setSection('people')}>Pessoas e Times</button>}
          {isManagement && <button className={section === 'rules' ? 'primary-button' : 'secondary-button'} onClick={() => setSection('rules')}>Regras</button>}
          <button className={section === 'requests' ? 'primary-button' : 'secondary-button'} onClick={() => setSection('requests')}>Solicitações</button>
        </div>

        {message && <div className="mt-4 rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm">{message}</div>}

        {section === 'scale' && (
          <>
            <section className="mt-6 grid gap-4 rounded-2xl border border-white/10 bg-slate-900/60 p-4 lg:grid-cols-[1fr_1fr_auto]">
              <label className="grid gap-1 text-sm text-slate-300">
                Time
                <select className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2" value={selectedTeamId} onChange={(event) => setSelectedTeamId(event.target.value)}>
                  {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1 text-sm text-slate-300">Mês
                  <select className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2" value={month} onChange={(event) => setMonth(Number(event.target.value))}>
                    {MONTHS.map((label, index) => <option key={label} value={index + 1}>{label}</option>)}
                  </select>
                </label>
                <label className="grid gap-1 text-sm text-slate-300">Ano
                  <input className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2" type="number" value={year} onChange={(event) => setYear(Number(event.target.value))} />
                </label>
              </div>
              {isManagement && <div className="flex items-end gap-2">
                <button className="primary-button" onClick={saveContextAndGenerate}>Gerar escala</button>
                <button className="secondary-button" onClick={releaseMonth}>Liberar mês</button>
              </div>}
            </section>

            {isManagement && (
              <section className="mt-4 grid gap-4 rounded-2xl border border-white/10 bg-slate-900/60 p-4 md:grid-cols-2">
                <label className="grid gap-1 text-sm text-slate-300">Feriados (AAAA-MM-DD, separados por vírgula)
                  <input className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2" value={context.holidays.join(', ')} onChange={(event) => setContext({ ...context, holidays: event.target.value.split(',').map((item) => item.trim()).filter(Boolean) })} />
                </label>
                <label className="grid gap-1 text-sm text-slate-300">Pontos facultativos
                  <input className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2" value={context.optional_days.join(', ')} onChange={(event) => setContext({ ...context, optional_days: event.target.value.split(',').map((item) => item.trim()).filter(Boolean) })} />
                </label>
              </section>
            )}

            <div className="mt-5 flex flex-wrap gap-2">
              {(['hybrid','lunch','snack','extended'] as const).map((type) => (
                <button key={type} className={entryType === type ? 'primary-button' : 'secondary-button'} onClick={() => setEntryType(type)}>
                  {{ hybrid: 'Híbrido', lunch: 'Almoço', snack: 'Lanche', extended: 'Estendido' }[type]}
                </button>
              ))}
            </div>

            {validations.length > 0 && (
              <div className="mt-4 grid gap-2">
                {validations.map((validation, index) => (
                  <div key={index} className={`rounded-lg border px-3 py-2 text-sm ${validation.level === 'error' ? 'border-red-400/30 bg-red-950/30 text-red-100' : validation.level === 'warning' ? 'border-amber-400/30 bg-amber-950/30 text-amber-100' : 'border-emerald-400/30 bg-emerald-950/30 text-emerald-100'}`}>
                    {validation.level === 'error' ? '❌' : validation.level === 'warning' ? '⚠️' : '✅'} {validation.message} {validation.date ? `— ${validation.date}` : ''}
                  </div>
                ))}
              </div>
            )}

            <section className="mt-5 overflow-x-auto rounded-2xl border border-white/10 bg-slate-900/60">
              <table className="min-w-max border-collapse text-sm">
                <thead className="sticky top-0 z-10 bg-slate-900">
                  <tr>
                    <th className="sticky left-0 z-20 min-w-48 border-b border-r border-white/10 bg-slate-900 px-4 py-3 text-left">Colaborador</th>
                    {monthDays.filter((day) => day.business).map((day) => <th key={day.value} className="min-w-16 border-b border-r border-white/10 px-2 py-3 text-center">{day.day}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {activeTeamPeople.map((person) => (
                    <tr key={person.id}>
                      <td className="sticky left-0 z-10 border-b border-r border-white/10 bg-slate-950 px-4 py-3 font-semibold">{person.name}</td>
                      {monthDays.filter((day) => day.business).map((day) => {
                        const membership = memberships.find((item) => item.person_id === person.id && item.team_id === selectedTeamId && item.start_date <= day.value && (!item.end_date || item.end_date >= day.value))
                        if (!membership) return <td key={day.value} className="border-b border-r border-white/10 bg-slate-950/40 text-center text-slate-600">—</td>
                        const entry = entries.find((item) => item.person_id === person.id && item.team_id === selectedTeamId && item.date === day.value && item.entry_type === entryType)
                        return (
                          <td key={day.value} className="border-b border-r border-white/10 p-1 text-center">
                            <button className="min-h-9 w-full rounded-md bg-slate-800 px-2 py-1 text-xs hover:bg-slate-700" onClick={() => cycleCell(person.id, day.value)}>
                              {entry?.value ?? '—'}
                            </button>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </>
        )}

        {section === 'people' && isManagement && (
          <div className="mt-6 grid gap-5 xl:grid-cols-[420px_1fr]">
            <section className="rounded-2xl border border-white/10 bg-slate-900/60 p-5">
              <h2 className="text-xl font-bold">Incluir pessoa</h2>
              <div className="mt-4 grid gap-3">
                <input className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2" placeholder="Nome" value={personName} onChange={(event) => setPersonName(event.target.value)} />
                <input className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2" placeholder="E-mail (opcional)" value={personEmail} onChange={(event) => setPersonEmail(event.target.value)} />
                <button className="primary-button" onClick={addPerson}>Adicionar pessoa</button>
              </div>
              <h3 className="mt-7 font-bold">Criar vínculo com time</h3>
              <div className="mt-3 grid gap-3">
                <select className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2" value={memberPersonId} onChange={(event) => setMemberPersonId(event.target.value)}>
                  <option value="">Selecione a pessoa</option>
                  {people.filter((person) => person.active).map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
                </select>
                <select className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2" value={memberTeamId} onChange={(event) => setMemberTeamId(event.target.value)}>
                  <option value="">Selecione o time</option>
                  {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
                </select>
                <input className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2" type="date" value={memberStart} onChange={(event) => setMemberStart(event.target.value)} />
                <button className="secondary-button" onClick={addMembership}>Criar vínculo</button>
              </div>
            </section>

            <section className="overflow-x-auto rounded-2xl border border-white/10 bg-slate-900/60 p-5">
              <h2 className="text-xl font-bold">Pessoas e vínculos</h2>
              <table className="mt-4 min-w-full text-sm">
                <thead><tr className="text-left text-slate-400"><th className="pb-3">Pessoa</th><th>Time</th><th>Vigência</th><th>Status</th><th>Ação</th></tr></thead>
                <tbody>
                  {people.map((person) => {
                    const personMemberships = memberships.filter((item) => item.person_id === person.id)
                    return personMemberships.length ? personMemberships.map((membership, index) => (
                      <tr key={membership.id} className="border-t border-white/10">
                        <td className="py-3">{index === 0 ? person.name : ''}</td>
                        <td>{teams.find((team) => team.id === membership.team_id)?.name ?? '—'}</td>
                        <td>{membership.start_date} → {membership.end_date ?? 'atual'}</td>
                        <td>{person.active ? 'Ativo' : 'Inativo'}</td>
                        <td className="flex gap-2 py-2">
                          {!membership.end_date && <button className="small-button" onClick={() => {
                            const value = window.prompt('Data final do vínculo (AAAA-MM-DD):', new Date().toISOString().slice(0,10))
                            if (value) closeMembership(membership, value)
                          }}>Encerrar vínculo</button>}
                          {index === 0 && <button className="small-button" onClick={() => togglePerson(person)}>{person.active ? 'Inativar' : 'Reativar'}</button>}
                        </td>
                      </tr>
                    )) : (
                      <tr key={person.id} className="border-t border-white/10">
                        <td className="py-3">{person.name}</td><td>Sem vínculo</td><td>—</td><td>{person.active ? 'Ativo' : 'Inativo'}</td>
                        <td><button className="small-button" onClick={() => togglePerson(person)}>{person.active ? 'Inativar' : 'Reativar'}</button></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </section>
          </div>
        )}

        {section === 'rules' && isManagement && (
          <section className="mt-6 rounded-2xl border border-white/10 bg-slate-900/60 p-5">
            <h2 className="text-xl font-bold">Regras vigentes</h2>
            <p className="mt-2 text-sm text-slate-400">As regras podem ser gerais, por time ou por pessoa e possuem vigência. Nesta primeira homologação, a edição detalhada será feita depois da validação do modelo de cadastro.</p>
            <div className="mt-4 grid gap-2">
              {rules.map((rule) => (
                <div key={rule.id} className="rounded-lg border border-white/10 bg-slate-950 p-3 text-sm">
                  <strong>{rule.rule_key}</strong> · {rule.start_date} → {rule.end_date ?? 'atual'}
                  <pre className="mt-2 overflow-x-auto text-xs text-slate-400">{JSON.stringify(rule.rule_value)}</pre>
                </div>
              ))}
              {!rules.length && <p className="text-slate-400">Nenhuma regra cadastrada ainda.</p>}
            </div>
          </section>
        )}

        {section === 'requests' && (
          <div className="mt-6 grid gap-5 lg:grid-cols-[420px_1fr]">
            <section className="rounded-2xl border border-white/10 bg-slate-900/60 p-5">
              <h2 className="text-xl font-bold">Nova solicitação</h2>
              <div className="mt-4 grid gap-3">
                <select className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2" value={selectedTeamId} onChange={(event) => setSelectedTeamId(event.target.value)}>
                  {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
                </select>
                <input className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2" type="date" value={requestDate} onChange={(event) => setRequestDate(event.target.value)} />
                <input className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2" value={requestType} onChange={(event) => setRequestType(event.target.value)} />
                <textarea className="min-h-28 rounded-lg border border-white/10 bg-slate-950 px-3 py-2" placeholder="Explique o pedido" value={requestReason} onChange={(event) => setRequestReason(event.target.value)} />
                <button className="primary-button" onClick={submitRequest}>Enviar solicitação</button>
              </div>
            </section>
            <section className="rounded-2xl border border-white/10 bg-slate-900/60 p-5">
              <h2 className="text-xl font-bold">Notificações</h2>
              <div className="mt-4 grid gap-2">
                {notifications.map((item) => (
                  <button key={item.id} className={`rounded-xl border p-4 text-left ${item.seen_at ? 'border-white/10 bg-slate-950/40' : 'border-cyan-400/40 bg-cyan-950/20'}`} onClick={() => markSeen(item)}>
                    <div className="flex items-center justify-between gap-3"><strong>{item.title}</strong><span className="text-xs text-slate-500">{new Date(item.created_at).toLocaleString('pt-BR')}</span></div>
                    <p className="mt-1 text-sm text-slate-300">{item.message}</p>
                  </button>
                ))}
                {!notifications.length && <p className="text-slate-400">Nenhuma notificação.</p>}
              </div>
            </section>
          </div>
        )}
      </section>
    </main>
  )
}
