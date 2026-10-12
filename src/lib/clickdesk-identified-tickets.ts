export type TicketEvidence = {ticket_id:string;occurred_date:string}
export function summarizeIdentifiedTickets(legacy:TicketEvidence[], verified:TicketEvidence[]){
 const tickets=new Map<string,{date:string;source:'legacy'|'verified'}>()
 const oldIds=new Set<string>(),newIds=new Set<string>()
 for(const row of legacy){
  const id=String(row.ticket_id||'').trim()
  if(!id||!/^20\d{2}-\d{2}-\d{2}$/.test(row.occurred_date))continue
  oldIds.add(id)
  if(!tickets.has(id))tickets.set(id,{date:row.occurred_date,source:'legacy'})
 }
 for(const row of verified){
  const id=String(row.ticket_id||'').trim()
  if(!id||!/^20\d{2}-\d{2}-\d{2}$/.test(row.occurred_date))continue
  newIds.add(id)
  tickets.set(id,{date:row.occurred_date,source:'verified'})
 }
 const grouped=new Map<string,{count:number,old:number,newCount:number}>()
 for(const item of tickets.values()){
  const group=grouped.get(item.date)??{count:0,old:0,newCount:0}
  group.count++
  if(item.source==='legacy')group.old++;else group.newCount++
  grouped.set(item.date,group)
 }
 return{
  total:tickets.size,legacy_count:oldIds.size,verified_count:newIds.size,
  overlap_count:[...oldIds].filter(x=>newIds.has(x)).length,
  daily:[...grouped.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([date,v])=>({
   date,count:v.count,source:v.old&&v.newCount?'mixed' as const:v.newCount?'verified' as const:'legacy' as const,
  })),official:false as const,
 }
}
