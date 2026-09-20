import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateMonthlySchedule } from '../src/lib/schedule-engine.ts'
import type {
  ScheduleGenerationInput,
  SchedulePerson,
  ScheduleRule,
  ScheduleTeam,
} from '../src/lib/schedule-types.ts'

function rule(
  id: string,
  teamId: string,
  key: string,
  value: unknown,
  personId: string | null = null,
): ScheduleRule {
  return {
    id,
    team_id: teamId,
    person_id: personId,
    rule_key: key,
    rule_value: { value },
    start_date: '2026-01-01',
    end_date: null,
    active: true,
  }
}

function people(count: number, prefix: string): SchedulePerson[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-p${index + 1}`,
    name: `${prefix} Pessoa ${index + 1}`,
    email: null,
    active: true,
    phone_analyst_id: null,
    chat_analyst_id: null,
    profile_id: null,
  }))
}

function baseInput(
  team: ScheduleTeam,
  persons: SchedulePerson[],
  rules: ScheduleRule[],
): ScheduleGenerationInput {
  return {
    team,
    people: persons,
    memberships: persons.map((person, index) => ({
      id: `m-${team.code}-${index}`,
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
    })),
    absences: [],
    rules,
    context: { year: 2026, month: 10, holidays: ['2026-10-12'], optional_days: [] },
    year: 2026,
    month: 10,
  }
}

test('Especializado usa almoço preferencial flexível, janelas completas e café sem sobreposição acima de 2', () => {
  const team: ScheduleTeam = {
    id: 'team-especializado',
    code: 'especializado',
    name: 'Suporte Especializado',
    manager_name: 'Marcos',
    manager_profile_id: null,
    active: true,
    settings: null,
  }
  const persons = people(7, 'E')
  const rules = [
    rule('e1', team.id, 'lunch_policy', 'coverage_weighted'),
    rule('e2', team.id, 'lunch_presential_preferred_time', '12:00'),
    rule('e3', team.id, 'lunch_ho_preferred_time', '13:00'),
    rule('e4', team.id, 'lunch_modal_strict', false),
    rule('e5', team.id, 'lunch_windows', { '12:00': '13:00', '13:00': '14:30' }),
    rule('e6', team.id, 'shift_end_by_lunch', { '12:00': '17:30', '13:00': '18:00' }),
    rule('e7', team.id, 'snack_policy', 'balanced_by_lunch'),
    rule('e8', team.id, 'snack_early_slots', ['15:45','16:00','16:15','16:30']),
    rule('e9', team.id, 'snack_late_slots', ['16:30','16:45','17:00','17:15']),
    rule('e10', team.id, 'extended_people_per_day', 2),
    rule('e11', team.id, 'extended_weekdays', [1,2,3,4]),
    rule('e12', team.id, 'extended_shifts', ['09:00-18:30','09:30-19:00']),
    rule('e13', team.id, 'extended_allowed_weekdays', [3,4], persons[0].id),
  ]
  const result = generateMonthlySchedule(baseInput(team, persons, rules))

  assert.equal(result.validations.filter((item) => item.level === 'error').length, 0)

  for (const lunch of result.entries.filter((entry) => entry.entry_type === 'lunch')) {
    if (lunch.value === '12:00') {
      assert.equal(lunch.metadata?.return_time, '13:00')
      assert.equal(lunch.metadata?.shift_end, '17:30')
    }
    if (lunch.value === '13:00') {
      assert.equal(lunch.metadata?.return_time, '14:30')
      assert.equal(lunch.metadata?.shift_end, '18:00')
    }
  }

  const snackCounts = new Map<string, number>()
  for (const snack of result.entries.filter((entry) => entry.entry_type === 'snack')) {
    const key = `${snack.date}|${snack.value}`
    snackCounts.set(key, (snackCounts.get(key) ?? 0) + 1)
  }
  assert.ok([...snackCounts.values()].every((count) => count <= 2))

  for (const extended of result.entries.filter((entry) => entry.entry_type === 'extended')) {
    const hybrid = result.entries.find((entry) =>
      entry.person_id === extended.person_id &&
      entry.date === extended.date &&
      entry.entry_type === 'hybrid'
    )
    assert.equal(hybrid?.value, 'HO')
    if (extended.person_id === persons[0].id) {
      const weekday = new Date(`${extended.date}T12:00:00Z`).getUTCDay()
      assert.ok([3,4].includes(weekday))
    }
  }

  for (const hybrid of result.entries.filter((entry) => entry.entry_type === 'hybrid' && ['P','HO'].includes(entry.value))) {
    const lunch = result.entries.find((entry) =>
      entry.person_id === hybrid.person_id &&
      entry.date === hybrid.date &&
      entry.entry_type === 'lunch'
    )
    const snack = result.entries.find((entry) =>
      entry.person_id === hybrid.person_id &&
      entry.date === hybrid.date &&
      entry.entry_type === 'snack'
    )
    assert.ok(lunch, `Almoço ausente para ${hybrid.person_id} em ${hybrid.date}`)
    assert.ok(snack, `Café ausente para ${hybrid.person_id} em ${hybrid.date}`)

    if (lunch?.value === '12:00') assert.ok((snack?.value ?? '') <= '16:30')
    if (lunch?.value === '13:00') assert.ok((snack?.value ?? '') >= '16:30')
  }
})

test('Telefone mantém café fixo e usa 11h30/13h como preferências de almoço por modalidade', () => {
  const team: ScheduleTeam = {
    id: 'team-telefone',
    code: 'telefone',
    name: 'Telefone',
    manager_name: 'Marcos',
    manager_profile_id: null,
    active: true,
    settings: null,
  }
  const persons = people(8, 'T')
  const fixedSlots = ['15:45','16:00','16:15','16:30','16:45','17:00','17:15','16:00']
  const rules: ScheduleRule[] = [
    rule('t1', team.id, 'lunch_policy', 'by_modality'),
    rule('t2', team.id, 'lunch_presential_preferred_time', '13:00'),
    rule('t3', team.id, 'lunch_ho_preferred_time', '11:30'),
    rule('t4', team.id, 'lunch_modal_strict', false),
    rule('t5', team.id, 'lunch_windows', { '11:30': '13:00', '13:00': '14:00' }),
    rule('t6', team.id, 'shift_end_by_lunch', { '11:30': '18:00', '13:00': '17:30' }),
    rule('t7', team.id, 'snack_policy', 'fixed_by_person'),
    ...persons.map((person, index) =>
      rule(`tf-${index}`, team.id, 'snack_fixed_time', fixedSlots[index], person.id),
    ),
  ]

  const result = generateMonthlySchedule(baseInput(team, persons, rules))

  persons.forEach((person, index) => {
    const snacks = result.entries.filter(
      (entry) => entry.person_id === person.id && entry.entry_type === 'snack',
    )
    assert.ok(snacks.length > 0)
    assert.ok(snacks.every((entry) => entry.value === fixedSlots[index]))
  })

  for (const lunch of result.entries.filter((entry) => entry.entry_type === 'lunch')) {
    const hybrid = result.entries.find((entry) =>
      entry.person_id === lunch.person_id &&
      entry.date === lunch.date &&
      entry.entry_type === 'hybrid'
    )
    if (hybrid?.value === 'HO' && lunch.value === '11:30') {
      assert.equal(lunch.metadata?.return_time, '13:00')
      assert.equal(lunch.metadata?.shift_end, '18:00')
    }
    if (hybrid?.value === 'P' && lunch.value === '13:00') {
      assert.equal(lunch.metadata?.return_time, '14:00')
      assert.equal(lunch.metadata?.shift_end, '17:30')
    }
  }
})

test('Suporte Outros preserva alvo de 5 pessoas às 12h e cobertura experiente quando disponível', () => {
  const team: ScheduleTeam = {
    id: 'team-outros',
    code: 'outros',
    name: 'Suporte Outros',
    manager_name: 'Polyana',
    manager_profile_id: null,
    active: true,
    settings: null,
  }
  const persons = people(11, 'O')
  const experienced = persons.slice(0, 5).map((person) => person.name)
  const rules: ScheduleRule[] = [
    rule('o1', team.id, 'lunch_policy', 'coverage_weighted'),
    rule('o2', team.id, 'lunch_presential_preferred_time', '12:00'),
    rule('o3', team.id, 'lunch_ho_preferred_time', '13:00'),
    rule('o4', team.id, 'lunch_modal_strict', false),
    rule('o5', team.id, 'lunch_slot_targets', { '12:00': 5 }),
    rule('o6', team.id, 'experienced_people', experienced),
    rule('o7', team.id, 'experienced_min_at_12', 3),
    rule('o8', team.id, 'lunch_windows', { '12:00': '13:00', '13:00': '14:30' }),
    rule('o9', team.id, 'snack_policy', 'balanced_by_lunch'),
  ]

  const result = generateMonthlySchedule(baseInput(team, persons, rules))
  const errors = result.validations.filter((item) => item.level === 'error')
  assert.deepEqual(errors, [], JSON.stringify(errors, null, 2))

  const dates = [...new Set(result.entries
    .filter((entry) => entry.entry_type === 'lunch')
    .map((entry) => entry.date))]

  for (const date of dates) {
    const lunches = result.entries.filter((entry) => entry.entry_type === 'lunch' && entry.date === date)
    assert.equal(lunches.filter((entry) => entry.value === '12:00').length, 5)
  }
})


test('Semana com feriado conta o feriado como um dos dois dias de HO e não cria Estendido no feriado', () => {
  const team: ScheduleTeam = {
    id: 'team-holiday',
    code: 'especializado',
    name: 'Especializado',
    manager_name: 'Marcos',
    manager_profile_id: null,
    active: true,
    settings: null,
  }
  const persons = people(7, 'F')
  const rules = [
    rule('fh1', team.id, 'extended_people_per_day', 2),
    rule('fh2', team.id, 'extended_weekdays', [1,2,3,4]),
    rule('fh3', team.id, 'extended_shifts', ['09:00-18:30','09:30-19:00']),
    rule('fh4', team.id, 'lunch_policy', 'coverage_weighted'),
    rule('fh5', team.id, 'lunch_presential_preferred_time', '12:00'),
    rule('fh6', team.id, 'lunch_ho_preferred_time', '13:00'),
    rule('fh7', team.id, 'snack_policy', 'balanced_by_lunch'),
  ]
  const input = baseInput(team, persons, rules)
  input.context = { year: 2026, month: 10, holidays: ['2026-10-12'], optional_days: [], click_days: [] }
  const result = generateMonthlySchedule(input)

  for (const person of persons) {
    const week = result.entries.filter(
      (entry) =>
        entry.person_id === person.id &&
        entry.entry_type === 'hybrid' &&
        entry.date >= '2026-10-12' &&
        entry.date <= '2026-10-16',
    )
    assert.equal(week.filter((entry) => entry.value === 'FERIADO').length, 1)
    assert.equal(week.filter((entry) => entry.value === 'HO').length, 1)
  }

  assert.equal(
    result.entries.filter((entry) => entry.date === '2026-10-12' && entry.entry_type === 'extended').length,
    0,
  )
})

test('Click Day força presencialidade, remaneja o HO, mantém almoço/café já calculados e remove Estendido', () => {
  const team: ScheduleTeam = {
    id: 'team-clickday',
    code: 'especializado',
    name: 'Especializado',
    manager_name: 'Marcos',
    manager_profile_id: null,
    active: true,
    settings: null,
  }
  const persons = people(7, 'C')
  const rules = [
    rule('c1', team.id, 'lunch_policy', 'coverage_weighted'),
    rule('c2', team.id, 'lunch_presential_preferred_time', '12:00'),
    rule('c3', team.id, 'lunch_ho_preferred_time', '13:00'),
    rule('c4', team.id, 'lunch_windows', { '12:00': '13:00', '13:00': '14:30' }),
    rule('c5', team.id, 'snack_policy', 'balanced_by_lunch'),
    rule('c6', team.id, 'snack_early_slots', ['15:45','16:00','16:15','16:30']),
    rule('c7', team.id, 'snack_late_slots', ['16:30','16:45','17:00','17:15']),
    rule('c8', team.id, 'extended_people_per_day', 2),
    rule('c9', team.id, 'extended_weekdays', [1,2,3,4]),
    rule('c10', team.id, 'extended_shifts', ['09:00-18:30','09:30-19:00']),
  ]

  const initialInput = baseInput(team, persons, rules)
  initialInput.context = { year: 2026, month: 10, holidays: [], optional_days: [], click_days: [] }
  const initial = generateMonthlySchedule(initialInput)

  assert.ok(
    initial.entries.some(
      (entry) => entry.date === '2026-10-21' && entry.entry_type === 'hybrid' && entry.value === 'HO',
    ),
    'cenário base precisa ter HO no dia escolhido para Click Day',
  )

  const clickInput: ScheduleGenerationInput = {
    ...initialInput,
    context: { ...initialInput.context, click_days: ['2026-10-21'] },
    existingEntries: initial.entries,
    preserveExistingLunchSnack: true,
  }
  const recalculated = generateMonthlySchedule(clickInput)
  assert.deepEqual(
    recalculated.validations.filter((item) => item.level === 'error'),
    [],
    JSON.stringify(recalculated.validations.filter((item) => item.level === 'error'), null, 2),
  )

  for (const previous of initial.entries.filter(
    (entry) => entry.entry_type === 'lunch' || entry.entry_type === 'snack',
  )) {
    const after = recalculated.entries.find(
      (entry) =>
        entry.person_id === previous.person_id &&
        entry.date === previous.date &&
        entry.entry_type === previous.entry_type,
    )
    assert.equal(
      after?.value,
      previous.value,
      `Click Day não deve reorganizar ${previous.entry_type} já publicado em ${previous.date}`,
    )
  }

  const clickHybrid = recalculated.entries.filter(
    (entry) => entry.date === '2026-10-21' && entry.entry_type === 'hybrid',
  )
  assert.ok(clickHybrid.length > 0)
  assert.ok(clickHybrid.every((entry) => entry.value !== 'HO'))
  assert.ok(clickHybrid.every((entry) => entry.value === 'CLICK_DAY'))

  assert.equal(
    recalculated.entries.filter(
      (entry) => entry.date === '2026-10-21' && entry.entry_type === 'extended',
    ).length,
    0,
  )

  for (const person of persons) {
    const beforeLunch = initial.entries.find(
      (entry) => entry.person_id === person.id && entry.date === '2026-10-21' && entry.entry_type === 'lunch',
    )
    const afterLunch = recalculated.entries.find(
      (entry) => entry.person_id === person.id && entry.date === '2026-10-21' && entry.entry_type === 'lunch',
    )
    const beforeSnack = initial.entries.find(
      (entry) => entry.person_id === person.id && entry.date === '2026-10-21' && entry.entry_type === 'snack',
    )
    const afterSnack = recalculated.entries.find(
      (entry) => entry.person_id === person.id && entry.date === '2026-10-21' && entry.entry_type === 'snack',
    )
    assert.equal(afterLunch?.value, beforeLunch?.value)
    assert.equal(afterSnack?.value, beforeSnack?.value)

    const weekHo = recalculated.entries.filter(
      (entry) =>
        entry.person_id === person.id &&
        entry.entry_type === 'hybrid' &&
        entry.date >= '2026-10-19' &&
        entry.date <= '2026-10-23' &&
        entry.value === 'HO',
    )
    assert.equal(weekHo.length, 2, `${person.name} precisa manter dois HOs na semana do Click Day`)
  }
})

test('Semana atravessando a virada do mês não reinicia a contagem de HO', () => {
  const team: ScheduleTeam = {
    id: 'team-boundary',
    code: 'telefone',
    name: 'Telefone',
    manager_name: 'Marcos',
    manager_profile_id: null,
    active: true,
    settings: null,
  }
  const persons = people(4, 'M')
  const memberships = persons.map((person, index) => ({
    id: `mb-${index}`,
    person_id: person.id,
    team_id: team.id,
    manager_profile_id: null,
    start_date: '2024-01-01',
    end_date: null,
    participates_in_schedule: true,
    participates_hybrid: true,
    participates_lunch: true,
    participates_snack: true,
    participates_extended: false,
  }))
  const rules = [
    rule('mb1', team.id, 'lunch_policy', 'by_modality'),
    rule('mb2', team.id, 'lunch_presential_preferred_time', '13:00'),
    rule('mb3', team.id, 'lunch_ho_preferred_time', '11:30'),
    rule('mb4', team.id, 'snack_policy', 'fixed_by_person'),
    ...persons.map((person, index) =>
      rule(`mbf-${index}`, team.id, 'snack_fixed_time', ['15:45','16:00','16:15','16:30'][index], person.id),
    ),
  ]

  const october = generateMonthlySchedule({
    team,
    people: persons,
    memberships,
    absences: [],
    rules,
    context: { year: 2024, month: 10, holidays: [], optional_days: [], click_days: [] },
    year: 2024,
    month: 10,
  })

  const november = generateMonthlySchedule({
    team,
    people: persons,
    memberships,
    absences: [],
    rules,
    context: { year: 2024, month: 11, holidays: [], optional_days: [], click_days: [] },
    year: 2024,
    month: 11,
    existingEntries: october.entries,
  })

  assert.ok(
    !november.validations.some((item) => item.code === 'HYBRID_WEEKLY_BALANCE'),
    JSON.stringify(november.validations.filter((item) => item.code === 'HYBRID_WEEKLY_BALANCE'), null, 2),
  )

  const combined = [...october.entries, ...november.entries]
  for (const person of persons) {
    const week = combined.filter(
      (entry) =>
        entry.person_id === person.id &&
        entry.entry_type === 'hybrid' &&
        entry.date >= '2024-10-28' &&
        entry.date <= '2024-11-01',
    )
    assert.equal(
      week.filter((entry) => entry.value === 'HO').length,
      2,
      `${person.name} deve ter exatamente dois HOs na semana que cruza o mês`,
    )
  }
})

test('Café acompanha a faixa do almoço e nunca ultrapassa duas pessoas por horário', () => {
  const team: ScheduleTeam = {
    id: 'team-coffee',
    code: 'especializado',
    name: 'Especializado',
    manager_name: 'Marcos',
    manager_profile_id: null,
    active: true,
    settings: null,
  }
  const persons = people(7, 'L')
  const rules = [
    rule('l1', team.id, 'lunch_policy', 'coverage_weighted'),
    rule('l2', team.id, 'lunch_presential_preferred_time', '12:00'),
    rule('l3', team.id, 'lunch_ho_preferred_time', '13:00'),
    rule('l4', team.id, 'snack_policy', 'balanced_by_lunch'),
    rule('l5', team.id, 'snack_early_slots', ['15:45','16:00','16:15','16:30']),
    rule('l6', team.id, 'snack_late_slots', ['16:30','16:45','17:00','17:15']),
  ]
  const input = baseInput(team, persons, rules)
  input.context = { year: 2026, month: 10, holidays: [], optional_days: [], click_days: [] }
  const result = generateMonthlySchedule(input)

  for (const snack of result.entries.filter((entry) => entry.entry_type === 'snack')) {
    const lunch = result.entries.find(
      (entry) =>
        entry.person_id === snack.person_id &&
        entry.date === snack.date &&
        entry.entry_type === 'lunch',
    )
    assert.ok(lunch)
    if ((lunch?.value ?? '') <= '12:00') {
      assert.ok(['15:45','16:00','16:15','16:30'].includes(snack.value))
    } else {
      assert.ok(['16:30','16:45','17:00','17:15'].includes(snack.value))
    }
  }

  const counts = new Map<string, number>()
  for (const snack of result.entries.filter((entry) => entry.entry_type === 'snack')) {
    const key = `${snack.date}|${snack.value}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  assert.ok([...counts.values()].every((count) => count <= 2))
})


