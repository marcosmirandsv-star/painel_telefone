'use client'

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import * as XLSX from 'xlsx'
import { User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { scheduleSupabase } from '@/lib/schedule-supabase'
import { isHomologationBrowserRuntime } from '@/lib/runtime-environment'
import { calculateAverageCsat, calculateChatAverage, calculateTeamPerformance } from '@/lib/indicators'
import {
  buildChatPerformanceDiagnostic,
  type ChatPerformanceDiagnostic,
} from '@/lib/chat-diagnostic'

// Homologação: mantém a IA qualitativa bloqueada no portal até a validação da leitura de transcript.
const QUALITATIVE_ANALYSIS_ENABLED_FOR_ANALYSTS = false

type Goal = {
  id: string
  key: string
  label: string
  value: number
  unit: string
  active: boolean
}

type Analyst = {
  id: string
  name: string
  active: boolean
  csat_goal: number
  photo_url?: string | null
}

type UserRole = 'master' | 'coordinator' | 'analyst'

type UserProfile = {
  id: string
  role?: string | null
  full_name?: string | null
  name?: string | null
  analyst_id?: string | null
  chat_analyst_id?: string | null
}

type ScheduleNotification = {
  id: string
  profile_id: string
  request_id: string | null
  title: string
  message: string
  seen_at: string | null
  created_at: string
}

type IndividualMetric = {
  id: string
  analyst_id: string
  week_start: string
  week_end: string
  csat: number
  total_reviews: number
  positive_reviews: number
  negative_reviews: number
  review_percentage: number
  total_tickets: number
  evidence_url: string | null
  notes: string | null
  analysts?:
    | {
        name: string
        photo_url?: string | null
      }
    | {
        name: string
        photo_url?: string | null
      }[]
    | null
}

type TeamMetric = {
  id: string
  week_start: string
  week_end: string
  answered_calls: number
  abandoned_calls: number
  total_calls: number
  performance_percentage: number
  overall_csat: number | null
  evidence_url: string | null
  notes: string | null
}

type ChatTeam = {
  id: string
  name: string
  legacy_name: string | null
  manager_name: string | null
  active: boolean
}

type ChatAnalyst = {
  id: string
  team_id: string
  name: string
  csat_goal: number
  active: boolean
  photo_url?: string | null
}

type ChatMetricImportRecord = {
  team_id: string
  analyst_id: string
  month_label: string
  year: number
  month_number: number
  period_start: string
  period_end: string
  csat: number
  review_percentage: number
  sending_percentage: number
  total_tickets: number
  inactive_tickets: number
  valid_tickets: number
  reviews: number
  positive_reviews: number
  negative_reviews: number
  csat_goal: number
  csat_delta: number
  general_review_goal: number
  status: string
}

type ChatPodiumManual = {
  id: string
  team_id: string
  analyst_id: string
  year: number
  month_number: number
  position: number
}

type ChatPodiumExclusion = {
  id: string
  team_id: string
  analyst_id: string
  year: number
  month_number: number
  reason: string | null
}

type ChatMonthlyMetric = {
  id: string
  team_id: string
  analyst_id: string
  month_label: string
  year: number
  month_number: number
  period_start: string
  period_end: string
  csat: number
  review_percentage: number
  sending_percentage: number
  total_tickets: number
  inactive_tickets: number
  valid_tickets: number
  reviews: number
  positive_reviews: number
  negative_reviews: number
  csat_goal: number
  csat_delta: number
  general_review_goal: number
  status: string | null
  chat_analysts?:
    | {
        name: string
        csat_goal: number
        photo_url?: string | null
      }
    | {
        name: string
        csat_goal: number
        photo_url?: string | null
      }[]
    | null
  chat_teams?:
    | {
        name: string
      }
    | {
        name: string
      }[]
    | null
}

type ChatImportHistory = {
  id: string
  year: number
  month_number: number
  month_label: string
  satisfaction_file_name: string
  satisfaction_file_size: number
  satisfaction_rows: number
  inactivity_file_name: string
  inactivity_file_size: number
  inactivity_rows: number
  analysts_processed: number
  status: 'completed' | 'failed'
  created_by_name: string | null
  created_at: string
}

type ClickDeskTestItem = {
  id: string
  name: string
  email?: string
}

type ClickDeskTestGroup = {
  ok: boolean
  items: ClickDeskTestItem[]
  error?: string
}

type ClickDeskTestResult = {
  configured: boolean
  connected?: boolean
  tested_at?: string
  account_id?: string
  users?: ClickDeskTestGroup
  attendants?: ClickDeskTestGroup
  departments?: ClickDeskTestGroup
  target_departments?: ClickDeskTestGroup
  queues?: ClickDeskTestGroup
  scope?: string[]
  error?: string
}

type ClickDeskConversationSample = {
  id: string
  mode: 'ai' | 'human'
  area: string | null
  assignee: string | null
  timestamp: string | null
  satisfaction: string | null
}

type ClickDeskJourneySignal = {
  ai_marker: boolean
  human_marker: boolean
  transfer_marker: boolean
  signal_keys: string[]
  payload_kind: 'null' | 'string' | 'array' | 'object' | 'other'
  top_level_keys: string[]
  candidate_paths: string[]
  safe_values: { path: string; value: string }[]
}

type ClickDeskAiRoutingDiagnostic = {
  connected?: boolean
  period?: { year: number; month: number }
  scope?: string[]
  pages_scanned?: number
  page_errors?: string[]
  listed_in_period?: number
  sampled?: number
  detail_available?: number
  transcript_available?: number
  area_resolved?: number
  samples?: {
    ticket_id: string
    list_timestamp: string | null
    list_area: string | null
    detail_available: boolean
    transcript_available: boolean
    detail_area: string | null
    transcript_area: string | null
    detail_keys: string[]
    transcript_keys: string[]
    routing_values: { path: string; value: string }[]
    run_correlations: { value: string; ticket_path: string; run_path: string }[]
    error?: string
  }[]
  repeated_signals?: { path: string; value: string; count: number }[]
  departments?: {
    ok: boolean
    targets: { id: string; name: string }[]
    error?: string
  }
  ai_agents?: {
    ok: boolean
    count: number
    items: {
      id: string
      name: string
      routing_values: { path: string; value: string }[]
      handoff_departments: { id: string; name: string | null; target: boolean }[]
      target_handoff_departments: { id: string; name: string | null; target: boolean }[]
    }[]
    error?: string
  }
  agent_runs?: {
    ok: boolean
    count: number
    pagination: Record<string, string | number | boolean | null>
    correlation_count: number
    fallback_uid_count?: number
    exact_ticket_matches?: {
      run_uid: string
      run_path: string
      ticket_id: string
      agent_id: string | null
      agent_name: string | null
      target_handoff_departments: { id: string; name: string | null; target: boolean }[]
    }[]
    items?: {
      uid: string
      uid_source: string | null
      uid_is_fallback: boolean
      agent_id: string | null
      agent_name: string | null
      conversation_id: string | null
      top_level_keys: string[]
      routing_values: { path: string; value: string }[]
      safe_scalars: { path: string; value: string }[]
      identifier_candidates: { path: string; value: string }[]
      target_handoff_departments: { id: string; name: string | null; target: boolean }[]
    }[]
    detail_samples?: {
      uid: string
      ok: boolean
      uid_source: string | null
      agent_id: string | null
      conversation_id: string | null
      top_level_keys: string[]
      routing_values: { path: string; value: string }[]
      safe_scalars: { path: string; value: string }[]
      identifier_candidates: { path: string; value: string }[]
      detail_keys: string[]
      detail_routing_values: { path: string; value: string }[]
      detail_safe_scalars: { path: string; value: string }[]
      error?: string
    }[]
    error?: string
  }
  conclusion?: string
  tested_at?: string
  error?: string
}

type ClickDeskConversationDiagnostic = {
  connected?: boolean
  period?: { year: number; month: number }
  scope?: string[]
  classification_rule?: string
  target_area_detected_in_payload?: boolean
  page_diagnostic_only?: boolean
  counts?: {
    ai: number
    transferred_to_human: number
    overlap: number
  }
  raw_counts?: {
    ai: number
    human: number
  }
  scan?: {
    ai?: { pages_scanned: number; last_page: number; complete: boolean; errors: string[] }
    human?: { pages_scanned: number; last_page: number; complete: boolean; errors: string[] }
  }
  area_coverage?: {
    ai_with_target_area: number
    ai_without_area: number
    human_with_target_area: number
    human_without_area: number
  }
  pagination?: {
    ai?: Record<string, string | number | boolean | null>
    human?: Record<string, string | number | boolean | null>
  }
  timestamps?: {
    ai?: { with_timestamp: number; without_timestamp: number; earliest: string | null; latest: string | null }
    human?: { with_timestamp: number; without_timestamp: number; earliest: string | null; latest: string | null }
  }
  journey_validation?: {
    id: string
    classified_as: 'ai' | 'human'
    assignee: string | null
    transcript_available: boolean
    detail_available: boolean
    transcript: ClickDeskJourneySignal
    detail: ClickDeskJourneySignal
    detail_area: string | null
    error?: string
  }[]
  operational_basis?: {
    source: string
    required_fields: string[]
    journey_status: string
    transcript_required_for_transfer: boolean
    ai_listing_status: string
  }
  human_by_assignee?: { name: string; count: number }[]
  human_by_area_assignee?: {
    area: string
    name: string
    count: number
    journey_confirmed: number
    satisfaction_labels: Record<string, number>
    positive_reviews: number
    negative_reviews: number
    reviews: number
    candidate_csat: number | null
    candidate_review_percentage: number | null
  }[]
  human_satisfaction_labels?: { label: string; count: number }[]
  satisfaction_validation?: {
    positive: number
    negative: number
    evaluated: number
    human_attendances: number
    candidate_csat: number | null
    candidate_review_percentage: number | null
    only_expected_binary_labels: boolean
    other_labels: { label: string; count: number }[]
    csat_config: {
      available: boolean
      keys: string[]
      values: { path: string; value: string }[]
      error?: string
    }
    formula_status: 'candidate_matches_current_business_formula' | 'needs_review_before_formula'
  }
  samples?: {
    ai: ClickDeskConversationSample[]
    human: ClickDeskConversationSample[]
  }
  queues_status?: string
  warning?: string
  tested_at?: string
  error?: string
}
type ClickDeskPersistedAggregate = {
  attendances: number
  positive_reviews: number
  negative_reviews: number
  reviews: number
  csat: number | null
  review_percentage: number | null
}

type ClickDeskPersistedMetrics = {
  source?: string
  period?: {
    start: string
    end: string
    business_time_zone: string
  }
  today?: ClickDeskPersistedAggregate & {
    date: string
    included_in_period: boolean
  }
  accumulated?: ClickDeskPersistedAggregate
  performance_accumulated?: ClickDeskPersistedAggregate
  management_support?: ClickDeskPersistedAggregate
  daily?: Array<ClickDeskPersistedAggregate & { date: string }>
  performance_daily?: Array<ClickDeskPersistedAggregate & { date: string }>
  by_analyst?: Array<
    ClickDeskPersistedAggregate & {
      analyst_id: string | null
      assignee_name: string
      area: string
      team_id: string | null
      today: ClickDeskPersistedAggregate
      daily: Array<ClickDeskPersistedAggregate & { date: string }>
    }
  >
  self_podium_context?: {
    team_average_attendances: number
    team_analysts_with_data: number
    position: number | null
    total_ranked: number
    eligible: boolean
    criteria: {
      csat_min: number
      review_min: number
      volume_min: number
      csat_met: boolean
      review_met: boolean
      volume_met: boolean
      completed: number
    }
  } | null
  data_quality?: {
    grouped_rows: number
    unmatched_grouped_rows: number
    unmatched_attendances: number
  }
  latest_sync?: {
    id: string
    status: string
    period_start: string
    period_end: string
    trigger_mode: string
    pages_scanned: number
    rows_upserted: number
    matched_rows: number
    unmatched_rows: number
    finished_at: string | null
  } | null
  date_basis?: {
    sources: Record<string, number>
    status: 'needs_validation' | 'validated'
    note: string
  }
  erro?: string
}

type ClickDeskDailyTicket = {
  ticket_id: string
  occurred_at: string
  area: string
  satisfaction_label: string | null
  journey_status: string | null
  timestamp_source: string | null
}

type ClickDeskDailyTicketResponse = {
  source?: string
  date?: string
  analyst_id?: string
  tickets?: ClickDeskDailyTicket[]
  erro?: string
}

type ClickDeskEvaluatedSampleTicket = ClickDeskDailyTicket & {
  occurred_date: string
  has_analysis: boolean
}

type ClickDeskEvaluatedSampleResponse = {
  source?: string
  analyst_id?: string
  period?: { start: string; end: string }
  totals?: {
    positive: number
    negative: number
    evaluated: number
  }
  sample_rule?: {
    negative_limit: number
    positive_limit: number
    strategy: string
  }
  negative?: ClickDeskEvaluatedSampleTicket[]
  positive?: ClickDeskEvaluatedSampleTicket[]
  erro?: string
  error?: string
}

type ClickDeskQualitativeSummary = {
  source?: string
  period?: { start: string; end: string }
  scope?: { team_id: string | null; analyst_id: string | null }
  totals?: {
    evaluated: number
    positive: number
    negative: number
    analyzed: number
    analyzed_positive: number
    analyzed_negative: number
    approved: number
    pending: number
    rejected: number
  }
  coverage?: {
    evaluated_percentage: number
    positive_percentage: number
    negative_percentage: number
  }
  causes?: { key: string; count: number }[]
  human_influence?: { key: string; count: number }[]
  controllability?: { key: string; count: number }[]
  sentiment_change?: { key: string; count: number }[]
  coaching_signals?: number
  analysts?: {
    analyst_id: string
    analyst_name: string
    analyzed: number
    positive: number
    negative: number
    coaching_signals: number
    top_causes: { key: string; count: number }[]
  }[]
  pending_reviews?: {
    ticket_id: string
    analyst_id: string
    analyst_name: string
    satisfaction_label: string | null
    cause: {
      category: string
      summary: string
      confidence: string
    }
    human_influence: {
      classification: string
      summary: string
      confidence: string
    }
    controllability: {
      classification: string
      summary: string
    }
    coaching_signal: {
      available: boolean
      summary: string
    }
  }[]
  validation_queue?: {
    ticket_id: string
    analyst_id: string | null
    analyst_name: string
    occurred_date: string
    occurred_at: string
    area: string
    satisfaction_label: string | null
  }[]
  error?: string
}

type ClickDeskQualitativeResponse = {
  source?: string
  ticket_id?: string
  analyst_id?: string | null
  occurred_date?: string | null
  area?: string | null
  satisfaction_label?: string | null
  transcript_characters_analyzed?: number
  model?: string
  cached?: boolean
  analyzed_at?: string
  validation_status?: 'pending' | 'approved' | 'rejected'
  validated_at?: string | null
  analysis?: {
    initial_sentiment: string
    final_sentiment: string
    primary_cause: {
      category: string
      summary: string
      confidence: string
    }
    human_influence: {
      classification: string
      summary: string
      confidence: string
    }
    controllability: {
      classification: string
      summary: string
    }
    coaching_signal: {
      available: boolean
      summary: string
    }
    evidence_summary: string[]
    limitations: string[]
  }
  error?: string
}

type ChatQualitativeFeedbackContext = {
  analyzedCount: number
  negativeAnalyzed: number
  positiveAnalyzed: number
  negativeTotal: number
  positiveTotal: number
  findings: {
    satisfactionLabel: string | null
    occurredDate: string | null
    analysis: NonNullable<ClickDeskQualitativeResponse['analysis']>
  }[]
}

type ClickDeskHistoryPoint = {
  month: string
  label: string
  source: 'official' | 'live'
  status: 'closed' | 'open'
  closure_id: string | null
  closed_at: string | null
  team_id: string | null
  team_name: string | null
  csat_goal: number | null
  review_goal: number
  attendances: number
  positive_reviews: number
  negative_reviews: number
  reviews: number
  csat: number | null
  review_percentage: number | null
  delta: {
    csat_pp: number | null
    review_percentage_pp: number | null
    attendances: number | null
  }
}

type ClickDeskAnalystHistory = {
  source?: string
  analyst?: {
    id: string
    name: string
    current_team_id: string | null
    active: boolean
  }
  current_month?: string
  points?: ClickDeskHistoryPoint[]
  official_months?: number
  live_month_included?: boolean
  erro?: string
}

type ClickDeskSyncResult = {
  synced?: boolean
  run_id?: string
  pages_scanned?: number
  rows_received?: number
  rows_in_period?: number
  rows_persisted?: number
  matched_rows?: number
  unmatched_rows?: number
  unmatched_assignees?: string[]
  auto_links_created?: number
  synced_at?: string
  erro?: string
}

type ClickDeskClosureTotals = {
  attendances: number
  positive_reviews: number
  negative_reviews: number
  reviews: number
  csat: number | null
  review_percentage: number | null
}

type ClickDeskClosurePreview = {
  versao?: string
  fonte?: string
  status?: string
  mes?: string
  equipe?: string
  tem_dados?: boolean
  operacao?: ClickDeskClosureTotals
  performance?: ClickDeskClosureTotals
  apoio_gestao?: ClickDeskClosureTotals
  analistas?: Array<{
    analyst_id: string
    name: string
    team_id: string | null
    team_name: string | null
    csat_goal: number | null
    review_goal: number
    attendances: number
    positive_reviews: number
    negative_reviews: number
    reviews: number
    csat: number | null
    review_percentage: number | null
  }>
  qualidade_dados?: {
    unmapped_attendances: number
    fallback_timestamp_attendances: number
    missing_team_attendances: number
    analyst_metadata_issues: number
  }
  fechamento?: {
    pronto: boolean
    pendencias: string[]
  }
  conferencia?: string
  fechamento_id?: string
  fechado_em?: string
  erro?: string
}

type IndividualForm = {
  analystId: string
  weekStart: string
  weekEnd: string
  csat: string
  positiveReviews: string
  negativeReviews: string
  totalTickets: string
  notes: string
  evidenceFile: File | null
}

type TeamForm = {
  weekStart: string
  weekEnd: string
  answeredCalls: string
  abandonedCalls: string
  totalCalls: string
  overallCsat: string
  notes: string
  evidenceFile: File | null
}

type ChartPoint = {
  label: string
  value: number
}

type WeeklyIndividualTrend = {
  label: string
  csat: number
  totalReviews: number
  totalTickets: number
}

type MonthlyPodiumResult = {
  analystId: string
  analystName: string
  averageCsat: number
  totalReviews: number
  totalTickets: number
  reviewPercentage: number
  individualGoal: number
  eligible: boolean
  reasons: string[]
}

type PhonePodiumRankingRow = {
  position: number
  analyst_id: string
  analyst_name: string
  average_csat: number
  total_reviews: number
  total_tickets: number
  review_percentage: number
  individual_goal: number
  eligible: boolean
  reasons: string[] | null
  team_average_tickets?: number
  team_average_csat?: number
}

type PhonePodiumManual = {
  id: string
  analyst_id: string
  period_start: string
  period_end: string
  position: number
  reason: string | null
}
type PeriodMode = 'week' | 'month' | 'year' | 'custom'

type PeriodFilter = {
  mode: PeriodMode
  start: string
  end: string
}

type AppModule = 'phone' | 'chat'

type ChatFeedbackStyle = 'coach' | 'sare' | 'mimo'
type FeedbackGoal = 'recognition' | 'courseCorrection' | 'maintenance' | 'development'

type ActiveTab = 'dashboard' | 'reports' | 'analysts' | 'goals' | 'entries' | 'users'

const initialIndividualForm: IndividualForm = {
  analystId: '',
  weekStart: '',
  weekEnd: '',
  csat: '',
  positiveReviews: '',
  negativeReviews: '',
  totalTickets: '',
  notes: '',
  evidenceFile: null,
}

const initialTeamForm: TeamForm = {
  weekStart: '',
  weekEnd: '',
  answeredCalls: '',
  abandonedCalls: '',
  totalCalls: '',
  overallCsat: '',
  notes: '',
  evidenceFile: null,
}

const initialAnalystForm = {
  name: '',
  csatGoal: '86',
  photoFile: null as File | null,
}

const initialGoalForm = {
  label: '',
  value: '',
  unit: 'percent',
  active: true,
}

const initialAccessUserForm = {
  fullName: '',
  email: '',
  password: '',
  role: 'analista',
  analystId: '',
  chatAnalystId: '',
}

function playScheduleAlertSound() {
  try {
    const AudioContextCtor =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
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
    // O alerta visual continua ativo caso o navegador bloqueie áudio automático.
  }
}

function showScheduleBrowserNotification(item: ScheduleNotification) {
  if (typeof window === 'undefined' || !('Notification' in window)) return
  if (window.Notification.permission !== 'granted') return
  try {
    new window.Notification(item.title, { body: item.message, tag: item.id })
  } catch {
    // O pop-up interno continua sendo o canal principal.
  }
}

const ANALYST_PHOTO_BUCKET = 'analyst-photos'
const MAX_ANALYST_PHOTO_SIZE = 5 * 1024 * 1024
const ACCEPTED_ANALYST_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp']

async function uploadAnalystPhoto(file: File, scope: 'phone' | 'chat', analystId: string) {
  if (!ACCEPTED_ANALYST_PHOTO_TYPES.includes(file.type)) {
    throw new Error('Use uma imagem PNG, JPG ou WEBP.')
  }
  if (file.size > MAX_ANALYST_PHOTO_SIZE) {
    throw new Error('A foto deve ter no máximo 5 MB.')
  }

  const extension = file.name.split('.').pop()?.toLowerCase() || 'jpg'
  const path = `${scope}/${analystId}/profile.${extension}`
  const { error } = await supabase.storage.from(ANALYST_PHOTO_BUCKET).upload(path, file, {
    cacheControl: '3600',
    contentType: file.type,
    upsert: true,
  })
  if (error) throw error

  const { data } = supabase.storage.from(ANALYST_PHOTO_BUCKET).getPublicUrl(path)
  return `${data.publicUrl}?v=${Date.now()}`
}

export default function Home() {
  const [user, setUser] = useState<User | null>(null)
  const [isHomologationView, setIsHomologationView] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [goals, setGoals] = useState<Goal[]>([])
  const [profiles, setProfiles] = useState<UserProfile[]>([])
  const [analysts, setAnalysts] = useState<Analyst[]>([])
  const [individualMetrics, setIndividualMetrics] = useState<IndividualMetric[]>([])
  const [teamMetrics, setTeamMetrics] = useState<TeamMetric[]>([])
  const [chatTeams, setChatTeams] = useState<ChatTeam[]>([])
  const [chatAnalysts, setChatAnalysts] = useState<ChatAnalyst[]>([])
  const [chatMonthlyMetrics, setChatMonthlyMetrics] = useState<ChatMonthlyMetric[]>([])
  const [chatPodiumManual, setChatPodiumManual] = useState<ChatPodiumManual[]>([])
  const [chatPodiumExclusions, setChatPodiumExclusions] = useState<ChatPodiumExclusion[]>([])
  const [activeModule, setActiveModule] = useState<AppModule>('phone')
  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard')
  const [individualForm, setIndividualForm] = useState(initialIndividualForm)
  const [teamForm, setTeamForm] = useState(initialTeamForm)
  const [analystForm, setAnalystForm] = useState(initialAnalystForm)
  const [goalForm, setGoalForm] = useState(initialGoalForm)
  const [accessUserForm, setAccessUserForm] = useState(initialAccessUserForm)
  const [editingProfileNameId, setEditingProfileNameId] = useState<string | null>(null)
  const [profileNameForm, setProfileNameForm] = useState('')
  const [editingAnalystId, setEditingAnalystId] = useState<string | null>(null)
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [scheduleProfileId, setScheduleProfileId] = useState<string | null>(null)
  const [scheduleNotifications, setScheduleNotifications] = useState<ScheduleNotification[]>([])
  const [schedulePopup, setSchedulePopup] = useState<ScheduleNotification | null>(null)
  const scheduleNotificationIds = useRef(new Set<string>())

  useEffect(() => {
    setIsHomologationView(isHomologationBrowserRuntime())

    const recoveryFromHash = new URLSearchParams(window.location.hash.replace('#', ''))
    const recoveryFromSearch = new URLSearchParams(window.location.search)
    const cameFromRecoveryLink =
      recoveryFromHash.get('type') === 'recovery' ||
      recoveryFromSearch.get('type') === 'recovery'

    async function loadSession() {
      const { data } = await supabase.auth.getUser()
      setUser(data.user)
      if (cameFromRecoveryLink) {
        setIsPasswordRecovery(true)
        setMessage('Digite uma nova senha para concluir a recuperação.')
      }
      if (!data.user) setLoading(false)
    }

    loadSession()

    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setUser(session?.user ?? null)
        setIsPasswordRecovery(true)
        setMessage('Digite uma nova senha para concluir a recuperação.')
      }
    })

    return () => {
      authListener.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!user) return
    loadData()
  }, [user])

  async function loadData() {
    if (!user) return

    setLoading(true)
    setMessage('')

    const [profileResult, profilesResult, goalsResult, analystsResult] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', user.id).maybeSingle(),
      supabase.from('profiles').select('*').order('full_name'),
      supabase.from('goals').select('id, key, label, value, unit, active').order('label'),
      supabase.from('analysts').select('id, name, active, csat_goal, photo_url').order('name'),
    ])

    const loadedProfile = (profileResult.data as UserProfile | null) ?? null
    const loadedAnalysts = analystsResult.data ?? []
    const loadedRole = normalizeUserRole(loadedProfile?.role)
    const loadedProfileAnalystId = getProfileAnalystId(loadedProfile, loadedAnalysts, user.email ?? '')

    if (profileResult.error) setMessage(getSupabaseMessage(profileResult.error.message))
    else setProfile(loadedProfile)

    if (profilesResult.error) setProfiles([])
    else setProfiles((profilesResult.data ?? []) as UserProfile[])

    if (goalsResult.error) setMessage(getSupabaseMessage(goalsResult.error.message))
    else setGoals((goalsResult.data ?? []).filter((goal) => goal.key !== 'individual_csat'))

    if (analystsResult.error) setMessage(getSupabaseMessage(analystsResult.error.message))
    else {
      const activeAnalysts = loadedAnalysts.filter((analyst) => analyst.active)
      setAnalysts(loadedAnalysts)
      setIndividualForm((current) => ({
        ...current,
        analystId: current.analystId || activeAnalysts[0]?.id || '',
      }))
    }

    let individualQuery = supabase
      .from('weekly_individual_metrics')
      .select('id, analyst_id, week_start, week_end, csat, total_reviews, positive_reviews, negative_reviews, review_percentage, total_tickets, evidence_url, notes, analysts(name, photo_url)')
      .order('week_start', { ascending: false })
      .limit(52)

    if (loadedRole === 'analyst') {
      if (loadedProfileAnalystId) individualQuery = individualQuery.eq('analyst_id', loadedProfileAnalystId)
      else individualQuery = individualQuery.eq('analyst_id', '00000000-0000-0000-0000-000000000000')
    }

    const [individualResult, teamResult] = await Promise.all([
      individualQuery,
      supabase
        .from('weekly_team_metrics')
        .select('id, week_start, week_end, answered_calls, abandoned_calls, total_calls, performance_percentage, overall_csat, evidence_url, notes')
        .order('week_start', { ascending: false })
        .limit(52),
    ])

    if (individualResult.error) setMessage(getSupabaseMessage(individualResult.error.message))
    else setIndividualMetrics((individualResult.data ?? []) as IndividualMetric[])

    if (teamResult.error) setMessage(getSupabaseMessage(teamResult.error.message))
    else setTeamMetrics(teamResult.data ?? [])

    const [chatTeamsResult, chatAnalystsResult] = await Promise.all([
      supabase.from('chat_teams').select('id, name, legacy_name, manager_name, active').order('name'),
      supabase.from('chat_analysts').select('id, team_id, name, csat_goal, active, photo_url').order('name'),
    ])

    if (chatTeamsResult.error) setMessage(getSupabaseMessage(chatTeamsResult.error.message))
    else setChatTeams((chatTeamsResult.data ?? []) as ChatTeam[])

    if (chatAnalystsResult.error) setMessage(getSupabaseMessage(chatAnalystsResult.error.message))
    else setChatAnalysts((chatAnalystsResult.data ?? []) as ChatAnalyst[])

    if (loadedRole === 'analyst') {
      setChatMonthlyMetrics([])
      setChatPodiumManual([])
      setChatPodiumExclusions([])
    } else {
      const [chatMetricsResult, chatManualPodiumResult, chatExclusionsResult] = await Promise.all([
        supabase
          .from('chat_monthly_metrics')
          .select('id, team_id, analyst_id, month_label, year, month_number, period_start, period_end, csat, review_percentage, sending_percentage, total_tickets, inactive_tickets, valid_tickets, reviews, positive_reviews, negative_reviews, csat_goal, csat_delta, general_review_goal, status, chat_analysts(name, csat_goal, photo_url), chat_teams(name)')
          .order('period_start', { ascending: false })
          .limit(500),
        supabase
          .from('chat_podium_manual')
          .select('id, team_id, analyst_id, year, month_number, position')
          .order('year', { ascending: false }),
        supabase
          .from('chat_podium_exclusions')
          .select('id, team_id, analyst_id, year, month_number, reason')
          .order('year', { ascending: false }),
      ])

      if (chatMetricsResult.error) setMessage(getSupabaseMessage(chatMetricsResult.error.message))
      else setChatMonthlyMetrics((chatMetricsResult.data ?? []) as ChatMonthlyMetric[])

      if (chatManualPodiumResult.error) setChatPodiumManual([])
      else setChatPodiumManual((chatManualPodiumResult.data ?? []) as ChatPodiumManual[])

      if (chatExclusionsResult.error) setChatPodiumExclusions([])
      else setChatPodiumExclusions((chatExclusionsResult.data ?? []) as ChatPodiumExclusion[])
    }

    setLoading(false)
  }

  const activeAnalysts = useMemo(
    () => analysts.filter((analyst) => analyst.active),
    [analysts],
  )
  const selectedAnalyst = useMemo(
    () => analysts.find((analyst) => analyst.id === individualForm.analystId) ?? null,
    [analysts, individualForm.analystId],
  )
  const podiumCsatGoal = goals.find((goal) => goal.key === 'podium_csat_minimum')?.value ?? 90
  const userRole = normalizeUserRole(profile?.role)
  const isManagementUser = userRole !== 'analyst'
  const profileAnalyst = useMemo(
    () => findProfileAnalyst(profile, analysts, user?.email ?? ''),
    [profile, analysts, user?.email],
  )
  const profileAnalystId = useMemo(
    () => getProfileAnalystId(profile, analysts, user?.email ?? ''),
    [profile, analysts, user?.email],
  )
  const analystFallback = useMemo(
    () => createProfileAnalystFallback(profile, profileAnalystId, user?.email ?? ''),
    [profile, profileAnalystId, user?.email],
  )
  const currentProfileAnalyst = profileAnalyst ?? analystFallback
  const profileChatAnalyst = useMemo(
    () =>
      chatAnalysts.find((analyst) => analyst.id === profile?.chat_analyst_id) ??
      null,
    [chatAnalysts, profile?.chat_analyst_id],
  )
  const profileChatTeam = useMemo(
    () =>
      profileChatAnalyst
        ? chatTeams.find((team) => team.id === profileChatAnalyst.team_id) ?? null
        : null,
    [chatTeams, profileChatAnalyst],
  )
  const hasPhoneAnalystAccess = Boolean(currentProfileAnalyst)
  const hasChatAnalystAccess = Boolean(profile?.chat_analyst_id)
  const visibleAnalysts = useMemo(
    () => (isManagementUser ? analysts : currentProfileAnalyst ? [currentProfileAnalyst] : []),
    [isManagementUser, analysts, currentProfileAnalyst],
  )
  const visibleActiveAnalysts = useMemo(
    () => visibleAnalysts.filter((analyst) => analyst.active),
    [visibleAnalysts],
  )
  const visibleIndividualMetrics = useMemo(
    () =>
      isManagementUser
        ? individualMetrics
        : individualMetrics.filter((metric) => metric.analyst_id === profileAnalystId),
    [isManagementUser, individualMetrics, profileAnalystId],
  )

  useEffect(() => {
    if (isManagementUser) return

    if (activeTab !== 'dashboard') setActiveTab('dashboard')

    if (activeModule === 'phone' && !hasPhoneAnalystAccess && hasChatAnalystAccess) {
      setActiveModule('chat')
      return
    }

    if (activeModule === 'chat' && !hasChatAnalystAccess && hasPhoneAnalystAccess) {
      setActiveModule('phone')
      return
    }

    if (!hasPhoneAnalystAccess && hasChatAnalystAccess) {
      setActiveModule('chat')
    }
  }, [
    activeModule,
    activeTab,
    hasPhoneAnalystAccess,
    hasChatAnalystAccess,
    isManagementUser,
  ])

  useEffect(() => {
    if (!isManagementUser || !profile?.full_name) {
      setScheduleProfileId(null)
      setScheduleNotifications([])
      setSchedulePopup(null)
      return
    }

    let cancelled = false
    let channel: ReturnType<typeof scheduleSupabase.channel> | null = null

    async function connectScheduleAlerts() {
      const { data: scheduleProfile } = await scheduleSupabase
        .from('profiles')
        .select('id,full_name')
        .eq('full_name', profile?.full_name ?? '')
        .maybeSingle()

      if (cancelled || !scheduleProfile?.id) return

      const profileId = String(scheduleProfile.id)
      setScheduleProfileId(profileId)

      const { data: initial } = await scheduleSupabase
        .from('schedule_notifications')
        .select('*')
        .eq('profile_id', profileId)
        .order('created_at', { ascending: false })
        .limit(30)

      if (cancelled) return
      const loaded = (initial ?? []) as ScheduleNotification[]
      setScheduleNotifications(loaded)
      scheduleNotificationIds.current = new Set(loaded.map((item) => item.id))

      const latestUnseen = loaded.find((item) => !item.seen_at)
      if (latestUnseen) setSchedulePopup(latestUnseen)

      channel = scheduleSupabase
        .channel(`performance-schedule-alerts-${profileId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'schedule_notifications',
            filter: `profile_id=eq.${profileId}`,
          },
          (payload) => {
            const item = payload.new as ScheduleNotification
            if (scheduleNotificationIds.current.has(item.id)) return
            scheduleNotificationIds.current.add(item.id)
            setScheduleNotifications((current) => [item, ...current])
            setSchedulePopup(item)
            playScheduleAlertSound()
            showScheduleBrowserNotification(item)
            document.title = '🔔 Nova solicitação de escala'
          },
        )
        .subscribe()
    }

    connectScheduleAlerts()

    return () => {
      cancelled = true
      if (channel) scheduleSupabase.removeChannel(channel)
    }
  }, [isManagementUser, profile?.full_name])

  useEffect(() => {
    if (!scheduleProfileId) return

    const checkUnseen = async () => {
      const { data } = await scheduleSupabase
        .from('schedule_notifications')
        .select('*')
        .eq('profile_id', scheduleProfileId)
        .is('seen_at', null)
        .order('created_at', { ascending: false })
        .limit(1)

      const unseen = (data?.[0] ?? null) as ScheduleNotification | null
      if (unseen) {
        setSchedulePopup(unseen)
        setScheduleNotifications((current) => {
          if (current.some((item) => item.id === unseen.id)) return current
          return [unseen, ...current]
        })
        playScheduleAlertSound()
      }
    }

    const onFocus = () => checkUnseen()
    const onVisibility = () => {
      if (document.visibilityState === 'visible') checkUnseen()
    }

    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [scheduleProfileId])

  async function markScheduleNotificationSeen(item: ScheduleNotification) {
    await scheduleSupabase
      .from('schedule_notifications')
      .update({ seen_at: new Date().toISOString() })
      .eq('id', item.id)

    setScheduleNotifications((current) =>
      current.map((notification) =>
        notification.id === item.id
          ? { ...notification, seen_at: new Date().toISOString() }
          : notification,
      ),
    )
    setSchedulePopup(null)
    document.title = 'Central de Performance'
  }

  async function enableScheduleBrowserNotifications() {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setMessage('Este navegador não oferece notificações do sistema.')
      return
    }
    const permission = await window.Notification.requestPermission()
    setMessage(
      permission === 'granted'
        ? 'Alertas de escala do navegador ativados.'
        : 'O navegador não autorizou notificações. O pop-up, sino e som internos continuam ativos.',
    )
  }

  async function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage('Entrando...')

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      setMessage(error.message)
      return
    }

    setUser(data.user)
    setMessage('')
  }

  async function handleHomologationSignup() {
    if (!isHomologationView) return

    const trimmedEmail = email.trim().toLowerCase()

    if (!trimmedEmail || password.length < 6) {
      setMessage('Na homologação, informe seu e-mail corporativo e uma senha com pelo menos 6 caracteres.')
      return
    }

    setSaving(true)
    setMessage('Criando acesso de homologação...')

    try {
      const { data, error } = await supabase.auth.signUp({
        email: trimmedEmail,
        password,
      })

      if (error) {
        setMessage(error.message)
        return
      }

      if (data.session && data.user) {
        setUser(data.user)
        setMessage('')
        return
      }

      setMessage('Acesso criado. Se o Supabase solicitar confirmação, confira seu e-mail corporativo antes de entrar.')
    } finally {
      setSaving(false)
    }
  }

  async function handlePasswordReset() {
    const trimmedEmail = email.trim()

    if (!trimmedEmail) {
      setMessage('Digite seu e-mail primeiro para receber o link de redefinicao.')
      return
    }

    setSaving(true)
    setMessage('Enviando e-mail de redefinicao...')

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || window.location.origin

    const { error } = await supabase.auth.resetPasswordForEmail(trimmedEmail, {
      redirectTo: appUrl,
    })

    setSaving(false)

    if (error) {
      setMessage(error.message)
      return
    }

    setMessage('Enviamos um link para seu e-mail. Abra o link para redefinir sua senha.')
  }

  async function handleUpdatePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (newPassword.length < 6) {
      setMessage('A nova senha precisa ter pelo menos 6 caracteres.')
      return
    }

    setSaving(true)
    setMessage('Atualizando senha...')

    const { error } = await supabase.auth.updateUser({ password: newPassword })

    setSaving(false)

    if (error) {
      setMessage(error.message)
      return
    }

    setNewPassword('')
    setIsPasswordRecovery(false)
    setMessage('Senha atualizada com sucesso.')
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    setUser(null)
    setIsPasswordRecovery(false)
    setProfile(null)
    setGoals([])
    setProfiles([])
    setAnalysts([])
    setIndividualMetrics([])
    setTeamMetrics([])
  }

  async function handleCreateAccessUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setMessage('Criando usuario de acesso...')

    try {
      if (accessUserForm.password.length < 6) {
        setMessage('A senha temporaria precisa ter pelo menos 6 caracteres.')
        return
      }

      if (
        accessUserForm.role === 'analista' &&
        !accessUserForm.analystId &&
        !accessUserForm.chatAnalystId
      ) {
        setMessage('Vincule o usuário ao Telefone, ao Chat ou aos dois módulos.')
        return
      }

      const { data: sessionData } = await supabase.auth.getSession()
      const accessToken = sessionData.session?.access_token

      if (!accessToken) {
        setMessage('Sessao expirada. Entre novamente para criar usuarios.')
        return
      }

      const response = await fetch('/api/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          fullName: accessUserForm.fullName.trim(),
          email: accessUserForm.email.trim(),
          password: accessUserForm.password,
          role: accessUserForm.role,
          analystId: accessUserForm.role === 'analista' ? accessUserForm.analystId : null,
          chatAnalystId:
            accessUserForm.role === 'analista' ? accessUserForm.chatAnalystId : null,
        }),
      })

      const result = await response.json().catch(() => ({}))

      if (!response.ok) {
        setMessage(result.error ?? 'Não foi possível criar o usuario.')
        return
      }

      setAccessUserForm(initialAccessUserForm)
      setMessage(result.message ?? 'Usuario criado com sucesso.')
      await loadData()
    } catch (error) {
      setMessage(getErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  function handleEditProfileName(profile: UserProfile) {
    setEditingProfileNameId(profile.id)
    setProfileNameForm(profile.full_name || profile.name || '')
    setMessage('')
  }

  function handleCancelProfileNameEdit() {
    setEditingProfileNameId(null)
    setProfileNameForm('')
    setMessage('')
  }

  async function handleSaveProfileName(profileId: string) {
    const fullName = profileNameForm.trim()

    if (!fullName) {
      setMessage('Informe o nome exibido do usuario.')
      return
    }

    setSaving(true)
    setMessage('Atualizando nome do usuario...')

    const { error } = await supabase
      .from('profiles')
      .update({ full_name: fullName })
      .eq('id', profileId)

    setSaving(false)

    if (error) {
      setMessage(getSupabaseMessage(error.message))
      return
    }

    setEditingProfileNameId(null)
    setProfileNameForm('')
    setMessage('Nome do usuario atualizado com sucesso.')
    await loadData()
  }

  async function handleAnalystSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setMessage('')

    try {
      const payload = {
        name: analystForm.name.trim(),
        csat_goal: toNumber(analystForm.csatGoal),
      }

      const result = editingAnalystId
        ? await withTimeout(
            supabase
              .from('analysts')
              .update(payload)
              .eq('id', editingAnalystId)
              .select('id, name, active, csat_goal, photo_url')
              .single(),
            'O Supabase demorou para atualizar o analista. Tente novamente.',
          )
        : await withTimeout(
            supabase
              .from('analysts')
              .insert({ ...payload, active: true })
              .select('id, name, active, csat_goal, photo_url')
              .single(),
            'O Supabase demorou para incluir o analista. Tente novamente.',
          )

      if (result.error) setMessage(result.error.message)
      else {
        let savedAnalyst = result.data as Analyst
        if (analystForm.photoFile) {
          const photoUrl = await uploadAnalystPhoto(analystForm.photoFile, 'phone', savedAnalyst.id)
          const photoResult = await supabase
            .from('analysts')
            .update({ photo_url: photoUrl })
            .eq('id', savedAnalyst.id)
            .select('id, name, active, csat_goal, photo_url')
            .single()
          if (photoResult.error) throw photoResult.error
          savedAnalyst = photoResult.data as Analyst
        }
        setMessage(editingAnalystId ? 'Analista atualizado com sucesso.' : 'Analista incluido com sucesso.')
        setAnalysts((current) => upsertAnalyst(current, savedAnalyst))
        setAnalystForm(initialAnalystForm)
        setEditingAnalystId(null)
      }
    } catch (error) {
      setMessage(getErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  async function handleEditAnalyst(analyst: Analyst) {
    setAnalystForm({
      name: analyst.name,
      csatGoal: String(analyst.csat_goal),
      photoFile: null,
    })
    setEditingAnalystId(analyst.id)
  }

  function handleCancelAnalystEdit() {
    setAnalystForm(initialAnalystForm)
    setEditingAnalystId(null)
  }

  async function handleRemoveAnalystPhoto(analyst: Analyst) {
    if (!window.confirm(`Remover a foto personalizada de ${analyst.name}?`)) return
    setSaving(true)
    const { error } = await supabase.from('analysts').update({ photo_url: null }).eq('id', analyst.id)
    setSaving(false)
    if (error) {
      setMessage(getSupabaseMessage(error.message))
      return
    }
    setAnalysts((current) => current.map((item) => item.id === analyst.id ? { ...item, photo_url: null } : item))
    setMessage('Foto personalizada removida. A imagem inicial ou as iniciais serão exibidas.')
  }

  async function handleToggleAnalyst(analyst: Analyst) {
    setSaving(true)
    setMessage('')

    try {
      const { error } = await withTimeout(
        supabase
          .from('analysts')
          .update({ active: !analyst.active })
          .eq('id', analyst.id)
          .select('id, name, active, csat_goal, photo_url')
          .single(),
        'O Supabase demorou para alterar o status do analista. Tente novamente.',
      )

      if (error) setMessage(error.message)
      else {
        setMessage(analyst.active ? 'Analista inativado com sucesso.' : 'Analista reativado com sucesso.')
        setAnalysts((current) =>
          current.map((item) =>
            item.id === analyst.id ? { ...item, active: !analyst.active } : item,
          ),
        )
      }
    } catch (error) {
      setMessage(getErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteAnalyst(analyst: Analyst) {
    const confirmed = window.confirm(
      `Excluir ${analyst.name}? Se ele tiver historico de lançamentos, prefira inativar para preservar os relatórios.`,
    )

    if (!confirmed) return

    setSaving(true)
    setMessage('')

    try {
      const { error } = await withTimeout(
        supabase.from('analysts').delete().eq('id', analyst.id),
        'O Supabase demorou para excluir o analista. Tente novamente.',
      )

      if (error) {
        setMessage('Não foi possível excluir. Se existir historico, use Inativar para preservar os dados.')
      } else {
        setMessage('Analista excluido com sucesso.')
        if (editingAnalystId === analyst.id) handleCancelAnalystEdit()
        setAnalysts((current) => current.filter((item) => item.id !== analyst.id))
      }
    } catch (error) {
      setMessage(getErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  async function handleGoalSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editingGoalId) return

    setSaving(true)
    setMessage('')

    try {
      const result = await withTimeout(
        supabase
          .from('goals')
          .update({
            label: goalForm.label.trim(),
            value: toNumber(goalForm.value),
            unit: goalForm.unit.trim() || 'percent',
            active: goalForm.active,
          })
          .eq('id', editingGoalId)
          .select('id, key, label, value, unit, active')
          .single(),
        'O Supabase demorou para atualizar a meta. Tente novamente.',
      )

      if (result.error) setMessage(result.error.message)
      else {
        setMessage('Meta atualizada com sucesso.')
        setGoals((current) => upsertGoal(current, result.data as Goal))
        setGoalForm(initialGoalForm)
        setEditingGoalId(null)
      }
    } catch (error) {
      setMessage(getErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  function handleEditGoal(goal: Goal) {
    setGoalForm({
      label: goal.label,
      value: String(goal.value),
      unit: goal.unit,
      active: goal.active,
    })
    setEditingGoalId(goal.id)
  }

  function handleCancelGoalEdit() {
    setGoalForm(initialGoalForm)
    setEditingGoalId(null)
  }

  async function uploadEvidence(file: File | null, folder: string) {
    if (!file) return null

    const extension = file.name.split('.').pop() || 'arquivo'
    const safeName = file.name
      .replace(/\.[^/.]+$/, '')
      .replace(/[^a-zA-Z0-9-_]/g, '-')
      .slice(0, 60)
    const path = `${folder}/${user?.id ?? 'usuario'}/${Date.now()}-${safeName}.${extension}`

    const { error } = await supabase.storage.from('evidencias').upload(path, file, {
      cacheControl: '3600',
      upsert: false,
    })

    if (error) throw new Error(error.message)

    const { data } = supabase.storage.from('evidencias').getPublicUrl(path)
    return data.publicUrl
  }

  async function handleIndividualSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage('')

    try {
      const positiveReviews = toNumber(individualForm.positiveReviews)
      const negativeReviews = toNumber(individualForm.negativeReviews)
      const totalReviews = positiveReviews + negativeReviews
      const totalTickets = toNumber(individualForm.totalTickets)

      if (isEndBeforeStart(individualForm.weekStart, individualForm.weekEnd)) {
        setMessage('A data final nao pode ser menor que a data inicial.')
        return
      }

      if (totalReviews > totalTickets) {
        setMessage('O total de avaliações nao pode ser maior que o total de atendimentos.')
        return
      }

      const alreadyExists = individualMetrics.some(
        (metric) =>
          metric.analyst_id === individualForm.analystId &&
          metric.week_start === individualForm.weekStart &&
          metric.week_end === individualForm.weekEnd,
      )

      if (alreadyExists) {
        setMessage('Já existe lançamento para este analista neste mesmo período.')
        return
      }

      setSaving(true)

      const reviewPercentage = totalTickets ? round((totalReviews / totalTickets) * 100) : 0
      const evidenceUrl = await uploadEvidence(individualForm.evidenceFile, 'individual')

      const { error } = await supabase.from('weekly_individual_metrics').insert({
        analyst_id: individualForm.analystId,
        week_start: individualForm.weekStart,
        week_end: individualForm.weekEnd,
        csat: toNumber(individualForm.csat),
        total_reviews: totalReviews,
        positive_reviews: positiveReviews,
        negative_reviews: negativeReviews,
        review_percentage: reviewPercentage,
        total_tickets: totalTickets,
        evidence_url: evidenceUrl,
        notes: individualForm.notes || null,
        created_by: user?.id,
      })

      if (error) setMessage(error.message)
      else {
        setMessage('Lancamento individual salvo com sucesso.')
        setIndividualForm({ ...initialIndividualForm, analystId: activeAnalysts[0]?.id || '' })
        await loadData()
      }
    } catch (error) {
      setMessage(`Não foi possível salvar a evidencia ou o lançamento: ${getErrorMessage(error)}`)
    } finally {
      setSaving(false)
    }
  }

  async function handleTeamSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage('')

    try {
      const answeredCalls = toNumber(teamForm.answeredCalls)
      const abandonedCalls = toNumber(teamForm.abandonedCalls)
      const totalCalls = toNumber(teamForm.totalCalls)
      const overallCsat = toNumber(teamForm.overallCsat)

      if (isEndBeforeStart(teamForm.weekStart, teamForm.weekEnd)) {
        setMessage('A data final nao pode ser menor que a data inicial.')
        return
      }

      if (answeredCalls > totalCalls) {
        setMessage('Ligações atendidas nao pode ser maior que o total processado.')
        return
      }

      const alreadyExists = teamMetrics.some(
        (metric) =>
          metric.week_start === teamForm.weekStart &&
          metric.week_end === teamForm.weekEnd,
      )

      if (alreadyExists) {
        setMessage('Já existe performance da equipe neste mesmo período.')
        return
      }

      setSaving(true)

      const performancePercentage = totalCalls
        ? round((answeredCalls / totalCalls) * 100)
        : 0
      const evidenceUrl = await uploadEvidence(teamForm.evidenceFile, 'equipe')

      const { error } = await supabase.from('weekly_team_metrics').insert({
        week_start: teamForm.weekStart,
        week_end: teamForm.weekEnd,
        answered_calls: answeredCalls,
        abandoned_calls: abandonedCalls,
        total_calls: totalCalls,
        performance_percentage: performancePercentage,
        overall_csat: overallCsat,
        evidence_url: evidenceUrl,
        notes: teamForm.notes || null,
        created_by: user?.id,
      })

      if (error) setMessage(error.message)
      else {
        setMessage('Performance da equipe salva com sucesso.')
        setTeamForm(initialTeamForm)
        await loadData()
      }
    } catch (error) {
      setMessage(`Não foi possível salvar a evidencia ou a performance: ${getErrorMessage(error)}`)
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteIndividualMetric(metric: IndividualMetric) {
    const analystName = getAnalystName(metric.analysts)
    const confirmed = window.confirm(
      `Excluir o lançamento individual de ${analystName} da semana ${formatWeek(metric.week_start, metric.week_end)}?`,
    )

    if (!confirmed) return

    setSaving(true)
    setMessage('')

    try {
      const { error } = await withTimeout(
        supabase.from('weekly_individual_metrics').delete().eq('id', metric.id),
        'O Supabase demorou para excluir o lançamento. Tente novamente.',
      )

      if (error) setMessage(error.message)
      else {
        setMessage('Lancamento individual excluido com sucesso.')
        setIndividualMetrics((current) => current.filter((item) => item.id !== metric.id))
      }
    } catch (error) {
      setMessage(getErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteTeamMetric(metric: TeamMetric) {
    const confirmed = window.confirm(
      `Excluir a performance da equipe da semana ${formatWeek(metric.week_start, metric.week_end)}?`,
    )

    if (!confirmed) return

    setSaving(true)
    setMessage('')

    try {
      const { error } = await withTimeout(
        supabase.from('weekly_team_metrics').delete().eq('id', metric.id),
        'O Supabase demorou para excluir a performance. Tente novamente.',
      )

      if (error) setMessage(error.message)
      else {
        setMessage('Performance da equipe excluida com sucesso.')
        setTeamMetrics((current) => current.filter((item) => item.id !== metric.id))
      }
    } catch (error) {
      setMessage(getErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  async function handleUpdateTeamOverallCsat(metric: TeamMetric, overallCsat: number) {
    if (!Number.isFinite(overallCsat) || overallCsat < 0 || overallCsat > 100) {
      setMessage('Informe um CSAT geral entre 0 e 100%.')
      return
    }

    setSaving(true)
    setMessage('')

    try {
      const { error } = await withTimeout(
        supabase.from('weekly_team_metrics').update({ overall_csat: overallCsat }).eq('id', metric.id),
        'O Supabase demorou para atualizar o CSAT geral. Tente novamente.',
      )

      if (error) setMessage(error.message)
      else {
        setMessage(`CSAT geral da semana ${formatWeek(metric.week_start, metric.week_end)} atualizado com sucesso.`)
        setTeamMetrics((current) =>
          current.map((item) => (item.id === metric.id ? { ...item, overall_csat: overallCsat } : item)),
        )
      }
    } catch (error) {
      setMessage(getErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  if (!user || isPasswordRecovery) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-white">
        <section className="w-full max-w-md rounded-lg border border-white/10 bg-white/5 p-6 shadow-2xl">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-cyan-300">
            Central de Performance
          </p>
          {isHomologationView && (
            <div className="mt-3 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs font-semibold text-amber-200">
              Ambiente de homologação · dados e acessos separados da produção
            </div>
          )}
          <h1 className="mt-4 text-3xl font-bold">
            {isPasswordRecovery ? 'Criar nova senha' : 'Entrar no sistema'}
          </h1>

          {isPasswordRecovery ? (
            <form className="mt-6 space-y-4" onSubmit={handleUpdatePassword}>
              <Field label="Nova senha">
                <input
                  className="form-input"
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  required
                  minLength={6}
                />
              </Field>

              <button className="primary-button w-full" disabled={saving} type="submit">
                {saving ? 'Salvando...' : 'Salvar nova senha'}
              </button>
            </form>
          ) : (
            <form className="mt-6 space-y-4" onSubmit={handleLogin}>
              <Field label="E-mail">
                <input
                  className="form-input"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </Field>

              <Field label="Senha">
                <input
                  className="form-input"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </Field>

              <button className="primary-button w-full" type="submit">
                Entrar
              </button>

              <button
                className="w-full text-sm font-semibold text-cyan-300 hover:text-cyan-200 disabled:text-slate-500"
                disabled={saving}
                type="button"
                onClick={handlePasswordReset}
              >
                {saving ? 'Enviando link...' : 'Esqueci minha senha'}
              </button>

              {isHomologationView && (
                <button
                  className="w-full rounded-lg border border-white/10 px-4 py-3 text-sm font-semibold text-slate-200 transition hover:border-cyan-400/40 hover:text-cyan-200 disabled:text-slate-500"
                  disabled={saving}
                  type="button"
                  onClick={handleHomologationSignup}
                >
                  {saving ? 'Preparando acesso...' : 'Primeiro acesso na homologação'}
                </button>
              )}
            </form>
          )}

          {message && <Feedback message={message} />}
        </section>
      </main>
    )
  }

  return (
    <main className="app-shell min-h-screen px-5 py-6 sm:px-8">
      {schedulePopup && (
        <div className="fixed right-4 top-4 z-50 w-[min(430px,calc(100vw-2rem))] rounded-2xl border border-cyan-400/50 bg-slate-900 p-5 shadow-2xl shadow-cyan-950/50">
          <div className="flex items-start gap-3">
            <div className="animate-bounce text-2xl">🔔</div>
            <div className="flex-1">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-300">
                Nova solicitação de escala
              </p>
              <h2 className="mt-1 text-lg font-bold">{schedulePopup.title}</h2>
              <p className="mt-2 text-sm text-slate-300">{schedulePopup.message}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  className="primary-button"
                  href="/escalas/gestao"
                  onClick={() => markScheduleNotificationSeen(schedulePopup)}
                >
                  Ver agora
                </Link>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => markScheduleNotificationSeen(schedulePopup)}
                >
                  Marcar como vista
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      <section className="mx-auto max-w-7xl">
        {isHomologationView && (
          <div className="homologation-banner" role="status">
            <strong>Ambiente de homologação</strong>
            <span>Versão de testes do Sistema de Performance. Alterações aqui não são produção.</span>
          </div>
        )}
        <header className="app-header flex flex-col gap-5 border-b border-white/10 pb-6 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-cyan-300">
              Central de Performance
            </p>
            <h1 className="mt-3 text-3xl font-bold sm:text-4xl">
              Gestão de Performance de Atendimento
            </h1>
            <p className="mt-3 max-w-3xl text-slate-300">
              Painel interno para acompanhar metas, analistas, lançamentos semanais,
              performance da equipe e próximas análises com IA.
            </p>
            <p className="mt-3 text-sm text-slate-400">
              Perfil: <strong>{getRoleLabel(userRole)}</strong>
              {!isManagementUser && (
                <span>
                  {' '}| Acesso individual:
                  {currentProfileAnalyst && (
                    <> <strong>{currentProfileAnalyst.name}</strong> · Telefone</>
                  )}
                  {currentProfileAnalyst && profileChatAnalyst && <span> | </span>}
                  {profileChatAnalyst && (
                    <> <strong>{profileChatAnalyst.name}</strong> · Chat</>
                  )}
                </span>
              )}
            </p>
            {!isManagementUser && !hasPhoneAnalystAccess && !hasChatAnalystAccess && (
              <p className="mt-2 text-sm text-amber-200">
                Perfil de analista sem vínculo com Telefone ou Chat. Peça à gestão para revisar o usuário.
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 self-start">
            {isManagementUser && (
              <>
                <button
                  className={`relative secondary-button ${scheduleNotifications.some((item) => !item.seen_at) ? 'animate-bounce' : ''}`}
                  type="button"
                  onClick={() => {
                    const unseen = scheduleNotifications.find((item) => !item.seen_at)
                    if (unseen) setSchedulePopup(unseen)
                  }}
                  title="Solicitações de escala"
                >
                  🔔
                  {scheduleNotifications.filter((item) => !item.seen_at).length > 0 && (
                    <span className="ml-2 rounded-full bg-red-500 px-2 py-0.5 text-xs font-bold">
                      {scheduleNotifications.filter((item) => !item.seen_at).length}
                    </span>
                  )}
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={enableScheduleBrowserNotifications}
                >
                  Ativar alertas
                </button>
              </>
            )}
            <button className="secondary-button" onClick={handleLogout}>
              Sair
            </button>
          </div>
        </header>

        <div className={`mt-6 grid gap-3 ${
          isManagementUser ? 'md:grid-cols-3' : 'md:grid-cols-2'
        }`}>
          {(isManagementUser || hasPhoneAnalystAccess) && (
            <button
              className={activeModule === 'phone' ? 'module-card-active' : 'module-card'}
              type="button"
              onClick={() => {
                setActiveModule('phone')
                setActiveTab('dashboard')
              }}
            >
              <span>Módulo telefone</span>
              <strong>
                {isManagementUser ? 'Performance de atendimento' : 'Meu desempenho no telefone'}
              </strong>
              <small>
                {isManagementUser
                  ? 'Dashboard, lançamentos, metas, pódio, SARE e IA preditiva.'
                  : 'Seus indicadores, metas e evolução individual.'}
              </small>
            </button>
          )}
          {(isManagementUser || hasChatAnalystAccess) && (
            <button
              className={activeModule === 'chat' ? 'module-card-active' : 'module-card'}
              type="button"
              onClick={() => setActiveModule('chat')}
            >
              <span>Módulo chat</span>
              <strong>
                {isManagementUser ? 'Performance de atendimento via chat' : 'Meu desempenho no chat'}
              </strong>
              <small>
                {isManagementUser
                  ? 'ClickDesk, visão da operação, gestão, fechamento e histórico.'
                  : 'Seus atendimentos ClickDesk, metas e histórico individual.'}
              </small>
            </button>
          )}
          {isManagementUser && (
            <Link className="module-card" href="/escalas">
              <span>Módulo escalas</span>
              <strong>Escalas e solicitações</strong>
              <small>Homologação: geração mensal, pessoas, sábados, publicação e alertas.</small>
            </Link>
          )}
        </div>
        {activeModule === 'phone' && (
          <nav className="mt-6 flex flex-wrap gap-2">
          <TabButton active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')}>
            Dashboard
          </TabButton>
          {isManagementUser && (
            <TabButton active={activeTab === 'reports'} onClick={() => setActiveTab('reports')}>
              Relatórios
            </TabButton>
          )}
          {isManagementUser && (
            <>
              <TabButton active={activeTab === 'entries'} onClick={() => setActiveTab('entries')}>
                Lançamentos
              </TabButton>
              <TabButton active={activeTab === 'analysts'} onClick={() => setActiveTab('analysts')}>
                Analistas
              </TabButton>
              <TabButton active={activeTab === 'goals'} onClick={() => setActiveTab('goals')}>
                Metas
              </TabButton>
              <TabButton active={activeTab === 'users'} onClick={() => setActiveTab('users')}>
                Usuários
              </TabButton>
              <Link className="tab-button" href="/integracoes">Fechamentos</Link>
            </>
          )}
          </nav>
        )}

        {message && <Feedback message={message} />}

        {activeModule === 'chat' && isManagementUser && (
          <ChatModuleDashboard
            role={userRole}
            teams={chatTeams}
            analysts={chatAnalysts}
            metrics={chatMonthlyMetrics}
            manualPodium={chatPodiumManual}
            podiumExclusions={chatPodiumExclusions}
            loading={loading}
            onImportComplete={loadData}
          />
        )}

        {activeModule === 'chat' && !isManagementUser && (
          <ChatAnalystPortal
            analyst={profileChatAnalyst}
            team={profileChatTeam}
          />
        )}

        {activeModule === 'phone' && activeTab === 'dashboard' && (
          <DashboardView
            analystsCount={visibleActiveAnalysts.length}
            analysts={visibleAnalysts}
            goals={goals}
            individualMetrics={visibleIndividualMetrics}
            teamMetrics={teamMetrics}
            loading={loading}
            role={userRole}
          />
        )}

        {activeModule === 'phone' && isManagementUser && activeTab === 'reports' && (
          <ReportsView
            analysts={visibleAnalysts}
            goals={goals}
            individualMetrics={visibleIndividualMetrics}
            teamMetrics={teamMetrics}
            role={userRole}
          />
        )}

        {activeModule === 'phone' && isManagementUser && activeTab === 'entries' && (
          <EntriesView
            analysts={activeAnalysts}
            selectedAnalyst={selectedAnalyst}
            podiumCsatGoal={podiumCsatGoal}
            individualMetrics={individualMetrics}
            teamMetrics={teamMetrics}
            individualForm={individualForm}
            teamForm={teamForm}
            saving={saving}
            onIndividualChange={setIndividualForm}
            onTeamChange={setTeamForm}
            onIndividualSubmit={handleIndividualSubmit}
            onTeamSubmit={handleTeamSubmit}
            onDeleteIndividualMetric={handleDeleteIndividualMetric}
            onDeleteTeamMetric={handleDeleteTeamMetric}
            onUpdateTeamOverallCsat={handleUpdateTeamOverallCsat}
          />
        )}

        {activeModule === 'phone' && isManagementUser && activeTab === 'analysts' && (
          <AnalystsView
            analysts={analysts}
            analystForm={analystForm}
            editingAnalystId={editingAnalystId}
            saving={saving}
            onAnalystChange={setAnalystForm}
            onAnalystSubmit={handleAnalystSubmit}
            onCancelEdit={handleCancelAnalystEdit}
            onEditAnalyst={handleEditAnalyst}
            onToggleAnalyst={handleToggleAnalyst}
            onDeleteAnalyst={handleDeleteAnalyst}
            onRemoveAnalystPhoto={handleRemoveAnalystPhoto}
          />
        )}

        {activeModule === 'phone' && isManagementUser && activeTab === 'users' && (
          <UsersView
            profiles={profiles}
            analysts={analysts}
            chatAnalysts={chatAnalysts}
            form={accessUserForm}
            editingProfileNameId={editingProfileNameId}
            profileNameForm={profileNameForm}
            saving={saving}
            onChange={setAccessUserForm}
            onProfileNameChange={setProfileNameForm}
            onSubmit={handleCreateAccessUser}
            onEditProfileName={handleEditProfileName}
            onCancelProfileNameEdit={handleCancelProfileNameEdit}
            onSaveProfileName={handleSaveProfileName}
          />
        )}

        {activeModule === 'phone' && isManagementUser && activeTab === 'goals' && (
          <GoalsView
            goals={goals}
            goalForm={goalForm}
            editingGoalId={editingGoalId}
            saving={saving}
            onGoalChange={setGoalForm}
            onGoalSubmit={handleGoalSubmit}
            onEditGoal={handleEditGoal}
            onCancelEdit={handleCancelGoalEdit}
          />
        )}
      </section>
    </main>
  )
}

function ChatPerformanceDiagnosticPanel({
  diagnostic,
}: {
  diagnostic: ChatPerformanceDiagnostic
}) {
  const statusClass =
    diagnostic.status === 'success'
      ? 'border-emerald-400/25 bg-emerald-400/5 text-emerald-100'
      : diagnostic.status === 'attention'
        ? 'border-amber-300/25 bg-amber-300/5 text-amber-100'
        : diagnostic.status === 'priority'
          ? 'border-rose-400/25 bg-rose-400/5 text-rose-100'
          : 'border-cyan-400/20 bg-cyan-400/5 text-cyan-100'

  const goalsText =
    diagnostic.goalsEvaluated === 2
      ? `${diagnostic.goalsMet} de 2 metas atingidas`
      : `${diagnostic.goalsEvaluated} de 2 metas avaliadas`

  return (
    <div className={`mt-5 rounded-xl border p-5 ${statusClass}`}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] opacity-80">
            O que está acontecendo
          </p>
          <h4 className="mt-2 text-xl font-bold">
            {goalsText}
          </h4>
          <p className="mt-2 max-w-4xl text-sm leading-6 opacity-90">
            {diagnostic.summary}
          </p>
        </div>
        <span className="self-start rounded-md border border-current/20 px-3 py-2 text-xs font-semibold">
          Base: metas + avaliações
        </span>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <div className="rounded-lg border border-emerald-400/20 bg-slate-950/35 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-emerald-300">
            Ponto forte
          </p>
          <strong className="mt-2 block text-slate-100">{diagnostic.strength.title}</strong>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            {diagnostic.strength.detail}
          </p>
        </div>

        <div className="rounded-lg border border-amber-300/20 bg-slate-950/35 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-amber-200">
            Ponto de atenção
          </p>
          <strong className="mt-2 block text-slate-100">{diagnostic.attention.title}</strong>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            {diagnostic.attention.detail}
          </p>
        </div>

        <div className="rounded-lg border border-cyan-400/20 bg-slate-950/35 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-300">
            O que olhar agora
          </p>
          <strong className="mt-2 block text-slate-100">{diagnostic.priority.title}</strong>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            {diagnostic.priority.detail}
          </p>
        </div>
      </div>

      <p className="mt-4 border-t border-current/10 pt-3 text-xs leading-5 opacity-70">
        {diagnostic.methodNote}
      </p>
    </div>
  )
}

function QualitativeAnalysisCard({
  result,
  onReanalyze,
  reanalyzing = false,
}: {
  result: ClickDeskQualitativeResponse
  onReanalyze?: () => void
  reanalyzing?: boolean
}) {
  if (result.error) {
    return (
      <div className="mt-3 rounded-lg border border-amber-300/20 bg-amber-300/5 p-3 text-sm text-amber-100">
        {result.error}
      </div>
    )
  }

  if (!result.analysis) return null

  return (
    <div className="mt-3 rounded-xl border border-violet-400/15 bg-violet-400/5 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-violet-200">
            Leitura qualitativa do atendimento
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {result.cached ? 'Análise já preservada' : 'Análise gerada agora'}
            {result.analyzed_at ? ` · ${formatDateTime(result.analyzed_at)}` : ''}
          </p>
          {result.validation_status && (
            <span
              className={`mt-2 inline-flex rounded-md px-2 py-1 text-[11px] font-semibold ${
                result.validation_status === 'approved'
                  ? 'bg-emerald-400/10 text-emerald-200'
                  : result.validation_status === 'rejected'
                    ? 'bg-rose-400/10 text-rose-200'
                    : 'bg-amber-300/10 text-amber-100'
              }`}
            >
              {result.validation_status === 'approved'
                ? 'Validada pela gestão'
                : result.validation_status === 'rejected'
                  ? 'Descartada da consolidação'
                  : 'Aguardando validação da gestão'}
            </span>
          )}
        </div>
        {onReanalyze && (
          <button
            type="button"
            className="text-xs font-semibold text-violet-200 hover:text-violet-100 disabled:opacity-50"
            disabled={reanalyzing}
            onClick={onReanalyze}
          >
            {reanalyzing ? 'Reanalisando...' : 'Reanalisar'}
          </button>
        )}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg bg-slate-950/45 p-3">
          <span className="text-xs text-slate-500">Sentimento</span>
          <strong className="mt-1 block text-sm">
            {formatQualitativeLabel(result.analysis.initial_sentiment)}
            {' → '}
            {formatQualitativeLabel(result.analysis.final_sentiment)}
          </strong>
        </div>
        <div className="rounded-lg bg-slate-950/45 p-3">
          <span className="text-xs text-slate-500">Causa provável</span>
          <strong className="mt-1 block text-sm">
            {formatQualitativeLabel(result.analysis.primary_cause.category)}
          </strong>
          <span className="mt-1 block text-xs text-slate-500">
            confiança {formatQualitativeLabel(result.analysis.primary_cause.confidence)}
          </span>
        </div>
        <div className="rounded-lg bg-slate-950/45 p-3">
          <span className="text-xs text-slate-500">Influência humana</span>
          <strong className="mt-1 block text-sm">
            {formatQualitativeLabel(result.analysis.human_influence.classification)}
          </strong>
          <span className="mt-1 block text-xs text-slate-500">
            confiança {formatQualitativeLabel(result.analysis.human_influence.confidence)}
          </span>
        </div>
        <div className="rounded-lg bg-slate-950/45 p-3">
          <span className="text-xs text-slate-500">Controlabilidade</span>
          <strong className="mt-1 block text-sm">
            {formatQualitativeLabel(result.analysis.controllability.classification)}
          </strong>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
            Por que essa avaliação pode ter acontecido?
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            {result.analysis.primary_cause.summary}
          </p>
          <p className="mt-3 text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
            Influência do atendimento humano
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            {result.analysis.human_influence.summary}
          </p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
            Evidências resumidas
          </p>
          {result.analysis.evidence_summary.length ? (
            <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-6 text-slate-300">
              {result.analysis.evidence_summary.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-slate-500">Sem evidência suficiente para resumir.</p>
          )}
          {result.analysis.limitations.length > 0 && (
            <>
              <p className="mt-3 text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
                Limitações
              </p>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                {result.analysis.limitations.join(' · ')}
              </p>
            </>
          )}
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-white/10 bg-slate-950/30 px-3 py-3 text-sm">
        <span className="text-slate-500">Ponto para feedback: </span>
        <strong className={result.analysis.coaching_signal.available ? 'text-cyan-200' : 'text-slate-300'}>
          {result.analysis.coaching_signal.summary}
        </strong>
      </div>
    </div>
  )
}

function QualitativeSampleTicketList({
  title,
  subtitle,
  tickets,
  tone,
  results,
  loadingTicketId,
  onAnalyze,
}: {
  title: string
  subtitle: string
  tickets: ClickDeskEvaluatedSampleTicket[]
  tone: 'positive' | 'negative'
  results: Record<string, ClickDeskQualitativeResponse>
  loadingTicketId: string
  onAnalyze: (ticketId: string, force?: boolean) => void
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-slate-950/30 p-4">
      <div>
        <h4 className="font-semibold text-slate-100">{title}</h4>
        <p className="mt-1 text-xs leading-5 text-slate-500">{subtitle}</p>
      </div>

      {tickets.length ? (
        <div className="mt-4 space-y-3">
          {tickets.map((ticket) => {
            const result = results[ticket.ticket_id]
            const loading = loadingTicketId === ticket.ticket_id
            return (
              <div key={ticket.ticket_id} className="rounded-lg border border-white/10 bg-slate-950/45 p-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="text-sm text-slate-100">Ticket #{ticket.ticket_id}</strong>
                      <span
                        className={`rounded-md px-2 py-1 text-[11px] font-semibold ${
                          tone === 'negative'
                            ? 'bg-amber-300/10 text-amber-100'
                            : 'bg-emerald-400/10 text-emerald-200'
                        }`}
                      >
                        {tone === 'negative' ? 'Negativa' : 'Positiva'}
                      </span>
                      {ticket.has_analysis && !result && (
                        <span className="rounded-md bg-violet-400/10 px-2 py-1 text-[11px] font-semibold text-violet-200">
                          Análise salva
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {formatDate(ticket.occurred_date)} · {ticket.area}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="small-button self-start sm:self-auto"
                    disabled={loading}
                    onClick={() => onAnalyze(ticket.ticket_id)}
                  >
                    {loading
                      ? 'Analisando...'
                      : ticket.has_analysis
                        ? 'Ver análise'
                        : 'Analisar com IA'}
                  </button>
                </div>

                {result && (
                  <QualitativeAnalysisCard
                    result={result}
                    reanalyzing={loading}
                    onReanalyze={() => onAnalyze(ticket.ticket_id, true)}
                  />
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <p className="mt-4 text-sm text-slate-500">
          Nenhuma avaliação deste tipo disponível na competência.
        </p>
      )}
    </div>
  )
}

function ChatAnalystPortal({
  analyst,
  team,
}: {
  analyst: ChatAnalyst | null
  team: ChatTeam | null
}) {
  const [metrics, setMetrics] = useState<ClickDeskPersistedMetrics | null>(null)
  const [history, setHistory] = useState<ClickDeskAnalystHistory | null>(null)
  const [loading, setLoading] = useState(false)
  const [selectedRoutineDate, setSelectedRoutineDate] = useState<string | null>(null)
  const [dailyTickets, setDailyTickets] = useState<ClickDeskDailyTicketResponse | null>(null)
  const [dailyTicketsLoading, setDailyTicketsLoading] = useState(false)
  const [evaluatedSample, setEvaluatedSample] = useState<ClickDeskEvaluatedSampleResponse | null>(null)
  const [qualitativeByTicket, setQualitativeByTicket] = useState<Record<string, ClickDeskQualitativeResponse>>({})
  const [qualitativeLoadingTicketId, setQualitativeLoadingTicketId] = useState('')
  const [qualitativeSampleLoading, setQualitativeSampleLoading] = useState(false)

  const now = new Date()
  const year = now.getFullYear()
  const monthNumber = now.getMonth() + 1
  const monthKey = `${year}-${String(monthNumber).padStart(2, '0')}`
  const monthStart = `${monthKey}-01`
  const monthEnd = new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10)
  const monthLabel = new Intl.DateTimeFormat('pt-BR', {
    month: 'long',
    year: 'numeric',
  }).format(now)
  const displayMonthLabel =
    monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1)

  useEffect(() => {
    const analystId = analyst?.id

    if (!analystId) {
      setMetrics(null)
      setHistory(null)
      return
    }

    const ownAnalystId: string = analystId
    let cancelled = false

    async function loadOwnChatData() {
      setLoading(true)

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession()

        if (!session?.access_token) {
          if (!cancelled) {
            setMetrics({ erro: 'Sua sessão expirou. Entre novamente.' })
            setHistory({ erro: 'Sua sessão expirou. Entre novamente.' })
          }
          return
        }

        const headers = { Authorization: `Bearer ${session.access_token}` }
        const metricParams = new URLSearchParams({
          start: monthStart,
          end: monthEnd,
          analyst_id: ownAnalystId,
        })
        const historyParams = new URLSearchParams({
          analyst_id: ownAnalystId,
        })
        const sampleParams = new URLSearchParams({
          start: monthStart,
          end: monthEnd,
          analyst_id: ownAnalystId,
        })

        const [metricResponse, historyResponse, sampleResponse] = await Promise.all([
          fetch(`/api/clickdesk/metrics?${metricParams.toString()}`, {
            headers,
            cache: 'no-store',
          }),
          fetch(`/api/clickdesk/history?${historyParams.toString()}`, {
            headers,
            cache: 'no-store',
          }),
          fetch(`/api/clickdesk/evaluated-sample?${sampleParams.toString()}`, {
            headers,
            cache: 'no-store',
          }),
        ])

        const [metricData, historyData, sampleData] = await Promise.all([
          metricResponse.json() as Promise<ClickDeskPersistedMetrics>,
          historyResponse.json() as Promise<ClickDeskAnalystHistory>,
          sampleResponse.json() as Promise<ClickDeskEvaluatedSampleResponse>,
        ])

        if (!metricResponse.ok) {
          metricData.erro =
            metricData.erro || 'Não foi possível carregar seus indicadores do Chat.'
        }
        if (!historyResponse.ok) {
          historyData.erro =
            historyData.erro || 'Não foi possível carregar seu histórico do Chat.'
        }
        if (!sampleResponse.ok) {
          sampleData.erro =
            sampleData.erro || sampleData.error || 'Não foi possível carregar sua amostra de avaliações.'
        }

        if (!cancelled) {
          setMetrics(metricData)
          setHistory(historyData)
          setEvaluatedSample(sampleData)
        }
      } catch (error) {
        if (!cancelled) {
          const message = getErrorMessage(error)
          setMetrics({ erro: message })
          setHistory({ erro: message })
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void loadOwnChatData()

    return () => {
      cancelled = true
    }
  }, [analyst?.id, monthStart, monthEnd])

  async function analyzeQualitativeTicket(ticketId: string, force = false) {
    setQualitativeLoadingTicketId(ticketId)

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session?.access_token) {
        setQualitativeByTicket((current) => ({
          ...current,
          [ticketId]: { error: 'Sua sessão expirou. Entre novamente.' },
        }))
        return
      }

      const response = await fetch('/api/clickdesk/qualitative', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ticket_id: ticketId, force }),
      })
      const data = (await response.json()) as ClickDeskQualitativeResponse

      if (!response.ok && !data.error) {
        data.error = 'Não foi possível analisar qualitativamente este atendimento.'
      }

      setQualitativeByTicket((current) => ({ ...current, [ticketId]: data }))

      if (response.ok) {
        setEvaluatedSample((current) =>
          current
            ? {
                ...current,
                negative: current.negative?.map((item) =>
                  item.ticket_id === ticketId ? { ...item, has_analysis: true } : item,
                ),
                positive: current.positive?.map((item) =>
                  item.ticket_id === ticketId ? { ...item, has_analysis: true } : item,
                ),
              }
            : current,
        )
      }
    } catch (error) {
      setQualitativeByTicket((current) => ({
        ...current,
        [ticketId]: { error: getErrorMessage(error) },
      }))
    } finally {
      setQualitativeLoadingTicketId('')
    }
  }

  async function analyzeQualitativeSample() {
    const tickets = [
      ...(evaluatedSample?.negative ?? []),
      ...(evaluatedSample?.positive ?? []),
    ]

    if (!tickets.length) return

    setQualitativeSampleLoading(true)
    try {
      for (const ticket of tickets) {
        await analyzeQualitativeTicket(ticket.ticket_id)
      }
    } finally {
      setQualitativeSampleLoading(false)
      setQualitativeLoadingTicketId('')
    }
  }

  async function loadDailyTickets(date: string) {
    if (!analyst?.id) return

    setSelectedRoutineDate(date)
    setDailyTicketsLoading(true)

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session?.access_token) {
        setDailyTickets({ erro: 'Sua sessão expirou. Entre novamente.' })
        return
      }

      const params = new URLSearchParams({
        date,
        analyst_id: analyst.id,
      })
      const response = await fetch(`/api/clickdesk/tickets?${params.toString()}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: 'no-store',
      })
      const data = (await response.json()) as ClickDeskDailyTicketResponse

      if (!response.ok) {
        data.erro = data.erro || 'Não foi possível carregar os tickets desse dia.'
      }

      setDailyTickets(data)
    } catch (error) {
      setDailyTickets({ erro: getErrorMessage(error) })
    } finally {
      setDailyTicketsLoading(false)
    }
  }

  if (!analyst) {
    return (
      <div className="mt-8">
        <section className="panel">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-amber-200">
            Acesso individual do Chat
          </p>
          <h2 className="mt-2 text-2xl font-bold">Vínculo não encontrado</h2>
          <p className="section-subtitle">
            Seu usuário está marcado para o Chat, mas o cadastro individual não pôde ser carregado. Peça à gestão para revisar o vínculo do acesso.
          </p>
        </section>
      </div>
    )
  }

  const ownMetric =
    metrics?.by_analyst?.find((item) => item.analyst_id === analyst.id) ??
    metrics?.by_analyst?.[0] ??
    null
  const accumulated = ownMetric ?? metrics?.performance_accumulated ?? null
  const today = ownMetric?.today ?? metrics?.today ?? null
  const daily = ownMetric?.daily ?? metrics?.performance_daily ?? []
  const csat = accumulated?.csat ?? null
  const reviewPercentage = accumulated?.review_percentage ?? null
  const csatGoal = Number(analyst.csat_goal)
  const reviewGoal = 25
  const diagnostic = buildChatPerformanceDiagnostic({
    csat,
    csatGoal,
    reviewPercentage,
    reviewGoal,
    positiveReviews: accumulated?.positive_reviews ?? 0,
    negativeReviews: accumulated?.negative_reviews ?? 0,
    attendances: accumulated?.attendances ?? 0,
  })
  const meetsCsat = diagnostic.csatMet === true
  const meetsReviews = diagnostic.reviewMet === true
  const status = diagnostic.statusLabel
  const podiumContext = metrics?.self_podium_context ?? null
  const podiumCriteria = podiumContext?.criteria ?? null
  const isOnPodium =
    podiumContext?.eligible === true &&
    podiumContext.position !== null &&
    podiumContext.position <= 3
  const historyPoints = history?.points ?? []
  const todayKey = new Date().toISOString().slice(0, 10)
  const visibleDayCount =
    now.getFullYear() === year && now.getMonth() + 1 === monthNumber
      ? now.getDate()
      : Number(monthEnd.slice(-2))
  const ruler = Array.from({ length: visibleDayCount }, (_, index) => {
    const day = String(index + 1).padStart(2, '0')
    const date = `${monthKey}-${day}`
    const source = daily.find((item) => item.date === date)
    return {
      date,
      day,
      attendances: source?.attendances ?? 0,
      reviews: source?.reviews ?? 0,
      csat: source?.csat ?? null,
    }
  })
  const activeRoutineDays = ruler.filter((item) => item.attendances > 0)

  return (
    <div className="mt-8 space-y-6">
      <section className="panel">
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-cyan-300">
          Chat · acesso individual
        </p>
        <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="flex items-center gap-4">
              <AnalystAvatar
                name={analyst.name}
                photoUrl={analyst.photo_url ?? null}
                size="lg"
              />
              <div>
                <p className="text-sm text-slate-400">{team?.name ?? 'Equipe do Chat'}</p>
                <h2 className="text-3xl font-bold">{analyst.name}</h2>
                <p className="mt-1 text-sm text-slate-400">
                  {displayMonthLabel} · ClickDesk
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {metrics?.latest_sync?.finished_at
                    ? `Última atualização: ${formatDateTime(metrics.latest_sync.finished_at)}`
                    : 'Última atualização ainda não informada'}
                </p>
              </div>
            </div>

            {podiumContext && podiumCriteria && (
              <div
                className={`rounded-xl border px-4 py-3 sm:min-w-60 ${
                  podiumContext.eligible
                    ? 'border-emerald-400/20 bg-emerald-400/5'
                    : 'border-amber-300/20 bg-amber-300/5'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p
                      className={`text-xs font-semibold uppercase tracking-[0.12em] ${
                        podiumContext.eligible ? 'text-emerald-300' : 'text-amber-200'
                      }`}
                    >
                      {isOnPodium ? 'Pódio do período' : 'Posição no ranking'}
                    </p>
                    <strong className="mt-2 block text-2xl text-slate-100">
                      {podiumContext.position
                        ? `${podiumContext.position}º de ${podiumContext.total_ranked}`
                        : '—'}
                    </strong>
                    <span
                      className={`mt-1 block text-xs font-semibold ${
                        podiumContext.eligible ? 'text-emerald-300' : 'text-amber-200'
                      }`}
                    >
                      {podiumContext.eligible ? 'Elegível ao pódio' : 'Não elegível ao pódio'}
                    </span>
                    <span className="mt-1 block text-xs text-slate-400">
                      {podiumCriteria.completed} de 3 critérios cumpridos
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="block text-xs text-slate-500">Média do time</span>
                    <strong className="text-sm text-slate-200">
                      {formatChatCount(podiumContext.team_average_attendances)}
                    </strong>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-cyan-400/20 bg-cyan-400/5 px-4 py-3 text-sm">
            <p className="text-slate-400">Situação atual</p>
            <strong className="mt-1 block text-cyan-100">{status}</strong>
            <span className="mt-1 block text-xs text-slate-400">
              Entenda a leitura logo abaixo
            </span>
          </div>
        </div>

        {loading && (
          <p className="mt-5 rounded-lg bg-slate-900 p-4 text-sm text-slate-300">
            Carregando seus indicadores...
          </p>
        )}
        {metrics?.erro && (
          <p className="mt-5 rounded-lg border border-amber-300/20 bg-amber-300/5 p-4 text-sm text-amber-100">
            {metrics.erro}
          </p>
        )}

        {!loading && !metrics?.erro && (
          <>
            <div className="mt-6">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                Resumo da competência
              </p>
              <div className="mt-3 grid gap-4 lg:grid-cols-3">
                <div className="rounded-xl border border-white/10 bg-slate-950/40 p-5">
                  <p className="text-sm text-slate-400">Atendimentos</p>
                  <strong className="mt-2 block text-3xl tabular-nums text-slate-100">
                    {formatChatCount(accumulated?.attendances ?? 0)}
                  </strong>
                  <div className="mt-4 flex items-center justify-between gap-4 border-t border-white/10 pt-3 text-sm">
                    <span className="text-slate-500">Hoje na base</span>
                    <strong className="tabular-nums text-slate-200">
                      {formatChatCount(today?.attendances ?? 0)}
                    </strong>
                  </div>
                </div>

                <div className={`rounded-xl border p-5 ${
                  csat === null
                    ? 'border-white/10 bg-slate-950/40'
                    : meetsCsat
                      ? 'border-emerald-400/20 bg-emerald-400/5'
                      : 'border-amber-300/20 bg-amber-300/5'
                }`}>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm text-slate-400">CSAT</p>
                      <strong className="mt-2 block text-3xl tabular-nums text-slate-100">
                        {csat === null ? '—' : formatChatPercent(csat)}
                      </strong>
                    </div>
                    <span className="rounded-md border border-white/10 px-2 py-1 text-xs text-slate-300">
                      Meta {formatChatPercent(csatGoal)}
                    </span>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-400">
                    {csat === null
                      ? 'Ainda sem avaliações suficientes para calcular o indicador.'
                      : diagnostic.csatDelta !== null && diagnostic.csatDelta >= 0
                        ? `${formatDelta(diagnostic.csatDelta, ' p.p.')} acima da meta.`
                        : `${formatDelta(Math.abs(diagnostic.csatDelta ?? 0), ' p.p.').replace('+', '')} abaixo da meta.`}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-4 border-t border-white/10 pt-3 text-sm">
                    <a className="text-slate-500 hover:text-emerald-200" href="#minhas-avaliacoes">
                      Positivas <strong className="text-slate-200">{formatChatCount(accumulated?.positive_reviews ?? 0)}</strong>
                      <span className="ml-1 text-xs">ver tickets</span>
                    </a>
                    <a className="text-slate-500 hover:text-amber-100" href="#minhas-avaliacoes">
                      Negativas <strong className="text-slate-200">{formatChatCount(accumulated?.negative_reviews ?? 0)}</strong>
                      <span className="ml-1 text-xs">entender</span>
                    </a>
                  </div>
                </div>

                <div className={`rounded-xl border p-5 ${
                  reviewPercentage === null
                    ? 'border-white/10 bg-slate-950/40'
                    : meetsReviews
                      ? 'border-emerald-400/20 bg-emerald-400/5'
                      : 'border-amber-300/20 bg-amber-300/5'
                }`}>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm text-slate-400">% de avaliações</p>
                      <strong className="mt-2 block text-3xl tabular-nums text-slate-100">
                        {reviewPercentage === null ? '—' : formatChatPercent(reviewPercentage)}
                      </strong>
                    </div>
                    <span className="rounded-md border border-white/10 px-2 py-1 text-xs text-slate-300">
                      Meta {formatChatPercent(reviewGoal)}
                    </span>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-400">
                    {reviewPercentage === null
                      ? 'Ainda sem base para calcular participação nas avaliações.'
                      : diagnostic.reviewDelta !== null && diagnostic.reviewDelta >= 0
                        ? `${formatDelta(diagnostic.reviewDelta, ' p.p.')} acima da meta.`
                        : `${formatDelta(Math.abs(diagnostic.reviewDelta ?? 0), ' p.p.').replace('+', '')} abaixo da meta.`}
                  </p>
                  <div className="mt-4 flex items-center justify-between gap-4 border-t border-white/10 pt-3 text-sm">
                    <span className="text-slate-500">Avaliações recebidas</span>
                    <strong className="tabular-nums text-slate-200">
                      {formatChatCount(accumulated?.reviews ?? 0)}
                    </strong>
                  </div>
                </div>
              </div>
            </div>

            <ChatPerformanceDiagnosticPanel diagnostic={diagnostic} />

            {podiumContext && podiumCriteria && (
              <div className="mt-5 rounded-xl border border-cyan-400/15 bg-slate-950/35 p-4">
                <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-300">
                      Caminho para o pódio
                    </p>
                    <h4 className="mt-1 text-lg font-bold text-slate-100">
                      {podiumCriteria.completed} de 3 critérios cumpridos
                    </h4>
                  </div>
                  <p className="text-xs text-slate-500">
                    Média do time: {formatChatCount(podiumContext.team_average_attendances)} atendimentos
                  </p>
                </div>

                <div className="mt-4 grid gap-2 md:grid-cols-3">
                  <div className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-3 ${
                    podiumCriteria.csat_met
                      ? 'border-emerald-400/25 bg-emerald-400/5'
                      : 'border-amber-300/25 bg-amber-300/5'
                  }`}>
                    <div>
                      <p className="text-xs text-slate-500">CSAT</p>
                      <strong className="text-slate-100">
                        {csat === null ? '—' : formatChatPercent(csat)}
                      </strong>
                    </div>
                    <span className="text-xs text-slate-400">
                      meta {formatChatPercent(podiumCriteria.csat_min)}
                    </span>
                  </div>

                  <div className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-3 ${
                    podiumCriteria.review_met
                      ? 'border-emerald-400/25 bg-emerald-400/5'
                      : 'border-amber-300/25 bg-amber-300/5'
                  }`}>
                    <div>
                      <p className="text-xs text-slate-500">Avaliações</p>
                      <strong className="text-slate-100">
                        {reviewPercentage === null ? '—' : formatChatPercent(reviewPercentage)}
                      </strong>
                    </div>
                    <span className="text-xs text-slate-400">
                      meta {formatChatPercent(podiumCriteria.review_min)}
                    </span>
                  </div>

                  <div className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-3 ${
                    podiumCriteria.volume_met
                      ? 'border-emerald-400/25 bg-emerald-400/5'
                      : 'border-amber-300/25 bg-amber-300/5'
                  }`}>
                    <div>
                      <p className="text-xs text-slate-500">Volume</p>
                      <strong className="text-slate-100">
                        {formatChatCount(accumulated?.attendances ?? 0)}
                      </strong>
                    </div>
                    <span className="text-xs text-slate-400">
                      média {formatChatCount(podiumCriteria.volume_min)}
                    </span>
                  </div>
                </div>

                <p className="mt-3 text-xs leading-5 text-slate-500">
                  A posição no ranking aparece junto do seu perfil. O pódio só é reconhecido quando os três critérios são cumpridos.
                </p>
              </div>
            )}

            <div id="minhas-avaliacoes" className="mt-5 scroll-mt-24 rounded-xl border border-violet-400/15 bg-violet-400/5 p-5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-violet-200">
                    Entenda suas avaliações · IA qualitativa
                  </p>
                  <strong className="mt-2 block text-xl text-slate-100">
                    O número mostra o resultado. Agora você pode investigar o porquê.
                  </strong>
                  <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-400">
                    O painel separa uma amostra distribuída ao longo da competência: até 3 avaliações negativas para investigar pontos de atenção e até 5 positivas para identificar o que funcionou. A análise usa o transcript do ClickDesk e não trata hipótese como fato.
                  </p>
                </div>
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2 text-center">
                    <div className="rounded-lg bg-slate-950/40 px-3 py-2">
                      <span className="block text-xs text-slate-500">Negativas no mês</span>
                      <strong className="mt-1 block text-lg text-amber-100">
                        {formatChatCount(evaluatedSample?.totals?.negative ?? accumulated?.negative_reviews ?? 0)}
                      </strong>
                    </div>
                    <div className="rounded-lg bg-slate-950/40 px-3 py-2">
                      <span className="block text-xs text-slate-500">Positivas no mês</span>
                      <strong className="mt-1 block text-lg text-emerald-200">
                        {formatChatCount(evaluatedSample?.totals?.positive ?? accumulated?.positive_reviews ?? 0)}
                      </strong>
                    </div>
                  </div>
                  {QUALITATIVE_ANALYSIS_ENABLED_FOR_ANALYSTS ? (
                    <button
                      type="button"
                      className="btn-primary w-full"
                      disabled={
                        qualitativeSampleLoading ||
                        ((evaluatedSample?.negative?.length ?? 0) + (evaluatedSample?.positive?.length ?? 0) === 0)
                      }
                      onClick={() => void analyzeQualitativeSample()}
                    >
                      {qualitativeSampleLoading ? 'Analisando amostra...' : 'Analisar amostra do mês'}
                    </button>
                  ) : (
                    <span className="block rounded-md border border-violet-300/20 bg-violet-300/5 px-3 py-2 text-center text-xs font-semibold text-violet-100">
                      IA qualitativa · em preparação
                    </span>
                  )}
                </div>
              </div>

              {!QUALITATIVE_ANALYSIS_ENABLED_FOR_ANALYSTS ? (
                <div className="mt-5 rounded-xl border border-violet-300/15 bg-slate-950/35 p-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <strong className="text-slate-100">Análise qualitativa em preparação</strong>
                      <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-400">
                        A amostra de avaliações já está identificada, mas a leitura do transcript por IA permanece temporariamente desativada no acesso individual até concluir a validação técnica e gerencial.
                      </p>
                    </div>
                    <span className="self-start rounded-md bg-violet-400/10 px-2 py-1 text-[11px] font-semibold text-violet-200">
                      Estrutura preservada
                    </span>
                  </div>
                </div>
              ) : evaluatedSample?.erro ? (
                <p className="mt-4 rounded-lg border border-amber-300/20 bg-amber-300/5 p-3 text-sm text-amber-100">
                  {evaluatedSample.erro}
                </p>
              ) : (
                <div className="mt-5 grid gap-4 xl:grid-cols-2">
                  <QualitativeSampleTicketList
                    title="Negativas para entender"
                    subtitle="Até 3 tickets distribuídos ao longo do mês. Se houver menos, o painel mostra todos."
                    tickets={evaluatedSample?.negative ?? []}
                    tone="negative"
                    results={qualitativeByTicket}
                    loadingTicketId={qualitativeLoadingTicketId}
                    onAnalyze={(ticketId, force) => void analyzeQualitativeTicket(ticketId, force)}
                  />
                  <QualitativeSampleTicketList
                    title="Positivas para aprender"
                    subtitle="Até 5 tickets distribuídos ao longo do mês para reconhecer padrões que vale repetir."
                    tickets={evaluatedSample?.positive ?? []}
                    tone="positive"
                    results={qualitativeByTicket}
                    loadingTicketId={qualitativeLoadingTicketId}
                    onAnalyze={(ticketId, force) => void analyzeQualitativeTicket(ticketId, force)}
                  />
                </div>
              )}

              <p className="mt-4 text-xs leading-5 text-slate-500">
                {QUALITATIVE_ANALYSIS_ENABLED_FOR_ANALYSTS
                  ? 'A amostra é apenas um atalho. Na rotina diária, qualquer ticket avaliado também pode ser analisado individualmente.'
                  : 'Enquanto a IA qualitativa não é liberada, os números e avaliações continuam disponíveis para acompanhamento objetivo.'}
              </p>
            </div>
          </>
        )}
      </section>

      <section className="panel">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-cyan-300">
              Minha rotina
            </p>
            <h3 className="mt-2 text-2xl font-bold">Dias com atendimento</h3>
            <p className="section-subtitle">
              A visão foi compactada. Clique em um dia para ver os seus tickets persistidos no ClickDesk.
            </p>
          </div>
          <span className="self-start rounded-md border border-white/10 bg-slate-950/40 px-3 py-2 text-xs text-slate-400">
            {activeRoutineDays.length} {activeRoutineDays.length === 1 ? 'dia com atividade' : 'dias com atividade'}
          </span>
        </div>

        {activeRoutineDays.length ? (
          <div className="mt-5 flex flex-wrap gap-2">
            {activeRoutineDays.map((item) => {
              const selected = selectedRoutineDate === item.date
              return (
                <button
                  key={item.date}
                  type="button"
                  onClick={() => void loadDailyTickets(item.date)}
                  className={`rounded-lg border px-4 py-3 text-left transition ${
                    selected
                      ? 'border-cyan-300/50 bg-cyan-300/10'
                      : 'border-white/10 bg-slate-950/45 hover:border-white/25'
                  }`}
                >
                  <span className="block text-xs text-slate-500">
                    {formatDate(item.date)}
                  </span>
                  <strong className="mt-1 block text-lg tabular-nums text-slate-100">
                    {formatChatCount(item.attendances)} atend.
                  </strong>
                  <span className="mt-1 block text-xs text-slate-500">
                    {formatChatCount(item.reviews)} {item.reviews === 1 ? 'avaliação' : 'avaliações'}
                  </span>
                </button>
              )
            })}
          </div>
        ) : (
          <EmptyState text="Ainda não há dias com atendimentos persistidos nesta competência." />
        )}

        {selectedRoutineDate && (
          <div className="mt-5 rounded-xl border border-white/10 bg-slate-950/35 p-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-300">
                  Tickets do dia
                </p>
                <h4 className="mt-1 text-lg font-bold">{formatDate(selectedRoutineDate)}</h4>
              </div>
              <button
                type="button"
                className="text-sm text-slate-400 hover:text-slate-200"
                onClick={() => {
                  setSelectedRoutineDate(null)
                  setDailyTickets(null)
                }}
              >
                Fechar detalhe
              </button>
            </div>

            {dailyTicketsLoading ? (
              <p className="mt-4 text-sm text-slate-400">Carregando seus tickets...</p>
            ) : dailyTickets?.erro ? (
              <p className="mt-4 rounded-lg border border-amber-300/20 bg-amber-300/5 p-3 text-sm text-amber-100">
                {dailyTickets.erro}
              </p>
            ) : dailyTickets?.tickets?.length ? (
              <div className="mt-4 space-y-2">
                {dailyTickets.tickets.map((ticket) => {
                  const time = new Intl.DateTimeFormat('pt-BR', {
                    hour: '2-digit',
                    minute: '2-digit',
                    timeZone: 'America/Sao_Paulo',
                  }).format(new Date(ticket.occurred_at))
                  const satisfaction =
                    ticket.satisfaction_label === 'positive'
                      ? 'Positiva'
                      : ticket.satisfaction_label === 'negative'
                        ? 'Negativa'
                        : 'Sem avaliação'

                  const qualitativeResult = qualitativeByTicket[ticket.ticket_id]
                  const qualitativeLoading = qualitativeLoadingTicketId === ticket.ticket_id
                  const evaluated = ticket.satisfaction_label === 'positive' || ticket.satisfaction_label === 'negative'

                  return (
                    <div
                      key={ticket.ticket_id}
                      className="rounded-lg border border-white/10 bg-slate-950/50 px-4 py-3"
                    >
                      <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto] sm:items-center">
                        <div>
                          <strong className="text-slate-100">Ticket #{ticket.ticket_id}</strong>
                          <p className="mt-1 text-xs text-slate-500">{ticket.area}</p>
                        </div>
                        <span className="text-sm tabular-nums text-slate-400">{time}</span>
                        <span className={`rounded-md px-2 py-1 text-xs font-semibold ${
                          satisfaction === 'Positiva'
                            ? 'bg-emerald-400/10 text-emerald-200'
                            : satisfaction === 'Negativa'
                              ? 'bg-amber-300/10 text-amber-100'
                              : 'bg-white/5 text-slate-400'
                        }`}>
                          {satisfaction}
                        </span>
                        {evaluated ? (
                          QUALITATIVE_ANALYSIS_ENABLED_FOR_ANALYSTS ? (
                            <button
                              type="button"
                              className="small-button"
                              disabled={qualitativeLoading}
                              onClick={() => void analyzeQualitativeTicket(ticket.ticket_id)}
                            >
                              {qualitativeLoading
                                ? 'Analisando...'
                                : qualitativeResult?.analysis
                                  ? 'Ver análise'
                                  : 'Analisar com IA'}
                            </button>
                          ) : (
                            <span className="text-xs font-semibold text-violet-200">IA em preparação</span>
                          )
                        ) : (
                          <span className="text-xs text-slate-600">Sem análise</span>
                        )}
                      </div>

                      {QUALITATIVE_ANALYSIS_ENABLED_FOR_ANALYSTS && qualitativeResult && (
                        <QualitativeAnalysisCard
                          result={qualitativeResult}
                          reanalyzing={qualitativeLoading}
                          onReanalyze={() => void analyzeQualitativeTicket(ticket.ticket_id, true)}
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="mt-4 text-sm text-slate-400">
                Nenhum ticket persistido foi encontrado para este dia.
              </p>
            )}
          </div>
        )}
      </section>

      <section className="panel">
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-cyan-300">
          Minha evolução
        </p>
        <h3 className="mt-2 text-2xl font-bold">Histórico ClickDesk</h3>
        <p className="section-subtitle">
          Meses fechados usam o snapshot oficial. O mês atual permanece vivo até o fechamento.
        </p>

        {history?.erro ? (
          <p className="mt-5 rounded-lg border border-amber-300/20 bg-amber-300/5 p-4 text-sm text-amber-100">
            {history.erro}
          </p>
        ) : historyPoints.length ? (
          <div className="mt-5 space-y-5">
            <div className="grid gap-4 lg:grid-cols-3">
              <TrendLineChart
                label="CSAT mensal"
                points={historyPoints.map((item) => ({
                  label: item.label.replace(' de ', '/'),
                  value: item.csat ?? 0,
                }))}
                suffix="%"
                singlePointLabel="Apenas uma competência disponível no histórico."
                latestPointLabel="Última competência"
                highlightedPointLabel="Competência destacada"
              />
              <TrendLineChart
                label="% de avaliações mensal"
                points={historyPoints.map((item) => ({
                  label: item.label.replace(' de ', '/'),
                  value: item.review_percentage ?? 0,
                }))}
                suffix="%"
                goal={25}
                goalLabel="Meta"
                singlePointLabel="Apenas uma competência disponível no histórico."
                latestPointLabel="Última competência"
                highlightedPointLabel="Competência destacada"
              />
              <TrendLineChart
                label="Atendimentos mensais"
                points={historyPoints.map((item) => ({
                  label: item.label.replace(' de ', '/'),
                  value: item.attendances,
                }))}
                singlePointLabel="Apenas uma competência disponível no histórico."
                latestPointLabel="Última competência"
                highlightedPointLabel="Competência destacada"
              />
            </div>

            <div className="space-y-3">
              {[...historyPoints].reverse().map((item) => (
                <div
                  key={item.month}
                  className="rounded-lg border border-white/10 bg-slate-950/35 p-4"
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <strong>{item.label}</strong>
                        <span
                          className={`rounded-md border px-2 py-1 text-[11px] font-semibold ${
                            item.source === 'official'
                              ? 'border-emerald-400/20 bg-emerald-400/5 text-emerald-200'
                              : 'border-cyan-400/20 bg-cyan-400/5 text-cyan-200'
                          }`}
                        >
                          {item.source === 'official' ? 'Oficial' : 'Em andamento'}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        {item.source === 'official'
                          ? 'Resultado mensal preservado'
                          : 'Base viva persistida do ClickDesk'}
                      </p>
                    </div>
                    <div className="grid grid-cols-3 gap-4 text-right">
                      <div>
                        <p className="text-xs text-slate-500">CSAT</p>
                        <strong>
                          {item.csat === null ? '—' : formatChatPercent(item.csat)}
                        </strong>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">Avaliações</p>
                        <strong>
                          {item.review_percentage === null
                            ? '—'
                            : formatChatPercent(item.review_percentage)}
                        </strong>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">Atendimentos</p>
                        <strong>{formatChatCount(item.attendances)}</strong>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <EmptyState text="Seu histórico ClickDesk será formado a partir das competências disponíveis." />
        )}
      </section>
    </div>
  )
}

function ChatModuleDashboard({
  role,
  teams,
  analysts,
  metrics,
  manualPodium,
  podiumExclusions,
  loading,
  onImportComplete,
}: {
  role: UserRole
  teams: ChatTeam[]
  analysts: ChatAnalyst[]
  metrics: ChatMonthlyMetric[]
  manualPodium: ChatPodiumManual[]
  podiumExclusions: ChatPodiumExclusion[]
  loading: boolean
  onImportComplete: () => Promise<void>
}) {
  const isManagementUser = role !== 'analyst'
  const periods = useMemo(() => {
    const map = new Map<string, { label: string; year: number; monthNumber: number; start: string }>()
    metrics.forEach((metric) => {
      const key = `${metric.year}-${metric.month_number}`
      if (!map.has(key)) {
        map.set(key, {
          label: metric.month_label,
          year: metric.year,
          monthNumber: metric.month_number,
          start: metric.period_start,
        })
      }
    })
    return [...map.values()].sort((a, b) => b.start.localeCompare(a.start))
  }, [metrics])
  const [selectedTeamId, setSelectedTeamId] = useState('all')
  const [selectedPeriodKey, setSelectedPeriodKey] = useState('')
  const [chatImportYear, setChatImportYear] = useState(String(new Date().getFullYear()))
  const [chatImportMonth, setChatImportMonth] = useState(String(new Date().getMonth() + 1))
  const [chatSatisfactionFile, setChatSatisfactionFile] = useState<File | null>(null)
  const [chatInactiveFile, setChatInactiveFile] = useState<File | null>(null)
  const [chatFileInputResetKey, setChatFileInputResetKey] = useState(0)
  const [chatImportSaving, setChatImportSaving] = useState(false)
  const [chatMonthDeleting, setChatMonthDeleting] = useState(false)
  const [chatImportMessage, setChatImportMessage] = useState('')
  const [chatImportHistory, setChatImportHistory] = useState<ChatImportHistory[]>([])
  const [chatImportHistoryLoading, setChatImportHistoryLoading] = useState(false)
  const [expandedChatImportId, setExpandedChatImportId] = useState('')
  const [chatExportMessage, setChatExportMessage] = useState('')
  const [chatFeedbackStyle, setChatFeedbackStyle] = useState<ChatFeedbackStyle>('coach')
  const [chatFeedbackGoal, setChatFeedbackGoal] = useState<FeedbackGoal>('recognition')
  const [chatManagerNotes, setChatManagerNotes] = useState('')
  const [chatFeedbackDraft, setChatFeedbackDraft] = useState('')
  const [chatAiSaving, setChatAiSaving] = useState(false)
  const [chatReportQualitativePreparing, setChatReportQualitativePreparing] = useState(false)
  const [chatReportQualitativeStatus, setChatReportQualitativeStatus] = useState('')
  const [selectedChatReportMetricId, setSelectedChatReportMetricId] = useState('')
  const [chatActiveTab, setChatActiveTab] = useState<'overview' | 'prototype' | 'podium' | 'analysis' | 'reports' | 'import' | 'settings'>('overview')
  const [chatToolsOpen, setChatToolsOpen] = useState(false)
  const [chat2AnalystId, setChat2AnalystId] = useState('')
  const [chat2LiveAnalystKey, setChat2LiveAnalystKey] = useState('')
  const [chat2PeriodKey, setChat2PeriodKey] = useState('')
  const [chat2DailyDateFilter, setChat2DailyDateFilter] = useState('all')
  const [clickDeskTestLoading, setClickDeskTestLoading] = useState(false)
  const [clickDeskTestResult, setClickDeskTestResult] = useState<ClickDeskTestResult | null>(null)
  const [clickDeskConversationLoading, setClickDeskConversationLoading] = useState(false)
  const [clickDeskConversationDiagnostic, setClickDeskConversationDiagnostic] = useState<ClickDeskConversationDiagnostic | null>(null)
  const [clickDeskPersistedMetrics, setClickDeskPersistedMetrics] = useState<ClickDeskPersistedMetrics | null>(null)
  const [clickDeskPreviousMetrics, setClickDeskPreviousMetrics] = useState<ClickDeskPersistedMetrics | null>(null)
  const [clickDeskSyncResult, setClickDeskSyncResult] = useState<ClickDeskSyncResult | null>(null)
  const [clickDeskAnalystHistory, setClickDeskAnalystHistory] = useState<ClickDeskAnalystHistory | null>(null)
  const [clickDeskHistoryLoading, setClickDeskHistoryLoading] = useState(false)
  const [clickDeskClosureLoading, setClickDeskClosureLoading] = useState(false)
  const [clickDeskClosurePreview, setClickDeskClosurePreview] = useState<ClickDeskClosurePreview | null>(null)
  const [clickDeskOfficialClosure, setClickDeskOfficialClosure] = useState<ClickDeskClosurePreview | null>(null)
  const [clickDeskClosureMessage, setClickDeskClosureMessage] = useState('')
  const [clickDeskAiRoutingLoading, setClickDeskAiRoutingLoading] = useState(false)
  const [clickDeskAiRoutingDiagnostic, setClickDeskAiRoutingDiagnostic] = useState<ClickDeskAiRoutingDiagnostic | null>(null)
  const [clickDeskQualitativeTicketId, setClickDeskQualitativeTicketId] = useState('')
  const [clickDeskQualitativeLoading, setClickDeskQualitativeLoading] = useState(false)
  const [clickDeskQualitativeResult, setClickDeskQualitativeResult] = useState<ClickDeskQualitativeResponse | null>(null)
  const [clickDeskQualitativeSummary, setClickDeskQualitativeSummary] = useState<ClickDeskQualitativeSummary | null>(null)
  const [clickDeskQualitativeSummaryLoading, setClickDeskQualitativeSummaryLoading] = useState(false)
  const [clickDeskQualitativeSummaryRefresh, setClickDeskQualitativeSummaryRefresh] = useState(0)
  const [clickDeskQualitativeValidationTicketId, setClickDeskQualitativeValidationTicketId] = useState('')
  const [manualPodiumDraft, setManualPodiumDraft] = useState<Record<number, string>>({})
  const [chatPodiumMessage, setChatPodiumMessage] = useState('')
  const [chatAnalystForm, setChatAnalystForm] = useState({ teamId: '', name: '', csatGoal: '86', photoFile: null as File | null })
  const [editingChatAnalystId, setEditingChatAnalystId] = useState<string | null>(null)
  const [chatAnalystSaving, setChatAnalystSaving] = useState(false)
  const [chatAnalystMessage, setChatAnalystMessage] = useState('')
  const [chatAnalystPhotoOverrides, setChatAnalystPhotoOverrides] = useState<Record<string, string | null>>({})
  const chatAnalystIdsWithHistory = useMemo(
    () => new Set(metrics.map((metric) => metric.analyst_id)),
    [metrics],
  )

  useEffect(() => {
    setChat2DailyDateFilter('all')
  }, [chat2LiveAnalystKey, chat2PeriodKey])

  useEffect(() => {
    setClickDeskPersistedMetrics(null)
    setClickDeskPreviousMetrics(null)
    setClickDeskClosurePreview(null)
    setClickDeskOfficialClosure(null)
    setClickDeskClosureMessage('')
  }, [selectedTeamId, chat2PeriodKey])

  useEffect(() => {
    if (!isManagementUser || chatActiveTab !== 'reports' || !chat2PeriodKey) return

    let cancelled = false

    async function loadOfficialReportSnapshot() {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession()

        if (!session?.access_token) return

        const [yearText, monthText] = chat2PeriodKey.split('-')
        const year = Number(yearText)
        const monthNumber = Number(monthText)
        if (!Number.isInteger(year) || !Number.isInteger(monthNumber)) return

        const params = new URLSearchParams({
          mes: `${year}-${String(monthNumber).padStart(2, '0')}`,
          canal: 'chat',
          equipe: selectedTeamId,
          fonte: 'oficial',
        })
        const response = await fetch(`/api/clickdesk/closures?${params.toString()}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
          cache: 'no-store',
        })

        if (cancelled) return

        if (response.ok) {
          const data = (await response.json()) as ClickDeskClosurePreview
          setClickDeskOfficialClosure(data)
        } else {
          setClickDeskOfficialClosure(null)
        }
      } catch {
        if (!cancelled) setClickDeskOfficialClosure(null)
      }
    }

    void loadOfficialReportSnapshot()

    return () => {
      cancelled = true
    }
  }, [isManagementUser, chatActiveTab, chat2PeriodKey, selectedTeamId])

  async function loadChatImportHistory() {
    if (!isManagementUser) return

    setChatImportHistoryLoading(true)
    const { data, error } = await supabase
      .from('chat_import_history')
      .select('id, year, month_number, month_label, satisfaction_file_name, satisfaction_file_size, satisfaction_rows, inactivity_file_name, inactivity_file_size, inactivity_rows, analysts_processed, status, created_by_name, created_at')
      .order('created_at', { ascending: false })
      .limit(12)

    if (!error) setChatImportHistory((data ?? []) as ChatImportHistory[])
    setChatImportHistoryLoading(false)
  }

  useEffect(() => {
    if (!isManagementUser) return
    void loadChatImportHistory()
  }, [isManagementUser])

  async function handleTestClickDeskConnection() {
    setClickDeskTestLoading(true)
    setClickDeskTestResult(null)

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session?.access_token) {
        setClickDeskTestResult({ configured: false, error: 'Sua sessão de homologação não está ativa.' })
        return
      }

      const response = await fetch('/api/clickdesk/test', {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        cache: 'no-store',
      })
      const data = (await response.json()) as ClickDeskTestResult

      if (!response.ok && !data.error) {
        data.error = 'Não foi possível testar a conexão com o ClickDesk.'
      }

      setClickDeskTestResult(data)
    } catch (error) {
      setClickDeskTestResult({
        configured: false,
        error: getErrorMessage(error),
      })
    } finally {
      setClickDeskTestLoading(false)
    }
  }

  async function loadClickDeskAnalystHistory(analystId: string) {
    if (!analystId) {
      setClickDeskAnalystHistory(null)
      return
    }

    setClickDeskHistoryLoading(true)
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session?.access_token) {
        setClickDeskAnalystHistory({ erro: 'Sua sessão de homologação não está ativa.' })
        return
      }

      const params = new URLSearchParams({ analyst_id: analystId })
      const response = await fetch(`/api/clickdesk/history?${params.toString()}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: 'no-store',
      })
      const data = (await response.json()) as ClickDeskAnalystHistory

      if (!response.ok) {
        data.erro = data.erro || 'Não foi possível carregar o histórico ClickDesk.'
      }

      setClickDeskAnalystHistory(data)
    } catch (error) {
      setClickDeskAnalystHistory({ erro: getErrorMessage(error) })
    } finally {
      setClickDeskHistoryLoading(false)
    }
  }

  async function loadClickDeskPersistedMetricsOnly(
    period: { start: string; end: string },
    teamId: string,
  ) {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session?.access_token) return

      const params = new URLSearchParams({
        start: period.start,
        end: period.end,
      })
      if (teamId !== 'all') params.set('team_id', teamId)

      const response = await fetch(`/api/clickdesk/metrics?${params.toString()}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: 'no-store',
      })
      const data = (await response.json()) as ClickDeskPersistedMetrics

      if (!response.ok) {
        data.erro = data.erro || 'Não foi possível carregar a base persistida do ClickDesk.'
      }

      setClickDeskPersistedMetrics(data)
    } catch (error) {
      setClickDeskPersistedMetrics({
        erro: getErrorMessage(error),
      })
    }
  }

  async function loadClickDeskPreviousMetricsOnly(
    period: { start: string; end: string },
    teamId: string,
  ) {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session?.access_token) return

      const params = new URLSearchParams({
        start: period.start,
        end: period.end,
      })
      if (teamId !== 'all') params.set('team_id', teamId)

      const response = await fetch(`/api/clickdesk/metrics?${params.toString()}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: 'no-store',
      })
      const data = (await response.json()) as ClickDeskPersistedMetrics

      if (!response.ok) {
        data.erro = data.erro || 'Não foi possível carregar a competência anterior do ClickDesk.'
      }

      setClickDeskPreviousMetrics(data)
    } catch (error) {
      setClickDeskPreviousMetrics({
        erro: getErrorMessage(error),
      })
    }
  }

  async function handleLoadClickDeskConversations() {
    setClickDeskConversationLoading(true)
    setClickDeskConversationDiagnostic(null)
    setClickDeskPersistedMetrics(null)
    setClickDeskSyncResult(null)

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session?.access_token) {
        setClickDeskConversationDiagnostic({ error: 'Sua sessão de homologação não está ativa.' })
        return
      }

      const headers = {
        Authorization: `Bearer ${session.access_token}`,
      }

      const syncResponse = await fetch('/api/clickdesk/sync', {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          start: chat2SelectedPeriod.start,
          end: chat2SelectedPeriod.end,
          trigger_mode: 'manual',
        }),
        cache: 'no-store',
      })
      const syncData = (await syncResponse.json()) as ClickDeskSyncResult
      setClickDeskSyncResult(syncData)

      if (!syncResponse.ok) {
        setClickDeskConversationDiagnostic({
          error: syncData.erro || 'Não foi possível sincronizar a base persistida do ClickDesk.',
        })
        return
      }

      const persistedParams = new URLSearchParams({
        start: chat2SelectedPeriod.start,
        end: chat2SelectedPeriod.end,
      })
      if (selectedTeamId !== 'all') persistedParams.set('team_id', selectedTeamId)
      const diagnosticParams = new URLSearchParams({
        year: String(chat2SelectedPeriod.year),
        month: String(chat2SelectedPeriod.monthNumber),
      })

      const [metricsResponse, diagnosticResponse] = await Promise.all([
        fetch(`/api/clickdesk/metrics?${persistedParams.toString()}`, {
          headers,
          cache: 'no-store',
        }),
        fetch(`/api/clickdesk/conversations?${diagnosticParams.toString()}`, {
          headers,
          cache: 'no-store',
        }),
      ])

      const [metricsData, diagnosticData] = await Promise.all([
        metricsResponse.json() as Promise<ClickDeskPersistedMetrics>,
        diagnosticResponse.json() as Promise<ClickDeskConversationDiagnostic>,
      ])

      if (!metricsResponse.ok) {
        metricsData.erro = metricsData.erro || 'Não foi possível ler a base persistida do ClickDesk.'
      }
      if (!diagnosticResponse.ok && !diagnosticData.error) {
        diagnosticData.error = 'Não foi possível ler o diagnóstico do ClickDesk.'
      }

      setClickDeskPersistedMetrics(metricsData)
      setClickDeskConversationDiagnostic(diagnosticData)
    } catch (error) {
      setClickDeskConversationDiagnostic({ error: getErrorMessage(error) })
    } finally {
      setClickDeskConversationLoading(false)
    }
  }

  async function handleLoadClickDeskClosurePreview() {
    setClickDeskClosureLoading(true)
    setClickDeskClosureMessage('')

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session?.access_token) {
        setClickDeskClosureMessage('Sua sessão de homologação não está ativa.')
        return
      }

      const closureYear = chat2SelectedPeriod.year
      const closureMonthNumber = chat2SelectedPeriod.monthNumber
      const month = `${closureYear}-${String(closureMonthNumber).padStart(2, '0')}`
      const params = new URLSearchParams({
        mes: month,
        canal: 'chat',
        equipe: selectedTeamId,
        fonte: 'atual',
      })
      const headers = { Authorization: `Bearer ${session.access_token}` }

      const previewResponse = await fetch(
        `/api/clickdesk/closures?${params.toString()}`,
        { headers, cache: 'no-store' },
      )
      const previewData = (await previewResponse.json()) as ClickDeskClosurePreview

      if (!previewResponse.ok) {
        setClickDeskClosureMessage(
          previewData.erro || 'Não foi possível gerar a prévia do fechamento ClickDesk.',
        )
        return
      }

      setClickDeskClosurePreview(previewData)

      const officialParams = new URLSearchParams(params)
      officialParams.set('fonte', 'oficial')
      const officialResponse = await fetch(
        `/api/clickdesk/closures?${officialParams.toString()}`,
        { headers, cache: 'no-store' },
      )

      if (officialResponse.ok) {
        const officialData = (await officialResponse.json()) as ClickDeskClosurePreview
        setClickDeskOfficialClosure(officialData)
      } else {
        setClickDeskOfficialClosure(null)
      }
    } catch (error) {
      setClickDeskClosureMessage(getErrorMessage(error))
    } finally {
      setClickDeskClosureLoading(false)
    }
  }

  async function handleApproveClickDeskClosure() {
    if (!clickDeskClosurePreview?.conferencia || !clickDeskClosurePreview.fechamento?.pronto) return

    const confirmed = window.confirm(
      'Confirmar o fechamento oficial desta competência? Depois de aprovado, o snapshot ficará imutável.',
    )
    if (!confirmed) return

    setClickDeskClosureLoading(true)
    setClickDeskClosureMessage('')

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session?.access_token) {
        setClickDeskClosureMessage('Sua sessão de homologação não está ativa.')
        return
      }

      const closureYear = chat2SelectedPeriod.year
      const closureMonthNumber = chat2SelectedPeriod.monthNumber
      const month = `${closureYear}-${String(closureMonthNumber).padStart(2, '0')}`
      const params = new URLSearchParams({
        mes: month,
        canal: 'chat',
        equipe: selectedTeamId,
        fonte: 'atual',
      })

      const response = await fetch(
        `/api/clickdesk/closures?${params.toString()}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ conferencia: clickDeskClosurePreview.conferencia }),
        },
      )

      const data = (await response.json()) as ClickDeskClosurePreview
      if (!response.ok) {
        setClickDeskClosureMessage(
          data.erro || 'Não foi possível aprovar o fechamento oficial.',
        )
        return
      }

      setClickDeskOfficialClosure(data)
      setClickDeskClosureMessage('Fechamento oficial preservado com sucesso.')
    } catch (error) {
      setClickDeskClosureMessage(getErrorMessage(error))
    } finally {
      setClickDeskClosureLoading(false)
    }
  }

  async function handleDiagnoseClickDeskAiRouting() {
    setClickDeskAiRoutingLoading(true)
    setClickDeskAiRoutingDiagnostic(null)

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session?.access_token) {
        setClickDeskAiRoutingDiagnostic({ error: 'Sua sessão de homologação não está ativa.' })
        return
      }

      const params = new URLSearchParams({
        year: String(chat2SelectedPeriod.year),
        month: String(chat2SelectedPeriod.monthNumber),
      })
      const response = await fetch(`/api/clickdesk/ai-routing?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        cache: 'no-store',
      })
      const data = (await response.json()) as ClickDeskAiRoutingDiagnostic

      if (!response.ok && !data.error) {
        data.error = 'Não foi possível diagnosticar o roteamento da IA.'
      }

      setClickDeskAiRoutingDiagnostic(data)
    } catch (error) {
      setClickDeskAiRoutingDiagnostic({ error: getErrorMessage(error) })
    } finally {
      setClickDeskAiRoutingLoading(false)
    }
  }

  async function runManagementQualitativeAnalysis(ticketId: string) {
    const normalizedTicketId = ticketId.trim()
    if (!normalizedTicketId) {
      setClickDeskQualitativeResult({ error: 'Informe um ticket persistido para validar a análise.' })
      return
    }

    setClickDeskQualitativeTicketId(normalizedTicketId)
    setClickDeskQualitativeLoading(true)
    setClickDeskQualitativeResult(null)

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session?.access_token) {
        setClickDeskQualitativeResult({ error: 'Sua sessão de homologação não está ativa.' })
        return
      }

      const response = await fetch('/api/clickdesk/qualitative', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ticket_id: normalizedTicketId }),
      })
      const data = (await response.json()) as ClickDeskQualitativeResponse

      if (!response.ok && !data.error) {
        data.error = 'Não foi possível analisar qualitativamente este atendimento.'
      }

      setClickDeskQualitativeResult(data)
      if (response.ok && !data.error) {
        setClickDeskQualitativeSummaryRefresh((current) => current + 1)
      }
    } catch (error) {
      setClickDeskQualitativeResult({ error: getErrorMessage(error) })
    } finally {
      setClickDeskQualitativeLoading(false)
    }
  }

  async function handleAnalyzeClickDeskQualitative() {
    await runManagementQualitativeAnalysis(clickDeskQualitativeTicketId)
  }

  async function handleValidateClickDeskQualitative(
    ticketId: string,
    status: 'approved' | 'rejected',
  ) {
    setClickDeskQualitativeValidationTicketId(ticketId)

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session?.access_token) {
        setClickDeskQualitativeResult({ error: 'Sua sessão de homologação não está ativa.' })
        return
      }

      const response = await fetch('/api/clickdesk/qualitative-validation', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ticket_id: ticketId, status }),
      })
      const data = (await response.json()) as ClickDeskQualitativeResponse

      if (!response.ok && !data.error) {
        data.error = 'Não foi possível salvar a validação desta análise.'
      }

      if (data.error) {
        setClickDeskQualitativeResult(data)
        return
      }

      setClickDeskQualitativeResult((current) =>
        current?.ticket_id === ticketId
          ? {
              ...current,
              validation_status: data.validation_status,
              validated_at: data.validated_at,
            }
          : current,
      )
      setClickDeskQualitativeSummaryRefresh((current) => current + 1)
    } catch (error) {
      setClickDeskQualitativeResult({ error: getErrorMessage(error) })
    } finally {
      setClickDeskQualitativeValidationTicketId('')
    }
  }

  async function handleChatMonthlyImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setChatImportMessage('')

    if (!chatSatisfactionFile || !chatInactiveFile) {
      setChatImportMessage('Selecione a planilha de satisfação e a planilha de inativos antes de importar.')
      return
    }

    const year = Number(chatImportYear)
    const monthNumber = Number(chatImportMonth)

    if (!year || !monthNumber || monthNumber < 1 || monthNumber > 12) {
      setChatImportMessage('Informe um mês e um ano válidos para a importação.')
      return
    }

    setChatImportSaving(true)

    try {
      const [satisfactionRows, inactiveRows] = await Promise.all([
        readSheetRows(chatSatisfactionFile),
        readSheetRows(chatInactiveFile),
      ])
      const period = getChatMonthPeriod(year, monthNumber)
      const importRows = buildChatMetricRowsFromSheets({
        satisfactionRows,
        inactiveRows,
        analysts,
        year,
        monthNumber,
        monthLabel: period.label,
        periodStart: period.start,
        periodEnd: period.end,
      })

      if (!importRows.length) {
        setChatImportMessage('Nenhum analista do cadastro foi encontrado nos arquivos selecionados.')
        return
      }

      const { error } = await supabase.from('chat_monthly_metrics').upsert(importRows, {
        onConflict: 'team_id,analyst_id,year,month_number',
      })

      if (error) throw error

      const { data: authData } = await supabase.auth.getUser()
      const importingUser = authData.user
      const importingUserName =
        importingUser?.user_metadata?.full_name ||
        importingUser?.user_metadata?.name ||
        importingUser?.email ||
        'Usuário não identificado'
      const { error: historyError } = await supabase.from('chat_import_history').insert({
        year,
        month_number: monthNumber,
        month_label: period.label,
        satisfaction_file_name: chatSatisfactionFile.name,
        satisfaction_file_size: chatSatisfactionFile.size,
        satisfaction_rows: satisfactionRows.length,
        inactivity_file_name: chatInactiveFile.name,
        inactivity_file_size: chatInactiveFile.size,
        inactivity_rows: inactiveRows.length,
        analysts_processed: importRows.length,
        status: 'completed',
        created_by: importingUser?.id ?? null,
        created_by_name: importingUserName,
      })

      if (historyError) {
        throw new Error(`Os dados foram importados, mas o histórico não pôde ser registrado: ${historyError.message}`)
      }

      await onImportComplete()
      await loadChatImportHistory()
      setSelectedPeriodKey(`${year}-${monthNumber}`)
      setChatImportMessage('')
      setExpandedChatImportId('')
      setChatSatisfactionFile(null)
      setChatInactiveFile(null)
      setChatFileInputResetKey((key) => key + 1)
    } catch (error) {
      setChatImportMessage(getErrorMessage(error))
    } finally {
      setChatImportSaving(false)
    }
  }

  async function handleDeleteChatMonth() {
    const year = Number(chatImportYear)
    const monthNumber = Number(chatImportMonth)
    const period = getChatMonthPeriod(year, monthNumber)
    const monthMetrics = metrics.filter(
      (metric) => metric.year === year && metric.month_number === monthNumber,
    )

    if (!monthMetrics.length) {
      setChatImportMessage(`Não existem dados importados para ${period.label}.`)
      return
    }

    const confirmed = window.confirm(
      `Excluir ${period.label}?\n\nSerão removidos ${monthMetrics.length} registro(s), além do pódio manual e das desconsiderações desse mês. O histórico das importações será preservado.\n\nEsta ação não pode ser desfeita.`,
    )

    if (!confirmed) return

    setChatMonthDeleting(true)
    setChatImportMessage('')

    try {
      const { error: exclusionsError } = await supabase
        .from('chat_podium_exclusions')
        .delete()
        .eq('year', year)
        .eq('month_number', monthNumber)
      if (exclusionsError) throw exclusionsError

      const { error: podiumError } = await supabase
        .from('chat_podium_manual')
        .delete()
        .eq('year', year)
        .eq('month_number', monthNumber)
      if (podiumError) throw podiumError

      const { error: metricsError } = await supabase
        .from('chat_monthly_metrics')
        .delete()
        .eq('year', year)
        .eq('month_number', monthNumber)
      if (metricsError) throw metricsError

      await onImportComplete()
      setSelectedPeriodKey('')
      setChatImportMessage(`${period.label} foi excluído. Agora você pode fazer uma nova importação limpa.`)
    } catch (error) {
      setChatImportMessage(`Não foi possível concluir a exclusão: ${getErrorMessage(error)}`)
    } finally {
      setChatMonthDeleting(false)
    }
  }

  useEffect(() => {
    if (!selectedPeriodKey && periods[0]) {
      setSelectedPeriodKey(`${periods[0].year}-${periods[0].monthNumber}`)
    }
  }, [periods, selectedPeriodKey])
  useEffect(() => {
    if (chat2PeriodKey) return
    const now = new Date()
    setChat2PeriodKey(`${now.getFullYear()}-${now.getMonth() + 1}`)
  }, [chat2PeriodKey])
  useEffect(() => {
    if (!chatAnalystForm.teamId && teams[0]) {
      setChatAnalystForm((current) => ({ ...current, teamId: teams[0].id }))
    }
  }, [teams, chatAnalystForm.teamId])

  useEffect(() => {
    if (!isManagementUser || chatActiveTab !== 'podium') return

    let cancelled = false

    async function loadQualitativeSummary() {
      setClickDeskQualitativeSummaryLoading(true)

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession()

        if (!session?.access_token) {
          if (!cancelled) {
            setClickDeskQualitativeSummary({ error: 'Sua sessão de homologação não está ativa.' })
          }
          return
        }

        const [yearText, monthText] = chat2PeriodKey.split('-')
        const now = new Date()
        const year = Number(yearText) || now.getFullYear()
        const monthNumber = Number(monthText) || now.getMonth() + 1
        const period = getChatMonthPeriod(year, monthNumber)
        const params = new URLSearchParams({
          start: period.start,
          end: period.end,
        })
        if (selectedTeamId !== 'all') params.set('team_id', selectedTeamId)

        const response = await fetch(`/api/clickdesk/qualitative-summary?${params.toString()}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
          cache: 'no-store',
        })
        const data = (await response.json()) as ClickDeskQualitativeSummary

        if (!response.ok && !data.error) {
          data.error = 'Não foi possível consolidar as análises qualitativas.'
        }

        if (!cancelled) setClickDeskQualitativeSummary(data)
      } catch (error) {
        if (!cancelled) {
          setClickDeskQualitativeSummary({ error: getErrorMessage(error) })
        }
      } finally {
        if (!cancelled) setClickDeskQualitativeSummaryLoading(false)
      }
    }

    void loadQualitativeSummary()

    return () => {
      cancelled = true
    }
  }, [isManagementUser, chatActiveTab, chat2PeriodKey, selectedTeamId, clickDeskQualitativeSummaryRefresh])

  if (!isManagementUser) {
    return (
      <div className="mt-8 space-y-7">

      <section className="panel">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-cyan-300">Módulo chat</p>
          <h2 className="mt-3 text-3xl font-bold">Acesso restrito à gestão</h2>
          <p className="mt-3 max-w-3xl text-slate-300">
            O módulo Chat será usado para importação mensal, cálculos consolidados, ranking, pódio e relatórios individuais.
          </p>
        </section>
      </div>
    )
  }

  const selectedPeriod = periods.find((period) => `${period.year}-${period.monthNumber}` === selectedPeriodKey) ?? periods[0]
  const visibleMetrics = metrics.filter((metric) => {
    const matchesTeam = selectedTeamId === 'all' || metric.team_id === selectedTeamId
    const matchesPeriod = selectedPeriod
      ? metric.year === selectedPeriod.year && metric.month_number === selectedPeriod.monthNumber
      : true
    return matchesTeam && matchesPeriod
  })
  const activePodiumExclusions = podiumExclusions.filter((exclusion) => {
    const matchesTeam = selectedTeamId === 'all' || exclusion.team_id === selectedTeamId
    const matchesPeriod = selectedPeriod
      ? exclusion.year === selectedPeriod.year && exclusion.month_number === selectedPeriod.monthNumber
      : true

    return matchesTeam && matchesPeriod
  })
  const excludedChatAnalystIds = new Set(activePodiumExclusions.map((exclusion) => exclusion.analyst_id))
  const calculationMetrics = visibleMetrics.filter((metric) => !excludedChatAnalystIds.has(metric.analyst_id))
  const excludedChatMetricKeys = new Set(
    podiumExclusions
      .filter((exclusion) => selectedTeamId === 'all' || exclusion.team_id === selectedTeamId)
      .map((exclusion) => `${exclusion.analyst_id}:${exclusion.year}:${exclusion.month_number}`),
  )
  const trendMetrics = metrics.filter(
    (metric) =>
      (selectedTeamId === 'all' || metric.team_id === selectedTeamId) &&
      !excludedChatMetricKeys.has(`${metric.analyst_id}:${metric.year}:${metric.month_number}`),
  )
  const selectedTeamName =
    selectedTeamId === 'all' ? 'Todas as equipes' : teams.find((team) => team.id === selectedTeamId)?.name ?? 'Equipe'
  const totals = calculationMetrics.reduce(
    (acc, metric) => ({
      tickets: acc.tickets + Number(metric.total_tickets),
      validTickets: acc.validTickets + Number(metric.valid_tickets),
      reviews: acc.reviews + Number(metric.reviews),
      positives: acc.positives + Number(metric.positive_reviews),
      negatives: acc.negatives + Number(metric.negative_reviews),
      inactive: acc.inactive + Number(metric.inactive_tickets),
    }),
    { tickets: 0, validTickets: 0, reviews: 0, positives: 0, negatives: 0, inactive: 0 },
  )
  const averageTickets = calculationMetrics.length ? round(totals.tickets / calculationMetrics.length) : 0
  const averageCsat = calculateChatAverage(calculationMetrics, 'csat')
  const averageReviews = calculateChatAverage(calculationMetrics, 'review_percentage')
  const averageSending = calculateChatAverage(calculationMetrics, 'sending_percentage')
  const chatReviewRate = totals.validTickets ? round((totals.reviews / totals.validTickets) * 100) : 0
  const chatSendingRate = totals.validTickets ? round(((totals.validTickets - totals.reviews) / totals.validTickets) * 100) : 0
  const chatInactiveRate = totals.tickets ? round((totals.inactive / totals.tickets) * 100) : 0
  const previousPeriodIndex = selectedPeriod
    ? periods.findIndex((period) => period.year === selectedPeriod.year && period.monthNumber === selectedPeriod.monthNumber)
    : -1
  const previousPeriod = previousPeriodIndex >= 0 ? periods[previousPeriodIndex + 1] : undefined
  const previousMetrics = metrics.filter((metric) => {
    const matchesTeam = selectedTeamId === 'all' || metric.team_id === selectedTeamId
    const matchesPeriod = previousPeriod
      ? metric.year === previousPeriod.year && metric.month_number === previousPeriod.monthNumber
      : false
    return matchesTeam && matchesPeriod
  })
  const previousExcludedAnalystIds = new Set(
    podiumExclusions
      .filter((exclusion) => {
        const matchesTeam = selectedTeamId === 'all' || exclusion.team_id === selectedTeamId
        const matchesPeriod = previousPeriod
          ? exclusion.year === previousPeriod.year && exclusion.month_number === previousPeriod.monthNumber
          : false
        return matchesTeam && matchesPeriod
      })
      .map((exclusion) => exclusion.analyst_id),
  )
  const previousCalculationMetrics = previousMetrics.filter(
    (metric) => !previousExcludedAnalystIds.has(metric.analyst_id),
  )
  const previousAverageCsat = calculateChatAverage(previousCalculationMetrics, 'csat')
  const previousAverageReviews = calculateChatAverage(previousCalculationMetrics, 'review_percentage')
  const previousAverageSending = calculateChatAverage(previousCalculationMetrics, 'sending_percentage')
  const chatCsatDelta = round(averageCsat - previousAverageCsat)
  const chatReviewDelta = round(averageReviews - previousAverageReviews)
  const chatSendingDelta = round(averageSending - previousAverageSending)
  const activeManualPodium = manualPodium
    .filter((item) => {
      const matchesTeam = selectedTeamId !== 'all' && item.team_id === selectedTeamId
      const matchesPeriod = selectedPeriod
        ? item.year === selectedPeriod.year && item.month_number === selectedPeriod.monthNumber
        : true

      return matchesTeam && matchesPeriod
    })
    .sort((a, b) => a.position - b.position)
  const chatRanking = buildChatRanking(visibleMetrics, averageTickets, excludedChatAnalystIds)
  const calculatedChatRanking = chatRanking.filter((item) => !item.excluded)
  const manualPodiumEligibleIds = new Set(
    chatRanking.filter((item) => item.eligible).map((item) => item.metric.analyst_id),
  )
  const automaticPodium = chatRanking.filter((item) => item.eligible).slice(0, 3).map((item) => item.metric)
  const podium = [1, 2, 3].map((position, index) => {
    const manual = activeManualPodium.find((item) => item.position === position)
    return manual
      ? calculationMetrics.find(
          (metric) =>
            metric.analyst_id === manual.analyst_id &&
            manualPodiumEligibleIds.has(metric.analyst_id),
        ) ?? automaticPodium[index] ?? null
      : automaticPodium[index] ?? null
  })
  const attention = calculationMetrics
    .map((metric) => ({ metric, reasons: getChatAttentionReasons(metric, averageTickets) }))
    .filter((item) => item.reasons.length)
    .sort((a, b) => Number(a.metric.csat) - Number(b.metric.csat))
    .slice(0, 5)
  const monthlyTrend = buildChatMonthlyTrend(trendMetrics).slice(-7)
  const monthlyUnifiedTrend = buildChatMonthlyUnifiedTrend(trendMetrics).slice(-7)
  const monthlyVolumeTrend = buildChatMonthlyVolumeTrend(trendMetrics).slice(-7)
  const chatGoalsReachedCount = calculationMetrics.filter(
    (metric) => Number(metric.csat) >= Number(metric.csat_goal) && Number(metric.review_percentage) >= Number(metric.general_review_goal),
  ).length
  const chatCriticalCount = calculationMetrics.filter((metric) => metric.status === 'Critico').length
  const chatTopPerformers = calculatedChatRanking
    .filter((item) => item.eligible || (Number(item.metric.csat) >= Number(item.metric.csat_goal) && Number(item.metric.review_percentage) >= 25))
    .slice(0, 5)
  const chatOpportunities = calculationMetrics
    .map((metric) => ({
      metric,
      reasons: getChatAttentionReasons(metric, averageTickets),
      csatDelta: round(Number(metric.csat) - Number(metric.csat_goal)),
      reviewDelta: round(Number(metric.review_percentage) - Number(metric.general_review_goal)),
      sendingDelta: round(Number(metric.sending_percentage) - 80),
    }))
    .filter((item) => item.reasons.length || item.csatDelta < 0 || item.reviewDelta < 0 || item.sendingDelta < 0)
    .sort((a, b) => {
      if (b.reasons.length !== a.reasons.length) return b.reasons.length - a.reasons.length
      if (a.csatDelta !== b.csatDelta) return a.csatDelta - b.csatDelta
      return Number(a.metric.csat) - Number(b.metric.csat)
    })
    .slice(0, 6)
  const [chatReportYearText, chatReportMonthText] = chat2PeriodKey.split('-')
  const chatReportNow = new Date()
  const chatReportYear = Number(chatReportYearText) || chatReportNow.getFullYear()
  const chatReportMonthNumber = Number(chatReportMonthText) || chatReportNow.getMonth() + 1
  const chatReportPeriodBase = getChatMonthPeriod(chatReportYear, chatReportMonthNumber)
  const chatReportPeriod = {
    ...chatReportPeriodBase,
    year: chatReportYear,
    monthNumber: chatReportMonthNumber,
    key: `${chatReportYear}-${chatReportMonthNumber}`,
  }
  const chatReportMonthKey = `${chatReportYear}-${String(chatReportMonthNumber).padStart(2, '0')}`
  const legacyChatReportMetrics = metrics.filter((metric) => {
    const matchesTeam = selectedTeamId === 'all' || metric.team_id === selectedTeamId
    return (
      matchesTeam &&
      metric.year === chatReportYear &&
      metric.month_number === chatReportMonthNumber
    )
  })
  const clickDeskReportPeriodMatches =
    clickDeskPersistedMetrics?.period?.start === chatReportPeriod.start &&
    Boolean(clickDeskPersistedMetrics?.period?.end) &&
    String(clickDeskPersistedMetrics?.period?.end) >= chatReportPeriod.start &&
    String(clickDeskPersistedMetrics?.period?.end) <= chatReportPeriod.end
  const clickDeskReportHasOfficialSnapshot =
    Boolean(clickDeskOfficialClosure?.fechamento_id) &&
    clickDeskOfficialClosure?.mes === chatReportMonthKey &&
    clickDeskOfficialClosure?.equipe === selectedTeamId

  const clickDeskOfficialReportMetrics: ChatMonthlyMetric[] =
    clickDeskReportHasOfficialSnapshot
      ? (clickDeskOfficialClosure?.analistas ?? []).map((item) => {
          const analystProfile = analysts.find((analyst) => analyst.id === item.analyst_id)
          const csatGoal = Number(item.csat_goal ?? analystProfile?.csat_goal ?? 90)
          const reviewGoal = Number(item.review_goal ?? 25)
          const csat = Number(item.csat ?? 0)
          const reviewPercentage = Number(item.review_percentage ?? 0)
          const teamName =
            item.team_name ??
            teams.find((team) => team.id === item.team_id)?.name ??
            'Equipe'

          return {
            id: `clickdesk:${chatReportMonthKey}:${item.analyst_id}`,
            team_id: item.team_id ?? analystProfile?.team_id ?? '',
            analyst_id: item.analyst_id,
            month_label: chatReportPeriod.label,
            year: chatReportYear,
            month_number: chatReportMonthNumber,
            period_start: chatReportPeriod.start,
            period_end: chatReportPeriod.end,
            csat,
            review_percentage: reviewPercentage,
            sending_percentage: round(Math.max(0, 100 - reviewPercentage)),
            total_tickets: Number(item.attendances ?? 0),
            inactive_tickets: 0,
            valid_tickets: Number(item.attendances ?? 0),
            reviews: Number(item.reviews ?? 0),
            positive_reviews: Number(item.positive_reviews ?? 0),
            negative_reviews: Number(item.negative_reviews ?? 0),
            csat_goal: csatGoal,
            csat_delta: round(csat - csatGoal),
            general_review_goal: reviewGoal,
            status:
              csat >= csatGoal && reviewPercentage >= reviewGoal
                ? 'Meta Superada'
                : csat < csatGoal && reviewPercentage < reviewGoal
                  ? 'Critico'
                  : 'Em acompanhamento',
            chat_analysts: {
              name: item.name,
              csat_goal: csatGoal,
              photo_url: analystProfile?.photo_url ?? null,
            },
            chat_teams: { name: teamName },
          }
        })
      : []

  const clickDeskLiveReportMetrics: ChatMonthlyMetric[] =
    !clickDeskReportHasOfficialSnapshot && clickDeskReportPeriodMatches
      ? (clickDeskPersistedMetrics?.by_analyst ?? [])
          .filter((item) => Boolean(item.analyst_id))
          .map((item) => {
            const analystId = item.analyst_id as string
            const analystProfile = analysts.find((analyst) => analyst.id === analystId)
            const csatGoal = Number(analystProfile?.csat_goal ?? 90)
            const reviewGoal = 25
            const csat = Number(item.csat ?? 0)
            const reviewPercentage = Number(item.review_percentage ?? 0)
            const teamName =
              teams.find((team) => team.id === item.team_id)?.name ??
              item.area ??
              'Equipe'

            return {
              id: `clickdesk:${chatReportMonthKey}:${analystId}`,
              team_id: item.team_id ?? analystProfile?.team_id ?? '',
              analyst_id: analystId,
              month_label: chatReportPeriod.label,
              year: chatReportYear,
              month_number: chatReportMonthNumber,
              period_start: chatReportPeriod.start,
              period_end: chatReportPeriod.end,
              csat,
              review_percentage: reviewPercentage,
              sending_percentage: round(Math.max(0, 100 - reviewPercentage)),
              total_tickets: Number(item.attendances ?? 0),
              inactive_tickets: 0,
              valid_tickets: Number(item.attendances ?? 0),
              reviews: Number(item.reviews ?? 0),
              positive_reviews: Number(item.positive_reviews ?? 0),
              negative_reviews: Number(item.negative_reviews ?? 0),
              csat_goal: csatGoal,
              csat_delta: round(csat - csatGoal),
              general_review_goal: reviewGoal,
              status:
                csat >= csatGoal && reviewPercentage >= reviewGoal
                  ? 'Meta Superada'
                  : csat < csatGoal && reviewPercentage < reviewGoal
                    ? 'Critico'
                    : 'Em acompanhamento',
              chat_analysts: {
                name: analystProfile?.name ?? item.assignee_name,
                csat_goal: csatGoal,
                photo_url: analystProfile?.photo_url ?? null,
              },
              chat_teams: { name: teamName },
            }
          })
      : []

  const clickDeskChatReportMetrics =
    clickDeskOfficialReportMetrics.length > 0
      ? clickDeskOfficialReportMetrics
      : clickDeskLiveReportMetrics
  const chatReportUsesClickDesk = clickDeskChatReportMetrics.length > 0
  const chatReportMetrics =
    chatReportUsesClickDesk ? clickDeskChatReportMetrics : legacyChatReportMetrics
  const chatReportExcludedIds = new Set(
    podiumExclusions
      .filter((item) => {
        const matchesTeam = selectedTeamId === 'all' || item.team_id === selectedTeamId
        return (
          matchesTeam &&
          item.year === chatReportYear &&
          item.month_number === chatReportMonthNumber
        )
      })
      .map((item) => item.analyst_id),
  )
  const chatReportCalculationMetrics = chatReportMetrics.filter(
    (metric) => !chatReportExcludedIds.has(metric.analyst_id),
  )
  const chatReportAverageTickets = chatReportCalculationMetrics.length
    ? round(
        chatReportCalculationMetrics.reduce(
          (sum, metric) => sum + Number(metric.total_tickets),
          0,
        ) / chatReportCalculationMetrics.length,
      )
    : 0
  const chatReportVolumeReference = Math.ceil(chatReportAverageTickets)
  const chatReportRanking = buildChatRanking(
    chatReportMetrics,
    chatReportAverageTickets,
    chatReportExcludedIds,
  )
  const selectedChatReportMetric =
    chatReportMetrics.find((metric) => metric.id === selectedChatReportMetricId) ??
    chatReportMetrics[0] ??
    null
  const selectedChatRankingItem = selectedChatReportMetric
    ? chatReportRanking.find((item) => item.metric.id === selectedChatReportMetric.id)
    : null
  const automaticChatReportPodium = chatReportRanking
    .filter((item) => item.eligible && !item.excluded)
    .slice(0, 3)
    .map((item) => item.metric)
  const selectedChatPodiumPosition = selectedChatReportMetric
    ? chatReportUsesClickDesk
      ? automaticChatReportPodium.findIndex(
          (metric) => metric.analyst_id === selectedChatReportMetric.analyst_id,
        ) + 1
      : podium.findIndex(
          (metric) => metric?.analyst_id === selectedChatReportMetric.analyst_id,
        ) + 1
    : 0
  const chatReportSourceLabel = chatReportUsesClickDesk
    ? clickDeskReportHasOfficialSnapshot
      ? 'ClickDesk · fechamento oficial'
      : 'ClickDesk · base viva'
    : 'Zendesk · histórico legado'
  const chatReportFeedbackSuggestion = selectedChatReportMetric
    ? buildChatFeedbackText({
        metric: selectedChatReportMetric,
        averageTickets: chatReportAverageTickets,
        podiumPosition: selectedChatPodiumPosition,
        managerNotes: chatManagerNotes,
      })
    : ''
  const chatReportExclusions = podiumExclusions.filter((item) => {
    const matchesTeam = selectedTeamId === 'all' || item.team_id === selectedTeamId
    return (
      matchesTeam &&
      item.year === chatReportYear &&
      item.month_number === chatReportMonthNumber
    )
  })
  const chatReportActiveManualPodium = manualPodium
    .filter(
      (item) =>
        selectedTeamId !== 'all' &&
        item.team_id === selectedTeamId &&
        item.year === chatReportYear &&
        item.month_number === chatReportMonthNumber,
    )
    .sort((a, b) => a.position - b.position)
  const chatReportManualEligibleIds = new Set(
    chatReportRanking.filter((item) => item.eligible).map((item) => item.metric.analyst_id),
  )
  const chatReportPodium = [1, 2, 3].map((position, index) => {
    const manual = chatReportActiveManualPodium.find((item) => item.position === position)
    return manual
      ? chatReportRanking.find(
          (item) =>
            item.metric.analyst_id === manual.analyst_id &&
            item.eligible,
        )?.metric ?? automaticChatReportPodium[index] ?? null
      : automaticChatReportPodium[index] ?? null
  })
  const chatReportEligibleItems = chatReportRanking.filter((item) => item.eligible)
  const chatReportEligibleCount = chatReportEligibleItems.length
  const chatReportCriticalCount = chatReportCalculationMetrics.filter(
    (metric) => metric.status === 'Critico',
  ).length
  const chatReportTopHighlight =
    chatReportEligibleItems[0]?.metric ?? chatReportRanking.find((item) => !item.excluded)?.metric ?? null
  const chatReportAttentionItem = chatReportRanking.find(
    (item) => !item.eligible && !item.excluded,
  )
  const chatReportAttentionHighlight = chatReportAttentionItem?.metric ?? null
  const chatReportAttentionText = chatReportAttentionItem?.reasons.length
    ? formatStatusText(chatReportAttentionItem.reasons.join(', '))
    : 'Sem prioridade aberta no período.'
  const chatReportClosureReading =
    !chatReportMetrics.length
      ? 'Ainda não há base suficiente para leitura do fechamento.'
      : chatReportEligibleCount >= 3 && !chatReportCriticalCount
        ? 'Fechamento forte: há pódio completo e nenhum caso crítico no período.'
        : chatReportEligibleCount > 0
          ? 'Fechamento positivo, com oportunidade de ampliar a quantidade de elegíveis ao pódio.'
          : 'Fechamento pede atenção: nenhum analista ficou plenamente elegível ao pódio.'

  const chatExecutiveStatus =
    !calculationMetrics.length
      ? 'Sem dados no período'
      : averageCsat >= 90 && averageReviews >= 25
        ? 'Operação saudável'
        : averageCsat < 85 || averageReviews < 20 || attention.length >= 3
          ? 'Acompanhamento prioritário'
          : 'Período em atenção'
  const chatExecutiveTone =
    !calculationMetrics.length
      ? 'text-slate-300'
      : averageCsat >= 90 && averageReviews >= 25
        ? 'text-emerald-300'
        : averageCsat < 85 || averageReviews < 20 || attention.length >= 3
          ? 'text-rose-300'
          : 'text-amber-300'
  const chatMainAlert =
    !calculationMetrics.length
      ? 'Selecione outro período ou aguarde a importação mensal.'
      : averageCsat < 85
        ? 'A qualidade do atendimento tem espaço para evolução.'
        : averageCsat < 90
          ? 'CSAT abaixo da referência de pódio do chat.'
          : averageReviews < 20
            ? 'A participação dos clientes nas pesquisas precisa ser ampliada.'
            : averageReviews < 25
              ? 'Avaliações abaixo do mínimo usado para elegibilidade ao pódio.'
              : attention.length
                ? 'Há analistas com pelo menos um critério fora da referência.'
                : 'Equipe alinhada com os critérios principais do período.'

  const chatRecommendedAction =
    !calculationMetrics.length
      ? 'Importar ou selecionar um mês com dados.'
      : averageCsat < 90
        ? 'Revisar atendimentos negativos e direcionar feedback dos analistas em atenção.'
        : averageReviews < 25
          ? 'Reforçar o convite para avaliação e acompanhar o volume de respostas no próximo ciclo.'
          : attention.length
            ? 'Priorizar os analistas listados em atenção antes do próximo fechamento.'
            : 'Manter a rotina atual e acompanhar se o resultado se sustenta no mês seguinte.'
  const chatEligibleCount = calculatedChatRanking.filter((item) => item.eligible).length
  const chatVisualRows = calculatedChatRanking.slice(0, 10).map((item) => ({
    label: getChatAnalystName(item.metric),
    primary: Number(item.metric.csat),
    secondary: Number(item.metric.review_percentage),
    volume: Number(item.metric.total_tickets),
    status: item.eligible ? 'Elegível' : formatStatusText(item.reasons.join(', ')),
  }))
  const chatVisualPoints = calculatedChatRanking.map((item) => ({
    label: getChatAnalystName(item.metric),
    x: Number(item.metric.total_tickets),
    y: Number(item.metric.csat),
    tone: item.eligible ? 'success' : Number(item.metric.csat) < 90 ? 'danger' : 'warning',
    detail: `${formatChatPercent(item.metric.review_percentage)} avaliações`,
  }))
  const chatTopHighlight = calculatedChatRanking.find((item) => item.eligible)?.metric ?? calculatedChatRanking[0]?.metric ?? null
  const chatAttentionHighlight = chatOpportunities[0]?.metric ?? null
  const chatAttentionText = chatOpportunities[0]?.reasons.length
    ? formatStatusText(chatOpportunities[0].reasons.join(', '))
    : 'Sem alerta crítico no período.'
  const chatClosureReading =
    !calculationMetrics.length
      ? 'Ainda não há base suficiente para leitura executiva.'
      : chatEligibleCount >= 3 && !chatCriticalCount
        ? 'Fechamento forte: há pódio completo e nenhum caso crítico no período.'
        : chatEligibleCount > 0
          ? 'Fechamento positivo, com oportunidade de ampliar a quantidade de elegíveis ao pódio.'
          : 'Fechamento pede atenção: nenhum analista ficou plenamente elegível ao pódio.'

  const chatBelowVolumeItems = calculatedChatRanking.filter((item) => item.reasons.some((reason) => reason.includes('volume abaixo')))
  const chatBelowCsatMetrics = calculationMetrics.filter((metric) => Number(metric.csat) < 90)
  const chatBelowReviewMetrics = calculationMetrics.filter((metric) => Number(metric.review_percentage) < Number(metric.general_review_goal))
  const chatCriticalMetrics = calculationMetrics.filter((metric) => metric.status === 'Critico')
  const chatEligibleItems = calculatedChatRanking.filter((item) => item.eligible)
  const chatFunnelItems = [
    {
      label: 'Base analisada',
      value: calculationMetrics.length,
      detail: activePodiumExclusions.length
        ? `${activePodiumExclusions.length} analista(s) desconsiderado(s) por exceção operacional.`
        : 'Analistas com dados válidos no período.',
    },
    {
      label: 'CSAT mínimo',
      value: calculationMetrics.filter((metric) => Number(metric.csat) >= 90).length,
      detail: 'Mantêm qualidade percebida acima de 90%.',
    },
    {
      label: 'Avaliações',
      value: calculationMetrics.filter((metric) => Number(metric.review_percentage) >= Number(metric.general_review_goal)).length,
      detail: 'Têm amostra de avaliações dentro da referência.',
    },
    {
      label: 'Volume',
      value: calculationMetrics.filter((metric) => Number(metric.total_tickets) >= averageTickets).length,
      detail: `Atendem pelo menos a média de ${averageTickets} atendimentos.`,
    },
    {
      label: 'Elegíveis',
      value: chatEligibleCount,
      detail: 'Cumpriram todos os critérios ao mesmo tempo.',
      tone: 'success' as const,
    },
  ]
  const chatBelowVolumeCount = chatBelowVolumeItems.length
  const chatBelowCsatCount = chatBelowCsatMetrics.length
  const chatBelowReviewCount = chatBelowReviewMetrics.length
  const chatNameList = (names: string[]) => {
    if (!names.length) return 'nenhum analista'
    if (names.length === 1) return names[0]
    if (names.length === 2) return `${names[0]} e ${names[1]}`
    return `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`
  }
  const chatBelowCsatNames = chatBelowCsatMetrics.slice(0, 3).map(getChatAnalystName)
  const chatBelowReviewNames = chatBelowReviewMetrics.slice(0, 3).map(getChatAnalystName)
  const chatBelowVolumeNames = chatBelowVolumeItems.slice(0, 3).map((item) => getChatAnalystName(item.metric))
  const chatCriticalNames = chatCriticalMetrics.slice(0, 3).map(getChatAnalystName)
  const chatEligibleNames = chatEligibleItems.slice(0, 3).map((item) => getChatAnalystName(item.metric))
  const chatManagementDiagnosis =
    !calculationMetrics.length
      ? 'Sem base importada para o período selecionado.'
      : chatCriticalCount > 0
        ? `Há risco real de fechamento: ${chatNameList(chatCriticalNames)} precisam de tratativa antes da comunicação final.`
        : averageCsat < 90
          ? `O principal risco está na qualidade percebida. ${chatBelowCsatCount} analista(s) ficaram abaixo de 90% de CSAT, começando por ${chatNameList(chatBelowCsatNames)}.`
          : averageReviews < 25
            ? `A qualidade está legível, mas a amostra de avaliações está baixa. Priorize aumento de respostas com ${chatNameList(chatBelowReviewNames)}.`
            : chatBelowVolumeCount > 0
              ? `O fechamento geral é saudável, mas o pódio depende de contexto operacional: ${chatBelowVolumeCount} analista(s) ficaram abaixo da média de ${averageTickets} atendimentos.`
              : 'Fechamento saudável: qualidade, amostra de avaliações e volume sustentam a leitura do período.'
  const chatTacticalPlan = !calculationMetrics.length
    ? ['Importar as planilhas do Zendesk.', 'Conferir se mês, equipe e analistas foram reconhecidos.', 'Selecionar equipe e período para liberar a leitura de gestão.']
    : [
        chatBelowCsatCount
          ? `Qualidade: ouvir duas interações mal avaliadas de ${chatNameList(chatBelowCsatNames)}, identificar o comportamento que prejudicou a experiência do cliente e combinar uma mudança objetiva com cada pessoa.`
          : `Qualidade: ouvir atendimentos bem avaliados de ${chatNameList(chatEligibleNames)}, identificar o que funcionou na abordagem e compartilhar esse exemplo com a equipe.`,
        chatBelowReviewCount
          ? `Avaliações: orientar ${chatNameList(chatBelowReviewNames)} a concluir o atendimento confirmando a solução e, em seguida, convidar o cliente a responder à pesquisa. Conferir no próximo fechamento se a participação aumentou.`
          : 'Avaliações: manter a forma de encerramento atual: confirmar que a solicitação foi resolvida e convidar o cliente a avaliar. Essa prática manteve a participação acima da referência de 25%.',
        chatBelowVolumeCount
          ? `Volume: observar se o resultado de ${chatNameList(chatBelowVolumeNames)} foi afetado por disponibilidade para puxar novos tickets, tempo dos atendimentos, pausas, ausência ou apoio a outro setor. Só tratar como desempenho individual depois de verificar o contexto operacional.`
          : 'Volume: manter a dinâmica atual da fila e monitorar apenas exceções operacionais.',
      ]
  const chatStrategicDecision =
    !calculationMetrics.length
      ? 'Decisão recomendada: aguardar a importação mensal antes de definir plano de gestão.'
      : chatCriticalCount > 0
        ? `Antes de publicar o fechamento, analisar individualmente ${chatNameList(chatCriticalNames)}, registrar a causa dos indicadores críticos e combinar uma ação com prazo para o próximo ciclo.`
        : chatEligibleCount >= 3
          ? `Antes de publicar o ranking, confirme se apoio a outro setor, ausências, pausas ou diferenças de disponibilidade para puxar tickets exigem algum ajuste. Depois, reconheça ${chatNameList(chatEligibleNames)} e compartilhe com a equipe os comportamentos que sustentaram os resultados.`
          : 'Antes de publicar o ranking, separe as exceções operacionais dos resultados individuais. Depois, escolha o indicador com maior impacto e defina uma ação para aumentar a quantidade de elegíveis no próximo ciclo.'
  const chatStrategicTrend =
    !calculationMetrics.length
      ? 'Sem tendência calculada.'
      : chatCsatDelta >= 0 && chatReviewDelta >= 0
        ? `Evolução favorável: o CSAT passou de ${formatChatPercent(previousAverageCsat)} para ${formatChatPercent(averageCsat)}, e as avaliações passaram de ${formatChatPercent(previousAverageReviews)} para ${formatChatPercent(averageReviews)}. Mantenha as práticas que produziram essa melhora.`
        : chatCsatDelta < 0 && chatReviewDelta < 0
          ? `Alerta duplo: o CSAT caiu de ${formatChatPercent(previousAverageCsat)} para ${formatChatPercent(averageCsat)}, e a participação nas avaliações caiu de ${formatChatPercent(previousAverageReviews)} para ${formatChatPercent(averageReviews)}. Revise atendimentos mal avaliados e a forma de encerramento antes de concluir o fechamento.`
          : chatCsatDelta < 0
            ? `Alerta de qualidade: o CSAT caiu de ${formatChatPercent(previousAverageCsat)} para ${formatChatPercent(averageCsat)}. Priorize a leitura dos atendimentos negativos e alinhe o comportamento que precisa mudar.`
            : `Alerta de participação: as avaliações passaram de ${formatChatPercent(previousAverageReviews)} para ${formatChatPercent(averageReviews)}. A qualidade pode estar preservada, mas é preciso aumentar a quantidade de clientes que respondem à pesquisa.`

  const chatManagementPriorities = chatOpportunities.slice(0, 5).map((item) => {
    const reasons = item.reasons
    const action =
      reasons.some((reason) => reason.includes('CSAT'))
        ? 'Revisar avaliações negativas e alinhar um comportamento observável para o próximo ciclo.'
        : reasons.some((reason) => reason.includes('avaliações'))
          ? 'Reforçar o encerramento do atendimento e acompanhar a participação na pesquisa.'
          : reasons.some((reason) => reason.includes('volume'))
            ? 'Validar contexto operacional antes de tratar o volume como desempenho individual.'
            : 'Acompanhar a evolução do indicador antes do próximo fechamento.'

    return {
      analyst: getChatAnalystName(item.metric),
      team: getChatTeamName(item.metric),
      reasons,
      action,
      csat: Number(item.metric.csat),
      reviews: Number(item.metric.review_percentage),
      tickets: Number(item.metric.total_tickets),
    }
  })

  const chatMonthlyContextCards = [
    {
      label: 'Mês analisado',
      value: selectedPeriod?.label ?? 'Período',
      detail: selectedTeamName,
    },
    {
      label: 'Comparativo',
      value: previousPeriod?.label ?? 'Sem mês anterior',
      detail: previousPeriod
        ? 'Leitura comparada com o fechamento mensal anterior da mesma equipe.'
        : 'Importe meses anteriores para liberar tendência e comparação.',
    },
    {
      label: 'Base consolidada',
      value: `${calculationMetrics.length} analista(s)`,
      detail: `${totals.tickets} atendimentos, ${totals.validTickets} válidos e ${totals.reviews} avaliações.`,
    },
  ]

  const chatMonthlyManagementCards = [
    {
      label: 'Reconhecimento',
      title:
        chatEligibleCount >= 3
          ? 'Pódio sustentado'
          : chatEligibleCount > 0
            ? 'Há destaques para reconhecer'
            : 'Reconhecimento seletivo',
      text:
        chatEligibleCount >= 3
          ? `Reconhecer o pódio e usar ${chatNameList(chatEligibleNames)} como referência de comportamento para o próximo mês.`
          : chatEligibleCount > 0
            ? `Reconhecer ${chatNameList(chatEligibleNames)} e separar o que foi prática individual do que foi contexto operacional.`
            : 'Sem pódio completo no período; reconhecer evoluções pontuais e evitar premiar sem cumprir os critérios.',
    },
    {
      label: 'Acompanhamento',
      title: chatOpportunities.length ? 'Priorizar analistas em atenção' : 'Sem fila crítica de acompanhamento',
      text: chatOpportunities.length
        ? `Começar por ${chatNameList(chatOpportunities.slice(0, 3).map((item) => getChatAnalystName(item.metric)))} e registrar uma ação objetiva por indicador pendente.`
        : 'Manter acompanhamento leve e repetir as práticas que sustentaram o fechamento.',
    },
    {
      label: 'Exceções operacionais',
      title: chatBelowVolumeCount ? 'Validar volume antes do pódio' : 'Volume sem exceção relevante',
      text: chatBelowVolumeCount
        ? `Antes de fechar o pódio, validar se ${chatNameList(chatBelowVolumeNames)} tiveram apoio a outro setor, ausência, pausas, atendimentos mais longos ou menor disponibilidade para puxar tickets.`
        : 'Não há alerta relevante de volume abaixo da média para justificar exceção operacional.',
    },
    {
      label: 'Próximo fechamento',
      title: averageCsat >= 90 && averageReviews >= 25 ? 'Repetir o que funcionou' : 'Corrigir o indicador prioritário',
      text:
        averageCsat >= 90 && averageReviews >= 25
          ? 'No próximo mês, verificar se CSAT e participação nas avaliações continuam acima das referências sem depender apenas de um ou dois destaques.'
          : 'No próximo mês, definir uma prioridade: qualidade se o CSAT caiu, participação se houve poucas avaliações, ou volume se existiu distorção operacional.',
    },
  ]

  function resetChatAnalystForm() {
    setEditingChatAnalystId(null)
    setChatAnalystForm({ teamId: teams[0]?.id ?? '', name: '', csatGoal: '86', photoFile: null })
  }

  async function handleChatAnalystSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setChatAnalystMessage('')

    const name = chatAnalystForm.name.trim()
    const csatGoal = Number(chatAnalystForm.csatGoal)

    if (!chatAnalystForm.teamId) {
      setChatAnalystMessage('Selecione uma equipe antes de salvar o analista.')
      return
    }

    if (!name) {
      setChatAnalystMessage('Informe o nome do analista.')
      return
    }

    if (Number.isNaN(csatGoal) || csatGoal < 0 || csatGoal > 100) {
      setChatAnalystMessage('Informe uma meta CSAT entre 0 e 100.')
      return
    }

    setChatAnalystSaving(true)

    try {
      const payload = {
        team_id: chatAnalystForm.teamId,
        name,
        csat_goal: csatGoal,
      }

      const saveResult = editingChatAnalystId
        ? await supabase.from('chat_analysts').update(payload).eq('id', editingChatAnalystId).select('id').single()
        : await supabase.from('chat_analysts').insert({ ...payload, active: true }).select('id').single()

      if (saveResult.error) throw saveResult.error

      if (chatAnalystForm.photoFile) {
        const analystId = editingChatAnalystId ?? saveResult.data.id
        const photoUrl = await uploadAnalystPhoto(chatAnalystForm.photoFile, 'chat', analystId)
        const { error: photoError } = await supabase.from('chat_analysts').update({ photo_url: photoUrl }).eq('id', analystId)
        if (photoError) throw photoError
        setChatAnalystPhotoOverrides((current) => ({ ...current, [analystId]: photoUrl }))
      }

      if (editingChatAnalystId) {
        await syncChatMetricGoalsForAnalyst(editingChatAnalystId, csatGoal)
      }

      await onImportComplete()
      resetChatAnalystForm()
      setChatAnalystMessage(editingChatAnalystId ? 'Analista atualizado com sucesso.' : 'Analista incluido com sucesso.')
    } catch (error) {
      setChatAnalystMessage(getErrorMessage(error))
    } finally {
      setChatAnalystSaving(false)
    }
  }

  async function syncChatMetricGoalsForAnalyst(analystId: string, csatGoal: number) {
    const { data, error } = await supabase
      .from('chat_monthly_metrics')
      .select('id, csat, review_percentage')
      .eq('analyst_id', analystId)

    if (error) throw error

    const updates = (data ?? []).map((metric) => ({
      id: metric.id,
      csat_goal: csatGoal,
      csat_delta: round(Number(metric.csat) - csatGoal),
      status: getChatMetricStatus(Number(metric.csat), Number(metric.review_percentage), csatGoal, 25),
    }))

    if (!updates.length) return

    const { error: updateError } = await supabase.from('chat_monthly_metrics').upsert(updates)
    if (updateError) throw updateError
  }
  function handleEditChatAnalyst(analyst: ChatAnalyst) {
    setEditingChatAnalystId(analyst.id)
    setChatAnalystForm({
      teamId: analyst.team_id,
      name: analyst.name,
      csatGoal: String(analyst.csat_goal),
      photoFile: null,
    })
    setChatAnalystMessage('')
  }

  async function handleToggleChatAnalyst(analyst: ChatAnalyst) {
    setChatAnalystMessage('')
    setChatAnalystSaving(true)

    try {
      const { error } = await supabase
        .from('chat_analysts')
        .update({ active: !analyst.active })
        .eq('id', analyst.id)

      if (error) throw error

      await onImportComplete()
      if (editingChatAnalystId === analyst.id) resetChatAnalystForm()
      setChatAnalystMessage(analyst.active ? 'Analista inativado com sucesso.' : 'Analista reativado com sucesso.')
    } catch (error) {
      setChatAnalystMessage(getErrorMessage(error))
    } finally {
      setChatAnalystSaving(false)
    }
  }

  async function handleDeleteChatAnalyst(analyst: ChatAnalyst) {
    setChatAnalystMessage('')

    if (chatAnalystIdsWithHistory.has(analyst.id)) {
      setChatAnalystMessage(
        `${analyst.name} possui histórico importado e não pode ser excluído. Use Inativar para preservar os resultados anteriores.`,
      )
      return
    }

    const confirmed = window.confirm(
      `Excluir definitivamente o cadastro de ${analyst.name}? Esta opção é destinada apenas a cadastros criados por engano e sem histórico.`,
    )

    if (!confirmed) return

    setChatAnalystSaving(true)

    try {
      const { error } = await supabase.from('chat_analysts').delete().eq('id', analyst.id)

      if (error) throw error

      await onImportComplete()
      if (editingChatAnalystId === analyst.id) resetChatAnalystForm()
      setChatAnalystMessage('Analista excluido com sucesso.')
    } catch (error) {
      setChatAnalystMessage(`${getErrorMessage(error)} Se este analista ja tiver historico, inative em vez de excluir.`)
    } finally {
      setChatAnalystSaving(false)
    }
  }

  async function handleRemoveChatAnalystPhoto(analyst: ChatAnalyst) {
    if (!window.confirm(`Remover a foto personalizada de ${analyst.name}?`)) return
    setChatAnalystSaving(true)
    const { error } = await supabase.from('chat_analysts').update({ photo_url: null }).eq('id', analyst.id)
    setChatAnalystSaving(false)
    if (error) {
      setChatAnalystMessage(getSupabaseMessage(error.message))
      return
    }
    setChatAnalystPhotoOverrides((current) => ({ ...current, [analyst.id]: null }))
    await onImportComplete()
    setChatAnalystMessage('Foto personalizada removida. A imagem inicial ou as iniciais serão exibidas.')
  }
  function getChatPodiumExclusion(metric: ChatMonthlyMetric) {
    return podiumExclusions.find(
      (exclusion) =>
        exclusion.analyst_id === metric.analyst_id &&
        exclusion.team_id === metric.team_id &&
        exclusion.year === metric.year &&
        exclusion.month_number === metric.month_number,
    )
  }

  function getManualPodiumDraftValue(position: number) {
    const source =
      chatActiveTab === 'reports' ? chatReportActiveManualPodium : activeManualPodium
    return manualPodiumDraft[position] ?? source.find((item) => item.position === position)?.analyst_id ?? ''
  }
  async function handleSaveChatManualPodium() {
    setChatPodiumMessage('')

    const podiumPeriod =
      chatActiveTab === 'reports' ? chatReportPeriod : selectedPeriod

    if (!podiumPeriod) {
      setChatPodiumMessage('Selecione um período antes de salvar o pódio manual.')
      return
    }

    if (selectedTeamId === 'all') {
      setChatPodiumMessage('Selecione uma equipe especifica para salvar o pódio manual.')
      return
    }

    const rows = [1, 2, 3]
      .map((position) => {
        const analystId = getManualPodiumDraftValue(position)
        return analystId
          ? {
              team_id: selectedTeamId,
              analyst_id: analystId,
              year: podiumPeriod.year,
              month_number: podiumPeriod.monthNumber,
              position,
            }
          : null
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row))

    if (!rows.length) {
      setChatPodiumMessage('Selecione pelo menos um analista para salvar o pódio manual.')
      return
    }

    if (new Set(rows.map((row) => row.analyst_id)).size !== rows.length) {
      setChatPodiumMessage('O mesmo analista nao pode ocupar mais de uma posição.')
      return
    }

    const eligibleIds =
      chatActiveTab === 'reports' ? chatReportManualEligibleIds : manualPodiumEligibleIds
    const ineligibleManualSelection = rows.find(
      (row) => !eligibleIds.has(row.analyst_id),
    )
    if (ineligibleManualSelection) {
      setChatPodiumMessage(
        'O ajuste manual só pode reorganizar analistas elegíveis. Quem não cumpre os critérios continua fora do pódio.',
      )
      return
    }

    try {
      const deleteResult = await supabase
        .from('chat_podium_manual')
        .delete()
        .eq('team_id', selectedTeamId)
        .eq('year', podiumPeriod.year)
        .eq('month_number', podiumPeriod.monthNumber)

      if (deleteResult.error) throw deleteResult.error

      const { error } = await supabase.from('chat_podium_manual').insert(rows)

      if (error) throw error

      await onImportComplete()
      setChatPodiumMessage('Pódio manual salvo para este período.')
    } catch (error) {
      setChatPodiumMessage(`Erro ao salvar pódio manual: ${getErrorMessage(error)}`)
    }
  }

  async function handleResetChatManualPodium() {
    setChatPodiumMessage('')

    const podiumPeriod =
      chatActiveTab === 'reports' ? chatReportPeriod : selectedPeriod

    if (!podiumPeriod || selectedTeamId === 'all') {
      setChatPodiumMessage('Selecione uma equipe especifica para resetar o pódio manual.')
      return
    }

    try {
      const { error } = await supabase
        .from('chat_podium_manual')
        .delete()
        .eq('team_id', selectedTeamId)
        .eq('year', podiumPeriod.year)
        .eq('month_number', podiumPeriod.monthNumber)

      if (error) throw error

      setManualPodiumDraft({})
      await onImportComplete()
      setChatPodiumMessage('Pódio manual removido. O ranking automático voltou a valer.')
    } catch (error) {
      setChatPodiumMessage(getErrorMessage(error))
    }
  }

  async function handleToggleChatPodiumExclusion(metric: ChatMonthlyMetric) {
    setChatExportMessage('')

    const currentExclusion = getChatPodiumExclusion(metric)

    try {
      if (currentExclusion) {
        const { error } = await supabase.from('chat_podium_exclusions').delete().eq('id', currentExclusion.id)
        if (error) throw error
        setChatExportMessage(`${getChatAnalystName(metric)} voltou a compor o ranking e a concorrer ao pódio deste período.`)
      } else {
        const reason = window.prompt(
          `Motivo para desconsiderar ${getChatAnalystName(metric)} do ranking e do pódio deste período:`,
          'Emprestimo para outro setor / volume atipico',
        )

        if (reason === null) return

        const { error } = await supabase.from('chat_podium_exclusions').upsert(
          {
            team_id: metric.team_id,
            analyst_id: metric.analyst_id,
            year: metric.year,
            month_number: metric.month_number,
            reason: reason.trim() || 'Excecao operacional',
          },
          { onConflict: 'team_id,analyst_id,year,month_number' },
        )
        if (error) throw error
        setChatExportMessage(
          `${getChatAnalystName(metric)} foi desconsiderado do ranking e do pódio deste período. O resultado oficial da competência permanece preservado.`,
        )
      }

      await onImportComplete()
    } catch (error) {
      setChatExportMessage(getErrorMessage(error))
    }
  }

  async function handlePrepareChatQualitativeSample() {
    if (!selectedChatReportMetric) {
      setChatReportQualitativeStatus('Selecione um analista antes de preparar a leitura qualitativa.')
      return
    }

    setChatReportQualitativePreparing(true)
    setChatReportQualitativeStatus('Preparando amostra qualitativa...')

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session?.access_token) {
        setChatReportQualitativeStatus('Sua sessão expirou. Entre novamente.')
        return
      }

      const metric = selectedChatReportMetric
      const start = `${metric.year}-${String(metric.month_number).padStart(2, '0')}-01`
      const end = new Date(Date.UTC(metric.year, metric.month_number, 0))
        .toISOString()
        .slice(0, 10)
      const params = new URLSearchParams({
        start,
        end,
        analyst_id: metric.analyst_id,
      })

      const sampleResponse = await fetch(
        `/api/clickdesk/evaluated-sample?${params.toString()}`,
        {
          headers: { Authorization: `Bearer ${session.access_token}` },
          cache: 'no-store',
        },
      )
      const sample = (await sampleResponse.json()) as ClickDeskEvaluatedSampleResponse

      if (!sampleResponse.ok) {
        throw new Error(
          sample.erro || sample.error || 'Não foi possível montar a amostra qualitativa.',
        )
      }

      const sampleTickets = [
        ...(sample.negative ?? []),
        ...(sample.positive ?? []),
      ]

      if (!sampleTickets.length) {
        setChatReportQualitativeStatus('Este analista ainda não possui avaliações elegíveis para a amostra.')
        return
      }

      let completed = 0
      let cached = 0
      let failed = 0

      for (const ticket of sampleTickets) {
        try {
          const response = await fetch('/api/clickdesk/qualitative', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${session.access_token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ ticket_id: ticket.ticket_id }),
          })
          const result = (await response.json()) as ClickDeskQualitativeResponse

          if (!response.ok || result.error) {
            failed += 1
            continue
          }

          completed += 1
          if (result.cached) cached += 1
        } catch {
          failed += 1
        }
      }

      const negativeCount = sample.negative?.length ?? 0
      const positiveCount = sample.positive?.length ?? 0
      const reusedText = cached > 0 ? ` · ${cached} reaproveitada(s) do cache` : ''
      const failedText = failed > 0 ? ` · ${failed} não concluída(s)` : ''

      setChatReportQualitativeStatus(
        `Leitura preparada: ${completed} de ${sampleTickets.length} tickets (${negativeCount} negativos + ${positiveCount} positivos)${reusedText}${failedText}. Valide as leituras em Gestão e ações; somente as aprovadas entram no feedback.`,
      )
    } catch (error) {
      setChatReportQualitativeStatus(getErrorMessage(error))
    } finally {
      setChatReportQualitativePreparing(false)
    }
  }

  async function loadChatQualitativeFeedbackContext(
    metric: ChatMonthlyMetric,
  ): Promise<ChatQualitativeFeedbackContext | undefined> {
    const start = `${metric.year}-${String(metric.month_number).padStart(2, '0')}-01`
    const end = new Date(Date.UTC(metric.year, metric.month_number, 0))
      .toISOString()
      .slice(0, 10)

    const result = await supabase
      .from('clickdesk_qualitative_analyses')
      .select('satisfaction_label,occurred_date,analysis')
      .eq('analyst_id', metric.analyst_id)
      .eq('validation_status', 'approved')
      .gte('occurred_date', start)
      .lte('occurred_date', end)
      .order('occurred_date', { ascending: true })
      .limit(8)

    if (result.error || !result.data?.length) return undefined

    const findings = result.data
      .map((item) => ({
        satisfactionLabel: item.satisfaction_label,
        occurredDate: item.occurred_date,
        analysis: item.analysis as ClickDeskQualitativeResponse['analysis'],
      }))
      .filter(
        (
          item,
        ): item is {
          satisfactionLabel: string | null
          occurredDate: string | null
          analysis: NonNullable<ClickDeskQualitativeResponse['analysis']>
        } => Boolean(item.analysis),
      )

    return {
      analyzedCount: findings.length,
      negativeAnalyzed: findings.filter((item) => item.satisfactionLabel === 'negative').length,
      positiveAnalyzed: findings.filter((item) => item.satisfactionLabel === 'positive').length,
      negativeTotal: Number(metric.negative_reviews),
      positiveTotal: Number(metric.positive_reviews),
      findings,
    }
  }

  async function loadChatReportHistoryMetrics(
    metric: ChatMonthlyMetric,
  ): Promise<ChatMonthlyMetric[]> {
    if (!chatReportUsesClickDesk) {
      return metrics
        .filter((historyMetric) => historyMetric.analyst_id === metric.analyst_id)
        .sort((a, b) =>
          a.year === b.year
            ? a.month_number - b.month_number
            : a.year - b.year,
        )
    }

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session?.access_token) return [metric]

      const params = new URLSearchParams({ analyst_id: metric.analyst_id })
      const response = await fetch(
        `/api/clickdesk/history?${params.toString()}`,
        {
          headers: { Authorization: `Bearer ${session.access_token}` },
          cache: 'no-store',
        },
      )
      const data = (await response.json()) as ClickDeskAnalystHistory
      if (!response.ok || !data.points?.length) return [metric]

      const analystName = getChatAnalystName(metric)
      const analystPhoto =
        analysts.find((analyst) => analyst.id === metric.analyst_id)?.photo_url ??
        getChatAnalystPhoto(metric)

      return data.points.map((point) => {
        const [yearText, monthText] = point.month.split('-')
        const year = Number(yearText)
        const monthNumber = Number(monthText)
        const period = getChatMonthPeriod(year, monthNumber)
        const csatGoal = Number(point.csat_goal ?? metric.csat_goal ?? 90)
        const reviewGoal = Number(point.review_goal ?? 25)
        const csat = Number(point.csat ?? 0)
        const reviewPercentage = Number(point.review_percentage ?? 0)

        return {
          id: `clickdesk-history:${point.month}:${metric.analyst_id}`,
          team_id: point.team_id ?? metric.team_id,
          analyst_id: metric.analyst_id,
          month_label: point.label,
          year,
          month_number: monthNumber,
          period_start: period.start,
          period_end: period.end,
          csat,
          review_percentage: reviewPercentage,
          sending_percentage: round(Math.max(0, 100 - reviewPercentage)),
          total_tickets: Number(point.attendances ?? 0),
          inactive_tickets: 0,
          valid_tickets: Number(point.attendances ?? 0),
          reviews: Number(point.reviews ?? 0),
          positive_reviews: Number(point.positive_reviews ?? 0),
          negative_reviews: Number(point.negative_reviews ?? 0),
          csat_goal: csatGoal,
          csat_delta: round(csat - csatGoal),
          general_review_goal: reviewGoal,
          status:
            csat >= csatGoal && reviewPercentage >= reviewGoal
              ? 'Meta Superada'
              : csat < csatGoal && reviewPercentage < reviewGoal
                ? 'Critico'
                : 'Em acompanhamento',
          chat_analysts: {
            name: analystName,
            csat_goal: csatGoal,
            photo_url: analystPhoto,
          },
          chat_teams: {
            name: point.team_name ?? getChatTeamName(metric),
          },
        }
      })
    } catch {
      return [metric]
    }
  }

  function handleGenerateChatFeedbackDraft() {
    if (!selectedChatReportMetric) {
      setChatExportMessage('Selecione um analista com dados antes de gerar o feedback.')
      return
    }

    setChatFeedbackDraft(chatReportFeedbackSuggestion)
    setChatExportMessage('Base factual gerada. Você pode revisá-la ou pedir à IA uma devolutiva personalizada.')
  }

  async function handleGenerateChatFeedbackWithAi() {
    if (!selectedChatReportMetric) {
      setChatExportMessage('Selecione um analista com dados antes de acionar a IA.')
      return
    }

    setChatAiSaving(true)
    setChatExportMessage('Gerando feedback com IA...')

    try {
      const reportHistory = await loadChatReportHistoryMetrics(selectedChatReportMetric)
      const history = reportHistory.map((historyMetric) => ({
        monthLabel: historyMetric.month_label,
        csat: Number(historyMetric.csat),
        reviewPercentage: Number(historyMetric.review_percentage),
        sendingPercentage: Number(historyMetric.sending_percentage),
        totalTickets: Number(historyMetric.total_tickets),
      }))
      const qualitativeContext = await loadChatQualitativeFeedbackContext(selectedChatReportMetric)
      const response = await fetch('/api/chat-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceModule: 'chat',
          dataSourceLabel: chatReportSourceLabel,
          feedbackStyle: chatFeedbackStyle,
          feedbackGoal: chatFeedbackGoal,
          generationMode: 'generate',
          periodLabel: chatReportPeriod.label,
          managerNotes: chatManagerNotes,
          fallbackText: chatReportFeedbackSuggestion,
          averageTickets: chatReportAverageTickets,
          podiumPosition: selectedChatPodiumPosition,
          metric: {
            analystName: getChatAnalystName(selectedChatReportMetric),
            teamName: getChatTeamName(selectedChatReportMetric),
            csat: Number(selectedChatReportMetric.csat),
            reviewPercentage: Number(selectedChatReportMetric.review_percentage),
            sendingPercentage: Number(selectedChatReportMetric.sending_percentage),
            totalTickets: Number(selectedChatReportMetric.total_tickets),
            inactiveTickets: Number(selectedChatReportMetric.inactive_tickets),
            validTickets: Number(selectedChatReportMetric.valid_tickets),
            reviews: Number(selectedChatReportMetric.reviews),
            positiveReviews: Number(selectedChatReportMetric.positive_reviews),
            negativeReviews: Number(selectedChatReportMetric.negative_reviews),
            csatGoal: Number(selectedChatReportMetric.csat_goal),
            reviewGoal: Number(selectedChatReportMetric.general_review_goal),
            status: selectedChatReportMetric.status,
          },
          monthlyHistory: history,
          qualitativeContext,
        }),
      })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data?.error || 'Não foi possível gerar feedback com IA.')
      }

      const safeFeedback = normalizeChatReportFeedback(data.feedback, chatReportFeedbackSuggestion, chatFeedbackStyle)
      setChatFeedbackDraft(safeFeedback)
      setChatExportMessage(data.warning || 'Devolutiva personalizada gerada com IA. Revise o texto antes de exportar.')
    } catch (error) {
      setChatExportMessage(getErrorMessage(error))
    } finally {
      setChatAiSaving(false)
    }
  }

  async function handleImproveChatFeedbackWithAi() {
    if (!selectedChatReportMetric) {
      setChatExportMessage('Selecione um analista com dados antes de acionar a IA.')
      return
    }

    const baseFeedback = chatFeedbackDraft.trim() || chatReportFeedbackSuggestion

    if (!baseFeedback.trim()) {
      setChatExportMessage('Gere uma sugestão ou escreva um texto antes de pedir melhoria com IA.')
      return
    }

    setChatAiSaving(true)
    setChatExportMessage('Melhorando texto com IA...')

    try {
      const reportHistory = await loadChatReportHistoryMetrics(selectedChatReportMetric)
      const history = reportHistory.map((historyMetric) => ({
        monthLabel: historyMetric.month_label,
        csat: Number(historyMetric.csat),
        reviewPercentage: Number(historyMetric.review_percentage),
        sendingPercentage: Number(historyMetric.sending_percentage),
        totalTickets: Number(historyMetric.total_tickets),
      }))
      const qualitativeContext = await loadChatQualitativeFeedbackContext(selectedChatReportMetric)
      const response = await fetch('/api/chat-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceModule: 'chat',
          dataSourceLabel: chatReportSourceLabel,
          feedbackStyle: chatFeedbackStyle,
          feedbackGoal: chatFeedbackGoal,
          generationMode: 'improve',
          periodLabel: chatReportPeriod.label,
          managerNotes: chatManagerNotes,
          fallbackText: baseFeedback,
          averageTickets: chatReportAverageTickets,
          podiumPosition: selectedChatPodiumPosition,
          metric: {
            analystName: getChatAnalystName(selectedChatReportMetric),
            teamName: getChatTeamName(selectedChatReportMetric),
            csat: Number(selectedChatReportMetric.csat),
            reviewPercentage: Number(selectedChatReportMetric.review_percentage),
            sendingPercentage: Number(selectedChatReportMetric.sending_percentage),
            totalTickets: Number(selectedChatReportMetric.total_tickets),
            inactiveTickets: Number(selectedChatReportMetric.inactive_tickets),
            validTickets: Number(selectedChatReportMetric.valid_tickets),
            reviews: Number(selectedChatReportMetric.reviews),
            positiveReviews: Number(selectedChatReportMetric.positive_reviews),
            negativeReviews: Number(selectedChatReportMetric.negative_reviews),
            csatGoal: Number(selectedChatReportMetric.csat_goal),
            reviewGoal: Number(selectedChatReportMetric.general_review_goal),
            status: selectedChatReportMetric.status,
          },
          monthlyHistory: history,
          qualitativeContext,
        }),
      })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data?.error || 'Não foi possível melhorar o feedback com IA.')
      }

      const safeFeedback = normalizeChatReportFeedback(data.feedback, baseFeedback, chatFeedbackStyle)
      setChatFeedbackDraft(safeFeedback)
      setChatExportMessage(data.warning || 'Texto reorganizado e personalizado com IA. Revise antes de exportar.')
    } catch (error) {
      setChatExportMessage(getErrorMessage(error))
    } finally {
      setChatAiSaving(false)
    }
  }

  function buildChatReportExportPayload(
    qualitativeContext: ChatQualitativeFeedbackContext | undefined,
    monthlyHistory: ChatMonthlyMetric[],
  ) {
    if (!selectedChatReportMetric) return null

    const finalFeedbackText = normalizeChatReportFeedback(chatFeedbackDraft, chatReportFeedbackSuggestion, chatFeedbackStyle)

    return {
      metric: selectedChatReportMetric,
      periodLabel: chatReportPeriod.label,
      averageTickets: chatReportAverageTickets,
      podiumPosition: selectedChatPodiumPosition,
      monthlyHistory,
      managerNotes: chatManagerNotes,
      feedbackText: finalFeedbackText,
      qualitativeContext,
      dataSourceLabel: chatReportSourceLabel,
      photoUrl: getAnalystPhoto(
        getChatAnalystName(selectedChatReportMetric),
        analysts.find((analyst) => analyst.id === selectedChatReportMetric.analyst_id)?.photo_url,
      ),
    }
  }

  async function handleExportChatIndividualReport() {
    if (!selectedChatReportMetric) {
      setChatExportMessage('Selecione um analista com dados antes de exportar o relatório individual.')
      return
    }

    try {
      setChatExportMessage('Preparando relatório e incorporando a foto do analista...')
      const qualitativeContext = await loadChatQualitativeFeedbackContext(
        selectedChatReportMetric,
      )
      const monthlyHistory = await loadChatReportHistoryMetrics(selectedChatReportMetric)
      const payload = buildChatReportExportPayload(qualitativeContext, monthlyHistory)

      if (!payload) {
        setChatExportMessage('Não foi possível montar os dados do relatório individual.')
        return
      }

      const fileName = await exportChatIndividualReport(payload)
      setChatExportMessage(`Relatório individual gerado: ${fileName}. Verifique a pasta Downloads.`)
    } catch (error) {
      setChatExportMessage(`Não foi possível gerar o relatório individual. ${getErrorMessage(error)}`)
    }
  }

  const chat2Periods = Array.from({ length: 12 }, (_, index) => {
    const date = new Date()
    date.setDate(1)
    date.setMonth(date.getMonth() - index)
    const year = date.getFullYear()
    const monthNumber = date.getMonth() + 1
    const period = getChatMonthPeriod(year, monthNumber)
    return { ...period, year, monthNumber, key: `${year}-${monthNumber}` }
  })
  const chatReportPeriods = Array.from(
    new Map(
      [
        ...chat2Periods,
        ...periods.map((period) => ({
          ...getChatMonthPeriod(period.year, period.monthNumber),
          label: period.label,
          year: period.year,
          monthNumber: period.monthNumber,
          key: `${period.year}-${period.monthNumber}`,
        })),
      ].map((period) => [period.key, period]),
    ).values(),
  ).sort((a, b) => b.start.localeCompare(a.start))
  const chat2PeriodOptions =
    chatActiveTab === 'reports' ? chatReportPeriods : chat2Periods
  const chat2SelectedPeriod =
    chat2PeriodOptions.find((period) => period.key === chat2PeriodKey) ??
    chat2PeriodOptions[0] ??
    chat2Periods[0]
  const chat2PreviousDate = new Date(Date.UTC(chat2SelectedPeriod.year, chat2SelectedPeriod.monthNumber - 2, 1))
  const chat2PreviousPeriod = {
    ...getChatMonthPeriod(chat2PreviousDate.getUTCFullYear(), chat2PreviousDate.getUTCMonth() + 1),
    year: chat2PreviousDate.getUTCFullYear(),
    monthNumber: chat2PreviousDate.getUTCMonth() + 1,
  }

  useEffect(() => {
    void loadClickDeskPersistedMetricsOnly(
      {
        start: chat2SelectedPeriod.start,
        end: chat2SelectedPeriod.end,
      },
      selectedTeamId,
    )
    void loadClickDeskPreviousMetricsOnly(
      {
        start: chat2PreviousPeriod.start,
        end: chat2PreviousPeriod.end,
      },
      selectedTeamId,
    )
  }, [
    chat2SelectedPeriod.start,
    chat2SelectedPeriod.end,
    chat2PreviousPeriod.start,
    chat2PreviousPeriod.end,
    selectedTeamId,
    isManagementUser,
  ])
  const chat2VisibleMetrics = metrics.filter((metric) => {
    const matchesTeam = selectedTeamId === 'all' || metric.team_id === selectedTeamId
    const matchesPeriod =
      metric.year === chat2SelectedPeriod.year && metric.month_number === chat2SelectedPeriod.monthNumber
    return matchesTeam && matchesPeriod
  })
  const chat2PersistedAnalystRows = clickDeskPersistedMetrics?.by_analyst ?? []
  const chat2DiagnosticAnalystRows = (clickDeskConversationDiagnostic?.human_by_area_assignee ?? []).filter(
    (item) =>
      chat2PersistedAnalystRows.some(
        (persisted) =>
          normalizeChatText(persisted.assignee_name) === normalizeChatText(item.name) &&
          normalizeChatText(persisted.area) === normalizeChatText(item.area),
      ),
  )
  const chat2PersistedHumanRows = chat2PersistedAnalystRows.map((item) => ({
    area: item.area,
    name: item.assignee_name,
    count: item.attendances,
    journey_confirmed: item.attendances,
    satisfaction_labels: {} as Record<string, number>,
    positive_reviews: item.positive_reviews,
    negative_reviews: item.negative_reviews,
    reviews: item.reviews,
    candidate_csat: item.csat,
    candidate_review_percentage: item.review_percentage,
  }))
  const chat2LiveHumanRows =
    chat2DiagnosticAnalystRows.length > 0
      ? chat2DiagnosticAnalystRows
      : chat2PersistedHumanRows
  const chat2SelectedLiveHuman =
    chat2LiveHumanRows.find((item) => `${item.area}::${item.name}` === chat2LiveAnalystKey) ??
    chat2LiveHumanRows[0] ??
    null
  const chat2SelectedPersistedAnalyst = chat2SelectedLiveHuman
    ? chat2PersistedAnalystRows.find(
        (item) =>
          normalizeChatText(item.assignee_name) === normalizeChatText(chat2SelectedLiveHuman.name) &&
          normalizeChatText(item.area) === normalizeChatText(chat2SelectedLiveHuman.area),
      ) ?? null
    : null

  useEffect(() => {
    const analystId = chat2SelectedPersistedAnalyst?.analyst_id
    if (analystId) {
      void loadClickDeskAnalystHistory(analystId)
    } else {
      setClickDeskAnalystHistory(null)
    }
  }, [chat2SelectedPersistedAnalyst?.analyst_id])

  const chat2HistoryPoints = clickDeskAnalystHistory?.points ?? []
  const chat2DailyMap = new Map(
    (chat2SelectedPersistedAnalyst?.daily ?? []).map((item) => [item.date, item]),
  )
  const chat2DailyCoverageDates = [
    ...(clickDeskPersistedMetrics?.performance_daily ?? []).map((item) => item.date),
    ...(clickDeskPersistedMetrics?.daily ?? []).map((item) => item.date),
    ...((clickDeskPersistedMetrics?.by_analyst ?? []).flatMap((item) => item.daily.map((day) => day.date))),
  ].filter(Boolean)
  const chat2DailyCoverageStart =
    chat2DailyCoverageDates.length > 0
      ? [...chat2DailyCoverageDates].sort((a, b) => a.localeCompare(b))[0]
      : null
  const chat2DailyRuler: Array<ClickDeskPersistedAggregate & { date: string; covered: boolean }> = []
  if (clickDeskPersistedMetrics?.period?.start && clickDeskPersistedMetrics?.period?.end) {
    const cursor = new Date(`${clickDeskPersistedMetrics.period.start}T00:00:00Z`)
    const limit = new Date(`${clickDeskPersistedMetrics.period.end}T00:00:00Z`)
    while (cursor <= limit) {
      const date = cursor.toISOString().slice(0, 10)
      const covered = chat2DailyCoverageStart ? date >= chat2DailyCoverageStart : true
      const persistedDay = chat2DailyMap.get(date)
      chat2DailyRuler.push(
        persistedDay
          ? { ...persistedDay, covered: true }
          : {
              date,
              covered,
              attendances: 0,
              positive_reviews: 0,
              negative_reviews: 0,
              reviews: 0,
              csat: null,
              review_percentage: null,
            },
      )
      cursor.setUTCDate(cursor.getUTCDate() + 1)
    }
  }
  const chat2SelectedDayMetric =
    chat2DailyDateFilter === 'all'
      ? null
      : chat2DailyRuler.find((item) => item.date === chat2DailyDateFilter) ?? null
  const chat2LivePositive =
    chat2SelectedPersistedAnalyst?.positive_reviews ?? chat2SelectedLiveHuman?.positive_reviews ?? 0
  const chat2LiveNegative =
    chat2SelectedPersistedAnalyst?.negative_reviews ?? chat2SelectedLiveHuman?.negative_reviews ?? 0
  const chat2LiveReviews =
    chat2SelectedPersistedAnalyst?.reviews ?? chat2SelectedLiveHuman?.reviews ?? 0
  const chat2LiveAttendances =
    chat2SelectedPersistedAnalyst?.attendances ?? chat2SelectedLiveHuman?.count ?? 0
  const chat2TodayAttendances = chat2SelectedPersistedAnalyst?.today.attendances ?? 0
  const chat2LiveCandidateCsat =
    chat2SelectedPersistedAnalyst?.csat !== null && chat2SelectedPersistedAnalyst?.csat !== undefined
      ? round(chat2SelectedPersistedAnalyst.csat)
      : chat2SelectedLiveHuman?.candidate_csat === null || chat2SelectedLiveHuman?.candidate_csat === undefined
        ? null
        : round(chat2SelectedLiveHuman.candidate_csat)
  const chat2LiveCandidateReviewPercentage =
    chat2SelectedPersistedAnalyst?.review_percentage !== null &&
    chat2SelectedPersistedAnalyst?.review_percentage !== undefined
      ? round(chat2SelectedPersistedAnalyst.review_percentage)
      : chat2SelectedLiveHuman?.candidate_review_percentage === null ||
          chat2SelectedLiveHuman?.candidate_review_percentage === undefined
        ? null
        : round(chat2SelectedLiveHuman.candidate_review_percentage)
  const chat2SelectedLiveAnalyst = chat2SelectedLiveHuman
    ? analysts.find((analyst) => normalizeChatText(analyst.name) === normalizeChatText(chat2SelectedLiveHuman.name)) ?? null
    : null
  const chat2LiveCsatGoal = chat2SelectedLiveAnalyst ? Number(chat2SelectedLiveAnalyst.csat_goal) : null
  const chat2LiveReviewGoal = 25
  const chat2LiveDiagnostic = buildChatPerformanceDiagnostic({
    csat: chat2LiveCandidateCsat,
    csatGoal: chat2LiveCsatGoal,
    reviewPercentage: chat2LiveCandidateReviewPercentage,
    reviewGoal: chat2LiveReviewGoal,
    positiveReviews: chat2LivePositive,
    negativeReviews: chat2LiveNegative,
    attendances: chat2LiveAttendances,
  })
  const chat2LiveCsatMet = chat2LiveDiagnostic.csatMet === true
  const chat2LiveReviewMet = chat2LiveDiagnostic.reviewMet === true
  const chat2LiveStatus = chat2LiveDiagnostic.statusLabel
  const chat2LiveTeamRows = chat2SelectedLiveHuman
    ? chat2PersistedAnalystRows.filter(
        (item) => normalizeChatText(item.area) === normalizeChatText(chat2SelectedLiveHuman.area),
      )
    : []
  const chat2LiveTeamTickets = chat2LiveTeamRows.reduce((sum, item) => sum + Number(item.attendances), 0)
  const chat2LiveTeamPositive = chat2LiveTeamRows.reduce((sum, item) => sum + Number(item.positive_reviews ?? 0), 0)
  const chat2LiveTeamNegative = chat2LiveTeamRows.reduce((sum, item) => sum + Number(item.negative_reviews ?? 0), 0)
  const chat2LiveTeamReviews = chat2LiveTeamPositive + chat2LiveTeamNegative
  const chat2LiveTeamCsat =
    chat2LiveTeamReviews > 0 ? round((chat2LiveTeamPositive / chat2LiveTeamReviews) * 100) : null
  const chat2LiveTeamReviewPercentage =
    chat2LiveTeamTickets > 0 ? round((chat2LiveTeamReviews / chat2LiveTeamTickets) * 100) : null
  const chat2LiveTeamAverageTickets =
    chat2LiveTeamRows.length > 0 ? round(chat2LiveTeamTickets / chat2LiveTeamRows.length) : 0
  const chat2ProductivityRows = [...chat2PersistedAnalystRows].sort(
    (a, b) => Number(b.attendances) - Number(a.attendances),
  )
  const chat2ProductivityTickets = chat2ProductivityRows.reduce(
    (sum, item) => sum + Number(item.attendances),
    0,
  )
  const chat2ProductivityPositive = chat2ProductivityRows.reduce(
    (sum, item) => sum + Number(item.positive_reviews ?? 0),
    0,
  )
  const chat2ProductivityNegative = chat2ProductivityRows.reduce(
    (sum, item) => sum + Number(item.negative_reviews ?? 0),
    0,
  )
  const chat2ProductivityReviews = chat2ProductivityPositive + chat2ProductivityNegative
  const chat2ProductivityCsat =
    chat2ProductivityReviews > 0
      ? round((chat2ProductivityPositive / chat2ProductivityReviews) * 100)
      : null
  const chat2ProductivityReviewPercentage =
    chat2ProductivityTickets > 0
      ? round((chat2ProductivityReviews / chat2ProductivityTickets) * 100)
      : null
  const chat2ProductivityAverageTickets =
    chat2ProductivityRows.length > 0
      ? round(chat2ProductivityTickets / chat2ProductivityRows.length)
      : 0
  const chat2ProductivityTeamVolumeStats = chat2ProductivityRows.reduce<Record<string, { tickets: number; analysts: number }>>(
    (acc, item) => {
      const key = item.team_id ?? item.area ?? 'sem-time'
      const current = acc[key] ?? { tickets: 0, analysts: 0 }
      current.tickets += Number(item.attendances)
      current.analysts += 1
      acc[key] = current
      return acc
    },
    {},
  )
  const chat2ProductivityAverageByTeam = Object.fromEntries(
    Object.entries(chat2ProductivityTeamVolumeStats).map(([key, item]) => [
      key,
      item.analysts > 0 ? round(item.tickets / item.analysts) : 0,
    ]),
  )
  const chat2OperationTodayTickets = chat2ProductivityRows.reduce(
    (sum, item) => sum + Number(item.today?.attendances ?? 0),
    0,
  )
  const chat2PreviousAccumulated = clickDeskPreviousMetrics?.performance_accumulated ?? null
  const chat2HasPreviousComparison = (clickDeskPreviousMetrics?.by_analyst?.length ?? 0) > 0
  const chat2OperationCsatDelta =
    chat2HasPreviousComparison &&
    chat2ProductivityCsat !== null &&
    chat2PreviousAccumulated?.csat !== null &&
    chat2PreviousAccumulated?.csat !== undefined
      ? round(chat2ProductivityCsat - Number(chat2PreviousAccumulated.csat))
      : null
  const chat2OperationReviewDelta =
    chat2HasPreviousComparison &&
    chat2ProductivityReviewPercentage !== null &&
    chat2PreviousAccumulated?.review_percentage !== null &&
    chat2PreviousAccumulated?.review_percentage !== undefined
      ? round(chat2ProductivityReviewPercentage - Number(chat2PreviousAccumulated.review_percentage))
      : null
  const chat2OperationVolumeDelta =
    chat2HasPreviousComparison && chat2PreviousAccumulated
      ? chat2ProductivityTickets - Number(chat2PreviousAccumulated.attendances ?? 0)
      : null
  const chat2OperationBelowCsat = chat2ProductivityRows.filter(
    (item) => item.csat !== null && Number(item.csat) < 90,
  )
  const chat2OperationBelowReviews = chat2ProductivityRows.filter(
    (item) => item.review_percentage === null || Number(item.review_percentage) < 25,
  )
  const chat2OperationBelowVolume = chat2ProductivityRows.filter((item) => {
    const teamKey = item.team_id ?? item.area ?? 'sem-time'
    const teamAverage = chat2ProductivityAverageByTeam[teamKey] ?? chat2ProductivityAverageTickets
    const volumePercentGap =
      teamAverage > 0 ? round(((Number(item.attendances) - teamAverage) / teamAverage) * 100) : 0
    return teamAverage >= 10 && volumePercentGap <= -20
  })
  const chat2OperationStatus =
    chat2ProductivityRows.length === 0
      ? 'Aguardando base'
      : (chat2ProductivityCsat ?? 0) >= 90 && (chat2ProductivityReviewPercentage ?? 0) >= 25
        ? 'Operação saudável'
        : (chat2ProductivityCsat ?? 0) < 85 || (chat2ProductivityReviewPercentage ?? 0) < 20
          ? 'Acompanhamento prioritário'
          : 'Operação em atenção'
  const chat2OperationStatusTone =
    chat2ProductivityRows.length === 0
      ? 'text-slate-300'
      : (chat2ProductivityCsat ?? 0) >= 90 && (chat2ProductivityReviewPercentage ?? 0) >= 25
        ? 'text-emerald-300'
        : (chat2ProductivityCsat ?? 0) < 85 || (chat2ProductivityReviewPercentage ?? 0) < 20
          ? 'text-rose-300'
          : 'text-amber-300'
  const chat2OperationReading =
    chat2ProductivityRows.length === 0
      ? 'Ainda não há base persistida suficiente para esta competência.'
      : (chat2ProductivityCsat ?? 0) < 90 && (chat2ProductivityReviewPercentage ?? 0) >= 25
        ? 'A participação nas avaliações já oferece uma base consistente, mas a satisfação do time está abaixo da referência de 90%.'
        : (chat2ProductivityCsat ?? 0) >= 90 && (chat2ProductivityReviewPercentage ?? 0) < 25
          ? 'A satisfação está saudável, mas a participação nas avaliações ainda está abaixo da referência de 25%.'
          : (chat2ProductivityCsat ?? 0) < 90 && (chat2ProductivityReviewPercentage ?? 0) < 25
            ? 'Qualidade e participação pedem acompanhamento conjunto antes do próximo fechamento.'
            : chat2OperationBelowVolume.length > 0
              ? 'Os indicadores gerais estão saudáveis; o principal cuidado agora é entender diferenças de volume dentro do time.'
              : 'Qualidade, participação e volume sustentam uma leitura saudável da operação.'
  const chat2OperationAreas = Object.values(
    chat2ProductivityRows.reduce<Record<string, {
      area: string
      analysts: number
      attendances: number
      positive: number
      negative: number
      reviews: number
    }>>((acc, item) => {
      const key = item.area || 'Área não identificada'
      const current = acc[key] ?? {
        area: key,
        analysts: 0,
        attendances: 0,
        positive: 0,
        negative: 0,
        reviews: 0,
      }
      current.analysts += 1
      current.attendances += Number(item.attendances)
      current.positive += Number(item.positive_reviews ?? 0)
      current.negative += Number(item.negative_reviews ?? 0)
      current.reviews += Number(item.reviews ?? 0)
      acc[key] = current
      return acc
    }, {}),
  ).map((item) => ({
    ...item,
    csat: item.reviews > 0 ? round((item.positive / item.reviews) * 100) : null,
    reviewPercentage: item.attendances > 0 ? round((item.reviews / item.attendances) * 100) : null,
  }))
  const chat2ManagementRows = chat2ProductivityRows
    .map((item) => {
      const analystProfile =
        analysts.find((analyst) => analyst.id === item.analyst_id) ??
        analysts.find((analyst) => normalizeChatText(analyst.name) === normalizeChatText(item.assignee_name)) ??
        null
      const csatGoal = analystProfile ? Number(analystProfile.csat_goal) : 90
      const reviewGoal = 25
      const teamKey = item.team_id ?? item.area ?? 'sem-time'
      const teamAverage = chat2ProductivityAverageByTeam[teamKey] ?? chat2ProductivityAverageTickets
      const csatValue = item.csat === null ? null : Number(item.csat)
      const reviewValue = item.review_percentage === null ? null : Number(item.review_percentage)
      const csatGap = csatValue === null ? null : round(csatValue - csatGoal)
      const reviewGap = reviewValue === null ? null : round(reviewValue - reviewGoal)
      const volumeGap = round(Number(item.attendances) - teamAverage)
      const volumePercentGap =
        teamAverage > 0 ? round(((Number(item.attendances) - teamAverage) / teamAverage) * 100) : 0
      const csatNeedsAttention = csatGap === null || csatGap < 0
      const reviewNeedsAttention = reviewGap === null || reviewGap < 0
      const volumeNeedsContext = teamAverage >= 10 && volumePercentGap <= -20
      const priority = csatNeedsAttention || reviewNeedsAttention
      const signals: string[] = []

      if (csatGap === null) {
        signals.push('CSAT ainda sem base')
      } else if (csatGap < 0) {
        signals.push(`CSAT ${formatDelta(csatGap, ' p.p.')} da meta individual`)
      }

      if (reviewGap === null) {
        signals.push('Avaliações ainda sem base')
      } else if (reviewGap < 0) {
        signals.push(`Avaliações ${formatDelta(reviewGap, ' p.p.')} da referência`)
      }

      if (volumeNeedsContext) {
        signals.push(`Volume ${formatChatPercent(Math.abs(volumePercentGap))} abaixo da média da área`)
      }

      let action = 'Manter acompanhamento e reconhecer a consistência do resultado.'
      if (csatNeedsAttention && reviewNeedsAttention) {
        action = Number(item.negative_reviews ?? 0) > 0
          ? `Revisar ${formatChatCount(item.negative_reviews)} avaliação(ões) negativa(s) antes do 1:1 e, em paralelo, reforçar o encerramento com convite à pesquisa.`
          : 'Revisar a qualidade do atendimento e ampliar a base de avaliações antes de definir uma ação individual.'
      } else if (csatNeedsAttention) {
        action = Number(item.negative_reviews ?? 0) > 0
          ? `Revisar ${formatChatCount(item.negative_reviews)} avaliação(ões) negativa(s) e identificar fatos observáveis antes do feedback.`
          : 'Acompanhar novas avaliações e revisar atendimentos antes de atribuir causa ao CSAT.'
      } else if (reviewNeedsAttention) {
        action = 'Reforçar o encerramento do atendimento e o convite à pesquisa; acompanhar se a participação sobe no próximo recorte.'
      } else if (volumeNeedsContext) {
        action = 'Validar disponibilidade, apoio a outras demandas, ausências e duração dos atendimentos antes de tratar o volume como desempenho individual.'
      }

      const score =
        (csatNeedsAttention ? 4 : 0) +
        (reviewNeedsAttention ? 2 : 0) +
        (volumeNeedsContext ? 1 : 0) +
        (Number(item.negative_reviews ?? 0) > 0 ? 1 : 0)

      return {
        ...item,
        csatGoal,
        reviewGoal,
        teamAverage,
        csatGap,
        reviewGap,
        volumeGap,
        volumePercentGap,
        priority,
        volumeNeedsContext,
        signals,
        action,
        score,
      }
    })
    .sort((a, b) => {
      if (Number(b.priority) !== Number(a.priority)) return Number(b.priority) - Number(a.priority)
      if (b.score !== a.score) return b.score - a.score
      return (a.csat ?? 0) - (b.csat ?? 0)
    })
  const chat2ManagementPriorities = chat2ManagementRows.filter((item) => item.priority)
  const chat2ManagementVolumeContexts = chat2ManagementRows.filter((item) => item.volumeNeedsContext)
  const chat2ManagementHealthy = chat2ManagementRows.filter(
    (item) => !item.priority,
  )
  const chat2ManagementCsatAttention = chat2ManagementRows.filter(
    (item) => item.csatGap === null || item.csatGap < 0,
  )
  const chat2ManagementReviewAttention = chat2ManagementRows.filter(
    (item) => item.reviewGap === null || item.reviewGap < 0,
  )
  const chat2ManagementNegativeReviews = chat2ManagementRows.reduce(
    (sum, item) => sum + Number(item.negative_reviews ?? 0),
    0,
  )
  const chat2SelectedMetric =
    chat2VisibleMetrics.find((metric) => metric.analyst_id === chat2AnalystId) ?? chat2VisibleMetrics[0] ?? null
  const chat2TeamMetrics = chat2SelectedMetric
    ? chat2VisibleMetrics.filter((metric) => metric.team_id === chat2SelectedMetric.team_id)
    : []
  const chat2TeamAverageCsat = calculateChatAverage(chat2TeamMetrics, 'csat')
  const chat2TeamAverageReviews = calculateChatAverage(chat2TeamMetrics, 'review_percentage')
  const chat2TeamTickets = chat2TeamMetrics.reduce((sum, metric) => sum + Number(metric.total_tickets), 0)
  const chat2TeamAverageTickets = chat2TeamMetrics.length ? round(chat2TeamTickets / chat2TeamMetrics.length) : 0
  const chat2Ranking = buildChatRanking(chat2TeamMetrics, chat2TeamAverageTickets, new Set<string>())
  const chat2RankingPosition = chat2SelectedMetric
    ? chat2Ranking.findIndex((item) => item.metric.analyst_id === chat2SelectedMetric.analyst_id) + 1
    : 0
  const chat2AnalystTrend = chat2SelectedMetric
    ? metrics
        .filter(
          (metric) =>
            metric.analyst_id === chat2SelectedMetric.analyst_id &&
            metric.period_start <= chat2SelectedMetric.period_start,
        )
        .sort((a, b) => a.period_start.localeCompare(b.period_start))
        .slice(-6)
    : []
  const chat2PositiveShare =
    chat2SelectedMetric && Number(chat2SelectedMetric.reviews) > 0
      ? round((Number(chat2SelectedMetric.positive_reviews) / Number(chat2SelectedMetric.reviews)) * 100)
      : 0
  const chat2NegativeShare =
    chat2SelectedMetric && Number(chat2SelectedMetric.reviews) > 0
      ? round((Number(chat2SelectedMetric.negative_reviews) / Number(chat2SelectedMetric.reviews)) * 100)
      : 0
  return (
    <div className="mt-8 space-y-7">
      <section className="panel workspace-hero">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="workspace-eyebrow">Módulo Chat</p>
            <h2 className="workspace-title">Central de performance do Chat</h2>
            <p className="section-subtitle">
              Operação, produtividade, gestão e fechamento em uma única experiência, com dados do ClickDesk e histórico oficial.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Equipe">
              <select
                className="form-input"
                value={selectedTeamId}
                onChange={(event) => {
                  setSelectedTeamId(event.target.value)
                  if (chatActiveTab === 'reports') {
                    setSelectedChatReportMetricId('')
                    setChatFeedbackDraft('')
                    setChatManagerNotes('')
                    setChatReportQualitativeStatus('')
                  }
                }}
              >
                <option value="all">Todas as equipes</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label={
                chatActiveTab === 'reports'
                  ? 'Período do relatório'
                  : chatActiveTab === 'prototype' || chatActiveTab === 'overview' || chatActiveTab === 'podium'
                    ? 'Período ClickDesk'
                    : 'Período'
              }
            >
              {chatActiveTab === 'prototype' || chatActiveTab === 'overview' || chatActiveTab === 'podium' || chatActiveTab === 'reports' ? (
                <select
                  className="form-input"
                  value={chat2PeriodKey}
                  onChange={(event) => {
                    const value = event.target.value
                    setChat2PeriodKey(value)
                    if (chatActiveTab === 'reports') {
                      setSelectedPeriodKey(value)
                      setSelectedChatReportMetricId('')
                      setChatFeedbackDraft('')
                      setChatReportQualitativeStatus('')
                    }
                  }}
                >
                  {(chatActiveTab === 'reports' ? chatReportPeriods : chat2Periods).map((period) => (
                    <option key={period.key} value={period.key}>
                      {period.label}{period.key === chat2Periods[0]?.key ? ' · mês atual' : ''}
                    </option>
                  ))}
                </select>
              ) : (
                <select className="form-input" value={selectedPeriodKey} onChange={(event) => setSelectedPeriodKey(event.target.value)}>
                  {periods.map((period) => (
                    <option key={`${period.year}-${period.monthNumber}`} value={`${period.year}-${period.monthNumber}`}>
                      {period.label}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>
        </div>
      </section>

      <nav className="chat-navigation workspace-navigation" aria-label="Áreas do módulo Chat">
        <div className="tab-row">
          <TabButton active={chatActiveTab === 'overview'} onClick={() => setChatActiveTab('overview')}>
            Visão da operação
          </TabButton>
          <TabButton active={chatActiveTab === 'prototype'} onClick={() => setChatActiveTab('prototype')}>
            Equipe e produtividade
          </TabButton>
          <TabButton active={chatActiveTab === 'podium'} onClick={() => setChatActiveTab('podium')}>
            Gestão e ações
          </TabButton>
          <TabButton active={chatActiveTab === 'reports'} onClick={() => setChatActiveTab('reports')}>
            Fechamento mensal
          </TabButton>
        </div>
        <div className="chat-tools-menu">
          <button
            aria-expanded={chatToolsOpen}
            aria-haspopup="menu"
            className={chatActiveTab === 'analysis' || chatActiveTab === 'import' || chatActiveTab === 'settings' ? 'chat-tools-trigger chat-tools-trigger-active' : 'chat-tools-trigger'}
            onClick={() => setChatToolsOpen((open) => !open)}
            type="button"
          >
            Ferramentas
            <span aria-hidden="true" className={chatToolsOpen ? 'chat-tools-chevron chat-tools-chevron-open' : 'chat-tools-chevron'}>⌄</span>
          </button>
          {chatToolsOpen && (
            <div className="chat-tools-dropdown" role="menu">
              <button
                className={chatActiveTab === 'analysis' ? 'chat-tools-option chat-tools-option-active' : 'chat-tools-option'}
                onClick={() => {
                  setChatActiveTab('analysis')
                  setChatToolsOpen(false)
                }}
                role="menuitem"
                type="button"
              >
                <strong>Conferência da base</strong>
                <span>Auditar comparação, volume, qualidade e dados importados</span>
              </button>
              <button
                className={chatActiveTab === 'import' ? 'chat-tools-option chat-tools-option-active' : 'chat-tools-option'}
                onClick={() => {
                  setChatActiveTab('import')
                  setChatToolsOpen(false)
                }}
                role="menuitem"
                type="button"
              >
                <strong>Importação</strong>
                <span>Atualizar a base mensal e o histórico operacional</span>
              </button>
              <button
                className={chatActiveTab === 'settings' ? 'chat-tools-option chat-tools-option-active' : 'chat-tools-option'}
                onClick={() => {
                  setChatActiveTab('settings')
                  setChatToolsOpen(false)
                }}
                role="menuitem"
                type="button"
              >
                <strong>Cadastros</strong>
                <span>Gerenciar analistas, metas e fotos</span>
              </button>
              {isManagementUser && (
                <Link className="chat-tools-option" href="/integracoes" role="menuitem">
                  <strong>Fechamentos oficiais</strong>
                  <span>Conferir e preservar os resultados aprovados</span>
                </Link>
              )}
            </div>
          )}
        </div>
      </nav>

      {chatActiveTab === 'overview' && (
        <section className="panel workspace-section-intro">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="workspace-eyebrow">Visão da operação</p>
              <h2 className="mt-2 text-2xl font-bold">Como está a operação agora?</h2>
              <p className="section-subtitle">
                Fotografia da competência com base viva do ClickDesk, comparação com o mês anterior e alertas objetivos para orientar a gestão.
              </p>
            </div>
            <div className="text-left lg:text-right">
              <span className="inline-flex rounded-md border border-cyan-300/20 bg-cyan-300/5 px-3 py-2 text-sm font-semibold text-cyan-100">
                ClickDesk · base viva
              </span>
              <p className="mt-2 text-xs text-slate-500">
                {clickDeskPersistedMetrics?.latest_sync?.finished_at
                  ? `Dados atualizados em ${formatDateTime(clickDeskPersistedMetrics.latest_sync.finished_at)}`
                  : 'Última atualização ainda não informada'}
              </p>
            </div>
          </div>
        </section>
      )}

      {chatActiveTab === 'prototype' && (
        <section className="panel workspace-section-intro">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="workspace-eyebrow">Equipe e produtividade</p>
              <h2 className="mt-2 text-2xl font-bold">Desempenho do time e leitura individual</h2>
              <p className="section-subtitle">
                Acompanhe volume, qualidade, avaliações, posição no ranking e evolução de cada analista com a base persistida do ClickDesk.
              </p>
            </div>
            <div className="text-left lg:text-right">
              <span className="inline-flex rounded-md border border-cyan-300/20 bg-cyan-300/5 px-3 py-2 text-sm font-semibold text-cyan-100">
                ClickDesk · base viva
              </span>
              <p className="mt-2 text-xs text-slate-500">
                {clickDeskPersistedMetrics?.latest_sync?.finished_at
                  ? `Última atualização: ${formatDateTime(clickDeskPersistedMetrics.latest_sync.finished_at)}`
                  : 'Última atualização ainda não informada'}
              </p>
            </div>
          </div>
        </section>
      )}

      {chatActiveTab === 'analysis' && (
        <section className="panel workspace-section-intro">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="workspace-eyebrow">Ferramentas · conferência da base</p>
              <h2 className="mt-2 text-2xl font-bold">Auditar os números antes da gestão</h2>
              <p className="section-subtitle">Comparação detalhada entre analistas, volume, qualidade, participação nas avaliações e conferência dos dados importados.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                className="secondary-button"
                disabled={clickDeskTestLoading}
                type="button"
                onClick={() => void handleTestClickDeskConnection()}
              >
                {clickDeskTestLoading ? 'Testando conexão...' : 'Testar conexão ClickDesk'}
              </button>
              <button
                className="secondary-button"
                disabled={clickDeskConversationLoading}
                type="button"
                onClick={() => void handleLoadClickDeskConversations()}
              >
                {clickDeskConversationLoading ? 'Sincronizando...' : 'Sincronizar base'}
              </button>
            </div>
          </div>
        </section>
      )}

      {chatActiveTab === 'podium' && (
        <section className="panel workspace-section-intro">
          <p className="workspace-eyebrow">Gestão e ações</p>
          <h2 className="mt-2 text-2xl font-bold">Onde agir e o que acompanhar?</h2>
          <p className="section-subtitle">Diagnóstico gerencial, prioridades, pontos de atenção e ações para o próximo ciclo, com a camada qualitativa de IA em validação controlada por evidências.</p>
        </section>
      )}

      {chatActiveTab === 'reports' && (
        <section className="panel workspace-section-intro">
          <p className="workspace-eyebrow">Fechamento mensal</p>
          <h2 className="mt-2 text-2xl font-bold">Consolidar, reconhecer e comunicar</h2>
          <p className="section-subtitle">Ranking final, ajustes operacionais do pódio e geração dos relatórios individuais.</p>
        </section>
      )}

      {chatActiveTab === 'prototype' && (
        <div className="space-y-6">
          <section className="panel">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.16em] text-cyan-300">Equipe e produtividade</p>
                <h3 className="mt-2 text-2xl font-bold">Visão do time</h3>
                <p className="section-subtitle">
                  Leia primeiro o cenário coletivo. Depois, clique em um analista para abrir o detalhamento individual logo abaixo.
                </p>
              </div>
              <span className="rounded-md border border-white/10 bg-slate-950/40 px-3 py-2 text-xs text-slate-400">
                {chat2SelectedPeriod.label} · {formatChatCount(chat2ProductivityRows.length)} analista(s) com dados
              </span>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              <MetricCard label="Atendimentos do time" value={formatChatCount(chat2ProductivityTickets)} />
              <MetricCard
                label="CSAT do time"
                value={chat2ProductivityCsat === null ? '—' : formatChatPercent(chat2ProductivityCsat)}
              />
              <MetricCard
                label="% de avaliações"
                value={chat2ProductivityReviewPercentage === null ? '—' : formatChatPercent(chat2ProductivityReviewPercentage)}
              />
              <MetricCard label="Avaliações recebidas" value={formatChatCount(chat2ProductivityReviews)} />
              <MetricCard
                label="Média por analista"
                value={formatChatCount(chat2ProductivityAverageTickets)}
              />
            </div>

            {chat2ProductivityRows.length > 0 ? (
              <div className="mt-5 overflow-x-auto rounded-xl border border-white/10 bg-slate-950/30">
                <div className="grid min-w-[680px] grid-cols-[minmax(220px,1.6fr)_repeat(3,minmax(110px,0.7fr))] gap-3 border-b border-white/10 px-4 py-3 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                  <span>Analista</span>
                  <span className="text-right">Atendimentos</span>
                  <span className="text-right">CSAT</span>
                  <span className="text-right">% avaliações</span>
                </div>
                <div className="divide-y divide-white/5">
                  {chat2ProductivityRows.map((item) => {
                    const analystKey = `${item.area}::${item.assignee_name}`
                    const selected = chat2SelectedLiveHuman
                      ? analystKey === `${chat2SelectedLiveHuman.area}::${chat2SelectedLiveHuman.name}`
                      : false
                    return (
                      <button
                        key={analystKey}
                        type="button"
                        onClick={() => setChat2LiveAnalystKey(analystKey)}
                        className={`grid min-w-[680px] w-full grid-cols-[minmax(220px,1.6fr)_repeat(3,minmax(110px,0.7fr))] items-center gap-3 px-4 py-3 text-left text-sm transition ${
                          selected ? 'bg-cyan-300/10' : 'hover:bg-white/[0.03]'
                        }`}
                      >
                        <span>
                          <strong className="block text-slate-100">{item.assignee_name}</strong>
                          <span className="mt-1 block text-xs text-slate-500">{item.area}</span>
                        </span>
                        <strong className="text-right tabular-nums">{formatChatCount(item.attendances)}</strong>
                        <span className="text-right tabular-nums">
                          {item.csat === null ? '—' : formatChatPercent(item.csat)}
                        </span>
                        <span className="text-right tabular-nums">
                          {item.review_percentage === null ? '—' : formatChatPercent(item.review_percentage)}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ) : (
              <div className="mt-5">
                <EmptyState text="Nenhum analista com dados persistidos nesta competência." />
              </div>
            )}
          </section>

          <section className="panel">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.16em] text-cyan-300">Equipe e produtividade · visão individual</p>
                <h3 className="mt-2 text-2xl font-bold">Resultado do analista</h3>
                <p className="section-subtitle">
                  Selecione uma pessoa para acompanhar o resultado individual na mesma lógica da experiência do analista. Atendimentos de gestão permanecem na operação, mas ficam fora da comparação individual e das metas.
                </p>
              </div>
              <div className="min-w-[260px]">
                <Field label="Visualizar como">
                  {chat2LiveHumanRows.length ? (
                    <select
                      className="form-input"
                      value={chat2SelectedLiveHuman ? `${chat2SelectedLiveHuman.area}::${chat2SelectedLiveHuman.name}` : ''}
                      onChange={(event) => setChat2LiveAnalystKey(event.target.value)}
                    >
                      {chat2LiveHumanRows.map((item) => (
                        <option key={`${item.area}-${item.name}`} value={`${item.area}::${item.name}`}>
                          {item.name} · {item.area}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <select
                      className="form-input"
                      value={chat2SelectedMetric?.analyst_id ?? ''}
                      onChange={(event) => setChat2AnalystId(event.target.value)}
                    >
                      {chat2VisibleMetrics.map((metric) => (
                        <option key={metric.id} value={metric.analyst_id}>
                          {getChatAnalystName(metric)} · {getChatTeamName(metric)}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
              </div>
            </div>

            {chat2SelectedLiveHuman ? (
              <>
                <div className="mt-6 flex flex-col gap-4 rounded-xl border border-white/10 bg-slate-950/35 p-5 md:flex-row md:items-center md:justify-between">
                  <div className="flex items-center gap-4">
                    <AnalystAvatar
                      name={chat2SelectedLiveHuman.name}
                      photoUrl={chat2SelectedLiveAnalyst?.photo_url ?? null}
                      size="lg"
                    />
                    <div>
                      <p className="text-sm text-slate-400">{chat2SelectedLiveHuman.area}</p>
                      <h3 className="text-2xl font-bold">{chat2SelectedLiveHuman.name}</h3>
                      <p className="mt-1 text-sm text-slate-400">{chat2SelectedPeriod.label} · ClickDesk</p>
                    </div>
                  </div>
                  <div className="grid gap-2 text-sm sm:grid-cols-2">
                    <div className="rounded-lg bg-slate-900 px-4 py-3">
                      <p className="text-slate-400">Situação do período</p>
                      <strong className="mt-1 block text-base">{chat2LiveStatus}</strong>
                      <span className="mt-1 block text-xs text-slate-500">
                        {chat2LiveDiagnostic.goalsEvaluated === 2
                          ? `${chat2LiveDiagnostic.goalsMet} de 2 metas atingidas`
                          : `${chat2LiveDiagnostic.goalsEvaluated} de 2 metas avaliadas`}
                      </span>
                    </div>
                    <div className="rounded-lg bg-slate-900 px-4 py-3">
                      <p className="text-slate-400">Base ClickDesk</p>
                      <strong className="mt-1 block text-base">
                        {clickDeskPersistedMetrics?.erro ? 'Indisponível' : 'Persistida'}
                      </strong>
                      <span className="mt-1 block text-xs text-slate-500">
                        {clickDeskPersistedMetrics?.latest_sync?.finished_at
                          ? `Atualizada em ${formatDateTime(clickDeskPersistedMetrics.latest_sync.finished_at)}`
                          : 'Competência em acompanhamento'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
                  <MetricCard label="Atendimentos na competência" value={formatChatCount(chat2LiveAttendances)} />
                  <MetricCard label="Atendimentos hoje" value={formatChatCount(chat2TodayAttendances)} />
                  <MetricCard
                    label="CSAT atual"
                    value={chat2LiveCandidateCsat === null ? '—' : formatChatPercent(chat2LiveCandidateCsat)}
                  />
                  <MetricCard label="Avaliações positivas" value={formatChatCount(chat2LivePositive)} tone="success" />
                  <MetricCard
                    label="Avaliações negativas"
                    value={formatChatCount(chat2LiveNegative)}
                    tone={chat2LiveNegative > 0 ? 'warning' : 'success'}
                  />
                  <MetricCard
                    label="% avaliações atual"
                    value={chat2LiveCandidateReviewPercentage === null ? '—' : formatChatPercent(chat2LiveCandidateReviewPercentage)}
                  />
                </div>

                <ChatPerformanceDiagnosticPanel diagnostic={chat2LiveDiagnostic} />

                {clickDeskPersistedMetrics?.period && (
                  <p className="mt-3 text-xs text-slate-500">
                    Período selecionado: {formatDate(clickDeskPersistedMetrics.period.start)} a {formatDate(clickDeskPersistedMetrics.period.end)}
                    {chat2DailyCoverageStart ? ` · base diária desde ${formatDate(chat2DailyCoverageStart)}` : ''}
                    {' '}· Hoje: {clickDeskPersistedMetrics.today?.date ? formatDate(clickDeskPersistedMetrics.today.date) : '—'}.
                  </p>
                )}

                {chat2DailyRuler.length > 0 && (
                  <div className="mt-5 rounded-xl border border-white/10 bg-slate-900/70 p-5">
                    <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                      <div>
                        <p className="text-sm font-semibold uppercase tracking-[0.14em] text-cyan-300">Régua diária</p>
                        <h4 className="mt-1 text-lg font-bold">Atendimentos por dia</h4>
                        <p className="mt-1 text-sm text-slate-400">
                          Clique em um dia para detalhar o resultado sem perder o acumulado da competência.
                        </p>
                      </div>
                      <label className="min-w-52 text-sm text-slate-400">
                        Detalhar dia
                        <select
                          className="form-input mt-1"
                          value={chat2DailyDateFilter}
                          onChange={(event) => setChat2DailyDateFilter(event.target.value)}
                        >
                          <option value="all">Competência inteira</option>
                          {chat2DailyRuler.map((item) => (
                            <option key={item.date} value={item.date} disabled={!item.covered}>
                              {formatDate(item.date)} · {item.covered ? `${formatChatCount(item.attendances)} atendimento(s)` : 'sem base diária'}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <div className="mt-4 flex gap-2 overflow-x-auto pb-2">
                      {chat2DailyRuler.map((item) => {
                        const selected = chat2DailyDateFilter === item.date
                        return (
                          <button
                            key={item.date}
                            type="button"
                            disabled={!item.covered}
                            onClick={() => item.covered && setChat2DailyDateFilter(selected ? 'all' : item.date)}
                            className={`min-w-16 rounded-lg border px-3 py-3 text-center transition ${
                              !item.covered
                                ? 'cursor-not-allowed border-white/5 bg-slate-950/25 text-slate-600'
                                : selected
                                  ? 'border-cyan-300/60 bg-cyan-300/10 text-cyan-100'
                                  : 'border-white/10 bg-slate-950/45 text-slate-300 hover:border-white/25'
                            }`}
                            title={
                              item.covered
                                ? `${formatDate(item.date)} · ${formatChatCount(item.attendances)} atendimento(s)`
                                : `${formatDate(item.date)} · sem base diária disponível`
                            }
                          >
                            <span className="block text-xs text-slate-500">{item.date.slice(8, 10)}</span>
                            <strong className="mt-1 block text-lg tabular-nums">
                              {item.covered ? formatChatCount(item.attendances) : '—'}
                            </strong>
                          </button>
                        )
                      })}
                    </div>

                    {clickDeskPersistedMetrics?.date_basis?.status === 'needs_validation' && (
                      <div className="mt-4 rounded-lg border border-amber-400/20 bg-amber-400/5 px-4 py-3 text-xs leading-5 text-amber-100">
                        <strong>Régua em validação.</strong>{' '}
                        {clickDeskPersistedMetrics.date_basis.note}
                      </div>
                    )}

                    {chat2SelectedDayMetric ? (
                      <div className="mt-4 border-t border-white/10 pt-4">
                        <p className="mb-3 text-sm font-semibold">
                          {formatDate(chat2SelectedDayMetric.date)} · detalhe do dia
                        </p>
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                          <div className="rounded-lg bg-slate-950/45 p-3">
                            <p className="text-xs text-slate-500">Atendimentos</p>
                            <strong className="mt-1 block text-xl tabular-nums">
                              {formatChatCount(chat2SelectedDayMetric.attendances)}
                            </strong>
                          </div>
                          <div className="rounded-lg bg-slate-950/45 p-3">
                            <p className="text-xs text-slate-500">CSAT</p>
                            <strong className="mt-1 block text-xl tabular-nums">
                              {chat2SelectedDayMetric.csat === null ? '—' : formatChatPercent(chat2SelectedDayMetric.csat)}
                            </strong>
                          </div>
                          <div className="rounded-lg bg-slate-950/45 p-3">
                            <p className="text-xs text-slate-500">Positivas</p>
                            <strong className="mt-1 block text-xl tabular-nums">
                              {formatChatCount(chat2SelectedDayMetric.positive_reviews)}
                            </strong>
                          </div>
                          <div className="rounded-lg bg-slate-950/45 p-3">
                            <p className="text-xs text-slate-500">Negativas</p>
                            <strong className="mt-1 block text-xl tabular-nums">
                              {formatChatCount(chat2SelectedDayMetric.negative_reviews)}
                            </strong>
                          </div>
                          <div className="rounded-lg bg-slate-950/45 p-3">
                            <p className="text-xs text-slate-500">% avaliações</p>
                            <strong className="mt-1 block text-xl tabular-nums">
                              {chat2SelectedDayMetric.review_percentage === null
                                ? '—'
                                : formatChatPercent(chat2SelectedDayMetric.review_percentage)}
                            </strong>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <p className="mt-3 text-xs text-slate-500">
                        Depois do início da cobertura diária, dias sem atendimento aparecem como 0. Datas anteriores à base disponível aparecem como —.
                      </p>
                    )}
                  </div>
                )}

                <div className="mt-5 grid gap-4 lg:grid-cols-3">
                  <div className="rounded-xl border border-white/10 bg-slate-900/70 p-5">
                    <p className="text-sm font-semibold uppercase tracking-[0.14em] text-cyan-300">Qualidade</p>
                    <div className="mt-4 space-y-3 text-sm">
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-slate-400">Meta de CSAT</span>
                        <strong className="tabular-nums">{chat2LiveCsatGoal === null ? 'Não vinculada' : formatChatPercent(chat2LiveCsatGoal)}</strong>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-slate-400">Resultado atual</span>
                        <strong className={chat2LiveCsatMet ? 'text-emerald-300' : 'text-amber-200'}>
                          {chat2LiveCandidateCsat === null ? '—' : formatChatPercent(chat2LiveCandidateCsat)}
                        </strong>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-slate-400">Distância da meta</span>
                        <strong className={chat2LiveCsatMet ? 'text-emerald-300' : 'text-amber-200'}>
                          {chat2LiveCandidateCsat === null || chat2LiveCsatGoal === null
                            ? '—'
                            : formatDelta(round(chat2LiveCandidateCsat - chat2LiveCsatGoal), ' p.p.')}
                        </strong>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-white/10 bg-slate-900/70 p-5">
                    <p className="text-sm font-semibold uppercase tracking-[0.14em] text-cyan-300">Participação</p>
                    <div className="mt-4 space-y-3 text-sm">
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-slate-400">Avaliações recebidas</span>
                        <strong className="tabular-nums">{formatChatCount(chat2LiveReviews)}</strong>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-slate-400">Meta de avaliações</span>
                        <strong className="tabular-nums">{formatChatPercent(chat2LiveReviewGoal)}</strong>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-slate-400">Resultado atual</span>
                        <strong className={chat2LiveReviewMet ? 'text-emerald-300' : 'text-amber-200'}>
                          {chat2LiveCandidateReviewPercentage === null ? '—' : formatChatPercent(chat2LiveCandidateReviewPercentage)}
                        </strong>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-white/10 bg-slate-900/70 p-5">
                    <p className="text-sm font-semibold uppercase tracking-[0.14em] text-cyan-300">Contexto do time</p>
                    <p className="mt-2 text-xs text-slate-500">{chat2SelectedLiveHuman.area} · somente analistas · sem expor resultados individuais</p>
                    <div className="mt-4 space-y-3 text-sm">
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-slate-400">CSAT do time</span>
                        <strong className="tabular-nums">
                          {chat2LiveTeamCsat === null ? '—' : formatChatPercent(chat2LiveTeamCsat)}
                        </strong>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-slate-400">% avaliações do time</span>
                        <strong className="tabular-nums">
                          {chat2LiveTeamReviewPercentage === null ? '—' : formatChatPercent(chat2LiveTeamReviewPercentage)}
                        </strong>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-slate-400">Média de atendimentos</span>
                        <strong className="tabular-nums">{formatChatCount(chat2LiveTeamAverageTickets)}</strong>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-4 rounded-lg border border-cyan-400/15 bg-cyan-400/5 px-4 py-3 text-xs leading-5 text-slate-400">
                  Base do período: {formatChatCount(chat2LiveAttendances)} atendimentos com transição IA → humano confirmada.
                  Os indicadores permanecem vivos durante a competência e são preservados no fechamento oficial.
                </div>
              </>
            ) : chat2SelectedMetric ? (
              <>
                <div className="mt-6 flex flex-col gap-4 rounded-xl border border-white/10 bg-slate-950/35 p-5 md:flex-row md:items-center md:justify-between">
                  <div className="flex items-center gap-4">
                    <AnalystAvatar
                      name={getChatAnalystName(chat2SelectedMetric)}
                      photoUrl={getChatAnalystPhoto(chat2SelectedMetric)}
                      size="lg"
                    />
                    <div>
                      <p className="text-sm text-slate-400">{getChatTeamName(chat2SelectedMetric)}</p>
                      <h3 className="text-2xl font-bold">{getChatAnalystName(chat2SelectedMetric)}</h3>
                      <p className="mt-1 text-sm text-slate-400">{chat2SelectedPeriod.label}</p>
                    </div>
                  </div>
                  <div className="rounded-lg bg-slate-900 px-4 py-3 text-sm">
                    <p className="text-slate-400">Posição no ranking do time</p>
                    <strong className="mt-1 block text-xl tabular-nums">
                      {chat2RankingPosition > 0 ? chat2RankingPosition + 'º de ' + chat2Ranking.length : '—'}
                    </strong>
                  </div>
                </div>

                <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
                  <MetricCard
                    label="Meu CSAT"
                    value={formatChatPercent(chat2SelectedMetric.csat)}
                    tone={Number(chat2SelectedMetric.csat) >= Number(chat2SelectedMetric.csat_goal) ? 'success' : 'warning'}
                  />
                  <MetricCard label="Atendimentos" value={formatChatCount(chat2SelectedMetric.total_tickets)} />
                  <MetricCard label="Avaliações positivas" value={formatChatCount(chat2SelectedMetric.positive_reviews)} tone="success" />
                  <MetricCard label="Avaliações negativas" value={formatChatCount(chat2SelectedMetric.negative_reviews)} tone={Number(chat2SelectedMetric.negative_reviews) > 0 ? 'warning' : 'success'} />
                  <MetricCard
                    label="% de avaliações"
                    value={formatChatPercent(chat2SelectedMetric.review_percentage)}
                    tone={Number(chat2SelectedMetric.review_percentage) >= Number(chat2SelectedMetric.general_review_goal) ? 'success' : 'warning'}
                  />
                </div>

                <div className="mt-5 grid gap-4 lg:grid-cols-3">
                  <div className="rounded-xl border border-white/10 bg-slate-900/70 p-5">
                    <p className="text-sm font-semibold uppercase tracking-[0.14em] text-cyan-300">Qualidade</p>
                    <div className="mt-4 space-y-3 text-sm">
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-slate-400">Meta de CSAT</span>
                        <strong className="tabular-nums">{formatChatPercent(chat2SelectedMetric.csat_goal)}</strong>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-slate-400">Distância da meta</span>
                        <strong className={Number(chat2SelectedMetric.csat) >= Number(chat2SelectedMetric.csat_goal) ? 'text-emerald-300' : 'text-amber-200'}>
                          {formatDelta(round(Number(chat2SelectedMetric.csat) - Number(chat2SelectedMetric.csat_goal)), ' p.p.')}
                        </strong>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-slate-400">Positivas entre avaliadas</span>
                        <strong className="tabular-nums">{formatChatPercent(chat2PositiveShare)}</strong>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-white/10 bg-slate-900/70 p-5">
                    <p className="text-sm font-semibold uppercase tracking-[0.14em] text-cyan-300">Participação</p>
                    <div className="mt-4 space-y-3 text-sm">
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-slate-400">Avaliações recebidas</span>
                        <strong className="tabular-nums">{formatChatCount(chat2SelectedMetric.reviews)}</strong>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-slate-400">Meta de avaliações</span>
                        <strong className="tabular-nums">{formatChatPercent(chat2SelectedMetric.general_review_goal)}</strong>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-slate-400">Negativas entre avaliadas</span>
                        <strong className="tabular-nums">{formatChatPercent(chat2NegativeShare)}</strong>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-white/10 bg-slate-900/70 p-5">
                    <p className="text-sm font-semibold uppercase tracking-[0.14em] text-cyan-300">Contexto do time</p>
                    <div className="mt-4 space-y-3 text-sm">
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-slate-400">CSAT do time</span>
                        <strong className="tabular-nums">{formatChatPercent(chat2TeamAverageCsat)}</strong>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-slate-400">Avaliações do time</span>
                        <strong className="tabular-nums">{formatChatPercent(chat2TeamAverageReviews)}</strong>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-slate-400">Média de atendimentos</span>
                        <strong className="tabular-nums">{formatChatCount(chat2TeamAverageTickets)}</strong>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <EmptyState text="Ainda não há dados consolidados do ClickDesk para este período. A conexão está ativa; a próxima etapa é ligar a leitura das conversas do mês atual." />
            )}
          </section>

          <section className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
            <div className="panel">
              <p className="text-sm font-semibold uppercase tracking-[0.16em] text-cyan-300">Evolução do analista</p>
              <h3 className="mt-2 text-2xl font-bold">Histórico ClickDesk</h3>
              <p className="section-subtitle">
                A nova série histórica será formada somente com dados ClickDesk, sem misturar os números antigos do Zendesk.
              </p>

              {clickDeskHistoryLoading ? (
                <div className="mt-5 rounded-lg border border-white/10 bg-slate-950/35 p-5 text-sm text-slate-300">
                  Carregando histórico oficial do analista...
                </div>
              ) : clickDeskAnalystHistory?.erro ? (
                <div className="mt-5 rounded-lg border border-amber-300/20 bg-amber-300/5 p-4 text-sm text-amber-100">
                  {clickDeskAnalystHistory.erro}
                </div>
              ) : chat2HistoryPoints.length > 0 ? (
                <div className="mt-5 space-y-5">
                  <div className="grid gap-4 lg:grid-cols-3">
                    <TrendLineChart
                      label="CSAT mensal"
                      points={chat2HistoryPoints.map((item) => ({
                        label: item.label.replace(' de ', '/'),
                        value: item.csat ?? 0,
                      }))}
                      suffix="%"
                      singlePointLabel="Apenas uma competência disponível no histórico."
                      latestPointLabel="Última competência"
                      highlightedPointLabel="Competência destacada"
                    />
                    <TrendLineChart
                      label="% de avaliações mensal"
                      points={chat2HistoryPoints.map((item) => ({
                        label: item.label.replace(' de ', '/'),
                        value: item.review_percentage ?? 0,
                      }))}
                      suffix="%"
                      goal={25}
                      goalLabel="Meta"
                      singlePointLabel="Apenas uma competência disponível no histórico."
                      latestPointLabel="Última competência"
                      highlightedPointLabel="Competência destacada"
                    />
                    <TrendLineChart
                      label="Atendimentos mensais"
                      points={chat2HistoryPoints.map((item) => ({
                        label: item.label.replace(' de ', '/'),
                        value: item.attendances,
                      }))}
                      singlePointLabel="Apenas uma competência disponível no histórico."
                      latestPointLabel="Última competência"
                      highlightedPointLabel="Competência destacada"
                    />
                  </div>

                  <div className="space-y-3">
                    {[...chat2HistoryPoints].reverse().map((item) => (
                      <div
                        key={item.month}
                        className="rounded-lg border border-white/10 bg-slate-950/35 p-4"
                      >
                        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <strong>{item.label}</strong>
                              <span
                                className={`rounded-md border px-2 py-1 text-[11px] font-semibold ${
                                  item.source === 'official'
                                    ? 'border-emerald-400/20 bg-emerald-400/5 text-emerald-200'
                                    : 'border-cyan-400/20 bg-cyan-400/5 text-cyan-200'
                                }`}
                              >
                                {item.source === 'official' ? 'Oficial' : 'Em andamento'}
                              </span>
                            </div>
                            <p className="mt-1 text-xs text-slate-500">
                              {item.source === 'official'
                                ? 'Snapshot mensal preservado'
                                : 'Base viva persistida do ClickDesk'}
                              {item.team_name ? ` · ${item.team_name}` : ''}
                            </p>
                          </div>
                          <div className="grid grid-cols-3 gap-4 text-right">
                            <div>
                              <p className="text-xs text-slate-500">CSAT</p>
                              <strong className="tabular-nums">
                                {item.csat === null ? '—' : formatChatPercent(item.csat)}
                              </strong>
                            </div>
                            <div>
                              <p className="text-xs text-slate-500">Avaliações</p>
                              <strong className="tabular-nums">
                                {item.review_percentage === null
                                  ? '—'
                                  : formatChatPercent(item.review_percentage)}
                              </strong>
                            </div>
                            <div>
                              <p className="text-xs text-slate-500">Atendimentos</p>
                              <strong className="tabular-nums">{formatChatCount(item.attendances)}</strong>
                            </div>
                          </div>
                        </div>

                        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 border-t border-white/10 pt-3 text-xs text-slate-400">
                          <span>
                            Meta CSAT:{' '}
                            <strong className="text-slate-200">
                              {item.csat_goal === null ? '—' : formatChatPercent(item.csat_goal)}
                            </strong>
                          </span>
                          <span>
                            Meta avaliações:{' '}
                            <strong className="text-slate-200">{formatChatPercent(item.review_goal)}</strong>
                          </span>
                          {item.delta.csat_pp !== null && (
                            <span>
                              Δ CSAT:{' '}
                              <strong className={item.delta.csat_pp >= 0 ? 'text-emerald-300' : 'text-amber-200'}>
                                {formatDelta(item.delta.csat_pp, ' p.p.')}
                              </strong>
                            </span>
                          )}
                          {item.delta.review_percentage_pp !== null && (
                            <span>
                              Δ avaliações:{' '}
                              <strong className={item.delta.review_percentage_pp >= 0 ? 'text-emerald-300' : 'text-amber-200'}>
                                {formatDelta(item.delta.review_percentage_pp, ' p.p.')}
                              </strong>
                            </span>
                          )}
                          {item.delta.attendances !== null && (
                            <span>
                              Δ atendimentos:{' '}
                              <strong className="text-slate-200">
                                {item.delta.attendances > 0 ? '+' : ''}
                                {formatChatCount(item.delta.attendances)}
                              </strong>
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  <p className="text-xs leading-5 text-slate-500">
                    Meses fechados usam exclusivamente o snapshot oficial. A competência atual usa a base viva persistida até o fechamento.
                  </p>
                </div>
              ) : (
                <EmptyState text="Ainda não existe histórico ClickDesk disponível para este analista." />
              )}
            </div>

            <div className="panel">
              <p className="text-sm font-semibold uppercase tracking-[0.16em] text-cyan-300">Nosso resultado</p>
              <h3 className="mt-2 text-2xl font-bold">{chat2SelectedLiveHuman?.area ?? 'Meu time'}</h3>
              <p className="section-subtitle">Contexto coletivo de performance dos analistas no período, sem incluir apoio de gestão.</p>

              {chat2SelectedLiveHuman ? (
                <div className="mt-5 grid gap-3">
                  <div className="rounded-lg bg-slate-900 p-4">
                    <p className="text-sm text-slate-400">CSAT do time</p>
                    <strong className="mt-2 block text-2xl tabular-nums">
                      {chat2LiveTeamCsat === null ? '—' : formatChatPercent(chat2LiveTeamCsat)}
                    </strong>
                  </div>
                  <div className="rounded-lg bg-slate-900 p-4">
                    <p className="text-sm text-slate-400">% de avaliações do time</p>
                    <strong className="mt-2 block text-2xl tabular-nums">
                      {chat2LiveTeamReviewPercentage === null ? '—' : formatChatPercent(chat2LiveTeamReviewPercentage)}
                    </strong>
                  </div>
                  <div className="rounded-lg bg-slate-900 p-4">
                    <p className="text-sm text-slate-400">Atendimentos do time</p>
                    <strong className="mt-2 block text-2xl tabular-nums">{formatChatCount(chat2LiveTeamTickets)}</strong>
                  </div>
                </div>
              ) : (
                <div className="mt-5">
                  <EmptyState text="Leia os atendimentos do período para gerar o contexto coletivo ClickDesk." />
                </div>
              )}
            </div>
          </section>




        </div>
      )}

      <section className={chatActiveTab === 'import' ? 'panel' : 'hidden'}>
        <div>
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-cyan-300">Importação mensal</p>
            <h3 className="mt-2 text-2xl font-bold">Atualizar base do chat</h3>
            <p className="section-subtitle">
              Use as planilhas de satisfação e inatividade baixadas do Zendesk. O cálculo segue a regra original do painel do chat.
            </p>
          </div>

          <form className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-6" onSubmit={handleChatMonthlyImport}>
            <Field label="Mês">
              <select className="form-input" value={chatImportMonth} onChange={(event) => setChatImportMonth(event.target.value)}>
                {chatMonthOptions.map((month) => (
                  <option key={month.value} value={month.value}>
                    {month.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Ano">
              <input
                className="form-input"
                min="2020"
                max="2100"
                type="number"
                value={chatImportYear}
                onChange={(event) => setChatImportYear(event.target.value)}
              />
            </Field>
            <Field label="Satisfação">
              <input
                key={`satisfaction-${chatFileInputResetKey}`}
                accept=".xlsx,.xls,.csv,text/csv"
                className="form-input"
                type="file"
                onChange={(event) => setChatSatisfactionFile(event.target.files?.[0] ?? null)}
              />
              {chatSatisfactionFile && <SelectedImportFile file={chatSatisfactionFile} />}
            </Field>
            <Field label="Inatividade">
              <input
                key={`inactivity-${chatFileInputResetKey}`}
                accept=".xlsx,.xls,.csv,text/csv"
                className="form-input"
                type="file"
                onChange={(event) => setChatInactiveFile(event.target.files?.[0] ?? null)}
              />
              {chatInactiveFile && <SelectedImportFile file={chatInactiveFile} />}
            </Field>
            <button className="btn-primary min-h-12 self-end" disabled={chatImportSaving || chatMonthDeleting} type="submit">
              {chatImportSaving ? 'Importando...' : 'Importar mês'}
            </button>
            <button
              className="danger-button min-h-12 self-end"
              disabled={chatImportSaving || chatMonthDeleting}
              type="button"
              onClick={() => void handleDeleteChatMonth()}
            >
              {chatMonthDeleting ? 'Excluindo...' : 'Excluir mês'}
            </button>
          </form>
        </div>

        {chatImportMessage && <p className="mt-4 rounded-md bg-slate-900/70 px-4 py-3 text-sm text-slate-200">{chatImportMessage}</p>}

        <div className="mt-6 border-t border-white/10 pt-5">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h4 className="font-semibold">Histórico de importações</h4>
              <p className="mt-1 text-sm text-slate-400">Arquivos e resultados das 12 importações mais recentes.</p>
            </div>
            <button className="secondary-button self-start" type="button" onClick={() => void loadChatImportHistory()}>
              Atualizar histórico
            </button>
          </div>

          <div className="mt-4 space-y-3">
            {chatImportHistory.map((item, index) => {
              const isExpanded = expandedChatImportId
                ? expandedChatImportId === item.id
                : index === 0

              return (
                <article key={item.id} className="overflow-hidden rounded-lg border border-white/10 bg-slate-900/60">
                  <button
                    className="flex w-full flex-col gap-3 p-4 text-left md:flex-row md:items-center md:justify-between"
                    type="button"
                    aria-expanded={isExpanded}
                    onClick={() => setExpandedChatImportId(isExpanded ? '__none__' : item.id)}
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{item.month_label}</span>
                        <span className="rounded-full bg-emerald-400/10 px-2.5 py-1 text-xs font-semibold text-emerald-300">
                          Concluída
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-slate-400">
                        {item.analysts_processed} analistas · {formatDateTime(item.created_at)} · {item.created_by_name || 'Responsável não informado'}
                      </p>
                    </div>
                    <span className="text-sm font-semibold text-cyan-200">
                      {isExpanded ? 'Ocultar arquivos' : 'Ver arquivos'}
                    </span>
                  </button>

                  {isExpanded && (
                    <div className="grid gap-3 border-t border-white/10 p-4 md:grid-cols-2">
                      <ImportFileSummary
                        label="Planilha de satisfação"
                        name={item.satisfaction_file_name}
                        size={item.satisfaction_file_size}
                        rows={item.satisfaction_rows}
                      />
                      <ImportFileSummary
                        label="Planilha de inatividade"
                        name={item.inactivity_file_name}
                        size={item.inactivity_file_size}
                        rows={item.inactivity_rows}
                      />
                    </div>
                  )}
                </article>
              )
            })}

            {chatImportHistoryLoading && <p className="text-sm text-slate-400">Carregando histórico...</p>}
            {!chatImportHistoryLoading && !chatImportHistory.length && (
              <div className="rounded-lg border border-dashed border-white/15 bg-slate-900/40 px-4 py-5">
                <p className="font-medium text-slate-200">O histórico começa na próxima importação.</p>
                <p className="mt-1 text-sm text-slate-400">
                  Os dados já importados continuam válidos; apenas os nomes dos arquivos antigos não foram registrados.
                </p>
              </div>
            )}
          </div>
        </div>
      </section>
      <div className={chatActiveTab === 'overview' ? 'metric-zone grid gap-4 sm:grid-cols-2 xl:grid-cols-6' : 'hidden'}>
        <MetricCard label="Atendimentos" value={formatChatCount(chat2ProductivityTickets)} />
        <MetricCard label="Hoje na base" value={formatChatCount(chat2OperationTodayTickets)} />
        <MetricCard
          label="CSAT do time"
          value={chat2ProductivityCsat === null ? '—' : formatChatPercent(chat2ProductivityCsat)}
          tone={(chat2ProductivityCsat ?? 0) >= 90 ? 'success' : (chat2ProductivityCsat ?? 0) >= 85 ? 'warning' : 'danger'}
        />
        <MetricCard
          label="% de avaliações"
          value={chat2ProductivityReviewPercentage === null ? '—' : formatChatPercent(chat2ProductivityReviewPercentage)}
          tone={(chat2ProductivityReviewPercentage ?? 0) >= 25 ? 'success' : (chat2ProductivityReviewPercentage ?? 0) >= 20 ? 'warning' : 'danger'}
        />
        <MetricCard label="Positivas" value={formatChatCount(chat2ProductivityPositive)} tone="success" />
        <MetricCard label="Negativas" value={formatChatCount(chat2ProductivityNegative)} tone={chat2ProductivityNegative > 0 ? 'warning' : 'success'} />
      </div>

      <CriteriaLegend
        hidden={chatActiveTab !== 'analysis'}
        title="Critérios do pódio do chat"
        items={[
          'CSAT mínimo de 90%',
          'Avaliações a partir de 25%',
          `Volume igual ou acima da média da equipe (${formatChatCount(averageTickets)} atendimentos)`,
        ]}
      />

      <section className={chatActiveTab === 'overview' ? 'panel' : 'hidden'}>
        <div className="grid gap-5 xl:grid-cols-[1.05fr_1.95fr]">
          <div className="rounded-xl border border-white/10 bg-slate-950/35 p-5">
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-cyan-300">Leitura da operação</p>
            <h2 className={`mt-3 text-3xl font-bold ${chat2OperationStatusTone}`}>{chat2OperationStatus}</h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              {chat2SelectedPeriod.label} · {selectedTeamName}
            </p>
            <p className="mt-3 text-sm leading-6 text-slate-400">{chat2OperationReading}</p>

            <div className="mt-5 grid grid-cols-3 gap-2 border-t border-white/10 pt-4 text-center">
              <div>
                <span className="block text-xs text-slate-500">CSAT &lt; 90%</span>
                <strong className="mt-1 block text-xl tabular-nums text-amber-200">{chat2OperationBelowCsat.length}</strong>
              </div>
              <div>
                <span className="block text-xs text-slate-500">Avaliações &lt; 25%</span>
                <strong className="mt-1 block text-xl tabular-nums text-amber-200">{chat2OperationBelowReviews.length}</strong>
              </div>
              <div>
                <span className="block text-xs text-slate-500">Volume em atenção</span>
                <strong className="mt-1 block text-xl tabular-nums text-amber-200">{chat2OperationBelowVolume.length}</strong>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <div className="executive-card">
                <p>CSAT vs mês anterior</p>
                <strong>{chat2OperationCsatDelta === null ? 'Sem base anterior' : formatDelta(chat2OperationCsatDelta, ' p.p.')}</strong>
                <span>
                  Atual: {chat2ProductivityCsat === null ? '—' : formatChatPercent(chat2ProductivityCsat)}
                  {chat2HasPreviousComparison && chat2PreviousAccumulated?.csat !== null && chat2PreviousAccumulated?.csat !== undefined
                    ? ` · anterior ${formatChatPercent(chat2PreviousAccumulated.csat)}`
                    : ' · sem competência ClickDesk anterior'}
                </span>
              </div>
              <div className="executive-card">
                <p>Avaliações vs mês anterior</p>
                <strong>{chat2OperationReviewDelta === null ? 'Sem base anterior' : formatDelta(chat2OperationReviewDelta, ' p.p.')}</strong>
                <span>
                  Atual: {chat2ProductivityReviewPercentage === null ? '—' : formatChatPercent(chat2ProductivityReviewPercentage)}
                  {chat2HasPreviousComparison && chat2PreviousAccumulated?.review_percentage !== null && chat2PreviousAccumulated?.review_percentage !== undefined
                    ? ` · anterior ${formatChatPercent(chat2PreviousAccumulated.review_percentage)}`
                    : ' · sem competência ClickDesk anterior'}
                </span>
              </div>
              <div className="executive-card">
                <p>Volume vs mês anterior</p>
                <strong>{chat2OperationVolumeDelta === null ? 'Sem base anterior' : formatDelta(chat2OperationVolumeDelta)}</strong>
                <span>
                  Atual: {formatChatCount(chat2ProductivityTickets)}
                  {chat2HasPreviousComparison && chat2PreviousAccumulated
                    ? ` · anterior ${formatChatCount(chat2PreviousAccumulated.attendances)}`
                    : ' · sem competência ClickDesk anterior'}
                </span>
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-slate-900/70 p-5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-sm text-slate-400">Contexto operacional</p>
                  <strong className="mt-1 block text-lg text-slate-100">
                    {formatChatCount(chat2ProductivityRows.length)} analista(s) com dados · média de {formatChatCount(chat2ProductivityAverageTickets)} atendimentos
                  </strong>
                </div>
                <span className="text-xs text-slate-500">
                  Referências: CSAT 90% · avaliações 25%
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.14em] text-cyan-300">Leitura por área</p>
              <h3 className="mt-1 text-xl font-bold">Onde o resultado está concentrado?</h3>
            </div>
            <span className="text-xs text-slate-500">Somente atendimentos classificados como analista</span>
          </div>

          {chat2OperationAreas.length > 0 ? (
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              {chat2OperationAreas.map((item) => (
                <div key={item.area} className="rounded-xl border border-white/10 bg-slate-950/35 p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <strong className="text-slate-100">{item.area}</strong>
                      <p className="mt-1 text-xs text-slate-500">
                        {formatChatCount(item.analysts)} analista(s) com dados
                      </p>
                    </div>
                    <strong className="text-xl tabular-nums text-cyan-200">{formatChatCount(item.attendances)}</strong>
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
                    <div>
                      <span className="block text-xs text-slate-500">CSAT</span>
                      <strong className="mt-1 block tabular-nums">
                        {item.csat === null ? '—' : formatChatPercent(item.csat)}
                      </strong>
                    </div>
                    <div>
                      <span className="block text-xs text-slate-500">% avaliações</span>
                      <strong className="mt-1 block tabular-nums">
                        {item.reviewPercentage === null ? '—' : formatChatPercent(item.reviewPercentage)}
                      </strong>
                    </div>
                    <div>
                      <span className="block text-xs text-slate-500">Avaliações</span>
                      <strong className="mt-1 block tabular-nums">{formatChatCount(item.reviews)}</strong>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-4">
              <EmptyState text="Ainda não há dados persistidos do ClickDesk para esta competência." />
            </div>
          )}
        </div>
      </section>

      <section className={chatActiveTab === 'podium' ? 'panel' : 'hidden'}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-cyan-300">Gestão e ações</p>
            <h2 className="mt-2 text-2xl font-bold">Quem precisa da sua atenção e qual é o próximo passo?</h2>
            <p className="section-subtitle">
              Fila construída com a base viva do ClickDesk. Qualidade e participação definem prioridade; somente diferenças relevantes de volume aparecem como contexto operacional a validar, nunca como falha automática.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
            <div className="rounded-lg bg-slate-950/45 px-3 py-2">
              <span className="block text-xs text-slate-500">Prioridades</span>
              <strong className="mt-1 block text-lg tabular-nums text-amber-200">{chat2ManagementPriorities.length}</strong>
            </div>
            <div className="rounded-lg bg-slate-950/45 px-3 py-2">
              <span className="block text-xs text-slate-500">Dentro das metas</span>
              <strong className="mt-1 block text-lg tabular-nums text-emerald-300">{chat2ManagementHealthy.length}</strong>
            </div>
            <div className="rounded-lg bg-slate-950/45 px-3 py-2">
              <span className="block text-xs text-slate-500">Contexto de volume</span>
              <strong className="mt-1 block text-lg tabular-nums text-cyan-200">{chat2ManagementVolumeContexts.length}</strong>
            </div>
            <div className="rounded-lg bg-slate-950/45 px-3 py-2">
              <span className="block text-xs text-slate-500">Negativas</span>
              <strong className="mt-1 block text-lg tabular-nums text-rose-200">{chat2ManagementNegativeReviews}</strong>
            </div>
          </div>
        </div>

        {chat2ManagementPriorities.length > 0 ? (
          <div className="mt-5 space-y-3">
            {chat2ManagementPriorities.map((item, index) => (
              <div key={`${item.area}::${item.assignee_name}`} className="rounded-xl border border-white/10 bg-slate-950/30 p-4">
                <div className="grid gap-4 xl:grid-cols-[auto_1.15fr_1.4fr_1.15fr_auto] xl:items-center">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-300/10 text-sm font-bold text-amber-200">
                    {index + 1}
                  </span>
                  <div>
                    <strong className="text-slate-100">{item.assignee_name}</strong>
                    <p className="mt-1 text-xs text-slate-500">{item.area}</p>
                    <p className="mt-2 text-xs text-slate-400">
                      CSAT {item.csat === null ? '—' : formatChatPercent(item.csat)} · avaliações {item.review_percentage === null ? '—' : formatChatPercent(item.review_percentage)} · {formatChatCount(item.attendances)} atendimentos
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Sinais objetivos</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {item.signals.map((signal) => (
                        <span key={signal} className="rounded-md border border-amber-300/15 bg-amber-300/5 px-2 py-1 text-xs text-amber-100">
                          {signal}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-300">Próxima ação</p>
                    <p className="mt-2 text-sm leading-5 text-slate-300">{item.action}</p>
                  </div>
                  <button
                    type="button"
                    className="small-button"
                    onClick={() => {
                      setChat2LiveAnalystKey(`${item.area}::${item.assignee_name}`)
                      setChatActiveTab('prototype')
                    }}
                  >
                    Abrir analista
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-5 rounded-xl border border-emerald-400/15 bg-emerald-400/5 p-5 text-sm text-emerald-100">
            Nenhum analista está abaixo da meta individual de CSAT ou da referência de 25% de avaliações neste recorte.
          </div>
        )}
      </section>

      <section className={chatActiveTab === 'podium' ? 'panel' : 'hidden'}>
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-cyan-300">Plano de gestão</p>
          <h2 className="mt-2 text-2xl font-bold">O que atacar primeiro?</h2>
          <p className="section-subtitle">
            A leitura abaixo separa qualidade, participação e contexto operacional para evitar que indicadores diferentes recebam a mesma tratativa.
          </p>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          <div className="rounded-xl border border-white/10 bg-slate-900/70 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-200">Qualidade</p>
            <strong className="mt-2 block text-2xl tabular-nums">{chat2ManagementCsatAttention.length}</strong>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              analista(s) abaixo da própria meta de CSAT ou ainda sem base suficiente. Priorize avaliações negativas e fatos observáveis antes do feedback.
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-slate-900/70 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-200">Participação</p>
            <strong className="mt-2 block text-2xl tabular-nums">{chat2ManagementReviewAttention.length}</strong>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              analista(s) abaixo de 25% de avaliações ou ainda sem base. Trabalhe encerramento, confirmação da solução e convite à pesquisa.
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-slate-900/70 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-300">Contexto operacional</p>
            <strong className="mt-2 block text-2xl tabular-nums">{chat2ManagementVolumeContexts.length}</strong>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              analista(s) com volume pelo menos 20% abaixo da média da própria área, quando já existe base mínima. Antes de qualquer cobrança, valide disponibilidade, ausências, apoio a outras demandas e duração dos atendimentos.
            </p>
          </div>
        </div>

        <div className="mt-5 rounded-xl border border-cyan-400/15 bg-cyan-400/5 p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-300">Sequência recomendada</p>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <div className="rounded-lg bg-slate-950/40 p-4">
              <strong className="text-slate-100">1. Validar o fato</strong>
              <p className="mt-2 text-sm leading-6 text-slate-400">Confira o indicador e, quando houver CSAT baixo, leia as avaliações negativas antes de concluir a causa.</p>
            </div>
            <div className="rounded-lg bg-slate-950/40 p-4">
              <strong className="text-slate-100">2. Separar causa de contexto</strong>
              <p className="mt-2 text-sm leading-6 text-slate-400">Volume baixo pede contexto operacional. Qualidade e participação pedem ações diferentes.</p>
            </div>
            <div className="rounded-lg bg-slate-950/40 p-4">
              <strong className="text-slate-100">3. Combinar uma ação observável</strong>
              <p className="mt-2 text-sm leading-6 text-slate-400">Feche o 1:1 com uma mudança concreta e um indicador para acompanhar no próximo recorte.</p>
            </div>
          </div>
        </div>
      </section>


      <section className={chatActiveTab === 'podium' ? 'panel' : 'hidden'}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-violet-200">IA qualitativa · em validação</p>
            <h2 className="mt-2 text-2xl font-bold">Da métrica para a causa</h2>
            <p className="section-subtitle">
              A leitura qualitativa já funciona por ticket. Esta visão consolida somente atendimentos efetivamente analisados e sempre informa a cobertura da amostra antes de mostrar padrões.
            </p>
          </div>
          <span className="rounded-md border border-violet-400/20 bg-violet-400/5 px-3 py-2 text-sm font-semibold text-violet-200">
            Homologação · evidência controlada
          </span>
        </div>

        <div className="mt-5 rounded-xl border border-white/10 bg-slate-950/30 p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-violet-200">Cobertura da leitura qualitativa</p>
              <h3 className="mt-2 text-xl font-bold">Quanto da experiência já foi realmente lido?</h3>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
                A cobertura conta tudo que a IA já leu. Os padrões gerenciais, porém, usam somente análises aprovadas pela gestão.
              </p>
            </div>
            {clickDeskQualitativeSummaryLoading && (
              <span className="text-xs font-semibold text-slate-500">Atualizando...</span>
            )}
          </div>

          {clickDeskQualitativeSummary?.error ? (
            <div className="mt-4 rounded-lg border border-amber-300/20 bg-amber-300/5 p-3 text-sm text-amber-100">
              {clickDeskQualitativeSummary.error}
            </div>
          ) : (
            <>
              {(clickDeskQualitativeSummary?.totals?.evaluated ?? 0) > 0 ? (
                <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                  <div className="rounded-lg bg-slate-900 p-4">
                    <p className="text-xs text-slate-500">Tickets analisados</p>
                    <strong className="mt-2 block text-2xl tabular-nums">
                      {formatChatCount(clickDeskQualitativeSummary?.totals?.analyzed ?? 0)}
                      {' / '}
                      {formatChatCount(clickDeskQualitativeSummary?.totals?.evaluated ?? 0)}
                    </strong>
                    <span className="mt-1 block text-xs text-slate-500">
                      {formatChatPercent(clickDeskQualitativeSummary?.coverage?.evaluated_percentage ?? 0)} da base avaliada
                    </span>
                  </div>
                  <div className="rounded-lg bg-slate-900 p-4">
                    <p className="text-xs text-slate-500">Negativas analisadas</p>
                    <strong className="mt-2 block text-2xl tabular-nums text-amber-100">
                      {formatChatCount(clickDeskQualitativeSummary?.totals?.analyzed_negative ?? 0)}
                      {' / '}
                      {formatChatCount(clickDeskQualitativeSummary?.totals?.negative ?? 0)}
                    </strong>
                    <span className="mt-1 block text-xs text-slate-500">
                      cobertura {formatChatPercent(clickDeskQualitativeSummary?.coverage?.negative_percentage ?? 0)}
                    </span>
                  </div>
                  <div className="rounded-lg bg-slate-900 p-4">
                    <p className="text-xs text-slate-500">Positivas analisadas</p>
                    <strong className="mt-2 block text-2xl tabular-nums text-emerald-200">
                      {formatChatCount(clickDeskQualitativeSummary?.totals?.analyzed_positive ?? 0)}
                      {' / '}
                      {formatChatCount(clickDeskQualitativeSummary?.totals?.positive ?? 0)}
                    </strong>
                    <span className="mt-1 block text-xs text-slate-500">
                      cobertura {formatChatPercent(clickDeskQualitativeSummary?.coverage?.positive_percentage ?? 0)}
                    </span>
                  </div>
                  <div className="rounded-lg bg-slate-900 p-4">
                    <p className="text-xs text-slate-500">Aprovadas pela gestão</p>
                    <strong className="mt-2 block text-2xl tabular-nums text-emerald-200">
                      {formatChatCount(clickDeskQualitativeSummary?.totals?.approved ?? 0)}
                    </strong>
                    <span className="mt-1 block text-xs text-slate-500">
                      {formatChatCount(clickDeskQualitativeSummary?.coaching_signals ?? 0)} com sinal para feedback
                    </span>
                  </div>
                  <div className="rounded-lg bg-slate-900 p-4">
                    <p className="text-xs text-slate-500">Aguardando validação</p>
                    <strong className="mt-2 block text-2xl tabular-nums text-amber-100">
                      {formatChatCount(clickDeskQualitativeSummary?.totals?.pending ?? 0)}
                    </strong>
                    <span className="mt-1 block text-xs text-slate-500">
                      {formatChatCount(clickDeskQualitativeSummary?.totals?.rejected ?? 0)} descartada(s)
                    </span>
                  </div>
                </div>
              ) : (
                <div className="mt-5 rounded-lg border border-dashed border-violet-300/20 bg-violet-300/5 p-4">
                  <strong className="text-slate-100">Nenhuma análise qualitativa iniciada nesta competência.</strong>
                  <p className="mt-2 text-sm leading-6 text-slate-400">
                    Os indicadores objetivos continuam válidos. Use o laboratório abaixo apenas quando quiser validar um transcript real antes de ampliar a automação.
                  </p>
                </div>
              )}

              {(clickDeskQualitativeSummary?.pending_reviews?.length ?? 0) > 0 && (
                <div className="mt-5 rounded-lg border border-violet-400/15 bg-violet-400/5 p-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-violet-200">Validação humana</p>
                      <h4 className="mt-1 font-semibold text-slate-100">Leituras aguardando sua conferência</h4>
                      <p className="mt-1 text-xs text-slate-500">
                        Aprove somente quando causa, influência e evidências fizerem sentido diante do atendimento.
                      </p>
                    </div>
                    <span className="text-xs text-slate-500">
                      {clickDeskQualitativeSummary?.totals?.pending ?? 0} pendente(s)
                    </span>
                  </div>

                  <div className="mt-3 space-y-3">
                    {clickDeskQualitativeSummary?.pending_reviews?.map((item) => {
                      const validating = clickDeskQualitativeValidationTicketId === item.ticket_id
                      return (
                        <div
                          key={item.ticket_id}
                          className="rounded-lg border border-white/10 bg-slate-950/40 p-4"
                        >
                          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                            <div>
                              <strong className="text-sm text-slate-100">{item.analyst_name}</strong>
                              <p className="mt-1 text-xs text-slate-500">
                                Ticket #{item.ticket_id} · {item.satisfaction_label === 'negative' ? 'avaliação negativa' : 'avaliação positiva'}
                              </p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                className="small-button"
                                disabled={validating}
                                onClick={() => void handleValidateClickDeskQualitative(item.ticket_id, 'approved')}
                              >
                                {validating ? 'Salvando...' : 'Aprovar leitura'}
                              </button>
                              <button
                                type="button"
                                className="danger-button"
                                disabled={validating}
                                onClick={() => void handleValidateClickDeskQualitative(item.ticket_id, 'rejected')}
                              >
                                Descartar
                              </button>
                            </div>
                          </div>

                          <div className="mt-3 grid gap-3 lg:grid-cols-3">
                            <div className="rounded-lg bg-slate-900/70 p-3">
                              <p className="text-xs text-slate-500">Causa provável</p>
                              <strong className="mt-1 block text-sm">
                                {formatQualitativeLabel(item.cause.category)}
                                {' · '}
                                confiança {formatQualitativeLabel(item.cause.confidence)}
                              </strong>
                              <p className="mt-2 text-xs leading-5 text-slate-400">{item.cause.summary}</p>
                            </div>
                            <div className="rounded-lg bg-slate-900/70 p-3">
                              <p className="text-xs text-slate-500">Influência humana</p>
                              <strong className="mt-1 block text-sm">
                                {formatQualitativeLabel(item.human_influence.classification)}
                              </strong>
                              <p className="mt-2 text-xs leading-5 text-slate-400">{item.human_influence.summary}</p>
                            </div>
                            <div className="rounded-lg bg-slate-900/70 p-3">
                              <p className="text-xs text-slate-500">Controlabilidade</p>
                              <strong className="mt-1 block text-sm">
                                {formatQualitativeLabel(item.controllability.classification)}
                              </strong>
                              <p className="mt-2 text-xs leading-5 text-slate-400">{item.controllability.summary}</p>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {(clickDeskQualitativeSummary?.validation_queue?.length ?? 0) > 0 && (
                <div className="mt-5 rounded-lg border border-amber-300/15 bg-amber-300/5 p-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-amber-100">Fila de validação</p>
                      <h4 className="mt-1 font-semibold text-slate-100">Negativas ainda não analisadas</h4>
                      <p className="mt-1 text-xs text-slate-500">
                        Até 5 casos reais do filtro atual para validar a leitura da IA antes de ampliar a automação.
                      </p>
                    </div>
                    <span className="text-xs text-slate-500">
                      {clickDeskQualitativeSummary?.validation_queue?.length ?? 0} pendente(s) exibida(s)
                    </span>
                  </div>

                  <div className="mt-3 space-y-2">
                    {clickDeskQualitativeSummary?.validation_queue?.map((item) => (
                      <div
                        key={item.ticket_id}
                        className="grid gap-3 rounded-lg border border-white/10 bg-slate-950/40 px-3 py-3 md:grid-cols-[1fr_auto_auto] md:items-center"
                      >
                        <div>
                          <strong className="text-sm text-slate-100">{item.analyst_name}</strong>
                          <p className="mt-1 text-xs text-slate-500">
                            Ticket #{item.ticket_id} · {formatDate(item.occurred_date)} · {item.area}
                          </p>
                        </div>
                        <span className="rounded-md bg-amber-300/10 px-2 py-1 text-xs font-semibold text-amber-100">
                          Negativa
                        </span>
                        <button
                          type="button"
                          className="small-button"
                          disabled={clickDeskQualitativeLoading}
                          onClick={() => void runManagementQualitativeAnalysis(item.ticket_id)}
                        >
                          {clickDeskQualitativeLoading && clickDeskQualitativeTicketId === item.ticket_id
                            ? 'Analisando...'
                            : 'Analisar agora'}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(clickDeskQualitativeSummary?.totals?.approved ?? 0) > 0 ? (
                <div className="mt-5 grid gap-4 xl:grid-cols-3">
                  <div className="rounded-lg border border-white/10 bg-slate-900/60 p-4">
                    <p className="text-sm font-semibold">Causas validadas na amostra</p>
                    <div className="mt-3 space-y-2">
                      {(clickDeskQualitativeSummary?.causes ?? []).slice(0, 5).map((item) => (
                        <div key={item.key} className="flex items-center justify-between gap-3 text-sm">
                          <span className="text-slate-400">{formatQualitativeLabel(item.key)}</span>
                          <strong className="tabular-nums">{formatChatCount(item.count)}</strong>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-slate-900/60 p-4">
                    <p className="text-sm font-semibold">Influência do atendimento humano</p>
                    <div className="mt-3 space-y-2">
                      {(clickDeskQualitativeSummary?.human_influence ?? []).slice(0, 5).map((item) => (
                        <div key={item.key} className="flex items-center justify-between gap-3 text-sm">
                          <span className="text-slate-400">{formatQualitativeLabel(item.key)}</span>
                          <strong className="tabular-nums">{formatChatCount(item.count)}</strong>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-slate-900/60 p-4">
                    <p className="text-sm font-semibold">Onde estava o controle?</p>
                    <div className="mt-3 space-y-2">
                      {(clickDeskQualitativeSummary?.controllability ?? []).slice(0, 5).map((item) => (
                        <div key={item.key} className="flex items-center justify-between gap-3 text-sm">
                          <span className="text-slate-400">{formatQualitativeLabel(item.key)}</span>
                          <strong className="tabular-nums">{formatChatCount(item.count)}</strong>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (clickDeskQualitativeSummary?.totals?.evaluated ?? 0) > 0 ? (
                <div className="mt-5 rounded-lg border border-dashed border-white/15 bg-slate-900/40 p-4">
                  <p className="font-medium text-slate-200">Os padrões começam na primeira análise aprovada.</p>
                  <p className="mt-1 text-sm leading-6 text-slate-500">
                    Analise conversas reais e aprove as leituras que fizerem sentido. Até lá, esta área permanece vazia em vez de transformar uma hipótese da IA em padrão da operação.
                  </p>
                </div>
              ) : null}

              {(clickDeskQualitativeSummary?.analysts?.length ?? 0) > 0 && (
                <div className="mt-5">
                  <p className="text-sm font-semibold">Cobertura por analista</p>
                  <div className="mt-3 overflow-x-auto rounded-lg border border-white/10">
                    <div className="min-w-[640px] divide-y divide-white/5">
                      {clickDeskQualitativeSummary?.analysts?.map((item) => (
                        <div key={item.analyst_id} className="grid grid-cols-[1.4fr_repeat(4,0.6fr)] gap-3 px-4 py-3 text-sm">
                          <strong className="text-slate-200">{item.analyst_name}</strong>
                          <span className="text-right tabular-nums">{item.analyzed} análises</span>
                          <span className="text-right tabular-nums text-amber-100">{item.negative} neg.</span>
                          <span className="text-right tabular-nums text-emerald-200">{item.positive} pos.</span>
                          <span className="text-right tabular-nums text-cyan-200">{item.coaching_signals} sinais</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <details className="mt-5 rounded-xl border border-violet-400/15 bg-violet-400/5 p-4">
          <summary className="cursor-pointer list-none">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <strong className="text-sm text-violet-100">Laboratório de validação qualitativa</strong>
                <p className="mt-1 text-xs leading-5 text-slate-400">
                  Ferramenta temporária da homologação para validar um ticket por vez antes de automatizar a análise no fluxo de gestão.
                </p>
              </div>
              <span className="text-xs font-semibold text-violet-200">Abrir teste</span>
            </div>
          </summary>

          <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
            <label className="text-sm text-slate-400">
              Ticket ClickDesk persistido
              <input
                className="form-input mt-1"
                value={clickDeskQualitativeTicketId}
                onChange={(event) => setClickDeskQualitativeTicketId(event.target.value)}
                placeholder="Cole o ID do ticket"
              />
            </label>
            <button
              className="btn-primary self-end"
              disabled={clickDeskQualitativeLoading}
              type="button"
              onClick={() => void handleAnalyzeClickDeskQualitative()}
            >
              {clickDeskQualitativeLoading ? 'Analisando...' : 'Analisar transcript'}
            </button>
          </div>

          {clickDeskQualitativeResult?.error && (
            <div className="mt-4 rounded-lg border border-amber-300/20 bg-amber-300/5 px-4 py-3 text-sm text-amber-100">
              {clickDeskQualitativeResult.error}
            </div>
          )}

          {clickDeskQualitativeResult?.analysis && (
            <div className="mt-5 space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-lg bg-slate-950/45 p-4">
                  <p className="text-xs text-slate-500">Sentimento inicial</p>
                  <strong className="mt-1 block">{formatQualitativeLabel(clickDeskQualitativeResult.analysis.initial_sentiment)}</strong>
                </div>
                <div className="rounded-lg bg-slate-950/45 p-4">
                  <p className="text-xs text-slate-500">Sentimento final</p>
                  <strong className="mt-1 block">{formatQualitativeLabel(clickDeskQualitativeResult.analysis.final_sentiment)}</strong>
                </div>
                <div className="rounded-lg bg-slate-950/45 p-4">
                  <p className="text-xs text-slate-500">Influência humana</p>
                  <strong className="mt-1 block">{formatQualitativeLabel(clickDeskQualitativeResult.analysis.human_influence.classification)}</strong>
                </div>
                <div className="rounded-lg bg-slate-950/45 p-4">
                  <p className="text-xs text-slate-500">Controlabilidade</p>
                  <strong className="mt-1 block">{formatQualitativeLabel(clickDeskQualitativeResult.analysis.controllability.classification)}</strong>
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-lg bg-slate-950/45 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-violet-200">Causa provável</p>
                  <p className="mt-2 text-sm font-semibold">
                    {formatQualitativeLabel(clickDeskQualitativeResult.analysis.primary_cause.category)}
                    {' · '}
                    confiança {formatQualitativeLabel(clickDeskQualitativeResult.analysis.primary_cause.confidence)}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-slate-400">{clickDeskQualitativeResult.analysis.primary_cause.summary}</p>
                </div>
                <div className="rounded-lg bg-slate-950/45 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-violet-200">Influência do atendimento humano</p>
                  <p className="mt-2 text-sm font-semibold">
                    {formatQualitativeLabel(clickDeskQualitativeResult.analysis.human_influence.classification)}
                    {' · '}
                    confiança {formatQualitativeLabel(clickDeskQualitativeResult.analysis.human_influence.confidence)}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-slate-400">{clickDeskQualitativeResult.analysis.human_influence.summary}</p>
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-lg bg-slate-950/45 p-4">
                  <p className="text-sm font-semibold">Evidências resumidas</p>
                  {clickDeskQualitativeResult.analysis.evidence_summary.length ? (
                    <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-slate-400">
                      {clickDeskQualitativeResult.analysis.evidence_summary.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-sm text-slate-500">Nenhuma evidência suficiente foi retornada.</p>
                  )}
                </div>
                <div className="rounded-lg bg-slate-950/45 p-4">
                  <p className="text-sm font-semibold">Limitações da leitura</p>
                  {clickDeskQualitativeResult.analysis.limitations.length ? (
                    <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-slate-400">
                      {clickDeskQualitativeResult.analysis.limitations.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-sm text-slate-500">Nenhuma limitação adicional registrada.</p>
                  )}
                </div>
              </div>

              <p className="text-xs text-slate-500">
                Ticket {clickDeskQualitativeResult.ticket_id} · {formatChatCount(clickDeskQualitativeResult.transcript_characters_analyzed ?? 0)} caracteres analisados · modelo {clickDeskQualitativeResult.model ?? 'não informado'}.
              </p>
            </div>
          )}
        </details>
      </section>

      <section className={chatActiveTab === 'reports' ? 'panel' : 'hidden'}>
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-cyan-300">Leitura para fechamento</p>
            <p className="mt-1 text-xs text-slate-500">Fonte: {chatReportSourceLabel}</p>
            <h2 className="mt-2 text-2xl font-bold">{chatReportClosureReading}</h2>
          </div>
          <span className="rounded-md bg-cyan-400/10 px-3 py-2 text-sm font-semibold text-cyan-200">
            {chatReportEligibleCount} {chatReportEligibleCount === 1 ? 'elegível' : 'elegíveis'} de {chatReportCalculationMetrics.length}
          </span>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          <div className="rounded-lg bg-slate-900 p-4">
            <p className="text-sm text-slate-400">Destaque do período</p>
            <p className="mt-2 text-lg font-bold">{chatReportTopHighlight ? getChatAnalystName(chatReportTopHighlight) : 'Aguardando dados'}</p>
            <p className="mt-1 text-sm text-slate-300">
              {chatReportTopHighlight ? `CSAT ${formatChatPercent(chatReportTopHighlight.csat)} | ${formatChatPercent(chatReportTopHighlight.review_percentage)} avaliações | ${formatChatCount(chatReportTopHighlight.total_tickets)} atendimentos` : 'Selecione uma competência com dados para liberar a leitura.'}
            </p>
          </div>
          <div className="rounded-lg bg-slate-900 p-4">
            <p className="text-sm text-slate-400">Principal ponto de atenção</p>
            <p className="mt-2 text-lg font-bold">{chatReportAttentionHighlight ? getChatAnalystName(chatReportAttentionHighlight) : 'Sem prioridade aberta'}</p>
            <p className="mt-1 text-sm text-slate-300">{chatReportAttentionText}</p>
          </div>
          <div className="rounded-lg bg-slate-900 p-4">
            <p className="text-sm text-slate-400">Referência mínima de volume</p>
            <p className="mt-2 text-lg font-bold tabular-nums">{formatChatCount(chatReportVolumeReference)} atendimentos</p>
            <p className="mt-1 text-sm text-slate-300">
              Para cumprir o critério de volume neste período, é necessário atingir pelo menos essa quantidade de atendimentos.
            </p>
          </div>
        </div>
      </section>

      <section className={chatActiveTab === 'analysis' ? 'panel' : 'hidden'}>
        <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
          <EligibilityFunnel
            title="Funil de elegibilidade do chat"
            subtitle="Mostra onde o pódio mensal está afunilando: qualidade, avaliações, volume ou combinação dos três."
            items={chatFunnelItems}
          />
          <ComparisonBars
            title="Comparativo visual dos analistas"
            subtitle="Mostra rapidamente quem combina qualidade, amostra de avaliações e volume no período."
            rows={chatVisualRows}
            primaryGoal={90}
            secondaryGoal={25}
            volumeReference={averageTickets}
          />
        </div>
        <div className="mt-6">
          <VolumeQualityMap
            title="Mapa volume x CSAT"
            subtitle="Quanto mais para a direita, maior o volume. Quanto mais para cima, melhor o CSAT."
            points={chatVisualPoints}
            xReference={averageTickets}
            yReference={90}
          />
        </div>
      </section>

      <section className={chatActiveTab === 'overview' ? 'panel' : 'hidden'}>
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-cyan-300">Histórico anterior · Zendesk</p>
          <h2 className="mt-2 text-2xl font-bold">Série preservada dos fechamentos anteriores</h2>
          <p className="section-subtitle">
            Estes números pertencem ao histórico legado do Zendesk e ficam preservados apenas para comparação histórica. Eles não entram nos cálculos da fotografia ClickDesk exibida acima.
          </p>
        </div>

        <div className="mt-5 grid gap-5 xl:grid-cols-2">
          <div className="rounded-xl border border-white/10 bg-slate-950/25 p-4">
            <p className="mb-3 text-sm font-semibold text-slate-200">Qualidade e avaliações</p>
            <GroupedPercentTrendChart
              points={monthlyUnifiedTrend}
              series={[
                { key: 'csat', label: 'CSAT', color: 'bg-cyan-300' },
                { key: 'reviews', label: 'Avaliações', color: 'bg-emerald-300' },
                { key: 'sending', label: '% sem avaliação', color: 'bg-amber-300' },
              ]}
            />
          </div>

          <TrendLineChart
            label="Atendimentos mensais"
            points={monthlyVolumeTrend}
            singlePointLabel="Apenas uma competência disponível para comparação."
            latestPointLabel="Última competência"
            highlightedPointLabel="Competência destacada"
          />
        </div>

        <p className="mt-5 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
          Indicadores do fechamento legado
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-lg bg-slate-900 p-4">
            <p className="text-sm text-slate-400">Atendimentos válidos</p>
            <strong className="mt-2 block text-2xl tabular-nums">{formatChatCount(totals.validTickets)}</strong>
          </div>
          <div className="rounded-lg bg-slate-900 p-4">
            <p className="text-sm text-slate-400">Inativos</p>
            <strong className="mt-2 block text-2xl tabular-nums">{formatChatCount(totals.inactive)}</strong>
          </div>
          <div className="rounded-lg bg-slate-900 p-4">
            <p className="text-sm text-slate-400">Avaliações recebidas</p>
            <strong className="mt-2 block text-2xl tabular-nums">{formatChatCount(totals.reviews)}</strong>
          </div>
          <div className="rounded-lg bg-slate-900 p-4">
            <p className="text-sm text-slate-400">Metas superadas</p>
            <strong className="mt-2 block text-2xl tabular-nums">{chatGoalsReachedCount}</strong>
          </div>
        </div>
      </section>

      <section className={chatActiveTab === 'reports' ? 'panel' : 'hidden'}>
        <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <h2 className="section-title">Pódio final do chat</h2>
            <p className="section-subtitle">
              O ranking automático define os elegíveis. O ajuste manual pode reorganizar a ordem entre eles, mas não coloca no pódio quem deixou de cumprir os critérios.
            </p>
          </div>
          {chatReportActiveManualPodium.length > 0 && (
            <span className="rounded-md bg-cyan-400/10 px-3 py-2 text-sm font-semibold text-cyan-200">
              Pódio manual ativo
            </span>
          )}
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-3">
          {[0, 1, 2].map((index) => {
            const winner = chatReportPodium[index]

            return (
              <div key={index} className="rounded-lg bg-slate-900 p-4">
                <p className="text-sm text-slate-400">{index + 1}º lugar</p>
                {winner ? (
                  <>
                    <div className="mt-3 flex items-center gap-3">
                      <AnalystAvatar name={getChatAnalystName(winner)} photoUrl={getChatAnalystPhoto(winner)} size="md" />
                      <p className="text-lg font-bold">{getChatAnalystName(winner)}</p>
                    </div>
                    <p className="mt-2 text-sm text-slate-300">CSAT {formatChatPercent(winner.csat)} | {formatChatPercent(winner.review_percentage)} avaliações | {formatChatCount(winner.total_tickets)} atendimentos</p>
                  </>
                ) : (
                  <p className="mt-3 text-slate-400">Aguardando elegível</p>
                )}
              </div>
            )
          })}
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto_auto]">
          {[1, 2, 3].map((position) => (
            <Field key={position} label={`${position}o lugar manual`}>
              <select
                className="form-input"
                disabled={selectedTeamId === 'all'}
                value={getManualPodiumDraftValue(position)}
                onChange={(event) => setManualPodiumDraft((current) => ({ ...current, [position]: event.target.value }))}
              >
                <option value="">Automático</option>
                {chatReportRanking
                  .filter((item) => item.eligible)
                  .map((item) => (
                    <option key={item.metric.id} value={item.metric.analyst_id}>
                      {getChatAnalystName(item.metric)}
                    </option>
                  ))}
              </select>
            </Field>
          ))}
          <button className="btn-primary self-end" type="button" onClick={handleSaveChatManualPodium}>
            Salvar pódio
          </button>
          <button className="secondary-button self-end" type="button" onClick={handleResetChatManualPodium}>
            Resetar
          </button>
          </div>

        {selectedTeamId === 'all' && (
          <p className="mt-3 text-sm text-slate-400">Para ajustar manualmente, selecione uma equipe específica no filtro do módulo chat.</p>
        )}
        {chatPodiumMessage && <p className="mt-4 rounded-md bg-slate-900/70 px-4 py-3 text-sm text-slate-200">{chatPodiumMessage}</p>}
      </section>

      <div className={chatActiveTab === 'reports' ? 'grid gap-6 xl:grid-cols-2' : 'hidden'}>
        <section className="panel xl:col-span-2">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="section-title">Ranking mensal do chat</h2>
              <p className="section-subtitle">
                Lista final do período, do primeiro ao último. Critérios: CSAT mínimo 90%, avaliações a partir de 25% e volume acima da média do período.
              </p>
            </div>
            <span className="rounded-md bg-cyan-400/10 px-3 py-2 text-sm font-semibold text-cyan-200">
              Referência mínima: {formatChatCount(chatReportVolumeReference)} atendimentos
            </span>
          </div>

          {chatReportExclusions.length > 0 && (
            <div className="mt-4 rounded-lg border border-amber-300/30 bg-amber-300/10 px-4 py-3 text-sm text-amber-100">
              Cálculos refeitos com {chatReportCalculationMetrics.length} analista(s). {chatReportExclusions.length} registro(s)
              desconsiderado(s) integralmente neste período por exceção operacional.
            </div>
          )}

          <div className="mt-5 grid gap-4 md:grid-cols-4">
            <div className="rounded-lg bg-slate-900 p-4">
              <p className="text-sm text-slate-400">Elegíveis</p>
              <p className="mt-2 text-2xl font-bold text-emerald-300">{chatReportEligibleCount}</p>
            </div>
            <div className="rounded-lg bg-slate-900 p-4">
              <p className="text-sm text-slate-400">Fora por volume</p>
              <p className="mt-2 text-2xl font-bold text-amber-200">
                {chatReportRanking.filter((item) => item.reasons.some((reason) => reason.includes('volume abaixo'))).length}
              </p>
            </div>
            <div className="rounded-lg bg-slate-900 p-4">
              <p className="text-sm text-slate-400">Fora por CSAT</p>
              <p className="mt-2 text-2xl font-bold text-amber-200">
                {chatReportRanking.filter((item) => item.reasons.some((reason) => reason.includes('CSAT abaixo'))).length}
              </p>
            </div>
            <div className="rounded-lg bg-slate-900 p-4">
              <p className="text-sm text-slate-400">Fora por avaliações</p>
              <p className="mt-2 text-2xl font-bold text-amber-200">
                {chatReportRanking.filter((item) => item.reasons.some((reason) => reason.includes('avaliações abaixo'))).length}
              </p>
            </div>
          </div>

          <div className="mt-5 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-slate-400">
                <tr>
                  <th className="pb-3 pr-4 font-medium">Posição</th>
                  <th className="pb-3 pr-4 font-medium">Analista</th>
                  <th className="pb-3 pr-4 font-medium">CSAT</th>
                  <th className="pb-3 pr-4 font-medium">Avaliações</th>
                  <th className="pb-3 pr-4 font-medium">Atendimentos</th>
                  <th className="pb-3 pr-4 font-medium">Vs. referência</th>
                  <th className="pb-3 pr-4 font-medium">Status</th>
                  <th className="pb-3 pr-4 font-medium">Motivo</th>
                  <th className="pb-3 font-medium">Cálculo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {chatReportRanking.map((item, index) => {
                  const volumeGap = Number(item.metric.total_tickets) - chatReportVolumeReference
                  const excluded = Boolean(getChatPodiumExclusion(item.metric))

                  return (
                    <tr key={item.metric.id}>
                      <td className="py-3 pr-4 font-bold text-cyan-300">{item.excluded ? '—' : `${index + 1}º`}</td>
                      <td className="py-3 pr-4 font-semibold">{getChatAnalystName(item.metric)}</td>
                      <td className="whitespace-nowrap py-3 pr-4 tabular-nums">{formatChatPercent(item.metric.csat)}</td>
                      <td className="whitespace-nowrap py-3 pr-4 tabular-nums">{formatChatPercent(item.metric.review_percentage)}</td>
                      <td className="whitespace-nowrap py-3 pr-4 tabular-nums">{formatChatCount(item.metric.total_tickets)}</td>
                      <td className={`whitespace-nowrap py-3 pr-4 font-semibold tabular-nums ${volumeGap >= 0 ? 'text-emerald-300' : 'text-amber-200'}`}>
                        {volumeGap >= 0 ? '+' : ''}{formatChatCount(volumeGap)}
                      </td>
                      <td className="py-3 pr-4">
                        {item.eligible ? (
                          <span className="text-emerald-300">Elegível</span>
                        ) : excluded ? (
                          <span className="text-amber-200">Desconsiderado</span>
                        ) : (
                          <span className="text-slate-400">Não elegível</span>
                        )}
                      </td>
                      <td className="py-3 pr-4 text-slate-300">
                        {item.eligible ? 'Cumpriu todos os critérios.' : formatStatusText(item.reasons.join(', '))}
                      </td>
                      <td className="py-3">
                        <button className="small-button" type="button" onClick={() => handleToggleChatPodiumExclusion(item.metric)}>
                          {excluded ? 'Incluir novamente' : 'Desconsiderar'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            {!chatReportRanking.length && <EmptyState text="Nenhum dado de chat encontrado neste período." />}
          </div>
        </section>

      </div>


      <section className={chatActiveTab === 'analysis' ? 'panel' : 'hidden'}>
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-cyan-300">Análise detalhada</p>
          <h2 className="section-title">Diagnóstico por analista</h2>
          <p className="section-subtitle">
            Compare CSAT, avaliações, percentual sem avaliação e volume com as referências do período para localizar destaques e oportunidades.
          </p>
        </div>

        <div className="mt-5 grid gap-6 xl:grid-cols-2">
          <div className="rounded-lg bg-slate-900 p-5">
            <h3 className="text-xl font-bold">Top performers</h3>
            <div className="mt-4 space-y-3">
              {chatTopPerformers.length ? (
                chatTopPerformers.map((item, index) => (
                  <div key={item.metric.id} className="rounded-md bg-slate-950/60 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm text-cyan-300">{index + 1}o destaque</p>
                        <p className="mt-1 font-semibold">{getChatAnalystName(item.metric)}</p>
                      </div>
                      <strong>{formatChatPercent(item.metric.csat)}</strong>
                    </div>
                    <p className="mt-2 text-sm text-slate-400">
                      Avaliações {formatChatPercent(item.metric.review_percentage)}, atendimento {formatChatCount(item.metric.total_tickets)} e meta CSAT {item.metric.csat_goal}%.
                    </p>
                  </div>
                ))
              ) : (
                <EmptyState text="Ainda não há destaque no filtro selecionado." />
              )}
            </div>
          </div>

          <div className="rounded-lg bg-slate-900 p-5">
            <h3 className="text-xl font-bold">Oportunidades</h3>
            <div className="mt-4 space-y-3">
              {chatOpportunities.length ? (
                chatOpportunities.map((item) => (
                  <div key={item.metric.id} className="rounded-md bg-slate-950/60 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-semibold">{getChatAnalystName(item.metric)}</p>
                      <span className="text-sm text-amber-200">{item.metric.status}</span>
                    </div>
                    <p className="mt-2 text-sm text-slate-400">{item.reasons.length ? formatStatusText(item.reasons.join(', ')) : 'Acompanhar estabilidade dos indicadores.'}</p>
                    <p className="mt-2 text-sm text-slate-300">
                      CSAT {formatDelta(item.csatDelta, ' p.p.')}, avaliações {formatDelta(item.reviewDelta, ' p.p.')} e envio {formatDelta(item.sendingDelta, ' p.p.')}.
                    </p>
                  </div>
                ))
              ) : (
                <EmptyState text="Nenhuma oportunidade crítica encontrada neste período." />
              )}
            </div>
          </div>
        </div>

        <div className="mt-6 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-slate-400">
              <tr>
                <th className="pb-3 pr-4 font-medium">Analista</th>
                <th className="pb-3 pr-4 font-medium">Status</th>
                <th className="pb-3 pr-4 font-medium">CSAT</th>
                <th className="pb-3 pr-4 font-medium">Delta CSAT</th>
                <th className="pb-3 pr-4 font-medium">Avaliações</th>
                <th className="pb-3 pr-4 font-medium">Delta aval.</th>
                <th className="pb-3 pr-4 font-medium">Envio</th>
                <th className="pb-3 pr-4 font-medium">Atendimentos</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {chatRanking.map((item) => (
                <tr key={item.metric.id}>
                  <td className="py-3 pr-4 font-semibold">{getChatAnalystName(item.metric)}</td>
                  <td className="py-3 pr-4">{item.metric.status}</td>
                  <td className="whitespace-nowrap py-3 pr-4 tabular-nums">{formatChatPercent(item.metric.csat)}</td>
                  <td className="py-3 pr-4">{formatDelta(round(Number(item.metric.csat) - Number(item.metric.csat_goal)), ' p.p.')}</td>
                  <td className="whitespace-nowrap py-3 pr-4 tabular-nums">{formatChatPercent(item.metric.review_percentage)}</td>
                  <td className="py-3 pr-4">{formatDelta(round(Number(item.metric.review_percentage) - Number(item.metric.general_review_goal)), ' p.p.')}</td>
                  <td className="whitespace-nowrap py-3 pr-4 tabular-nums">{formatChatPercent(item.metric.sending_percentage)}</td>
                  <td className="whitespace-nowrap py-3 pr-4 tabular-nums">{formatChatCount(item.metric.total_tickets)} / média {formatChatCount(averageTickets)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!chatRanking.length && <EmptyState text="Nenhum dado para análise neste filtro." />}
        </div>
      </section>
      <section className={chatActiveTab === 'reports' ? 'panel' : 'hidden'}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-cyan-300">Relatório individual</p>
            <h2 className="section-title">Fechamento mensal por analista</h2>
            <p className="section-subtitle">
              Fluxo guiado: confira os dados, gere o feedback, revise o texto final e exporte o documento individual.
            </p>
            <p className="mt-2 text-xs text-slate-500">
              Fonte desta competência: <strong className="text-slate-300">{chatReportSourceLabel}</strong>
            </p>
          </div>

          <div className="grid flex-1 gap-3 md:grid-cols-3">
            <Field label="1. Analista">
              <select
                className="form-input"
                value={selectedChatReportMetric?.id ?? ''}
                onChange={(event) => {
                  setSelectedChatReportMetricId(event.target.value)
                  setChatFeedbackDraft('')
                  setChatReportQualitativeStatus('')
                }}
              >
                {chatReportMetrics.map((metric) => (
                  <option key={metric.id} value={metric.id}>
                    {getChatAnalystName(metric)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="2. Modelo do feedback">
              <select
                className="form-input"
                value={chatFeedbackStyle}
                onChange={(event) => {
                  setChatFeedbackStyle(event.target.value as ChatFeedbackStyle)
                  setChatFeedbackDraft('')
                }}
              >
                <option value="coach">Coach</option>
                <option value="mimo">MIMO</option>
                <option value="sare">SARE</option>
              </select>
            </Field>
            <Field label="Objetivo">
              <select className="form-input" value={chatFeedbackGoal} onChange={(event) => setChatFeedbackGoal(event.target.value as FeedbackGoal)}>
                <option value="recognition">Reconhecer e manter</option>
                <option value="courseCorrection">Corrigir rota</option>
                <option value="development">Desenvolver comportamento</option>
                <option value="maintenance">Proteger padrão</option>
              </select>
            </Field>
          </div>
        </div>

        {selectedChatReportMetric ? (
          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <MetricCard label="CSAT" value={formatChatPercent(selectedChatReportMetric.csat)} />
            <MetricCard label="% de avaliações" value={formatChatPercent(selectedChatReportMetric.review_percentage)} />
            <MetricCard label="Avaliações recebidas" value={formatChatCount(selectedChatReportMetric.reviews)} />
            <MetricCard label="Atendimentos" value={selectedChatReportMetric.total_tickets} />
            <MetricCard label="Pódio" value={selectedChatPodiumPosition > 0 ? `${selectedChatPodiumPosition}º lugar` : 'Fora'} />
          </div>
        ) : (
          <EmptyState text="Selecione um analista com dados para gerar o relatório." />
        )}

        <div className="mt-5 grid gap-4 lg:grid-cols-4">
          <div className="rounded-lg bg-slate-900 p-4 text-sm text-slate-300">
            <p className="font-semibold text-slate-100">1. Conferir</p>
            <p className="mt-2">Verifique período, analista, CSAT, avaliações, volume e posição no pódio.</p>
          </div>
          <div className="rounded-lg bg-slate-900 p-4 text-sm text-slate-300">
            <p className="font-semibold text-slate-100">2. Entender a amostra</p>
            <p className="mt-2">Prepare até 3 negativas e 5 positivas e valide as leituras antes de levá-las ao feedback.</p>
          </div>
          <div className="rounded-lg bg-slate-900 p-4 text-sm text-slate-300">
            <p className="font-semibold text-slate-100">3. Revisar feedback</p>
            <p className="mt-2">Combine indicadores, evidências qualitativas e suas observações antes do texto final.</p>
          </div>
          <div className="rounded-lg bg-slate-900 p-4 text-sm text-slate-300">
            <p className="font-semibold text-slate-100">4. Exportar</p>
            <p className="mt-2">O arquivo individual será gerado para envio ao colaborador no fechamento mensal.</p>
          </div>
        </div>

        <div className="mt-5 grid gap-4">
          <Field label="3. Observações do gestor">
            <textarea
              className="form-input min-h-24"
              value={chatManagerNotes}
              onChange={(event) => setChatManagerNotes(event.target.value)}
              placeholder="Inclua o contexto do mês, combinados, pontos de atenção ou reconhecimento para orientar o feedback."
            />
          </Field>


          <div className="rounded-xl border border-violet-400/15 bg-violet-400/5 p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-violet-200">Leitura qualitativa opcional</p>
                <p className="mt-1 text-sm text-slate-300">
                  Prepare a amostra e depois valide as leituras em Gestão e ações. Somente o que for aprovado entra como evidência do feedback.
                </p>
                {chatReportQualitativeStatus && (
                  <p className="mt-2 text-xs leading-5 text-slate-400">{chatReportQualitativeStatus}</p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  className="btn-secondary shrink-0 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={!selectedChatReportMetric || chatReportQualitativePreparing}
                  type="button"
                  onClick={() => void handlePrepareChatQualitativeSample()}
                >
                  {chatReportQualitativePreparing ? 'Preparando leitura...' : 'Preparar leitura qualitativa'}
                </button>
                <button
                  className="small-button shrink-0"
                  type="button"
                  onClick={() => setChatActiveTab('podium')}
                >
                  Ir para validação
                </button>
              </div>
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-[auto_auto_auto_1fr] lg:items-start">
            <button
              className="btn-secondary disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!selectedChatReportMetric}
              type="button"
              onClick={handleGenerateChatFeedbackDraft}
            >
              Gerar base factual
            </button>
            <button
              className="btn-primary disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!selectedChatReportMetric || chatAiSaving}
              type="button"
              onClick={handleGenerateChatFeedbackWithAi}
            >
              {chatAiSaving ? 'Gerando...' : 'Gerar texto assistido'}
            </button>
            <button
              className="btn-secondary disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!selectedChatReportMetric || chatAiSaving || !chatFeedbackDraft.trim()}
              type="button"
              onClick={handleImproveChatFeedbackWithAi}
            >
              Melhorar texto atual
            </button>
            <p className="text-sm text-slate-300">
              A base factual resume os dados sem interpretar comportamentos. A IA usa o objetivo e suas observações para criar uma devolutiva individual e humana.
            </p>
          </div>

          <Field label="Texto final do feedback">
            <textarea
              className="form-input min-h-56"
              value={chatFeedbackDraft}
              onChange={(event) => setChatFeedbackDraft(event.target.value)}
              placeholder="Gere uma sugestão ou escreva aqui o feedback final que irá para o relatório."
            />
          </Field>

          <button
            className="btn-primary w-fit disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!selectedChatReportMetric}
            type="button"
            onClick={handleExportChatIndividualReport}
          >
            6. Exportar relatório Word
          </button>
        </div>

        {chatExportMessage && <p className="mt-4 rounded-md bg-slate-900/70 px-4 py-3 text-sm text-slate-200">{chatExportMessage}</p>}
      </section>
      
      <section className={chatActiveTab === 'reports' ? 'panel' : 'hidden'}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-cyan-300">
              Fechamento oficial ClickDesk
            </p>
            <h3 className="mt-2 text-2xl font-bold">Aprovação final da competência</h3>
            <p className="section-subtitle">
              Depois de revisar leitura, pódio, ranking e relatórios individuais, confira a base persistida e preserve o resultado oficial da competência.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className="secondary-button"
              disabled={clickDeskClosureLoading}
              onClick={() => void handleLoadClickDeskClosurePreview()}
            >
              {clickDeskClosureLoading ? 'Conferindo...' : 'Conferir prévia'}
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={
                clickDeskClosureLoading ||
                !clickDeskClosurePreview?.fechamento?.pronto ||
                !clickDeskClosurePreview?.conferencia ||
                Boolean(clickDeskOfficialClosure?.fechamento_id)
              }
              onClick={() => void handleApproveClickDeskClosure()}
            >
              {clickDeskOfficialClosure?.fechamento_id
                ? 'Competência fechada'
                : 'Aprovar fechamento oficial'}
            </button>
          </div>
        </div>

        {clickDeskClosureMessage && (
          <div className="mt-4 rounded-lg border border-amber-300/20 bg-amber-300/5 px-4 py-3 text-sm text-amber-100">
            {clickDeskClosureMessage}
          </div>
        )}

        {!clickDeskClosurePreview && !clickDeskClosureMessage && (
          <div className="mt-5 rounded-xl border border-dashed border-white/15 bg-slate-950/30 p-5 text-sm text-slate-300">
            Use “Conferir prévia” para validar a competência selecionada e a equipe atual antes do fechamento.
          </div>
        )}

        {clickDeskClosurePreview && (
          <div className="mt-5 space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                label="Operação humana"
                value={formatChatCount(clickDeskClosurePreview.operacao?.attendances ?? 0)}
              />
              <MetricCard
                label="Performance · analistas"
                value={formatChatCount(clickDeskClosurePreview.performance?.attendances ?? 0)}
              />
              <MetricCard
                label="CSAT · analistas"
                value={
                  clickDeskClosurePreview.performance?.csat == null
                    ? '—'
                    : formatChatPercent(clickDeskClosurePreview.performance.csat)
                }
              />
              <MetricCard
                label="Apoio de gestão"
                value={formatChatCount(clickDeskClosurePreview.apoio_gestao?.attendances ?? 0)}
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-white/10 bg-slate-900/70 p-5">
                <p className="text-sm font-semibold">Qualidade da base</p>
                <div className="mt-3 grid gap-2 text-sm text-slate-300">
                  <span>
                    Sem identidade: <strong>{formatChatCount(clickDeskClosurePreview.qualidade_dados?.unmapped_attendances ?? 0)}</strong>
                  </span>
                  <span>
                    Fallback temporal: <strong>{formatChatCount(clickDeskClosurePreview.qualidade_dados?.fallback_timestamp_attendances ?? 0)}</strong>
                  </span>
                  <span>
                    Sem equipe: <strong>{formatChatCount(clickDeskClosurePreview.qualidade_dados?.missing_team_attendances ?? 0)}</strong>
                  </span>
                  <span>
                    Cadastro/meta incompleto: <strong>{formatChatCount(clickDeskClosurePreview.qualidade_dados?.analyst_metadata_issues ?? 0)}</strong>
                  </span>
                </div>
              </div>

              <div className="rounded-xl border border-white/10 bg-slate-900/70 p-5">
                <p className="text-sm font-semibold">Status do fechamento</p>
                {clickDeskOfficialClosure?.fechamento_id ? (
                  <div className="mt-3 rounded-lg border border-emerald-400/20 bg-emerald-400/5 px-4 py-3 text-sm text-emerald-100">
                    Fechamento oficial preservado. ID {clickDeskOfficialClosure.fechamento_id.slice(0, 8)}…
                  </div>
                ) : clickDeskClosurePreview.fechamento?.pronto ? (
                  <div className="mt-3 rounded-lg border border-emerald-400/20 bg-emerald-400/5 px-4 py-3 text-sm text-emerald-100">
                    Competência pronta para aprovação oficial.
                  </div>
                ) : (
                  <div className="mt-3 rounded-lg border border-amber-300/20 bg-amber-300/5 px-4 py-3 text-sm text-amber-100">
                    <strong>Ainda não pode fechar.</strong>
                    <ul className="mt-2 list-disc space-y-1 pl-5">
                      {(clickDeskClosurePreview.fechamento?.pendencias ?? []).map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>

            <p className="text-xs text-slate-500">
              Snapshot: {clickDeskClosurePreview.analistas?.length ?? 0} analista(s) com resultado congelável · meta de avaliações 25% · meta de CSAT preservada por analista.
            </p>
          </div>
        )}
      </section>


      <section className={chatActiveTab === 'settings' ? 'panel' : 'hidden'}>
        <div className="flex flex-col gap-6 xl:flex-row">
          <div className="xl:w-2/5">
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-cyan-300">Cadastro do chat</p>
            <h2 className="section-title">{editingChatAnalystId ? 'Editar meta do analista' : 'Incluir analista do chat'}</h2>
            <p className="section-subtitle">
              Cadastre analistas por equipe e mantenha a meta individual de CSAT usada nas importações e relatórios do chat.
            </p>

            <form className="mt-5 grid gap-4" onSubmit={handleChatAnalystSubmit}>
              <Field label="Equipe">
                <select
                  className="form-input"
                  value={chatAnalystForm.teamId}
                  onChange={(event) => setChatAnalystForm({ ...chatAnalystForm, teamId: event.target.value })}
                  required
                >
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Nome do analista">
                <input
                  className="form-input"
                  value={chatAnalystForm.name}
                  onChange={(event) => setChatAnalystForm({ ...chatAnalystForm, name: event.target.value })}
                  required
                />
              </Field>

              <Field label="Meta CSAT individual (%)">
                <input
                  className="form-input"
                  min="0"
                  max="100"
                  step="0.01"
                  type="number"
                  value={chatAnalystForm.csatGoal}
                  onChange={(event) => setChatAnalystForm({ ...chatAnalystForm, csatGoal: event.target.value })}
                  required
                />
              </Field>

              <Field label={editingChatAnalystId ? 'Substituir foto' : 'Foto do analista'}>
                <input
                  accept="image/png,image/jpeg,image/webp"
                  className="form-input"
                  type="file"
                  onChange={(event) => setChatAnalystForm({ ...chatAnalystForm, photoFile: event.target.files?.[0] ?? null })}
                />
                <p className="mt-2 text-xs text-slate-400">PNG, JPG ou WEBP, com até 5 MB.</p>
              </Field>

              <div className="flex flex-wrap gap-3">
                <button className="primary-button" disabled={chatAnalystSaving} type="submit">
                  {chatAnalystSaving ? 'Salvando...' : editingChatAnalystId ? 'Salvar alterações' : 'Incluir analista'}
                </button>

                {editingChatAnalystId && (
                  <button className="secondary-button" type="button" onClick={resetChatAnalystForm}>
                    Cancelar
                  </button>
                )}
              </div>
            </form>

            {chatAnalystMessage && (
              <p className="mt-4 rounded-md bg-slate-900/70 px-4 py-3 text-sm text-slate-200">{chatAnalystMessage}</p>
            )}
          </div>

          <div className="flex-1 overflow-x-auto">
            <h3 className="text-xl font-bold">Analistas e metas cadastradas</h3>
            <p className="section-subtitle">
              Inative para preservar histórico. Exclua apenas cadastros criados por engano.
            </p>
            <table className="mt-5 min-w-full text-left text-sm">
              <thead className="text-slate-400">
                <tr>
                  <th className="pb-3 pr-4 font-medium">Analista</th>
                  <th className="pb-3 pr-4 font-medium">Equipe</th>
                  <th className="pb-3 pr-4 font-medium">Meta CSAT</th>
                  <th className="pb-3 pr-4 font-medium">Status</th>
                  <th className="pb-3 font-medium">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {[...analysts]
                  .sort((a, b) => `${getChatTeamNameById(teams, a.team_id)} ${a.name}`.localeCompare(`${getChatTeamNameById(teams, b.team_id)} ${b.name}`))
                  .map((analyst) => {
                    const hasImportedHistory = chatAnalystIdsWithHistory.has(analyst.id)
                    const displayedPhotoUrl = Object.prototype.hasOwnProperty.call(chatAnalystPhotoOverrides, analyst.id)
                      ? chatAnalystPhotoOverrides[analyst.id]
                      : analyst.photo_url

                    return (
                    <tr key={analyst.id}>
                      <td className="py-3 pr-4 font-semibold">
                        <div className="flex items-center gap-3">
                          <AnalystAvatar name={analyst.name} photoUrl={displayedPhotoUrl} size="sm" />
                          <span>{analyst.name}</span>
                        </div>
                      </td>
                      <td className="py-3 pr-4 text-slate-300">{getChatTeamNameById(teams, analyst.team_id)}</td>
                      <td className="py-3 pr-4">{analyst.csat_goal}%</td>
                      <td className="py-3 pr-4">
                        <span className={analyst.active ? 'text-emerald-300' : 'text-slate-400'}>
                          {analyst.active ? 'Ativo' : 'Inativo'}
                        </span>
                      </td>
                      <td className="whitespace-nowrap py-3">
                        <div className="flex flex-nowrap items-center gap-2">
                          <button className="small-button" type="button" onClick={() => handleEditChatAnalyst(analyst)}>
                            Editar
                          </button>
                          <button className="small-button" type="button" onClick={() => handleToggleChatAnalyst(analyst)}>
                            {analyst.active ? 'Inativar' : 'Reativar'}
                          </button>
                          {!hasImportedHistory && (
                            <button className="danger-button" type="button" onClick={() => handleDeleteChatAnalyst(analyst)}>
                              Excluir cadastro
                            </button>
                          )}
                          {analyst.photo_url && (
                            <button className="small-button" type="button" onClick={() => handleRemoveChatAnalystPhoto(analyst)}>
                              Remover foto
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    )
                  })}
              </tbody>
            </table>

            {!analysts.length && <EmptyState text="Nenhum analista de chat cadastrado." />}
          </div>
        </div>
      </section>
      <section className={chatActiveTab === 'analysis' ? 'panel' : 'hidden'}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="section-title">Base e produtividade</h2>
            <p className="section-subtitle">
              {metrics.length} registros carregados entre histórico e importações mensais do Zendesk. Use esta seção para conferir os números de produtividade e validar a importação antes do fechamento.
            </p>
          </div>
          <span className="rounded-md bg-cyan-400/10 px-3 py-2 text-sm font-semibold text-cyan-200">
            {selectedPeriod?.label ?? 'Período'} - {selectedTeamName}
          </span>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-6">
          <MetricCard label="Atendidos" value={formatChatCount(totals.tickets)} />
          <MetricCard label="Inativos" value={`${formatChatCount(totals.inactive)} (${formatChatPercent(chatInactiveRate)})`} />
          <MetricCard label="Válidos" value={formatChatCount(totals.validTickets)} />
          <MetricCard label="Avaliações" value={`${formatChatCount(totals.reviews)} (${formatChatPercent(chatReviewRate)})`} />
          <MetricCard label="Sem avaliação" value={`${formatChatCount(Math.max(totals.validTickets - totals.reviews, 0))} (${formatChatPercent(chatSendingRate)})`} />
          <MetricCard label="CSAT consolidado" value={formatChatPercent(averageCsat)} />
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          <div className="rounded-lg bg-slate-900 p-4 text-sm text-slate-300">
            <p className="font-semibold text-slate-100">Fórmula de avaliações</p>
            <p className="mt-2">Avaliações recebidas / atendimentos válidos x 100.</p>
          </div>
          <div className="rounded-lg bg-slate-900 p-4 text-sm text-slate-300">
            <p className="font-semibold text-slate-100">Fórmula de % sem avaliação</p>
            <p className="mt-2">Válidos sem avaliação / atendimentos válidos x 100.</p>
          </div>
          <div className="rounded-lg bg-slate-900 p-4 text-sm text-slate-300">
            <p className="font-semibold text-slate-100">Fórmula de inatividade</p>
            <p className="mt-2">Inativos / atendimentos totais x 100. Este número é apoio operacional; o indicador principal do fechamento continua sendo o % sem avaliação.</p>
          </div>
        </div>

        <div className="mt-5 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-slate-400">
              <tr>
                <th className="px-3 py-2">Analista</th>
                <th className="px-3 py-2">Equipe</th>
                <th className="px-3 py-2">CSAT</th>
                <th className="px-3 py-2">Avaliações</th>
                <th className="px-3 py-2">Atendidos</th>
                <th className="px-3 py-2">Válidos</th>
                <th className="px-3 py-2">Inativos</th>
                <th className="px-3 py-2">% inatividade</th>
                <th className="px-3 py-2">% envio avaliação</th>
              </tr>
            </thead>
            <tbody>
              {visibleMetrics.map((metric) => (
                <tr key={metric.id} className="border-t border-slate-800">
                  <td className="px-3 py-3 font-semibold">{getChatAnalystName(metric)}</td>
                  <td className="px-3 py-3 text-slate-300">{getChatTeamName(metric)}</td>
                  <td className="whitespace-nowrap px-3 py-3 tabular-nums">{formatChatPercent(metric.csat)}</td>
                  <td className="whitespace-nowrap px-3 py-3 tabular-nums">{formatChatPercent(metric.review_percentage)}</td>
                  <td className="whitespace-nowrap px-3 py-3 tabular-nums">{formatChatCount(metric.total_tickets)}</td>
                  <td className="whitespace-nowrap px-3 py-3 tabular-nums">{formatChatCount(metric.valid_tickets)}</td>
                  <td className="whitespace-nowrap px-3 py-3 tabular-nums">{formatChatCount(metric.inactive_tickets)}</td>
                  <td className="whitespace-nowrap px-3 py-3 tabular-nums">{formatChatPercent(metric.total_tickets ? (Number(metric.inactive_tickets) / Number(metric.total_tickets)) * 100 : 0)}</td>
                  <td className="whitespace-nowrap px-3 py-3 tabular-nums">{formatChatPercent(metric.sending_percentage)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-cyan-400/30 font-semibold text-cyan-100">
              <tr>
                <td className="px-3 py-3" colSpan={2}>Total do filtro</td>
                <td className="whitespace-nowrap px-3 py-3 tabular-nums">{formatChatPercent(averageCsat)}</td>
                <td className="whitespace-nowrap px-3 py-3 tabular-nums">{formatChatPercent(chatReviewRate)}</td>
                <td className="whitespace-nowrap px-3 py-3 tabular-nums">{formatChatCount(totals.tickets)}</td>
                <td className="whitespace-nowrap px-3 py-3 tabular-nums">{formatChatCount(totals.validTickets)}</td>
                <td className="whitespace-nowrap px-3 py-3 tabular-nums">{formatChatCount(totals.inactive)}</td>
                <td className="whitespace-nowrap px-3 py-3 tabular-nums">{formatChatPercent(chatInactiveRate)}</td>
                <td className="whitespace-nowrap px-3 py-3 tabular-nums">{formatChatPercent(chatSendingRate)}</td>
              </tr>
            </tfoot>
          </table>
          {!visibleMetrics.length && <EmptyState text="Nenhum dado importado para o filtro selecionado." />}
        </div>
      </section>
    </div>
  )
}

function DashboardView({
  analystsCount,
  analysts,
  goals,
  individualMetrics,
  teamMetrics,
  loading,
  role,
}: {
  analystsCount: number
  analysts: Analyst[]
  goals: Goal[]
  individualMetrics: IndividualMetric[]
  teamMetrics: TeamMetric[]
  loading: boolean
  role: UserRole
}) {
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>(() => createPeriodFilter('month'))
  const [managementSection, setManagementSection] = useState<'area' | 'people'>('area')
  const [phonePodiumRanking, setPhonePodiumRanking] = useState<PhonePodiumRankingRow[]>([])
  const [phoneManualPodium, setPhoneManualPodium] = useState<PhonePodiumManual[]>([])
  const [phoneManualPodiumDraft, setPhoneManualPodiumDraft] = useState<Record<number, string>>({})
  const [phoneManualPodiumReason, setPhoneManualPodiumReason] = useState('')
  const [phoneManualPodiumMessage, setPhoneManualPodiumMessage] = useState('')
  const [phoneManualPodiumSaving, setPhoneManualPodiumSaving] = useState(false)
  const [managementAiAnalysis, setManagementAiAnalysis] = useState('')
  const [managementAiMessage, setManagementAiMessage] = useState('')
  const [managementAiLoading, setManagementAiLoading] = useState(false)
  const filteredIndividualMetrics = useMemo(
    () => filterIndividualMetricsByPeriod(individualMetrics, periodFilter),
    [individualMetrics, periodFilter],
  )
  const filteredTeamMetrics = useMemo(
    () => filterTeamMetricsByPeriod(teamMetrics, periodFilter),
    [teamMetrics, periodFilter],
  )
  const weeklyIndividualTrend = aggregateIndividualByWeek(filteredIndividualMetrics).slice(-8)
  const weeklyReviewCoverageTrend = weeklyIndividualTrend.map((item) => ({
    label: item.label,
    value: item.totalTickets ? round((item.totalReviews / item.totalTickets) * 100) : 0,
  }))
  const teamPerformanceTrend = [...filteredTeamMetrics]
    .sort((a, b) => a.week_start.localeCompare(b.week_start))
    .slice(-8)
    .map((metric) => ({
      label: formatShortDate(metric.week_start),
      value: calculateTeamPerformance([metric]),
    }))
  const overallCsatTrend = [...filteredTeamMetrics]
    .filter((metric) => metric.overall_csat !== null)
    .sort((a, b) => a.week_start.localeCompare(b.week_start))
    .slice(-8)
    .map((metric) => ({
      label: formatShortDate(metric.week_start),
      value: Number(metric.overall_csat),
    }))
  const podiumCsatGoal = getGoalValue(goals, 'podium_csat_minimum', 90)
  const reviewGoal = getGoalValue(goals, 'review_percentage', 25)
  const teamPerformanceGoal = getTeamPerformanceGoal(goals)
  const weeklyEligibilityTrend = [...new Set(filteredIndividualMetrics.map((metric) => metric.week_start))]
    .sort()
    .map((weekStart) => {
      const weekMetrics = filteredIndividualMetrics.filter((metric) => metric.week_start === weekStart)
      const weekPodium = buildPeriodPodium(weekMetrics, analysts, podiumCsatGoal, reviewGoal)
      return {
        label: formatShortDate(weekStart),
        eligible: weekPodium.filter((item) => item.eligible).length,
        total: weekPodium.length,
      }
    })
  const previousPeriodFilter = getPreviousPeriod(periodFilter)
  const previousIndividualMetrics = filterIndividualMetricsByPeriod(individualMetrics, previousPeriodFilter)
  const previousTeamMetrics = filterTeamMetricsByPeriod(teamMetrics, previousPeriodFilter)
  useEffect(() => {
    let active = true

    async function loadPhonePodiumRanking() {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session?.access_token) {
        if (active) setPhonePodiumRanking([])
        return
      }

      const response = await fetch(
        `/api/phone-podium?start=${periodFilter.start}&end=${periodFilter.end}`,
        {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        },
      )

      if (!active) return
      if (!response.ok) {
        setPhonePodiumRanking([])
        return
      }

      const data = (await response.json()) as PhonePodiumRankingRow[]
      setPhonePodiumRanking(data ?? [])
    }

    loadPhonePodiumRanking()

    return () => {
      active = false
    }
  }, [periodFilter.start, periodFilter.end])
  useEffect(() => {
    let active = true

    async function loadPhoneManualPodium() {
      const { data, error } = await supabase
        .from('phone_podium_manual')
        .select('id, analyst_id, period_start, period_end, position, reason')
        .eq('period_start', periodFilter.start)
        .eq('period_end', periodFilter.end)
        .order('position')

      if (!active) return
      if (error) {
        setPhoneManualPodium([])
        setPhoneManualPodiumDraft({})
        return
      }

      const rows = (data ?? []) as PhonePodiumManual[]
      setPhoneManualPodium(rows)
      setPhoneManualPodiumDraft(Object.fromEntries(rows.map((item) => [item.position, item.analyst_id])))
      setPhoneManualPodiumReason(rows[0]?.reason ?? '')
    }

    void loadPhoneManualPodium()
    return () => {
      active = false
    }
  }, [periodFilter.start, periodFilter.end])
  useEffect(() => {
    setManagementAiAnalysis('')
    setManagementAiMessage('')
  }, [periodFilter.start, periodFilter.end])
  const periodPodium = buildPeriodPodium(filteredIndividualMetrics, analysts, podiumCsatGoal, reviewGoal)
  const calculatedPodiumWinners = periodPodium.filter((item) => item.eligible).slice(0, 3)
  const podiumWinners = phoneManualPodium.length
    ? [1, 2, 3].map((position) => {
        const manual = phoneManualPodium.find((item) => item.position === position)
        return manual
          ? periodPodium.find((item) => item.analystId === manual.analyst_id)
          : calculatedPodiumWinners[position - 1]
      })
    : calculatedPodiumWinners
  const isManualPhonePodium = phoneManualPodium.length > 0
  const attentionList = periodPodium.filter((item) => !item.eligible)
  const eligibleCount = periodPodium.filter((item) => item.eligible).length
  const periodLabel = formatPeriodLabel(periodFilter)
  const periodAverageCsat = calculateAverageCsat(filteredIndividualMetrics)
  const previousAverageCsat = calculateAverageCsat(previousIndividualMetrics)
  const periodTeamPerformance = calculateTeamPerformance(filteredTeamMetrics)
  const previousTeamPerformance = calculateTeamPerformance(previousTeamMetrics)
  const hasPreviousIndividualData = previousIndividualMetrics.length > 0
  const hasPreviousTeamData = previousTeamMetrics.length > 0
  const csatDelta = hasPreviousIndividualData ? round(periodAverageCsat - previousAverageCsat) : 0
  const teamPerformanceDelta = hasPreviousTeamData ? round(periodTeamPerformance - previousTeamPerformance) : 0
  const hasWeeklyPaceComparison = weeklyIndividualTrend.length > 1
  const firstWeeklyResult = weeklyIndividualTrend[0] ?? null
  const lastWeeklyResult = weeklyIndividualTrend.at(-1) ?? null
  const firstWeeklyPerformance = teamPerformanceTrend[0] ?? null
  const lastWeeklyPerformance = teamPerformanceTrend.at(-1) ?? null
  const firstWeeklyOverallCsat = overallCsatTrend[0] ?? null
  const lastWeeklyOverallCsat = overallCsatTrend.at(-1) ?? null
  const firstWeeklyEligibility = weeklyEligibilityTrend[0] ?? null
  const lastWeeklyEligibility = weeklyEligibilityTrend.at(-1) ?? null
  const weeklyCsatPace = firstWeeklyResult && lastWeeklyResult
    ? round(lastWeeklyResult.csat - firstWeeklyResult.csat)
    : 0
  const weeklyPerformancePace = firstWeeklyPerformance && lastWeeklyPerformance
    ? round(lastWeeklyPerformance.value - firstWeeklyPerformance.value)
    : 0
  const weeklyOverallCsatPace = firstWeeklyOverallCsat && lastWeeklyOverallCsat
    ? round(lastWeeklyOverallCsat.value - firstWeeklyOverallCsat.value)
    : 0
  const weeklyEligibilityPace = firstWeeklyEligibility && lastWeeklyEligibility
    ? lastWeeklyEligibility.eligible - firstWeeklyEligibility.eligible
    : 0
  const totalReviews = filteredIndividualMetrics.reduce((sum, metric) => sum + Number(metric.total_reviews), 0)
  const totalTickets = filteredIndividualMetrics.reduce((sum, metric) => sum + Number(metric.total_tickets), 0)
  const periodAverageTickets = periodPodium.length ? round(totalTickets / periodPodium.length) : 0
  const n1PositiveReviews = filteredIndividualMetrics.reduce((sum, metric) => sum + Number(metric.positive_reviews), 0)
  const reviewCoverage = totalTickets ? round((totalReviews / totalTickets) * 100) : 0
  const teamAnsweredCalls = filteredTeamMetrics.reduce((sum, metric) => sum + Number(metric.answered_calls), 0)
  const teamTotalCalls = filteredTeamMetrics.reduce((sum, metric) => sum + Number(metric.total_calls), 0)
  const metricsWithOverallCsat = filteredTeamMetrics.filter(
    (metric) => metric.overall_csat !== null,
  )
  const n1MetricsInOverallCoverage = filteredIndividualMetrics.filter((metric) =>
    metricsWithOverallCsat.some(
      (teamMetric) => teamMetric.week_start === metric.week_start && teamMetric.week_end === metric.week_end,
    ),
  )
  const n1ComparisonCsat = calculateAverageCsat(n1MetricsInOverallCoverage)
  const overallPhoneCsat = metricsWithOverallCsat.length
    ? round(
        metricsWithOverallCsat.reduce((sum, metric) => sum + Number(metric.overall_csat), 0) /
          metricsWithOverallCsat.length,
      )
    : null
  const overallCsatGap = overallPhoneCsat === null ? null : round(overallPhoneCsat - n1ComparisonCsat)
  const hasCompleteOverallCoverage = filteredTeamMetrics.length > 0 && metricsWithOverallCsat.length === filteredTeamMetrics.length
  const isManagementView = role === 'master' || role === 'coordinator'
  const n1ImpactRanking = periodPodium
    .map((result) => {
      const analystMetrics = filteredIndividualMetrics.filter((metric) => metric.analyst_id === result.analystId)
      const positive = analystMetrics.reduce((sum, metric) => sum + Number(metric.positive_reviews), 0)
      const negative = analystMetrics.reduce((sum, metric) => sum + Number(metric.negative_reviews), 0)
      const reviewsWithoutAnalyst = totalReviews - positive - negative
      const csatWithoutAnalyst = reviewsWithoutAnalyst > 0
        ? round(((n1PositiveReviews - positive) / reviewsWithoutAnalyst) * 100)
        : periodAverageCsat

      return {
        analystName: result.analystName,
        averageCsat: result.averageCsat,
        reviews: positive + negative,
        negativeReviews: negative,
        downwardImpact: round(csatWithoutAnalyst - periodAverageCsat),
      }
    })
    .filter((item) => item.reviews > 0)
    .sort((a, b) => b.downwardImpact - a.downwardImpact)
  const attentionCount = attentionList.length
  const attentionDetails = attentionList.map((item) => {
    const criteria: string[] = []

    if (item.averageCsat < item.individualGoal || item.averageCsat < podiumCsatGoal) {
      const csatReferences = [
        item.averageCsat < item.individualGoal ? `meta individual ${item.individualGoal}%` : null,
        item.averageCsat < podiumCsatGoal ? `pódio ${podiumCsatGoal}%` : null,
      ].filter(Boolean).join(' e ')
      criteria.push(`CSAT ${formatPercent(item.averageCsat)} (referência: ${csatReferences})`)
    }
    if (item.reviewPercentage < reviewGoal) {
      criteria.push(`avaliações ${formatPercent(item.reviewPercentage)} (meta ${reviewGoal}%)`)
    }
    if (item.totalTickets < periodAverageTickets) {
      criteria.push(`volume ${item.totalTickets} (média do time ${periodAverageTickets})`)
    }

    return `${item.analystName}: ${criteria.join('; ')}`
  })
  const attentionSummary = attentionDetails.join(' | ')
  const hasPeriodData = filteredIndividualMetrics.length > 0 || filteredTeamMetrics.length > 0
  const predictiveGoalProbability = calculateGoalProbability({
    hasData: hasPeriodData,
    csat: periodAverageCsat,
    csatGoal: podiumCsatGoal,
    csatDelta,
    teamPerformance: periodTeamPerformance,
    teamPerformanceGoal,
    teamPerformanceDelta,
    reviewCoverage,
    reviewGoal,
    eligibleCount,
    totalAnalysts: periodPodium.length,
  })
  const projectedCsat = projectMetric(periodAverageCsat, csatDelta, podiumCsatGoal)
  const projectedTeamPerformance = projectMetric(periodTeamPerformance, teamPerformanceDelta, teamPerformanceGoal)
  const predictiveRiskLevel = getPredictiveRiskLevel(
    predictiveGoalProbability,
    csatDelta,
    teamPerformanceDelta,
    attentionCount,
  )
  const weeklyPaceFacts = [
    firstWeeklyResult && lastWeeklyResult
      ? `CSAT N1: ${formatPercent(firstWeeklyResult.csat)} para ${formatPercent(lastWeeklyResult.csat)} (${formatDelta(weeklyCsatPace, ' p.p.')})`
      : null,
    teamPerformanceTrend.length > 1 && firstWeeklyPerformance && lastWeeklyPerformance
      ? `performance: ${formatPercent(firstWeeklyPerformance.value)} para ${formatPercent(lastWeeklyPerformance.value)} (${formatDelta(weeklyPerformancePace, ' p.p.')})`
      : null,
    overallCsatTrend.length > 1 && firstWeeklyOverallCsat && lastWeeklyOverallCsat
      ? `CSAT geral N1 + N2: ${formatPercent(firstWeeklyOverallCsat.value)} para ${formatPercent(lastWeeklyOverallCsat.value)} (${formatDelta(weeklyOverallCsatPace, ' p.p.')})`
      : null,
    weeklyEligibilityTrend.length > 1 && firstWeeklyEligibility && lastWeeklyEligibility
      ? `elegíveis: ${firstWeeklyEligibility.eligible} de ${firstWeeklyEligibility.total} para ${lastWeeklyEligibility.eligible} de ${lastWeeklyEligibility.total}`
      : null,
  ].filter((fact): fact is string => Boolean(fact))
  const weeklyPaceRisks = [
    weeklyIndividualTrend.length > 1 && lastWeeklyResult && lastWeeklyResult.csat < podiumCsatGoal && weeklyCsatPace <= 0
      ? `o CSAT N1 tende a permanecer abaixo de ${podiumCsatGoal}%`
      : null,
    teamPerformanceTrend.length > 1 && lastWeeklyPerformance && lastWeeklyPerformance.value < teamPerformanceGoal && weeklyPerformancePace <= 0
      ? `a performance tende a permanecer abaixo de ${teamPerformanceGoal}%`
      : null,
    overallCsatTrend.length > 1 && lastWeeklyOverallCsat && lastWeeklyOverallCsat.value < podiumCsatGoal && weeklyOverallCsatPace <= 0
      ? `o CSAT geral N1 + N2 tende a permanecer abaixo de ${podiumCsatGoal}%`
      : null,
    weeklyEligibilityTrend.length > 1 && lastWeeklyEligibility && lastWeeklyEligibility.total > 0 &&
      lastWeeklyEligibility.eligible / lastWeeklyEligibility.total < 0.5 && weeklyEligibilityPace <= 0
      ? 'o período tende a fechar com poucos analistas elegíveis ao pódio'
      : null,
  ].filter((risk): risk is string => Boolean(risk))
  const weeklyPaceRead = !hasWeeklyPaceComparison
    ? 'Ainda há somente uma semana lançada neste recorte. A tendência será liberada após o próximo lançamento semanal.'
    : `Da primeira para a última semana, ${weeklyPaceFacts.join('; ')}. ${
        weeklyPaceRisks.length
          ? `Se esse ritmo continuar, ${weeklyPaceRisks.join(' e ')}.`
          : 'Mantido esse ritmo, os indicadores acompanhados permanecem em trajetória compatível com as metas.'
      }`
  const weeklyPaceAction = !hasWeeklyPaceComparison
    ? 'Fazer o próximo lançamento semanal para comparar velocidade, direção e consistência da evolução.'
    : weeklyPaceRisks.length
      ? 'Atuar nos critérios indicados abaixo e conferir, no próximo lançamento semanal, se a distância para a meta diminuiu.'
      : 'Preservar as práticas atuais e confirmar no próximo lançamento se a evolução se mantém.'
  const predictiveRiskDrivers = !hasPeriodData
    ? []
    : [
        predictiveGoalProbability < 75
          ? {
              label: 'Chance geral de fechamento',
              reading: `${predictiveGoalProbability}% (faixa de atenção: abaixo de 75%)`,
              action: 'Revisar os critérios ainda não cumpridos antes do próximo lançamento.',
              severity: predictiveGoalProbability < 45 ? 'Alto' : 'Médio',
            }
          : null,
        hasPreviousIndividualData && csatDelta < 0
          ? {
              label: 'CSAT em queda',
              reading: `${formatDelta(csatDelta, ' p.p.')} em relação ao período anterior`,
              action: 'Identificar os analistas com maior impacto negativo e combinar uma ação prática de qualidade.',
              severity: csatDelta < -2 ? 'Alto' : 'Médio',
            }
          : null,
        hasPreviousTeamData && teamPerformanceDelta < 0
          ? {
              label: 'Performance operacional em queda',
              reading: `${formatDelta(teamPerformanceDelta, ' p.p.')} em relação ao período anterior`,
              action: 'Conferir abandonos, escala, cobertura e possíveis gargalos do atendimento.',
              severity: teamPerformanceDelta < -1.5 ? 'Alto' : 'Médio',
            }
          : null,
        attentionCount > 0
          ? {
              label: 'Analistas que pedem acompanhamento',
              reading: `${attentionCount} analista(s) em atenção. ${attentionSummary}`,
              action: isManagementView
                ? 'Abrir a análise individual dos nomes indicados, validar a causa e registrar um feedback MIMO com uma ação mensurável para o próximo lançamento.'
                : 'Observe em sua elegibilidade qual critério precisa de recuperação.',
              severity: attentionCount >= 3 ? 'Alto' : 'Médio',
            }
          : null,
      ].filter((driver): driver is NonNullable<typeof driver> => driver !== null)
  const predictiveAction =
    !hasPeriodData
      ? 'Aguardar novos lançamentos para liberar previsao.'
      : predictiveRiskDrivers.length > 0
        ? `Alerta acionado por: ${predictiveRiskDrivers.map((driver) => driver.label.toLowerCase()).join(', ')}. Veja o diagnóstico e as ações logo abaixo.`
        : 'Nenhum alerta acionado. Manter a rotina atual e preservar a consistência até o fechamento.'
  const executiveNextAction =
    !hasPeriodData
      ? 'Conferir se os lançamentos da semana/mes ja foram feitos.'
      : attentionCount
        ? 'Abrir feedback MIMO dos analistas em atenção, combinar uma ação objetiva por critério e conferir o resultado no próximo lançamento.'
        : periodTeamPerformance < teamPerformanceGoal
          ? 'Revisar abandonos, escala e gargalos antes do fechamento.'
          : 'Comparar evolução semanal e preservar a rotina atual.'
  const executiveClosingRead =
    !hasPeriodData
      ? 'Fechamento ainda nao liberado para leitura.'
      : periodTeamPerformance < teamPerformanceGoal
        ? `Meta operacional em risco: performance atual de ${formatPercent(periodTeamPerformance)} para uma meta de ${teamPerformanceGoal}%. Revisar abandonos, escala e cobertura.`
        : periodAverageCsat < podiumCsatGoal
          ? `Qualidade em atenção: CSAT N1 de ${formatPercent(periodAverageCsat)} para a referência de ${podiumCsatGoal}%. Revisar os casos com impacto negativo.`
          : attentionCount
            ? `Pódio em atenção: ${attentionCount} analista(s) podem fechar fora dos critérios. A operação está em ${formatPercent(periodTeamPerformance)}, mas os casos individuais precisam de ação.`
            : 'Fechamento favorável: manter o acompanhamento até concluir o período.'

  function handlePeriodModeChange(mode: PeriodMode) {
    setPeriodFilter(createPeriodFilter(mode))
  }

  async function handleManagementAiAnalysis() {
    if (!hasPeriodData || !isManagementView) return

    setManagementAiLoading(true)
    setManagementAiMessage('Analisando os indicadores com IA...')

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('Sua sessão expirou. Entre novamente no sistema.')

      const response = await fetch('/api/management-analysis', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          periodLabel,
          riskLevel: predictiveRiskLevel,
          goalProbability: predictiveGoalProbability,
          team: {
            csat: periodAverageCsat,
            csatGoal: podiumCsatGoal,
            csatDelta,
            performance: periodTeamPerformance,
            performanceGoal: teamPerformanceGoal,
            performanceDelta: teamPerformanceDelta,
            reviewCoverage,
            reviewGoal,
            answeredCalls: teamAnsweredCalls,
            totalCalls: teamTotalCalls,
            eligibleCount,
            totalAnalysts: periodPodium.length,
          },
          analysts: attentionList.map((item) => ({
            name: item.analystName,
            csat: item.averageCsat,
            csatGoal: Math.max(item.individualGoal, podiumCsatGoal),
            reviewPercentage: item.reviewPercentage,
            reviewGoal,
            tickets: item.totalTickets,
            teamAverageTickets: periodAverageTickets,
            reasons: item.reasons,
          })),
          localDiagnosis: executiveClosingRead,
          localAction: executiveNextAction,
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data?.error || 'Não foi possível aprofundar a análise com IA.')

      setManagementAiAnalysis(data.analysis ?? '')
      setManagementAiMessage('Análise gerada pela IA com base nos cálculos deste período. Revise antes de agir.')
    } catch (error) {
      setManagementAiMessage(error instanceof Error ? error.message : 'Não foi possível consultar a IA agora.')
    } finally {
      setManagementAiLoading(false)
    }
  }
  const isAnalystDashboard = role === 'analyst'
  const analystProfile = isAnalystDashboard ? analysts[0] ?? null : null
  const localAnalystResult = isAnalystDashboard ? periodPodium[0] ?? null : null
  const secureAnalystRanking = isAnalystDashboard ? phonePodiumRanking[0] ?? null : null
  const n1TeamAverageCsat = isAnalystDashboard && secureAnalystRanking?.team_average_csat !== undefined
    ? Number(secureAnalystRanking.team_average_csat)
    : periodAverageCsat
  const analystResult = secureAnalystRanking
    ? {
        analystId: secureAnalystRanking.analyst_id,
        analystName: secureAnalystRanking.analyst_name,
        averageCsat: Number(secureAnalystRanking.average_csat),
        totalReviews: Number(secureAnalystRanking.total_reviews),
        totalTickets: Number(secureAnalystRanking.total_tickets),
        reviewPercentage: Number(secureAnalystRanking.review_percentage),
        individualGoal: Number(secureAnalystRanking.individual_goal),
        eligible: Boolean(secureAnalystRanking.eligible),
        reasons: secureAnalystRanking.reasons ?? [],
      }
    : localAnalystResult
  const analystManualPodiumPosition = analystResult
    ? phoneManualPodium.find((item) => item.analyst_id === analystResult.analystId)?.position ?? 0
    : 0
  const analystRankingPosition = analystManualPodiumPosition
    || secureAnalystRanking?.position
    || (localAnalystResult ? periodPodium.findIndex((item) => item.analystId === localAnalystResult.analystId) + 1 : 0)
  const analystDataLoading = isAnalystDashboard && loading
  const launchedPeriodLabel = formatLaunchedPeriodLabel(filteredIndividualMetrics, periodFilter)
  const analystRankingRead =
    periodFilter.mode === 'month'
      ? `Ranking parcial do mês, calculado com os lançamentos já feitos em ${launchedPeriodLabel}.`
      : periodFilter.mode === 'week'
        ? `Ranking semanal calculado com os lançamentos de ${launchedPeriodLabel}.`
        : `Ranking calculado com os lançamentos de ${launchedPeriodLabel}.`
  const analystStatusText = analystResult
    ? analystManualPodiumPosition
      ? 'Incluído no pódio pela gestão'
      : analystResult.eligible
      ? 'Elegível para o pódio'
      : 'Fora do pódio neste período'
    : 'Sem lançamento no período'
  const analystFocusText = analystResult
    ? analystResult.eligible
      ? 'Manter CSAT, volume e percentual de avaliações ate o fechamento.'
      : formatStatusText(analystResult.reasons.join(', '))
    : 'Selecione outro período ou aguarde o lançamento semanal.'
  const analystActionText = analystResult
    ? buildDevelopmentFocus(analystResult, csatDelta)
    : 'Aguardar lançamento do período para liberar recomendação individual.'
  const analystPulseText = analystResult
    ? analystManualPodiumPosition
      ? `Você está no ${analystManualPodiumPosition}º lugar por decisão registrada da gestão neste período.`
      : analystResult.eligible
      ? analystRankingPosition > 0 && analystRankingPosition <= 3
        ? 'Você esta no pódio neste recorte. O foco e sustentar os critérios ate o fechamento.'
        : 'Você cumpre os critérios, mas ainda esta fora do top 3 neste recorte.'
      : 'Sua posição aparece no ranking, mas ainda existe critério pendente para entrar no pódio.'
    : 'Ainda nao ha dados individuais para este filtro.'
  const analystPodiumPositionStatus = analystResult
    ? analystManualPodiumPosition
      ? 'No pódio por ajuste da gestão'
      : !analystResult.eligible
      ? 'Fora do pódio por critério pendente'
      : analystRankingPosition > 0 && analystRankingPosition <= 3
        ? 'No pódio agora'
        : 'Elegível, fora do top 3 agora'
    : 'Sem posição calculada'
  const analystPodiumProjectionText = analystResult
    ? !analystResult.eligible
      ? `Para projetar entrada no pódio, primeiro regularize: ${analystResult.reasons.join(', ') || 'critérios pendentes'}.`
      : periodFilter.mode === 'month'
        ? `Se mantiver este ritmo ate o fechamento, a tendencia atual e terminar em ${analystRankingPosition ? `${analystRankingPosition}o lugar` : 'posição calculada'}; a posição muda conforme os novos lançamentos do time.`
        : `Neste recorte, a posição atual e ${analystRankingPosition ? `${analystRankingPosition}o lugar` : 'calculada pelo ranking'}; no mensal, ela sera recalculada com todos os lançamentos.`
    : 'Aguardando lançamento para calcular posição e tendencia.'
  const podiumAverageFromSecureRanking = phonePodiumRanking.find((item) => Number(item.team_average_tickets) > 0)?.team_average_tickets
  const podiumAverageSource = phonePodiumRanking.length
    ? phonePodiumRanking.map((item) => Number(item.total_tickets))
    : periodPodium.map((item) => item.totalTickets)
  const podiumAverageTickets = podiumAverageFromSecureRanking
    ? Number(podiumAverageFromSecureRanking)
    : podiumAverageSource.length
      ? round(podiumAverageSource.reduce((sum, totalTickets) => sum + totalTickets, 0) / podiumAverageSource.length)
      : 0
  const analystCsatGap = analystResult ? round(Math.max(podiumCsatGoal - analystResult.averageCsat, 0)) : 0
  const analystReviewGap = analystResult ? round(Math.max(reviewGoal - analystResult.reviewPercentage, 0)) : 0
  const analystVolumeGap = analystResult ? Math.ceil(Math.max(podiumAverageTickets - analystResult.totalTickets, 0)) : 0
  const analystPodiumChecklist = [
    {
      label: 'CSAT mínimo',
      value: analystResult
        ? analystCsatGap > 0
          ? `faltam ${formatDelta(analystCsatGap, ' p.p.').replace('+', '')} para ${podiumCsatGoal}%`
          : `cumprido: ${formatPercent(analystResult.averageCsat)}`
        : 'sem dados',
      ok: Boolean(analystResult && analystCsatGap === 0),
    },
    {
      label: 'Avaliações',
      value: analystResult
        ? analystReviewGap > 0
          ? `faltam ${formatDelta(analystReviewGap, ' p.p.').replace('+', '')} para ${reviewGoal}%`
          : `cumprido: ${formatPercent(analystResult.reviewPercentage)}`
        : 'sem dados',
      ok: Boolean(analystResult && analystReviewGap === 0),
    },
    {
      label: 'Volume',
      value: analystResult
        ? analystVolumeGap > 0
          ? `${analystResult.totalTickets} atendimentos; faltam ${analystVolumeGap} para a média do time (${formatChatCount(podiumAverageTickets)})`
          : `${analystResult.totalTickets} atendimentos; média do time: ${formatChatCount(podiumAverageTickets)}`
        : 'sem dados',
      ok: Boolean(analystResult && podiumAverageTickets > 0 && analystVolumeGap === 0),
    },
  ]
  const analystCriteriaCompleted = analystPodiumChecklist.filter((item) => item.ok).length
  const analystJourneyProgress = analystResult ? Math.round((analystCriteriaCompleted / analystPodiumChecklist.length) * 100) : 0
  const analystPodiumGapText = analystResult
    ? analystResult.eligible
      ? 'Você ja cumpre os critérios objetivos. Agora o foco e preservar qualidade, avaliações e volume ate o fechamento.'
      : 'Para entrar no pódio, priorize os critérios abaixo que ainda estao pendentes neste recorte.'
    : 'Sem lançamento no período para calcular distancia ate o pódio.'
  const analystActionPlan = analystResult
    ? [
        {
          label: '1. Qualidade percebida',
          title: analystCsatGap > 0 ? `Recuperar ${formatDelta(analystCsatGap, ' p.p.').replace('+', '')} de CSAT` : 'Proteger o CSAT atual',
          text:
            analystCsatGap > 0
              ? 'Nos próximos atendimentos, confirme o problema antes de orientar, valide se a solucao ficou clara e encerre perguntando se ainda ficou alguma duvida. A meta e reduzir motivos de avaliação negativa antes do próximo fechamento.'
              : 'Seu CSAT esta acima da referência. Mantenha o mesmo padrao de abertura, diagnostico e fechamento para evitar queda de qualidade no restante do período.',
        },
        {
          label: '2. Avaliações respondidas',
          title: analystReviewGap > 0 ? `Buscar mais ${formatDelta(analystReviewGap, ' p.p.').replace('+', '')} em avaliações` : 'Manter boa amostra de avaliações',
          text:
            analystReviewGap > 0
              ? 'Ao perceber que o cliente teve o problema resolvido, faca um fechamento simples e objetivo pedindo a avaliação. O foco nao e forcar resposta, e aumentar a amostra para o resultado representar melhor sua entrega.'
              : 'A amostra de avaliações esta saudavel. Continue encerrando os contatos com clareza, porque um bom volume de respostas protege a leitura do seu CSAT.',
        },
        {
          label: '3. Volume de atendimento',
          title: analystVolumeGap > 0 ? `Faltam ${analystVolumeGap} atendimentos para a média` : 'Volume dentro da média do time',
          text:
            analystVolumeGap > 0
              ? `A média do time no recorte e ${formatChatCount(podiumAverageTickets)}. Combine com a gestão se houve fila, pausa, ausencia ou apoio a outro setor. Se a distribuicao estiver normal, o alvo e recuperar volume mantendo qualidade.`
              : `Você esta com ${analystResult.totalTickets} atendimentos contra média de ${formatChatCount(podiumAverageTickets)}. O cuidado agora e nao ganhar volume sacrificando CSAT ou avaliação.`,
        },
      ]
    : []
  const analystNextTargetText = analystResult
    ? analystResult.eligible
      ? analystRankingPosition > 0 && analystRankingPosition <= 3
        ? 'Meta imédiata: preservar os tres critérios e evitar queda ate o próximo lançamento.'
        : 'Meta imédiata: manter elegibilidade e buscar ganho em CSAT, avaliações ou volume para apróximar do top 3.'
      : 'Meta imédiata: resolver primeiro os critérios pendentes antes de pensar em posição no pódio.'
    : 'Meta imédiata: aguardar o lançamento do período para liberar o plano.'
  const phoneFunnelItems = [
    {
      label: 'Analistas lançados',
      value: periodPodium.length,
      detail: 'Base usada no ranking do recorte selecionado.',
    },
    {
      label: 'CSAT mínimo',
      value: periodPodium.filter((item) => item.averageCsat >= podiumCsatGoal).length,
      detail: `Bateram a referência de ${podiumCsatGoal}%.`,
    },
    {
      label: 'Avaliações',
      value: periodPodium.filter((item) => item.reviewPercentage >= reviewGoal).length,
      detail: `Mantêm amostra acima de ${reviewGoal}%.`,
    },
    {
      label: 'Volume',
      value: periodPodium.filter((item) => item.totalTickets >= podiumAverageTickets).length,
      detail: `Atendimentos iguais ou acima da média de ${formatChatCount(podiumAverageTickets)}.`,
    },
    {
      label: 'Elegíveis',
      value: eligibleCount,
      detail: 'Cumpriram todos os critérios ao mesmo tempo.',
      tone: 'success' as const,
    },
  ]
  const phoneVisualRows = periodPodium.slice(0, 10).map((item) => ({
    label: item.analystName,
    primary: item.averageCsat,
    secondary: item.reviewPercentage,
    volume: item.totalTickets,
    status: item.eligible ? 'Elegível' : formatStatusText(item.reasons.join(', ')),
  }))
  const phoneVisualPoints = periodPodium.map((item) => ({
    label: item.analystName,
    x: item.totalTickets,
    y: item.averageCsat,
    tone: item.eligible ? 'success' : item.averageCsat < podiumCsatGoal ? 'danger' : 'warning',
    detail: `${formatPercent(item.reviewPercentage)} avaliações`,
  }))

  async function handleSavePhoneManualPodium() {
    const selectedEntries = [1, 2, 3]
      .map((position) => ({
        position,
        analystId: phoneManualPodiumDraft[position]
          ?? calculatedPodiumWinners[position - 1]?.analystId
          ?? '',
      }))
      .filter((item) => item.analystId)
    const selectedIds = selectedEntries.map((item) => item.analystId)

    setPhoneManualPodiumMessage('')
    if (!selectedEntries.length) {
      setPhoneManualPodiumMessage('Selecione ao menos um analista ou restaure o pódio calculado.')
      return
    }
    if (new Set(selectedIds).size !== selectedIds.length) {
      setPhoneManualPodiumMessage('O mesmo analista não pode ocupar duas posições.')
      return
    }
    if (!phoneManualPodiumReason.trim()) {
      setPhoneManualPodiumMessage('Informe o motivo do ajuste para manter a decisão registrada.')
      return
    }

    setPhoneManualPodiumSaving(true)
    try {
      const { error: deleteError } = await supabase
        .from('phone_podium_manual')
        .delete()
        .eq('period_start', periodFilter.start)
        .eq('period_end', periodFilter.end)
      if (deleteError) throw deleteError

      const { data: authData } = await supabase.auth.getUser()
      const { data, error: insertError } = await supabase
        .from('phone_podium_manual')
        .insert(selectedEntries.map((item) => ({
          analyst_id: item.analystId,
          period_start: periodFilter.start,
          period_end: periodFilter.end,
          position: item.position,
          reason: phoneManualPodiumReason.trim(),
          created_by: authData.user?.id ?? null,
        })))
        .select('id, analyst_id, period_start, period_end, position, reason')
        .order('position')
      if (insertError) throw insertError

      setPhoneManualPodium((data ?? []) as PhonePodiumManual[])
      setPhoneManualPodiumMessage('Pódio ajustado pela gestão e salvo para este período.')
    } catch (error) {
      setPhoneManualPodiumMessage(getSupabaseMessage(getErrorMessage(error)))
    } finally {
      setPhoneManualPodiumSaving(false)
    }
  }

  async function handleRestoreCalculatedPhonePodium() {
    if (!window.confirm(`Restaurar o pódio calculado para ${periodLabel}? O ajuste manual deste período será removido.`)) return

    setPhoneManualPodiumSaving(true)
    setPhoneManualPodiumMessage('')
    const { error } = await supabase
      .from('phone_podium_manual')
      .delete()
      .eq('period_start', periodFilter.start)
      .eq('period_end', periodFilter.end)
    setPhoneManualPodiumSaving(false)

    if (error) {
      setPhoneManualPodiumMessage(getSupabaseMessage(error.message))
      return
    }

    setPhoneManualPodium([])
    setPhoneManualPodiumDraft({})
    setPhoneManualPodiumReason('')
    setPhoneManualPodiumMessage('Pódio calculado restaurado para este período.')
  }

  return (
    <div className="mt-8 space-y-7">
      <section className="panel">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="section-title">Periodo de análise</h2>
            <p className="section-subtitle">
              {isAnalystDashboard
                ? 'Sua performance, graficos e elegibilidade seguem este filtro.'
                : 'Os cards, graficos, pódio e insights abaixo seguem este filtro.'}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {(['week', 'month', 'year', 'custom'] as PeriodMode[]).map((mode) => (
              <button
                key={mode}
                className={periodFilter.mode === mode ? 'tab-button-active' : 'tab-button'}
                type="button"
                onClick={() => handlePeriodModeChange(mode)}
              >
                {getPeriodModeLabel(mode)}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field label="Inicio">
            <input
              className="form-input"
              type="date"
              value={periodFilter.start}
              onChange={(event) =>
                setPeriodFilter({ ...periodFilter, mode: 'custom', start: event.target.value })
              }
            />
          </Field>
          <Field label="Fim">
            <input
              className="form-input"
              type="date"
              value={periodFilter.end}
              onChange={(event) =>
                setPeriodFilter({ ...periodFilter, mode: 'custom', end: event.target.value })
              }
            />
          </Field>
        </div>
      </section>

      {!isAnalystDashboard && (
        <nav className="panel workspace-switcher" aria-label="Visão do dashboard">
          <div>
            <p className="workspace-eyebrow">Visão da gestão</p>
            <h2 className="section-title mt-2">
              {managementSection === 'area' ? 'Operação' : 'Pessoas'}
            </h2>
            <p className="section-subtitle">
              {managementSection === 'area'
                ? 'Resultado consolidado, tendências, riscos e decisões da operação.'
                : 'Desempenho individual, elegibilidade, volume, ranking e acompanhamento do time.'}
            </p>
          </div>
          <div className="workspace-switcher-row" role="group" aria-label="Alternar entre operação e pessoas">
            <button
              className={managementSection === 'area' ? 'workspace-switcher-button workspace-switcher-button-active' : 'workspace-switcher-button'}
              type="button"
              aria-pressed={managementSection === 'area'}
              onClick={() => setManagementSection('area')}
            >
              Operação
            </button>
            <button
              className={managementSection === 'people' ? 'workspace-switcher-button workspace-switcher-button-active' : 'workspace-switcher-button'}
              type="button"
              aria-pressed={managementSection === 'people'}
              onClick={() => setManagementSection('people')}
            >
              Pessoas
            </button>
          </div>
        </nav>
      )}

      {isAnalystDashboard ? (
        <>
          <section className="metric-zone">
            <div className="metric-zone-heading">
              <div>
                <p className="workspace-eyebrow">Minha performance</p>
                <h2 className="section-title mt-2">Meu resultado no período</h2>
                <p className="section-subtitle">Indicadores individuais, posição e critérios que dependem diretamente do seu resultado.</p>
              </div>
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              <AnalystIdentityCard analyst={analystProfile} />
              <MetricCard label="Meu CSAT" value={formatPercent(analystResult?.averageCsat ?? 0)} tone={analystResult && analystResult.averageCsat >= analystResult.individualGoal ? 'success' : analystResult ? 'warning' : undefined} />
              <MetricCard label="Minhas avaliações" value={`${formatChatCount(totalReviews)} (${formatPercent(reviewCoverage)})`} tone={reviewCoverage >= reviewGoal ? 'success' : reviewCoverage >= 20 ? 'warning' : 'danger'} />
              <MetricCard label="Meus atendimentos" value={formatChatCount(totalTickets)} tone={podiumAverageTickets && totalTickets >= podiumAverageTickets ? 'success' : podiumAverageTickets ? 'warning' : undefined} />
              <MetricCard label="Minha posição" value={analystDataLoading ? '...' : analystRankingPosition ? `${analystRankingPosition}º` : '-'} tone={analystResult?.eligible ? 'success' : analystResult ? 'warning' : undefined} />
            </div>
          </section>

          <section className="metric-zone context-zone">
            <div className="metric-zone-heading">
              <div>
                <p className="workspace-eyebrow">Nosso resultado</p>
                <h2 className="section-title mt-2">Contexto da equipe</h2>
                <p className="section-subtitle">A performance é coletiva e permanece visível para mostrar o resultado que o time está construindo junto.</p>
              </div>
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-3">
              <MetricCard label="Performance da equipe" value={formatPercent(periodTeamPerformance || 0)} tone={periodTeamPerformance >= teamPerformanceGoal ? 'success' : periodTeamPerformance >= teamPerformanceGoal - 3 ? 'warning' : 'danger'} />
              <MetricCard label="CSAT equipe N1" value={formatPercent(n1TeamAverageCsat || 0)} tone={n1TeamAverageCsat >= podiumCsatGoal ? 'success' : n1TeamAverageCsat >= podiumCsatGoal - 5 ? 'warning' : 'danger'} />
              <MetricCard label="CSAT geral N1 + N2" value={overallPhoneCsat === null ? 'Não informado' : formatPercent(overallPhoneCsat)} tone={overallPhoneCsat === null ? undefined : overallPhoneCsat >= podiumCsatGoal ? 'success' : overallPhoneCsat >= podiumCsatGoal - 5 ? 'warning' : 'danger'} />
            </div>
            <p className="context-note">
              O CSAT da equipe N1 reúne os analistas do telefone. O CSAT geral inclui também os atendimentos de transbordo do N2 e serve como contexto da operação; ele não altera seu pódio individual.
            </p>
          </section>
        </>
      ) : managementSection === 'area' ? (
        <section className="metric-zone">
          <div className="metric-zone-heading">
            <div>
              <p className="workspace-eyebrow">Operação</p>
              <h2 className="section-title mt-2">Visão executiva do período</h2>
              <p className="section-subtitle">Somente indicadores consolidados da operação, sem misturar leitura individual de pessoas.</p>
            </div>
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <MetricCard label="Performance da equipe" value={formatPercent(periodTeamPerformance || 0)} tone={periodTeamPerformance >= teamPerformanceGoal ? 'success' : periodTeamPerformance >= teamPerformanceGoal - 3 ? 'warning' : 'danger'} />
            <MetricCard label="CSAT equipe N1" value={formatPercent(n1TeamAverageCsat || 0)} tone={n1TeamAverageCsat >= podiumCsatGoal ? 'success' : n1TeamAverageCsat >= podiumCsatGoal - 5 ? 'warning' : 'danger'} />
            <MetricCard label="CSAT geral N1 + N2" value={overallPhoneCsat === null ? 'Não informado' : formatPercent(overallPhoneCsat)} tone={overallPhoneCsat === null ? undefined : overallPhoneCsat >= podiumCsatGoal ? 'success' : overallPhoneCsat >= podiumCsatGoal - 5 ? 'warning' : 'danger'} />
            <MetricCard label="Cobertura de avaliações" value={formatPercent(reviewCoverage)} tone={reviewCoverage >= reviewGoal ? 'success' : reviewCoverage >= 20 ? 'warning' : 'danger'} />
            <MetricCard label="Atendimentos N1" value={formatChatCount(totalTickets)} />
          </div>
        </section>
      ) : (
        <section className="metric-zone">
          <div className="metric-zone-heading">
            <div>
              <p className="workspace-eyebrow">Pessoas</p>
              <h2 className="section-title mt-2">Saúde do time no período</h2>
              <p className="section-subtitle">Aqui entram pessoas, comparação individual, elegibilidade e contexto de produtividade.</p>
            </div>
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <MetricCard label="Analistas ativos" value={loading ? '...' : analystsCount} />
            <MetricCard label="Elegíveis" value={eligibleCount} tone={eligibleCount > 0 ? 'success' : 'warning'} />
            <MetricCard label="Em atenção" value={attentionCount} tone={attentionCount > 0 ? 'warning' : 'success'} />
            <MetricCard label="Média de atendimentos" value={formatChatCount(podiumAverageTickets || 0)} />
            <MetricCard label="Cobertura de avaliações" value={formatPercent(reviewCoverage)} tone={reviewCoverage >= reviewGoal ? 'success' : reviewCoverage >= 20 ? 'warning' : 'danger'} />
          </div>
        </section>
      )}

      {isManagementView && managementSection === 'area' && (
        <section className="panel border border-cyan-400/20">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.16em] text-cyan-300">Diagnóstico reservado</p>
              <h2 className="section-title mt-2">Impacto no CSAT do telefone</h2>
              <p className="section-subtitle">Visível apenas para master e coordenadora. O pódio continua considerando somente os analistas do N1.</p>
            </div>
            <span className="rounded-md bg-cyan-400/10 px-3 py-2 text-sm font-semibold text-cyan-200">Gestão</span>
          </div>

          {overallPhoneCsat === null ? (
            <div className="mt-5 rounded-lg bg-slate-900 p-4 text-sm text-slate-300">
              Informe o CSAT geral do 55PBX no fechamento semanal para liberar a comparação N1 versus N2.
            </div>
          ) : (
            <>
              <div className="mt-5 grid gap-4 md:grid-cols-3">
                <MetricCard label="CSAT N1 comparável" value={formatPercent(n1ComparisonCsat)} />
                <MetricCard label="CSAT geral" value={formatPercent(overallPhoneCsat)} />
                <MetricCard label="Diferença geral x N1" value={formatDelta(overallCsatGap ?? 0, ' p.p.')} tone={overallCsatGap !== null && overallCsatGap < 0 ? 'danger' : 'success'} />
              </div>

              <div className="mt-5 grid gap-4 lg:grid-cols-2">
                <div className="rounded-lg bg-slate-900 p-4">
                  <h3 className="font-semibold text-slate-100">Onde está a diferença?</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-300">
                    {overallCsatGap !== null && overallCsatGap < -0.01
                      ? `O resultado geral está ${formatDelta(Math.abs(overallCsatGap), ' p.p.').replace('+', '')} abaixo do N1. Como o geral inclui o N2, esta diferença indica que o conjunto externo ao N1 reduziu o consolidado. Sem as avaliações individuais do N2, não é possível atribuir o efeito a uma pessoa específica.`
                      : overallCsatGap !== null && overallCsatGap > 0.01
                        ? `O resultado geral está ${formatDelta(overallCsatGap, ' p.p.').replace('+', '')} acima do N1. Neste recorte, o conjunto externo ao N1 melhora o consolidado da operação.`
                        : 'N1 e resultado geral estão praticamente alinhados neste período.'}
                  </p>
                  {!hasCompleteOverallCoverage && (
                    <p className="mt-3 text-xs leading-5 text-amber-200">Atenção: parte das semanas do filtro ainda não possui o CSAT geral informado; a comparação cobre somente as semanas preenchidas.</p>
                  )}
                  <p className="mt-3 text-xs leading-5 text-slate-400">Em filtros com várias semanas, o CSAT geral representa a média dos fechamentos semanais informados.</p>
                </div>

              </div>
            </>
          )}
        </section>
      )}

      {(isAnalystDashboard || managementSection === 'people') && <CriteriaLegend
        title={isAnalystDashboard ? 'Critérios para disputar o pódio' : 'Critérios do pódio do telefone'}
        items={[
          `CSAT mínimo de ${podiumCsatGoal}%`,
          `Avaliações a partir de ${reviewGoal}%`,
          `Volume igual ou acima da média do time (${formatChatCount(podiumAverageTickets || 0)} atendimentos)`,
        ]}
      />}

      {!isAnalystDashboard && managementSection === 'area' && <section className="panel">
        <h2 className="section-title">Projeção do fechamento</h2>
        <p className="section-subtitle">
          Mostra para onde os indicadores apontam se a tendência atual continuar. A projeção não altera os resultados já apurados.
        </p>

        <div className="mt-6 grid gap-4 lg:grid-cols-4">
          <PredictiveCard
            label="Chance geral de fechamento"
            value={`${predictiveGoalProbability}%`}
            detail={
              hasPeriodData
                ? `Leitura combinada de CSAT, performance, avaliações e pódio. ${eligibleCount} de ${periodPodium.length} elegíveis.`
                : 'Sem base de dados no período.'
            }
            tone={predictiveGoalProbability >= 75 ? 'success' : predictiveGoalProbability >= 45 ? 'warning' : 'danger'}
          />
          <PredictiveCard
            label="CSAT projetado"
            value={formatPercent(projectedCsat)}
            detail={hasPreviousIndividualData
              ? `Resultado esperado se a tendência continuar. ${formatDelta(csatDelta, ' p.p.')} vs período anterior.`
              : 'Resultado esperado com a base atual. Ainda não há período anterior equivalente para comparação.'}
            tone={projectedCsat >= podiumCsatGoal ? 'success' : 'warning'}
          />
          <PredictiveCard
            label="Performance projetada"
            value={formatPercent(projectedTeamPerformance)}
            detail={hasPreviousTeamData
              ? `Valor esperado da operação se a tendência continuar. Meta: ${teamPerformanceGoal}%.`
              : `Valor esperado com a base atual. Meta: ${teamPerformanceGoal}%; ainda sem período anterior equivalente.`}
            tone={projectedTeamPerformance >= teamPerformanceGoal ? 'success' : 'danger'}
          />
          <PredictiveCard
            label="Risco do período"
            value={predictiveRiskLevel}
            detail={predictiveAction}
            tone={predictiveRiskLevel === 'Baixo' ? 'success' : predictiveRiskLevel === 'Medio' ? 'warning' : 'danger'}
          />
        </div>

        <div className="mt-5 rounded-lg bg-slate-900 p-5">
          <p className="text-sm font-semibold text-slate-200">Como ler esta projeção</p>
          <div className="mt-3 grid gap-3 text-sm leading-6 text-slate-400 md:grid-cols-2">
            <p>
              A chance geral combina CSAT, performance, avaliações e quantidade de analistas elegíveis. Ela não é o
              mesmo número da performance operacional.
            </p>
            <p>
              CSAT e performance projetados são valores esperados, não probabilidades. O diagnóstico abaixo explica
              por que o risco foi acionado e qual ação deve ser tomada.
            </p>
          </div>
        </div>
      </section>}

      {!isAnalystDashboard && managementSection === 'area' && <section className="panel">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-stretch">
          <div className="xl:w-2/5">
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-cyan-300">
              {isAnalystDashboard ? 'Resumo individual' : 'Diagnóstico e plano de ação'}
            </p>
            <h2 className={`mt-3 text-3xl font-bold ${isAnalystDashboard ? 'text-cyan-300' : attentionCount ? 'text-amber-300' : 'text-emerald-300'}`}>
              {isAnalystDashboard
                ? analystStatusText
                : `${eligibleCount} de ${periodPodium.length} analistas elegíveis`}
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              {isAnalystDashboard
                ? analystFocusText
                : `${periodLabel}. O detalhamento abaixo mostra quem precisa de atenção, qual critério não foi cumprido e a próxima ação recomendada.`}
            </p>
          </div>

          <div className="grid flex-1 gap-4 md:grid-cols-3">
            <div className="executive-card">
              <p>{isAnalystDashboard ? 'Atendimentos no período' : hasPreviousIndividualData ? 'CSAT vs período anterior' : 'CSAT do período'}</p>
              <strong>
                {isAnalystDashboard
                  ? totalTickets
                  : hasPreviousIndividualData
                    ? formatDelta(csatDelta, ' p.p.')
                    : formatPercent(periodAverageCsat || 0)}
              </strong>
              <span>
                {isAnalystDashboard
                  ? `${totalReviews} avaliações registradas em ${launchedPeriodLabel}`
                  : hasPreviousIndividualData
                    ? `Atual: ${formatPercent(periodAverageCsat || 0)}`
                    : 'Sem período anterior equivalente para comparação'}
              </span>
            </div>
            <div className="executive-card">
              <p>Performance equipe</p>
              <strong>{formatPercent(periodTeamPerformance || 0)}</strong>
              <span>
                {hasPreviousTeamData
                  ? `${formatDelta(teamPerformanceDelta, ' p.p.')} vs anterior`
                  : 'Sem período anterior equivalente para comparação'}
              </span>
            </div>
            <div className="executive-card">
              <p>{isAnalystDashboard ? 'Minhas avaliações' : 'Cobertura de avaliações'}</p>
              <strong>{formatPercent(reviewCoverage)}</strong>
              <span>{totalReviews} avaliações respondidas de {totalTickets} atendimentos</span>
            </div>
          </div>
        </div>

        <div className="mt-5 rounded-lg bg-slate-900 p-5">
          <div className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-200">Onde está o risco?</p>
              <p className="mt-1 text-sm text-slate-400">
                Veja o que elevou o alerta, quem precisa de atenção e a ação recomendada para cada caso.
              </p>
            </div>
            <span className="text-sm font-semibold text-slate-300">
              Risco do período: {predictiveRiskLevel}
            </span>
          </div>

          {hasPeriodData && (
            <div className="mt-4 rounded-lg border border-cyan-400/20 bg-slate-950/60 p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="font-semibold text-white">Ritmo entre a primeira e a última semana</p>
                <span className={weeklyPaceRisks.length ? 'text-amber-200' : 'text-emerald-300'}>
                  {hasWeeklyPaceComparison
                    ? weeklyPaceRisks.length ? 'Tendência exige atenção' : 'Tendência favorável'
                    : 'Aguardando comparação'}
                </span>
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-300">{weeklyPaceRead}</p>
              <p className="mt-2 text-sm leading-6 text-slate-400">Próxima ação: {weeklyPaceAction}</p>
            </div>
          )}

          {!hasPeriodData ? (
            <p className="mt-4 text-sm text-slate-400">Ainda não há dados suficientes para localizar riscos.</p>
          ) : predictiveRiskDrivers.length ? (
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {predictiveRiskDrivers.map((driver) => (
                <div key={driver.label} className="rounded-lg border border-white/10 bg-slate-950/60 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold text-white">{driver.label}</p>
                    <span className={driver.severity === 'Alto' ? 'text-rose-300' : 'text-amber-300'}>
                      {driver.severity}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-slate-300">Leitura: {driver.reading}.</p>
                  <p className="mt-2 text-sm leading-6 text-slate-400">Próxima ação: {driver.action}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-4 rounded-lg border border-emerald-400/20 bg-emerald-400/5 p-4">
              <p className="font-semibold text-emerald-300">Cenário estável neste período.</p>
              <p className="mt-2 text-sm text-slate-300">
                O risco de queda está baixo porque nenhum indicador acionou alerta. CSAT, performance,
                chance de fechamento e critérios do pódio estão estáveis neste recorte.
              </p>
            </div>
          )}
        </div>

        {!isAnalystDashboard && (
          <div className="mt-5">
            <div className="rounded-lg border border-cyan-400/20 bg-slate-900 p-5">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="font-semibold text-white">Aprofundamento com IA</p>
                  <p className="mt-1 text-sm leading-6 text-slate-400">
                    A IA interpreta os cálculos acima, prioriza ações e explica como acompanhar o próximo resultado.
                    Ela não altera números, critérios ou posições do pódio.
                  </p>
                </div>
                <button
                  className="primary-button shrink-0 disabled:cursor-not-allowed disabled:opacity-60"
                  type="button"
                  disabled={!hasPeriodData || managementAiLoading}
                  onClick={handleManagementAiAnalysis}
                >
                  {managementAiLoading ? 'Analisando...' : 'Aprofundar análise com IA'}
                </button>
              </div>
              {managementAiMessage && (
                <p className="mt-4 text-sm text-cyan-100">{managementAiMessage}</p>
              )}
              {managementAiAnalysis && (
                <div className="mt-4 whitespace-pre-line rounded-lg border border-white/10 bg-slate-950/70 p-5 text-sm leading-7 text-slate-200">
                  {managementAiAnalysis}
                </div>
              )}
            </div>
          </div>
        )}
      </section>}

      {!isAnalystDashboard && managementSection === 'people' && (
        <section className="panel">
          <h2 className="section-title">Análise visual do período</h2>
          <p className="section-subtitle">
            Compare elegibilidade, qualidade e volume para localizar rapidamente onde a equipe ganha ou perde força.
          </p>

          <div className="mt-5 people-insight">
            <p className="workspace-eyebrow">Leitura de pessoas</p>
            <h3 className="mt-2 text-lg font-bold">Impacto individual no consolidado N1</h3>
            <p className="mt-1 text-sm leading-6 text-slate-400">Esta leitura fica em Pessoas porque apresenta nomes e impacto individual. Ela não muda o cálculo do CSAT.</p>
                <div className="rounded-lg bg-slate-900 p-4">
                  <h3 className="font-semibold text-slate-100">Impacto matemático dentro do N1</h3>
                  <p className="mt-2 text-xs leading-5 text-slate-400">A leitura considera CSAT e quantidade de avaliações. Ela indica impacto no número consolidado, não culpa ou causa operacional.</p>
                  <div className="mt-3 space-y-2">
                    {n1ImpactRanking.filter((item) => item.downwardImpact > 0).slice(0, 3).map((item) => (
                      <div key={item.analystName} className="flex flex-col gap-1 rounded-md bg-slate-950 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                        <span className="font-semibold">{item.analystName}</span>
                        <span className="text-slate-300">{formatPercent(item.averageCsat)} CSAT · {formatChatCount(item.reviews)} avaliações · impacto de {formatDelta(item.downwardImpact, ' p.p.')}</span>
                      </div>
                    ))}
                    {!n1ImpactRanking.some((item) => item.downwardImpact > 0) && (
                      <p className="text-sm text-slate-300">Nenhum impacto negativo individual relevante foi identificado no N1 neste recorte.</p>
                    )}
                  </div>
                </div>

          </div>

          <div className="mt-6 grid gap-6 xl:grid-cols-[0.85fr_1.15fr]">
            <EligibilityFunnel
              title="Funil de elegibilidade do telefone"
              subtitle="Mostra em qual critério o time perde força antes do fechamento do pódio."
              items={phoneFunnelItems}
            />
            <ComparisonBars
              title="Comparativo visual dos analistas"
              subtitle="Mostra rapidamente quem combina CSAT, avaliações e volume de atendimentos no período."
              rows={phoneVisualRows}
              primaryGoal={podiumCsatGoal}
              secondaryGoal={reviewGoal}
              volumeReference={podiumAverageTickets}
            />
            <div className="xl:col-span-2">
              <VolumeQualityMap
                title="Mapa volume x CSAT"
                subtitle="Quanto mais para a direita, maior o volume. Quanto mais para cima, melhor o CSAT."
                points={phoneVisualPoints}
                xReference={podiumAverageTickets}
                yReference={podiumCsatGoal}
              />
            </div>
          </div>
        </section>
      )}

      {isAnalystDashboard && (
        <>
          <section className="panel">
            <p className="workspace-eyebrow">Minha evolução</p>
            <h2 className="section-title mt-2">Minha evolução recente</h2>
            <p className="section-subtitle">Somente indicadores individuais dentro de ${periodLabel}.</p>

            <div className="mt-6 grid gap-6 md:grid-cols-2">
              <TrendLineChart
                label="Meu CSAT semanal"
                points={weeklyIndividualTrend.map((item) => ({
                  label: item.label,
                  value: item.csat,
                }))}
                suffix="%"
              />
              <BarTrend
                label="Minhas avaliações por semana"
                points={weeklyIndividualTrend.map((item) => ({
                  label: item.label,
                  value: item.totalReviews,
                }))}
              />
              <BarTrend
                label="Meus atendimentos por semana"
                points={weeklyIndividualTrend.map((item) => ({
                  label: item.label,
                  value: item.totalTickets,
                }))}
              />
              <TrendLineChart
                label="Meu percentual de avaliações por semana"
                points={weeklyReviewCoverageTrend}
                suffix="%"
                goal={reviewGoal}
                goalLabel="Meta do pódio"
              />
            </div>
          </section>

          <section className="panel context-zone">
            <p className="workspace-eyebrow">Nosso resultado</p>
            <h2 className="section-title mt-2">Evolução da equipe</h2>
            <p className="section-subtitle">Contexto coletivo mantido na visão do analista para acompanhar o equilíbrio da operação.</p>
            <div className="mt-6 grid gap-6 md:grid-cols-2">
              <TrendLineChart
                label="Performance da equipe"
                points={teamPerformanceTrend}
                suffix="%"
              />
              <TrendLineChart
                label="CSAT geral N1 + N2 por semana"
                points={overallCsatTrend}
                suffix="%"
              />
            </div>
          </section>
        </>
      )}

      {!isAnalystDashboard && managementSection === 'area' && (
        <section className="panel">
          <p className="workspace-eyebrow">Operação</p>
          <h2 className="section-title mt-2">Variações recentes</h2>
          <p className="section-subtitle">Evolução calculada dentro de ${periodLabel}.</p>

          <div className="mt-6 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            <TrendLineChart
              label="CSAT médio semanal"
              points={weeklyIndividualTrend.map((item) => ({
                label: item.label,
                value: item.csat,
              }))}
              suffix="%"
            />
            <BarTrend
              label="Avaliações por semana"
              points={weeklyIndividualTrend.map((item) => ({
                label: item.label,
                value: item.totalReviews,
              }))}
            />
            <BarTrend
              label="Atendimentos por semana"
              points={weeklyIndividualTrend.map((item) => ({
                label: item.label,
                value: item.totalTickets,
              }))}
            />
            <TrendLineChart
              label="Performance da equipe"
              points={teamPerformanceTrend}
              suffix="%"
            />
            <TrendLineChart
              label="CSAT geral N1 + N2 por semana"
              points={overallCsatTrend}
              suffix="%"
            />
            <TrendLineChart
              label="Cobertura de avaliações por semana"
              points={weeklyReviewCoverageTrend}
              suffix="%"
              goal={reviewGoal}
              goalLabel="Meta do pódio"
            />
          </div>
        </section>
      )}

      {(isAnalystDashboard || managementSection === 'people') && <section className="panel">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="section-title">
              {isAnalystDashboard ? 'Minha elegibilidade' : 'Ranking completo do período'}
            </h2>
            <p className="section-subtitle">
              {isAnalystDashboard
                ? `Sua leitura em ${launchedPeriodLabel}: CSAT mínimo ${podiumCsatGoal}%, avaliações ${reviewGoal}% e volume comparado com a média dos analistas lançados.`
                : `Ranking de ${periodLabel}: CSAT mínimo ${podiumCsatGoal}%, avaliações ${reviewGoal}% e atendimentos dentro da média da equipe.`}
            </p>
            {!isAnalystDashboard && (
              <p className="mt-2 text-sm text-slate-400">
                Média de atendimentos do time neste recorte: <span className="font-semibold text-slate-200">{formatChatCount(podiumAverageTickets || 0)}</span>.
              </p>
            )}
          </div>
        </div>

        {isAnalystDashboard ? (
          <div className="mt-6 grid gap-4 lg:grid-cols-3">
            <div className="rounded-lg bg-slate-900 p-5">
              <p className="text-sm text-slate-400">Status do período</p>
              <h3 className={`mt-2 text-2xl font-bold ${analystDataLoading ? 'text-cyan-300' : analystResult?.eligible ? 'text-emerald-300' : 'text-cyan-300'}`}>
                {analystDataLoading ? 'Atualizando leitura...' : analystStatusText}
              </h3>
              <p className="mt-3 text-sm text-slate-400">
                {analystDataLoading ? 'Buscando lançamentos e recalculando sua posição com os dados do período.' : analystPulseText}
              </p>
            </div>

            <div className="rounded-lg bg-slate-900 p-5">
              <p className="text-sm text-slate-400">CSAT e avaliações</p>
              <p className="mt-2 text-3xl font-bold text-cyan-300">
                {formatPercent(analystResult?.averageCsat ?? 0)}
              </p>
              <p className="mt-2 text-sm text-slate-400">
                {formatPercent(analystResult?.reviewPercentage ?? 0)} avaliações | meta {reviewGoal}%
              </p>
            </div>

            <div className="rounded-lg bg-slate-900 p-5">
              <p className="text-sm text-slate-400">Posição no período</p>
              <p className="mt-2 text-3xl font-bold">{analystDataLoading ? '...' : analystRankingPosition ? `${analystRankingPosition}o` : '-'}</p>
              <p className={`mt-2 text-sm font-semibold ${analystDataLoading ? 'text-cyan-300' : analystResult?.eligible && analystRankingPosition <= 3 ? 'text-emerald-300' : analystResult?.eligible ? 'text-cyan-300' : 'text-amber-200'}`}>
                {analystDataLoading ? 'Calculando com os dados do período' : analystPodiumPositionStatus}
              </p>
              <p className="mt-2 text-sm text-slate-400">
                {analystDataLoading ? 'Aguarde a leitura final do banco antes de considerar a posição.' : analystRankingRead}
              </p>
            </div>

            <div className="rounded-lg bg-slate-900 p-5 lg:col-span-3">
              <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                <div>
                  <p className="text-sm text-slate-400">O que falta para o pódio?</p>
                  <h3 className="mt-2 text-2xl font-bold text-cyan-300">
                    {analystDataLoading ? 'Calculando critérios' : analystResult?.eligible ? 'Você esta dentro dos critérios' : 'Distancia ate o pódio'}
                  </h3>
                </div>
                <p className="max-w-2xl text-sm leading-6 text-slate-400">
                  {analystDataLoading ? 'Aguarde enquanto o sistema cruza CSAT, avaliações, volume e ranking do período.' : analystPodiumGapText}
                </p>
              </div>
              <div className="mt-5 rounded-lg border border-cyan-400/20 bg-slate-950/70 p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-cyan-200">Sua jornada até o pódio</p>
                    <p className="mt-1 text-sm text-slate-400">Atualizada com os lançamentos de {launchedPeriodLabel}.</p>
                  </div>
                  <p className="text-2xl font-bold text-white">{analystCriteriaCompleted} de 3 critérios</p>
                </div>
                <div className="mt-5 h-3 overflow-hidden rounded-full bg-slate-800" aria-label={`${analystJourneyProgress}% dos critérios cumpridos`}>
                  <div className="h-full rounded-full bg-cyan-300 transition-[width] duration-500" style={{ width: `${analystJourneyProgress}%` }} />
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                  {analystPodiumChecklist.map((item, index) => (
                    <div key={`journey-${item.label}`} className={`rounded-lg border p-4 ${item.ok ? 'border-emerald-400/30 bg-emerald-400/5' : 'border-amber-300/30 bg-amber-300/5'}`}>
                      <div className="flex items-center gap-3">
                        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${item.ok ? 'bg-emerald-300 text-slate-950' : 'bg-amber-200 text-slate-950'}`}>
                          {item.ok ? 'OK' : index + 1}
                        </span>
                        <p className="font-semibold text-white">{item.label}</p>
                      </div>
                      <p className={`mt-3 text-sm leading-6 ${item.ok ? 'text-emerald-200' : 'text-amber-100'}`}>{item.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="mt-6 rounded-xl border border-cyan-400/20 bg-slate-900/60 p-5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-lg font-bold">Ajuste do pódio pela gestão</h3>
                    {isManualPhonePodium && (
                      <span className="rounded-full bg-cyan-400/10 px-2.5 py-1 text-xs font-semibold text-cyan-200">
                        Ajustado pela gestão
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-slate-400">
                    O ranking calculado continua visível abaixo. Use este ajuste apenas para decisões reconhecidas pela gestão.
                  </p>
                </div>
                {isManualPhonePodium && (
                  <button
                    className="secondary-button self-start"
                    disabled={phoneManualPodiumSaving}
                    type="button"
                    onClick={() => void handleRestoreCalculatedPhonePodium()}
                  >
                    Restaurar calculado
                  </button>
                )}
              </div>

              <div className="mt-5 grid gap-4 md:grid-cols-3">
                {[1, 2, 3].map((position) => (
                  <Field key={position} label={`${position}º lugar`}>
                    <select
                      className="form-input"
                      value={phoneManualPodiumDraft[position]
                        ?? calculatedPodiumWinners[position - 1]?.analystId
                        ?? ''}
                      onChange={(event) => setPhoneManualPodiumDraft((current) => ({
                        ...current,
                        [position]: event.target.value,
                      }))}
                    >
                      <option value="">Vaga não definida</option>
                      {periodPodium.map((item) => (
                        <option key={item.analystId} value={item.analystId}>
                          {item.analystName} · CSAT {formatPercent(item.averageCsat)} · {formatChatCount(item.totalTickets)} atend.
                        </option>
                      ))}
                    </select>
                  </Field>
                ))}
              </div>

              <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
                <Field label="Motivo do ajuste">
                  <input
                    className="form-input"
                    placeholder="Ex.: reconhecimento por mérito; diferença de apenas um atendimento para a média."
                    value={phoneManualPodiumReason}
                    onChange={(event) => setPhoneManualPodiumReason(event.target.value)}
                  />
                </Field>
                <button
                  className="primary-button min-h-12"
                  disabled={phoneManualPodiumSaving || !periodPodium.length}
                  type="button"
                  onClick={() => void handleSavePhoneManualPodium()}
                >
                  {phoneManualPodiumSaving ? 'Salvando...' : 'Salvar pódio ajustado'}
                </button>
              </div>

              {phoneManualPodiumMessage && (
                <p className="mt-4 rounded-md bg-slate-950/70 px-4 py-3 text-sm text-slate-200">
                  {phoneManualPodiumMessage}
                </p>
              )}
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-3">
              {[0, 1, 2].map((index) => {
                const winner = podiumWinners[index]
                const winnerAnalyst = winner
                  ? analysts.find((analyst) => analyst.id === winner.analystId)
                  : null

                return (
                  <div key={index} className="rounded-lg bg-slate-900 p-5">
                    <p className="text-sm text-slate-400">{index + 1}o lugar</p>
                    {winner ? (
                      <>
                        <div className="mt-3 flex items-center gap-3">
                          <AnalystAvatar
                            name={winner.analystName}
                            photoUrl={winnerAnalyst?.photo_url}
                            size="md"
                          />
                          <h3 className="text-xl font-bold">{winner.analystName}</h3>
                        </div>
                        <p className="mt-3 text-3xl font-bold text-cyan-300 tabular-nums">{formatPercent(winner.averageCsat)}</p>
                        <p className="mt-2 text-sm text-slate-400">
                          {formatPercent(winner.reviewPercentage)} avaliações | {formatChatCount(winner.totalTickets)} atendimentos
                        </p>
                      </>
                    ) : (
                      <p className="mt-5 text-sm text-slate-500">Aguardando elegível</p>
                    )}
                  </div>
                )
              })}
            </div>

            <div className="mt-6 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="text-slate-400">
                  <tr>
                    <th className="pb-3 pr-4 font-medium">Posição</th>
                    <th className="pb-3 pr-4 font-medium">Analista</th>
                    <th className="pb-3 pr-4 font-medium">CSAT período</th>
                    <th className="pb-3 pr-4 font-medium">Avaliações</th>
                    <th className="pb-3 pr-4 font-medium">Atendimentos</th>
                    <th className="pb-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {periodPodium.map((item) => {
                    const manualPosition = phoneManualPodium.find((manual) => manual.analyst_id === item.analystId)?.position

                    return (
                    <tr key={item.analystId}>
                      <td className="py-3 pr-4 font-bold text-cyan-300">{periodPodium.findIndex((rankingItem) => rankingItem.analystId === item.analystId) + 1}o</td>
                      <td className="py-3 pr-4">{item.analystName}</td>
                      <td className="whitespace-nowrap py-3 pr-4 tabular-nums">
                        {formatPercent(item.averageCsat)} <span className="text-slate-500">/ meta {item.individualGoal}%</span>
                      </td>
                      <td className="whitespace-nowrap py-3 pr-4 tabular-nums">{formatPercent(item.reviewPercentage)}</td>
                      <td className="whitespace-nowrap py-3 pr-4 tabular-nums">{formatChatCount(item.totalTickets)}</td>
                      <td className="py-3">
                        {manualPosition ? (
                          <span className="font-semibold text-cyan-200">Pódio ajustado · {manualPosition}º lugar</span>
                        ) : item.eligible ? (
                          <span className="text-emerald-300">Elegível</span>
                        ) : (
                          <span className="text-slate-400">{formatStatusText(item.reasons.join(', '))}</span>
                        )}
                      </td>
                    </tr>
                    )
                  })}
                </tbody>
              </table>

              {!periodPodium.length && (
                <EmptyState text="Ainda nao ha lançamentos individuais no período selecionado." />
              )}
            </div>
          </>
          )}
      </section>}
    </div>
  )
}

function ReportsView({
  analysts,
  goals,
  individualMetrics,
  teamMetrics,
  role,
}: {
  analysts: Analyst[]
  goals: Goal[]
  individualMetrics: IndividualMetric[]
  teamMetrics: TeamMetric[]
  role: UserRole
}) {
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>(() => createPeriodFilter('month'))
  const [phonePodiumRanking, setPhonePodiumRanking] = useState<PhonePodiumRankingRow[]>([])
  const [selectedAnalystId, setSelectedAnalystId] = useState('')
  const [exportMessage, setExportMessage] = useState('')
  const [phoneManagerNotes, setPhoneManagerNotes] = useState('')
  const [phoneFeedbackDraft, setPhoneFeedbackDraft] = useState('')
  const [phoneFeedbackStyle, setPhoneFeedbackStyle] = useState<ChatFeedbackStyle>('mimo')
  const [phoneFeedbackGoal, setPhoneFeedbackGoal] = useState<FeedbackGoal>('development')
  const [phoneAiSaving, setPhoneAiSaving] = useState(false)
  const [phoneAiStatus, setPhoneAiStatus] = useState<'idle' | 'success' | 'fallback' | 'error'>('idle')
  const isManagementUser = role !== 'analyst'
  const reportAnalysts = useMemo(
    () => (analysts.length ? analysts : buildAnalystsFromMetrics(individualMetrics)),
    [analysts, individualMetrics],
  )

  useEffect(() => {
    if (!reportAnalysts.length) return
    if (!selectedAnalystId || !reportAnalysts.some((analyst) => analyst.id === selectedAnalystId)) {
      setSelectedAnalystId(reportAnalysts[0].id)
    }
  }, [reportAnalysts, selectedAnalystId])

  useEffect(() => {
    setPhoneFeedbackDraft('')
    setExportMessage('')
    setPhoneAiStatus('idle')
  }, [periodFilter.start, periodFilter.end, selectedAnalystId, phoneFeedbackStyle])


  const selectedAnalyst =
    reportAnalysts.find((analyst) => analyst.id === selectedAnalystId) ?? reportAnalysts[0] ?? null
  const periodLabel = formatPeriodLabel(periodFilter)
  const previousPeriod = getPreviousPeriod(periodFilter)
  const podiumCsatGoal = getGoalValue(goals, 'podium_csat_minimum', 90)
  const reviewGoal = getGoalValue(goals, 'review_percentage', 25)
  const teamPerformanceGoal = getTeamPerformanceGoal(goals)
  const periodIndividualMetrics = filterIndividualMetricsByPeriod(individualMetrics, periodFilter)
  const periodTeamMetrics = filterTeamMetricsByPeriod(teamMetrics, periodFilter)
  const analystMetrics = selectedAnalyst
    ? periodIndividualMetrics.filter((metric) => metric.analyst_id === selectedAnalyst.id)
    : []
  const previousAnalystMetrics = selectedAnalyst
    ? filterIndividualMetricsByPeriod(individualMetrics, previousPeriod).filter(
        (metric) => metric.analyst_id === selectedAnalyst.id,
      )
    : []
  const podium = buildPeriodPodium(periodIndividualMetrics, reportAnalysts, podiumCsatGoal, reviewGoal)
  const analystResult = selectedAnalyst
    ? podium.find((item) => item.analystId === selectedAnalyst.id) ?? null
    : null
  const previousCsat = calculateAverageCsat(previousAnalystMetrics)
  const csatDelta = analystResult ? round(analystResult.averageCsat - previousCsat) : 0
  const teamPerformance = calculateTeamPerformance(periodTeamMetrics)
  const teamStatus =
    teamPerformance >= teamPerformanceGoal
      ? 'Operação dentro da referência.'
      : 'Operação abaixo da referência definida.'
  const selectedRankingPosition = analystResult
    ? podium.findIndex((item) => item.analystId === analystResult.analystId) + 1
    : 0
  const strongestResult = podium[0] ?? null
  const attentionResults = podium.filter((item) => !item.eligible).slice(0, 3)
  const growthResults = podium
    .map((item) => {
      const previous = filterIndividualMetricsByPeriod(individualMetrics, previousPeriod).filter(
        (metric) => metric.analyst_id === item.analystId,
      )

      return {
        ...item,
        delta: round(item.averageCsat - calculateAverageCsat(previous)),
      }
    })
    .sort((a, b) => b.delta - a.delta)
  const bestGrowth = growthResults[0] ?? null
  const riskResults = podium
    .filter((item) => !item.eligible || item.averageCsat < item.individualGoal + 2)
    .slice(0, 3)
  const reviewCount = analystMetrics.reduce((sum, metric) => sum + Number(metric.total_reviews), 0)
  const answeredTickets = analystResult?.totalTickets ?? 0
  const teamAnsweredCalls = periodTeamMetrics.reduce((sum, metric) => sum + Number(metric.answered_calls), 0)
  const teamAbandonedCalls = periodTeamMetrics.reduce((sum, metric) => sum + Number(metric.abandoned_calls), 0)
  const teamTotalCalls = periodTeamMetrics.reduce((sum, metric) => sum + Number(metric.total_calls), 0)
  const teamLossPercentage = teamTotalCalls ? round((teamAbandonedCalls / teamTotalCalls) * 100) : 0
  const weeklyEvolution = aggregateIndividualByWeek(analystMetrics)
  const supervisorAverageTickets = podium.length
    ? round(podium.reduce((sum, item) => sum + item.totalTickets, 0) / podium.length)
    : 0
  const supervisorVolumeGap = analystResult ? analystResult.totalTickets - supervisorAverageTickets : 0
  const supervisorReviewGap = analystResult ? round(analystResult.reviewPercentage - reviewGoal) : 0
  const supervisorCsatGap = analystResult ? round(analystResult.averageCsat - podiumCsatGoal) : 0
  const supervisorCaseStatus = analystResult
    ? analystResult.eligible
      ? selectedRankingPosition > 0 && selectedRankingPosition <= 3
        ? 'Caso de reconhecimento e preservação'
        : 'Caso elegível para desenvolvimento competitivo'
      : 'Caso de acompanhamento ativo'
    : 'Sem leitura disponível'
  const supervisorDecisionText = analystResult
    ? analystResult.eligible
      ? selectedRankingPosition > 0 && selectedRankingPosition <= 3
        ? 'Reconhecer o resultado, registrar as praticas que sustentaram o desempenho e combinar como proteger o padrao ate o fechamento.'
        : 'Manter elegibilidade, comparar com o top 3 e escolher um ganho objetivo em CSAT, avaliações ou volume para disputar posição.'
      : `Tratar os critérios pendentes antes de falar em pódio: ${analystResult.reasons.join(', ') || 'revisar indicadores'}.`
    : 'Selecione um analista com lançamento no período para liberar recomendação.'
  const supervisorOneToOneText = analystResult
    ? analystResult.eligible
      ? 'Use a conversa 1:1 para perguntar quais comportamentos ajudaram o resultado, quais atendimentos devem virar referência e qual rotina precisa ser repetida.'
      : 'Use a conversa 1:1 para identificar causa raiz: qualidade do atendimento, encerramento sem pedido de avaliação, volume abaixo da média ou contexto operacional.'
    : 'Aguardando dados para sugerir roteiro de conversa.'
  const supervisorFollowUpText = analystResult
    ? `No próximo ciclo, acompanhar CSAT ${formatPercent(analystResult.averageCsat)} (${formatDelta(supervisorCsatGap, ' p.p.')} vs pódio), avaliações ${formatPercent(analystResult.reviewPercentage)} (${formatDelta(supervisorReviewGap, ' p.p.')} vs meta) e volume ${formatChatCount(analystResult.totalTickets)} (${formatDelta(supervisorVolumeGap, '')} vs média ${formatChatCount(supervisorAverageTickets)}).`
    : 'Sem acompanhamento definido.'
  const supervisorPeriodTypeText =
    periodFilter.mode === 'week'
      ? 'Leitura semanal'
      : periodFilter.mode === 'month'
        ? 'Leitura mensal acumulada'
        : periodFilter.mode === 'year'
          ? 'Leitura anual acumulada'
          : 'Leitura personalizada'
  const supervisorPeriodStatusText =
    periodFilter.mode === 'month'
      ? 'O mes e recalculado conforme novas semanas forem lancadas.'
      : periodFilter.mode === 'year'
        ? 'O ano e recalculado conforme novos meses e semanas forem lancados.'
        : periodFilter.mode === 'week'
          ? 'A semana representa o recorte selecionado para acompanhamento.'
          : 'O resultado segue exatamente o intervalo escolhido.'
  const supervisorComparisonText = `Comparativo contra período anterior equivalente: ${formatPeriodLabel(previousPeriod)}.`
  const supervisorContextCards = [
    { label: 'Recorte analisado', value: periodLabel, detail: supervisorPeriodTypeText },
    { label: 'Base da leitura', value: selectedAnalyst?.name ?? 'Sem analista', detail: supervisorPeriodStatusText },
    { label: 'Comparativo usado', value: formatPeriodLabel(previousPeriod), detail: supervisorComparisonText },
  ]
  const supervisorActionCards = [
    {
      label: 'Diagnóstico',
      title: supervisorCaseStatus,
      text: analystResult
        ? `Ranking atual: ${selectedRankingPosition || '-'}o. CSAT ${formatPercent(analystResult.averageCsat)}, avaliações ${formatPercent(analystResult.reviewPercentage)} e ${formatChatCount(analystResult.totalTickets)} atendimentos contra média ${formatChatCount(supervisorAverageTickets)}.`
        : 'Selecione um analista e período com dados para calcular a leitura.',
    },
    {
      label: 'Acao recomendada',
      title: analystResult?.eligible ? 'Preservar ou competir' : 'Corrigir impeditivos',
      text: supervisorDecisionText,
    },
    {
      label: 'Conversa 1:1',
      title: 'Pergunta que destrava ação',
      text: supervisorOneToOneText,
    },
    {
      label: 'Proximo acompanhamento',
      title: 'Indicadores para revisar',
      text: supervisorFollowUpText,
    },
  ]
  const situationText = selectedAnalyst && analystResult
    ? `${selectedAnalyst.name} fechou ${periodLabel} com CSAT de ${formatPercent(analystResult.averageCsat)}, ${formatChatCount(analystResult.totalReviews)} avaliações e ${formatChatCount(analystResult.totalTickets)} atendimentos registrados. A meta individual e ${analystResult.individualGoal}% e a referência para pódio e ${podiumCsatGoal}%. A variação contra o período anterior foi de ${formatDelta(csatDelta, ' p.p.')}.`
    : ''
  const actionText = analystResult
    ? analystResult.eligible
      ? 'Foram alinhadas a manutencao das praticas atuais, a preservação do volume de avaliações e o acompanhamento semanal de qualquer oscilação antes do fechamento do ciclo.'
      : `Foram alinhadas a priorização dos pontos: ${analystResult.reasons.join(', ')}. A recomendação inicial e revisar atendimentos de menor satisfação, reforcar o convite para avaliação e acompanhar o indicador semanalmente.`
    : ''
  const resultText = analystResult
    ? analystResult.eligible
      ? `Resultado esperado: manter CSAT acima de ${podiumCsatGoal}%, preservar elegibilidade ao pódio e sustentar volume de avaliações igual ou superior a ${reviewGoal}% dos atendimentos.`
      : `Resultado esperado: recuperar os pontos impeditivos para apróximar o desempenho da referência de pódio (${podiumCsatGoal}%) e elevar a consistencia do indicador no próximo ciclo.`
    : ''
  const evolutionText = analystResult
    ? `Expectativa e plano de desenvolvimento: ${buildDevelopmentFocus(analystResult, csatDelta)} Perguntas sugeridas para 1:1: o que ajudou ou atrapalhou o CSAT no período? quais atendimentos merecem revisao? qual ação simples pode aumentar avaliações na próxima semana?`
    : ''
  const feedbackSummary = analystResult
    ? analystResult.eligible
      ? `${selectedAnalyst?.name ?? 'Analista'} está elegível ao pódio no período. O foco recomendado e preservar consistencia, volume de avaliações e acompanhamento semanal.`
      : `${selectedAnalyst?.name ?? 'Analista'} ainda nao sustenta elegibilidade ao pódio neste período. O foco recomendado e atuar sobre: ${analystResult.reasons.join(', ')}.`
    : ''
  const phoneFeedbackSuggestion = selectedAnalyst && analystResult
    ? buildPhoneFeedbackText({
        analystName: selectedAnalyst.name,
        periodLabel,
        analystResult,
        podiumCsatGoal,
        reviewGoal,
        teamPerformance,
        teamPerformanceGoal,
        rankingPosition: selectedRankingPosition,
        managerNotes: phoneManagerNotes,
        averageTickets: supervisorAverageTickets,
      })
    : ''

  const hasSelectedAnalyst = Boolean(selectedAnalyst)
  const hasAnalystLaunch = Boolean(analystResult)
  const hasTeamLaunch = periodTeamMetrics.length > 0
  const reportReady = hasSelectedAnalyst && hasAnalystLaunch
  const reportReadinessItems = [
    {
      label: 'Analista selecionado',
      done: hasSelectedAnalyst,
      detail: selectedAnalyst ? selectedAnalyst.name : 'Selecione um analista para gerar o SARE.',
    },
    {
      label: 'Lancamento individual no período',
      done: hasAnalystLaunch,
      detail: hasAnalystLaunch ? 'Dados individuais encontrados.' : 'Não ha lançamento individual para este filtro.',
    },
    {
      label: 'Desempenho da equipe',
      done: hasTeamLaunch,
      detail: hasTeamLaunch
        ? `${formatPercent(teamPerformance)} de performance no período.`
        : 'Sem lançamento de equipe; o relatório sai, mas a leitura operacional fica incompleta.',
    },
  ]
  function handlePeriodModeChange(mode: PeriodMode) {
    setPeriodFilter(createPeriodFilter(mode))
  }

  function handleGeneratePhoneFeedbackDraft() {
    if (!selectedAnalyst || !analystResult) {
      setExportMessage('Selecione um analista e um período com lançamento antes de gerar o feedback.')
      return
    }

    setPhoneFeedbackDraft(phoneFeedbackSuggestion)
    setPhoneAiStatus('idle')
    setExportMessage('Base factual gerada. Use a IA para transformar os dados em um feedback personalizado.')
  }

  async function handleGeneratePhoneFeedbackWithAi() {
    if (!selectedAnalyst || !analystResult) {
      setExportMessage('Selecione um analista e um período com lançamento antes de acionar a IA.')
      return
    }

    setPhoneAiSaving(true)
    setExportMessage('')

    try {
      const averageTickets =
        podium.length > 0
          ? round(podium.reduce((sum, item) => sum + item.totalTickets, 0) / podium.length)
          : 0
      const response = await fetch('/api/chat-feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          serviceModule: 'phone',
          feedbackStyle: phoneFeedbackStyle,
          feedbackGoal: phoneFeedbackGoal,
          generationMode: 'generate',
          periodLabel,
          managerNotes: phoneManagerNotes,
          fallbackText: phoneFeedbackSuggestion,
          averageTickets,
          podiumPosition: selectedRankingPosition,
          metric: {
            analystName: selectedAnalyst.name,
            teamName: 'Telefone',
            csat: analystResult.averageCsat,
            reviewPercentage: analystResult.reviewPercentage,
            totalTickets: analystResult.totalTickets,
            reviews: analystResult.totalReviews,
            csatGoal: analystResult.individualGoal,
            reviewGoal,
            status: analystResult.eligible ? 'Elegível ao pódio' : 'Em acompanhamento',
            teamPerformance,
            teamAnsweredCalls,
            teamTotalCalls,
          },
          monthlyHistory: weeklyEvolution.map((item) => ({
            monthLabel: item.label,
            csat: item.csat,
            reviewPercentage: item.totalTickets ? round((item.totalReviews / item.totalTickets) * 100) : 0,
            sendingPercentage: 0,
            totalTickets: item.totalTickets,
          })),
        }),
      })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Não foi possível gerar texto com IA.')
      }

      if (data.source === 'local-fallback') {
        setPhoneAiStatus('fallback')
        setExportMessage(data.warning || 'A IA não respondeu. A base factual foi mantida sem reescrita.')
      } else {
        setPhoneFeedbackDraft(cleanChatReportFeedbackText(data.feedback ?? ''))
        setPhoneAiStatus('success')
        setExportMessage('Texto personalizado gerado pela IA. Revise antes de exportar.')
      }
    } catch (error) {
      setPhoneFeedbackDraft(phoneFeedbackSuggestion)
      setPhoneAiStatus('error')
      setExportMessage(`A IA externa nao gerou um texto valido agora. Usei a sugestão local do telefone. Motivo: ${getErrorMessage(error)}`)
    } finally {
      setPhoneAiSaving(false)
    }
  }

  async function handleImprovePhoneFeedbackWithAi() {
    if (!selectedAnalyst || !analystResult) {
      setExportMessage('Selecione um analista e um período com lançamento antes de acionar a IA.')
      return
    }

    const baseFeedback = phoneFeedbackDraft.trim() || phoneFeedbackSuggestion

    if (!baseFeedback.trim()) {
      setExportMessage('Gere uma sugestão ou escreva um texto antes de pedir melhoria com IA.')
      return
    }

    setPhoneAiSaving(true)
    setExportMessage('Melhorando texto com IA...')

    try {
      const averageTickets =
        podium.length > 0
          ? round(podium.reduce((sum, item) => sum + item.totalTickets, 0) / podium.length)
          : 0
      const response = await fetch('/api/chat-feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          serviceModule: 'phone',
          feedbackStyle: phoneFeedbackStyle,
          feedbackGoal: phoneFeedbackGoal,
          generationMode: 'improve',
          periodLabel,
          managerNotes: phoneManagerNotes,
          fallbackText: baseFeedback,
          averageTickets,
          podiumPosition: selectedRankingPosition,
          metric: {
            analystName: selectedAnalyst.name,
            teamName: 'Telefone',
            csat: analystResult.averageCsat,
            reviewPercentage: analystResult.reviewPercentage,
            totalTickets: analystResult.totalTickets,
            reviews: analystResult.totalReviews,
            csatGoal: analystResult.individualGoal,
            reviewGoal,
            status: analystResult.eligible ? 'Elegível ao pódio' : 'Em acompanhamento',
            teamPerformance,
            teamAnsweredCalls,
            teamTotalCalls,
          },
          monthlyHistory: weeklyEvolution.map((item) => ({
            monthLabel: item.label,
            csat: item.csat,
            reviewPercentage: item.totalTickets ? round((item.totalReviews / item.totalTickets) * 100) : 0,
            sendingPercentage: 0,
            totalTickets: item.totalTickets,
          })),
        }),
      })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Não foi possível melhorar texto com IA.')
      }

      if (data.source === 'local-fallback') {
        setPhoneAiStatus('fallback')
        setExportMessage(data.warning || 'A IA não respondeu. O texto atual foi mantido sem alterações.')
      } else {
        setPhoneFeedbackDraft(cleanChatReportFeedbackText(data.feedback ?? ''))
        setPhoneAiStatus('success')
        setExportMessage('Texto reorganizado e corrigido pela IA. Revise antes de exportar.')
      }
    } catch (error) {
      setPhoneAiStatus('error')
      setExportMessage('A IA externa não melhorou o texto agora. Mantive o texto atual. Motivo: ' + getErrorMessage(error))
    } finally {
      setPhoneAiSaving(false)
    }
  }

  async function handleExportWordReport() {
    if (!selectedAnalyst || !analystResult) {
      setExportMessage('Selecione um analista e um período com lançamento antes de exportar.')
      return
    }

    try {
      setExportMessage('Preparando relatório e incorporando a foto do analista...')
      const finalPhoneFeedback = normalizePhoneReportFeedback(phoneFeedbackDraft, phoneFeedbackSuggestion, phoneFeedbackStyle)
      const fileName = await exportWordReport({
        analystName: selectedAnalyst.name,
        photoUrl: getAnalystPhoto(selectedAnalyst.name, selectedAnalyst.photo_url),
        periodLabel,
        expected: {
          csat: podiumCsatGoal,

          review: reviewGoal,
        },
        achieved: {
          csat: analystResult.averageCsat,
          loss: teamLossPercentage,
          summary: feedbackSummary,
          reviewPercentage: analystResult.reviewPercentage,
          reviewCount,
          answeredTickets,
          averageTickets:
            podium.length > 0
              ? round(podium.reduce((sum, item) => sum + item.totalTickets, 0) / podium.length)
              : 0,
          rankingPosition: selectedRankingPosition,
          teamPerformance,
          teamAnsweredCalls,
          teamAbandonedCalls,
          teamTotalCalls,
        },
        weeklyEvolution,
        assistedFeedback: finalPhoneFeedback,
      })

      setExportMessage(`Relatorio gerado: ${fileName}. Verifique a pasta Downloads.`)
    } catch (error) {
      setExportMessage(`Não foi possível gerar o arquivo. ${getErrorMessage(error)}`)
    }
  }

  return (
    <div className="mt-8 space-y-7">
      <section className="panel">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="section-title">Relatórios e IA analitica</h2>
            <p className="section-subtitle">
              Gere feedback MIMO ou SARE com base nos lançamentos do período, dados do pódio e observações da gestão.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {(['week', 'month', 'year', 'custom'] as PeriodMode[]).map((mode) => (
              <button
                key={mode}
                className={periodFilter.mode === mode ? 'tab-button-active' : 'tab-button'}
                type="button"
                onClick={() => handlePeriodModeChange(mode)}
              >
                {getPeriodModeLabel(mode)}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          {isManagementUser && (
            <Field label="Analista">
              <select
                className="form-input"
                value={selectedAnalystId}
                onChange={(event) => setSelectedAnalystId(event.target.value)}
              >
                {reportAnalysts.map((analyst) => (
                  <option key={analyst.id} value={analyst.id}>
                    {analyst.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Inicio">
            <input
              className="form-input"
              type="date"
              value={periodFilter.start}
              onChange={(event) =>
                setPeriodFilter({ ...periodFilter, mode: 'custom', start: event.target.value })
              }
            />
          </Field>
          <Field label="Fim">
            <input
              className="form-input"
              type="date"
              value={periodFilter.end}
              onChange={(event) =>
                setPeriodFilter({ ...periodFilter, mode: 'custom', end: event.target.value })
              }
            />
          </Field>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard label="Analista" value={selectedAnalyst?.name ?? 'Sem analista'} />
        <MetricCard label="CSAT do período" value={`${formatPercent(analystResult?.averageCsat ?? 0)}`} />
        <MetricCard label="Variação vs período anterior" value={formatDelta(csatDelta, '%')} />
        <MetricCard label="Performance equipe" value={formatPercent(teamPerformance)} />
      </div>

      <section className="panel no-print">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="eyebrow">Inteligência de gestão</p>
            <h2 className="section-title">Leitura do supervisor para o analista</h2>
            <p className="section-subtitle">
              Diagnóstico e ações sugeridas para apoiar acompanhamento individual antes do fechamento.
            </p>
          </div>
          <span className={`rounded-full px-4 py-2 text-sm font-semibold ${analystResult?.eligible ? 'bg-emerald-400/10 text-emerald-300' : 'bg-amber-400/10 text-amber-200'}`}>
            {supervisorCaseStatus}
          </span>
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-3">
          {supervisorContextCards.map((item) => (
            <div key={item.label} className="rounded-lg border border-cyan-400/20 bg-cyan-400/5 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">{item.label}</p>
              <p className="mt-2 text-lg font-bold">{item.value}</p>
              <p className="mt-2 text-sm leading-5 text-slate-300">{item.detail}</p>
            </div>
          ))}
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-4">
          {supervisorActionCards.map((item) => (
            <div key={item.label} className="rounded-lg bg-slate-900 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">{item.label}</p>
              <h3 className="mt-3 text-lg font-bold">{item.title}</h3>
              <p className="mt-3 text-sm leading-6 text-slate-300">{item.text}</p>
            </div>
          ))}
        </div>
      </section>



      <section className="panel no-print">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="section-title">Prontidão do relatório</h2>
            <p className="section-subtitle">
              Confira se o relatório deste período já tem base suficiente antes de exportar.
            </p>
          </div>
          <span className={`rounded-full px-4 py-2 text-sm font-semibold ${reportReady ? 'bg-emerald-400/10 text-emerald-300' : 'bg-amber-400/10 text-amber-200'}`}>
            {reportReady ? 'Pronto para exportar' : 'Pendente de dados'}
          </span>
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-3">
          {reportReadinessItems.map((item) => (
            <div key={item.label} className="rounded-lg bg-slate-900 p-4">
              <p className={item.done ? 'text-sm font-semibold text-emerald-300' : 'text-sm font-semibold text-amber-200'}>
                {item.done ? 'OK' : 'Pendente'} - {item.label}
              </p>
              <p className="mt-2 text-sm leading-5 text-slate-400">{item.detail}</p>
            </div>
          ))}
        </div>
      </section>
      <section className="panel print-report">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="hidden print:block text-sm font-bold uppercase tracking-[0.18em] text-cyan-300">
              Central de Performance
            </p>
            <h2 className="section-title">Relatório mensal {getChatFeedbackStyleLabel(phoneFeedbackStyle)}</h2>
            <p className="section-subtitle">
              {phoneFeedbackStyle === 'mimo'
                ? 'Estrutura MIMO: Momento observado, Impacto, Melhoria ou manutenção e Orientação.'
                : 'Estrutura SARE: Situação, Alinhamentos Realizados, Resultado Esperado e Expectativa.'}
            </p>
          </div>

          {selectedAnalyst && (
            <div className="hidden text-right print:block">
              <p className="text-sm text-slate-400">Analista</p>
              <p className="text-lg font-bold">{selectedAnalyst.name}</p>
              <p className="text-sm text-slate-400">{periodLabel}</p>
            </div>
          )}
        </div>

        <div className="no-print mt-5 grid gap-4">
          <Field label="Observações do gestor">
            <textarea
              className="form-input min-h-24"
              value={phoneManagerNotes}
              onChange={(event) => setPhoneManagerNotes(event.target.value)}
              placeholder="Inclua contexto do período, combinados, reconhecimento ou pontos de atenção para orientar a IA."
            />
          </Field>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Modelo do feedback">
              <select
                className="form-input"
                value={phoneFeedbackStyle}
                onChange={(event) => {
                  setPhoneFeedbackStyle(event.target.value as ChatFeedbackStyle)
                  setPhoneFeedbackDraft('')
                }}
              >
                <option value="mimo">MIMO</option>
                <option value="sare">SARE</option>
              </select>
            </Field>
            <Field label="Objetivo">
              <select className="form-input" value={phoneFeedbackGoal} onChange={(event) => setPhoneFeedbackGoal(event.target.value as FeedbackGoal)}>
                <option value="development">Desenvolver comportamento</option>
                <option value="courseCorrection">Corrigir rota</option>
                <option value="recognition">Reconhecer e manter</option>
                <option value="maintenance">Proteger padrão</option>
              </select>
            </Field>
          </div>

          <div className="grid gap-3 lg:grid-cols-[auto_auto_auto_1fr] lg:items-start">
            <button
              className="btn-secondary disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!selectedAnalyst || !analystResult}
              type="button"
              onClick={handleGeneratePhoneFeedbackDraft}
            >
              Gerar base factual
            </button>
            <button
              className="btn-primary disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!selectedAnalyst || !analystResult || phoneAiSaving}
              type="button"
              onClick={handleGeneratePhoneFeedbackWithAi}
            >
              {phoneAiSaving ? 'Gerando...' : 'Gerar texto assistido'}
            </button>
            <button
              className="btn-secondary disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!selectedAnalyst || !analystResult || phoneAiSaving || !phoneFeedbackDraft.trim()}
              type="button"
              onClick={handleImprovePhoneFeedbackWithAi}
            >
              Melhorar texto atual
            </button>
            <p className="text-sm text-slate-300">
              A base factual reúne os números sem criar uma redação pronta. A IA usa esses fatos, o objetivo e suas observações para escrever um feedback personalizado.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-slate-300">Texto final assistido</p>
            {phoneAiStatus === 'success' && <span className="rounded-full bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-300">Gerado pela IA</span>}
            {phoneAiStatus === 'fallback' && <span className="rounded-full bg-amber-400/10 px-3 py-1 text-xs font-semibold text-amber-200">IA não respondeu · base mantida</span>}
            {phoneAiStatus === 'error' && <span className="rounded-full bg-rose-400/10 px-3 py-1 text-xs font-semibold text-rose-300">Falha ao acessar a IA</span>}
          </div>
          <Field label="">
            <textarea
              className="form-input min-h-48"
              value={phoneFeedbackDraft}
              onChange={(event) => setPhoneFeedbackDraft(event.target.value)}
              placeholder="Gere a base factual, use a IA ou escreva aqui o texto final que irá para o relatório."
            />
          </Field>
        </div>

        <div className="no-print mt-4">
          <button
            className="primary-button disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!selectedAnalyst || !analystResult}
            type="button"
            onClick={handleExportWordReport}
          >
            Exportar relatório Word
          </button>
        </div>
        <div className="no-print">{exportMessage && <Feedback message={exportMessage} />}</div>

        {selectedAnalyst && analystResult ? (
          <div className="mt-6 space-y-5">
            <div className="grid gap-3 md:grid-cols-4">
              <div className="report-summary-card">
                <p>CSAT atual</p>
                <strong>{formatPercent(analystResult.averageCsat)}</strong>
              </div>
              <div className="report-summary-card">
                <p>Variação</p>
                <strong className={csatDelta >= 0 ? 'text-emerald-300' : 'text-rose-300'}>
                  {formatDelta(csatDelta, ' p.p.')}
                </strong>
              </div>
              <div className="report-summary-card">
                <p>Avaliações</p>
                <strong>{analystResult.totalReviews}</strong>
              </div>
              <div className="report-summary-card">
                <p>Podio</p>
                <strong>{selectedRankingPosition || '-'}</strong>
              </div>
            </div>

            {weeklyEvolution.length > 0 && (
              <div className="rounded-lg bg-slate-900 p-5">
                <h3 className="text-lg font-bold">Evolucao visual</h3>
                <p className="mt-1 text-sm text-slate-400">
                  Leitura rapida de melhora, queda ou estabilidade no período.
                </p>
                <div className="mt-4 space-y-3">
                  {weeklyEvolution.map((item, index) => {
                    const previous = weeklyEvolution[index - 1]
                    const delta = previous ? round(item.csat - previous.csat) : 0
                    const width = Math.max(8, Math.min(100, item.csat))
                    const barClass =
                      delta > 0 ? 'bg-emerald-400' : delta < 0 ? 'bg-rose-400' : 'bg-cyan-300'

                    return (
                      <div key={item.label} className="report-evolution-row">
                        <span>{item.label}</span>
                        <div className="report-evolution-track">
                          <div className={`report-evolution-bar ${barClass}`} style={{ width: `${width}%` }} />
                        </div>
                        <strong>
                          {formatPercent(item.csat)} <span>{formatDelta(delta, ' p.p.')}</span>
                        </strong>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            <div className="grid gap-4 lg:grid-cols-2">
              <ReportBlock
                title="S - Situação"
                text={situationText}
              />
              <ReportBlock
                title="A - Alinhamentos Realizados"
                text={actionText}
              />
              <ReportBlock
                title="R - Resultado Esperado"
                text={resultText}
              />
              <ReportBlock
                title="E - Expectativa e Plano de Desenvolvimento"
                text={evolutionText}
              />
            </div>
          </div>
        ) : (
          <EmptyState text="Selecione um analista e um período com lançamento individual para liberar a exportação." />
        )}
      </section>

      <section className="panel">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="section-title">Camadas de IA e plano de ação</h2>
            <p className="section-subtitle">
              Leitura automatica para apoiar feedback, acompanhamento e decisao da lideranca.
            </p>
          </div>
          <div className="rounded-lg bg-slate-900 px-4 py-3 text-sm text-slate-300">
            Periodo analisado: <strong>{periodLabel}</strong>
          </div>
        </div>

        <div className="mt-6 grid gap-4 xl:grid-cols-3">
          <div className="rounded-lg bg-slate-900 p-5">
            <p className="text-sm text-slate-400">IA Coach individual</p>
            <h3 className="mt-2 text-xl font-bold">{selectedAnalyst?.name ?? 'Analista'}</h3>
            <div className="mt-4 space-y-3 text-sm text-slate-300">
              <p>
                <span className="text-slate-500">Leitura: </span>
                {analystResult
                  ? analystResult.eligible
                    ? 'desempenho sustentando elegibilidade ao pódio no período.'
                    : `desempenho pede ajuste em ${analystResult.reasons.join(', ')}.`
                  : 'aguardando lançamentos no período.'}
              </p>
              <p>
                <span className="text-slate-500">Tendencia: </span>
                {getTrendText(csatDelta)}.
              </p>
              <p>
                <span className="text-slate-500">Foco recomendado: </span>
                {analystResult ? buildDevelopmentFocus(analystResult, csatDelta) : 'registrar dados para liberar leitura.'}
              </p>
            </div>
          </div>

          <div className="rounded-lg bg-slate-900 p-5">
            <p className="text-sm text-slate-400">IA Supervisor equipe</p>
            {isManagementUser ? (
              <div className="mt-4 space-y-3 text-sm text-slate-300">
                <p>
                  <span className="text-slate-500">Reconhecer: </span>
                  {strongestResult ? `${strongestResult.analystName}, com ${formatPercent(strongestResult.averageCsat)} de CSAT.` : 'aguardar dados do período.'}
                </p>
                <p>
                  <span className="text-slate-500">Acompanhar: </span>
                  {attentionResults.length ? attentionResults.map((item) => item.analystName).join(', ') : 'sem alertas críticos entre os lançamentos atuais.'}
                </p>
                <p>
                  <span className="text-slate-500">Evolucao: </span>
                  {bestGrowth ? `${bestGrowth.analystName} apresenta o melhor movimento comparativo (${formatDelta(bestGrowth.delta, ' p.p.')}).` : 'sem base comparativa suficiente.'}
                </p>
              </div>
            ) : (
              <p className="mt-4 text-sm text-slate-300">
                A visao completa de equipe e exclusiva da gestão. Você visualiza sua leitura individual e a performance geral compartilhada.
              </p>
            )}
          </div>

          <div className="rounded-lg bg-slate-900 p-5">
            <p className="text-sm text-slate-400">IA Executiva operação</p>
            <div className="mt-4 space-y-3 text-sm text-slate-300">
              <p>
                <span className="text-slate-500">Performance: </span>
                {formatPercent(teamPerformance)} no período, meta {teamPerformanceGoal}%.
              </p>
              <p>
                <span className="text-slate-500">Previsao: </span>
                {teamPerformance >= teamPerformanceGoal
                  ? 'fechamento tende a permanecer dentro da referência se o volume atual se mantiver.'
                  : 'ha risco de fechamento abaixo da referência se nao houver recuperação.'}
              </p>
              <p>
                <span className="text-slate-500">Risco: </span>
                {riskResults.length ? `${riskResults.length} analista(s) pedem acompanhamento no ciclo.` : 'nenhum risco individual evidente no período.'}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg bg-slate-900 p-5">
            <p className="text-sm text-slate-400">Roteiro sugerido para 1:1</p>
            <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-slate-300">
              <li>Comecar pela situação do período e confirmar se os numeros refletem a realidade operacional.</li>
              <li>Discutir o principal ponto de variação: CSAT, avaliações ou volume de atendimentos.</li>
              <li>Definir uma ação objetiva para a próxima semana, com comportamento observavel.</li>
              <li>Registrar a expectativa do próximo ciclo e revisar no fechamento seguinte.</li>
            </ol>
          </div>

          <div className="rounded-lg bg-slate-900 p-5">
            <p className="text-sm text-slate-400">{isManagementUser ? 'Fila de acompanhamento' : 'Meu próximo ciclo'}</p>
            {isManagementUser ? (
              riskResults.length ? (
                <div className="mt-4 space-y-3">
                  {riskResults.map((item) => (
                    <div key={item.analystId} className="rounded-md bg-slate-950 p-3">
                      <p className="font-semibold">{item.analystName}</p>
                      <p className="mt-1 text-sm text-slate-400">{formatStatusText(item.reasons.join(', '))}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-4 text-sm text-emerald-300">
                  Nenhum analista entrou em fila de acompanhamento neste período.
                </p>
              )
            ) : (
              <p className="mt-4 text-sm text-slate-300">
                Acompanhar sua evolução semanal, proteger o volume de avaliações e revisar atendimentos que possam impactar o CSAT.
              </p>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}

function ReportBlock({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-lg bg-slate-900 p-5">
      <h3 className="text-lg font-bold">{title}</h3>
      <p className="mt-3 text-sm leading-6 text-slate-300">{text}</p>
    </div>
  )
}

function SelectedImportFile({ file }: { file: File }) {
  return (
    <div className="mt-2 min-w-0 rounded-md border border-emerald-400/25 bg-emerald-400/10 px-3 py-2">
      <p className="truncate text-sm font-medium text-emerald-200" title={file.name}>
        ✓ {file.name}
      </p>
      <p className="mt-0.5 text-xs text-emerald-300/80">Selecionado · {formatFileSize(file.size)}</p>
    </div>
  )
}

function ImportFileSummary({
  label,
  name,
  size,
  rows,
}: {
  label: string
  name: string
  size: number
  rows: number
}) {
  return (
    <div className="min-w-0 rounded-lg bg-slate-950/70 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">{label}</p>
      <p className="mt-2 truncate font-medium text-slate-100" title={name}>{name}</p>
      <p className="mt-1 text-sm text-slate-400">{rows} linha(s) lida(s) · {formatFileSize(size)}</p>
    </div>
  )
}

function EntriesView({
  analysts,
  selectedAnalyst,
  podiumCsatGoal,
  individualMetrics,
  teamMetrics,
  individualForm,
  teamForm,
  saving,
  onIndividualChange,
  onTeamChange,
  onIndividualSubmit,
  onTeamSubmit,
  onDeleteIndividualMetric,
  onDeleteTeamMetric,
  onUpdateTeamOverallCsat,
}: {
  analysts: Analyst[]
  selectedAnalyst: Analyst | null
  podiumCsatGoal: number
  individualMetrics: IndividualMetric[]
  teamMetrics: TeamMetric[]
  individualForm: typeof initialIndividualForm
  teamForm: typeof initialTeamForm
  saving: boolean
  onIndividualChange: (form: typeof initialIndividualForm) => void
  onTeamChange: (form: typeof initialTeamForm) => void
  onIndividualSubmit: (event: React.FormEvent<HTMLFormElement>) => void
  onTeamSubmit: (event: React.FormEvent<HTMLFormElement>) => void
  onDeleteIndividualMetric: (metric: IndividualMetric) => void
  onDeleteTeamMetric: (metric: TeamMetric) => void
  onUpdateTeamOverallCsat: (metric: TeamMetric, overallCsat: number) => void
}) {
  const launchPeriods = useMemo(() => {
    const periods = new Map<string, { key: string; start: string; end: string }>()

    ;[...individualMetrics, ...teamMetrics].forEach((metric) => {
      const key = `${metric.week_start}|${metric.week_end}`
      periods.set(key, { key, start: metric.week_start, end: metric.week_end })
    })

    return [...periods.values()].sort((a, b) =>
      b.start.localeCompare(a.start) || b.end.localeCompare(a.end),
    )
  }, [individualMetrics, teamMetrics])
  const [selectedChecklistPeriod, setSelectedChecklistPeriod] = useState('')
  const checklistPeriod =
    launchPeriods.find((period) => period.key === selectedChecklistPeriod) ?? launchPeriods[0] ?? null
  const positiveReviews = toNumber(individualForm.positiveReviews)
  const negativeReviews = toNumber(individualForm.negativeReviews)
  const totalReviews = positiveReviews + negativeReviews
  const totalTickets = toNumber(individualForm.totalTickets)
  const reviewPercentage = totalTickets ? round((totalReviews / totalTickets) * 100) : 0
  const individualDateInvalid = isEndBeforeStart(individualForm.weekStart, individualForm.weekEnd)
  const individualDuplicate = individualMetrics.some(
    (metric) =>
      metric.analyst_id === individualForm.analystId &&
      metric.week_start === individualForm.weekStart &&
      metric.week_end === individualForm.weekEnd,
  )
  const individualReviewsInvalid = totalReviews > totalTickets && totalTickets > 0
  const answeredCalls = toNumber(teamForm.answeredCalls)
  const abandonedCalls = toNumber(teamForm.abandonedCalls)
  const totalCalls = toNumber(teamForm.totalCalls)
  const overallCsat = toNumber(teamForm.overallCsat)
  const calculatedPerformance = totalCalls ? round((answeredCalls / totalCalls) * 100) : 0
  const teamDateInvalid = isEndBeforeStart(teamForm.weekStart, teamForm.weekEnd)
  const teamDuplicate = teamMetrics.some(
    (metric) => metric.week_start === teamForm.weekStart && metric.week_end === teamForm.weekEnd,
  )
  const teamAnsweredInvalid = answeredCalls > totalCalls && totalCalls > 0
  const teamTotalMismatch =
    totalCalls > 0 && answeredCalls + abandonedCalls > 0 && answeredCalls + abandonedCalls !== totalCalls
  const checklistStart = checklistPeriod?.start ?? ''
  const checklistEnd = checklistPeriod?.end ?? ''
  const checklistIndividualMetrics =
    checklistStart && checklistEnd
      ? individualMetrics.filter((metric) => metric.week_start === checklistStart && metric.week_end === checklistEnd)
      : []
  const launchedAnalystIds = new Set(checklistIndividualMetrics.map((metric) => metric.analyst_id))
  const pendingAnalysts = analysts.filter((analyst) => !launchedAnalystIds.has(analyst.id))
  const checklistTeamMetric =
    checklistStart && checklistEnd
      ? teamMetrics.find((metric) => metric.week_start === checklistStart && metric.week_end === checklistEnd)
      : null
  const checklistComplete =
    Boolean(checklistStart && checklistEnd && checklistTeamMetric && pendingAnalysts.length === 0)
  const checklistDayCount = getInclusiveDayCount(checklistStart, checklistEnd)


  return (
    <div className="mt-8 space-y-6">
      <section className="panel">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="section-title">Fechamento semanal</h2>
            <p className="section-subtitle">
              Use este resumo para conferir se todos os lançamentos da semana foram feitos antes de fechar o período.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="block min-w-64 text-sm text-slate-300">
              Período para conferência
              <select
                className="input mt-2"
                value={checklistPeriod?.key ?? ''}
                onChange={(event) => setSelectedChecklistPeriod(event.target.value)}
                disabled={!launchPeriods.length}
              >
                {!launchPeriods.length && <option value="">Nenhum período lançado</option>}
                {launchPeriods.map((period) => (
                  <option key={period.key} value={period.key}>
                    {formatWeek(period.start, period.end)}
                  </option>
                ))}
              </select>
            </label>
            <div className={`rounded-lg px-4 py-3 text-sm font-semibold ${checklistComplete ? 'bg-emerald-400/10 text-emerald-200' : 'bg-amber-400/10 text-amber-100'}`}>
              {!checklistPeriod ? 'Sem lançamentos' : checklistComplete ? 'Semana completa' : 'Semana pendente'}
            </div>
          </div>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-4">
          <div className="rounded-lg bg-slate-900 p-4">
            <p className="text-sm text-slate-400">Periodo conferido</p>
            <p className="mt-2 font-semibold">
              {checklistStart && checklistEnd ? `${formatDate(checklistStart)} a ${formatDate(checklistEnd)}` : 'Nenhum período lançado'}
            </p>
            {checklistDayCount > 0 && checklistDayCount < 5 && (
              <p className="mt-1 text-xs text-cyan-200">
                Período parcial de {checklistDayCount} dia(s)
              </p>
            )}
          </div>
          <div className="rounded-lg bg-slate-900 p-4">
            <p className="text-sm text-slate-400">Analistas lancados</p>
            <p className="mt-2 text-2xl font-bold">{checklistIndividualMetrics.length}/{analysts.length}</p>
          </div>
          <div className="rounded-lg bg-slate-900 p-4">
            <p className="text-sm text-slate-400">Performance equipe</p>
            <p className={`mt-2 text-xl font-bold ${checklistTeamMetric ? 'text-emerald-300' : 'text-amber-200'}`}>
              {checklistTeamMetric ? 'Registrada' : 'Pendente'}
            </p>
          </div>
          <div className="rounded-lg bg-slate-900 p-4">
            <p className="text-sm text-slate-400">Proxima ação</p>
            <p className="mt-2 font-semibold">
              {!checklistStart || !checklistEnd
                ? 'Faça o primeiro lançamento da semana.'
                : pendingAnalysts.length
                  ? `Faltam ${pendingAnalysts.length} analista(s).`
                  : checklistTeamMetric
                    ? 'Conferir historico e evidencias.'
                    : 'Registrar performance da equipe.'}
            </p>
          </div>
        </div>

        {checklistStart && checklistEnd && (
          <div className="mt-5 rounded-lg bg-slate-900 p-4">
            <p className="text-sm text-slate-400">Pendencias por analista</p>
            {pendingAnalysts.length ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {pendingAnalysts.map((analyst) => (
                  <span key={analyst.id} className="rounded-full bg-amber-400/10 px-3 py-1 text-sm text-amber-100">
                    {analyst.name}
                  </span>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm text-emerald-300">Todos os analistas ativos ja possuem lançamento neste período.</p>
            )}
          </div>
        )}
      </section>


      <div className="grid gap-6 xl:grid-cols-2">
        <section className="panel">
        <h2 className="section-title">Lancamento individual</h2>
        <p className="section-subtitle">
          Registre resultado real, avaliações e atendimentos da semana anterior.
        </p>

        <form className="mt-5 grid gap-4" onSubmit={onIndividualSubmit}>
          <Field label="Analista">
            <select
              className="form-input"
              value={individualForm.analystId}
              onChange={(event) =>
                onIndividualChange({ ...individualForm, analystId: event.target.value })
              }
              required
            >
              {analysts.map((analyst) => (
                <option key={analyst.id} value={analyst.id}>
                  {analyst.name}
                </option>
              ))}
            </select>
          </Field>

          <div className="rounded-md bg-slate-900 p-3 text-sm text-slate-300">
            Meta individual: <strong>{selectedAnalyst?.csat_goal ?? 0}%</strong>
            <span className="mx-2 text-slate-600">|</span>
            Minimo para pódio: <strong>{podiumCsatGoal}%</strong>
          </div>

          {(individualDateInvalid || individualDuplicate || individualReviewsInvalid) && (
            <div className="rounded-md border border-amber-300/30 bg-amber-300/10 p-3 text-sm text-amber-100">
              {individualDateInvalid && <p>A data final nao pode ser menor que a data inicial.</p>}
              {individualDuplicate && <p>Já existe lançamento para este analista neste período.</p>}
              {individualReviewsInvalid && (
                <p>O total de avaliações nao pode ser maior que o total de atendimentos.</p>
              )}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Inicio da semana">
              <input
                className="form-input"
                type="date"
                value={individualForm.weekStart}
                onChange={(event) =>
                  onIndividualChange({ ...individualForm, weekStart: event.target.value })
                }
                required
              />
            </Field>
            <Field label="Fim da semana">
              <input
                className="form-input"
                type="date"
                value={individualForm.weekEnd}
                onChange={(event) =>
                  onIndividualChange({ ...individualForm, weekEnd: event.target.value })
                }
                required
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="CSAT realizado na semana (%)">
              <input
                className="form-input"
                min="0"
                max="100"
                step="0.01"
                type="number"
                value={individualForm.csat}
                onChange={(event) =>
                  onIndividualChange({ ...individualForm, csat: event.target.value })
                }
                required
              />
            </Field>
            <Field label="Total de atendimentos">
              <input
                className="form-input"
                min="0"
                type="number"
                value={individualForm.totalTickets}
                onChange={(event) =>
                  onIndividualChange({ ...individualForm, totalTickets: event.target.value })
                }
                required
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Avaliações positivas">
              <input
                className="form-input"
                min="0"
                type="number"
                value={individualForm.positiveReviews}
                onChange={(event) =>
                  onIndividualChange({ ...individualForm, positiveReviews: event.target.value })
                }
                required
              />
            </Field>
            <Field label="Avaliações negativas">
              <input
                className="form-input"
                min="0"
                type="number"
                value={individualForm.negativeReviews}
                onChange={(event) =>
                  onIndividualChange({ ...individualForm, negativeReviews: event.target.value })
                }
                required
              />
            </Field>
          </div>

          <Field label="Observações">
            <textarea
              className="form-input min-h-24"
              value={individualForm.notes}
              onChange={(event) =>
                onIndividualChange({ ...individualForm, notes: event.target.value })
              }
            />
          </Field>

          <Field label="Evidencia do 55PBX (print ou PDF)">
            <input
              accept="image/png,image/jpeg,image/webp,application/pdf"
              className="form-input"
              type="file"
              onChange={(event) =>
                onIndividualChange({
                  ...individualForm,
                  evidenceFile: event.target.files?.[0] ?? null,
                })
              }
            />
          </Field>

          <div className="rounded-md bg-slate-900 p-4 text-sm text-slate-300">
            <p>Total de avaliações: <strong>{totalReviews}</strong></p>
            <p>Percentual de avaliações: <strong>{formatPercent(reviewPercentage)}</strong></p>
            <p>
              CSAT informado: <strong>{formatPercent(toNumber(individualForm.csat))}</strong>
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <button className="primary-button" disabled={saving} type="submit">
              {saving ? 'Salvando...' : 'Salvar lançamento individual'}
            </button>
            <button
              className="secondary-button"
              disabled={saving}
              type="button"
              onClick={() =>
                onIndividualChange({ ...initialIndividualForm, analystId: analysts[0]?.id || '' })
              }
            >
              Limpar formulario
            </button>
          </div>
        </form>
        </section>

        <section className="panel">
        <h2 className="section-title">Performance da equipe</h2>
        <p className="section-subtitle">
          Formula atual: ligações atendidas / total processado x 100.
        </p>

        <form className="mt-5 grid gap-4" onSubmit={onTeamSubmit}>
          {(teamDateInvalid || teamDuplicate || teamAnsweredInvalid || teamTotalMismatch) && (
            <div className="rounded-md border border-amber-300/30 bg-amber-300/10 p-3 text-sm text-amber-100">
              {teamDateInvalid && <p>A data final nao pode ser menor que a data inicial.</p>}
              {teamDuplicate && <p>Já existe performance da equipe neste período.</p>}
              {teamAnsweredInvalid && (
                <p>Ligações atendidas nao pode ser maior que o total processado.</p>
              )}
              {teamTotalMismatch && (
                <p>Conferencia: atendidas + abandonadas esta diferente do total processado.</p>
              )}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Inicio da semana">
              <input
                className="form-input"
                type="date"
                value={teamForm.weekStart}
                onChange={(event) => onTeamChange({ ...teamForm, weekStart: event.target.value })}
                required
              />
            </Field>
            <Field label="Fim da semana">
              <input
                className="form-input"
                type="date"
                value={teamForm.weekEnd}
                onChange={(event) => onTeamChange({ ...teamForm, weekEnd: event.target.value })}
                required
              />
            </Field>
          </div>

          <Field label="Ligações atendidas">
            <input
              className="form-input"
              min="0"
              type="number"
              value={teamForm.answeredCalls}
              onChange={(event) => onTeamChange({ ...teamForm, answeredCalls: event.target.value })}
              required
            />
          </Field>
          <Field label="Ligações abandonadas">
            <input
              className="form-input"
              min="0"
              type="number"
              value={teamForm.abandonedCalls}
              onChange={(event) =>
                onTeamChange({ ...teamForm, abandonedCalls: event.target.value })
              }
              required
            />
          </Field>
          <Field label="Total processado">
            <input
              className="form-input"
              min="1"
              type="number"
              value={teamForm.totalCalls}
              onChange={(event) => onTeamChange({ ...teamForm, totalCalls: event.target.value })}
              required
            />
          </Field>

          <div className="rounded-lg border border-cyan-400/20 bg-cyan-400/5 p-4">
            <h3 className="font-semibold text-cyan-200">CSAT geral do telefone (N1 + N2)</h3>
            <p className="mt-1 text-sm leading-6 text-slate-300">
              Informe o percentual pronto exibido no 55PBX. Ele será usado apenas para comparar o N1 com o resultado geral; não altera o pódio dos analistas do N1.
            </p>
            <div className="mt-4 max-w-sm">
              <Field label="CSAT geral informado (%)">
                <input
                  className="form-input"
                  min="0"
                  max="100"
                  step="0.01"
                  type="number"
                  value={teamForm.overallCsat}
                  onChange={(event) => onTeamChange({ ...teamForm, overallCsat: event.target.value })}
                  required
                />
              </Field>
            </div>
            <p className="mt-3 text-sm text-slate-300">Valor informado: <strong className="text-cyan-200">{formatPercent(overallCsat)}</strong></p>
          </div>

          <Field label="Observações">
            <textarea
              className="form-input min-h-24"
              value={teamForm.notes}
              onChange={(event) => onTeamChange({ ...teamForm, notes: event.target.value })}
            />
          </Field>

          <Field label="Evidencia do 55PBX (print ou PDF)">
            <input
              accept="image/png,image/jpeg,image/webp,application/pdf"
              className="form-input"
              type="file"
              onChange={(event) =>
                onTeamChange({
                  ...teamForm,
                  evidenceFile: event.target.files?.[0] ?? null,
                })
              }
            />
          </Field>

          <div className="rounded-md bg-slate-900 p-4 text-sm text-slate-300">
            <p>Performance calculada: <strong>{formatPercent(calculatedPerformance)}</strong></p>
            <p>Atendidas + abandonadas: <strong>{answeredCalls + abandonedCalls}</strong></p>
            <p>Total processado: <strong>{totalCalls}</strong></p>
          </div>

          <div className="flex flex-wrap gap-3">
            <button className="primary-button" disabled={saving} type="submit">
              {saving ? 'Salvando...' : 'Salvar performance da equipe'}
            </button>
            <button
              className="secondary-button"
              disabled={saving}
              type="button"
              onClick={() => onTeamChange(initialTeamForm)}
            >
              Limpar formulario
            </button>
          </div>
        </form>
        </section>
      </div>

      <EntriesHistory
        individualMetrics={individualMetrics}
        teamMetrics={teamMetrics}
        saving={saving}
        onDeleteIndividualMetric={onDeleteIndividualMetric}
        onDeleteTeamMetric={onDeleteTeamMetric}
        onUpdateTeamOverallCsat={onUpdateTeamOverallCsat}
      />
    </div>
  )
}

function EntriesHistory({
  individualMetrics,
  teamMetrics,
  saving,
  onDeleteIndividualMetric,
  onDeleteTeamMetric,
  onUpdateTeamOverallCsat,
}: {
  individualMetrics: IndividualMetric[]
  teamMetrics: TeamMetric[]
  saving: boolean
  onDeleteIndividualMetric: (metric: IndividualMetric) => void
  onDeleteTeamMetric: (metric: TeamMetric) => void
  onUpdateTeamOverallCsat: (metric: TeamMetric, overallCsat: number) => void
}) {
  const [historyType, setHistoryType] = useState<'all' | 'individual' | 'team'>('all')
  const [historyAnalyst, setHistoryAnalyst] = useState('all')
  const [historyStart, setHistoryStart] = useState('')
  const [historyEnd, setHistoryEnd] = useState('')
  const [historyPage, setHistoryPage] = useState(0)
  const [expandedHistoryPeriod, setExpandedHistoryPeriod] = useState('')
  const analystOptions = getHistoryAnalystOptions(individualMetrics)
  const filteredIndividualMetrics = individualMetrics.filter((metric) => {
    const analystName = getAnalystName(metric.analysts)
    const matchesAnalyst = historyAnalyst === 'all' || analystName === historyAnalyst
    return matchesAnalyst && isMetricInsideHistoryFilter(metric.week_start, metric.week_end, historyStart, historyEnd)
  })
  const filteredTeamMetrics = teamMetrics.filter((metric) =>
    isMetricInsideHistoryFilter(metric.week_start, metric.week_end, historyStart, historyEnd),
  )
  const showIndividual = historyType === 'all' || historyType === 'individual'
  const showTeam = historyType === 'all' || historyType === 'team'
  const totalIndividualReviews = filteredIndividualMetrics.reduce(
    (sum, metric) => sum + Number(metric.total_reviews),
    0,
  )
  const totalIndividualTickets = filteredIndividualMetrics.reduce(
    (sum, metric) => sum + Number(metric.total_tickets),
    0,
  )
  const averageHistoryCsat = calculateAverageCsat(filteredIndividualMetrics)
  const averageTeamPerformance = calculateTeamPerformance(filteredTeamMetrics)
  const historyPeriods = useMemo(() => {
    const periods = new Map<
      string,
      { key: string; start: string; end: string; individual: IndividualMetric[]; team: TeamMetric | null }
    >()

    if (showIndividual) {
      filteredIndividualMetrics.forEach((metric) => {
        const key = `${metric.week_start}|${metric.week_end}`
        const period = periods.get(key) ?? {
          key,
          start: metric.week_start,
          end: metric.week_end,
          individual: [],
          team: null,
        }
        period.individual.push(metric)
        periods.set(key, period)
      })
    }

    if (showTeam) {
      filteredTeamMetrics.forEach((metric) => {
        const key = `${metric.week_start}|${metric.week_end}`
        const period = periods.get(key) ?? {
          key,
          start: metric.week_start,
          end: metric.week_end,
          individual: [],
          team: null,
        }
        period.team = metric
        periods.set(key, period)
      })
    }

    return [...periods.values()].sort((a, b) =>
      b.start.localeCompare(a.start) || b.end.localeCompare(a.end),
    )
  }, [filteredIndividualMetrics, filteredTeamMetrics, showIndividual, showTeam])
  const historyPageSize = 4
  const historyPageCount = Math.max(1, Math.ceil(historyPeriods.length / historyPageSize))
  const safeHistoryPage = Math.min(historyPage, historyPageCount - 1)
  const visibleHistoryPeriods = historyPeriods.slice(
    safeHistoryPage * historyPageSize,
    (safeHistoryPage + 1) * historyPageSize,
  )

  function resetHistoryPage() {
    setHistoryPage(0)
    setExpandedHistoryPeriod('')
  }

  function clearHistoryFilters() {
    setHistoryType('all')
    setHistoryAnalyst('all')
    setHistoryStart('')
    setHistoryEnd('')
    resetHistoryPage()
  }

  return (
    <section className="panel">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="section-title">Historico de lançamentos</h2>
          <p className="section-subtitle">
            Filtre registros por tipo, período e analista para revisar dados acumulados ou excluir lançamentos de teste.
          </p>
        </div>
        <button className="secondary-button self-start" type="button" onClick={clearHistoryFilters}>
          Limpar filtros
        </button>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-4">
        <Field label="Tipo de historico">
          <select
            className="form-input"
            value={historyType}
            onChange={(event) => {
              setHistoryType(event.target.value as 'all' | 'individual' | 'team')
              resetHistoryPage()
            }}
          >
            <option value="all">Todos</option>
            <option value="individual">Somente individuais</option>
            <option value="team">Somente equipe</option>
          </select>
        </Field>
        <Field label="Analista">
          <select
            className="form-input"
            disabled={historyType === 'team'}
            value={historyAnalyst}
            onChange={(event) => {
              setHistoryAnalyst(event.target.value)
              resetHistoryPage()
            }}
          >
            <option value="all">Todos</option>
            {analystOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Inicio">
          <input
            className="form-input"
            type="date"
            value={historyStart}
            onChange={(event) => {
              setHistoryStart(event.target.value)
              resetHistoryPage()
            }}
          />
        </Field>
        <Field label="Fim">
          <input
            className="form-input"
            type="date"
            value={historyEnd}
            onChange={(event) => {
              setHistoryEnd(event.target.value)
              resetHistoryPage()
            }}
          />
        </Field>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-4">
        <div className="rounded-lg bg-slate-900 p-4">
          <p className="text-sm text-slate-400">Registros individuais</p>
          <p className="mt-2 text-2xl font-bold">{filteredIndividualMetrics.length}</p>
        </div>
        <div className="rounded-lg bg-slate-900 p-4">
          <p className="text-sm text-slate-400">CSAT médio filtrado</p>
          <p className="mt-2 text-2xl font-bold tabular-nums">{formatPercent(averageHistoryCsat)}</p>
        </div>
        <div className="rounded-lg bg-slate-900 p-4">
          <p className="text-sm text-slate-400">Avaliações / atendimentos</p>
          <p className="mt-2 text-2xl font-bold">{totalIndividualReviews}/{totalIndividualTickets}</p>
        </div>
        <div className="rounded-lg bg-slate-900 p-4">
          <p className="text-sm text-slate-400">Performance equipe</p>
          <p className="mt-2 text-2xl font-bold tabular-nums">{formatPercent(averageTeamPerformance)}</p>
        </div>
      </div>

      <div className="mt-6 space-y-4">
        {visibleHistoryPeriods.map((period, index) => {
          const isExpanded = expandedHistoryPeriod
            ? expandedHistoryPeriod === period.key
            : index === 0
          const periodCsat = calculateAverageCsat(period.individual)

          return (
            <article key={period.key} className="overflow-hidden rounded-xl border border-white/10 bg-slate-900/60">
              <button
                className="flex w-full flex-col gap-3 p-5 text-left sm:flex-row sm:items-center sm:justify-between"
                type="button"
                aria-expanded={isExpanded}
                onClick={() => setExpandedHistoryPeriod(isExpanded ? '__none__' : period.key)}
              >
                <div>
                  <p className="font-semibold">{formatWeek(period.start, period.end)}</p>
                  <p className="mt-1 text-sm text-slate-400">
                    {period.individual.length} analista(s) · CSAT médio {formatPercent(periodCsat)} · Equipe {period.team ? 'registrada' : 'pendente'}
                  </p>
                  {getInclusiveDayCount(period.start, period.end) < 5 && (
                    <p className="mt-1 text-xs text-cyan-200">
                      Período parcial de {getInclusiveDayCount(period.start, period.end)} dia(s)
                    </p>
                  )}
                </div>
                <span className="text-sm font-semibold text-cyan-200">
                  {isExpanded ? 'Recolher detalhes' : 'Ver detalhes'}
                </span>
              </button>

              {isExpanded && (
                <div className="border-t border-white/10 p-5">
                  {showIndividual && (
                    <div>
                      <h3 className="font-semibold">Lancamentos individuais</h3>
                      <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="text-slate-400">
                  <tr>
                    <th className="pb-3 pr-4 font-medium">Analista</th>
                    <th className="pb-3 pr-4 font-medium">Semana</th>
                    <th className="pb-3 pr-4 font-medium">CSAT</th>
                    <th className="pb-3 pr-4 font-medium">Avaliações</th>
                    <th className="pb-3 pr-4 font-medium">Atendimentos</th>
                    <th className="pb-3 pr-4 font-medium">Evidencia</th>
                    <th className="pb-3 font-medium">Acao</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {period.individual.map((metric) => (
                    <tr key={metric.id}>
                      <td className="py-3 pr-4">{getAnalystName(metric.analysts)}</td>
                      <td className="py-3 pr-4">{formatWeek(metric.week_start, metric.week_end)}</td>
                      <td className="whitespace-nowrap py-3 pr-4 tabular-nums">{formatPercent(metric.csat)}</td>
                      <td className="py-3 pr-4">{metric.total_reviews}</td>
                      <td className="py-3 pr-4">{metric.total_tickets}</td>
                      <td className="py-3 pr-4">
                        <EvidenceLink url={metric.evidence_url} />
                      </td>
                      <td className="py-3">
                        <button
                          className="danger-button"
                          disabled={saving}
                          type="button"
                          onClick={() => onDeleteIndividualMetric(metric)}
                        >
                          Excluir
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {!period.individual.length && (
                <EmptyState text="Nenhum lançamento individual encontrado com estes filtros." />
              )}
                      </div>
                    </div>
                  )}

                  {showTeam && (
                    <div className={showIndividual ? 'mt-6' : ''}>
                      <h3 className="font-semibold">Performance da equipe</h3>
                      <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="text-slate-400">
                  <tr>
                    <th className="pb-3 pr-4 font-medium">Semana</th>
                    <th className="pb-3 pr-4 font-medium">Performance</th>
                    <th className="pb-3 pr-4 font-medium">Atendidas</th>
                    <th className="pb-3 pr-4 font-medium">Processadas</th>
                    <th className="pb-3 pr-4 font-medium">CSAT geral N1 + N2</th>
                    <th className="pb-3 pr-4 font-medium">Evidencia</th>
                    <th className="pb-3 font-medium">Acao</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {period.team && (
                    <tr key={period.team.id}>
                      <td className="py-3 pr-4">{formatWeek(period.team.week_start, period.team.week_end)}</td>
                      <td className="whitespace-nowrap py-3 pr-4 tabular-nums">{formatPercent(period.team.performance_percentage)}</td>
                      <td className="py-3 pr-4">{period.team.answered_calls}</td>
                      <td className="py-3 pr-4">{period.team.total_calls}</td>
                      <td className="min-w-52 py-3 pr-4">
                        <TeamOverallCsatEditor
                          metric={period.team}
                          saving={saving}
                          onSave={onUpdateTeamOverallCsat}
                        />
                      </td>
                      <td className="py-3 pr-4">
                        <EvidenceLink url={period.team.evidence_url} />
                      </td>
                      <td className="py-3">
                        <button
                          className="danger-button"
                          disabled={saving}
                          type="button"
                          onClick={() => onDeleteTeamMetric(period.team!)}
                        >
                          Excluir
                        </button>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>

              {!period.team && (
                <EmptyState text="Nenhuma performance de equipe encontrada com estes filtros." />
              )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </article>
          )
        })}

        {!historyPeriods.length && (
          <EmptyState text="Nenhum lançamento encontrado com estes filtros." />
        )}

        {historyPageCount > 1 && (
          <div className="flex flex-col gap-3 border-t border-white/10 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-slate-400">
              Página {safeHistoryPage + 1} de {historyPageCount} · {historyPeriods.length} período(s)
            </p>
            <div className="flex gap-2">
              <button
                className="secondary-button"
                type="button"
                disabled={safeHistoryPage === 0}
                onClick={() => {
                  setHistoryPage((page) => Math.max(0, page - 1))
                  setExpandedHistoryPeriod('')
                }}
              >
                Anterior
              </button>
              <button
                className="secondary-button"
                type="button"
                disabled={safeHistoryPage >= historyPageCount - 1}
                onClick={() => {
                  setHistoryPage((page) => Math.min(historyPageCount - 1, page + 1))
                  setExpandedHistoryPeriod('')
                }}
              >
                Próxima
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

function TeamOverallCsatEditor({
  metric,
  saving,
  onSave,
}: {
  metric: TeamMetric
  saving: boolean
  onSave: (metric: TeamMetric, overallCsat: number) => void
}) {
  const [value, setValue] = useState(metric.overall_csat == null ? '' : String(metric.overall_csat))

  useEffect(() => {
    setValue(metric.overall_csat == null ? '' : String(metric.overall_csat))
  }, [metric.overall_csat])

  return (
    <div className="flex items-center gap-2">
      <input
        aria-label={`CSAT geral da semana ${formatWeek(metric.week_start, metric.week_end)}`}
        className="form-input min-w-24 py-2"
        type="number"
        min="0"
        max="100"
        step="0.01"
        placeholder="0 a 100"
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <button
        className="secondary-button whitespace-nowrap"
        disabled={saving || value === ''}
        type="button"
        onClick={() => onSave(metric, Number(value))}
      >
        Salvar
      </button>
    </div>
  )
}
function getHistoryAnalystOptions(metrics: IndividualMetric[]) {
  const names = new Set<string>()
  metrics.forEach((metric) => names.add(getAnalystName(metric.analysts)))
  return [...names].sort((a, b) => a.localeCompare(b))
}

const DEFAULT_ANALYST_PHOTOS: Record<string, string> = {
  'bruno silva': '/team-photos/phone/bruno-silva.png',
  'gabriel vaz': '/team-photos/phone/gabriel-vaz.png',
  'henrique sergio': '/team-photos/phone/henrique-sergio.png',
  jesse: '/team-photos/phone/jesse.png',
  'karine cunha': '/team-photos/phone/karine-cunha.png',
  'mario diniz': '/team-photos/phone/mario-diniz.png',
  'sergio junior': '/team-photos/phone/sergio-junior.png',
  'thales silva': '/team-photos/phone/thales-silva.png',
  'ana claudia correa': '/team-photos/chat/ana-claudia-correa.png',
  'carlos lemos': '/team-photos/chat/carlos-lemos.png',
  'lorena almeida': '/team-photos/chat/lorena-almeida.png',
  'paulo victor': '/team-photos/chat/paulo-victor.png',
  'paulo victor leite': '/team-photos/chat/paulo-victor.png',
  'joao pedro vianey': '/team-photos/chat/joao-pedro-vianey.png',
  'joao vitor almeida': '/team-photos/chat/joao-vitor-almeida.png',
  'thiago reis': '/team-photos/chat/thiago-reis.png',
  'vanessa kateline': '/team-photos/chat/vanessa-kateline.png',
  'vanessa silva': '/team-photos/chat/vanessa-kateline.png',
}

function getAnalystPhoto(name: string, photoUrl?: string | null) {
  return photoUrl || DEFAULT_ANALYST_PHOTOS[normalizeText(name)] || null
}

function AnalystAvatar({ name, photoUrl, size = 'md' }: { name: string; photoUrl?: string | null; size?: 'sm' | 'md' | 'lg' }) {
  const resolvedPhoto = getAnalystPhoto(name, photoUrl)
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
  return (
    <span className={`analyst-avatar analyst-avatar-${size}`} title={name}>
      {resolvedPhoto ? <img alt={`Foto de ${name}`} src={resolvedPhoto} /> : <span>{initials || '?'}</span>}
    </span>
  )
}

function isMetricInsideHistoryFilter(
  weekStart: string,
  weekEnd: string,
  filterStart: string,
  filterEnd: string,
) {
  if (filterStart && weekEnd < filterStart) return false
  if (filterEnd && weekStart > filterEnd) return false
  return true
}
function AnalystsView({
  analysts,
  analystForm,
  editingAnalystId,
  saving,
  onAnalystChange,
  onAnalystSubmit,
  onCancelEdit,
  onEditAnalyst,
  onToggleAnalyst,
  onDeleteAnalyst,
  onRemoveAnalystPhoto,
}: {
  analysts: Analyst[]
  analystForm: typeof initialAnalystForm
  editingAnalystId: string | null
  saving: boolean
  onAnalystChange: (form: typeof initialAnalystForm) => void
  onAnalystSubmit: (event: React.FormEvent<HTMLFormElement>) => void
  onCancelEdit: () => void
  onEditAnalyst: (analyst: Analyst) => void
  onToggleAnalyst: (analyst: Analyst) => void
  onDeleteAnalyst: (analyst: Analyst) => void
  onRemoveAnalystPhoto: (analyst: Analyst) => void
}) {
  return (
    <div className="mt-8 grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
      <section className="panel">
        <h2 className="section-title">
          {editingAnalystId ? 'Editar analista' : 'Incluir analista'}
        </h2>
        <p className="section-subtitle">
          Defina o nome e a meta de CSAT individual conforme o perfil da empresa.
        </p>

        <form className="mt-5 grid gap-4" onSubmit={onAnalystSubmit}>
          <Field label="Nome do analista">
            <input
              className="form-input"
              value={analystForm.name}
              onChange={(event) =>
                onAnalystChange({ ...analystForm, name: event.target.value })
              }
              required
            />
          </Field>

          <Field label="Meta CSAT individual (%)">
            <input
              className="form-input"
              min="0"
              max="100"
              step="0.01"
              type="number"
              value={analystForm.csatGoal}
              onChange={(event) =>
                onAnalystChange({ ...analystForm, csatGoal: event.target.value })
              }
              required
            />
          </Field>

          <Field label={editingAnalystId ? 'Substituir foto' : 'Foto do analista'}>
            <input
              accept="image/png,image/jpeg,image/webp"
              className="form-input"
              type="file"
              onChange={(event) => onAnalystChange({ ...analystForm, photoFile: event.target.files?.[0] ?? null })}
            />
            <p className="mt-2 text-xs text-slate-400">PNG, JPG ou WEBP, com até 5 MB. A imagem será exibida em formato quadrado.</p>
          </Field>

          <div className="flex flex-wrap gap-3">
            <button className="primary-button" disabled={saving} type="submit">
              {saving ? 'Salvando...' : editingAnalystId ? 'Salvar alterações' : 'Incluir analista'}
            </button>

            {editingAnalystId && (
              <button className="secondary-button" type="button" onClick={onCancelEdit}>
                Cancelar
              </button>
            )}
          </div>
        </form>
      </section>

      <section className="panel">
        <h2 className="section-title">Analistas cadastrados</h2>
        <p className="section-subtitle">
          Inative para preservar histórico. Exclua apenas cadastros criados por engano.
        </p>

        <div className="mt-5 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-slate-400">
              <tr>
                <th className="pb-3 pr-4 font-medium">Analista</th>
                <th className="pb-3 pr-4 font-medium">Meta CSAT</th>
                <th className="pb-3 pr-4 font-medium">Status</th>
                <th className="pb-3 font-medium">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {analysts.map((analyst) => (
                <tr key={analyst.id}>
                  <td className="py-3 pr-4">
                    <div className="flex items-center gap-3">
                      <AnalystAvatar name={analyst.name} photoUrl={analyst.photo_url} size="sm" />
                      <span>{analyst.name}</span>
                    </div>
                  </td>
                  <td className="py-3 pr-4">{analyst.csat_goal}%</td>
                  <td className="py-3 pr-4">
                    <span className={analyst.active ? 'text-emerald-300' : 'text-slate-400'}>
                      {analyst.active ? 'Ativo' : 'Inativo'}
                    </span>
                  </td>
                  <td className="py-3">
                    <div className="flex flex-wrap gap-2">
                      <button
                        className="small-button"
                        type="button"
                        onClick={() => onEditAnalyst(analyst)}
                      >
                        Editar
                      </button>
                      <button
                        className="small-button"
                        type="button"
                        onClick={() => onToggleAnalyst(analyst)}
                      >
                        {analyst.active ? 'Inativar' : 'Reativar'}
                      </button>
                      <button
                        className="danger-button"
                        type="button"
                        onClick={() => onDeleteAnalyst(analyst)}
                      >
                        Excluir
                      </button>
                      {analyst.photo_url && (
                        <button className="small-button" type="button" onClick={() => onRemoveAnalystPhoto(analyst)}>
                          Remover foto
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {!analysts.length && <EmptyState text="Nenhum analista cadastrado." />}
        </div>
      </section>
    </div>
  )
}

function UsersView({
  profiles,
  analysts,
  chatAnalysts,
  form,
  editingProfileNameId,
  profileNameForm,
  saving,
  onChange,
  onProfileNameChange,
  onSubmit,
  onEditProfileName,
  onCancelProfileNameEdit,
  onSaveProfileName,
}: {
  profiles: UserProfile[]
  analysts: Analyst[]
  chatAnalysts: ChatAnalyst[]
  form: typeof initialAccessUserForm
  editingProfileNameId: string | null
  profileNameForm: string
  saving: boolean
  onChange: (form: typeof initialAccessUserForm) => void
  onProfileNameChange: (value: string) => void
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void
  onEditProfileName: (profile: UserProfile) => void
  onCancelProfileNameEdit: () => void
  onSaveProfileName: (profileId: string) => void
}) {
  const activeAnalysts = analysts.filter((analyst) => analyst.active)
  const activeChatAnalysts = chatAnalysts.filter((analyst) => analyst.active)

  return (
    <div className="mt-8 grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
      <section className="panel">
        <h2 className="section-title">Criar acesso ao sistema</h2>
        <p className="section-subtitle">
          Crie o login, defina o perfil e vincule o usuario ao analista quando for acesso individual.
        </p>

        <form className="mt-5 grid gap-4" onSubmit={onSubmit}>
          <Field label="Nome completo">
            <input
              className="form-input"
              value={form.fullName}
              onChange={(event) => onChange({ ...form, fullName: event.target.value })}
              required
            />
          </Field>

          <Field label="E-mail de acesso">
            <input
              className="form-input"
              type="email"
              value={form.email}
              onChange={(event) => onChange({ ...form, email: event.target.value })}
              required
            />
          </Field>

          <Field label="Senha temporaria">
            <input
              className="form-input"
              minLength={6}
              type="password"
              value={form.password}
              onChange={(event) => onChange({ ...form, password: event.target.value })}
              required
            />
          </Field>

          <Field label="Perfil">
            <select
              className="form-input"
              value={form.role}
              onChange={(event) =>
                onChange({
                  ...form,
                  role: event.target.value,
                  analystId: event.target.value === 'analista' ? form.analystId : '',
                  chatAnalystId:
                    event.target.value === 'analista' ? form.chatAnalystId : '',
                })
              }
            >
              <option value="analista">Analista</option>
              <option value="coordenadora">Coordenadora / Supervisao</option>
              <option value="master">Master</option>
            </select>
          </Field>

          {form.role === 'analista' && (
            <div className="grid gap-4">
              <Field label="Telefone · vincular analista">
                <select
                  className="form-input"
                  value={form.analystId}
                  onChange={(event) => onChange({ ...form, analystId: event.target.value })}
                >
                  <option value="">Sem acesso ao Telefone</option>
                  {activeAnalysts.map((analyst) => (
                    <option key={analyst.id} value={analyst.id}>
                      {analyst.name}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Chat · vincular analista">
                <select
                  className="form-input"
                  value={form.chatAnalystId}
                  onChange={(event) =>
                    onChange({ ...form, chatAnalystId: event.target.value })
                  }
                >
                  <option value="">Sem acesso ao Chat</option>
                  {activeChatAnalysts.map((analyst) => (
                    <option key={analyst.id} value={analyst.id}>
                      {analyst.name}
                    </option>
                  ))}
                </select>
              </Field>

              <p className="text-xs leading-5 text-slate-400">
                Para perfil Analista, vincule pelo menos um módulo. O mesmo login pode ter acesso individual ao Telefone, ao Chat ou aos dois.
              </p>
            </div>
          )}

          <button className="primary-button" disabled={saving} type="submit">
            {saving ? 'Criando...' : 'Criar usuario'}
          </button>
        </form>
      </section>

      <section className="panel">
        <h2 className="section-title">Usuarios vinculados</h2>
        <p className="section-subtitle">
          Estes registros controlam o que cada pessoa pode visualizar apos entrar no sistema.
        </p>

        <div className="mt-5 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-slate-400">
              <tr>
                <th className="pb-3 pr-4 font-medium">Nome</th>
                <th className="pb-3 pr-4 font-medium">Perfil</th>
                <th className="pb-3 pr-4 font-medium">Telefone</th>
                <th className="pb-3 pr-4 font-medium">Chat</th>
                <th className="pb-3 font-medium">Acoes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {profiles.map((profile) => {
                const analyst = analysts.find((item) => item.id === profile.analyst_id)
                const chatAnalyst = chatAnalysts.find(
                  (item) => item.id === profile.chat_analyst_id,
                )
                return (
                  <tr key={profile.id}>
                    <td className="py-3 pr-4">
                      {editingProfileNameId === profile.id ? (
                        <input
                          className="form-input min-w-52 py-2"
                          value={profileNameForm}
                          onChange={(event) => onProfileNameChange(event.target.value)}
                        />
                      ) : (
                        profile.full_name || profile.name || profile.id
                      )}
                    </td>
                    <td className="py-3 pr-4">{profile.role ?? '-'}</td>
                    <td className="py-3 pr-4">{analyst?.name ?? '-'}</td>
                    <td className="py-3 pr-4">{chatAnalyst?.name ?? '-'}</td>
                    <td className="py-3">
                      {editingProfileNameId === profile.id ? (
                        <div className="flex flex-wrap gap-2">
                          <button
                            className="small-button"
                            disabled={saving}
                            type="button"
                            onClick={() => onSaveProfileName(profile.id)}
                          >
                            Salvar
                          </button>
                          <button className="secondary-button" type="button" onClick={onCancelProfileNameEdit}>
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <button className="small-button" type="button" onClick={() => onEditProfileName(profile)}>
                          Editar nome
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {!profiles.length && <EmptyState text="Nenhum usuario vinculado encontrado." />}
        </div>
      </section>
    </div>
  )
}

function GoalsView({
  goals,
  goalForm,
  editingGoalId,
  saving,
  onGoalChange,
  onGoalSubmit,
  onEditGoal,
  onCancelEdit,
}: {
  goals: Goal[]
  goalForm: typeof initialGoalForm
  editingGoalId: string | null
  saving: boolean
  onGoalChange: (form: typeof initialGoalForm) => void
  onGoalSubmit: (event: React.FormEvent<HTMLFormElement>) => void
  onEditGoal: (goal: Goal) => void
  onCancelEdit: () => void
}) {
  return (
    <div className="mt-8 space-y-6">
      <section className="panel">
        <h2 className="section-title">Metas e impacto no sistema</h2>
        <p className="section-subtitle">
          Estes parametros alimentam dashboard, pódio, relatórios SARE e leituras preditivas. O CSAT individual continua no cadastro de cada analista.
        </p>

        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          <GoalImpactCard
            title="Podio mensal"
            text="Usa CSAT mínimo para pódio, percentual mínimo de avaliações e volume de atendimentos dentro da média da equipe."
          />
          <GoalImpactCard
            title="Performance da equipe"
            text="Define a referência operacional compartilhada por todos e usada nos alertas executivos."
          />
          <GoalImpactCard
            title="Relatórios e IA"
            text="As metas aparecem no SARE, nos planos de desenvolvimento e na inteligencia preditiva do dashboard."
          />
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
        <section className="panel">
          <h2 className="section-title">
            {editingGoalId ? 'Editar meta' : 'Selecione uma meta'}
          </h2>
          <p className="section-subtitle">
            Ajuste metas gerais da operação sem alterar codigo ou rodar query.
          </p>

          <form className="mt-5 grid gap-4" onSubmit={onGoalSubmit}>
            <Field label="Nome da meta">
              <input
                className="form-input"
                disabled={!editingGoalId}
                value={goalForm.label}
                onChange={(event) => onGoalChange({ ...goalForm, label: event.target.value })}
                required
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Valor">
                <input
                  className="form-input"
                  disabled={!editingGoalId}
                  min="0"
                  step="0.01"
                  type="number"
                  value={goalForm.value}
                  onChange={(event) => onGoalChange({ ...goalForm, value: event.target.value })}
                  required
                />
              </Field>

              <Field label="Unidade">
                <select
                  className="form-input"
                  disabled={!editingGoalId}
                  value={goalForm.unit}
                  onChange={(event) => onGoalChange({ ...goalForm, unit: event.target.value })}
                >
                  <option value="percent">Percentual</option>
                  <option value="number">Numero</option>
                </select>
              </Field>
            </div>

            <label className="flex items-center gap-3 text-sm text-slate-300">
              <input
                checked={goalForm.active}
                disabled={!editingGoalId}
                type="checkbox"
                onChange={(event) => onGoalChange({ ...goalForm, active: event.target.checked })}
              />
              Meta ativa
            </label>

            <div className="flex flex-wrap gap-3">
              <button className="primary-button" disabled={!editingGoalId || saving} type="submit">
                {saving ? 'Salvando...' : 'Salvar meta'}
              </button>

              {editingGoalId && (
                <button className="secondary-button" type="button" onClick={onCancelEdit}>
                  Cancelar
                </button>
              )}
            </div>
          </form>
        </section>

        <section className="panel">
          <h2 className="section-title">Metas configuradas</h2>
          <p className="section-subtitle">
            O CSAT individual fica no cadastro de cada analista; aqui ficam metas da operação.
          </p>

          <div className="mt-5 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-slate-400">
                <tr>
                  <th className="pb-3 pr-4 font-medium">Meta</th>
                  <th className="pb-3 pr-4 font-medium">Valor</th>
                  <th className="pb-3 pr-4 font-medium">Status</th>
                  <th className="pb-3 pr-4 font-medium">Impacto</th>
                  <th className="pb-3 font-medium">Acao</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {goals.map((goal) => (
                  <tr key={goal.id}>
                    <td className="py-3 pr-4">{goal.label}</td>
                    <td className="py-3 pr-4">
                      {goal.value}
                      {goal.unit === 'percent' ? '%' : ''}
                    </td>
                    <td className="py-3 pr-4">
                      <span className={goal.active ? 'text-emerald-300' : 'text-slate-400'}>
                        {goal.active ? 'Ativa' : 'Inativa'}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-slate-400">{getGoalImpactText(goal)}</td>
                    <td className="py-3">
                      <button className="small-button" type="button" onClick={() => onEditGoal(goal)}>
                        Editar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {!goals.length && <EmptyState text="Nenhuma meta cadastrada." />}
          </div>
        </section>
      </div>
    </div>
  )
}
function GoalImpactCard({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-lg bg-slate-900 p-5">
      <p className="text-sm text-slate-400">{title}</p>
      <p className="mt-2 text-sm leading-6 text-slate-300">{text}</p>
    </div>
  )
}

function getGoalImpactText(goal: Goal) {
  const key = goal.key.toLowerCase()
  const label = goal.label.toLowerCase()

  if (key.includes('podium') || label.includes('pódio') || label.includes('pódio')) {
    return 'Define elegibilidade para o pódio e relatórios SARE.'
  }

  if (key.includes('review') || label.includes('avalia')) {
    return 'Define o mínimo de avaliações esperado por atendimento.'
  }

  if (key.includes('performance') || key.includes('team') || label.includes('performance') || label.includes('desempenho')) {
    return 'Define a referência da performance operacional da equipe.'
  }

  return 'Parametro operacional usado nos calculos e leituras do painel.'
}
function MetricCard({
  label,
  value,
  tone,
}: {
  label: string
  value: string | number
  tone?: 'success' | 'warning' | 'danger'
}) {
  const toneClass =
    tone === 'success'
      ? 'border-emerald-400/30 bg-emerald-400/10'
      : tone === 'warning'
        ? 'border-amber-400/30 bg-amber-400/10'
        : tone === 'danger'
          ? 'border-rose-400/30 bg-rose-400/10'
          : 'border-white/10 bg-white/5'
  const valueClass =
    tone === 'success'
      ? 'text-emerald-300'
      : tone === 'warning'
        ? 'text-amber-200'
        : tone === 'danger'
          ? 'text-rose-200'
          : ''

  return (
    <div className={`metric-card border p-5 ${toneClass}`}>
      <p className="text-sm text-slate-400">{label}</p>
      <p className={`mt-2 text-xl font-semibold leading-tight tabular-nums sm:text-2xl ${valueClass}`}>
        {value}
      </p>
    </div>
  )
}

function AnalystIdentityCard({ analyst }: { analyst: Pick<Analyst, 'name' | 'photo_url'> | null }) {
  return (
    <div className="metric-card border border-cyan-400/25 bg-cyan-400/5 p-5">
      <p className="text-sm text-slate-400">Analista</p>
      <div className="mt-3 flex items-center gap-3">
        <AnalystAvatar name={analyst?.name ?? 'Analista'} photoUrl={analyst?.photo_url} size="md" />
        <p className="text-xl font-semibold leading-tight text-cyan-200 sm:text-2xl">{analyst?.name ?? 'Não vinculado'}</p>
      </div>
    </div>
  )
}

function CriteriaLegend({
  title,
  items,
  hidden = false,
}: {
  title: string
  items: string[]
  hidden?: boolean
}) {
  return (
    <div className={hidden ? 'hidden' : 'rounded-lg border border-cyan-400/20 bg-cyan-400/5 p-4'}>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">{title}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {items.map((item) => (
          <span key={item} className="rounded-md border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-slate-200">
            {item}
          </span>
        ))}
      </div>
    </div>
  )
}

function PredictiveCard({
  label,
  value,
  detail,
  tone,
}: {
  label: string
  value: string | number
  detail: string
  tone: 'success' | 'warning' | 'danger'
}) {
  const toneClass =
    tone === 'success'
      ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-200'
      : tone === 'warning'
        ? 'border-amber-400/40 bg-amber-400/10 text-amber-200'
        : 'border-rose-400/40 bg-rose-400/10 text-rose-200'

  return (
    <div className={`rounded-lg border p-5 ${toneClass}`}>
      <p className="text-sm text-slate-300">{label}</p>
      <p className="mt-2 text-2xl font-bold">{value}</p>
      <p className="mt-3 text-sm leading-5 text-slate-300">{detail}</p>
    </div>
  )
}

function EligibilityFunnel({
  title,
  subtitle,
  items,
}: {
  title: string
  subtitle: string
  items: Array<{ label: string; value: number; detail: string; tone?: 'success' | 'warning' | 'danger' }>
}) {
  const base = Math.max(items[0]?.value ?? 0, 1)

  return (
    <div className="rounded-lg bg-slate-900 p-5">
      <h3 className="text-xl font-bold">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-slate-400">{subtitle}</p>
      <div className="mt-5 space-y-3">
        {items.map((item, index) => {
          const width = Math.max(6, Math.min(100, (item.value / base) * 100))
          const color =
            item.tone === 'success'
              ? 'bg-emerald-300'
              : item.tone === 'danger'
                ? 'bg-rose-300'
                : index === 0
                  ? 'bg-cyan-300'
                  : 'bg-amber-300'

          return (
            <div key={item.label} className="rounded-md bg-slate-950/60 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{item.label}</p>
                  <p className="mt-1 text-xs leading-5 text-slate-400">{item.detail}</p>
                </div>
                <strong className="text-lg">{item.value}</strong>
              </div>
              <div className="mt-3 h-3 overflow-hidden rounded-full bg-slate-800">
                <div className={`h-3 rounded-full ${color}`} style={{ width: `${width}%` }} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TrendLineChart({
  label,
  points,
  suffix = '',
  goal,
  goalLabel = 'Meta',
  singlePointLabel = 'Apenas um fechamento disponível neste período.',
  latestPointLabel = 'Última semana',
  highlightedPointLabel = 'Semana destacada',
}: {
  label: string
  points: ChartPoint[]
  suffix?: string
  goal?: number
  goalLabel?: string
  singlePointLabel?: string
  latestPointLabel?: string
  highlightedPointLabel?: string
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const comparisonValues = goal === undefined ? [] : [goal]
  const path = buildLinePath(points, comparisonValues)
  const first = points.at(0)?.value ?? 0
  const latest = points.at(-1)?.value ?? 0
  const delta = round(latest - first)
  const hasComparison = points.length > 1
  const highlightedPoint = activeIndex === null ? points.at(-1) : points[activeIndex]

  return (
    <div className="rounded-lg bg-slate-900 p-5 transition-colors hover:bg-slate-900/90">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-slate-400">{label}</p>
          <p className="mt-1 text-2xl font-semibold">
            {formatValueWithSuffix(latest, suffix)}
          </p>
          <p className="mt-2 text-xs leading-5 text-slate-400">
            {hasComparison
              ? `De ${first}${suffix} para ${latest}${suffix} · ${delta > 0 ? '+' : ''}${delta}${suffix === '%' ? ' p.p.' : ''}`
              : singlePointLabel}
          </p>
        </div>
        {highlightedPoint && (
          <div className="rounded-md border border-cyan-300/20 bg-cyan-300/5 px-3 py-2 text-right">
            <p className="text-xs text-slate-400">{activeIndex === null ? latestPointLabel : highlightedPointLabel}</p>
            <p className="mt-1 text-sm font-semibold text-cyan-200">
              {highlightedPoint.label}: {formatValueWithSuffix(highlightedPoint.value, suffix)}
            </p>
          </div>
        )}
        {goal !== undefined && (
          <div className="rounded-md border border-amber-300/20 bg-amber-300/5 px-3 py-2 text-right">
            <p className="text-xs text-slate-400">{goalLabel}</p>
            <p className="mt-1 text-sm font-semibold text-amber-200">{formatValueWithSuffix(goal, suffix)}</p>
          </div>
        )}
      </div>

      {points.length ? (
        <svg
          className="mt-4 h-44 w-full"
          role="img"
          viewBox="0 0 320 130"
          onMouseLeave={() => setActiveIndex(null)}
        >
          <title>{label}</title>
          <path d="M20 110 H310" stroke="rgb(51 65 85)" strokeWidth="1" />
          <path d="M20 15 V110" stroke="rgb(51 65 85)" strokeWidth="1" />
          {goal !== undefined && (
            <>
              <path
                d={`M20 ${getPointPosition(goal, 0, points, comparisonValues).y} H310`}
                stroke="rgb(252 211 77)"
                strokeDasharray="6 5"
                strokeWidth="1.5"
              />
              <text
                fill="rgb(253 230 138)"
                fontSize="9"
                textAnchor="end"
                x="308"
                y={Math.max(getPointPosition(goal, 0, points, comparisonValues).y - 5, 10)}
              >
                Meta {goal}{suffix}
              </text>
            </>
          )}
          <path d={path} fill="none" stroke="rgb(103 232 249)" strokeWidth="3" />
          {points.map((point, index) => {
            const { x, y } = getPointPosition(point.value, index, points, comparisonValues)
            return (
              <g
                key={`${point.label}-${index}`}
                className="cursor-pointer"
                onMouseEnter={() => setActiveIndex(index)}
              >
                <title>{`${point.label}: ${point.value}${suffix}`}</title>
                <circle cx={x} cy={y} fill="transparent" r="14" />
                <circle
                  cx={x}
                  cy={y}
                  fill="rgb(103 232 249)"
                  r={activeIndex === index ? 7 : 4}
                  stroke={activeIndex === index ? 'rgb(255 255 255)' : 'transparent'}
                  strokeWidth="2"
                />
                <text fill="rgb(226 232 240)" fontSize="10" fontWeight="600" textAnchor="middle" x={x} y={Math.max(y - 9, 10)}>
                  {formatValueWithSuffix(point.value, suffix)}
                </text>
                <text fill="rgb(203 213 225)" fontSize="10" textAnchor="middle" x={x} y="126">
                  {point.label}
                </text>
              </g>
            )
          })}
        </svg>
      ) : (
        <EmptyState text="Sem dados suficientes para o grafico." />
      )}
    </div>
  )
}

function BarTrend({
  label,
  points,
}: {
  label: string
  points: ChartPoint[]
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const maxValue = Math.max(...points.map((point) => point.value), 1)

  return (
    <div className="rounded-lg bg-slate-900 p-5 transition-colors hover:bg-slate-900/90">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-slate-400">{label}</p>
        {points.length > 0 && (
          <p className="text-xs text-cyan-200">
            {activeIndex === null ? 'Passe o mouse para destacar' : `${points[activeIndex].label}: ${formatChatCount(points[activeIndex].value)}`}
          </p>
        )}
      </div>
      <div className="mt-4 space-y-3">
        {points.map((point, index) => (
          <div
            key={point.label}
            className={`grid grid-cols-[72px_1fr_42px] items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors ${activeIndex === index ? 'bg-cyan-300/10' : ''}`}
            title={`${point.label}: ${formatChatCount(point.value)}`}
            onMouseEnter={() => setActiveIndex(index)}
            onMouseLeave={() => setActiveIndex(null)}
          >
            <span className="text-slate-400">{point.label}</span>
            <div className="h-3 rounded-full bg-slate-800">
              <div
                className={`h-3 rounded-full transition-all ${activeIndex === index ? 'bg-white' : 'bg-cyan-300'}`}
                style={{ width: `${Math.max((point.value / maxValue) * 100, 4)}%` }}
              />
            </div>
            <strong className="text-right tabular-nums">{formatChatCount(point.value)}</strong>
          </div>
        ))}
        {!points.length && <EmptyState text="Sem dados suficientes para o grafico." />}
      </div>
    </div>
  )
}

function GroupedPercentTrendChart({
  points,
  series,
}: {
  points: Array<{ label: string; csat: number; reviews: number; sending: number }>
  series: Array<{ key: 'csat' | 'reviews' | 'sending'; label: string; color: string }>
}) {
  return (
    <div className="rounded-lg bg-slate-900 p-4">
      <div className="flex flex-wrap gap-3 text-xs text-slate-300">
        {series.map((item) => (
          <span key={item.key} className="inline-flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${item.color}`} />
            {item.label}
          </span>
        ))}
      </div>

      <div className="mt-5 space-y-4">
        {points.map((point) => (
          <div key={point.label} className="grid gap-2 md:grid-cols-[90px_1fr] md:items-center">
            <span className="text-sm font-semibold text-slate-300">{point.label}</span>
            <div className="grid gap-2">
              {series.map((item) => (
                <div key={item.key} className="grid grid-cols-[1fr_48px] items-center gap-3">
                  <div className="h-3 rounded-full bg-slate-800">
                    <div className={`h-3 rounded-full ${item.color}`} style={{ width: `${Math.max(point[item.key], 3)}%` }} />
                  </div>
                  <strong className="text-right text-xs">{formatPercent(point[item.key])}</strong>
                </div>
              ))}
            </div>
          </div>
        ))}
        {!points.length && <EmptyState text="Sem dados suficientes para o grafico." />}
      </div>
    </div>
  )
}

function ComparisonBars({
  title,
  subtitle,
  rows,
  primaryGoal,
  secondaryGoal,
  volumeReference,
}: {
  title: string
  subtitle: string
  rows: Array<{ label: string; primary: number; secondary: number; volume: number; status?: string }>
  primaryGoal: number
  secondaryGoal: number
  volumeReference?: number
}) {
  const maxVolume = Math.max(...rows.map((row) => row.volume), volumeReference ?? 0, 1)

  return (
    <div className="rounded-lg bg-slate-900 p-5">
      <h3 className="text-xl font-bold">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-slate-400">{subtitle}</p>
      <div className="mt-5 space-y-4">
        {rows.map((row) => (
          <div key={row.label} className="rounded-md bg-slate-950/60 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold">{row.label}</p>
              <span className="text-xs text-slate-400">{row.status}</span>
            </div>
            <div className="mt-3 grid gap-2">
              <ProgressMetric label="CSAT" value={row.primary} goal={primaryGoal} suffix="%" tone="cyan" />
              <ProgressMetric label="Avaliações" value={row.secondary} goal={secondaryGoal} suffix="%" tone="emerald" />
              <ProgressMetric label="Volume" value={row.volume} goal={volumeReference} max={maxVolume} tone="amber" />
            </div>
          </div>
        ))}
        {!rows.length && <EmptyState text="Sem dados suficientes para o grafico." />}
      </div>
    </div>
  )
}

function ProgressMetric({
  label,
  value,
  goal,
  max = 100,
  suffix = '',
  tone,
}: {
  label: string
  value: number
  goal?: number
  max?: number
  suffix?: string
  tone: 'cyan' | 'emerald' | 'amber'
}) {
  const color = tone === 'cyan' ? 'bg-cyan-300' : tone === 'emerald' ? 'bg-emerald-300' : 'bg-amber-300'
  const percent = Math.min((value / Math.max(max, 1)) * 100, 100)

  return (
    <div className="grid grid-cols-[88px_1fr_84px] items-center gap-3 text-xs">
      <span className="text-slate-400">{label}</span>
      <div className="relative h-3 rounded-full bg-slate-800">
        <div className={`h-3 rounded-full ${color}`} style={{ width: `${Math.max(percent, value > 0 ? 4 : 0)}%` }} />
        {goal !== undefined && max === 100 && (
          <span className="absolute top-[-3px] h-5 w-px bg-white/60" style={{ left: `${Math.min(goal, 100)}%` }} />
        )}
      </div>
      <strong className="text-right">
        {formatValueWithSuffix(value, suffix)}
      </strong>
    </div>
  )
}

function VolumeQualityMap({
  title,
  subtitle,
  points,
  xReference,
  yReference,
}: {
  title: string
  subtitle: string
  points: Array<{ label: string; x: number; y: number; tone: string; detail?: string }>
  xReference?: number
  yReference: number
}) {
  const maxX = Math.max(...points.map((point) => point.x), xReference ?? 0, 1)
  const minY = Math.min(...points.map((point) => point.y), yReference, 80)
  const maxY = Math.max(...points.map((point) => point.y), yReference, 100)
  const yRange = Math.max(maxY - minY, 1)

  return (
    <div className="rounded-lg bg-slate-900 p-5">
      <h3 className="text-xl font-bold">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-slate-400">{subtitle}</p>
      <div className="relative mt-5 h-80 overflow-hidden rounded-lg border border-white/10 bg-slate-950/60 p-4">
        <div className="absolute inset-x-4 bottom-10 border-t border-white/10" />
        <div className="absolute bottom-4 left-4 top-4 border-l border-white/10" />
        {xReference !== undefined && (
          <div className="absolute bottom-10 top-4 border-l border-cyan-300/30" style={{ left: `${Math.max(12, Math.min(92, (xReference / maxX) * 86 + 4))}%` }} />
        )}
        <div className="absolute left-4 right-4 border-t border-emerald-300/30" style={{ bottom: `${Math.max(12, Math.min(88, ((yReference - minY) / yRange) * 76 + 10))}%` }} />
        {points.map((point) => {
          const left = Math.max(8, Math.min(92, (point.x / maxX) * 86 + 6))
          const bottom = Math.max(12, Math.min(88, ((point.y - minY) / yRange) * 76 + 10))
          const color = point.tone === 'success' ? 'bg-emerald-300' : point.tone === 'danger' ? 'bg-rose-300' : 'bg-amber-300'

          return (
            <div key={point.label} className="group absolute -translate-x-1/2 translate-y-1/2" style={{ left: `${left}%`, bottom: `${bottom}%` }}>
              <span className={`block h-3.5 w-3.5 rounded-full shadow-lg ring-4 ring-slate-900 ${color}`} />
              <div className="pointer-events-none absolute left-4 top-[-14px] z-10 hidden min-w-44 rounded-md bg-slate-800 px-3 py-2 text-xs text-slate-100 shadow-xl group-hover:block">
                <strong>{point.label}</strong>
                <p>CSAT {formatPercent(point.y)} | Volume {formatChatCount(point.x)}</p>
                {point.detail && <p>{point.detail}</p>}
              </div>
            </div>
          )
        })}
        <span className="absolute bottom-3 right-4 text-xs text-slate-500">Volume</span>
        <span className="absolute left-5 top-3 text-xs text-slate-500">CSAT</span>
        {!points.length && <EmptyState text="Sem dados suficientes para o mapa." />}
      </div>
    </div>
  )
}

function TabButton({
  active,
  children,
  onClick,
}: {
  active: boolean
  children: React.ReactNode
  onClick: () => void
}) {
  return (
    <button className={active ? 'tab-button-active' : 'tab-button'} onClick={onClick}>
      {children}
    </button>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-2 text-sm text-slate-300">
      {label}
      {children}
    </label>
  )
}

function Feedback({ message }: { message: string }) {
  return <p className="mt-5 rounded-md bg-slate-900 p-3 text-sm text-slate-300">{message}</p>
}

function EvidenceLink({ url }: { url: string | null }) {
  if (!url) return <span className="text-slate-500">Sem arquivo</span>

  return (
    <a className="text-cyan-300 hover:text-cyan-200" href={url} rel="noreferrer" target="_blank">
      Abrir
    </a>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="mt-4 rounded-lg border border-amber-400/20 bg-amber-400/10 p-4">
      <p className="text-sm font-semibold text-amber-100">Sem dados para este recorte</p>
      <p className="mt-1 text-sm leading-6 text-slate-300">{text}</p>
    </div>
  )
}

function formatWeek(start: string, end: string) {
  return `${formatDate(start)} a ${formatDate(end)}`
}

function getAnalystName(analyst: IndividualMetric['analysts']) {
  if (Array.isArray(analyst)) return analyst[0]?.name ?? 'Analista'
  return analyst?.name ?? 'Analista'
}

function normalizeUserRole(role: string | null | undefined): UserRole {
  const normalized = (role ?? '').toLowerCase()

  if (normalized.includes('master')) return 'master'
  if (normalized.includes('coord')) return 'coordinator'
  if (normalized.includes('analista') || normalized.includes('analyst')) return 'analyst'
  return 'analyst'
}

function getRoleLabel(role: UserRole) {
  const labels: Record<UserRole, string> = {
    master: 'Master',
    coordinator: 'Coordenadora',
    analyst: 'Analista',
  }

  return labels[role]
}

function findProfileAnalyst(profile: UserProfile | null, analysts: Analyst[], email: string) {
  if (!profile) return null

  if (profile.analyst_id) {
    const byId = analysts.find((analyst) => analyst.id === profile.analyst_id)
    if (byId) return byId
  }

  const profileName = normalizeText(profile.full_name || profile.name || '')
  const byName = analysts.find((analyst) => normalizeText(analyst.name) === profileName)

  if (byName) return byName

  const emailName = normalizeText(email.split('@')[0]?.replace(/[._-]+/g, ' ') ?? '')
  return analysts.find((analyst) => emailName.includes(normalizeText(analyst.name))) ?? null
}

function getProfileAnalystId(profile: UserProfile | null, analysts: Analyst[], email: string) {
  if (profile?.analyst_id) return profile.analyst_id

  return findProfileAnalyst(profile, analysts, email)?.id ?? null
}

function createProfileAnalystFallback(
  profile: UserProfile | null,
  analystId: string | null,
  email: string,
): Analyst | null {
  if (!profile || !analystId) return null

  return {
    id: analystId,
    name: profile.full_name || profile.name || email.split('@')[0] || 'Analista',
    active: true,
    csat_goal: 0,
  }
}

function buildAnalystsFromMetrics(metrics: IndividualMetric[]): Analyst[] {
  const grouped = new Map<string, Analyst>()

  metrics.forEach((metric) => {
    if (grouped.has(metric.analyst_id)) return

    grouped.set(metric.analyst_id, {
      id: metric.analyst_id,
      name: getMetricAnalystName(metric) || 'Analista',
      active: true,
      csat_goal: 86,
    })
  })

  return [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name))
}

function getMetricAnalystName(metric: IndividualMetric) {
  if (Array.isArray(metric.analysts)) return metric.analysts[0]?.name ?? ''

  return metric.analysts?.name ?? ''
}

function normalizeText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function formatDate(value: string) {
  if (!value) return '-'
  const [year, month, day] = value.split('-')
  return `${day}/${month}/${year}`
}

function formatDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'

  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date)
}

function formatFileSize(bytes: number) {
  if (!bytes) return '0 KB'
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`
}

function formatShortDate(value: string) {
  if (!value) return '-'
  const [, month, day] = value.split('-')
  return `${day}/${month}`
}

async function buildEmbeddedReportPhoto(photoUrl?: string | null) {
  if (!photoUrl) return ''

  const resolvedPhotoUrl = new URL(photoUrl, window.location.origin).href
  const response = await fetch(resolvedPhotoUrl, { cache: 'no-store' })
  if (!response.ok) {
    throw new Error('A foto cadastrada não pôde ser carregada. Atualize a foto do analista e tente novamente.')
  }

  const sourceBlob = await response.blob()
  const objectUrl = URL.createObjectURL(sourceBlob)

  try {
    const image = new Image()
    image.src = objectUrl
    await image.decode()

    const canvas = document.createElement('canvas')
    const size = 256
    const borderWidth = 7
    canvas.width = size
    canvas.height = size
    const context = canvas.getContext('2d')
    if (!context) throw new Error('O navegador não conseguiu preparar a foto para o relatório.')

    const sourceSize = Math.min(image.naturalWidth, image.naturalHeight)
    const sourceX = (image.naturalWidth - sourceSize) / 2
    const sourceY = (image.naturalHeight - sourceSize) / 2

    context.clearRect(0, 0, size, size)
    context.save()
    context.beginPath()
    context.arc(size / 2, size / 2, size / 2 - borderWidth, 0, Math.PI * 2)
    context.clip()
    context.drawImage(image, sourceX, sourceY, sourceSize, sourceSize, borderWidth, borderWidth, size - borderWidth * 2, size - borderWidth * 2)
    context.restore()
    context.strokeStyle = '#0891b2'
    context.lineWidth = borderWidth
    context.beginPath()
    context.arc(size / 2, size / 2, size / 2 - borderWidth / 2, 0, Math.PI * 2)
    context.stroke()

    return canvas.toDataURL('image/png')
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

async function exportChatIndividualReport({
  metric,
  periodLabel,
  averageTickets,
  podiumPosition,
  monthlyHistory,
  managerNotes,
  feedbackText,
  qualitativeContext,
  dataSourceLabel,
  photoUrl,
}: {
  metric: ChatMonthlyMetric
  periodLabel: string
  averageTickets: number
  podiumPosition: number
  monthlyHistory: ChatMonthlyMetric[]
  managerNotes: string
  feedbackText: string
  qualitativeContext?: ChatQualitativeFeedbackContext
  dataSourceLabel: string
  photoUrl?: string | null
}) {
  const analystName = getChatAnalystName(metric)
  const safeName = escapeHtml(analystName)
  const embeddedPhotoUrl = await buildEmbeddedReportPhoto(photoUrl)
  const photoHtml = embeddedPhotoUrl
    ? `<img class="profile-photo" src="${embeddedPhotoUrl}" alt="Foto de ${safeName}" width="76" height="76" style="width:76px;height:76px;max-width:76px;max-height:76px;display:block;" />`
    : ''
  const csatGoal = Number(metric.csat_goal) || 90
  const reviewGoal = Number(metric.general_review_goal) || 25
  const csatGap = round(Number(metric.csat) - csatGoal)
  const reviewGap = round(Number(metric.review_percentage) - reviewGoal)
  const podiumText =
    podiumPosition > 0
      ? `${podiumPosition}º lugar no pódio`
      : 'Fora do pódio nesta competência'
  const status =
    metric.status ||
    (Number(metric.csat) >= csatGoal && Number(metric.review_percentage) >= reviewGoal
      ? 'Meta Superada'
      : 'Em acompanhamento')
  const statusColor =
    status === 'Meta Superada'
      ? '#059669'
      : status === 'Critico'
        ? '#dc2626'
        : '#d97706'
  const csatText =
    csatGap >= 0
      ? `${formatDelta(csatGap, ' p.p.')} acima da meta individual de ${csatGoal}%.`
      : `${formatDelta(Math.abs(csatGap), ' p.p.').replace('+', '')} abaixo da meta individual de ${csatGoal}%.`
  const reviewText =
    reviewGap >= 0
      ? `${formatDelta(reviewGap, ' p.p.')} acima da referência de ${reviewGoal}%.`
      : `${formatDelta(Math.abs(reviewGap), ' p.p.').replace('+', '')} abaixo da referência de ${reviewGoal}%.`
  const finalFeedback =
    feedbackText.trim() ||
    buildChatFeedbackText({ metric, averageTickets, podiumPosition, managerNotes })
  const managerNotesHtml = managerNotes.trim()
    ? `<section class="section-block">
        <div class="section-heading">
          <span class="section-kicker">Contexto da liderança</span>
          <h2>Observações do gestor</h2>
        </div>
        <div class="note-box">${formatChatFeedbackForReport(managerNotes)}</div>
      </section>`
    : ''
  const evolutionRows = buildChatReportEvolutionRows(monthlyHistory)
  const qualitativeFindings = qualitativeContext?.findings ?? []
  const negativeQualitativeFindings = qualitativeFindings.filter(
    (item) => item.satisfactionLabel === 'negative',
  )
  const positiveQualitativeFindings = qualitativeFindings.filter(
    (item) => item.satisfactionLabel === 'positive',
  )
  const compactQualitativeText = (value: string, maxLength = 180) => {
    const normalized = value.trim().replace(/\s+/g, ' ')
    if (normalized.length <= maxLength) return normalized
    const cutAt = normalized.lastIndexOf(' ', maxLength - 1)
    return `${normalized.slice(0, cutAt > 80 ? cutAt : maxLength).trim()}…`
  }
  const topQualitativeLabels = (
    findings: typeof qualitativeFindings,
    selector: (item: (typeof qualitativeFindings)[number]) => string,
    limit = 2,
  ) => {
    const counts: Record<string, number> = {}
    findings.forEach((item) => {
      const value = selector(item)
      if (!value) return
      counts[value] = (counts[value] ?? 0) + 1
    })

    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([key, count]) => `${formatQualitativeLabel(key)}${count > 1 ? ` (${count})` : ''}`)
      .join(' · ')
  }
  const uniqueQualitativeSummaries = (
    findings: typeof qualitativeFindings,
    selector: (item: (typeof qualitativeFindings)[number]) => string,
    limit = 1,
  ) => {
    const summaries = findings
      .map(selector)
      .map((value) => compactQualitativeText(value))
      .filter(Boolean)

    return [...new Set(summaries)].slice(0, limit).join(' ')
  }

  const negativeCauseText = topQualitativeLabels(
    negativeQualitativeFindings,
    (item) => item.analysis.primary_cause.category,
  )
  const negativeHumanText = uniqueQualitativeSummaries(
    negativeQualitativeFindings,
    (item) => item.analysis.human_influence.summary,
  )
  const positiveHumanText = uniqueQualitativeSummaries(
    positiveQualitativeFindings,
    (item) => item.analysis.human_influence.summary,
    2,
  )
  const positiveCauseText = topQualitativeLabels(
    positiveQualitativeFindings,
    (item) => item.analysis.primary_cause.category,
  )
  const qualitativeFocusText =
    qualitativeFindings
      .filter((item) => item.analysis.coaching_signal.available)
      .map((item) => compactQualitativeText(item.analysis.coaching_signal.summary))
      .filter(Boolean)[0] ??
    (negativeCauseText
      ? `Acompanhar a recorrência de ${negativeCauseText.toLowerCase()} e reforçar as práticas que preservaram as experiências positivas.`
      : 'Manter as práticas que sustentaram as experiências positivas e acompanhar novas avaliações no próximo ciclo.')

  const negativeSummaryText = negativeQualitativeFindings.length
    ? `Na amostra negativa, os principais sinais foram ${negativeCauseText || 'diversificados, sem um padrão recorrente suficiente'}.${negativeHumanText ? ` ${negativeHumanText}` : ''}`
    : 'Nenhuma avaliação negativa validada na amostra.'

  const positiveSummaryText = positiveQualitativeFindings.length
    ? positiveHumanText
      ? `Na amostra positiva, destacaram-se: ${positiveHumanText}`
      : `Na amostra positiva, os principais sinais foram ${positiveCauseText || 'favoráveis, sem um padrão único dominante'}.`
    : 'Nenhuma avaliação positiva validada na amostra.'

  const qualitativeHtml = qualitativeFindings.length
    ? `
      <section class="section-block">
        <div class="section-heading">
          <span class="section-kicker">IA + validação da gestão</span>
          <h2>Resumo qualitativo da experiência</h2>
        </div>
        <div class="insight-box">
          <div class="sample-line">
            <strong>${qualitativeFindings.length} leitura(s) aprovada(s)</strong>
            <span>${negativeQualitativeFindings.length} negativa(s) · ${positiveQualitativeFindings.length} positiva(s)</span>
          </div>
          <p class="muted">Cobertura validada: ${qualitativeContext?.negativeAnalyzed ?? 0} de ${qualitativeContext?.negativeTotal ?? 0} negativas e ${qualitativeContext?.positiveAnalyzed ?? 0} de ${qualitativeContext?.positiveTotal ?? 0} positivas.</p>
          <div class="qualitative-grid">
            <div class="qualitative-item">
              <span>Nas negativas</span>
              <p>${escapeHtml(negativeSummaryText)}</p>
            </div>
            <div class="qualitative-item">
              <span>Nas positivas</span>
              <p>${escapeHtml(positiveSummaryText)}</p>
            </div>
          </div>
          <div class="focus-line">
            <span>Foco do próximo ciclo</span>
            <strong>${escapeHtml(compactQualitativeText(qualitativeFocusText, 220))}</strong>
          </div>
          <p class="footnote">Leitura amostral baseada somente em análises aprovadas pela gestão. Não representa automaticamente todos os atendimentos da competência.</p>
        </div>
      </section>
    `
    : `
      <section class="section-block">
        <div class="section-heading">
          <span class="section-kicker">Experiência do cliente</span>
          <h2>Leitura qualitativa</h2>
        </div>
        <div class="empty-insight">
          <strong>Sem leitura qualitativa validada nesta competência.</strong>
          <p>O relatório preserva somente evidências aprovadas pela gestão; nenhuma hipótese da IA foi incorporada ao documento.</p>
        </div>
      </section>
    `

  const documentHtml = `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Relatório individual - ${safeName}</title>
        <style>
          * { box-sizing: border-box; }
          body {
            font-family: Arial, Helvetica, sans-serif;
            color: #172033;
            margin: 30px;
            background: #ffffff;
          }
          h1 { font-size: 25px; line-height: 1.15; margin: 0; color: #0f172a; }
          h2 { font-size: 17px; line-height: 1.25; margin: 2px 0 0; color: #0f172a; }
          h3 { font-size: 13px; margin: 0 0 5px; color: #0f172a; }
          p { font-size: 11.5px; line-height: 1.55; margin: 0 0 7px; }
          .header {
            padding: 0 0 16px;
            margin-bottom: 16px;
            border-bottom: 1px solid #cbd5e1;
          }
          .header-content { display: flex; align-items: center; gap: 16px; }
          .profile-photo {
            width: 76px !important;
            height: 76px !important;
            max-width: 76px !important;
            max-height: 76px !important;
            border-radius: 50%;
            object-fit: cover;
            border: 3px solid #0e7490;
            display: block;
          }
          .eyebrow {
            display: block;
            color: #0e7490;
            font-size: 9px;
            font-weight: bold;
            letter-spacing: 1.2px;
            text-transform: uppercase;
            margin-bottom: 5px;
          }
          .subtitle { color: #64748b; margin: 5px 0 0; font-size: 10.5px; }
          .source-pill {
            display: inline-block;
            margin-top: 7px;
            padding: 4px 8px;
            border: 1px solid #bae6fd;
            background: #f0f9ff;
            color: #075985;
            font-size: 9px;
            font-weight: bold;
          }
          .summary-card {
            border: 1px solid #dbe4ee;
            border-left: 5px solid ${statusColor};
            background: #f8fafc;
            padding: 14px;
            margin: 0 0 14px;
          }
          .summary-top { display: flex; justify-content: space-between; gap: 14px; align-items: flex-start; }
          .status-label { color: ${statusColor}; font-size: 17px; font-weight: bold; display: block; margin-top: 3px; }
          .podium-badge {
            border: 1px solid #cbd5e1;
            background: #ffffff;
            padding: 7px 10px;
            font-size: 10px;
            font-weight: bold;
            color: #334155;
            white-space: nowrap;
          }
          .summary-note { color: #64748b; margin-top: 8px; margin-bottom: 0; }
          .kpi-grid {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 8px;
            margin: 0 0 18px;
          }
          .kpi-card {
            border: 1px solid #dbe4ee;
            background: #ffffff;
            padding: 10px;
            min-height: 74px;
          }
          .kpi-card span {
            display: block;
            color: #64748b;
            font-size: 9px;
            margin-bottom: 5px;
          }
          .kpi-card strong {
            display: block;
            color: #0f172a;
            font-size: 18px;
            line-height: 1.1;
          }
          .kpi-card em {
            display: block;
            color: #64748b;
            font-size: 9px;
            font-style: normal;
            margin-top: 5px;
            line-height: 1.35;
          }
          .section-block { margin: 20px 0 0; }
          .section-heading { margin-bottom: 9px; }
          .section-kicker {
            display: block;
            color: #0e7490;
            font-size: 9px;
            font-weight: bold;
            letter-spacing: 0.9px;
            text-transform: uppercase;
            margin-bottom: 3px;
          }
          .reading-grid {
            display: grid;
            grid-template-columns: 1fr 1fr 1fr;
            gap: 8px;
          }
          .reading-card {
            border: 1px solid #dbe4ee;
            background: #f8fafc;
            padding: 11px;
            page-break-inside: avoid;
          }
          .reading-card span {
            display: block;
            color: #64748b;
            font-size: 9px;
            margin-bottom: 5px;
          }
          .reading-card strong {
            display: block;
            color: #0f172a;
            font-size: 12px;
            line-height: 1.35;
            margin-bottom: 5px;
          }
          .reading-card p { color: #475569; margin-bottom: 0; }
          .trend {
            border: 1px solid #dbe4ee;
            background: #f8fafc;
            padding: 12px;
            margin: 0;
          }
          .strategy-grid {
            display: grid;
            grid-template-columns: 1fr 1fr 1fr;
            gap: 8px;
            margin: 0 0 12px;
          }
          .strategy-card {
            border: 1px solid #dbe4ee;
            background: #ffffff;
            padding: 9px;
            page-break-inside: avoid;
          }
          .strategy-card span { display: block; color: #64748b; font-size: 9px; margin-bottom: 4px; }
          .strategy-card strong { display: block; color: #0f172a; font-size: 11px; line-height: 1.35; }
          .strategy-card em { display: block; color: #64748b; font-size: 9px; font-style: normal; margin-top: 4px; }
          .report-chart {
            display: block;
            width: 100%;
            max-width: 640px;
            height: auto;
            margin: 7px auto 13px;
            border: 1px solid #dbe4ee;
            background: #ffffff;
            page-break-inside: avoid;
          }
          .chart-title { font-size: 10.5px; font-weight: bold; color: #0f172a; margin: 10px 0 4px; }
          .chart-legend { font-size: 9px; color: #64748b; margin: 0 0 6px; }
          .initial-history {
            border: 1px solid #dbe4ee;
            background: #f8fafc;
            padding: 13px;
          }
          .initial-history strong { display: block; color: #0f172a; font-size: 13px; margin-bottom: 5px; }
          .snapshot-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 8px;
            margin-top: 10px;
          }
          .snapshot-item { background: #ffffff; border: 1px solid #e2e8f0; padding: 8px; }
          .snapshot-item span { display: block; color: #64748b; font-size: 9px; }
          .snapshot-item strong { display: block; color: #0f172a; font-size: 13px; margin-top: 3px; }
          .insight-box {
            border: 1px solid #dbe4ee;
            background: #f8fafc;
            padding: 12px;
          }
          .sample-line { display: flex; justify-content: space-between; gap: 10px; margin-bottom: 7px; }
          .sample-line strong { color: #0f172a; font-size: 11px; }
          .sample-line span { color: #64748b; font-size: 10px; }
          .qualitative-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px;
            margin: 10px 0;
          }
          .qualitative-item { background: #ffffff; border: 1px solid #e2e8f0; padding: 9px; }
          .qualitative-item span { display: block; color: #0e7490; font-size: 9px; font-weight: bold; margin-bottom: 4px; text-transform: uppercase; }
          .qualitative-item p { margin-bottom: 0; }
          .focus-line {
            border-left: 4px solid #0e7490;
            background: #ecfeff;
            padding: 9px 10px;
            margin-top: 8px;
          }
          .focus-line span { display: block; color: #0e7490; font-size: 9px; font-weight: bold; text-transform: uppercase; margin-bottom: 3px; }
          .focus-line strong { color: #0f172a; font-size: 11px; line-height: 1.4; }
          .empty-insight {
            border: 1px dashed #cbd5e1;
            background: #f8fafc;
            padding: 12px;
          }
          .empty-insight strong { display: block; color: #334155; font-size: 11px; margin-bottom: 4px; }
          .empty-insight p { color: #64748b; margin-bottom: 0; }
          .coach {
            border-left: 5px solid #0891b2;
            background: #ecfeff;
            padding: 12px;
            margin-top: 7px;
            page-break-inside: avoid;
          }
          .coach p:last-child { margin-bottom: 0; }
          .note-box {
            border-left: 5px solid #64748b;
            background: #f8fafc;
            padding: 12px;
          }
          .muted { color: #64748b; }
          .footnote { color: #64748b; font-size: 9px; margin: 8px 0 0; }
          .report-footer {
            border-top: 1px solid #e2e8f0;
            color: #94a3b8;
            font-size: 8.5px;
            margin-top: 22px;
            padding-top: 8px;
          }
          @page { margin: 17mm; }
          @media print {
            body { margin: 0; }
            .summary-card, .kpi-card, .reading-card, .strategy-card, .report-chart,
            .insight-box, .coach, .note-box, .initial-history { page-break-inside: avoid; }
          }
        </style>
      </head>
      <body>
        <header class="header">
          <div class="header-content">
            ${photoHtml}
            <div>
              <span class="eyebrow">Central de Performance · Chat</span>
              <h1>Relatório individual · ${safeName}</h1>
              <p class="subtitle">${escapeHtml(periodLabel)}</p>
              <span class="source-pill">${escapeHtml(dataSourceLabel)}</span>
            </div>
          </div>
        </header>

        <section class="summary-card">
          <div class="summary-top">
            <div>
              <span class="eyebrow">Situação do período</span>
              <strong class="status-label">${escapeHtml(status)}</strong>
            </div>
            <span class="podium-badge">${escapeHtml(podiumText)}</span>
          </div>
          <p class="summary-note">Leitura individual baseada nos indicadores oficiais da competência. Comparações operacionais entre colegas permanecem na visão gerencial e não compõem este documento.</p>
        </section>

        <div class="kpi-grid">
          <div class="kpi-card">
            <span>CSAT</span>
            <strong>${formatPercent(metric.csat)}</strong>
            <em>Meta individual: ${csatGoal}% · ${escapeHtml(csatText)}</em>
          </div>
          <div class="kpi-card">
            <span>% de avaliações</span>
            <strong>${formatPercent(metric.review_percentage)}</strong>
            <em>Referência: ${reviewGoal}% · ${escapeHtml(reviewText)}</em>
          </div>
          <div class="kpi-card">
            <span>Avaliações recebidas</span>
            <strong>${formatChatCount(metric.reviews)}</strong>
            <em>${formatChatCount(metric.positive_reviews)} positivas · ${formatChatCount(metric.negative_reviews)} negativas</em>
          </div>
          <div class="kpi-card">
            <span>Atendimentos</span>
            <strong>${formatChatCount(metric.total_tickets)}</strong>
            <em>Volume registrado na competência</em>
          </div>
        </div>

        <section class="section-block">
          <div class="section-heading">
            <span class="section-kicker">Leitura objetiva</span>
            <h2>O que os números mostram</h2>
          </div>
          <div class="reading-grid">
            <div class="reading-card">
              <span>Qualidade percebida</span>
              <strong>CSAT de ${formatPercent(metric.csat)}</strong>
              <p>${escapeHtml(csatText)} Foram registradas ${formatChatCount(metric.positive_reviews)} avaliação(ões) positiva(s) e ${formatChatCount(metric.negative_reviews)} negativa(s).</p>
            </div>
            <div class="reading-card">
              <span>Participação dos clientes</span>
              <strong>${formatPercent(metric.review_percentage)} dos atendimentos avaliados</strong>
              <p>${escapeHtml(reviewText)} A taxa considera ${formatChatCount(metric.reviews)} respostas sobre ${formatChatCount(metric.valid_tickets)} atendimentos válidos.</p>
            </div>
            <div class="reading-card">
              <span>Volume do período</span>
              <strong>${formatChatCount(metric.total_tickets)} atendimentos</strong>
              <p>O volume é apresentado como dado factual. O contexto de distribuição entre analistas é tratado exclusivamente na visão de gestão.</p>
            </div>
          </div>
        </section>

        <section class="section-block">
          <div class="section-heading">
            <span class="section-kicker">Histórico ClickDesk</span>
            <h2>Evolução do analista</h2>
          </div>
          ${evolutionRows}
        </section>

        ${qualitativeHtml}

        ${managerNotesHtml}

        <section class="section-block">
          <div class="section-heading">
            <span class="section-kicker">Devolutiva</span>
            <h2>Feedback do ciclo</h2>
          </div>
          <div class="coach">
            ${formatChatFeedbackForReport(finalFeedback)}
          </div>
        </section>

        <footer class="report-footer">
          Relatório gerado pela Central de Performance. Fonte da competência: ${escapeHtml(dataSourceLabel)}.
          Indicadores quantitativos representam o período selecionado; leituras qualitativas só aparecem quando aprovadas pela gestão.
        </footer>
      </body>
    </html>
  `

  const blob = new Blob(['\ufeff', documentHtml], {
    type: 'application/msword;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  const fileName = `relatório-${slugifyFileName(analystName)}-${slugifyFileName(periodLabel)}.doc`

  link.href = url
  link.download = fileName
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)

  return fileName
}

function buildChatReportLineChart(
  history: ChatMonthlyMetric[],
  series: Array<{
    label: string
    color: string
    value: (metric: ChatMonthlyMetric) => number
  }>,
  maximum: number,
  valueSuffix = '',
) {
  const canvas = document.createElement('canvas')
  canvas.width = 1280
  canvas.height = 430
  const context = canvas.getContext('2d')
  if (!context) return ''

  const left = 90
  const right = 36
  const top = 82
  const bottom = 72
  const plotWidth = canvas.width - left - right
  const plotHeight = canvas.height - top - bottom
  const safeMaximum = Math.max(maximum, 1)
  const xAt = (index: number) => history.length === 1
    ? left + plotWidth / 2
    : left + (index / (history.length - 1)) * plotWidth
  const yAt = (value: number) => top + plotHeight - (Math.max(0, Math.min(safeMaximum, value)) / safeMaximum) * plotHeight

  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.font = '22px Arial'
  context.textBaseline = 'middle'

  series.forEach((item, index) => {
    const legendX = left + index * 260
    context.fillStyle = item.color
    context.fillRect(legendX, 28, 24, 6)
    context.fillStyle = '#334155'
    context.fillText(item.label, legendX + 34, 31)
  })

  context.strokeStyle = '#dbe3ef'
  context.lineWidth = 2
  context.fillStyle = '#64748b'
  context.textAlign = 'right'
  for (let step = 0; step <= 4; step += 1) {
    const value = (safeMaximum / 4) * step
    const y = yAt(value)
    context.beginPath()
    context.moveTo(left, y)
    context.lineTo(canvas.width - right, y)
    context.stroke()
    context.fillText(`${Math.round(value)}${valueSuffix}`, left - 14, y)
  }

  context.textAlign = 'center'
  history.forEach((metric, index) => {
    const month = metric.month_label.replace(/\s+\d{4}$/, '')
    context.fillText(month.slice(0, 3), xAt(index), canvas.height - 35)
  })

  series.forEach((item) => {
    context.strokeStyle = item.color
    context.fillStyle = item.color
    context.lineWidth = 5
    context.lineJoin = 'round'
    context.beginPath()
    history.forEach((metric, index) => {
      const x = xAt(index)
      const y = yAt(item.value(metric))
      if (index === 0) context.moveTo(x, y)
      else context.lineTo(x, y)
    })
    context.stroke()
    history.forEach((metric, index) => {
      context.beginPath()
      context.arc(xAt(index), yAt(item.value(metric)), 7, 0, Math.PI * 2)
      context.fill()
    })
  })

  return canvas.toDataURL('image/png')
}

function buildChatReportEvolutionRows(history: ChatMonthlyMetric[]) {
  if (!history.length) {
    return `
      <div class="empty-insight">
        <strong>Histórico ClickDesk ainda não disponível.</strong>
        <p>A evolução será formada conforme novas competências forem fechadas, sem misturar a série antiga do Zendesk.</p>
      </div>
    `
  }

  const first = history[0]
  const last = history.at(-1) ?? first

  if (history.length === 1) {
    return `
      <div class="initial-history">
        <strong>Fotografia inicial</strong>
        <p class="muted">Esta é a primeira competência ClickDesk disponível para este analista. Ainda não existe base suficiente para classificar melhora, queda ou estabilidade. A tendência será apresentada a partir do próximo fechamento.</p>
        <div class="snapshot-grid">
          <div class="snapshot-item">
            <span>Competência</span>
            <strong>${escapeHtml(last.month_label)}</strong>
          </div>
          <div class="snapshot-item">
            <span>CSAT</span>
            <strong>${formatPercent(last.csat)}</strong>
          </div>
          <div class="snapshot-item">
            <span>% de avaliações</span>
            <strong>${formatPercent(last.review_percentage)}</strong>
          </div>
        </div>
      </div>
    `
  }

  const csatDelta = round(Number(last.csat) - Number(first.csat))
  const reviewDelta = round(Number(last.review_percentage) - Number(first.review_percentage))
  const maxTickets = Math.max(...history.map((metric) => Number(metric.total_tickets)), 1)
  const bestCsat = [...history].sort((a, b) => Number(b.csat) - Number(a.csat))[0]
  const lowestCsat = [...history].sort((a, b) => Number(a.csat) - Number(b.csat))[0]
  const bestReview = [...history].sort(
    (a, b) => Number(b.review_percentage) - Number(a.review_percentage),
  )[0]
  const lastCsatGoal = Number(last.csat_goal) || 90
  const lastReviewGoal = Number(last.general_review_goal) || 25
  const trendSignal =
    csatDelta >= 0 && reviewDelta >= 0
      ? 'Evolução favorável'
      : csatDelta < 0 && reviewDelta < 0
        ? 'Queda combinada'
        : 'Evolução mista'
  const focusText =
    Number(last.csat) < lastCsatGoal
      ? 'Priorizar qualidade percebida e revisar as causas confirmadas nas avaliações negativas.'
      : Number(last.review_percentage) < lastReviewGoal
        ? 'Ampliar a participação nas avaliações para tornar a leitura mais representativa.'
        : csatDelta < 0
          ? 'Entender o que mudou no último ciclo e preservar as práticas que sustentavam o patamar anterior.'
          : reviewDelta < 0
            ? 'Preservar o CSAT e recuperar a participação dos clientes nas avaliações.'
            : 'Manter a consistência e identificar quais práticas sustentaram o resultado.'

  const percentageChart = buildChatReportLineChart(
    history,
    [
      { label: 'CSAT', color: '#0891b2', value: (metric) => Number(metric.csat) },
      { label: 'Avaliações', color: '#7c3aed', value: (metric) => Number(metric.review_percentage) },
      { label: 'Sem avaliação', color: '#d97706', value: (metric) => Number(metric.sending_percentage) },
    ],
    100,
    '%',
  )
  const volumeMaximum = Math.max(100, Math.ceil(maxTickets / 100) * 100)
  const volumeChart = buildChatReportLineChart(
    history,
    [{ label: 'Atendimentos', color: '#059669', value: (metric) => Number(metric.total_tickets) }],
    volumeMaximum,
  )

  return `
    <div class="trend">
      <div class="strategy-grid">
        <div class="strategy-card">
          <span>Leitura do histórico</span>
          <strong>${escapeHtml(trendSignal)}</strong>
          <em>Do primeiro ao último mês: CSAT ${formatDelta(csatDelta, ' p.p.')} · avaliações ${formatDelta(reviewDelta, ' p.p.')}.</em>
        </div>
        <div class="strategy-card">
          <span>Referências da série</span>
          <strong>Melhor CSAT: ${escapeHtml(bestCsat.month_label)}</strong>
          <em>Menor CSAT: ${escapeHtml(lowestCsat.month_label)} · maior participação: ${escapeHtml(bestReview.month_label)}.</em>
        </div>
        <div class="strategy-card">
          <span>Foco recomendado</span>
          <strong>${escapeHtml(focusText)}</strong>
          <em>Leitura baseada exclusivamente na série ClickDesk.</em>
        </div>
      </div>

      <p class="chart-title">Qualidade e participação nas avaliações</p>
      <p class="chart-legend">Evolução percentual das competências ClickDesk disponíveis.</p>
      <img class="report-chart" src="${percentageChart}" width="640" height="215" alt="Evolução mensal de CSAT e avaliações" />

      <p class="chart-title">Atendimentos por competência</p>
      <p class="chart-legend">Volume individual registrado em cada competência, sem comparação com colegas.</p>
      <img class="report-chart" src="${volumeChart}" width="640" height="215" alt="Evolução mensal do volume individual" />
    </div>
  `
}

function cleanChatReportFeedbackText(text: string) {
  return text
    .replace(/\*\*/g, '')
    .replace(/^#+\s*/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function isChatReportFeedbackComplete(text: string, style: ChatFeedbackStyle) {
  const cleanText = cleanChatReportFeedbackText(text)
  const normalizedText = cleanText.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const requiredSections =
    style === 'sare'
      ? ['situacao', 'alinhamentos', 'resultado', 'expectativa']
      : style === 'mimo'
        ? ['momento', 'impacto', 'melhoria', 'orientacao']
        : ['leitura', 'forcas', 'plano', 'expectativa']

  return cleanText.length >= 650 && requiredSections.every((section) => normalizedText.includes(section))
}

function normalizeChatReportFeedback(text: string, fallbackText: string, style: ChatFeedbackStyle) {
  const cleanText = normalizeFeedbackManagerVoice(cleanChatReportFeedbackText(text))
  return isChatReportFeedbackComplete(cleanText, style)
    ? cleanText
    : normalizeFeedbackManagerVoice(cleanChatReportFeedbackText(fallbackText))
}

function normalizeFeedbackManagerVoice(text: string) {
  return text
    .replace(/(?:recomendo\s+(?:que\s+você\s+)?conversar|converse)\s+com\s+(?:(?:a\s+)?sua\s+liderança|(?:o\s+)?seu\s+gestor)\s+para\s+(?:validar|entender|confirmar)\s+se\s+/gi, 'vamos verificar juntos se ')
    .replace(/recomendo\s+(?:que\s+você\s+)?conversar\s+com\s+(?:a\s+)?sua\s+liderança\s+para\s+/gi, 'vamos ')
    .replace(/converse\s+com\s+(?:a\s+)?sua\s+liderança\s+para\s+/gi, 'vamos ')
    .replace(/converse\s+com\s+(?:o\s+)?seu\s+gestor\s+para\s+/gi, 'vamos ')
    .replace(/alinhe\s+com\s+(?:o\s+)?seu\s+gestor\s+(?:uma\s+)?revisão\s+(?:de|das?|dos?)\s+/gi, 'vamos revisar juntos ')
    .replace(/confira\s+com\s+(?:o\s+)?seu\s+gestor\s+se\s+/gi, 'vamos conferir juntos se ')
    .replace(/leve\s+(?:ao|para\s+o)\s+gestor\s+/gi, 'traga para nossa conversa ')
    .trim()
}
function buildChatFeedbackText({
  metric,
  averageTickets,
  podiumPosition,
  managerNotes,
}: {
  metric: ChatMonthlyMetric
  averageTickets: number
  podiumPosition: number
  managerNotes: string
}) {
  const analystName = getChatAnalystName(metric)
  const csatGoal = Number(metric.csat_goal) || 90
  const reviewGoal = Number(metric.general_review_goal) || 25
  const csatGap = round(Number(metric.csat) - csatGoal)
  const reviewGap = round(Number(metric.review_percentage) - reviewGoal)
  const podiumText =
    podiumPosition > 0 && podiumPosition <= 3
      ? `${podiumPosition}º lugar no pódio`
      : 'fora dos três primeiros lugares'
  const qualityFact =
    csatGap >= 0
      ? `CSAT ${formatPercent(metric.csat)}, ${formatDelta(csatGap, ' p.p.')} acima da meta de ${csatGoal}%`
      : `CSAT ${formatPercent(metric.csat)}, ${formatDelta(Math.abs(csatGap), ' p.p.').replace('+', '')} abaixo da meta de ${csatGoal}%`
  const reviewFact =
    reviewGap >= 0
      ? `avaliações ${formatPercent(metric.review_percentage)}, ${formatDelta(reviewGap, ' p.p.')} acima da referência de ${reviewGoal}%`
      : `avaliações ${formatPercent(metric.review_percentage)}, ${formatDelta(Math.abs(reviewGap), ' p.p.').replace('+', '')} abaixo da referência de ${reviewGoal}%`
  const priority =
    csatGap < 0
      ? 'revisar a qualidade percebida nos atendimentos avaliados negativamente'
      : reviewGap < 0
        ? 'ampliar a participação nas avaliações para aumentar a representatividade da amostra'
        : 'identificar quais práticas reais ajudaram a sustentar os indicadores e decidir como mantê-las no próximo ciclo'
  const verification =
    'Os indicadores mostram resultado, mas não comprovam comportamentos específicos. Exemplos reais da operação, observações do gestor e leituras qualitativas validadas devem orientar qualquer conclusão sobre conduta.'

  return [
    `Base factual do ciclo: ${analystName} registrou ${qualityFact}; ${reviewFact}, com ${metric.reviews} respostas sobre ${metric.valid_tickets} atendimentos válidos; e ${metric.total_tickets} atendimentos no período. Posição: ${podiumText}.`,
    `Ponto prioritário: ${priority}.`,
    `Contexto a considerar: ${verification}`,
    managerNotes.trim()
      ? `Observação registrada pelo gestor: ${managerNotes.trim()}`
      : 'Observação do gestor: não informada.',
  ]
    .filter(Boolean)
    .join('\n\n')
}

function getChatFeedbackStyleLabel(style: ChatFeedbackStyle) {
  if (style === 'sare') return 'SARE'
  if (style === 'mimo') return 'MIMO'
  return 'Coach'
}

function formatChatFeedbackForReport(text: string) {
  return text
    .split(/\r?\n\r?\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\r?\n/g, '<br />')}</p>`)
    .join('')
}
function buildPhoneFeedbackText({
  analystName,
  periodLabel,
  analystResult,
  podiumCsatGoal,
  reviewGoal,
  teamPerformance,
  teamPerformanceGoal,
  rankingPosition,
  managerNotes,
  averageTickets,
}: {
  analystName: string
  periodLabel: string
  analystResult: ReturnType<typeof buildPeriodPodium>[number]
  podiumCsatGoal: number
  reviewGoal: number
  teamPerformance: number
  teamPerformanceGoal: number
  rankingPosition: number
  managerNotes: string
  averageTickets: number
}) {
  const isTopThree = rankingPosition > 0 && rankingPosition <= 3
  const rankingText = rankingPosition
    ? isTopThree
      ? `${rankingPosition}º lugar no pódio`
      : `${rankingPosition}ª posição no ranking, fora dos três primeiros lugares`
    : 'sem posição calculada no ranking'
  const volumeDifference = round(analystResult.totalTickets - averageTickets)
  const podiumGap = round(analystResult.averageCsat - podiumCsatGoal)
  const reviewGap = round(analystResult.reviewPercentage - reviewGoal)
  const priority =
    podiumGap < 0
      ? `compreender o que influenciou o CSAT, que ficou ${formatDelta(Math.abs(podiumGap), ' p.p.').replace('+', '')} abaixo da referência`
      : reviewGap < 0
        ? `ampliar a participação nas avaliações, que ficou ${formatDelta(Math.abs(reviewGap), ' p.p.').replace('+', '')} abaixo da meta`
        : volumeDifference < 0
          ? `entender o contexto do volume, que ficou ${Math.abs(volumeDifference)} atendimentos abaixo da média do time`
          : 'identificar as práticas reais que ajudaram a equilibrar os indicadores e decidir como mantê-las'
  const contextToVerify = volumeDifference < 0
    ? 'Pausas, ausências, duração dos atendimentos e atuação em outras atividades podem ser verificados, mas os números não demonstram sozinhos a causa da diferença de volume.'
    : 'Os indicadores não comprovam comportamentos específicos. Use exemplos reais da operação ou observações do gestor antes de relacionar o resultado a uma conduta.'

  return [
    `Base factual do ciclo: ${analystName}, em ${periodLabel}, registrou CSAT de ${formatPercent(analystResult.averageCsat)} (referência ${podiumCsatGoal}%), ${formatChatCount(analystResult.totalReviews)} avaliações, taxa de avaliações de ${formatPercent(analystResult.reviewPercentage)} (meta ${reviewGoal}%) e ${formatChatCount(analystResult.totalTickets)} atendimentos. A média do time foi ${formatChatCount(averageTickets)}. Posição: ${rankingText}. Performance da equipe: ${formatPercent(teamPerformance)} diante da referência de ${teamPerformanceGoal}%.`,
    `Ponto prioritário: ${priority}.`,
    `Contexto a verificar: ${contextToVerify}`,
    managerNotes.trim() ? `Observação registrada pelo gestor: ${managerNotes.trim()}` : 'Observação do gestor: não informada.',
  ].join('\n\n')
}

function normalizePhoneReportFeedback(text: string, fallbackText: string, style: ChatFeedbackStyle) {
  return normalizeChatReportFeedback(text, fallbackText, style)
}

async function exportWordReport({
  analystName,
  photoUrl,
  periodLabel,
  expected,
  achieved,
  weeklyEvolution,
  assistedFeedback,
}: {
  analystName: string
  photoUrl?: string | null
  periodLabel: string
  expected: {
    csat: number
    review: number
  }
  achieved: {
    csat: number
    loss: number
    summary: string
    reviewPercentage: number
    reviewCount: number
    answeredTickets: number
    averageTickets: number
    rankingPosition: number
    teamPerformance: number
    teamAnsweredCalls: number
    teamAbandonedCalls: number
    teamTotalCalls: number
  }
  weeklyEvolution: WeeklyIndividualTrend[]
  assistedFeedback: string
}) {
  const safeName = escapeHtml(analystName)
  const embeddedPhotoUrl = await buildEmbeddedReportPhoto(photoUrl)
  const photoHtml = embeddedPhotoUrl
    ? `<img class="profile-photo" src="${embeddedPhotoUrl}" alt="Foto de ${safeName}" width="76" height="76" style="width:76px;height:76px;max-width:76px;max-height:76px;display:block;" />`
    : ''
  const firstEvolution = weeklyEvolution[0] ?? null
  const lastEvolution = weeklyEvolution.at(-1) ?? null
  const bestEvolution = weeklyEvolution.reduce<WeeklyIndividualTrend | null>(
    (best, item) => (!best || item.csat > best.csat ? item : best),
    null,
  )
  const worstEvolution = weeklyEvolution.reduce<WeeklyIndividualTrend | null>(
    (worst, item) => (!worst || item.csat < worst.csat ? item : worst),
    null,
  )
  const hasWeeklyComparison = weeklyEvolution.length > 1
  const csatDelta = hasWeeklyComparison && firstEvolution && lastEvolution ? round(lastEvolution.csat - firstEvolution.csat) : 0
  const csatTrendLabel = !hasWeeklyComparison
    ? 'Sem comparativo'
    : csatDelta > 0
      ? 'Melhorou'
      : csatDelta < 0
        ? 'Piorou'
        : 'Estavel'
  const csatTrendClass = !hasWeeklyComparison ? 'neutral' : csatDelta >= 0 ? 'positive' : 'negative'
  const goalGap = round(achieved.csat - expected.csat)
  const goalGapText = goalGap >= 0
    ? `${formatDelta(goalGap, ' p.p.')} acima da referência`
    : `${formatDelta(goalGap, ' p.p.')} abaixo da referência`
  const reviewGap = round(achieved.reviewPercentage - expected.review)
  const reviewGapText = reviewGap >= 0
    ? `${formatDelta(reviewGap, ' p.p.')} acima da meta`
    : `${formatDelta(reviewGap, ' p.p.')} abaixo da meta`
  const evolutionBars = weeklyEvolution.length
    ? weeklyEvolution
        .map((item, index) => {
          const previous = weeklyEvolution[index - 1]
          const delta = previous ? round(item.csat - previous.csat) : 0
          const color = delta > 0 ? '#059669' : delta < 0 ? '#dc2626' : '#0891b2'
          const width = Math.max(8, Math.min(100, item.csat))
          const marker = delta > 0 ? 'subiu' : delta < 0 ? 'caiu' : index === 0 ? 'base' : 'estavel'

          return `
            <div class="evolution-row">
              <div class="evolution-label">${escapeHtml(item.label)}</div>
              <div class="evolution-track">
                <div class="evolution-bar" style="width:${width}%; background:${color};"></div>
              </div>
              <div class="evolution-value">
                <strong>${formatPercent(item.csat)}</strong>
                <span class="${delta >= 0 ? 'positive' : 'negative'}">${index === 0 ? 'inicio' : formatDelta(delta, ' p.p.')}</span>
                <em>${marker}</em>
              </div>
            </div>
          `
        })
        .join('')
    : '<p class="muted">Sem dados de evolução no período.</p>'
  const volumeRows = weeklyEvolution.length
    ? weeklyEvolution
        .map(
          (item) => `
            <tr>
              <td>${escapeHtml(item.label)}</td>
              <td>${item.totalReviews}</td>
              <td>${item.totalTickets}</td>
            </tr>
          `,
        )
        .join('')
    : '<tr><td colspan="3">Sem dados de volume no período.</td></tr>'

  const documentHtml = `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Relatorio mensal - ${safeName}</title>
        <style>
          body { font-family: Arial, sans-serif; color: #111827; margin: 34px; }
          h1 { font-size: 28px; margin: 0 0 6px; color: #0f172a; }
          h2 { color: #0f766e; font-size: 18px; margin: 24px 0 8px; }
          h3 { font-size: 15px; margin: 18px 0 6px; color: #0f172a; }
          p { font-size: 12px; line-height: 1.55; margin: 0 0 10px; }
          table { border-collapse: collapse; width: 100%; margin: 10px 0 18px; }
          th, td { border: 1px solid #cbd5e1; font-size: 11px; padding: 8px; text-align: left; }
          th { background: #ecfeff; font-weight: bold; color: #0f172a; }
          .subtitle { color: #475569; margin-bottom: 18px; }
          .header { border-bottom: 3px solid #06b6d4; padding-bottom: 12px; margin-bottom: 18px; }
          .header-content { display: flex; align-items: center; gap: 16px; }
          .profile-photo { width: 76px !important; height: 76px !important; max-width: 76px !important; max-height: 76px !important; border-radius: 50%; object-fit: cover; border: 2px solid #0891b2; display: block; }
          .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
          .box { border: 1px solid #cbd5e1; background: #f8fafc; padding: 12px; margin-bottom: 12px; }
          .box h2 { margin-top: 0; }
          .insight-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 12px 0 18px; }
          .insight { background: #f8fafc; border: 1px solid #cbd5e1; border-top: 4px solid #0891b2; padding: 10px; min-height: 58px; }
          .insight-label { color: #475569; font-size: 10px; margin-bottom: 5px; text-transform: uppercase; letter-spacing: .03em; }
          .insight-value { font-size: 18px; font-weight: bold; color: #0f172a; }
          .insight-note { color: #475569; font-size: 10px; margin-top: 3px; }
          .positive { color: #059669; }
          .negative { color: #dc2626; }
          .neutral { color: #475569; }
          .trend-panel { border: 1px solid #cbd5e1; padding: 12px; margin: 12px 0 18px; }
          .trend-title { font-size: 12px; font-weight: bold; margin-bottom: 10px; color: #0f172a; }
          .evolution-row { display: grid; grid-template-columns: 74px 1fr 140px; gap: 10px; align-items: center; margin: 10px 0; }
          .evolution-label { font-size: 11px; font-weight: bold; color: #0f172a; }
          .evolution-track { background: #e2e8f0; height: 20px; border-radius: 3px; overflow: hidden; position: relative; }
          .evolution-bar { height: 20px; }
          .goal-badge { display: inline-block; background: #0f766e; color: #ffffff; font-size: 11px; font-weight: bold; padding: 6px 9px; margin: 0 0 10px; }
          .evolution-value { font-size: 11px; font-weight: normal; }
          .evolution-value strong { display: inline-block; min-width: 42px; }
          .evolution-value span { font-weight: bold; }
          .evolution-value em { color: #64748b; font-style: normal; margin-left: 4px; }
          .muted { color: #475569; }
          .callout { background: #ecfeff; border-left: 4px solid #0891b2; padding: 10px 12px; margin: 12px 0 16px; }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="header-content">
            ${photoHtml}
            <div><h1>${safeName}</h1><p class="subtitle">Relatorio mensal de performance - ${escapeHtml(periodLabel)}</p></div>
          </div>
        </div>

        <div class="grid">
          <div class="box">
            <h2>Esperado</h2>
            <p>CSAT maior ou igual a ${expected.csat}%</p>
            <p>${expected.review}% de avaliações dos atendimentos</p>
          </div>
          <div class="box">
            <h2>Atingido</h2>
            <p>CSAT: ${formatPercent(achieved.csat)} (${goalGapText})</p>
            <p>Avaliações: ${formatPercent(achieved.reviewPercentage)} (${achieved.reviewCount} respondidas, ${reviewGapText})</p>
            <p>Atendimentos: ${achieved.answeredTickets}</p>
            <p>Media por colaborador: ${achieved.averageTickets}</p>
            <p>Posição pódio: ${achieved.rankingPosition || '-'}</p>
          </div>
        </div>

        <h2>Sintese do feedback</h2>
        <div class="callout"><p>${escapeHtml(achieved.summary)}</p></div>

        <h2>Graficos e evolução</h2>
        <p class="muted">Leitura visual para identificar rapidamente melhora, queda ou estabilidade.</p>
        <div class="insight-grid">
          <div class="insight">
            <div class="insight-label">CSAT atual</div>
            <div class="insight-value">${formatPercent(achieved.csat)}</div>
            <div class="insight-note">${goalGapText}</div>
          </div>
          <div class="insight">
            <div class="insight-label">Tendencia</div>
            <div class="insight-value ${csatTrendClass}">${csatTrendLabel}</div>
            <div class="insight-note">${hasWeeklyComparison ? formatDelta(csatDelta, ' p.p.') : 'precisa de mais semanas'}</div>
          </div>
          <div class="insight">
            <div class="insight-label">Melhor semana</div>
            <div class="insight-value">${bestEvolution ? `${bestEvolution.label} - ${formatPercent(bestEvolution.csat)}` : '-'}</div>
            <div class="insight-note">ponto mais alto do período</div>
          </div>
          <div class="insight">
            <div class="insight-label">Avaliações respondidas</div>
            <div class="insight-value">${achieved.reviewCount}</div>
            <div class="insight-note">${formatPercent(achieved.reviewPercentage)} dos atendimentos</div>
          </div>
        </div>
        <div class="trend-panel">
          <div class="trend-title">Evolução semanal do CSAT</div>
          <div class="goal-badge">Referência para o pódio: ${expected.csat}%</div>
          ${evolutionBars}
        </div>
        <p class="muted">Menor ponto do período: ${worstEvolution ? `${worstEvolution.label} - ${formatPercent(worstEvolution.csat)}` : '-'}.</p>
        <h3>Volume semanal</h3>
        <p class="muted">Complemento da evolução: avaliações respondidas e atendimentos registrados em cada semana.</p>
        <table>
          <thead>
            <tr>
              <th>Semana</th>
              <th>Avaliações</th>
              <th>Atendimentos</th>
            </tr>
          </thead>
          <tbody>${volumeRows}</tbody>
        </table>
        <h2>Contexto operacional da equipe</h2>
        <p>Performance da equipe no período: ${formatPercent(achieved.teamPerformance)}.</p>
        <p>Ligações atendidas pela equipe: ${achieved.teamAnsweredCalls}. Total processado: ${achieved.teamTotalCalls}.</p>

        <h2>Feedback</h2>
        <div class="callout">${formatChatFeedbackForReport(assistedFeedback)}</div>
      </body>
    </html>
  `
  const blob = new Blob(['\ufeff', documentHtml], {
    type: 'application/msword;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  const fileName = `${slugifyFileName(analystName)}-relatório-${slugifyFileName(periodLabel)}.doc`

  link.href = url
  link.download = fileName
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()

  window.setTimeout(() => {
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }, 5000)

  return fileName
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function slugifyFileName(value: string) {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function aggregateIndividualByWeek(metrics: IndividualMetric[]): WeeklyIndividualTrend[] {
  const grouped = new Map<
    string,
    {
      weekStart: string
      csatTotal: number
      count: number
      totalReviews: number
      totalTickets: number
    }
  >()

  metrics.forEach((metric) => {
    const current = grouped.get(metric.week_start) ?? {
      weekStart: metric.week_start,
      csatTotal: 0,
      count: 0,
      totalReviews: 0,
      totalTickets: 0,
    }

    current.csatTotal += Number(metric.csat)
    current.count += 1
    current.totalReviews += Number(metric.total_reviews)
    current.totalTickets += Number(metric.total_tickets)
    grouped.set(metric.week_start, current)
  })

  return [...grouped.values()]
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
    .map((week) => ({
      label: formatShortDate(week.weekStart),
      csat: round(week.csatTotal / week.count),
      totalReviews: week.totalReviews,
      totalTickets: week.totalTickets,
    }))
}

function buildPeriodPodium(
  metrics: IndividualMetric[],
  analysts: Analyst[],
  podiumCsatGoal: number,
  reviewGoal: number,
): MonthlyPodiumResult[] {
  const activeAnalysts = analysts.filter((analyst) => analyst.active)
  const activeAnalystIds = new Set(activeAnalysts.map((analyst) => analyst.id))
  const periodMetrics = metrics.filter((metric) => activeAnalystIds.has(metric.analyst_id))
  const grouped = new Map<
    string,
    {
      csatWeightedTotal: number
      csatSimpleTotal: number
      csatSimpleCount: number
      totalReviews: number
      totalTickets: number
    }
  >()

  periodMetrics.forEach((metric) => {
    const current = grouped.get(metric.analyst_id) ?? {
      csatWeightedTotal: 0,
      csatSimpleTotal: 0,
      csatSimpleCount: 0,
      totalReviews: 0,
      totalTickets: 0,
    }
    const totalReviews = Number(metric.total_reviews)
    const csat = Number(metric.csat)

    current.csatWeightedTotal += csat * totalReviews
    current.csatSimpleTotal += csat
    current.csatSimpleCount += 1
    current.totalReviews += totalReviews
    current.totalTickets += Number(metric.total_tickets)
    grouped.set(metric.analyst_id, current)
  })

  const analystsWithMetrics = activeAnalysts
    .map((analyst) => {
      const metric = grouped.get(analyst.id)
      if (!metric) return null

      const averageTickets =
        grouped.size > 0
          ? [...grouped.values()].reduce((sum, item) => sum + item.totalTickets, 0) / grouped.size
          : 0
      const averageCsat =
        metric.totalReviews > 0
          ? metric.csatWeightedTotal / metric.totalReviews
          : metric.csatSimpleTotal / metric.csatSimpleCount
      const reviewPercentage =
        metric.totalTickets > 0 ? (metric.totalReviews / metric.totalTickets) * 100 : 0
      const individualGoal = Number(analyst.csat_goal)
      const reasons: string[] = []

      if (averageCsat < individualGoal) reasons.push('abaixo da meta individual')
      if (averageCsat < podiumCsatGoal) reasons.push('abaixo do pódio')
      if (reviewPercentage < reviewGoal) reasons.push('avaliações abaixo da meta')
      if (metric.totalTickets < averageTickets) reasons.push('atendimentos abaixo da média')

      return {
        analystId: analyst.id,
        analystName: analyst.name,
        averageCsat: round(averageCsat),
        totalReviews: metric.totalReviews,
        totalTickets: metric.totalTickets,
        reviewPercentage: round(reviewPercentage),
        individualGoal,
        eligible: reasons.length === 0,
        reasons,
      }
    })
    .filter((item): item is MonthlyPodiumResult => Boolean(item))

  return analystsWithMetrics.sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1
    if (b.averageCsat !== a.averageCsat) return b.averageCsat - a.averageCsat
    if (b.reviewPercentage !== a.reviewPercentage) return b.reviewPercentage - a.reviewPercentage
    if (b.totalTickets !== a.totalTickets) return b.totalTickets - a.totalTickets
    return a.analystName.localeCompare(b.analystName)
  })
}

function getGoalValue(goals: Goal[], key: string, fallback: number) {
  const normalizedKey = key.toLowerCase()
  const goal = goals.find((item) => item.active && item.key.toLowerCase() === normalizedKey)

  if (goal) return Number(goal.value)

  const labelSearch = normalizedKey.includes('review') ? 'avalia' : 'pódio'
  const matchingLabel = goals.find(
    (item) => item.active && item.label.toLowerCase().includes(labelSearch),
  )

  return matchingLabel ? Number(matchingLabel.value) : fallback
}

function getTeamPerformanceGoal(goals: Goal[]) {
  const goal = goals.find((item) => {
    const key = item.key.toLowerCase()
    const label = item.label.toLowerCase()

    return (
      item.active &&
      (key.includes('performance') ||
        key.includes('team') ||
        label.includes('desempenho') ||
        label.includes('performance'))
    )
  })

  return goal ? Number(goal.value) : 96
}

function createPeriodFilter(mode: PeriodMode): PeriodFilter {
  const now = new Date()
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth()

  if (mode === 'week') {
    const start = startOfBusinessWeek(now)
    const end = addDays(start, 4)

    return {
      mode,
      start: toDateInputValue(start),
      end: toDateInputValue(end),
    }
  }

  if (mode === 'year') {
    return {
      mode,
      start: `${currentYear}-01-01`,
      end: `${currentYear}-12-31`,
    }
  }

  const start = new Date(currentYear, currentMonth, 1)
  const end = new Date(currentYear, currentMonth + 1, 0)

  return {
    mode,
    start: toDateInputValue(start),
    end: toDateInputValue(end),
  }
}

function filterIndividualMetricsByPeriod(metrics: IndividualMetric[], period: PeriodFilter) {
  return metrics.filter((metric) => isMetricInPeriod(metric.week_start, metric.week_end, period))
}

function filterTeamMetricsByPeriod(metrics: TeamMetric[], period: PeriodFilter) {
  return metrics.filter((metric) => isMetricInPeriod(metric.week_start, metric.week_end, period))
}

function isMetricInPeriod(weekStart: string, weekEnd: string, period: PeriodFilter) {
  if (!period.start || !period.end) return true

  return weekStart <= period.end && weekEnd >= period.start
}

function calculateGoalProbability({
  hasData,
  csat,
  csatGoal,
  csatDelta,
  teamPerformance,
  teamPerformanceGoal,
  teamPerformanceDelta,
  reviewCoverage,
  reviewGoal,
  eligibleCount,
  totalAnalysts,
}: {
  hasData: boolean
  csat: number
  csatGoal: number
  csatDelta: number
  teamPerformance: number
  teamPerformanceGoal: number
  teamPerformanceDelta: number
  reviewCoverage: number
  reviewGoal: number
  eligibleCount: number
  totalAnalysts: number
}) {
  if (!hasData) return 0

  const csatScore = clampScore(50 + (csat - csatGoal) * 8 + csatDelta * 4)
  const teamScore = clampScore(50 + (teamPerformance - teamPerformanceGoal) * 10 + teamPerformanceDelta * 4)
  const reviewScore = clampScore(50 + (reviewCoverage - reviewGoal) * 3)
  const podiumScore = totalAnalysts ? (eligibleCount / totalAnalysts) * 100 : 0

  return Math.round(csatScore * 0.35 + teamScore * 0.3 + reviewScore * 0.2 + podiumScore * 0.15)
}

function projectMetric(current: number, delta: number, fallbackGoal: number) {
  if (!current) return fallbackGoal
  return round(Math.max(0, Math.min(100, current + delta * 0.5)))
}

function getPredictiveRiskLevel(
  probability: number,
  csatDelta: number,
  teamPerformanceDelta: number,
  attentionCount: number,
) {
  if (probability < 45 || csatDelta < -2 || teamPerformanceDelta < -1.5 || attentionCount >= 3) {
    return 'Alto'
  }

  if (probability < 75 || csatDelta < 0 || teamPerformanceDelta < 0 || attentionCount > 0) {
    return 'Medio'
  }

  return 'Baixo'
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, value))
}
function getChatTeamNameById(teams: ChatTeam[], teamId: string) {
  return teams.find((team) => team.id === teamId)?.name ?? 'Equipe'
}
function getChatAnalystName(metric: ChatMonthlyMetric) {
  const analyst = Array.isArray(metric.chat_analysts) ? metric.chat_analysts[0] : metric.chat_analysts
  return analyst?.name ?? 'Analista'
}

function getChatAnalystPhoto(metric: ChatMonthlyMetric) {
  const analyst = Array.isArray(metric.chat_analysts) ? metric.chat_analysts[0] : metric.chat_analysts
  return analyst?.photo_url ?? null
}

function getChatTeamName(metric: ChatMonthlyMetric) {
  const team = Array.isArray(metric.chat_teams) ? metric.chat_teams[0] : metric.chat_teams
  return team?.name ?? 'Equipe'
}

const chatMonthOptions = [
  { value: '1', label: 'Janeiro' },
  { value: '2', label: 'Fevereiro' },
  { value: '3', label: 'Marco' },
  { value: '4', label: 'Abril' },
  { value: '5', label: 'Maio' },
  { value: '6', label: 'Junho' },
  { value: '7', label: 'Julho' },
  { value: '8', label: 'Agosto' },
  { value: '9', label: 'Setembro' },
  { value: '10', label: 'Outubro' },
  { value: '11', label: 'Novembro' },
  { value: '12', label: 'Dezembro' },
]

async function readSheetRows(file: File) {
  if (file.name.toLowerCase().endsWith('.csv')) {
    return parseCsvRows(await file.text())
  }

  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array' })
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) return []

  return XLSX.utils.sheet_to_json<Record<string, string | number | null>>(workbook.Sheets[sheetName], {
    defval: '',
    raw: false,
  })
}

function parseCsvRows(text: string) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim())
  if (lines.length < 2) return []

  const delimiter = detectCsvDelimiter(lines[0])
  const headers = parseCsvLine(lines[0], delimiter).map((header) => header.trim())

  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line, delimiter)
    return headers.reduce<Record<string, string>>((row, header, index) => {
      row[header] = values[index]?.trim() ?? ''
      return row
    }, {})
  })
}

function detectCsvDelimiter(headerLine: string) {
  const commaCount = (headerLine.match(/,/g) ?? []).length
  const semicolonCount = (headerLine.match(/;/g) ?? []).length
  return semicolonCount > commaCount ? ';' : ','
}

function parseCsvLine(line: string, delimiter: string) {
  const values: string[] = []
  let current = ''
  let insideQuotes = false

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    const next = line[index + 1]

    if (char === '"' && insideQuotes && next === '"') {
      current += '"'
      index += 1
      continue
    }

    if (char === '"') {
      insideQuotes = !insideQuotes
      continue
    }

    if (char === delimiter && !insideQuotes) {
      values.push(current)
      current = ''
      continue
    }

    current += char
  }

  values.push(current)
  return values
}

function normalizeChatText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

function normalizeChatColumn(value: string) {
  return normalizeChatText(value).replace(/[^a-z0-9]/g, '')
}

function findChatColumn(rows: Record<string, string | number | null>[], candidates: string[]) {
  const headers = Object.keys(rows[0] ?? {})
  const normalizedCandidates = candidates.map(normalizeChatColumn)
  const directMatch = headers.find((header) => normalizedCandidates.includes(normalizeChatColumn(header)))
  if (directMatch) return directMatch

  return headers.find((header) => {
    const normalizedHeader = normalizeChatColumn(header)
    return normalizedCandidates.some((candidate) => normalizedHeader.includes(candidate) || candidate.includes(normalizedHeader))
  })
}

function getChatRowValue(row: Record<string, string | number | null>, column: string) {
  return String(row[column] ?? '').trim()
}

function getChatMonthPeriod(year: number, monthNumber: number) {
  const month = chatMonthOptions.find((option) => Number(option.value) === monthNumber)?.label ?? 'Periodo'
  const paddedMonth = String(monthNumber).padStart(2, '0')
  const lastDay = new Date(year, monthNumber, 0).getDate()

  return {
    label: `${month} ${year}`,
    start: `${year}-${paddedMonth}-01`,
    end: `${year}-${paddedMonth}-${String(lastDay).padStart(2, '0')}`,
  }
}

function buildChatMetricRowsFromSheets({
  satisfactionRows,
  inactiveRows,
  analysts,
  year,
  monthNumber,
  monthLabel,
  periodStart,
  periodEnd,
}: {
  satisfactionRows: Record<string, string | number | null>[]
  inactiveRows: Record<string, string | number | null>[]
  analysts: ChatAnalyst[]
  year: number
  monthNumber: number
  monthLabel: string
  periodStart: string
  periodEnd: string
}) {
  const satisfactionAnalystColumn = findChatColumn(satisfactionRows, [
    'Nome do atribuido',
    'Atribuido',
    'Assignee',
    'Responsavel',
    'Nome do agente',
    'Analista',
  ])
  const satisfactionRatingColumn = findChatColumn(satisfactionRows, [
    'Indice de satisfação do ticket Boa Ruim vazio',
    'Indice de satisfação do ticket',
    'Satisfação',
    'CSAT',
    'Rating',
    'Avaliação',
  ])
  const inactiveAnalystColumn = findChatColumn(inactiveRows, [
    'Nome do atribuido',
    'Atribuido',
    'Assignee',
    'Responsavel',
    'Nome do agente',
    'Analista',
  ])

  if (!satisfactionAnalystColumn) throw new Error('Não encontrei a coluna do analista na planilha de satisfação.')
  if (!satisfactionRatingColumn) throw new Error('Não encontrei a coluna de satisfação/avaliação na planilha de satisfação.')
  if (!inactiveAnalystColumn) throw new Error('Não encontrei a coluna do analista na planilha de inatividade.')

  return analysts
    .filter((analyst) => analyst.active)
    .map((analyst): ChatMetricImportRecord | null => {
      const analystName = normalizeChatText(analyst.name)
      const analystSatisfactionRows = satisfactionRows.filter(
        (row) => normalizeChatText(getChatRowValue(row, satisfactionAnalystColumn)) === analystName,
      )
      const analystInactiveRows = inactiveRows.filter(
        (row) => normalizeChatText(getChatRowValue(row, inactiveAnalystColumn)) === analystName,
      )
      const totalTickets = analystSatisfactionRows.length
      const inactiveTickets = analystInactiveRows.length

      if (!totalTickets) return null

      const validTickets = Math.max(totalTickets - inactiveTickets, 0)
      const ratedRows = analystSatisfactionRows.filter((row) => {
        const rating = normalizeChatText(getChatRowValue(row, satisfactionRatingColumn))
        return rating === 'boa' || rating === 'ruim' || rating === 'good' || rating === 'bad'
      })
      const positiveReviews = ratedRows.filter((row) => {
        const rating = normalizeChatText(getChatRowValue(row, satisfactionRatingColumn))
        return rating === 'boa' || rating === 'good'
      }).length
      const reviews = ratedRows.length
      const negativeReviews = Math.max(reviews - positiveReviews, 0)
      const csat = reviews ? round((positiveReviews / reviews) * 100) : 0
      const reviewPercentage = validTickets ? round((reviews / validTickets) * 100) : 0
      const sendingPercentage = validTickets ? round(((validTickets - reviews) / validTickets) * 100) : 0
      const csatGoal = Number(analyst.csat_goal) || 86
      const generalReviewGoal = 25
      const csatDelta = round(csat - csatGoal)
      const status = getChatMetricStatus(csat, reviewPercentage, csatGoal, generalReviewGoal)

      return {
        team_id: analyst.team_id,
        analyst_id: analyst.id,
        month_label: monthLabel,
        year,
        month_number: monthNumber,
        period_start: periodStart,
        period_end: periodEnd,
        csat,
        review_percentage: reviewPercentage,
        sending_percentage: sendingPercentage,
        total_tickets: totalTickets,
        inactive_tickets: inactiveTickets,
        valid_tickets: validTickets,
        reviews,
        positive_reviews: positiveReviews,
        negative_reviews: negativeReviews,
        csat_goal: csatGoal,
        csat_delta: csatDelta,
        general_review_goal: generalReviewGoal,
        status,
      }
    })
    .filter((record): record is ChatMetricImportRecord => Boolean(record))
}
function buildChatRanking(
  metrics: ChatMonthlyMetric[],
  averageTickets: number,
  excludedAnalystIds = new Set<string>(),
) {
  return metrics
    .map((metric) => {
      const excluded = excludedAnalystIds.has(metric.analyst_id)
      const reasons = getChatAttentionReasons(metric, averageTickets)
      if (excluded) reasons.push('desconsiderado do período por exceção operacional')

      return {
        metric,
        eligible: !excluded && reasons.length === 0,
        excluded,
        reasons,
      }
    })
    .sort((a, b) => {
      if (a.excluded !== b.excluded) return a.excluded ? 1 : -1
      if (a.eligible !== b.eligible) return a.eligible ? -1 : 1
      if (Number(b.metric.csat) !== Number(a.metric.csat)) return Number(b.metric.csat) - Number(a.metric.csat)
      if (Number(b.metric.review_percentage) !== Number(a.metric.review_percentage)) {
        return Number(b.metric.review_percentage) - Number(a.metric.review_percentage)
      }
      if (Number(b.metric.total_tickets) !== Number(a.metric.total_tickets)) {
        return Number(b.metric.total_tickets) - Number(a.metric.total_tickets)
      }
      return getChatAnalystName(a.metric).localeCompare(getChatAnalystName(b.metric))
    })
}
function buildChatPodium(metrics: ChatMonthlyMetric[], averageTickets: number) {
  return metrics
    .filter(
      (metric) =>
        Number(metric.csat) >= 90 &&
        Number(metric.review_percentage) >= 25 &&
        Number(metric.total_tickets) >= averageTickets,
    )
    .sort((a, b) => Number(b.csat) - Number(a.csat))
    .slice(0, 3)
}

function getChatMetricStatus(csat: number, reviewPercentage: number, csatGoal: number, reviewGoal = 25) {
  if (csat >= csatGoal && reviewPercentage >= reviewGoal) return 'Meta Superada'
  if (csat >= csatGoal || reviewPercentage >= reviewGoal) return 'Atencao'
  return 'Critico'
}
function getChatAttentionReasons(metric: ChatMonthlyMetric, averageTickets: number) {
  const reasons: string[] = []
  const minimumVolumeReference = Math.ceil(averageTickets)
  if (Number(metric.csat) < 90) reasons.push('CSAT abaixo de 90%')
  if (Number(metric.review_percentage) < 25) reasons.push('avaliações abaixo de 25%')
  if (Number(metric.total_tickets) < averageTickets) {
    reasons.push(`volume abaixo da referência mínima (${minimumVolumeReference} atend.)`)
  }
  return reasons
}

function buildChatMonthlyUnifiedTrend(metrics: ChatMonthlyMetric[]) {
  const grouped = new Map<
    string,
    { label: string; year: number; month: number; csatSum: number; reviewsSum: number; sendingSum: number; count: number }
  >()

  metrics.forEach((metric) => {
    const key = `${metric.year}-${metric.month_number}`
    const current = grouped.get(key) ?? {
      label: metric.month_label,
      year: metric.year,
      month: metric.month_number,
      csatSum: 0,
      reviewsSum: 0,
      sendingSum: 0,
      count: 0,
    }

    current.csatSum += Number(metric.csat)
    current.reviewsSum += Number(metric.review_percentage)
    current.sendingSum += Number(metric.sending_percentage)
    current.count += 1
    grouped.set(key, current)
  })

  return [...grouped.values()]
    .sort((a, b) => (a.year === b.year ? a.month - b.month : a.year - b.year))
    .map((item) => ({
      label: item.label.replace(' 2026', ''),
      csat: item.count ? round(item.csatSum / item.count) : 0,
      reviews: item.count ? round(item.reviewsSum / item.count) : 0,
      sending: item.count ? round(item.sendingSum / item.count) : 0,
    }))
}

function buildChatMonthlyVolumeTrend(metrics: ChatMonthlyMetric[]) {
  const grouped = new Map<string, { label: string; year: number; month: number; tickets: number }>()

  metrics.forEach((metric) => {
    const key = `${metric.year}-${metric.month_number}`
    const current = grouped.get(key) ?? {
      label: metric.month_label,
      year: metric.year,
      month: metric.month_number,
      tickets: 0,
    }

    current.tickets += Number(metric.total_tickets)
    grouped.set(key, current)
  })

  return [...grouped.values()]
    .sort((a, b) => (a.year === b.year ? a.month - b.month : a.year - b.year))
    .map((item) => ({
      label: item.label.replace(' 2026', ''),
      value: item.tickets,
    }))
}

function buildChatMonthlyTrend(metrics: ChatMonthlyMetric[]) {
  const grouped = new Map<string, { label: string; year: number; month: number; csatSum: number; count: number }>()
  metrics.forEach((metric) => {
    const key = `${metric.year}-${metric.month_number}`
    const current = grouped.get(key) ?? {
      label: metric.month_label,
      year: metric.year,
      month: metric.month_number,
      csatSum: 0,
      count: 0,
    }
    current.csatSum += Number(metric.csat)
    current.count += 1
    grouped.set(key, current)
  })

  return [...grouped.values()]
    .sort((a, b) => (a.year === b.year ? a.month - b.month : a.year - b.year))
    .map((item) => ({
      label: item.label.replace(' 2026', ''),
      value: item.count ? round(item.csatSum / item.count) : 0,
    }))
}

function getPeriodModeLabel(mode: PeriodMode) {
  const labels: Record<PeriodMode, string> = {
    week: 'Semana',
    month: 'Mes',
    year: 'Ano',
    custom: 'Personalizado',
  }

  return labels[mode]
}

function formatPeriodLabel(period: PeriodFilter) {
  if (!period.start || !period.end) return 'todo o historico'
  return `${formatDate(period.start)} a ${formatDate(period.end)}`
}

function formatLaunchedPeriodLabel(metrics: IndividualMetric[], period: PeriodFilter) {
  if (!metrics.length) return formatPeriodLabel(period)

  const starts = metrics.map((metric) => metric.week_start).sort()
  const ends = metrics.map((metric) => metric.week_end).sort()
  const firstLaunch = starts[0]
  const lastLaunch = ends[ends.length - 1]

  if (!firstLaunch || !lastLaunch) return formatPeriodLabel(period)
  return `${formatDate(firstLaunch)} a ${formatDate(lastLaunch)}`
}

function getPreviousPeriod(period: PeriodFilter): PeriodFilter {
  if (!period.start || !period.end) return period

  const start = new Date(`${period.start}T00:00:00`)
  const end = new Date(`${period.end}T00:00:00`)
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1)
  const previousEnd = addDays(start, -1)
  const previousStart = addDays(previousEnd, -(days - 1))

  return {
    mode: 'custom',
    start: toDateInputValue(previousStart),
    end: toDateInputValue(previousEnd),
  }
}

function formatDelta(value: number, suffix = '') {
  const numericValue = Number(value)
  const absoluteValue = Math.abs(numericValue)
  const isPercentLike = suffix.includes('%') || suffix.includes('p.p.')
  const formattedValue = isPercentLike
    ? formatPercentNumber(absoluteValue)
    : chatCountFormatter.format(absoluteValue)

  return `${numericValue > 0 ? '+' : numericValue < 0 ? '-' : ''}${formattedValue}${suffix}`
}

function getTrendText(delta: number) {
  if (delta > 1) return 'crescimento frente ao período anterior'
  if (delta < -1) return 'queda frente ao período anterior'
  return 'estabilidade frente ao período anterior'
}

function buildDevelopmentFocus(result: MonthlyPodiumResult, delta: number) {
  if (result.eligible && delta >= 0) {
    return 'manter consistencia, proteger volume de avaliações e preparar boas praticas para compartilhar com a equipe.'
  }

  if (result.reviewPercentage < 25) {
    return 'aumentar o percentual de avaliações, reforcando o convite ao final dos atendimentos e acompanhando o volume semanal.'
  }

  if (result.averageCsat < result.individualGoal) {
    return 'revisar atendimentos com menor satisfação e escolher uma ação objetiva de melhoria para a próxima semana.'
  }

  if (delta < 0) {
    return 'investigar a queda recente e comparar os casos do período atual com o ciclo anterior.'
  }

  return 'manter acompanhamento semanal e buscar estabilidade ate o fechamento do ciclo.'
}

function startOfBusinessWeek(date: Date) {
  const start = new Date(date)
  const day = start.getDay()
  const diff = day === 0 ? -6 : 1 - day
  start.setDate(start.getDate() + diff)

  return start
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)

  return next
}

function toDateInputValue(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function getPointPosition(value: number, index: number, points: ChartPoint[], comparisonValues: number[] = []) {
  const values = [...points.map((point) => point.value), ...comparisonValues]
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const x = points.length === 1 ? 165 : 20 + (index / (points.length - 1)) * 290
  const y = 110 - ((value - min) / range) * 88

  return { x, y }
}

function buildLinePath(points: ChartPoint[], comparisonValues: number[] = []) {
  if (!points.length) return ''

  return points
    .map((point, index) => {
      const { x, y } = getPointPosition(point.value, index, points, comparisonValues)
      return `${index === 0 ? 'M' : 'L'} ${x} ${y}`
    })
    .join(' ')
}

function toNumber(value: string) {
  return Number(value || 0)
}

function isEndBeforeStart(start: string, end: string) {
  if (!start || !end) return false
  return end < start
}

function getInclusiveDayCount(start: string, end: string) {
  if (!start || !end || end < start) return 0

  const startDate = new Date(`${start}T00:00:00`)
  const endDate = new Date(`${end}T00:00:00`)
  return Math.round((endDate.getTime() - startDate.getTime()) / 86400000) + 1
}

function round(value: number) {
  return Math.round(value * 100) / 100
}

const chatCountFormatter = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

const chatPercentFormatter = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

function formatChatCount(value: number | string) {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? chatCountFormatter.format(numericValue) : '0'
}

function formatPercentNumber(value: number | string) {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? chatPercentFormatter.format(numericValue) : '0,00'
}

function formatPercent(value: number | string) {
  return `${formatPercentNumber(value)}%`
}

function formatValueWithSuffix(value: number | string, suffix = '') {
  return suffix === '%' ? formatPercent(value) : `${formatChatCount(value)}${suffix}`
}

function formatStatusText(value: string) {
  const normalizedValue = value.trim()
  return normalizedValue
    ? `${normalizedValue.charAt(0).toUpperCase()}${normalizedValue.slice(1)}`
    : ''
}

function formatQualitativeLabel(value: string) {
  const labels: Record<string, string> = {
    positive: 'Positivo',
    neutral: 'Neutro',
    negative: 'Negativo',
    mixed: 'Misto',
    unclear: 'Inconclusivo',
    low: 'Baixa',
    medium: 'Média',
    high: 'Alta',
    improved: 'Melhorou a experiência',
    worsened: 'Piorou a experiência',
    analyst: 'Analista',
    company: 'Empresa / processo interno',
    customer: 'Cliente',
    external: 'Fator externo',
    system_or_product: 'Sistema ou produto',
    process: 'Processo',
    wait_time: 'Tempo de espera',
    communication: 'Comunicação',
    resolution_quality: 'Qualidade da resolução',
    customer_expectation: 'Expectativa do cliente',
    other: 'Outro fator',
  }

  return labels[value] ?? formatStatusText(value.replace(/_/g, ' '))
}

function formatChatPercent(value: number | string) {
  return formatPercent(value)
}

function upsertAnalyst(analysts: Analyst[], updatedAnalyst: Analyst) {
  const exists = analysts.some((analyst) => analyst.id === updatedAnalyst.id)

  if (!exists) return [...analysts, updatedAnalyst].sort((a, b) => a.name.localeCompare(b.name))

  return analysts.map((analyst) =>
    analyst.id === updatedAnalyst.id ? updatedAnalyst : analyst,
  )
}

function upsertGoal(goals: Goal[], updatedGoal: Goal) {
  return goals
    .map((goal) => (goal.id === updatedGoal.id ? updatedGoal : goal))
    .sort((a, b) => a.label.localeCompare(b.label))
}

function withTimeout<T>(promise: PromiseLike<T>, message: string, timeoutMs = 10000) {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      window.setTimeout(() => reject(new Error(message)), timeoutMs)
    }),
  ])
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message

  if (error && typeof error === 'object') {
    const supabaseError = error as {
      message?: string
      details?: string
      hint?: string
      code?: string
    }
    const parts = [supabaseError.message, supabaseError.details, supabaseError.hint, supabaseError.code]
      .filter(Boolean)
      .map(String)

    if (parts.length) return parts.join(' | ')
  }

  return 'Não foi possível concluir a ação. Tente novamente.'
}

function getSupabaseMessage(message: string) {
  if (message.toLowerCase().includes('jwt issued at future')) return ''
  return message
}
