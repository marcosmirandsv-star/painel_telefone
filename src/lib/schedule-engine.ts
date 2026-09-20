import type {
  ScheduleAbsence,
  ScheduleEntry,
  ScheduleGenerationInput,
  ScheduleGenerationResult,
  ScheduleMembership,
  SchedulePerson,
  ScheduleRule,
  ScheduleValidation,
} from './schedule-types.ts'
import { planWeeklyHybrid } from './schedule-hybrid-planner.ts'

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

type MembershipEntryType = 'hybrid' | 'lunch' | 'snack' | 'extended'

function membershipAllowsEntry(membership: ScheduleMembership, entryType?: MembershipEntryType) {
  if (!membership.participates_in_schedule) return false
  if (!entryType) return true
  if (entryType === 'hybrid') return membership.participates_hybrid !== false
  if (entryType === 'lunch') return membership.participates_lunch !== false
  if (entryType === 'snack') return membership.participates_snack !== false
  if (entryType === 'extended') return membership.participates_extended !== false
  return true
}

function personMembershipOnDate(
  memberships: ScheduleMembership[],
  personId: string,
  teamId: string,
  date: string,
  entryType?: MembershipEntryType,
) {
  return memberships.some(
    (membership) =>
      membership.person_id === personId &&
      membership.team_id === teamId &&
      membershipAllowsEntry(membership, entryType) &&
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

function isClickDay(input: ScheduleGenerationInput, date: string) {
  return (input.context.click_days ?? []).includes(date)
}

function getActivePeople(input: ScheduleGenerationInput, date: string, entryType: MembershipEntryType) {
  return input.people.filter(
    (person) =>
      person.active &&
      personMembershipOnDate(input.memberships, person.id, input.team.id, date, entryType),
  )
}

function adjacentBusinessDay(dateValue: string, direction: -1 | 1) {
  let cursor = atUtcDate(dateValue)
  do {
    cursor = new Date(cursor.getTime() + direction * DAY_MS)
  } while (cursor.getUTCDay() === WEEKDAY.saturday || cursor.getUTCDay() === WEEKDAY.sunday)
  return iso(cursor)
}

function isForcedPresentialAroundVacation(absences: ScheduleAbsence[], personId: string, date: string) {
  const previous = adjacentBusinessDay(date, -1)
  const next = adjacentBusinessDay(date, 1)
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
  const holidays = week.filter(
    (date) => isHoliday(input, date) && personMembershipOnDate(input.memberships, person.id, input.team.id, date, 'hybrid'),
  )
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
    if (!personMembershipOnDate(input.memberships, person.id, input.team.id, date, 'hybrid')) return false
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
  const hybrid = new Map(
    entries
      .filter((entry) => entry.date === date && entry.entry_type === 'hybrid')
      .map((entry) => [entry.person_id, entry.value]),
  )
  const available = people.filter(
    (person) => !absenceOnDate(input.absences, person.id, date) && !isHoliday(input, date),
  )
  const teamRules = rulesForDate(input.rules, input.team.id, null, date)
  const policy = ruleValue<string>(teamRules, 'lunch_policy', 'legacy')
  const defaultTime = ruleValue<string>(teamRules, 'lunch_default_time', '13:00')
  const presentPreferred = ruleValue<string>(teamRules, 'lunch_presential_preferred_time', '12:00')
  const hoPreferred = ruleValue<string>(teamRules, 'lunch_ho_preferred_time', ruleValue<string>(teamRules, 'ho_lunch_time', '13:00'))
  const modalStrict = ruleValue<boolean>(teamRules, 'lunch_modal_strict', false)
  const slotTargets = ruleValue<Record<string, number> | null>(teamRules, 'lunch_slot_targets', null)
  const lunchWindows = ruleValue<Record<string, string>>(teamRules, 'lunch_windows', {})
  const shiftEndByLunch = ruleValue<Record<string, string>>(teamRules, 'shift_end_by_lunch', {})
  const experiencedNames = ruleValue<string[]>(teamRules, 'experienced_people', [])

  const assigned = new Map<string, string>()
  const preferredByPerson = new Map<string, string>()

  for (const person of available) {
    const personRules = rulesForDate(input.rules, input.team.id, person.id, date)
    const isHo = hybrid.get(person.id) === 'HO'
    const preferred = isHo ? hoPreferred : presentPreferred
    preferredByPerson.set(person.id, preferred)

    const conditional = isHo
      ? ruleValue<string | null>(personRules, 'lunch_ho_time', null)
      : ruleValue<string | null>(personRules, 'lunch_presential_time', null)
    const fixed = ruleValue<string | null>(personRules, 'lunch_fixed_time', null)
    const alternating = ruleValue<string[] | null>(personRules, 'lunch_alternating_times', null)

    if (conditional) assigned.set(person.id, conditional)
    else if (fixed) assigned.set(person.id, fixed)
    else if (alternating?.length) {
      const dayIndex = Math.max(0, atUtcDate(date).getUTCDate() - 1)
      assigned.set(person.id, alternating[dayIndex % alternating.length] ?? preferred)
    } else if (modalStrict) {
      assigned.set(person.id, preferred)
    }
  }

  const unassigned = available.filter((person) => !assigned.has(person.id))

  if (slotTargets) {
    for (const [slot, rawTarget] of Object.entries(slotTargets)) {
      const target = Number(rawTarget)
      if (!Number.isFinite(target) || target <= 0) continue

      let current = [...assigned.values()].filter((value) => value === slot).length
      const candidates = unassigned
        .filter((person) => !assigned.has(person.id))
        .sort((a, b) => {
          const ap = preferredByPerson.get(a.id) === slot ? 0 : 1
          const bp = preferredByPerson.get(b.id) === slot ? 0 : 1
          const ae = slot === '12:00' && experiencedNames.includes(a.name) ? 0 : 1
          const be = slot === '12:00' && experiencedNames.includes(b.name) ? 0 : 1
          return ap - bp || ae - be || a.name.localeCompare(b.name)
        })

      for (const person of candidates) {
        if (current >= target) break
        assigned.set(person.id, slot)
        current += 1
      }
    }
  } else if (!modalStrict && policy !== 'legacy') {
    const earlySlot = presentPreferred
    const earlyTarget = Math.floor(available.length / 2)
    let earlyCount = [...assigned.values()].filter((value) => value === earlySlot).length

    const earlyCandidates = unassigned
      .filter((person) => !assigned.has(person.id))
      .sort((a, b) => {
        const ap = preferredByPerson.get(a.id) === earlySlot ? 0 : 1
        const bp = preferredByPerson.get(b.id) === earlySlot ? 0 : 1
        return ap - bp || a.name.localeCompare(b.name)
      })

    for (const person of earlyCandidates) {
      if (earlyCount >= earlyTarget) break
      assigned.set(person.id, earlySlot)
      earlyCount += 1
    }
  }

  for (const person of unassigned) {
    if (assigned.has(person.id)) continue
    if (policy === 'legacy') {
      assigned.set(person.id, hybrid.get(person.id) === 'HO' ? hoPreferred : defaultTime)
      continue
    }

    const preferred = preferredByPerson.get(person.id) ?? defaultTime
    const preferredTarget = slotTargets?.[preferred]
    const preferredCount = [...assigned.values()].filter((value) => value === preferred).length

    if (
      slotTargets &&
      Number.isFinite(Number(preferredTarget)) &&
      preferredCount >= Number(preferredTarget)
    ) {
      const alternative = preferred === presentPreferred ? hoPreferred : defaultTime
      assigned.set(person.id, alternative)
    } else {
      assigned.set(person.id, preferred)
    }
  }

  for (const person of available) {
    const value = assigned.get(person.id) ?? defaultTime
    const preferred = preferredByPerson.get(person.id) ?? defaultTime
    result.push({
      person_id: person.id,
      team_id: input.team.id,
      date,
      entry_type: 'lunch',
      value,
      source: 'generated',
      metadata: {
        return_time: lunchWindows[value] ?? null,
        shift_end: shiftEndByLunch[value] ?? null,
        preferred_start: preferred,
        preference_met: value === preferred,
      },
    })
  }
  return result
}

function distributeSnack(
  input: ScheduleGenerationInput,
  date: string,
  people: SchedulePerson[],
  entries: ScheduleEntry[],
  monthlyUsage: Map<string, number>,
) {
  const lunchMap = new Map(
    entries
      .filter((entry) => entry.date === date && entry.entry_type === 'lunch')
      .map((entry) => [entry.person_id, entry.value]),
  )
  const teamRules = rulesForDate(input.rules, input.team.id, null, date)
  const policy = ruleValue<string>(teamRules, 'snack_policy', 'legacy')
  const earlySlots = ruleValue<string[]>(
    teamRules,
    'snack_early_slots',
    ['15:45', '16:00', '16:15', '16:30'],
  )
  const lateSlots = ruleValue<string[]>(
    teamRules,
    'snack_late_slots',
    ['16:30', '16:45', '17:00', '17:15'],
  )
  const legacySlots: Record<string, string[]> = {
    '12:00': ['15:45', '16:15', '16:30'],
    '13:00': ['16:45', '17:00', '17:15'],
    '11:30': ['15:45', '16:15', '16:30'],
  }

  const counts = new Map<string, number>()
  const result: ScheduleEntry[] = []
  const available = people.filter(
    (person) => !absenceOnDate(input.absences, person.id, date) && !isHoliday(input, date),
  )

  const fixedPeople: SchedulePerson[] = []
  const flexiblePeople: SchedulePerson[] = []
  for (const person of available) {
    const personRules = rulesForDate(input.rules, input.team.id, person.id, date)
    const fixed = ruleValue<string | null>(personRules, 'snack_fixed_time', null)
    if (fixed) fixedPeople.push(person)
    else flexiblePeople.push(person)
  }

  for (const person of fixedPeople) {
    const personRules = rulesForDate(input.rules, input.team.id, person.id, date)
    const fixed = ruleValue<string>(personRules, 'snack_fixed_time', '16:15')
    counts.set(fixed, (counts.get(fixed) ?? 0) + 1)
    monthlyUsage.set(`${person.id}|${fixed}`, (monthlyUsage.get(`${person.id}|${fixed}`) ?? 0) + 1)
    result.push({
      person_id: person.id,
      team_id: input.team.id,
      date,
      entry_type: 'snack',
      value: fixed,
      source: 'generated',
      metadata: { policy: 'fixed' },
    })
  }

  for (const person of flexiblePeople) {
    const lunch = lunchMap.get(person.id) ?? '13:00'
    let slots: string[]
    let preferLater = false

    if (policy === 'balanced_by_lunch') {
      const earlyLunch = lunch <= '12:00'
      slots = earlyLunch ? earlySlots : lateSlots
      preferLater = !earlyLunch
    } else {
      slots = legacySlots[lunch] ?? legacySlots['13:00']
    }

    const ranked = slots
      .map((slot, index) => ({
        slot,
        index,
        dayCount: counts.get(slot) ?? 0,
        personCount: monthlyUsage.get(`${person.id}|${slot}`) ?? 0,
      }))
      .filter((item) => item.dayCount < 2)
      .sort((a, b) =>
        a.personCount - b.personCount ||
        a.dayCount - b.dayCount ||
        (preferLater ? b.index - a.index : a.index - b.index),
      )

    const picked = ranked[0] ?? {
      slot: slots[0],
      dayCount: counts.get(slots[0]) ?? 0,
      personCount: monthlyUsage.get(`${person.id}|${slots[0]}`) ?? 0,
      index: 0,
    }

    counts.set(picked.slot, (counts.get(picked.slot) ?? 0) + 1)
    monthlyUsage.set(
      `${person.id}|${picked.slot}`,
      (monthlyUsage.get(`${person.id}|${picked.slot}`) ?? 0) + 1,
    )

    result.push({
      person_id: person.id,
      team_id: input.team.id,
      date,
      entry_type: 'snack',
      value: picked.slot,
      source: 'generated',
      metadata: {
        policy,
        lunch_start: lunch,
      },
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
  if (!allowedWeekdays.includes(day) || isHoliday(input, date) || isClickDay(input, date)) return []

  const seats = Number(ruleValue(teamRules, 'extended_people_per_day', 0))
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

  const targetDates = new Set(dates)
  const firstTargetDate = dates[0]
  const lastTargetDate = dates.at(-1) ?? dates[0]

  for (const monday of weeks) {
    const week = weekDays(monday)
    const peopleInWeek = input.people.filter((person) =>
      week.some((date) =>
        personMembershipOnDate(input.memberships, person.id, input.team.id, date, 'hybrid'),
      ),
    )

    const teamRules = rulesForDate(input.rules, input.team.id, null, monday)
    const extendedSeats = Number(ruleValue(teamRules, 'extended_people_per_day', 0))
    const extendedWeekdays = ruleArray(teamRules, 'extended_weekdays', [1, 2, 3, 4])
    const requiredHoByDate: Record<string, number> = {}
    const requiredEligibleByDate: Record<string, string[]> = {}

    if (extendedSeats > 0) {
      for (const date of week) {
        if (isHoliday(input, date) || isClickDay(input, date)) continue
        const weekday = atUtcDate(date).getUTCDay()
        if (!extendedWeekdays.includes(weekday)) continue
        requiredHoByDate[date] = extendedSeats
        requiredEligibleByDate[date] = peopleInWeek
          .filter((person) => {
            if (!personMembershipOnDate(input.memberships, person.id, input.team.id, date, 'extended')) return false
            if (absenceOnDate(input.absences, person.id, date)) return false
            const personRules = rulesForDate(input.rules, input.team.id, person.id, date)
            const allowed = ruleArray(personRules, 'extended_allowed_weekdays', [1, 2, 3, 4, 5])
            const blocked = ruleArray(personRules, 'extended_blocked_weekdays', [])
            return allowed.includes(weekday) && !blocked.includes(weekday)
          })
          .map((person) => person.id)
      }
    }

    const plannerPeople = peopleInWeek.map((person) => {
      const personRules = rulesForDate(input.rules, input.team.id, person.id, monday)
      const activeWeek = week.filter((date) =>
        personMembershipOnDate(input.memberships, person.id, input.team.id, date, 'hybrid'),
      )
      const holidayCredits = activeWeek.filter((date) => isHoliday(input, date)).length
      const targetHo = Math.max(0, 2 - holidayCredits)
      const fixedWeekdays = ruleArray(personRules, 'hybrid_fixed_weekdays', [])
      const preservedHoDates: string[] = []

      for (const date of activeWeek) {
        const existing = existingMap.get(`${person.id}|${input.team.id}|${date}|hybrid`)
        const beforeReference =
          input.stabilityMode === 'preserve_existing' &&
          Boolean(input.stabilityReferenceDate) &&
          date < (input.stabilityReferenceDate as string)
        const preserve =
          existing &&
          (!targetDates.has(date) ||
            beforeReference ||
            existing.locked ||
            existing.source === 'manual' ||
            existing.source === 'exception')
        if (
          preserve &&
          existing.value === 'HO' &&
          !isHoliday(input, date) &&
          !isClickDay(input, date)
        ) preservedHoDates.push(date)
      }

      const candidates = activeWeek
        .filter((date) => {
          if (isHoliday(input, date) || isClickDay(input, date)) return false
          if (fixedWeekdays.length && !fixedWeekdays.includes(atUtcDate(date).getUTCDay())) return false
          if (
            input.stabilityMode === 'preserve_existing' &&
            input.stabilityReferenceDate &&
            date < input.stabilityReferenceDate
          ) return false
          if (absenceOnDate(input.absences, person.id, date)) return false
          if (isForcedPresentialAroundVacation(input.absences, person.id, date)) return false

          const existing = existingMap.get(`${person.id}|${input.team.id}|${date}|hybrid`)
          const outsideCurrentMonth = !targetDates.has(date)

          // A semana operacional atravessa a virada do mês. Dias do mês anterior
          // nunca são replanejados; apenas contam se já possuem escala.
          if (outsideCurrentMonth && firstTargetDate && date < firstTargetDate) return false

          // Dias do mês seguinte podem participar do planejamento como reserva
          // virtual. Se já possuem escala, ela é tratada como compromisso fechado.
          if (outsideCurrentMonth && lastTargetDate && date > lastTargetDate && existing) return false

          if (
            existing &&
            (existing.locked || existing.source === 'manual' || existing.source === 'exception')
          ) return false
          return true
        })
        .map((date) => ({ date, weekday: atUtcDate(date).getUTCDay() }))

      const preferredDates =
        input.stabilityMode === 'preserve_existing'
          ? activeWeek.filter((date) => {
              const existing = existingMap.get(`${person.id}|${input.team.id}|${date}|hybrid`)
              return existing?.value === 'HO' && !preservedHoDates.includes(date)
            })
          : []

      return {
        id: person.id,
        name: person.name,
        remaining: Math.max(0, targetHo - preservedHoDates.length),
        preservedHoDates,
        candidates,
        fixedWeekdays,
        preferredWeekdays: ruleArray(personRules, 'hybrid_preferred_weekdays', []),
        preferredDates,
      }
    })

    const weeklyHo = planWeeklyHybrid({ people: plannerPeople, requiredHoByDate, requiredEligibleByDate })

    for (const person of peopleInWeek) {
      for (const date of week) {
        if (!targetDates.has(date)) continue
        if (!personMembershipOnDate(input.memberships, person.id, input.team.id, date, 'hybrid')) continue

        const existing = existingMap.get(`${person.id}|${input.team.id}|${date}|hybrid`)
        const preservePast =
          input.stabilityMode === 'preserve_existing' &&
          input.stabilityReferenceDate &&
          date < input.stabilityReferenceDate &&
          existing
        const clickDay = isClickDay(input, date)
        const clickDayOverridesWorkingMode =
          clickDay && existing && ['P', 'HO', 'CLICK_DAY'].includes(existing.value)

        if (
          !clickDayOverridesWorkingMode &&
          (
            preservePast ||
            existing?.locked ||
            existing?.source === 'manual' ||
            existing?.source === 'exception'
          )
        ) {
          if (existing) entries.push(existing)
          continue
        }

        const absence = absenceOnDate(input.absences, person.id, date)
        let value = 'P'
        if (isHoliday(input, date)) value = 'FERIADO'
        else if (absence) value = absence.kind
        else if (clickDay) value = 'CLICK_DAY'
        else if (isForcedPresentialAroundVacation(input.absences, person.id, date)) value = 'P'
        else if (weeklyHo.get(person.id)?.has(date)) value = 'HO'

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
  const snackUsage = new Map<string, number>()
  const preserveBefore =
    input.stabilityMode === 'preserve_existing' ? input.stabilityReferenceDate : undefined

  for (const existing of input.existingEntries ?? []) {
    const historical = Boolean(preserveBefore && existing.date < preserveBefore)
    if (
      existing.entry_type === 'extended' &&
      (historical || existing.locked || existing.source === 'manual' || existing.source === 'exception')
    ) {
      extendedCounts.set(existing.person_id, (extendedCounts.get(existing.person_id) ?? 0) + 1)
    }
    if (
      existing.entry_type === 'snack' &&
      (historical || existing.locked || existing.source === 'manual' || existing.source === 'exception')
    ) {
      const key = `${existing.person_id}|${existing.value}`
      snackUsage.set(key, (snackUsage.get(key) ?? 0) + 1)
    }
  }

  for (const date of dates) {
    if (preserveBefore && date < preserveBefore) {
      entries.push(
        ...(input.existingEntries ?? []).filter(
          (entry) =>
            entry.date === date &&
            (entry.entry_type === 'lunch' ||
              entry.entry_type === 'snack' ||
              entry.entry_type === 'extended'),
        ),
      )
      continue
    }

    const clickDay = isClickDay(input, date)
    if (clickDay || input.preserveExistingLunchSnack) {
      const previousDaily = (input.existingEntries ?? []).filter(
        (entry) =>
          entry.date === date &&
          (entry.entry_type === 'lunch' || entry.entry_type === 'snack'),
      )
      const previousKeys = new Set(previousDaily.map(entryKey))

      const generatedLunch = distributeLunch(
        input,
        date,
        getActivePeople(input, date, 'lunch'),
        entries,
      ).filter((entry) => !previousKeys.has(entryKey(entry)))
      entries.push(...generatedLunch)

      const generatedSnack = distributeSnack(
        input,
        date,
        getActivePeople(input, date, 'snack'),
        [...entries, ...previousDaily],
        snackUsage,
      ).filter((entry) => !previousKeys.has(entryKey(entry)))

      entries.push(...generatedSnack, ...previousDaily)

      if (!clickDay) {
        entries.push(...distributeExtended(
          input,
          date,
          getActivePeople(input, date, 'extended'),
          entries,
          extendedCounts,
        ))
      }
      continue
    }

    entries.push(...distributeLunch(input, date, getActivePeople(input, date, 'lunch'), entries))
    entries.push(...distributeSnack(input, date, getActivePeople(input, date, 'snack'), entries, snackUsage))
    entries.push(...distributeExtended(input, date, getActivePeople(input, date, 'extended'), entries, extendedCounts))
  }

  validations.push(...validateSchedule(input, entries))
  return { entries, validations }
}

export function validateSchedule(input: ScheduleGenerationInput, entries: ScheduleEntry[]) {
  const validations: ScheduleValidation[] = []
  const dates = monthDays(input.year, input.month)

  for (const entry of entries) {
    const entryMembershipType =
      entry.entry_type === 'hybrid' || entry.entry_type === 'lunch' || entry.entry_type === 'snack' || entry.entry_type === 'extended'
        ? entry.entry_type
        : undefined
    if (!personMembershipOnDate(input.memberships, entry.person_id, input.team.id, entry.date, entryMembershipType)) {
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
    const teamRules = rulesForDate(input.rules, input.team.id, null, date)
    const presentPreferred = ruleValue<string>(teamRules, 'lunch_presential_preferred_time', '12:00')
    const hoPreferred = ruleValue<string>(
      teamRules,
      'lunch_ho_preferred_time',
      ruleValue<string>(teamRules, 'ho_lunch_time', '13:00'),
    )
    const modalStrict = ruleValue<boolean>(teamRules, 'lunch_modal_strict', false)
    const experiencedNames = ruleValue<string[]>(teamRules, 'experienced_people', [])
    const experiencedMinAtNoon = Number(ruleValue(teamRules, 'experienced_min_at_12', 0))

    if (modalStrict) {
      for (const lunch of lunches) {
        const expected = hybrid.get(lunch.person_id) === 'HO' ? hoPreferred : presentPreferred
        if (lunch.value !== expected) {
          validations.push({
            level: 'error',
            code: 'LUNCH_MODALITY_MISMATCH',
            message: `Almoço incompatível com a modalidade. Esperado: ${expected}.`,
            date,
            person_id: lunch.person_id,
          })
        }
      }
    }

    if (experiencedMinAtNoon > 0 && !isHoliday(input, date)) {
      const experiencedAtNoon = lunches.filter((lunch) => {
        const person = input.people.find((item) => item.id === lunch.person_id)
        return lunch.value === '12:00' && Boolean(person && experiencedNames.includes(person.name))
      }).length
      const experiencedAvailable = input.people.filter(
        (person) =>
          experiencedNames.includes(person.name) &&
          personMembershipOnDate(input.memberships, person.id, input.team.id, date, 'lunch') &&
          !absenceOnDate(input.absences, person.id, date) &&
          hybrid.get(person.id) !== 'HO',
      ).length
      const required = Math.min(experiencedMinAtNoon, experiencedAvailable)
      if (experiencedAtNoon < required) {
        validations.push({
          level: 'error',
          code: 'LUNCH_EXPERIENCED_COVERAGE',
          message: `Almoço das 12:00 precisa manter pelo menos ${required} pessoa(s) experiente(s).`,
          date,
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

    if (isClickDay(input, date)) {
      const clickHybrid = [...hybrid.entries()]
      for (const [personId, value] of clickHybrid) {
        if (value === 'HO') {
          validations.push({
            level: 'error',
            code: 'CLICK_DAY_HO',
            message: 'Click Day não pode manter Home Office.',
            date,
            person_id: personId,
          })
        }
      }

      const clickExtended = entries.filter(
        (entry) => entry.date === date && entry.entry_type === 'extended',
      )
      if (clickExtended.length) {
        validations.push({
          level: 'error',
          code: 'CLICK_DAY_EXTENDED',
          message: 'Click Day não pode ter Estendido.',
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

    const extendedSeats = Number(ruleValue(teamRules, 'extended_people_per_day', 0))
    const extendedWeekdays = ruleArray(teamRules, 'extended_weekdays', [1, 2, 3, 4])
    const shouldHaveExtended =
      extendedSeats > 0 &&
      extendedWeekdays.includes(atUtcDate(date).getUTCDay()) &&
      !isHoliday(input, date) &&
      !isClickDay(input, date)

    if (shouldHaveExtended && extended.length < extendedSeats) {
      validations.push({
        level: 'error',
        code: 'EXTENDED_UNDER_CAPACITY',
        message: `Estendido precisa de ${extendedSeats} pessoa(s), mas foram escaladas ${extended.length}.`,
        date,
      })
    }
  }

  const weekStarts = [...new Set(dates.map(mondayOf))]
  const hybridReference = new Map<string, ScheduleEntry>()
  for (const entry of input.existingEntries ?? []) {
    if (entry.entry_type === 'hybrid' && entry.team_id === input.team.id) {
      hybridReference.set(`${entry.person_id}|${entry.date}`, entry)
    }
  }
  for (const entry of entries) {
    if (entry.entry_type === 'hybrid' && entry.team_id === input.team.id) {
      hybridReference.set(`${entry.person_id}|${entry.date}`, entry)
    }
  }

  for (const monday of weekStarts) {
    const week = weekDays(monday)
    for (const person of input.people) {
      const activeDays = week.filter((date) =>
        personMembershipOnDate(input.memberships, person.id, input.team.id, date, 'hybrid'),
      )
      if (!activeDays.length) continue

      const completeWeek = activeDays.every(
        (date) => hybridReference.has(`${person.id}|${date}`) || isHoliday(input, date),
      )
      if (!completeWeek) continue

      const holidayCredits = activeDays.filter((date) => isHoliday(input, date)).length
      const expectedHo = Math.max(0, 2 - holidayCredits)
      const actualHo = activeDays.filter(
        (date) => hybridReference.get(`${person.id}|${date}`)?.value === 'HO',
      ).length

      if (actualHo !== expectedHo) {
        validations.push({
          level: 'warning',
          code: 'HYBRID_WEEKLY_BALANCE',
          message: `${person.name}: semana de ${monday} ficou com ${actualHo} dia(s) de HO; referência operacional: ${expectedHo}.`,
          date: monday,
          person_id: person.id,
        })
      }
    }
  }

  const extendedCounts = new Map<string, number>()
  for (const entry of entries.filter((item) => item.entry_type === 'extended')) {
    extendedCounts.set(entry.person_id, (extendedCounts.get(entry.person_id) ?? 0) + 1)
  }
  const eligibleExtendedPeople = input.people.filter((person) =>
    dates.some((date) =>
      personMembershipOnDate(input.memberships, person.id, input.team.id, date, 'extended') &&
      !absenceOnDate(input.absences, person.id, date),
    ),
  )
  const distribution = eligibleExtendedPeople.map((person) => extendedCounts.get(person.id) ?? 0)
  if (distribution.length > 1 && Math.max(...distribution) - Math.min(...distribution) > 1) {
    validations.push({
      level: 'warning',
      code: 'EXTENDED_UNBALANCED',
      message: 'Distribuição do estendido ficou com diferença maior que 1 entre participantes elegíveis.',
    })
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
