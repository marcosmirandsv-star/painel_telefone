import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError } from '@/lib/integration-server'

export type ClickDeskClosurePeriod = {
  month: string
  start: string
  end: string
  team: string
}

type AttendanceRow = {
  clickdesk_ticket_id: string
  occurred_date: string
  area: string
  assignee_name: string
  analyst_id: string | null
  team_id: string | null
  identity_role: 'analyst' | 'management' | 'unmapped'
  satisfaction_label: string | null
  timestamp_source: string
}

type AnalystRow = {
  id: string
  team_id: string
  name: string
  csat_goal: number | string
  active: boolean
}

type TeamRow = {
  id: string
  name: string
  manager_name: string | null
}

type Totals = {
  attendances: number
  positive_reviews: number
  negative_reviews: number
  reviews: number
  csat: number | null
  review_percentage: number | null
}

function round(value: number) {
  return Math.round(value * 100) / 100
}

function aggregate(rows: AttendanceRow[]): Totals {
  const positive = rows.filter(
    (row) => String(row.satisfaction_label ?? '').toLowerCase() === 'positive',
  ).length
  const negative = rows.filter(
    (row) => String(row.satisfaction_label ?? '').toLowerCase() === 'negative',
  ).length
  const reviews = positive + negative
  const attendances = rows.length

  return {
    attendances,
    positive_reviews: positive,
    negative_reviews: negative,
    reviews,
    csat: reviews > 0 ? round((positive / reviews) * 100) : null,
    review_percentage:
      attendances > 0 ? round((reviews / attendances) * 100) : null,
  }
}

async function pagedAttendances(
  admin: SupabaseClient,
  period: ClickDeskClosurePeriod,
): Promise<AttendanceRow[]> {
  const result: AttendanceRow[] = []

  for (let offset = 0; offset < 100000; offset += 500) {
    let query = admin
      .from('clickdesk_chat_attendances')
      .select(
        'clickdesk_ticket_id,occurred_date,area,assignee_name,analyst_id,team_id,identity_role,satisfaction_label,timestamp_source',
      )
      .gte('occurred_date', period.start)
      .lte('occurred_date', period.end)
      .order('clickdesk_ticket_id', { ascending: true })
      .range(offset, offset + 499)

    if (period.team !== 'all') query = query.eq('team_id', period.team)

    const { data, error } = await query
    if (error) throw new ApiError(503, 'Base persistida do ClickDesk indisponível.')

    result.push(...((data ?? []) as AttendanceRow[]))
    if ((data ?? []).length < 500) return result
  }

  throw new ApiError(422, 'O volume do fechamento excedeu o limite de consulta.')
}

function groupBy<T>(items: T[], keyOf: (item: T) => string) {
  const grouped = new Map<string, T[]>()
  items.forEach((item) => {
    const key = keyOf(item)
    const current = grouped.get(key) ?? []
    current.push(item)
    grouped.set(key, current)
  })
  return grouped
}

