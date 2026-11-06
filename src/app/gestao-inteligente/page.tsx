'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { supabase } from '@/lib/supabase'
import { caseStates, stateLabels, transitions, type CaseState, type CxCase } from '@/lib/cx360'

type Catalog = { teams: { id: string; name: string }[]; managers: { id: string; full_name: string }[] }
type Payload = Catalog & { user_id: string; cases: CxCase[]; truncated: boolean; retrieved_at: string; diagnostics: { note: string } }
type Audit = { id: string; actor_id: string; occurred_at: string; before_state: CxCase | null; after_state: CxCase }
type Registration = { title: string; ticket_source: string; ticket_id: string; team_id: string; observation: string; evidence: string; hypothesis: string; impact: string }
const empty: Registration = { title: '', ticket_source: 'clickdesk', ticket_id: '', team_id: '', observation: '', evidence: '', hypothesis: '', impact: '' }
const panel = 'rounded-2xl border border-slate-700 bg-slate-900/80 p-5'
const input = 'mt-1 block w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-slate-100'
const button = 'rounded-lg bg-cyan-800 px-4 py-2 font-medium text-white hover:bg-cyan-700 disabled:opacity-50'
const origins: Record<string, string> = { clickdesk: 'ClickDesk', zendesk: 'Zendesk', telefone: 'Telefone' }
const dateTime = (value: string) => new Date(value).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })

