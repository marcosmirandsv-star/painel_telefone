'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { scheduleSupabase as supabase } from '@/lib/schedule-supabase'
import { generateMonthlySchedule, validateSchedule } from '@/lib/schedule-engine'
import { ScheduleDateList } from '@/components/schedule-date-list'
import { ScheduleModal } from '@/components/schedule-modal'
import type {
  ScheduleAbsence,
  ScheduleEntry,
  ScheduleMembership,
  ScheduleMonthContext,
  SchedulePerson,
  ScheduleRule,
  ScheduleTeam,
  ScheduleValidation,
} from '@/lib/schedule-types'

type Profile = { id: string; full_name: string | null; role: string | null }
type Notification = {
  id: string
  profile_id: string
  title: string
  message: string
  seen_at: string | null
  created_at: string
  request_id: string | null
}

const MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']
const WEEKDAY_LABEL = ['DOM','SEG','TER','QUA','QUI','SEX','SÁB']

const RULE_LABELS: Record<string, string> = {
  experienced_min_at_12: 'Cobertura experiente às 12h',
  experienced_people: 'Pessoas experientes para cobertura',
  extended_allowed_weekdays: 'Dias permitidos para Estendido',
  extended_blocked_weekdays: 'Dias bloqueados para Estendido',
  extended_people_per_day: 'Pessoas no Estendido por dia',
  extended_shifts: 'Horários do Estendido',
  extended_weekdays: 'Dias da semana com Estendido',
  ho_lunch_time: 'Almoço em Home Office',
  hybrid_fixed_weekdays: 'Dias fixos de Home Office',
  hybrid_preferred_weekdays: 'Dias preferenciais de Home Office',
  lunch_default_time: 'Horário padrão de almoço',
  lunch_ho_preferred_time: 'Almoço preferencial em Home Office',
  lunch_modal_strict: 'Vínculo rígido entre modalidade e almoço',
  lunch_policy: 'Política de distribuição do almoço',
  lunch_presential_preferred_time: 'Almoço preferencial presencial',
  lunch_slot_targets: 'Distribuição de almoço por horário',
  lunch_windows: 'Janelas completas de almoço',
  shift_end_by_lunch: 'Saída prevista por janela de almoço',
  snack_early_slots: 'Faixa de café para almoço mais cedo',
  snack_fixed_time: 'Café fixo',
  snack_late_slots: 'Faixa de café para almoço mais tarde',
  snack_policy: 'Política de distribuição do café',
}

const RULE_POLICY_LABELS: Record<string, string> = {
  coverage_weighted: 'Preferência com ajuste por cobertura',
  by_modality: 'Preferência conforme Presencial / Home Office',
  balanced_by_lunch: 'Balanceado conforme o horário de almoço',
  fixed_by_person: 'Horário fixo por pessoa',
  legacy: 'Regra anterior',
}

function weekdayName(value: number) {
  return ['domingo','segunda','terça','quarta','quinta','sexta','sábado'][value] ?? String(value)
}

function readableRuleValue(rule: ScheduleRule) {
  const value = rule.rule_value?.value
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') return RULE_POLICY_LABELS[value] ?? value
  if (Array.isArray(value)) {
    if (value.every((item) => typeof item === 'number')) {
      return value.map((item) => weekdayName(Number(item))).join(', ')
    }
    return value.join(', ')
  }
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => `${key} → ${String(item)}`)
      .join(' · ')
  }
  return '—'
}

const STATUS = [
  ['P','Presencial'],
  ['HO','Home Office'],
  ['FOLGA','Folga'],
  ['DAY_OFF','Day Off'],
  ['PREMIACAO','Premiação'],
  ['BANCO_HORAS','Banco de horas'],
  ['FERIAS','Férias'],
  ['CLICK_DAY','Click Day'],
  ['SENAC','Senac'],
] as const

function beep() {
  try {
    const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextCtor) return
    const context = new AudioContextCtor()
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.frequency.value = 880
    gain.gain.value = 0.05
    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.start()
    oscillator.stop(context.currentTime + 0.14)
  } catch {
    // Som é um reforço; a notificação visual continua funcionando.
  }
}

function browserNotify(item: Notification) {
  if (typeof window === 'undefined' || !('Notification' in window)) return
  if (window.Notification.permission !== 'granted') return
  try {
    new window.Notification(item.title, { body: item.message, tag: item.id })
  } catch {
    // O pop-up interno continua sendo o canal principal.
  }
}

function ymd(year: number, month: number) {
  return `${year}-${String(month).padStart(2, '0')}`
}

function monthRange(year: number, month: number) {
  const start = `${ymd(year, month)}-01`
  const end = new Date(Date.UTC(year, month, 0, 12)).toISOString().slice(0, 10)
  return { start, end }
}

function shiftIsoDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function daysInMonth(year: number, month: number) {
  const total = new Date(year, month, 0).getDate()
  return Array.from({ length: total }, (_, index) => {
    const day = index + 1
    const value = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    const dow = new Date(`${value}T12:00:00`).getDay()
    return { value, day, dow, business: dow >= 1 && dow <= 5 }
  })
}

function scheduleCellTone(value?: string) {
  const key = (value ?? '').toLowerCase().replaceAll('_', '-')
  if (!key) return 'schedule-status-default'
  if (key === 'p') return 'schedule-status-p'
  if (key === 'ho') return 'schedule-status-ho'
  if (key === 'click-day') return 'schedule-status-click-day'
  if (key === 'feriado') return 'schedule-status-feriado'
  if (key === 'ferias') return 'schedule-status-ferias'
  if (key === 'day-off') return 'schedule-status-day-off'
  if (key === 'folga') return 'schedule-status-folga'
  if (key === 'premiacao') return 'schedule-status-premiacao'
  if (key === 'banco-horas') return 'schedule-status-banco-horas'
  if (key === 'senac') return 'schedule-status-senac'
  return 'schedule-status-default'
}

