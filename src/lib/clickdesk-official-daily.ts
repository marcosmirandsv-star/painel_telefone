type Row = {occurred_date:string;assignee_name:string;attendances:number;positive_reviews:number;negative_reviews:number}
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
  }
  return daily
}