test('Click Day preserva almoço/café existentes por pessoa e completa eventuais lacunas', () => {
  const team: ScheduleTeam = {
    id: 'team-click-partial',
    code: 'especializado',
    name: 'Especializado',
    manager_name: 'Marcos',
    manager_profile_id: null,
    active: true,
    settings: null,
  }
  const persons = people(5, 'CP')
  const rules = [
    rule('cp1', team.id, 'lunch_policy', 'coverage_weighted'),
    rule('cp2', team.id, 'lunch_presential_preferred_time', '12:00'),
    rule('cp3', team.id, 'lunch_ho_preferred_time', '13:00'),
    rule('cp4', team.id, 'snack_policy', 'balanced_by_lunch'),
    rule('cp5', team.id, 'snack_early_slots', ['15:45','16:00','16:15','16:30']),
    rule('cp6', team.id, 'snack_late_slots', ['16:30','16:45','17:00','17:15']),
  ]
  const initialInput = baseInput(team, persons, rules)
  initialInput.context = { year: 2026, month: 10, holidays: [], optional_days: [], click_days: [] }
  const initial = generateMonthlySchedule(initialInput)

  const date = '2026-10-21'
  const preservedPerson = persons[0]
  const preservedDaily = initial.entries.filter(
    (entry) =>
      entry.person_id === preservedPerson.id &&
      entry.date === date &&
      (entry.entry_type === 'lunch' || entry.entry_type === 'snack'),
  )
  assert.equal(preservedDaily.length, 2)

  const click = generateMonthlySchedule({
    ...initialInput,
    context: { ...initialInput.context, click_days: [date] },
    existingEntries: [
      ...initial.entries.filter(
        (entry) =>
          entry.date !== date ||
          entry.entry_type === 'hybrid' ||
          entry.person_id === preservedPerson.id,
      ),
    ],
  })

  const clickLunches = click.entries.filter((entry) => entry.date === date && entry.entry_type === 'lunch')
  const clickSnacks = click.entries.filter((entry) => entry.date === date && entry.entry_type === 'snack')
  assert.equal(clickLunches.length, persons.length)
  assert.equal(clickSnacks.length, persons.length)

  for (const preserved of preservedDaily) {
    const after = click.entries.find(
      (entry) =>
        entry.person_id === preserved.person_id &&
        entry.date === preserved.date &&
        entry.entry_type === preserved.entry_type,
    )
    assert.equal(after?.value, preserved.value)
  }
})


