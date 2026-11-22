'use client'
import './chat.css'
import Link from 'next/link'
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '@/lib/supabase'
import { createSessionIdentityGuard } from '@/lib/session-identity'
import { calculateAverageCsat, calculateChatAverage, calculateTeamPerformance } from '@/lib/indicators'
import {
  buildChatPerformanceDiagnostic,
  type ChatPerformanceDiagnostic,
} from '@/lib/chat-diagnostic'
import { normalizeQualitativeAnalysis, qualitativeAnalysisVersion, QUALITATIVE_ANALYSIS_VERSION } from '@/lib/clickdesk-qualitative'
import { chatBusinessDate, chatPeriodBounds, selectChatPresentationRow } from '@/lib/chat-presentation'
import { clickDeskDailyAvailable, clickDeskPublicationDay, publishedClickDeskEnd, isOfficialClickDeskSource } from '@/lib/clickdesk-publication'
import { sumChatVoteRows } from '@/lib/clickdesk-csat'
import ChatTimeFilter from '@/components/chat/ChatTimeFilter'
import ChatNeutralReviews from '@/components/chat/ChatNeutralReviews'
import AnalystReviews from '@/components/chat/AnalystReviews'
import ChatAccessManagement from '@/components/chat/ChatAccessManagement'
import ChatReconciliationStatus from '@/components/chat/ChatReconciliationStatus'
import CxDiagnostics from '@/components/CxDiagnostics'
import ChatCaseManagement from '@/components/chat/ChatCaseManagement'
import { chatTimeRange, type ChatTimeMode } from '@/lib/chat-time-filter'
import ClickDeskSourceReport from '@/components/chat/ClickDeskSourceReport'
const QUALITATIVE_ANALYSIS_ENABLED_FOR_ANALYSTS = true

const OFFICIAL_RESOLUTION_POLICY = 'Campo Recebidos do relatório ClickDesk, nas filas ERP/Fiscal e no intervalo selecionado. A performance inclui somente os analistas do quadro aprovado; o total operacional pode incluir outros responsáveis e atendimentos sem responsável. As capturas são atualizadas a cada 30 minutos. O CSAT ajustado exclui somente neutros externos comprovados; todas as avaliações continuam na participação.'

function reconciliationReason(reason: string | null) {
  const labels: Record<string,string> = {
    history_incomplete: 'Histórico incompleto; autoria final ainda não comprovada.',
    final_author_not_in_eligible_registry: 'Último autor humano não identificado no cadastro elegível.',
    final_author_ambiguous: 'Autoria da última resposta ambígua.',
    no_public_human_answer: 'Sem resposta pública humana comprovada.',
    final_author_apprentice: 'Último atendente é aprendiz; excluído da performance, sem crédito ao atendente anterior.',
    final_answer_outside_period: 'Última resposta humana pertence a outro período.',
    credited_to_final_other_analyst: 'Crédito exclusivo de outro atendente final; participação anterior não é duplicada.',
    audit_deadline: 'Limite de tempo da consulta; aguarda nova conferência.',
    history_read_failed: 'Não foi possível consultar o histórico.',
    human_timestamp_missing: 'Horário da resposta humana não comprovado.',
    message_id_conflict: 'Evidências conflitantes para a mesma mensagem.',
    final_message_id_missing: 'Identificador da última mensagem ausente.',
  }
  return reason?.startsWith('clickdesk_http_') ? `Falha de leitura no ClickDesk (HTTP ${reason.slice(14)}).` : labels[reason ?? ''] ?? 'Pendente de conferência.'
}

async function feedbackRequestHeaders() {
    const {data:{session}}=await supabase.auth.getSession()
    if(!session?.access_token)throw new Error('Sua sessão expirou. Entre novamente para gerar o feedback.')
    return {'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`}
  }

type UserRole = 'master' | 'coordinator' | 'analyst'

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
  csat_original?: number | null
  excluded_neutrals?: number
  neutral_human?: number
  neutral_external?: number
  neutral_pending?: number
  review_percentage: number | null
}

type ClickDeskVerifiedCoverage = {
  source?: string
  status?: 'complementary_evidence_not_final'
  period?: { start: string; end: string }
  note?: string
  analysts?: Array<{
    analyst_id: string
    analyst_name: string
    team_id: string | null
    active: boolean
    distinct_tickets_with_human_contribution: number
    positive_reviews_with_last_human_evidence: number
    negative_reviews_with_last_human_evidence: number
    evaluated_with_last_human_evidence: number
  }>
  erro?: string
}

