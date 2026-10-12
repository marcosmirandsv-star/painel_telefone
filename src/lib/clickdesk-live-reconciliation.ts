export type HumanTicket = { ticket_id: string; analyst_id: string; occurred_date: string; satisfaction_label: string | null; source: 'legacy' | 'verified'; rating_attribution?: string | null }
export type TeamAnalyst = { id: string; name: string }
const pct=(a:number,b:number)=>b>0?Math.round(a/b*10000)/100:null
const rated=(x:string|null)=>x==='positive'||x==='negative'
export function reconcileLiveTeam(analysts:TeamAnalyst[], input:HumanTicket[], ownId:string){
 const validIds=new Set(analysts.filter(a=>!/^(ana julia|david)( |$)/i.test(a.name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim())).map(a=>a.id))
 if(!validIds.has(ownId))return null
 const pairs=new Map<string,HumanTicket>()
 for(const r of input){
  if(!r.ticket_id||!validIds.has(r.analyst_id)||!/^20\d{2}-\d{2}-\d{2}$/.test(r.occurred_date))continue
  const key=r.ticket_id+'::'+r.analyst_id,existing=pairs.get(key)
  if(!existing||r.source==='verified'&&existing.source==='legacy')pairs.set(key,r)
 }
 const byTicket=new Map<string,HumanTicket[]>()
 const volumes=new Map<string,number>()
 for(const r of pairs.values()){
  const a=byTicket.get(r.ticket_id)??[];a.push(r);byTicket.set(r.ticket_id,a)
  volumes.set(r.analyst_id,(volumes.get(r.analyst_id)??0)+1)
 }
 const evaluations=new Map<string,{good:number;bad:number}>()
 let ambiguous=0
 for(const items of byTicket.values()){
  const verified=items.filter(r=>r.source==='verified'&&rated(r.satisfaction_label)&&r.rating_attribution==='last_public_human_answer')
  const legacy=items.filter(r=>r.source==='legacy'&&rated(r.satisfaction_label))
  const chosen=verified.length?verified:legacy
  if(chosen.length>1){ambiguous++;continue}
  if(!chosen.length)continue
  const r=chosen[0],c=evaluations.get(r.analyst_id)??{good:0,bad:0}
  if(r.satisfaction_label==='positive')c.good++;else c.bad++
  evaluations.set(r.analyst_id,c)
 }
 const all=[...validIds].map(analyst_id=>{
  const total=volumes.get(analyst_id)??0
  const good=evaluations.get(analyst_id)?.good??0,bad=evaluations.get(analyst_id)?.bad??0
  return {analyst_id,attendances:total,positive_reviews:good,negative_reviews:bad,reviews:good+bad,csat:pct(good,good+bad),review_percentage:pct(good+bad,total)}
 })
 const scored=all.filter(x=>x.attendances>0)
 const avg=scored.length?Math.round(scored.reduce((n,v)=>n+v.attendances,0)/scored.length*100)/100:0
 const eligible=(r:typeof all[number])=>(r.csat??0)>=90&&(r.review_percentage??0)>=25&&r.attendances>=avg
 const ranked=scored.slice().sort((a,b)=>Number(eligible(b))-Number(eligible(a))||(b.csat??0)-(a.csat??0)||(b.review_percentage??0)-(a.review_percentage??0)||b.attendances-a.attendances||a.analyst_id.localeCompare(b.analyst_id))
 const own=all.find(x=>x.analyst_id===ownId)!
 const csat_met=(own.csat??0)>=90,review_met=(own.review_percentage??0)>=25,volume_met=own.attendances>=avg&&own.attendances>0
 return {...own,partial_capture:true as const,inactivity_not_identified:true as const,ambiguous_rated_tickets:ambiguous,podium:{
  position:ranked.findIndex(x=>x.analyst_id===ownId)+1||null,total_ranked:ranked.length,eligible:eligible(own),team_average_attendances:avg,
  criteria:{csat_min:90,review_min:25,volume_min:avg,csat_met,review_met,volume_met,completed:Number(csat_met)+Number(review_met)+Number(volume_met)}
 }}
}
