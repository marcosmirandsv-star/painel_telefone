import {
  ScheduleAbsence,
  ScheduleEntry,
  ScheduleGenerationInput,
  ScheduleGenerationResult,
  ScheduleMembership,
  SchedulePerson,
  ScheduleRule,
  ScheduleValidation,
} from './schedule-types'

const DAY_MS = 24 * 60 * 60 * 1000
const WEEKDAY = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 }

function iso(date: Date) {
  return date.toISOString().slice(0, 10)
}

function atUtcDate(value: string) {
  return new Date(`${value}T12:00:00Z`)
}

function monthDays(year: number, month: number) {
  const start = new Date(Date.UTC(year, month - 1, 1, 12))
  const end = new Date(Date.UTC(year, month, 0, 12))
  const dates: string[] = []
  for (let cursor = start; cursor <= end; cursor = new Date(cursor.getTime() + DAY_MS)) {
    const day = cursor.getUTCDay()
    if (day >= WEEKDAY.monday && day <= WEEKDAY.friday) dates.push(iso(cursor))
  }
  return dates
}

function mondayOf(dateValue: string) {
  const date = atUtcDate(dateValue)
  const offset = date.getUTCDay() === 0 ? -6 : 1 - date.getUTCDay()
  return iso(new Date(date.getTime() + offset * DAY_MS))
}

function weekDays(dateValue: string) {
  const monday = atUtcDate(mondayOf(dateValue))
  return Array.from({ length: 5 }, (_, index) => iso(new Date(monday.getTime() + index * DAY_MS)))
}

function dateInRange(date: string, start: string, end: string | null | undefined) {
  return date >= start && (!end || date <= end)
}

function personMembershipOnDate(memberships: ScheduleMembership[], personId: string, teamId: string, date: string) {
  return memberships.some(
    (membership) =>
      membership.person_id === personId &&
      membership.team_id === teamId &&
      membership.participates_in_schedule &&
      dateInRange(date, membership.start_date, membership.end_date),
  )
}

function absenceOnDate(absences: ScheduleAbsence[], personId: string, date: string) {
  return absences.find(
    (absence) => absence.person_id === personId && dateInRange(date, absence.start_date, absence.end_date),
  )
}

function rulesForDate(rules: ScheduleRule[], teamId: string, personId: string | null, date: string) {
  return rules.filter(
    (rule) =>
      rule.active &&
      (!rule.team_id || rule.team_id === teamId) &&
      (!rule.person_id || rule.person_id === personId) &&
      dateInRange(date, rule.start_date, rule.end_date),
  )
}

function ruleValue<T>(rules: ScheduleRule[], key: string, fallback: T): T {
  const matching = rules.filter((rule) => rule.rule_key === key)
  if (!matching.length) return fallback
  const value = matching.at(-1)?.rule_value?.value
  return (value === undefined ? fallback : value) as T
}

function ruleArray(rules: ScheduleRule[], key: string, fallback: number[]) {
  const matching = rules.filter((rule) => rule.rule_key === key)
  if (!matching.length) return fallback
  const value = matching.at(-1)?.rule_value?.value
  return Array.isArray(value) ? value.map(Number).filter(Number.isFinite) : fallback
}

function entryKey(entry: ScheduleEntry) {
  return `${entry.person_id}|${entry.team_id}|${entry.date}|${entry.entry_type}`
}

function isHoliday(input: ScheduleGenerationInput, date: string) {
  return input.context.holidays.includes(date) || input.context.optional_days.includes(date)
}

function getActivePeople(input: ScheduleGenerationInput, date: string) {
  return input.people.filter(
    (person) =>
      person.active &&
      personMembershipOnDate(input.memberships, person.id, input.team.id, date),
  )
}

function isForcedPresentialAroundVacation(absences: ScheduleAbsence[], personId: string, date: string) {
  const current = atUtcDate(date)
  const previous = iso(new Date(current.getTime() - DAY_MS))
  const next = iso(new Date(current.getTime() + DAY_MS))
  const previousVacation = absences.find(
    (absence) =>
      absence.person_id === personId &&
      absence.kind === 'FERIAS' &&
      dateInRange(previous, absence.start_date, absence.end_date),
  )
  const nextVacation = absences.find(
    (absence) =>
      absence.person_id === personId &&
      absence.kind === 'FERIAS' &&
      dateInRange(next, absence.start_date, absence.end_date),
  )
  return Boolean(previousVacation || nextVacation)
}

