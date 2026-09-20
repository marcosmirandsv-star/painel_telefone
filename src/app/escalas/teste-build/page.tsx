import { planWeeklyHybrid } from '@/lib/schedule-hybrid-planner'

export const dynamic = 'force-static'

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Schedule planner self-test failed: ${message}`)
}

function runPlannerSelfTest() {
  const dates = [
    ['2026-10-05', 1],
    ['2026-10-06', 2],
    ['2026-10-07', 3],
    ['2026-10-08', 4],
    ['2026-10-09', 5],
  ] as const

  const people = Array.from({ length: 7 }, (_, index) => ({
    id: `p${index + 1}`,
    name: `Pessoa ${index + 1}`,
    remaining: 2,
    preservedHoDates: [] as string[],
    candidates: dates.map(([date, weekday]) => ({ date, weekday })),
    fixedWeekdays: index === 0 ? [1, 2] : [],
    preferredWeekdays: index === 1 ? [1, 5] : [],
  }))

  const requiredHoByDate = {
    '2026-10-05': 2,
    '2026-10-06': 2,
    '2026-10-07': 2,
    '2026-10-08': 2,
  }

  const requiredEligibleByDate = {
    '2026-10-05': people.map((person) => person.id),
    '2026-10-06': people.map((person) => person.id).filter((id) => id !== 'p7'),
    '2026-10-07': people.map((person) => person.id),
    '2026-10-08': people.map((person) => person.id).filter((id) => id !== 'p6'),
  }

  const plan = planWeeklyHybrid({ people, requiredHoByDate, requiredEligibleByDate })

  for (const person of people) {
    assert((plan.get(person.id)?.size ?? 0) === 2, `${person.name} deve ter 2 dias de HO`)
  }

  for (const [date, required] of Object.entries(requiredHoByDate)) {
    const eligible = new Set(requiredEligibleByDate[date as keyof typeof requiredEligibleByDate])
    const coverage = people.filter(
      (person) => eligible.has(person.id) && plan.get(person.id)?.has(date),
    ).length
    assert(coverage >= required, `${date} precisa ter ${required} pessoas elegíveis em HO`)
  }

  assert(plan.get('p1')?.has('2026-10-05') === true, 'dia fixo de segunda deve ser respeitado')
  assert(plan.get('p1')?.has('2026-10-06') === true, 'dia fixo de terça deve ser respeitado')

  const holidayPeople = people.map((person) => ({
    ...person,
    remaining: 1,
    fixedWeekdays: [],
  }))
  const holidayPlan = planWeeklyHybrid({
    people: holidayPeople,
    requiredHoByDate: {
      '2026-10-13': 2,
      '2026-10-14': 2,
      '2026-10-15': 2,
    },
    requiredEligibleByDate: {
      '2026-10-13': holidayPeople.map((person) => person.id),
      '2026-10-14': holidayPeople.map((person) => person.id),
      '2026-10-15': holidayPeople.map((person) => person.id),
    },
  })

  for (const person of holidayPeople) {
    assert((holidayPlan.get(person.id)?.size ?? 0) === 1, `${person.name} deve ter 1 HO adicional na semana com feriado`)
  }

  return 'OK'
}

const status = runPlannerSelfTest()

export default function ScheduleBuildTestPage() {
  return (
    <main style={{ padding: 24 }}>
      <h1>Teste interno do planejador de escala</h1>
      <p>Status: {status}</p>
    </main>
  )
}
