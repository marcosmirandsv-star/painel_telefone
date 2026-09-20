export type ScheduleTeam = {
  id: string
  code: string
  name: string
  manager_name: string | null
  manager_profile_id: string | null
  active: boolean
  settings: Record<string, unknown> | null
}

export type SchedulePerson = {
  id: string
  name: string
  email: string | null
  active: boolean
  phone_analyst_id: string | null
  chat_analyst_id: string | null
  profile_id: string | null
}

export type ScheduleMembership = {
  id: string
  person_id: string
  team_id: string
  manager_profile_id: string | null
  start_date: string
  end_date: string | null
  participates_in_schedule: boolean
  participates_hybrid?: boolean
  participates_lunch?: boolean
  participates_snack?: boolean
  participates_extended?: boolean
}

export type ScheduleAbsence = {
  id?: string
  person_id: string
  kind: 'FERIAS' | 'DAY_OFF' | 'FOLGA' | 'PREMIACAO' | 'BANCO_HORAS' | 'SENAC' | 'OUTRA'
  start_date: string
  end_date: string
  notes?: string | null
}

export type ScheduleEntryType = 'hybrid' | 'lunch' | 'snack' | 'extended' | 'saturday'

export type ScheduleEntry = {
  id?: string
  person_id: string
  team_id: string
  date: string
  entry_type: ScheduleEntryType
  value: string
  source: 'generated' | 'manual' | 'exception'
  locked?: boolean
  metadata?: Record<string, unknown>
}

export type ScheduleRule = {
  id: string
  team_id: string | null
  person_id: string | null
  rule_key: string
  rule_value: Record<string, unknown>
  start_date: string
  end_date: string | null
  active: boolean
}

export type ScheduleMonthContext = {
  id?: string
  year: number
  month: number
  holidays: string[]
  optional_days: string[]
  click_days?: string[]
  notes?: string | null
}

export type ScheduleValidation = {
  level: 'ok' | 'warning' | 'error'
  code: string
  message: string
  date?: string
  person_id?: string
}

export type ScheduleGenerationInput = {
  team: ScheduleTeam
  people: SchedulePerson[]
  memberships: ScheduleMembership[]
  absences: ScheduleAbsence[]
  rules: ScheduleRule[]
  context: ScheduleMonthContext
  year: number
  month: number
  existingEntries?: ScheduleEntry[]
  stabilityMode?: 'standard' | 'preserve_existing'
  stabilityReferenceDate?: string
}

export type ScheduleGenerationResult = {
  entries: ScheduleEntry[]
  validations: ScheduleValidation[]
}
