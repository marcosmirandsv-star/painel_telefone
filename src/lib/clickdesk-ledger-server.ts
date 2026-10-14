import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError } from './integration-server'
import type { FinalTicket } from './clickdesk-final-owner'

type LedgerRow = {
  ticket_id: string
  analyst_id: string
  team_id: string
  last_public_message_id: string
  last_public_at: string
  occurred_date: string
  area: string | null
  satisfaction_label: 'positive' | 'negative' | null
  rating_timestamp_warning: boolean
  evidence_source: string
  verified_at: string
}

/** Only server-side admin clients can read this RLS-protected table. */
export async function readFinalLedger(
  admin: SupabaseClient,
  filters: { start: string; end: string; analystId?: string | null; teamId?: string | null },
): Promise<LedgerRow[]> {
  const records: LedgerRow[] = []
  for (let offset = 0; offset < 50000; offset += 500) {
    let query = admin.from('clickdesk_final_ticket_ledger')
      .select('ticket_id,analyst_id,team_id,last_public_message_id,last_public_at,occurred_date,area,satisfaction_label,rating_timestamp_warning,evidence_source,verified_at')
      .gte('occurred_date', filters.start)
      .lte('occurred_date', filters.end)
      .order('ticket_id', { ascending: true })
    if (filters.analystId) query = query.eq('analyst_id', filters.analystId)
    if (filters.teamId) query = query.eq('team_id', filters.teamId)
    const { data, error } = await query.range(offset, offset + 499)
    if (error) throw new ApiError(503, 'Ledger ClickDesk de homologação indisponível.')
    const page = (data ?? []) as LedgerRow[]
    records.push(...page)
    if (page.length < 500) return records
  }
  throw new ApiError(422, 'Ledger ClickDesk excedeu o limite de paginação segura.')
}

export async function readLedgerCoverage(admin: SupabaseClient) {
  const { data, error } = await admin.from('clickdesk_final_coverage')
    .select('source_key,start_date,end_date,candidate_count,confirmed_count,pending_count,completeness,verified_at')
    .order('verified_at', { ascending: false })
    .limit(20)
  if (error) throw new ApiError(503, 'Status da cobertura ClickDesk indisponível.')
  // Nunca inferir cobertura total de uma amostra parcial.
  const entries = data ?? []
  return {
    complete: entries.length > 0 && entries.every(e => e.completeness === 'complete'),
    entries,
    verified_at: entries[0]?.verified_at ?? null,
    note: 'Cobertura parcial; números ainda não equivalem ao relatório oficial nem à descoberta integral de tickets.',
  }
}

export function asFinalTicket(row: LedgerRow, name: string): FinalTicket {
  return {
    ticket_id: row.ticket_id,
    analyst_id: row.analyst_id,
    analyst_name: name,
    team_id: row.team_id,
    occurred_at: row.last_public_at,
    occurred_date: row.occurred_date,
    area: row.area,
    message_id: row.last_public_message_id,
    satisfaction_label: row.satisfaction_label,
    confirmed: true,
    reason: null,
    rating_timestamp_warning: row.rating_timestamp_warning,
  }
}
