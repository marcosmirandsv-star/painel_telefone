
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const esc = (value: unknown) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const monthNames = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

function monthEnd(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0, 12)).toISOString().slice(0, 10);
}

function businessDays(year: number, month: number) {
  const last = new Date(Date.UTC(year, month, 0, 12)).getUTCDate();
  const rows: {date:string,day:number}[] = [];
  for (let day=1; day<=last; day++) {
    const date = `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
    const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (dow >= 1 && dow <= 5) rows.push({date,day});
  }
  return rows;
}

function page(body: string, title = "Escala") {
  return new Response(`<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${esc(title)}</title>
<style>
:root{color-scheme:dark;font-family:Inter,system-ui,Arial,sans-serif;background:#020617;color:#f8fafc}
*{box-sizing:border-box}body{margin:0;background:#020617}main{max-width:1600px;margin:auto;padding:24px}
.banner{border:1px solid #f59e0b66;background:#451a0333;padding:12px 16px;border-radius:12px;margin-bottom:16px;color:#fde68a}
.card{border:1px solid #ffffff18;background:#0f172acc;border-radius:16px;padding:18px;margin-top:18px}
h1{margin:6px 0;font-size:30px}p{color:#94a3b8}.tabs{display:flex;gap:8px;flex-wrap:wrap;margin:18px 0}
button,.btn{border:1px solid #ffffff20;background:#1e293b;color:#fff;border-radius:10px;padding:9px 13px;cursor:pointer}
button.active{background:#0891b2}table{border-collapse:collapse;min-width:max-content;width:100%;font-size:13px}
th,td{border:1px solid #ffffff16;padding:8px;text-align:center}th:first-child,td:first-child{position:sticky;left:0;background:#0f172a;text-align:left;min-width:190px}
.wrap{overflow:auto;border-radius:14px;border:1px solid #ffffff18}.section{display:none}.section.active{display:block}
input,select,textarea{width:100%;border:1px solid #ffffff20;background:#020617;color:#fff;border-radius:9px;padding:10px}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}@media(max-width:700px){.grid{grid-template-columns:1fr}}
.ok{background:#052e1633;border:1px solid #22c55e55;padding:12px;border-radius:10px;color:#bbf7d0}.err{background:#450a0a55;border:1px solid #ef444455;padding:12px;border-radius:10px;color:#fecaca}
small{color:#64748b}
</style>
</head><body><main>${body}</main></body></html>`, {headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store"}});
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const db = createClient(supabaseUrl, serviceKey, {auth:{persistSession:false}});

  if (!token) return page('<div class="err">Link inválido.</div>', "Escala");

  const {data: link} = await db.from("schedule_public_links")
    .select("id,team_id,year,month,active,expires_at,schedule_teams(id,name)")
    .eq("token", token).maybeSingle();

  if (!link || !link.active || !link.team_id || !link.year || !link.month) {
    return page('<div class="err">Link inválido ou desativado.</div>', "Escala");
  }
  if (link.expires_at && new Date(link.expires_at).getTime() < Date.now()) {
    return page('<div class="err">Este link expirou.</div>', "Escala");
  }

  const {data: publication} = await db.from("schedule_publications").select("released")
    .eq("team_id",link.team_id).eq("year",link.year).eq("month",link.month).maybeSingle();
  if (!publication?.released) return page('<div class="err">Este mês ainda não foi liberado.</div>', "Escala");

  if (req.method === "POST") {
    const form = await req.formData();
    const requesterName = String(form.get("requester_name") ?? "").trim();
    const requesterEmail = String(form.get("requester_email") ?? "").trim().toLowerCase();
    const targetDate = String(form.get("target_date") ?? "");
    const requestType = String(form.get("request_type") ?? "").trim();
    const reason = String(form.get("reason") ?? "").trim();
    const prefix = `${link.year}-${String(link.month).padStart(2,"0")}`;

    if (!requesterName || !targetDate || !requestType || !targetDate.startsWith(prefix)) {
      return page('<div class="err">Preencha nome, data válida e tipo da solicitação.</div><p><a class="btn" href="?token='+esc(token)+'">Voltar</a></p>', "Solicitação");
    }

    const {error} = await db.from("schedule_requests").insert({
      requester_name: requesterName,
      requester_email: requesterEmail || null,
      team_id: link.team_id,
      target_date: targetDate,
      request_type: requestType,
      reason: reason || null
    });
    if (error) return page('<div class="err">Não foi possível enviar a solicitação.</div><p><a class="btn" href="?token='+esc(token)+'">Voltar</a></p>', "Solicitação");

    return page('<div class="ok"><strong>Solicitação enviada.</strong><br>A gestão responsável foi notificada.</div><p><a class="btn" href="?token='+esc(token)+'">Voltar para a escala</a></p>', "Solicitação enviada");
  }

  const prefix = `${link.year}-${String(link.month).padStart(2,"0")}`;
  const start = `${prefix}-01`;
  const end = monthEnd(link.year,link.month);
  const [{data: entries},{data: memberships},{data: people}] = await Promise.all([
    db.from("schedule_entries").select("person_id,date,entry_type,value").eq("team_id",link.team_id).gte("date",start).lte("date",end),
    db.from("schedule_memberships").select("person_id,start_date,end_date,participates_in_schedule,participates_hybrid,participates_lunch,participates_snack,participates_extended").eq("team_id",link.team_id).lte("start_date",end),
    db.from("schedule_people").select("id,name,active").order("name")
  ]);

  const validMemberships = (memberships ?? []).filter((m:any)=>!m.end_date || m.end_date >= start);
  const visiblePeople = (people ?? []).filter((p:any)=>validMemberships.some((m:any)=>m.person_id===p.id));
  const days = businessDays(link.year,link.month);
  const teamName = Array.isArray(link.schedule_teams) ? link.schedule_teams[0]?.name : (link.schedule_teams as any)?.name;

  const types = [["hybrid","Híbrido"],["lunch","Almoço"],["snack","Lanche"],["extended","Estendido"]];
  const sections = types.map(([type,label],idx)=>{
    const rows = visiblePeople.map((person:any)=>{
      const cells = days.map(day=>{
        const membership:any = validMemberships.find((m:any)=>m.person_id===person.id && m.start_date<=day.date && (!m.end_date || m.end_date>=day.date));
        if (!membership) return "<td>—</td>";
        const allowed = type==="hybrid" ? membership.participates_hybrid!==false
          : type==="lunch" ? membership.participates_lunch!==false
          : type==="snack" ? membership.participates_snack!==false
          : membership.participates_extended!==false;
        if (!allowed) return "<td>—</td>";
        const entry:any = (entries ?? []).find((e:any)=>e.person_id===person.id && e.date===day.date && e.entry_type===type);
        return `<td>${esc(entry?.value ?? "—")}</td>`;
      }).join("");
      return `<tr><td><strong>${esc(person.name)}</strong></td>${cells}</tr>`;
    }).join("");
    return `<section id="sec-${type}" class="section ${idx===0?"active":""}"><div class="wrap"><table><thead><tr><th>Colaborador</th>${days.map(d=>`<th>${d.day}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div></section>`;
  }).join("");

  const tabs = types.map(([type,label],idx)=>`<button class="${idx===0?"active":""}" data-tab="${type}">${label}</button>`).join("");
  const body = `
  <div class="banner">🧪 <strong>Ambiente de homologação</strong> — escala para validação interna.</div>
  <header><small>ESCALA PUBLICADA</small><h1>${esc(teamName ?? "Equipe")}</h1><p>${monthNames[link.month-1]} de ${link.year}</p></header>
  <div class="tabs">${tabs}</div>
  ${sections}
  <div class="card">
    <h2>Solicitar alteração</h2><p>O pedido será enviado para a gestão responsável e gerará uma notificação.</p>
    <form method="post" action="?token=${encodeURIComponent(token)}">
      <div class="grid">
        <label>Seu nome<input name="requester_name" required></label>
        <label>E-mail corporativo (opcional)<input name="requester_email" type="email"></label>
        <label>Data<input name="target_date" type="date" min="${start}" max="${end}" required></label>
        <label>Tipo<select name="request_type"><option>Troca de escala</option><option>Alteração de Home Office</option><option>Alteração de almoço</option><option>Alteração de lanche</option><option>Outro</option></select></label>
      </div>
      <label style="display:block;margin-top:10px">Justificativa<textarea name="reason" rows="4"></textarea></label>
      <button style="margin-top:12px;background:#0891b2">Enviar solicitação</button>
    </form>
  </div>
  <script>
    document.querySelectorAll("[data-tab]").forEach(btn=>btn.addEventListener("click",()=>{
      document.querySelectorAll("[data-tab]").forEach(x=>x.classList.remove("active"));
      document.querySelectorAll(".section").forEach(x=>x.classList.remove("active"));
      btn.classList.add("active"); document.getElementById("sec-"+btn.dataset.tab).classList.add("active");
    }));
  </script>`;
  return page(body, `Escala - ${teamName ?? "Equipe"}`);
});