function membershipAllowsTab(
  membership: ScheduleMembership,
  entryType: 'hybrid' | 'lunch' | 'snack' | 'extended',
) {
  if (!membership.participates_in_schedule) return false
  if (entryType === 'hybrid') return membership.participates_hybrid !== false
  if (entryType === 'lunch') return membership.participates_lunch !== false
  if (entryType === 'snack') return membership.participates_snack !== false
  return membership.participates_extended !== false
}

export default function EscalasPage() {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [teams, setTeams] = useState<ScheduleTeam[]>([])
  const [people, setPeople] = useState<SchedulePerson[]>([])
  const [memberships, setMemberships] = useState<ScheduleMembership[]>([])
  const [rules, setRules] = useState<ScheduleRule[]>([])
  const [absences, setAbsences] = useState<ScheduleAbsence[]>([])
  const [entries, setEntries] = useState<ScheduleEntry[]>([])
  const [context, setContext] = useState<ScheduleMonthContext>({ year, month, holidays: [], optional_days: [], click_days: [] })
  const [monthContexts, setMonthContexts] = useState<ScheduleMonthContext[]>([])
  const [selectedTeamId, setSelectedTeamId] = useState('')
  const [section, setSection] = useState<'scale'|'people'|'rules'|'requests'>('scale')
  const [entryType, setEntryType] = useState<'hybrid'|'lunch'|'snack'|'extended'>('hybrid')
  const [validations, setValidations] = useState<ScheduleValidation[]>([])
  const [message, setMessage] = useState('')
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [popup, setPopup] = useState<Notification | null>(null)
  const [loading, setLoading] = useState(true)
  const [personName, setPersonName] = useState('')
  const [personEmail, setPersonEmail] = useState('')
  const [memberTeamId, setMemberTeamId] = useState('')
  const [memberPersonId, setMemberPersonId] = useState('')
  const [memberStart, setMemberStart] = useState(`${ymd(year, month)}-01`)
  const [absencePersonId, setAbsencePersonId] = useState('')
  const [absenceKind, setAbsenceKind] = useState<ScheduleAbsence['kind']>('FERIAS')
  const [absenceStart, setAbsenceStart] = useState(`${ymd(year, month)}-01`)
  const [absenceEnd, setAbsenceEnd] = useState(`${ymd(year, month)}-01`)
  const [requestDate, setRequestDate] = useState(`${ymd(year, month)}-01`)
  const [requestType, setRequestType] = useState('Troca de escala')
  const [requestReason, setRequestReason] = useState('')
  const [membershipDialog, setMembershipDialog] = useState<{ mode: 'transfer' | 'end'; membership: ScheduleMembership } | null>(null)
  const [membershipActionDate, setMembershipActionDate] = useState(new Date().toISOString().slice(0, 10))
  const [transferTeamId, setTransferTeamId] = useState('')
  const latestNotificationIds = useRef(new Set<string>())

  const isManagement = ['master','coordenadora','coordinator'].includes((profile?.role ?? '').toLowerCase())
  const selectedTeam = teams.find((team) => team.id === selectedTeamId) ?? null
  const monthDays = useMemo(() => daysInMonth(year, month), [year, month])
  const monthPrefix = ymd(year, month)
  const businessMonthDays = useMemo(() => monthDays.filter((day) => day.business), [monthDays])
  const crossesPreviousMonth = Boolean(businessMonthDays[0] && businessMonthDays[0].dow > 1)
  const crossesNextMonth = Boolean(businessMonthDays.at(-1) && (businessMonthDays.at(-1)?.dow ?? 5) < 5)
  const { start: monthStartDate, end: monthEndDate } = useMemo(() => monthRange(year, month), [year, month])
  const paddedStartDate = useMemo(() => shiftIsoDate(monthStartDate, -7), [monthStartDate])
  const paddedEndDate = useMemo(() => shiftIsoDate(monthEndDate, 7), [monthEndDate])

  const loadAll = useCallback(async () => {
    setLoading(true)
    const { data: userData } = await supabase.auth.getUser()
    const user = userData.user
    const [
      profileResult,
      teamResult,
      peopleResult,
      membershipsResult,
      rulesResult,
      absencesResult,
      entriesResult,
      contextsResult,
      notificationResult,
    ] = await Promise.all([
      user
        ? supabase.from('profiles').select('id,full_name,role').eq('id', user.id).maybeSingle()
        : supabase.from('profiles').select('id,full_name,role').eq('full_name', 'Marcos Miranda').maybeSingle(),
      supabase.from('schedule_teams').select('*').eq('active', true).order('name'),
      supabase.from('schedule_people').select('*').order('name'),
      supabase.from('schedule_memberships').select('*').order('start_date'),
      supabase.from('schedule_rules').select('*').eq('active', true).order('start_date'),
      supabase.from('schedule_absences').select('*').lte('start_date', paddedEndDate).gte('end_date', paddedStartDate),
      supabase.from('schedule_entries').select('*').gte('date', paddedStartDate).lte('date', paddedEndDate),
      supabase.from('schedule_month_contexts').select('*').order('year').order('month'),
      supabase.from('schedule_notifications').select('*').order('created_at', { ascending: false }).limit(30),
    ])

    const loadedProfile = (profileResult.data as Profile | null) ?? { id: 'homologacao', full_name: 'Marcos Miranda', role: 'master' }
    setProfile(loadedProfile)
    const loadedTeams = (teamResult.data ?? []) as ScheduleTeam[]
    setTeams(loadedTeams)
    setSelectedTeamId((current) => current || loadedTeams[0]?.id || '')
    setPeople((peopleResult.data ?? []) as SchedulePerson[])
    setMemberships((membershipsResult.data ?? []) as ScheduleMembership[])
    setRules((rulesResult.data ?? []) as ScheduleRule[])
    setAbsences((absencesResult.data ?? []) as ScheduleAbsence[])
    setEntries((entriesResult.data ?? []) as ScheduleEntry[])
    const loadedContexts = (contextsResult.data ?? []) as ScheduleMonthContext[]
    setMonthContexts(loadedContexts)
    const currentContext = loadedContexts.find((item) => item.year === year && item.month === month)
    setContext(
      currentContext
        ? {
            id: currentContext.id,
            year,
            month,
            holidays: currentContext.holidays ?? [],
            optional_days: currentContext.optional_days ?? [],
            click_days: currentContext.click_days ?? [],
            notes: currentContext.notes,
          }
        : { year, month, holidays: [], optional_days: [], click_days: [] },
    )
    const loadedNotifications = ((notificationResult.data ?? []) as Notification[]).filter(
      (item) => item.profile_id === loadedProfile.id,
    )
    setNotifications(loadedNotifications)
    latestNotificationIds.current = new Set(loadedNotifications.map((item) => item.id))
    setLoading(false)
  }, [month, paddedEndDate, paddedStartDate, year])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  useEffect(() => {
    if (!memberStart.startsWith(monthPrefix)) setMemberStart(monthStartDate)
    if (!absenceStart.startsWith(monthPrefix)) setAbsenceStart(monthStartDate)
    if (!absenceEnd.startsWith(monthPrefix)) setAbsenceEnd(monthStartDate)
    if (!requestDate.startsWith(monthPrefix)) setRequestDate(monthStartDate)
  }, [absenceEnd, absenceStart, memberStart, monthPrefix, monthStartDate, requestDate])

  useEffect(() => {
    if (!profile?.id) return
    const channel = supabase
      .channel(`schedule-notifications-${profile.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'schedule_notifications', filter: `profile_id=eq.${profile.id}` },
        (payload) => {
          const item = payload.new as Notification
          if (latestNotificationIds.current.has(item.id)) return
          latestNotificationIds.current.add(item.id)
          setNotifications((current) => [item, ...current])
          setPopup(item)
          beep()
          browserNotify(item)
          document.title = '🔔 Nova solicitação de escala'
        },
      )
      .subscribe()

    const onFocus = async () => {
      const { data } = await supabase
        .from('schedule_notifications')
        .select('*')
        .eq('profile_id', profile.id)
        .is('seen_at', null)
        .order('created_at', { ascending: false })
        .limit(1)
      const unseen = (data?.[0] ?? null) as Notification | null
      if (unseen && !popup) {
        setPopup(unseen)
        beep()
      }
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') onFocus()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
      supabase.removeChannel(channel)
    }
  }, [popup, profile?.id])

  async function enableBrowserNotifications() {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      return setMessage('Este navegador não oferece notificações do sistema.')
    }
    const permission = await window.Notification.requestPermission()
    setMessage(
      permission === 'granted'
        ? 'Alertas do navegador ativados.'
        : 'O navegador não autorizou notificações. O pop-up e o sino continuam ativos.',
    )
  }

  async function markSeen(item: Notification) {
    await supabase.from('schedule_notifications').update({ seen_at: new Date().toISOString() }).eq('id', item.id)
    setNotifications((current) => current.map((notification) => notification.id === item.id ? { ...notification, seen_at: new Date().toISOString() } : notification))
    setPopup(null)
    document.title = 'Escalas | Performance'
  }

  async function addPerson() {
    if (!personName.trim()) return
    const { data, error } = await supabase.from('schedule_people').insert({
      name: personName.trim(),
      email: personEmail.trim().toLowerCase() || null,
    }).select('*').single()
    if (error) return setMessage(error.message)
    setPeople((current) => [...current, data as SchedulePerson].sort((a,b) => a.name.localeCompare(b.name)))
    setPersonName('')
    setPersonEmail('')
    setMessage('Pessoa incluída com sucesso.')
  }

  async function togglePerson(person: SchedulePerson) {
    const { error } = await supabase.from('schedule_people').update({ active: !person.active }).eq('id', person.id)
    if (error) return setMessage(error.message)
    setPeople((current) => current.map((item) => item.id === person.id ? { ...item, active: !person.active } : item))
  }

  async function addMembership() {
    if (!memberPersonId || !memberTeamId || !memberStart) return
    const { data, error } = await supabase.from('schedule_memberships').insert({
      person_id: memberPersonId,
      team_id: memberTeamId,
      start_date: memberStart,
      participates_in_schedule: true,
    }).select('*').single()
    if (error) return setMessage(error.message)
    setMemberships((current) => [...current, data as ScheduleMembership])
    setMessage('Vínculo criado com vigência definida.')
  }

  async function closeMembership(membership: ScheduleMembership, endDate: string) {
    const { error } = await supabase.from('schedule_memberships').update({ end_date: endDate }).eq('id', membership.id)
    if (error) return setMessage(error.message)
    setMemberships((current) => current.map((item) => item.id === membership.id ? { ...item, end_date: endDate } : item))
  }

  function openMembershipAction(mode: 'transfer' | 'end', membership: ScheduleMembership) {
    setMembershipActionDate(new Date().toISOString().slice(0, 10))
    const fallbackTeam = teams.find((item) => item.id !== membership.team_id)
    setTransferTeamId(fallbackTeam?.id ?? '')
    setMembershipDialog({ mode, membership })
  }

  async function confirmMembershipAction() {
    if (!membershipDialog || !membershipActionDate) return
    const { membership, mode } = membershipDialog
    const person = people.find((item) => item.id === membership.person_id)

    if (mode === 'end') {
      await closeMembership(membership, membershipActionDate)
      setMessage(`Vínculo de ${person?.name ?? 'Pessoa'} encerrado em ${membershipActionDate}.`)
      setMembershipDialog(null)
      return
    }

    const target = teams.find((item) => item.id === transferTeamId)
    if (!target) return setMessage('Selecione o time de destino.')

    const { error } = await supabase.rpc('transfer_schedule_membership', {
      p_membership_id: membership.id,
      p_target_team_id: target.id,
      p_effective_date: membershipActionDate,
    })
    if (error) return setMessage(error.message)

    setMessage(`${person?.name ?? 'Pessoa'} transferido(a) para ${target.name} a partir de ${membershipActionDate}.`)
    setMembershipDialog(null)
    await loadAll()
  }

  async function addAbsence() {
    if (!absencePersonId || !absenceStart || !absenceEnd) return
    if (absenceEnd < absenceStart) return setMessage('A data final não pode ser anterior à data inicial.')
    const { data: auth } = await supabase.auth.getUser()
    const { data, error } = await supabase.from('schedule_absences').insert({
      person_id: absencePersonId,
      kind: absenceKind,
      start_date: absenceStart,
      end_date: absenceEnd,
      created_by: auth.user?.id ?? null,
    }).select('*').single()
    if (error) return setMessage(error.message)
    setAbsences((current) => [...current, data as ScheduleAbsence])
    setMessage(absenceKind === 'FERIAS' ? 'Férias registradas para a geração.' : 'Indisponibilidade registrada.')
  }

  async function removeAbsence(absence: ScheduleAbsence) {
    if (!absence.id) return
    const { error } = await supabase.from('schedule_absences').delete().eq('id', absence.id)
    if (error) return setMessage(error.message)
    setAbsences((current) => current.filter((item) => item.id !== absence.id))
    setMessage('Indisponibilidade removida.')
  }

  async function saveContextAndGenerate() {
    if (!selectedTeam || !isManagement) return
    const previousMonthContext = monthContexts.find((item) => item.year === year && item.month === month)
    const previousClickDays = [...(previousMonthContext?.click_days ?? [])].sort()
    const nextClickDays = [...(context.click_days ?? [])].sort()
    const clickDaysChanged = JSON.stringify(previousClickDays) !== JSON.stringify(nextClickDays)
    const { data: auth } = await supabase.auth.getUser()
    const contextPayload = {
      year,
      month,
      holidays: context.holidays,
      optional_days: context.optional_days,
      click_days: context.click_days ?? [],
      notes: context.notes ?? null,
      created_by: auth.user?.id ?? null,
    }
    const { data: savedContext, error: contextError } = await supabase
      .from('schedule_month_contexts')
      .upsert(contextPayload, { onConflict: 'year,month' })
      .select('*')
      .single()
    if (contextError) return setMessage(contextError.message)

    const existingEntriesForGeneration = entries.filter((entry) => entry.team_id === selectedTeam.id)
    const otherContexts = monthContexts.filter((item) => !(item.year === year && item.month === month))
    const generationContext: ScheduleMonthContext = {
      id: savedContext.id,
      year,
      month,
      holidays: [...new Set([
        ...(savedContext.holidays ?? []),
        ...otherContexts.flatMap((item) => item.holidays ?? []),
      ])],
      optional_days: [...new Set([
        ...(savedContext.optional_days ?? []),
        ...otherContexts.flatMap((item) => item.optional_days ?? []),
      ])],
      click_days: [...new Set([
        ...(savedContext.click_days ?? []),
        ...otherContexts.flatMap((item) => item.click_days ?? []),
      ])],
      notes: savedContext.notes,
    }
    setMonthContexts((current) => [
      ...current.filter((item) => !(item.year === year && item.month === month)),
      generationContext,
    ])
    const result = generateMonthlySchedule({
      team: selectedTeam,
      people,
      memberships,
      absences,
      rules,
      context: generationContext,
      year,
      month,
      existingEntries: existingEntriesForGeneration,
      preserveExistingLunchSnack: clickDaysChanged,
    })

    const protectedEntries = existingEntriesForGeneration.filter(
      (entry) =>
        entry.date >= monthStartDate &&
        entry.date <= monthEndDate &&
        (entry.locked || entry.source === 'manual' || entry.source === 'exception'),
    )
    const protectedKeys = new Set(
      protectedEntries.map((entry) => `${entry.person_id}|${entry.team_id}|${entry.date}|${entry.entry_type}`),
    )
    const generatedEntries = result.entries.filter(
      (entry) => !protectedKeys.has(`${entry.person_id}|${entry.team_id}|${entry.date}|${entry.entry_type}`),
    )
    const finalEntries = [...generatedEntries, ...protectedEntries]
    const finalValidations = validateSchedule(
      {
        team: selectedTeam,
        people,
        memberships,
        absences,
        rules,
        context: generationContext,
        year,
        month,
        existingEntries: existingEntriesForGeneration,
      },
      finalEntries,
    )

    const { error: cleanupError } = await supabase
      .from('schedule_entries')
      .delete()
      .eq('team_id', selectedTeam.id)
      .gte('date', monthStartDate)
      .lte('date', monthEndDate)
      .eq('source', 'generated')
      .eq('locked', false)
    if (cleanupError) return setMessage(cleanupError.message)

    const payload = finalEntries.map((entry) => ({
      person_id: entry.person_id,
      team_id: entry.team_id,
      date: entry.date,
      entry_type: entry.entry_type,
      value: entry.value,
      source: entry.source,
      locked: entry.locked ?? false,
      metadata: entry.metadata ?? {},
      updated_by: auth.user?.id ?? null,
      updated_at: new Date().toISOString(),
    }))
    const { error } = await supabase.from('schedule_entries').upsert(payload, { onConflict: 'person_id,team_id,date,entry_type' })
    if (error) return setMessage(error.message)
    setValidations(finalValidations)
    setEntries((current) => [
      ...current.filter((entry) => entry.team_id !== selectedTeam.id || !entry.date.startsWith(monthPrefix)),
      ...finalEntries,
    ])
    setMessage(finalValidations.some((item) => item.level === 'error') ? 'Escala gerada com alertas para revisão.' : 'Escala gerada e validada sem conflitos obrigatórios.')
  }

  async function cycleCell(personId: string, date: string) {
    if (!selectedTeam || !isManagement) return
    const membership = memberships.find(
      (item) =>
        item.person_id === personId &&
        item.team_id === selectedTeam.id &&
        item.start_date <= date &&
        (!item.end_date || item.end_date >= date),
    )
    if (!membership || !membershipAllowsTab(membership, entryType)) return
    const current = entries.find((entry) => entry.person_id === personId && entry.team_id === selectedTeam.id && entry.date === date && entry.entry_type === entryType)
    let value = current?.value ?? ''
    if (entryType === 'hybrid') {
      const values = STATUS.map(([key]) => key)
      const index = values.indexOf(value as typeof values[number])
      value = values[(index + 1) % values.length]
    } else if (entryType === 'lunch') value = value === '12:00' ? '13:00' : value === '13:00' ? '11:30' : '12:00'
    else if (entryType === 'snack') {
      const values = ['15:45','16:00','16:15','16:30','16:45','17:00','17:15']
      value = values[(values.indexOf(value) + 1) % values.length]
    } else {
      value = value === '09:00-18:30' ? '09:30-19:00' : '09:00-18:30'
    }
    const { data: auth } = await supabase.auth.getUser()
    const payload = {
      person_id: personId,
      team_id: selectedTeam.id,
      date,
      entry_type: entryType,
      value,
      source: 'manual',
      locked: true,
      updated_by: auth.user?.id ?? null,
      updated_at: new Date().toISOString(),
    }
    const { data, error } = await supabase.from('schedule_entries').upsert(payload, { onConflict: 'person_id,team_id,date,entry_type' }).select('*').single()
    if (error) return setMessage(error.message)
    setEntries((currentEntries) => [
      ...currentEntries.filter((item) => !(item.person_id === personId && item.team_id === selectedTeam.id && item.date === date && item.entry_type === entryType)),
      data as ScheduleEntry,
    ])
  }

  async function releaseMonth() {
    if (!selectedTeam) return
    const { data: auth } = await supabase.auth.getUser()
    const { error } = await supabase.from('schedule_publications').upsert({
      team_id: selectedTeam.id,
      year,
      month,
      released: true,
      released_at: new Date().toISOString(),
      released_by: auth.user?.id ?? null,
    }, { onConflict: 'team_id,year,month' })
    setMessage(error ? error.message : `${MONTHS[month - 1]} liberado para visualização.`)
  }

  async function submitRequest() {
    if (!selectedTeam || !profile) return
    const { error } = await supabase.from('schedule_requests').insert({
      requester_name: profile.full_name ?? 'Colaborador',
      team_id: selectedTeam.id,
      target_date: requestDate,
      request_type: requestType,
      reason: requestReason.trim() || null,
    })
    if (error) return setMessage(error.message)
    setRequestReason('')
    setMessage('Solicitação enviada. A gestão foi notificada.')
  }

  const validationSummary = useMemo(() => ({
    errors: validations.filter((item) => item.level === 'error').length,
    warnings: validations.filter((item) => item.level === 'warning').length,
    ok: validations.filter((item) => item.level === 'ok').length,
  }), [validations])

  const activeTeamPeople = useMemo(() => {
    if (!selectedTeam) return []
    return people.filter((person) =>
      memberships.some((membership) =>
        membership.person_id === person.id &&
        membership.team_id === selectedTeam.id &&
        membership.participates_in_schedule &&
        membership.start_date <= monthEndDate &&
        (!membership.end_date || membership.end_date >= monthStartDate),
      ),
    )
  }, [memberships, monthEndDate, monthStartDate, people, selectedTeam])

  if (loading) return <main className="schedule-shell p-8">Carregando módulo de escalas...</main>

  return (
    <main className="schedule-shell p-4 sm:p-7">
      {membershipDialog && (
        <ScheduleModal
          title={membershipDialog.mode === 'transfer' ? 'Transferir colaborador' : 'Encerrar vínculo'}
          description={
            membershipDialog.mode === 'transfer'
              ? 'A vigência mantém o histórico anterior intacto e aplica o novo time somente a partir da data informada.'
              : 'A pessoa deixa de participar dos cálculos da escala após a data final do vínculo.'
          }
          tone={membershipDialog.mode === 'end' ? 'danger' : 'default'}
          onClose={() => setMembershipDialog(null)}
          footer={
            <>
              <button className="secondary-button" onClick={() => setMembershipDialog(null)}>Cancelar</button>
              <button className={membershipDialog.mode === 'transfer' ? 'primary-button' : 'danger-button'} onClick={confirmMembershipAction}>
                {membershipDialog.mode === 'transfer' ? 'Confirmar transferência' : 'Encerrar vínculo'}
              </button>
            </>
          }
        >
          <div className="schedule-inline-note">
            <strong>{people.find((item) => item.id === membershipDialog.membership.person_id)?.name ?? 'Pessoa'}</strong>
            <br />
            Time atual: {teams.find((item) => item.id === membershipDialog.membership.team_id)?.name ?? '—'}
          </div>
          {membershipDialog.mode === 'transfer' && (
            <label className="schedule-field">
              Novo time
              <select className="px-3 py-2" value={transferTeamId} onChange={(event) => setTransferTeamId(event.target.value)}>
                {teams.filter((item) => item.id !== membershipDialog.membership.team_id).map((team) => (
                  <option key={team.id} value={team.id}>{team.name}</option>
                ))}
              </select>
            </label>
          )}
          <label className="schedule-field">
            {membershipDialog.mode === 'transfer' ? 'Início no novo time' : 'Último dia no time'}
            <input className="px-3 py-2" type="date" value={membershipActionDate} onChange={(event) => setMembershipActionDate(event.target.value)} />
          </label>
        </ScheduleModal>
      )}
      {popup && (
        <div className="schedule-toast fixed right-4 top-4 z-50 w-[min(420px,calc(100vw-2rem))] p-5">
          <div className="flex items-start gap-3">
            <div className="schedule-bell-attention text-2xl">🔔</div>
            <div className="flex-1">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-300">Nova solicitação</p>
              <h2 className="mt-1 text-lg font-bold">{popup.title}</h2>
              <p className="mt-2 text-sm text-slate-300">{popup.message}</p>
              <div className="mt-4 flex gap-2">
                <button className="primary-button" onClick={() => { setSection('requests'); markSeen(popup) }}>Ver agora</button>
                <button className="secondary-button" onClick={() => markSeen(popup)}>Dispensar</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <section className="mx-auto max-w-[1600px]">
        <div className="schedule-banner-homologation mb-4 px-4 py-3 text-sm">
          <strong>Ambiente de homologação</strong> · Nenhuma alteração desta tela afeta a produção.
        </div>

        <header className="schedule-topbar flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="schedule-kicker">Central de Performance · Escalas</p>
            <h1 className="schedule-heading mt-2 text-3xl font-bold">Planejamento operacional</h1>
            <p className="schedule-subtitle mt-2">Geração, validação, publicação e manutenção da escala em um único fluxo.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button className={`relative rounded-xl border border-white/10 bg-slate-900 px-4 py-3 ${notifications.some((item) => !item.seen_at) ? 'schedule-bell-attention' : ''}`} onClick={() => setSection('requests')}>
              🔔
              {notifications.filter((item) => !item.seen_at).length > 0 && (
                <span className="absolute -right-2 -top-2 rounded-full bg-red-500 px-2 py-0.5 text-xs font-bold">
                  {notifications.filter((item) => !item.seen_at).length}
                </span>
              )}
            </button>
            {isManagement && <button className="secondary-button" onClick={enableBrowserNotifications}>Ativar alertas</button>}
            {isManagement && <Link className="secondary-button" href="/escalas/sabados">Sábados</Link>}
            {isManagement && <Link className="secondary-button" href="/escalas/gestao">Gestão</Link>}
            <Link className="secondary-button" href="/">Voltar ao Performance</Link>
          </div>
        </header>

        <div className="mt-5">
          <div className="schedule-segmented">
            <button className={section === 'scale' ? 'is-active' : ''} onClick={() => setSection('scale')}>Escalas</button>
            {isManagement && <button className={section === 'people' ? 'is-active' : ''} onClick={() => setSection('people')}>Pessoas e times</button>}
            {isManagement && <button className={section === 'rules' ? 'is-active' : ''} onClick={() => setSection('rules')}>Regras</button>}
            <button className={section === 'requests' ? 'is-active' : ''} onClick={() => setSection('requests')}>Solicitações</button>
          </div>
        </div>

        {message && <div className="mt-4 rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm">{message}</div>}

        {section === 'scale' && (
          <>
            {(crossesPreviousMonth || crossesNextMonth) && (
              <div className="schedule-inline-note mt-6">
                <strong>Semana operacional atravessando a virada do mês.</strong>{' '}
                O motor considera os dias do mês anterior e/ou seguinte para fechar a distribuição semanal de Presencial e Home Office sem reiniciar a contagem no dia 1º.
              </div>
            )}

            <section className="schedule-overview-grid mt-6">
              <div className="schedule-overview-card">
                <span>Equipe</span>
                <strong>{selectedTeam?.name ?? '—'}</strong>
                <small>{activeTeamPeople.length} colaborador(es) na vigência</small>
              </div>
              <div className="schedule-overview-card">
                <span>Período</span>
                <strong>{MONTHS[month - 1]} {year}</strong>
                <small>{monthDays.filter((day) => day.business).length} dias úteis</small>
              </div>
              <div className="schedule-overview-card">
                <span>Calendário</span>
                <strong>{context.holidays.length + context.optional_days.length + (context.click_days?.length ?? 0)}</strong>
                <small>feriados, facultativos e Click Days</small>
              </div>
              <div className={`schedule-overview-card ${validationSummary.errors ? 'schedule-overview-danger' : validationSummary.warnings ? 'schedule-overview-warning' : ''}`}>
                <span>Validação</span>
                <strong>{validationSummary.errors ? `${validationSummary.errors} erro(s)` : validationSummary.warnings ? `${validationSummary.warnings} atenção(ões)` : 'Sem bloqueios'}</strong>
                <small>{validations.length ? 'resultado da última geração' : 'gere a escala para validar'}</small>
              </div>
            </section>

            <section className="schedule-card mt-6 grid gap-4 p-5 lg:grid-cols-[1fr_1fr_auto]">
              <label className="grid gap-1 text-sm text-slate-300">
                Time
                <select className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2" value={selectedTeamId} onChange={(event) => setSelectedTeamId(event.target.value)}>
                  {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1 text-sm text-slate-300">Mês
                  <select className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2" value={month} onChange={(event) => setMonth(Number(event.target.value))}>
                    {MONTHS.map((label, index) => <option key={label} value={index + 1}>{label}</option>)}
                  </select>
                </label>
                <label className="grid gap-1 text-sm text-slate-300">Ano
                  <input className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2" type="number" value={year} onChange={(event) => setYear(Number(event.target.value))} />
                </label>
              </div>
              {isManagement && <div className="flex items-end gap-2">
                <button className="primary-button" onClick={saveContextAndGenerate}>Gerar escala</button>
                <button className="secondary-button" onClick={releaseMonth}>Liberar mês</button>
              </div>}
            </section>

            {isManagement && (
              <>
                <section className="schedule-card mt-4 p-5">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <p className="schedule-kicker">Contexto do mês</p>
                      <h2 className="schedule-heading mt-1 text-lg font-bold">Datas que alteram a geração</h2>
                      <p className="schedule-subtitle mt-1 text-sm">Cadastre as exceções do calendário antes de gerar a escala.</p>
                    </div>
                    <span className="text-xs text-slate-500">As datas são reaproveitadas na semana operacional, inclusive na virada do mês.</span>
                  </div>
                  <div className="mt-5 grid gap-4 lg:grid-cols-3">
                    <ScheduleDateList
                      label="Feriados"
                      help="Contam como um dos dois dias de Home Office da semana."
                      value={context.holidays}
                      onChange={(holidays) => setContext({ ...context, holidays })}
                      accent="amber"
                    />
                    <ScheduleDateList
                      label="Pontos facultativos"
                      help="Seguem a mesma lógica de crédito semanal dos feriados."
                      value={context.optional_days}
                      onChange={(optional_days) => setContext({ ...context, optional_days })}
                    />
                    <ScheduleDateList
                      label="Click Day"
                      help="Todos ficam presenciais, sem Estendido; o HO é remanejado dentro da semana."
                      value={context.click_days ?? []}
                      onChange={(click_days) => setContext({ ...context, click_days })}
                      accent="violet"
                    />
                  </div>
                </section>

                <section className="schedule-card mt-4 p-5">
                  <div>
                    <h2 className="font-bold">Férias e indisponibilidades</h2>
                    <p className="mt-1 text-sm text-slate-400">Essas datas entram no cálculo antes da geração da escala.</p>
                  </div>
                  <div className="mt-4 grid gap-3 lg:grid-cols-[1.3fr_1fr_1fr_1fr_auto]">
                    <select className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2" value={absencePersonId} onChange={(event) => setAbsencePersonId(event.target.value)}>
                      <option value="">Selecione a pessoa</option>
                      {activeTeamPeople.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
                    </select>
                    <select className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2" value={absenceKind} onChange={(event) => setAbsenceKind(event.target.value as ScheduleAbsence['kind'])}>
                      <option value="FERIAS">Férias</option>
                      <option value="DAY_OFF">Day Off</option>
                      <option value="FOLGA">Folga</option>
                      <option value="PREMIACAO">Premiação</option>
                      <option value="BANCO_HORAS">Banco de horas</option>
                      <option value="SENAC">Senac</option>
                      <option value="OUTRA">Outra</option>
                    </select>
                    <input className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2" type="date" value={absenceStart} onChange={(event) => setAbsenceStart(event.target.value)} />
                    <input className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2" type="date" value={absenceEnd} onChange={(event) => setAbsenceEnd(event.target.value)} />
                    <button className="secondary-button" onClick={addAbsence}>Adicionar</button>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {absences
                      .filter(
                        (absence) =>
                          absence.start_date <= monthEndDate &&
                          absence.end_date >= monthStartDate &&
                          activeTeamPeople.some((person) => person.id === absence.person_id),
                      )
                      .map((absence) => {
                        const person = people.find((item) => item.id === absence.person_id)
                        return (
                          <div key={absence.id ?? `${absence.person_id}-${absence.start_date}`} className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm">
                            <strong>{person?.name ?? 'Pessoa'}</strong> · {absence.kind} · {absence.start_date} → {absence.end_date}
                            {absence.id && <button className="ml-3 text-red-300" onClick={() => removeAbsence(absence)}>Remover</button>}
                          </div>
                        )
                      })}
                  </div>
                </section>
              </>
            )}

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <div className="schedule-segmented">
                {(['hybrid','lunch','snack','extended'] as const).map((type) => (
                  <button key={type} className={entryType === type ? 'is-active' : ''} onClick={() => setEntryType(type)}>
                    {{ hybrid: 'Híbrido', lunch: 'Almoço', snack: 'Café', extended: 'Estendido' }[type]}
                  </button>
                ))}
              </div>
              <p className="text-xs text-slate-500">Clique em uma célula para ajustar manualmente. Ajustes manuais ficam protegidos.</p>
            </div>

            {validations.length > 0 && (
              <section className="schedule-card mt-4 p-4">
                <div className="schedule-validation-summary">
                  <div className="schedule-metric"><span>Erros</span><strong>{validationSummary.errors}</strong></div>
                  <div className="schedule-metric"><span>Atenções</span><strong>{validationSummary.warnings}</strong></div>
                  <div className="schedule-metric"><span>Validações OK</span><strong>{validationSummary.ok}</strong></div>
                </div>
                {(validationSummary.errors > 0 || validationSummary.warnings > 0) && (
                  <div className="mt-3 grid gap-2">
                    {validations.filter((item) => item.level !== 'ok').map((validation, index) => (
                      <div key={index} className={`rounded-lg border px-3 py-2 text-sm ${validation.level === 'error' ? 'border-red-400/30 bg-red-950/20 text-red-100' : 'border-amber-400/30 bg-amber-950/20 text-amber-100'}`}>
                        <strong>{validation.level === 'error' ? 'Erro' : 'Atenção'}:</strong> {validation.message} {validation.date ? `— ${new Date(`${validation.date}T12:00:00`).toLocaleDateString('pt-BR')}` : ''}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

            <section className="schedule-table-wrap mt-5">
              <table className="schedule-table">
                <thead className="sticky top-0 z-20">
                  <tr>
                    <th className="schedule-person-cell px-4 py-3 text-left">Colaborador</th>
                    {monthDays.filter((day) => day.business).map((day) => (
                      <th key={day.value} className="schedule-day-head">
                        <span>{String(day.day).padStart(2, '0')}</span>
                        <span className="weekday">{WEEKDAY_LABEL[day.dow]}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {activeTeamPeople.map((person) => (
                    <tr key={person.id}>
                      <td className="schedule-person-cell px-4 py-3 font-semibold">{person.name}</td>
                      {monthDays.filter((day) => day.business).map((day) => {
                        const membership = memberships.find((item) => item.person_id === person.id && item.team_id === selectedTeamId && item.start_date <= day.value && (!item.end_date || item.end_date >= day.value))
                        if (!membership || !membershipAllowsTab(membership, entryType)) {
                          return <td key={day.value} className="px-2 py-2 text-center text-slate-600">—</td>
                        }
                        const entry = entries.find((item) => item.person_id === person.id && item.team_id === selectedTeamId && item.date === day.value && item.entry_type === entryType)
                        const manual = Boolean(entry?.locked || entry?.source === 'manual' || entry?.source === 'exception')
                        return (
                          <td key={day.value} className="p-1.5 text-center">
                            <button
                              className={`schedule-cell-button ${scheduleCellTone(entry?.value)} ${manual ? 'schedule-manual-indicator' : ''}`}
                              onClick={() => cycleCell(person.id, day.value)}
                              title={manual ? 'Ajuste manual protegido' : 'Clique para alterar'}
                            >
                              {entry?.value ?? '—'}
                            </button>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </>
        )}

        {section === 'people' && isManagement && (
          <div className="mt-6 grid gap-5 xl:grid-cols-[420px_1fr]">
            <section className="rounded-2xl border border-white/10 bg-slate-900/60 p-5">
              <h2 className="text-xl font-bold">Incluir pessoa</h2>
              <div className="mt-4 grid gap-3">
                <input className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2" placeholder="Nome" value={personName} onChange={(event) => setPersonName(event.target.value)} />
                <input className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2" placeholder="E-mail (opcional)" value={personEmail} onChange={(event) => setPersonEmail(event.target.value)} />
                <button className="primary-button" onClick={addPerson}>Adicionar pessoa</button>
              </div>
              <h3 className="mt-7 font-bold">Criar vínculo com time</h3>
              <div className="mt-3 grid gap-3">
                <select className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2" value={memberPersonId} onChange={(event) => setMemberPersonId(event.target.value)}>
                  <option value="">Selecione a pessoa</option>
                  {people.filter((person) => person.active).map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
                </select>
                <select className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2" value={memberTeamId} onChange={(event) => setMemberTeamId(event.target.value)}>
                  <option value="">Selecione o time</option>
                  {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
                </select>
                <input className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2" type="date" value={memberStart} onChange={(event) => setMemberStart(event.target.value)} />
                <button className="secondary-button" onClick={addMembership}>Criar vínculo</button>
              </div>
            </section>

            <section className="overflow-x-auto rounded-2xl border border-white/10 bg-slate-900/60 p-5">
              <h2 className="text-xl font-bold">Pessoas e vínculos</h2>
              <table className="mt-4 min-w-full text-sm">
                <thead><tr className="text-left text-slate-400"><th className="pb-3">Pessoa</th><th>Time</th><th>Vigência</th><th>Status</th><th>Ação</th></tr></thead>
                <tbody>
                  {people.map((person) => {
                    const personMemberships = memberships.filter((item) => item.person_id === person.id)
                    return personMemberships.length ? personMemberships.map((membership, index) => (
                      <tr key={membership.id} className="border-t border-white/10">
                        <td className="py-3">{index === 0 ? person.name : ''}</td>
                        <td>{teams.find((team) => team.id === membership.team_id)?.name ?? '—'}</td>
                        <td>{membership.start_date} → {membership.end_date ?? 'atual'}</td>
                        <td>{person.active ? 'Ativo' : 'Inativo'}</td>
                        <td className="flex gap-2 py-2">
                          {!membership.end_date && <button className="small-button" onClick={() => openMembershipAction('transfer', membership)}>Transferir</button>}
                          {!membership.end_date && <button className="small-button" onClick={() => openMembershipAction('end', membership)}>Encerrar vínculo</button>}
                          {index === 0 && <button className="small-button" onClick={() => togglePerson(person)}>{person.active ? 'Inativar' : 'Reativar'}</button>}
                        </td>
                      </tr>
                    )) : (
                      <tr key={person.id} className="border-t border-white/10">
                        <td className="py-3">{person.name}</td><td>Sem vínculo</td><td>—</td><td>{person.active ? 'Ativo' : 'Inativo'}</td>
                        <td><button className="small-button" onClick={() => togglePerson(person)}>{person.active ? 'Inativar' : 'Reativar'}</button></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </section>
          </div>
        )}

        {section === 'rules' && isManagement && (
          <section className="schedule-card mt-6 p-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="schedule-kicker">Configuração operacional</p>
                <h2 className="schedule-heading mt-1 text-xl font-bold">Regras vigentes</h2>
                <p className="schedule-subtitle mt-2 text-sm">Leitura amigável das regras que o motor usa para gerar e validar a escala.</p>
              </div>
              <span className="text-xs text-slate-500">{rules.length} regra(s) ativa(s)</span>
            </div>
            <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {rules.map((rule) => {
                const team = rule.team_id ? teams.find((item) => item.id === rule.team_id) : null
                const person = rule.person_id ? people.find((item) => item.id === rule.person_id) : null
                return (
                  <article key={rule.id} className="schedule-card-muted p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-bold text-slate-100">{RULE_LABELS[rule.rule_key] ?? rule.rule_key}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          {person ? person.name : team ? team.name : 'Regra geral'}
                        </p>
                      </div>
                      <span className="rounded-full border border-white/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                        Vigente
                      </span>
                    </div>
                    <p className="mt-4 text-sm leading-6 text-slate-300">{readableRuleValue(rule)}</p>
                    <p className="mt-3 text-xs text-slate-600">
                      Desde {new Date(`${rule.start_date}T12:00:00`).toLocaleDateString('pt-BR')}
                      {rule.end_date ? ` até ${new Date(`${rule.end_date}T12:00:00`).toLocaleDateString('pt-BR')}` : ''}
                    </p>
                  </article>
                )
              })}
              {!rules.length && <div className="schedule-empty md:col-span-2 xl:col-span-3">Nenhuma regra cadastrada.</div>}
            </div>
          </section>
        )}

        {section === 'requests' && (
          <div className="mt-6 grid gap-5 lg:grid-cols-[420px_1fr]">
            <section className="rounded-2xl border border-white/10 bg-slate-900/60 p-5">
              <h2 className="text-xl font-bold">Nova solicitação</h2>
              <div className="mt-4 grid gap-3">
                <select className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2" value={selectedTeamId} onChange={(event) => setSelectedTeamId(event.target.value)}>
                  {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
                </select>
                <input className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2" type="date" value={requestDate} onChange={(event) => setRequestDate(event.target.value)} />
                <input className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2" value={requestType} onChange={(event) => setRequestType(event.target.value)} />
                <textarea className="min-h-28 rounded-lg border border-white/10 bg-slate-950 px-3 py-2" placeholder="Explique o pedido" value={requestReason} onChange={(event) => setRequestReason(event.target.value)} />
                <button className="primary-button" onClick={submitRequest}>Enviar solicitação</button>
              </div>
            </section>
            <section className="rounded-2xl border border-white/10 bg-slate-900/60 p-5">
              <h2 className="text-xl font-bold">Notificações</h2>
              <div className="mt-4 grid gap-2">
                {notifications.map((item) => (
                  <button key={item.id} className={`rounded-xl border p-4 text-left ${item.seen_at ? 'border-white/10 bg-slate-950/40' : 'border-cyan-400/40 bg-cyan-950/20'}`} onClick={() => markSeen(item)}>
                    <div className="flex items-center justify-between gap-3"><strong>{item.title}</strong><span className="text-xs text-slate-500">{new Date(item.created_at).toLocaleString('pt-BR')}</span></div>
                    <p className="mt-1 text-sm text-slate-300">{item.message}</p>
                  </button>
                ))}
                {!notifications.length && <p className="text-slate-400">Nenhuma notificação.</p>}
              </div>
            </section>
          </div>
        )}
      </section>
    </main>
  )
}
