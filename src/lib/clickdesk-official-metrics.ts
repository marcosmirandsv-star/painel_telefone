import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError } from './integration-server'
import { reconciledDaily, sliceOfficialDaily } from './clickdesk-official-daily'
import { publishedClickDeskEnd } from './clickdesk-publication'

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
  excluded_neutrals?: number
  neutral_human?: number
  neutral_external?: number
  neutral_pending?: number
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

type OfficialResult={rows:OfficialDailyMetricRow[];dailyRows:OfficialDailyMetricRow[]|null;coverage:{complete:boolean;verified_at:string|null;entries:never[]};admin:SupabaseClient;excludedInactive:number;lastReconciledAt:string|null;metricSource:'clickdesk_official_period_metrics'|'clickdesk_event_receipts'}
export async function loadOfficialPeriodRows(
  admin: SupabaseClient,
  filters: {start:string;end:string;analystId?:string|null;teamId?:string|null},
):Promise<OfficialResult|null> {
  let official = await admin
    .rpc('get_scoped_clickdesk_official_period_metrics', {
      p_start: filters.start,
      p_end: filters.end,
    })

  if(filters.start>='2026-11-01'&&!official.error&&(!official.data?.length||official.data.some((metric:OfficialPeriodMetric)=>!Number.isFinite(Date.parse(metric.captured_at))||Date.now()-Date.parse(metric.captured_at)>=30*60*1000))){
    const requested=await admin.rpc('request_clickdesk_official_period',{p_start:filters.start,p_end:filters.end})
    if(requested.error)throw new ApiError(503,'Não foi possível solicitar a captura deste intervalo do ClickDesk.')
    for(let attempt=0;attempt<15&&!official.data?.length;attempt++){
      await new Promise(resolve=>setTimeout(resolve,2000))
      official=await admin.rpc('get_scoped_clickdesk_official_period_metrics',{p_start:filters.start,p_end:filters.end})
      if(official.error)break
    }
    if(!official.error&&!official.data?.length)throw new ApiError(503,'O ClickDesk ainda está preparando este intervalo. Tente novamente em instantes.')
  }

  if (official.error) {
    console.warn('clickdesk_official_snapshot_unavailable', {
      code: official.error.code,
      message: official.error.message,
    })
    throw new ApiError(503, 'A fotografia oficial do ClickDesk não está disponível.')
  }
  if (!official.data?.length) {
    // A day/week can reuse only daily captures reconciled with the same scoped monthly source.
    const monthStart=filters.start.slice(0,7)+'-01'
    const [year,month]=filters.start.slice(0,7).split('-').map(Number)
    const monthEnd=publishedClickDeskEnd(new Date(Date.UTC(year,month,0)).toISOString().slice(0,10))
    if(filters.start.slice(0,7)===filters.end.slice(0,7)&&(filters.start!==monthStart||filters.end!==monthEnd)) {
      const anchor=await loadOfficialPeriodRows(admin,{...filters,start:monthStart,end:monthEnd})
      if(!anchor?.dailyRows)throw new ApiError(503,'A distribuição diária deste mês ainda não está conciliada com o ClickDesk. O intervalo selecionado não foi substituído pelo total mensal.')
      const selected=sliceOfficialDaily(anchor.rows,anchor.dailyRows,filters.start,filters.end)
      return {...anchor,rows:selected.rows,dailyRows:selected.dailyRows}
    }
    return null
  }

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

  const neutral=filters.start>='2026-11-01'?await admin.rpc('get_scoped_clickdesk_official_neutral_counts',{p_start:filters.start,p_end:filters.end}):{data:[],error:null}
  if(neutral.error)throw new ApiError(503,'Não foi possível conferir os ajustes das avaliações neutras.')
  type NeutralCounts={period_start:string;period_end:string;source_owner_key:string;excluded_neutrals:number;neutral_human:number;neutral_external:number;neutral_pending:number}
  const counts=(key:string,start:string,end:string)=>{
    const found=(neutral.data??[] as NeutralCounts[]).find((n:NeutralCounts)=>n.source_owner_key===key&&n.period_start===start&&n.period_end===end)
    return {excluded_neutrals:Number(found?.excluded_neutrals??0),neutral_human:Number(found?.neutral_human??0),neutral_external:Number(found?.neutral_external??0),neutral_pending:Number(found?.neutral_pending??0)}
  }
  const rows = (official.data as OfficialPeriodMetric[])
    .map(metric => {
      const person = roster.get(metric.source_owner_key)
      const isActive = Boolean(person?.active)
      return {
        ...counts(metric.source_owner_key,filters.start,filters.end),
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

  const daily = await admin.rpc('get_scoped_clickdesk_official_daily_metrics', {p_start:filters.start,p_end:filters.end})
  const candidates:OfficialDailyMetricRow[] = daily.error ? [] : (daily.data ?? []).flatMap((metric:OfficialPeriodMetric & {occurred_date:string})=>{
    const person=rows.find(row=>row.assignee_name===metric.source_owner_name)
    return person ? [{...person,...counts(metric.source_owner_key,metric.occurred_date,metric.occurred_date),occurred_date:metric.occurred_date,attendances:Number(metric.attendances),positive_reviews:Number(metric.positive_reviews),negative_reviews:Number(metric.negative_reviews),reviews:Number(metric.positive_reviews)+Number(metric.negative_reviews)}] : []
  })
  const dailyRows=reconciledDaily<OfficialDailyMetricRow>(rows,candidates,filters.start,filters.end)

  return {
    rows,
    dailyRows,
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
