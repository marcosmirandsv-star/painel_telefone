export type HybridCandidate = {
  date: string
  weekday: number
}

export type WeeklyHybridPerson = {
  id: string
  name: string
  remaining: number
  preservedHoDates: string[]
  candidates: HybridCandidate[]
  fixedWeekdays: number[]
  preferredWeekdays: number[]
  preferredDates?: string[]
}

export type WeeklyHybridPlanInput = {
  people: WeeklyHybridPerson[]
  requiredHoByDate: Record<string, number>
  requiredEligibleByDate?: Record<string, string[]>
}

function adjacent(a: string, b: string) {
  const da = new Date(`${a}T12:00:00Z`).getTime()
  const db = new Date(`${b}T12:00:00Z`).getTime()
  return Math.abs(da - db) === 24 * 60 * 60 * 1000
}

export function planWeeklyHybrid(input: WeeklyHybridPlanInput) {
  const assignments = new Map<string, Set<string>>()
  const remaining = new Map<string, number>()
  const dayCounts = new Map<string, number>()
  const coverageCounts = new Map<string, number>()
  const byId = new Map(input.people.map((person) => [person.id, person]))

  function coversRequirement(personId: string, date: string) {
    const eligible = input.requiredEligibleByDate?.[date]
    return !eligible || eligible.includes(personId)
  }

  for (const person of input.people) {
    const dates = new Set(person.preservedHoDates)
    assignments.set(person.id, dates)
    remaining.set(person.id, Math.max(0, person.remaining))
    for (const date of dates) {
      dayCounts.set(date, (dayCounts.get(date) ?? 0) + 1)
      if (coversRequirement(person.id, date)) {
        coverageCounts.set(date, (coverageCounts.get(date) ?? 0) + 1)
      }
    }
  }

  function canAssign(personId: string, date: string) {
    const person = byId.get(personId)
    if (!person || (remaining.get(personId) ?? 0) <= 0) return false
    if (assignments.get(personId)?.has(date)) return false
    return person.candidates.some((candidate) => candidate.date === date)
  }

  function assign(personId: string, date: string) {
    if (!canAssign(personId, date)) return false
    assignments.get(personId)?.add(date)
    remaining.set(personId, (remaining.get(personId) ?? 0) - 1)
    dayCounts.set(date, (dayCounts.get(date) ?? 0) + 1)
    if (coversRequirement(personId, date)) {
      coverageCounts.set(date, (coverageCounts.get(date) ?? 0) + 1)
    }
    return true
  }

  const constrained = [...input.people].sort((a, b) =>
    b.fixedWeekdays.length - a.fixedWeekdays.length
    || a.candidates.length - b.candidates.length
    || a.name.localeCompare(b.name)
  )

  for (const person of constrained) {
    for (const weekday of person.fixedWeekdays) {
      if ((remaining.get(person.id) ?? 0) <= 0) break
      const candidate = person.candidates.find((item) => item.weekday === weekday)
      if (candidate) assign(person.id, candidate.date)
    }
  }

  for (const [date, required] of Object.entries(input.requiredHoByDate)) {
    while ((coverageCounts.get(date) ?? 0) < required) {
      const candidatePeople = input.people
        .filter((person) => canAssign(person.id, date) && coversRequirement(person.id, date))
        .sort((a, b) => {
          const aw = a.candidates.find((item) => item.date === date)?.weekday
          const bw = b.candidates.find((item) => item.date === date)?.weekday
          const ap = aw !== undefined && a.preferredWeekdays.includes(aw) ? 0 : 1
          const bp = bw !== undefined && b.preferredWeekdays.includes(bw) ? 0 : 1
          return ap - bp
            || a.candidates.length - b.candidates.length
            || a.name.localeCompare(b.name)
        })
      if (!candidatePeople[0] || !assign(candidatePeople[0].id, date)) break
    }
  }

  const pending = [...input.people].sort((a, b) =>
    a.candidates.length - b.candidates.length || a.name.localeCompare(b.name)
  )

  for (const person of pending) {
    while ((remaining.get(person.id) ?? 0) > 0) {
      const current = assignments.get(person.id) ?? new Set<string>()
      const options = person.candidates.filter((candidate) => !current.has(candidate.date))
      if (!options.length) break

      options.sort((a, b) => {
        const score = (candidate: HybridCandidate) => {
          const required = input.requiredHoByDate[candidate.date] ?? 0
          const deficit = Math.max(0, required - (coverageCounts.get(candidate.date) ?? 0))
          const existingDate = person.preferredDates?.includes(candidate.date) ? 45 : 0
          const preferred = person.preferredWeekdays.includes(candidate.weekday) ? 25 : 0
          const consecutive = [...current].some((date) => adjacent(date, candidate.date)) ? 20 : 0
          const balancePenalty = (dayCounts.get(candidate.date) ?? 0) * 5
          return deficit * 100 + existingDate + preferred + consecutive - balancePenalty
        }
        return score(b) - score(a) || a.date.localeCompare(b.date)
      })

      if (!assign(person.id, options[0].date)) break
    }
  }

  return assignments
}