test('Dias fixos de HO não são deslocados para dias fora da restrição', () => {
  const team: ScheduleTeam = {
    id: 'team-fixed',
    code: 'especializado',
    name: 'Especializado',
    manager_name: 'Marcos',
    manager_profile_id: null,
    active: true,
    settings: null,
  }
  const persons = people(3, 'FX')
  const fixedPerson = persons[0]
  const rules = [
    rule('fx1', team.id, 'hybrid_fixed_weekdays', [3,4], fixedPerson.id),
    rule('fx2', team.id, 'lunch_policy', 'coverage_weighted'),
    rule('fx3', team.id, 'lunch_presential_preferred_time', '12:00'),
    rule('fx4', team.id, 'lunch_ho_preferred_time', '13:00'),
    rule('fx5', team.id, 'snack_policy', 'balanced_by_lunch'),
  ]
  const input = baseInput(team, persons, rules)
  input.context = { year: 2026, month: 10, holidays: [], optional_days: [], click_days: [] }
  const result = generateMonthlySchedule(input)

  const hoDays = result.entries.filter(
    (entry) => entry.person_id === fixedPerson.id && entry.entry_type === 'hybrid' && entry.value === 'HO',
  )
  assert.ok(hoDays.length > 0)
  assert.ok(
    hoDays.every((entry) => [3,4].includes(new Date(`${entry.date}T12:00:00Z`).getUTCDay())),
    JSON.stringify(hoDays, null, 2),
  )
})

