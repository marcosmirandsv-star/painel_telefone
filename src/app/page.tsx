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
  active: boolean
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
  evidence_url: string | null
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
  evidence_url: string | null
  notes: string | null
}

type IndividualForm = {
  analystId: string
  weekStart: string
  weekEnd: string
  csat: string
  positiveReviews: string
  negativeReviews: string
  totalTickets: string
  notes: string
  evidenceFile: File | null
}

type TeamForm = {
  weekStart: string
  weekEnd: string
  answeredCalls: string
  abandonedCalls: string
  totalCalls: string
  notes: string
  evidenceFile: File | null
}

type ChartPoint = {
  label: string
  value: number
}

type WeeklyIndividualTrend = {
  label: string
  csat: number
  totalReviews: number
  totalTickets: number
}

type MonthlyPodiumResult = {
  analystId: string
  analystName: string
  averageCsat: number
  totalReviews: number
  totalTickets: number
  reviewPercentage: number
  individualGoal: number
  eligible: boolean
  reasons: string[]
}

type PeriodMode = 'week' | 'month' | 'year' | 'custom'

type PeriodFilter = {
  mode: PeriodMode
  start: string
  end: string
}

type ActiveTab = 'dashboard' | 'analysts' | 'goals' | 'entries'

const initialIndividualForm: IndividualForm = {
  analystId: '',
  weekStart: '',
  weekEnd: '',
  csat: '',
  positiveReviews: '',
  negativeReviews: '',
  totalTickets: '',
  notes: '',
  evidenceFile: null,
}

const initialTeamForm: TeamForm = {
  weekStart: '',
  weekEnd: '',
  answeredCalls: '',
  abandonedCalls: '',
  totalCalls: '',
  notes: '',
  evidenceFile: null,
}

const initialAnalystForm = {
  name: '',
  csatGoal: '86',
}

const initialGoalForm = {
  label: '',
  value: '',
  unit: 'percent',
  active: true,
}

