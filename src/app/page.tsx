'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
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

type UserRole = 'master' | 'coordinator' | 'analyst'

type UserProfile = {
  id: string
  role?: string | null
  full_name?: string | null
  name?: string | null
  analyst_id?: string | null
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

type ChatTeam = {
  id: string
  name: string
  legacy_name: string | null
  manager_name: string | null
  active: boolean
}

type ChatAnalyst = {
  id: string
  team_id: string
  name: string
  csat_goal: number
  active: boolean
}

type ChatMetricImportRecord = {
  team_id: string
  analyst_id: string
  month_label: string
  year: number
  month_number: number
  period_start: string
  period_end: string
  csat: number
  review_percentage: number
  sending_percentage: number
  total_tickets: number
  inactive_tickets: number
  valid_tickets: number
  reviews: number
  positive_reviews: number
  negative_reviews: number
  csat_goal: number
  csat_delta: number
  general_review_goal: number
  status: string
}

type ChatPodiumManual = {
  id: string
  team_id: string
  analyst_id: string
  year: number
  month_number: number
  position: number
}

type ChatPodiumExclusion = {
  id: string
  team_id: string
  analyst_id: string
  year: number
  month_number: number
  reason: string | null
}

type ChatMonthlyMetric = {
  id: string
  team_id: string
  analyst_id: string
  month_label: string
  year: number
  month_number: number
  period_start: string
  period_end: string
  csat: number
  review_percentage: number
  sending_percentage: number
  total_tickets: number
  inactive_tickets: number
  valid_tickets: number
  reviews: number
  positive_reviews: number
  negative_reviews: number
  csat_goal: number
  csat_delta: number
  general_review_goal: number
  status: string | null
  chat_analysts?:
    | {
        name: string
        csat_goal: number
      }
    | {
        name: string
        csat_goal: number
      }[]
    | null
  chat_teams?:
    | {
        name: string
      }
    | {
        name: string
      }[]
    | null
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

type PhonePodiumRankingRow = {
  position: number
  analyst_id: string
  analyst_name: string
  average_csat: number
  total_reviews: number
  total_tickets: number
  review_percentage: number
  individual_goal: number
  eligible: boolean
  reasons: string[] | null
}
type PeriodMode = 'week' | 'month' | 'year' | 'custom'

type PeriodFilter = {
  mode: PeriodMode
  start: string
  end: string
}

type AppModule = 'phone' | 'chat'

type ChatFeedbackStyle = 'coach' | 'sare' | 'mimo'

type ActiveTab = 'dashboard' | 'reports' | 'analysts' | 'goals' | 'entries'

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
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [goals, setGoals] = useState<Goal[]>([])
  const [analysts, setAnalysts] = useState<Analyst[]>([])
  const [individualMetrics, setIndividualMetrics] = useState<IndividualMetric[]>([])
  const [teamMetrics, setTeamMetrics] = useState<TeamMetric[]>([])
  const [chatTeams, setChatTeams] = useState<ChatTeam[]>([])
  const [chatAnalysts, setChatAnalysts] = useState<ChatAnalyst[]>([])
  const [chatMonthlyMetrics, setChatMonthlyMetrics] = useState<ChatMonthlyMetric[]>([])
  const [chatPodiumManual, setChatPodiumManual] = useState<ChatPodiumManual[]>([])
  const [chatPodiumExclusions, setChatPodiumExclusions] = useState<ChatPodiumExclusion[]>([])
  const [activeModule, setActiveModule] = useState<AppModule>('phone')
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
    if (!user) return

    setLoading(true)
    setMessage('')

    const [profileResult, goalsResult, analystsResult] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', user.id).maybeSingle(),
      supabase.from('goals').select('id, key, label, value, unit, active').order('label'),
      supabase.from('analysts').select('id, name, active, csat_goal').order('name'),
    ])

    const loadedProfile = (profileResult.data as UserProfile | null) ?? null
    const loadedAnalysts = analystsResult.data ?? []
    const loadedRole = normalizeUserRole(loadedProfile?.role)
    const loadedProfileAnalystId = getProfileAnalystId(loadedProfile, loadedAnalysts, user.email ?? '')

    if (profileResult.error) setMessage(getSupabaseMessage(profileResult.error.message))
    else setProfile(loadedProfile)

    if (goalsResult.error) setMessage(getSupabaseMessage(goalsResult.error.message))
    else setGoals((goalsResult.data ?? []).filter((goal) => goal.key !== 'individual_csat'))

    if (analystsResult.error) setMessage(getSupabaseMessage(analystsResult.error.message))
    else {
      const activeAnalysts = loadedAnalysts.filter((analyst) => analyst.active)
      setAnalysts(loadedAnalysts)
      setIndividualForm((current) => ({
        ...current,
        analystId: current.analystId || activeAnalysts[0]?.id || '',
      }))
    }

    let individualQuery = supabase
      .from('weekly_individual_metrics')
      .select('id, analyst_id, week_start, week_end, csat, total_reviews, positive_reviews, negative_reviews, review_percentage, total_tickets, evidence_url, notes, analysts(name)')
      .order('week_start', { ascending: false })
      .limit(52)

    if (loadedRole === 'analyst') {
      if (loadedProfileAnalystId) individualQuery = individualQuery.eq('analyst_id', loadedProfileAnalystId)
      else individualQuery = individualQuery.eq('analyst_id', '00000000-0000-0000-0000-000000000000')
    }

    const [individualResult, teamResult] = await Promise.all([
      individualQuery,
      supabase
        .from('weekly_team_metrics')
        .select('id, week_start, week_end, answered_calls, abandoned_calls, total_calls, performance_percentage, evidence_url, notes')
        .order('week_start', { ascending: false })
        .limit(52),
    ])

    if (individualResult.error) setMessage(getSupabaseMessage(individualResult.error.message))
    else setIndividualMetrics((individualResult.data ?? []) as IndividualMetric[])

    if (teamResult.error) setMessage(getSupabaseMessage(teamResult.error.message))
    else setTeamMetrics(teamResult.data ?? [])

    const [chatTeamsResult, chatAnalystsResult, chatMetricsResult, chatManualPodiumResult, chatExclusionsResult] = await Promise.all([
      supabase.from('chat_teams').select('id, name, legacy_name, manager_name, active').order('name'),
      supabase.from('chat_analysts').select('id, team_id, name, csat_goal, active').order('name'),
      supabase
        .from('chat_monthly_metrics')
        .select('id, team_id, analyst_id, month_label, year, month_number, period_start, period_end, csat, review_percentage, sending_percentage, total_tickets, inactive_tickets, valid_tickets, reviews, positive_reviews, negative_reviews, csat_goal, csat_delta, general_review_goal, status, chat_analysts(name, csat_goal), chat_teams(name)')
        .order('period_start', { ascending: false })
        .limit(500),
      supabase
        .from('chat_podium_manual')
        .select('id, team_id, analyst_id, year, month_number, position')
        .order('year', { ascending: false }),
      supabase
        .from('chat_podium_exclusions')
        .select('id, team_id, analyst_id, year, month_number, reason')
        .order('year', { ascending: false }),
    ])

    if (chatTeamsResult.error) setMessage(getSupabaseMessage(chatTeamsResult.error.message))
    else setChatTeams((chatTeamsResult.data ?? []) as ChatTeam[])

    if (chatAnalystsResult.error) setMessage(getSupabaseMessage(chatAnalystsResult.error.message))
    else setChatAnalysts((chatAnalystsResult.data ?? []) as ChatAnalyst[])

    if (chatMetricsResult.error) setMessage(getSupabaseMessage(chatMetricsResult.error.message))
    else setChatMonthlyMetrics((chatMetricsResult.data ?? []) as ChatMonthlyMetric[])

    if (chatManualPodiumResult.error) setChatPodiumManual([])
    else setChatPodiumManual((chatManualPodiumResult.data ?? []) as ChatPodiumManual[])

    if (chatExclusionsResult.error) setChatPodiumExclusions([])
    else setChatPodiumExclusions((chatExclusionsResult.data ?? []) as ChatPodiumExclusion[])

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
  const userRole = normalizeUserRole(profile?.role)
  const isManagementUser = userRole !== 'analyst'
  const profileAnalyst = useMemo(
    () => findProfileAnalyst(profile, analysts, user?.email ?? ''),
    [profile, analysts, user?.email],
  )
  const profileAnalystId = useMemo(
    () => getProfileAnalystId(profile, analysts, user?.email ?? ''),
    [profile, analysts, user?.email],
  )
  const analystFallback = useMemo(
    () => createProfileAnalystFallback(profile, profileAnalystId, user?.email ?? ''),
    [profile, profileAnalystId, user?.email],
  )
  const currentProfileAnalyst = profileAnalyst ?? analystFallback
  const visibleAnalysts = useMemo(
    () => (isManagementUser ? analysts : currentProfileAnalyst ? [currentProfileAnalyst] : []),
    [isManagementUser, analysts, currentProfileAnalyst],
  )
  const visibleActiveAnalysts = useMemo(
    () => visibleAnalysts.filter((analyst) => analyst.active),
    [visibleAnalysts],
  )
  const visibleIndividualMetrics = useMemo(
    () =>
      isManagementUser
        ? individualMetrics
        : individualMetrics.filter((metric) => metric.analyst_id === profileAnalystId),
    [isManagementUser, individualMetrics, profileAnalystId],
  )

  useEffect(() => {
    if (isManagementUser) return
    if (!['dashboard', 'reports'].includes(activeTab)) setActiveTab('dashboard')
  }, [activeTab, isManagementUser])

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

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || window.location.origin

    const { error } = await supabase.auth.resetPasswordForEmail(trimmedEmail, {
      redirectTo: appUrl,
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
    setProfile(null)
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
    setMessage('')

    try {
      const positiveReviews = toNumber(individualForm.positiveReviews)
      const negativeReviews = toNumber(individualForm.negativeReviews)
      const totalReviews = positiveReviews + negativeReviews
      const totalTickets = toNumber(individualForm.totalTickets)

      if (isEndBeforeStart(individualForm.weekStart, individualForm.weekEnd)) {
        setMessage('A data final nao pode ser menor que a data inicial.')
        return
      }

      if (totalReviews > totalTickets) {
        setMessage('O total de avaliacoes nao pode ser maior que o total de atendimentos.')
        return
      }

      const alreadyExists = individualMetrics.some(
        (metric) =>
          metric.analyst_id === individualForm.analystId &&
          metric.week_start === individualForm.weekStart &&
          metric.week_end === individualForm.weekEnd,
      )

      if (alreadyExists) {
        setMessage('Ja existe lancamento para este analista neste mesmo periodo.')
        return
      }

      setSaving(true)

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
    setMessage('')

    try {
      const answeredCalls = toNumber(teamForm.answeredCalls)
      const abandonedCalls = toNumber(teamForm.abandonedCalls)
      const totalCalls = toNumber(teamForm.totalCalls)

      if (isEndBeforeStart(teamForm.weekStart, teamForm.weekEnd)) {
        setMessage('A data final nao pode ser menor que a data inicial.')
        return
      }

      if (answeredCalls > totalCalls) {
        setMessage('Ligacoes atendidas nao pode ser maior que o total processado.')
        return
      }

      const alreadyExists = teamMetrics.some(
        (metric) =>
          metric.week_start === teamForm.weekStart &&
          metric.week_end === teamForm.weekEnd,
      )

      if (alreadyExists) {
        setMessage('Ja existe performance da equipe neste mesmo periodo.')
        return
      }

      setSaving(true)

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
            Central de Performance
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
              Central de Performance
            </p>
            <h1 className="mt-3 text-3xl font-bold sm:text-4xl">
              Gestao de Performance de Atendimento
            </h1>
            <p className="mt-3 max-w-3xl text-slate-300">
              Painel interno para acompanhar metas, analistas, lancamentos semanais,
              performance da equipe e proximas analises com IA.
            </p>
            <p className="mt-3 text-sm text-slate-400">
              Perfil: <strong>{getRoleLabel(userRole)}</strong>
              {!isManagementUser && currentProfileAnalyst && (
                <span> | Analista: <strong>{currentProfileAnalyst.name}</strong></span>
              )}
            </p>
            {!isManagementUser && !currentProfileAnalyst && (
              <p className="mt-2 text-sm text-amber-200">
                Perfil de analista sem vinculo com cadastro. Peca ao gestor para revisar o usuario.
              </p>
            )}
          </div>

          <button className="secondary-button self-start" onClick={handleLogout}>
            Sair
          </button>
        </header>

        <div className="mt-6 grid gap-3 md:grid-cols-2">
          <button
            className={activeModule === 'phone' ? 'module-card-active' : 'module-card'}
            type="button"
            onClick={() => {
              setActiveModule('phone')
              setActiveTab('dashboard')
            }}
          >
            <span>Modulo telefone</span>
            <strong>Performance de atendimento</strong>
            <small>Dashboard, lancamentos, metas, podio, SARE e IA preditiva.</small>
          </button>
          <button
            className={activeModule === 'chat' ? 'module-card-active' : 'module-card'}
            type="button"
            onClick={() => setActiveModule('chat')}
          >
            <span>Modulo chat</span>
            <strong>Performance de atendimento via chat</strong>
            <small>Dados do Zendesk, importacao mensal, ranking, podio e relatorios individuais.</small>
          </button>
        </div>
        {activeModule === 'phone' && (
          <nav className="mt-6 flex flex-wrap gap-2">
          <TabButton active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')}>
            Dashboard
          </TabButton>
          <TabButton active={activeTab === 'reports'} onClick={() => setActiveTab('reports')}>
            Relatorios
          </TabButton>
          {isManagementUser && (
            <>
              <TabButton active={activeTab === 'entries'} onClick={() => setActiveTab('entries')}>
                Lancamentos
              </TabButton>
              <TabButton active={activeTab === 'analysts'} onClick={() => setActiveTab('analysts')}>
                Analistas
              </TabButton>
              <TabButton active={activeTab === 'goals'} onClick={() => setActiveTab('goals')}>
                Metas
              </TabButton>
            </>
          )}
          </nav>
        )}

        {message && <Feedback message={message} />}

        {activeModule === 'chat' && (
          <ChatModuleDashboard
            role={userRole}
            teams={chatTeams}
            analysts={chatAnalysts}
            metrics={chatMonthlyMetrics}
            manualPodium={chatPodiumManual}
            podiumExclusions={chatPodiumExclusions}
            loading={loading}
            onImportComplete={loadData}
          />
        )}

        {activeModule === 'phone' && activeTab === 'dashboard' && (
          <DashboardView
            analystsCount={visibleActiveAnalysts.length}
            analysts={visibleAnalysts}
            goals={goals}
            individualMetrics={visibleIndividualMetrics}
            teamMetrics={teamMetrics}
            loading={loading}
            role={userRole}
          />
        )}

        {activeModule === 'phone' && activeTab === 'reports' && (
          <ReportsView
            analysts={visibleAnalysts}
            goals={goals}
            individualMetrics={visibleIndividualMetrics}
            teamMetrics={teamMetrics}
            role={userRole}
          />
        )}

        {activeModule === 'phone' && isManagementUser && activeTab === 'entries' && (
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

        {activeModule === 'phone' && isManagementUser && activeTab === 'analysts' && (
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

        {activeModule === 'phone' && isManagementUser && activeTab === 'goals' && (
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

function ChatModuleDashboard({
  role,
  teams,
  analysts,
  metrics,
  manualPodium,
  podiumExclusions,
  loading,
  onImportComplete,
}: {
  role: UserRole
  teams: ChatTeam[]
  analysts: ChatAnalyst[]
  metrics: ChatMonthlyMetric[]
  manualPodium: ChatPodiumManual[]
  podiumExclusions: ChatPodiumExclusion[]
  loading: boolean
  onImportComplete: () => Promise<void>
}) {
  const isManagementUser = role !== 'analyst'
  const periods = useMemo(() => {
    const map = new Map<string, { label: string; year: number; monthNumber: number; start: string }>()
    metrics.forEach((metric) => {
      const key = `${metric.year}-${metric.month_number}`
      if (!map.has(key)) {
        map.set(key, {
          label: metric.month_label,
          year: metric.year,
          monthNumber: metric.month_number,
          start: metric.period_start,
        })
      }
    })
    return [...map.values()].sort((a, b) => b.start.localeCompare(a.start))
  }, [metrics])
  const [selectedTeamId, setSelectedTeamId] = useState('all')
  const [selectedPeriodKey, setSelectedPeriodKey] = useState('')
  const [chatImportYear, setChatImportYear] = useState(String(new Date().getFullYear()))
  const [chatImportMonth, setChatImportMonth] = useState(String(new Date().getMonth() + 1))
  const [chatSatisfactionFile, setChatSatisfactionFile] = useState<File | null>(null)
  const [chatInactiveFile, setChatInactiveFile] = useState<File | null>(null)
  const [chatImportSaving, setChatImportSaving] = useState(false)
  const [chatImportMessage, setChatImportMessage] = useState('')
  const [chatExportMessage, setChatExportMessage] = useState('')
  const [chatFeedbackStyle, setChatFeedbackStyle] = useState<ChatFeedbackStyle>('coach')
  const [chatManagerNotes, setChatManagerNotes] = useState('')
  const [chatFeedbackDraft, setChatFeedbackDraft] = useState('')
  const [selectedChatReportMetricId, setSelectedChatReportMetricId] = useState('')
  const [chatActiveTab, setChatActiveTab] = useState<'overview' | 'podium' | 'analysis' | 'reports' | 'import' | 'settings' | 'base'>('overview')
  const [manualPodiumDraft, setManualPodiumDraft] = useState<Record<number, string>>({})
  const [chatPodiumMessage, setChatPodiumMessage] = useState('')
  const [chatAnalystForm, setChatAnalystForm] = useState({ teamId: '', name: '', csatGoal: '86' })
  const [editingChatAnalystId, setEditingChatAnalystId] = useState<string | null>(null)
  const [chatAnalystSaving, setChatAnalystSaving] = useState(false)
  const [chatAnalystMessage, setChatAnalystMessage] = useState('')
  async function handleChatMonthlyImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setChatImportMessage('')

    if (!chatSatisfactionFile || !chatInactiveFile) {
      setChatImportMessage('Selecione a planilha de satisfacao e a planilha de inativos antes de importar.')
      return
    }

    const year = Number(chatImportYear)
    const monthNumber = Number(chatImportMonth)

    if (!year || !monthNumber || monthNumber < 1 || monthNumber > 12) {
      setChatImportMessage('Informe um mes e ano validos para a importacao.')
      return
    }

    setChatImportSaving(true)

    try {
      const [satisfactionRows, inactiveRows] = await Promise.all([
        readSheetRows(chatSatisfactionFile),
        readSheetRows(chatInactiveFile),
      ])
      const period = getChatMonthPeriod(year, monthNumber)
      const importRows = buildChatMetricRowsFromSheets({
        satisfactionRows,
        inactiveRows,
        analysts,
        year,
        monthNumber,
        monthLabel: period.label,
        periodStart: period.start,
        periodEnd: period.end,
      })

      if (!importRows.length) {
        setChatImportMessage('Nenhum analista do cadastro foi encontrado nos arquivos selecionados.')
        return
      }

      const { error } = await supabase.from('chat_monthly_metrics').upsert(importRows, {
        onConflict: 'team_id,analyst_id,year,month_number',
      })

      if (error) throw error

      await onImportComplete()
      setSelectedPeriodKey(`${year}-${monthNumber}`)
      setChatImportMessage(`Importacao concluida: ${importRows.length} analistas processados para ${period.label}.`)
    } catch (error) {
      setChatImportMessage(getErrorMessage(error))
    } finally {
      setChatImportSaving(false)
    }
  }

  useEffect(() => {
    if (!selectedPeriodKey && periods[0]) {
      setSelectedPeriodKey(`${periods[0].year}-${periods[0].monthNumber}`)
    }
  }, [periods, selectedPeriodKey])
  useEffect(() => {
    if (!chatAnalystForm.teamId && teams[0]) {
      setChatAnalystForm((current) => ({ ...current, teamId: teams[0].id }))
    }
  }, [teams, chatAnalystForm.teamId])

  if (!isManagementUser) {
    return (
      <div className="mt-8 space-y-7">

      <section className="panel">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-cyan-300">Modulo chat</p>
          <h2 className="mt-3 text-3xl font-bold">Acesso restrito a gestao</h2>
          <p className="mt-3 max-w-3xl text-slate-300">
            O modulo chat sera usado para importacao mensal, calculos consolidados, ranking, podio e relatorios individuais.
          </p>
        </section>
      </div>
    )
  }

  const selectedPeriod = periods.find((period) => `${period.year}-${period.monthNumber}` === selectedPeriodKey) ?? periods[0]
  const visibleMetrics = metrics.filter((metric) => {
    const matchesTeam = selectedTeamId === 'all' || metric.team_id === selectedTeamId
    const matchesPeriod = selectedPeriod
      ? metric.year === selectedPeriod.year && metric.month_number === selectedPeriod.monthNumber
      : true
    return matchesTeam && matchesPeriod
  })
  const trendMetrics = metrics.filter((metric) => selectedTeamId === 'all' || metric.team_id === selectedTeamId)
  const selectedTeamName =
    selectedTeamId === 'all' ? 'Todas as equipes' : teams.find((team) => team.id === selectedTeamId)?.name ?? 'Equipe'
  const totals = visibleMetrics.reduce(
    (acc, metric) => ({
      tickets: acc.tickets + Number(metric.total_tickets),
      validTickets: acc.validTickets + Number(metric.valid_tickets),
      reviews: acc.reviews + Number(metric.reviews),
      positives: acc.positives + Number(metric.positive_reviews),
      negatives: acc.negatives + Number(metric.negative_reviews),
      inactive: acc.inactive + Number(metric.inactive_tickets),
    }),
    { tickets: 0, validTickets: 0, reviews: 0, positives: 0, negatives: 0, inactive: 0 },
  )
  const averageTickets = visibleMetrics.length ? round(totals.tickets / visibleMetrics.length) : 0
  const averageCsat = calculateChatAverage(visibleMetrics, 'csat')
  const averageReviews = calculateChatAverage(visibleMetrics, 'review_percentage')
  const averageSending = calculateChatAverage(visibleMetrics, 'sending_percentage')
  const previousPeriodIndex = selectedPeriod
    ? periods.findIndex((period) => period.year === selectedPeriod.year && period.monthNumber === selectedPeriod.monthNumber)
    : -1
  const previousPeriod = previousPeriodIndex >= 0 ? periods[previousPeriodIndex + 1] : undefined
  const previousMetrics = metrics.filter((metric) => {
    const matchesTeam = selectedTeamId === 'all' || metric.team_id === selectedTeamId
    const matchesPeriod = previousPeriod
      ? metric.year === previousPeriod.year && metric.month_number === previousPeriod.monthNumber
      : false
    return matchesTeam && matchesPeriod
  })
  const previousAverageCsat = calculateChatAverage(previousMetrics, 'csat')
  const previousAverageReviews = calculateChatAverage(previousMetrics, 'review_percentage')
  const previousAverageSending = calculateChatAverage(previousMetrics, 'sending_percentage')
  const chatCsatDelta = round(averageCsat - previousAverageCsat)
  const chatReviewDelta = round(averageReviews - previousAverageReviews)
  const chatSendingDelta = round(averageSending - previousAverageSending)
  const activeManualPodium = manualPodium
    .filter((item) => {
      const matchesTeam = selectedTeamId !== 'all' && item.team_id === selectedTeamId
      const matchesPeriod = selectedPeriod
        ? item.year === selectedPeriod.year && item.month_number === selectedPeriod.monthNumber
        : true

      return matchesTeam && matchesPeriod
    })
    .sort((a, b) => a.position - b.position)
  const manualPodiumMetrics = activeManualPodium
    .map((manual) => visibleMetrics.find((metric) => metric.analyst_id === manual.analyst_id) ?? null)
    .filter((metric): metric is ChatMonthlyMetric => Boolean(metric))

  const activePodiumExclusions = podiumExclusions.filter((exclusion) => {
    const matchesTeam = selectedTeamId === 'all' || exclusion.team_id === selectedTeamId
    const matchesPeriod = selectedPeriod
      ? exclusion.year === selectedPeriod.year && exclusion.month_number === selectedPeriod.monthNumber
      : true

    return matchesTeam && matchesPeriod
  })
  const excludedChatAnalystIds = new Set(activePodiumExclusions.map((exclusion) => exclusion.analyst_id))
  const chatRanking = buildChatRanking(visibleMetrics, averageTickets, excludedChatAnalystIds)
  const automaticPodium = chatRanking.filter((item) => item.eligible).slice(0, 3).map((item) => item.metric)
  const podium = [1, 2, 3].map((position, index) => {
    const manual = activeManualPodium.find((item) => item.position === position)
    return manual
      ? visibleMetrics.find((metric) => metric.analyst_id === manual.analyst_id) ?? automaticPodium[index] ?? null
      : automaticPodium[index] ?? null
  })
  const attention = visibleMetrics
    .map((metric) => ({ metric, reasons: getChatAttentionReasons(metric, averageTickets) }))
    .filter((item) => item.reasons.length)
    .sort((a, b) => Number(a.metric.csat) - Number(b.metric.csat))
    .slice(0, 5)
  const monthlyTrend = buildChatMonthlyTrend(trendMetrics).slice(-7)
  const monthlyUnifiedTrend = buildChatMonthlyUnifiedTrend(trendMetrics).slice(-7)
  const chatGoalsReachedCount = visibleMetrics.filter(
    (metric) => Number(metric.csat) >= Number(metric.csat_goal) && Number(metric.review_percentage) >= Number(metric.general_review_goal),
  ).length
  const chatCriticalCount = visibleMetrics.filter((metric) => metric.status === 'Critico').length
  const chatTopPerformers = chatRanking
    .filter((item) => item.eligible || (Number(item.metric.csat) >= Number(item.metric.csat_goal) && Number(item.metric.review_percentage) >= 25))
    .slice(0, 5)
  const chatOpportunities = visibleMetrics
    .map((metric) => ({
      metric,
      reasons: getChatAttentionReasons(metric, averageTickets),
      csatDelta: round(Number(metric.csat) - Number(metric.csat_goal)),
      reviewDelta: round(Number(metric.review_percentage) - Number(metric.general_review_goal)),
      sendingDelta: round(Number(metric.sending_percentage) - 80),
    }))
    .filter((item) => item.reasons.length || item.csatDelta < 0 || item.reviewDelta < 0 || item.sendingDelta < 0)
    .sort((a, b) => {
      if (b.reasons.length !== a.reasons.length) return b.reasons.length - a.reasons.length
      if (a.csatDelta !== b.csatDelta) return a.csatDelta - b.csatDelta
      return Number(a.metric.csat) - Number(b.metric.csat)
    })
    .slice(0, 6)
  const selectedChatReportMetric =
    visibleMetrics.find((metric) => metric.id === selectedChatReportMetricId) ?? visibleMetrics[0] ?? null
  const selectedChatRankingItem = selectedChatReportMetric
    ? chatRanking.find((item) => item.metric.id === selectedChatReportMetric.id)
    : null
  const selectedChatPodiumPosition = selectedChatReportMetric
    ? podium.findIndex((metric) => metric?.analyst_id === selectedChatReportMetric.analyst_id) + 1
    : 0
  const chatReportFeedbackSuggestion = selectedChatReportMetric
    ? buildChatFeedbackText({
        metric: selectedChatReportMetric,
        averageTickets,
        podiumPosition: selectedChatPodiumPosition,
        style: chatFeedbackStyle,
        managerNotes: chatManagerNotes,
      })
    : ''
  const chatExecutiveStatus =
    !visibleMetrics.length
      ? 'Sem dados no periodo'
      : averageCsat >= 90 && averageReviews >= 25
        ? 'Operacao saudavel'
        : averageCsat < 85 || averageReviews < 20 || attention.length >= 3
          ? 'Acompanhamento prioritario'
          : 'Periodo em atencao'
  const chatExecutiveTone =
    !visibleMetrics.length
      ? 'text-slate-300'
      : averageCsat >= 90 && averageReviews >= 25
        ? 'text-emerald-300'
        : averageCsat < 85 || averageReviews < 20 || attention.length >= 3
          ? 'text-rose-300'
          : 'text-amber-300'
  const chatMainAlert =
    !visibleMetrics.length
      ? 'Selecione outro periodo ou aguarde a importacao mensal.'
      : averageCsat < 85
        ? 'A qualidade do atendimento tem espaco para evolucao.'
        : averageCsat < 90
          ? 'CSAT abaixo da referencia de podio do chat.'
          : averageReviews < 20
            ? 'A participacao dos clientes nas pesquisas precisa ser ampliada.'
            : averageReviews < 25
              ? 'Avaliacoes abaixo do minimo usado para elegibilidade ao podio.'
              : attention.length
                ? 'Ha analistas com pelo menos um criterio fora da referencia.'
                : 'Equipe alinhada com os criterios principais do periodo.'

  const chatRecommendedAction =
    !visibleMetrics.length
      ? 'Importar ou selecionar um mes com dados.'
      : averageCsat < 90
        ? 'Revisar atendimentos negativos e direcionar feedback dos analistas em atencao.'
        : averageReviews < 25
          ? 'Reforcar convite para avaliacao e acompanhar volume de respostas no proximo ciclo.'
          : attention.length
            ? 'Priorizar os analistas listados em atencao antes do proximo fechamento.'
            : 'Manter rotina atual e acompanhar se o resultado se sustenta no mes seguinte.'

    function resetChatAnalystForm() {
    setEditingChatAnalystId(null)
    setChatAnalystForm({ teamId: teams[0]?.id ?? '', name: '', csatGoal: '86' })
  }

  async function handleChatAnalystSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setChatAnalystMessage('')

    const name = chatAnalystForm.name.trim()
    const csatGoal = Number(chatAnalystForm.csatGoal)

    if (!chatAnalystForm.teamId) {
      setChatAnalystMessage('Selecione uma equipe antes de salvar o analista.')
      return
    }

    if (!name) {
      setChatAnalystMessage('Informe o nome do analista.')
      return
    }

    if (Number.isNaN(csatGoal) || csatGoal < 0 || csatGoal > 100) {
      setChatAnalystMessage('Informe uma meta CSAT entre 0 e 100.')
      return
    }

    setChatAnalystSaving(true)

    try {
      const payload = {
        team_id: chatAnalystForm.teamId,
        name,
        csat_goal: csatGoal,
      }

      const { error } = editingChatAnalystId
        ? await supabase.from('chat_analysts').update(payload).eq('id', editingChatAnalystId)
        : await supabase.from('chat_analysts').insert({ ...payload, active: true })

      if (error) throw error

      if (editingChatAnalystId) {
        await syncChatMetricGoalsForAnalyst(editingChatAnalystId, csatGoal)
      }

      await onImportComplete()
      resetChatAnalystForm()
      setChatAnalystMessage(editingChatAnalystId ? 'Analista atualizado com sucesso.' : 'Analista incluido com sucesso.')
    } catch (error) {
      setChatAnalystMessage(getErrorMessage(error))
    } finally {
      setChatAnalystSaving(false)
    }
  }

  async function syncChatMetricGoalsForAnalyst(analystId: string, csatGoal: number) {
    const { data, error } = await supabase
      .from('chat_monthly_metrics')
      .select('id, csat, review_percentage')
      .eq('analyst_id', analystId)

    if (error) throw error

    const updates = (data ?? []).map((metric) => ({
      id: metric.id,
      csat_goal: csatGoal,
      csat_delta: round(Number(metric.csat) - csatGoal),
      status: getChatMetricStatus(Number(metric.csat), Number(metric.review_percentage), csatGoal, 25),
    }))

    if (!updates.length) return

    const { error: updateError } = await supabase.from('chat_monthly_metrics').upsert(updates)
    if (updateError) throw updateError
  }
  function handleEditChatAnalyst(analyst: ChatAnalyst) {
    setEditingChatAnalystId(analyst.id)
    setChatAnalystForm({
      teamId: analyst.team_id,
      name: analyst.name,
      csatGoal: String(analyst.csat_goal),
    })
    setChatAnalystMessage('')
  }

  async function handleToggleChatAnalyst(analyst: ChatAnalyst) {
    setChatAnalystMessage('')
    setChatAnalystSaving(true)

    try {
      const { error } = await supabase
        .from('chat_analysts')
        .update({ active: !analyst.active })
        .eq('id', analyst.id)

      if (error) throw error

      await onImportComplete()
      if (editingChatAnalystId === analyst.id) resetChatAnalystForm()
      setChatAnalystMessage(analyst.active ? 'Analista inativado com sucesso.' : 'Analista reativado com sucesso.')
    } catch (error) {
      setChatAnalystMessage(getErrorMessage(error))
    } finally {
      setChatAnalystSaving(false)
    }
  }

  async function handleDeleteChatAnalyst(analyst: ChatAnalyst) {
    setChatAnalystMessage('')

    const confirmed = window.confirm(
      `Excluir ${analyst.name}? Use exclusao apenas para cadastros criados por engano. Se houver historico importado, prefira inativar.`,
    )

    if (!confirmed) return

    setChatAnalystSaving(true)

    try {
      const { error } = await supabase.from('chat_analysts').delete().eq('id', analyst.id)

      if (error) throw error

      await onImportComplete()
      if (editingChatAnalystId === analyst.id) resetChatAnalystForm()
      setChatAnalystMessage('Analista excluido com sucesso.')
    } catch (error) {
      setChatAnalystMessage(`${getErrorMessage(error)} Se este analista ja tiver historico, inative em vez de excluir.`)
    } finally {
      setChatAnalystSaving(false)
    }
  }
  function getChatPodiumExclusion(metric: ChatMonthlyMetric) {
    return activePodiumExclusions.find(
      (exclusion) =>
        exclusion.analyst_id === metric.analyst_id &&
        exclusion.team_id === metric.team_id &&
        exclusion.year === metric.year &&
        exclusion.month_number === metric.month_number,
    )
  }

  function getManualPodiumDraftValue(position: number) {
    return manualPodiumDraft[position] ?? activeManualPodium.find((item) => item.position === position)?.analyst_id ?? ''
  }
  async function handleSaveChatManualPodium() {
    setChatPodiumMessage('')

    if (!selectedPeriod) {
      setChatPodiumMessage('Selecione um periodo antes de salvar o podio manual.')
      return
    }

    if (selectedTeamId === 'all') {
      setChatPodiumMessage('Selecione uma equipe especifica para salvar o podio manual.')
      return
    }

    const rows = [1, 2, 3]
      .map((position) => {
        const analystId = getManualPodiumDraftValue(position)
        return analystId
          ? {
              team_id: selectedTeamId,
              analyst_id: analystId,
              year: selectedPeriod.year,
              month_number: selectedPeriod.monthNumber,
              position,
            }
          : null
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row))

    if (!rows.length) {
      setChatPodiumMessage('Selecione pelo menos um analista para salvar o podio manual.')
      return
    }

    if (new Set(rows.map((row) => row.analyst_id)).size !== rows.length) {
      setChatPodiumMessage('O mesmo analista nao pode ocupar mais de uma posicao.')
      return
    }

    try {
      const deleteResult = await supabase
        .from('chat_podium_manual')
        .delete()
        .eq('team_id', selectedTeamId)
        .eq('year', selectedPeriod.year)
        .eq('month_number', selectedPeriod.monthNumber)

      if (deleteResult.error) throw deleteResult.error

      const { error } = await supabase.from('chat_podium_manual').insert(rows)

      if (error) throw error

      await onImportComplete()
      setChatPodiumMessage('Podio manual salvo para este periodo.')
    } catch (error) {
      setChatPodiumMessage(`Erro ao salvar podio manual: ${getErrorMessage(error)}`)
    }
  }

  async function handleResetChatManualPodium() {
    setChatPodiumMessage('')

    if (!selectedPeriod || selectedTeamId === 'all') {
      setChatPodiumMessage('Selecione uma equipe especifica para resetar o podio manual.')
      return
    }

    try {
      const { error } = await supabase
        .from('chat_podium_manual')
        .delete()
        .eq('team_id', selectedTeamId)
        .eq('year', selectedPeriod.year)
        .eq('month_number', selectedPeriod.monthNumber)

      if (error) throw error

      setManualPodiumDraft({})
      await onImportComplete()
      setChatPodiumMessage('Podio manual removido. O ranking automatico voltou a valer.')
    } catch (error) {
      setChatPodiumMessage(getErrorMessage(error))
    }
  }

  async function handleToggleChatPodiumExclusion(metric: ChatMonthlyMetric) {
    setChatExportMessage('')

    const currentExclusion = getChatPodiumExclusion(metric)

    try {
      if (currentExclusion) {
        const { error } = await supabase.from('chat_podium_exclusions').delete().eq('id', currentExclusion.id)
        if (error) throw error
        setChatExportMessage(`${getChatAnalystName(metric)} voltou a concorrer ao podio deste periodo.`)
      } else {
        const reason = window.prompt(
          `Motivo para tirar ${getChatAnalystName(metric)} do podio deste periodo:`,
          'Emprestimo para outro setor / volume atipico',
        )

        if (reason === null) return

        const { error } = await supabase.from('chat_podium_exclusions').upsert(
          {
            team_id: metric.team_id,
            analyst_id: metric.analyst_id,
            year: metric.year,
            month_number: metric.month_number,
            reason: reason.trim() || 'Excecao operacional',
          },
          { onConflict: 'team_id,analyst_id,year,month_number' },
        )
        if (error) throw error
        setChatExportMessage(`${getChatAnalystName(metric)} ficou fora do podio deste periodo por excecao operacional.`)
      }

      await onImportComplete()
    } catch (error) {
      setChatExportMessage(getErrorMessage(error))
    }
  }

  function handleGenerateChatFeedbackDraft() {
    if (!selectedChatReportMetric) {
      setChatExportMessage('Selecione um analista com dados antes de gerar o feedback.')
      return
    }

    setChatFeedbackDraft(chatReportFeedbackSuggestion)
    setChatExportMessage('Sugestao de feedback gerada. Revise o texto antes de exportar.')
  }

  function handleExportChatIndividualReport() {
    if (!selectedChatReportMetric) {
      setChatExportMessage('Selecione um analista com dados antes de exportar o relatorio individual.')
      return
    }

    try {
      const finalFeedbackText = (chatFeedbackDraft || chatReportFeedbackSuggestion).trim()
      const fileName = exportChatIndividualReport({
        metric: selectedChatReportMetric,
        periodLabel: selectedPeriod?.label ?? 'Periodo',
        averageTickets,
        podiumPosition: selectedChatPodiumPosition,
        monthlyHistory: metrics
          .filter((historyMetric) => historyMetric.analyst_id === selectedChatReportMetric.analyst_id)
          .sort((a, b) => (a.year === b.year ? a.month_number - b.month_number : a.year - b.year)),
        feedbackStyle: chatFeedbackStyle,
        managerNotes: chatManagerNotes,
        feedbackText: finalFeedbackText,
      })

      setChatExportMessage(`Relatorio individual gerado: ${fileName}. Verifique a pasta Downloads.`)
    } catch {
      setChatExportMessage('Nao foi possivel gerar o relatorio individual. Tente novamente ou use outro navegador.')
    }
  }

  return (
    <div className="mt-8 space-y-7">
      <section className="panel">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-cyan-300">Modulo chat</p>
            <h2 className="mt-3 text-3xl font-bold">Performance mensal do chat</h2>
            <p className="section-subtitle">
              Leitura consolidada dos dados historicos e das importacoes mensais do Zendesk.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Equipe">
              <select className="form-input" value={selectedTeamId} onChange={(event) => setSelectedTeamId(event.target.value)}>
                <option value="all">Todas as equipes</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Periodo">
              <select className="form-input" value={selectedPeriodKey} onChange={(event) => setSelectedPeriodKey(event.target.value)}>
                {periods.map((period) => (
                  <option key={`${period.year}-${period.monthNumber}`} value={`${period.year}-${period.monthNumber}`}>
                    {period.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </div>
      </section>

      <nav className="tab-row">
        <TabButton active={chatActiveTab === 'overview'} onClick={() => setChatActiveTab('overview')}>
          Painel
        </TabButton>
        <TabButton active={chatActiveTab === 'podium'} onClick={() => setChatActiveTab('podium')}>
          Ranking e podio
        </TabButton>
        <TabButton active={chatActiveTab === 'analysis'} onClick={() => setChatActiveTab('analysis')}>
          Analise
        </TabButton>
        <TabButton active={chatActiveTab === 'reports'} onClick={() => setChatActiveTab('reports')}>
          Relatorios
        </TabButton>
        <TabButton active={chatActiveTab === 'import'} onClick={() => setChatActiveTab('import')}>
          Importacao
        </TabButton>
        <TabButton active={chatActiveTab === 'settings'} onClick={() => setChatActiveTab('settings')}>
          Cadastros
        </TabButton>
        <TabButton active={chatActiveTab === 'base'} onClick={() => setChatActiveTab('base')}>
          Base importada
        </TabButton>
      </nav>

      <section className={chatActiveTab === 'import' ? 'panel' : 'hidden'}>
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-cyan-300">Importacao mensal</p>
            <h3 className="mt-2 text-2xl font-bold">Atualizar base do chat</h3>
            <p className="section-subtitle">
              Use as planilhas de satisfacao e inatividade baixadas do Zendesk. O calculo segue a regra original do painel do chat.
            </p>
          </div>

          <form className="grid flex-1 gap-3 md:grid-cols-5" onSubmit={handleChatMonthlyImport}>
            <Field label="Mes">
              <select className="form-input" value={chatImportMonth} onChange={(event) => setChatImportMonth(event.target.value)}>
                {chatMonthOptions.map((month) => (
                  <option key={month.value} value={month.value}>
                    {month.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Ano">
              <input
                className="form-input"
                min="2020"
                max="2100"
                type="number"
                value={chatImportYear}
                onChange={(event) => setChatImportYear(event.target.value)}
              />
            </Field>
            <Field label="Satisfacao">
              <input
                accept=".xlsx,.xls,.csv,text/csv"
                className="form-input"
                type="file"
                onChange={(event) => setChatSatisfactionFile(event.target.files?.[0] ?? null)}
              />
            </Field>
            <Field label="Inatividade">
              <input
                accept=".xlsx,.xls,.csv,text/csv"
                className="form-input"
                type="file"
                onChange={(event) => setChatInactiveFile(event.target.files?.[0] ?? null)}
              />
            </Field>
            <button className="btn-primary self-end" disabled={chatImportSaving} type="submit">
              {chatImportSaving ? 'Importando...' : 'Importar mes'}
            </button>
          </form>
        </div>

        {chatImportMessage && <p className="mt-4 rounded-md bg-slate-900/70 px-4 py-3 text-sm text-slate-200">{chatImportMessage}</p>}
      </section>
      <div className={chatActiveTab === 'overview' ? 'grid gap-4 md:grid-cols-4' : 'hidden'}>
        <MetricCard label="Equipe" value={selectedTeamName} />
        <MetricCard label="CSAT medio" value={loading ? '...' : `${averageCsat}%`} />
        <MetricCard label="% avaliacoes" value={`${averageReviews}%`} />
        <MetricCard label="Atendimentos" value={totals.tickets} />
      </div>

      <section className={chatActiveTab === 'overview' ? 'panel' : 'hidden'}>
        <div className="flex flex-col gap-6 xl:flex-row xl:items-stretch">
          <div className="xl:w-2/5">
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-cyan-300">Resumo executivo</p>
            <h2 className={`mt-3 text-3xl font-bold ${chatExecutiveTone}`}>{chatExecutiveStatus}</h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              {selectedPeriod?.label ?? 'Periodo'} - {selectedTeamName}. {chatMainAlert}
            </p>
          </div>

          <div className="grid flex-1 gap-4 md:grid-cols-3">
            <div className="executive-card">
              <p>CSAT vs mes anterior</p>
              <strong>{formatDelta(chatCsatDelta, ' p.p.')}</strong>
              <span>Atual: {averageCsat}%</span>
            </div>
            <div className="executive-card">
              <p>Avaliacoes vs mes anterior</p>
              <strong>{formatDelta(chatReviewDelta, ' p.p.')}</strong>
              <span>Atual: {averageReviews}%</span>
            </div>
            <div className="executive-card">
              <p>Envio/sem avaliacao</p>
              <strong>{averageSending}%</strong>
              <span>{formatDelta(chatSendingDelta, ' p.p.')} vs anterior</span>
            </div>
          </div>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          <div className="rounded-lg bg-slate-900 p-4">
            <p className="text-sm text-slate-400">Alerta principal</p>
            <p className="mt-2 font-semibold">{chatMainAlert}</p>
          </div>
          <div className="rounded-lg bg-slate-900 p-4">
            <p className="text-sm text-slate-400">Acao recomendada</p>
            <p className="mt-2 font-semibold">{chatRecommendedAction}</p>
          </div>
          <div className="rounded-lg bg-slate-900 p-4">
            <p className="text-sm text-slate-400">Criterio legado</p>
            <p className="mt-2 font-semibold">CSAT 90%, avaliacoes 25% e volume acima da media.</p>
          </div>
        </div>
      </section>

      <section className={chatActiveTab === 'overview' ? 'panel' : 'hidden'}>
        <div className="grid gap-6 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <h2 className="section-title">Evolucao mensal</h2>
            <p className="section-subtitle">CSAT medio consolidado por mes no filtro selecionado.</p>
            <div className="mt-5">
              <GroupedPercentTrendChart
                points={monthlyUnifiedTrend}
                series={[
                  { key: 'csat', label: 'CSAT', color: 'bg-cyan-300' },
                  { key: 'reviews', label: 'Avaliacoes', color: 'bg-emerald-300' },
                  { key: 'sending', label: 'Envio/sem avaliacao', color: 'bg-amber-300' },
                ]}
              />
            </div>
          </div>
          <div className="rounded-lg bg-slate-900 p-5">
            <h3 className="text-xl font-bold">Resumo operacional</h3>
            <div className="mt-4 space-y-3 text-sm text-slate-300">
              <p>Validos: <strong>{totals.validTickets}</strong></p>
              <p>Inativos: <strong>{totals.inactive}</strong></p>
              <p>Avaliacoes: <strong>{totals.reviews}</strong></p>
              <p>Envio/sem avaliacao medio: <strong>{averageSending}%</strong></p>
              <p>Media por analista: <strong>{averageTickets}</strong></p>
              <p>Metas superadas: <strong>{chatGoalsReachedCount}</strong></p>
              <p>Criticos: <strong>{chatCriticalCount}</strong></p>
            </div>
          </div>
        </div>
      </section>

      <section className={chatActiveTab === 'podium' ? 'panel' : 'hidden'}>
        <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <h2 className="section-title">Podio final do chat</h2>
            <p className="section-subtitle">
              Usa o ranking automatico, mas permite ajuste manual por equipe e periodo quando houver emprestimo, cobertura ou excecao operacional.
            </p>
          </div>
          {activeManualPodium.length > 0 && (
            <span className="rounded-md bg-cyan-400/10 px-3 py-2 text-sm font-semibold text-cyan-200">
              Podio manual ativo
            </span>
          )}
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-3">
          {[0, 1, 2].map((index) => {
            const winner = podium[index]

            return (
              <div key={index} className="rounded-lg bg-slate-900 p-4">
                <p className="text-sm text-slate-400">{index + 1}o lugar</p>
                {winner ? (
                  <>
                    <p className="mt-3 text-lg font-bold">{getChatAnalystName(winner)}</p>
                    <p className="mt-2 text-sm text-slate-300">CSAT {winner.csat}% | {winner.review_percentage}% avaliacoes | {winner.total_tickets} atendimentos</p>
                  </>
                ) : (
                  <p className="mt-3 text-slate-400">Aguardando elegivel</p>
                )}
              </div>
            )
          })}
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto_auto]">
          {[1, 2, 3].map((position) => (
            <Field key={position} label={`${position}o lugar manual`}>
              <select
                className="form-input"
                disabled={selectedTeamId === 'all'}
                value={getManualPodiumDraftValue(position)}
                onChange={(event) => setManualPodiumDraft((current) => ({ ...current, [position]: event.target.value }))}
              >
                <option value="">Automatico</option>
                {visibleMetrics.map((metric) => (
                  <option key={metric.id} value={metric.analyst_id}>
                    {getChatAnalystName(metric)}
                  </option>
                ))}
              </select>
            </Field>
          ))}
          <button className="btn-primary self-end" type="button" onClick={handleSaveChatManualPodium}>
            Salvar podio
          </button>
          <button className="secondary-button self-end" type="button" onClick={handleResetChatManualPodium}>
            Resetar
          </button>
        </div>

        {selectedTeamId === 'all' && (
          <p className="mt-3 text-sm text-slate-400">Para ajustar manualmente, selecione uma equipe especifica no filtro do modulo chat.</p>
        )}
        {chatPodiumMessage && <p className="mt-4 rounded-md bg-slate-900/70 px-4 py-3 text-sm text-slate-200">{chatPodiumMessage}</p>}
      </section>

      <div className={chatActiveTab === 'podium' ? 'grid gap-6 xl:grid-cols-2' : 'hidden'}>
                <section className="panel">
          <h2 className="section-title">Ranking mensal do chat</h2>
          <p className="section-subtitle">Lista final do periodo, do primeiro ao ultimo. Criterios: CSAT minimo 90%, avaliacoes a partir de 25% e volume acima da media do periodo ({averageTickets} atendimentos). Excecoes manuais preservam o historico e apenas removem a elegibilidade ao podio.</p>
          <div className="mt-5 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-slate-400">
                <tr>
                  <th className="pb-3 pr-4 font-medium">Posicao</th>
                  <th className="pb-3 pr-4 font-medium">Analista</th>
                  <th className="pb-3 pr-4 font-medium">CSAT</th>
                  <th className="pb-3 pr-4 font-medium">Avaliacoes</th>
                  <th className="pb-3 pr-4 font-medium">Atendimentos</th>
                  <th className="pb-3 pr-4 font-medium">Status</th>
                  <th className="pb-3 font-medium">Podio</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {chatRanking.map((item, index) => (
                  <tr key={item.metric.id}>
                    <td className="py-3 pr-4 font-bold text-cyan-300">{index + 1}o</td>
                    <td className="py-3 pr-4">{getChatAnalystName(item.metric)}</td>
                    <td className="py-3 pr-4">{item.metric.csat}%</td>
                    <td className="py-3 pr-4">{item.metric.review_percentage}%</td>
                    <td className="py-3 pr-4">{item.metric.total_tickets}</td>
                    <td className="py-3 pr-4">
                      {item.eligible ? (
                        <span className="text-emerald-300">Elegivel</span>
                      ) : (
                        <span className="text-slate-400">{item.reasons.join(', ')}</span>
                      )}
                    </td>
                    <td className="py-3">
                      <button className="small-button" type="button" onClick={() => handleToggleChatPodiumExclusion(item.metric)}>
                        {getChatPodiumExclusion(item.metric) ? 'Permitir' : 'Tirar'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {!chatRanking.length && <EmptyState text="Nenhum dado de chat encontrado neste periodo." />}
          </div>
        </section>

        <section className="panel">
          <h2 className="section-title">Analistas em atencao</h2>
          <p className="section-subtitle">Lista objetiva para orientar acompanhamento mensal.</p>
          <div className="mt-5 space-y-3">
            {attention.length ? (
              attention.map((item) => (
                <div key={item.metric.id} className="rounded-lg bg-slate-900 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold">{getChatAnalystName(item.metric)}</p>
                    <strong className="text-amber-200">{item.metric.csat}%</strong>
                  </div>
                  <p className="mt-2 text-sm text-slate-400">{item.reasons.join(', ')}</p>
                </div>
              ))
            ) : (
              <EmptyState text="Nenhum ponto critico encontrado neste filtro." />
            )}
          </div>
        </section>
      </div>


      <section className={chatActiveTab === 'analysis' ? 'panel' : 'hidden'}>
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-cyan-300">Analise detalhada</p>
          <h2 className="section-title">Leitura por criterios do painel antigo</h2>
          <p className="section-subtitle">
            Mostra delta de CSAT contra a meta individual, delta de avaliacoes contra 25%, envio/sem avaliacao contra 80% e volume contra a media do periodo.
          </p>
        </div>

        <div className="mt-5 grid gap-6 xl:grid-cols-2">
          <div className="rounded-lg bg-slate-900 p-5">
            <h3 className="text-xl font-bold">Top performers</h3>
            <div className="mt-4 space-y-3">
              {chatTopPerformers.length ? (
                chatTopPerformers.map((item, index) => (
                  <div key={item.metric.id} className="rounded-md bg-slate-950/60 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm text-cyan-300">{index + 1}o destaque</p>
                        <p className="mt-1 font-semibold">{getChatAnalystName(item.metric)}</p>
                      </div>
                      <strong>{item.metric.csat}%</strong>
                    </div>
                    <p className="mt-2 text-sm text-slate-400">
                      Avaliacoes {item.metric.review_percentage}%, atendimento {item.metric.total_tickets} e meta CSAT {item.metric.csat_goal}%.
                    </p>
                  </div>
                ))
              ) : (
                <EmptyState text="Ainda nao ha destaque no filtro selecionado." />
              )}
            </div>
          </div>

          <div className="rounded-lg bg-slate-900 p-5">
            <h3 className="text-xl font-bold">Oportunidades</h3>
            <div className="mt-4 space-y-3">
              {chatOpportunities.length ? (
                chatOpportunities.map((item) => (
                  <div key={item.metric.id} className="rounded-md bg-slate-950/60 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-semibold">{getChatAnalystName(item.metric)}</p>
                      <span className="text-sm text-amber-200">{item.metric.status}</span>
                    </div>
                    <p className="mt-2 text-sm text-slate-400">{item.reasons.length ? item.reasons.join(', ') : 'Acompanhar estabilidade dos indicadores.'}</p>
                    <p className="mt-2 text-sm text-slate-300">
                      CSAT {formatDelta(item.csatDelta, ' p.p.')}, avaliacoes {formatDelta(item.reviewDelta, ' p.p.')} e envio {formatDelta(item.sendingDelta, ' p.p.')}.
                    </p>
                  </div>
                ))
              ) : (
                <EmptyState text="Nenhuma oportunidade critica encontrada neste periodo." />
              )}
            </div>
          </div>
        </div>

        <div className="mt-6 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-slate-400">
              <tr>
                <th className="pb-3 pr-4 font-medium">Analista</th>
                <th className="pb-3 pr-4 font-medium">Status</th>
                <th className="pb-3 pr-4 font-medium">CSAT</th>
                <th className="pb-3 pr-4 font-medium">Delta CSAT</th>
                <th className="pb-3 pr-4 font-medium">Avaliacoes</th>
                <th className="pb-3 pr-4 font-medium">Delta aval.</th>
                <th className="pb-3 pr-4 font-medium">Envio</th>
                <th className="pb-3 pr-4 font-medium">Atendimentos</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {chatRanking.map((item) => (
                <tr key={item.metric.id}>
                  <td className="py-3 pr-4 font-semibold">{getChatAnalystName(item.metric)}</td>
                  <td className="py-3 pr-4">{item.metric.status}</td>
                  <td className="py-3 pr-4">{item.metric.csat}%</td>
                  <td className="py-3 pr-4">{formatDelta(round(Number(item.metric.csat) - Number(item.metric.csat_goal)), ' p.p.')}</td>
                  <td className="py-3 pr-4">{item.metric.review_percentage}%</td>
                  <td className="py-3 pr-4">{formatDelta(round(Number(item.metric.review_percentage) - Number(item.metric.general_review_goal)), ' p.p.')}</td>
                  <td className="py-3 pr-4">{item.metric.sending_percentage}%</td>
                  <td className="py-3 pr-4">{item.metric.total_tickets} / media {averageTickets}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!chatRanking.length && <EmptyState text="Nenhum dado para analise neste filtro." />}
        </div>
      </section>
      <section className={chatActiveTab === 'reports' ? 'panel' : 'hidden'}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-cyan-300">Relatorio individual</p>
            <h2 className="section-title">Analise mensal por analista</h2>
            <p className="section-subtitle">
              Gera um documento individual no modelo de fechamento: esperado, atingido, analise tecnica e feedback de performance.
            </p>
          </div>

          <div className="grid flex-1 gap-3 md:grid-cols-2">
            <Field label="Analista">
              <select
                className="form-input"
                value={selectedChatReportMetric?.id ?? ''}
                onChange={(event) => {
                  setSelectedChatReportMetricId(event.target.value)
                  setChatFeedbackDraft('')
                }}
              >
                {visibleMetrics.map((metric) => (
                  <option key={metric.id} value={metric.id}>
                    {getChatAnalystName(metric)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Modelo do feedback">
              <select
                className="form-input"
                value={chatFeedbackStyle}
                onChange={(event) => {
                  setChatFeedbackStyle(event.target.value as ChatFeedbackStyle)
                  setChatFeedbackDraft('')
                }}
              >
                <option value="coach">Coach</option>
                <option value="sare">SARE</option>
                <option value="mimo">MIMO</option>
              </select>
            </Field>
          </div>
        </div>

        <div className="mt-5 grid gap-4">
          <Field label="Observacoes do gestor">
            <textarea
              className="form-input min-h-24"
              value={chatManagerNotes}
              onChange={(event) => setChatManagerNotes(event.target.value)}
              placeholder="Inclua contexto do mes, combinados, pontos de atencao ou reconhecimento para entrar no feedback."
            />
          </Field>

          <div className="grid gap-3 lg:grid-cols-[auto_1fr] lg:items-start">
            <button
              className="btn-secondary disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!selectedChatReportMetric}
              type="button"
              onClick={handleGenerateChatFeedbackDraft}
            >
              Gerar sugestao
            </button>
            <p className="text-sm text-slate-300">
              A sugestao usa os numeros do Zendesk e suas observacoes. O texto final abaixo pode ser ajustado antes do arquivo ser gerado.
            </p>
          </div>

          <Field label="Texto final do feedback">
            <textarea
              className="form-input min-h-56"
              value={chatFeedbackDraft || chatReportFeedbackSuggestion}
              onChange={(event) => setChatFeedbackDraft(event.target.value)}
              placeholder="Gere uma sugestao ou escreva o feedback final do relatorio."
            />
          </Field>

          <button
            className="btn-primary w-fit disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!selectedChatReportMetric}
            type="button"
            onClick={handleExportChatIndividualReport}
          >
            Exportar individual
          </button>
        </div>
      

        {chatExportMessage && <p className="mt-4 rounded-md bg-slate-900/70 px-4 py-3 text-sm text-slate-200">{chatExportMessage}</p>}
      </section>
      
      <section className={chatActiveTab === 'settings' ? 'panel' : 'hidden'}>
        <div className="flex flex-col gap-6 xl:flex-row">
          <div className="xl:w-2/5">
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-cyan-300">Cadastro do chat</p>
            <h2 className="section-title">{editingChatAnalystId ? 'Editar meta do analista' : 'Incluir analista do chat'}</h2>
            <p className="section-subtitle">
              Cadastre analistas por equipe e mantenha a meta individual de CSAT usada nas importacoes e relatorios do chat.
            </p>

            <form className="mt-5 grid gap-4" onSubmit={handleChatAnalystSubmit}>
              <Field label="Equipe">
                <select
                  className="form-input"
                  value={chatAnalystForm.teamId}
                  onChange={(event) => setChatAnalystForm({ ...chatAnalystForm, teamId: event.target.value })}
                  required
                >
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Nome do analista">
                <input
                  className="form-input"
                  value={chatAnalystForm.name}
                  onChange={(event) => setChatAnalystForm({ ...chatAnalystForm, name: event.target.value })}
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
                  value={chatAnalystForm.csatGoal}
                  onChange={(event) => setChatAnalystForm({ ...chatAnalystForm, csatGoal: event.target.value })}
                  required
                />
              </Field>

              <div className="flex flex-wrap gap-3">
                <button className="btn-primary" disabled={chatAnalystSaving} type="submit">
                  {chatAnalystSaving ? 'Salvando...' : editingChatAnalystId ? 'Salvar alteracoes' : 'Incluir analista'}
                </button>

                {editingChatAnalystId && (
                  <button className="secondary-button" type="button" onClick={resetChatAnalystForm}>
                    Cancelar
                  </button>
                )}
              </div>
            </form>

            {chatAnalystMessage && (
              <p className="mt-4 rounded-md bg-slate-900/70 px-4 py-3 text-sm text-slate-200">{chatAnalystMessage}</p>
            )}
          </div>

          <div className="flex-1 overflow-x-auto">
            <h3 className="text-xl font-bold">Analistas e metas cadastradas</h3>
            <p className="section-subtitle">
              Inative para preservar historico. Exclua apenas cadastros criados por engano.
            </p>
            <table className="mt-5 min-w-full text-left text-sm">
              <thead className="text-slate-400">
                <tr>
                  <th className="pb-3 pr-4 font-medium">Analista</th>
                  <th className="pb-3 pr-4 font-medium">Equipe</th>
                  <th className="pb-3 pr-4 font-medium">Meta CSAT</th>
                  <th className="pb-3 pr-4 font-medium">Status</th>
                  <th className="pb-3 font-medium">Acoes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {[...analysts]
                  .sort((a, b) => `${getChatTeamNameById(teams, a.team_id)} ${a.name}`.localeCompare(`${getChatTeamNameById(teams, b.team_id)} ${b.name}`))
                  .map((analyst) => (
                    <tr key={analyst.id}>
                      <td className="py-3 pr-4 font-semibold">{analyst.name}</td>
                      <td className="py-3 pr-4 text-slate-300">{getChatTeamNameById(teams, analyst.team_id)}</td>
                      <td className="py-3 pr-4">{analyst.csat_goal}%</td>
                      <td className="py-3 pr-4">
                        <span className={analyst.active ? 'text-emerald-300' : 'text-slate-400'}>
                          {analyst.active ? 'Ativo' : 'Inativo'}
                        </span>
                      </td>
                      <td className="py-3">
                        <div className="flex flex-wrap gap-2">
                          <button className="small-button" type="button" onClick={() => handleEditChatAnalyst(analyst)}>
                            Editar
                          </button>
                          <button className="small-button" type="button" onClick={() => handleToggleChatAnalyst(analyst)}>
                            {analyst.active ? 'Inativar' : 'Reativar'}
                          </button>
                          <button className="danger-button" type="button" onClick={() => handleDeleteChatAnalyst(analyst)}>
                            Excluir
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>

            {!analysts.length && <EmptyState text="Nenhum analista de chat cadastrado." />}
          </div>
        </div>
      </section>
      <section className={chatActiveTab === 'base' ? 'panel' : 'hidden'}>
        <h2 className="section-title">Base importada</h2>
        <p className="section-subtitle">
          {metrics.length} registros carregados entre historico e importacoes mensais do Zendesk. O % envio avaliacao segue a regra do painel antigo: atendimentos validos sem avaliacao dividido por atendimentos validos. A inatividade e apenas apoio operacional: inativos dividido por atendimentos totais.
        </p>
        <div className="mt-5 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-slate-400">
              <tr>
                <th className="px-3 py-2">Analista</th>
                <th className="px-3 py-2">Equipe</th>
                <th className="px-3 py-2">CSAT</th>
                <th className="px-3 py-2">Avaliacoes</th>
                <th className="px-3 py-2">Atendimentos</th>
                <th className="px-3 py-2">Validos</th>
                <th className="px-3 py-2">Inativos</th>
                <th className="px-3 py-2">% inatividade</th>
                <th className="px-3 py-2">% envio avaliacao</th>
              </tr>
            </thead>
            <tbody>
              {visibleMetrics.map((metric) => (
                <tr key={metric.id} className="border-t border-slate-800">
                  <td className="px-3 py-3 font-semibold">{getChatAnalystName(metric)}</td>
                  <td className="px-3 py-3 text-slate-300">{getChatTeamName(metric)}</td>
                  <td className="px-3 py-3">{metric.csat}%</td>
                  <td className="px-3 py-3">{metric.review_percentage}%</td>
                  <td className="px-3 py-3">{metric.total_tickets}</td>
                  <td className="px-3 py-3">{metric.valid_tickets}</td>
                  <td className="px-3 py-3">{metric.inactive_tickets}</td>
                  <td className="px-3 py-3">{metric.total_tickets ? round((Number(metric.inactive_tickets) / Number(metric.total_tickets)) * 100) : 0}%</td>
                  <td className="px-3 py-3">{metric.sending_percentage}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

function DashboardView({
  analystsCount,
  analysts,
  goals,
  individualMetrics,
  teamMetrics,
  loading,
  role,
}: {
  analystsCount: number
  analysts: Analyst[]
  goals: Goal[]
  individualMetrics: IndividualMetric[]
  teamMetrics: TeamMetric[]
  loading: boolean
  role: UserRole
}) {
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>(() => createPeriodFilter('month'))
  const [phonePodiumRanking, setPhonePodiumRanking] = useState<PhonePodiumRankingRow[]>([])
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
      value: calculateTeamPerformance([metric]),
    }))
  const podiumCsatGoal = getGoalValue(goals, 'podium_csat_minimum', 90)
  const reviewGoal = getGoalValue(goals, 'review_percentage', 25)
  const teamPerformanceGoal = getTeamPerformanceGoal(goals)
  const previousPeriodFilter = getPreviousPeriod(periodFilter)
  const previousIndividualMetrics = filterIndividualMetricsByPeriod(individualMetrics, previousPeriodFilter)
  const previousTeamMetrics = filterTeamMetricsByPeriod(teamMetrics, previousPeriodFilter)
  useEffect(() => {
    let active = true

    async function loadPhonePodiumRanking() {
      const { data, error } = await supabase.rpc('get_phone_podium_ranking', {
        p_start: periodFilter.start,
        p_end: periodFilter.end,
      })

      if (!active) return
      setPhonePodiumRanking(error ? [] : ((data ?? []) as PhonePodiumRankingRow[]))
    }

    loadPhonePodiumRanking()

    return () => {
      active = false
    }
  }, [periodFilter.start, periodFilter.end])
  const periodPodium = buildPeriodPodium(filteredIndividualMetrics, analysts, podiumCsatGoal, reviewGoal)
  const podiumWinners = periodPodium.filter((item) => item.eligible).slice(0, 3)
  const bestPerformer = periodPodium[0] ?? null
  const attentionList = periodPodium.filter((item) => !item.eligible).slice(0, 3)
  const eligibleCount = periodPodium.filter((item) => item.eligible).length
  const periodLabel = formatPeriodLabel(periodFilter)
  const periodAverageCsat = calculateAverageCsat(filteredIndividualMetrics)
  const previousAverageCsat = calculateAverageCsat(previousIndividualMetrics)
  const periodTeamPerformance = calculateTeamPerformance(filteredTeamMetrics)
  const previousTeamPerformance = calculateTeamPerformance(previousTeamMetrics)
  const csatDelta = round(periodAverageCsat - previousAverageCsat)
  const teamPerformanceDelta = round(periodTeamPerformance - previousTeamPerformance)
  const totalReviews = filteredIndividualMetrics.reduce((sum, metric) => sum + Number(metric.total_reviews), 0)
  const totalTickets = filteredIndividualMetrics.reduce((sum, metric) => sum + Number(metric.total_tickets), 0)
  const reviewCoverage = totalTickets ? round((totalReviews / totalTickets) * 100) : 0
  const teamAnsweredCalls = filteredTeamMetrics.reduce((sum, metric) => sum + Number(metric.answered_calls), 0)
  const teamTotalCalls = filteredTeamMetrics.reduce((sum, metric) => sum + Number(metric.total_calls), 0)
  const attentionCount = attentionList.length
  const hasPeriodData = filteredIndividualMetrics.length > 0 || filteredTeamMetrics.length > 0
  const predictiveGoalProbability = calculateGoalProbability({
    hasData: hasPeriodData,
    csat: periodAverageCsat,
    csatGoal: podiumCsatGoal,
    csatDelta,
    teamPerformance: periodTeamPerformance,
    teamPerformanceGoal,
    teamPerformanceDelta,
    reviewCoverage,
    reviewGoal,
    eligibleCount,
    totalAnalysts: periodPodium.length,
  })
  const projectedCsat = projectMetric(periodAverageCsat, csatDelta, podiumCsatGoal)
  const projectedTeamPerformance = projectMetric(periodTeamPerformance, teamPerformanceDelta, teamPerformanceGoal)
  const predictiveRiskLevel = getPredictiveRiskLevel(
    predictiveGoalProbability,
    csatDelta,
    teamPerformanceDelta,
    attentionCount,
  )
  const predictiveAction =
    !hasPeriodData
      ? 'Aguardar novos lancamentos para liberar previsao.'
      : predictiveRiskLevel === 'Alto'
        ? 'Priorizar feedback SARE e acompanhamento semanal dos indicadores criticos.'
        : predictiveRiskLevel === 'Medio'
          ? 'Monitorar variacoes e reforcar os pontos abaixo da meta antes do fechamento.'
          : 'Manter rotina atual e preservar consistencia ate o fechamento.'
  const executiveStatus =
    !hasPeriodData
      ? 'Sem dados no periodo'
      : periodTeamPerformance >= teamPerformanceGoal && periodAverageCsat >= podiumCsatGoal
        ? 'Periodo saudavel'
        : attentionCount
          ? 'Periodo pede acompanhamento'
          : 'Periodo em consolidacao'
  const executiveStatusTone =
    !hasPeriodData
      ? 'text-slate-300'
      : periodTeamPerformance >= teamPerformanceGoal && periodAverageCsat >= podiumCsatGoal
        ? 'text-emerald-300'
        : attentionCount
          ? 'text-amber-300'
          : 'text-cyan-300'
  const executivePriority =
    !hasPeriodData
      ? 'Selecionar outro periodo ou aguardar os lancamentos.'
      : attentionList.length > 0
        ? `Priorizar ${attentionList.map((item) => item.analystName).join(', ')}.`
        : periodTeamPerformance < teamPerformanceGoal
          ? 'Revisar performance operacional da equipe.'
          : 'Manter rotina de acompanhamento semanal.'

  const executiveCriticalPoint =
    !hasPeriodData
      ? 'Sem dados suficientes para diagnostico.'
      : attentionList.length > 0
        ? `${attentionCount} analista(s) abaixo dos criterios de podio.`
        : periodAverageCsat < podiumCsatGoal
          ? `CSAT do periodo abaixo da meta de podio (${podiumCsatGoal}%).`
          : periodTeamPerformance < teamPerformanceGoal
            ? `Performance da equipe abaixo da meta operacional (${teamPerformanceGoal}%).`
            : 'Indicadores principais dentro da faixa esperada.'
  const executiveNextAction =
    !hasPeriodData
      ? 'Conferir se os lancamentos da semana/mes ja foram feitos.'
      : attentionCount
        ? 'Abrir feedback SARE dos analistas em atencao e acompanhar a semana seguinte.'
        : periodTeamPerformance < teamPerformanceGoal
          ? 'Revisar abandonos, escala e gargalos antes do fechamento.'
          : 'Comparar evolucao semanal e preservar a rotina atual.'
  const executiveClosingRead =
    !hasPeriodData
      ? 'Fechamento ainda nao liberado para leitura.'
      : predictiveRiskLevel === 'Alto'
        ? 'Fechamento em risco: agir antes de consolidar o periodo.'
        : predictiveRiskLevel === 'Medio'
          ? 'Fechamento pede monitoramento: ha variacao que pode mudar o resultado.'
          : 'Fechamento favoravel: manter acompanhamento ate concluir o periodo.'

  function handlePeriodModeChange(mode: PeriodMode) {
    setPeriodFilter(createPeriodFilter(mode))
  }
  const isAnalystDashboard = role === 'analyst'
  const analystProfile = isAnalystDashboard ? analysts[0] ?? null : null
  const analystResult = isAnalystDashboard ? periodPodium[0] ?? null : null
  const secureAnalystRanking = isAnalystDashboard ? phonePodiumRanking[0] ?? null : null
  const analystRankingPosition = secureAnalystRanking?.position ?? (analystResult ? periodPodium.findIndex((item) => item.analystId === analystResult.analystId) + 1 : 0)
  const analystStatusText = analystResult
    ? analystResult.eligible
      ? 'Elegivel para o podio'
      : 'Fora do podio neste periodo'
    : 'Sem lancamento no periodo'
  const analystFocusText = analystResult
    ? analystResult.eligible
      ? 'Manter CSAT, volume e percentual de avaliacoes ate o fechamento.'
      : analystResult.reasons.join(', ')
    : 'Selecione outro periodo ou aguarde o lancamento semanal.'
  const analystActionText = analystResult
    ? buildDevelopmentFocus(analystResult, csatDelta)
    : 'Aguardar lancamento do periodo para liberar recomendacao individual.'
  const analystPulseText = analystResult
    ? analystResult.eligible
      ? 'Voce esta dentro da leitura esperada para disputar o podio.'
      : 'Existe pelo menos um ponto objetivo para recuperar antes do fechamento.'
    : 'Ainda nao ha dados individuais para este filtro.'

  return (
    <div className="mt-8 space-y-7">
      <section className="panel">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="section-title">Periodo de analise</h2>
            <p className="section-subtitle">
              {isAnalystDashboard
                ? 'Sua performance, graficos e elegibilidade seguem este filtro.'
                : 'Os cards, graficos, podio e insights abaixo seguem este filtro.'}
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
        {isAnalystDashboard ? (
          <>
            <MetricCard label="Perfil" value="Analista" tone="success" />
            <MetricCard label="Analista" value={analystProfile?.name ?? 'Nao vinculado'} />
            <MetricCard label="Meu CSAT" value={`${analystResult?.averageCsat ?? 0}%`} />
            <MetricCard label="Meta individual" value={`${analystProfile?.csat_goal ?? 0}%`} />
          </>
        ) : (
          <>
            <MetricCard label="Status" value="Supabase conectado" tone="success" />
            <MetricCard label="Analistas ativos" value={loading ? '...' : analystsCount} />
            <MetricCard label="CSAT do periodo" value={`${periodAverageCsat || 0}%`} />
            <MetricCard label="Performance equipe" value={`${periodTeamPerformance || 0}%`} />
          </>
        )}
      </div>

      <section className="panel">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-stretch">
          <div className="xl:w-2/5">
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-cyan-300">
              {isAnalystDashboard ? 'Resumo individual' : 'Resumo executivo'}
            </p>
            <h2 className={`mt-3 text-3xl font-bold ${isAnalystDashboard ? 'text-cyan-300' : executiveStatusTone}`}>
              {isAnalystDashboard ? analystStatusText : executiveStatus}
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              {isAnalystDashboard
                ? analystFocusText
                : `${periodLabel}: ${eligibleCount} de ${periodPodium.length} analistas elegiveis ao podio. ${executivePriority}`}
            </p>
          </div>

          <div className="grid flex-1 gap-4 md:grid-cols-3">
            <div className="executive-card">
              <p>{isAnalystDashboard ? 'Meu CSAT vs periodo anterior' : 'CSAT vs periodo anterior'}</p>
              <strong>{formatDelta(csatDelta, ' p.p.')}</strong>
              <span>Atual: {periodAverageCsat || 0}%</span>
            </div>
            <div className="executive-card">
              <p>Performance equipe</p>
              <strong>{periodTeamPerformance || 0}%</strong>
              <span>{formatDelta(teamPerformanceDelta, ' p.p.')} vs anterior</span>
            </div>
            <div className="executive-card">
              <p>{isAnalystDashboard ? 'Minhas avaliacoes' : 'Cobertura de avaliacoes'}</p>
              <strong>{reviewCoverage}%</strong>
              <span>{totalReviews} avaliacoes em {totalTickets} atendimentos</span>
            </div>
          </div>
        </div>

        {!isAnalystDashboard && (
          <div className="mt-5 grid gap-4 lg:grid-cols-3">            <div className="rounded-lg bg-slate-900 p-4">
              <p className="text-sm text-slate-400">Ponto critico</p>
              <p className="mt-2 font-semibold">{executiveCriticalPoint}</p>
              <p className="mt-2 text-xs leading-5 text-slate-500">{executivePriority}</p>
            </div>
            <div className="rounded-lg bg-slate-900 p-4">
              <p className="text-sm text-slate-400">Acao recomendada</p>
              <p className="mt-2 font-semibold">{executiveNextAction}</p>
            </div>
            <div className="rounded-lg bg-slate-900 p-4">
              <p className="text-sm text-slate-400">Leitura do fechamento</p>
              <p className="mt-2 font-semibold">{executiveClosingRead}</p>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                Volume: {teamAnsweredCalls} atendidas de {teamTotalCalls} processadas.
              </p>
            </div>
          </div>
        )}
      </section>

      <section className="panel">
        <h2 className="section-title">Inteligencia preditiva</h2>
        <p className="section-subtitle">
          Projecao inicial baseada nos lancamentos, metas, variacao contra periodo anterior e risco operacional.
        </p>

        <div className="mt-6 grid gap-4 lg:grid-cols-4">
          <PredictiveCard
            label="Chance de atingir metas"
            value={`${predictiveGoalProbability}%`}
            detail={
              hasPeriodData
                ? `CSAT, performance, avaliacoes e podio combinados. ${eligibleCount} de ${periodPodium.length} elegiveis.`
                : 'Sem base de dados no periodo.'
            }
            tone={predictiveGoalProbability >= 75 ? 'success' : predictiveGoalProbability >= 45 ? 'warning' : 'danger'}
          />
          <PredictiveCard
            label="Previsao CSAT"
            value={`${projectedCsat}%`}
            detail={`${formatDelta(csatDelta, ' p.p.')} vs periodo anterior`}
            tone={projectedCsat >= podiumCsatGoal ? 'success' : 'warning'}
          />
          <PredictiveCard
            label="Previsao performance"
            value={`${projectedTeamPerformance}%`}
            detail={`meta operacional ${teamPerformanceGoal}%`}
            tone={projectedTeamPerformance >= teamPerformanceGoal ? 'success' : 'danger'}
          />
          <PredictiveCard
            label="Risco de queda"
            value={predictiveRiskLevel}
            detail={predictiveAction}
            tone={predictiveRiskLevel === 'Baixo' ? 'success' : predictiveRiskLevel === 'Medio' ? 'warning' : 'danger'}
          />
        </div>

        <div className="mt-5 rounded-lg bg-slate-900 p-5">
          <p className="text-sm font-semibold text-slate-200">Como ler esta previsao</p>
          <div className="mt-3 grid gap-3 text-sm leading-6 text-slate-400 md:grid-cols-2">
            <p>
              A chance de atingir metas combina CSAT do periodo, performance da equipe, cobertura de avaliacoes e
              quantidade de analistas elegiveis ao podio.
            </p>
            <p>
              As previsoes usam o resultado atual e parte da variacao contra o periodo anterior. Quanto mais semanas
              lancadas, mais confiavel fica a leitura.
            </p>
            <p>
              O risco de queda sobe quando CSAT ou performance perdem forca, quando a chance fica abaixo de 75% ou
              quando existem analistas em acompanhamento.
            </p>
            <p>
              Esta leitura e um alerta de gestao: ela ajuda a decidir onde agir antes do fechamento, sem substituir a
              analise do gestor.
            </p>
          </div>
        </div>
      </section>

      <section className="panel">
        <h2 className="section-title">
          {isAnalystDashboard ? 'Minha evolucao recente' : 'Variacoes recentes'}
        </h2>
        <p className="section-subtitle">
          {isAnalystDashboard
            ? `Seu comportamento dentro de ${periodLabel}.`
            : `Evolucao calculada dentro de ${periodLabel}.`}
        </p>

        <div className="mt-6 grid gap-6 xl:grid-cols-3">
          <TrendLineChart
            label={isAnalystDashboard ? 'Meu CSAT semanal' : 'CSAT medio semanal'}
            points={weeklyIndividualTrend.map((item) => ({
              label: item.label,
              value: item.csat,
            }))}
            suffix="%"
          />
          <BarTrend
            label={isAnalystDashboard ? 'Minhas avaliacoes por semana' : 'Avaliacoes por semana'}
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
            <h2 className="section-title">
              {isAnalystDashboard ? 'Minha elegibilidade' : 'Ranking completo do periodo'}
            </h2>
            <p className="section-subtitle">
              {isAnalystDashboard
                ? `Sua leitura no periodo ${periodLabel}: CSAT minimo ${podiumCsatGoal}%, avaliacoes ${reviewGoal}% e atendimentos dentro da media.`
                : `Ranking de ${periodLabel}: CSAT minimo ${podiumCsatGoal}%, avaliacoes ${reviewGoal}% e atendimentos dentro da media da equipe.`}
            </p>
          </div>
        </div>

        {isAnalystDashboard ? (
          <div className="mt-6 grid gap-4 lg:grid-cols-3">
            <div className="rounded-lg bg-slate-900 p-5">
              <p className="text-sm text-slate-400">Status do periodo</p>
              <h3 className={`mt-2 text-2xl font-bold ${analystResult?.eligible ? 'text-emerald-300' : 'text-cyan-300'}`}>
                {analystStatusText}
              </h3>
              <p className="mt-3 text-sm text-slate-400">{analystPulseText}</p>
            </div>

            <div className="rounded-lg bg-slate-900 p-5">
              <p className="text-sm text-slate-400">CSAT e avaliacoes</p>
              <p className="mt-2 text-3xl font-bold text-cyan-300">
                {analystResult?.averageCsat ?? 0}%
              </p>
              <p className="mt-2 text-sm text-slate-400">
                {analystResult?.reviewPercentage ?? 0}% avaliacoes | meta {reviewGoal}%
              </p>
            </div>

            <div className="rounded-lg bg-slate-900 p-5">
              <p className="text-sm text-slate-400">Posicao no ranking</p>
              <p className="mt-2 text-3xl font-bold">{analystRankingPosition ? `${analystRankingPosition}o` : '-'}</p>
              <p className="mt-2 text-sm text-slate-400">
                No filtro semanal, esta e sua posicao parcial; no mensal, mostra a leitura acumulada.
              </p>
            </div>
          </div>
        ) : (
          <>
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
                    <th className="pb-3 pr-4 font-medium">Posicao</th>
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
                      <td className="py-3 pr-4 font-bold text-cyan-300">{periodPodium.findIndex((rankingItem) => rankingItem.analystId === item.analystId) + 1}o</td>
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
          </>
          )}
      </section>

      <section className="panel">
        <h2 className="section-title">
          {isAnalystDashboard ? 'Meus insights do periodo' : 'Insights do periodo'}
        </h2>
        <p className="section-subtitle">
          {isAnalystDashboard
            ? 'Leitura rapida para acompanhar seu desempenho sem abrir historico de lancamentos.'
            : 'Leitura rapida para entender desempenho, riscos e prioridades sem abrir historico de lancamentos.'}
        </p>

        {isAnalystDashboard ? (
          <div className="mt-6 grid gap-4 lg:grid-cols-3">
            <div className="rounded-lg bg-slate-900 p-5">
              <p className="text-sm text-slate-400">Ponto forte</p>
              <p className="mt-2 text-xl font-bold">
                {analystResult && analystResult.averageCsat >= analystResult.individualGoal
                  ? 'CSAT dentro da meta individual'
                  : 'Acompanhar CSAT individual'}
              </p>
              <p className="mt-2 text-sm text-slate-400">
                Resultado atual: {analystResult?.averageCsat ?? 0}% / meta {analystProfile?.csat_goal ?? 0}%.
              </p>
            </div>

            <div className="rounded-lg bg-slate-900 p-5">
              <p className="text-sm text-slate-400">Ponto de atencao</p>
              <p className="mt-2 text-xl font-bold">
                {analystResult ? analystActionText : 'Sem dados no periodo'}
              </p>
              <p className="mt-2 text-sm text-slate-400">
                Esta recomendacao muda conforme o periodo selecionado no filtro.
              </p>
            </div>

            <div className="rounded-lg bg-slate-900 p-5">
              <p className="text-sm text-slate-400">Equipe no periodo</p>
              <p className="mt-2 text-3xl font-bold text-emerald-300">
                {periodTeamPerformance || 0}%
              </p>
              <p className="mt-2 text-sm text-slate-400">
                Referencia geral da operacao: {teamPerformanceGoal}%.
              </p>
            </div>
          </div>
        ) : (
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
        )}
      </section>
    </div>
  )
}

function ReportsView({
  analysts,
  goals,
  individualMetrics,
  teamMetrics,
  role,
}: {
  analysts: Analyst[]
  goals: Goal[]
  individualMetrics: IndividualMetric[]
  teamMetrics: TeamMetric[]
  role: UserRole
}) {
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>(() => createPeriodFilter('month'))
  const [phonePodiumRanking, setPhonePodiumRanking] = useState<PhonePodiumRankingRow[]>([])
  const [selectedAnalystId, setSelectedAnalystId] = useState('')
  const [exportMessage, setExportMessage] = useState('')
  const isManagementUser = role !== 'analyst'
  const reportAnalysts = useMemo(
    () => (analysts.length ? analysts : buildAnalystsFromMetrics(individualMetrics)),
    [analysts, individualMetrics],
  )

  useEffect(() => {
    if (!reportAnalysts.length) return
    if (!selectedAnalystId || !reportAnalysts.some((analyst) => analyst.id === selectedAnalystId)) {
      setSelectedAnalystId(reportAnalysts[0].id)
    }
  }, [reportAnalysts, selectedAnalystId])

  const selectedAnalyst =
    reportAnalysts.find((analyst) => analyst.id === selectedAnalystId) ?? reportAnalysts[0] ?? null
  const periodLabel = formatPeriodLabel(periodFilter)
  const previousPeriod = getPreviousPeriod(periodFilter)
  const podiumCsatGoal = getGoalValue(goals, 'podium_csat_minimum', 90)
  const reviewGoal = getGoalValue(goals, 'review_percentage', 25)
  const teamPerformanceGoal = getTeamPerformanceGoal(goals)
  const periodIndividualMetrics = filterIndividualMetricsByPeriod(individualMetrics, periodFilter)
  const periodTeamMetrics = filterTeamMetricsByPeriod(teamMetrics, periodFilter)
  const analystMetrics = selectedAnalyst
    ? periodIndividualMetrics.filter((metric) => metric.analyst_id === selectedAnalyst.id)
    : []
  const previousAnalystMetrics = selectedAnalyst
    ? filterIndividualMetricsByPeriod(individualMetrics, previousPeriod).filter(
        (metric) => metric.analyst_id === selectedAnalyst.id,
      )
    : []
  const podium = buildPeriodPodium(periodIndividualMetrics, reportAnalysts, podiumCsatGoal, reviewGoal)
  const analystResult = selectedAnalyst
    ? podium.find((item) => item.analystId === selectedAnalyst.id) ?? null
    : null
  const previousCsat = calculateAverageCsat(previousAnalystMetrics)
  const csatDelta = analystResult ? round(analystResult.averageCsat - previousCsat) : 0
  const teamPerformance = calculateTeamPerformance(periodTeamMetrics)
  const teamStatus =
    teamPerformance >= teamPerformanceGoal
      ? 'Operacao dentro da referencia.'
      : 'Operacao abaixo da referencia definida.'
  const selectedRankingPosition = analystResult
    ? podium.findIndex((item) => item.analystId === analystResult.analystId) + 1
    : 0
  const strongestResult = podium[0] ?? null
  const attentionResults = podium.filter((item) => !item.eligible).slice(0, 3)
  const growthResults = podium
    .map((item) => {
      const previous = filterIndividualMetricsByPeriod(individualMetrics, previousPeriod).filter(
        (metric) => metric.analyst_id === item.analystId,
      )

      return {
        ...item,
        delta: round(item.averageCsat - calculateAverageCsat(previous)),
      }
    })
    .sort((a, b) => b.delta - a.delta)
  const bestGrowth = growthResults[0] ?? null
  const riskResults = podium
    .filter((item) => !item.eligible || item.averageCsat < item.individualGoal + 2)
    .slice(0, 3)
  const reviewCount = analystMetrics.reduce((sum, metric) => sum + Number(metric.total_reviews), 0)
  const answeredTickets = analystResult?.totalTickets ?? 0
  const teamAnsweredCalls = periodTeamMetrics.reduce((sum, metric) => sum + Number(metric.answered_calls), 0)
  const teamAbandonedCalls = periodTeamMetrics.reduce((sum, metric) => sum + Number(metric.abandoned_calls), 0)
  const teamTotalCalls = periodTeamMetrics.reduce((sum, metric) => sum + Number(metric.total_calls), 0)
  const teamLossPercentage = teamTotalCalls ? round((teamAbandonedCalls / teamTotalCalls) * 100) : 0
  const weeklyEvolution = aggregateIndividualByWeek(analystMetrics)
  const situationText = selectedAnalyst && analystResult
    ? `${selectedAnalyst.name} fechou ${periodLabel} com CSAT de ${analystResult.averageCsat}%, ${analystResult.totalReviews} avaliacoes e ${analystResult.totalTickets} atendimentos registrados. A meta individual e ${analystResult.individualGoal}% e a referencia para podio e ${podiumCsatGoal}%. A variacao contra o periodo anterior foi de ${formatDelta(csatDelta, ' p.p.')}.`
    : ''
  const actionText = analystResult
    ? analystResult.eligible
      ? 'Foram alinhadas a manutencao das praticas atuais, a preservacao do volume de avaliacoes e o acompanhamento semanal de qualquer oscilacao antes do fechamento do ciclo.'
      : `Foram alinhadas a priorizacao dos pontos: ${analystResult.reasons.join(', ')}. A recomendacao inicial e revisar atendimentos de menor satisfacao, reforcar o convite para avaliacao e acompanhar o indicador semanalmente.`
    : ''
  const resultText = analystResult
    ? analystResult.eligible
      ? `Resultado esperado: manter CSAT acima de ${podiumCsatGoal}%, preservar elegibilidade ao podio e sustentar volume de avaliacoes igual ou superior a ${reviewGoal}% dos atendimentos.`
      : `Resultado esperado: recuperar os pontos impeditivos para aproximar o desempenho da referencia de podio (${podiumCsatGoal}%) e elevar a consistencia do indicador no proximo ciclo.`
    : ''
  const evolutionText = analystResult
    ? `Expectativa e plano de desenvolvimento: ${buildDevelopmentFocus(analystResult, csatDelta)} Perguntas sugeridas para 1:1: o que ajudou ou atrapalhou o CSAT no periodo? quais atendimentos merecem revisao? qual acao simples pode aumentar avaliacoes na proxima semana?`
    : ''
  const feedbackSummary = analystResult
    ? analystResult.eligible
      ? `${selectedAnalyst?.name ?? 'Analista'} esta elegivel ao podio no periodo. O foco recomendado e preservar consistencia, volume de avaliacoes e acompanhamento semanal.`
      : `${selectedAnalyst?.name ?? 'Analista'} ainda nao sustenta elegibilidade ao podio neste periodo. O foco recomendado e atuar sobre: ${analystResult.reasons.join(', ')}.`
    : ''

  const hasSelectedAnalyst = Boolean(selectedAnalyst)
  const hasAnalystLaunch = Boolean(analystResult)
  const hasTeamLaunch = periodTeamMetrics.length > 0
  const reportReady = hasSelectedAnalyst && hasAnalystLaunch
  const reportReadinessItems = [
    {
      label: 'Analista selecionado',
      done: hasSelectedAnalyst,
      detail: selectedAnalyst ? selectedAnalyst.name : 'Selecione um analista para gerar o SARE.',
    },
    {
      label: 'Lancamento individual no periodo',
      done: hasAnalystLaunch,
      detail: hasAnalystLaunch ? 'Dados individuais encontrados.' : 'Nao ha lancamento individual para este filtro.',
    },
    {
      label: 'Desempenho da equipe',
      done: hasTeamLaunch,
      detail: hasTeamLaunch
        ? `${teamPerformance}% de performance no periodo.`
        : 'Sem lancamento de equipe; o relatorio sai, mas a leitura operacional fica incompleta.',
    },
  ]
  function handlePeriodModeChange(mode: PeriodMode) {
    setPeriodFilter(createPeriodFilter(mode))
  }

  function handleExportWordReport() {
    if (!selectedAnalyst || !analystResult) {
      setExportMessage('Selecione um analista e um periodo com lancamento antes de exportar.')
      return
    }

    try {
      const fileName = exportWordReport({
        analystName: selectedAnalyst.name,
        periodLabel,
        expected: {
          csat: podiumCsatGoal,

          review: reviewGoal,
        },
        achieved: {
          csat: analystResult.averageCsat,
          loss: teamLossPercentage,
          summary: feedbackSummary,
          reviewPercentage: analystResult.reviewPercentage,
          reviewCount,
          answeredTickets,
          averageTickets:
            podium.length > 0
              ? round(podium.reduce((sum, item) => sum + item.totalTickets, 0) / podium.length)
              : 0,
          rankingPosition: selectedRankingPosition,
          teamPerformance,
          teamAnsweredCalls,
          teamAbandonedCalls,
          teamTotalCalls,
        },
        sare: {
          situation: situationText,
          action: actionText,
          result: resultText,
          evolution: evolutionText,
        },
        weeklyEvolution,
      })

      setExportMessage(`Relatorio gerado: ${fileName}. Verifique a pasta Downloads.`)
    } catch {
      setExportMessage('Nao foi possivel gerar o arquivo. Tente novamente ou use outro navegador.')
    }
  }

  function handlePrintReport() {
    if (!selectedAnalyst || !analystResult) {
      setExportMessage('Selecione um analista e um periodo com lancamento antes de gerar PDF.')
      return
    }

    setExportMessage('Na janela de impressao, escolha "Salvar como PDF".')
    window.setTimeout(() => window.print(), 120)
  }

  return (
    <div className="mt-8 space-y-7">
      <section className="panel">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="section-title">Relatorios e IA analitica</h2>
            <p className="section-subtitle">
              Primeira camada SARE gerada a partir dos lancamentos do periodo. A API de IA entra na proxima etapa.
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

        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          {isManagementUser && (
            <Field label="Analista">
              <select
                className="form-input"
                value={selectedAnalystId}
                onChange={(event) => setSelectedAnalystId(event.target.value)}
              >
                {reportAnalysts.map((analyst) => (
                  <option key={analyst.id} value={analyst.id}>
                    {analyst.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
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
        <MetricCard label="Analista" value={selectedAnalyst?.name ?? 'Sem analista'} />
        <MetricCard label="CSAT do periodo" value={`${analystResult?.averageCsat ?? 0}%`} />
        <MetricCard label="Variacao vs periodo anterior" value={formatDelta(csatDelta, '%')} />
        <MetricCard label="Performance equipe" value={`${teamPerformance}%`} />
      </div>

      <section className="panel no-print">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="section-title">Prontidao do relatorio</h2>
            <p className="section-subtitle">
              Confira se o SARE deste periodo ja tem base suficiente antes de exportar.
            </p>
          </div>
          <span className={`rounded-full px-4 py-2 text-sm font-semibold ${reportReady ? 'bg-emerald-400/10 text-emerald-300' : 'bg-amber-400/10 text-amber-200'}`}>
            {reportReady ? 'Pronto para exportar' : 'Pendente de dados'}
          </span>
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-3">
          {reportReadinessItems.map((item) => (
            <div key={item.label} className="rounded-lg bg-slate-900 p-4">
              <p className={item.done ? 'text-sm font-semibold text-emerald-300' : 'text-sm font-semibold text-amber-200'}>
                {item.done ? 'OK' : 'Pendente'} - {item.label}
              </p>
              <p className="mt-2 text-sm leading-5 text-slate-400">{item.detail}</p>
            </div>
          ))}
        </div>
      </section>
      <section className="panel print-report">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="hidden print:block text-sm font-bold uppercase tracking-[0.18em] text-cyan-300">
              Central de Performance
            </p>
            <h2 className="section-title">Relatorio mensal SARE</h2>
            <p className="section-subtitle">
              Estrutura correta: Situacao, Alinhamentos Realizados, Resultado Esperado e Expectativa.
            </p>
          </div>

          {selectedAnalyst && (
            <div className="hidden text-right print:block">
              <p className="text-sm text-slate-400">Analista</p>
              <p className="text-lg font-bold">{selectedAnalyst.name}</p>
              <p className="text-sm text-slate-400">{periodLabel}</p>
            </div>
          )}
        </div>

        <div className="no-print mt-4 flex flex-wrap gap-3">
          <button
            className="primary-button disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!selectedAnalyst || !analystResult}
            type="button"
            onClick={handleExportWordReport}
          >
            Exportar relatorio Word
          </button>
          <button
            className="secondary-button disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!selectedAnalyst || !analystResult}
            type="button"
            onClick={handlePrintReport}
          >
            Salvar PDF
          </button>
        </div>
        <div className="no-print">{exportMessage && <Feedback message={exportMessage} />}</div>

        {selectedAnalyst && analystResult ? (
          <div className="mt-6 space-y-5">
            <div className="grid gap-3 md:grid-cols-4">
              <div className="report-summary-card">
                <p>CSAT atual</p>
                <strong>{analystResult.averageCsat}%</strong>
              </div>
              <div className="report-summary-card">
                <p>Variacao</p>
                <strong className={csatDelta >= 0 ? 'text-emerald-300' : 'text-rose-300'}>
                  {formatDelta(csatDelta, ' p.p.')}
                </strong>
              </div>
              <div className="report-summary-card">
                <p>Avaliacoes</p>
                <strong>{analystResult.totalReviews}</strong>
              </div>
              <div className="report-summary-card">
                <p>Podio</p>
                <strong>{selectedRankingPosition || '-'}</strong>
              </div>
            </div>

            {weeklyEvolution.length > 0 && (
              <div className="rounded-lg bg-slate-900 p-5">
                <h3 className="text-lg font-bold">Evolucao visual</h3>
                <p className="mt-1 text-sm text-slate-400">
                  Leitura rapida de melhora, queda ou estabilidade no periodo.
                </p>
                <div className="mt-4 space-y-3">
                  {weeklyEvolution.map((item, index) => {
                    const previous = weeklyEvolution[index - 1]
                    const delta = previous ? round(item.csat - previous.csat) : 0
                    const width = Math.max(8, Math.min(100, item.csat))
                    const barClass =
                      delta > 0 ? 'bg-emerald-400' : delta < 0 ? 'bg-rose-400' : 'bg-cyan-300'

                    return (
                      <div key={item.label} className="report-evolution-row">
                        <span>{item.label}</span>
                        <div className="report-evolution-track">
                          <div className={`report-evolution-bar ${barClass}`} style={{ width: `${width}%` }} />
                        </div>
                        <strong>
                          {item.csat}% <span>{formatDelta(delta, ' p.p.')}</span>
                        </strong>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            <div className="grid gap-4 lg:grid-cols-2">
              <ReportBlock
                title="S - Situacao"
                text={situationText}
              />
              <ReportBlock
                title="A - Alinhamentos Realizados"
                text={actionText}
              />
              <ReportBlock
                title="R - Resultado Esperado"
                text={resultText}
              />
              <ReportBlock
                title="E - Expectativa e Plano de Desenvolvimento"
                text={evolutionText}
              />
            </div>
          </div>
        ) : (
          <EmptyState text="Selecione um analista e um periodo com lancamento individual para liberar a exportacao." />
        )}
      </section>

      <section className="panel">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="section-title">Camadas de IA e plano de acao</h2>
            <p className="section-subtitle">
              Leitura automatica para apoiar feedback, acompanhamento e decisao da lideranca.
            </p>
          </div>
          <div className="rounded-lg bg-slate-900 px-4 py-3 text-sm text-slate-300">
            Periodo analisado: <strong>{periodLabel}</strong>
          </div>
        </div>

        <div className="mt-6 grid gap-4 xl:grid-cols-3">
          <div className="rounded-lg bg-slate-900 p-5">
            <p className="text-sm text-slate-400">IA Coach individual</p>
            <h3 className="mt-2 text-xl font-bold">{selectedAnalyst?.name ?? 'Analista'}</h3>
            <div className="mt-4 space-y-3 text-sm text-slate-300">
              <p>
                <span className="text-slate-500">Leitura: </span>
                {analystResult
                  ? analystResult.eligible
                    ? 'desempenho sustentando elegibilidade ao podio no periodo.'
                    : `desempenho pede ajuste em ${analystResult.reasons.join(', ')}.`
                  : 'aguardando lancamentos no periodo.'}
              </p>
              <p>
                <span className="text-slate-500">Tendencia: </span>
                {getTrendText(csatDelta)}.
              </p>
              <p>
                <span className="text-slate-500">Foco recomendado: </span>
                {analystResult ? buildDevelopmentFocus(analystResult, csatDelta) : 'registrar dados para liberar leitura.'}
              </p>
            </div>
          </div>

          <div className="rounded-lg bg-slate-900 p-5">
            <p className="text-sm text-slate-400">IA Supervisor equipe</p>
            {isManagementUser ? (
              <div className="mt-4 space-y-3 text-sm text-slate-300">
                <p>
                  <span className="text-slate-500">Reconhecer: </span>
                  {strongestResult ? `${strongestResult.analystName}, com ${strongestResult.averageCsat}% de CSAT.` : 'aguardar dados do periodo.'}
                </p>
                <p>
                  <span className="text-slate-500">Acompanhar: </span>
                  {attentionResults.length ? attentionResults.map((item) => item.analystName).join(', ') : 'sem alertas criticos entre os lancamentos atuais.'}
                </p>
                <p>
                  <span className="text-slate-500">Evolucao: </span>
                  {bestGrowth ? `${bestGrowth.analystName} apresenta o melhor movimento comparativo (${formatDelta(bestGrowth.delta, ' p.p.')}).` : 'sem base comparativa suficiente.'}
                </p>
              </div>
            ) : (
              <p className="mt-4 text-sm text-slate-300">
                A visao completa de equipe e exclusiva da gestao. Voce visualiza sua leitura individual e a performance geral compartilhada.
              </p>
            )}
          </div>

          <div className="rounded-lg bg-slate-900 p-5">
            <p className="text-sm text-slate-400">IA Executiva operacao</p>
            <div className="mt-4 space-y-3 text-sm text-slate-300">
              <p>
                <span className="text-slate-500">Performance: </span>
                {teamPerformance}% no periodo, meta {teamPerformanceGoal}%.
              </p>
              <p>
                <span className="text-slate-500">Previsao: </span>
                {teamPerformance >= teamPerformanceGoal
                  ? 'fechamento tende a permanecer dentro da referencia se o volume atual se mantiver.'
                  : 'ha risco de fechamento abaixo da referencia se nao houver recuperacao.'}
              </p>
              <p>
                <span className="text-slate-500">Risco: </span>
                {riskResults.length ? `${riskResults.length} analista(s) pedem acompanhamento no ciclo.` : 'nenhum risco individual evidente no periodo.'}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg bg-slate-900 p-5">
            <p className="text-sm text-slate-400">Roteiro sugerido para 1:1</p>
            <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-slate-300">
              <li>Comecar pela situacao do periodo e confirmar se os numeros refletem a realidade operacional.</li>
              <li>Discutir o principal ponto de variacao: CSAT, avaliacoes ou volume de atendimentos.</li>
              <li>Definir uma acao objetiva para a proxima semana, com comportamento observavel.</li>
              <li>Registrar a expectativa do proximo ciclo e revisar no fechamento seguinte.</li>
            </ol>
          </div>

          <div className="rounded-lg bg-slate-900 p-5">
            <p className="text-sm text-slate-400">{isManagementUser ? 'Fila de acompanhamento' : 'Meu proximo ciclo'}</p>
            {isManagementUser ? (
              riskResults.length ? (
                <div className="mt-4 space-y-3">
                  {riskResults.map((item) => (
                    <div key={item.analystId} className="rounded-md bg-slate-950 p-3">
                      <p className="font-semibold">{item.analystName}</p>
                      <p className="mt-1 text-sm text-slate-400">{item.reasons.join(', ')}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-4 text-sm text-emerald-300">
                  Nenhum analista entrou em fila de acompanhamento neste periodo.
                </p>
              )
            ) : (
              <p className="mt-4 text-sm text-slate-300">
                Acompanhar sua evolucao semanal, proteger o volume de avaliacoes e revisar atendimentos que possam impactar o CSAT.
              </p>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}

function ReportBlock({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-lg bg-slate-900 p-5">
      <h3 className="text-lg font-bold">{title}</h3>
      <p className="mt-3 text-sm leading-6 text-slate-300">{text}</p>
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
  const positiveReviews = toNumber(individualForm.positiveReviews)
  const negativeReviews = toNumber(individualForm.negativeReviews)
  const totalReviews = positiveReviews + negativeReviews
  const totalTickets = toNumber(individualForm.totalTickets)
  const reviewPercentage = totalTickets ? round((totalReviews / totalTickets) * 100) : 0
  const individualDateInvalid = isEndBeforeStart(individualForm.weekStart, individualForm.weekEnd)
  const individualDuplicate = individualMetrics.some(
    (metric) =>
      metric.analyst_id === individualForm.analystId &&
      metric.week_start === individualForm.weekStart &&
      metric.week_end === individualForm.weekEnd,
  )
  const individualReviewsInvalid = totalReviews > totalTickets && totalTickets > 0
  const answeredCalls = toNumber(teamForm.answeredCalls)
  const abandonedCalls = toNumber(teamForm.abandonedCalls)
  const totalCalls = toNumber(teamForm.totalCalls)
  const calculatedPerformance = totalCalls ? round((answeredCalls / totalCalls) * 100) : 0
  const teamDateInvalid = isEndBeforeStart(teamForm.weekStart, teamForm.weekEnd)
  const teamDuplicate = teamMetrics.some(
    (metric) => metric.week_start === teamForm.weekStart && metric.week_end === teamForm.weekEnd,
  )
  const teamAnsweredInvalid = answeredCalls > totalCalls && totalCalls > 0
  const teamTotalMismatch =
    totalCalls > 0 && answeredCalls + abandonedCalls > 0 && answeredCalls + abandonedCalls !== totalCalls
  const checklistStart = individualForm.weekStart || teamForm.weekStart
  const checklistEnd = individualForm.weekEnd || teamForm.weekEnd
  const checklistIndividualMetrics =
    checklistStart && checklistEnd
      ? individualMetrics.filter((metric) => metric.week_start === checklistStart && metric.week_end === checklistEnd)
      : []
  const launchedAnalystIds = new Set(checklistIndividualMetrics.map((metric) => metric.analyst_id))
  const pendingAnalysts = analysts.filter((analyst) => !launchedAnalystIds.has(analyst.id))
  const checklistTeamMetric =
    checklistStart && checklistEnd
      ? teamMetrics.find((metric) => metric.week_start === checklistStart && metric.week_end === checklistEnd)
      : null
  const checklistComplete =
    Boolean(checklistStart && checklistEnd && checklistTeamMetric && pendingAnalysts.length === 0)


  return (
    <div className="mt-8 space-y-6">
      <section className="panel">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="section-title">Fechamento semanal</h2>
            <p className="section-subtitle">
              Use este resumo para conferir se todos os lancamentos da semana foram feitos antes de fechar o periodo.
            </p>
          </div>
          <div className={`rounded-lg px-4 py-3 text-sm font-semibold ${checklistComplete ? 'bg-emerald-400/10 text-emerald-200' : 'bg-amber-400/10 text-amber-100'}`}>
            {checklistComplete ? 'Semana completa' : 'Semana pendente'}
          </div>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-4">
          <div className="rounded-lg bg-slate-900 p-4">
            <p className="text-sm text-slate-400">Periodo conferido</p>
            <p className="mt-2 font-semibold">
              {checklistStart && checklistEnd ? `${formatDate(checklistStart)} a ${formatDate(checklistEnd)}` : 'Informe as datas'}
            </p>
          </div>
          <div className="rounded-lg bg-slate-900 p-4">
            <p className="text-sm text-slate-400">Analistas lancados</p>
            <p className="mt-2 text-2xl font-bold">{checklistIndividualMetrics.length}/{analysts.length}</p>
          </div>
          <div className="rounded-lg bg-slate-900 p-4">
            <p className="text-sm text-slate-400">Performance equipe</p>
            <p className={`mt-2 text-xl font-bold ${checklistTeamMetric ? 'text-emerald-300' : 'text-amber-200'}`}>
              {checklistTeamMetric ? 'Registrada' : 'Pendente'}
            </p>
          </div>
          <div className="rounded-lg bg-slate-900 p-4">
            <p className="text-sm text-slate-400">Proxima acao</p>
            <p className="mt-2 font-semibold">
              {!checklistStart || !checklistEnd
                ? 'Preencher inicio e fim da semana.'
                : pendingAnalysts.length
                  ? `Faltam ${pendingAnalysts.length} analista(s).`
                  : checklistTeamMetric
                    ? 'Conferir historico e evidencias.'
                    : 'Registrar performance da equipe.'}
            </p>
          </div>
        </div>

        {checklistStart && checklistEnd && (
          <div className="mt-5 rounded-lg bg-slate-900 p-4">
            <p className="text-sm text-slate-400">Pendencias por analista</p>
            {pendingAnalysts.length ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {pendingAnalysts.map((analyst) => (
                  <span key={analyst.id} className="rounded-full bg-amber-400/10 px-3 py-1 text-sm text-amber-100">
                    {analyst.name}
                  </span>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm text-emerald-300">Todos os analistas ativos ja possuem lancamento neste periodo.</p>
            )}
          </div>
        )}
      </section>


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

          {(individualDateInvalid || individualDuplicate || individualReviewsInvalid) && (
            <div className="rounded-md border border-amber-300/30 bg-amber-300/10 p-3 text-sm text-amber-100">
              {individualDateInvalid && <p>A data final nao pode ser menor que a data inicial.</p>}
              {individualDuplicate && <p>Ja existe lancamento para este analista neste periodo.</p>}
              {individualReviewsInvalid && (
                <p>O total de avaliacoes nao pode ser maior que o total de atendimentos.</p>
              )}
            </div>
          )}

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

          <div className="rounded-md bg-slate-900 p-4 text-sm text-slate-300">
            <p>Total de avaliacoes: <strong>{totalReviews}</strong></p>
            <p>Percentual de avaliacoes: <strong>{reviewPercentage}%</strong></p>
            <p>
              CSAT informado: <strong>{toNumber(individualForm.csat)}%</strong>
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <button className="primary-button" disabled={saving} type="submit">
              {saving ? 'Salvando...' : 'Salvar lancamento individual'}
            </button>
            <button
              className="secondary-button"
              disabled={saving}
              type="button"
              onClick={() =>
                onIndividualChange({ ...initialIndividualForm, analystId: analysts[0]?.id || '' })
              }
            >
              Limpar formulario
            </button>
          </div>
        </form>
        </section>

        <section className="panel">
        <h2 className="section-title">Performance da equipe</h2>
        <p className="section-subtitle">
          Formula atual: ligacoes atendidas / total processado x 100.
        </p>

        <form className="mt-5 grid gap-4" onSubmit={onTeamSubmit}>
          {(teamDateInvalid || teamDuplicate || teamAnsweredInvalid || teamTotalMismatch) && (
            <div className="rounded-md border border-amber-300/30 bg-amber-300/10 p-3 text-sm text-amber-100">
              {teamDateInvalid && <p>A data final nao pode ser menor que a data inicial.</p>}
              {teamDuplicate && <p>Ja existe performance da equipe neste periodo.</p>}
              {teamAnsweredInvalid && (
                <p>Ligacoes atendidas nao pode ser maior que o total processado.</p>
              )}
              {teamTotalMismatch && (
                <p>Conferencia: atendidas + abandonadas esta diferente do total processado.</p>
              )}
            </div>
          )}

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

          <div className="rounded-md bg-slate-900 p-4 text-sm text-slate-300">
            <p>Performance calculada: <strong>{calculatedPerformance}%</strong></p>
            <p>Atendidas + abandonadas: <strong>{answeredCalls + abandonedCalls}</strong></p>
            <p>Total processado: <strong>{totalCalls}</strong></p>
          </div>

          <div className="flex flex-wrap gap-3">
            <button className="primary-button" disabled={saving} type="submit">
              {saving ? 'Salvando...' : 'Salvar performance da equipe'}
            </button>
            <button
              className="secondary-button"
              disabled={saving}
              type="button"
              onClick={() => onTeamChange(initialTeamForm)}
            >
              Limpar formulario
            </button>
          </div>
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
  const [historyType, setHistoryType] = useState<'all' | 'individual' | 'team'>('all')
  const [historyAnalyst, setHistoryAnalyst] = useState('all')
  const [historyStart, setHistoryStart] = useState('')
  const [historyEnd, setHistoryEnd] = useState('')
  const analystOptions = getHistoryAnalystOptions(individualMetrics)
  const filteredIndividualMetrics = individualMetrics.filter((metric) => {
    const analystName = getAnalystName(metric.analysts)
    const matchesAnalyst = historyAnalyst === 'all' || analystName === historyAnalyst
    return matchesAnalyst && isMetricInsideHistoryFilter(metric.week_start, metric.week_end, historyStart, historyEnd)
  })
  const filteredTeamMetrics = teamMetrics.filter((metric) =>
    isMetricInsideHistoryFilter(metric.week_start, metric.week_end, historyStart, historyEnd),
  )
  const showIndividual = historyType === 'all' || historyType === 'individual'
  const showTeam = historyType === 'all' || historyType === 'team'
  const totalIndividualReviews = filteredIndividualMetrics.reduce(
    (sum, metric) => sum + Number(metric.total_reviews),
    0,
  )
  const totalIndividualTickets = filteredIndividualMetrics.reduce(
    (sum, metric) => sum + Number(metric.total_tickets),
    0,
  )
  const averageHistoryCsat = calculateAverageCsat(filteredIndividualMetrics)
  const averageTeamPerformance = calculateTeamPerformance(filteredTeamMetrics)

  function clearHistoryFilters() {
    setHistoryType('all')
    setHistoryAnalyst('all')
    setHistoryStart('')
    setHistoryEnd('')
  }

  return (
    <section className="panel">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="section-title">Historico de lancamentos</h2>
          <p className="section-subtitle">
            Filtre registros por tipo, periodo e analista para revisar dados acumulados ou excluir lancamentos de teste.
          </p>
        </div>
        <button className="secondary-button self-start" type="button" onClick={clearHistoryFilters}>
          Limpar filtros
        </button>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-4">
        <Field label="Tipo de historico">
          <select
            className="form-input"
            value={historyType}
            onChange={(event) => setHistoryType(event.target.value as 'all' | 'individual' | 'team')}
          >
            <option value="all">Todos</option>
            <option value="individual">Somente individuais</option>
            <option value="team">Somente equipe</option>
          </select>
        </Field>
        <Field label="Analista">
          <select
            className="form-input"
            disabled={historyType === 'team'}
            value={historyAnalyst}
            onChange={(event) => setHistoryAnalyst(event.target.value)}
          >
            <option value="all">Todos</option>
            {analystOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Inicio">
          <input
            className="form-input"
            type="date"
            value={historyStart}
            onChange={(event) => setHistoryStart(event.target.value)}
          />
        </Field>
        <Field label="Fim">
          <input
            className="form-input"
            type="date"
            value={historyEnd}
            onChange={(event) => setHistoryEnd(event.target.value)}
          />
        </Field>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-4">
        <div className="rounded-lg bg-slate-900 p-4">
          <p className="text-sm text-slate-400">Registros individuais</p>
          <p className="mt-2 text-2xl font-bold">{filteredIndividualMetrics.length}</p>
        </div>
        <div className="rounded-lg bg-slate-900 p-4">
          <p className="text-sm text-slate-400">CSAT medio filtrado</p>
          <p className="mt-2 text-2xl font-bold">{averageHistoryCsat}%</p>
        </div>
        <div className="rounded-lg bg-slate-900 p-4">
          <p className="text-sm text-slate-400">Avaliacoes / atendimentos</p>
          <p className="mt-2 text-2xl font-bold">{totalIndividualReviews}/{totalIndividualTickets}</p>
        </div>
        <div className="rounded-lg bg-slate-900 p-4">
          <p className="text-sm text-slate-400">Performance equipe</p>
          <p className="mt-2 text-2xl font-bold">{averageTeamPerformance}%</p>
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        {showIndividual && (
          <div>
            <h3 className="font-semibold">Lancamentos individuais</h3>
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="text-slate-400">
                  <tr>
                    <th className="pb-3 pr-4 font-medium">Analista</th>
                    <th className="pb-3 pr-4 font-medium">Semana</th>
                    <th className="pb-3 pr-4 font-medium">CSAT</th>
                    <th className="pb-3 pr-4 font-medium">Avaliacoes</th>
                    <th className="pb-3 pr-4 font-medium">Atendimentos</th>
                    <th className="pb-3 pr-4 font-medium">Evidencia</th>
                    <th className="pb-3 font-medium">Acao</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {filteredIndividualMetrics.map((metric) => (
                    <tr key={metric.id}>
                      <td className="py-3 pr-4">{getAnalystName(metric.analysts)}</td>
                      <td className="py-3 pr-4">{formatWeek(metric.week_start, metric.week_end)}</td>
                      <td className="py-3 pr-4">{metric.csat}%</td>
                      <td className="py-3 pr-4">{metric.total_reviews}</td>
                      <td className="py-3 pr-4">{metric.total_tickets}</td>
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

              {!filteredIndividualMetrics.length && (
                <EmptyState text="Nenhum lancamento individual encontrado com estes filtros." />
              )}
            </div>
          </div>
        )}

        {showTeam && (
          <div>
            <h3 className="font-semibold">Performance da equipe</h3>
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="text-slate-400">
                  <tr>
                    <th className="pb-3 pr-4 font-medium">Semana</th>
                    <th className="pb-3 pr-4 font-medium">Performance</th>
                    <th className="pb-3 pr-4 font-medium">Atendidas</th>
                    <th className="pb-3 pr-4 font-medium">Processadas</th>
                    <th className="pb-3 pr-4 font-medium">Evidencia</th>
                    <th className="pb-3 font-medium">Acao</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {filteredTeamMetrics.map((metric) => (
                    <tr key={metric.id}>
                      <td className="py-3 pr-4">{formatWeek(metric.week_start, metric.week_end)}</td>
                      <td className="py-3 pr-4">{metric.performance_percentage}%</td>
                      <td className="py-3 pr-4">{metric.answered_calls}</td>
                      <td className="py-3 pr-4">{metric.total_calls}</td>
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

              {!filteredTeamMetrics.length && (
                <EmptyState text="Nenhuma performance de equipe encontrada com estes filtros." />
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
function getHistoryAnalystOptions(metrics: IndividualMetric[]) {
  const names = new Set<string>()
  metrics.forEach((metric) => names.add(getAnalystName(metric.analysts)))
  return [...names].sort((a, b) => a.localeCompare(b))
}

function isMetricInsideHistoryFilter(
  weekStart: string,
  weekEnd: string,
  filterStart: string,
  filterEnd: string,
) {
  if (filterStart && weekEnd < filterStart) return false
  if (filterEnd && weekStart > filterEnd) return false
  return true
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
    <div className="mt-8 space-y-6">
      <section className="panel">
        <h2 className="section-title">Metas e impacto no sistema</h2>
        <p className="section-subtitle">
          Estes parametros alimentam dashboard, podio, relatorios SARE e leituras preditivas. O CSAT individual continua no cadastro de cada analista.
        </p>

        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          <GoalImpactCard
            title="Podio mensal"
            text="Usa CSAT minimo para podio, percentual minimo de avaliacoes e volume de atendimentos dentro da media da equipe."
          />
          <GoalImpactCard
            title="Performance da equipe"
            text="Define a referencia operacional compartilhada por todos e usada nos alertas executivos."
          />
          <GoalImpactCard
            title="Relatorios e IA"
            text="As metas aparecem no SARE, nos planos de desenvolvimento e na inteligencia preditiva do dashboard."
          />
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
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
                  <th className="pb-3 pr-4 font-medium">Impacto</th>
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
                    <td className="py-3 pr-4 text-slate-400">{getGoalImpactText(goal)}</td>
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
    </div>
  )
}
function GoalImpactCard({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-lg bg-slate-900 p-5">
      <p className="text-sm text-slate-400">{title}</p>
      <p className="mt-2 text-sm leading-6 text-slate-300">{text}</p>
    </div>
  )
}

function getGoalImpactText(goal: Goal) {
  const key = goal.key.toLowerCase()
  const label = goal.label.toLowerCase()

  if (key.includes('podium') || label.includes('podio') || label.includes('pÃ³dio')) {
    return 'Define elegibilidade para o podio e relatorios SARE.'
  }

  if (key.includes('review') || label.includes('avalia')) {
    return 'Define o minimo de avaliacoes esperado por atendimento.'
  }

  if (key.includes('performance') || key.includes('team') || label.includes('performance') || label.includes('desempenho')) {
    return 'Define a referencia da performance operacional da equipe.'
  }

  return 'Parametro operacional usado nos calculos e leituras do painel.'
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

function PredictiveCard({
  label,
  value,
  detail,
  tone,
}: {
  label: string
  value: string | number
  detail: string
  tone: 'success' | 'warning' | 'danger'
}) {
  const toneClass =
    tone === 'success'
      ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-200'
      : tone === 'warning'
        ? 'border-amber-400/40 bg-amber-400/10 text-amber-200'
        : 'border-rose-400/40 bg-rose-400/10 text-rose-200'

  return (
    <div className={`rounded-lg border p-5 ${toneClass}`}>
      <p className="text-sm text-slate-300">{label}</p>
      <p className="mt-2 text-2xl font-bold">{value}</p>
      <p className="mt-3 text-sm leading-5 text-slate-300">{detail}</p>
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

function GroupedPercentTrendChart({
  points,
  series,
}: {
  points: Array<{ label: string; csat: number; reviews: number; sending: number }>
  series: Array<{ key: 'csat' | 'reviews' | 'sending'; label: string; color: string }>
}) {
  return (
    <div className="rounded-lg bg-slate-900 p-4">
      <div className="flex flex-wrap gap-3 text-xs text-slate-300">
        {series.map((item) => (
          <span key={item.key} className="inline-flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${item.color}`} />
            {item.label}
          </span>
        ))}
      </div>

      <div className="mt-5 space-y-4">
        {points.map((point) => (
          <div key={point.label} className="grid gap-2 md:grid-cols-[90px_1fr] md:items-center">
            <span className="text-sm font-semibold text-slate-300">{point.label}</span>
            <div className="grid gap-2">
              {series.map((item) => (
                <div key={item.key} className="grid grid-cols-[1fr_48px] items-center gap-3">
                  <div className="h-3 rounded-full bg-slate-800">
                    <div className={`h-3 rounded-full ${item.color}`} style={{ width: `${Math.max(point[item.key], 3)}%` }} />
                  </div>
                  <strong className="text-right text-xs">{point[item.key]}%</strong>
                </div>
              ))}
            </div>
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

function normalizeUserRole(role: string | null | undefined): UserRole {
  const normalized = (role ?? '').toLowerCase()

  if (normalized.includes('master')) return 'master'
  if (normalized.includes('coord')) return 'coordinator'
  if (normalized.includes('analista') || normalized.includes('analyst')) return 'analyst'
  return 'analyst'
}

function getRoleLabel(role: UserRole) {
  const labels: Record<UserRole, string> = {
    master: 'Master',
    coordinator: 'Coordenadora',
    analyst: 'Analista',
  }

  return labels[role]
}

function findProfileAnalyst(profile: UserProfile | null, analysts: Analyst[], email: string) {
  if (!profile) return null

  if (profile.analyst_id) {
    const byId = analysts.find((analyst) => analyst.id === profile.analyst_id)
    if (byId) return byId
  }

  const profileName = normalizeText(profile.full_name || profile.name || '')
  const byName = analysts.find((analyst) => normalizeText(analyst.name) === profileName)

  if (byName) return byName

  const emailName = normalizeText(email.split('@')[0]?.replace(/[._-]+/g, ' ') ?? '')
  return analysts.find((analyst) => emailName.includes(normalizeText(analyst.name))) ?? null
}

function getProfileAnalystId(profile: UserProfile | null, analysts: Analyst[], email: string) {
  if (profile?.analyst_id) return profile.analyst_id

  return findProfileAnalyst(profile, analysts, email)?.id ?? null
}

function createProfileAnalystFallback(
  profile: UserProfile | null,
  analystId: string | null,
  email: string,
): Analyst | null {
  if (!profile || !analystId) return null

  return {
    id: analystId,
    name: profile.full_name || profile.name || email.split('@')[0] || 'Analista',
    active: true,
    csat_goal: 0,
  }
}

function buildAnalystsFromMetrics(metrics: IndividualMetric[]): Analyst[] {
  const grouped = new Map<string, Analyst>()

  metrics.forEach((metric) => {
    if (grouped.has(metric.analyst_id)) return

    grouped.set(metric.analyst_id, {
      id: metric.analyst_id,
      name: getMetricAnalystName(metric) || 'Analista',
      active: true,
      csat_goal: 86,
    })
  })

  return [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name))
}

function getMetricAnalystName(metric: IndividualMetric) {
  if (Array.isArray(metric.analysts)) return metric.analysts[0]?.name ?? ''

  return metric.analysts?.name ?? ''
}

function normalizeText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
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

function exportChatIndividualReport({
  metric,
  periodLabel,
  averageTickets,
  podiumPosition,
  monthlyHistory,
  feedbackStyle,
  managerNotes,
  feedbackText,
}: {
  metric: ChatMonthlyMetric
  periodLabel: string
  averageTickets: number
  podiumPosition: number
  monthlyHistory: ChatMonthlyMetric[]
  feedbackStyle: ChatFeedbackStyle
  managerNotes: string
  feedbackText: string
}) {
  const analystName = getChatAnalystName(metric)
  const safeName = escapeHtml(analystName)
  const csatGoal = Number(metric.csat_goal) || 90
  const reviewGoal = 25
  const csatGap = round(Number(metric.csat) - csatGoal)
  const reviewGap = round(Number(metric.review_percentage) - reviewGoal)
  const productivityGap = averageTickets ? round(((Number(metric.total_tickets) - averageTickets) / averageTickets) * 100) : 0
  const podiumText = podiumPosition > 0
    ? `${podiumPosition}o Lugar - CSAT: ${metric.csat}% | ${metric.total_tickets} atendimentos | ${metric.review_percentage}% avaliacoes`
    : 'Nao elegivel ao podio neste periodo'
  const status = metric.status || (Number(metric.csat) >= csatGoal && Number(metric.review_percentage) >= reviewGoal ? 'Meta Superada' : 'Em acompanhamento')
  const statusColor = status === 'Meta Superada' ? '#059669' : status === 'Critico' ? '#dc2626' : '#d97706'
  const csatText = csatGap >= 0
    ? `O resultado superou a referencia de ${csatGoal}% em ${formatDelta(csatGap, ' p.p.')}.`
    : `O resultado ficou ${formatDelta(csatGap, ' p.p.')} abaixo da referencia de ${csatGoal}%.`
  const reviewText = reviewGap >= 0
    ? `O resultado superou a meta de avaliacoes em ${formatDelta(reviewGap, ' p.p.')}.`
    : `O resultado ficou ${formatDelta(reviewGap, ' p.p.')} abaixo da meta minima de avaliacoes.`
  const productivityText = productivityGap >= 0
    ? `${analystName} absorveu uma demanda ${formatDelta(productivityGap, '%')} superior a media da operacao.`
    : `${analystName} ficou ${formatDelta(productivityGap, '%')} abaixo da media de atendimentos da operacao.`
  const finalFeedback = feedbackText.trim() || buildChatFeedbackText({ metric, averageTickets, podiumPosition, style: feedbackStyle, managerNotes })
  const feedbackTitle = getChatFeedbackStyleLabel(feedbackStyle)
  const managerNotesHtml = managerNotes.trim() ? `<h2>Observacoes do gestor</h2><div class="note-box">${formatChatFeedbackForReport(managerNotes)}</div>` : ''
  const evolutionRows = buildChatReportEvolutionRows(monthlyHistory)

  const documentHtml = `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Analise individual - ${safeName}</title>
        <style>
          body { font-family: Arial, sans-serif; color: #111827; margin: 34px; }
          h1 { font-size: 26px; margin: 0 0 6px; color: #0f172a; }
          h2 { color: #0f766e; font-size: 18px; margin: 24px 0 8px; }
          h3 { font-size: 14px; margin: 16px 0 6px; color: #0f172a; }
          p { font-size: 12px; line-height: 1.55; margin: 0 0 8px; }
          ul { margin-top: 6px; }
          li { font-size: 12px; line-height: 1.55; margin-bottom: 5px; }
          .header { border-bottom: 3px solid #06b6d4; padding-bottom: 12px; margin-bottom: 18px; }
          .subtitle { color: #475569; margin-bottom: 0; }
          .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 12px 0 18px; }
          .box { border: 1px solid #cbd5e1; background: #f8fafc; padding: 12px; margin-bottom: 12px; }
          .box h2 { margin-top: 0; }
          .status { border-left: 5px solid ${statusColor}; background: #f8fafc; padding: 12px; margin-top: 8px; }
          .status strong { color: ${statusColor}; font-size: 16px; }
          .muted { color: #475569; }
          .metric { font-weight: bold; color: #0f172a; }
          .trend { border: 1px solid #cbd5e1; background: #f8fafc; padding: 12px; margin: 10px 0 16px; }
          .trend-table { border-collapse: collapse; width: 100%; margin-top: 12px; }
          .trend-table th { background: #0f766e; color: #ffffff; font-size: 10px; padding: 7px; text-align: left; }
          .trend-table td { border: 1px solid #dbe3ef; font-size: 10px; padding: 7px; vertical-align: middle; }
          .chart-title { font-size: 12px; font-weight: bold; color: #0f172a; margin: 12px 0 6px; }
          .chart-legend { font-size: 10px; color: #475569; margin: 4px 0 8px; }
          .legend-dot { display: inline-block; width: 9px; height: 9px; margin-right: 4px; border-radius: 9px; }
          .line-chart { width: 100%; height: 165px; border: 1px solid #cbd5e1; background: #ffffff; }
          .volume-row { display: grid; grid-template-columns: 78px 1fr 64px; gap: 8px; align-items: center; margin: 7px 0; }
          .volume-label { font-size: 10px; font-weight: bold; color: #0f172a; }
          .volume-track { background: #e2e8f0; height: 16px; border-radius: 2px; overflow: hidden; }
          .volume-bar { background: #059669; height: 16px; border-radius: 2px; }
          .volume-value { font-size: 10px; font-weight: bold; text-align: right; }
          .trend-read { background: #ecfeff; border-left: 4px solid #0891b2; padding: 9px 10px; margin: 8px 0 10px; }
          .trend-read p { margin: 0; }
          .coach { border-left: 5px solid #0891b2; background: #ecfeff; padding: 12px; margin-top: 8px; }
          .note-box { border-left: 5px solid #64748b; background: #f8fafc; padding: 12px; margin-top: 8px; }
          .month-card { border: 1px solid #cbd5e1; background: #ffffff; padding: 10px; margin: 10px 0; page-break-inside: avoid; }
          .month-card-title { font-size: 12px; font-weight: bold; margin: 0 0 8px; color: #0f172a; }
          .indicator-row { display: grid; grid-template-columns: 90px 1fr 58px; gap: 8px; align-items: center; margin: 6px 0; }
          .indicator-label { color: #334155; font-size: 10px; font-weight: bold; }
          .indicator-track { background: #e2e8f0; height: 15px; overflow: hidden; }
          .indicator-fill { height: 15px; }
          .indicator-fill.csat { background: #0891b2; }
          .indicator-fill.review { background: #7c3aed; }
          .indicator-fill.sending { background: #d97706; }
          .indicator-fill.volume { background: #059669; }
          .indicator-value { color: #0f172a; font-size: 10px; font-weight: bold; text-align: right; }
          .kpi-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin: 12px 0 16px; }
          .kpi-card { border: 1px solid #cbd5e1; background: #ffffff; padding: 10px; }
          .kpi-card span { display: block; color: #475569; font-size: 10px; margin-bottom: 5px; }
          .kpi-card strong { display: block; color: #0f172a; font-size: 18px; }
          .kpi-card em { display: block; color: #475569; font-size: 10px; font-style: normal; margin-top: 5px; }
          .coach h3 { margin-top: 0; color: #0f172a; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>Relatorio de Performance - ${safeName}</h1>
          <p class="subtitle">Periodo: ${escapeHtml(periodLabel)} | Fonte: Zendesk</p>
        </div>

        <div class="grid">
          <div class="box">
            <h2>Esperado:</h2>
            <p>>= ${reviewGoal}% de avaliacoes</p>
            <p>>= ${csatGoal}% de Satisfacao</p>
          </div>
          <div class="box">
            <h2>Atingido:</h2>
            <p>CSAT: <span class="metric">${metric.csat}%</span></p>
            <p>Avaliacoes: <span class="metric">${metric.review_percentage}%</span> (${metric.positive_reviews} positivos + ${metric.negative_reviews} negativos = ${metric.reviews})</p>
            <p>% Envio: <span class="metric">${metric.sending_percentage}%</span></p>
            <p>Atendidos: ${metric.total_tickets} - ${metric.inactive_tickets} = <span class="metric">${metric.valid_tickets}</span></p>
            <p>Media por agente: ${averageTickets}</p>
            <p>Posicao no Podio: ${escapeHtml(podiumText)}</p>
          </div>
        </div>

        <div class="kpi-grid">
          <div class="kpi-card">
            <span>Qualidade percebida</span>
            <strong>${metric.csat}%</strong>
            <em>Meta individual: ${csatGoal}% (${formatDelta(csatGap, ' p.p.')})</em>
          </div>
          <div class="kpi-card">
            <span>Participacao em avaliacoes</span>
            <strong>${metric.review_percentage}%</strong>
            <em>Referencia: ${reviewGoal}% (${formatDelta(reviewGap, ' p.p.')})</em>
          </div>
          <div class="kpi-card">
            <span>Volume mensal</span>
            <strong>${metric.total_tickets}</strong>
            <em>Media da operacao: ${averageTickets} (${formatDelta(productivityGap, '%')})</em>
          </div>
        </div>

        <h2>Analise Tecnica de Desempenho</h2>
        <h3>Qualidade e Satisfacao do Cliente (CSAT)</h3>
        <p>O(A) colaborador(a) registrou um indice de <strong>Satisfacao (CSAT) de ${metric.csat}%</strong>.</p>
        <ul>
          <li><strong>Comparativo com a meta:</strong> ${escapeHtml(csatText)}</li>
          <li><strong>Analise detalhada:</strong> Do volume total de feedbacks recebidos (${metric.reviews}), <strong>${metric.positive_reviews} foram positivos</strong>. Houve ${metric.negative_reviews} registros negativos.</li>
        </ul>

        <h3>Engajamento e Coleta de Feedback</h3>
        <p>O(A) colaborador(a) alcancou uma <strong>taxa de avaliacoes de ${metric.review_percentage}%</strong>.</p>
        <ul>
          <li><strong>Comparativo com a meta:</strong> ${escapeHtml(reviewText)}</li>
          <li><strong>Calculo:</strong> A taxa foi calculada sobre ${metric.reviews} avaliacoes divididas por ${metric.valid_tickets} atendimentos validos.</li>
        </ul>

        <h3>Produtividade e Volumetria</h3>
        <p>O volume total de atendimentos realizados pelo(a) colaborador(a) foi de <strong>${metric.total_tickets} chamados</strong>.</p>
        <ul>
          <li><strong>Comparativo com a operacao:</strong> A media de atendimentos por agente foi de ${averageTickets}. ${escapeHtml(productivityText)}</li>
          <li><strong>Destaque:</strong> ${escapeHtml(podiumText)}.</li>
        </ul>

        <h2>Evolucao mensal</h2>
        <p class="muted">Leitura comparativa dos meses importados. O objetivo e enxergar rapidamente melhora, queda ou estabilidade em CSAT, avaliacoes e volume.</p>
        ${evolutionRows}

        ${managerNotesHtml}

        <h2>Feedback ${escapeHtml(feedbackTitle)}</h2>
        <div class="coach">
          ${formatChatFeedbackForReport(finalFeedback)}
        </div>
      </body>
    </html>
  `
  const blob = new Blob(['\ufeff', documentHtml], {
    type: 'application/msword;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  const fileName = `analise-${slugifyFileName(analystName)}-${slugifyFileName(periodLabel)}.doc`

  link.href = url
  link.download = fileName
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)

  return fileName
}

function buildChatReportEvolutionRows(history: ChatMonthlyMetric[]) {
  if (!history.length) return '<p class="muted">Sem historico mensal suficiente para exibir evolucao.</p>'

  const first = history[0]
  const last = history.at(-1) ?? first
  const csatDelta = round(Number(last.csat) - Number(first.csat))
  const reviewDelta = round(Number(last.review_percentage) - Number(first.review_percentage))
  const sendingDelta = round(Number(last.sending_percentage) - Number(first.sending_percentage))
  const ticketDelta = Number(last.total_tickets) - Number(first.total_tickets)
  const maxTickets = Math.max(...history.map((metric) => Number(metric.total_tickets)), 1)
  const deltaText = (value: number, suffix = '') => (value > 0 ? `+${value}${suffix}` : `${value}${suffix}`)
  const barWidth = (value: number, max = 100) => `${Math.max(3, Math.min(100, (value / max) * 100))}%`
  const monthCards = history
    .map((metric) => {
      const month = escapeHtml(metric.month_label.replace(' 2026', ''))
      const volumeWidth = barWidth(Number(metric.total_tickets), maxTickets)

      return `
        <div class="month-card">
          <p class="month-card-title">${month}</p>
          <div class="indicator-row">
            <span class="indicator-label">CSAT</span>
            <span class="indicator-track"><span class="indicator-fill csat" style="display:block;width:${barWidth(Number(metric.csat))};"></span></span>
            <span class="indicator-value">${metric.csat}%</span>
          </div>
          <div class="indicator-row">
            <span class="indicator-label">Avaliacoes</span>
            <span class="indicator-track"><span class="indicator-fill review" style="display:block;width:${barWidth(Number(metric.review_percentage))};"></span></span>
            <span class="indicator-value">${metric.review_percentage}%</span>
          </div>
          <div class="indicator-row">
            <span class="indicator-label">Envio</span>
            <span class="indicator-track"><span class="indicator-fill sending" style="display:block;width:${barWidth(Number(metric.sending_percentage))};"></span></span>
            <span class="indicator-value">${metric.sending_percentage}%</span>
          </div>
          <div class="indicator-row">
            <span class="indicator-label">Atendimentos</span>
            <span class="indicator-track"><span class="indicator-fill volume" style="display:block;width:${volumeWidth};"></span></span>
            <span class="indicator-value">${metric.total_tickets}</span>
          </div>
        </div>
      `
    })
    .join('')
  const tableRows = history
    .map(
      (metric) => `
        <tr>
          <td><strong>${escapeHtml(metric.month_label.replace(' 2026', ''))}</strong></td>
          <td>${metric.csat}%</td>
          <td>${metric.review_percentage}%</td>
          <td>${metric.sending_percentage}%</td>
          <td>${metric.total_tickets}</td>
        </tr>
      `,
    )
    .join('')
  const readText =
    history.length > 1
      ? `No historico importado, o CSAT variou ${deltaText(csatDelta, ' p.p.')}, as avaliacoes variaram ${deltaText(reviewDelta, ' p.p.')}, o envio variou ${deltaText(sendingDelta, ' p.p.')} e o volume mudou ${deltaText(ticketDelta)} atendimentos entre ${first.month_label} e ${last.month_label}.`
      : 'Ha apenas um mes importado para este analista; a leitura funciona como fotografia do periodo.'

  return `
    <div class="trend">
      <div class="trend-read"><p>${escapeHtml(readText)}</p></div>
      <p class="chart-title">Evolucao visual por mes</p>
      <p class="chart-legend">Barras percentuais mostram CSAT, avaliacoes e envio. A barra de atendimentos usa escala relativa ao maior volume do historico exibido.</p>
      ${monthCards}

      <table class="trend-table">
        <tr>
          <th>Mes</th>
          <th>CSAT</th>
          <th>Avaliacoes</th>
          <th>Envio</th>
          <th>Atendimentos</th>
        </tr>
        ${tableRows}
      </table>
    </div>
  `
}

function buildChatFeedbackText({
  metric,
  averageTickets,
  podiumPosition,
  style,
  managerNotes,
}: {
  metric: ChatMonthlyMetric
  averageTickets: number
  podiumPosition: number
  style: ChatFeedbackStyle
  managerNotes: string
}) {
  const analystName = getChatAnalystName(metric)
  const csatGoal = Number(metric.csat_goal) || 90
  const reviewGoal = Number(metric.general_review_goal) || 25
  const status = metric.status || getChatMetricStatus(Number(metric.csat), Number(metric.review_percentage), csatGoal, reviewGoal)
  const csatGap = round(Number(metric.csat) - csatGoal)
  const reviewGap = round(Number(metric.review_percentage) - reviewGoal)
  const productivityGap = averageTickets ? round(((Number(metric.total_tickets) - averageTickets) / averageTickets) * 100) : 0
  const podiumText = podiumPosition > 0 ? `${podiumPosition}o lugar no podio` : 'fora do podio neste fechamento'
  const contextLine = `${analystName} fechou o ciclo com CSAT de ${metric.csat}%, avaliacoes de ${metric.review_percentage}%, envio/sem avaliacao de ${metric.sending_percentage}% e ${metric.total_tickets} atendimentos. Status: ${status}.`
  const notesLine = managerNotes.trim() ? `Contexto do gestor: ${managerNotes.trim()}` : ''
  const strengths: string[] = []
  const actions: string[] = []

  if (csatGap >= 0) {
    strengths.push(`qualidade percebida acima da meta individual de ${csatGoal}%`)
    actions.push('manter o padrao de abordagem que sustentou a satisfacao do cliente')
  } else {
    actions.push('revisar os atendimentos que geraram avaliacao negativa e transformar os principais pontos em combinados praticos')
  }

  if (reviewGap >= 0) {
    strengths.push(`volume de avaliacoes suficiente, ${formatDelta(reviewGap, ' p.p.')} acima da referencia`)
    actions.push('preservar a rotina de encerramento que estimula resposta do cliente')
  } else {
    actions.push('reforcar a coleta de feedback no encerramento, buscando elevar a amostra de avaliacoes')
  }

  if (productivityGap >= 0) {
    strengths.push(`volume ${formatDelta(productivityGap, '%')} acima da media da operacao`)
  } else {
    actions.push('validar se o volume abaixo da media veio de distribuicao, ausencias, emprestimo para outro setor ou oportunidade de produtividade')
  }

  const strengthText = strengths.length ? strengths.join('; ') : 'ha oportunidade de consolidar padroes de qualidade, volume e coleta de feedback'
  const actionText = actions.join('; ')
  const resultText =
    status === 'Meta Superada'
      ? 'O resultado esperado e preservar a consistencia e usar o ciclo como referencia positiva para o proximo fechamento mensal.'
      : status === 'Critico'
        ? 'O resultado esperado e recuperar previsibilidade no proximo fechamento, priorizando poucos ajustes de alto impacto.'
        : 'O resultado esperado e transformar os bons sinais do ciclo em consistencia suficiente para superar todos os criterios no proximo fechamento.'

  if (style === 'sare') {
    return [
      `Situacao: ${contextLine}`,
      `Alinhamentos Realizados: ${actionText}. ${notesLine}`,
      `Resultado Esperado: ${resultText} Posicao atual: ${podiumText}.`,
      `Expectativa e Plano de Desenvolvimento: para o proximo ciclo mensal, acompanhar a manutencao do CSAT, ampliar a qualidade da amostra de avaliacoes quando necessario e proteger o volume valido de atendimentos.`,
    ]
      .filter(Boolean)
      .join('\n\n')
  }

  if (style === 'mimo') {
    return [
      `Momento observado: ${contextLine}`,
      `Impacto: ${strengthText}. A leitura coloca o colaborador ${podiumText}.`,
      `Melhoria ou manutencao: ${actionText}. ${notesLine}`,
      `Orientacao: ${resultText}`,
    ]
      .filter(Boolean)
      .join('\n\n')
  }

  return [
    `Leitura do ciclo: ${contextLine}`,
    `Forcas observadas: ${strengthText}.`,
    `Plano de desenvolvimento: ${actionText}. ${notesLine}`,
    `Expectativa para o proximo ciclo mensal: ${resultText} Posicao atual: ${podiumText}.`,
  ]
    .filter(Boolean)
    .join('\n\n')
}

function getChatFeedbackStyleLabel(style: ChatFeedbackStyle) {
  if (style === 'sare') return 'SARE'
  if (style === 'mimo') return 'MIMO'
  return 'Coach'
}

function formatChatFeedbackForReport(text: string) {
  return text
    .split(/\r?\n\r?\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\r?\n/g, '<br />')}</p>`)
    .join('')
}
function exportWordReport({
  analystName,
  periodLabel,
  expected,
  achieved,
  sare,
  weeklyEvolution,
}: {
  analystName: string
  periodLabel: string
  expected: {
    csat: number
    review: number
  }
  achieved: {
    csat: number
    loss: number
    summary: string
    reviewPercentage: number
    reviewCount: number
    answeredTickets: number
    averageTickets: number
    rankingPosition: number
    teamPerformance: number
    teamAnsweredCalls: number
    teamAbandonedCalls: number
    teamTotalCalls: number
  }
  sare: {
    situation: string
    action: string
    result: string
    evolution: string
  }
  weeklyEvolution: WeeklyIndividualTrend[]
}) {
  const safeName = escapeHtml(analystName)
  const firstEvolution = weeklyEvolution[0] ?? null
  const lastEvolution = weeklyEvolution.at(-1) ?? null
  const bestEvolution = weeklyEvolution.reduce<WeeklyIndividualTrend | null>(
    (best, item) => (!best || item.csat > best.csat ? item : best),
    null,
  )
  const worstEvolution = weeklyEvolution.reduce<WeeklyIndividualTrend | null>(
    (worst, item) => (!worst || item.csat < worst.csat ? item : worst),
    null,
  )
  const hasWeeklyComparison = weeklyEvolution.length > 1
  const csatDelta = hasWeeklyComparison && firstEvolution && lastEvolution ? round(lastEvolution.csat - firstEvolution.csat) : 0
  const csatTrendLabel = !hasWeeklyComparison
    ? 'Sem comparativo'
    : csatDelta > 0
      ? 'Melhorou'
      : csatDelta < 0
        ? 'Piorou'
        : 'Estavel'
  const csatTrendClass = !hasWeeklyComparison ? 'neutral' : csatDelta >= 0 ? 'positive' : 'negative'
  const goalGap = round(achieved.csat - expected.csat)
  const goalGapText = goalGap >= 0
    ? `${formatDelta(goalGap, ' p.p.')} acima da referencia`
    : `${formatDelta(goalGap, ' p.p.')} abaixo da referencia`
  const reviewGap = round(achieved.reviewPercentage - expected.review)
  const reviewGapText = reviewGap >= 0
    ? `${formatDelta(reviewGap, ' p.p.')} acima da meta`
    : `${formatDelta(reviewGap, ' p.p.')} abaixo da meta`
  const evolutionBars = weeklyEvolution.length
    ? weeklyEvolution
        .map((item, index) => {
          const previous = weeklyEvolution[index - 1]
          const delta = previous ? round(item.csat - previous.csat) : 0
          const color = delta > 0 ? '#059669' : delta < 0 ? '#dc2626' : '#0891b2'
          const width = Math.max(8, Math.min(100, item.csat))
          const marker = delta > 0 ? 'subiu' : delta < 0 ? 'caiu' : index === 0 ? 'base' : 'estavel'

          return `
            <div class="evolution-row">
              <div class="evolution-label">${escapeHtml(item.label)}</div>
              <div class="evolution-track">
                <div class="goal-line"></div>
                <div class="evolution-bar" style="width:${width}%; background:${color};"></div>
              </div>
              <div class="evolution-value">
                <strong>${item.csat}%</strong>
                <span class="${delta >= 0 ? 'positive' : 'negative'}">${index === 0 ? 'inicio' : formatDelta(delta, ' p.p.')}</span>
                <em>${marker}</em>
              </div>
            </div>
          `
        })
        .join('')
    : '<p class="muted">Sem dados de evolucao no periodo.</p>'
  const evolutionRows = weeklyEvolution.length
    ? weeklyEvolution
        .map(
          (item) => `
            <tr>
              <td>${escapeHtml(item.label)}</td>
              <td>${item.csat}%</td>
              <td>${item.totalReviews}</td>
              <td>${item.totalTickets}</td>
            </tr>
          `,
        )
        .join('')
    : '<tr><td colspan="4">Sem dados de evolucao no periodo.</td></tr>'

  const documentHtml = `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Relatorio mensal - ${safeName}</title>
        <style>
          body { font-family: Arial, sans-serif; color: #111827; margin: 34px; }
          h1 { font-size: 28px; margin: 0 0 6px; color: #0f172a; }
          h2 { color: #0f766e; font-size: 18px; margin: 24px 0 8px; }
          h3 { font-size: 15px; margin: 18px 0 6px; color: #0f172a; }
          p { font-size: 12px; line-height: 1.55; margin: 0 0 10px; }
          table { border-collapse: collapse; width: 100%; margin: 10px 0 18px; }
          th, td { border: 1px solid #cbd5e1; font-size: 11px; padding: 8px; text-align: left; }
          th { background: #ecfeff; font-weight: bold; color: #0f172a; }
          .subtitle { color: #475569; margin-bottom: 18px; }
          .header { border-bottom: 3px solid #06b6d4; padding-bottom: 12px; margin-bottom: 18px; }
          .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
          .box { border: 1px solid #cbd5e1; background: #f8fafc; padding: 12px; margin-bottom: 12px; }
          .box h2 { margin-top: 0; }
          .insight-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 12px 0 18px; }
          .insight { background: #f8fafc; border: 1px solid #cbd5e1; border-top: 4px solid #0891b2; padding: 10px; min-height: 58px; }
          .insight-label { color: #475569; font-size: 10px; margin-bottom: 5px; text-transform: uppercase; letter-spacing: .03em; }
          .insight-value { font-size: 18px; font-weight: bold; color: #0f172a; }
          .insight-note { color: #475569; font-size: 10px; margin-top: 3px; }
          .positive { color: #059669; }
          .negative { color: #dc2626; }
          .neutral { color: #475569; }
          .trend-panel { border: 1px solid #cbd5e1; padding: 12px; margin: 12px 0 18px; }
          .trend-title { font-size: 12px; font-weight: bold; margin-bottom: 10px; color: #0f172a; }
          .evolution-row { display: grid; grid-template-columns: 74px 1fr 140px; gap: 10px; align-items: center; margin: 10px 0; }
          .evolution-label { font-size: 11px; font-weight: bold; color: #0f172a; }
          .evolution-track { background: #e2e8f0; height: 20px; border-radius: 3px; overflow: hidden; position: relative; }
          .evolution-bar { height: 20px; }
          .goal-line { position: absolute; left: ${expected.csat}%; top: 0; width: 2px; height: 20px; background: #111827; opacity: .55; }
          .evolution-value { font-size: 11px; font-weight: normal; }
          .evolution-value strong { display: inline-block; min-width: 42px; }
          .evolution-value span { font-weight: bold; }
          .evolution-value em { color: #64748b; font-style: normal; margin-left: 4px; }
          .muted { color: #475569; }
          .callout { background: #ecfeff; border-left: 4px solid #0891b2; padding: 10px 12px; margin: 12px 0 16px; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>${safeName}</h1>
          <p class="subtitle">Relatorio mensal de performance - ${escapeHtml(periodLabel)}</p>
        </div>

        <div class="grid">
          <div class="box">
            <h2>Esperado</h2>
            <p>CSAT maior ou igual a ${expected.csat}%</p>
            <p>${expected.review}% de avaliacoes dos atendimentos</p>
          </div>
          <div class="box">
            <h2>Atingido</h2>
            <p>CSAT: ${achieved.csat}% (${goalGapText})</p>
            <p>Avaliacoes: ${achieved.reviewPercentage}% (${achieved.reviewCount} respondidas, ${reviewGapText})</p>
            <p>Atendimentos: ${achieved.answeredTickets}</p>
            <p>Media por colaborador: ${achieved.averageTickets}</p>
            <p>Posicao podio: ${achieved.rankingPosition || '-'}</p>
          </div>
        </div>

        <h2>Sintese do feedback</h2>
        <div class="callout"><p>${escapeHtml(achieved.summary)}</p></div>

        <h2>Graficos e evolucao</h2>
        <p class="muted">Leitura visual para identificar rapidamente melhora, queda ou estabilidade.</p>
        <div class="insight-grid">
          <div class="insight">
            <div class="insight-label">CSAT atual</div>
            <div class="insight-value">${achieved.csat}%</div>
            <div class="insight-note">${goalGapText}</div>
          </div>
          <div class="insight">
            <div class="insight-label">Tendencia</div>
            <div class="insight-value ${csatTrendClass}">${csatTrendLabel}</div>
            <div class="insight-note">${hasWeeklyComparison ? formatDelta(csatDelta, ' p.p.') : 'precisa de mais semanas'}</div>
          </div>
          <div class="insight">
            <div class="insight-label">Melhor semana</div>
            <div class="insight-value">${bestEvolution ? `${bestEvolution.label} - ${bestEvolution.csat}%` : '-'}</div>
            <div class="insight-note">ponto mais alto do periodo</div>
          </div>
          <div class="insight">
            <div class="insight-label">Avaliacoes respondidas</div>
            <div class="insight-value">${achieved.reviewCount}</div>
            <div class="insight-note">${achieved.reviewPercentage}% dos atendimentos</div>
          </div>
        </div>
        <div class="trend-panel">
          <div class="trend-title">Evolucao semanal do CSAT - linha escura marca a referencia de ${expected.csat}%</div>
          ${evolutionBars}
        </div>
        <p class="muted">Menor ponto do periodo: ${worstEvolution ? `${worstEvolution.label} - ${worstEvolution.csat}%` : '-'}.</p>
        <table>
          <thead>
            <tr>
              <th>Semana</th>
              <th>CSAT</th>
              <th>Avaliacoes</th>
              <th>Atendimentos</th>
            </tr>
          </thead>
          <tbody>${evolutionRows}</tbody>
        </table>
        <h2>Contexto operacional da equipe</h2>
        <p>Performance da equipe no periodo: ${achieved.teamPerformance}%.</p>
        <p>Ligacoes atendidas pela equipe: ${achieved.teamAnsweredCalls}. Total processado: ${achieved.teamTotalCalls}.</p>

        <h2>Analise SARE</h2>
        <h3>S - Situacao</h3>
        <p>${escapeHtml(sare.situation)}</p>
        <h3>A - Alinhamentos Realizados</h3>
        <p>${escapeHtml(sare.action)}</p>
        <h3>R - Resultado Esperado</h3>
        <p>${escapeHtml(sare.result)}</p>
        <h3>E - Expectativa e Plano de Desenvolvimento</h3>
        <p>${escapeHtml(sare.evolution)}</p>
      </body>
    </html>
  `
  const blob = new Blob(['\ufeff', documentHtml], {
    type: 'application/msword;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  const fileName = `${slugifyFileName(analystName)}-relatorio-${slugifyFileName(periodLabel)}.doc`

  link.href = url
  link.download = fileName
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()

  window.setTimeout(() => {
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }, 5000)

  return fileName
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function slugifyFileName(value: string) {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
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

function calculateGoalProbability({
  hasData,
  csat,
  csatGoal,
  csatDelta,
  teamPerformance,
  teamPerformanceGoal,
  teamPerformanceDelta,
  reviewCoverage,
  reviewGoal,
  eligibleCount,
  totalAnalysts,
}: {
  hasData: boolean
  csat: number
  csatGoal: number
  csatDelta: number
  teamPerformance: number
  teamPerformanceGoal: number
  teamPerformanceDelta: number
  reviewCoverage: number
  reviewGoal: number
  eligibleCount: number
  totalAnalysts: number
}) {
  if (!hasData) return 0

  const csatScore = clampScore(50 + (csat - csatGoal) * 8 + csatDelta * 4)
  const teamScore = clampScore(50 + (teamPerformance - teamPerformanceGoal) * 10 + teamPerformanceDelta * 4)
  const reviewScore = clampScore(50 + (reviewCoverage - reviewGoal) * 3)
  const podiumScore = totalAnalysts ? (eligibleCount / totalAnalysts) * 100 : 0

  return Math.round(csatScore * 0.35 + teamScore * 0.3 + reviewScore * 0.2 + podiumScore * 0.15)
}

function projectMetric(current: number, delta: number, fallbackGoal: number) {
  if (!current) return fallbackGoal
  return round(Math.max(0, Math.min(100, current + delta * 0.5)))
}

function getPredictiveRiskLevel(
  probability: number,
  csatDelta: number,
  teamPerformanceDelta: number,
  attentionCount: number,
) {
  if (probability < 45 || csatDelta < -2 || teamPerformanceDelta < -1.5 || attentionCount >= 3) {
    return 'Alto'
  }

  if (probability < 75 || csatDelta < 0 || teamPerformanceDelta < 0 || attentionCount > 0) {
    return 'Medio'
  }

  return 'Baixo'
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, value))
}
function getChatTeamNameById(teams: ChatTeam[], teamId: string) {
  return teams.find((team) => team.id === teamId)?.name ?? 'Equipe'
}
function getChatAnalystName(metric: ChatMonthlyMetric) {
  const analyst = Array.isArray(metric.chat_analysts) ? metric.chat_analysts[0] : metric.chat_analysts
  return analyst?.name ?? 'Analista'
}

function getChatTeamName(metric: ChatMonthlyMetric) {
  const team = Array.isArray(metric.chat_teams) ? metric.chat_teams[0] : metric.chat_teams
  return team?.name ?? 'Equipe'
}

const chatMonthOptions = [
  { value: '1', label: 'Janeiro' },
  { value: '2', label: 'Fevereiro' },
  { value: '3', label: 'Marco' },
  { value: '4', label: 'Abril' },
  { value: '5', label: 'Maio' },
  { value: '6', label: 'Junho' },
  { value: '7', label: 'Julho' },
  { value: '8', label: 'Agosto' },
  { value: '9', label: 'Setembro' },
  { value: '10', label: 'Outubro' },
  { value: '11', label: 'Novembro' },
  { value: '12', label: 'Dezembro' },
]

async function readSheetRows(file: File) {
  if (file.name.toLowerCase().endsWith('.csv')) {
    return parseCsvRows(await file.text())
  }

  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array' })
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) return []

  return XLSX.utils.sheet_to_json<Record<string, string | number | null>>(workbook.Sheets[sheetName], {
    defval: '',
    raw: false,
  })
}

function parseCsvRows(text: string) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim())
  if (lines.length < 2) return []

  const delimiter = detectCsvDelimiter(lines[0])
  const headers = parseCsvLine(lines[0], delimiter).map((header) => header.trim())

  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line, delimiter)
    return headers.reduce<Record<string, string>>((row, header, index) => {
      row[header] = values[index]?.trim() ?? ''
      return row
    }, {})
  })
}

function detectCsvDelimiter(headerLine: string) {
  const commaCount = (headerLine.match(/,/g) ?? []).length
  const semicolonCount = (headerLine.match(/;/g) ?? []).length
  return semicolonCount > commaCount ? ';' : ','
}

function parseCsvLine(line: string, delimiter: string) {
  const values: string[] = []
  let current = ''
  let insideQuotes = false

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    const next = line[index + 1]

    if (char === '"' && insideQuotes && next === '"') {
      current += '"'
      index += 1
      continue
    }

    if (char === '"') {
      insideQuotes = !insideQuotes
      continue
    }

    if (char === delimiter && !insideQuotes) {
      values.push(current)
      current = ''
      continue
    }

    current += char
  }

  values.push(current)
  return values
}

function normalizeChatText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

function normalizeChatColumn(value: string) {
  return normalizeChatText(value).replace(/[^a-z0-9]/g, '')
}

function findChatColumn(rows: Record<string, string | number | null>[], candidates: string[]) {
  const headers = Object.keys(rows[0] ?? {})
  const normalizedCandidates = candidates.map(normalizeChatColumn)
  const directMatch = headers.find((header) => normalizedCandidates.includes(normalizeChatColumn(header)))
  if (directMatch) return directMatch

  return headers.find((header) => {
    const normalizedHeader = normalizeChatColumn(header)
    return normalizedCandidates.some((candidate) => normalizedHeader.includes(candidate) || candidate.includes(normalizedHeader))
  })
}

function getChatRowValue(row: Record<string, string | number | null>, column: string) {
  return String(row[column] ?? '').trim()
}

function getChatMonthPeriod(year: number, monthNumber: number) {
  const month = chatMonthOptions.find((option) => Number(option.value) === monthNumber)?.label ?? 'Periodo'
  const paddedMonth = String(monthNumber).padStart(2, '0')
  const lastDay = new Date(year, monthNumber, 0).getDate()

  return {
    label: `${month} ${year}`,
    start: `${year}-${paddedMonth}-01`,
    end: `${year}-${paddedMonth}-${String(lastDay).padStart(2, '0')}`,
  }
}

function buildChatMetricRowsFromSheets({
  satisfactionRows,
  inactiveRows,
  analysts,
  year,
  monthNumber,
  monthLabel,
  periodStart,
  periodEnd,
}: {
  satisfactionRows: Record<string, string | number | null>[]
  inactiveRows: Record<string, string | number | null>[]
  analysts: ChatAnalyst[]
  year: number
  monthNumber: number
  monthLabel: string
  periodStart: string
  periodEnd: string
}) {
  const satisfactionAnalystColumn = findChatColumn(satisfactionRows, [
    'Nome do atribuido',
    'Atribuido',
    'Assignee',
    'Responsavel',
    'Nome do agente',
    'Analista',
  ])
  const satisfactionRatingColumn = findChatColumn(satisfactionRows, [
    'Indice de satisfacao do ticket Boa Ruim vazio',
    'Indice de satisfacao do ticket',
    'Satisfacao',
    'CSAT',
    'Rating',
    'Avaliacao',
  ])
  const inactiveAnalystColumn = findChatColumn(inactiveRows, [
    'Nome do atribuido',
    'Atribuido',
    'Assignee',
    'Responsavel',
    'Nome do agente',
    'Analista',
  ])

  if (!satisfactionAnalystColumn) throw new Error('Nao encontrei a coluna do analista na planilha de satisfacao.')
  if (!satisfactionRatingColumn) throw new Error('Nao encontrei a coluna de satisfacao/avaliacao na planilha de satisfacao.')
  if (!inactiveAnalystColumn) throw new Error('Nao encontrei a coluna do analista na planilha de inatividade.')

  return analysts
    .filter((analyst) => analyst.active)
    .map((analyst): ChatMetricImportRecord | null => {
      const analystName = normalizeChatText(analyst.name)
      const analystSatisfactionRows = satisfactionRows.filter(
        (row) => normalizeChatText(getChatRowValue(row, satisfactionAnalystColumn)) === analystName,
      )
      const analystInactiveRows = inactiveRows.filter(
        (row) => normalizeChatText(getChatRowValue(row, inactiveAnalystColumn)) === analystName,
      )
      const totalTickets = analystSatisfactionRows.length
      const inactiveTickets = analystInactiveRows.length

      if (!totalTickets) return null

      const validTickets = Math.max(totalTickets - inactiveTickets, 0)
      const ratedRows = analystSatisfactionRows.filter((row) => {
        const rating = normalizeChatText(getChatRowValue(row, satisfactionRatingColumn))
        return rating === 'boa' || rating === 'ruim' || rating === 'good' || rating === 'bad'
      })
      const positiveReviews = ratedRows.filter((row) => {
        const rating = normalizeChatText(getChatRowValue(row, satisfactionRatingColumn))
        return rating === 'boa' || rating === 'good'
      }).length
      const reviews = ratedRows.length
      const negativeReviews = Math.max(reviews - positiveReviews, 0)
      const csat = reviews ? round((positiveReviews / reviews) * 100) : 0
      const reviewPercentage = validTickets ? round((reviews / validTickets) * 100) : 0
      const sendingPercentage = validTickets ? round(((validTickets - reviews) / validTickets) * 100) : 0
      const csatGoal = Number(analyst.csat_goal) || 86
      const generalReviewGoal = 25
      const csatDelta = round(csat - csatGoal)
      const status = getChatMetricStatus(csat, reviewPercentage, csatGoal, generalReviewGoal)

      return {
        team_id: analyst.team_id,
        analyst_id: analyst.id,
        month_label: monthLabel,
        year,
        month_number: monthNumber,
        period_start: periodStart,
        period_end: periodEnd,
        csat,
        review_percentage: reviewPercentage,
        sending_percentage: sendingPercentage,
        total_tickets: totalTickets,
        inactive_tickets: inactiveTickets,
        valid_tickets: validTickets,
        reviews,
        positive_reviews: positiveReviews,
        negative_reviews: negativeReviews,
        csat_goal: csatGoal,
        csat_delta: csatDelta,
        general_review_goal: generalReviewGoal,
        status,
      }
    })
    .filter((record): record is ChatMetricImportRecord => Boolean(record))
}
function calculateChatAverage(
  metrics: ChatMonthlyMetric[],
  field: 'csat' | 'review_percentage' | 'sending_percentage',
) {
  if (!metrics.length) return 0
  return round(metrics.reduce((sum, metric) => sum + Number(metric[field]), 0) / metrics.length)
}

function buildChatRanking(
  metrics: ChatMonthlyMetric[],
  averageTickets: number,
  excludedAnalystIds = new Set<string>(),
) {
  return metrics
    .map((metric) => {
      const reasons = getChatAttentionReasons(metric, averageTickets)
      if (excludedAnalystIds.has(metric.analyst_id)) reasons.push('fora do podio por excecao operacional')

      return {
        metric,
        eligible: reasons.length === 0,
        reasons,
      }
    })
    .sort((a, b) => {
      if (a.eligible !== b.eligible) return a.eligible ? -1 : 1
      if (Number(b.metric.csat) !== Number(a.metric.csat)) return Number(b.metric.csat) - Number(a.metric.csat)
      if (Number(b.metric.review_percentage) !== Number(a.metric.review_percentage)) {
        return Number(b.metric.review_percentage) - Number(a.metric.review_percentage)
      }
      if (Number(b.metric.total_tickets) !== Number(a.metric.total_tickets)) {
        return Number(b.metric.total_tickets) - Number(a.metric.total_tickets)
      }
      return getChatAnalystName(a.metric).localeCompare(getChatAnalystName(b.metric))
    })
}
function buildChatPodium(metrics: ChatMonthlyMetric[], averageTickets: number) {
  return metrics
    .filter(
      (metric) =>
        Number(metric.csat) >= 90 &&
        Number(metric.review_percentage) >= 25 &&
        Number(metric.total_tickets) >= averageTickets,
    )
    .sort((a, b) => Number(b.csat) - Number(a.csat))
    .slice(0, 3)
}

function getChatMetricStatus(csat: number, reviewPercentage: number, csatGoal: number, reviewGoal = 25) {
  if (csat >= csatGoal && reviewPercentage >= reviewGoal) return 'Meta Superada'
  if (csat >= csatGoal || reviewPercentage >= reviewGoal) return 'Atencao'
  return 'Critico'
}
function getChatAttentionReasons(metric: ChatMonthlyMetric, averageTickets: number) {
  const reasons: string[] = []
  if (Number(metric.csat) < 90) reasons.push('CSAT abaixo de 90%')
  if (Number(metric.review_percentage) < 25) reasons.push('avaliacoes abaixo de 25%')
  if (Number(metric.total_tickets) < averageTickets) reasons.push('volume abaixo da media (' + averageTickets + ' atend.)')
  return reasons
}

function buildChatMonthlyUnifiedTrend(metrics: ChatMonthlyMetric[]) {
  const grouped = new Map<
    string,
    { label: string; year: number; month: number; csatSum: number; reviewsSum: number; sendingSum: number; count: number }
  >()

  metrics.forEach((metric) => {
    const key = `${metric.year}-${metric.month_number}`
    const current = grouped.get(key) ?? {
      label: metric.month_label,
      year: metric.year,
      month: metric.month_number,
      csatSum: 0,
      reviewsSum: 0,
      sendingSum: 0,
      count: 0,
    }

    current.csatSum += Number(metric.csat)
    current.reviewsSum += Number(metric.review_percentage)
    current.sendingSum += Number(metric.sending_percentage)
    current.count += 1
    grouped.set(key, current)
  })

  return [...grouped.values()]
    .sort((a, b) => (a.year === b.year ? a.month - b.month : a.year - b.year))
    .map((item) => ({
      label: item.label.replace(' 2026', ''),
      csat: item.count ? round(item.csatSum / item.count) : 0,
      reviews: item.count ? round(item.reviewsSum / item.count) : 0,
      sending: item.count ? round(item.sendingSum / item.count) : 0,
    }))
}

function buildChatMonthlyTrend(metrics: ChatMonthlyMetric[]) {
  const grouped = new Map<string, { label: string; year: number; month: number; csatSum: number; count: number }>()
  metrics.forEach((metric) => {
    const key = `${metric.year}-${metric.month_number}`
    const current = grouped.get(key) ?? {
      label: metric.month_label,
      year: metric.year,
      month: metric.month_number,
      csatSum: 0,
      count: 0,
    }
    current.csatSum += Number(metric.csat)
    current.count += 1
    grouped.set(key, current)
  })

  return [...grouped.values()]
    .sort((a, b) => (a.year === b.year ? a.month - b.month : a.year - b.year))
    .map((item) => ({
      label: item.label.replace(' 2026', ''),
      value: item.count ? round(item.csatSum / item.count) : 0,
    }))
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

function getPreviousPeriod(period: PeriodFilter): PeriodFilter {
  if (!period.start || !period.end) return period

  const start = new Date(`${period.start}T00:00:00`)
  const end = new Date(`${period.end}T00:00:00`)
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1)
  const previousEnd = addDays(start, -1)
  const previousStart = addDays(previousEnd, -(days - 1))

  return {
    mode: 'custom',
    start: toDateInputValue(previousStart),
    end: toDateInputValue(previousEnd),
  }
}

function calculateTeamPerformance(metrics: TeamMetric[]) {
  if (!metrics.length) return 0

  const answered = metrics.reduce((sum, metric) => sum + Number(metric.answered_calls), 0)
  const total = metrics.reduce((sum, metric) => sum + Number(metric.total_calls), 0)

  return total ? round((answered / total) * 100) : 0
}

function formatDelta(value: number, suffix = '') {
  if (!value) return `0${suffix}`

  return `${value > 0 ? '+' : ''}${value}${suffix}`
}

function getTrendText(delta: number) {
  if (delta > 1) return 'crescimento frente ao periodo anterior'
  if (delta < -1) return 'queda frente ao periodo anterior'
  return 'estabilidade frente ao periodo anterior'
}

function buildDevelopmentFocus(result: MonthlyPodiumResult, delta: number) {
  if (result.eligible && delta >= 0) {
    return 'manter consistencia, proteger volume de avaliacoes e preparar boas praticas para compartilhar com a equipe.'
  }

  if (result.reviewPercentage < 25) {
    return 'aumentar o percentual de avaliacoes, reforcando o convite ao final dos atendimentos e acompanhando o volume semanal.'
  }

  if (result.averageCsat < result.individualGoal) {
    return 'revisar atendimentos com menor satisfacao e escolher uma acao objetiva de melhoria para a proxima semana.'
  }

  if (delta < 0) {
    return 'investigar a queda recente e comparar os casos do periodo atual com o ciclo anterior.'
  }

  return 'manter acompanhamento semanal e buscar estabilidade ate o fechamento do ciclo.'
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

function isEndBeforeStart(start: string, end: string) {
  if (!start || !end) return false
  return end < start
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

  if (error && typeof error === 'object') {
    const supabaseError = error as {
      message?: string
      details?: string
      hint?: string
      code?: string
    }
    const parts = [supabaseError.message, supabaseError.details, supabaseError.hint, supabaseError.code]
      .filter(Boolean)
      .map(String)

    if (parts.length) return parts.join(' | ')
  }

  return 'Nao foi possivel concluir a acao. Tente novamente.'
}

function getSupabaseMessage(message: string) {
  if (message.toLowerCase().includes('jwt issued at future')) return ''
  return message
}
















