test('Click Day em dia fixo não empurra a pessoa para um dia proibido', () => {
  const team: ScheduleTeam = {
    id: 'team-fixed-click',
    code: 'especializado',
    name: 'Especializado',
    manager_name: 'Marcos',
    manager_profile_id: null,
    active: true,
    settings: null,
  }
  const persons = people(3, 'FC')
  const fixedPerson = persons[0]
  const rules = [
    rule('fc1', team.id, 'hybrid_fixed_weekdays', [3,4], fixedPerson.id),
    rule('fc2', team.id, 'lunch_policy', 'coverage_weighted'),
    rule('fc3', team.id, 'lunch_presential_preferred_time', '12:00'),
    rule('fc4', team.id, 'lunch_ho_preferred_time', '13:00'),
    rule('fc5', team.id, 'snack_policy', 'balanced_by_lunch'),
  ]
  const input = baseInput(team, persons, rules)
  input.context = {
    year: 2026,
    month: 10,
    holidays: [],
    optional_days: [],
    click_days: ['2026-10-21'],
  }
  const result = generateMonthlySchedule(input)

  const weekRows = result.entries.filter(
    (entry) =>
      entry.person_id === fixedPerson.id &&
      entry.entry_type === 'hybrid' &&
      entry.date >= '2026-10-19' &&
      entry.date <= '2026-10-23',
  )
  assert.ok(weekRows.every((entry) => entry.value !== 'HO' || [3,4].includes(new Date(`${entry.date}T12:00:00Z`).getUTCDay())))
  assert.ok(weekRows.some((entry) => entry.date === '2026-10-21' && entry.value === 'CLICK_DAY'))
})