export default function Home() {
  const [user, setUser] = useState<User | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false)
  const [goals, setGoals] = useState<Goal[]>([])
  const [analysts, setAnalysts] = useState<Analyst[]>([])
  const [individualMetrics, setIndividualMetrics] = useState<IndividualMetric[]>([])
  const [teamMetrics, setTeamMetrics] = useState<TeamMetric[]>([])
  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard')
  const [individualForm, setIndividualForm] = useState(initialIndividualForm)
  const [teamForm, setTeamForm] = useState(initialTeamForm)
  const [analystForm, setAnalystForm] = useState(initialAnalystForm)
  const [goalForm, setGoalForm] = useState(initialGoalForm)
  const [editingAnalystId, setEditingAnalystId] = useState<string | null>(null)
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    const recoveryFromHash = new URLSearchParams(window.location.hash.replace('#', ''))
    const recoveryFromSearch = new URLSearchParams(window.location.search)
    const cameFromRecoveryLink =
      recoveryFromHash.get('type') === 'recovery' ||
      recoveryFromSearch.get('type') === 'recovery'

    async function loadSession() {
      const { data } = await supabase.auth.getUser()
      setUser(data.user)
      if (cameFromRecoveryLink) {
        setIsPasswordRecovery(true)
        setMessage('Digite uma nova senha para concluir a recuperacao.')
      }
      setLoading(false)
    }

    loadSession()

    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setUser(session?.user ?? null)
        setIsPasswordRecovery(true)
        setMessage('Digite uma nova senha para concluir a recuperacao.')
      }
    })

    return () => {
      authListener.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!user) return
    loadData()
  }, [user])

  async function loadData() {
    setLoading(true)
    setMessage('')

    const [goalsResult, analystsResult, individualResult, teamResult] = await Promise.all([
      supabase.from('goals').select('id, key, label, value, unit, active').order('label'),
      supabase.from('analysts').select('id, name, active, csat_goal').order('name'),
      supabase
        .from('weekly_individual_metrics')
        .select('id, analyst_id, week_start, week_end, csat, total_reviews, positive_reviews, negative_reviews, review_percentage, total_tickets, evidence_url, notes, analysts(name)')
        .order('week_start', { ascending: false })
        .limit(52),
      supabase
        .from('weekly_team_metrics')
        .select('id, week_start, week_end, answered_calls, abandoned_calls, total_calls, performance_percentage, evidence_url, notes')
        .order('week_start', { ascending: false })
        .limit(52),
    ])

    if (goalsResult.error) setMessage(goalsResult.error.message)
    else setGoals((goalsResult.data ?? []).filter((goal) => goal.key !== 'individual_csat'))

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

  const activeAnalysts = useMemo(
    () => analysts.filter((analyst) => analyst.active),
    [analysts],
  )
  const selectedAnalyst = useMemo(
    () => analysts.find((analyst) => analyst.id === individualForm.analystId) ?? null,
    [analysts, individualForm.analystId],
  )
  const podiumCsatGoal = goals.find((goal) => goal.key === 'podium_csat_minimum')?.value ?? 90

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

  async function handlePasswordReset() {
    const trimmedEmail = email.trim()

    if (!trimmedEmail) {
      setMessage('Digite seu e-mail primeiro para receber o link de redefinicao.')
      return
    }

    setSaving(true)
    setMessage('Enviando e-mail de redefinicao...')

    const { error } = await supabase.auth.resetPasswordForEmail(trimmedEmail, {
      redirectTo: window.location.origin,
    })

    setSaving(false)

    if (error) {
      setMessage(error.message)
      return
    }

    setMessage('Enviamos um link para seu e-mail. Abra o link para redefinir sua senha.')
  }

  async function handleUpdatePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (newPassword.length < 6) {
      setMessage('A nova senha precisa ter pelo menos 6 caracteres.')
      return
    }

    setSaving(true)
    setMessage('Atualizando senha...')

    const { error } = await supabase.auth.updateUser({ password: newPassword })

    setSaving(false)

    if (error) {
      setMessage(error.message)
      return
    }

    setNewPassword('')
    setIsPasswordRecovery(false)
    setMessage('Senha atualizada com sucesso.')
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    setUser(null)
    setIsPasswordRecovery(false)
    setGoals([])
    setAnalysts([])
    setIndividualMetrics([])
    setTeamMetrics([])
  }

  async function handleAnalystSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setMessage('')

    try {
      const payload = {
        name: analystForm.name.trim(),
        csat_goal: toNumber(analystForm.csatGoal),
      }

      const result = editingAnalystId
        ? await withTimeout(
            supabase
              .from('analysts')
              .update(payload)
              .eq('id', editingAnalystId)
              .select('id, name, active, csat_goal')
              .single(),
            'O Supabase demorou para atualizar o analista. Tente novamente.',
          )
        : await withTimeout(
            supabase
              .from('analysts')
              .insert({ ...payload, active: true })
              .select('id, name, active, csat_goal')
              .single(),
            'O Supabase demorou para incluir o analista. Tente novamente.',
          )

      if (result.error) setMessage(result.error.message)
      else {
        setMessage(editingAnalystId ? 'Analista atualizado com sucesso.' : 'Analista incluido com sucesso.')
        setAnalysts((current) => upsertAnalyst(current, result.data as Analyst))
        setAnalystForm(initialAnalystForm)
        setEditingAnalystId(null)
      }
    } catch (error) {
      setMessage(getErrorMessage(error))
    } finally {
      setSaving(false)
    }
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

    try {
      const { error } = await withTimeout(
        supabase
          .from('analysts')
          .update({ active: !analyst.active })
          .eq('id', analyst.id)
          .select('id, name, active, csat_goal')
          .single(),
        'O Supabase demorou para alterar o status do analista. Tente novamente.',
      )

      if (error) setMessage(error.message)
      else {
        setMessage(analyst.active ? 'Analista inativado com sucesso.' : 'Analista reativado com sucesso.')
        setAnalysts((current) =>
          current.map((item) =>
            item.id === analyst.id ? { ...item, active: !analyst.active } : item,
          ),
        )
      }
    } catch (error) {
      setMessage(getErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteAnalyst(analyst: Analyst) {
    const confirmed = window.confirm(
      `Excluir ${analyst.name}? Se ele tiver historico de lancamentos, prefira inativar para preservar os relatorios.`,
    )

    if (!confirmed) return

    setSaving(true)
    setMessage('')

    try {
      const { error } = await withTimeout(
        supabase.from('analysts').delete().eq('id', analyst.id),
        'O Supabase demorou para excluir o analista. Tente novamente.',
      )

      if (error) {
        setMessage('Nao foi possivel excluir. Se existir historico, use Inativar para preservar os dados.')
      } else {
        setMessage('Analista excluido com sucesso.')
        if (editingAnalystId === analyst.id) handleCancelAnalystEdit()
        setAnalysts((current) => current.filter((item) => item.id !== analyst.id))
      }
    } catch (error) {
      setMessage(getErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  async function handleGoalSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editingGoalId) return

    setSaving(true)
    setMessage('')

    try {
      const result = await withTimeout(
        supabase
          .from('goals')
          .update({
            label: goalForm.label.trim(),
            value: toNumber(goalForm.value),
            unit: goalForm.unit.trim() || 'percent',
            active: goalForm.active,
          })
          .eq('id', editingGoalId)
          .select('id, key, label, value, unit, active')
          .single(),
        'O Supabase demorou para atualizar a meta. Tente novamente.',
      )

      if (result.error) setMessage(result.error.message)
      else {
        setMessage('Meta atualizada com sucesso.')
        setGoals((current) => upsertGoal(current, result.data as Goal))
        setGoalForm(initialGoalForm)
        setEditingGoalId(null)
      }
    } catch (error) {
      setMessage(getErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  function handleEditGoal(goal: Goal) {
    setGoalForm({
      label: goal.label,
      value: String(goal.value),
      unit: goal.unit,
      active: goal.active,
    })
    setEditingGoalId(goal.id)
  }

  function handleCancelGoalEdit() {
    setGoalForm(initialGoalForm)
    setEditingGoalId(null)
  }

  async function uploadEvidence(file: File | null, folder: string) {
    if (!file) return null

    const extension = file.name.split('.').pop() || 'arquivo'
    const safeName = file.name
      .replace(/\.[^/.]+$/, '')
      .replace(/[^a-zA-Z0-9-_]/g, '-')
      .slice(0, 60)
    const path = `${folder}/${user?.id ?? 'usuario'}/${Date.now()}-${safeName}.${extension}`

    const { error } = await supabase.storage.from('evidencias').upload(path, file, {
      cacheControl: '3600',
      upsert: false,
    })

    if (error) throw new Error(error.message)

    const { data } = supabase.storage.from('evidencias').getPublicUrl(path)
    return data.publicUrl
  }

  async function handleIndividualSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setMessage('')

    try {
      const positiveReviews = toNumber(individualForm.positiveReviews)
      const negativeReviews = toNumber(individualForm.negativeReviews)
      const totalReviews = positiveReviews + negativeReviews
      const totalTickets = toNumber(individualForm.totalTickets)
      const reviewPercentage = totalTickets ? round((totalReviews / totalTickets) * 100) : 0
      const evidenceUrl = await uploadEvidence(individualForm.evidenceFile, 'individual')

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
        evidence_url: evidenceUrl,
        notes: individualForm.notes || null,
        created_by: user?.id,
      })

      if (error) setMessage(error.message)
      else {
        setMessage('Lancamento individual salvo com sucesso.')
        setIndividualForm({ ...initialIndividualForm, analystId: activeAnalysts[0]?.id || '' })
        await loadData()
      }
    } catch (error) {
      setMessage(`Nao foi possivel salvar a evidencia ou o lancamento: ${getErrorMessage(error)}`)
    } finally {
      setSaving(false)
    }
  }

  async function handleTeamSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setMessage('')

    try {
      const answeredCalls = toNumber(teamForm.answeredCalls)
      const abandonedCalls = toNumber(teamForm.abandonedCalls)
      const totalCalls = toNumber(teamForm.totalCalls)
      const performancePercentage = totalCalls
        ? round((answeredCalls / totalCalls) * 100)
        : 0
      const evidenceUrl = await uploadEvidence(teamForm.evidenceFile, 'equipe')

      const { error } = await supabase.from('weekly_team_metrics').insert({
        week_start: teamForm.weekStart,
        week_end: teamForm.weekEnd,
        answered_calls: answeredCalls,
        abandoned_calls: abandonedCalls,
        total_calls: totalCalls,
        performance_percentage: performancePercentage,
        evidence_url: evidenceUrl,
        notes: teamForm.notes || null,
        created_by: user?.id,
      })

      if (error) setMessage(error.message)
      else {
        setMessage('Performance da equipe salva com sucesso.')
        setTeamForm(initialTeamForm)
        await loadData()
      }
    } catch (error) {
      setMessage(`Nao foi possivel salvar a evidencia ou a performance: ${getErrorMessage(error)}`)
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteIndividualMetric(metric: IndividualMetric) {
    const analystName = getAnalystName(metric.analysts)
    const confirmed = window.confirm(
      `Excluir o lancamento individual de ${analystName} da semana ${formatWeek(metric.week_start, metric.week_end)}?`,
    )

    if (!confirmed) return

    setSaving(true)
    setMessage('')

    try {
      const { error } = await withTimeout(
        supabase.from('weekly_individual_metrics').delete().eq('id', metric.id),
        'O Supabase demorou para excluir o lancamento. Tente novamente.',
      )

      if (error) setMessage(error.message)
      else {
        setMessage('Lancamento individual excluido com sucesso.')
        setIndividualMetrics((current) => current.filter((item) => item.id !== metric.id))
      }
    } catch (error) {
      setMessage(getErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteTeamMetric(metric: TeamMetric) {
    const confirmed = window.confirm(
      `Excluir a performance da equipe da semana ${formatWeek(metric.week_start, metric.week_end)}?`,
    )

    if (!confirmed) return

    setSaving(true)
    setMessage('')

    try {
      const { error } = await withTimeout(
        supabase.from('weekly_team_metrics').delete().eq('id', metric.id),
        'O Supabase demorou para excluir a performance. Tente novamente.',
      )

      if (error) setMessage(error.message)
      else {
        setMessage('Performance da equipe excluida com sucesso.')
        setTeamMetrics((current) => current.filter((item) => item.id !== metric.id))
      }
    } catch (error) {
      setMessage(getErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  if (!user || isPasswordRecovery) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-white">
        <section className="w-full max-w-md rounded-lg border border-white/10 bg-white/5 p-6 shadow-2xl">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-cyan-300">
            Painel Telefone
          </p>
          <h1 className="mt-4 text-3xl font-bold">
            {isPasswordRecovery ? 'Criar nova senha' : 'Entrar no sistema'}
          </h1>

          {isPasswordRecovery ? (
            <form className="mt-6 space-y-4" onSubmit={handleUpdatePassword}>
              <Field label="Nova senha">
                <input
                  className="form-input"
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  required
                  minLength={6}
                />
              </Field>

              <button className="primary-button w-full" disabled={saving} type="submit">
                {saving ? 'Salvando...' : 'Salvar nova senha'}
              </button>
            </form>
          ) : (
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

              <button
                className="w-full text-sm font-semibold text-cyan-300 hover:text-cyan-200 disabled:text-slate-500"
                disabled={saving}
                type="button"
                onClick={handlePasswordReset}
              >
                {saving ? 'Enviando link...' : 'Esqueci minha senha'}
              </button>
            </form>
          )}

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
            analysts={analysts}
            goals={goals}
            individualMetrics={individualMetrics}
            teamMetrics={teamMetrics}
            loading={loading}
          />
        )}

        {activeTab === 'entries' && (
          <EntriesView
            analysts={activeAnalysts}
            selectedAnalyst={selectedAnalyst}
            podiumCsatGoal={podiumCsatGoal}
            individualMetrics={individualMetrics}
            teamMetrics={teamMetrics}
            individualForm={individualForm}
            teamForm={teamForm}
            saving={saving}
            onIndividualChange={setIndividualForm}
            onTeamChange={setTeamForm}
            onIndividualSubmit={handleIndividualSubmit}
            onTeamSubmit={handleTeamSubmit}
            onDeleteIndividualMetric={handleDeleteIndividualMetric}
            onDeleteTeamMetric={handleDeleteTeamMetric}
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

        {activeTab === 'goals' && (
          <GoalsView
            goals={goals}
            goalForm={goalForm}
            editingGoalId={editingGoalId}
            saving={saving}
            onGoalChange={setGoalForm}
            onGoalSubmit={handleGoalSubmit}
            onEditGoal={handleEditGoal}
            onCancelEdit={handleCancelGoalEdit}
          />
        )}
      </section>
    </main>
  )
}

function DashboardView({
  analystsCount,
  analysts,
  goals,
  individualMetrics,
  teamMetrics,
  loading,
}: {
  analystsCount: number
  analysts: Analyst[]
  goals: Goal[]
  individualMetrics: IndividualMetric[]
  teamMetrics: TeamMetric[]
  loading: boolean
}) {
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>(() => createPeriodFilter('month'))
  const filteredIndividualMetrics = useMemo(
    () => filterIndividualMetricsByPeriod(individualMetrics, periodFilter),
    [individualMetrics, periodFilter],
  )
  const filteredTeamMetrics = useMemo(
    () => filterTeamMetricsByPeriod(teamMetrics, periodFilter),
    [teamMetrics, periodFilter],
  )
  const weeklyIndividualTrend = aggregateIndividualByWeek(filteredIndividualMetrics).slice(-8)
  const teamPerformanceTrend = [...filteredTeamMetrics]
    .sort((a, b) => a.week_start.localeCompare(b.week_start))
    .slice(-8)
    .map((metric) => ({
      label: formatShortDate(metric.week_start),
      value: Number(metric.performance_percentage),
    }))
  const podiumCsatGoal = getGoalValue(goals, 'podium_csat_minimum', 90)
  const reviewGoal = getGoalValue(goals, 'review_percentage', 25)
  const teamPerformanceGoal = getTeamPerformanceGoal(goals)
  const periodPodium = buildPeriodPodium(filteredIndividualMetrics, analysts, podiumCsatGoal, reviewGoal)
  const podiumWinners = periodPodium.filter((item) => item.eligible).slice(0, 3)
  const bestPerformer = periodPodium[0] ?? null
  const attentionList = periodPodium.filter((item) => !item.eligible).slice(0, 3)
  const eligibleCount = periodPodium.filter((item) => item.eligible).length
  const periodLabel = formatPeriodLabel(periodFilter)
  const periodAverageCsat = calculateAverageCsat(filteredIndividualMetrics)
  const periodTeamPerformance = filteredTeamMetrics[0]?.performance_percentage ?? 0

  function handlePeriodModeChange(mode: PeriodMode) {
    setPeriodFilter(createPeriodFilter(mode))
  }

  return (
    <div className="mt-8 space-y-7">
      <section className="panel">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="section-title">Periodo de analise</h2>
            <p className="section-subtitle">
              Os cards, graficos, podio e insights abaixo seguem este filtro.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {(['week', 'month', 'year', 'custom'] as PeriodMode[]).map((mode) => (
              <button
                key={mode}
                className={periodFilter.mode === mode ? 'tab-button-active' : 'tab-button'}
                type="button"
                onClick={() => handlePeriodModeChange(mode)}
              >
                {getPeriodModeLabel(mode)}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field label="Inicio">
            <input
              className="form-input"
              type="date"
              value={periodFilter.start}
              onChange={(event) =>
                setPeriodFilter({ ...periodFilter, mode: 'custom', start: event.target.value })
              }
            />
          </Field>
          <Field label="Fim">
            <input
              className="form-input"
              type="date"
              value={periodFilter.end}
              onChange={(event) =>
                setPeriodFilter({ ...periodFilter, mode: 'custom', end: event.target.value })
              }
            />
          </Field>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard label="Status" value="Supabase conectado" tone="success" />
        <MetricCard label="Analistas ativos" value={loading ? '...' : analystsCount} />
        <MetricCard label="CSAT do periodo" value={`${periodAverageCsat || 0}%`} />
        <MetricCard label="Performance equipe" value={`${periodTeamPerformance || 0}%`} />
      </div>

      <section className="panel">
        <h2 className="section-title">Variacoes recentes</h2>
        <p className="section-subtitle">
          Evolucao calculada dentro de {periodLabel}.
        </p>

        <div className="mt-6 grid gap-6 xl:grid-cols-3">
          <TrendLineChart
            label="CSAT medio semanal"
            points={weeklyIndividualTrend.map((item) => ({
              label: item.label,
              value: item.csat,
            }))}
            suffix="%"
          />
          <BarTrend
            label="Avaliacoes por semana"
            points={weeklyIndividualTrend.map((item) => ({
              label: item.label,
              value: item.totalReviews,
            }))}
          />
          <TrendLineChart
            label="Performance da equipe"
            points={teamPerformanceTrend}
            suffix="%"
          />
        </div>
      </section>

      <section className="panel">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="section-title">Podio do periodo</h2>
            <p className="section-subtitle">
              Ranking de {periodLabel}: CSAT minimo {podiumCsatGoal}%, avaliacoes {reviewGoal}% e atendimentos dentro da media da equipe.
            </p>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {[0, 1, 2].map((index) => {
            const winner = podiumWinners[index]

            return (
              <div key={index} className="rounded-lg bg-slate-900 p-5">
                <p className="text-sm text-slate-400">{index + 1}o lugar</p>
                {winner ? (
                  <>
                    <h3 className="mt-2 text-xl font-bold">{winner.analystName}</h3>
                    <p className="mt-3 text-3xl font-bold text-cyan-300">{winner.averageCsat}%</p>
                    <p className="mt-2 text-sm text-slate-400">
                      {winner.reviewPercentage}% avaliacoes | {winner.totalTickets} atendimentos
                    </p>
                  </>
                ) : (
                  <p className="mt-5 text-sm text-slate-500">Aguardando elegivel</p>
                )}
              </div>
            )
          })}
        </div>

        <div className="mt-6 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-slate-400">
              <tr>
                <th className="pb-3 pr-4 font-medium">Analista</th>
                <th className="pb-3 pr-4 font-medium">CSAT periodo</th>
                <th className="pb-3 pr-4 font-medium">Avaliacoes</th>
                <th className="pb-3 pr-4 font-medium">Atendimentos</th>
                <th className="pb-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {periodPodium.map((item) => (
                <tr key={item.analystId}>
                  <td className="py-3 pr-4">{item.analystName}</td>
                  <td className="py-3 pr-4">
                    {item.averageCsat}% <span className="text-slate-500">/ meta {item.individualGoal}%</span>
                  </td>
                  <td className="py-3 pr-4">{item.reviewPercentage}%</td>
                  <td className="py-3 pr-4">{item.totalTickets}</td>
                  <td className="py-3">
                    {item.eligible ? (
                      <span className="text-emerald-300">Elegivel</span>
                    ) : (
                      <span className="text-slate-400">{item.reasons.join(', ')}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {!periodPodium.length && (
            <EmptyState text="Ainda nao ha lancamentos individuais no periodo selecionado." />
          )}
        </div>
      </section>

      <section className="panel">
        <h2 className="section-title">Insights do periodo</h2>
        <p className="section-subtitle">
          Leitura rapida para entender desempenho, riscos e prioridades sem abrir historico de lancamentos.
        </p>

        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          <div className="rounded-lg bg-slate-900 p-5">
            <p className="text-sm text-slate-400">Melhor leitura</p>
            {bestPerformer ? (
              <>
                <h3 className="mt-2 text-xl font-bold">{bestPerformer.analystName}</h3>
                <p className="mt-2 text-3xl font-bold text-cyan-300">{bestPerformer.averageCsat}%</p>
                <p className="mt-2 text-sm text-slate-400">
                  {bestPerformer.reviewPercentage}% avaliacoes no periodo
                </p>
              </>
            ) : (
              <p className="mt-4 text-sm text-slate-500">Aguardando dados do periodo.</p>
            )}
          </div>

          <div className="rounded-lg bg-slate-900 p-5">
            <p className="text-sm text-slate-400">Atencao necessaria</p>
            {attentionList.length ? (
              <div className="mt-4 space-y-3">
                {attentionList.map((item) => (
                  <div key={item.analystId} className="border-b border-white/10 pb-3 last:border-0 last:pb-0">
                    <p className="font-semibold">{item.analystName}</p>
                    <p className="mt-1 text-sm text-slate-400">{item.reasons.join(', ')}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-4 text-sm text-emerald-300">
                Nenhum alerta critico entre os analistas com lancamento.
              </p>
            )}
          </div>

          <div className="rounded-lg bg-slate-900 p-5">
            <p className="text-sm text-slate-400">Saude da equipe</p>
            <p className="mt-2 text-3xl font-bold text-emerald-300">
              {periodTeamPerformance || 0}%
            </p>
            <p className="mt-2 text-sm text-slate-400">
              Meta de referencia: {teamPerformanceGoal}%
            </p>
            <p className="mt-4 text-sm text-slate-300">
              {eligibleCount} de {periodPodium.length} analistas estao elegiveis para o podio.
            </p>
          </div>
        </div>
      </section>
    </div>
  )
}

function EntriesView({
  analysts,
  selectedAnalyst,
  podiumCsatGoal,
  individualMetrics,
  teamMetrics,
  individualForm,
  teamForm,
  saving,
  onIndividualChange,
  onTeamChange,
  onIndividualSubmit,
  onTeamSubmit,
  onDeleteIndividualMetric,
  onDeleteTeamMetric,
}: {
  analysts: Analyst[]
  selectedAnalyst: Analyst | null
  podiumCsatGoal: number
  individualMetrics: IndividualMetric[]
  teamMetrics: TeamMetric[]
  individualForm: typeof initialIndividualForm
  teamForm: typeof initialTeamForm
  saving: boolean
  onIndividualChange: (form: typeof initialIndividualForm) => void
  onTeamChange: (form: typeof initialTeamForm) => void
  onIndividualSubmit: (event: React.FormEvent<HTMLFormElement>) => void
  onTeamSubmit: (event: React.FormEvent<HTMLFormElement>) => void
  onDeleteIndividualMetric: (metric: IndividualMetric) => void
  onDeleteTeamMetric: (metric: TeamMetric) => void
}) {
  return (
    <div className="mt-8 space-y-6">
      <div className="grid gap-6 xl:grid-cols-2">
        <section className="panel">
        <h2 className="section-title">Lancamento individual</h2>
        <p className="section-subtitle">
          Registre resultado real, avaliacoes e atendimentos da semana anterior.
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

          <div className="rounded-md bg-slate-900 p-3 text-sm text-slate-300">
            Meta individual: <strong>{selectedAnalyst?.csat_goal ?? 0}%</strong>
            <span className="mx-2 text-slate-600">|</span>
            Minimo para podio: <strong>{podiumCsatGoal}%</strong>
          </div>

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
            <Field label="CSAT realizado na semana (%)">
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

          <Field label="Evidencia do 55PBX (print ou PDF)">
            <input
              accept="image/png,image/jpeg,image/webp,application/pdf"
              className="form-input"
              type="file"
              onChange={(event) =>
                onIndividualChange({
                  ...individualForm,
                  evidenceFile: event.target.files?.[0] ?? null,
                })
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
          Formula atual: ligacoes atendidas / total processado x 100.
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
          <Field label="Total processado">
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

          <Field label="Evidencia do 55PBX (print ou PDF)">
            <input
              accept="image/png,image/jpeg,image/webp,application/pdf"
              className="form-input"
              type="file"
              onChange={(event) =>
                onTeamChange({
                  ...teamForm,
                  evidenceFile: event.target.files?.[0] ?? null,
                })
              }
            />
          </Field>

          <button className="primary-button" disabled={saving} type="submit">
            {saving ? 'Salvando...' : 'Salvar performance da equipe'}
          </button>
        </form>
        </section>
      </div>

      <EntriesHistory
        individualMetrics={individualMetrics}
        teamMetrics={teamMetrics}
        saving={saving}
        onDeleteIndividualMetric={onDeleteIndividualMetric}
        onDeleteTeamMetric={onDeleteTeamMetric}
      />
    </div>
  )
}

function EntriesHistory({
  individualMetrics,
  teamMetrics,
  saving,
  onDeleteIndividualMetric,
  onDeleteTeamMetric,
}: {
  individualMetrics: IndividualMetric[]
  teamMetrics: TeamMetric[]
  saving: boolean
  onDeleteIndividualMetric: (metric: IndividualMetric) => void
  onDeleteTeamMetric: (metric: TeamMetric) => void
}) {
  return (
    <section className="panel">
      <h2 className="section-title">Historico de lancamentos</h2>
      <p className="section-subtitle">
        Use Excluir para remover lancamentos de teste ou registros feitos por engano.
      </p>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <div>
          <h3 className="font-semibold">Individuais</h3>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-slate-400">
                <tr>
                  <th className="pb-3 pr-4 font-medium">Analista</th>
                  <th className="pb-3 pr-4 font-medium">Semana</th>
                  <th className="pb-3 pr-4 font-medium">CSAT</th>
                  <th className="pb-3 pr-4 font-medium">Evidencia</th>
                  <th className="pb-3 font-medium">Acao</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {individualMetrics.map((metric) => (
                  <tr key={metric.id}>
                    <td className="py-3 pr-4">{getAnalystName(metric.analysts)}</td>
                    <td className="py-3 pr-4">{formatWeek(metric.week_start, metric.week_end)}</td>
                    <td className="py-3 pr-4">{metric.csat}%</td>
                    <td className="py-3 pr-4">
                      <EvidenceLink url={metric.evidence_url} />
                    </td>
                    <td className="py-3">
                      <button
                        className="danger-button"
                        disabled={saving}
                        type="button"
                        onClick={() => onDeleteIndividualMetric(metric)}
                      >
                        Excluir
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {!individualMetrics.length && (
              <EmptyState text="Nenhum lancamento individual registrado." />
            )}
          </div>
        </div>

        <div>
          <h3 className="font-semibold">Equipe</h3>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-slate-400">
                <tr>
                  <th className="pb-3 pr-4 font-medium">Semana</th>
                  <th className="pb-3 pr-4 font-medium">Performance</th>
                  <th className="pb-3 pr-4 font-medium">Evidencia</th>
                  <th className="pb-3 font-medium">Acao</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {teamMetrics.map((metric) => (
                  <tr key={metric.id}>
                    <td className="py-3 pr-4">{formatWeek(metric.week_start, metric.week_end)}</td>
                    <td className="py-3 pr-4">{metric.performance_percentage}%</td>
                    <td className="py-3 pr-4">
                      <EvidenceLink url={metric.evidence_url} />
                    </td>
                    <td className="py-3">
                      <button
                        className="danger-button"
                        disabled={saving}
                        type="button"
                        onClick={() => onDeleteTeamMetric(metric)}
                      >
                        Excluir
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {!teamMetrics.length && <EmptyState text="Nenhuma performance de equipe registrada." />}
          </div>
        </div>
      </div>
    </section>
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

function GoalsView({
  goals,
  goalForm,
  editingGoalId,
  saving,
  onGoalChange,
  onGoalSubmit,
  onEditGoal,
  onCancelEdit,
}: {
  goals: Goal[]
  goalForm: typeof initialGoalForm
  editingGoalId: string | null
  saving: boolean
  onGoalChange: (form: typeof initialGoalForm) => void
  onGoalSubmit: (event: React.FormEvent<HTMLFormElement>) => void
  onEditGoal: (goal: Goal) => void
  onCancelEdit: () => void
}) {
  return (
    <div className="mt-8 grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
      <section className="panel">
        <h2 className="section-title">
          {editingGoalId ? 'Editar meta' : 'Selecione uma meta'}
        </h2>
        <p className="section-subtitle">
          Ajuste metas gerais da operacao sem alterar codigo ou rodar query.
        </p>

        <form className="mt-5 grid gap-4" onSubmit={onGoalSubmit}>
          <Field label="Nome da meta">
            <input
              className="form-input"
              disabled={!editingGoalId}
              value={goalForm.label}
              onChange={(event) => onGoalChange({ ...goalForm, label: event.target.value })}
              required
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Valor">
              <input
                className="form-input"
                disabled={!editingGoalId}
                min="0"
                step="0.01"
                type="number"
                value={goalForm.value}
                onChange={(event) => onGoalChange({ ...goalForm, value: event.target.value })}
                required
              />
            </Field>

            <Field label="Unidade">
              <select
                className="form-input"
                disabled={!editingGoalId}
                value={goalForm.unit}
                onChange={(event) => onGoalChange({ ...goalForm, unit: event.target.value })}
              >
                <option value="percent">Percentual</option>
                <option value="number">Numero</option>
              </select>
            </Field>
          </div>

          <label className="flex items-center gap-3 text-sm text-slate-300">
            <input
              checked={goalForm.active}
              disabled={!editingGoalId}
              type="checkbox"
              onChange={(event) => onGoalChange({ ...goalForm, active: event.target.checked })}
            />
            Meta ativa
          </label>

          <div className="flex flex-wrap gap-3">
            <button className="primary-button" disabled={!editingGoalId || saving} type="submit">
              {saving ? 'Salvando...' : 'Salvar meta'}
            </button>

            {editingGoalId && (
              <button className="secondary-button" type="button" onClick={onCancelEdit}>
                Cancelar
              </button>
            )}
          </div>
        </form>
      </section>

      <section className="panel">
        <h2 className="section-title">Metas configuradas</h2>
        <p className="section-subtitle">
          O CSAT individual fica no cadastro de cada analista; aqui ficam metas da operacao.
        </p>

        <div className="mt-5 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-slate-400">
              <tr>
                <th className="pb-3 pr-4 font-medium">Meta</th>
                <th className="pb-3 pr-4 font-medium">Valor</th>
                <th className="pb-3 pr-4 font-medium">Status</th>
                <th className="pb-3 font-medium">Acao</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {goals.map((goal) => (
                <tr key={goal.id}>
                  <td className="py-3 pr-4">{goal.label}</td>
                  <td className="py-3 pr-4">
                    {goal.value}
                    {goal.unit === 'percent' ? '%' : ''}
                  </td>
                  <td className="py-3 pr-4">
                    <span className={goal.active ? 'text-emerald-300' : 'text-slate-400'}>
                      {goal.active ? 'Ativa' : 'Inativa'}
                    </span>
                  </td>
                  <td className="py-3">
                    <button className="small-button" type="button" onClick={() => onEditGoal(goal)}>
                      Editar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {!goals.length && <EmptyState text="Nenhuma meta cadastrada." />}
        </div>
      </section>
    </div>
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

function TrendLineChart({
  label,
  points,
  suffix = '',
}: {
  label: string
  points: ChartPoint[]
  suffix?: string
}) {
  const path = buildLinePath(points)
  const latest = points.at(-1)?.value ?? 0

  return (
    <div className="rounded-lg bg-slate-900 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-slate-400">{label}</p>
          <p className="mt-1 text-2xl font-semibold">
            {latest}
            {suffix}
          </p>
        </div>
      </div>

      {points.length ? (
        <svg className="mt-4 h-36 w-full" role="img" viewBox="0 0 320 130">
          <title>{label}</title>
          <path d="M20 110 H310" stroke="rgb(51 65 85)" strokeWidth="1" />
          <path d="M20 15 V110" stroke="rgb(51 65 85)" strokeWidth="1" />
          <path d={path} fill="none" stroke="rgb(103 232 249)" strokeWidth="3" />
          {points.map((point, index) => {
            const { x, y } = getPointPosition(point.value, index, points)
            return (
              <g key={`${point.label}-${index}`}>
                <circle cx={x} cy={y} fill="rgb(103 232 249)" r="4" />
                <text fill="rgb(203 213 225)" fontSize="10" textAnchor="middle" x={x} y="126">
                  {point.label}
                </text>
              </g>
            )
          })}
        </svg>
      ) : (
        <EmptyState text="Sem dados suficientes para o grafico." />
      )}
    </div>
  )
}

function BarTrend({
  label,
  points,
}: {
  label: string
  points: ChartPoint[]
}) {
  const maxValue = Math.max(...points.map((point) => point.value), 1)

  return (
    <div className="rounded-lg bg-slate-900 p-4">
      <p className="text-sm text-slate-400">{label}</p>
      <div className="mt-4 space-y-3">
        {points.map((point) => (
          <div key={point.label} className="grid grid-cols-[72px_1fr_42px] items-center gap-3 text-sm">
            <span className="text-slate-400">{point.label}</span>
            <div className="h-3 rounded-full bg-slate-800">
              <div
                className="h-3 rounded-full bg-cyan-300"
                style={{ width: `${Math.max((point.value / maxValue) * 100, 4)}%` }}
              />
            </div>
            <strong className="text-right">{point.value}</strong>
          </div>
        ))}
        {!points.length && <EmptyState text="Sem dados suficientes para o grafico." />}
      </div>
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

function EvidenceLink({ url }: { url: string | null }) {
  if (!url) return <span className="text-slate-500">Sem arquivo</span>

  return (
    <a className="text-cyan-300 hover:text-cyan-200" href={url} rel="noreferrer" target="_blank">
      Abrir
    </a>
  )
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

function formatShortDate(value: string) {
  if (!value) return '-'
  const [, month, day] = value.split('-')
  return `${day}/${month}`
}

function aggregateIndividualByWeek(metrics: IndividualMetric[]): WeeklyIndividualTrend[] {
  const grouped = new Map<
    string,
    {
      weekStart: string
      csatTotal: number
      count: number
      totalReviews: number
      totalTickets: number
    }
  >()

  metrics.forEach((metric) => {
    const current = grouped.get(metric.week_start) ?? {
      weekStart: metric.week_start,
      csatTotal: 0,
      count: 0,
      totalReviews: 0,
      totalTickets: 0,
    }

    current.csatTotal += Number(metric.csat)
    current.count += 1
    current.totalReviews += Number(metric.total_reviews)
    current.totalTickets += Number(metric.total_tickets)
    grouped.set(metric.week_start, current)
  })

  return [...grouped.values()]
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
    .map((week) => ({
      label: formatShortDate(week.weekStart),
      csat: round(week.csatTotal / week.count),
      totalReviews: week.totalReviews,
      totalTickets: week.totalTickets,
    }))
}

function buildPeriodPodium(
  metrics: IndividualMetric[],
  analysts: Analyst[],
  podiumCsatGoal: number,
  reviewGoal: number,
): MonthlyPodiumResult[] {
  const activeAnalysts = analysts.filter((analyst) => analyst.active)
  const activeAnalystIds = new Set(activeAnalysts.map((analyst) => analyst.id))
  const periodMetrics = metrics.filter((metric) => activeAnalystIds.has(metric.analyst_id))
  const grouped = new Map<
    string,
    {
      csatWeightedTotal: number
      csatSimpleTotal: number
      csatSimpleCount: number
      totalReviews: number
      totalTickets: number
    }
  >()

  periodMetrics.forEach((metric) => {
    const current = grouped.get(metric.analyst_id) ?? {
      csatWeightedTotal: 0,
      csatSimpleTotal: 0,
      csatSimpleCount: 0,
      totalReviews: 0,
      totalTickets: 0,
    }
    const totalReviews = Number(metric.total_reviews)
    const csat = Number(metric.csat)

    current.csatWeightedTotal += csat * totalReviews
    current.csatSimpleTotal += csat
    current.csatSimpleCount += 1
    current.totalReviews += totalReviews
    current.totalTickets += Number(metric.total_tickets)
    grouped.set(metric.analyst_id, current)
  })

  const analystsWithMetrics = activeAnalysts
    .map((analyst) => {
      const metric = grouped.get(analyst.id)
      if (!metric) return null

      const averageTickets =
        grouped.size > 0
          ? [...grouped.values()].reduce((sum, item) => sum + item.totalTickets, 0) / grouped.size
          : 0
      const averageCsat =
        metric.totalReviews > 0
          ? metric.csatWeightedTotal / metric.totalReviews
          : metric.csatSimpleTotal / metric.csatSimpleCount
      const reviewPercentage =
        metric.totalTickets > 0 ? (metric.totalReviews / metric.totalTickets) * 100 : 0
      const individualGoal = Number(analyst.csat_goal)
      const reasons: string[] = []

      if (averageCsat < individualGoal) reasons.push('abaixo da meta individual')
      if (averageCsat < podiumCsatGoal) reasons.push('abaixo do podio')
      if (reviewPercentage < reviewGoal) reasons.push('avaliacoes abaixo da meta')
      if (metric.totalTickets < averageTickets) reasons.push('atendimentos abaixo da media')

      return {
        analystId: analyst.id,
        analystName: analyst.name,
        averageCsat: round(averageCsat),
        totalReviews: metric.totalReviews,
        totalTickets: metric.totalTickets,
        reviewPercentage: round(reviewPercentage),
        individualGoal,
        eligible: reasons.length === 0,
        reasons,
      }
    })
    .filter((item): item is MonthlyPodiumResult => Boolean(item))

  return analystsWithMetrics.sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1
    if (b.averageCsat !== a.averageCsat) return b.averageCsat - a.averageCsat
    if (b.reviewPercentage !== a.reviewPercentage) return b.reviewPercentage - a.reviewPercentage
    if (b.totalTickets !== a.totalTickets) return b.totalTickets - a.totalTickets
    return a.analystName.localeCompare(b.analystName)
  })
}

function getGoalValue(goals: Goal[], key: string, fallback: number) {
  const normalizedKey = key.toLowerCase()
  const goal = goals.find((item) => item.active && item.key.toLowerCase() === normalizedKey)

  if (goal) return Number(goal.value)

  const labelSearch = normalizedKey.includes('review') ? 'avalia' : 'podio'
  const matchingLabel = goals.find(
    (item) => item.active && item.label.toLowerCase().includes(labelSearch),
  )

  return matchingLabel ? Number(matchingLabel.value) : fallback
}

function getTeamPerformanceGoal(goals: Goal[]) {
  const goal = goals.find((item) => {
    const key = item.key.toLowerCase()
    const label = item.label.toLowerCase()

    return (
      item.active &&
      (key.includes('performance') ||
        key.includes('team') ||
        label.includes('desempenho') ||
        label.includes('performance'))
    )
  })

  return goal ? Number(goal.value) : 96
}

function createPeriodFilter(mode: PeriodMode): PeriodFilter {
  const now = new Date()
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth()

  if (mode === 'week') {
    const start = startOfBusinessWeek(now)
    const end = addDays(start, 4)

    return {
      mode,
      start: toDateInputValue(start),
      end: toDateInputValue(end),
    }
  }

  if (mode === 'year') {
    return {
      mode,
      start: `${currentYear}-01-01`,
      end: `${currentYear}-12-31`,
    }
  }

  const start = new Date(currentYear, currentMonth, 1)
  const end = new Date(currentYear, currentMonth + 1, 0)

  return {
    mode,
    start: toDateInputValue(start),
    end: toDateInputValue(end),
  }
}

function filterIndividualMetricsByPeriod(metrics: IndividualMetric[], period: PeriodFilter) {
  return metrics.filter((metric) => isMetricInPeriod(metric.week_start, metric.week_end, period))
}

function filterTeamMetricsByPeriod(metrics: TeamMetric[], period: PeriodFilter) {
  return metrics.filter((metric) => isMetricInPeriod(metric.week_start, metric.week_end, period))
}

function isMetricInPeriod(weekStart: string, weekEnd: string, period: PeriodFilter) {
  if (!period.start || !period.end) return true

  return weekStart <= period.end && weekEnd >= period.start
}

function calculateAverageCsat(metrics: IndividualMetric[]) {
  if (!metrics.length) return 0

  const reviewTotal = metrics.reduce((sum, metric) => sum + Number(metric.total_reviews), 0)

  if (reviewTotal > 0) {
    const weightedTotal = metrics.reduce(
      (sum, metric) => sum + Number(metric.csat) * Number(metric.total_reviews),
      0,
    )

    return round(weightedTotal / reviewTotal)
  }

  const total = metrics.reduce((sum, metric) => sum + Number(metric.csat), 0)
  return round(total / metrics.length)
}

function getPeriodModeLabel(mode: PeriodMode) {
  const labels: Record<PeriodMode, string> = {
    week: 'Semana',
    month: 'Mes',
    year: 'Ano',
    custom: 'Personalizado',
  }

  return labels[mode]
}

function formatPeriodLabel(period: PeriodFilter) {
  if (!period.start || !period.end) return 'todo o historico'
  return `${formatDate(period.start)} a ${formatDate(period.end)}`
}

function startOfBusinessWeek(date: Date) {
  const start = new Date(date)
  const day = start.getDay()
  const diff = day === 0 ? -6 : 1 - day
  start.setDate(start.getDate() + diff)

  return start
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)

  return next
}

function toDateInputValue(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function getPointPosition(value: number, index: number, points: ChartPoint[]) {
  const values = points.map((point) => point.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const x = points.length === 1 ? 165 : 20 + (index / (points.length - 1)) * 290
  const y = 110 - ((value - min) / range) * 88

  return { x, y }
}

function buildLinePath(points: ChartPoint[]) {
  if (!points.length) return ''

  return points
    .map((point, index) => {
      const { x, y } = getPointPosition(point.value, index, points)
      return `${index === 0 ? 'M' : 'L'} ${x} ${y}`
    })
    .join(' ')
}

function toNumber(value: string) {
  return Number(value || 0)
}

function round(value: number) {
  return Math.round(value * 100) / 100
}

function upsertAnalyst(analysts: Analyst[], updatedAnalyst: Analyst) {
  const exists = analysts.some((analyst) => analyst.id === updatedAnalyst.id)

  if (!exists) return [...analysts, updatedAnalyst].sort((a, b) => a.name.localeCompare(b.name))

  return analysts.map((analyst) =>
    analyst.id === updatedAnalyst.id ? updatedAnalyst : analyst,
  )
}

function upsertGoal(goals: Goal[], updatedGoal: Goal) {
  return goals
    .map((goal) => (goal.id === updatedGoal.id ? updatedGoal : goal))
    .sort((a, b) => a.label.localeCompare(b.label))
}

function withTimeout<T>(promise: PromiseLike<T>, message: string, timeoutMs = 10000) {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      window.setTimeout(() => reject(new Error(message)), timeoutMs)
    }),
  ])
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  return 'Nao foi possivel concluir a acao. Tente novamente.'
}
