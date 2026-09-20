import { generateMonthlySchedule } from '@/lib/schedule-engine'
import type { ScheduleGenerationInput, ScheduleRule } from '@/lib/schedule-types'

export const dynamic = 'force-static'

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Schedule self-test: ${message}`)
}

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

function makePeople(count: number, prefix: string) {
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

function runSpecialized() {
  const teamId = 'team-specialized'
  const team = {
    id: teamId,
    code: 'especializado',
    name: 'Especializado',
    manager_name: 'Marcos',
    manager_profile_id: null,
    active: true,
    settings: null,
  }
  const people = makePeople(7, 'E')
  const memberships = people.map((person, index) => ({
    id: `em-${index}`,
    person_id: person.id,
    team_id: teamId,
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
    rule('e1', teamId, 'lunch_policy', 'coverage_weighted'),
    rule('e2', teamId, 'lunch_presential_preferred_time', '12:00'),
    rule('e3', teamId, 'lunch_ho_preferred_time', '13:00'),
    rule('e4', teamId, 'lunch_modal_strict', false),
    rule('e5', teamId, 'lunch_windows', { '12:00': '13:00', '13:00': '14:30' }),
    rule('e6', teamId, 'shift_end_by_lunch', { '12:00': '17:30', '13:00': '18:00' }),
    rule('e7', teamId, 'snack_policy', 'balanced_by_lunch'),
    rule('e8', teamId, 'snack_early_slots', ['15:45','16:00','16:15','16:30']),
    rule('e9', teamId, 'snack_late_slots', ['16:30','16:45','17:00','17:15']),
    rule('e10', teamId, 'extended_people_per_day', 2),
    rule('e11', teamId, 'extended_weekdays', [1,2,3,4]),
    rule('e12', teamId, 'extended_shifts', ['09:00-18:30','09:30-19:00']),
  ]
  const input: ScheduleGenerationInput = {
    team,
    people,
    memberships,
    absences: [],
    rules,
    context: { year: 2026, month: 10, holidays: ['2026-10-12'], optional_days: [] },
    year: 2026,
    month: 10,
  }
  const result = generateMonthlySchedule(input)
  assert(!result.validations.some((v) => v.level === 'error'), 'Especializado não deveria gerar erro obrigatório no cenário base')

  const lunches = result.entries.filter((entry) => entry.entry_type === 'lunch')
  assert(lunches.length > 0, 'Especializado deve gerar almoços')
  for (const lunch of lunches) {
    const meta = lunch.metadata ?? {}
    if (lunch.value === '12:00') assert(meta.return_time === '13:00', 'Almoço 12h deve retornar 13h')
    if (lunch.value === '13:00') assert(meta.return_time === '14:30', 'Almoço 13h deve retornar 14h30')
  }

  const snackCounts = new Map<string, number>()
  for (const snack of result.entries.filter((entry) => entry.entry_type === 'snack')) {
    const key = `${snack.date}|${snack.value}`
    snackCounts.set(key, (snackCounts.get(key) ?? 0) + 1)
  }
  assert([...snackCounts.values()].every((count) => count <= 2), 'Café não pode passar de duas pessoas por horário')

  const expectedExtendedDays = result.entries
    .filter((entry) => entry.entry_type === 'extended')
    .reduce((map, entry) => map.set(entry.date, (map.get(entry.date) ?? 0) + 1), new Map<string, number>())
  assert([...expectedExtendedDays.values()].every((count) => count === 2), 'Estendido deve ter duas pessoas nos dias gerados')

  return result.entries.length
}

function runPhone() {
  const teamId = 'team-phone'
  const team = {
    id: teamId,
    code: 'telefone',
    name: 'Telefone',
    manager_name: 'Marcos',
    manager_profile_id: null,
    active: true,
    settings: null,
  }
  const people = makePeople(8, 'T')
  const memberships = people.map((person, index) => ({
    id: `tm-${index}`,
    person_id: person.id,
    team_id: teamId,
    manager_profile_id: null,
    start_date: '2026-01-01',
    end_date: null,
    participates_in_schedule: true,
    participates_hybrid: true,
    participates_lunch: true,
    participates_snack: true,
    participates_extended: false,
  }))
  const fixedSlots = ['15:45','16:00','16:15','16:30','16:45','17:00','17:15','16:00']
  const rules: ScheduleRule[] = [
    rule('t1', teamId, 'lunch_policy', 'by_modality'),
    rule('t2', teamId, 'lunch_presential_preferred_time', '13:00'),
    rule('t3', teamId, 'lunch_ho_preferred_time', '11:30'),
    rule('t4', teamId, 'lunch_modal_strict', false),
    rule('t5', teamId, 'lunch_windows', { '11:30': '13:00', '13:00': '14:00' }),
    rule('t6', teamId, 'snack_policy', 'fixed_by_person'),
    ...people.map((person, index) => rule(`tf-${index}`, teamId, 'snack_fixed_time', fixedSlots[index], person.id)),
  ]
  const result = generateMonthlySchedule({
    team,
    people,
    memberships,
    absences: [],
    rules,
    context: { year: 2026, month: 10, holidays: [], optional_days: [] },
    year: 2026,
    month: 10,
  })

  for (const person of people) {
    const snacks = result.entries.filter((entry) => entry.person_id === person.id && entry.entry_type === 'snack')
    const expected = fixedSlots[people.indexOf(person)]
    assert(snacks.every((entry) => entry.value === expected), `Café fixo do Telefone não foi preservado para ${person.name}`)
  }

  for (const lunch of result.entries.filter((entry) => entry.entry_type === 'lunch')) {
    const hybrid = result.entries.find(
      (entry) =>
        entry.person_id === lunch.person_id &&
        entry.date === lunch.date &&
        entry.entry_type === 'hybrid',
    )
    if (hybrid?.value === 'HO') assert(lunch.value === '11:30', 'Telefone em HO deve preferir 11h30 no cenário sem conflito')
    if (hybrid?.value === 'P') assert(lunch.value === '13:00', 'Telefone presencial deve preferir 13h no cenário sem conflito')
  }

  return result.entries.length
}

const specialized = runSpecialized()
const phone = runPhone()

export default function ScheduleSelfTestPage() {
  return <main>OK {specialized + phone}</main>
}