function chooseHoDays(
  input: ScheduleGenerationInput,
  person: SchedulePerson,
  week: string[],
  existingMap: Map<string, ScheduleEntry>,
) {
  const existingHo = week.filter((date) => existingMap.get(`${person.id}|${input.team.id}|${date}|hybrid`)?.value === 'HO')
  const holidays = week.filter((date) => isHoliday(input, date) && personMembershipOnDate(input.memberships, person.id, input.team.id, date))
  const targetHo = Math.max(0, 2 - holidays.length)
  if (existingHo.length >= targetHo) return existingHo.slice(0, targetHo)

  const dateRules = rulesForDate(input.rules, input.team.id, person.id, week[0])
  const fixed = ruleArray(dateRules, 'hybrid_fixed_weekdays', [])
  const preferred = ruleArray(dateRules, 'hybrid_preferred_weekdays', [])
  const preferredPairs = ruleValue<number[][]>(
    dateRules,
    'hybrid_preferred_pairs',
    [[1, 2], [2, 3], [3, 4], [4, 5]],
  )

  const available = week.filter((date) => {
    const day = atUtcDate(date).getUTCDay()
    if (!personMembershipOnDate(input.memberships, person.id, input.team.id, date)) return false
    if (isHoliday(input, date)) return false
    if (absenceOnDate(input.absences, person.id, date)) return false
    if (isForcedPresentialAroundVacation(input.absences, person.id, date)) return false
    return day >= 1 && day <= 5
  })

  const picked = new Set(existingHo)
  for (const weekday of fixed) {
    const date = available.find((item) => atUtcDate(item).getUTCDay() === weekday)
    if (date && picked.size < targetHo) picked.add(date)
  }

  if (picked.size < targetHo && preferred.length) {
    for (const weekday of preferred) {
      const date = available.find((item) => atUtcDate(item).getUTCDay() === weekday)
      if (date && picked.size < targetHo) picked.add(date)
    }
  }

  if (picked.size < targetHo) {
    for (const pair of preferredPairs) {
      const pairDates = pair
        .map((weekday) => available.find((item) => atUtcDate(item).getUTCDay() === weekday))
        .filter(Boolean) as string[]
      if (pairDates.length === pair.length) {
        for (const date of pairDates) {
          if (picked.size < targetHo) picked.add(date)
        }
        if (picked.size >= targetHo) break
      }
    }
  }

  for (const date of available) {
    if (picked.size >= targetHo) break
    picked.add(date)
  }

  return [...picked]
}

function distributeLunch(
  input: ScheduleGenerationInput,
  date: string,
  people: SchedulePerson[],
  entries: ScheduleEntry[],
) {
  const result: ScheduleEntry[] = []
  const hybrid = new Map(entries.filter((entry) => entry.date === date && entry.entry_type === 'hybrid').map((entry) => [entry.person_id, entry.value]))
  const available = people.filter((person) => !absenceOnDate(input.absences, person.id, date) && !isHoliday(input, date))
  const teamRules = rulesForDate(input.rules, input.team.id, null, date)
  const noonTarget = Math.floor(available.length / 2)

  const fixedLunch = new Map<string, string>()
  for (const person of available) {
    const personRules = rulesForDate(input.rules, input.team.id, person.id, date)
    const fixed = ruleValue<string | null>(personRules, 'lunch_fixed_time', null)
    if (fixed) fixedLunch.set(person.id, fixed)
    if (hybrid.get(person.id) === 'HO') fixedLunch.set(person.id, '13:00')
  }

  const noonCandidates = available.filter((person) => !fixedLunch.has(person.id) && hybrid.get(person.id) !== 'HO')
  const experiencedNames = ruleValue<string[]>(teamRules, 'experienced_people', [])
  noonCandidates.sort((a, b) => {
    const ai = experiencedNames.includes(a.name) ? 0 : 1
    const bi = experiencedNames.includes(b.name) ? 0 : 1
    return ai - bi || a.name.localeCompare(b.name)
  })

  const noonNeeded = Math.max(0, noonTarget - [...fixedLunch.values()].filter((time) => time === '12:00').length)
  const noonIds = new Set(noonCandidates.slice(0, noonNeeded).map((person) => person.id))

  for (const person of available) {
    const value = fixedLunch.get(person.id) ?? (noonIds.has(person.id) ? '12:00' : '13:00')
    result.push({
      person_id: person.id,
      team_id: input.team.id,
      date,
      entry_type: 'lunch',
      value,
      source: 'generated',
    })
  }
  return result
}

