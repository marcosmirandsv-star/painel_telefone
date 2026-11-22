type Row = {occurred_date:string;assignee_name:string;attendances:number;positive_reviews:number;negative_reviews:number;excluded_neutrals?:number;neutral_human?:number;neutral_external?:number;neutral_pending?:number}
/** Require a complete per-owner calendar and reconciliation with the period capture. */
export function reconciledDaily<T extends Row>(period:T[],daily:T[],start:string,end:string):T[]|null {
  const days=[] as string[]
  for(let day=start;day<=end;day=new Date(Date.parse(day+'T12:00:00Z')+86400000).toISOString().slice(0,10))days.push(day)
  if(!period.length || daily.length!==period.length*days.length)return null
  const seen=new Set<string>()
  for(const row of daily){const key=row.assignee_name+'|'+row.occurred_date;if(seen.has(key)||!days.includes(row.occurred_date)||!period.some(p=>p.assignee_name===row.assignee_name))return null;seen.add(key)}
  for(const row of period){
    const own=daily.filter(d=>d.assignee_name===row.assignee_name)
    if(own.length!==days.length)return null
    for(const key of ['attendances','positive_reviews','negative_reviews'] as const)if(own.reduce((sum,d)=>sum+d[key],0)!==row[key])return null
    // A period's neutral decisions must also reconcile before selecting a subset.
    for(const key of ['excluded_neutrals','neutral_human','neutral_external','neutral_pending'] as const)if(own.reduce((sum,d)=>sum+(d[key]??0),0)!==(row[key]??0))return null
  }
  return daily
}

/** Counts come exclusively from the previously reconciled calendar; ratios stay in the existing aggregator. */
export function sliceOfficialDaily<T extends Row>(period:T[],daily:T[],start:string,end:string) {
 const selected=daily.filter(row=>row.occurred_date>=start&&row.occurred_date<=end)
 const rows=period.map(row=>{
   const own=selected.filter(day=>day.assignee_name===row.assignee_name)
   return {...row,occurred_date:end,attendances:own.reduce((n,d)=>n+d.attendances,0),positive_reviews:own.reduce((n,d)=>n+d.positive_reviews,0),negative_reviews:own.reduce((n,d)=>n+d.negative_reviews,0),
     excluded_neutrals:own.reduce((n,d)=>n+(d.excluded_neutrals??0),0),neutral_human:own.reduce((n,d)=>n+(d.neutral_human??0),0),neutral_external:own.reduce((n,d)=>n+(d.neutral_external??0),0),neutral_pending:own.reduce((n,d)=>n+(d.neutral_pending??0),0)}
 })
 // reviews is derived from the two original counters, never summed percentages.
 return {rows:rows.map(row=>({...row,reviews:row.positive_reviews+row.negative_reviews})),dailyRows:selected}
}
