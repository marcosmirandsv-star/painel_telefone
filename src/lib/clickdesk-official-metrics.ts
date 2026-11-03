import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError } from './integration-server'

export type OfficialDailyMetricRow = {
  occurred_date: string
  team_id: string | null
  analyst_id: string | null
  area: string
  assignee_name: string
  identity_role: 'analyst' | 'management' | 'unmapped' | 'apprentice'
  attendances: number
  positive_reviews: number
  negative_reviews: number
  reviews: number
  csat: number | null
  review_percentage: number | null
}

function normalizeSourceOwner(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ')
}

type OfficialPeriodMetric = {
  source_owner_name: string
  source_owner_key: string
  attendances: number
  positive_reviews: number
  negative_reviews: number
  captured_at: string
}

export async function loadOfficialPeriodRows(
  admin: SupabaseClient,
  filters: {start:string;end:string;analystId?:string|null;teamId?:string|null},
) {
  const official = await admin
    .rpc('get_scoped_clickdesk_official_period_metrics', {
      p_start: filters.start,
      p_end: filters.end,
    })

  if (official.error) {
    console.warn('clickdesk_official_snapshot_unavailable', {
      code: official.error.code,
      message: official.error.message,
    })
    throw new ApiError(503, 'A fotografia oficial do ClickDesk não está disponível.')
  }
  if (!official.data?.length) return null

  const people = await admin.from('chat_analysts').select('id,name,team_id,active')
  if (people.error) {
    console.warn('clickdesk_official_roster_unavailable', {
      code: people.error.code,
      message: people.error.message,
    })
    throw new ApiError(503, 'Cadastro de analistas da homologação indisponível.')
  }

  const roster = new Map(
    (people.data ?? []).map(person => [normalizeSourceOwner(person.name), person]),
  )
  const rows = (official.data as OfficialPeriodMetric[])
    .map(metric => {
      const person = roster.get(metric.source_owner_key)
      const isActive = Boolean(person?.active)
      return {
        occurred_date: filters.end,
        team_id: person?.team_id ?? null,
        analyst_id: person?.id ?? null,
        area: 'Suporte - ERP e Suporte - Fiscal',
        assignee_name: metric.source_owner_name,
        // The scoped RPC already restricts owners to the approved performance roster.
        identity_role: isActive ? 'analyst' : 'unmapped',
        attendances: Number(metric.attendances) || 0,
        positive_reviews: Number(metric.positive_reviews) || 0,
        negative_reviews: Number(metric.negative_reviews) || 0,
        reviews: (Number(metric.positive_reviews) || 0) + (Number(metric.negative_reviews) || 0),
        csat: null,
        review_percentage: null,
      } satisfies OfficialDailyMetricRow
    })
    .filter(row =>
      (!filters.analystId || row.analyst_id === filters.analystId) &&
      (!filters.teamId || row.team_id === filters.teamId),
    )

  const capturedAt = (official.data as OfficialPeriodMetric[])
    .map(row => row.captured_at)
    .sort()
    .at(-1) ?? null

  return {
    rows,
    coverage: {
      complete: true,
      verified_at: capturedAt,
      entries: [],
    },
    admin,
    excludedInactive: 0,
    lastReconciledAt: capturedAt,
    metricSource: 'clickdesk_official_period_metrics' as const,
  }
}
