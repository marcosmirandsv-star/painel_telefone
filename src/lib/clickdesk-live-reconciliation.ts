/** A ticket is credited to one proven final human, with or without rating.
 * Unrated transfers with unknown final responder are pending, never guessed. */
export type HumanTicket={ticket_id:string;analyst_id:string;occurred_date:string;satisfaction_label:string|null;source:'legacy'|'verified';rating_attribution?:string|null}
export type TeamAnalyst={id:string;name:string}
const percentage=(a:number,b:number)=>b?Math.round(10000*a/b)/100:null
const rated=(x:string|null)=>x==='positive'||x==='negative'
const apprentice=(name:string)=>/^(ana julia|david)( |$)/i.test(name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim())

export function reconcileLiveTeam(analysts:TeamAnalyst[],rows:HumanTicket[],ownId:string){
 const allowed=new Set(analysts.filter(a=>!apprentice(a.name)).map(a=>a.id))
 if(!allowed.has(ownId))return null
 const all=new Map<string,Map<string,{old?:HumanTicket;verified?:HumanTicket}>>()
 for(const row of rows){
  if(!row.ticket_id||!row.analyst_id||!/^20\d{2}-\d{2}-\d{2}$/.test(row.occurred_date))continue
  const perPerson=all.get(row.ticket_id)??new Map()
  const prior=perPerson.get(row.analyst_id)??{}
  if(row.source==='verified')prior.verified=row;else prior.old=row
  perPerson.set(row.analyst_id,prior)
  all.set(row.ticket_id,perPerson)
 }
 const assignments=new Map<string,Array<{ticket_id:string;date:string}>>()
 const positives=new Map<string,number>(),negatives=new Map<string,number>()
 const pending=new Map<string,number>(),transferred=new Map<string,number>()
 let unresolved=0
 for(const [ticket_id,persons] of all){
  const members=[...persons].map(([id,source])=>({id,source}))
  const finalRated=members.filter(m=>rated(m.source.verified?.satisfaction_label??null)&&m.source.verified?.rating_attribution==='last_public_human_answer')
  const owner=finalRated.length===1?finalRated[0]:finalRated.length===0&&members.length===1?members[0]:null
  if(!owner){
   unresolved++
   for(const p of members)if(allowed.has(p.id))pending.set(p.id,(pending.get(p.id)??0)+1)
   continue
  }
  for(const p of members)if(p.id!==owner.id&&allowed.has(p.id))transferred.set(p.id,(transferred.get(p.id)??0)+1)
  if(!allowed.has(owner.id))continue
  const best=owner.source.verified??owner.source.old!
  const lst=assignments.get(owner.id)??[]
  lst.push({ticket_id,date:best.occurred_date});assignments.set(owner.id,lst)
  const score=finalRated.length===1?owner.source.verified?.satisfaction_label??null:
    owner.source.verified?.satisfaction_label??owner.source.old?.satisfaction_label??null
  if(score==='positive')positives.set(owner.id,(positives.get(owner.id)??0)+1)
  if(score==='negative')negatives.set(owner.id,(negatives.get(owner.id)??0)+1)
 }
 const team=[...allowed].map(analyst_id=>{
  const attendances=assignments.get(analyst_id)?.length??0
  const positive_reviews=positives.get(analyst_id)??0,negative_reviews=negatives.get(analyst_id)??0
  const reviews=positive_reviews+negative_reviews
  return {analyst_id,attendances,positive_reviews,negative_reviews,reviews,
   csat:percentage(positive_reviews,reviews),review_percentage:percentage(reviews,attendances)}
 })
 const active=team.filter(x=>x.attendances>0)
 const avg=active.length?Math.round(active.reduce((n,x)=>n+x.attendances,0)*100/active.length)/100:0
 const eligible=(x:typeof team[number])=>(x.csat??0)>=90&&(x.review_percentage??0)>=25&&x.attendances>=avg
 const ranked=active.slice().sort((a,b)=>Number(eligible(b))-Number(eligible(a))||(b.csat??0)-(a.csat??0)||(b.review_percentage??0)-(a.review_percentage??0)||b.attendances-a.attendances||a.analyst_id.localeCompare(b.analyst_id))
 const own=team.find(x=>x.analyst_id===ownId)!
 const owned_tickets=(assignments.get(ownId)??[]).sort((a,b)=>a.date.localeCompare(b.date)||a.ticket_id.localeCompare(b.ticket_id))
 const grouped=new Map<string,number>()
 for(const r of owned_tickets)grouped.set(r.date,(grouped.get(r.date)??0)+1)
 const csat_met=(own.csat??0)>=90,review_met=(own.review_percentage??0)>=25,volume_met=own.attendances>0&&own.attendances>=avg
 return {...own,owned_tickets,daily:[...grouped].sort(([a],[b])=>a.localeCompare(b)).map(([date,count])=>({date,count})),
  pending_owner_tickets:pending.get(ownId)??0,
  transferred_to_another_human:transferred.get(ownId)??0,
  unresolved_tickets_in_capture:unresolved,
  partial_capture:true as const,inactivity_not_identified:true as const,
  podium:{position:ranked.findIndex(x=>x.analyst_id===ownId)+1||null,total_ranked:ranked.length,
   eligible:eligible(own),team_average_attendances:avg,
   criteria:{csat_min:90,review_min:25,volume_min:avg,csat_met,review_met,volume_met,
    completed:Number(csat_met)+Number(review_met)+Number(volume_met)}
  }
 }
}
