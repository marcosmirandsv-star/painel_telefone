import type {SupabaseClient} from '@supabase/supabase-js'
import {ApiError} from './integration-server'
import {chatMetricTotals} from './chat-metric-totals'
import type {OfficialDailyMetricRow} from './clickdesk-official-metrics'
export async function loadEventPeriodRows(admin:SupabaseClient,filters:{start:string;end:string;analystId?:string|null;teamId?:string|null}){
 const people=await admin.from('chat_analysts').select('id,name,team_id,active')
 if(people.error)throw new ApiError(503,'Cadastro de analistas indisponível.')
 const roster=new Map((people.data??[]).filter(person=>person.active).map(person=>[person.id,person]))
 const data:Record<string,unknown>[]=[]
 for(let offset=0;offset<10000;offset+=500){
  let query=admin.from('clickdesk_event_published_daily').select('*').gte('occurred_date',filters.start).lte('occurred_date',filters.end).order('occurred_date').order('analyst_id')
  if(filters.analystId)query=query.eq('analyst_id',filters.analystId)
  if(filters.teamId)query=query.eq('team_id',filters.teamId)
  const page=await query.range(offset,offset+499)
  if(page.error)throw new ApiError(503,'A contagem por eventos está indisponível.')
  data.push(...(page.data??[]))
  if((page.data?.length??0)<500)break
  if(offset===9500)throw new ApiError(503,'A contagem por eventos excedeu a paginação segura.')
 }
 if(!data.length)throw new ApiError(503,'Preparando a contagem por eventos. A base anterior não foi apresentada como resultado protegido.')
 const dailyRows:OfficialDailyMetricRow[]=data.flatMap(metric=>{
  const person=roster.get(String(metric.analyst_id));if(!person)return []
  return [{occurred_date:String(metric.occurred_date),team_id:String(metric.team_id),analyst_id:person.id,area:'Suporte - ERP e Suporte - Fiscal',assignee_name:person.name,identity_role:'analyst',
   attendances:Number(metric.attendances),positive_reviews:Number(metric.positive_reviews),negative_reviews:Number(metric.negative_reviews),
   excluded_neutrals:Number(metric.excluded_neutrals),neutral_human:Number(metric.neutral_human),neutral_external:Number(metric.neutral_external),neutral_pending:Number(metric.neutral_pending),
   reviews:Number(metric.positive_reviews)+Number(metric.negative_reviews),csat:null,review_percentage:null}]
 })
 const expectedDays=Math.round((Date.parse(filters.end)-Date.parse(filters.start))/86400000)+1
 const ids=[...new Set(dailyRows.map(row=>row.analyst_id))]
 if(!ids.length||ids.some(id=>new Set(dailyRows.filter(row=>row.analyst_id===id).map(row=>row.occurred_date)).size!==expectedDays))throw new ApiError(503,'O intervalo ainda está em conferência. Nenhum dia faltante foi tratado como zero.')
 const rows=ids.map(id=>{const own=dailyRows.filter(row=>row.analyst_id===id);return {...own[0],occurred_date:filters.end,...chatMetricTotals(own)}})
 const capturedAt=data.map(row=>String(row.captured_at)).sort().at(-1)??null
 return {rows,dailyRows,coverage:{complete:true,verified_at:capturedAt,entries:[] as never[]},admin,excludedInactive:0,lastReconciledAt:capturedAt,metricSource:'clickdesk_event_receipts' as const}
}