function distributeSnack(
  input: ScheduleGenerationInput,
  date: string,
  people: SchedulePerson[],
  entries: ScheduleEntry[],
) {
  const lunchMap = new Map(entries.filter((entry) => entry.date === date && entry.entry_type === 'lunch').map((entry) => [entry.person_id, entry.value]))
  const slotsByLunch: Record<string, string[]> = {
    '12:00': ['15:45', '16:15', '16:30'],
    '13:00': ['16:45', '17:00', '17:15'],
    '11:30': ['15:45', '16:15', '16:30'],
  }
  const counts = new Map<string, number>()
  const result: ScheduleEntry[] = []

  for (const person of people) {
    if (absenceOnDate(input.absences, person.id, date) || isHoliday(input, date)) continue
    const personRules = rulesForDate(input.rules, input.team.id, person.id, date)
    const fixed = ruleValue<string | null>(personRules, 'snack_fixed_time', null)
    const lunch = lunchMap.get(person.id)
    const slots = fixed ? [fixed] : slotsByLunch[lunch ?? '13:00'] ?? slotsByLunch['13:00']
    const picked = slots
      .map((slot) => ({ slot, count: counts.get(slot) ?? 0 }))
      .filter((item) => item.count < 2)
      .sort((a, b) => a.count - b.count || a.slot.localeCompare(b.slot))[0]
    const value = picked?.slot ?? slots[0]
    counts.set(value, (counts.get(value) ?? 0) + 1)
    result.push({
      person_id: person.id,
      team_id: input.team.id,
      date,
      entry_type: 'snack',
      value,
      source: 'generated',
    })
  }
  return result
}

function distributeExtended(
  input: ScheduleGenerationInput,
  date: string,
  people: SchedulePerson[],
  entries: ScheduleEntry[],
  runningCounts: Map<string, number>,
) {
  const day = atUtcDate(date).getUTCDay()
  const teamRules = rulesForDate(input.rules, input.team.id, null, date)
  const allowedWeekdays = ruleArray(teamRules, 'extended_weekdays', [1, 2, 3, 4])
  if (!allowedWeekdays.includes(day) || isHoliday(input, date)) return []

  const seats = Number(ruleValue(teamRules, 'extended_people_per_day', 2))
  if (!Number.isFinite(seats) || seats <= 0) return []

  const hybrid = new Map(entries.filter((entry) => entry.date === date && entry.entry_type === 'hybrid').map((entry) => [entry.person_id, entry.value]))
  const candidates = people
    .filter((person) => {
      if (hybrid.get(person.id) !== 'HO') return false
      if (absenceOnDate(input.absences, person.id, date)) return false
      const personRules = rulesForDate(input.rules, input.team.id, person.id, date)
      const allowed = ruleArray(personRules, 'extended_allowed_weekdays', [1, 2, 3, 4, 5])
      const blocked = ruleArray(personRules, 'extended_blocked_weekdays', [])
      return allowed.includes(day) && !blocked.includes(day)
    })
    .sort((a, b) => (runningCounts.get(a.id) ?? 0) - (runningCounts.get(b.id) ?? 0) || a.name.localeCompare(b.name))

  const selected = candidates.slice(0, seats)
  const result: ScheduleEntry[] = []
  selected.forEach((person, index) => {
    runningCounts.set(person.id, (runningCounts.get(person.id) ?? 0) + 1)
    const shifts = ruleValue<string[]>(teamRules, 'extended_shifts', ['09:00-18:30', '09:30-19:00'])
    result.push({
      person_id: person.id,
      team_id: input.team.id,
      date,
      entry_type: 'extended',
      value: shifts[index] ?? shifts.at(-1) ?? 'Até 19:00',
      source: 'generated',
    })
  })
  return result
}