type ClickDeskPersistedMetrics = {
  publication?: {mode:string;available_through:string;daily_available?:boolean}
  reconciliation?: {
    captured_at: string
    pending_count: number
    retry_needed?: boolean
    pending: Array<{ ticket_id: string; reason: string | null }>
    excluded?: Array<{ ticket_id: string; reason: string }>
    coverage?: 'complete' | 'audit_sample_only' | 'stored_candidates_only'
    coverage_complete?: boolean
    coverage_sources?: Array<{ source_key: string; candidate_count: number; confirmed_count: number; pending_count: number; completeness: string }>
    pending_note?: string
  }
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
  sync_schedule?: {
    interval_minutes: number
    window_brt: string
    next_sync_at: string
  }
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
  analyst_takeaways?: { key: string; count: number }[]
  analysts?: {
    analyst_id: string
    analyst_name: string
    evaluated: number
    evaluated_positive: number
    evaluated_negative: number
    analyzed: number
    analyzed_positive: number
    analyzed_negative: number
    coverage_percentage: number
    approved: number
    pending: number
    rejected: number
    coaching_signals: number
    top_causes: { key: string; count: number }[]
  }[]
  pending_reviews?: {
    ticket_id: string
    analyst_id: string
    analyst_name: string
    satisfaction_label: string | null
    analysis: NonNullable<ClickDeskQualitativeResponse['analysis']>
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
  positive_validation_queue?: {
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

type ClickDeskOperation360Pattern = {
  key: string
  count: number
  percentage: number
  ticket_ids: string[]
  examples: string[]
}

type ClickDeskOperation360PatternGroup = {
  analyzed: number
  causes: ClickDeskOperation360Pattern[]
  controllability: ClickDeskOperation360Pattern[]
  human_influence: ClickDeskOperation360Pattern[]
  takeaways: ClickDeskOperation360Pattern[]
}

type ClickDeskOperation360Synthesis = {
  coverage_level: 'none' | 'initial' | 'partial' | 'strong'
  coverage_label: string
  headline: string
  negative_read: string
  control_read: string
  positive_read: string
  result_read: string
  recommended_focus?: string
  caveat: string
}

type ClickDeskOperation360 = {
  background?: {
    counts: { pending: number; processing: number; failed: number; done: number }
    health: { status: string; last_started_at: string | null; last_finished_at: string | null; error_code: string | null } | null
    failures: { ticket_id: string; error_code: string; attempts: number; next_attempt_at: string }[]
    refreshed_at: string
    inventory?: {
      scope: string
      run: { status: string; cutoff_date: string; error_code: string | null; finished_at: string | null }
      assessment: { candidate_count: number; confirmed_count: number; excluded_count: number; pending_count: number; complete: boolean; reasons: Record<string,number> } | null
      source_exclusions?: Array<{ticket_id:string;reason:string;source_deleted_at:string;verified_at:string}>
      source_exceptions?: Array<{ticket_id:string;reason:string;checked_at:string}>
      partitions: Record<string,number> | null
    } | null
  } | null
  source_coverage?: { status: 'complete' | 'audit_sample_only'; verified_at: string | null; note: string }
  source?: string
  period?: { start: string; end: string }
  scope?: { team_id: string | null }
  totals?: {
    attendances: number
    evaluated: number
    positive: number
    negative: number
    csat: number | null
    review_percentage: number | null
  }
  coverage?: {
    analyzed: number
    approved: number
    analyzed_percentage: number
    approved_percentage: number
    negative: {
      analyzed: number
      approved: number
      total: number
      analyzed_percentage: number
      approved_percentage: number
    }
    positive: {
      analyzed: number
      approved: number
      total: number
      analyzed_percentage: number
      approved_percentage: number
    }
  }
  preliminary_patterns?: {
    status: string
    total: number
    negative: ClickDeskOperation360PatternGroup
    positive: ClickDeskOperation360PatternGroup
  }
  preliminary_synthesis?: ClickDeskOperation360Synthesis
  validated_patterns?: {
    status: string
    total: number
    negative: ClickDeskOperation360PatternGroup
    positive: ClickDeskOperation360PatternGroup
  }
  validated_synthesis?: ClickDeskOperation360Synthesis
  analysis_status?: {
    pending: number
    approved: number
    rejected: number
    stale?: number
  }
  queues?: {
    negative_unanalyzed: {
      ticket_id: string
      analyst_id: string | null
      analyst_name: string
      area: string
      occurred_date: string
      occurred_at: string
      satisfaction_label: string | null
    }[]
    positive_unanalyzed: {
      ticket_id: string
      analyst_id: string | null
      analyst_name: string
      area: string
      occurred_date: string
      occurred_at: string
      satisfaction_label: string | null
    }[]
  }
  interpretation_rule?: {
    message: string
    causality: string
  }
  erro?: string
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
    analyst_takeaway: {
      kind: 'maintain' | 'develop' | 'context' | 'none'
      summary: string
      confidence: string
    }
    evidence_summary: string[]
    limitations: string[]
    cx_coaching: {
      negative_rating_hypothesis: string
      customer_experience_impact: string
      observable_analyst_behavior: string
      practice_to_improve: string
      suggested_phrase: string
      verification_check: string
      attribution_caution: string
      evidence_confidence: 'low' | 'medium' | 'high'
      source: 'generated' | 'contextual_from_existing_analysis'
    }
  }
  error?: string
  erro?: string
}

type ChatQualitativeFeedbackContext = {
  analyzedCount: number
  negativeAnalyzed: number
  positiveAnalyzed: number
  negativeTotal: number
  positiveTotal: number
  findings: {
    ticketId?: string
    satisfactionLabel: string | null
    occurredDate: string | null
    analysis: NonNullable<ClickDeskQualitativeResponse['analysis']>
  }[]
}

type ClickDeskHistoryPoint = {
  metric_source?: string
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
  accepted?: boolean
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

type ChartPoint = {
  label: string
  value: number
}

type ChatActiveTab = 'overview' | 'operation360' | 'prototype' | 'podium' | 'analysis' | 'reports' | 'import' | 'settings'

type ChatFeedbackStyle = 'coach' | 'sare' | 'mimo'

type FeedbackGoal = 'recognition' | 'courseCorrection' | 'maintenance' | 'development'

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

function Operation360PatternList({
  title,
  subtitle,
  patterns,
  tone = 'neutral',
  onOpenTicket,
  selectedTicketId = '',
  ticketLoading = false,
}: {
  title: string
  subtitle: string
  patterns: ClickDeskOperation360Pattern[]
  tone?: 'negative' | 'positive' | 'neutral'
  onOpenTicket?: (ticketId: string) => void
  selectedTicketId?: string
  ticketLoading?: boolean
}) {
  const shellClass =
    tone === 'negative'
      ? 'border-amber-300/15 bg-amber-300/5'
      : tone === 'positive'
        ? 'border-emerald-300/15 bg-emerald-300/5'
        : 'border-violet-300/15 bg-violet-300/5'

  return (
    <div className={`rounded-xl border p-4 ${shellClass}`}>
      <h4 className="font-semibold text-slate-100">{title}</h4>
      <p className="mt-1 text-xs leading-5 text-slate-500">{subtitle}</p>

      {patterns.length > 0 ? (
        <div className="mt-4 space-y-3">
          {patterns.slice(0, 6).map((pattern) => (
            <div key={pattern.key} className="rounded-lg border border-white/10 bg-slate-950/35 p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <strong className="text-sm text-slate-100">
                    {formatQualitativeLabel(pattern.key)}
                  </strong>
                  <p className="mt-1 text-xs text-slate-500">
                    {formatChatCount(pattern.count)} ocorrência(s) · {formatChatPercent(pattern.percentage)} da leitura analisada
                  </p>
                </div>
                <span className="rounded-md bg-slate-900 px-2 py-1 text-xs font-semibold text-slate-300">
                  {formatChatCount(pattern.count)}
                </span>
              </div>

              {pattern.examples.length > 0 && (
                <div className="mt-3 space-y-1 border-t border-white/10 pt-3">
                  {pattern.examples.slice(0, 2).map((example) => (
                    <p key={example} className="text-xs leading-5 text-slate-400">
                      {example}
                    </p>
                  ))}
                </div>
              )}

              {pattern.ticket_ids.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/10 pt-3">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-600">
                    Evidências
                  </span>
                  {pattern.ticket_ids.slice(0, 6).map((ticketId) => (
                    <button
                      key={ticketId}
                      type="button"
                      className="rounded-md border border-white/10 bg-slate-900 px-2 py-1 text-[11px] font-semibold text-slate-300 hover:border-cyan-300/30 hover:text-cyan-100 disabled:cursor-wait disabled:opacity-60"
                      disabled={ticketLoading && selectedTicketId === ticketId}
                      onClick={() => onOpenTicket?.(ticketId)}
                    >
                      {ticketLoading && selectedTicketId === ticketId ? 'Abrindo...' : `#${ticketId}`}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-dashed border-white/10 bg-slate-950/25 p-4 text-sm text-slate-500">
          Ainda não há análises suficientes para formar um padrão seguro neste recorte.
        </div>
      )}
    </div>
  )
}

function QualitativeAnalysisCard({
  result: rawResult,
  onReanalyze,
  reanalyzing = false,
  audience = 'management',
}: {
  result: ClickDeskQualitativeResponse
  onReanalyze?: () => void
  reanalyzing?: boolean
  audience?: 'management' | 'analyst'
}) {
  const result = rawResult.analysis
    ? { ...rawResult, analysis: normalizeQualitativeAnalysis(rawResult.analysis, rawResult.satisfaction_label) }
    : rawResult
  if (result.error) {
    return (
      <div className="mt-3 rounded-lg border border-amber-300/20 bg-amber-300/5 p-3 text-sm text-amber-100">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <strong className="block text-amber-50">Análise não concluída</strong>
            <p className="mt-1 leading-5">{result.error}</p>
          </div>
          {onReanalyze && (
            <button
              type="button"
              className="small-button self-start sm:self-auto"
              disabled={reanalyzing}
              onClick={onReanalyze}
            >
              {reanalyzing ? 'Tentando novamente...' : 'Tentar novamente'}
            </button>
          )}
        </div>
      </div>
    )
  }

  if (!result.analysis) return null

  const analystTakeawayLabel =
    result.analysis.analyst_takeaway.kind === 'maintain'
      ? 'O que vale manter'
      : result.analysis.analyst_takeaway.kind === 'develop'
        ? 'O que você pode desenvolver'
        : result.analysis.analyst_takeaway.kind === 'context'
          ? 'O que é importante contextualizar'
          : 'O que esta conversa permite concluir'

  return (
    <div className="mt-3 rounded-xl border border-violet-400/15 bg-violet-400/5 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-violet-200">
            {audience === 'analyst' ? 'Leitura da sua avaliação' : 'Leitura qualitativa do atendimento'}
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
              {audience === 'analyst'
                ? result.validation_status === 'approved'
                  ? 'Selecionada para feedback'
                  : result.validation_status === 'rejected'
                    ? 'Descartada do feedback'
                    : 'Disponível para seleção de feedback'
                : result.validation_status === 'approved'
                  ? 'Selecionada para feedback'
                  : result.validation_status === 'rejected'
                    ? 'Descartada do feedback'
                    : 'Ainda não selecionada para feedback'}
            </span>
          )}
        </div>
        {onReanalyze && audience === 'management' && (
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

      {audience === 'management' && (
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
            <span className="text-xs text-slate-500">Contexto principal observado</span>
            <strong className="mt-1 block text-sm">
              {formatQualitativeLabel(result.analysis.primary_cause.category)}
            </strong>
            <span className="mt-1 block text-xs text-slate-500">
              confiança {formatQualitativeLabel(result.analysis.primary_cause.confidence)}
            </span>
          </div>
          <div className="rounded-lg bg-slate-950/45 p-3">
            <span className="text-xs text-slate-500">Influência do atendimento humano</span>
            <strong className="mt-1 block text-sm">
              {formatQualitativeLabel(result.analysis.human_influence.classification)}
            </strong>
            <span className="mt-1 block text-xs text-slate-500">
              confiança {formatQualitativeLabel(result.analysis.human_influence.confidence)}
            </span>
          </div>
          <div className="rounded-lg bg-slate-950/45 p-3">
            <span className="text-xs text-slate-500">Onde estava o controle?</span>
            <strong className="mt-1 block text-sm">
              {formatQualitativeLabel(result.analysis.controllability.classification)}
            </strong>
          </div>
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
            O que estava acontecendo neste atendimento?
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            {result.analysis.primary_cause.summary}
          </p>
          {audience === 'management' ? (
            <>
              <p className="mt-3 text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
                Influência do atendimento humano
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                {result.analysis.human_influence.summary}
              </p>
            </>
          ) : (
            <>
              <p className="mt-3 text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
                O que estava sob seu controle?
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                {result.analysis.controllability.summary}
              </p>
            </>
          )}
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
        {audience === 'analyst' ? (
          <>
            <span className="text-slate-500">{analystTakeawayLabel}: </span>
            <strong
              className={
                result.analysis.analyst_takeaway.kind === 'maintain'
                  ? 'text-emerald-200'
                  : result.analysis.analyst_takeaway.kind === 'develop'
                    ? 'text-cyan-200'
                    : result.analysis.analyst_takeaway.kind === 'context'
                      ? 'text-violet-200'
                      : 'text-slate-300'
              }
            >
              {result.analysis.analyst_takeaway.summary}
            </strong>
          </>
        ) : (
          <>
            <span className="text-slate-500">Prática de CX para o próximo caso (sem atribuição automática de culpa): </span>
            <strong className="text-cyan-200">
              {result.analysis.cx_coaching.practice_to_improve}
            </strong>
          </>
        )}
      </div>
      <div className="mt-3 space-y-3 rounded-lg border border-cyan-300/15 bg-cyan-300/[0.04] p-4 text-sm">
        <p className="text-xs font-bold uppercase tracking-[0.12em] text-cyan-200">Coaching de experiência do cliente · causa e efeito</p>
        <div>
          <strong className="text-slate-100">{result.satisfaction_label === 'positive' ? 'O que pode explicar a avaliação positiva?' : 'Por que a nota pode ter sido negativa?'}</strong>
          <p className="mt-1 leading-6 text-slate-300">{result.analysis.cx_coaching.negative_rating_hypothesis}</p>
        </div>
        <div>
          <strong className="text-slate-100">Impacto percebido ou possível</strong>
          <p className="mt-1 leading-6 text-slate-300">{result.analysis.cx_coaching.customer_experience_impact}</p>
        </div>
        <div>
          <strong className="text-slate-100">O que o atendimento demonstrou</strong>
          <p className="mt-1 leading-6 text-slate-300">{result.analysis.cx_coaching.observable_analyst_behavior}</p>
        </div>
        <div>
          <strong className="text-slate-100">Como conduzir um caso semelhante</strong>
          <p className="mt-1 leading-6 text-cyan-100">{result.analysis.cx_coaching.practice_to_improve}</p>
          <p className="mt-2 rounded-md bg-slate-950/55 p-3 italic leading-6 text-slate-300">“{result.analysis.cx_coaching.suggested_phrase}”</p>
        </div>
        <div>
          <strong className="text-slate-100">O que a gestão deve verificar na próxima amostra</strong>
          <p className="mt-1 leading-6 text-slate-300">{result.analysis.cx_coaching.verification_check}</p>
        </div>
        <p className="border-t border-white/10 pt-3 text-xs leading-5 text-amber-100">
          {result.analysis.cx_coaching.attribution_caution}
          {result.analysis.cx_coaching.source === 'contextual_from_existing_analysis'
            ? ' · Sugestão elaborada a partir do diagnóstico preservado; não é uma nova leitura do transcript.'
            : ' · Sugestão da IA sujeita à validação da gestão.'}
        </p>
      </div>
    </div>
  )
}

function QualitativeValidationActions({
  ticketId,
  status,
  validating,
  onValidate,
}: {
  ticketId: string
  status?: 'pending' | 'approved' | 'rejected'
  validating: boolean
  onValidate: (ticketId: string, status: 'pending' | 'approved' | 'rejected') => void
}) {

  return (
    <div className="mt-3 flex flex-col gap-3 rounded-lg border border-white/10 bg-slate-950/30 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <strong className="text-sm text-slate-100">{status === 'approved' ? 'Selecionada para feedback' : status === 'rejected' ? 'Descartada do feedback' : 'Disponível para selecionar quando for útil'}</strong>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          Escolha os tickets que deseja usar nos próximos relatórios de feedback. A escolha é opcional, pode ser revista e não altera a nota do cliente, o CSAT ou outros KPIs.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="small-button"
          disabled={validating || status === 'approved'}
          onClick={() => onValidate(ticketId, 'approved')}
        >
          {validating ? 'Salvando...' : 'Selecionar para feedback'}
        </button>
        <button
          type="button"
          className="danger-button"
          disabled={validating || status === 'rejected'}
          onClick={() => onValidate(ticketId, 'rejected')}
        >
          Descartar do feedback
        </button>
        {status && status !== 'pending' && (
          <button type="button" className="small-button" disabled={validating}
            onClick={() => onValidate(ticketId, 'pending')}>
            Limpar escolha
          </button>
        )}
      </div>
    </div>
  )
}

function ChatMetricHelp({text}:{text:string}){return <details className="relative ml-1 inline-block align-middle"><summary className="cursor-pointer list-none text-xs text-cyan-300" aria-label="Entender indicador">ⓘ</summary><p className="absolute left-0 top-5 z-20 w-64 rounded-lg border border-white/10 bg-slate-950 p-3 text-xs font-normal leading-5 text-slate-300 shadow-xl">{text}</p></details>}

function ChatSharedPerformanceSummary({ metric, csatGoal, dailyAvailable = true }: {
  metric: ClickDeskPersistedAggregate & { today?: ClickDeskPersistedAggregate } | null
  csatGoal: number
  dailyAvailable?: boolean
}) {
  const accumulated = metric
  const today = metric?.today ?? null
  const csat = metric?.csat ?? null
  const reviewPercentage = metric?.review_percentage ?? null
  const reviewGoal = 25
  const diagnostic = buildChatPerformanceDiagnostic({
    csat, csatGoal, reviewPercentage, reviewGoal,
    positiveReviews: metric?.positive_reviews ?? 0,
    negativeReviews: metric?.negative_reviews ?? 0,
    attendances: metric?.attendances ?? 0,
  })
  const meetsCsat = diagnostic.csatMet === true
  const meetsReviews = diagnostic.reviewMet === true
  if (!metric) return <EmptyState text="Sem base individual consolidada para esta competência. Ausência de captura não comprova zero atendimentos." />
  return (
            <div className="mt-6">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                Resumo do intervalo selecionado
              </p>
              {metric.csat_original!==undefined&&<details className="mt-2 text-xs text-slate-400"><summary className="cursor-pointer">CSAT original e ajustes</summary><p className="mt-2">Original: {metric.csat_original===null?'—':formatChatPercent(metric.csat_original)} · {metric.excluded_neutrals??0} neutro(s) externo(s) retirado(s) apenas do CSAT ajustado. As {metric.reviews} avaliações permanecem na participação; {metric.neutral_pending??0} neutro(s) aguardam revisão.</p></details>}
              <div className="mt-3 grid gap-4 lg:grid-cols-3">
                <div className="rounded-xl border border-white/10 bg-slate-950/40 p-5">
                  <p className="text-sm text-slate-400">Atendimentos <ChatMetricHelp text="Total de Recebidos no cabeçalho do relatório ClickDesk, filtrado por este analista, pelas filas ERP/Fiscal e pelo intervalo selecionado." /></p>
                  <strong className="mt-2 block text-3xl tabular-nums text-slate-100">
                    {formatChatCount(accumulated?.attendances ?? 0)}
                  </strong>
                  <div className="mt-4 flex items-center justify-between gap-4 border-t border-white/10 pt-3 text-sm">
                    <span className="text-slate-500">Atendimentos hoje</span>
                    <strong className="tabular-nums text-slate-200">
                      {dailyAvailable && today ? formatChatCount(today.attendances) : '—'}
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
                      <p className="text-sm text-slate-400">CSAT ajustado <ChatMetricHelp text="Positivas ÷ avaliações consideradas. Apenas neutros externos comprovados são retirados deste cálculo; as respostas originais são preservadas." /></p>
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
                    <a className="text-slate-500 hover:text-emerald-200" href="#minha-rotina">
                      Positivas <strong className="text-slate-200">{formatChatCount(accumulated?.positive_reviews ?? 0)}</strong>
                      <span className="ml-1 text-xs">ver tickets</span>
                    </a>
                    <a className="text-slate-500 hover:text-amber-100" href="#minha-rotina">
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
                      <p className="text-sm text-slate-400">% de avaliações <ChatMetricHelp text="Avaliações recebidas ÷ atendimentos do período. Neutros externos continuam nesta quantidade; respostas podem se referir a atendimentos de dias anteriores." /></p>
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


  )
}

function ManagementDailyFeedback({
  analystId, days, onSelectionSaved,
}: {
  analystId: string
  days: Array<ClickDeskPersistedAggregate & { date: string }>
  onSelectionSaved: () => void
}) {
  const [date, setDate] = useState('')
  const [tickets, setTickets] = useState<ClickDeskDailyTicketResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [busyTicket, setBusyTicket] = useState('')
  const [results, setResults] = useState<Record<string, ClickDeskQualitativeResponse>>({})
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!date) return
    let active = true
    setLoading(true)
    setTickets(null)
    setResults({})
    setMessage('')
    void (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) throw new Error('Sua sessão expirou. Entre novamente.')
        const params = new URLSearchParams({ date, analyst_id: analystId })
        const response = await fetch('/api/clickdesk/tickets?' + params, {
          headers: { Authorization: 'Bearer ' + session.access_token }, cache: 'no-store',
        })
        const data = await response.json() as ClickDeskDailyTicketResponse
        if (!response.ok) throw new Error(data.erro || 'Não foi possível carregar os tickets.')
        if (active) setTickets(data)
      } catch (error) {
        if (active) setMessage(getErrorMessage(error))
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [date, analystId])

  async function analyze(ticketId: string) {
    setBusyTicket(ticketId)
    setMessage('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Sua sessão expirou. Entre novamente.')
      const response = await fetch('/api/clickdesk/qualitative', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket_id: ticketId, force: false }),
      })
      const data = await response.json() as ClickDeskQualitativeResponse
      if (!response.ok || data.error || data.erro) throw new Error(data.error || data.erro || 'Falha ao carregar análise.')
      setResults(current => ({ ...current, [ticketId]: data }))
    } catch (error) { setMessage(getErrorMessage(error)) }
    finally { setBusyTicket('') }
  }

  async function select(ticketId: string, status: 'pending' | 'approved' | 'rejected') {
    setBusyTicket(ticketId)
    setMessage('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Sua sessão expirou. Entre novamente.')
      const response = await fetch('/api/clickdesk/qualitative-validation', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket_id: ticketId, status }),
      })
      const data = await response.json() as ClickDeskQualitativeResponse
      if (!response.ok || data.error || data.erro) throw new Error(data.error || data.erro || 'Falha ao salvar seleção.')
      setResults(current => ({ ...current, [ticketId]: { ...current[ticketId], ...data } }))
      onSelectionSaved()
    } catch (error) { setMessage(getErrorMessage(error)) }
    finally { setBusyTicket('') }
  }

  return (
    <section id="minha-rotina" className="workspace-content-section rounded-xl border border-white/10 p-5">
      <h3 className="text-xl font-bold">Régua diária · selecionar tickets para feedback</h3>
      <p className="mt-2 text-sm text-slate-400">{days.length ? "Abra um dia e escolha os casos positivos ou negativos que deseja levar ao feedback. A seleção é opcional e não altera os indicadores." : "Os totais deste período estão disponíveis, mas a seleção de tickets por dia ainda aguarda uma base diária conciliada."}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {days.map(day => (
          <button key={day.date} type="button" className="small-button" disabled={Boolean(busyTicket)}
            aria-pressed={date === day.date} onClick={() => setDate(day.date)}>
            {formatDate(day.date)} · {day.positive_reviews} positivas · {day.negative_reviews} negativas
          </button>
        ))}
      </div>
      {loading && <p role="status" className="mt-4">Carregando tickets do dia...</p>}
      {message && <p role="alert" className="mt-4 text-amber-100">{message}</p>}
      {date && tickets && (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-slate-400">{formatDate(date)} · {tickets.tickets?.length ?? 0} tickets carregados</p>
          {(tickets.tickets ?? []).map(ticket => (
            <div key={ticket.ticket_id} className="rounded-lg border border-white/10 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <strong>Ticket #{ticket.ticket_id} · {ticket.satisfaction_label === 'positive' ? 'Positiva' : ticket.satisfaction_label === 'negative' ? 'Negativa' : 'Sem avaliação'}</strong>
                {(ticket.satisfaction_label === 'positive' || ticket.satisfaction_label === 'negative') && (
                  <button type="button" className="small-button" disabled={Boolean(busyTicket)}
                    onClick={() => void analyze(ticket.ticket_id)}>
                    {busyTicket === ticket.ticket_id ? 'Carregando...' : 'Ver análise para feedback'}
                  </button>
                )}
              </div>
              {results[ticket.ticket_id]?.analysis && (
                <>
                  <QualitativeAnalysisCard result={results[ticket.ticket_id]} audience="management" />
                  <QualitativeValidationActions ticketId={ticket.ticket_id}
                    status={results[ticket.ticket_id].validation_status}
                    validating={Boolean(busyTicket)}
                    onValidate={(id, status) => void select(id, status)} />
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
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
  const dailyTicketRequest = useRef(0)
  const [qualitativeByTicket, setQualitativeByTicket] = useState<Record<string, ClickDeskQualitativeResponse>>({})
  const [qualitativeLoadingTicketId, setQualitativeLoadingTicketId] = useState('')
  const [openQualitativeTicketId, setOpenQualitativeTicketId] = useState<string | null>(null)

  const businessToday = chatBusinessDate()
  const [monthKey, setMonthKey] = useState(() => businessToday.slice(0, 7))
  const [timeMode,setTimeMode]=useState<ChatTimeMode>('month')
  const [timeReference,setTimeReference]=useState('')
  const {start:monthStart,end:monthEnd}=chatTimeRange(monthKey,timeMode,timeReference)
  const monthLabel = new Intl.DateTimeFormat('pt-BR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(`${monthStart}T12:00:00Z`))
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
    let retryTimer: number | undefined
    let deadlineRetries = 0

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
        const [metricResponse, historyResponse] = await Promise.all([
          fetch(`/api/clickdesk/metrics?${metricParams.toString()}`, {
            headers,
            cache: 'no-store',
          }),
          fetch(`/api/clickdesk/history?${historyParams.toString()}`, {
            headers,
            cache: 'no-store',
          }),
        ])

        const [metricData, historyData] = await Promise.all([
          metricResponse.json() as Promise<ClickDeskPersistedMetrics>,
          historyResponse.json() as Promise<ClickDeskAnalystHistory>,
        ])

        if (!metricResponse.ok) {
          metricData.erro =
            metricData.erro || 'Não foi possível carregar seus indicadores do Chat.'
        }
        if (!historyResponse.ok) {
          historyData.erro =
            historyData.erro || 'Não foi possível carregar seu histórico do Chat.'
        }
        if (!cancelled) {
          setMetrics(metricData)
          setHistory(historyData)
          if(metricData.reconciliation?.retry_needed && deadlineRetries<2) {
            deadlineRetries++
            retryTimer=window.setTimeout(()=>{if(!cancelled)void loadOwnChatData()},5000)
          }
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
    // Durante a reconciliação incremental, atualize os indicadores leves
    // sem exigir que o analista recarregue a página manualmente.
    const refreshTimer = window.setInterval(() => {
      void loadOwnChatData()
    }, 30 * 60 * 1000)

    return () => {
      cancelled = true
      window.clearInterval(refreshTimer)
      window.clearTimeout(retryTimer)
    }
  }, [analyst?.id, monthStart, monthEnd])

  function changeRoutineMonth(value: string) {
    if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(value) || value === monthKey) return
    setMonthKey(value)
    setMetrics(null)
    setHistory(null)
    setSelectedRoutineDate(null)
    setDailyTickets(null)
    setOpenQualitativeTicketId(null)
    setQualitativeByTicket({})
  }

  async function analyzeQualitativeTicket(ticketId: string, force = false) {
    if (!force && openQualitativeTicketId === ticketId) {
      setOpenQualitativeTicketId(null)
      return
    }
    setOpenQualitativeTicketId(ticketId)
    if (!force && qualitativeByTicket[ticketId]?.analysis) return
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
      const rawQualitativeError = data.error || data.erro
      data.error = rawQualitativeError
        ? getQualitativeUserError(rawQualitativeError, response.status)
        : undefined

      if (!response.ok && !data.error) {
        data.error = getQualitativeUserError('', response.status)
      }

      setQualitativeByTicket((current) => ({ ...current, [ticketId]: data }))

    } catch {
      setQualitativeByTicket((current) => ({
        ...current,
        [ticketId]: { error: getQualitativeUserError('', 503) },
      }))
    } finally {
      setQualitativeLoadingTicketId('')
    }
  }

  async function loadDailyTickets(date: string) {
    if (!analyst?.id) return
    const requestId = ++dailyTicketRequest.current

    setOpenQualitativeTicketId(null)
    if (selectedRoutineDate === date) {
      setSelectedRoutineDate(null)
      setDailyTickets(null)
      return
    }
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

      if (requestId === dailyTicketRequest.current) setDailyTickets(data)
    } catch (error) {
      if (requestId === dailyTicketRequest.current) setDailyTickets({ erro: getErrorMessage(error) })
    } finally {
      if (requestId === dailyTicketRequest.current) setDailyTicketsLoading(false)
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

  const ownSelection = selectChatPresentationRow(metrics?.by_analyst ?? [], analyst.id)
  const ownMetric = ownSelection.row
  const accumulated = ownMetric
  const today = ownMetric?.today ?? null
  const daily = ownMetric?.daily ?? []
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
  const todayKey = businessToday
  const firstVisibleDay=Number(monthStart.slice(-2))
  const visibleDayCount=monthEnd<monthStart?0:Number(monthEnd.slice(-2))-firstVisibleDay+1
  const ruler = Array.from({ length: visibleDayCount }, (_, index) => {
    const day = String(index + firstVisibleDay).padStart(2, '0')
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
    <div className="analyst-portal mt-6 space-y-5">
      <section className="panel analyst-portal-hero">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-cyan-300">
            Chat · acesso individual
          </p>
          <span className="rounded-md border border-white/10 bg-slate-950/40 px-3 py-2 text-xs text-slate-400">
            Somente seus dados
          </span>
        </div>
        <label className="mt-3 flex items-center gap-3 text-sm text-slate-400">
          Competência
          <input type="month" aria-label="Competência do meu desempenho" value={monthKey} max={businessToday.slice(0, 7)} className="form-input max-w-48"
            onInput={event => changeRoutineMonth(event.currentTarget.value)}
            onChange={event => changeRoutineMonth(event.currentTarget.value)} />
        </label>
        <ChatTimeFilter month={monthKey} mode={timeMode} reference={timeReference} dailyAvailable={clickDeskDailyAvailable(metrics)} onChange={(mode,reference)=>{const next=chatTimeRange(monthKey,mode,reference);if(next.start!==monthStart||next.end!==monthEnd){setMetrics(null);setSelectedRoutineDate(null);setDailyTickets(null);setOpenQualitativeTicketId(null)}setTimeMode(mode);setTimeReference(reference)}} />
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
                  {displayMonthLabel} · {timeMode==='month'?'Mês':timeMode==='week'?'Semana':timeMode==='custom'?'Personalizado':'Dia'} · ClickDesk
                </p>
                <div className="mt-2">
                  <ClickDeskSyncStatus
                    latestSyncAt={metrics?.latest_sync?.finished_at}
                    schedule={metrics?.sync_schedule}
                    historical={monthKey.replace(/-(\d)$/, '-0$1') < businessToday.slice(0, 7)}
                    compact
                  />
                </div>
              </div>
            </div>

            {!loading && metrics && !metrics.erro && !podiumContext && <p className="text-sm text-slate-400" role="status">Comparação do time aguardando a conferência deste período.</p>}
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
                      {formatPercentNumber(podiumContext.team_average_attendances)}
                    </strong>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="analyst-status-card rounded-lg border border-cyan-400/20 bg-cyan-400/5 px-4 py-3 text-sm">
            <p className="text-slate-400">Situação atual</p>
            <strong className="mt-1 block text-cyan-100">{loading ? 'Consultando indicadores' : status}</strong>
            {!loading && !metrics?.erro && <span className="mt-1 block text-xs text-slate-400">
              {Number(meetsCsat) + Number(meetsReviews)} de 2 metas atingidas
            </span>}
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
            <details className="mt-4 rounded-lg border border-white/10 p-3 text-xs leading-5 text-slate-400"><summary className="cursor-pointer">Como os números são contados</summary><p className="mt-2">
              Fonte: {isOfficialClickDeskSource(metrics?.source)?'volume por responsável no relatório ClickDesk':'último atendimento público humano comprovado'} · {formatDate(monthStart)} a {formatDate(monthEnd)} · horário de Brasília.
              {' '}{metrics?.reconciliation?.coverage === 'complete'
                ? 'A captura e a conciliação deste corte foram conferidas. Este atestado não substitui um fechamento mensal aprovado.'
                : 'A conciliação histórica está pendente. Sincronização concluída não garante cobertura completa; esta leitura não substitui o fechamento oficial.'}
              {isOfficialClickDeskSource(metrics?.source) && <span className="mt-2 block">{OFFICIAL_RESOLUTION_POLICY}</span>}
              {ownSelection.ambiguous && ' Há mais de uma fila para seu cadastro neste período. O resumo individual fica indisponível até a conferência, sem somar ou escolher uma fila por suposição.'}
              {metrics?.date_basis?.status === 'needs_validation' && ` ${metrics.date_basis.note}`}
            </p></details>
            {metrics?.reconciliation && metrics.source!=='clickdesk_event_receipts' && <details className="mt-3 rounded-lg border border-white/10 p-3 text-xs text-slate-400">
              <summary className="cursor-pointer">Conferência da autoria · {metrics.reconciliation.pending_count} ticket(s) pendente(s)</summary>
              <p className="mt-2">Um ticket tem um único crédito. Competência definida pela última resposta pública humana em Brasília. Snapshot: {formatDateTime(metrics.reconciliation.captured_at)}. Sem resposta ou cobertura comprovada, o ticket permanece fora dos indicadores.</p>
              <ul className="mt-2 space-y-1">{metrics.reconciliation.pending.map(item => <li key={item.ticket_id}>Ticket {item.ticket_id}: {reconciliationReason(item.reason)}</li>)}</ul>
              <ul className="mt-2 space-y-1">{metrics.reconciliation.excluded?.map(item => <li key={item.ticket_id}>Ticket {item.ticket_id}: {reconciliationReason(item.reason)}</li>)}</ul>
            </details>}
            <ChatSharedPerformanceSummary metric={accumulated} csatGoal={csatGoal} dailyAvailable={clickDeskDailyAvailable(metrics) && monthStart<=clickDeskPublicationDay() && monthEnd>=clickDeskPublicationDay()} />
            {isOfficialClickDeskSource(metrics?.source) && monthStart>='2026-11-01' && <ChatNeutralReviews start={monthStart} end={monthEnd} analystId={analyst?.id} />}

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
                    Média do time: {formatPercentNumber(podiumContext.team_average_attendances)} atendimentos
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

          </>
        )}
      </section>

      <AnalystReviews key={`${analyst.id}:${monthStart}:${monthEnd}`} start={monthStart} end={monthEnd} analystId={analyst.id}
        onAnalyze={(id) => void analyzeQualitativeTicket(id)} loadingTicketId={qualitativeLoadingTicketId}
        renderAnalysis={(id) => qualitativeByTicket[id] && openQualitativeTicketId === id ? <QualitativeAnalysisCard result={qualitativeByTicket[id]} reanalyzing={qualitativeLoadingTicketId === id} audience="analyst" /> : null} />
      <section id="minha-rotina" className={loading || metrics?.erro ? 'hidden' : 'panel scroll-mt-24'}>
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
          <div className="flex flex-wrap gap-2 self-start">
            <span className="rounded-md border border-white/10 bg-slate-950/40 px-3 py-2 text-xs text-slate-400">
              {clickDeskDailyAvailable(metrics) ? `${activeRoutineDays.length} ${activeRoutineDays.length === 1 ? 'dia com atividade' : 'dias com atividade'}` : 'Distribuição diária em conferência'}
            </span>
            <span className="rounded-md border border-amber-300/15 bg-amber-300/5 px-3 py-2 text-xs text-amber-100">
              {formatChatCount(accumulated?.negative_reviews ?? 0)} negativas no intervalo
            </span>
            <span className="rounded-md border border-emerald-400/15 bg-emerald-400/5 px-3 py-2 text-xs text-emerald-200">
              {formatChatCount(accumulated?.positive_reviews ?? 0)} positivas no intervalo
            </span>
          </div>
        </div>

        {activeRoutineDays.length ? (
          <div className="mt-5 flex flex-wrap gap-2">
            {activeRoutineDays.map((item) => {
              const selected = selectedRoutineDate === item.date
              return (
                <button
                  key={item.date}
                  type="button"
                  aria-expanded={selected}
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
          <EmptyState text={clickDeskDailyAvailable(metrics) ? "Nenhum dia com atendimento no intervalo selecionado." : "Os totais do período estão disponíveis. Os dias serão exibidos quando a distribuição diária estiver conciliada com esses totais."} />
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
                  setOpenQualitativeTicketId(null)
                  setSelectedRoutineDate(null)
                  setDailyTickets(null)
                }}
              >
                Fechar detalhe
              </button>
            </div>

            <p className="mt-3 text-xs text-slate-400">Esta lista reúne tickets persistidos para consulta. Ela pode diferir dos Recebidos do relatório individual; os indicadores acima continuam usando o relatório ClickDesk conciliado.</p>
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
                  const qualitativeOpen = openQualitativeTicketId === ticket.ticket_id
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
                              onClick={() => {
                                if (qualitativeResult?.analysis) {
                                  setOpenQualitativeTicketId((current) =>
                                    current === ticket.ticket_id ? null : ticket.ticket_id,
                                  )
                                  return
                                }
                                void analyzeQualitativeTicket(ticket.ticket_id)
                              }}
                            >
                              {qualitativeLoading
                                ? 'Analisando...'
                                : qualitativeResult?.analysis
                                  ? qualitativeOpen
                                    ? 'Fechar análise'
                                    : 'Ver análise'
                                  : 'Analisar com IA'}
                            </button>
                          ) : (
                            <span className="text-xs font-semibold text-violet-200">IA em preparação</span>
                          )
                        ) : (
                          <span className="text-xs text-slate-600">Sem análise</span>
                        )}
                      </div>

                      {QUALITATIVE_ANALYSIS_ENABLED_FOR_ANALYSTS && qualitativeResult && qualitativeOpen && (
                        <QualitativeAnalysisCard
                          result={qualitativeResult}
                          reanalyzing={qualitativeLoading}
                          audience="analyst"
                          onReanalyze={
                            qualitativeResult.error
                              ? () => void analyzeQualitativeTicket(ticket.ticket_id)
                              : undefined
                          }
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

      <section className={loading ? 'hidden' : 'panel'}>
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-cyan-300">
          Minha evolução
        </p>
        <h3 className="mt-2 text-2xl font-bold">Histórico ClickDesk</h3>
        <p className="section-subtitle">
          Histórico mensal: não acompanha os filtros de dia, semana ou intervalo acima. O mês atual mostra o acumulado até a última atualização; meses fechados mantêm o resultado aprovado.
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
                          : isOfficialClickDeskSource(item.metric_source) ? 'Relatório ClickDesk do período · última atualização' : 'Base de autoria humana · escopo diferente do relatório'}
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
                        <p className="mt-2 text-xs text-slate-400">{item.reviews} avaliações · {item.positive_reviews} boas · {item.negative_reviews} ruins</p>
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
  chatActiveTab,
  onChatActiveTabChange,
  onImportComplete,
}: {
  role: UserRole
  teams: ChatTeam[]
  analysts: ChatAnalyst[]
  metrics: ChatMonthlyMetric[]
  manualPodium: ChatPodiumManual[]
  podiumExclusions: ChatPodiumExclusion[]
  loading: boolean
  chatActiveTab: ChatActiveTab
  onChatActiveTabChange: (tab: ChatActiveTab) => void
  onImportComplete: () => Promise<void>
}) {
  const isManagementUser = role !== 'analyst'
  const [chatCaseRefresh,setChatCaseRefresh]=useState(0)
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
  const [chatTimeMode,setChatTimeMode]=useState<ChatTimeMode>('month')
  const [chatTimeReference,setChatTimeReference]=useState('')
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
  const [chat2AnalystId, setChat2AnalystId] = useState('')
  const [chat2LiveAnalystKey, setChat2LiveAnalystKey] = useState('')
  const [chat2PeriodKey, setChat2PeriodKey] = useState('')
  const [chat2DailyDateFilter, setChat2DailyDateFilter] = useState('all')
  const [clickDeskTestLoading, setClickDeskTestLoading] = useState(false)
  const [clickDeskTestResult, setClickDeskTestResult] = useState<ClickDeskTestResult | null>(null)
  const [clickDeskConversationLoading, setClickDeskConversationLoading] = useState(false)
  const [clickDeskConversationDiagnostic, setClickDeskConversationDiagnostic] = useState<ClickDeskConversationDiagnostic | null>(null)
  const [clickDeskPersistedMetrics, setClickDeskPersistedMetrics] = useState<ClickDeskPersistedMetrics | null>(null)
  const [clickDeskVerifiedCoverage, setClickDeskVerifiedCoverage] = useState<ClickDeskVerifiedCoverage | null>(null)
  const [clickDeskVerifiedCoverageLoading, setClickDeskVerifiedCoverageLoading] = useState(false)
  const [clickDeskMetricsLoading, setClickDeskMetricsLoading] = useState(false)
  const chatMetricsReady = !clickDeskMetricsLoading && !clickDeskPersistedMetrics?.erro && Boolean(clickDeskPersistedMetrics?.by_analyst?.length)
  const clickDeskMetricsRequestVersion = useRef(0)
  useEffect(() => () => { clickDeskMetricsRequestVersion.current++ }, [])
  const [clickDeskPreviousMetrics, setClickDeskPreviousMetrics] = useState<ClickDeskPersistedMetrics | null>(null)
  const [captureNotice,setCaptureNotice]=useState('')
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
  const [clickDeskQualitativeResultSource, setClickDeskQualitativeResultSource] = useState<'queue' | 'manual'>('queue')
  const [clickDeskQualitativeSummary, setClickDeskQualitativeSummary] = useState<ClickDeskQualitativeSummary | null>(null)
  const [clickDeskQualitativeSummaryLoading, setClickDeskQualitativeSummaryLoading] = useState(false)
  const [clickDeskQualitativeSummaryRefresh, setClickDeskQualitativeSummaryRefresh] = useState(0)
  const [clickDeskQualitativeValidationTicketId, setClickDeskQualitativeValidationTicketId] = useState('')
  const [clickDeskOperation360, setClickDeskOperation360] = useState<ClickDeskOperation360 | null>(null)
  const [clickDeskOperation360Loading, setClickDeskOperation360Loading] = useState(false)
  const [clickDeskOperation360Refresh, setClickDeskOperation360Refresh] = useState(0)
  const [clickDeskOperation360Analyzing, setClickDeskOperation360Analyzing] = useState<'negative' | 'positive' | 'all' | ''>('')
  const operation360RequestSequence = useRef(0)
  const [clickDeskOperation360Message, setClickDeskOperation360Message] = useState('')
  const [clickDeskOperation360EvidenceTicketId, setClickDeskOperation360EvidenceTicketId] = useState('')
  const [clickDeskOperation360EvidenceLoading, setClickDeskOperation360EvidenceLoading] = useState(false)
  const [clickDeskOperation360Evidence, setClickDeskOperation360Evidence] = useState<ClickDeskQualitativeResponse | null>(null)
  const [chatQualitativeFocusAnalystId, setChatQualitativeFocusAnalystId] = useState('')
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
        setClickDeskTestResult({ configured: false, error: 'Sua sessão expirou. Entre novamente.' })
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
        setClickDeskAnalystHistory({ erro: 'Sua sessão expirou. Entre novamente.' })
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
    deadlineRetry = 0,
  ) {
    const requestVersion = ++clickDeskMetricsRequestVersion.current
    setClickDeskMetricsLoading(true)
    // Nunca mantenha números de outra equipe ou competência enquanto a API carrega.
    if (deadlineRetry === 0) setClickDeskPersistedMetrics(null)
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session?.access_token) {
        if (requestVersion === clickDeskMetricsRequestVersion.current) {
          setClickDeskPersistedMetrics({ erro: 'Sessão indisponível. Entre novamente no painel.' })
        }
        return
      }

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
        data.erro = data.erro || 'Não foi possível carregar os indicadores do ClickDesk.'
      }

      if (requestVersion !== clickDeskMetricsRequestVersion.current) return
      setClickDeskPersistedMetrics(data)
      if (data.reconciliation?.retry_needed && deadlineRetry < 2) {
        window.setTimeout(() => {
          if (requestVersion === clickDeskMetricsRequestVersion.current) {
            void loadClickDeskPersistedMetricsOnly(period, teamId, deadlineRetry + 1)
          }
        }, 5000)
      }
    } catch (error) {
      if (requestVersion === clickDeskMetricsRequestVersion.current) {
        setClickDeskPersistedMetrics({ erro: getErrorMessage(error) })
      }
    } finally {
      if (requestVersion === clickDeskMetricsRequestVersion.current) {
        setClickDeskMetricsLoading(false)
      }
    }
  }

  async function loadClickDeskPreviousMetricsOnly(
    period: { start: string; end: string },
    teamId: string,
  ) {
    setClickDeskPreviousMetrics(null)
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
        setClickDeskConversationDiagnostic({ error: 'Sua sessão expirou. Entre novamente.' })
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
      if(syncResponse.ok&&syncData.accepted){setCaptureNotice('Captura oficial solicitada. Os indicadores mantêm a última captura válida até a conclusão da fila.');return}

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
        setClickDeskClosureMessage('Sua sessão expirou. Entre novamente.')
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
        setClickDeskClosureMessage('Sua sessão expirou. Entre novamente.')
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
        setClickDeskAiRoutingDiagnostic({ error: 'Sua sessão expirou. Entre novamente.' })
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

  async function runManagementQualitativeAnalysis(ticketId: string, source: 'queue' | 'manual' = 'queue') {
    const normalizedTicketId = ticketId.trim()
    if (!normalizedTicketId) {
      setClickDeskQualitativeResult({ error: 'Informe um ticket persistido para validar a análise.' })
      return
    }

    setClickDeskQualitativeTicketId(normalizedTicketId)
    setClickDeskQualitativeResultSource(source)
    setClickDeskQualitativeLoading(true)
    setClickDeskQualitativeResult(null)

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session?.access_token) {
        setClickDeskQualitativeResult({ error: 'Sua sessão expirou. Entre novamente.' })
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
      const rawQualitativeError = data.error || data.erro
      data.error = rawQualitativeError
        ? getQualitativeUserError(rawQualitativeError, response.status)
        : undefined

      if (!response.ok && !data.error) {
        data.error = getQualitativeUserError('', response.status)
      }

      setClickDeskQualitativeResult(data)

      if (response.ok && !data.error && data.analysis) {
        setClickDeskQualitativeSummaryRefresh((current) => current + 1)
      }
    } catch {
      setClickDeskQualitativeResult({ error: getQualitativeUserError('', 503) })
    } finally {
      setClickDeskQualitativeLoading(false)
    }
  }

  async function handleAnalyzeClickDeskQualitative() {
    await runManagementQualitativeAnalysis(clickDeskQualitativeTicketId, 'manual')
  }

  async function handleValidateClickDeskQualitative(
    ticketId: string,
    status: 'pending' | 'approved' | 'rejected',
  ) {
    setClickDeskQualitativeValidationTicketId(ticketId)

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session?.access_token) {
        setClickDeskQualitativeResult({ error: 'Sua sessão expirou. Entre novamente.' })
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
      data.error = data.error || data.erro

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

  async function loadOperation360(quiet = false) {
    if (!isManagementUser || !chat2PeriodKey) return
    const sequence = ++operation360RequestSequence.current
    if (!quiet) {
      setClickDeskOperation360Loading(true)
      setClickDeskOperation360(null)
      setClickDeskOperation360Evidence(null)
      setClickDeskOperation360EvidenceTicketId('')
    }
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('Sua sessão expirou. Entre novamente.')
      const [year, month] = chat2PeriodKey.split('-').map(Number)
      const period = getChatMonthPeriod(year, month)
      const params = new URLSearchParams({ start: period.start, end: period.end })
      if (selectedTeamId !== 'all') params.set('team_id', selectedTeamId)
      const response = await fetch(`/api/clickdesk/operation-360?${params.toString()}`, {
        headers: { Authorization: `Bearer ${session.access_token}` }, cache: 'no-store',
      })
      const data = (await response.json()) as ClickDeskOperation360
      if (sequence !== operation360RequestSequence.current) return
      if (!response.ok) throw new Error(data.error || data.erro || 'Não foi possível consultar o 360º.')
      setClickDeskOperation360(data)
    } catch (error) {
      if (sequence === operation360RequestSequence.current) {
        if (quiet) setClickDeskOperation360Message('A atualização automática falhou. A última leitura permanece visível; tente atualizar novamente.')
        else setClickDeskOperation360({ error: getErrorMessage(error) })
      }
    } finally {
      if (sequence === operation360RequestSequence.current) setClickDeskOperation360Loading(false)
    }
  }

  async function handleCompleteOperation360(retryFailed = false) {
    if (!chat2PeriodKey || clickDeskOperation360Analyzing) return
    const sequence = operation360RequestSequence.current
    setClickDeskOperation360Analyzing('all')
    setClickDeskOperation360Message('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('Sua sessão expirou. Entre novamente.')
      const response = await fetch('/api/clickdesk/operation-360/jobs', {
        method: 'POST', headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ start: chat2SelectedPeriod.start, end: chat2SelectedPeriod.end, team_id: selectedTeamId === 'all' ? null : selectedTeamId, retry_failed: retryFailed }),
        cache: 'no-store',
      })
      const data = await response.json()
      if (!response.ok || !data.accepted) throw new Error(data.erro || data.error || 'Não foi possível iniciar a fila.')
      if (sequence === operation360RequestSequence.current) {
        setClickDeskOperation360Message('Fila registrada no servidor. Você pode trocar filtros ou fechar esta aba; as leituras continuam e esta tela atualiza a cada 10 segundos.')
      }
      setClickDeskOperation360Refresh((current) => current + 1)
    } catch (error) {
      if (sequence === operation360RequestSequence.current) setClickDeskOperation360Message(getErrorMessage(error))
    } finally { setClickDeskOperation360Analyzing('') }
  }

  async function handleRefreshClickDeskInventory() {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('Sua sessão não está ativa.')
      const response = await fetch('/api/clickdesk/inventory', {
        method: 'POST', headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ month: chat2PeriodKey }), cache: 'no-store',
      })
      const data = await response.json()
      if (!response.ok || !data.accepted) throw new Error(data.erro || 'Não foi possível iniciar a captura.')
      setClickDeskOperation360Message('Captura registrada no servidor. A conciliação seguirá a fila sem depender desta aba.')
      setClickDeskOperation360Refresh((current) => current + 1)
    } catch (error) { setClickDeskOperation360Message(getErrorMessage(error)) }
  }

  async function handleOpenOperation360Evidence(ticketId: string) {
    if (!ticketId || clickDeskOperation360EvidenceLoading) return

    setClickDeskOperation360EvidenceTicketId(ticketId)
    setClickDeskOperation360EvidenceLoading(true)
    setClickDeskOperation360Evidence(null)

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session?.access_token) {
        setClickDeskOperation360Evidence({
          ticket_id: ticketId,
          error: 'Sua sessão expirou. Entre novamente.',
        })
        return
      }

      const response = await fetch('/api/clickdesk/qualitative', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ticket_id: ticketId }),
      })
      const data = (await response.json()) as ClickDeskQualitativeResponse
      const rawError = data.error || data.erro
      data.error = rawError
        ? getQualitativeUserError(rawError, response.status)
        : response.ok
          ? undefined
          : getQualitativeUserError('', response.status)

      setClickDeskOperation360Evidence(data)
      window.setTimeout(() => {
        document
          .getElementById('operation360-evidence')
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 80)
    } catch {
      setClickDeskOperation360Evidence({
        ticket_id: ticketId,
        error: getQualitativeUserError('', 503),
      })
    } finally {
      setClickDeskOperation360EvidenceLoading(false)
    }
  }

  useEffect(() => {
    if (!isManagementUser || chatActiveTab !== 'operation360' || !chat2PeriodKey) return
    setClickDeskOperation360Message('')
    void loadOperation360()
    const timer = window.setInterval(() => { void loadOperation360(true) }, 10000)
    return () => { window.clearInterval(timer); operation360RequestSequence.current += 1 }
  }, [
    isManagementUser,
    chatActiveTab,
    chat2PeriodKey,
    selectedTeamId,
    clickDeskOperation360Refresh,
  ])

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
            setClickDeskQualitativeSummary({ error: 'Sua sessão expirou. Entre novamente.' })
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

  const selectedPeriod = periods.find((period) => `${period.year}-${period.monthNumber}` === selectedPeriodKey) ?? periods[0]
  const legacyVisibleMetrics = metrics.filter((metric) => {
    const matchesTeam = selectedTeamId === 'all' || metric.team_id === selectedTeamId
    const matchesPeriod = selectedPeriod
      ? metric.year === selectedPeriod.year && metric.month_number === selectedPeriod.monthNumber
      : true
    return matchesTeam && matchesPeriod
  })
  const [chatAuditYearText, chatAuditMonthText] = chat2PeriodKey.split('-')
  const chatAuditNow = new Date()
  const chatAuditYear = Number(chatAuditYearText) || chatAuditNow.getFullYear()
  const chatAuditMonthNumber = Number(chatAuditMonthText) || chatAuditNow.getMonth() + 1
  const chatMonthPeriod = getChatMonthPeriod(chatAuditYear, chatAuditMonthNumber)
  const chatFilterMonth = `${chatAuditYear}-${String(chatAuditMonthNumber).padStart(2,'0')}`
  const chatRangeEnabled = ['overview','prototype'].includes(chatActiveTab)
  const chatRange = chatTimeRange(chatFilterMonth,chatRangeEnabled?chatTimeMode:'month',chatTimeReference)
  const chatAuditPeriod = chatRangeEnabled && chatTimeMode!=='month' ? {...chatMonthPeriod,...chatRange,label:`${chatTimeMode==='day'?'Dia':chatTimeMode==='custom'?'Personalizado':'Semana'} · ${formatDate(chatRange.start)} a ${formatDate(chatRange.end)}`} : chatMonthPeriod
  const clickDeskAuditPeriodMatches =
    clickDeskPersistedMetrics?.period?.start === chatAuditPeriod.start &&
    Boolean(clickDeskPersistedMetrics?.period?.end) &&
    String(clickDeskPersistedMetrics?.period?.end) >= chatAuditPeriod.start &&
    String(clickDeskPersistedMetrics?.period?.end) <= chatAuditPeriod.end &&
    !clickDeskPersistedMetrics?.erro
  // Nunca rotular resultados de outra competência com o mês selecionado.
  const clickDeskAuditMetrics: ChatMonthlyMetric[] = (
    clickDeskAuditPeriodMatches ? clickDeskPersistedMetrics?.by_analyst ?? [] : []
  )
    .filter((item) => {
      if (!item.analyst_id) return false
      if (!analysts.some((analyst) => analyst.id === item.analyst_id && analyst.active)) return false
      return selectedTeamId === 'all' || item.team_id === selectedTeamId
    })
    .map((item) => {
      const analystId = item.analyst_id as string
      const analystProfile = analysts.find((analyst) => analyst.id === analystId)
      const teamId = analystProfile?.team_id ?? item.team_id ?? ''
      const teamName = teams.find((team) => team.id === teamId)?.name ?? item.area ?? 'Equipe'
      const csatGoal = Number(analystProfile?.csat_goal ?? 90)
      const reviewGoal = 25
      const csat = Number(item.csat ?? 0)
      const reviewPercentage = Number(item.review_percentage ?? 0)

      return {
        id: `clickdesk:audit:${chatAuditPeriod.start}:${analystId}`,
        team_id: teamId,
        analyst_id: analystId,
        month_label: chatAuditPeriod.label,
        year: chatAuditYear,
        month_number: chatAuditMonthNumber,
        period_start: chatAuditPeriod.start,
        period_end: chatAuditPeriod.end,
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
  const liveChatAnalysis = chatActiveTab === 'analysis' && chatAuditPeriod.start >= '2026-10-01'
  // Histórico importado do Zendesk continua disponível em competências antigas,
  // mas nunca substitui uma leitura ClickDesk ausente no mês corrente.
  const visibleMetrics = liveChatAnalysis ? clickDeskAuditMetrics : legacyVisibleMetrics
  const activePodiumExclusions = podiumExclusions.filter((exclusion) => {
    const matchesTeam = selectedTeamId === 'all' || exclusion.team_id === selectedTeamId
    const matchesPeriod =
      chatActiveTab === 'analysis'
        ? exclusion.year === chatAuditYear && exclusion.month_number === chatAuditMonthNumber
        : selectedPeriod
          ? exclusion.year === selectedPeriod.year && exclusion.month_number === selectedPeriod.monthNumber
          : true

    return matchesTeam && matchesPeriod
  })
  const excludedChatAnalystIds = new Set(activePodiumExclusions.map((exclusion) => exclusion.analyst_id))
  // Exclusão do pódio não apaga avaliações reais do CSAT da equipe.
  const calculationMetrics = liveChatAnalysis
    ? visibleMetrics
    : visibleMetrics.filter((metric) => !excludedChatAnalystIds.has(metric.analyst_id))
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
  const auditedChatTotals = liveChatAnalysis
    ? sumChatVoteRows(calculationMetrics.map((metric) => ({
        attendances: Number(metric.total_tickets),
        positive_reviews: Number(metric.positive_reviews),
        negative_reviews: Number(metric.negative_reviews),
      })))
    : null
  const averageCsat = auditedChatTotals ? (auditedChatTotals.csat ?? 0) : calculateChatAverage(calculationMetrics, 'csat')
  const averageReviews = auditedChatTotals ? (auditedChatTotals.reviewPercentage ?? 0) : calculateChatAverage(calculationMetrics, 'review_percentage')
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
  const chatReportInProgress = chatReportMonthKey >= chatBusinessDate().slice(0, 7)
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
  const chatReportCurrentClickDeskOnly = chatReportPeriod.start >= '2026-10-01'
  const chatReportUsesClickDesk = chatReportCurrentClickDeskOnly || clickDeskChatReportMetrics.length > 0
  // Em competência ClickDesk, jamais recorrer silenciosamente a importação antiga.
  const chatReportMetrics = chatReportUsesClickDesk
    ? clickDeskChatReportMetrics
    : legacyChatReportMetrics
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
  const chatReportClosureReading = chatReportInProgress
    ? 'Competência em andamento: acompanhamento parcial até a última atualização.'
    :
    !chatReportMetrics.length
      ? 'Ainda não há base suficiente para leitura do fechamento.'
      : chatReportEligibleCount >= 3 && !chatReportCriticalCount
        ? 'Fechamento forte: há pódio completo e nenhum caso crítico no período.'
        : chatReportEligibleCount > 0
          ? 'Fechamento positivo, com oportunidade de ampliar a quantidade de elegíveis ao pódio.'
          : 'Fechamento pede atenção: nenhum analista ficou plenamente elegível ao pódio.'

  const chatExecutiveStatus =
    (liveChatAnalysis && totals.reviews === 0 && totals.tickets > 0)
      ? 'Sem avaliações no período'
      : !calculationMetrics.length
        ? 'Sem dados no período'
      : averageCsat >= 90 && averageReviews >= 25
        ? 'Operação saudável'
        : averageCsat < 85 || averageReviews < 20 || attention.length >= 3
          ? 'Acompanhamento prioritário'
          : 'Período em atenção'
  const chatExecutiveTone =
    (!calculationMetrics.length || (liveChatAnalysis && totals.reviews === 0))
      ? 'text-slate-300'
      : averageCsat >= 90 && averageReviews >= 25
        ? 'text-emerald-300'
        : averageCsat < 85 || averageReviews < 20 || attention.length >= 3
          ? 'text-rose-300'
          : 'text-amber-300'
  const chatMainAlert =
    (liveChatAnalysis && totals.reviews === 0)
      ? 'Ainda não existem avaliações atribuídas neste recorte; não interpretar como CSAT zero.'
      : !calculationMetrics.length
        ? 'Aguardando conciliação de tickets desta competência.'
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
    (liveChatAnalysis && totals.reviews === 0)
      ? 'Acompanhar novas avaliações confirmadas antes de concluir a leitura de qualidade.'
      : !calculationMetrics.length
        ? 'Selecione um período com dados confirmados.'
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
    liveChatAnalysis
      ? 'Indicadores do ClickDesk auditado; a tendência histórica importada utiliza outra fonte e não é comparada com a competência corrente.'
      : !calculationMetrics.length
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
      let firstFailure = ''

      setChatQualitativeFocusAnalystId(metric.analyst_id)

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
          result.error = result.error || result.erro

          if (!response.ok || result.error) {
            failed += 1
            if (!firstFailure) {
              firstFailure =
                result.error ||
                `Falha HTTP ${response.status} ao analisar o ticket ${ticket.ticket_id}.`
            }
            continue
          }

          completed += 1
          if (result.cached) cached += 1
        } catch (error) {
          failed += 1
          if (!firstFailure) firstFailure = getErrorMessage(error)
        }
      }

      const negativeCount = sample.negative?.length ?? 0
      const positiveCount = sample.positive?.length ?? 0
      const reusedText = cached > 0 ? ` · ${cached} reaproveitada(s) do cache` : ''
      const failedText = failed > 0 ? ` · ${failed} não concluída(s)` : ''

      setChatReportQualitativeStatus(
        completed > 0
          ? `Leitura preparada: ${completed} de ${sampleTickets.length} tickets (${negativeCount} negativos + ${positiveCount} positivos)${reusedText}${failedText}. Valide as leituras em Gestão e ações; somente as aprovadas entram no feedback.`
          : `Nenhuma leitura foi concluída (${failed} de ${sampleTickets.length} falharam).${firstFailure ? ` Motivo: ${firstFailure}` : ''}`,
      )
      if (completed > 0) {
        setClickDeskQualitativeSummaryRefresh((current) => current + 1)
      }
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

    // Todas as escolhas editoriais do período entram no relatório; sem corte silencioso em oito.
    const findings: ChatQualitativeFeedbackContext['findings'] = []
    for (let offset = 0; offset < 10000; offset += 500) {
      const result = await supabase
        .from('clickdesk_qualitative_analyses')
        .select('clickdesk_ticket_id,satisfaction_label,occurred_date,analysis')
        .eq('analyst_id', metric.analyst_id)
        .eq('validation_status', 'approved')
        .gte('occurred_date', start)
        .lte('occurred_date', end)
        .order('occurred_date', { ascending: true })
        .order('clickdesk_ticket_id', { ascending: true })
        .range(offset, offset + 499)
      if (result.error) throw new Error('Não foi possível carregar os tickets selecionados para feedback. Tente novamente.')
      if ((result.data ?? []).some(item => qualitativeAnalysisVersion(item.analysis) < QUALITATIVE_ANALYSIS_VERSION)) {
        throw new Error('Há tickets selecionados cujo conteúdo mudou ou cuja leitura precisa ser atualizada. Retome a leitura na Análise 360 antes de usar essas evidências no feedback. Os indicadores e as notas do cliente não dependem disso.')
      }
      findings.push(...(result.data ?? []).map(item => ({
        ticketId: item.clickdesk_ticket_id,
        satisfactionLabel: item.satisfaction_label,
        occurredDate: item.occurred_date,
        analysis: normalizeQualitativeAnalysis(item.analysis, item.satisfaction_label),
      })))
      if ((result.data ?? []).length < 500) break
      if (offset + 500 >= 10000) throw new Error('Seleção de feedback excedeu o limite seguro de consulta.')
    }
    if (!findings.length) return undefined

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

    setChatFeedbackDraft(chatReportInProgress ? chatReportFeedbackSuggestion.replace(/encerra a competência/g, 'apresenta até agora na competência') : chatReportFeedbackSuggestion)
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
        headers: await feedbackRequestHeaders(),
        body: JSON.stringify({
          serviceModule: 'chat',
          dataSourceLabel: chatReportSourceLabel,
          feedbackStyle: chatFeedbackStyle,
          feedbackGoal: chatFeedbackGoal,
          generationMode: 'generate',
          periodLabel: chatReportInProgress ? chatReportPeriod.label + ' · em andamento' : chatReportPeriod.label,
          periodStatus: chatReportInProgress ? 'open' : 'closed',
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
        headers: await feedbackRequestHeaders(),
        body: JSON.stringify({
          serviceModule: 'chat',
          dataSourceLabel: chatReportSourceLabel,
          feedbackStyle: chatFeedbackStyle,
          feedbackGoal: chatFeedbackGoal,
          generationMode: 'improve',
          periodLabel: chatReportInProgress ? chatReportPeriod.label + ' · em andamento' : chatReportPeriod.label,
          periodStatus: chatReportInProgress ? 'open' : 'closed',
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
      periodLabel: chatReportInProgress ? chatReportPeriod.label + ' · em andamento' : chatReportPeriod.label,
          periodStatus: chatReportInProgress ? 'open' : 'closed',
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
  const chat2MonthPeriod =
    chat2PeriodOptions.find((period) => period.key === chat2PeriodKey) ??
    chat2PeriodOptions[0] ??
    chat2Periods[0]
  const chat2SelectedPeriod = chatRangeEnabled && chatTimeMode!=='month' ? {...chat2MonthPeriod,...chatAuditPeriod} : chat2MonthPeriod
  const chat2D1InRange=chat2SelectedPeriod.start<=clickDeskPublicationDay()&&chat2SelectedPeriod.end>=clickDeskPublicationDay()
  useEffect(() => {
    if (!isManagementUser || chatActiveTab !== 'analysis') {
      setClickDeskVerifiedCoverage(null)
      return
    }
    let cancelled = false
    async function loadVerifiedCoverage() {
      setClickDeskVerifiedCoverageLoading(true)
      setClickDeskVerifiedCoverage(null)
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.access_token) {
          if (!cancelled) setClickDeskVerifiedCoverage({ erro: 'Sessão expirada.' })
          return
        }
        const params = new URLSearchParams({
          start: chat2SelectedPeriod.start, end: chat2SelectedPeriod.end,
        })
        if (selectedTeamId !== 'all') params.set('team_id', selectedTeamId)
        const response = await fetch(`/api/clickdesk/verified-coverage?${params.toString()}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
          cache: 'no-store',
        })
        const result = (await response.json()) as ClickDeskVerifiedCoverage
        if (!response.ok) result.erro = result.erro || 'Conferência complementar indisponível.'
        if (!cancelled) setClickDeskVerifiedCoverage(result)
      } catch {
        if (!cancelled) setClickDeskVerifiedCoverage({ erro: 'Falha na leitura complementar.' })
      } finally {
        if (!cancelled) setClickDeskVerifiedCoverageLoading(false)
      }
    }
    void loadVerifiedCoverage()
    return () => { cancelled = true }
  }, [chat2SelectedPeriod.start, chat2SelectedPeriod.end, selectedTeamId, isManagementUser, chatActiveTab])

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

  useEffect(() => {
    if (!isManagementUser) return

    const refreshTimer = window.setInterval(() => {
      void loadClickDeskPersistedMetricsOnly(
        {
          start: chat2SelectedPeriod.start,
          end: chat2SelectedPeriod.end,
        },
        selectedTeamId,
      )
    }, 30 * 60 * 1000)

    return () => window.clearInterval(refreshTimer)
  }, [
    chat2SelectedPeriod.start,
    chat2SelectedPeriod.end,
    selectedTeamId,
    isManagementUser,
  ])
  // Visão de analista do mês corrente usa as MESMAS linhas do ledger
  // que a visão individual; importações manuais são somente histórico.
  const chat2VisibleMetrics = chat2SelectedPeriod.start >= '2026-10-01'
    ? (chat2SelectedPeriod.start === chatAuditPeriod.start ? clickDeskAuditMetrics : [])
    : metrics.filter((metric) => {
        const matchesTeam = selectedTeamId === 'all' || metric.team_id === selectedTeamId
        const matchesPeriod =
          metric.year === chat2SelectedPeriod.year && metric.month_number === chat2SelectedPeriod.monthNumber
        return matchesTeam && matchesPeriod
      })
  const chat2CoveragePartial = clickDeskPersistedMetrics?.reconciliation?.coverage !== 'complete'
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
  // Dados complementares não substituem a titularidade final para medir CSAT.
  const chat2LiveHumanRows = chat2PersistedHumanRows
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
  const sharedIndividualSelection = selectChatPresentationRow(
    chat2PersistedAnalystRows, chat2SelectedPersistedAnalyst?.analyst_id,
  )
  const sharedIndividualPerson = analysts.find(person => person.id === chat2SelectedPersistedAnalyst?.analyst_id)

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
      const persistedDay = chat2DailyMap.get(date)
      // Sem ticket final confirmado não há como afirmar volume zero.
      const covered = Boolean(persistedDay)
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
      : chat2DailyRuler.find((item) => item.date === chat2DailyDateFilter && item.covered) ?? null
  const chat2LivePositive = chat2SelectedPersistedAnalyst?.positive_reviews ?? 0
  const chat2LiveNegative = chat2SelectedPersistedAnalyst?.negative_reviews ?? 0
  const chat2LiveReviews = chat2SelectedPersistedAnalyst?.reviews ?? 0
  const chat2LiveAttendances = chat2SelectedPersistedAnalyst?.attendances ?? 0
  const chat2TodayAttendances = chat2SelectedPersistedAnalyst?.today.attendances ?? 0
  const chat2LiveCandidateCsat = chat2SelectedPersistedAnalyst?.csat ?? null
  const chat2LiveCandidateReviewPercentage = chat2SelectedPersistedAnalyst?.review_percentage ?? null
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
  const chat2LiveTeamRows = chat2SelectedPersistedAnalyst
    ? chat2PersistedAnalystRows.filter(
        (item) => item.team_id === chat2SelectedPersistedAnalyst.team_id,
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
  const chat2OperationDailySource = clickDeskPersistedMetrics?.performance_daily ?? []
  const chat2OperationTodayDate = clickDeskPersistedMetrics?.today?.date ?? null
  const chat2OperationPeriodEnd =
    clickDeskPersistedMetrics?.period?.end &&
    chat2OperationTodayDate &&
    clickDeskPersistedMetrics.period.start <= chat2OperationTodayDate &&
    chat2OperationTodayDate <= clickDeskPersistedMetrics.period.end
      ? chat2OperationTodayDate
      : clickDeskPersistedMetrics?.period?.end ?? null
  const chat2OperationDailyMap = new Map(chat2OperationDailySource.map((item) => [item.date, item]))
  const chat2OperationDailyRuler: Array<ClickDeskPersistedAggregate & { date: string; covered: boolean }> = []

  if (
    clickDeskPersistedMetrics?.period?.start &&
    chat2OperationPeriodEnd &&
    clickDeskPersistedMetrics.period.start <= chat2OperationPeriodEnd
  ) {
    const cursor = new Date(`${clickDeskPersistedMetrics.period.start}T00:00:00Z`)
    const limit = new Date(`${chat2OperationPeriodEnd}T00:00:00Z`)
    while (cursor <= limit) {
      const date = cursor.toISOString().slice(0, 10)
      const persistedDay = chat2OperationDailyMap.get(date)
      const covered = Boolean(persistedDay)
      chat2OperationDailyRuler.push(
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

  const chat2OperationCoveredDays = chat2OperationDailyRuler.filter((item) => item.covered)
  const chat2OperationDaysWithVolume = chat2OperationCoveredDays.filter((item) => Number(item.attendances) > 0)
  const chat2OperationDailyAverage =
    chat2OperationDaysWithVolume.length > 0
      ? round(
          chat2OperationDaysWithVolume.reduce((sum, item) => sum + Number(item.attendances), 0) /
            chat2OperationDaysWithVolume.length,
        )
      : 0
  const chat2OperationPeakDay =
    [...chat2OperationDaysWithVolume].sort(
      (a, b) => Number(b.attendances) - Number(a.attendances) || a.date.localeCompare(b.date),
    )[0] ?? null

  const chat2OperationDateBefore = (date: string, days = 1) => {
    const value = new Date(`${date}T00:00:00Z`)
    value.setUTCDate(value.getUTCDate() - days)
    return value.toISOString().slice(0, 10)
  }
  const chat2OperationIsCurrentPeriod =
    Boolean(
      chat2OperationTodayDate &&
        clickDeskPersistedMetrics?.period?.start &&
        clickDeskPersistedMetrics?.period?.end &&
        clickDeskPersistedMetrics.period.start <= chat2OperationTodayDate &&
        chat2OperationTodayDate <= clickDeskPersistedMetrics.period.end,
    )
  const chat2OperationReferenceDate =
    chat2OperationIsCurrentPeriod && chat2OperationTodayDate
      ? chat2OperationTodayDate
      : chat2OperationPeriodEnd
  const chat2OperationPreviousDate = chat2OperationReferenceDate
    ? chat2OperationDateBefore(chat2OperationReferenceDate)
    : null
  const chat2OperationPreviousDay =
    chat2OperationPreviousDate
      ? chat2OperationDailyRuler.find((item) => item.date === chat2OperationPreviousDate) ?? null
      : null
  const chat2OperationReferenceDay =
    chat2OperationReferenceDate
      ? chat2OperationDailyRuler.find((item) => item.date === chat2OperationReferenceDate) ?? null
      : null
  const chat2OperationCompletedVolumeDays = chat2OperationDaysWithVolume
  const chat2OperationLastCompletedDay = chat2OperationCompletedVolumeDays.at(-1) ?? null
  const chat2OperationPreviousCompletedDay = chat2OperationCompletedVolumeDays.at(-2) ?? null
  const chat2OperationClosedDayDelta =
    chat2OperationLastCompletedDay && chat2OperationPreviousCompletedDay
      ? Number(chat2OperationLastCompletedDay.attendances) -
        Number(chat2OperationPreviousCompletedDay.attendances)
      : null
  const chat2OperationClosedDayDeltaPercent =
    chat2OperationLastCompletedDay &&
    chat2OperationPreviousCompletedDay &&
    Number(chat2OperationPreviousCompletedDay.attendances) > 0
      ? round(
          (chat2OperationClosedDayDelta! /
            Number(chat2OperationPreviousCompletedDay.attendances)) *
            100,
        )
      : null
  const chat2OperationRecentDailyPoints = chat2OperationCoveredDays
    .slice(-14)
    .map((item) => ({
      label: item.date.slice(8, 10),
      value: Number(item.attendances),
    }))
  const chat2WeekdayLabels = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
  const chat2OperationWeekdayStats = chat2OperationDaysWithVolume.reduce<
    Record<number, { total: number; days: number }>
  >((acc, item) => {
    const weekday = new Date(`${item.date}T12:00:00Z`).getUTCDay()
    const current = acc[weekday] ?? { total: 0, days: 0 }
    current.total += Number(item.attendances)
    current.days += 1
    acc[weekday] = current
    return acc
  }, {})
  const chat2OperationWeekdayPoints = [1, 2, 3, 4, 5, 6, 0]
    .filter((weekday) => Boolean(chat2OperationWeekdayStats[weekday]))
    .map((weekday) => ({
      label: chat2WeekdayLabels[weekday],
      value: round(
        chat2OperationWeekdayStats[weekday].total /
          Math.max(chat2OperationWeekdayStats[weekday].days, 1),
      ),
    }))
  const chat2OperationPeakWeekday =
    [...chat2OperationWeekdayPoints].sort((a, b) => b.value - a.value)[0] ?? null
  const clickDeskPreviousPeriodMatches = (!chatRangeEnabled || chatTimeMode==='month') && clickDeskPreviousMetrics?.period?.start === chat2PreviousPeriod.start && clickDeskPreviousMetrics?.period?.end === chat2PreviousPeriod.end
  const chat2PreviousAccumulated = clickDeskPreviousPeriodMatches ? clickDeskPreviousMetrics?.performance_accumulated ?? null : null
  const chat2HasPreviousComparison = clickDeskPreviousPeriodMatches && (clickDeskPreviousMetrics?.by_analyst?.length ?? 0) > 0
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
  // Agrupar por equipe cadastrada, nunca pelo campo de fila de um ticket.
  const chat2OperationTeams = Object.values(
    chat2ProductivityRows.reduce<Record<string, {
      teamId: string; teamName: string; analysts: number
      attendances: number; positive: number; negative: number; reviews: number
    }>>((acc, item) => {
      const key = item.team_id ?? 'sem-vinculo'
      const registered = teams.find((team) => team.id === item.team_id)
      const current = acc[key] ?? {
        teamId: key, teamName: registered?.name ?? 'Vínculo de equipe não identificado',
        analysts: 0, attendances: 0, positive: 0, negative: 0, reviews: 0,
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
  })).sort((a,b) => b.attendances - a.attendances || a.teamName.localeCompare(b.teamName, 'pt-BR'))
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
  const chat2PreviousAnalystRows = clickDeskPreviousPeriodMatches ? clickDeskPreviousMetrics?.by_analyst ?? [] : []
  const chat2PeopleMovementRows = chat2ManagementRows.map((item) => {
    const previous =
      chat2PreviousAnalystRows.find(
        (previousItem) =>
          Boolean(item.analyst_id) &&
          Boolean(previousItem.analyst_id) &&
          previousItem.analyst_id === item.analyst_id,
      ) ??
      chat2PreviousAnalystRows.find(
        (previousItem) =>
          normalizeChatText(previousItem.assignee_name) === normalizeChatText(item.assignee_name) &&
          normalizeChatText(previousItem.area) === normalizeChatText(item.area),
      ) ??
      null
    const previousCsat =
      previous?.csat === null || previous?.csat === undefined ? null : Number(previous.csat)
    const previousReviewPercentage =
      previous?.review_percentage === null || previous?.review_percentage === undefined
        ? null
        : Number(previous.review_percentage)
    const csatDelta =
      item.csat === null || previousCsat === null
        ? null
        : round(Number(item.csat) - previousCsat)
    const reviewDelta =
      item.review_percentage === null || previousReviewPercentage === null
        ? null
        : round(Number(item.review_percentage) - previousReviewPercentage)
    const currentHealthy = !item.priority
    const previousHealthy =
      previousCsat !== null &&
      previousReviewPercentage !== null &&
      previousCsat >= item.csatGoal &&
      previousReviewPercentage >= item.reviewGoal

    return {
      ...item,
      previous,
      previousCsat,
      previousReviewPercentage,
      csatDelta,
      reviewDelta,
      currentHealthy,
      previousHealthy,
      enteredHealthy: Boolean(previous) && currentHealthy && !previousHealthy,
    }
  })
  const chat2RecoveryPerson =
    [...chat2PeopleMovementRows]
      .filter((item) => item.enteredHealthy)
      .sort((a, b) => (b.csatDelta ?? 0) - (a.csatDelta ?? 0))[0] ??
    [...chat2PeopleMovementRows]
      .filter((item) => item.csatDelta !== null && Number(item.csatDelta) > 0)
      .sort((a, b) => Number(b.csatDelta ?? 0) - Number(a.csatDelta ?? 0))[0] ??
    null
  const chat2ConsistencyPerson =
    [...chat2ManagementHealthy]
      .filter((item) => item.csat !== null && item.review_percentage !== null)
      .sort((a, b) => {
        const bStrength = Number(b.csatGap ?? 0) + Number(b.reviewGap ?? 0)
        const aStrength = Number(a.csatGap ?? 0) + Number(a.reviewGap ?? 0)
        if (bStrength !== aStrength) return bStrength - aStrength
        return Number(b.attendances) - Number(a.attendances)
      })[0] ?? null
  const chat2PriorityPerson = chat2ManagementPriorities[0] ?? null
  const chat2CommandPulseDotClass =
    chat2ProductivityRows.length === 0
      ? 'bg-slate-500'
      : chat2OperationStatus === 'Operação saudável'
        ? 'bg-emerald-300'
        : chat2OperationStatus === 'Acompanhamento prioritário'
          ? 'bg-rose-300'
          : 'bg-amber-300'
  const chat2CommandCenterBriefing =
    chat2ProductivityRows.length === 0
      ? 'A Central ainda não recebeu base suficiente para gerar um briefing executivo desta competência.'
      : [
          chat2OperationStatus + '.',
          (!clickDeskDailyAvailable(clickDeskPersistedMetrics) ? 'Distribuição diária ainda em conferência;' : formatChatCount(chat2OperationTodayTickets) + ' atendimento(s) em última atualização;'),
          'o CSAT acumulado está em ' +
            (chat2ProductivityCsat === null ? '—' : formatChatPercent(chat2ProductivityCsat)) +
            ' e a participação nas avaliações em ' +
            (chat2ProductivityReviewPercentage === null ? '—' : formatChatPercent(chat2ProductivityReviewPercentage)) +
            '.',
          chat2ManagementPriorities.length > 0
            ? formatChatCount(chat2ManagementPriorities.length) + ' pessoa(s) pedem leitura gerencial neste recorte.'
            : 'Nenhuma pessoa está abaixo das duas referências principais neste recorte.',
        ].join(' ')
  const chat2CommandCenterSyncLabel = clickDeskPersistedMetrics?.latest_sync?.finished_at
    ? formatDateTime(clickDeskPersistedMetrics.latest_sync.finished_at)
    : 'aguardando sincronização'
  const chat2CommandCenterNextSyncLabel = clickDeskPersistedMetrics?.sync_schedule?.next_sync_at
    ? formatDateTime(clickDeskPersistedMetrics.sync_schedule.next_sync_at)
    : 'agenda não informada'

  const chat2SelectedMetric =
    chat2VisibleMetrics.find((metric) => metric.analyst_id === chat2AnalystId) ?? chat2VisibleMetrics[0] ?? null
  const chat2TeamMetrics = chat2SelectedMetric
    ? chat2VisibleMetrics.filter((metric) => metric.team_id === chat2SelectedMetric.team_id)
    : []
  const chat2CurrentTeamTotals = chat2SelectedPeriod.start >= '2026-10-01'
    ? sumChatVoteRows(chat2TeamMetrics.map((metric) => ({
        attendances: Number(metric.total_tickets),
        positive_reviews: Number(metric.positive_reviews),
        negative_reviews: Number(metric.negative_reviews),
      })))
    : null
  const chat2TeamAverageCsat = chat2CurrentTeamTotals
    ? chat2CurrentTeamTotals.csat
    : calculateChatAverage(chat2TeamMetrics, 'csat')
  const chat2TeamAverageReviews = chat2CurrentTeamTotals
    ? chat2CurrentTeamTotals.reviewPercentage
    : calculateChatAverage(chat2TeamMetrics, 'review_percentage')
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
  const operation360Totals = clickDeskOperation360?.totals
  const operation360Coverage = clickDeskOperation360?.coverage
  const operation360Preliminary = clickDeskOperation360?.preliminary_patterns
  const operation360PreliminarySynthesis = clickDeskOperation360?.preliminary_synthesis
  const operation360Display = operation360Preliminary
  const operation360DisplaySynthesis = operation360PreliminarySynthesis
  const operation360NegativeQueue = clickDeskOperation360?.queues?.negative_unanalyzed ?? []
  const operation360PositiveQueue = clickDeskOperation360?.queues?.positive_unanalyzed ?? []
  const operation360NegativePatterns = operation360Display?.negative.causes ?? []
  const operation360PositivePatterns = operation360Display?.positive.causes ?? []
  const operation360ControlPatterns = operation360Display?.negative.controllability ?? []
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


  return (
    <div className="mt-8 space-y-7">
      <section className="panel workspace-hero">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="workspace-eyebrow">Módulo Chat</p>
            <h2 className="workspace-title">Central de Performance do Chat</h2>
            <p className="section-subtitle">
              Indicadores, pessoas, Análise 360º e fechamento com dados do ClickDesk.
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
                  : chatActiveTab === 'prototype' || chatActiveTab === 'overview' || chatActiveTab === 'operation360' || chatActiveTab === 'podium' || chatActiveTab === 'analysis'
                    ? 'Período ClickDesk'
                    : 'Período'
              }
            >
              {chatActiveTab === 'prototype' || chatActiveTab === 'overview' || chatActiveTab === 'operation360' || chatActiveTab === 'podium' || chatActiveTab === 'analysis' || chatActiveTab === 'reports' ? (
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

        {chatRangeEnabled && <ChatTimeFilter month={chatFilterMonth} mode={chatTimeMode} reference={chatTimeReference} dailyAvailable={clickDeskDailyAvailable(clickDeskPersistedMetrics)} onChange={(mode,reference)=>{const next=chatTimeRange(chatFilterMonth,mode,reference);if(next.start!==chatRange.start||next.end!==chatRange.end){setClickDeskPersistedMetrics(null);setChat2DailyDateFilter('all')}setChatTimeMode(mode);setChatTimeReference(reference)}} />}
        <div className="mt-4 border-t border-white/10 pt-4">
          <ClickDeskSyncStatus
            latestSyncAt={clickDeskPersistedMetrics?.latest_sync?.finished_at}
            schedule={clickDeskPersistedMetrics?.sync_schedule}
            historical={chatFilterMonth.replace(/-(\d)$/, '-0$1') < chatBusinessDate().slice(0, 7)}
          />
        </div>
      </section>



      <label className="block text-sm text-slate-400 lg:hidden">
        Navegar no Chat
        <select className="form-input mt-1" value={chatActiveTab} onChange={(event) => onChatActiveTabChange(event.target.value as ChatActiveTab)}>
          <option value="overview">Operação</option>
          <option value="prototype">Equipe e produtividade</option>
          <option value="operation360">Visão 360º</option>
          <option value="podium">Gestão e ações</option>
          <option value="reports">Relatórios</option>
          <option value="analysis">Pódio</option>
          <option value="import">Importar histórico</option>
          <option value="settings">Cadastros</option>
        </select>
      </label>
      {['overview', 'prototype', 'podium', 'reports'].includes(chatActiveTab) &&
        (clickDeskMetricsLoading || clickDeskPersistedMetrics?.erro || !clickDeskPersistedMetrics ||
          (clickDeskPersistedMetrics.by_analyst?.length ?? 0) === 0) && (
        <div role="status" aria-live="polite" className="rounded-lg border border-amber-300/30 bg-amber-300/10 p-4 text-sm text-amber-100">
          <strong className="block">
            {clickDeskMetricsLoading ? 'Consultando indicadores ClickDesk...' :
              clickDeskPersistedMetrics?.erro ? 'Não foi possível consultar a base ClickDesk' :
              'Sem atendimentos humanos confirmados neste recorte'}
          </strong>
          <p className="mt-2">
            {clickDeskMetricsLoading
              ? 'Consultando os indicadores já conciliados. A captura da origem e as leituras da IA continuam separadamente.'
              : clickDeskPersistedMetrics?.erro
                ? clickDeskPersistedMetrics.erro
                : 'A cobertura deste período/equipe permanece inconclusiva. Não é possível afirmar que os atendimentos ou avaliações sejam zero.'}
          </p>
          {!clickDeskMetricsLoading && (
            <button type="button" className="secondary-button mt-3"
              onClick={() => void loadClickDeskPersistedMetricsOnly(
                { start: chat2SelectedPeriod.start, end: chat2SelectedPeriod.end }, selectedTeamId
              )}>
              Tentar novamente
            </button>
          )}
        </div>
      )}
      {['overview', 'prototype', 'podium', 'reports'].includes(chatActiveTab) &&
        clickDeskPersistedMetrics?.reconciliation?.coverage === 'audit_sample_only' && (
          <div role="status" className="rounded-lg border border-amber-300/30 bg-amber-300/10 p-4 text-sm text-amber-100">
            <strong>AMOSTRA PARCIAL AUDITADA — NÃO É O FECHAMENTO OFICIAL</strong>
            <p className="mt-2">Os indicadores abaixo representam somente tickets comprovados e registrados na base de evidências. Ainda falta validar a descoberta de todos os tickets da competência. Não usar posições no pódio, metas atingidas ou volume comparativo para decisões finais.</p>
            <p className="mt-2 text-xs">Amostra: {clickDeskPersistedMetrics.reconciliation.coverage_sources?.map(item => `${item.confirmed_count} confirmados / ${item.candidate_count} candidatos · ${item.pending_count} pendentes`).join(' · ') || 'cobertura em conferência'}.</p>
          </div>
        )}
      {['overview', 'prototype', 'podium', 'reports'].includes(chatActiveTab) && (
        <details className="rounded-lg border border-white/10 p-3 text-xs leading-5 text-slate-400"><summary className="cursor-pointer">Como os números são contados</summary><p className="mt-2">
          Fonte individual: {isOfficialClickDeskSource(clickDeskPersistedMetrics?.source) ? 'relatório ClickDesk de volume por responsável e atendente avaliado, até última atualização' : 'último atendimento público humano comprovado, até última atualização'}.{' '}
          {clickDeskPersistedMetrics?.reconciliation?.coverage === 'complete'
            ? 'A captura e a conciliação do corte exibido foram conferidas. Esta consulta não aprova o fechamento mensal.'
            : 'A cobertura da descoberta permanece em conferência; sincronização concluída ou ausência de registros não comprova cobertura completa nem zero atendimentos. Valores parciais não substituem o fechamento oficial.'}
          {' '}Equipe de origem e fila são dimensões diferentes.
          {isOfficialClickDeskSource(clickDeskPersistedMetrics?.source) && <span className="mt-2 block">{OFFICIAL_RESOLUTION_POLICY}</span>}
        </p></details>
      )}
      {clickDeskPersistedMetrics?.reconciliation && clickDeskPersistedMetrics.source!=='clickdesk_event_receipts' && ['overview','prototype','reports'].includes(chatActiveTab) && <details className="rounded-lg border border-white/10 p-3 text-xs text-slate-400">
        <summary className="cursor-pointer">Tickets capturados com autoria inconclusiva neste recorte: {clickDeskPersistedMetrics.reconciliation.pending_count}</summary>
        <p className="mt-2">A contagem não inclui tickets ainda não descobertos; consulte a cobertura da captura. Conferência {formatDateTime(clickDeskPersistedMetrics.reconciliation.captured_at)}. Casos inconclusivos não recebem crédito arbitrário nem são tratados como resoluções ou avaliações.</p>
        <ul className="mt-2 space-y-1">{clickDeskPersistedMetrics.reconciliation.pending.map(item => <li key={item.ticket_id}>Ticket {item.ticket_id}: {reconciliationReason(item.reason)}</li>)}</ul>
      </details>}
      {chatActiveTab === 'overview' && isManagementUser && <ChatReconciliationStatus start={chat2SelectedPeriod.start} end={chat2SelectedPeriod.end} />}
      {chatActiveTab === 'overview' && isManagementUser && <ClickDeskSourceReport key={`${chat2SelectedPeriod.start}:${chat2SelectedPeriod.end}`} start={chat2SelectedPeriod.start} end={chat2SelectedPeriod.end} />}
      {chatActiveTab === 'overview' && chatMetricsReady && (
        <section className="workspace-page-heading">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="workspace-eyebrow">Visão da operação</p>
              <h2 className="mt-2 text-2xl font-bold">Como está a operação agora?</h2>
              <p className="section-subtitle">
                Resumo do intervalo selecionado e alertas para decisão rápida. Comparação mensal disponível na visão Mês.
              </p>
            </div>
            <div className="text-left lg:text-right">
              <span className="inline-flex rounded-md border border-cyan-300/20 bg-cyan-300/5 px-3 py-2 text-sm font-semibold text-cyan-100">
                ClickDesk · base viva
              </span>
              <button
                type="button"
                className="secondary-button mt-3"
                onClick={() => onChatActiveTabChange('operation360')}
              >
                Abrir Análise 360º
              </button>
            </div>
          </div>
        </section>
      )}


      {chatActiveTab === 'overview' && chatMetricsReady && (
        <details className="overflow-hidden rounded-2xl border border-cyan-300/15 bg-slate-950/35 shadow-[0_22px_70px_rgba(2,8,23,0.28)]">
          <summary className="cursor-pointer px-5 py-4 text-sm font-semibold text-cyan-100">Briefing e radar da operação · abrir detalhes</summary>
          <div className="border-b border-white/10 px-5 py-4 sm:px-6">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-300">
                    Operação do Chat
                  </p>
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-slate-400">
                    leitura automática
                  </span>
                </div>
                <p className="mt-2 text-sm text-slate-400">
                  O essencial primeiro: pulso, mudanças relevantes e pessoas que merecem contexto.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => onChatActiveTabChange('operation360')}
                >
                  Investigar qualidade
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => onChatActiveTabChange('prototype')}
                >
                  Ver pessoas
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => onChatActiveTabChange('podium')}
                >
                  Abrir prioridades
                </button>
              </div>
            </div>
          </div>

          <div className="grid gap-5 p-5 sm:p-6 xl:grid-cols-[0.92fr_1.08fr]">
            <div className="rounded-2xl border border-white/10 bg-slate-900/55 p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm text-slate-400">Pulso da operação</p>
                  <div className="mt-2 flex items-center gap-3">
                    <span className={'h-2.5 w-2.5 rounded-full shadow-[0_0_18px_currentColor] ' + chat2CommandPulseDotClass} />
                    <h3 className={'text-2xl font-bold ' + chat2OperationStatusTone}>{chat2OperationStatus}</h3>
                  </div>
                  <p className="mt-2 text-sm text-slate-500">
                    {selectedTeamName} · {chat2SelectedPeriod.label}
                  </p>
                </div>
                <span className="rounded-full border border-white/10 bg-slate-950/55 px-3 py-1.5 text-xs text-slate-400">
                  ClickDesk vivo
                </span>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-white/10 bg-slate-950/40 p-4">
                  <p className="text-xs uppercase tracking-[0.12em] text-slate-500">CSAT</p>
                  <strong className="mt-2 block text-2xl tabular-nums">
                    {chat2ProductivityCsat === null ? '—' : formatChatPercent(chat2ProductivityCsat)}
                  </strong>
                  <span className={'mt-1 block text-xs ' + (
                    chat2OperationCsatDelta === null
                      ? 'text-slate-500'
                      : chat2OperationCsatDelta >= 0
                        ? 'text-emerald-300'
                        : 'text-amber-200'
                  )}>
                    {chat2OperationCsatDelta === null
                      ? 'sem base anterior comparável'
                      : formatDelta(chat2OperationCsatDelta, ' p.p.') + ' vs. mês anterior'}
                  </span>
                </div>
                <div className="rounded-xl border border-white/10 bg-slate-950/40 p-4">
                  <p className="text-xs uppercase tracking-[0.12em] text-slate-500">Avaliações</p>
                  <strong className="mt-2 block text-2xl tabular-nums">
                    {chat2ProductivityReviewPercentage === null ? '—' : formatChatPercent(chat2ProductivityReviewPercentage)}
                  </strong>
                  <span className={'mt-1 block text-xs ' + (
                    chat2OperationReviewDelta === null
                      ? 'text-slate-500'
                      : chat2OperationReviewDelta >= 0
                        ? 'text-emerald-300'
                        : 'text-amber-200'
                  )}>
                    {chat2OperationReviewDelta === null
                      ? 'sem base anterior comparável'
                      : formatDelta(chat2OperationReviewDelta, ' p.p.') + ' vs. mês anterior'}
                  </span>
                </div>
                <div className="rounded-xl border border-white/10 bg-slate-950/40 p-4">
                  <p className="text-xs uppercase tracking-[0.12em] text-slate-500">última atualização</p>
                  <strong className="mt-2 block text-2xl tabular-nums">
                    {!clickDeskDailyAvailable(clickDeskPersistedMetrics) || !chat2D1InRange ? '—' : formatChatCount(chat2OperationTodayTickets)}
                  </strong>
                  <span className="mt-1 block text-xs text-slate-500">
                    média diária da base: {formatChatCount(chat2OperationDailyAverage)}
                  </span>
                </div>
                <div className="rounded-xl border border-white/10 bg-slate-950/40 p-4">
                  <p className="text-xs uppercase tracking-[0.12em] text-slate-500">Prioridades</p>
                  <strong className="mt-2 block text-2xl tabular-nums">
                    {formatChatCount(chat2ManagementPriorities.length)}
                  </strong>
                  <span className="mt-1 block text-xs text-slate-500">
                    {formatChatCount(chat2ManagementHealthy.length)} pessoa(s) com as referências principais atendidas
                  </span>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-violet-300/15 bg-violet-300/[0.04] p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-violet-100">Copiloto da operação</p>
                  <p className="mt-1 text-xs text-slate-500">Briefing gerado a partir dos indicadores disponíveis</p>
                </div>
                <span className="rounded-full border border-violet-300/20 bg-violet-300/10 px-2.5 py-1 text-[11px] font-semibold text-violet-100">
                  agora
                </span>
              </div>
              <p className="mt-4 text-sm leading-6 text-slate-200">{chat2CommandCenterBriefing}</p>

              <div className="mt-5 border-t border-white/10 pt-4">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">3 movimentos importantes</p>
                <div className="mt-3 space-y-2">
                  <div className="flex items-start gap-3 rounded-xl bg-slate-950/35 px-4 py-3">
                    <span className="mt-1 text-cyan-300">↗</span>
                    <div>
                      <strong className="text-sm text-slate-100">Qualidade</strong>
                      <p className="mt-1 text-xs leading-5 text-slate-400">
                        {chat2OperationCsatDelta === null
                          ? 'A competência anterior ainda não oferece comparação equivalente.'
                          : 'CSAT ' + formatDelta(chat2OperationCsatDelta, ' p.p.') + ' em relação à competência anterior.'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 rounded-xl bg-slate-950/35 px-4 py-3">
                    <span className="mt-1 text-amber-200">◎</span>
                    <div>
                      <strong className="text-sm text-slate-100">Pessoas</strong>
                      <p className="mt-1 text-xs leading-5 text-slate-400">
                        {chat2ManagementPriorities.length > 0
                          ? formatChatCount(chat2ManagementPriorities.length) + ' pessoa(s) estão abaixo de pelo menos uma referência principal.'
                          : 'Nenhuma prioridade individual foi sinalizada pelas referências principais.'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 rounded-xl bg-slate-950/35 px-4 py-3">
                    <span className="mt-1 text-emerald-300">●</span>
                    <div>
                      <strong className="text-sm text-slate-100">Ritmo</strong>
                      <p className="mt-1 text-xs leading-5 text-slate-400">
                        {chat2OperationPeakDay
                          ? 'Pico da base em ' + formatDate(chat2OperationPeakDay.date) + ' com ' + formatChatCount(chat2OperationPeakDay.attendances) + ' atendimento(s).'
                          : 'A série diária ainda não tem cobertura suficiente para identificar pico.'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-white/10 px-5 py-5 sm:px-6">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-cyan-300">Radar de pessoas</p>
                <h3 className="mt-1 text-lg font-bold">O que mudou e onde vale olhar primeiro</h3>
              </div>
              <p className="text-xs text-slate-500">
                Leitura comparativa; volume isolado nunca é tratado como desempenho individual.
              </p>
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-3">
              <button
                type="button"
                disabled={!chat2PriorityPerson}
                onClick={() => {
                  if (!chat2PriorityPerson) return
                  setChat2LiveAnalystKey(chat2PriorityPerson.area + '::' + chat2PriorityPerson.assignee_name)
                  onChatActiveTabChange('prototype')
                }}
                className="rounded-xl border border-amber-300/15 bg-amber-300/[0.04] p-4 text-left transition hover:border-amber-300/30 disabled:cursor-default disabled:opacity-70"
              >
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-amber-200">Prioridade atual</p>
                <strong className="mt-2 block text-base text-slate-100">
                  {chat2PriorityPerson?.assignee_name ?? 'Nenhuma prioridade'}
                </strong>
                <span className="mt-2 block text-xs leading-5 text-slate-400">
                  {chat2PriorityPerson
                    ? chat2PriorityPerson.signals.slice(0, 2).join(' · ')
                    : 'As referências principais não apontam prioridade individual neste recorte.'}
                </span>
              </button>

              <button
                type="button"
                disabled={!chat2RecoveryPerson}
                onClick={() => {
                  if (!chat2RecoveryPerson) return
                  setChat2LiveAnalystKey(chat2RecoveryPerson.area + '::' + chat2RecoveryPerson.assignee_name)
                  onChatActiveTabChange('prototype')
                }}
                className="rounded-xl border border-cyan-300/15 bg-cyan-300/[0.04] p-4 text-left transition hover:border-cyan-300/30 disabled:cursor-default disabled:opacity-70"
              >
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-200">Movimento positivo</p>
                <strong className="mt-2 block text-base text-slate-100">
                  {chat2RecoveryPerson?.assignee_name ?? 'Sem comparação suficiente'}
                </strong>
                <span className="mt-2 block text-xs leading-5 text-slate-400">
                  {chat2RecoveryPerson
                    ? chat2RecoveryPerson.enteredHealthy
                      ? 'Passou a atender as referências principais' +
                        (chat2RecoveryPerson.csatDelta === null
                          ? '.'
                          : ' · CSAT ' + formatDelta(chat2RecoveryPerson.csatDelta, ' p.p.') + '.')
                      : 'Maior avanço comparável de CSAT: ' + formatDelta(chat2RecoveryPerson.csatDelta ?? 0, ' p.p.') + '.'
                    : 'A competência anterior não permite comparar pessoas com segurança.'}
                </span>
              </button>

              <button
                type="button"
                disabled={!chat2ConsistencyPerson}
                onClick={() => {
                  if (!chat2ConsistencyPerson) return
                  setChat2LiveAnalystKey(chat2ConsistencyPerson.area + '::' + chat2ConsistencyPerson.assignee_name)
                  onChatActiveTabChange('prototype')
                }}
                className="rounded-xl border border-emerald-300/15 bg-emerald-300/[0.04] p-4 text-left transition hover:border-emerald-300/30 disabled:cursor-default disabled:opacity-70"
              >
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-emerald-200">Consistência atual</p>
                <strong className="mt-2 block text-base text-slate-100">
                  {chat2ConsistencyPerson?.assignee_name ?? 'Aguardando base'}
                </strong>
                <span className="mt-2 block text-xs leading-5 text-slate-400">
                  {chat2ConsistencyPerson
                    ? 'CSAT ' +
                      (chat2ConsistencyPerson.csat === null ? '—' : formatChatPercent(chat2ConsistencyPerson.csat)) +
                      ' · avaliações ' +
                      (chat2ConsistencyPerson.review_percentage === null
                        ? '—'
                        : formatChatPercent(chat2ConsistencyPerson.review_percentage)) +
                      '.'
                    : 'Ainda não há uma leitura consolidada de consistência neste recorte.'}
                </span>
              </button>
            </div>
          </div>

          <div className="grid gap-3 border-t border-white/10 bg-slate-950/30 px-5 py-4 text-xs sm:grid-cols-3 sm:px-6">
            <div>
              <span className="block text-slate-500">Base atualizada</span>
              <strong className="mt-1 block font-semibold text-slate-300">{chat2CommandCenterSyncLabel}</strong>
            </div>
            <div>
              <span className="block text-slate-500">Próximo ciclo</span>
              <strong className="mt-1 block font-semibold text-slate-300">{chat2CommandCenterNextSyncLabel}</strong>
            </div>
            <div>
              <span className="block text-slate-500">Próxima leitura</span>
              <strong className="mt-1 block font-semibold text-cyan-200">
                Dados → diagnóstico → ação gerencial
              </strong>
            </div>
          </div>
        </details>
      )}

      {chatActiveTab === 'operation360' && (
        <section className="workspace-page-heading">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="workspace-eyebrow">Análise 360º da operação</p>
              <h2 className="mt-2 text-2xl font-bold">Por que o CSAT está nesse nível?</h2>
              <p className="section-subtitle">
                Cruza avaliações, explica padrões das negativas e destaca práticas recorrentes nas positivas.
              </p>
            </div>
            <span className="inline-flex rounded-md border border-violet-300/20 bg-violet-300/5 px-3 py-2 text-sm font-semibold text-violet-100">
              Exclusivo da gestão
            </span>
          </div>
        </section>
      )}

      {chatActiveTab === 'prototype' && chatMetricsReady && (
        <section className="workspace-page-heading">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="workspace-eyebrow">Equipe e produtividade</p>
              <h2 className="mt-2 text-2xl font-bold">Desempenho do time e leitura individual</h2>
              <p className="section-subtitle">
                Volume, CSAT, avaliações, ranking e evolução por analista.
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

      {captureNotice&&<p role="status" className="text-sm text-cyan-200">{captureNotice}</p>}
      {chatActiveTab === 'analysis' && (
        <section className="workspace-page-heading">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="workspace-eyebrow">Ferramentas · conferência da base</p>
              <h2 className="mt-2 text-2xl font-bold">Conferência e auditoria da base</h2>
              <p className="section-subtitle">Valide dados, compare indicadores e consulte tickets quando necessário.</p>
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

      <section className={chatActiveTab === 'analysis' ? 'panel' : 'hidden'}>
        <p className="text-sm font-bold text-cyan-200">Auditoria das participações ClickDesk</p>
        <p className="mt-2 text-xs text-slate-400">
          Evidência de captura auxiliar, separada dos indicadores de atendimento e satisfação.
        </p>
          <details className="workspace-content-section border border-amber-300/20 rounded-xl p-4">
            <summary className="cursor-pointer text-sm font-bold text-amber-100">
              Diagnóstico da captura auxiliar · participações, não atendimentos
            </summary>
            <p className="mt-3 text-xs leading-5 text-amber-100">
              Fonte: contribuições verificadas na captura auxiliar, que registra a primeira participação humana,
              não a titularidade final. Um ticket pode incluir várias pessoas. Essa captura lê uma página de
              mensagens, sem a paginação integral exigida pelo ledger. As avaliações capturadas são incompletas:
              NÃO são outro CSAT e não devem ser usadas para metas, ranking ou fechamento.
              Para indicadores de desempenho, consulte somente Equipe e produtividade.
            </p>
            {clickDeskVerifiedCoverageLoading ? (
              <p className="mt-3 text-sm text-slate-400">Consultando contribuições verificadas...</p>
            ) : clickDeskVerifiedCoverage?.erro ? (
              <p className="mt-3 text-sm text-amber-100">{clickDeskVerifiedCoverage.erro}</p>
            ) : clickDeskVerifiedCoverage?.analysts?.length ? (
              <div className="data-table-shell mt-4 overflow-x-auto">
                <table className="min-w-[660px] w-full text-sm">
                  <thead><tr className="border-b border-white/10 text-left text-xs text-slate-400">
                    <th className="p-3">Analista</th>
                    <th className="p-3 text-right">Tickets com participação</th>
                    <th className="p-3 text-right">Positivas na captura auxiliar</th>
                    <th className="p-3 text-right">Negativas na captura auxiliar</th>
                  </tr></thead>
                  <tbody className="divide-y divide-white/5">
                    {clickDeskVerifiedCoverage.analysts.map(item => (
                      <tr key={item.analyst_id}>
                        <td className="p-3 font-medium text-slate-100">{item.analyst_name}{!item.active ? <span className="ml-2 text-xs text-amber-200"> (histórico · inativo)</span> : null}</td>
                        <td className="p-3 text-right tabular-nums">{formatChatCount(item.distinct_tickets_with_human_contribution)}</td>
                        <td className="p-3 text-right tabular-nums">{formatChatCount(item.positive_reviews_with_last_human_evidence)}</td>
                        <td className="p-3 text-right tabular-nums">{formatChatCount(item.negative_reviews_with_last_human_evidence)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="mt-3 text-sm text-slate-400">Nenhuma contribuição verificada neste recorte.</p>}
          </details>
      </section>

      {chatActiveTab === 'podium' && chatMetricsReady && (
        <section className="workspace-page-heading">
          <p className="workspace-eyebrow">Gestão e ações</p>
          <h2 className="mt-2 text-2xl font-bold">Onde agir e o que acompanhar?</h2>
          <p className="section-subtitle">Prioridades, alertas e ações gerenciais apoiadas por dados e IA.</p>
        </section>
      )}

      {chatActiveTab === 'reports' && chatMetricsReady && (
        <section className="workspace-page-heading">
          <p className="workspace-eyebrow">Fechamento mensal</p>
          <h2 className="mt-2 text-2xl font-bold">{chatReportInProgress ? 'Acompanhar a competência em andamento' : 'Consolidar, reconhecer e comunicar'}</h2>
          <p className="section-subtitle">{chatReportInProgress ? 'Prévia de indicadores e relatórios de acompanhamento; resultados ainda podem mudar.' : 'Ranking final, ajustes operacionais do pódio e geração dos relatórios individuais.'}</p>
        </section>
      )}

      {chatActiveTab === 'prototype' && chatMetricsReady && (
        <div className="space-y-7">
          <section className="workspace-content-section">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="workspace-eyebrow">Visão do time</p>
                <h3 className="mt-2 text-2xl font-bold">Desempenho coletivo</h3>
                <p className="section-subtitle">
                  Escolha um analista para ver seu resultado e os tickets do período.
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
              <div className="data-table-shell mt-5 overflow-x-auto">
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
                        aria-pressed={selected}
                        onClick={() => {
                          setChat2LiveAnalystKey(analystKey)
                          requestAnimationFrame(() => document.getElementById('chat-selected-analyst')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
                        }}
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
          <section id="chat-selected-analyst" className="workspace-content-section scroll-mt-6 rounded-xl border border-cyan-300/15 p-4">
            <div className="flex flex-wrap items-center gap-4">
              {sharedIndividualPerson && <AnalystAvatar name={sharedIndividualPerson.name} photoUrl={sharedIndividualPerson.photo_url ?? null} size="lg" />}
              <div>
                <p className="workspace-eyebrow">Resumo compartilhado com o analista</p>
                <h3 className="mt-1 text-xl font-bold">{sharedIndividualPerson?.name ?? chat2SelectedPersistedAnalyst?.assignee_name ?? 'Selecione um analista abaixo'}</h3>
                <p className="mt-1 text-xs text-slate-400">{chat2SelectedPeriod.label} · resultado individual do período</p>
                {sharedIndividualPerson && <p className="mt-1 text-xs text-slate-400">{teams.find(team => team.id === sharedIndividualPerson.team_id)?.name ?? 'Equipe não identificada'}</p>}
              </div>
            </div>
            {sharedIndividualSelection.ambiguous && <p className="mt-3 text-sm text-amber-200">Mais de uma fila encontrada para o analista. Resumo indisponível até a conferência; nenhuma soma automática foi realizada.</p>}
            <ChatSharedPerformanceSummary metric={sharedIndividualSelection.row} csatGoal={Number(sharedIndividualPerson?.csat_goal ?? 90)} dailyAvailable={clickDeskDailyAvailable(clickDeskPersistedMetrics) && chat2D1InRange} />
            {isOfficialClickDeskSource(clickDeskPersistedMetrics?.source) && chat2SelectedPeriod.start>='2026-11-01' && <ChatNeutralReviews start={chat2SelectedPeriod.start} end={chat2SelectedPeriod.end} analystId={chat2SelectedPersistedAnalyst?.analyst_id} teamId={selectedTeamId==='all'?null:selectedTeamId} />}
          </section>
          {sharedIndividualPerson && sharedIndividualSelection.row && (
            <details className="rounded-xl border border-white/10 p-4">
              <summary className="cursor-pointer text-sm font-semibold text-cyan-100">Selecionar tickets para feedback</summary>
            <ManagementDailyFeedback
              key={sharedIndividualPerson.id + ':' + chat2SelectedPeriod.start + ':' + chat2SelectedPeriod.end}
              analystId={sharedIndividualPerson.id}
              days={sharedIndividualSelection.row.daily}
              onSelectionSaved={() => setClickDeskQualitativeSummaryRefresh(current => current + 1)}
            />
            </details>
          )}


          <details className="workspace-content-section rounded-xl border border-white/10 p-4 text-xs text-slate-400"><summary className="cursor-pointer">Entender datas e atribuição</summary><p className="mt-2">
            {isOfficialClickDeskSource(clickDeskPersistedMetrics?.source) ? 'Totais do relatório ClickDesk conciliados por atendente avaliado, responsável pelo volume e time de lotação. A distribuição diária é publicada somente após conciliar com o período. ' : ''}
            {isOfficialClickDeskSource(clickDeskPersistedMetrics?.source) ? 'Recebimentos de e-mail também contam, mesmo sem resposta pública. ' : 'Exibição exclusiva dos atendimentos auditados por último respondente humano. '}
            Participações históricas e capturas auxiliares ficam em Ferramentas → Conferência da base. Os dados deste mês ainda são parciais.
          </p></details>

          <details className="workspace-content-section workspace-content-section-divided phone-ai-layers">
            <summary className="cursor-pointer px-5 py-4 text-sm font-semibold text-cyan-100">Diagnóstico complementar e histórico · pode usar fontes diferentes do resumo compartilhado</summary>
            <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="workspace-eyebrow">Visão individual</p>
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
                  <MetricCard label="Atendimentos no intervalo" value={formatChatCount(chat2LiveAttendances)} />
                  <MetricCard label="Recebidos hoje" value={!clickDeskDailyAvailable(clickDeskPersistedMetrics) || !chat2D1InRange ? '—' : formatChatCount(chat2TodayAttendances)} />
                  <MetricCard
                    label="CSAT do intervalo selecionado"
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

                <p className="mt-3 text-xs text-amber-200">
                  {chat2SelectedPeriod.label} · último autor humano confirmado · {chat2LivePositive} positiva(s),
                  {' '}{chat2LiveNegative} negativa(s) · {chat2LiveReviews} avaliação(ões).
                  O percentual diário pode ser diferente do resultado do intervalo selecionado.
                </p>
                <ChatPerformanceDiagnosticPanel diagnostic={chat2LiveDiagnostic} />

                {clickDeskPersistedMetrics?.period && (
                  <p className="mt-3 text-xs text-slate-500">
                    Período selecionado: {formatDate(clickDeskPersistedMetrics.period.start)} a {formatDate(clickDeskPersistedMetrics.period.end)}
                    {chat2DailyCoverageStart ? ` · base diária desde ${formatDate(chat2DailyCoverageStart)}` : ''}
                    {' '}· última atualização: dados publicados até {formatDate(clickDeskPublicationDay())}.
                  </p>
                )}

                {chat2DailyRuler.length > 0 && (
                  <div className="mt-5 rounded-xl border border-white/10 bg-slate-900/70 p-5">
                    <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                      <div>
                        <p className="text-sm font-semibold uppercase tracking-[0.14em] text-cyan-300">Régua diária</p>
                        <h4 className="mt-1 text-lg font-bold">Atendimentos por dia</h4>
                        <p className="mt-1 text-sm text-slate-400">
                          Clique em um dia para detalhar os tickets comprovados. Dias ainda não conciliados aparecem como em conferência, nunca como zero atendimentos.
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
                              {formatDate(item.date)} · {item.covered ? `${formatChatCount(item.attendances)} atendimento(s) confirmado(s)` : 'em conferência'}
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
                                ? `${formatDate(item.date)} · ${formatChatCount(item.attendances)} atendimento(s) confirmado(s) · cobertura parcial`
                                : `${formatDate(item.date)} · em conferência de atendimento`
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

                <div className="phone-reports-filter-grid mt-4 grid gap-3 lg:grid-cols-3">
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
                    value={chat2SelectedPeriod.start >= '2026-10-01' && chat2SelectedMetric.reviews === 0 ? '—' : formatChatPercent(chat2SelectedMetric.csat)}
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
                          {chat2SelectedPeriod.start >= '2026-10-01' && chat2SelectedMetric.reviews === 0 ? '— (sem avaliações)' : formatDelta(round(Number(chat2SelectedMetric.csat) - Number(chat2SelectedMetric.csat_goal)), ' p.p.')}
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
                        <strong className="tabular-nums">{chat2TeamAverageCsat === null ? '—' : formatChatPercent(chat2TeamAverageCsat)}</strong>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-slate-400">Avaliações do time</span>
                        <strong className="tabular-nums">{chat2TeamAverageReviews === null ? '—' : formatChatPercent(chat2TeamAverageReviews)}</strong>
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
          </details>

          <details className="panel">
            <summary className="cursor-pointer text-sm font-semibold text-cyan-100">Histórico mensal do analista · abrir</summary>
            <div className="mt-4">
              <p className="text-sm font-semibold uppercase tracking-[0.16em] text-cyan-300">Evolução do analista</p>
              <h3 className="mt-2 text-2xl font-bold">Histórico ClickDesk</h3>
              <p className="section-subtitle">
                Comparação por mês completo. Estes valores não acompanham o filtro de dias acima.
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
                  {chat2HistoryPoints.length > 1 && <div className="grid gap-4 lg:grid-cols-3">
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
                  </div>}

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
                                : isOfficialClickDeskSource(item.metric_source) ? 'Relatório ClickDesk do período · última atualização' : 'Base de autoria humana · escopo diferente do relatório'}
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
                    Meses fechados preservam o snapshot aprovado. A competência atual usa a fonte identificada no cartão, com data dos eventos, sem aprovação automática do fechamento.
                  </p>
                </div>
              ) : (
                <EmptyState text="Ainda não existe histórico ClickDesk disponível para este analista." />
              )}
            </div>

          </details>




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
      <section className={chatActiveTab === 'operation360' ? 'workspace-content-section' : 'hidden'}>
        {isManagementUser && chatActiveTab === 'operation360' && <details className="workspace-collapsible"><summary className="cursor-pointer"><h2 className="text-xl font-bold">Critérios do atendimento e evidências preservadas</h2><p className="mt-2 text-sm text-slate-400">Acolhimento, entendimento, clareza, diligência, continuidade e encerramento. Histórico qualitativo até D-1, com cobertura própria; não altera CSAT, volume ou avaliações oficiais.</p></summary><div className="mt-5"><CxDiagnostics diagnosisOnly initialScope={{start:chatAuditPeriod.start,end:chatAuditPeriod.end,teamId:selectedTeamId==='all'?'':selectedTeamId}} key={`diagnosis:${chatAuditPeriod.start}:${chatAuditPeriod.end}:${selectedTeamId}`} onCaseCreated={()=>onChatActiveTabChange('podium')}/></div></details>}
        {clickDeskOperation360Loading && !clickDeskOperation360 ? (
          <div className="rounded-xl border border-white/10 bg-slate-950/30 p-6 text-sm text-slate-400">
            Montando a leitura 360º da operação...
          </div>
        ) : clickDeskOperation360?.error || clickDeskOperation360?.erro ? (
          <div className="rounded-xl border border-rose-300/20 bg-rose-300/5 p-5">
            <strong className="text-rose-100">Não foi possível montar a análise 360º.</strong>
            <p className="mt-2 text-sm text-rose-100/80">
              {clickDeskOperation360.error || clickDeskOperation360.erro}
            </p>
            <button type="button" className="secondary-button mt-4" onClick={() => void loadOperation360()}>
              Tentar novamente
            </button>
          </div>
        ) : clickDeskOperation360?.source_coverage?.status === 'audit_sample_only' &&
            (clickDeskOperation360?.totals?.attendances ?? 0) === 0 ? (
          <div role="status" className="rounded-xl border border-amber-300/30 bg-amber-300/10 p-5 text-amber-100">
            <h3 className="text-lg font-semibold">Visão 360º: inventário por ticket ainda indisponível</h3>
            <p className="mt-2 text-sm leading-6">
              O ClickDesk já fornece indicadores oficiais à aba Operação, mas a base de evidências
              por ticket necessária à análise qualitativa ainda não foi conciliada neste período.
              Por isso, não seria correto apresentar atendimentos, avaliações ou CSAT iguais a zero
              como resultado da Visão 360º.
            </p>
            <p className="mt-2 text-sm leading-6">
              A leitura da IA permanece pendente até a comprovação da autoria e do histórico
              individual dos tickets. Nenhuma avaliação nem indicador oficial foi alterado.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {clickDeskOperation360?.source_coverage?.status === 'audit_sample_only' && (
              <div role="status" className="rounded-lg border border-amber-300/20 bg-amber-300/5 p-4 text-sm text-amber-100">
                <strong>IA e CSAT em cobertura parcial</strong>
                <p className="mt-2">
                  A análise percorre somente tickets avaliados com último atendente humano confirmado.
                  Não há avaliação definitiva da operação até a recuperação do restante do período.
                  Para processar os pendentes, utilize o comando de análise abaixo.
                </p>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <MetricCard
                label="Atendimentos"
                value={formatChatCount(operation360Totals?.attendances ?? 0)}
              />
              <MetricCard
                label="Avaliações"
                value={
                  operation360Totals?.review_percentage === null || operation360Totals?.review_percentage === undefined
                    ? formatChatCount(operation360Totals?.evaluated ?? 0)
                    : `${formatChatCount(operation360Totals?.evaluated ?? 0)} · ${formatChatPercent(operation360Totals.review_percentage)}`
                }
              />
              <MetricCard
                label="CSAT"
                value={
                  operation360Totals?.csat === null || operation360Totals?.csat === undefined
                    ? '—'
                    : formatChatPercent(operation360Totals.csat)
                }
                tone={(operation360Totals?.csat ?? 0) >= 90 ? 'success' : (operation360Totals?.csat ?? 0) >= 85 ? 'warning' : 'danger'}
              />
              <MetricCard
                label="Positivas"
                value={formatChatCount(operation360Totals?.positive ?? 0)}
                tone="success"
              />
              <MetricCard
                label="Negativas"
                value={formatChatCount(operation360Totals?.negative ?? 0)}
                tone={(operation360Totals?.negative ?? 0) > 0 ? 'warning' : 'success'}
              />
            </div>

            <div className="rounded-xl border border-violet-300/20 bg-violet-300/5 p-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-sm font-semibold text-violet-100">Leitura da IA · {selectedTeamId === 'all' ? 'Todas as equipes' : teams.find((team) => team.id === selectedTeamId)?.name ?? 'Equipe selecionada'} · {chat2PeriodKey}</p>
                  <p className="mt-1 text-xs leading-5 text-slate-400">
                    {operation360NegativeQueue.length + operation360PositiveQueue.length > 0
                      ? `${operation360NegativeQueue.length} negativa(s) e ${operation360PositiveQueue.length} positiva(s) aguardam leitura da IA. As notas já estão incluídas no CSAT e no percentual de avaliações. Selecionar ou descartar para feedback é opcional.`
                      : 'Todas as avaliações elegíveis deste recorte já possuem leitura qualitativa válida.'}
                  </p>
                </div>
                <button
                  type="button"
                  className="secondary-button shrink-0"
                  disabled={
                    Boolean(clickDeskOperation360Analyzing) ||
                    operation360NegativeQueue.length + operation360PositiveQueue.length === 0
                  }
                  onClick={() => void handleCompleteOperation360()}
                >
                  {clickDeskOperation360Analyzing === 'all'
                    ? 'Registrando fila no servidor...'
                    : operation360NegativeQueue.length + operation360PositiveQueue.length > 0
                      ? `Iniciar ou retomar leitura · ${operation360NegativeQueue.length + operation360PositiveQueue.length} sem leitura`
                      : 'Leitura completa'}
                </button>
              </div>
              <p className="mt-3 text-xs leading-5 text-slate-300">
                CSAT e participação são cálculos da base conciliada e não aguardam a IA. Os contadores abaixo pertencem somente à equipe e ao período exibidos.
              </p>
              {clickDeskOperation360?.background && (
                <div className="mt-3 rounded-lg border border-white/10 p-3 text-xs leading-6 text-slate-300" aria-live="polite">
                  <p>Fila no servidor neste recorte: {clickDeskOperation360.background.counts.processing} em leitura · {clickDeskOperation360.background.counts.pending} aguardando processamento · {clickDeskOperation360.background.counts.failed} com falha.</p>
                  <p>A tela atualiza a cada 10 segundos. O processamento continua com a aba fechada.</p>
                  <p>Rotina automática: {({ ready: 'disponível', running: 'processando', cooldown: 'aguardando liberação da API', attention: 'nova tentativa necessária', error: 'precisa de atenção', not_configured: 'aguardando configuração' } as Record<string,string>)[clickDeskOperation360.background.health?.status ?? 'not_configured'] ?? 'em conferência'} · última atividade: {clickDeskOperation360.background.health?.last_started_at ? formatDateTime(clickDeskOperation360.background.health.last_started_at) : 'ainda não registrada'}.</p>
                  {clickDeskOperation360.background.failures.length > 0 && (
                    <details><summary>Ver tickets que precisam de atenção</summary>
                    <button type="button" className="secondary-button mt-2" onClick={() => void handleCompleteOperation360(true)}>Tentar novamente nos tickets com falha</button>
                    {clickDeskOperation360.background.failures.map((item) => <p key={item.ticket_id}>Ticket #{item.ticket_id}: {item.error_code.includes('429') ? 'A API solicitou aguardar antes de tentar novamente' : item.error_code === 'transcript_insufficient' ? 'Conversa sem conteúdo suficiente para uma análise segura' : item.error_code === 'provider_invalid_json' ? 'A IA não devolveu uma resposta utilizável' : 'Não foi possível concluir a leitura; revisar o ticket'} · {item.attempts} tentativa(s).</p>)}
                    </details>
                  )}
                </div>
              )}
              {clickDeskOperation360?.background?.inventory && (
                <details className="mt-3 rounded-lg border border-white/10 p-3 text-xs leading-6 text-slate-300">
                  <summary>Conferência da base numérica · todas as equipes desta competência</summary>
                  <p>Esta conferência é independente da leitura da IA e da seleção para feedback.</p>
                  {clickDeskOperation360.background.inventory.run.error_code && <p>{clickDeskOperation360.background.inventory.run.error_code === 'source_daily_limit_requires_export' ? 'A API atingiu o limite de registros em um único dia. É necessário obter uma exportação completa da origem antes de certificar a cobertura.' : clickDeskOperation360.background.inventory.run.error_code.includes('429') ? 'A origem solicitou uma pausa nas consultas. O sistema fará nova tentativa dentro dos limites configurados.' : 'A conferência encontrou mudança ou falha na origem. Haverá até três tentativas automáticas; se persistir, atualize a captura para revisar novamente.'}</p>}
                  <p>Captura: {clickDeskOperation360.background.inventory.run.status === 'complete' ? 'varredura de origem concluída' : clickDeskOperation360.background.inventory.run.status === 'error' ? 'precisa de nova conferência' : 'varredura em andamento'} · corte em {formatDate(clickDeskOperation360.background.inventory.run.cutoff_date)}.</p>
                  {clickDeskOperation360.background.inventory.assessment && (
                    <p>{clickDeskOperation360.background.inventory.assessment.candidate_count} candidatos descobertos · {clickDeskOperation360.background.inventory.assessment.confirmed_count} com autoria conferida · {clickDeskOperation360.background.inventory.assessment.excluded_count} fora do escopo elegível · {clickDeskOperation360.background.inventory.assessment.pending_count} aguardando conciliação.</p>
                  )}
                  <p>{clickDeskOperation360.background.inventory.assessment?.complete ? 'A captura e a classificação deste corte foram conferidas. A competência em andamento ainda não é um fechamento mensal.' : 'A base permanece parcial. O fechamento oficial aguarda a descoberta integral e a resolução das pendências da origem.'}</p>
                  {(clickDeskOperation360.background.inventory.source_exceptions?.length ?? 0) > 0 && <div className="mt-2"><p>Tickets com falha de consulta ou histórico incompleto na origem:</p><ul>{clickDeskOperation360.background.inventory.source_exceptions?.map(item => <li key={item.ticket_id}>#{item.ticket_id} · {reconciliationReason(item.reason)} · conferido em {formatDateTime(item.checked_at)}</li>)}</ul><p>Esses casos exigem o histórico completo da origem; não são resolvidos por aprovação editorial nem pela IA.</p></div>}
                  {(clickDeskOperation360.background.inventory.source_exclusions?.length ?? 0) > 0 && <div className="mt-2"><p>Referências históricas com exclusão comprovada na origem:</p><ul>{clickDeskOperation360.background.inventory.source_exclusions?.map(item => <li key={item.ticket_id}>ID interno {item.ticket_id} · excluído na origem em {formatDateTime(item.source_deleted_at)} · conferido em {formatDateTime(item.verified_at)}</li>)}</ul><p>As referências foram preservadas para auditoria. Sem histórico disponível, elas não geram créditos ou avaliações no cálculo canônico.</p></div>}
                  <button type="button" className="secondary-button mt-2" onClick={() => void handleRefreshClickDeskInventory()}>Atualizar captura da competência</button>
                </details>
              )}
              {clickDeskOperation360Message && (
                <p className="mt-3 text-sm leading-6 text-violet-100">{clickDeskOperation360Message}</p>
              )}
            </div>

            <details className="rounded-xl border border-white/10 bg-slate-950/25 p-4">
              <summary className="cursor-pointer list-none text-sm font-semibold text-slate-200">
                Cobertura e processamento da IA
                <span className="ml-2 text-xs font-normal text-slate-500">
                  {formatChatCount(operation360Coverage?.negative.analyzed ?? 0)}
                  {' / '}
                  {formatChatCount(operation360Coverage?.negative.total ?? 0)} negativas ·{' '}
                  {formatChatCount(operation360Coverage?.positive.analyzed ?? 0)}
                  {' / '}
                  {formatChatCount(operation360Coverage?.positive.total ?? 0)} positivas
                </span>
              </summary>
              <div className="mt-4">
            <div className="rounded-xl border border-violet-300/15 bg-violet-300/5 p-5">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div className="max-w-3xl">
                  <p className="workspace-eyebrow text-violet-200">Cobertura da IA</p>
                  <h3 className="mt-2 text-xl font-bold">Quanto da história já foi lido?</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-400">
                    O CSAT é calculado sobre as avaliações. A IA analisa os tickets avaliados, reaproveita leituras já disponíveis e procura padrões para explicar o resultado da operação.
                  </p>
                  {(clickDeskOperation360?.analysis_status?.stale ?? 0) > 0 && (
                    <p className="mt-3 rounded-lg border border-amber-300/15 bg-amber-300/5 px-3 py-2 text-xs leading-5 text-amber-100">
                      {formatChatCount(clickDeskOperation360?.analysis_status?.stale ?? 0)} análise(s) de uma versão qualitativa anterior serão refeitas automaticamente para usar os critérios atuais.
                    </p>
                  )}
                </div>
                <div className="grid min-w-[280px] grid-cols-2 gap-3">
                  <div className="rounded-lg bg-slate-950/40 p-3">
                    <span className="text-xs text-slate-500">Negativas analisadas</span>
                    <strong className="mt-1 block text-xl tabular-nums text-amber-100">
                      {formatChatCount(operation360Coverage?.negative.analyzed ?? 0)}
                      {' / '}
                      {formatChatCount(operation360Coverage?.negative.total ?? 0)}
                    </strong>
                    <span className="text-xs text-slate-500">
                      {formatChatPercent(operation360Coverage?.negative.analyzed_percentage ?? 0)}
                    </span>
                  </div>
                  <div className="rounded-lg bg-slate-950/40 p-3">
                    <span className="text-xs text-slate-500">Positivas analisadas</span>
                    <strong className="mt-1 block text-xl tabular-nums text-emerald-200">
                      {formatChatCount(operation360Coverage?.positive.analyzed ?? 0)}
                      {' / '}
                      {formatChatCount(operation360Coverage?.positive.total ?? 0)}
                    </strong>
                    <span className="text-xs text-slate-500">
                      {formatChatPercent(operation360Coverage?.positive.analyzed_percentage ?? 0)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-5 flex flex-wrap gap-3 border-t border-white/10 pt-4">
                <p className="text-xs text-slate-400">A leitura deste grupo faz parte da fila no servidor. Use o comando de iniciar ou retomar no início desta tela.</p>
                <p className="text-xs text-slate-400">A leitura deste grupo faz parte da fila no servidor. Use o comando de iniciar ou retomar no início desta tela.</p>
              </div>

              {operation360PositiveQueue.length > 20 && (
                <p className="mt-3 text-xs leading-5 text-slate-500">
                  O processamento completo usa lotes controlados e continua automaticamente até esgotar a fila ou encontrar tickets que precisem de nova tentativa.
                </p>
              )}

            </div>
              </div>
            </details>

            <div className="rounded-xl border border-cyan-300/15 bg-cyan-300/5 p-5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="workspace-eyebrow text-cyan-200">Síntese 360º</p>
                  <h3 className="mt-2 text-xl font-bold">O que está acontecendo com o resultado?</h3>
                </div>
                <span className="rounded-md border border-cyan-300/20 bg-slate-950/30 px-3 py-2 text-xs font-semibold text-cyan-100">
                  {operation360DisplaySynthesis?.coverage_label ?? 'Sem cobertura'}
                </span>
              </div>

              <p className="mt-4 text-base font-semibold leading-7 text-slate-100">
                {operation360DisplaySynthesis?.headline ??
                  'Ainda não há leitura qualitativa suficiente para construir uma síntese.'}
              </p>

              <div className="mt-5 space-y-3">
                <div className="rounded-lg border border-amber-300/15 bg-slate-950/35 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-amber-200">Nas negativas</p>
                  <p className="mt-2 text-sm leading-6 text-slate-300">
                    {operation360DisplaySynthesis?.negative_read ??
                      'Ainda não há padrão negativo consolidável.'}
                  </p>
                </div>
                <div className="rounded-lg border border-emerald-300/15 bg-slate-950/35 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-emerald-200">Nas positivas</p>
                  <p className="mt-2 text-sm leading-6 text-slate-300">
                    {operation360DisplaySynthesis?.positive_read ??
                      'Ainda não há prática positiva recorrente consolidável.'}
                  </p>
                </div>
              </div>

              <div className="mt-5 border-t border-white/10 pt-4">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-200">Leitura do resultado</p>
                <p className="mt-2 text-sm font-semibold leading-6 text-slate-100">
                  {operation360DisplaySynthesis?.result_read ??
                    'Ainda não há leitura suficiente para explicar quais fatores estão pesando no resultado.'}
                </p>
              </div>
            </div>

            <details className="rounded-xl border border-white/10 bg-slate-950/25 p-4">
              <summary className="cursor-pointer list-none">
                <span className="text-sm font-semibold text-slate-200">Ver detalhes, padrões e evidências</span>
                <span className="ml-2 text-xs text-slate-500">
                  causas, controlabilidade e tickets
                </span>
              </summary>
              <div className="mt-5 space-y-6">
            <div className="rounded-xl border border-amber-300/15 bg-slate-950/30 p-5">
              <div>
                <p className="workspace-eyebrow text-amber-200">Padrões observados</p>
                <h3 className="mt-2 text-xl font-bold">O que se repete nas avaliações?</h3>
                <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-400">
                  Abra os padrões somente quando precisar investigar as causas e os tickets que sustentam a leitura.
                </p>
              </div>

              <div className="mt-5 grid gap-5 xl:grid-cols-2">
                <Operation360PatternList
                  title="O que aparece nas negativas"
                  subtitle="Fatores mais recorrentes entre os tickets negativos que a IA já conseguiu analisar."
                  patterns={operation360NegativePatterns}
                  tone="negative"
                  onOpenTicket={handleOpenOperation360Evidence}
                  selectedTicketId={clickDeskOperation360EvidenceTicketId}
                  ticketLoading={clickDeskOperation360EvidenceLoading}
                />
                <Operation360PatternList
                  title="O que aparece nas positivas"
                  subtitle="Fatores e práticas que se repetem nos tickets positivos e podem indicar comportamentos a preservar."
                  patterns={operation360PositivePatterns}
                  tone="positive"
                  onOpenTicket={handleOpenOperation360Evidence}
                  selectedTicketId={clickDeskOperation360EvidenceTicketId}
                  ticketLoading={clickDeskOperation360EvidenceLoading}
                />
              </div>
            </div>

            <Operation360PatternList
              title="De quem é o fator observado?"
              subtitle="Separa o que estava sob controle do atendimento do que pertence a processo, empresa, cliente, fator externo ou combinação."
              patterns={operation360ControlPatterns}
              tone="neutral"
              onOpenTicket={handleOpenOperation360Evidence}
              selectedTicketId={clickDeskOperation360EvidenceTicketId}
              ticketLoading={clickDeskOperation360EvidenceLoading}
            />

            {(clickDeskOperation360EvidenceTicketId || clickDeskOperation360Evidence) && (
              <div
                id="operation360-evidence"
                className="scroll-mt-24 rounded-xl border border-cyan-300/15 bg-slate-950/35 p-5"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="workspace-eyebrow text-cyan-200">Evidência do padrão</p>
                    <h3 className="mt-2 text-xl font-bold">
                      Ticket #{clickDeskOperation360EvidenceTicketId || clickDeskOperation360Evidence?.ticket_id}
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-slate-400">
                      Esta é a leitura qualitativa preservada do ticket que sustenta o padrão selecionado.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="small-button self-start"
                    onClick={() => {
                      setClickDeskOperation360Evidence(null)
                      setClickDeskOperation360EvidenceTicketId('')
                    }}
                  >
                    Fechar evidência
                  </button>
                </div>

                {clickDeskOperation360EvidenceLoading ? (
                  <div className="mt-4 rounded-lg border border-white/10 bg-slate-950/40 p-4 text-sm text-slate-400">
                    Carregando a leitura preservada...
                  </div>
                ) : clickDeskOperation360Evidence ? (
                  <QualitativeAnalysisCard
                    result={clickDeskOperation360Evidence}
                    audience="management"
                  />
                ) : null}
              </div>
            )}


              </div>
            </details>

          </div>
        )}
      </section>

      <CriteriaLegend
        hidden={chatActiveTab !== 'analysis'}
        title="Critérios do pódio do chat"
        items={[
          'CSAT mínimo de 90%',
          'Avaliações a partir de 25%',
          `Volume igual ou acima da média da equipe (${formatChatCount(averageTickets)} atendimentos)`,
        ]}
      />

      <section className={chatActiveTab === 'overview' && chatMetricsReady ? 'workspace-content-section' : 'hidden'}>
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
            {chat2HasPreviousComparison && <p className="text-xs leading-5 text-slate-400">Comparação com a base disponível do mês anterior. {chatFilterMonth === chatBusinessDate().slice(0, 7) ? 'O mês atual está em andamento; os volumes correspondem a períodos de duração diferente.' : 'Confira a cobertura e a fonte de ambos os meses antes de interpretar a variação como mudança de desempenho.'}</p>}
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

        <div className="mt-5 rounded-xl border border-white/10 bg-slate-950/25 p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.14em] text-cyan-300">Volume diário da operação</p>
              <h3 className="mt-1 text-xl font-bold">Quanto atendemos em cada dia?</h3>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
                Visão coletiva dos atendimentos realizados no ClickDesk para {selectedTeamName.toLowerCase()}. O dia atual fica em andamento; dias anteriores preservam a data dos eventos. O total mensal não substitui a conciliação diária.
              </p>
            </div>
            <div className="text-left lg:text-right">
              <span className="inline-flex rounded-md border border-cyan-300/20 bg-cyan-300/5 px-3 py-2 text-xs font-semibold text-cyan-100">
                {chat2OperationIsCurrentPeriod ? 'Competência em andamento' : 'Competência histórica'}
              </span>
              <p className="mt-2 text-xs text-slate-500">
                {clickDeskPersistedMetrics?.latest_sync?.finished_at
                  ? `Última sincronização: ${formatDateTime(clickDeskPersistedMetrics.latest_sync.finished_at)}`
                  : 'Última sincronização não informada'}
              </p>
            </div>
          </div>

          <details className="mt-4">
            <summary className="cursor-pointer text-sm text-slate-400">Detalhes de volume · médias, pico e variação</summary>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <div className="rounded-lg bg-slate-900 p-4">
              <p className="text-xs text-slate-500">{chat2OperationIsCurrentPeriod ? 'Dia anterior ao último publicado' : 'Dia anterior ao fechamento'}</p>
              <strong className="mt-2 block text-2xl tabular-nums">
                {chat2OperationPreviousDay?.covered
                  ? formatChatCount(chat2OperationPreviousDay.attendances)
                  : '—'}
              </strong>
              <span className="mt-1 block text-xs text-slate-500">
                {chat2OperationPreviousDay?.date ? formatDate(chat2OperationPreviousDay.date) : 'Sem base diária'}
              </span>
            </div>
            <div className="rounded-lg bg-slate-900 p-4">
              <p className="text-xs text-slate-500">{chat2OperationIsCurrentPeriod ? 'Hoje · em andamento' : 'Último dia da competência'}</p>
              <strong className="mt-2 block text-2xl tabular-nums text-cyan-200">
                {chat2OperationReferenceDay?.covered
                  ? formatChatCount(chat2OperationReferenceDay.attendances)
                  : '—'}
              </strong>
              <span className="mt-1 block text-xs text-slate-500">
                {chat2OperationReferenceDay?.date ? formatDate(chat2OperationReferenceDay.date) : 'Sem base diária'}
              </span>
            </div>
            <div className="rounded-lg bg-slate-900 p-4">
              <p className="text-xs text-slate-500">Média por dia com movimento</p>
              <strong className="mt-2 block text-2xl tabular-nums">{!clickDeskDailyAvailable(clickDeskPersistedMetrics) ? '—' : formatChatCount(chat2OperationDailyAverage)}</strong>
              <span className="mt-1 block text-xs text-slate-500">
                {!clickDeskDailyAvailable(clickDeskPersistedMetrics) ? 'Distribuição diária ainda não conciliada' : `${formatChatCount(chat2OperationDaysWithVolume.length)} dia(s) com atendimento`}
              </span>
            </div>
            <div className="rounded-lg bg-slate-900 p-4">
              <p className="text-xs text-slate-500">Pico do período</p>
              <strong className="mt-2 block text-2xl tabular-nums text-amber-200">
                {chat2OperationPeakDay ? formatChatCount(chat2OperationPeakDay.attendances) : '—'}
              </strong>
              <span className="mt-1 block text-xs text-slate-500">
                {chat2OperationPeakDay ? formatDate(chat2OperationPeakDay.date) : 'Sem base diária'}
              </span>
            </div>
            <div className="rounded-lg bg-slate-900 p-4">
              <p className="text-xs text-slate-500">Variação · últimos dias fechados</p>
              <strong className={`mt-2 block text-2xl tabular-nums ${
                chat2OperationClosedDayDelta === null
                  ? 'text-slate-200'
                  : chat2OperationClosedDayDelta > 0
                    ? 'text-emerald-300'
                    : chat2OperationClosedDayDelta < 0
                      ? 'text-amber-200'
                      : 'text-slate-200'
              }`}>
                {chat2OperationClosedDayDelta === null
                  ? '—'
                  : `${chat2OperationClosedDayDelta > 0 ? '+' : ''}${formatChatCount(chat2OperationClosedDayDelta)}`}
              </strong>
              <span className="mt-1 block text-xs text-slate-500">
                {chat2OperationClosedDayDeltaPercent === null
                  ? 'Aguardando dois dias completos'
                  : `${chat2OperationClosedDayDeltaPercent > 0 ? '+' : ''}${chat2OperationClosedDayDeltaPercent}% vs. dia anterior com movimento`}
              </span>
            </div>
          </div>
          </details>

          {chat2OperationCoveredDays.length > 0 ? (
            <>
              <div className="mt-5 space-y-4">
                <TrendLineChart
                  label="Evolução diária · últimos 14 dias cobertos"
                  points={chat2OperationRecentDailyPoints}
                  singlePointLabel="Apenas um dia disponível para leitura."
                  latestPointLabel="Último dia"
                  highlightedPointLabel="Dia destacado"
                />
                <details>
                  <summary className="cursor-pointer text-sm text-slate-400">Comparar dias da semana</summary>
                <BarTrend
                  label="Média de atendimentos por dia da semana"
                  points={chat2OperationWeekdayPoints}
                />
                </details>
              </div>

              <div className="mt-5 rounded-lg border border-white/10 bg-slate-900/45 p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Dias do período</p>
                    <strong className="mt-1 block text-sm text-slate-200">Volume consolidado por dia</strong>
                  </div>
                  <span className="text-xs text-slate-500">
                    {chat2OperationPeakWeekday
                      ? `Maior média semanal: ${chat2OperationPeakWeekday.label} · ${formatChatCount(chat2OperationPeakWeekday.value)} atendimentos`
                      : 'Padrão semanal ainda sem base suficiente'}
                  </span>
                </div>

                <div className="mt-4 flex gap-2 overflow-x-auto pb-2">
                  {chat2OperationDailyRuler.map((item) => {
                    const isToday = chat2OperationTodayDate === item.date
                    const isPeak = chat2OperationPeakDay?.date === item.date
                    return (
                      <div
                        key={item.date}
                        className={`min-w-20 rounded-lg border px-3 py-3 text-center ${
                          !item.covered
                            ? 'border-white/5 bg-slate-950/20 text-slate-600'
                            : isPeak
                              ? 'border-amber-300/35 bg-amber-300/5'
                              : isToday
                                ? 'border-cyan-300/35 bg-cyan-300/5'
                                : 'border-white/10 bg-slate-950/40'
                        }`}
                        title={
                          item.covered
                            ? `${formatDate(item.date)} · ${formatChatCount(item.attendances)} atendimento(s)`
                            : `${formatDate(item.date)} · sem base diária`
                        }
                      >
                        <span className="block text-[11px] text-slate-500">{item.date.slice(8, 10)}</span>
                        <strong className="mt-1 block text-lg tabular-nums">
                          {item.covered ? formatChatCount(item.attendances) : '—'}
                        </strong>
                        <span className="mt-1 block text-[10px] text-slate-500">
                          {isPeak ? 'pico' : isToday ? 'hoje' : ''}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>

              {clickDeskPersistedMetrics?.date_basis?.status === 'needs_validation' && (
                <div className="mt-4 rounded-lg border border-amber-400/20 bg-amber-400/5 px-4 py-3 text-xs leading-5 text-amber-100">
                  <strong>Distribuição diária em validação.</strong>{' '}
                  {clickDeskPersistedMetrics.date_basis.note}
                </div>
              )}
            </>
          ) : (
            <div className="mt-5">
              <EmptyState text="Ainda não há base diária suficiente para montar a evolução de volume desta competência." />
            </div>
          )}
        </div>

        <div className="mt-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.14em] text-cyan-300">Leitura por equipe</p>
              <h3 className="mt-1 text-xl font-bold">Como estão as equipes do Chat?</h3>
            </div>
            <span className="text-xs text-slate-500">{isOfficialClickDeskSource(clickDeskPersistedMetrics?.source) ? 'Relatório ERP/Fiscal · time de lotação · até última atualização' : 'Autoria humana final · equipe cadastrada · cobertura parcial'}</span>
            <p className="mt-1 text-xs text-slate-500">{isOfficialClickDeskSource(clickDeskPersistedMetrics?.source) ? 'Os Recebidos do relatório individual e as avaliações são agrupados pelo time de lotação do analista. A fila do atendimento pode ser diferente do time; por isso, o total da fila pode diferir do total do time.' : 'Renovação, Suporte N3 e fila não comprovada são históricos de roteamento, não equipes. O ticket permanece creditado à equipe cadastrada do último autor humano.'}</p>
          </div>

          {chat2OperationTeams.length > 0 ? (
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              {chat2OperationTeams.map((item) => (
                <div key={item.teamId} className="rounded-xl border border-white/10 bg-slate-950/35 p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <strong className="text-slate-100">{item.teamName}</strong>
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

      {isManagementUser && chatActiveTab === 'podium' && <details id="chat-action-follow-up" className="workspace-collapsible"><summary className="cursor-pointer"><h2 className="text-xl font-bold">Investigações, decisões e acompanhamento</h2><p className="mt-2 text-sm text-slate-400">Valide as leituras, registre ações com responsável e prazo e acompanhe o resultado. O histórico existente foi preservado.</p></summary><div className="mt-5"><CxDiagnostics initialScope={{start:chatAuditPeriod.start,end:chatAuditPeriod.end,teamId:selectedTeamId==='all'?'':selectedTeamId}} key={`actions:${chatAuditPeriod.start}:${chatAuditPeriod.end}:${selectedTeamId}`} onCaseCreated={()=>setChatCaseRefresh(v=>v+1)}/><ChatCaseManagement initialTeamId={selectedTeamId==='all'?'':selectedTeamId} key={`cases:${selectedTeamId}:${chatCaseRefresh}`}/></div></details>}
      <section id="chat-management-priorities" className={chatActiveTab === 'podium' ? 'workspace-content-section' : 'hidden'}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-cyan-300">Gestão e ações</p>
            <h2 className="mt-2 text-2xl font-bold">Quem precisa da sua atenção e qual é o próximo passo?</h2>
            <p className="section-subtitle">
              Sinais de qualidade e participação nos tickets comprovados. Enquanto a cobertura for parcial, as prioridades são observações da amostra, não avaliação definitiva de desempenho.
            </p>
          </div>
          <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-white/10 bg-slate-950/30 text-center sm:grid-cols-4 sm:divide-x sm:divide-white/10">
            <div className="flex min-h-20 flex-col items-center justify-center px-3 py-3">
              <span className="flex min-h-8 items-center justify-center text-xs leading-4 text-slate-500">Prioridades</span>
              <strong className="mt-1 block text-lg tabular-nums text-amber-200">{chat2ManagementRows.length ? chat2ManagementPriorities.length : '—'}</strong>
            </div>
            <div className="flex min-h-20 flex-col items-center justify-center px-3 py-3">
              <span className="flex min-h-8 items-center justify-center text-xs leading-4 text-slate-500">Metas atingidas</span>
              <strong className="mt-1 block text-lg tabular-nums text-emerald-300">{chat2CoveragePartial ? '—' : chat2ManagementRows.length ? chat2ManagementHealthy.length : '—'}</strong>
            </div>
            <div className="flex min-h-20 flex-col items-center justify-center px-3 py-3">
              <span className="flex min-h-8 items-center justify-center text-xs leading-4 text-slate-500">Volume a validar</span>
              <strong className="mt-1 block text-lg tabular-nums text-cyan-200">{chat2ManagementRows.length ? chat2ManagementVolumeContexts.length : '—'}</strong>
            </div>
            <div className="flex min-h-20 flex-col items-center justify-center px-3 py-3">
              <span className="flex min-h-8 items-center justify-center text-xs leading-4 text-slate-500">Avaliações negativas</span>
              <strong className="mt-1 block text-lg tabular-nums text-rose-200">{chat2ManagementRows.length ? chat2ManagementNegativeReviews : '—'}</strong>
            </div>
          </div>
        </div>

        {chat2ManagementPriorities.length > 0 ? (
          <div className="mt-5 divide-y divide-white/5 overflow-hidden rounded-xl border border-white/10 bg-slate-950/25">
            {chat2ManagementPriorities.map((item, index) => (
              <div key={`${item.area}::${item.assignee_name}`} className="p-4">
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
                      onChatActiveTabChange('prototype')
                    }}
                  >
                    Abrir analista
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : chat2ManagementRows.length === 0 ? (
          <div className="mt-5 rounded-xl border border-amber-300/20 bg-amber-300/5 p-5 text-sm text-amber-100">
            Não é possível avaliar metas, prioridades ou avaliações negativas: não há indicadores válidos carregados para esta equipe e período.
          </div>
        ) : chat2CoveragePartial ? (
          <div className="mt-5 rounded-xl border border-amber-300/20 bg-amber-300/5 p-5 text-sm text-amber-100">
            Não há sinais de prioridade entre os tickets comprovados desta amostra. Isso não significa que todos os analistas atingiram as metas: a descoberta do período ainda está incompleta.
          </div>
        ) : (
          <div className="mt-5 rounded-xl border border-emerald-400/15 bg-emerald-400/5 p-5 text-sm text-emerald-100">
            Nenhum analista está abaixo da meta individual de CSAT ou da referência de 25% de avaliações neste recorte.
          </div>
        )}
      </section>

      <details className={chatActiveTab === 'podium' && chat2ManagementRows.length > 0 ? 'workspace-collapsible' : 'hidden'}>
        <summary className="cursor-pointer list-none">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.16em] text-cyan-300">Plano de gestão</p>
              <h2 className="mt-1 text-xl font-bold">Como priorizar a atuação</h2>
              <p className="mt-1 text-sm text-slate-400">
                Qualidade, participação e contexto operacional separados para evitar a mesma tratativa para problemas diferentes.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-md border border-amber-300/15 bg-amber-300/5 px-3 py-2 text-xs text-amber-100">
                Qualidade {chat2ManagementCsatAttention.length}
              </span>
              <span className="rounded-md border border-amber-300/15 bg-amber-300/5 px-3 py-2 text-xs text-amber-100">
                Participação {chat2ManagementReviewAttention.length}
              </span>
              <span className="rounded-md border border-cyan-300/15 bg-cyan-300/5 px-3 py-2 text-xs text-cyan-100">
                Contexto {chat2ManagementVolumeContexts.length}
              </span>
              <span className="rounded-md border border-white/10 bg-slate-950/40 px-3 py-2 text-xs font-semibold text-slate-300">
                Abrir orientação
              </span>
            </div>
          </div>
        </summary>

        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          <div className="rounded-xl border border-white/10 bg-slate-900/70 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-200">Qualidade</p>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              {chat2ManagementCsatAttention.length} analista(s) abaixo da própria meta de CSAT ou ainda sem base suficiente. Priorize avaliações negativas e fatos observáveis antes do feedback.
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-slate-900/70 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-200">Participação</p>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              {chat2ManagementReviewAttention.length} analista(s) abaixo de 25% de avaliações ou ainda sem base. Trabalhe encerramento, confirmação da solução e convite à pesquisa.
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-slate-900/70 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-300">Contexto operacional</p>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              {chat2ManagementVolumeContexts.length} analista(s) com volume pelo menos 20% abaixo da média da própria área. Antes de qualquer cobrança, valide disponibilidade, ausências, apoio a outras demandas e duração dos atendimentos.
            </p>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-cyan-400/15 bg-cyan-400/5 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-300">Sequência recomendada</p>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            <strong>1. Validar o fato.</strong> Confira indicador e avaliações. {' '}
            <strong>2. Separar causa de contexto.</strong> Volume, qualidade e participação pedem leituras diferentes. {' '}
            <strong>3. Combinar uma ação observável.</strong> Feche o 1:1 com comportamento concreto e indicador para acompanhar.
          </p>
        </div>
      </details>


      <details
        id="chat-qualitative-validation"
        className={chatActiveTab === 'podium' ? 'workspace-collapsible' : 'hidden'}
        open={chatQualitativeFocusAnalystId ? true : undefined}
      >
        <summary className="cursor-pointer list-none">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="workspace-eyebrow text-violet-200">IA qualitativa · governança ativa</p>
              <h2 className="mt-2 text-xl font-bold">Da métrica para a causa</h2>
              <p className="section-subtitle">
                Selecione tickets positivos e negativos para os próximos feedbacks. Não é necessário decidir sobre todos os tickets; notas e KPIs independem desta escolha.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-md border border-violet-400/20 bg-violet-400/5 px-3 py-2 text-xs font-semibold text-violet-200">
                Seleção para feedback
              </span>
              <span className="rounded-md border border-white/10 bg-slate-950/40 px-3 py-2 text-xs font-semibold text-slate-300">
                Abrir governança qualitativa
              </span>
            </div>
          </div>
        </summary>

        {chatQualitativeFocusAnalystId && (
          <div className="mt-4 flex flex-col gap-3 rounded-lg border border-violet-400/20 bg-violet-400/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-violet-200">Validação focada</p>
              <strong className="mt-1 block text-slate-100">
                {analysts.find((item) => item.id === chatQualitativeFocusAnalystId)?.name ?? 'Analista selecionado'}
              </strong>
              <p className="mt-1 text-xs text-slate-500">A fila abaixo mostra somente tickets deste analista enquanto o foco estiver ativo.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="small-button" onClick={() => setChatQualitativeFocusAnalystId('')}>
                Mostrar toda a equipe
              </button>
              <button
                type="button"
                className="small-button"
                onClick={() => {
                  onChatActiveTabChange('reports')
                  window.setTimeout(() => {
                    document
                      .getElementById('chat-report-individual')
                      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  }, 80)
                }}
              >
                Voltar ao relatório
              </button>
            </div>
          </div>
        )}

        <div className="mt-5 rounded-xl border border-white/10 bg-slate-950/30 p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-violet-200">Cobertura da leitura qualitativa</p>
              <h3 className="mt-2 text-xl font-bold">Cobertura e fila qualitativa</h3>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
                Cobertura mostra o que já foi lido; consolidação usa somente análises aprovadas pela gestão.
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
                    <p className="text-xs text-slate-500">Selecionadas para feedback</p>
                    <strong className="mt-2 block text-2xl tabular-nums text-emerald-200">
                      {formatChatCount(clickDeskQualitativeSummary?.totals?.approved ?? 0)}
                    </strong>
                    <span className="mt-1 block text-xs text-slate-500">
                      {formatChatCount(clickDeskQualitativeSummary?.coaching_signals ?? 0)} com ponto acionável
                    </span>
                  </div>
                  <div className="rounded-lg bg-slate-900 p-4">
                    <p className="text-xs text-slate-500">Disponíveis para seleção</p>
                    <strong className="mt-2 block text-2xl tabular-nums text-amber-100">
                      {formatChatCount(clickDeskQualitativeSummary?.totals?.pending ?? 0)}
                    </strong>
                    <span className="mt-1 block text-xs text-slate-500">
                      {formatChatCount(clickDeskQualitativeSummary?.totals?.rejected ?? 0)} descartada(s) do feedback
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

              {(clickDeskQualitativeSummary?.pending_reviews ?? []).filter(
                (item) => !chatQualitativeFocusAnalystId || item.analyst_id === chatQualitativeFocusAnalystId,
              ).length > 0 && (
                <div id="qualitative-pending-reviews" className="mt-5 rounded-lg border border-violet-400/15 bg-violet-400/5 p-4 scroll-mt-24">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-violet-200">Seleção editorial</p>
                      <h4 className="mt-1 font-semibold text-slate-100">Tickets disponíveis para feedback</h4>
                      <p className="mt-1 text-xs text-slate-500">
                        O ticket já foi analisado. Confira a leitura e selecione apenas os casos úteis para o feedback.
                      </p>
                    </div>
                    <span className="text-xs text-slate-500">
                      {(clickDeskQualitativeSummary?.pending_reviews ?? []).filter(
                        (item) => !chatQualitativeFocusAnalystId || item.analyst_id === chatQualitativeFocusAnalystId,
                      ).length} pendente(s)
                    </span>
                  </div>

                  <div className="mt-3 space-y-4">
                    {(clickDeskQualitativeSummary?.pending_reviews ?? [])
                      .filter(
                        (item) =>
                          !chatQualitativeFocusAnalystId ||
                          item.analyst_id === chatQualitativeFocusAnalystId,
                      )
                      .map((item) => {
                        const validating = clickDeskQualitativeValidationTicketId === item.ticket_id
                        return (
                          <div
                            key={item.ticket_id}
                            className="rounded-lg border border-white/10 bg-slate-950/40 p-4"
                          >
                            <div>
                              <strong className="text-sm text-slate-100">{item.analyst_name}</strong>
                              <p className="mt-1 text-xs text-slate-500">
                                Ticket #{item.ticket_id} · {item.satisfaction_label === 'negative' ? 'avaliação negativa' : 'avaliação positiva'}
                              </p>
                            </div>

                            <QualitativeAnalysisCard
                              result={{
                                ticket_id: item.ticket_id,
                                satisfaction_label: item.satisfaction_label,
                                validation_status: 'pending',
                                analysis: item.analysis,
                                cached: true,
                              }}
                              audience="management"
                            />

                            <QualitativeValidationActions
                              ticketId={item.ticket_id}
                              status="pending"
                              validating={validating}
                              onValidate={(ticketId, status) =>
                                void handleValidateClickDeskQualitative(ticketId, status)
                              }
                            />
                          </div>
                        )
                      })}
                  </div>
                </div>
              )}

              {[
                ...(clickDeskQualitativeSummary?.validation_queue ?? []),
                ...(clickDeskQualitativeSummary?.positive_validation_queue ?? []),
              ].filter(
                (item) => !chatQualitativeFocusAnalystId || item.analyst_id === chatQualitativeFocusAnalystId,
              ).length > 0 && (
                <div className="mt-5 rounded-lg border border-white/10 bg-slate-900/45 p-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-violet-200">
                      Amostras para análise
                    </p>
                    <h4 className="mt-1 font-semibold text-slate-100">
                      O que precisa ser entendido e o que merece ser reconhecido
                    </h4>
                    <p className="mt-1 text-xs leading-5 text-slate-500">
                      Negativas ajudam a investigar atritos e contexto. Positivas ajudam a identificar práticas que vale reconhecer e repetir. A fila distribui os tickets ao longo do período para evitar concentrar a leitura em um único dia.
                    </p>
                  </div>

                  <div className="mt-4 grid gap-4 xl:grid-cols-2">
                    <div className="rounded-lg border border-amber-300/15 bg-amber-300/5 p-3">
                      <div className="flex items-end justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-amber-100">
                            Negativas
                          </p>
                          <p className="mt-1 text-sm font-semibold text-slate-100">
                            Ainda não analisadas
                          </p>
                        </div>
                        <span className="text-xs text-slate-500">
                          {(clickDeskQualitativeSummary?.validation_queue ?? []).filter(
                            (item) => !chatQualitativeFocusAnalystId || item.analyst_id === chatQualitativeFocusAnalystId,
                          ).length} exibida(s)
                        </span>
                      </div>

                      <div className="mt-3 space-y-2">
                        {(clickDeskQualitativeSummary?.validation_queue ?? [])
                          .filter(
                            (item) =>
                              !chatQualitativeFocusAnalystId ||
                              item.analyst_id === chatQualitativeFocusAnalystId,
                          )
                          .map((item) => (
                            <div
                              key={item.ticket_id}
                              className="grid gap-2 rounded-lg border border-white/10 bg-slate-950/40 px-3 py-3 sm:grid-cols-[1fr_auto] sm:items-center"
                            >
                              <div>
                                <strong className="text-sm text-slate-100">{item.analyst_name}</strong>
                                <p className="mt-1 text-xs text-slate-500">
                                  Ticket #{item.ticket_id} · {formatDate(item.occurred_date)} · {item.area}
                                </p>
                              </div>
                              <button
                                type="button"
                                className="small-button"
                                disabled={clickDeskQualitativeLoading}
                                onClick={() => void runManagementQualitativeAnalysis(item.ticket_id, 'queue')}
                              >
                                {clickDeskQualitativeLoading && clickDeskQualitativeTicketId === item.ticket_id
                                  ? 'Analisando...'
                                  : clickDeskQualitativeResultSource === 'queue' &&
                                      clickDeskQualitativeResult?.ticket_id === item.ticket_id &&
                                      clickDeskQualitativeResult?.analysis
                                    ? 'Leitura pronta'
                                    : 'Analisar'}
                              </button>

                              {clickDeskQualitativeResultSource === 'queue' &&
                                clickDeskQualitativeResult?.ticket_id === item.ticket_id && (
                                  <div className="sm:col-span-2">
                                    <QualitativeAnalysisCard
                                      result={clickDeskQualitativeResult}
                                      audience="management"
                                      reanalyzing={clickDeskQualitativeLoading}
                                      onReanalyze={
                                        clickDeskQualitativeResult.error
                                          ? () => void runManagementQualitativeAnalysis(item.ticket_id, 'queue')
                                          : undefined
                                      }
                                    />
                                    {clickDeskQualitativeResult.analysis && (
                                      <QualitativeValidationActions
                                        ticketId={item.ticket_id}
                                        status={clickDeskQualitativeResult.validation_status}
                                        validating={clickDeskQualitativeValidationTicketId === item.ticket_id}
                                        onValidate={(ticketId, status) =>
                                          void handleValidateClickDeskQualitative(ticketId, status)
                                        }
                                      />
                                    )}
                                  </div>
                                )}
                            </div>
                          ))}
                        {(clickDeskQualitativeSummary?.validation_queue ?? []).filter(
                          (item) => !chatQualitativeFocusAnalystId || item.analyst_id === chatQualitativeFocusAnalystId,
                        ).length === 0 && (
                          <p className="rounded-lg border border-dashed border-white/10 px-3 py-3 text-xs text-slate-500">
                            Nenhuma negativa pendente neste filtro.
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="rounded-lg border border-emerald-400/15 bg-emerald-400/5 p-3">
                      <div className="flex items-end justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-emerald-200">
                            Positivas
                          </p>
                          <p className="mt-1 text-sm font-semibold text-slate-100">
                            Ainda não analisadas
                          </p>
                        </div>
                        <span className="text-xs text-slate-500">
                          {(clickDeskQualitativeSummary?.positive_validation_queue ?? []).filter(
                            (item) => !chatQualitativeFocusAnalystId || item.analyst_id === chatQualitativeFocusAnalystId,
                          ).length} exibida(s)
                        </span>
                      </div>

                      <div className="mt-3 space-y-2">
                        {(clickDeskQualitativeSummary?.positive_validation_queue ?? [])
                          .filter(
                            (item) =>
                              !chatQualitativeFocusAnalystId ||
                              item.analyst_id === chatQualitativeFocusAnalystId,
                          )
                          .map((item) => (
                            <div
                              key={item.ticket_id}
                              className="grid gap-2 rounded-lg border border-white/10 bg-slate-950/40 px-3 py-3 sm:grid-cols-[1fr_auto] sm:items-center"
                            >
                              <div>
                                <strong className="text-sm text-slate-100">{item.analyst_name}</strong>
                                <p className="mt-1 text-xs text-slate-500">
                                  Ticket #{item.ticket_id} · {formatDate(item.occurred_date)} · {item.area}
                                </p>
                              </div>
                              <button
                                type="button"
                                className="small-button"
                                disabled={clickDeskQualitativeLoading}
                                onClick={() => void runManagementQualitativeAnalysis(item.ticket_id, 'queue')}
                              >
                                {clickDeskQualitativeLoading && clickDeskQualitativeTicketId === item.ticket_id
                                  ? 'Analisando...'
                                  : clickDeskQualitativeResultSource === 'queue' &&
                                      clickDeskQualitativeResult?.ticket_id === item.ticket_id &&
                                      clickDeskQualitativeResult?.analysis
                                    ? 'Leitura pronta'
                                    : 'Analisar'}
                              </button>

                              {clickDeskQualitativeResultSource === 'queue' &&
                                clickDeskQualitativeResult?.ticket_id === item.ticket_id && (
                                  <div className="sm:col-span-2">
                                    <QualitativeAnalysisCard
                                      result={clickDeskQualitativeResult}
                                      audience="management"
                                      reanalyzing={clickDeskQualitativeLoading}
                                      onReanalyze={
                                        clickDeskQualitativeResult.error
                                          ? () => void runManagementQualitativeAnalysis(item.ticket_id, 'queue')
                                          : undefined
                                      }
                                    />
                                    {clickDeskQualitativeResult.analysis && (
                                      <QualitativeValidationActions
                                        ticketId={item.ticket_id}
                                        status={clickDeskQualitativeResult.validation_status}
                                        validating={clickDeskQualitativeValidationTicketId === item.ticket_id}
                                        onValidate={(ticketId, status) =>
                                          void handleValidateClickDeskQualitative(ticketId, status)
                                        }
                                      />
                                    )}
                                  </div>
                                )}
                            </div>
                          ))}
                        {(clickDeskQualitativeSummary?.positive_validation_queue ?? []).filter(
                          (item) => !chatQualitativeFocusAnalystId || item.analyst_id === chatQualitativeFocusAnalystId,
                        ).length === 0 && (
                          <p className="rounded-lg border border-dashed border-white/10 px-3 py-3 text-xs text-slate-500">
                            Nenhuma positiva pendente neste filtro.
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <details className="mt-5 rounded-lg border border-white/10 bg-slate-900/35 p-4">
                <summary className="cursor-pointer list-none">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-violet-200">Seleção para feedback</p>
                      <h4 className="mt-1 font-semibold text-slate-100">Padrões e cobertura detalhada</h4>
                      <p className="mt-1 text-xs text-slate-500">
                        Abra quando quiser investigar distribuição de causas, influência, controle, aprendizados e cobertura por analista.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <span className="rounded-md bg-emerald-400/10 px-2 py-1 text-xs font-semibold text-emerald-200">
                        {formatChatCount(clickDeskQualitativeSummary?.totals?.approved ?? 0)} aprovadas
                      </span>
                      <span className="rounded-md bg-cyan-400/10 px-2 py-1 text-xs font-semibold text-cyan-200">
                        {formatChatCount(clickDeskQualitativeSummary?.coaching_signals ?? 0)} sinais
                      </span>
                      <span className="rounded-md bg-violet-400/10 px-2 py-1 text-xs font-semibold text-violet-200">
                        Ver detalhes
                      </span>
                    </div>
                  </div>
                </summary>

                <div className="mt-4">
                  {(clickDeskQualitativeSummary?.totals?.approved ?? 0) > 0 ? (
                    <div className="mt-5 grid gap-4 xl:grid-cols-4">
                      <div className="rounded-lg border border-white/10 bg-slate-900/60 p-4">
                        <p className="text-sm font-semibold">Contextos dos tickets selecionados</p>
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
                        <p className="mt-1 text-xs leading-5 text-slate-500">
                          Indica quem tinha condições reais de influenciar ou resolver o contexto: analista, empresa, cliente, fator externo ou combinação deles.
                        </p>
                        <div className="mt-3 space-y-2">
                          {(clickDeskQualitativeSummary?.controllability ?? []).slice(0, 5).map((item) => (
                            <div key={item.key} className="flex items-center justify-between gap-3 text-sm">
                              <span className="text-slate-400">{formatQualitativeLabel(item.key)}</span>
                              <strong className="tabular-nums">{formatChatCount(item.count)}</strong>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="rounded-lg border border-white/10 bg-slate-900/60 p-4">
                        <p className="text-sm font-semibold">Aprendizados selecionados</p>
                        <p className="mt-1 text-xs leading-5 text-slate-500">
                          Resume se a leitura aprovada aponta prática para manter, desenvolver, contextualizar ou se não permite conclusão segura.
                        </p>
                        <div className="mt-3 space-y-2">
                          {(clickDeskQualitativeSummary?.analyst_takeaways ?? []).slice(0, 5).map((item) => (
                            <div key={item.key} className="flex items-center justify-between gap-3 text-sm">
                              <span className="text-slate-400">
                                {item.key === 'maintain'
                                  ? 'Manter'
                                  : item.key === 'develop'
                                    ? 'Desenvolver'
                                    : item.key === 'context'
                                      ? 'Contextualizar'
                                      : 'Sem conclusão segura'}
                              </span>
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
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                        <div>
                          <p className="text-sm font-semibold">Cobertura por analista</p>
                          <p className="mt-1 text-xs text-slate-500">
                            Aqui cobertura significa avaliações efetivamente analisadas, independentemente de aprovação. Padrões usam somente as aprovadas.
                          </p>
                        </div>
                      </div>
                      <div className="mt-3 overflow-x-auto rounded-lg border border-white/10">
                        <div className="min-w-[760px] divide-y divide-white/5">
                          <div className="grid grid-cols-[1.5fr_repeat(5,0.72fr)] gap-3 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                            <span>Analista</span>
                            <span className="text-right">Lidos</span>
                            <span className="text-right">Cobertura</span>
                            <span className="text-right">Aprov.</span>
                            <span className="text-right">Pend.</span>
                            <span className="text-right">Sinais</span>
                          </div>
                          {clickDeskQualitativeSummary?.analysts?.map((item) => (
                            <div key={item.analyst_id} className="grid grid-cols-[1.5fr_repeat(5,0.72fr)] gap-3 px-4 py-3 text-sm">
                              <strong className="text-slate-200">{item.analyst_name}</strong>
                              <span className="text-right tabular-nums">
                                {item.analyzed}/{item.evaluated}
                              </span>
                              <span className="text-right tabular-nums text-violet-200">
                                {formatChatPercent(item.coverage_percentage)}
                              </span>
                              <span className="text-right tabular-nums text-emerald-200">{item.approved}</span>
                              <span className="text-right tabular-nums text-amber-100">{item.pending}</span>
                              <span className="text-right tabular-nums text-cyan-200">{item.coaching_signals}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                </div>
              </details>

            </>
          )}
        </div>


      </details>

      <section className={chatActiveTab === 'reports' && chatMetricsReady ? 'workspace-content-section' : 'hidden'}>
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="workspace-eyebrow">Leitura para fechamento</p>
            <p className="mt-1 text-xs text-slate-500">Fonte: {chatReportSourceLabel}</p>
            <h2 className="mt-2 text-2xl font-bold">{chatReportClosureReading}</h2>
          </div>
          <span className="rounded-md bg-cyan-400/10 px-3 py-2 text-sm font-semibold text-cyan-200">
            {chatReportEligibleCount} {chatReportEligibleCount === 1 ? 'elegível' : 'elegíveis'} de {chatReportCalculationMetrics.length}
          </span>
        </div>

        <div className="mt-5 grid overflow-hidden rounded-xl border border-white/10 bg-slate-950/25 lg:grid-cols-3 lg:divide-x lg:divide-white/10">
          <div className="p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">Destaque do período</p>
            <p className="mt-2 text-lg font-bold">{chatReportTopHighlight ? getChatAnalystName(chatReportTopHighlight) : 'Aguardando dados'}</p>
            <p className="mt-1 text-sm text-slate-400">
              {chatReportTopHighlight ? `CSAT ${formatChatPercent(chatReportTopHighlight.csat)} · ${formatChatPercent(chatReportTopHighlight.review_percentage)} avaliações · ${formatChatCount(chatReportTopHighlight.total_tickets)} atendimentos` : 'Selecione uma competência com dados para liberar a leitura.'}
            </p>
          </div>
          <div className="border-t border-white/10 p-4 lg:border-t-0">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">Ponto de atenção</p>
            <p className="mt-2 text-lg font-bold">{chatReportAttentionHighlight ? getChatAnalystName(chatReportAttentionHighlight) : 'Sem prioridade aberta'}</p>
            <p className="mt-1 text-sm text-slate-400">{chatReportAttentionText}</p>
          </div>
          <div className="border-t border-white/10 p-4 lg:border-t-0">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">Referência de volume</p>
            <p className="mt-2 text-lg font-bold tabular-nums">{formatChatCount(chatReportVolumeReference)} atendimentos</p>
            <p className="mt-1 text-sm text-slate-400">Mínimo usado no critério de volume desta competência.</p>
          </div>
        </div>
      </section>

      <section className={chatActiveTab === 'analysis' ? 'panel' : 'hidden'}>
        <details className="rounded-xl border border-white/10 bg-slate-950/25 p-4">
          <summary className="cursor-pointer list-none">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-violet-200">
                  Consulta qualitativa
                </p>
                <strong className="mt-1 block text-sm text-slate-200">Analisar ticket específico</strong>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  Use para investigar um ticket e decidir se ele deve compor um feedback.
                </p>
              </div>
              <span className="text-xs font-semibold text-violet-200">Abrir</span>
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
              {clickDeskQualitativeLoading && clickDeskQualitativeResultSource === 'manual'
                ? 'Analisando...'
                : 'Analisar ticket'}
            </button>
          </div>

          {clickDeskQualitativeResultSource === 'manual' && clickDeskQualitativeResult && (
            <>
              <QualitativeAnalysisCard
                result={clickDeskQualitativeResult}
                audience="management"
                reanalyzing={clickDeskQualitativeLoading}
                onReanalyze={
                  clickDeskQualitativeResult.error
                    ? () => void handleAnalyzeClickDeskQualitative()
                    : undefined
                }
              />
              {clickDeskQualitativeResult.analysis && clickDeskQualitativeResult.ticket_id && (
                <QualitativeValidationActions
                  ticketId={clickDeskQualitativeResult.ticket_id}
                  status={clickDeskQualitativeResult.validation_status}
                  validating={
                    clickDeskQualitativeValidationTicketId === clickDeskQualitativeResult.ticket_id
                  }
                  onValidate={(ticketId, status) =>
                    void handleValidateClickDeskQualitative(ticketId, status)
                  }
                />
              )}
            </>
          )}
        </details>
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

      <details className={chatActiveTab === 'overview' && chatMetricsReady ? 'panel' : 'hidden'}>
        <summary className="cursor-pointer text-sm font-semibold text-cyan-100">Histórico Zendesk · consultar meses anteriores</summary>
        <div className="mt-4">
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
      </details>

      <section className={chatActiveTab === 'reports' && chatMetricsReady ? 'workspace-content-section workspace-content-section-divided' : 'hidden'}>
        <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <p className="workspace-eyebrow">Reconhecimento</p>
            <h2 className="section-title">{chatReportInProgress ? 'Prévia do pódio do chat' : 'Pódio final do chat'}</h2>
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
        <details className="workspace-collapsible xl:col-span-2">
          <summary className="cursor-pointer list-none">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="workspace-eyebrow">Ranking detalhado</p>
                <h2 className="mt-1 text-xl font-bold">Ranking mensal do chat</h2>
                <p className="section-subtitle">
                  Abra para conferir posição, elegibilidade, critérios e exceções operacionais sem carregar toda a tabela na leitura principal do fechamento.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-md bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-200">
                  Referência: {formatChatCount(chatReportVolumeReference)}
                </span>
                <span className="rounded-md border border-white/10 bg-slate-950/40 px-3 py-2 text-xs font-semibold text-slate-300">
                  Abrir ranking
                </span>
              </div>
            </div>
          </summary>

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
        </details>

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
      <section id="chat-report-individual" className={chatActiveTab === 'reports' ? 'workspace-content-section workspace-content-section-divided' : 'hidden'}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-cyan-300">Relatório individual</p>
            <h2 className="section-title">{chatReportInProgress ? 'Acompanhamento mensal por analista' : 'Fechamento mensal por analista'}</h2>
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
          <div className="phone-kpi-grid mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <MetricCard label="CSAT" value={chatReportUsesClickDesk && selectedChatReportMetric.reviews === 0 ? '—' : formatChatPercent(selectedChatReportMetric.csat)} />
            <MetricCard label="% de avaliações" value={formatChatPercent(selectedChatReportMetric.review_percentage)} />
            <MetricCard label="Avaliações recebidas" value={formatChatCount(selectedChatReportMetric.reviews)} />
            <MetricCard label="Atendimentos" value={selectedChatReportMetric.total_tickets} />
            <MetricCard label="Pódio" value={selectedChatPodiumPosition > 0 ? `${selectedChatPodiumPosition}º lugar` : 'Fora'} />
          </div>
        ) : (
          <EmptyState text="Selecione um analista com dados para gerar o relatório." />
        )}

        <div className="mt-5 grid overflow-hidden rounded-xl border border-white/10 bg-slate-950/25 md:grid-cols-4 md:divide-x md:divide-white/10">
          <div className="p-3 text-sm text-slate-400">
            <strong className="block text-slate-100">1. Conferir</strong>
            <span className="mt-1 block text-xs leading-5">Indicadores, volume e pódio.</span>
          </div>
          <div className="border-t border-white/10 p-3 text-sm text-slate-400 md:border-t-0">
            <strong className="block text-slate-100">2. Selecionar tickets</strong>
            <span className="mt-1 block text-xs leading-5">Escolha opcional na régua diária.</span>
          </div>
          <div className="border-t border-white/10 p-3 text-sm text-slate-400 md:border-t-0">
            <strong className="block text-slate-100">3. Revisar feedback</strong>
            <span className="mt-1 block text-xs leading-5">Dados, evidências e contexto do gestor.</span>
          </div>
          <div className="border-t border-white/10 p-3 text-sm text-slate-400 md:border-t-0">
            <strong className="block text-slate-100">4. Exportar</strong>
            <span className="mt-1 block text-xs leading-5">Documento individual do fechamento.</span>
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
                  Selecione os tickets úteis na régua diária do analista ou em Gestão e ações. Somente os selecionados entram no feedback; não é necessário decidir sobre os demais.
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
                  disabled={!selectedChatReportMetric}
                  onClick={() => {
                    if (!selectedChatReportMetric) return
                    setChatQualitativeFocusAnalystId(selectedChatReportMetric.analyst_id)
                    onChatActiveTabChange('podium')
                    window.setTimeout(() => {
                      document
                        .getElementById('chat-qualitative-validation')
                        ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                    }, 80)
                  }}
                >
                  Selecionar tickets deste analista
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
      
      <section className={chatActiveTab === 'reports' && chatMetricsReady ? 'workspace-content-section workspace-content-section-divided' : 'hidden'}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="workspace-eyebrow">
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


      {isManagementUser && chatActiveTab === 'settings' && <ChatAccessManagement analysts={analysts}/>}
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
            {liveChatAnalysis ? chatAuditPeriod.label : selectedPeriod?.label ?? 'Período'} - {selectedTeamName}
          </span>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-6">
          <MetricCard label="Atendidos" value={formatChatCount(totals.tickets)} />
          <MetricCard label="Inativos" value={`${formatChatCount(totals.inactive)} (${formatChatPercent(chatInactiveRate)})`} />
          <MetricCard label="Válidos" value={formatChatCount(totals.validTickets)} />
          <MetricCard label="Avaliações" value={`${formatChatCount(totals.reviews)} (${formatChatPercent(chatReviewRate)})`} />
          <MetricCard label="Sem avaliação" value={`${formatChatCount(Math.max(totals.validTickets - totals.reviews, 0))} (${formatChatPercent(chatSendingRate)})`} />
          <MetricCard label={liveChatAnalysis ? "CSAT consolidado por avaliações" : "CSAT médio do histórico"} value={liveChatAnalysis && totals.reviews === 0 ? '—' : formatChatPercent(averageCsat)} />
        </div>
        {liveChatAnalysis && (
          <p className="mt-3 text-xs text-amber-200">
            ClickDesk · {chatAuditPeriod.label} · amostra de autoria final auditada.
            CSAT consolidado = {totals.positives} avaliações positivas / {totals.reviews} avaliações recebidas.
            Nunca é a média simples dos percentuais individuais.
            A competência permanece em conferência até a conciliação histórica completa.
          </p>
        )}

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
                  <td className="whitespace-nowrap px-3 py-3 tabular-nums">{liveChatAnalysis && metric.reviews === 0 ? '—' : formatChatPercent(metric.csat)}</td>
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
                <td className="whitespace-nowrap px-3 py-3 tabular-nums">{liveChatAnalysis && totals.reviews === 0 ? '—' : formatChatPercent(averageCsat)}</td>
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

function ClickDeskSyncStatus({
  latestSyncAt,
  schedule,
  historical = false,
  compact = false,
}: {
  latestSyncAt?: string | null
  schedule?: ClickDeskPersistedMetrics['sync_schedule']
  historical?: boolean
  compact?: boolean
}) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const nextSyncAt = schedule?.next_sync_at ? new Date(schedule.next_sync_at) : null
  const nextSyncTime =
    nextSyncAt && !Number.isNaN(nextSyncAt.getTime())
      ? new Intl.DateTimeFormat('pt-BR', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'America/Sao_Paulo',
        }).format(nextSyncAt)
      : null
  const nextSyncTimestamp =
    nextSyncAt && !Number.isNaN(nextSyncAt.getTime()) ? nextSyncAt.getTime() : null
  const latestSyncTimestamp =
    latestSyncAt && !Number.isNaN(new Date(latestSyncAt).getTime())
      ? new Date(latestSyncAt).getTime()
      : null
  const intervalMs = (schedule?.interval_minutes ?? 30) * 60 * 1000
  const currentBusinessHour = Number(
    new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      hourCycle: 'h23',
      timeZone: 'America/Sao_Paulo',
    }).format(new Date(now)),
  )
  const insideSyncWindow = currentBusinessHour >= 0 && currentBusinessHour <= 23
  const latestSyncIsStale =
    insideSyncWindow &&
    (latestSyncTimestamp === null || now - latestSyncTimestamp > intervalMs + 10 * 60 * 1000)
  const isOverdue =
    latestSyncIsStale ||
    (nextSyncTimestamp !== null && now > nextSyncTimestamp + 120000)
  const remainingMs =
    nextSyncTimestamp === null ? null : Math.max(0, nextSyncTimestamp - now)
  const remainingSeconds = remainingMs === null ? null : Math.floor(remainingMs / 1000)
  const hours = remainingSeconds === null ? 0 : Math.floor(remainingSeconds / 3600)
  const minutes = remainingSeconds === null ? 0 : Math.floor((remainingSeconds % 3600) / 60)
  const seconds = remainingSeconds === null ? 0 : remainingSeconds % 60
  const countdown =
    remainingSeconds === null
      ? 'aguardando agenda'
      : isOverdue
        ? 'atualização atrasada'
        : hours > 0
          ? `${hours}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`
          : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`

  void compact
  void countdown
  return <p className="text-xs leading-5 text-slate-400" role="status">
    Atualizado: <strong>{latestSyncAt ? formatDateTime(latestSyncAt) : 'em preparação'}</strong>
    {!historical && <> · Próxima captura prevista: {nextSyncTime ?? 'aguardando agenda'}</>}
    {historical && <span> · Período histórico · data da última captura</span>}
    {!historical && isOverdue&&<span className="ml-2 text-amber-200">Atualização pendente</span>}
  </p>
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
        <EmptyState text="Sem dados suficientes para o gráfico." />
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
        {!points.length && <EmptyState text="Sem dados suficientes para o gráfico." />}
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
        {!points.length && <EmptyState text="Sem dados suficientes para o gráfico." />}
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
        {!rows.length && <EmptyState text="Sem dados suficientes para o gráfico." />}
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-2 text-sm text-slate-300">
      {label}
      {children}
    </label>
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

function normalizeUserRole(role: string | null | undefined): UserRole {
  const normalized = (role ?? '').toLowerCase()

  if (normalized.includes('master')) return 'master'
  if (normalized.includes('coord')) return 'coordinator'
  if (normalized.includes('analista') || normalized.includes('analyst')) return 'analyst'
  return 'analyst'
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
  const rawStatus =
    metric.status ||
    (Number(metric.csat) >= csatGoal && Number(metric.review_percentage) >= reviewGoal
      ? 'Meta Superada'
      : 'Em acompanhamento')
  const status =
    rawStatus === 'Meta Superada'
      ? 'Dentro das metas'
      : rawStatus === 'Critico'
        ? 'Requer atenção'
        : rawStatus
  const statusColor =
    rawStatus === 'Meta Superada'
      ? '#059669'
      : rawStatus === 'Critico'
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
  const positiveReviewsText =
    Number(metric.positive_reviews) === 1
      ? '1 avaliação positiva'
      : `${formatChatCount(metric.positive_reviews)} avaliações positivas`
  const negativeReviewsText =
    Number(metric.negative_reviews) === 1
      ? '1 avaliação negativa'
      : `${formatChatCount(metric.negative_reviews)} avaliações negativas`
  const finalFeedback =
    feedbackText.trim() ||
    buildChatFeedbackText({ metric, podiumPosition, managerNotes })
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
    : 'Nenhuma avaliação negativa selecionada para feedback.'

  const positiveSummaryText = positiveQualitativeFindings.length
    ? positiveHumanText
      ? `Na amostra positiva, destacaram-se: ${positiveHumanText}`
      : `Na amostra positiva, os principais sinais foram ${positiveCauseText || 'favoráveis, sem um padrão único dominante'}.`
    : 'Nenhuma avaliação positiva selecionada para feedback.'

  const qualitativeHtml = qualitativeFindings.length
    ? `
      <section class="section-block">
        <div class="section-heading">
          <span class="section-kicker">Tickets selecionados pela gestão</span>
          <h2>Resumo qualitativo da experiência</h2>
        </div>
        <div class="insight-box">
          <div class="sample-line">
            <strong>${qualitativeFindings.length} ticket(s) selecionado(s) para feedback</strong>
            <span>${negativeQualitativeFindings.length} negativa(s) · ${positiveQualitativeFindings.length} positiva(s)</span>
          </div>
          <p class="muted">Seleção para feedback: ${qualitativeContext?.negativeAnalyzed ?? 0} de ${qualitativeContext?.negativeTotal ?? 0} negativas e ${qualitativeContext?.positiveAnalyzed ?? 0} de ${qualitativeContext?.positiveTotal ?? 0} positivas.</p>
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
          <strong>Nenhum ticket selecionado para feedback nesta competência.</strong>
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
          <p class="summary-note">Síntese individual da competência, com foco no resultado alcançado, no histórico disponível e nos próximos passos.</p>
        </section>

        <div class="kpi-grid">
          <div class="kpi-card">
            <span>CSAT</span>
            <strong>${formatPercent(metric.csat)}</strong>
            <em>Meta ${csatGoal}% · ${formatDelta(csatGap, ' p.p.')}</em>
          </div>
          <div class="kpi-card">
            <span>% de avaliações</span>
            <strong>${formatPercent(metric.review_percentage)}</strong>
            <em>Referência ${reviewGoal}% · ${formatDelta(reviewGap, ' p.p.')}</em>
          </div>
          <div class="kpi-card">
            <span>Avaliações recebidas</span>
            <strong>${formatChatCount(metric.reviews)}</strong>
            <em>${escapeHtml(positiveReviewsText)} · ${escapeHtml(negativeReviewsText)}</em>
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
              <p>${escapeHtml(csatText)} Foram registradas ${escapeHtml(positiveReviewsText)} e ${escapeHtml(negativeReviewsText)}.</p>
            </div>
            <div class="reading-card">
              <span>Participação dos clientes</span>
              <strong>${formatPercent(metric.review_percentage)} dos atendimentos avaliados</strong>
              <p>${escapeHtml(reviewText)} A taxa considera ${formatChatCount(metric.reviews)} respostas sobre ${formatChatCount(metric.valid_tickets)} atendimentos válidos.</p>
            </div>
            <div class="reading-card">
              <span>Volume do período</span>
              <strong>${formatChatCount(metric.total_tickets)} atendimentos</strong>
              <p>${formatChatCount(metric.total_tickets)} atendimentos registrados na competência.</p>
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
  podiumPosition,
  managerNotes,
}: {
  metric: ChatMonthlyMetric
  podiumPosition: number
  managerNotes: string
}) {
  const analystName = getChatAnalystName(metric)
  const csatGoal = Number(metric.csat_goal) || 90
  const reviewGoal = Number(metric.general_review_goal) || 25
  const csatMet = Number(metric.csat) >= csatGoal
  const reviewMet = Number(metric.review_percentage) >= reviewGoal
  const isPodium = podiumPosition > 0 && podiumPosition <= 3

  const cycleReading =
    csatMet && reviewMet
      ? `${analystName} encerra a competência dentro das metas de qualidade e participação nas avaliações.${isPodium ? ` O resultado também levou ao ${podiumPosition}º lugar no pódio.` : ''}`
      : !csatMet && !reviewMet
        ? `${analystName} encerra a competência com dois pontos que pedem acompanhamento: qualidade percebida e participação nas avaliações.`
        : !csatMet
          ? `${analystName} encerra a competência com participação adequada nas avaliações, mas com atenção necessária à qualidade percebida pelos clientes.`
          : `${analystName} encerra a competência com qualidade percebida dentro da meta, mas ainda precisa ampliar a participação dos clientes nas avaliações.`

  const nextStep =
    !csatMet
      ? 'O próximo passo é revisar as avaliações negativas e as evidências reais dos atendimentos para entender o que influenciou a experiência do cliente e definir uma ação concreta para o próximo ciclo.'
      : !reviewMet
        ? 'O próximo passo é reforçar um encerramento claro do atendimento e o convite natural à pesquisa, acompanhando se a amostra cresce no próximo fechamento.'
        : 'O próximo passo é identificar, nas evidências reais do atendimento, quais práticas ajudaram a sustentar esse resultado e transformá-las em um padrão consciente para o próximo ciclo.'

  const evidenceRule =
    'Os indicadores mostram o resultado do período, mas não explicam sozinhos o comportamento que o produziu. Reconhecimentos ou ajustes comportamentais devem ser apoiados por exemplos reais, observações da gestão ou evidências dos tickets selecionados para feedback.'

  return [
    cycleReading,
    nextStep,
    evidenceRule,
    managerNotes.trim()
      ? `Contexto registrado pela gestão: ${managerNotes.trim()}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

function formatChatFeedbackForReport(text: string) {
  return text
    .split(/\r?\n\r?\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\r?\n/g, '<br />')}</p>`)
    .join('')
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
  const month = chatMonthOptions.find((option) => Number(option.value) === monthNumber)?.label ?? 'Período'
  const paddedMonth = String(monthNumber).padStart(2, '0')
  const lastDay = new Date(year, monthNumber, 0).getDate()

  return {
    label: `${month} ${year}`,
    start: `${year}-${paddedMonth}-01`,
    end: publishedClickDeskEnd(`${year}-${paddedMonth}-${String(lastDay).padStart(2, '0')}`),
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

function formatDelta(value: number, suffix = '') {
  const numericValue = Number(value)
  const absoluteValue = Math.abs(numericValue)
  const isPercentLike = suffix.includes('%') || suffix.includes('p.p.')
  const formattedValue = isPercentLike
    ? formatPercentNumber(absoluteValue)
    : chatCountFormatter.format(absoluteValue)

  return `${numericValue > 0 ? '+' : numericValue < 0 ? '-' : ''}${formattedValue}${suffix}`
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

function getQualitativeUserError(message?: string, status?: number) {
  const normalized = message?.trim() ?? ''

  if (
    status === 401 ||
    status === 403 ||
    status === 404 ||
    status === 422
  ) {
    return normalized || 'Não foi possível analisar qualitativamente este atendimento.'
  }

  if (
    (status !== undefined && status >= 500) ||
    /gemini|ai gateway|github models|high demand|credit card|quota|provider|temporar|overloaded|resource exhausted|http 429|http 503/i.test(
      normalized,
    )
  ) {
    return 'A IA qualitativa está temporariamente indisponível. O ticket não foi alterado e pode ser analisado novamente.'
  }

  return normalized || 'Não foi possível analisar qualitativamente este atendimento.'
}

function getSupabaseMessage(message: string) {
  if (message.toLowerCase().includes('jwt issued at future')) return ''
  return message
}

function ChatProductionContent(){
 const [refresh,setRefresh]=useState(0),[state,setState]=useState<{role:UserRole;chatId:string|null;teams:ChatTeam[];analysts:ChatAnalyst[];metrics:ChatMonthlyMetric[];manual:ChatPodiumManual[];excluded:ChatPodiumExclusion[]}|null>(null),[error,setError]=useState('')
 const [tab,setTab]=useState<ChatActiveTab>(()=>typeof window!=='undefined'&&new URLSearchParams(window.location.search).get('view')==='operation360'?'operation360':'overview')
 const enabled=process.env.NEXT_PUBLIC_CHAT_OFFICIAL_ENABLED==='true'&&process.env.NEXT_PUBLIC_SUPABASE_URL==='https://qmetbydkepfdgfqkdkai.supabase.co'
 useEffect(()=>{if(!enabled)return;let cancelled=false;const identityChanged=createSessionIdentityGuard();const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,session)=>{if(identityChanged(session?.user))window.location.reload()});void(async()=>{try{
  const auth=await supabase.auth.getUser();if(identityChanged(auth.data.user)){window.location.reload();return}if(!auth.data.user)throw Error('Entre no sistema para acessar o Chat.')
  const profile=await supabase.from('profiles').select('role,chat_analyst_id').eq('id',auth.data.user.id).single();if(profile.error)throw Error('Perfil indisponível.')
  const role=normalizeUserRole(profile.data.role),chatId=profile.data.chat_analyst_id
  if(role==='analyst'&&!chatId)throw Error('Seu acesso ainda não tem vínculo com um analista do Chat.')
  const [teams,analysts,metrics,manual,excluded]=await Promise.all([
   supabase.from('chat_teams').select('*').order('name'),supabase.from('chat_analysts').select('*').order('name'),
   supabase.from('chat_monthly_metrics').select('*,chat_analysts(name,csat_goal,photo_url),chat_teams(name)').order('period_start',{ascending:false}).limit(500),
   supabase.from('chat_podium_manual').select('*'),supabase.from('chat_podium_exclusions').select('*')])
  if([teams,analysts,metrics,manual,excluded].some(r=>r.error))throw Error('Não foi possível carregar o cadastro do Chat.')
  if(!cancelled)setState({role,chatId,teams:teams.data??[],analysts:analysts.data??[],metrics:metrics.data??[],manual:manual.data??[],excluded:excluded.data??[]})
 }catch(e){if(!cancelled)setError(e instanceof Error?e.message:'Chat indisponível.')}})();return()=>{cancelled=true;subscription.unsubscribe()}},[enabled,refresh])
 if(!enabled)return <main className="page-shell"><p>O novo Chat ainda não foi habilitado em produção.</p><Link href="/">Voltar à Central</Link></main>
 if(error)return <main className="page-shell"><p role="status">{error}</p><Link href="/">Voltar à Central</Link></main>
 if(!state)return <main className="page-shell"><p role="status">Carregando Chat...</p></main>
 const analyst=state.analysts.find(a=>a.id===state.chatId)??null
 return <main className="page-shell"><header><h1>Performance do Chat</h1><p>{state.role==='analyst'?'Acesso individual · somente seus dados':'Visão de gestão'}</p><Link href="/">Voltar à Central</Link></header>{state.role!=='analyst'&&<nav className="flex flex-wrap gap-2 py-4" aria-label="Navegação do Chat">{([['overview','Operação'],['operation360','Visão 360º'],['prototype','Equipe e produtividade'],['podium','Gestão e ações'],['analysis','Pódio'],['reports','Relatórios'],['import','Importar histórico'],['settings','Cadastros']] as const).map(([key,label])=><button key={key} type="button" className={tab===key?'primary-button':'secondary-button'} aria-pressed={tab===key} onClick={()=>setTab(key)}>{label}</button>)}</nav>}{state.role==='analyst'?<ChatAnalystPortal analyst={analyst} team={state.teams.find(t=>t.id===analyst?.team_id)??null}/>:<ChatModuleDashboard role={state.role} teams={state.teams} analysts={state.analysts} metrics={state.metrics} manualPodium={state.manual} podiumExclusions={state.excluded} loading={false} chatActiveTab={tab} onChatActiveTabChange={setTab} onImportComplete={async()=>setRefresh(v=>v+1)}/>}</main>
}

export default function ChatProductionPage(){return <div className="chat-production-shell"><ChatProductionContent/></div>}



