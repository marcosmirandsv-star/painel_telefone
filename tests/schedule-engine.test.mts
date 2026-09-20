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
