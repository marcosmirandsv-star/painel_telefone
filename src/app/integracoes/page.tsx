'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import KeyManager from './key-manager'

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
  const [section, setSection] = useState<'closure' | 'integrations'>('closure')
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
  return <main className="mx-auto max-w-6xl space-y-6 p-6 text-slate-100">
    <div className="flex flex-col gap-4 border-b border-white/10 pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <Link href="/" className="text-sm font-semibold text-cyan-300 hover:text-cyan-200">← Voltar ao painel</Link>
        <p className="mt-4 text-xs font-semibold uppercase tracking-[0.16em] text-cyan-300">Gestão · Fechamentos</p>
        <h1 className="mt-2 text-3xl font-bold">Fechamentos oficiais</h1>
        <p className="mt-2 max-w-3xl text-slate-300">Confira os indicadores antes de preservar o resultado mensal como referência oficial.</p>
      </div>
      <span className="rounded-md border border-white/10 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-300">Homologação</span>
    </div>

    <nav className="workspace-filter-panel workspace-switcher" aria-label="Áreas de fechamentos">
      <div>
        <p className="workspace-eyebrow">Fechamentos</p>
        <h2 className="section-title mt-2">{section === 'closure' ? 'Conferência mensal' : 'Integrações e API'}</h2>
        <p className="section-subtitle">
          {section === 'closure'
            ? 'Consulte os dados atuais, confira e preserve o fechamento aprovado.'
            : 'Gerencie chaves de leitura para sistemas autorizados.'}
        </p>
      </div>
      <div className="workspace-switcher-row" role="group" aria-label="Navegar em fechamentos">
        <button
          className={section === 'closure' ? 'workspace-switcher-button workspace-switcher-button-active' : 'workspace-switcher-button'}
          type="button"
          aria-pressed={section === 'closure'}
          onClick={() => setSection('closure')}
        >
          Fechamento
        </button>
        <button
          className={section === 'integrations' ? 'workspace-switcher-button workspace-switcher-button-active' : 'workspace-switcher-button'}
          type="button"
          aria-pressed={section === 'integrations'}
          onClick={() => setSection('integrations')}
        >
          Integrações
        </button>
      </div>
    </nav>

    {section === 'closure' && <details className="rounded-xl border border-slate-700 p-4">
      <summary className="cursor-pointer font-semibold">Como usar esta área</summary>
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-slate-300">
        <li>Escolha o mês e o canal. No chat, escolha também a equipe.</li>
        <li><strong>Conferir dados atuais</strong> consulta os números disponíveis, sem aprovar ou alterar nada. Use esta opção para testar.</li>
        <li><strong>Aprovar fechamento</strong> guarda uma cópia oficial do resultado conferido, para um mês já encerrado. Nesta versão, essa cópia não pode ser substituída.</li>
        <li><strong>Ver fechamento oficial</strong> recupera uma cópia já aprovada para o mesmo mês, canal e equipe.</li>
      </ol>
      <p className="mt-3 text-slate-300">Aqui você usa seu login de gestão do painel.</p>
    </details>}

    <p role="status" aria-live="polite" className={message ? 'rounded-lg border border-white/10 bg-slate-900/60 px-4 py-3 text-sm text-slate-300' : 'hidden'}>{message}</p>

    {section === 'closure' && authorized && <>
      <fieldset disabled={busy} className="grid gap-4 rounded-xl border border-white/10 bg-slate-950/35 p-5 md:grid-cols-2 xl:grid-cols-4">
        <legend className="px-2 text-sm font-semibold text-cyan-200">Período para conferência</legend>
        <label>Mês <input aria-label="Mês" type="month" min="2000-01" max="2099-12" className="form-input mt-2" value={month} onChange={e => { setMonth(e.target.value); clear() }} /></label>
        <label>Canal <select className="form-input mt-2" value={channel} onChange={e => { setChannel(e.target.value); setTeam('all'); clear() }}><option value="telefone">Telefone</option><option value="chat">Chat</option></select></label>
        {channel === 'chat' && <label>Equipe <select className="form-input mt-2" value={team} onChange={e => { setTeam(e.target.value); clear() }}><option value="all">Todas as equipes</option>{teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>}
        <button disabled={!month || busy} className="primary-button self-end disabled:opacity-50" onClick={() => consult()}>Conferir dados atuais</button>
        <button disabled={!month || busy} className="secondary-button self-end disabled:opacity-50" onClick={() => consult(false, true)}>Ver fechamento oficial</button>
      </fieldset>
      <p className="text-sm text-slate-300">No telefone, semanas que cruzam o mês entram integralmente, como no painel. No chat, as exclusões manuais são respeitadas. O fechamento é preservado por mês, canal e equipe selecionada; fechar todas as equipes não cria fechamentos individuais.</p>
      {preview && <section className="space-y-4 rounded-xl border border-white/10 bg-slate-950/35 p-5">
        <h2 className="text-xl font-semibold">{preview.status === 'fechado' ? 'Fechamento oficial' : 'Dados atuais — ainda não aprovados'}</h2>
        {!preview.tem_dados && <p>Não há registros considerados para este período.</p>}
        <dl className="grid gap-px overflow-hidden rounded-lg border border-white/10 bg-white/10 sm:grid-cols-2 lg:grid-cols-3">{Object.entries(preview.indicadores).map(([key, value]) => <div key={key} className="bg-slate-950/85 p-4"><dt className="text-xs text-slate-500">{key.replaceAll('_', ' ')}</dt><dd className="mt-2 text-xl font-bold tabular-nums">{value === null ? 'Sem base' : value.toLocaleString('pt-BR')}</dd></div>)}</dl>
        {preview.conferencia && preview.tem_dados && <>
          <label className="block"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} /> Conferi os indicadores e quero preservar este resultado como fechamento oficial. Não será possível substituí-lo nesta versão.</label>
          <button className="primary-button disabled:opacity-50" disabled={!confirmed || busy} onClick={() => consult(true)}>{busy ? 'Processando…' : 'Aprovar fechamento'}</button>
        </>}
      </section>}
    </>}
    {section === 'integrations' && (
      <section className="rounded-xl border border-white/10 bg-slate-950/35 p-5 text-sm text-slate-300">
        <h2 className="text-xl font-semibold text-white">Integrações com outros sistemas</h2>
        <p className="mt-3">Plataformas autorizadas podem consultar indicadores atuais ou fechamentos oficiais pela API. O perfil Master pode gerar e revogar uma chave própria para cada sistema.</p>
        <p className="mt-2">Essas chaves são somente para leitura e não são necessárias para usar a tela de fechamentos.</p>
        {authorized && isMaster ? <KeyManager /> : authorized ? <p className="mt-4 text-slate-400">A gestão de chaves é exclusiva do perfil Master.</p> : null}
      </section>
    )}
  </main>
}