test('Feriado conta como um dos dois dias de Home Office da semana', () => {
  const team: ScheduleTeam = {
    id: 'team-holiday',
    code: 'holiday-test',
    name: 'Feriado',
    manager_name: 'Gestão',
    manager_profile_id: null,
    active: true,
    settings: null,
  }
  const persons = people(5, 'F')
  const input = baseInput(team, persons, [])
  input.context = {
    year: 2026,
    month: 10,
    holidays: ['2026-10-12'],
    optional_days: [],
    click_days: [],
  }

  const result = generateMonthlySchedule(input)
  const week = ['2026-10-12','2026-10-13','2026-10-14','2026-10-15','2026-10-16']

  for (const person of persons) {
    const hybrid = result.entries.filter(
      (entry) =>
        entry.person_id === person.id &&
        entry.entry_type === 'hybrid' &&
        week.includes(entry.date),
    )
    assert.equal(hybrid.filter((entry) => entry.value === 'FERIADO').length, 1)
    assert.equal(
      hybrid.filter((entry) => entry.value === 'HO').length,
      1,
      `${person.name} deve ter somente 1 HO adicional na semana com feriado`,
    )
  }
})

test('Click Day força presencial, remove Estendido, preserva almoço/café e remaneja HO', () => {
  const team: ScheduleTeam = {
    id: 'team-click',
    code: 'especializado',
    name: 'Especializado',
    manager_name: 'Gestão',
    manager_profile_id: null,
    active: true,
    settings: null,
  }
  const persons = people(7, 'C')
  const rules: ScheduleRule[] = [
    rule('c1', team.id, 'lunch_policy', 'coverage_weighted'),
    rule('c2', team.id, 'lunch_presential_preferred_time', '12:00'),
    rule('c3', team.id, 'lunch_ho_preferred_time', '13:00'),
    rule('c4', team.id, 'lunch_modal_strict', false),
    rule('c5', team.id, 'lunch_windows', { '12:00': '13:00', '13:00': '14:30' }),
    rule('c6', team.id, 'shift_end_by_lunch', { '12:00': '17:30', '13:00': '18:00' }),
    rule('c7', team.id, 'snack_policy', 'balanced_by_lunch'),
    rule('c8', team.id, 'snack_early_slots', ['15:45','16:00','16:15','16:30']),
    rule('c9', team.id, 'snack_late_slots', ['16:30','16:45','17:00','17:15']),
    rule('c10', team.id, 'extended_people_per_day', 2),
    rule('c11', team.id, 'extended_weekdays', [1,2,3,4]),
    rule('c12', team.id, 'extended_shifts', ['09:00-18:30','09:30-19:00']),
  ]

  const baselineInput = baseInput(team, persons, rules)
  baselineInput.context = { year: 2026, month: 10, holidays: [], optional_days: [], click_days: [] }
  const baseline = generateMonthlySchedule(baselineInput)

  const clickDate = '2026-10-14'
  const withClickInput = baseInput(team, persons, rules)
  withClickInput.context = { year: 2026, month: 10, holidays: [], optional_days: [], click_days: [clickDate] }
  withClickInput.existingEntries = baseline.entries

  const result = generateMonthlySchedule(withClickInput)
  const week = ['2026-10-12','2026-10-13','2026-10-14','2026-10-15','2026-10-16']

  assert.equal(
    result.entries.filter((entry) => entry.date === clickDate && entry.entry_type === 'extended').length,
    0,
    'Click Day não pode ter Estendido',
  )

  for (const person of persons) {
    const clickHybrid = result.entries.find(
      (entry) => entry.person_id === person.id && entry.date === clickDate && entry.entry_type === 'hybrid',
    )
    assert.equal(clickHybrid?.value, 'CLICK_DAY')

    const weeklyHo = result.entries.filter(
      (entry) =>
        entry.person_id === person.id &&
        entry.entry_type === 'hybrid' &&
        entry.value === 'HO' &&
        week.includes(entry.date),
    )
    assert.equal(weeklyHo.length, 2, `${person.name} deve manter os 2 HOs na semana do Click Day`)

    for (const type of ['lunch','snack'] as const) {
      const before = baseline.entries.find(
        (entry) => entry.person_id === person.id && entry.date === clickDate && entry.entry_type === type,
      )
      const after = result.entries.find(
        (entry) => entry.person_id === person.id && entry.date === clickDate && entry.entry_type === type,
      )
      assert.equal(after?.value, before?.value, `${type} deve ser preservado no Click Day`)
    }
  }

  const clickErrors = result.validations.filter((item) =>
    item.code === 'CLICK_DAY_HO' || item.code === 'CLICK_DAY_EXTENDED',
  )
  assert.deepEqual(clickErrors, [])
})

