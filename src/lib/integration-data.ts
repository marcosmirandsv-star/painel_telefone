import type { SupabaseClient } from '@supabase/supabase-js'
import { chatSummary, phoneSummary, type ChatIndicator, type PhoneIndividual, type PhoneTeam } from './indicators.ts'
import { ApiError, parseQuery } from './integration-server.ts'

type Period = ReturnType<typeof parseQuery>
type Week = { id: string; week_start: string; week_end: string }
type ChatRow = ChatIndicator & { id: string; team_id: string; analyst_id: string }
// Explicit paging avoids silently returning only Supabase's first 1,000 rows.
async function rows<T>(admin: SupabaseClient, table: string, columns: string, filters: Record<string, string | number>, period?: Period): Promise<T[]> {
  const result: T[] = []
  for (let offset = 0; offset < 100000; offset += 500) {
    let query = admin.from(table).select(columns).order('id').range(offset, offset + 499)
    for (const [key, value] of Object.entries(filters)) query = query.eq(key, value)
    if (period) query = query.lte('week_start', period.end).gte('week_end', period.start)
    const { data, error } = await query
    if (error) throw new ApiError(503, 'Base de indicadores indisponível.')
    result.push(...(data as unknown as T[]))
    if (data.length < 500) return result
  }
  throw new ApiError(422, 'Volume excede o limite de consulta.')
}
export async function currentIndicators(admin: SupabaseClient, period: Period, weekly = false) {
  const meta = { versao: '1', regras: '1', consultado_em: new Date().toISOString(), atualizado_em: null, status: 'parcial', canal: period.channel, mes: period.month || null, inicio: period.start, fim: period.end, equipe: period.team }
  if (period.channel === 'telefone') {
    const [individual, team] = await Promise.all([
      rows<PhoneIndividual & Week>(admin, 'weekly_individual_metrics', 'id,week_start,week_end,csat,total_reviews,total_tickets', {}, period),
      rows<PhoneTeam & Week>(admin, 'weekly_team_metrics', 'id,week_start,week_end,answered_calls,abandoned_calls,total_calls,overall_csat', {}, period),
    ])
    const weeks = [...new Set([...individual, ...team].map(row => `${row.week_start}|${row.week_end}`))].sort()
    return { ...meta, tem_dados: weeks.length > 0, regra_periodo: 'semanas_sobrepostas_integrais', semanas: weeks.map(key => { const [inicio, fim] = key.split('|'); return { inicio, fim, ...(weekly ? { indicadores: phoneSummary(individual.filter(r => r.week_start === inicio && r.week_end === fim), team.filter(r => r.week_start === inicio && r.week_end === fim)) } : {}) } }), indicadores: phoneSummary(individual, team) }
  }
  const filters: Record<string, string | number> = { year: Number(period.month.slice(0, 4)), month_number: Number(period.month.slice(5)) }
  if (period.team !== 'all') {
    filters.team_id = period.team
    const { data, error } = await admin.from('chat_teams').select('id').eq('id', period.team).maybeSingle()
    if (error) throw new ApiError(503, 'Equipes indisponíveis.')
    if (!data) throw new ApiError(404, 'Equipe não encontrada.')
  }
  const [metrics, exclusions] = await Promise.all([
    rows<ChatRow>(admin, 'chat_monthly_metrics', 'id,team_id,analyst_id,csat,review_percentage,sending_percentage,total_tickets,valid_tickets,reviews,positive_reviews,negative_reviews,inactive_tickets', filters),
    rows<{ id: string; analyst_id: string }>(admin, 'chat_podium_exclusions', 'id,analyst_id', filters),
  ])
  const excluded = new Set(exclusions.map(row => row.analyst_id))
  const included = metrics.filter(row => !excluded.has(row.analyst_id))
  return { ...meta, tem_dados: included.length > 0, regra_periodo: 'mes_importado_com_exclusoes_do_painel', indicadores: chatSummary(included, metrics.length - included.length) }
}

export async function officialIndicators(admin: SupabaseClient, period: Period) {
  const { data, error } = await admin.from('integration_closures').select('id,created_at,payload').eq('month', period.month).eq('channel', period.channel).eq('team', period.team).maybeSingle()
  if (error) throw new ApiError(503, 'Fechamentos indisponíveis.')
  if (!data) throw new ApiError(404, 'Ainda não existe fechamento oficial para este filtro.')
  return { ...data.payload, status: 'fechado', fechamento_id: data.id, fechado_em: data.created_at }
}