export async function buildClickDeskClosureSnapshot(
  admin: SupabaseClient,
  period: ClickDeskClosurePeriod,
) {
  if (period.team !== 'all') {
    const { data, error } = await admin
      .from('chat_teams')
      .select('id')
      .eq('id', period.team)
      .maybeSingle()

    if (error) throw new ApiError(503, 'Não foi possível validar a equipe do fechamento.')
    if (!data) throw new ApiError(404, 'Equipe do chat não encontrada.')
  }

  const [attendanceRows, analystsResult, teamsResult, latestSyncResult, finalSyncResult] =
    await Promise.all([
      pagedAttendances(admin, period),
      admin
        .from('chat_analysts')
        .select('id,team_id,name,csat_goal,active'),
      admin.from('chat_teams').select('id,name,manager_name'),
      admin
        .from('clickdesk_chat_sync_runs')
        .select(
          'id,trigger_mode,status,period_start,period_end,rows_upserted,analyst_rows,management_rows,unmapped_rows,finished_at,timestamp_audit',
        )
        .eq('status', 'completed')
        .lte('period_start', period.end)
        .gte('period_end', period.start)
        .order('finished_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from('clickdesk_chat_sync_runs')
        .select(
          'id,trigger_mode,status,period_start,period_end,rows_upserted,finished_at,timestamp_audit',
        )
        .eq('status', 'completed')
        .lte('period_start', period.end)
        .gte('period_end', period.end)
        .order('finished_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

  if (analystsResult.error) throw new ApiError(503, 'Cadastro de analistas indisponível.')
  if (teamsResult.error) throw new ApiError(503, 'Cadastro de equipes indisponível.')
  if (latestSyncResult.error) throw new ApiError(503, 'Histórico de sincronização indisponível.')
  if (finalSyncResult.error) throw new ApiError(503, 'Validação final da competência indisponível.')

  const analysts = (analystsResult.data ?? []) as AnalystRow[]
  const teams = (teamsResult.data ?? []) as TeamRow[]
  const analystById = new Map(analysts.map((item) => [item.id, item]))
  const teamById = new Map(teams.map((item) => [item.id, item]))

  const performanceRows = attendanceRows.filter((row) => row.identity_role === 'analyst')
  const managementRows = attendanceRows.filter((row) => row.identity_role === 'management')
  const unmappedRows = attendanceRows.filter((row) => row.identity_role === 'unmapped')

  const analystGroups = groupBy(
    performanceRows.filter((row) => row.analyst_id),
    (row) => row.analyst_id as string,
  )

  const analystSnapshots = [...analystGroups.entries()]
    .map(([analystId, rows]) => {
      const analyst = analystById.get(analystId)
      const totals = aggregate(rows)
      const goal = analyst ? Number(analyst.csat_goal) : null
      const reviewGoal = 25

      return {
        analyst_id: analystId,
        name: analyst?.name ?? rows[0]?.assignee_name ?? 'Analista não identificado',
        team_id: rows[0]?.team_id ?? analyst?.team_id ?? null,
        team_name:
          teamById.get(rows[0]?.team_id ?? analyst?.team_id ?? '')?.name ?? null,
        active_at_closure: analyst?.active ?? null,
        csat_goal: Number.isFinite(goal) ? goal : null,
        review_goal: reviewGoal,
        ...totals,
        csat_goal_met:
          totals.csat !== null && Number.isFinite(goal)
            ? totals.csat >= Number(goal)
            : null,
        review_goal_met:
          totals.review_percentage !== null
            ? totals.review_percentage >= reviewGoal
            : false,
      }
    })
    .sort(
      (a, b) =>
        (a.team_name ?? '').localeCompare(b.team_name ?? '', 'pt-BR') ||
        a.name.localeCompare(b.name, 'pt-BR'),
    )

  const teamGroups = groupBy(
    attendanceRows.filter((row) => row.team_id),
    (row) => row.team_id as string,
  )

  const teamSnapshots = [...teamGroups.entries()]
    .map(([teamId, rows]) => {
      const performance = rows.filter((row) => row.identity_role === 'analyst')
      const management = rows.filter((row) => row.identity_role === 'management')
      const distinctAnalysts = new Set(
        performance.map((row) => row.analyst_id).filter(Boolean),
      )

      return {
        team_id: teamId,
        team_name: teamById.get(teamId)?.name ?? null,
        manager_name: teamById.get(teamId)?.manager_name ?? null,
        operational: aggregate(rows),
        performance: aggregate(performance),
        management_support: aggregate(management),
        analyst_count: distinctAnalysts.size,
        average_attendances:
          distinctAnalysts.size > 0
            ? round(performance.length / distinctAnalysts.size)
            : 0,
      }
    })
    .sort((a, b) =>
      (a.team_name ?? '').localeCompare(b.team_name ?? '', 'pt-BR'),
    )

  const managementGroups = groupBy(
    managementRows,
    (row) => `${row.assignee_name}::${row.team_id ?? 'sem-time'}::${row.area}`,
  )

  const managementSnapshots = [...managementGroups.values()]
    .map((rows) => ({
      name: rows[0]?.assignee_name ?? 'Gestão',
      team_id: rows[0]?.team_id ?? null,
      team_name: teamById.get(rows[0]?.team_id ?? '')?.name ?? null,
      area: rows[0]?.area ?? null,
      ...aggregate(rows),
    }))
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name, 'pt-BR') ||
        (a.area ?? '').localeCompare(b.area ?? '', 'pt-BR'),
    )

  const fallbackRows = attendanceRows.filter(
    (row) =>
      row.timestamp_source === 'updated_at' ||
      row.timestamp_source === 'unknown' ||
      row.timestamp_source.startsWith('fallback_'),
  )
  const missingTeamRows = attendanceRows.filter((row) => !row.team_id)
  const missingAnalystMetadata = analystSnapshots.filter(
    (item) => item.csat_goal === null || !item.team_id || !item.team_name,
  )

  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())

  const issues: string[] = []
  if (period.end >= today) {
    issues.push('A competência ainda está aberta.')
  }
  if (!finalSyncResult.data) {
    issues.push('O último dia da competência ainda não foi revalidado pelo ClickDesk.')
  }
  if (unmappedRows.length > 0) {
    issues.push(`${unmappedRows.length} atendimento(s) ainda estão sem identidade vinculada.`)
  }
  if (fallbackRows.length > 0) {
    issues.push(`${fallbackRows.length} atendimento(s) ainda usam fallback temporal.`)
  }
  if (missingTeamRows.length > 0) {
    issues.push(`${missingTeamRows.length} atendimento(s) ainda estão sem equipe vinculada.`)
  }
  if (missingAnalystMetadata.length > 0) {
    issues.push(
      `${missingAnalystMetadata.length} analista(s) do período estão sem cadastro, equipe ou meta completa.`,
    )
  }

  return {
    versao: '2',
    regras: 'clickdesk-human-v1',
    fonte: 'clickdesk_persisted',
    consultado_em: new Date().toISOString(),
    status: 'parcial',
    canal: 'chat',
    mes: period.month,
    inicio: period.start,
    fim: period.end,
    equipe: period.team,
    tem_dados: attendanceRows.length > 0,
    regra_periodo: 'atendimentos_humanos_clickdesk_por_data_operacional',
    regra_data:
      'first_assignee_message -> first_human_role_message -> explicit_fallback',
    metas: {
      review_percentage: 25,
      csat: 'meta individual congelada por analista no fechamento',
    },
    operacao: aggregate(attendanceRows),
    performance: aggregate(performanceRows),
    apoio_gestao: aggregate(managementRows),
    analistas: analystSnapshots,
    equipes: teamSnapshots,
    gestao: managementSnapshots,
    qualidade_dados: {
      unmapped_attendances: unmappedRows.length,
      fallback_timestamp_attendances: fallbackRows.length,
      missing_team_attendances: missingTeamRows.length,
      analyst_metadata_issues: missingAnalystMetadata.length,
    },
    sincronizacao: {
      ultima: latestSyncResult.data ?? null,
      fechamento_do_ultimo_dia: finalSyncResult.data ?? null,
    },
    fechamento: {
      pronto: attendanceRows.length > 0 && issues.length === 0,
      pendencias: issues,
    },
  }
}