export default function CxManagement() {
  const [access, setAccess] = useState(false), [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('Validando acesso…')
  const [data, setData] = useState<Payload | null>(null)
  const [catalog, setCatalog] = useState<Catalog>({ teams: [], managers: [] })
  const [team, setTeam] = useState(''), [status, setStatus] = useState('')
  const [tab, setTab] = useState<'cases' | 'new' | 'summary'>('cases')
  const [registration, setRegistration] = useState<Registration>(empty)
  const [selected, setSelected] = useState<CxCase | null>(null)
  const [approval, setApproval] = useState(false)
  const [history, setHistory] = useState<Audit[]>([]), [historyLimited, setHistoryLimited] = useState(false)
  const requestVersion = useRef(0), historyVersion = useRef(0)

  const api = useCallback(async (path = '', options?: RequestInit) => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error('Entre no painel com sua conta de gestão.')
    const response = await fetch(`/api/gestao-inteligente${path}`, { ...options, cache: 'no-store', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` } })
    const payload = await response.json()
    if (!response.ok) throw new Error(payload.erro || 'Consulta indisponível.')
    return payload
  }, [])
  const load = useCallback(async () => {
    const version = ++requestVersion.current
    ++historyVersion.current
    setBusy(true); setData(null); setSelected(null); setHistory([])
    try {
      const params = new URLSearchParams({ ...(team ? { team_id: team } : {}), ...(status ? { status } : {}) })
      const payload = await api(`?${params}`)
      if (version !== requestVersion.current) return
      setData(payload); setCatalog({ teams: payload.teams, managers: payload.managers }); setAccess(true)
      setMessage(payload.cases.length ? 'Acompanhamentos atualizados.' : 'Nenhuma ocorrência registrada neste recorte. Use “Registrar ocorrência” para iniciar um acompanhamento com evidências.')
    } catch (error) { if (version === requestVersion.current) setMessage((error as Error).message) }
    finally { if (version === requestVersion.current) setBusy(false) }
  }, [api, team, status])

  useEffect(() => {
    let active = true
    const invalidate = () => { ++requestVersion.current; ++historyVersion.current }
    const { data: listener } = supabase.auth.onAuthStateChange(event => {
      if (event === 'SIGNED_OUT') { invalidate(); setAccess(false); setData(null); setCatalog({ teams: [], managers: [] }); setSelected(null); setHistory([]); setMessage('Sessão encerrada. Entre novamente no painel.') }
    })
    async function authorize() {
      const { data: { user }, error } = await supabase.auth.getUser()
      if (!active) return
      if (!user || error) { setMessage('Entre no painel com sua conta de gestão.'); return }
      const profile = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
      if (!active) return
      if (profile.error || !['master', 'coordenadora'].includes(String(profile.data?.role).toLowerCase())) { setMessage('Esta área é exclusiva da gestão.'); return }
      setAccess(true); setMessage('Consulte os acompanhamentos para começar.')
    }
    void authorize()
    return () => { active = false; invalidate(); listener.subscription.unsubscribe() }
  }, [])
  function clear() { ++requestVersion.current; ++historyVersion.current; setData(null); setSelected(null); setHistory([]); setMessage('Filtros alterados. Clique em consultar.') }
  async function register(event: FormEvent) {
    event.preventDefault(); setBusy(true)
    try {
      await api('', { method: 'POST', body: JSON.stringify(registration) })
      setRegistration(empty); setTab('cases'); await load(); setMessage('Ocorrência registrada para investigação. A hipótese ainda não é uma conclusão aprovada.')
    } catch (error) { setMessage((error as Error).message) } finally { setBusy(false) }
  }
  async function open(record: CxCase) {
    const version = ++historyVersion.current
    setSelected(record); setApproval(false); setHistory([]); setHistoryLimited(false)
    try {
      const payload = await api(`/historico?id=${record.id}`)
      if (version === historyVersion.current) { setHistory(payload.events); setHistoryLimited(payload.truncated) }
    } catch (error) { if (version === historyVersion.current) setMessage((error as Error).message) }
  }
  async function save(event: FormEvent) {
    event.preventDefault(); if (!selected) return
    setBusy(true)
    try {
      await api('', { method: 'PATCH', body: JSON.stringify({ ...selected, approve: approval }) })
      await load(); setMessage('Acompanhamento salvo. A alteração e seu autor constam no histórico.')
    } catch (error) { setMessage((error as Error).message) } finally { setBusy(false) }
  }
  const teamName = (id: string) => catalog.teams.find(item => item.id === id)?.name ?? 'Equipe'
  const managerName = (id: string) => catalog.managers.find(item => item.id === id)?.full_name ?? 'Gestor'
  const original = data?.cases.find(item => item.id === selected?.id)
  const patch = (value: Partial<CxCase>) => { setSelected(previous => previous ? { ...previous, ...value } : null); setApproval(false) }
  const field = (key: keyof Registration, value: string) => setRegistration(previous => ({ ...previous, [key]: value }))

  return <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-8 text-slate-100 sm:px-8">
    <Link href="/" className="text-cyan-300 underline">Voltar ao Sistema de Performance</Link>
    <header className={`${panel} border-cyan-900`}><p className="text-xs font-semibold uppercase tracking-widest text-cyan-200">Gestão e desenvolvimento · acesso restrito</p><h1 className="mt-3 text-3xl font-semibold">Gestão Inteligente — CX 360º</h1><p className="mt-3 max-w-3xl text-slate-300">Investigue situações, reúna evidências e acompanhe ações de melhoria. Cada conclusão e encaminhamento depende da validação de um gestor.</p></header>
    <p role="status" aria-live="polite" className="rounded-xl border border-slate-700 p-3">{message}</p>
    {access && <>
      <section className={`${panel} border-amber-900/70`}><h2 className="font-semibold text-amber-100">Fontes de diagnóstico</h2><p className="mt-2 text-sm text-slate-300">{data?.diagnostics.note ?? 'Os diagnósticos automáticos da IA 360º ainda não estão integrados à produção. Esta versão trabalha com observações e evidências registradas pela gestão.'}</p><p className="mt-2 text-sm text-slate-400">Indicadores oficiais, produtividade, CSAT e pódio permanecem nas áreas de operação. Poucos tickets atribuídos não comprovam ociosidade; encerramento por inatividade não comprova resolução.</p></section>
      <form onSubmit={event => { event.preventDefault(); void load() }}><fieldset disabled={busy} className={`${panel} flex flex-wrap items-end gap-4`}><legend className="px-2 font-semibold">Acompanhamentos</legend><label>Equipe<select className={input} value={team} onChange={event => { clear(); setTeam(event.target.value) }}><option value="">Todas as equipes</option>{catalog.teams.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Etapa<select className={input} value={status} onChange={event => { clear(); setStatus(event.target.value) }}><option value="">Todas as etapas</option>{caseStates.map(item => <option key={item} value={item}>{stateLabels[item]}</option>)}</select></label><button className={button}>{busy ? 'Consultando…' : 'Consultar'}</button></fieldset></form>
      {data && <>
        <nav className="flex flex-wrap gap-2" aria-label="Visões da gestão">{([['cases', 'Acompanhamentos'], ['new', 'Registrar ocorrência'], ['summary', 'Resumo gerencial']] as const).map(([key, label]) => <button key={key} disabled={busy} className={tab === key ? button : 'rounded-lg border border-slate-600 px-4 py-2'} aria-pressed={tab === key} onClick={() => setTab(key)}>{label}</button>)}</nav>
        {data.truncated && <p className="text-amber-100">Exibindo os 200 acompanhamentos mais recentes deste recorte. Use os filtros para detalhar.</p>}
        {tab === 'new' && <form onSubmit={register} className={`${panel} space-y-4`}><h2 className="text-xl font-semibold">Registrar uma situação para investigação</h2><p className="text-sm text-slate-300">Descreva fatos observáveis e a referência exata do atendimento. Evite dados pessoais do cliente. A origem e o identificador ficam preservados, sem associação automática com outros sistemas ou atribuição individual de performance.</p><fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
          <label className="sm:col-span-2">Título<input className={input} required minLength={5} maxLength={200} value={registration.title} onChange={event => field('title', event.target.value)} /></label>
          <label>Equipe<select className={input} required value={registration.team_id} onChange={event => field('team_id', event.target.value)}><option value="">Selecione</option>{catalog.teams.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>Origem<select className={input} value={registration.ticket_source} onChange={event => field('ticket_source', event.target.value)}>{Object.entries(origins).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label className="sm:col-span-2">Identificador exato do ticket ou registro de ligação<input className={input} required maxLength={100} value={registration.ticket_id} onChange={event => field('ticket_id', event.target.value)} /></label>
          <label className="sm:col-span-2">O que aconteceu? Somente fatos observados<textarea className={input} required minLength={10} maxLength={3000} rows={3} value={registration.observation} onChange={event => field('observation', event.target.value)} /></label>
          <label className="sm:col-span-2">Qual a evidência? Mensagem, evento ou referência verificável<textarea className={input} required minLength={10} maxLength={3000} rows={3} value={registration.evidence} onChange={event => field('evidence', event.target.value)} /></label>
          <label>Hipótese a investigar (opcional)<textarea className={input} maxLength={3000} rows={3} value={registration.hypothesis} onChange={event => field('hypothesis', event.target.value)} /></label>
          <label>Impacto observado e sua evidência (opcional)<textarea className={input} maxLength={3000} rows={3} value={registration.impact} onChange={event => field('impact', event.target.value)} /></label>
          <button className={`${button} justify-self-start`} type="submit">Registrar investigação</button>
        </fieldset></form>}
        {tab === 'cases' && <section className="grid gap-5 lg:grid-cols-2"><div className={`${panel} space-y-3`}><h2 className="text-xl font-semibold">Situações em acompanhamento</h2>{!data.cases.length && <p className="text-slate-300">Nenhuma ocorrência neste recorte. Nenhum diagnóstico foi presumido a partir da ausência de dados.</p>}{data.cases.map(record => <button key={record.id} disabled={busy} className="block w-full rounded-xl border border-slate-700 p-4 text-left hover:border-cyan-600" onClick={() => void open(record)}><strong>{record.title}</strong><span className="mt-2 block text-sm text-slate-300">{teamName(record.team_id)} · {origins[record.ticket_source]} {record.ticket_id}</span><span className="mt-1 block text-sm text-cyan-200">{stateLabels[record.status]} · revisão {record.review_date ?? 'a definir'}</span></button>)}</div>
          {selected && original && <form onSubmit={save} className={`${panel} space-y-4`}><h2 className="text-xl font-semibold">{selected.title}</h2><p className="text-sm text-slate-300">{origins[selected.ticket_source]} {selected.ticket_id} · {teamName(selected.team_id)}</p><dl className="space-y-3 text-sm"><div><dt className="font-semibold text-cyan-200">Fato registrado pela gestão</dt><dd>{selected.observation}</dd></div><div><dt className="font-semibold text-cyan-200">Evidência informada</dt><dd>{selected.evidence}</dd></div><div><dt className="font-semibold text-cyan-200">Hipótese ainda sujeita a verificação</dt><dd>{selected.hypothesis || 'Não informada.'}</dd></div><div><dt className="font-semibold text-cyan-200">Impacto observado</dt><dd>{selected.impact || 'Sem evidência suficiente para quantificar.'}</dd></div></dl>
            {selected.approved_at && <p className="text-sm text-emerald-200">Ação aprovada por {managerName(selected.approved_by!)} em {dateTime(selected.approved_at)}.</p>}
            <fieldset disabled={busy || original.status === 'concluido'} className="space-y-4"><label className="block">Etapa<select className={input} value={selected.status} onChange={event => patch({ status: event.target.value as CaseState })}>{[original.status, ...transitions[original.status]].map(item => <option key={item} value={item}>{stateLabels[item]}</option>)}</select></label><label className="block">Ação de melhoria<textarea className={input} maxLength={3000} rows={3} value={selected.action} onChange={event => patch({ action: event.target.value })} /></label><label className="block">Responsável<select className={input} value={selected.owner_id} onChange={event => patch({ owner_id: event.target.value })}>{catalog.managers.map(item => <option key={item.id} value={item.id}>{item.full_name}</option>)}</select></label><label className="block">Revisar em<input className={input} type="date" value={selected.review_date ?? ''} onChange={event => patch({ review_date: event.target.value || null })} /></label><label className="block">Validação das evidências, decisões e feedbacks<textarea className={input} maxLength={3000} rows={3} value={selected.decision_notes} onChange={event => patch({ decision_notes: event.target.value })} /></label><label className="block">Resultado observado ou justificativa de encerramento<textarea className={input} maxLength={3000} rows={3} value={selected.outcome} onChange={event => patch({ outcome: event.target.value })} /></label>{selected.status === 'acao_definida' && <label className="block text-amber-100"><input type="checkbox" checked={approval} onChange={event => setApproval(event.target.checked)} /> Conferi as evidências e aprovo esta ação de melhoria.</label>}<button className={button} disabled={busy || (selected.status === 'acao_definida' && !approval)}>Salvar acompanhamento</button></fieldset>
            <details><summary className="cursor-pointer font-semibold">Histórico de alterações ({history.length})</summary><ol className="mt-3 space-y-3">{history.map(event => <li key={event.id} className="rounded-lg bg-slate-800 p-3 text-sm"><p>{dateTime(event.occurred_at)} · {managerName(event.actor_id)}</p><p>{stateLabels[event.after_state.status]} · versão {event.after_state.version}</p><p>{event.after_state.decision_notes || 'Ocorrência registrada para investigação.'}</p><p>{event.after_state.outcome}</p><details className="mt-2"><summary className="cursor-pointer text-cyan-200">Plano registrado nesta versão</summary><p>{event.after_state.action || 'Ação ainda não definida.'}</p><p>Responsável: {managerName(event.after_state.owner_id)} · revisão {event.after_state.review_date ?? 'a definir'}</p></details></li>)}</ol>{historyLimited && <p>Histórico limitado aos primeiros 500 eventos.</p>}</details>
          </form>}
        </section>}
        {tab === 'summary' && <section className={`${panel} space-y-4`}><h2 className="text-xl font-semibold">Resumo dos acompanhamentos consultados</h2><p>{data.cases.length} ocorrência(s) neste recorte{data.truncated ? ' parcial' : ''}. As contagens se referem a registros de gestão, sem equivalência com indicadores de performance.</p><ul className="grid gap-2 sm:grid-cols-2">{caseStates.map(item => <li key={item}>{stateLabels[item]}: <strong>{data.cases.filter(record => record.status === item).length}</strong></li>)}</ul><h3 className="font-semibold">Próximas revisões registradas</h3><ul className="list-disc space-y-2 pl-5">{data.cases.filter(item => item.review_date && !['concluido','inconclusivo'].includes(item.status)).sort((a, b) => a.review_date!.localeCompare(b.review_date!)).map(item => <li key={item.id}>{item.review_date} — {item.title}: {item.action || 'Ação em investigação'}</li>)}</ul><p className="text-sm text-slate-400">Evolução deve ser registrada com evidências no acompanhamento. Radar em tempo real, assistente conversacional e resumos diários e semanais automáticos ainda não estão disponíveis.</p></section>}
        <p className="text-xs text-slate-400">Dados de produção · consulta em {dateTime(data.retrieved_at)}. Recomendações e hipóteses não constituem decisões aprovadas nem geram medidas disciplinares automáticas.</p>
      </>}
    </>}
  </main>
}
