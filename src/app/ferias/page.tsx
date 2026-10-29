'use client'

import Link from 'next/link'
import { FormEvent, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'

type Team = { id: string; name: string; manager_person_id: string | null; active: boolean }
type Person = {
  id: string
  name: string
  photo_url: string | null
  team_id: string | null
  manager_person_id: string | null
  phone_analyst_id: string | null
  chat_analyst_id: string | null
  active: boolean
}
type Vacation = {
  id: string
  person_id: string
  start_date: string
  end_date: string
  days: number
  status: 'planned' | 'scheduled' | 'cancelled'
  hr_ticket: string | null
  cash_bonus_days: number | null
  thirteenth_advance: boolean | null
  notes: string | null
}

type VacationSection = 'planning' | 'people' | 'history'
type VacationListStatus = 'all' | 'planned' | 'scheduled' | 'completed' | 'cancelled'
type ExternalRow = Record<string, unknown>

const dateToday = new Date().toISOString().slice(0, 10)
const emptyPerson = { name: '', team_id: '', manager_person_id: '', photo_url: '', active: true }
const emptyVacation = {
  person_id: '', start_date: '', end_date: '', status: 'planned', hr_ticket: '', cash_bonus_days: '', thirteenth_advance: false, notes: '',
}

function isManagementRole(role: string | null | undefined) {
  const normalized = (role ?? '').toLowerCase()
  return normalized.includes('master') || normalized.includes('coord')
}

function daysBetween(start: string, end: string) {
  if (!start || !end) return null
  const diff = new Date(`${end}T12:00:00`).getTime() - new Date(`${start}T12:00:00`).getTime()
  return diff < 0 ? null : Math.round(diff / 86_400_000) + 1
}

function overlaps(startA: string, endA: string, startB: string, endB: string) {
  return startA <= endB && endA >= startB
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(`${value}T12:00:00`))
}

function statusLabel(status: Vacation['status']) {
  return { planned: 'Planejada', scheduled: 'Programada', cancelled: 'Cancelada' }[status]
}

function getVacationListStatus(vacation: Vacation): Exclude<VacationListStatus, 'all'> {
  if (vacation.status === 'cancelled') return 'cancelled'
  if (vacation.end_date < dateToday) return 'completed'
  return vacation.status
}

function statusLabelForList(status: Exclude<VacationListStatus, 'all'>) {
  return { planned: 'Planejada', scheduled: 'Programada', completed: 'Concluída', cancelled: 'Cancelada' }[status]
}

function statusTone(status: Exclude<VacationListStatus, 'all'>) {
  return {
    planned: 'border-red-400/45 bg-red-400/10 text-red-200',
    scheduled: 'border-emerald-400/45 bg-emerald-400/10 text-emerald-200',
    completed: 'border-slate-500/55 bg-slate-700/45 text-slate-200',
    cancelled: 'border-amber-400/45 bg-amber-400/10 text-amber-200',
  }[status]
}

function asExternalRows(value: unknown): ExternalRow[] {
  if (Array.isArray(value)) return value.filter((item): item is ExternalRow => Boolean(item) && typeof item === 'object')
  if (value && typeof value === 'object') {
    const container = value as Record<string, unknown>
    for (const key of ['data', 'items', 'results', 'ferias', 'vacations']) {
      if (Array.isArray(container[key])) return asExternalRows(container[key])
    }
  }
  return []
}

function externalValue(row: ExternalRow, terms: string[]) {
  const normalizedTerms = terms.map((term) => term.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase())
  const findValue = (value: unknown, depth = 0): string | undefined => {
    if (!value || typeof value !== 'object' || depth > 3) return undefined
    for (const [key, nestedValue] of Object.entries(value as ExternalRow)) {
      const normalizedKey = key.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      if (normalizedTerms.some((term) => normalizedKey.includes(term)) && (typeof nestedValue === 'string' || typeof nestedValue === 'number')) return String(nestedValue)
      const found = findValue(nestedValue, depth + 1)
      if (found) return found
    }
    return undefined
  }
  return findValue(row) ?? '—'
}

