'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

type Person = { id: string; name: string; active: boolean }
type SaturdayMember = { id: string; person_id: string; role: 'fixed'|'rotating'; start_date: string; end_date: string | null; active: boolean }
type SaturdayEntry = { id?: string; person_id: string; team_id: string; date: string; entry_type: 'saturday'; value: string; source: string; locked?: boolean }
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

  async function endMember(member: SaturdayMember) {
    const endDate = window.prompt('Encerrar participação em (AAAA-MM-DD):', new Date().toISOString().slice(0,10))
    if (!endDate) return
    const { error } = await supabase.from('schedule_saturday_members').update({ end_date: endDate, active: false }).eq('id', member.id)
    if (error) return setMessage(error.message)
    await load()
  }

  async function generate() {
    if (!team) return
    const fixed = members.filter((item) => item.active && item.role === 'fixed')
    const rotating = members.filter((item) => item.active && item.role === 'rotating')
    const counts = new Map<string, number>()
    const rows: SaturdayEntry[] = []

    for (const date of dates) {
      const eligible = eligibleOnDate(date)
      const fixedEligible = fixed.filter((item) => eligible.some((e) => e.id === item.id))
      const rotatingEligible = rotating.filter((item) => eligible.some((e) => e.id === item.id))

      if (fixedEligible[0]) {
        rows.push({ person_id: fixedEligible[0].person_id, team_id: team.id, date, entry_type: 'saturday', value: 'Fixo', source: 'generated' })
        counts.set(fixedEligible[0].person_id, (counts.get(fixedEligible[0].person_id) ?? 0) + 1)
      }

      const second = rotatingEligible
        .sort((a,b) => (counts.get(a.person_id) ?? 0) - (counts.get(b.person_id) ?? 0))[0]

      if (second) {
        rows.push({ person_id: second.person_id, team_id: team.id, date, entry_type: 'saturday', value: 'Rodízio', source: 'generated' })
        counts.set(second.person_id, (counts.get(second.person_id) ?? 0) + 1)
      }
    }

    const manualKeys = new Set(entries.filter((item) => item.source === 'manual' || item.locked).map((item) => `${item.person_id}|${item.date}`))
    const payload = rows.filter((row) => !manualKeys.has(`${row.person_id}|${row.date}`))
    const { error } = await supabase.from('schedule_entries').upsert(payload, { onConflict:'person_id,team_id,date,entry_type' })
    if (error) return setMessage(error.message)
    setMessage('Sábados futuros gerados sem sobrescrever trocas manuais.')
    await load()
  }

  async function replace(date: string, oldPersonId: string) {
    if (!team) return
    const eligible = eligibleOnDate(date)
    const names = eligible.map((item) => people.find((person) => person.id === item.person_id)).filter(Boolean) as Person[]
    const chosenName = window.prompt('Digite exatamente o nome do substituto:\n' + names.map((item) => item.name).join('\n'))
    if (!chosenName) return
    const chosen = names.find((item) => item.name.toLowerCase() === chosenName.trim().toLowerCase())
    if (!chosen) return setMessage('Nome não encontrado entre os elegíveis para este sábado.')

    const current = entries.find((item) => item.date === date && item.person_id === oldPersonId && item.entry_type === 'saturday')
    if (current?.id) await supabase.from('schedule_entries').delete().eq('id', current.id)
    const { error } = await supabase.from('schedule_entries').upsert({
      person_id: chosen.id,
      team_id: team.id,
      date,
      entry_type:'saturday',
      value:'Substituição',
      source:'manual',
      locked:true,
    }, { onConflict:'person_id,team_id,date,entry_type' })
    if (error) return setMessage(error.message)
    await load()
  }

  const byMonth = useMemo(() => Array.from({ length: 12 }, (_, month) =>
    dates.filter((date) => new Date(`${date}T12:00:00`).getUTCMonth() === month)
  ), [dates])

  return (
    <main className="min-h-screen bg-slate-950 p-4 text-white sm:p-7">
      <section className="mx-auto max-w-[1600px]">
        <div className="mb-4 rounded-xl border border-amber-400/40 bg-amber-950/30 px-4 py-3 text-sm">🧪 Homologação — rodízio de sábados</div>
        <header className="flex flex-col gap-4 border-b border-white/10 pb-5 lg:flex-row lg:items-center lg:justify-between">
          <div><p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-300">Painel de Escalas</p><h1 className="mt-2 text-3xl font-bold">Sábados {year}</h1><p className="mt-2 text-slate-400">Uma vaga fixa e uma vaga de rodízio, com trocas manuais preservadas.</p></div>
          <div className="flex gap-2"><Link className="secondary-button" href="/escalas">Escalas mensais</Link><Link className="secondary-button" href="/">Performance</Link></div>
        </header>

        {message && <div className="mt-4 rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm">{message}</div>}

        <section className="mt-6 grid gap-4 rounded-2xl border border-white/10 bg-slate-900/60 p-5 lg:grid-cols-[160px_1fr_auto]">
          <label className="grid gap-1 text-sm">Ano<input className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2" type="number" value={year} onChange={(e)=>setYear(Number(e.target.value))}/></label>
          <div className="grid gap-3 sm:grid-cols-3">
            <select className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2" value={newPersonId} onChange={(e)=>setNewPersonId(e.target.value)}><option value="">Adicionar participante...</option>{people.filter((p)=>p.active).map((p)=><option key={p.id} value={p.id}>{p.name}</option>)}</select>
            <select className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2" value={newRole} onChange={(e)=>setNewRole(e.target.value as 'fixed'|'rotating')}><option value="fixed">Fixo</option><option value="rotating">Rodízio</option></select>
            <input className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2" type="date" value={newStart} onChange={(e)=>setNewStart(e.target.value)}/>
          </div>
          <div className="flex items-end gap-2"><button className="secondary-button" onClick={addMember}>Adicionar</button><button className="primary-button" onClick={generate}>Gerar sábados</button></div>
        </section>

        <section className="mt-5 rounded-2xl border border-white/10 bg-slate-900/60 p-5">
          <h2 className="text-lg font-bold">Equipe do rodízio</h2>
          <div className="mt-3 flex flex-wrap gap-2">{members.map((member)=>{const person=people.find((p)=>p.id===member.person_id); return <div key={member.id} className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm"><strong>{person?.name ?? 'Pessoa'}</strong> · {member.role === 'fixed' ? 'Fixo' : 'Rodízio'} · desde {member.start_date}{member.end_date ? ` até ${member.end_date}` : ''} {!member.end_date && <button className="ml-2 text-amber-300" onClick={()=>endMember(member)}>Encerrar</button>}</div>})}</div>
        </section>

        <section className="mt-5 overflow-x-auto rounded-2xl border border-white/10 bg-slate-900/60 p-4">
          <div className="grid min-w-[1200px] grid-cols-4 gap-4 xl:grid-cols-6">
            {byMonth.map((monthDates, monthIndex)=>(
              <div key={monthIndex} className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
                <h3 className="mb-3 font-bold">{new Date(year, monthIndex, 1).toLocaleDateString('pt-BR',{month:'long'})}</h3>
                <div className="grid gap-3">
                  {monthDates.map((date)=>{
                    const dayEntries=entries.filter((item)=>item.date===date)
                    return <div key={date} className="rounded-lg border border-white/10 p-3"><div className="text-xs text-slate-400">{new Date(`${date}T12:00:00`).toLocaleDateString('pt-BR')}</div>{dayEntries.map((item)=>{const person=people.find((p)=>p.id===item.person_id); return <button key={item.id ?? item.person_id} className="mt-2 block w-full rounded-md bg-slate-800 px-2 py-2 text-left text-sm hover:bg-slate-700" onClick={()=>replace(date,item.person_id)}>{person?.name ?? '—'} <span className="float-right text-xs text-slate-500">{item.value}</span></button>})}{dayEntries.length<2 && <div className="mt-2 text-sm text-amber-300">Vaga disponível</div>}</div>
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
