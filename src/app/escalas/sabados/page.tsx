'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { scheduleSupabase as supabase } from '@/lib/schedule-supabase'
import { ScheduleModal } from '@/components/schedule-modal'

type Person = { id: string; name: string; active: boolean }
type SaturdayMember = { id: string; person_id: string; role: 'fixed'|'rotating'; start_date: string; end_date: string | null; active: boolean }
type SaturdayEntry = {
  id?: string
  person_id: string
  team_id: string
  date: string
  entry_type: 'saturday'
  value: string
  source: string
  locked?: boolean
  metadata?: { slot?: 'fixed' | 'rotating' }
}
type Team = { id: string; code: string; name: string }

function saturdays(year: number) {
  const dates: string[] = []
  const start = new Date(Date.UTC(year, 0, 1, 12))
  const end = new Date(Date.UTC(year, 11, 31, 12))
  for (let d = start; d <= end; d = new Date(d.getTime() + 86400000)) {
    if (d.getUTCDay() === 6) dates.push(d.toISOString().slice(0,10))
  }
  return dates
}

export default function SaturdaySchedulePage() {
  const [year, setYear] = useState(new Date().getFullYear())
  const [people, setPeople] = useState<Person[]>([])
  const [members, setMembers] = useState<SaturdayMember[]>([])
  const [entries, setEntries] = useState<SaturdayEntry[]>([])
  const [team, setTeam] = useState<Team | null>(null)
  const [message, setMessage] = useState('')
  const [newPersonId, setNewPersonId] = useState('')
  const [newRole, setNewRole] = useState<'fixed'|'rotating'>('rotating')
  const [newStart, setNewStart] = useState(`${year}-01-01`)
  const [endDialogMember, setEndDialogMember] = useState<SaturdayMember | null>(null)
  const [endDate, setEndDate] = useState(new Date().toISOString().slice(0,10))
  const [replaceDialog, setReplaceDialog] = useState<{date:string; current:SaturdayEntry; slot:'fixed'|'rotating'; candidates:Person[]}|null>(null)
  const [replacementPersonId, setReplacementPersonId] = useState('')

  const dates = useMemo(() => saturdays(year), [year])

  async function load() {
    const [{ data: peopleData }, { data: teamData }, { data: memberData }, { data: entryData }] = await Promise.all([
      supabase.from('schedule_people').select('id,name,active').order('name'),
      supabase.from('schedule_teams').select('id,code,name').eq('code','sabados').maybeSingle(),
      supabase.from('schedule_saturday_members').select('*').order('start_date'),
      supabase.from('schedule_entries').select('*').eq('entry_type','saturday').gte('date', `${year}-01-01`).lte('date', `${year}-12-31`),
    ])
    setPeople((peopleData ?? []) as Person[])
    setTeam(teamData as Team | null)
    setMembers((memberData ?? []) as SaturdayMember[])
    setEntries((entryData ?? []) as SaturdayEntry[])
  }

  useEffect(() => { load() }, [year])

  function eligibleOnDate(date: string) {
    return members.filter((member) =>
      member.active &&
      member.start_date <= date &&
      (!member.end_date || member.end_date >= date),
    )
  }

  async function addMember() {
    if (!newPersonId) return
    const { error } = await supabase.from('schedule_saturday_members').insert({
      person_id: newPersonId,
      role: newRole,
      start_date: newStart,
      active: true,
    })
    if (error) return setMessage(error.message)
    setMessage('Participante incluído no rodízio.')
    await load()
  }

  function openEndMember(member: SaturdayMember) {
    setEndDate(new Date().toISOString().slice(0,10))
    setEndDialogMember(member)
  }

  async function confirmEndMember() {
    if (!endDialogMember || !endDate) return
    const { error } = await supabase
      .from('schedule_saturday_members')
      .update({ end_date: endDate, active: false })
      .eq('id', endDialogMember.id)
    if (error) return setMessage(error.message)
    setEndDialogMember(null)
    setMessage('Participação encerrada com vigência preservada.')
    await load()
  }

  async function generate() {
    if (!team) return
    const fixed = members.filter((item) => item.role === 'fixed')
    const rotating = members.filter((item) => item.role === 'rotating')
    const counts = new Map<string, number>()
    const eligibleCounts = new Map<string, number>()
    const rows: SaturdayEntry[] = []

    for (const date of dates) {
      const eligible = eligibleOnDate(date)
      const fixedEligible = fixed.filter((item) => eligible.some((e) => e.id === item.id))
      const rotatingEligible = rotating.filter((item) => eligible.some((e) => e.id === item.id))
      const manualEntries = entries.filter(
        (item) => item.date === date && (item.source === 'manual' || item.locked),
      )
      const manualFixed = manualEntries.find(
        (item) => item.metadata?.slot === 'fixed' || item.value === 'Substituição fixa',
      )
      const manualRotating = manualEntries.find(
        (item) => item.metadata?.slot === 'rotating' || item.value === 'Substituição de rodízio',
      )

      if (!manualFixed && fixedEligible[0]) {
        rows.push({
          person_id: fixedEligible[0].person_id,
          team_id: team.id,
          date,
          entry_type: 'saturday',
          value: 'Fixo',
          source: 'generated',
          metadata: { slot: 'fixed' },
        })
      }

      for (const candidate of rotatingEligible) {
        eligibleCounts.set(candidate.person_id, (eligibleCounts.get(candidate.person_id) ?? 0) + 1)
      }

      if (manualRotating) {
        counts.set(manualRotating.person_id, (counts.get(manualRotating.person_id) ?? 0) + 1)
        continue
      }

      const second = [...rotatingEligible]
        .sort((a, b) => {
          const aEligible = eligibleCounts.get(a.person_id) ?? 1
          const bEligible = eligibleCounts.get(b.person_id) ?? 1
          const aRate = (counts.get(a.person_id) ?? 0) / aEligible
          const bRate = (counts.get(b.person_id) ?? 0) / bEligible
          return aRate - bRate
            || (counts.get(a.person_id) ?? 0) - (counts.get(b.person_id) ?? 0)
            || a.person_id.localeCompare(b.person_id)
        })[0]

      if (second) {
        rows.push({
          person_id: second.person_id,
          team_id: team.id,
          date,
          entry_type: 'saturday',
          value: 'Rodízio',
          source: 'generated',
          metadata: { slot: 'rotating' },
        })
        counts.set(second.person_id, (counts.get(second.person_id) ?? 0) + 1)
      }
    }

    const { error: cleanupError } = await supabase
      .from('schedule_entries')
      .delete()
      .eq('team_id', team.id)
      .eq('entry_type', 'saturday')
      .gte('date', `${year}-01-01`)
      .lte('date', `${year}-12-31`)
      .eq('source', 'generated')
      .eq('locked', false)
    if (cleanupError) return setMessage(cleanupError.message)

    const { error } = await supabase
      .from('schedule_entries')
      .upsert(rows, { onConflict:'person_id,team_id,date,entry_type' })
    if (error) return setMessage(error.message)
    setMessage('Sábados gerados respeitando vigência, equilíbrio proporcional e trocas manuais.')
    await load()
  }

  function openReplace(date: string, oldPersonId: string) {
    if (!team) return
    const current = entries.find(
      (item) => item.date === date && item.person_id === oldPersonId && item.entry_type === 'saturday',
    )
    if (!current) return
    const slot: 'fixed' | 'rotating' =
      current.metadata?.slot ??
      (current.value === 'Fixo' || current.value === 'Substituição fixa' ? 'fixed' : 'rotating')

    const alreadyScheduled = new Set(
      entries.filter((item) => item.date === date && item.person_id !== oldPersonId).map((item) => item.person_id),
    )
    const candidates = eligibleOnDate(date)
      .map((item) => people.find((person) => person.id === item.person_id))
      .filter((person): person is Person => person !== undefined && !alreadyScheduled.has(person.id))

    setReplacementPersonId(candidates[0]?.id ?? '')
    setReplaceDialog({ date, current, slot, candidates })
  }

  async function confirmReplace() {
    if (!team || !replaceDialog || !replacementPersonId) return
    const chosen = replaceDialog.candidates.find((item) => item.id === replacementPersonId)
    if (!chosen) return setMessage('Selecione uma pessoa elegível para este sábado.')

    if (replaceDialog.current.id) {
      await supabase.from('schedule_entries').delete().eq('id', replaceDialog.current.id)
    }

    const { error } = await supabase.from('schedule_entries').upsert({
      person_id: chosen.id,
      team_id: team.id,
      date: replaceDialog.date,
      entry_type:'saturday',
      value: replaceDialog.slot === 'fixed' ? 'Substituição fixa' : 'Substituição de rodízio',
      source:'manual',
      locked:true,
      metadata:{ slot: replaceDialog.slot },
    }, { onConflict:'person_id,team_id,date,entry_type' })
    if (error) return setMessage(error.message)

    setReplaceDialog(null)
    setMessage('Troca registrada e protegida contra nova geração.')
    await load()
  }

  const byMonth = useMemo(() => Array.from({ length: 12 }, (_, month) =>
    dates.filter((date) => new Date(`${date}T12:00:00`).getUTCMonth() === month)
  ), [dates])

  return (
    <main className="schedule-shell p-4 sm:p-7">
      {endDialogMember && (
        <ScheduleModal
          title="Encerrar participação no rodízio"
          description="O histórico dos sábados anteriores será preservado."
          tone="danger"
          onClose={() => setEndDialogMember(null)}
          footer={
            <>
              <button className="secondary-button" onClick={() => setEndDialogMember(null)}>Cancelar</button>
              <button className="danger-button" onClick={confirmEndMember}>Encerrar participação</button>
            </>
          }
        >
          <div className="schedule-inline-note">
            <strong>{people.find((person) => person.id === endDialogMember.person_id)?.name ?? 'Pessoa'}</strong>
            <br />
            {endDialogMember.role === 'fixed' ? 'Participante fixo' : 'Participante do rodízio'}
          </div>
          <label className="schedule-field">
            Último dia de participação
            <input className="px-3 py-2" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
          </label>
        </ScheduleModal>
      )}

      {replaceDialog && (
        <ScheduleModal
          title="Substituir pessoa no sábado"
          description="A troca será protegida e não será sobrescrita quando os sábados forem gerados novamente."
          onClose={() => setReplaceDialog(null)}
          footer={
            <>
              <button className="secondary-button" onClick={() => setReplaceDialog(null)}>Cancelar</button>
              <button className="primary-button" onClick={confirmReplace} disabled={!replacementPersonId}>Confirmar troca</button>
            </>
          }
        >
          <div className="schedule-inline-note">
            {new Date(`${replaceDialog.date}T12:00:00`).toLocaleDateString('pt-BR')} · {replaceDialog.slot === 'fixed' ? 'Vaga fixa' : 'Vaga de rodízio'}
          </div>
          <label className="schedule-field">
            Substituto
            <select className="px-3 py-2" value={replacementPersonId} onChange={(event) => setReplacementPersonId(event.target.value)}>
              {replaceDialog.candidates.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
            </select>
          </label>
        </ScheduleModal>
      )}

      <section className="mx-auto max-w-[1600px]">
        <div className="schedule-banner-homologation mb-4 px-4 py-3 text-sm"><strong>Ambiente de homologação</strong> · rodízio de sábados</div>
        <header className="schedule-topbar flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div><p className="schedule-kicker">Painel de Escalas</p><h1 className="schedule-heading mt-2 text-3xl font-bold">Sábados {year}</h1><p className="schedule-subtitle mt-2">Uma vaga fixa e uma vaga de rodízio, com trocas manuais preservadas.</p></div>
          <div className="flex gap-2"><Link className="secondary-button" href="/escalas">Escalas mensais</Link><Link className="secondary-button" href="/">Performance</Link></div>
        </header>

        {message && <div className="mt-4 rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm">{message}</div>}

        <section className="mt-6 grid gap-4 schedule-card p-5 lg:grid-cols-[160px_1fr_auto]">
          <label className="grid gap-1 text-sm">Ano<input className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2" type="number" value={year} onChange={(e)=>setYear(Number(e.target.value))}/></label>
          <div className="grid gap-3 sm:grid-cols-3">
            <select className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2" value={newPersonId} onChange={(e)=>setNewPersonId(e.target.value)}><option value="">Adicionar participante...</option>{people.filter((p)=>p.active).map((p)=><option key={p.id} value={p.id}>{p.name}</option>)}</select>
            <select className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2" value={newRole} onChange={(e)=>setNewRole(e.target.value as 'fixed'|'rotating')}><option value="fixed">Fixo</option><option value="rotating">Rodízio</option></select>
            <input className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2" type="date" value={newStart} onChange={(e)=>setNewStart(e.target.value)}/>
          </div>
          <div className="flex items-end gap-2"><button className="secondary-button" onClick={addMember}>Adicionar</button><button className="primary-button" onClick={generate}>Gerar sábados</button></div>
        </section>

        <section className="mt-5 schedule-card p-5">
          <h2 className="text-lg font-bold">Equipe do rodízio</h2>
          <div className="mt-3 flex flex-wrap gap-2">{members.map((member)=>{const person=people.find((p)=>p.id===member.person_id); return <div key={member.id} className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm"><strong>{person?.name ?? 'Pessoa'}</strong> · {member.role === 'fixed' ? 'Fixo' : 'Rodízio'} · desde {member.start_date}{member.end_date ? ` até ${member.end_date}` : ''} {!member.end_date && <button className="ml-2 text-amber-300" onClick={()=>openEndMember(member)}>Encerrar</button>}</div>})}</div>
        </section>

        <section className="mt-5 overflow-x-auto schedule-card p-4">
          <div className="grid min-w-[1200px] grid-cols-4 gap-4 xl:grid-cols-6">
            {byMonth.map((monthDates, monthIndex)=>(
              <div key={monthIndex} className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
                <h3 className="mb-3 font-bold">{new Date(year, monthIndex, 1).toLocaleDateString('pt-BR',{month:'long'})}</h3>
                <div className="grid gap-3">
                  {monthDates.map((date)=>{
                    const dayEntries=entries.filter((item)=>item.date===date)
                    return <div key={date} className="rounded-lg border border-white/10 p-3"><div className="text-xs text-slate-400">{new Date(`${date}T12:00:00`).toLocaleDateString('pt-BR')}</div>{dayEntries.map((item)=>{const person=people.find((p)=>p.id===item.person_id); return <button key={item.id ?? item.person_id} className="mt-2 block w-full rounded-md bg-slate-800 px-2 py-2 text-left text-sm hover:bg-slate-700" onClick={()=>openReplace(date,item.person_id)}>{person?.name ?? '—'} <span className="float-right text-xs text-slate-500">{item.value}</span></button>})}{dayEntries.length<2 && <div className="mt-2 text-sm text-amber-300">Vaga disponível</div>}</div>
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>
      </section>
    </main>
  )
}
