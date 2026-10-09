/** Verified human response counts, keyed by ticket + analyst.
 * Independent of official resolved-ticket totals and legacy CSAT/podium data.
 */
export type VerifiedContributionRow = {
 ticket_id:string
 analyst_id:string
 team_id:string
 analyst_name:string
 occurred_date:string
 verified_at:string | null
}
export function summarizeVerifiedContributions(rows:VerifiedContributionRow[],today:string){
 const seen=new Set<string>()
 const byDay=new Map<string,number>()
 const analysts=new Map<string,{
  analyst_id:string,team_id:string,analyst_name:string,total:number,
  days:Map<string,number>
 }>()
 let latest:string|null=null
 for(const row of rows){
  if(!row.ticket_id||!row.analyst_id||!row.team_id||!row.occurred_date)continue
  const normalized=row.analyst_name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase()
  if(/^(ana julia|david)( |$)/.test(normalized))continue
  const key=row.ticket_id+'::'+row.analyst_id
  if(seen.has(key))continue
  seen.add(key)
  const current=analysts.get(row.analyst_id)??{
   analyst_id:row.analyst_id,team_id:row.team_id,analyst_name:row.analyst_name,
   total:0,days:new Map<string,number>()
  }
  if(current.team_id!==row.team_id)continue
  current.total++
  current.days.set(row.occurred_date,(current.days.get(row.occurred_date)??0)+1)
  analysts.set(row.analyst_id,current)
  byDay.set(row.occurred_date,(byDay.get(row.occurred_date)??0)+1)
  if(row.verified_at&&Number.isFinite(Date.parse(row.verified_at))&&
      (!latest||Date.parse(row.verified_at)>Date.parse(latest)))latest=row.verified_at
 }
 const daily=[...byDay].sort(([a],[b])=>a.localeCompare(b))
  .map(([date,count])=>({date,count}))
 return {
  source:'clickdesk_public_agent_message' as const,
  total:seen.size,
  today:{date:today,count:byDay.get(today)??0},
  daily,
  by_analyst:[...analysts.values()].map(({days,...a})=>({
   ...a,daily:[...days].sort(([a],[b])=>a.localeCompare(b))
    .map(([date,count])=>({date,count})),
   today:days.get(today)??0,
  })).sort((a,b)=>b.total-a.total||a.analyst_name.localeCompare(b.analyst_name,'pt-BR')),
  last_verified_at:latest,
  has_records:daily.length>0,
  coverage_status:'partial_until_queue_finished' as const,
 }
}
