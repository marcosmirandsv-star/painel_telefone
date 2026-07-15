'use client'

import { useEffect, useMemo, useState } from 'react'
import { User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

type Goal = {
  id: string
  key: string
  label: string
  value: number
  unit: string
}

type Analyst = {
  id: string
  name: string
  active: boolean
  csat_goal: number
}

type IndividualMetric = {
  id: string
  analyst_id: string
  week_start: string
  week_end: string
  csat: number
  total_reviews: number
  positive_reviews: number
  negative_reviews: number
  review_percentage: number
  total_tickets: number
  notes: string | null
  analysts?:
    | {
        name: string
      }
    | {
        name: string
      }[]
    | null
}

type TeamMetric = {
  id: string
  week_start: string
  week_end: string
  answered_calls: number
  abandoned_calls: number
  total_calls: number
  performance_percentage: number
  notes: string | null
}

type ActiveTab = 'dashboard' | 'analysts' | 'goals' | 'entries'

const initialIndividualForm = {
  analystId: '',
  weekStart: '',
  weekEnd: '',
  csat: '',
  positiveReviews: '',
  negativeReviews: '',
  totalTickets: '',
  notes: '',
}

const initialTeamForm = {
  weekStart: '',
  weekEnd: '',
  answeredCalls: '',
  abandonedCalls: '',
  totalCalls: '',
  notes: '',
}

const initialAnalystForm = {
  name: '',
  csatGoal: '86',
}

export default function Home() {
  const [user, setUser] = useState<User | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [goals, setGoals] = useState<Goal[]>([])
  const [analysts, setAnalysts] = useState<Analyst[]>([])
  const [individualMetrics, setIndividualMetrics] = useState<IndividualMetric[]>([])
  const [teamMetrics, setTeamMetrics] = useState<TeamMetric[]>([])
  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard')
  const [individualForm, setIndividualForm] = useState(initialIndividualForm)
  const [teamForm, setTeamForm] = useState(initialTeamForm)
  const [analystForm, setAnalystForm] = useState(initialAnalystForm)
  const [editingAnalystId, setEditingAnalystId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    async function loadSession() {
      const { data } = await supabase.auth.getUser()
      setUser(data.user)
      setLoading(false)
    }

    loadSession()
  }, [])

  useEffect(() => {
    if (!user) return
    loadData()
  }, [user])

  async function loadData() {
    setLoading(true)
    setMessage('')

    const [goalsResult, analystsResult, individualResult, teamResult] = await Promise.all([
      supabase.from('goals').select('id, key, label, value, unit').order('label'),
      supabase.from('analysts').select('id, name, active, csat_goal').order('name'),
      supabase
        .from('weekly_individual_metrics')
        .select('id, analyst_id, week_start, week_end, csat, total_reviews, positive_reviews, negative_reviews, review_percentage, total_tickets, notes, analysts(name)')
        .order('week_start', { ascending: false })
        .limit(8),
      supabase
        .from('weekly_team_metrics')
        .select('id, week_start, week_end, answered_calls, abandoned_calls, total_calls, performance_percentage, notes')
        .order('week_start', { ascending: false })
        .limit(6),
    ])

    if (goalsResult.error) setMessage(goalsResult.error.message)
    else setGoals(goalsResult.data ?? [])

    if (analystsResult.error) setMessage(analystsResult.error.message)
    else {
      const loadedAnalysts = analystsResult.data ?? []
      const activeAnalysts = loadedAnalysts.filter((analyst) => analyst.active)
      setAnalysts(loadedAnalysts)
      setIndividualForm((current) => ({
        ...current,
        analystId: current.analystId || activeAnalysts[0]?.id || '',
      }))
    }

    if (individualResult.error) setMessage(individualResult.error.message)
    else setIndividualMetrics((individualResult.data ?? []) as IndividualMetric[])

    if (teamResult.error) setMessage(teamResult.error.message)
    else setTeamMetrics(teamResult.data ?? [])

    setLoading(false)
  }

  const latestTeamPerformance = teamMetrics[0]?.performance_percentage ?? 0
  const activeAnalysts = useMemo(
    () => analysts.filter((analyst) => analyst.active),
    [analysts],
  )
  const averageCsat = useMemo(() => {
    if (!individualMetrics.length) return 0
    const total = individualMetrics.reduce((sum, metric) => sum + Number(metric.csat), 0)
    return Math.round((total / individualMetrics.length) * 10) / 10
  }, [individualMetrics])

  async function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage('Entrando...')

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      setMessage(error.message)
      return
    }

    setUser(data.user)
    setMessage('')
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    setUser(null)
    setGoals([])
    setAnalysts([])
    setIndividualMetrics([])
    setTeamMetrics([])
  }

  async function handleAnalystSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setMessage('')

    const payload = {
      name: analystForm.name.trim(),
      csat_goal: toNumber(analystForm.csatGoal),
    }

    const result = editingAnalystId
      ? await supabase.from('analysts').update(payload).eq('id', editingAnalystId)
      : await supabase.from('analysts').insert({ ...payload, active: true })

    if (result.error) setMessage(result.error.message)
    else {
      setMessage(editingAnalystId ? 'Analista atualizado com sucesso.' : 'Analista incluido com sucesso.')
      setAnalystForm(initialAnalystForm)
      setEditingAnalystId(null)
      await loadData()
    }

    setSaving(false)
  }

  async function handleEditAnalyst(analyst: Analyst) {
    setAnalystForm({
      name: analyst.name,
      csatGoal: String(analyst.csat_goal),
    })
    setEditingAnalystId(analyst.id)
  }

  function handleCancelAnalystEdit() {
    setAnalystForm(initialAnalystForm)
    setEditingAnalystId(null)
  }

  async function handleToggleAnalyst(analyst: Analyst) {
    setSaving(true)
    setMessage('')

    const { error } = await supabase
      .from('analysts')
      .update({ active: !analyst.active })
      .eq('id', analyst.id)

    if (error) setMessage(error.message)
    else {
      setMessage(analyst.active ? 'Analista inativado com sucesso.' : 'Analista reativado com sucesso.')
      await loadData()
    }

    setSaving(false)
  }

  async function handleDeleteAnalyst(analyst: Analyst) {
    const confirmed = window.confirm(
      `Excluir ${analyst.name}? Se ele tiver historico de lancamentos, prefira inativar para preservar os relatorios.`,
    )

    if (!confirmed) return

    setSaving(true)
    setMessage('')

    const { error } = await supabase.from('analysts').delete().eq('id', analyst.id)

    if (error) {
      setMessage('Nao foi possivel excluir. Se existir historico, use Inativar para preservar os dados.')
    } else {
      setMessage('Analista excluido com sucesso.')
      if (editingAnalystId === analyst.id) handleCancelAnalystEdit()
      await loadData()
    }

    setSaving(false)
  }

  async function handleIndividualSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setMessage('')

    const positiveReviews = toNumber(individualForm.positiveReviews)
    const negativeReviews = toNumber(individualForm.negativeReviews)
    const totalReviews = positiveReviews + negativeReviews
    const totalTickets = toNumber(individualForm.totalTickets)
    const reviewPercentage = totalTickets ? round((totalReviews / totalTickets) * 100) : 0

    const { error } = await supabase.from('weekly_individual_metrics').insert({
      analyst_id: individualForm.analystId,
      week_start: individualForm.weekStart,
      week_end: individualForm.weekEnd,
      csat: toNumber(individualForm.csat),
      total_reviews: totalReviews,
      positive_reviews: positiveReviews,
      negative_reviews: negativeReviews,
      review_percentage: reviewPercentage,
      total_tickets: totalTickets,
      notes: individualForm.notes || null,
      created_by: user?.id,
    })

    if (error) setMessage(error.message)
    else {
      setMessage('Lancamento individual salvo com sucesso.')
      setIndividualForm({ ...initialIndividualForm, analystId: analysts[0]?.id || '' })
      await loadData()
    }

    setSaving(false)
  }

  async function handleTeamSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setMessage('')

    const answeredCalls = toNumber(teamForm.answeredCalls)
    const abandonedCalls = toNumber(teamForm.abandonedCalls)
    const totalCalls = toNumber(teamForm.totalCalls)
    const performancePercentage = answeredCalls
      ? round((abandonedCalls / answeredCalls) * 100)
      : 0

    const { error } = await supabase.from('weekly_team_metrics').insert({
      week_start: teamForm.weekStart,
      week_end: teamForm.weekEnd,
      answered_calls: answeredCalls,
      abandoned_calls: abandonedCalls,
      total_calls: totalCalls,
      performance_percentage: performancePercentage,
      notes: teamForm.notes || null,
      created_by: user?.id,
    })

    if (error) setMessage(error.message)
    else {
      setMessage('Performance da equipe salva com sucesso.')
      setTeamForm(initialTeamForm)
      await loadData()
    }

    setSaving(false)
  }

  if (!user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-white">
        <section className="w-full max-w-md rounded-lg border border-white/10 bg-white/5 p-6 shadow-2xl">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-cyan-300">
            Painel Telefone
          </p>
          <h1 className="mt-4 text-3xl font-bold">Entrar no sistema</h1>

          <form className="mt-6 space-y-4" onSubmit={handleLogin}>
            <Field label="E-mail">
              <input
                className="form-input"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </Field>

            <Field label="Senha">
              <input
                className="form-input"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </Field>

            <button className="primary-button w-full" type="submit">
              Entrar
            </button>
          </form>

          {message && <Feedback message={message} />}
        </section>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-slate-950 px-5 py-6 text-white sm:px-8">
      <section className="mx-auto max-w-7xl">
        <header className="flex flex-col gap-5 border-b border-white/10 pb-6 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-cyan-300">
              Painel Telefone
            </p>
            <h1 className="mt-3 text-3xl font-bold sm:text-4xl">
              Gestao de Performance de Atendimento
            </h1>
            <p className="mt-3 max-w-3xl text-slate-300">
              Painel interno para acompanhar metas, analistas, lancamentos semanais,
              performance da equipe e proximas analises com IA.
            </p>
          </div>

          <button className="secondary-button self-start" onClick={handleLogout}>
            Sair
          </button>
        </header>

        <nav className="mt-6 flex flex-wrap gap-2">
          <TabButton active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')}>
            Dashboard
          </TabButton>
          <TabButton active={activeTab === 'entries'} onClick={() => setActiveTab('entries')}>
            Lancamentos
          </TabButton>
          <TabButton active={activeTab === 'analysts'} onClick={() => setActiveTab('analysts')}>
            Analistas
          </TabButton>
          <TabButton active={activeTab === 'goals'} onClick={() => setActiveTab('goals')}>
            Metas
          </TabButton>
        </nav>

        {message && <Feedback message={message} />}

        {activeTab === 'dashboard' && (
          <DashboardView
            analystsCount={activeAnalysts.length}
            goalsCount={goals.length}
            averageCsat={averageCsat}
            latestTeamPerformance={latestTeamPerformance}
            individualMetrics={individualMetrics}
            teamMetrics={teamMetrics}
            loading={loading}
          />
        )}

        {activeTab === 'entries' && (
          <EntriesView
            analysts={activeAnalysts}
            individualForm={individualForm}
            teamForm={teamForm}
            saving={saving}
            onIndividualChange={setIndividualForm}
            onTeamChange={setTeamForm}
            onIndividualSubmit={handleIndividualSubmit}
            onTeamSubmit={handleTeamSubmit}
          />
        )}

        {activeTab === 'analysts' && (
          <AnalystsView
            analysts={analysts}
            analystForm={analystForm}
            editingAnalystId={editingAnalystId}
            saving={saving}
            onAnalystChange={setAnalystForm}
            onAnalystSubmit={handleAnalystSubmit}
            onCancelEdit={handleCancelAnalystEdit}
            onEditAnalyst={handleEditAnalyst}
            onToggleAnalyst={handleToggleAnalyst}
            onDeleteAnalyst={handleDeleteAnalyst}
          />
        )}

        {activeTab === 'goals' && <GoalsView goals={goals} />}
      </section>
    </main>
  )
}

