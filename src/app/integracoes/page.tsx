'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

type Preview = { conferencia?: string; tem_dados: boolean; status: string; indicadores: Record<string, number | null>; [key: string]: unknown }
export default function IntegrationsPage() {
  const [authorized, setAuthorized] = useState(false)
  const [month, setMonth] = useState('')
  const [channel, setChannel] = useState('telefone')
  const [team, setTeam] = useState('all')
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([])
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [message, setMessage] = useState('Verificando seu acesso…')
  useEffect(() => {
    let active = true
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { if (active) setMessage('Entre no painel com sua conta de gestão e volte a esta página.'); return }
      const { data, error } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
      if (error || !['master', 'coordenadora', 'coordinator'].includes(String(data?.role).toLowerCase())) { if (active) setMessage('Esta área é exclusiva da gestão.'); return }
      const result = await supabase.from('chat_teams').select('id,name').order('name')
      if (active) { setTeams(result.data ?? []); setAuthorized(true); setMessage(result.error ? 'Não foi possível carregar as equipes. Atualize a página para tentar novamente.' : '') }
    }
    load().catch(() => { if (active) setMessage('Não foi possível verificar o acesso. Atualize a página.') })
    return () => { active = false }
  }, [])
  function clear() { setPreview(null); setConfirmed(false); setMessage('') }
  async function consult(approve = false, official = false) {
    setBusy(true); setMessage('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Sua sessão expirou. Entre novamente no painel.')
      const query = new URLSearchParams({ mes: month, canal: channel, equipe: team, fonte: official ? 'oficial' : 'atual' })
      const response = await fetch(`/api/integrations/closures?${query}`, {
        method: approve ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        ...(approve ? { body: JSON.stringify({ conferencia: preview?.conferencia }) } : {}),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.erro || 'Consulta indisponível.')
      setPreview(data); setConfirmed(false)
      setMessage(approve ? 'Fechamento aprovado e preservado.' : official ? 'Fechamento oficial recuperado.' : 'Confira os números abaixo antes de aprovar.')
    } catch (error) { setPreview(null); setConfirmed(false); setMessage(error instanceof Error ? error.message : 'Falha na consulta.') }
    finally { setBusy(false) }
  }
  return <main className="mx-auto max-w-5xl space-y-6 p-6 text-slate-100">
    <Link href="/" className="text-cyan-300 underline">Voltar ao painel</Link>
    <h1 className="text-3xl font-bold">Integrações e fechamentos</h1>
    <p>Prepare os indicadores de telefone e chat para consulta por outras plataformas da empresa. Os acessos externos são configurados individualmente pelo responsável técnico.</p>
    <p role="status" aria-live="polite">{message}</p>
    {authorized && <>
      <fieldset disabled={busy} className="flex flex-wrap gap-4 rounded-xl border border-slate-700 p-4">
        <legend>Período para conferência</legend>
        <label>Mês <input aria-label="Mês" type="month" min="2000-01" max="2099-12" className="rounded bg-slate-800 p-2" value={month} onChange={e => { setMonth(e.target.value); clear() }} /></label>
        <label>Canal <select className="rounded bg-slate-800 p-2" value={channel} onChange={e => { setChannel(e.target.value); setTeam('all'); clear() }}><option value="telefone">Telefone</option><option value="chat">Chat</option></select></label>
        {channel === 'chat' && <label>Equipe <select className="rounded bg-slate-800 p-2" value={team} onChange={e => { setTeam(e.target.value); clear() }}><option value="all">Todas as equipes</option>{teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>}
        <button disabled={!month || busy} className="rounded bg-cyan-800 px-4 py-2 disabled:opacity-50" onClick={() => consult()}>Conferir dados atuais</button>
        <button disabled={!month || busy} className="rounded border px-4 py-2 disabled:opacity-50" onClick={() => consult(false, true)}>Ver fechamento oficial</button>
      </fieldset>
      <p className="text-sm text-slate-300">No telefone, semanas que cruzam o mês entram integralmente, como no painel. No chat, as exclusões manuais são respeitadas. O fechamento é preservado por mês, canal e equipe selecionada; fechar todas as equipes não cria fechamentos individuais.</p>
      {preview && <section className="space-y-4 rounded-xl border border-slate-700 p-4">
        <h2 className="text-xl font-semibold">{preview.status === 'fechado' ? 'Fechamento oficial' : 'Dados atuais — ainda não aprovados'}</h2>
        {!preview.tem_dados && <p>Não há registros considerados para este período.</p>}
        <dl className="grid gap-3 sm:grid-cols-2">{Object.entries(preview.indicadores).map(([key, value]) => <div key={key} className="rounded bg-slate-800 p-3"><dt>{key.replaceAll('_', ' ')}</dt><dd className="text-xl font-bold">{value === null ? 'Sem base para cálculo' : value.toLocaleString('pt-BR')}</dd></div>)}</dl>
        {preview.conferencia && preview.tem_dados && <>
          <label className="block"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} /> Conferi os indicadores e quero preservar este resultado como fechamento oficial. Não será possível substituí-lo nesta versão.</label>
          <button className="rounded bg-cyan-700 px-4 py-2 disabled:opacity-50" disabled={!confirmed || busy} onClick={() => consult(true)}>{busy ? 'Processando…' : 'Aprovar fechamento'}</button>
        </>}
      </section>}
    </>}
  </main>
}
