'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'

type Snapshot = {
  team: { id: string; name: string }
  year: number
  month: number
  people: Array<{ id: string; name: string; active: boolean }>
  memberships: Array<{ person_id: string; team_id: string; start_date: string; end_date: string | null }>
  entries: Array<{ person_id: string; team_id: string; date: string; entry_type: string; value: string }>
}

const MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']

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

  useEffect(() => {
    fetch(`/api/schedule/public/${params.token}`, { cache: 'no-store' })
      .then(async (response) => {
        const body = await response.json()
        if (!response.ok) throw new Error(body.error || 'Não foi possível carregar a escala.')
        setSnapshot(body)
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Erro ao carregar escala.'))
  }, [params.token])

  const days = useMemo(() => snapshot ? businessDays(snapshot.year, snapshot.month) : [], [snapshot])

  if (error) return <main className="min-h-screen bg-slate-950 p-8 text-white"><div className="mx-auto max-w-xl rounded-2xl border border-red-400/30 bg-red-950/30 p-6">{error}</div></main>
  if (!snapshot) return <main className="min-h-screen bg-slate-950 p-8 text-white">Carregando escala...</main>

  const visiblePeople = snapshot.people.filter((person) =>
    snapshot.memberships.some((membership) => membership.person_id === person.id),
  )

  return (
    <main className="min-h-screen bg-slate-950 p-4 text-white sm:p-7">
      <section className="mx-auto max-w-[1600px]">
        <header className="border-b border-white/10 pb-5">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-300">Escala publicada</p>
          <h1 className="mt-2 text-3xl font-bold">{snapshot.team.name}</h1>
          <p className="mt-2 text-slate-400">{MONTHS[snapshot.month - 1]} de {snapshot.year}</p>
        </header>
        <div className="mt-5 flex flex-wrap gap-2">
          {[['hybrid','Híbrido'],['lunch','Almoço'],['snack','Lanche'],['extended','Estendido']].map(([value,label]) => (
            <button key={value} className={entryType === value ? 'primary-button' : 'secondary-button'} onClick={() => setEntryType(value)}>{label}</button>
          ))}
        </div>
        <section className="mt-5 overflow-x-auto rounded-2xl border border-white/10 bg-slate-900/60">
          <table className="min-w-max border-collapse text-sm">
            <thead className="bg-slate-900"><tr>
              <th className="sticky left-0 z-10 min-w-48 border-b border-r border-white/10 bg-slate-900 px-4 py-3 text-left">Colaborador</th>
              {days.map((day) => <th key={day.value} className="min-w-16 border-b border-r border-white/10 px-2 py-3 text-center">{day.day}</th>)}
            </tr></thead>
            <tbody>
              {visiblePeople.map((person) => (
                <tr key={person.id}>
                  <td className="sticky left-0 border-b border-r border-white/10 bg-slate-950 px-4 py-3 font-semibold">{person.name}</td>
                  {days.map((day) => {
                    const membership = snapshot.memberships.find((item) => item.person_id === person.id && item.start_date <= day.value && (!item.end_date || item.end_date >= day.value))
                    if (!membership) return <td key={day.value} className="border-b border-r border-white/10 text-center text-slate-600">—</td>
                    const entry = snapshot.entries.find((item) => item.person_id === person.id && item.date === day.value && item.entry_type === entryType)
                    return <td key={day.value} className="border-b border-r border-white/10 px-2 py-3 text-center">{entry?.value ?? '—'}</td>
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <p className="mt-4 text-xs text-slate-500">Link somente para consulta. Regras e funções de gestão não são expostas.</p>
      </section>
    </main>
  )
}