function DashboardView({
  analystsCount,
  goalsCount,
  averageCsat,
  latestTeamPerformance,
  individualMetrics,
  teamMetrics,
  loading,
}: {
  analystsCount: number
  goalsCount: number
  averageCsat: number
  latestTeamPerformance: number
  individualMetrics: IndividualMetric[]
  teamMetrics: TeamMetric[]
  loading: boolean
}) {
  return (
    <div className="mt-8 space-y-7">
      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard label="Status" value="Supabase conectado" tone="success" />
        <MetricCard label="Analistas ativos" value={loading ? '...' : analystsCount} />
        <MetricCard label="Metas" value={loading ? '...' : goalsCount} />
        <MetricCard label="CSAT medio recente" value={`${averageCsat || 0}%`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="panel">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="section-title">Ultimos lancamentos individuais</h2>
              <p className="section-subtitle">Dados mais recentes por semana e analista.</p>
            </div>
          </div>

          <div className="mt-5 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-slate-400">
                <tr>
                  <th className="pb-3 pr-4 font-medium">Analista</th>
                  <th className="pb-3 pr-4 font-medium">Semana</th>
                  <th className="pb-3 pr-4 font-medium">CSAT</th>
                  <th className="pb-3 pr-4 font-medium">Avaliacoes</th>
                  <th className="pb-3 font-medium">Atendimentos</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {individualMetrics.map((metric) => (
                  <tr key={metric.id}>
                    <td className="py-3 pr-4">{getAnalystName(metric.analysts)}</td>
                    <td className="py-3 pr-4">{formatWeek(metric.week_start, metric.week_end)}</td>
                    <td className="py-3 pr-4">{metric.csat}%</td>
                    <td className="py-3 pr-4">{metric.total_reviews}</td>
                    <td className="py-3">{metric.total_tickets}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {!individualMetrics.length && (
              <EmptyState text="Ainda nao ha lancamentos individuais registrados." />
            )}
          </div>
        </section>

        <section className="panel">
          <h2 className="section-title">Performance da equipe</h2>
          <p className="section-subtitle">Meta inicial configurada: 96%.</p>

          <div className="mt-6 rounded-lg bg-slate-900 p-5">
            <p className="text-sm text-slate-400">Ultima performance registrada</p>
            <p className="mt-2 text-4xl font-bold text-emerald-300">
              {latestTeamPerformance || 0}%
            </p>
          </div>

          <div className="mt-5 space-y-3">
            {teamMetrics.map((metric) => (
              <div key={metric.id} className="list-row">
                <span>{formatWeek(metric.week_start, metric.week_end)}</span>
                <strong>{metric.performance_percentage}%</strong>
              </div>
            ))}
          </div>

          {!teamMetrics.length && <EmptyState text="Ainda nao ha performance semanal registrada." />}
        </section>
      </div>
    </div>
  )
}

function EntriesView({
  analysts,
  individualForm,
  teamForm,
  saving,
  onIndividualChange,
  onTeamChange,
  onIndividualSubmit,
  onTeamSubmit,
}: {
  analysts: Analyst[]
  individualForm: typeof initialIndividualForm
  teamForm: typeof initialTeamForm
  saving: boolean
  onIndividualChange: (form: typeof initialIndividualForm) => void
  onTeamChange: (form: typeof initialTeamForm) => void
  onIndividualSubmit: (event: React.FormEvent<HTMLFormElement>) => void
  onTeamSubmit: (event: React.FormEvent<HTMLFormElement>) => void
}) {
  return (
    <div className="mt-8 grid gap-6 xl:grid-cols-2">
      <section className="panel">
        <h2 className="section-title">Lancamento individual</h2>
        <p className="section-subtitle">
          Registre CSAT, avaliacoes e atendimentos da semana anterior.
        </p>

        <form className="mt-5 grid gap-4" onSubmit={onIndividualSubmit}>
          <Field label="Analista">
            <select
              className="form-input"
              value={individualForm.analystId}
              onChange={(event) =>
                onIndividualChange({ ...individualForm, analystId: event.target.value })
              }
              required
            >
              {analysts.map((analyst) => (
                <option key={analyst.id} value={analyst.id}>
                  {analyst.name}
                </option>
              ))}
            </select>
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Inicio da semana">
              <input
                className="form-input"
                type="date"
                value={individualForm.weekStart}
                onChange={(event) =>
                  onIndividualChange({ ...individualForm, weekStart: event.target.value })
                }
                required
              />
            </Field>
            <Field label="Fim da semana">
              <input
                className="form-input"
                type="date"
                value={individualForm.weekEnd}
                onChange={(event) =>
                  onIndividualChange({ ...individualForm, weekEnd: event.target.value })
                }
                required
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="CSAT (%)">
              <input
                className="form-input"
                min="0"
                max="100"
                step="0.01"
                type="number"
                value={individualForm.csat}
                onChange={(event) =>
                  onIndividualChange({ ...individualForm, csat: event.target.value })
                }
                required
              />
            </Field>
            <Field label="Total de atendimentos">
              <input
                className="form-input"
                min="0"
                type="number"
                value={individualForm.totalTickets}
                onChange={(event) =>
                  onIndividualChange({ ...individualForm, totalTickets: event.target.value })
                }
                required
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Avaliacoes positivas">
              <input
                className="form-input"
                min="0"
                type="number"
                value={individualForm.positiveReviews}
                onChange={(event) =>
                  onIndividualChange({ ...individualForm, positiveReviews: event.target.value })
                }
                required
              />
            </Field>
            <Field label="Avaliacoes negativas">
              <input
                className="form-input"
                min="0"
                type="number"
                value={individualForm.negativeReviews}
                onChange={(event) =>
                  onIndividualChange({ ...individualForm, negativeReviews: event.target.value })
                }
                required
              />
            </Field>
          </div>

          <Field label="Observacoes">
            <textarea
              className="form-input min-h-24"
              value={individualForm.notes}
              onChange={(event) =>
                onIndividualChange({ ...individualForm, notes: event.target.value })
              }
            />
          </Field>

          <button className="primary-button" disabled={saving} type="submit">
            {saving ? 'Salvando...' : 'Salvar lancamento individual'}
          </button>
        </form>
      </section>

      <section className="panel">
        <h2 className="section-title">Performance da equipe</h2>
        <p className="section-subtitle">
          Formula atual: ligacoes abandonadas / ligacoes atendidas x 100.
        </p>

        <form className="mt-5 grid gap-4" onSubmit={onTeamSubmit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Inicio da semana">
              <input
                className="form-input"
                type="date"
                value={teamForm.weekStart}
                onChange={(event) => onTeamChange({ ...teamForm, weekStart: event.target.value })}
                required
              />
            </Field>
            <Field label="Fim da semana">
              <input
                className="form-input"
                type="date"
                value={teamForm.weekEnd}
                onChange={(event) => onTeamChange({ ...teamForm, weekEnd: event.target.value })}
                required
              />
            </Field>
          </div>

          <Field label="Ligacoes atendidas">
            <input
              className="form-input"
              min="0"
              type="number"
              value={teamForm.answeredCalls}
              onChange={(event) => onTeamChange({ ...teamForm, answeredCalls: event.target.value })}
              required
            />
          </Field>
          <Field label="Ligacoes abandonadas">
            <input
              className="form-input"
              min="0"
              type="number"
              value={teamForm.abandonedCalls}
              onChange={(event) =>
                onTeamChange({ ...teamForm, abandonedCalls: event.target.value })
              }
              required
            />
          </Field>
          <Field label="Total de ligacoes">
            <input
              className="form-input"
              min="1"
              type="number"
              value={teamForm.totalCalls}
              onChange={(event) => onTeamChange({ ...teamForm, totalCalls: event.target.value })}
              required
            />
          </Field>
          <Field label="Observacoes">
            <textarea
              className="form-input min-h-24"
              value={teamForm.notes}
              onChange={(event) => onTeamChange({ ...teamForm, notes: event.target.value })}
            />
          </Field>

          <button className="primary-button" disabled={saving} type="submit">
            {saving ? 'Salvando...' : 'Salvar performance da equipe'}
          </button>
        </form>
      </section>
    </div>
  )
}

function AnalystsView({
  analysts,
  analystForm,
  editingAnalystId,
  saving,
  onAnalystChange,
  onAnalystSubmit,
  onCancelEdit,
  onEditAnalyst,
  onToggleAnalyst,
  onDeleteAnalyst,
}: {
  analysts: Analyst[]
  analystForm: typeof initialAnalystForm
  editingAnalystId: string | null
  saving: boolean
  onAnalystChange: (form: typeof initialAnalystForm) => void
  onAnalystSubmit: (event: React.FormEvent<HTMLFormElement>) => void
  onCancelEdit: () => void
  onEditAnalyst: (analyst: Analyst) => void
  onToggleAnalyst: (analyst: Analyst) => void
  onDeleteAnalyst: (analyst: Analyst) => void
}) {
  return (
    <div className="mt-8 grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
      <section className="panel">
        <h2 className="section-title">
          {editingAnalystId ? 'Editar analista' : 'Incluir analista'}
        </h2>
        <p className="section-subtitle">
          Defina o nome e a meta de CSAT individual conforme o perfil da empresa.
        </p>

        <form className="mt-5 grid gap-4" onSubmit={onAnalystSubmit}>
          <Field label="Nome do analista">
            <input
              className="form-input"
              value={analystForm.name}
              onChange={(event) =>
                onAnalystChange({ ...analystForm, name: event.target.value })
              }
              required
            />
          </Field>

          <Field label="Meta CSAT individual (%)">
            <input
              className="form-input"
              min="0"
              max="100"
              step="0.01"
              type="number"
              value={analystForm.csatGoal}
              onChange={(event) =>
                onAnalystChange({ ...analystForm, csatGoal: event.target.value })
              }
              required
            />
          </Field>

          <div className="flex flex-wrap gap-3">
            <button className="primary-button" disabled={saving} type="submit">
              {saving ? 'Salvando...' : editingAnalystId ? 'Salvar alteracoes' : 'Incluir analista'}
            </button>

            {editingAnalystId && (
              <button className="secondary-button" type="button" onClick={onCancelEdit}>
                Cancelar
              </button>
            )}
          </div>
        </form>
      </section>

      <section className="panel">
        <h2 className="section-title">Analistas cadastrados</h2>
        <p className="section-subtitle">
          Inative para preservar historico. Exclua apenas cadastros criados por engano.
        </p>

        <div className="mt-5 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-slate-400">
              <tr>
                <th className="pb-3 pr-4 font-medium">Nome</th>
                <th className="pb-3 pr-4 font-medium">Meta CSAT</th>
                <th className="pb-3 pr-4 font-medium">Status</th>
                <th className="pb-3 font-medium">Acoes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {analysts.map((analyst) => (
                <tr key={analyst.id}>
                  <td className="py-3 pr-4">{analyst.name}</td>
                  <td className="py-3 pr-4">{analyst.csat_goal}%</td>
                  <td className="py-3 pr-4">
                    <span className={analyst.active ? 'text-emerald-300' : 'text-slate-400'}>
                      {analyst.active ? 'Ativo' : 'Inativo'}
                    </span>
                  </td>
                  <td className="py-3">
                    <div className="flex flex-wrap gap-2">
                      <button
                        className="small-button"
                        type="button"
                        onClick={() => onEditAnalyst(analyst)}
                      >
                        Editar
                      </button>
                      <button
                        className="small-button"
                        type="button"
                        onClick={() => onToggleAnalyst(analyst)}
                      >
                        {analyst.active ? 'Inativar' : 'Reativar'}
                      </button>
                      <button
                        className="danger-button"
                        type="button"
                        onClick={() => onDeleteAnalyst(analyst)}
                      >
                        Excluir
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {!analysts.length && <EmptyState text="Nenhum analista cadastrado." />}
        </div>
      </section>
    </div>
  )
}

function GoalsView({ goals }: { goals: Goal[] }) {
  return (
    <section className="panel mt-8">
      <h2 className="section-title">Metas configuradas</h2>
      <p className="section-subtitle">Esses valores vem do banco e poderao ser editados em tela.</p>
      <div className="mt-5 grid gap-3 md:grid-cols-2">
        {goals.map((goal) => (
          <div key={goal.id} className="list-row">
            <span>{goal.label}</span>
            <strong>
              {goal.value}
              {goal.unit === 'percent' ? '%' : ''}
            </strong>
          </div>
        ))}
      </div>
    </section>
  )
}

function MetricCard({
  label,
  value,
  tone,
}: {
  label: string
  value: string | number
  tone?: 'success'
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-5">
      <p className="text-sm text-slate-400">{label}</p>
      <p className={`mt-2 text-2xl font-semibold ${tone === 'success' ? 'text-emerald-300' : ''}`}>
        {value}
      </p>
    </div>
  )
}

function TabButton({
  active,
  children,
  onClick,
}: {
  active: boolean
  children: React.ReactNode
  onClick: () => void
}) {
  return (
    <button className={active ? 'tab-button-active' : 'tab-button'} onClick={onClick}>
      {children}
    </button>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-2 text-sm text-slate-300">
      {label}
      {children}
    </label>
  )
}

function Feedback({ message }: { message: string }) {
  return <p className="mt-5 rounded-md bg-slate-900 p-3 text-sm text-slate-300">{message}</p>
}

function EmptyState({ text }: { text: string }) {
  return <p className="mt-4 rounded-md bg-slate-900 p-4 text-sm text-slate-400">{text}</p>
}

function formatWeek(start: string, end: string) {
  return `${formatDate(start)} a ${formatDate(end)}`
}

function getAnalystName(analyst: IndividualMetric['analysts']) {
  if (Array.isArray(analyst)) return analyst[0]?.name ?? 'Analista'
  return analyst?.name ?? 'Analista'
}

function formatDate(value: string) {
  if (!value) return '-'
  const [year, month, day] = value.split('-')
  return `${day}/${month}/${year}`
}

function toNumber(value: string) {
  return Number(value || 0)
}

function round(value: number) {
  return Math.round(value * 100) / 100
}
