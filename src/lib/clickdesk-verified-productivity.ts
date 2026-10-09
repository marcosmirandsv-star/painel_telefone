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
 satisfaction_label?:'positive'|'negative'|null
}
export function summarizeVerifiedContributions(rows:VerifiedContributionRow[],today:string){
 const seen=new Set<string>()
 const ticketReviews=new Set<string>()
 let positive=0,negative=0
 const ratingsDaily=new Map<string,{positive:number,negative:number}>()
 const analystRatings=new Map<string,{positive:number,negative:number}>()
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
  if((row.satisfaction_label==='positive'||row.satisfaction_label==='negative') && !ticketReviews.has(row.ticket_id)){
    ticketReviews.add(row.ticket_id)
    const isPositive=row.satisfaction_label==='positive'
    if(isPositive)positive++;else negative++
    const dailyReview=ratingsDaily.get(row.occurred_date)??{positive:0,negative:0}
    dailyReview[isPositive?'positive':'negative']++
    ratingsDaily.set(row.occurred_date,dailyReview)
    const analystReview=analystRatings.get(row.analyst_id)??{positive:0,negative:0}
    analystReview[isPositive?'positive':'negative']++
    analystRatings.set(row.analyst_id,analystReview)
  }
  if(row.verified_at&&Number.isFinite(Date.parse(row.verified_at))&&
      (!latest||Date.parse(row.verified_at)>Date.parse(latest)))latest=row.verified_at
 }
 const daily=[...byDay].sort(([a],[b])=>a.localeCompare(b))
  .map(([date,count])=>({date,count}))
 const percent=(part:number,denom:number)=>denom>0?Math.round(part/denom*10000)/100:null
 const reviews=positive+negative
 const reviewStats=(p:number,n:number,attendances:number)=>({
   positive_reviews:p,negative_reviews:n,reviews:p+n,
   csat:percent(p,p+n),review_percentage:percent(p+n,attendances),
 })
 return {
  source:'clickdesk_public_agent_message' as const,
  evaluations:reviewStats(positive,negative,seen.size),
  evaluation_source:'clickdesk_ticket_rating_last_public_human' as const,
  ratings_daily:[...ratingsDaily].sort(([a],[b])=>a.localeCompare(b))
    .map(([date,r])=>({date,...reviewStats(r.positive,r.negative,byDay.get(date)??0)})),
  total:seen.size,
  today:{date:today,count:byDay.get(today)??0},
  daily,
  by_analyst:[...analysts.values()].map(({days,...a})=>({
   ...a,
   evaluations:(()=>{const r=analystRatings.get(a.analyst_id)??{positive:0,negative:0};
     return reviewStats(r.positive,r.negative,a.total)})(),
   daily:[...days].sort(([a],[b])=>a.localeCompare(b))
    .map(([date,count])=>({date,count})),
   today:days.get(today)??0,
  })).sort((a,b)=>b.total-a.total||a.analyst_name.localeCompare(b.analyst_name,'pt-BR')),
  last_verified_at:latest,
  has_records:daily.length>0,
  coverage_status:'partial_until_queue_finished' as const,
 }
}