export function generateMonthlySchedule(input: ScheduleGenerationInput): ScheduleGenerationResult {
  const dates = monthDays(input.year, input.month)
  const validations: ScheduleValidation[] = []
  const entries: ScheduleEntry[] = []
  const existingMap = new Map((input.existingEntries ?? []).map((entry) => [entryKey(entry), entry]))
  const weeks = [...new Set(dates.map(mondayOf))]

  for (const monday of weeks) {
    const week = weekDays(monday)
    const peopleInWeek = input.people.filter((person) => week.some((date) => personMembershipOnDate(input.memberships, person.id, input.team.id, date)))
    for (const person of peopleInWeek) {
      const hoDays = new Set(chooseHoDays(input, person, week, existingMap))
      for (const date of week) {
        if (!dates.includes(date)) continue
        if (!personMembershipOnDate(input.memberships, person.id, input.team.id, date)) continue

        const existing = existingMap.get(`${person.id}|${input.team.id}|${date}|hybrid`)
        if (existing?.locked || existing?.source === 'manual' || existing?.source === 'exception') {
          entries.push(existing)
          continue
        }

        const absence = absenceOnDate(input.absences, person.id, date)
        let value = 'P'
        if (isHoliday(input, date)) value = 'FERIADO'
        else if (absence) value = absence.kind
        else if (isForcedPresentialAroundVacation(input.absences, person.id, date)) value = 'P'
        else if (hoDays.has(date)) value = 'HO'

        entries.push({
          person_id: person.id,
          team_id: input.team.id,
          date,
          entry_type: 'hybrid',
          value,
          source: 'generated',
        })
      }
    }
  }

  const extendedCounts = new Map<string, number>()
  for (const date of dates) {
    const activePeople = getActivePeople(input, date)
    entries.push(...distributeLunch(input, date, activePeople, entries))
    entries.push(...distributeSnack(input, date, activePeople, entries))
    entries.push(...distributeExtended(input, date, activePeople, entries, extendedCounts))
  }

  validations.push(...validateSchedule(input, entries))
  return { entries, validations }
}

export function validateSchedule(input: ScheduleGenerationInput, entries: ScheduleEntry[]) {
  const validations: ScheduleValidation[] = []
  const dates = monthDays(input.year, input.month)

  for (const entry of entries) {
    if (!personMembershipOnDate(input.memberships, entry.person_id, input.team.id, entry.date)) {
      validations.push({
        level: 'error',
        code: 'PERSON_OUTSIDE_TEAM',
        message: 'Pessoa escalada fora da vigência do vínculo com o time.',
        date: entry.date,
        person_id: entry.person_id,
      })
    }
  }

  for (const date of dates) {
    const hybrid = new Map(entries.filter((entry) => entry.date === date && entry.entry_type === 'hybrid').map((entry) => [entry.person_id, entry.value]))
    const lunches = entries.filter((entry) => entry.date === date && entry.entry_type === 'lunch')
    for (const lunch of lunches) {
      if (hybrid.get(lunch.person_id) === 'HO' && lunch.value !== '13:00') {
        validations.push({
          level: 'error',
          code: 'HO_LUNCH_NOT_13',
          message: 'Colaborador em HO precisa almoçar às 13:00.',
          date,
          person_id: lunch.person_id,
        })
      }
    }

    const snacks = entries.filter((entry) => entry.date === date && entry.entry_type === 'snack')
    const snackCounts = new Map<string, number>()
    for (const snack of snacks) snackCounts.set(snack.value, (snackCounts.get(snack.value) ?? 0) + 1)
    for (const [slot, count] of snackCounts) {
      if (count > 2) {
        validations.push({
          level: 'error',
          code: 'SNACK_OVER_CAPACITY',
          message: `Mais de 2 pessoas no lanche das ${slot}.`,
          date,
        })
      }
    }

    const extended = entries.filter((entry) => entry.date === date && entry.entry_type === 'extended')
    for (const item of extended) {
      if (hybrid.get(item.person_id) !== 'HO') {
        validations.push({
          level: 'error',
          code: 'EXTENDED_NOT_HO',
          message: 'Estendido atribuído para pessoa que não está em HO.',
          date,
          person_id: item.person_id,
        })
      }
    }
  }

  const errors = validations.filter((item) => item.level === 'error').length
  if (!errors) {
    validations.push({
      level: 'ok',
      code: 'VALIDATED',
      message: 'Escala validada sem conflitos obrigatórios.',
    })
  }
  return validations
}
