'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import KeyManager from './key-manager'
import { PerformanceIcon } from '@/components/ui/performance-icons'
import { PerformancePageGuide } from '@/components/ui/PerformanceNavigation'
import { closuresHelp } from '@/lib/performance-guides'

type Preview = { conferencia?: string; tem_dados: boolean; status: string; indicadores: Record<string, number | null>; [key: string]: unknown }
export default function IntegrationsPage() {
  const [authorized, setAuthorized] = useState(false)
  const [isMaster, setIsMaster] = useState(false)
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
      if (active) { setTeams(result.data ?? []); setAuthorized(true); setIsMaster(String(data?.role).toLowerCase() === 'master'); setMessage(result.error ? 'Não foi possível carregar as equipes. Atualize a página para tentar novamente.' : '') }
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
      if (response.status === 404 && official) throw new Error('Ainda não foi aprovado um fechamento para este mês, canal e equipe. Use “Conferir dados atuais” para consultar os números disponíveis.')
      if (!response.ok) throw new Error(data.erro || 'Consulta indisponível.')
      setPreview(data); setConfirmed(false)
      setMessage(approve ? 'Fechamento aprovado e preservado.' : official ? 'Fechamento oficial recuperado.' : 'Confira os números abaixo antes de aprovar.')
    } catch (error) { setPreview(null); setConfirmed(false); setMessage(error instanceof Error ? error.message : 'Falha na consulta.') }
    finally { setBusy(false) }
  }
  return <main className="mx-auto max-w-6xl space-y-5 p-5 text-slate-100 md:p-8">
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-700/70 pb-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-teal-300">Central de Performance · Administração</p>
        <h1 className="mt-2 flex items-center gap-3 text-3xl font-bold">
          <PerformanceIcon name="shield" size={29}/> Fechamentos
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-300">
          Confira e preserve os números por canal e competência, sem misturar resultados de origens diferentes.
        </p>
      </div>
      <Link href="/" className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold text-cyan-200 hover:border-teal-300/40">Voltar à Central</Link>
    </header>
    <PerformancePageGuide help={closuresHelp} compact/>
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
        {preview.status !== 'fechado' && preview.conferencia && preview.tem_dados && <>
          <label className="block"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} /> Conferi os indicadores e quero preservar este resultado como fechamento oficial. Não será possível substituí-lo nesta versão.</label>
          <button className="rounded bg-cyan-700 px-4 py-2 disabled:opacity-50" disabled={!confirmed || busy} onClick={() => consult(true)}>{busy ? 'Processando…' : 'Aprovar fechamento'}</button>
        </>}
      </section>}
    </>}
    <details className="rounded-xl border border-slate-700 p-4 text-sm text-slate-300">
      <summary className="cursor-pointer font-semibold">Integrações com outros sistemas</summary>
      <p className="mt-3">Outras plataformas autorizadas podem consultar os indicadores atuais ou os fechamentos oficiais pela API. O perfil Master pode gerar e revogar uma chave própria para cada sistema nesta área. Essa chave não é necessária para usar a tela de fechamentos.</p>
      <p className="mt-2">Conferir ou aprovar um fechamento não envia os dados automaticamente a outras equipes.</p>
      {authorized && isMaster && <KeyManager />}
    </details>
  </main>
}