export default function VacationPage() {
  const [allowed, setAllowed] = useState<boolean | null>(null)
  const [teams, setTeams] = useState<Team[]>([])
  const [people, setPeople] = useState<Person[]>([])
  const [vacations, setVacations] = useState<Vacation[]>([])
  const [teamFilter, setTeamFilter] = useState('')
  const [selectedPersonId, setSelectedPersonId] = useState('')
  const [personForm, setPersonForm] = useState(emptyPerson)
  const [vacationForm, setVacationForm] = useState(emptyVacation)
  const [editingVacationId, setEditingVacationId] = useState<string | null>(null)
  const [activeSection, setActiveSection] = useState<VacationSection>('history')
  const [periodTeamFilter, setPeriodTeamFilter] = useState('')
  const [periodPersonFilter, setPeriodPersonFilter] = useState('')
  const [periodStatusFilter, setPeriodStatusFilter] = useState<VacationListStatus>('all')
  const [periodStartFilter, setPeriodStartFilter] = useState('')
  const [periodEndFilter, setPeriodEndFilter] = useState('')
  const [genteGestaoVacations, setGenteGestaoVacations] = useState<ExternalRow[]>([])
  const [genteGestaoMessage, setGenteGestaoMessage] = useState('')
  const [loadingGenteGestao, setLoadingGenteGestao] = useState(false)
  const [teamName, setTeamName] = useState('')
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)

  async function load() {
    const { data: auth } = await supabase.auth.getUser()
    if (!auth.user) {
      window.location.href = '/'
      return
    }
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', auth.user.id).maybeSingle()
    const canManage = isManagementRole(profile?.role)
    setAllowed(canManage)
    if (!canManage) return

    const [teamsResult, peopleResult, vacationsResult] = await Promise.all([
      supabase.from('workforce_teams').select('id,name,manager_person_id,active').order('name'),
      supabase.from('workforce_people').select('id,name,photo_url,team_id,manager_person_id,phone_analyst_id,chat_analyst_id,active').order('name'),
      supabase.from('vacation_periods').select('id,person_id,start_date,end_date,days,status,hr_ticket,cash_bonus_days,thirteenth_advance,notes').order('start_date'),
    ])
    const firstError = teamsResult.error || peopleResult.error || vacationsResult.error
    if (firstError) setMessage(`Não foi possível carregar o controle: ${firstError.message}`)
    setTeams((teamsResult.data ?? []) as Team[])
    setPeople((peopleResult.data ?? []) as Person[])
    setVacations((vacationsResult.data ?? []) as Vacation[])
  }

  useEffect(() => { load() }, [])

  const visiblePeople = useMemo(
    () => people.filter((person) => !teamFilter || person.team_id === teamFilter),
    [people, teamFilter],
  )
  const teamLookup = useMemo(() => new Map(teams.map((team) => [team.id, team])), [teams])
  const peopleLookup = useMemo(() => new Map(people.map((person) => [person.id, person])), [people])
  const chosenDays = daysBetween(vacationForm.start_date, vacationForm.end_date)
  const selectedTeam = peopleLookup.get(vacationForm.person_id)?.team_id ?? ''
  const periodConflicts = useMemo(() => {
    if (!vacationForm.start_date || !vacationForm.end_date || !selectedTeam) return []
    return vacations.filter((vacation) => {
      const person = peopleLookup.get(vacation.person_id)
      return vacation.status !== 'cancelled' && person?.team_id === selectedTeam && vacation.person_id !== vacationForm.person_id && overlaps(vacationForm.start_date, vacationForm.end_date, vacation.start_date, vacation.end_date)
    })
  }, [vacationForm, vacations, peopleLookup, selectedTeam])

  const selectedTeamPeople = people.filter((person) => person.active && person.team_id === selectedTeam)
  const selectedAbsentPeople = new Set(periodConflicts.map((vacation) => vacation.person_id))
  const currentPerson = peopleLookup.get(vacationForm.person_id)
  if (currentPerson && vacationForm.start_date && vacationForm.end_date) selectedAbsentPeople.add(currentPerson.id)

  function choosePerson(personId: string) {
    setSelectedPersonId(personId)
    const person = peopleLookup.get(personId)
    if (!person) return setPersonForm(emptyPerson)
    setPersonForm({
      name: person.name,
      team_id: person.team_id ?? '',
      manager_person_id: person.manager_person_id ?? '',
      photo_url: person.photo_url ?? '',
      active: person.active,
    })
  }

  const selectedPerson = selectedPersonId ? peopleLookup.get(selectedPersonId) : null
  const selectedPersonComesFromExistingRegistry = Boolean(selectedPerson?.phone_analyst_id || selectedPerson?.chat_analyst_id)
  const selectedPersonSource = selectedPerson?.phone_analyst_id && selectedPerson?.chat_analyst_id
    ? 'Telefone e Chat'
    : selectedPerson?.phone_analyst_id
      ? 'Analistas de Telefone'
      : selectedPerson?.chat_analyst_id
        ? 'Analistas de Chat'
        : null
  const filteredVacations = useMemo(() => vacations.filter((vacation) => {
    const person = peopleLookup.get(vacation.person_id)
    const displayStatus = getVacationListStatus(vacation)
    if (periodTeamFilter && person?.team_id !== periodTeamFilter) return false
    if (periodPersonFilter && vacation.person_id !== periodPersonFilter) return false
    if (periodStatusFilter !== 'all' && displayStatus !== periodStatusFilter) return false
    if (periodStartFilter && vacation.end_date < periodStartFilter) return false
    if (periodEndFilter && vacation.start_date > periodEndFilter) return false
    return true
  }), [vacations, peopleLookup, periodTeamFilter, periodPersonFilter, periodStatusFilter, periodStartFilter, periodEndFilter])

  async function savePerson(event: FormEvent) {
    event.preventDefault()
    if (!personForm.name.trim()) return setMessage('Informe o nome da pessoa.')
    setSaving(true); setMessage('')
    const payload = {
      name: personForm.name.trim(),
      team_id: personForm.team_id || null,
      manager_person_id: personForm.manager_person_id || null,
      photo_url: personForm.photo_url.trim() || null,
      active: personForm.active,
      updated_at: new Date().toISOString(),
    }
    const previous = selectedPersonId ? peopleLookup.get(selectedPersonId) : null
    const result = previous
      ? await supabase.from('workforce_people').update(payload).eq('id', previous.id).select('id').single()
      : await supabase.from('workforce_people').insert(payload).select('id').single()
    if (result.error) { setSaving(false); return setMessage(result.error.message) }
    const changedAssignment = !previous || previous.team_id !== payload.team_id || previous.manager_person_id !== payload.manager_person_id
    if (changedAssignment) {
      await supabase.from('workforce_assignment_history').insert({
        person_id: result.data.id, team_id: payload.team_id, manager_person_id: payload.manager_person_id, starts_on: dateToday,
        reason: previous ? 'Atualização de time ou gestor pelo controle de férias' : 'Cadastro criado pelo controle de férias',
      })
    }
    setMessage(previous ? 'Cadastro atualizado.' : 'Pessoa cadastrada.')
    setSelectedPersonId(''); setPersonForm(emptyPerson); setSaving(false); await load()
  }

  async function saveTeam(event: FormEvent) {
    event.preventDefault()
    if (!teamName.trim()) return
    setSaving(true); setMessage('')
    const { error } = await supabase.from('workforce_teams').insert({ name: teamName.trim() })
    setSaving(false)
    if (error) return setMessage(error.code === '23505' ? 'Já existe um time com esse nome.' : error.message)
    setTeamName(''); setMessage('Time criado.'); await load()
  }

  async function saveVacation(event: FormEvent) {
    event.preventDefault()
    if (!vacationForm.person_id || !vacationForm.start_date || !vacationForm.end_date || !chosenDays) return setMessage('Preencha pessoa, início e fim com datas válidas.')
    setSaving(true); setMessage('')
    const payload = {
      person_id: vacationForm.person_id, start_date: vacationForm.start_date, end_date: vacationForm.end_date,
      status: vacationForm.status, hr_ticket: vacationForm.hr_ticket.trim() || null,
      cash_bonus_days: vacationForm.cash_bonus_days ? Number(vacationForm.cash_bonus_days) : null,
      thirteenth_advance: vacationForm.thirteenth_advance, notes: vacationForm.notes.trim() || null,
      updated_at: new Date().toISOString(),
    }
    const { error } = editingVacationId
      ? await supabase.from('vacation_periods').update(payload).eq('id', editingVacationId)
      : await supabase.from('vacation_periods').insert(payload)
    setSaving(false)
    if (error) return setMessage(error.message)
    setVacationForm(emptyVacation); setEditingVacationId(null); setMessage(editingVacationId ? 'Período atualizado.' : 'Férias registradas.'); await load()
  }

  function editVacation(vacation: Vacation) {
    setEditingVacationId(vacation.id)
    setVacationForm({
      person_id: vacation.person_id,
      start_date: vacation.start_date,
      end_date: vacation.end_date,
      status: vacation.status,
      hr_ticket: vacation.hr_ticket ?? '',
      cash_bonus_days: vacation.cash_bonus_days?.toString() ?? '',
      thirteenth_advance: vacation.thirteenth_advance ?? false,
      notes: vacation.notes ?? '',
    })
    setActiveSection('planning')
    document.getElementById('programar-ferias')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  async function cancelVacation(id: string) {
    setSaving(true)
    const { error } = await supabase.from('vacation_periods').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', id)
    setSaving(false)
    if (error) return setMessage(error.message)
    setMessage('Período cancelado; o histórico foi preservado.'); await load()
  }

  async function consultGenteGestao() {
    setLoadingGenteGestao(true)
    setGenteGestaoMessage('')
    const { data: sessionData } = await supabase.auth.getSession()
    const accessToken = sessionData.session?.access_token
    const response = await fetch('/api/gente-gestao/ferias', {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    })
    const payload = await response.json().catch(() => null)
    setLoadingGenteGestao(false)
    if (!response.ok) {
      setGenteGestaoVacations([])
      setGenteGestaoMessage(typeof payload?.error === 'string' ? payload.error : 'Não foi possível consultar o Gente Gestão.')
      return
    }
    const rows = asExternalRows(payload?.ferias)
    setGenteGestaoVacations(rows)
    setGenteGestaoMessage(rows.length ? `${rows.length} período(s) encontrado(s) no Gente Gestão.` : 'A consulta foi realizada, sem períodos retornados para o seu escopo.')
  }

  function closeGenteGestaoConsult() {
    setGenteGestaoVacations([])
    setGenteGestaoMessage('')
  }

  if (allowed === null) return <main className="min-h-screen bg-slate-950 p-8 text-slate-100">Carregando controle de férias…</main>
  if (!allowed) return <main className="min-h-screen bg-slate-950 p-8 text-slate-100"><p>Acesso restrito à gestão.</p><Link href="/" className="mt-4 inline-block text-cyan-300">Voltar ao painel</Link></main>

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-7 text-slate-100 md:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-700 pb-6">
          <div><p className="text-sm font-semibold uppercase tracking-[.18em] text-cyan-300">Gestão</p><h1 className="mt-1 text-3xl font-bold">Controle de férias e capacidade</h1><p className="mt-2 max-w-3xl text-slate-300">Planeje períodos, confira a cobertura do time e mantenha a lotação e a gestão de cada pessoa atualizadas.</p></div>
          <Link href="/" className="rounded-lg border border-cyan-400/50 px-4 py-2 font-semibold text-cyan-200">Voltar ao painel</Link>
        </header>

        {message && <p className="mt-5 rounded-lg border border-cyan-400/30 bg-cyan-400/10 p-3 text-sm text-cyan-100">{message}</p>}

        <nav className="mt-6 flex flex-wrap gap-2 border-b border-slate-700 pb-4" aria-label="Áreas do controle de férias">
          <button type="button" onClick={() => setActiveSection('history')} className={activeSection === 'history' ? 'rounded-lg bg-cyan-400 px-4 py-2 font-bold text-slate-950' : 'rounded-lg border border-slate-600 px-4 py-2 font-semibold text-slate-200'}>Períodos e histórico</button>
          <button type="button" onClick={() => setActiveSection('planning')} className={activeSection === 'planning' ? 'rounded-lg bg-cyan-400 px-4 py-2 font-bold text-slate-950' : 'rounded-lg border border-slate-600 px-4 py-2 font-semibold text-slate-200'}>Planejamento e cobertura</button>
          <button type="button" onClick={() => setActiveSection('people')} className={activeSection === 'people' ? 'rounded-lg bg-cyan-400 px-4 py-2 font-bold text-slate-950' : 'rounded-lg border border-slate-600 px-4 py-2 font-semibold text-slate-200'}>Pessoas e times</button>
        </nav>

        {activeSection === 'planning' && <section className="mt-6 grid gap-5 lg:grid-cols-3">
          <form id="programar-ferias" onSubmit={saveVacation} className="rounded-xl border border-slate-700 bg-slate-900 p-5 lg:col-span-2">
            <h2 className="text-xl font-bold">{editingVacationId ? 'Editar período de férias' : 'Programar férias'}</h2><p className="mt-1 text-sm text-slate-400">A quantidade é calculada em dias corridos, incluindo início e fim.</p>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <label className="text-sm">Time
                <select className="mt-1 w-full rounded bg-slate-800 p-2" value={teamFilter} onChange={(e) => { setTeamFilter(e.target.value); setVacationForm({ ...vacationForm, person_id: '' }) }}><option value="">Todos os times</option>{teams.filter((team) => team.active).map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select>
              </label>
              <label className="text-sm">Pessoa
                <select required className="mt-1 w-full rounded bg-slate-800 p-2" value={vacationForm.person_id} onChange={(e) => setVacationForm({ ...vacationForm, person_id: e.target.value })}><option value="">Selecione</option>{visiblePeople.filter((person) => person.active).map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select>
              </label>
              <label className="text-sm">Início<input required type="date" className="mt-1 w-full rounded bg-slate-800 p-2" value={vacationForm.start_date} onChange={(e) => setVacationForm({ ...vacationForm, start_date: e.target.value })} /></label>
              <label className="text-sm">Fim<input required type="date" min={vacationForm.start_date || undefined} className="mt-1 w-full rounded bg-slate-800 p-2" value={vacationForm.end_date} onChange={(e) => setVacationForm({ ...vacationForm, end_date: e.target.value })} /></label>
              <label className="text-sm">Situação<select className="mt-1 w-full rounded bg-slate-800 p-2" value={vacationForm.status} onChange={(e) => setVacationForm({ ...vacationForm, status: e.target.value as Vacation['status'] })}><option value="planned">Planejada</option><option value="scheduled">Programada</option></select></label>
              <label className="text-sm">Ticket do DP<input className="mt-1 w-full rounded bg-slate-800 p-2" value={vacationForm.hr_ticket} onChange={(e) => setVacationForm({ ...vacationForm, hr_ticket: e.target.value })} /></label>
              <label className="text-sm">Abono pecuniário (dias)<input min="0" max="10" type="number" className="mt-1 w-full rounded bg-slate-800 p-2" value={vacationForm.cash_bonus_days} onChange={(e) => setVacationForm({ ...vacationForm, cash_bonus_days: e.target.value })} /></label>
              <label className="flex items-end gap-2 text-sm"><input type="checkbox" checked={vacationForm.thirteenth_advance} onChange={(e) => setVacationForm({ ...vacationForm, thirteenth_advance: e.target.checked })} />Adiantamento do 13º</label>
            </div>
            <label className="mt-3 block text-sm">Observações<textarea className="mt-1 w-full rounded bg-slate-800 p-2" rows={2} value={vacationForm.notes} onChange={(e) => setVacationForm({ ...vacationForm, notes: e.target.value })} /></label>
            <div className="mt-4 flex flex-wrap items-center gap-3"><strong className="rounded bg-cyan-400/15 px-3 py-2 text-cyan-200">{chosenDays ? `${chosenDays} dias corridos` : 'Informe as datas'}</strong><button disabled={saving} className="rounded bg-cyan-500 px-4 py-2 font-bold text-slate-950 disabled:opacity-50">{editingVacationId ? 'Salvar alteração' : 'Registrar período'}</button>{editingVacationId && <button type="button" className="rounded border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-200" onClick={() => { setEditingVacationId(null); setVacationForm(emptyVacation) }}>Cancelar edição</button>}</div>
          </form>

          <aside className="rounded-xl border border-slate-700 bg-slate-900 p-5"><h2 className="text-xl font-bold">Cobertura do período</h2>{!selectedTeam || !chosenDays ? <p className="mt-3 text-sm text-slate-400">Selecione pessoa e período para avaliar a disponibilidade da equipe.</p> : <><p className="mt-3 text-sm text-slate-300"><strong>{teamLookup.get(selectedTeam)?.name}</strong> terá <strong>{selectedTeamPeople.length - selectedAbsentPeople.size}</strong> de {selectedTeamPeople.length} pessoas ativas disponíveis.</p>{periodConflicts.length ? <ul className="mt-4 space-y-2 text-sm text-amber-200">{periodConflicts.map((vacation) => <li key={vacation.id}>Conflito: {peopleLookup.get(vacation.person_id)?.name} — {formatDate(vacation.start_date)} a {formatDate(vacation.end_date)}</li>)}</ul> : <p className="mt-4 text-sm text-emerald-300">Nenhuma sobreposição registrada para este time.</p>}</>}</aside>
        </section>}

        {activeSection === 'people' && <section className="mt-6 grid gap-5 lg:grid-cols-3">
          <form onSubmit={savePerson} className="rounded-xl border border-slate-700 bg-slate-900 p-5 lg:col-span-2"><div className="flex flex-wrap justify-between gap-2"><div><h2 className="text-xl font-bold">Vínculo de pessoas</h2><p className="text-sm text-slate-400">O cadastro de analista e usuário continua sendo a fonte oficial. Aqui ficam somente time, gestor e planejamento de férias.</p></div><button type="button" className="text-sm text-cyan-300" onClick={() => { setSelectedPersonId(''); setPersonForm(emptyPerson) }}>Adicionar colaborador sem cadastro de analista</button></div>
            {selectedPersonComesFromExistingRegistry && <p className="mt-4 rounded-lg border border-cyan-400/20 bg-cyan-400/10 p-3 text-sm text-cyan-100">Este colaborador vem de <strong>{selectedPersonSource}</strong>. Nome, foto e situação ativa são atualizados pelo cadastro de origem; altere aqui apenas o time e o gestor.</p>}
            <div className="mt-4 grid gap-3 md:grid-cols-2"><label className="text-sm">Pessoa<select className="mt-1 w-full rounded bg-slate-800 p-2" value={selectedPersonId} onChange={(e) => choosePerson(e.target.value)}><option value="">Novo colaborador sem cadastro de analista</option>{people.map((person) => <option key={person.id} value={person.id}>{person.name}{person.phone_analyst_id || person.chat_analyst_id ? ' · cadastro existente' : ''}</option>)}</select></label><label className="text-sm">Nome<input required disabled={selectedPersonComesFromExistingRegistry} className="mt-1 w-full rounded bg-slate-800 p-2 disabled:cursor-not-allowed disabled:opacity-55" value={personForm.name} onChange={(e) => setPersonForm({ ...personForm, name: e.target.value })} /></label><label className="text-sm">Time<select className="mt-1 w-full rounded bg-slate-800 p-2" value={personForm.team_id} onChange={(e) => setPersonForm({ ...personForm, team_id: e.target.value })}><option value="">Sem time</option>{teams.filter((team) => team.active).map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label><label className="text-sm">Gestor<select className="mt-1 w-full rounded bg-slate-800 p-2" value={personForm.manager_person_id} onChange={(e) => setPersonForm({ ...personForm, manager_person_id: e.target.value })}><option value="">Sem gestor definido</option>{people.filter((person) => person.id !== selectedPersonId && person.active).map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label><label className="text-sm md:col-span-2">URL da foto<input type="url" disabled={selectedPersonComesFromExistingRegistry} placeholder="https://…" className="mt-1 w-full rounded bg-slate-800 p-2 disabled:cursor-not-allowed disabled:opacity-55" value={personForm.photo_url} onChange={(e) => setPersonForm({ ...personForm, photo_url: e.target.value })} /></label></div><label className="mt-3 flex gap-2 text-sm"><input type="checkbox" disabled={selectedPersonComesFromExistingRegistry} checked={personForm.active} onChange={(e) => setPersonForm({ ...personForm, active: e.target.checked })} />Pessoa ativa</label><button disabled={saving} className="mt-4 rounded bg-cyan-500 px-4 py-2 font-bold text-slate-950 disabled:opacity-50">Salvar vínculo</button></form>
          <form onSubmit={saveTeam} className="rounded-xl border border-slate-700 bg-slate-900 p-5"><h2 className="text-xl font-bold">Times</h2><label className="mt-3 block text-sm">Novo time<input className="mt-1 w-full rounded bg-slate-800 p-2" value={teamName} onChange={(e) => setTeamName(e.target.value)} /></label><button disabled={saving} className="mt-3 rounded border border-cyan-400 px-3 py-2 text-sm font-bold text-cyan-200">Criar time</button><ul className="mt-5 space-y-2 text-sm text-slate-300">{teams.filter((team) => team.active).map((team) => <li key={team.id}>{team.name}<span className="block text-xs text-slate-500">{team.manager_person_id ? `Gestor: ${peopleLookup.get(team.manager_person_id)?.name ?? 'Cadastro pendente'}` : 'Gestor a definir'}</span></li>)}</ul></form>
        </section>}

        {activeSection === 'history' && <section className="mt-6 space-y-5"><div className="rounded-xl border border-indigo-400/25 bg-indigo-400/8 p-5"><div className="flex flex-wrap items-center justify-between gap-4"><div><p className="text-sm font-bold uppercase tracking-[.14em] text-indigo-200">Consulta externa</p><h2 className="mt-1 text-xl font-bold">Férias no Gente Gestão</h2><p className="mt-1 text-sm text-slate-300">Consulta somente leitura, limitada ao seu time e subordinados conforme o escopo do token.</p></div><div className="flex flex-wrap gap-2"><button type="button" disabled={loadingGenteGestao} onClick={consultGenteGestao} className="rounded bg-indigo-300 px-4 py-2 font-bold text-slate-950 disabled:opacity-50">{loadingGenteGestao ? 'Consultando...' : 'Consultar Gente Gestão'}</button>{genteGestaoVacations.length > 0 && <button type="button" onClick={closeGenteGestaoConsult} className="rounded border border-indigo-200/50 px-4 py-2 font-bold text-indigo-100">Fechar consulta</button>}</div></div>{genteGestaoMessage && <p className="mt-4 text-sm text-indigo-100">{genteGestaoMessage}</p>}{genteGestaoVacations.length > 0 && <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[650px] text-left text-sm"><thead className="border-b border-indigo-300/25 text-indigo-100"><tr><th className="p-2">Colaborador</th><th className="p-2">Início</th><th className="p-2">Fim</th><th className="p-2">Situação</th></tr></thead><tbody>{genteGestaoVacations.map((vacation, index) => <tr className="border-b border-indigo-200/10" key={`${externalValue(vacation, ['id', 'codigo'])}-${index}`}><td className="p-2">{externalValue(vacation, ['colaborador', 'funcionario', 'pessoa', 'usuario', 'nome', 'employee', 'name', 'title', 'titulo'])}</td><td className="p-2">{externalValue(vacation, ['inicio', 'start', 'data_inicio', 'date_start', 'dataInicio'])}</td><td className="p-2">{externalValue(vacation, ['fim', 'termino', 'end', 'data_fim', 'date_end', 'dataFim'])}</td><td className="p-2">{externalValue(vacation, ['situacao', 'status', 'tipo'])}</td></tr>)}</tbody></table></div>}</div><div className="rounded-xl border border-slate-700 bg-slate-900 p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-bold">Períodos e histórico</h2><p className="mt-1 text-sm text-slate-400">Planejadas ficam em vermelho, programadas em verde. Períodos encerrados permanecem no histórico para consulta.</p></div><strong className="rounded bg-slate-800 px-3 py-2 text-sm text-slate-200">{filteredVacations.length} resultado(s)</strong></div><div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5"><label className="text-sm">Time<select className="mt-1 w-full rounded bg-slate-800 p-2" value={periodTeamFilter} onChange={(event) => { setPeriodTeamFilter(event.target.value); setPeriodPersonFilter('') }}><option value="">Todos os times</option>{teams.filter((team) => team.active).map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label><label className="text-sm">Pessoa<select className="mt-1 w-full rounded bg-slate-800 p-2" value={periodPersonFilter} onChange={(event) => setPeriodPersonFilter(event.target.value)}><option value="">Todas as pessoas</option>{people.filter((person) => !periodTeamFilter || person.team_id === periodTeamFilter).map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label><label className="text-sm">Situação<select className="mt-1 w-full rounded bg-slate-800 p-2" value={periodStatusFilter} onChange={(event) => setPeriodStatusFilter(event.target.value as VacationListStatus)}><option value="all">Todas</option><option value="planned">Planejada</option><option value="scheduled">Programada</option><option value="completed">Concluída</option><option value="cancelled">Cancelada</option></select></label><label className="text-sm">Período a partir de<input type="date" className="mt-1 w-full rounded bg-slate-800 p-2" value={periodStartFilter} onChange={(event) => setPeriodStartFilter(event.target.value)} /></label><label className="text-sm">Período até<input type="date" className="mt-1 w-full rounded bg-slate-800 p-2" value={periodEndFilter} onChange={(event) => setPeriodEndFilter(event.target.value)} /></label></div><div className="mt-5 flex flex-wrap gap-3 text-xs"><span className="rounded-full border border-red-400/45 bg-red-400/10 px-3 py-1 text-red-200">Planejada · aguardando confirmação</span><span className="rounded-full border border-emerald-400/45 bg-emerald-400/10 px-3 py-1 text-emerald-200">Programada · confirmada</span><span className="rounded-full border border-slate-500/55 bg-slate-700/45 px-3 py-1 text-slate-200">Concluída · histórico</span></div><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="border-b border-slate-700 text-slate-400"><tr><th className="p-2">Pessoa</th><th className="p-2">Time</th><th className="p-2">Período</th><th className="p-2">Dias</th><th className="p-2">Situação</th><th className="p-2">DP</th><th className="p-2">Ações</th></tr></thead><tbody>{filteredVacations.map((vacation) => { const person = peopleLookup.get(vacation.person_id); const displayStatus = getVacationListStatus(vacation); return <tr className="border-b border-slate-800" key={vacation.id}><td className="p-2">{person?.name ?? 'Pessoa removida'}</td><td className="p-2">{person?.team_id ? teamLookup.get(person.team_id)?.name : '—'}</td><td className="p-2">{formatDate(vacation.start_date)} a {formatDate(vacation.end_date)}</td><td className="p-2">{vacation.days}</td><td className="p-2"><span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${statusTone(displayStatus)}`}>{statusLabelForList(displayStatus)}</span></td><td className="p-2">{vacation.hr_ticket ?? '—'}</td><td className="p-2 whitespace-nowrap"><button disabled={saving} onClick={() => editVacation(vacation)} className="mr-3 text-cyan-300">Editar</button>{vacation.status !== 'cancelled' && <button disabled={saving} onClick={() => cancelVacation(vacation.id)} className="text-amber-300">Cancelar</button>}</td></tr> })}</tbody></table></div></div></section>}
      </div>
    </main>
  )
}
