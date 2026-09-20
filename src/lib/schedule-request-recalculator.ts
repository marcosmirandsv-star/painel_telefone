import type { SupabaseClient } from '@supabase/supabase-js'
import { generateMonthlySchedule, validateSchedule } from './schedule-engine'
import type {
  ScheduleAbsence,
  ScheduleEntry,
  ScheduleMembership,
  ScheduleMonthContext,
  SchedulePerson,
  ScheduleRule,
  ScheduleTeam,
} from './schedule-types'

export type ScheduleRequestForReview = {
  id: string
  requester_person_id: string | null
  requester_name: string
  requester_email: string | null
  team_id: string
  target_date: string
  request_type: string
  requested_value: string | null
  reason: string | null
  status: string
}

export type RecalculationResult = {
  status: 'applied' | 'needs_review' | 'manual_required' | 'not_applicable'
  summary: string
  affectedDates: string[]
  changes: Array<{
    person_id: string
    person_name: string
    date: string
    entry_type: string
    before: string | null
    after: string | null
  }>
  validationErrors: string[]
}

const ENTRY_TYPES = ['hybrid', 'lunch', 'snack', 'extended'] as const

function normalize(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function monthRange(dateValue: string) {
  const [year, month] = dateValue.split('-').map(Number)
  const start = `${year}-${String(month).padStart(2, '0')}-01`
  const end = new Date(Date.UTC(year, month, 0, 12)).toISOString().slice(0, 10)
  return { year, month, start, end }
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function operationalWeek(dateValue: string) {
  const date = new Date(`${dateValue}T12:00:00Z`)
  const dow = date.getUTCDay()
  const delta = dow === 0 ? -6 : 1 - dow
  const monday = addDays(dateValue, delta)
  return Array.from({ length: 5 }, (_, index) => addDays(monday, index))
}

function entryKey(entry: Pick<ScheduleEntry, 'person_id' | 'team_id' | 'date' | 'entry_type'>) {
  return `${entry.person_id}|${entry.team_id}|${entry.date}|${entry.entry_type}`
}

function absenceKind(requestType: string): ScheduleAbsence['kind'] | null {
  const type = normalize(requestType)
  if (type.includes('day off')) return 'DAY_OFF'
  if (type.includes('premia')) return 'PREMIACAO'
  if (type.includes('banco')) return 'BANCO_HORAS'
  if (type === 'folga' || type.includes('compens')) return 'FOLGA'
  return null
}

function isHybridChange(requestType: string) {
  return normalize(requestType).includes('home office')
}

function isSaturday(dateValue: string) {
  return new Date(`${dateValue}T12:00:00Z`).getUTCDay() === 6
}

async function resolvePerson(
  supabase: SupabaseClient,
  request: ScheduleRequestForReview,
) {
  if (request.requester_person_id) return request.requester_person_id

  const { data: people } = await supabase
    .from('schedule_people')
    .select('id,name')
    .ilike('name', request.requester_name)

  const candidates = people ?? []
  for (const person of candidates) {
    const { data: membership } = await supabase
      .from('schedule_memberships')
      .select('id')
      .eq('person_id', person.id)
      .eq('team_id', request.team_id)
      .eq('participates_in_schedule', true)
      .lte('start_date', request.target_date)
      .or(`end_date.is.null,end_date.gte.${request.target_date}`)
      .maybeSingle()
    if (membership) return String(person.id)
  }
  return null
}

async function createChangeEvent(
  supabase: SupabaseClient,
  request: ScheduleRequestForReview,
  result: RecalculationResult,
) {
  if (!result.affectedDates.length || !result.changes.length) return
  await supabase.from('schedule_change_events').insert({
    team_id: request.team_id,
    request_id: request.id,
    target_date: request.target_date,
    affected_dates: result.affectedDates,
    summary: result.summary,
    details: {
      changes: result.changes,
      validation_errors: result.validationErrors,
      recalculation_status: result.status,
    },
    visible_to_team: true,
  })
}

export async function approveAndRecalculateScheduleRequest(
  supabase: SupabaseClient,
  request: ScheduleRequestForReview,
  reviewNotes?: string | null,
): Promise<RecalculationResult> {
  const personId = await resolvePerson(supabase, request)
  const { data: teamRow } = await supabase
    .from('schedule_teams')
    .select('*')
    .eq('id', request.team_id)
    .maybeSingle()

  const team = teamRow as ScheduleTeam | null
  if (!team) {
    throw new Error('Time da solicitação não encontrado.')
  }

  const baseUpdate = {
    status: 'approved',
    reviewed_at: new Date().toISOString(),
    review_notes: reviewNotes || null,
  }

  if (isSaturday(request.target_date) || team.code === 'sabados') {
    await supabase
      .from('schedule_requests')
      .update({
        ...baseUpdate,
        recalculation_status: 'not_applicable',
        recalculation_summary: { reason: 'Sábado não participa do recálculo automático.' },
      })
      .eq('id', request.id)

    return {
      status: 'not_applicable',
      summary: 'Solicitação aprovada. A escala de sábado não foi recalculada automaticamente.',
      affectedDates: [],
      changes: [],
      validationErrors: [],
    }
  }

  const autoTeams = new Set(['telefone', 'especializado', 'outros', 'n2'])
  const kind = absenceKind(request.request_type)
  const hybridRequest = isHybridChange(request.request_type)

  if (!autoTeams.has(team.code) || (!kind && !hybridRequest)) {
    await supabase
      .from('schedule_requests')
      .update({
        ...baseUpdate,
        recalculation_status: 'manual_required',
        recalculation_summary: {
          reason: 'Tipo de solicitação ou time exige ajuste manual antes de avisar a equipe.',
        },
      })
      .eq('id', request.id)

    return {
      status: 'manual_required',
      summary: 'Solicitação aprovada, mas este tipo de alteração exige ajuste manual da escala.',
      affectedDates: [],
      changes: [],
      validationErrors: [],
    }
  }

  const { year, month, start: monthStart, end: monthEnd } = monthRange(request.target_date)
  const { data: priorTargetRows } = await supabase
    .from('schedule_entries')
    .select('*')
    .eq('team_id', request.team_id)
    .eq('date', request.target_date)
  const priorTargetEntries = (priorTargetRows ?? []) as ScheduleEntry[]

  if (!personId) {
    await supabase
      .from('schedule_requests')
      .update({
        ...baseUpdate,
        recalculation_status: 'needs_review',
        recalculation_summary: { reason: 'Não foi possível identificar a pessoa da solicitação.' },
      })
      .eq('id', request.id)

    return {
      status: 'needs_review',
      summary: 'Solicitação aprovada, mas a pessoa não pôde ser identificada para o recálculo.',
      affectedDates: [],
      changes: [],
      validationErrors: ['Pessoa da solicitação não identificada.'],
    }
  }

  if (kind) {
    const { data: existingAbsence } = await supabase
      .from('schedule_absences')
      .select('id')
      .eq('person_id', personId)
      .eq('kind', kind)
      .lte('start_date', request.target_date)
      .gte('end_date', request.target_date)
      .limit(1)
      .maybeSingle()

    if (!existingAbsence) {
      const { error } = await supabase.from('schedule_absences').insert({
        person_id: personId,
        kind,
        start_date: request.target_date,
        end_date: request.target_date,
        notes: `Criado automaticamente pela solicitação ${request.id}.`,
      })
      if (error) throw new Error(error.message)
    }

    await supabase
      .from('schedule_entries')
      .delete()
      .eq('team_id', request.team_id)
      .eq('person_id', personId)
      .eq('date', request.target_date)
      .in('entry_type', [...ENTRY_TYPES])
  }

  if (hybridRequest) {
    const value = request.requested_value === 'HO' || request.requested_value === 'P'
      ? request.requested_value
      : null

    if (!value) {
      await supabase
        .from('schedule_requests')
        .update({
          ...baseUpdate,
          recalculation_status: 'needs_review',
          recalculation_summary: {
            reason: 'A solicitação de Home Office não informou a modalidade desejada.',
          },
        })
        .eq('id', request.id)

      return {
        status: 'needs_review',
        summary: 'Solicitação aprovada, mas falta informar Home Office ou Presencial.',
        affectedDates: [],
        changes: [],
        validationErrors: ['Modalidade desejada não informada.'],
      }
    }

    const { error } = await supabase.from('schedule_entries').upsert({
      person_id: personId,
      team_id: request.team_id,
      date: request.target_date,
      entry_type: 'hybrid',
      value,
      source: 'exception',
      locked: true,
      metadata: {
        approved_request_id: request.id,
        requested_change: true,
      },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'person_id,team_id,date,entry_type' })

    if (error) throw new Error(error.message)
  }

  const paddedStart = addDays(monthStart, -7)
  const paddedEnd = addDays(monthEnd, 7)

  const [
    peopleResult,
    membershipsResult,
    rulesResult,
    absencesResult,
    entriesResult,
    contextsResult,
  ] = await Promise.all([
    supabase.from('schedule_people').select('*').order('name'),
    supabase.from('schedule_memberships').select('*').eq('team_id', request.team_id).lte('start_date', paddedEnd),
    supabase.from('schedule_rules').select('*').eq('active', true).order('start_date'),
    supabase.from('schedule_absences').select('*').lte('start_date', paddedEnd).gte('end_date', paddedStart),
    supabase.from('schedule_entries').select('*').eq('team_id', request.team_id).gte('date', paddedStart).lte('date', paddedEnd),
    supabase.from('schedule_month_contexts').select('*').order('year').order('month'),
  ])

  const people = (peopleResult.data ?? []) as SchedulePerson[]
  const memberships = ((membershipsResult.data ?? []) as ScheduleMembership[]).filter(
    (membership) => !membership.end_date || membership.end_date >= paddedStart,
  )
  const rules = (rulesResult.data ?? []) as ScheduleRule[]
  const absences = (absencesResult.data ?? []) as ScheduleAbsence[]
  const existingEntries = (entriesResult.data ?? []) as ScheduleEntry[]
  const contexts = (contextsResult.data ?? []) as ScheduleMonthContext[]

  const currentContext = contexts.find((item) => item.year === year && item.month === month)
  const context: ScheduleMonthContext = {
    id: currentContext?.id,
    year,
    month,
    holidays: [...new Set(contexts.flatMap((item) => item.holidays ?? []))],
    optional_days: [...new Set(contexts.flatMap((item) => item.optional_days ?? []))],
    notes: currentContext?.notes ?? null,
  }

  const generated = generateMonthlySchedule({
    team,
    people,
    memberships,
    absences,
    rules,
    context,
    year,
    month,
    existingEntries,
  })

  const currentMonthEntries = existingEntries.filter(
    (entry) => entry.date >= monthStart && entry.date <= monthEnd,
  )
  const baselineMonthEntries = [
    ...currentMonthEntries.filter((entry) => entry.date !== request.target_date),
    ...priorTargetEntries,
  ]

  const protectedEntries = currentMonthEntries.filter(
    (entry) =>
      (entry.locked || entry.source === 'manual' || entry.source === 'exception') &&
      !(kind && entry.person_id === personId && entry.date === request.target_date),
  )
  const protectedKeys = new Set(protectedEntries.map(entryKey))
  const generatedEntries = generated.entries.filter((entry) => !protectedKeys.has(entryKey(entry)))
  const finalMonthEntries = [...generatedEntries, ...protectedEntries]

  const oldMap = new Map(baselineMonthEntries.map((entry) => [entryKey(entry), entry]))
  const newMap = new Map(finalMonthEntries.map((entry) => [entryKey(entry), entry]))
  const week = operationalWeek(request.target_date).filter(
    (date) => date >= monthStart && date <= monthEnd,
  )

  const affected = new Set<string>([request.target_date])
  for (const date of week) {
    const peopleIds = new Set(
      [
        ...baselineMonthEntries.filter((entry) => entry.date === date && entry.entry_type === 'hybrid'),
        ...finalMonthEntries.filter((entry) => entry.date === date && entry.entry_type === 'hybrid'),
      ].map((entry) => entry.person_id),
    )
    for (const id of peopleIds) {
      const key = `${id}|${request.team_id}|${date}|hybrid`
      const before = oldMap.get(key)?.value ?? null
      const after = newMap.get(key)?.value ?? null
      if (before !== after) affected.add(date)
    }
  }

  const affectedDates = [...affected].sort()

  for (const date of affectedDates) {
    const { error: cleanupError } = await supabase
      .from('schedule_entries')
      .delete()
      .eq('team_id', request.team_id)
      .eq('date', date)
      .eq('source', 'generated')
      .eq('locked', false)

    if (cleanupError) throw new Error(cleanupError.message)
  }

  if (kind) {
    await supabase
      .from('schedule_entries')
      .delete()
      .eq('team_id', request.team_id)
      .eq('person_id', personId)
      .eq('date', request.target_date)
      .in('entry_type', [...ENTRY_TYPES])
  }

  const entriesToPersist = finalMonthEntries.filter(
    (entry) => affected.has(entry.date),
  )

  if (entriesToPersist.length) {
    const { error: upsertError } = await supabase.from('schedule_entries').upsert(
      entriesToPersist.map((entry) => ({
        person_id: entry.person_id,
        team_id: entry.team_id,
        date: entry.date,
        entry_type: entry.entry_type,
        value: entry.value,
        source: entry.source,
        locked: entry.locked ?? false,
        metadata: entry.metadata ?? {},
        updated_at: new Date().toISOString(),
      })),
      { onConflict: 'person_id,team_id,date,entry_type' },
    )

    if (upsertError) throw new Error(upsertError.message)
  }

  const postMonthEntries = [
    ...currentMonthEntries.filter((entry) => !affected.has(entry.date)),
    ...entriesToPersist,
  ]
  const validations = validateSchedule(
    {
      team,
      people,
      memberships,
      absences,
      rules,
      context,
      year,
      month,
      existingEntries: postMonthEntries,
    },
    postMonthEntries,
  )

  const errors = validations.filter((item) => item.level === 'error')
  const peopleById = new Map(people.map((person) => [person.id, person.name]))
  const changes: RecalculationResult['changes'] = []

  for (const date of affectedDates) {
    for (const type of ENTRY_TYPES) {
      const ids = new Set(
        [
          ...baselineMonthEntries.filter((entry) => entry.date === date && entry.entry_type === type),
          ...entriesToPersist.filter((entry) => entry.date === date && entry.entry_type === type),
        ].map((entry) => entry.person_id),
      )
      for (const id of ids) {
        const key = `${id}|${request.team_id}|${date}|${type}`
        const before = oldMap.get(key)?.value ?? null
        const after = entriesToPersist.find(
          (entry) =>
            entry.person_id === id &&
            entry.team_id === request.team_id &&
            entry.date === date &&
            entry.entry_type === type,
        )?.value ?? null

        if (before !== after) {
          changes.push({
            person_id: id,
            person_name: peopleById.get(id) ?? 'Colaborador',
            date,
            entry_type: type,
            before,
            after,
          })
        }
      }
    }
  }

  const formattedDates = affectedDates
    .map((date) => new Date(`${date}T12:00:00`).toLocaleDateString('pt-BR'))
    .join(', ')

  const result: RecalculationResult = {
    status: errors.length ? 'needs_review' : 'applied',
    summary: errors.length
      ? `A escala foi recalculada após uma solicitação aprovada. Confira os dias ${formattedDates}; há pontos que exigem revisão da gestão.`
      : `A escala foi atualizada após uma solicitação aprovada. Confira novamente os dias ${formattedDates}.`,
    affectedDates,
    changes,
    validationErrors: errors.map((item) => item.message),
  }

  await supabase
    .from('schedule_requests')
    .update({
      ...baseUpdate,
      applied_at: new Date().toISOString(),
      recalculation_status: result.status,
      recalculation_summary: {
        affected_dates: affectedDates,
        changes_count: changes.length,
        validation_errors: result.validationErrors,
      },
    })
    .eq('id', request.id)

  await createChangeEvent(supabase, request, result)
  return result
}
