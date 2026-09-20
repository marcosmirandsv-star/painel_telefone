'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { scheduleSupabase as supabase } from '@/lib/schedule-supabase'

type Profile = { id: string; full_name: string | null; role: string | null }
type Team = { id: string; name: string; code: string }
type Recipient = { id: string; team_id: string | null; profile_id: string; receive_all: boolean; active: boolean }
type RequestItem = {
  id: string
  requester_name: string
  requester_email: string | null
  team_id: string
  target_date: string
  request_type: string
  requested_value: string | null
  reason: string | null
  status: string
  created_at: string
}
type PublicLink = { id: string; token: string; team_id: string | null; year: number | null; month: number | null; active: boolean; expires_at: string | null }

export default function ScheduleManagementPage() {
  const [profiles,setProfiles]=useState<Profile[]>([])
  const [teams,setTeams]=useState<Team[]>([])
  const [recipients,setRecipients]=useState<Recipient[]>([])
  const [requests,setRequests]=useState<RequestItem[]>([])
  const [links,setLinks]=useState<PublicLink[]>([])
  const [profileId,setProfileId]=useState('')
  const [teamId,setTeamId]=useState('')
  const [receiveAll,setReceiveAll]=useState(false)
  const [linkTeamId,setLinkTeamId]=useState('')
  const [year,setYear]=useState(new Date().getFullYear())
  const [month,setMonth]=useState(new Date().getMonth()+1)
  const [message,setMessage]=useState('')

  async function load(){
    const [p,t,r,q,l]=await Promise.all([
      supabase.from('profiles').select('id,full_name,role').order('full_name'),
      supabase.from('schedule_teams').select('id,name,code').eq('active',true).order('name'),
      supabase.from('schedule_notification_recipients').select('*').eq('active',true),
      supabase.from('schedule_requests').select('*').order('created_at',{ascending:false}).limit(100),
      supabase.from('schedule_public_links').select('*').order('created_at',{ascending:false}).limit(50),
    ])
    setProfiles((p.data??[]) as Profile[])
    const ts=(t.data??[]) as Team[]; setTeams(ts); setTeamId((v)=>v||ts[0]?.id||''); setLinkTeamId((v)=>v||ts[0]?.id||'')
    setRecipients((r.data??[]) as Recipient[])
    setRequests((q.data??[]) as RequestItem[])
    setLinks((l.data??[]) as PublicLink[])
  }
  useEffect(()=>{load()},[])

  async function addRecipient(){
    if(!profileId || (!receiveAll && !teamId)) return
    const {error}=await supabase.from('schedule_notification_recipients').upsert({
      profile_id:profileId,
      team_id:receiveAll?null:teamId,
      receive_all:receiveAll,
      active:true,
    },{onConflict:'team_id,profile_id'})
    if(error) return setMessage(error.message)
    setMessage('Destinatário de alertas configurado.')
    await load()
  }

  async function removeRecipient(id:string){
    const {error}=await supabase.from('schedule_notification_recipients').update({active:false}).eq('id',id)
    if(error) return setMessage(error.message)
    await load()
  }

  async function reviewRequest(item:RequestItem,status:'approved'|'rejected'){
    const note=window.prompt(status==='approved'?'Observação da aprovação (opcional):':'Motivo da recusa (opcional):','') ?? null
    const {data:auth}=await supabase.auth.getUser()
    const {error}=await supabase.from('schedule_requests').update({
      status,
      reviewed_by:auth.user?.id??null,
      reviewed_at:new Date().toISOString(),
      review_notes:note||null,
    }).eq('id',item.id)
    if(error) return setMessage(error.message)
    setMessage(status==='approved'?'Solicitação aprovada.':'Solicitação recusada.')
    await load()
  }

  async function createPublicLink(){
    if(!linkTeamId) return
    const {data:auth}=await supabase.auth.getUser()
    const {data,error}=await supabase.from('schedule_public_links').insert({
      team_id:linkTeamId,
      year,month,
      active:true,
      created_by:auth.user?.id??null,
    }).select('*').single()
    if(error) return setMessage(error.message)
    const url=`${window.location.origin}/escalas/publica/${data.token}`
    try{await navigator.clipboard.writeText(url); setMessage('Link de consulta criado e copiado.')}catch{setMessage(`Link criado: ${url}`)}
    await load()
  }

  async function toggleLink(link:PublicLink){
    const {error}=await supabase.from('schedule_public_links').update({active:!link.active}).eq('id',link.id)
    if(error) return setMessage(error.message)
    await load()
  }

  function personName(id:string){return profiles.find((p)=>p.id===id)?.full_name??'Perfil'}
  function teamName(id:string|null){return id?teams.find((t)=>t.id===id)?.name??'Time':'Todos os times'}

  return <main className="min-h-screen bg-slate-950 p-4 text-white sm:p-7">
    <section className="mx-auto max-w-7xl">
      <div className="mb-4 rounded-xl border border-amber-400/40 bg-amber-950/30 px-4 py-3 text-sm">🧪 Homologação — configurações e solicitações</div>
      <header className="flex flex-col gap-4 border-b border-white/10 pb-5 lg:flex-row lg:items-center lg:justify-between">
        <div><p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-300">Painel de Escalas</p><h1 className="mt-2 text-3xl font-bold">Gestão</h1><p className="mt-2 text-slate-400">Alertas, solicitações e links de consulta.</p></div>
        <div className="flex gap-2"><Link className="secondary-button" href="/escalas">Escalas</Link><Link className="secondary-button" href="/escalas/sabados">Sábados</Link></div>
      </header>
      {message&&<div className="mt-4 rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm">{message}</div>}

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <section className="rounded-2xl border border-white/10 bg-slate-900/60 p-5">
          <h2 className="text-xl font-bold">Quem recebe alertas</h2>
          <p className="mt-2 text-sm text-slate-400">Use “todos os times” para coordenação ou acompanhamento geral.</p>
          <div className="mt-4 grid gap-3">
            <select className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2" value={profileId} onChange={(e)=>setProfileId(e.target.value)}><option value="">Selecione a pessoa</option>{profiles.map((p)=><option key={p.id} value={p.id}>{p.full_name??p.id}</option>)}</select>
            <select disabled={receiveAll} className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2 disabled:opacity-50" value={teamId} onChange={(e)=>setTeamId(e.target.value)}>{teams.map((t)=><option key={t.id} value={t.id}>{t.name}</option>)}</select>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={receiveAll} onChange={(e)=>setReceiveAll(e.target.checked)}/> Receber solicitações de todos os times</label>
            <button className="primary-button" onClick={addRecipient}>Adicionar destinatário</button>
          </div>
          <div className="mt-5 grid gap-2">{recipients.map((r)=><div key={r.id} className="flex items-center justify-between rounded-lg border border-white/10 bg-slate-950 p-3 text-sm"><span><strong>{personName(r.profile_id)}</strong> · {r.receive_all?'Todos os times':teamName(r.team_id)}</span><button className="text-red-300" onClick={()=>removeRecipient(r.id)}>Remover</button></div>)}</div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-slate-900/60 p-5">
          <h2 className="text-xl font-bold">Link de consulta sem login</h2>
          <p className="mt-2 text-sm text-slate-400">O link só mostra um mês já liberado. Regras e gestão não ficam expostas.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <select className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2" value={linkTeamId} onChange={(e)=>setLinkTeamId(e.target.value)}>{teams.map((t)=><option key={t.id} value={t.id}>{t.name}</option>)}</select>
            <input className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2" type="number" value={month} min={1} max={12} onChange={(e)=>setMonth(Number(e.target.value))}/>
            <input className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2" type="number" value={year} onChange={(e)=>setYear(Number(e.target.value))}/>
          </div>
          <button className="primary-button mt-3" onClick={createPublicLink}>Criar e copiar link</button>
          <div className="mt-5 grid gap-2">{links.map((l)=><div key={l.id} className="flex items-center justify-between rounded-lg border border-white/10 bg-slate-950 p-3 text-sm"><span>{teamName(l.team_id)} · {l.month}/{l.year} · {l.active?'Ativo':'Desativado'}</span><button className="small-button" onClick={()=>toggleLink(l)}>{l.active?'Desativar':'Ativar'}</button></div>)}</div>
        </section>
      </div>

      <section className="mt-5 rounded-2xl border border-white/10 bg-slate-900/60 p-5">
        <h2 className="text-xl font-bold">Solicitações</h2>
        <div className="mt-4 overflow-x-auto"><table className="min-w-full text-sm"><thead><tr className="text-left text-slate-400"><th className="pb-3">Pessoa</th><th>Time</th><th>Data</th><th>Pedido</th><th>Motivo</th><th>Status</th><th>Ação</th></tr></thead><tbody>{requests.map((r)=><tr key={r.id} className="border-t border-white/10"><td className="py-3 font-semibold">{r.requester_name}</td><td>{teamName(r.team_id)}</td><td>{r.target_date}</td><td>{r.request_type}</td><td className="max-w-xs">{r.reason??'—'}</td><td>{r.status}</td><td className="flex gap-2 py-2">{r.status==='pending'&&<><button className="small-button" onClick={()=>reviewRequest(r,'approved')}>Aprovar</button><button className="danger-button" onClick={()=>reviewRequest(r,'rejected')}>Recusar</button></>}</td></tr>)}</tbody></table></div>
      </section>
    </section>
  </main>
}