test('Semana operacional atravessa a virada do mês sem reiniciar a cota de HO', () => {
  const team: ScheduleTeam = {
    id: 'team-boundary',
    code: 'boundary-test',
    name: 'Virada do mês',
    manager_name: 'Gestão',
    manager_profile_id: null,
    active: true,
    settings: null,
  }
  const persons = people(4, 'V')
  const memberships = persons.map((person, index) => ({
    id: `boundary-m-${index}`,
    person_id: person.id,
    team_id: team.id,
    manager_profile_id: null,
    start_date: '2024-01-01',
    end_date: null,
    participates_in_schedule: true,
    participates_hybrid: true,
    participates_lunch: true,
    participates_snack: true,
    participates_extended: false,
  }))

  const october = generateMonthlySchedule({
    team,
    people: persons,
    memberships,
    absences: [],
    rules: [],
    context: { year: 2024, month: 10, holidays: [], optional_days: [], click_days: [] },
    year: 2024,
    month: 10,
  })

  const november = generateMonthlySchedule({
    team,
    people: persons,
    memberships,
    absences: [],
    rules: [],
    context: { year: 2024, month: 11, holidays: [], optional_days: [], click_days: [] },
    year: 2024,
    month: 11,
    existingEntries: october.entries,
  })

  const boundaryWeek = ['2024-10-28','2024-10-29','2024-10-30','2024-10-31','2024-11-01']
  const combined = [...october.entries, ...november.entries]

  for (const person of persons) {
    const weeklyHo = combined.filter(
      (entry) =>
        entry.person_id === person.id &&
        entry.entry_type === 'hybrid' &&
        entry.value === 'HO' &&
        boundaryWeek.includes(entry.date),
    )
    assert.equal(
      weeklyHo.length,
      2,
      `${person.name} deve ter exatamente 2 HOs na semana 28/10–01/11, mesmo atravessando o mês`,
    )
  }

  assert.equal(
    november.validations.filter((item) => item.code === 'HYBRID_WEEKLY_BALANCE').length,
    0,
    'A semana completa da virada não deve gerar desequilíbrio de HO',
  )
})
