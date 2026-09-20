import { planWeeklyHybrid } from '@/lib/schedule-hybrid-planner'
import { generateMonthlySchedule } from '@/lib/schedule-engine'
import type { ScheduleGenerationInput } from '@/lib/schedule-types'

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

  const holidayCandidates = [
    { date: '2026-10-13', weekday: 2 },
    { date: '2026-10-14', weekday: 3 },
    { date: '2026-10-15', weekday: 4 },
    { date: '2026-10-16', weekday: 5 },
  ]
  const holidayPeople = people.map((person) => ({
    ...person,
    remaining: 1,
    fixedWeekdays: [],
    candidates: holidayCandidates,
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

function runEngineSelfTest() {
  const team = {
    id: 'team-test',
    code: 'especializado',
    name: 'Time teste',
    manager_name: 'Gestor',
    manager_profile_id: null,
    active: true,
    settings: null,
  }
  const people = Array.from({ length: 4 }, (_, index) => ({
    id: `person-${index + 1}`,
    name: `Analista ${index + 1}`,
    email: null,
    active: true,
    phone_analyst_id: null,
    chat_analyst_id: null,
    profile_id: null,
  }))
  const memberships = people.map((person, index) => ({
    id: `membership-${index + 1}`,
    person_id: person.id,
    team_id: team.id,
    manager_profile_id: null,
    start_date: '2026-01-01',
    end_date: null,
    participates_in_schedule: true,
    participates_hybrid: true,
    participates_lunch: true,
    participates_snack: true,
    participates_extended: true,
  }))
  const rules = [
    {
      id: 'rule-1', team_id: team.id, person_id: null,
      rule_key: 'extended_people_per_day', rule_value: { value: 2 },
      start_date: '2026-01-01', end_date: null, active: true,
    },
    {
      id: 'rule-2', team_id: team.id, person_id: null,
      rule_key: 'extended_weekdays', rule_value: { value: [1, 2, 3, 4] },
      start_date: '2026-01-01', end_date: null, active: true,
    },
    {
      id: 'rule-3', team_id: team.id, person_id: null,
      rule_key: 'ho_lunch_time', rule_value: { value: '13:00' },
      start_date: '2026-01-01', end_date: null, active: true,
    },
  ]

  const input: ScheduleGenerationInput = {
    team,
    people,
    memberships,
    absences: [],
    rules,
    context: { year: 2026, month: 11, holidays: [], optional_days: [] },
    year: 2026,
    month: 11,
    existingEntries: [{
      person_id: 'person-1',
      team_id: team.id,
      date: '2026-11-03',
      entry_type: 'hybrid',
      value: 'P',
      source: 'manual',
      locked: true,
    }],
  }

  const result = generateMonthlySchedule(input)
  const errors = result.validations.filter((item) => item.level === 'error')
  assert(errors.length === 0, `motor completo retornou ${errors.length} erro(s)`)

  const manual = result.entries.find(
    (entry) =>
      entry.person_id === 'person-1' &&
      entry.date === '2026-11-03' &&
      entry.entry_type === 'hybrid',
  )
  assert(manual?.value === 'P' && manual.locked === true, 'ajuste manual deve ser preservado')

  const extendedDates = [...new Set(
    result.entries.filter((entry) => entry.entry_type === 'extended').map((entry) => entry.date),
  )]
  for (const date of extendedDates) {
    const extended = result.entries.filter(
      (entry) => entry.date === date && entry.entry_type === 'extended',
    )
    assert(extended.length === 2, `${date} precisa ter 2 pessoas no estendido`)
    for (const item of extended) {
      const hybrid = result.entries.find(
        (entry) =>
          entry.person_id === item.person_id &&
          entry.date === date &&
          entry.entry_type === 'hybrid',
      )
      assert(hybrid?.value === 'HO', 'estendido precisa estar em HO')
    }
  }

  for (const lunch of result.entries.filter((entry) => entry.entry_type === 'lunch')) {
    const hybrid = result.entries.find(
      (entry) =>
        entry.person_id === lunch.person_id &&
        entry.date === lunch.date &&
        entry.entry_type === 'hybrid',
    )
    if (hybrid?.value === 'HO') {
      assert(lunch.value === '13:00', 'HO deve almoçar às 13:00')
    }
  }

  const snackGroups = new Map<string, number>()
  for (const snack of result.entries.filter((entry) => entry.entry_type === 'snack')) {
    const key = `${snack.date}|${snack.value}`
    snackGroups.set(key, (snackGroups.get(key) ?? 0) + 1)
  }
  assert(
    [...snackGroups.values()].every((count) => count <= 2),
    'lanche não pode ultrapassar 2 pessoas por horário',
  )

  return 'OK'
}

const status = `${runPlannerSelfTest()} / ${runEngineSelfTest()}`

export default function ScheduleBuildTestPage() {
  return (
    <main style={{ padding: 24 }}>
      <h1>Teste interno do planejador de escala</h1>
      <p>Status: {status}</p>
    </main>
  )
}
