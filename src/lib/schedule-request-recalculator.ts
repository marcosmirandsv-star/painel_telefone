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

function localTodayIso() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
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

  for (const person of people ?? []) {
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

async function updateRequestOnly(
  supabase: SupabaseClient,
  requestId: string,
  reviewNotes: string | null | undefined,
  recalculationStatus: string,
  recalculationSummary: Record<string, unknown>,
) {
  const { error } = await supabase
    .from('schedule_requests')
    .update({
      status: 'approved',
      reviewed_at: new Date().toISOString(),
      review_notes: reviewNotes || null,
      recalculation_status: recalculationStatus,
      recalculation_summary: recalculationSummary,
    })
    .eq('id', requestId)

  if (error) throw new Error(error.message)
}

export async function approveAndRecalculateScheduleRequest(
  supabase: SupabaseClient,
  request: ScheduleRequestForReview,
  reviewNotes?: string | null,
): Promise<RecalculationResult> {
  const personId = await resolvePerson(supabase, request)
  const { data: teamRow, error: teamError } = await supabase
    .from('schedule_teams')
    .select('*')
    .eq('id', request.team_id)
    .maybeSingle()

  if (teamError) throw new Error(teamError.message)

  const team = teamRow as ScheduleTeam | null
  if (!team) throw new Error('Time da solicitação não encontrado.')

  if (isSaturday(request.target_date) || team.code === 'sabados') {
    await updateRequestOnly(
      supabase,
      request.id,
      reviewNotes,
      'not_applicable',
      { reason: 'Sábado não participa do recálculo automático.' },
    )

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
    await updateRequestOnly(
      supabase,
      request.id,
      reviewNotes,
      'manual_required',
      { reason: 'Tipo de solicitação ou time exige ajuste manual antes de avisar a equipe.' },
    )

    return {
      status: 'manual_required',
      summary: 'Solicitação aprovada, mas este tipo de alteração exige ajuste manual da escala.',
      affectedDates: [],
      changes: [],
      validationErrors: [],
    }
  }

  if (!personId) {
    await updateRequestOnly(
      supabase,
      request.id,
      reviewNotes,
      'needs_review',
      { reason: 'Não foi possível identificar a pessoa da solicitação.' },
    )

    return {
      status: 'needs_review',
      summary: 'Solicitação aprovada, mas a pessoa não pôde ser identificada para o recálculo.',
      affectedDates: [],
      changes: [],
      validationErrors: ['Pessoa da solicitação não identificada.'],
    }
  }

  const hybridValue = hybridRequest
    ? request.requested_value === 'HO' || request.requested_value === 'P'
      ? request.requested_value
      : null
    : null

  if (hybridRequest && !hybridValue) {
    await updateRequestOnly(
      supabase,
      request.id,
      reviewNotes,
      'needs_review',
      { reason: 'A solicitação de Home Office não informou a modalidade desejada.' },
    )

    return {
      status: 'needs_review',
      summary: 'Solicitação aprovada, mas falta informar Home Office ou Presencial.',
      affectedDates: [],
      changes: [],
      validationErrors: ['Modalidade desejada não informada.'],
    }
  }

  const { year, month, start: monthStart, end: monthEnd } = monthRange(request.target_date)
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

  const queryErrors = [
    peopleResult.error,
    membershipsResult.error,
    rulesResult.error,
    absencesResult.error,
    entriesResult.error,
    contextsResult.error,
  ].filter(Boolean)

  if (queryErrors.length) throw new Error(queryErrors[0]?.message ?? 'Erro ao carregar dados da escala.')

  const people = (peopleResult.data ?? []) as SchedulePerson[]
  const memberships = ((membershipsResult.data ?? []) as ScheduleMembership[]).filter(
    (membership) => !membership.end_date || membership.end_date >= paddedStart,
  )
  const rules = (rulesResult.data ?? []) as ScheduleRule[]
  const baselineAbsences = (absencesResult.data ?? []) as ScheduleAbsence[]
  const baselineEntries = (entriesResult.data ?? []) as ScheduleEntry[]
  const contexts = (contextsResult.data ?? []) as ScheduleMonthContext[]

  const priorTargetEntries = baselineEntries.filter((entry) => entry.date === request.target_date)
  const simulatedAbsences = [...baselineAbsences]
  let absencePayload: Record<string, unknown> | null = null

  if (kind) {
    const existingAbsence = simulatedAbsences.some(
      (absence) =>
        absence.person_id === personId &&
        absence.kind === kind &&
        absence.start_date <= request.target_date &&
        absence.end_date >= request.target_date,
    )

    if (!existingAbsence) {
      const newAbsence: ScheduleAbsence = {
        person_id: personId,
        kind,
        start_date: request.target_date,
        end_date: request.target_date,
        notes: `Criado automaticamente pela solicitação ${request.id}.`,
      }
      simulatedAbsences.push(newAbsence)
      absencePayload = newAbsence
    }
  }

  let simulatedEntries = [...baselineEntries]

  if (kind) {
    simulatedEntries = simulatedEntries.filter(
      (entry) =>
        !(
          entry.person_id === personId &&
          entry.team_id === request.team_id &&
          entry.date === request.target_date &&
          ENTRY_TYPES.includes(entry.entry_type as typeof ENTRY_TYPES[number])
        ),
    )
  }

  if (hybridValue) {
    const exceptionEntry: ScheduleEntry = {
      person_id: personId,
      team_id: request.team_id,
      date: request.target_date,
      entry_type: 'hybrid',
      value: hybridValue,
      source: 'exception',
      locked: true,
      metadata: {
        approved_request_id: request.id,
        requested_change: true,
      },
    }

    simulatedEntries = [
      ...simulatedEntries.filter(
        (entry) =>
          !(
            entry.person_id === personId &&
            entry.team_id === request.team_id &&
            entry.date === request.target_date &&
            entry.entry_type === 'hybrid'
          ),
      ),
      exceptionEntry,
    ]
  }

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
    absences: simulatedAbsences,
    rules,
    context,
    year,
    month,
    existingEntries: simulatedEntries,
    stabilityMode: 'preserve_existing',
    stabilityReferenceDate: localTodayIso(),
  })

  const baselineMonthEntries = baselineEntries.filter(
    (entry) => entry.date >= monthStart && entry.date <= monthEnd,
  )
  const simulatedMonthEntries = simulatedEntries.filter(
    (entry) => entry.date >= monthStart && entry.date <= monthEnd,
  )

  const protectedEntries = simulatedMonthEntries.filter(
    (entry) => entry.locked || entry.source === 'manual' || entry.source === 'exception',
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
  const entriesToPersist = finalMonthEntries.filter((entry) => affected.has(entry.date))

  const postMonthEntries = [
    ...baselineMonthEntries.filter((entry) => !affected.has(entry.date)),
    ...entriesToPersist,
  ]

  const validations = validateSchedule(
    {
      team,
      people,
      memberships,
      absences: simulatedAbsences,
      rules,
      context,
      year,
      month,
      existingEntries: postMonthEntries,
      stabilityMode: 'preserve_existing',
      stabilityReferenceDate: localTodayIso(),
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

  const entriesPayload = entriesToPersist.map((entry) => ({
    person_id: entry.person_id,
    team_id: entry.team_id,
    date: entry.date,
    entry_type: entry.entry_type,
    value: entry.value,
    source: entry.source,
    locked: entry.locked ?? false,
    metadata: entry.metadata ?? {},
  }))

  const eventPayload = changes.length
    ? {
        team_id: request.team_id,
        target_date: request.target_date,
        affected_dates: affectedDates,
        summary: result.summary,
        details: {
          changes,
          validation_errors: result.validationErrors,
          recalculation_status: result.status,
        },
        visible_to_team: true,
      }
    : null

  const { error: applyError } = await supabase.rpc('apply_schedule_request_recalculation', {
    p_request_id: request.id,
    p_review_notes: reviewNotes || '',
    p_recalculation_status: result.status,
    p_recalculation_summary: {
      affected_dates: affectedDates,
      changes_count: changes.length,
      validation_errors: result.validationErrors,
    },
    p_absence: absencePayload,
    p_absence_person_id: kind ? personId : null,
    p_absence_target_date: kind ? request.target_date : null,
    p_affected_dates: affectedDates,
    p_entries: entriesPayload,
    p_event: eventPayload,
  })

  if (applyError) throw new Error(applyError.message)

  return result
}
