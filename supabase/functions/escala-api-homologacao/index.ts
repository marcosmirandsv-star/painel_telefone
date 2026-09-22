
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type, authorization, apikey, x-client-info",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};

function json(data: unknown, status=200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {...cors, "content-type":"application/json; charset=utf-8", "cache-control":"no-store"},
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok",{headers:cors});
  const url = new URL(req.url);
  const body = req.method === "POST" ? await req.json().catch(()=>({})) : {};
  const token = url.searchParams.get("token") ?? String(body.token ?? "");
  if (!token) return json({error:"Link inválido."},400);

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    {auth:{persistSession:false}}
  );

  const {data: link} = await db.from("schedule_public_links")
    .select("id,team_id,year,month,active,expires_at,schedule_teams(id,name)")
    .eq("token",token).maybeSingle();

  if (!link || !link.active || !link.team_id || !link.year || !link.month) {
    return json({error:"Link inválido ou desativado."},404);
  }
  if (link.expires_at && new Date(link.expires_at).getTime() < Date.now()) {
    return json({error:"Link expirado."},410);
  }

  const {data: publication} = await db.from("schedule_publications").select("released")
    .eq("team_id",link.team_id).eq("year",link.year).eq("month",link.month).maybeSingle();
  if (!publication?.released) return json({error:"Este mês ainda não foi liberado."},403);

  const prefix = `${link.year}-${String(link.month).padStart(2,"0")}`;
  const start = `${prefix}-01`;
  const end = new Date(Date.UTC(link.year,link.month,0,12)).toISOString().slice(0,10);

  if (req.method === "POST") {
    const requesterName = String(body.requesterName ?? "").trim();
    const requesterEmail = String(body.requesterEmail ?? "").trim().toLowerCase();
    const targetDate = String(body.targetDate ?? "");
    const requestType = String(body.requestType ?? "").trim();
    const reason = String(body.reason ?? "").trim();

    if (!requesterName || !targetDate || !requestType || !targetDate.startsWith(prefix)) {
      return json({error:"Informe nome, data válida e tipo da solicitação."},400);
    }
    const {data,error} = await db.from("schedule_requests").insert({
      requester_name: requesterName,
      requester_email: requesterEmail || null,
      team_id: link.team_id,
      target_date: targetDate,
      request_type: requestType,
      reason: reason || null,
    }).select("id,status,created_at").single();

    if (error) return json({error:"Não foi possível enviar a solicitação."},500);
    return json({ok:true,request:data,message:"Solicitação enviada. A gestão foi notificada."},201);
  }

  const [{data: entries},{data: memberships},{data: people}] = await Promise.all([
    db.from("schedule_entries")
      .select("person_id,date,entry_type,value")
      .eq("team_id",link.team_id).gte("date",start).lte("date",end).order("date"),
    db.from("schedule_memberships")
      .select("person_id,start_date,end_date,participates_in_schedule,participates_hybrid,participates_lunch,participates_snack,participates_extended")
      .eq("team_id",link.team_id).lte("start_date",end),
    db.from("schedule_people").select("id,name,active").order("name"),
  ]);

  const validMemberships=(memberships??[]).filter((m:any)=>!m.end_date||m.end_date>=start);
  const validIds=new Set(validMemberships.map((m:any)=>m.person_id));
  const visiblePeople=(people??[]).filter((p:any)=>validIds.has(p.id));

  return json({
    team: Array.isArray(link.schedule_teams) ? link.schedule_teams[0] : link.schedule_teams,
    year: link.year,
    month: link.month,
    start,
    end,
    people: visiblePeople,
    memberships: validMemberships,
    entries: entries??[],
  });
});
