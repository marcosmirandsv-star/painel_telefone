import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { lastHumanRatingOwner } from "./last-human-rating.ts";

const BASE="https://api.desk.click.app/api/v1";
const HOMO="vvtorcvchnqhcredhorv.supabase.co";
const MAX_BATCH=20;
const TZ="America/Sao_Paulo";
const LIMIT_MS=18000;
type R=Record<string,unknown>;
const obj=(x:unknown):R=>x && typeof x==="object" && !Array.isArray(x)?x as R:{};
const str=(x:unknown):string=>typeof x==="string"?x.trim():typeof x==="number"&&Number.isFinite(x)?String(x):"";
const norm=(s:string)=>s.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("pt-BR").replace(/[^a-z0-9]+/g," ").trim().replace(/\s+/g," ");
const day=(t:string):string|null=>{
 const dt=new Date(t);if(!Number.isFinite(dt.getTime()))return null;
 const parts=new Intl.DateTimeFormat("en-US",{timeZone:TZ,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(dt);
 const p=(k:string)=>parts.find(x=>x.type===k)?.value??"";
 return p("year")+"-"+p("month")+"-"+p("day");
};
const validDay=(s:unknown):s is string=>typeof s==="string"&&/^20\d{2}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s+"T00:00:00Z"))&&new Date(s+"T00:00:00Z").toISOString().slice(0,10)===s;
const array=(p:unknown):unknown[]=>{
 if(Array.isArray(p))return p;
 const r=obj(p);
 for(const k of ["data","items","results","tickets","messages","events"]){
  if(Array.isArray(r[k]))return r[k] as unknown[];
  const child=obj(r[k]);
  for(const n of ["data","items","results","tickets","messages","events"])if(Array.isArray(child[n]))return child[n] as unknown[];
 }
 throw new Error("ClickDesk returned unrecognized collection envelope");
};
const pageCount=(p:unknown):number=>{
 const r=obj(p),meta=obj(r.meta),data=obj(r.data);
 const nodes=[r,meta,obj(meta.pagination),obj(r.pagination),obj(data.meta),obj(data.pagination)];
 for(const n of nodes)for(const key of ["last_page","lastPage","total_pages"]){
  const v=n[key];if(v==null)continue;const count=Number(v);
  if(Number.isSafeInteger(count)&&count>=1)return count;
 }
 throw new Error("ClickDesk pagination missing; not assuming complete");
};
const unwrap=(p:unknown):R=>{const r=obj(p),data=obj(r.data);return Object.keys(data).length?data:(Object.keys(obj(r.ticket)).length?obj(r.ticket):r)};
const ticketId=(r:R)=>str(r.id)||str(r.ticket_id);
const stamp=(m:R)=>str(m.created_at)||str(m.createdAt)||str(m.sent_at)||str(m.timestamp);
const safeTimestamp=(t:string)=>/(Z|[+-]\d{2}:\d{2})$/i.test(t)&&Number.isFinite(Date.parse(t));
const statusRating=(ticket:R)=>{
 const candidate=[ticket.satisfaction,ticket.rating,ticket.csat];
 for(const value of candidate){const source=obj(value),raw=str(source.label)||str(source.sentiment)||str(source.rating)||str(value);
  const normalized=norm(raw);
  if(["boa","bom","good","positive","positiva"].includes(normalized))return "positive";
  if(["ruim","bad","negative","negativa"].includes(normalized))return "negative";
 }
 return null;
};
async function get(path:string,key:string,account:string):Promise<unknown>{
 if(!path.startsWith("/tickets"))throw new Error("GET endpoint not approved");
 const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),LIMIT_MS);
 try{
  const response=await fetch(BASE+path,{method:"GET",headers:{Authorization:"Bearer "+key,"X-Account-Id":account,Accept:"application/json"},signal:ctl.signal});
  if(!response.ok)throw new Error("ClickDesk HTTP "+response.status+" "+path.slice(0,75));
  return await response.json();
 }finally{clearTimeout(timer)}
}
Deno.serve(async(req:Request)=>{
 const url=Deno.env.get("SUPABASE_URL")??"";
 if(!url||new URL(url).hostname!==HOMO)return Response.json({error:"homologation_only"},{status:403});
 if(req.method!=="POST")return Response.json({error:"post_only"},{status:405});
 const token=req.headers.get("authorization")?.replace(/^Bearer\s+/i,"").trim();
 if(!token)return Response.json({error:"unauthorized"},{status:401});
 const raw=Deno.env.get("SUPABASE_SECRET_KEYS"),legacy=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 let secret=legacy??"";
 if(raw)try{secret=str(JSON.parse(raw).default)}catch{}
 if(!secret)return Response.json({error:"admin_config_unavailable"},{status:503});
 const admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
 const cr=await admin.rpc("get_clickdesk_cron_credentials",{p_token:token});
 if(cr.error||!cr.data)return Response.json({error:"unauthorized"},{status:401});
 const key=str(cr.data.api_key),account=str(cr.data.account_id);
 if(!key||!account)return Response.json({error:"clickdesk_not_configured"},{status:503});
 let body:R;try{body=obj(await req.json())}catch{return Response.json({error:"invalid_json"},{status:400})}
 const start=body.start,end=body.end??body.start,action=body.action;
 if(!validDay(start)||!validDay(end)||end<start||start<"2026-10-03"||
    end>(day(new Date().toISOString())??"2026-10-09")||
    (Date.parse(end)-Date.parse(start))/86400000>31)return Response.json({error:"invalid_history_window"},{status:400});
 const dry=body.dry_run===true;
 if(action==="discover"){
  if(!dry)return Response.json({error:"discovery_requires_dry_run"},{status:400});
  const page=Number(body.page);
  if(!Number.isSafeInteger(page)||page<1||page>60)return Response.json({error:"invalid_page"},{status:400});
  try{
   const payload=await get("/tickets?inbox=all&view=all&stage=team&sort=id&dir=desc&per_page=500&page="+page,key,account);
   const total=pageCount(payload),tickets=array(payload);
   if(page>total||tickets.length===0)return Response.json({error:"page_out_of_bounds_or_empty",page,total},{status:422});
   const candidateDetails=tickets.map(x=>obj(x)).filter(t=>{
    const created=day(str(t.created_at)||str(t.createdAt));
    const updated=day(str(t.updated_at)||str(t.updatedAt)||str(t.closed_at)||str(t.created_at));
    return created&&updated&&created<=end&&updated>=start;
   }).map(t=>({ticket_id:ticketId(t),source_updated_at:str(t.updated_at)||str(t.updatedAt)||str(t.closed_at)||str(t.created_at)}))
     .filter(x=>x.ticket_id&&safeTimestamp(x.source_updated_at));
   const updatedDays=tickets.map(x=>day(str(obj(x).updated_at))).filter(Boolean).sort();
   return Response.json({ok:true,action:"discover",page,total_pages:total,scanned:tickets.length,
    candidates:[...new Set(candidateDetails.map(x=>x.ticket_id))],candidate_details:candidateDetails,oldest_updated_day:updatedDays[0]??null,
    newest_updated_day:updatedDays.at(-1)??null,dry_run:true,rows_written:0});
  }catch(e){return Response.json({error:e instanceof Error?e.message:"discovery_failed"},{status:503})}
 }
 if(action!=="process")return Response.json({error:"invalid_action"},{status:400});
 const ids=body.ticket_ids;
 if(!Array.isArray(ids)||ids.length<1||ids.length>MAX_BATCH||ids.some(x=>!/^\d+$/.test(str(x))))
  return Response.json({error:"invalid_ticket_ids"},{status:400});
 if(!dry && body.commit_verified!==true)return Response.json({error:"commit_verified_explicitly_required"},{status:400});
 const {data:roster,error:rosterError}=await admin.from("chat_analysts").select("id,team_id,name,active");
 if(rosterError)return Response.json({error:"analyst_registry_unavailable"},{status:503});
 const byName=new Map<string,R[]>();
 for(const analyst of roster??[]){const key=norm(str(analyst.name));byName.set(key,[...(byName.get(key)??[]),obj(analyst)])}
 const records:R[]=[],ticketAudit:R[]=[],errors:R[]=[];
 const unique=[...new Set(ids.map(str))];
 for(let i=0;i<unique.length;i+=4){
  const outcomes=await Promise.all(unique.slice(i,i+4).map(async id=>{
   try{
    const [ticketPayload,messagesPayload]=await Promise.all([
     get("/tickets/"+id,key,account),get("/tickets/"+id+"/messages",key,account)]);
    const ticket=unwrap(ticketPayload),messages=array(messagesPayload);
    const perAnalyst=new Map<string,R>();
    for(const m0 of messages){
     const m=obj(m0),authorObj=obj(m.author);
     const author=str(m.author_name)||str(m.author)||str(authorObj.name);
     const kind=(str(m.author_type)||str(authorObj.type)).toLowerCase();
     const visibility=str(m.visibility).toLowerCase();
     const isPublic=visibility==="public"||(!visibility&&(m.public===true||m.is_public===true));
     const t=stamp(m),messageId=str(m.id)||str(m.message_id);
     if(!author||kind!=="agent"||!isPublic||!safeTimestamp(t)||!messageId)continue;
     const matches=byName.get(norm(author))??[];
     if(matches.length!==1)continue;
     const match=matches[0],name=str(match.name);
     if(!name||!match.id||!match.team_id||/^(ana julia|david)( |$)/.test(norm(name)))continue;
     const existing=perAnalyst.get(str(match.id));
     if(!existing||Date.parse(t)<Date.parse(str(existing.first_answered_at)))
       perAnalyst.set(str(match.id),{ticket_id:id,analyst_id:match.id,team_id:match.team_id,
        analyst_name:name,first_message_id:messageId,first_answered_at:new Date(t).toISOString(),
        occurred_date:day(t),satisfaction_label:null,rating_attribution:"unverified",
        rating_last_message_id:null,rating_last_answered_at:null,
        evidence_source:"clickdesk_public_agent_message"});
    }
    // The client evaluation belongs to the LAST human who served the ticket.
    // Use the public agent message author across ALL teams. Current owner, bot
    // hand-off, status and message count never stand in for actual authorship.
    // Earlier contributors remain credited for their verified work, but not
    // for this ticket-level evaluation.
    const rating=statusRating(ticket);
    const lastHuman=lastHumanRatingOwner(messages);
    const ownerCandidates=lastHuman.ok?(byName.get(norm(lastHuman.author_name))??[]):[];
    const matchedOwner=ownerCandidates.length===1?ownerCandidates[0]:null;
    const creditedRow=matchedOwner?perAnalyst.get(str(matchedOwner.id)):null;
    const ratingAssigned=Boolean(rating && lastHuman.ok && creditedRow &&
      !/^(ana julia|david)( |$)/.test(norm(str(matchedOwner?.name))));
    if(ratingAssigned && lastHuman.ok && creditedRow){
      creditedRow.satisfaction_label=rating;
      creditedRow.rating_attribution="last_public_human_answer";
      creditedRow.rating_last_message_id=lastHuman.message_id;
      creditedRow.rating_last_answered_at=new Date(lastHuman.answered_at).toISOString();
    }
    const within=[...perAnalyst.values()].filter(x=>x.occurred_date>=start&&x.occurred_date<=end);
    const ownerRaw=ticket.owner??ticket.assignee??ticket.agent;
    const owner=str(ownerRaw)||str(obj(ownerRaw).name);
    return {rows:within,audit:{ticket_id:id,messages_scanned:messages.length,
       verified_analysts:within.map(x=>x.analyst_name),rating_on_ticket:rating,
       ticket_status:str(ticket.status),ticket_owner:owner||null,
       last_public_human:lastHuman.ok?lastHuman.author_name:null,
       rating_assigned:ratingAssigned && within.some(x=>x.analyst_id===matchedOwner?.id),
       rating_assignment_reason:!rating?"ticket_unrated":!lastHuman.ok?lastHuman.reason:
         !matchedOwner?"last_human_not_uniquely_registered":
         !creditedRow?"last_human_no_verified_contribution":
         "last_public_human_answer"}};
   }catch(e){return {error:{ticket_id:id,message:e instanceof Error?e.message:"ticket_read_failed"}}}
  }));
  for(const out of outcomes){if("error" in out)errors.push(out.error as R);else{
    records.push(...out.rows as R[]);ticketAudit.push(out.audit as R);
  }}
 }
 const preview={ok:errors.length===0,action:"process",dry_run:dry,requested:unique.length,
  processed:ticketAudit.length,contributions:records.length,unique_tickets:new Set(records.map(x=>x.ticket_id)).size,
  errors,rows:records,rows_written:0,
  rated_tickets:ticketAudit.filter(x=>x.rating_on_ticket==="positive"||x.rating_on_ticket==="negative").length,
  ratings_attributed:records.filter(x=>x.rating_attribution==="last_public_human_answer").length,
  ticket_audit:dry?ticketAudit:undefined,
  rating_note:"Each customer rating belongs exclusively to the last verified public human agent across all queues; ambiguous authors stay unassigned."};
 if(dry||errors.length)return Response.json(preview,{status:errors.length?422:200});
 if(records.length===0)return Response.json({...preview,dry_run:false,rows_written:0,rows:[]});
 // A single database transaction clears any older rated contributor and writes
 // the newly verified last public human. Re-openings cannot double-award CSAT.
 const {data:savedCount,error:saveError}=await admin.rpc(
   "clickdesk_save_verified_contributions",{p_rows:records});
 if(saveError)return Response.json({...preview,ok:false,error:saveError.message},{status:503});
 return Response.json({...preview,dry_run:false,rows_written:Number(savedCount) || records.length,
  rows:records.map(x=>({
  ticket_id:x.ticket_id,analyst_id:x.analyst_id,occurred_date:x.occurred_date}))});
});
