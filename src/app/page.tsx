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
  photo_url?: string | null
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
        photo_url?: string | null
      }
    | {
        name: string
        photo_url?: string | null
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
  overall_csat: number | null
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
  photo_url?: string | null
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
        photo_url?: string | null
      }
    | {
        name: string
        csat_goal: number
        photo_url?: string | null
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
  overallCsat: string
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
  team_average_tickets?: number
  team_average_csat?: number
}
type PeriodMode = 'week' | 'month' | 'year' | 'custom'

type PeriodFilter = {
  mode: PeriodMode
  start: string
  end: string
}

type AppModule = 'phone' | 'chat'

type ChatFeedbackStyle = 'coach' | 'sare' | 'mimo'
type FeedbackGoal = 'recognition' | 'courseCorrection' | 'maintenance' | 'development'
type FeedbackTone = 'human' | 'direct' | 'executive'

type ActiveTab = 'dashboard' | 'reports' | 'analysts' | 'goals' | 'entries' | 'users'

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
  overallCsat: '',
  notes: '',
  evidenceFile: null,
}

const initialAnalystForm = {
  name: '',
  csatGoal: '86',
  photoFile: null as File | null,
}

const initialGoalForm = {
  label: '',
  value: '',
  unit: 'percent',
  active: true,
}

const initialAccessUserForm = {
  fullName: '',
  email: '',
  password: '',
  role: 'analista',
  analystId: '',
}

const ANALYST_PHOTO_BUCKET = 'analyst-photos'
const MAX_ANALYST_PHOTO_SIZE = 5 * 1024 * 1024
const ACCEPTED_ANALYST_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp']

async function uploadAnalystPhoto(file: File, scope: 'phone' | 'chat', analystId: string) {
  if (!ACCEPTED_ANALYST_PHOTO_TYPES.includes(file.type)) {
    throw new Error('Use uma imagem PNG, JPG ou WEBP.')
  }
  if (file.size > MAX_ANALYST_PHOTO_SIZE) {
    throw new Error('A foto deve ter no máximo 5 MB.')
  }

  const extension = file.name.split('.').pop()?.toLowerCase() || 'jpg'
  const path = `${scope}/${analystId}/profile.${extension}`
  const { error } = await supabase.storage.from(ANALYST_PHOTO_BUCKET).upload(path, file, {
    cacheControl: '3600',
    contentType: file.type,
    upsert: true,
  })
  if (error) throw error

  const { data } = supabase.storage.from(ANALYST_PHOTO_BUCKET).getPublicUrl(path)
  return `${data.publicUrl}?v=${Date.now()}`
}

export default function Home() {
  const [user, setUser] = useState<User | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [goals, setGoals] = useState<Goal[]>([])
  const [profiles, setProfiles] = useState<UserProfile[]>([])
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
  const [accessUserForm, setAccessUserForm] = useState(initialAccessUserForm)
  const [editingProfileNameId, setEditingProfileNameId] = useState<string | null>(null)
  const [profileNameForm, setProfileNameForm] = useState('')
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
        setMessage('Digite uma nova senha para concluir a recuperação.')
      }
      if (!data.user) setLoading(false)
    }

    loadSession()

    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setUser(session?.user ?? null)
        setIsPasswordRecovery(true)
        setMessage('Digite uma nova senha para concluir a recuperação.')
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

    const [profileResult, profilesResult, goalsResult, analystsResult] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', user.id).maybeSingle(),
      supabase.from('profiles').select('*').order('full_name'),
      supabase.from('goals').select('id, key, label, value, unit, active').order('label'),
      supabase.from('analysts').select('id, name, active, csat_goal, photo_url').order('name'),
    ])

    const loadedProfile = (profileResult.data as UserProfile | null) ?? null
    const loadedAnalysts = analystsResult.data ?? []
    const loadedRole = normalizeUserRole(loadedProfile?.role)
    const loadedProfileAnalystId = getProfileAnalystId(loadedProfile, loadedAnalysts, user.email ?? '')

    if (profileResult.error) setMessage(getSupabaseMessage(profileResult.error.message))
    else setProfile(loadedProfile)

    if (profilesResult.error) setProfiles([])
    else setProfiles((profilesResult.data ?? []) as UserProfile[])

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
      .select('id, analyst_id, week_start, week_end, csat, total_reviews, positive_reviews, negative_reviews, review_percentage, total_tickets, evidence_url, notes, analysts(name, photo_url)')
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
        .select('id, week_start, week_end, answered_calls, abandoned_calls, total_calls, performance_percentage, overall_csat, evidence_url, notes')
        .order('week_start', { ascending: false })
        .limit(52),
    ])

    if (individualResult.error) setMessage(getSupabaseMessage(individualResult.error.message))
    else setIndividualMetrics((individualResult.data ?? []) as IndividualMetric[])

    if (teamResult.error) setMessage(getSupabaseMessage(teamResult.error.message))
    else setTeamMetrics(teamResult.data ?? [])

    const [chatTeamsResult, chatAnalystsResult, chatMetricsResult, chatManualPodiumResult, chatExclusionsResult] = await Promise.all([
      supabase.from('chat_teams').select('id, name, legacy_name, manager_name, active').order('name'),
      supabase.from('chat_analysts').select('id, team_id, name, csat_goal, active, photo_url').order('name'),
      supabase
        .from('chat_monthly_metrics')
        .select('id, team_id, analyst_id, month_label, year, month_number, period_start, period_end, csat, review_percentage, sending_percentage, total_tickets, inactive_tickets, valid_tickets, reviews, positive_reviews, negative_reviews, csat_goal, csat_delta, general_review_goal, status, chat_analysts(name, csat_goal, photo_url), chat_teams(name)')
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
    if (activeModule !== 'phone') setActiveModule('phone')
    if (activeTab !== 'dashboard') setActiveTab('dashboard')
  }, [activeModule, activeTab, isManagementUser])

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
    setProfiles([])
    setAnalysts([])
    setIndividualMetrics([])
    setTeamMetrics([])
  }

  async function handleCreateAccessUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setMessage('Criando usuario de acesso...')

    try {
      if (accessUserForm.password.length < 6) {
        setMessage('A senha temporaria precisa ter pelo menos 6 caracteres.')
        return
      }

      if (accessUserForm.role === 'analista' && !accessUserForm.analystId) {
        setMessage('Selecione o analista que sera vinculado a este usuario.')
        return
      }

      const { data: sessionData } = await supabase.auth.getSession()
      const accessToken = sessionData.session?.access_token

      if (!accessToken) {
        setMessage('Sessao expirada. Entre novamente para criar usuarios.')
        return
      }

      const response = await fetch('/api/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          fullName: accessUserForm.fullName.trim(),
          email: accessUserForm.email.trim(),
          password: accessUserForm.password,
          role: accessUserForm.role,
          analystId: accessUserForm.role === 'analista' ? accessUserForm.analystId : null,
        }),
      })

      const result = await response.json().catch(() => ({}))

      if (!response.ok) {
        setMessage(result.error ?? 'Não foi possível criar o usuario.')
        return
      }

      setAccessUserForm(initialAccessUserForm)
      setMessage(result.message ?? 'Usuario criado com sucesso.')
      await loadData()
    } catch (error) {
      setMessage(getErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  function handleEditProfileName(profile: UserProfile) {
    setEditingProfileNameId(profile.id)
    setProfileNameForm(profile.full_name || profile.name || '')
    setMessage('')
  }

  function handleCancelProfileNameEdit() {
    setEditingProfileNameId(null)
    setProfileNameForm('')
    setMessage('')
  }

  async function handleSaveProfileName(profileId: string) {
    const fullName = profileNameForm.trim()

    if (!fullName) {
      setMessage('Informe o nome exibido do usuario.')
      return
    }

    setSaving(true)
    setMessage('Atualizando nome do usuario...')

    const { error } = await supabase
      .from('profiles')
      .update({ full_name: fullName })
      .eq('id', profileId)

    setSaving(false)

    if (error) {
      setMessage(getSupabaseMessage(error.message))
      return
    }

    setEditingProfileNameId(null)
    setProfileNameForm('')
    setMessage('Nome do usuario atualizado com sucesso.')
    await loadData()
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
              .select('id, name, active, csat_goal, photo_url')
              .single(),
            'O Supabase demorou para atualizar o analista. Tente novamente.',
          )
        : await withTimeout(
            supabase
              .from('analysts')
              .insert({ ...payload, active: true })
              .select('id, name, active, csat_goal, photo_url')
              .single(),
            'O Supabase demorou para incluir o analista. Tente novamente.',
          )

      if (result.error) setMessage(result.error.message)
      else {
        let savedAnalyst = result.data as Analyst
        if (analystForm.photoFile) {
          const photoUrl = await uploadAnalystPhoto(analystForm.photoFile, 'phone', savedAnalyst.id)
          const photoResult = await supabase
            .from('analysts')
            .update({ photo_url: photoUrl })
            .eq('id', savedAnalyst.id)
            .select('id, name, active, csat_goal, photo_url')
            .single()
          if (photoResult.error) throw photoResult.error
          savedAnalyst = photoResult.data as Analyst
        }
        setMessage(editingAnalystId ? 'Analista atualizado com sucesso.' : 'Analista incluido com sucesso.')
        setAnalysts((current) => upsertAnalyst(current, savedAnalyst))
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
      photoFile: null,
    })
    setEditingAnalystId(analyst.id)
  }

  function handleCancelAnalystEdit() {
    setAnalystForm(initialAnalystForm)
    setEditingAnalystId(null)
  }

  async function handleRemoveAnalystPhoto(analyst: Analyst) {
    if (!window.confirm(`Remover a foto personalizada de ${analyst.name}?`)) return
    setSaving(true)
    const { error } = await supabase.from('analysts').update({ photo_url: null }).eq('id', analyst.id)
    setSaving(false)
    if (error) {
      setMessage(getSupabaseMessage(error.message))
      return
    }
    setAnalysts((current) => current.map((item) => item.id === analyst.id ? { ...item, photo_url: null } : item))
    setMessage('Foto personalizada removida. A imagem inicial ou as iniciais serão exibidas.')
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
          .select('id, name, active, csat_goal, photo_url')
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
      `Excluir ${analyst.name}? Se ele tiver historico de lançamentos, prefira inativar para preservar os relatórios.`,
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
        setMessage('Não foi possível excluir. Se existir historico, use Inativar para preservar os dados.')
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
        setMessage('O total de avaliações nao pode ser maior que o total de atendimentos.')
        return
      }

      const alreadyExists = individualMetrics.some(
        (metric) =>
          metric.analyst_id === individualForm.analystId &&
          metric.week_start === individualForm.weekStart &&
          metric.week_end === individualForm.weekEnd,
      )

      if (alreadyExists) {
        setMessage('Já existe lançamento para este analista neste mesmo período.')
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
      setMessage(`Não foi possível salvar a evidencia ou o lançamento: ${getErrorMessage(error)}`)
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
      const overallCsat = toNumber(teamForm.overallCsat)

      if (isEndBeforeStart(teamForm.weekStart, teamForm.weekEnd)) {
        setMessage('A data final nao pode ser menor que a data inicial.')
        return
      }

      if (answeredCalls > totalCalls) {
        setMessage('Ligações atendidas nao pode ser maior que o total processado.')
        return
      }

      const alreadyExists = teamMetrics.some(
        (metric) =>
          metric.week_start === teamForm.weekStart &&
          metric.week_end === teamForm.weekEnd,
      )

      if (alreadyExists) {
        setMessage('Já existe performance da equipe neste mesmo período.')
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
        overall_csat: overallCsat,
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
      setMessage(`Não foi possível salvar a evidencia ou a performance: ${getErrorMessage(error)}`)
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteIndividualMetric(metric: IndividualMetric) {
    const analystName = getAnalystName(metric.analysts)
    const confirmed = window.confirm(
      `Excluir o lançamento individual de ${analystName} da semana ${formatWeek(metric.week_start, metric.week_end)}?`,
    )

    if (!confirmed) return

    setSaving(true)
    setMessage('')

    try {
      const { error } = await withTimeout(
        supabase.from('weekly_individual_metrics').delete().eq('id', metric.id),
        'O Supabase demorou para excluir o lançamento. Tente novamente.',
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

  async function handleUpdateTeamOverallCsat(metric: TeamMetric, overallCsat: number) {
    if (!Number.isFinite(overallCsat) || overallCsat < 0 || overallCsat > 100) {
      setMessage('Informe um CSAT geral entre 0 e 100%.')
      return
    }

    setSaving(true)
    setMessage('')

    try {
      const { error } = await withTimeout(
        supabase.from('weekly_team_metrics').update({ overall_csat: overallCsat }).eq('id', metric.id),
        'O Supabase demorou para atualizar o CSAT geral. Tente novamente.',
      )

      if (error) setMessage(error.message)
      else {
        setMessage(`CSAT geral da semana ${formatWeek(metric.week_start, metric.week_end)} atualizado com sucesso.`)
        setTeamMetrics((current) =>
          current.map((item) => (item.id === metric.id ? { ...item, overall_csat: overallCsat } : item)),
        )
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
              Painel interno para acompanhar metas, analistas, lançamentos semanais,
              performance da equipe e próximas análises com IA.
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

        {isManagementUser && (
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
              <small>Dashboard, lançamentos, metas, pódio, SARE e IA preditiva.</small>
            </button>
            <button
              className={activeModule === 'chat' ? 'module-card-active' : 'module-card'}
              type="button"
              onClick={() => setActiveModule('chat')}
            >
              <span>Modulo chat</span>
              <strong>Performance de atendimento via chat</strong>
              <small>Dados do Zendesk, importação mensal, ranking, pódio e relatórios individuais.</small>
            </button>
          </div>
        )}
        {activeModule === 'phone' && (
          <nav className="mt-6 flex flex-wrap gap-2">
          <TabButton active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')}>
            Dashboard
          </TabButton>
          {isManagementUser && (
            <TabButton active={activeTab === 'reports'} onClick={() => setActiveTab('reports')}>
              Relatorios
            </TabButton>
          )}
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
              <TabButton active={activeTab === 'users'} onClick={() => setActiveTab('users')}>
                Usuarios
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

        {activeModule === 'phone' && isManagementUser && activeTab === 'reports' && (
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
            onUpdateTeamOverallCsat={handleUpdateTeamOverallCsat}
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
            onRemoveAnalystPhoto={handleRemoveAnalystPhoto}
          />
        )}

        {activeModule === 'phone' && isManagementUser && activeTab === 'users' && (
          <UsersView
            profiles={profiles}
            analysts={analysts}
            form={accessUserForm}
            editingProfileNameId={editingProfileNameId}
            profileNameForm={profileNameForm}
            saving={saving}
            onChange={setAccessUserForm}
            onProfileNameChange={setProfileNameForm}
            onSubmit={handleCreateAccessUser}
            onEditProfileName={handleEditProfileName}
            onCancelProfileNameEdit={handleCancelProfileNameEdit}
            onSaveProfileName={handleSaveProfileName}
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
  const [chatFeedbackGoal, setChatFeedbackGoal] = useState<FeedbackGoal>('recognition')
  const [chatFeedbackTone, setChatFeedbackTone] = useState<FeedbackTone>('human')
  const [chatManagerNotes, setChatManagerNotes] = useState('')
  const [chatFeedbackDraft, setChatFeedbackDraft] = useState('')
  const [chatAiSaving, setChatAiSaving] = useState(false)
  const [selectedChatReportMetricId, setSelectedChatReportMetricId] = useState('')
  const [chatActiveTab, setChatActiveTab] = useState<'overview' | 'podium' | 'analysis' | 'reports' | 'import' | 'settings' | 'base'>('overview')
  const [manualPodiumDraft, setManualPodiumDraft] = useState<Record<number, string>>({})
  const [chatPodiumMessage, setChatPodiumMessage] = useState('')
  const [chatAnalystForm, setChatAnalystForm] = useState({ teamId: '', name: '', csatGoal: '86', photoFile: null as File | null })
  const [editingChatAnalystId, setEditingChatAnalystId] = useState<string | null>(null)
  const [chatAnalystSaving, setChatAnalystSaving] = useState(false)
  const [chatAnalystMessage, setChatAnalystMessage] = useState('')
  async function handleChatMonthlyImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setChatImportMessage('')

    if (!chatSatisfactionFile || !chatInactiveFile) {
      setChatImportMessage('Selecione a planilha de satisfação e a planilha de inativos antes de importar.')
      return
    }

    const year = Number(chatImportYear)
    const monthNumber = Number(chatImportMonth)

    if (!year || !monthNumber || monthNumber < 1 || monthNumber > 12) {
      setChatImportMessage('Informe um mes e ano válidos para a importação.')
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
      setChatImportMessage(`Importação concluida: ${importRows.length} analistas processados para ${period.label}.`)
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
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-cyan-300">Módulo chat</p>
          <h2 className="mt-3 text-3xl font-bold">Acesso restrito a gestão</h2>
          <p className="mt-3 max-w-3xl text-slate-300">
            O modulo chat sera usado para importação mensal, calculos consolidados, ranking, pódio e relatórios individuais.
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
  const chatReviewRate = totals.validTickets ? round((totals.reviews / totals.validTickets) * 100) : 0
  const chatSendingRate = totals.validTickets ? round(((totals.validTickets - totals.reviews) / totals.validTickets) * 100) : 0
  const chatInactiveRate = totals.tickets ? round((totals.inactive / totals.tickets) * 100) : 0
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
        managerNotes: '',
      })
    : ''
  const chatExecutiveStatus =
    !visibleMetrics.length
      ? 'Sem dados no período'
      : averageCsat >= 90 && averageReviews >= 25
        ? 'Operação saudavel'
        : averageCsat < 85 || averageReviews < 20 || attention.length >= 3
          ? 'Acompanhamento prioritario'
          : 'Periodo em atenção'
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
      ? 'Selecione outro período ou aguarde a importação mensal.'
      : averageCsat < 85
        ? 'A qualidade do atendimento tem espaco para evolução.'
        : averageCsat < 90
          ? 'CSAT abaixo da referência de pódio do chat.'
          : averageReviews < 20
            ? 'A participação dos clientes nas pesquisas precisa ser ampliada.'
            : averageReviews < 25
              ? 'Avaliações abaixo do mínimo usado para elegibilidade ao pódio.'
              : attention.length
                ? 'Há analistas com pelo menos um critério fora da referência.'
                : 'Equipe alinhada com os critérios principais do período.'

  const chatRecommendedAction =
    !visibleMetrics.length
      ? 'Importar ou selecionar um mes com dados.'
      : averageCsat < 90
        ? 'Revisar atendimentos negativos e direcionar feedback dos analistas em atenção.'
        : averageReviews < 25
          ? 'Reforcar convite para avaliação e acompanhar volume de respostas no próximo ciclo.'
          : attention.length
            ? 'Priorizar os analistas listados em atenção antes do próximo fechamento.'
            : 'Manter rotina atual e acompanhar se o resultado se sustenta no mes seguinte.'
  const chatEligibleCount = chatRanking.filter((item) => item.eligible).length
  const chatVisualRows = chatRanking.slice(0, 10).map((item) => ({
    label: getChatAnalystName(item.metric),
    primary: Number(item.metric.csat),
    secondary: Number(item.metric.review_percentage),
    volume: Number(item.metric.total_tickets),
    status: item.eligible ? 'Elegivel' : item.reasons.join(', '),
  }))
  const chatVisualPoints = chatRanking.map((item) => ({
    label: getChatAnalystName(item.metric),
    x: Number(item.metric.total_tickets),
    y: Number(item.metric.csat),
    tone: item.eligible ? 'success' : Number(item.metric.csat) < 90 ? 'danger' : 'warning',
    detail: `${item.metric.review_percentage}% avaliações`,
  }))
  const chatTopHighlight = chatRanking.find((item) => item.eligible)?.metric ?? chatRanking[0]?.metric ?? null
  const chatAttentionHighlight = chatOpportunities[0]?.metric ?? null
  const chatAttentionText = chatOpportunities[0]?.reasons.join(', ') ?? 'Sem alerta crítico no período.'
  const chatClosureReading =
    !visibleMetrics.length
      ? 'Ainda não há base suficiente para leitura executiva.'
      : chatEligibleCount >= 3 && !chatCriticalCount
        ? 'Fechamento forte: há pódio completo e nenhum caso crítico no período.'
        : chatEligibleCount > 0
          ? 'Fechamento positivo, com oportunidade de ampliar a quantidade de elegíveis ao pódio.'
          : 'Fechamento pede atenção: nenhum analista ficou plenamente elegível ao pódio.'

  const chatBelowVolumeItems = chatRanking.filter((item) => item.reasons.some((reason) => reason.includes('volume abaixo')))
  const chatBelowCsatMetrics = visibleMetrics.filter((metric) => Number(metric.csat) < 90)
  const chatBelowReviewMetrics = visibleMetrics.filter((metric) => Number(metric.review_percentage) < Number(metric.general_review_goal))
  const chatCriticalMetrics = visibleMetrics.filter((metric) => metric.status === 'Critico')
  const chatEligibleItems = chatRanking.filter((item) => item.eligible)
  const chatFunnelItems = [
    {
      label: 'Base analisada',
      value: visibleMetrics.length,
      detail: 'Analistas com dados no período.',
    },
    {
      label: 'CSAT mínimo',
      value: visibleMetrics.filter((metric) => Number(metric.csat) >= 90).length,
      detail: 'Mantêm qualidade percebida acima de 90%.',
    },
    {
      label: 'Avaliações',
      value: visibleMetrics.filter((metric) => Number(metric.review_percentage) >= Number(metric.general_review_goal)).length,
      detail: 'Têm amostra de avaliações dentro da referência.',
    },
    {
      label: 'Volume',
      value: visibleMetrics.filter((metric) => Number(metric.total_tickets) >= averageTickets).length,
      detail: `Atendem pelo menos a média de ${averageTickets} atendimentos.`,
    },
    {
      label: 'Elegíveis',
      value: chatEligibleCount,
      detail: 'Cumpriram todos os critérios ao mesmo tempo.',
      tone: 'success' as const,
    },
  ]
  const chatBelowVolumeCount = chatBelowVolumeItems.length
  const chatBelowCsatCount = chatBelowCsatMetrics.length
  const chatBelowReviewCount = chatBelowReviewMetrics.length
  const chatNameList = (names: string[]) => {
    if (!names.length) return 'nenhum analista'
    if (names.length === 1) return names[0]
    if (names.length === 2) return `${names[0]} e ${names[1]}`
    return `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`
  }
  const chatBelowCsatNames = chatBelowCsatMetrics.slice(0, 3).map(getChatAnalystName)
  const chatBelowReviewNames = chatBelowReviewMetrics.slice(0, 3).map(getChatAnalystName)
  const chatBelowVolumeNames = chatBelowVolumeItems.slice(0, 3).map((item) => getChatAnalystName(item.metric))
  const chatCriticalNames = chatCriticalMetrics.slice(0, 3).map(getChatAnalystName)
  const chatEligibleNames = chatEligibleItems.slice(0, 3).map((item) => getChatAnalystName(item.metric))
  const chatManagementDiagnosis =
    !visibleMetrics.length
      ? 'Sem base importada para o período selecionado.'
      : chatCriticalCount > 0
        ? `Há risco real de fechamento: ${chatNameList(chatCriticalNames)} precisam de tratativa antes da comunicação final.`
        : averageCsat < 90
          ? `O principal risco está na qualidade percebida. ${chatBelowCsatCount} analista(s) ficaram abaixo de 90% de CSAT, começando por ${chatNameList(chatBelowCsatNames)}.`
          : averageReviews < 25
            ? `A qualidade está legível, mas a amostra de avaliações está baixa. Priorize aumento de respostas com ${chatNameList(chatBelowReviewNames)}.`
            : chatBelowVolumeCount > 0
              ? `O fechamento geral é saudável, mas o pódio depende de contexto operacional: ${chatBelowVolumeCount} analista(s) ficaram abaixo da média de ${averageTickets} atendimentos.`
              : 'Fechamento saudável: qualidade, amostra de avaliações e volume sustentam a leitura do período.'
  const chatTacticalPlan = !visibleMetrics.length
    ? ['Importar as planilhas do Zendesk.', 'Conferir se mês, equipe e analistas foram reconhecidos.', 'Selecionar equipe e período para liberar a leitura de gestão.']
    : [
        chatBelowCsatCount
          ? `Qualidade: ouvir 2 interações mal avaliadas de ${chatNameList(chatBelowCsatNames)} e registrar uma orientação objetiva por pessoa.`
          : `Qualidade: usar ${chatNameList(chatEligibleNames)} como referência de abordagem e encerramento para o próximo ciclo.`,
        chatBelowReviewCount
          ? `Avaliações: reforçar com ${chatNameList(chatBelowReviewNames)} a frase de encerramento e conferir se o convite está sendo enviado no momento correto.`
          : 'Avaliações: manter o ritual de encerramento que preservou a amostra acima da referência de 25%.',
        chatBelowVolumeCount
          ? `Volume: validar ${chatNameList(chatBelowVolumeNames)} contra escala, ausência, empréstimo para outro setor ou distribuição de fila antes de fechar o pódio.`
          : 'Volume: manter a distribuição atual e monitorar apenas exceções operacionais.',
      ]
  const chatStrategicDecision =
    !visibleMetrics.length
      ? 'Decisão recomendada: aguardar a importação mensal antes de definir plano de gestão.'
      : chatCriticalCount > 0
        ? `Decisão recomendada: tratar ${chatNameList(chatCriticalNames)} como prioridade de gestão antes de publicar o fechamento.`
        : chatEligibleCount >= 3
          ? `Decisão recomendada: validar o pódio, reconhecer ${chatNameList(chatEligibleNames)} e transformar as práticas vencedoras em padrão do próximo ciclo.`
          : 'Decisão recomendada: separar exceções operacionais de desempenho real e focar o próximo ciclo em ampliar elegíveis ao pódio.'
  const chatStrategicTrend =
    !visibleMetrics.length
      ? 'Sem tendência calculada.'
      : chatCsatDelta >= 0 && chatReviewDelta >= 0
        ? 'Tendência favorável: qualidade e amostra melhoraram contra o mês anterior; preserve o que funcionou.'
        : chatCsatDelta < 0 && chatReviewDelta < 0
          ? 'Tendência de atenção: qualidade e amostra pioraram juntas; faça revisão de causa antes do fechamento.'
          : chatCsatDelta < 0
            ? 'Tendência de qualidade: priorize leitura dos atendimentos negativos e alinhe comportamento de atendimento.'
            : 'Tendência de amostra: o desafio não é só qualidade, é conseguir mais clientes respondendo à avaliação.'

  const chatMonthlyContextCards = [
    {
      label: 'Mes analisado',
      value: selectedPeriod?.label ?? 'Periodo',
      detail: selectedTeamName,
    },
    {
      label: 'Comparativo',
      value: previousPeriod?.label ?? 'Sem mes anterior',
      detail: previousPeriod
        ? 'Leitura comparada com o fechamento mensal anterior da mesma equipe.'
        : 'Importe meses anteriores para liberar tendencia e comparação.',
    },
    {
      label: 'Base Zendesk',
      value: `${visibleMetrics.length} analista(s)`,
      detail: `${totals.tickets} atendimentos, ${totals.validTickets} válidos e ${totals.reviews} avaliações.`,
    },
  ]

  const chatMonthlyManagementCards = [
    {
      label: 'Reconhecimento',
      title:
        chatEligibleCount >= 3
          ? 'Podio sustentado'
          : chatEligibleCount > 0
            ? 'Há destaques para reconhecer'
            : 'Reconhecimento seletivo',
      text:
        chatEligibleCount >= 3
          ? `Reconhecer o pódio e usar ${chatNameList(chatEligibleNames)} como referência de comportamento para o próximo mes.`
          : chatEligibleCount > 0
            ? `Reconhecer ${chatNameList(chatEligibleNames)} e separar o que foi pratica individual do que foi contexto operacional.`
            : 'Sem pódio completo no período; reconhecer evolucoes pontuais e evitar premiar sem cumprir os critérios.',
    },
    {
      label: 'Acompanhamento',
      title: chatOpportunities.length ? 'Priorizar analistas em atenção' : 'Sem fila crítica de acompanhamento',
      text: chatOpportunities.length
        ? `Comecar por ${chatNameList(chatOpportunities.slice(0, 3).map((item) => getChatAnalystName(item.metric)))} e registrar uma ação objetiva por indicador pendente.`
        : 'Manter acompanhamento leve e preservar o padrao que sustentou o fechamento.',
    },
    {
      label: 'Excecoes operacionais',
      title: chatBelowVolumeCount ? 'Validar volume antes do pódio' : 'Volume sem excecao relevante',
      text: chatBelowVolumeCount
        ? `Antes de fechar o pódio, validar se ${chatNameList(chatBelowVolumeNames)} tiveram emprestimo, ausencia, cobertura ou distribuicao diferente de fila.`
        : 'Não ha alerta relevante de volume abaixo da média para justificar excecao operacional.',
    },
    {
      label: 'Proximo fechamento',
      title: averageCsat >= 90 && averageReviews >= 25 ? 'Proteger padrao' : 'Corrigir base do indicador',
      text:
        averageCsat >= 90 && averageReviews >= 25
          ? 'No próximo mes, acompanhar se CSAT e amostra continuam sustentados sem depender apenas de um ou dois destaques.'
          : 'No próximo mes, definir uma prioridade: qualidade se CSAT caiu, amostra se avaliações ficaram baixas, ou volume se houve distorcao operacional.',
    },
  ]

  function resetChatAnalystForm() {
    setEditingChatAnalystId(null)
    setChatAnalystForm({ teamId: teams[0]?.id ?? '', name: '', csatGoal: '86', photoFile: null })
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

      const saveResult = editingChatAnalystId
        ? await supabase.from('chat_analysts').update(payload).eq('id', editingChatAnalystId).select('id').single()
        : await supabase.from('chat_analysts').insert({ ...payload, active: true }).select('id').single()

      if (saveResult.error) throw saveResult.error

      if (chatAnalystForm.photoFile) {
        const analystId = editingChatAnalystId ?? saveResult.data.id
        const photoUrl = await uploadAnalystPhoto(chatAnalystForm.photoFile, 'chat', analystId)
        const { error: photoError } = await supabase.from('chat_analysts').update({ photo_url: photoUrl }).eq('id', analystId)
        if (photoError) throw photoError
      }

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
      photoFile: null,
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

  async function handleRemoveChatAnalystPhoto(analyst: ChatAnalyst) {
    if (!window.confirm(`Remover a foto personalizada de ${analyst.name}?`)) return
    setChatAnalystSaving(true)
    const { error } = await supabase.from('chat_analysts').update({ photo_url: null }).eq('id', analyst.id)
    setChatAnalystSaving(false)
    if (error) {
      setChatAnalystMessage(getSupabaseMessage(error.message))
      return
    }
    await onImportComplete()
    setChatAnalystMessage('Foto personalizada removida. A imagem inicial ou as iniciais serão exibidas.')
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
      setChatPodiumMessage('Selecione um período antes de salvar o pódio manual.')
      return
    }

    if (selectedTeamId === 'all') {
      setChatPodiumMessage('Selecione uma equipe especifica para salvar o pódio manual.')
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
      setChatPodiumMessage('Selecione pelo menos um analista para salvar o pódio manual.')
      return
    }

    if (new Set(rows.map((row) => row.analyst_id)).size !== rows.length) {
      setChatPodiumMessage('O mesmo analista nao pode ocupar mais de uma posição.')
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
      setChatPodiumMessage('Podio manual salvo para este período.')
    } catch (error) {
      setChatPodiumMessage(`Erro ao salvar pódio manual: ${getErrorMessage(error)}`)
    }
  }

  async function handleResetChatManualPodium() {
    setChatPodiumMessage('')

    if (!selectedPeriod || selectedTeamId === 'all') {
      setChatPodiumMessage('Selecione uma equipe especifica para resetar o pódio manual.')
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
        setChatExportMessage(`${getChatAnalystName(metric)} voltou a concorrer ao pódio deste período.`)
      } else {
        const reason = window.prompt(
          `Motivo para tirar ${getChatAnalystName(metric)} do pódio deste período:`,
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
        setChatExportMessage(`${getChatAnalystName(metric)} ficou fora do pódio deste período por excecao operacional.`)
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
    setChatExportMessage('Sugestão de feedback gerada. Revise o texto antes de exportar.')
  }

  async function handleGenerateChatFeedbackWithAi() {
    if (!selectedChatReportMetric) {
      setChatExportMessage('Selecione um analista com dados antes de acionar a IA.')
      return
    }

    setChatAiSaving(true)
    setChatExportMessage('Gerando feedback com IA...')

    try {
      const history = metrics
        .filter((historyMetric) => historyMetric.analyst_id === selectedChatReportMetric.analyst_id)
        .sort((a, b) => (a.year === b.year ? a.month_number - b.month_number : a.year - b.year))
        .map((historyMetric) => ({
          monthLabel: historyMetric.month_label,
          csat: Number(historyMetric.csat),
          reviewPercentage: Number(historyMetric.review_percentage),
          sendingPercentage: Number(historyMetric.sending_percentage),
          totalTickets: Number(historyMetric.total_tickets),
        }))
      const response = await fetch('/api/chat-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feedbackStyle: chatFeedbackStyle,
          feedbackGoal: chatFeedbackGoal,
          feedbackTone: chatFeedbackTone,
          generationMode: 'generate',
          periodLabel: selectedPeriod?.label ?? 'Periodo',
          managerNotes: chatManagerNotes,
          fallbackText: chatReportFeedbackSuggestion,
          averageTickets,
          podiumPosition: selectedChatPodiumPosition,
          metric: {
            analystName: getChatAnalystName(selectedChatReportMetric),
            teamName: getChatTeamName(selectedChatReportMetric),
            csat: Number(selectedChatReportMetric.csat),
            reviewPercentage: Number(selectedChatReportMetric.review_percentage),
            sendingPercentage: Number(selectedChatReportMetric.sending_percentage),
            totalTickets: Number(selectedChatReportMetric.total_tickets),
            inactiveTickets: Number(selectedChatReportMetric.inactive_tickets),
            validTickets: Number(selectedChatReportMetric.valid_tickets),
            reviews: Number(selectedChatReportMetric.reviews),
            positiveReviews: Number(selectedChatReportMetric.positive_reviews),
            negativeReviews: Number(selectedChatReportMetric.negative_reviews),
            csatGoal: Number(selectedChatReportMetric.csat_goal),
            reviewGoal: Number(selectedChatReportMetric.general_review_goal),
            status: selectedChatReportMetric.status,
          },
          monthlyHistory: history,
        }),
      })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data?.error || 'Não foi possível gerar feedback com IA.')
      }

      const safeFeedback = normalizeChatReportFeedback(data.feedback, chatReportFeedbackSuggestion, chatFeedbackStyle)
      setChatFeedbackDraft(safeFeedback)
      setChatExportMessage(data.warning || 'Feedback gerado com IA. Revise o texto antes de exportar.')
    } catch (error) {
      setChatExportMessage(getErrorMessage(error))
    } finally {
      setChatAiSaving(false)
    }
  }

  async function handleImproveChatFeedbackWithAi() {
    if (!selectedChatReportMetric) {
      setChatExportMessage('Selecione um analista com dados antes de acionar a IA.')
      return
    }

    const baseFeedback = chatFeedbackDraft.trim() || chatReportFeedbackSuggestion

    if (!baseFeedback.trim()) {
      setChatExportMessage('Gere uma sugestão ou escreva um texto antes de pedir melhoria com IA.')
      return
    }

    setChatAiSaving(true)
    setChatExportMessage('Melhorando texto com IA...')

    try {
      const history = metrics
        .filter((historyMetric) => historyMetric.analyst_id === selectedChatReportMetric.analyst_id)
        .sort((a, b) => (a.year === b.year ? a.month_number - b.month_number : a.year - b.year))
        .map((historyMetric) => ({
          monthLabel: historyMetric.month_label,
          csat: Number(historyMetric.csat),
          reviewPercentage: Number(historyMetric.review_percentage),
          sendingPercentage: Number(historyMetric.sending_percentage),
          totalTickets: Number(historyMetric.total_tickets),
        }))
      const response = await fetch('/api/chat-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feedbackStyle: chatFeedbackStyle,
          feedbackGoal: chatFeedbackGoal,
          feedbackTone: chatFeedbackTone,
          generationMode: 'improve',
          periodLabel: selectedPeriod?.label ?? 'Periodo',
          managerNotes: chatManagerNotes,
          fallbackText: baseFeedback,
          averageTickets,
          podiumPosition: selectedChatPodiumPosition,
          metric: {
            analystName: getChatAnalystName(selectedChatReportMetric),
            teamName: getChatTeamName(selectedChatReportMetric),
            csat: Number(selectedChatReportMetric.csat),
            reviewPercentage: Number(selectedChatReportMetric.review_percentage),
            sendingPercentage: Number(selectedChatReportMetric.sending_percentage),
            totalTickets: Number(selectedChatReportMetric.total_tickets),
            inactiveTickets: Number(selectedChatReportMetric.inactive_tickets),
            validTickets: Number(selectedChatReportMetric.valid_tickets),
            reviews: Number(selectedChatReportMetric.reviews),
            positiveReviews: Number(selectedChatReportMetric.positive_reviews),
            negativeReviews: Number(selectedChatReportMetric.negative_reviews),
            csatGoal: Number(selectedChatReportMetric.csat_goal),
            reviewGoal: Number(selectedChatReportMetric.general_review_goal),
            status: selectedChatReportMetric.status,
          },
          monthlyHistory: history,
        }),
      })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data?.error || 'Não foi possível melhorar o feedback com IA.')
      }

      const safeFeedback = normalizeChatReportFeedback(data.feedback, baseFeedback, chatFeedbackStyle)
      setChatFeedbackDraft(safeFeedback)
      setChatExportMessage(data.warning || 'Texto melhorado com IA. Revise antes de exportar.')
    } catch (error) {
      setChatExportMessage(getErrorMessage(error))
    } finally {
      setChatAiSaving(false)
    }
  }

  function buildChatReportExportPayload() {
    if (!selectedChatReportMetric) return null

    const finalFeedbackText = normalizeChatReportFeedback(chatFeedbackDraft, chatReportFeedbackSuggestion, chatFeedbackStyle)

    return {
      metric: selectedChatReportMetric,
      periodLabel: selectedPeriod?.label ?? 'Periodo',
      averageTickets,
      podiumPosition: selectedChatPodiumPosition,
      monthlyHistory: metrics
        .filter((historyMetric) => historyMetric.analyst_id === selectedChatReportMetric.analyst_id)
        .sort((a, b) => (a.year === b.year ? a.month_number - b.month_number : a.year - b.year)),
      feedbackStyle: chatFeedbackStyle,
      managerNotes: '',
      feedbackText: finalFeedbackText,
      photoUrl: getAnalystPhoto(
        getChatAnalystName(selectedChatReportMetric),
        analysts.find((analyst) => analyst.id === selectedChatReportMetric.analyst_id)?.photo_url,
      ),
    }
  }

  function handleExportChatIndividualReport() {
    const payload = buildChatReportExportPayload()

    if (!payload) {
      setChatExportMessage('Selecione um analista com dados antes de exportar o relatório individual.')
      return
    }

    try {
      const fileName = exportChatIndividualReport(payload)
      setChatExportMessage(`Relatório individual gerado: ${fileName}. Verifique a pasta Downloads.`)
    } catch {
      setChatExportMessage('Não foi possível gerar o relatório individual. Tente novamente ou use outro navegador.')
    }
  }

  return (
    <div className="mt-8 space-y-7">
      <section className="panel">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-cyan-300">Módulo chat</p>
            <h2 className="mt-3 text-3xl font-bold">Performance mensal do chat</h2>
            <p className="section-subtitle">
              Leitura consolidada dos dados históricos e das importações mensais do Zendesk.
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
          Ranking e pódio
        </TabButton>
        <TabButton active={chatActiveTab === 'analysis'} onClick={() => setChatActiveTab('analysis')}>
          Análise
        </TabButton>
        <TabButton active={chatActiveTab === 'reports'} onClick={() => setChatActiveTab('reports')}>
          Relatórios
        </TabButton>
        <TabButton active={chatActiveTab === 'import'} onClick={() => setChatActiveTab('import')}>
          Importação
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
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-cyan-300">Importação mensal</p>
            <h3 className="mt-2 text-2xl font-bold">Atualizar base do chat</h3>
            <p className="section-subtitle">
              Use as planilhas de satisfação e inatividade baixadas do Zendesk. O cálculo segue a regra original do painel do chat.
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
            <Field label="Satisfação">
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
              {chatImportSaving ? 'Importando...' : 'Importar mês'}
            </button>
          </form>
        </div>

        {chatImportMessage && <p className="mt-4 rounded-md bg-slate-900/70 px-4 py-3 text-sm text-slate-200">{chatImportMessage}</p>}
      </section>
      <div className={chatActiveTab === 'overview' ? 'grid gap-4 md:grid-cols-4' : 'hidden'}>
        <MetricCard label="Equipe" value={selectedTeamName} />
        <MetricCard label="CSAT médio" value={loading ? '...' : formatChatPercent(averageCsat)} tone={averageCsat >= 90 ? 'success' : averageCsat >= 85 ? 'warning' : 'danger'} />
        <MetricCard label="% avaliações" value={formatChatPercent(averageReviews)} tone={averageReviews >= 25 ? 'success' : averageReviews >= 20 ? 'warning' : 'danger'} />
        <MetricCard label="Atendimentos" value={formatChatCount(totals.tickets)} />
      </div>

      <CriteriaLegend
        hidden={chatActiveTab !== 'overview'}
        title="Critérios do pódio do chat"
        items={[
          'CSAT mínimo de 90%',
          'Avaliações a partir de 25%',
          `Volume igual ou acima da média da equipe (${formatChatCount(averageTickets)} atendimentos)`,
        ]}
      />

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
              <p>CSAT vs mês anterior</p>
              <strong>{formatDelta(chatCsatDelta, ' p.p.')}</strong>
              <span>Atual: {formatChatPercent(averageCsat)}</span>
            </div>
            <div className="executive-card">
              <p>Avaliações vs mês anterior</p>
              <strong>{formatDelta(chatReviewDelta, ' p.p.')}</strong>
              <span>Atual: {formatChatPercent(averageReviews)}</span>
            </div>
            <div className="executive-card">
              <p>% sem avaliação</p>
              <strong>{formatChatPercent(averageSending)}</strong>
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
            <p className="text-sm text-slate-400">Ação recomendada</p>
            <p className="mt-2 font-semibold">{chatRecommendedAction}</p>
          </div>
          <div className="rounded-lg bg-slate-900 p-4">
            <p className="text-sm text-slate-400">Critério legado</p>
            <p className="mt-2 font-semibold">CSAT 90%, avaliações 25% e volume acima da média.</p>
          </div>
        </div>
      </section>

      <section className={chatActiveTab === 'overview' ? 'panel' : 'hidden'}>
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-cyan-300">Inteligência de gestão</p>
          <h2 className="mt-2 text-2xl font-bold">Três camadas para decidir o próximo movimento</h2>
          <p className="section-subtitle">
            Leitura preditiva local baseada no Zendesk: diagnóstico operacional, plano tático e decisão estratégica para o fechamento mensal.
          </p>
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-3">
          {chatMonthlyContextCards.map((card) => (
            <div key={card.label} className="rounded-lg border border-cyan-400/15 bg-cyan-400/5 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-300">{card.label}</p>
              <p className="mt-2 text-lg font-bold">{card.value}</p>
              <p className="mt-1 text-sm leading-6 text-slate-300">{card.detail}</p>
            </div>
          ))}
        </div>

        <div className="mt-5 grid gap-4 xl:grid-cols-3">
          <div className="rounded-lg bg-slate-900 p-5">
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-cyan-300">1. Operacional</p>
            <h3 className="mt-3 text-xl font-bold">Diagnóstico</h3>
            <p className="mt-3 text-sm leading-6 text-slate-300">{chatManagementDiagnosis}</p>
            <div className="mt-4 grid gap-2 text-sm text-slate-300">
              <span>CSAT médio: <strong>{formatChatPercent(averageCsat)}</strong></span>
              <span>Avaliações: <strong>{formatChatPercent(averageReviews)}</strong></span>
              <span>Sem avaliação: <strong>{formatChatPercent(averageSending)}</strong></span>
              <span>Inativos: <strong>{formatChatPercent(chatInactiveRate)}</strong></span>
            </div>
          </div>

          <div className="rounded-lg bg-slate-900 p-5">
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-cyan-300">2. Tática</p>
            <h3 className="mt-3 text-xl font-bold">Plano de ação</h3>
            <ul className="mt-3 space-y-3 text-sm leading-6 text-slate-300">
              {chatTacticalPlan.map((item) => (
                <li key={item} className="rounded-md bg-slate-950/70 px-3 py-2">{item}</li>
              ))}
            </ul>
          </div>

          <div className="rounded-lg bg-slate-900 p-5">
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-cyan-300">3. Estratégica</p>
            <h3 className="mt-3 text-xl font-bold">Decisão recomendada</h3>
            <p className="mt-3 text-sm leading-6 text-slate-300">{chatStrategicDecision}</p>
            <p className="mt-4 rounded-md bg-cyan-400/10 px-3 py-2 text-sm font-semibold text-cyan-100">{chatStrategicTrend}</p>
          </div>
        </div>
      </section>

      <section className={chatActiveTab === 'overview' ? 'panel' : 'hidden'}>
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-cyan-300">Inteligência do fechamento mensal</p>
          <h2 className="mt-2 text-2xl font-bold">Acoes de gestão para o próximo ciclo</h2>
          <p className="section-subtitle">
            Leitura desenhada para o uso real do chat: fechamento mensal, reconhecimento, excecoes operacionais e plano do próximo mes.
          </p>
        </div>

        <div className="mt-5 grid gap-4 xl:grid-cols-4">
          {chatMonthlyManagementCards.map((card) => (
            <div key={card.label} className="rounded-lg bg-slate-900 p-5">
              <p className="text-sm font-semibold uppercase tracking-[0.16em] text-cyan-300">{card.label}</p>
              <h3 className="mt-3 text-lg font-bold">{card.title}</h3>
              <p className="mt-3 text-sm leading-6 text-slate-300">{card.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className={chatActiveTab === 'overview' ? 'panel' : 'hidden'}>
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-cyan-300">Fechamento mensal</p>
            <h2 className="mt-2 text-2xl font-bold">{chatClosureReading}</h2>
          </div>
          <span className="rounded-md bg-cyan-400/10 px-3 py-2 text-sm font-semibold text-cyan-200">
            {chatEligibleCount} elegíveis de {visibleMetrics.length}
          </span>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          <div className="rounded-lg bg-slate-900 p-4">
            <p className="text-sm text-slate-400">Destaque do período</p>
            <p className="mt-2 text-lg font-bold">{chatTopHighlight ? getChatAnalystName(chatTopHighlight) : 'Aguardando dados'}</p>
            <p className="mt-1 text-sm text-slate-300">
              {chatTopHighlight ? `CSAT ${formatChatPercent(chatTopHighlight.csat)} | ${formatChatPercent(chatTopHighlight.review_percentage)} avaliações | ${formatChatCount(chatTopHighlight.total_tickets)} atendimentos` : 'Importe um mês para liberar a leitura.'}
            </p>
          </div>
          <div className="rounded-lg bg-slate-900 p-4">
            <p className="text-sm text-slate-400">Principal ponto de atenção</p>
            <p className="mt-2 text-lg font-bold">{chatAttentionHighlight ? getChatAnalystName(chatAttentionHighlight) : 'Sem prioridade aberta'}</p>
            <p className="mt-1 text-sm text-slate-300">{chatAttentionText}</p>
          </div>
          <div className="rounded-lg bg-slate-900 p-4">
            <p className="text-sm text-slate-400">Média de volume para pódio</p>
            <p className="mt-2 text-lg font-bold tabular-nums">{formatChatCount(averageTickets)} atendimentos</p>
            <p className="mt-1 text-sm text-slate-300">
              Quem fica abaixo dessa média aparece como volume abaixo da média no ranking.
            </p>
          </div>
        </div>
      </section>

      <section className={chatActiveTab === 'overview' ? 'panel' : 'hidden'}>
        <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
          <EligibilityFunnel
            title="Funil de elegibilidade do chat"
            subtitle="Mostra onde o pódio mensal está afunilando: qualidade, avaliações, volume ou combinação dos três."
            items={chatFunnelItems}
          />
          <ComparisonBars
            title="Comparativo visual dos analistas"
            subtitle="Mostra rapidamente quem combina qualidade, amostra de avaliações e volume no período."
            rows={chatVisualRows}
            primaryGoal={90}
            secondaryGoal={25}
            volumeReference={averageTickets}
          />
        </div>
        <div className="mt-6">
          <VolumeQualityMap
            title="Mapa volume x CSAT"
            subtitle="Quanto mais para a direita, maior o volume. Quanto mais para cima, melhor o CSAT."
            points={chatVisualPoints}
            xReference={averageTickets}
            yReference={90}
          />
        </div>
      </section>

      <section className={chatActiveTab === 'overview' ? 'panel' : 'hidden'}>
        <div className="grid gap-6 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <h2 className="section-title">Evolução mensal</h2>
            <p className="section-subtitle">CSAT médio consolidado por mes no filtro selecionado.</p>
            <div className="mt-5">
              <GroupedPercentTrendChart
                points={monthlyUnifiedTrend}
                series={[
                  { key: 'csat', label: 'CSAT', color: 'bg-cyan-300' },
                  { key: 'reviews', label: 'Avaliações', color: 'bg-emerald-300' },
                  { key: 'sending', label: '% sem avaliação', color: 'bg-amber-300' },
                ]}
              />
            </div>
          </div>
          <div className="rounded-lg bg-slate-900 p-5">
            <h3 className="text-xl font-bold">Resumo operacional</h3>
            <div className="mt-4 space-y-3 text-sm text-slate-300">
              <p>Válidos: <strong className="tabular-nums">{formatChatCount(totals.validTickets)}</strong></p>
              <p>Inativos: <strong className="tabular-nums">{formatChatCount(totals.inactive)}</strong></p>
              <p>Avaliações: <strong className="tabular-nums">{formatChatCount(totals.reviews)}</strong></p>
              <p>% sem avaliação médio: <strong className="tabular-nums">{formatChatPercent(averageSending)}</strong></p>
              <p>Média por analista: <strong className="tabular-nums">{formatChatCount(averageTickets)}</strong></p>
              <p>Metas superadas: <strong>{chatGoalsReachedCount}</strong></p>
              <p>Críticos: <strong>{chatCriticalCount}</strong></p>
            </div>
          </div>
        </div>
      </section>

      <section className={chatActiveTab === 'podium' ? 'panel' : 'hidden'}>
        <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <h2 className="section-title">Pódio final do chat</h2>
            <p className="section-subtitle">
              Usa o ranking automático, mas permite ajuste manual por equipe e período quando houver empréstimo, cobertura ou exceção operacional.
            </p>
          </div>
          {activeManualPodium.length > 0 && (
            <span className="rounded-md bg-cyan-400/10 px-3 py-2 text-sm font-semibold text-cyan-200">
              Pódio manual ativo
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
                    <div className="mt-3 flex items-center gap-3">
                      <AnalystAvatar name={getChatAnalystName(winner)} photoUrl={getChatAnalystPhoto(winner)} size="md" />
                      <p className="text-lg font-bold">{getChatAnalystName(winner)}</p>
                    </div>
                    <p className="mt-2 text-sm text-slate-300">CSAT {formatChatPercent(winner.csat)} | {formatChatPercent(winner.review_percentage)} avaliações | {formatChatCount(winner.total_tickets)} atendimentos</p>
                  </>
                ) : (
                  <p className="mt-3 text-slate-400">Aguardando elegível</p>
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
                <option value="">Automático</option>
                {visibleMetrics.map((metric) => (
                  <option key={metric.id} value={metric.analyst_id}>
                    {getChatAnalystName(metric)}
                  </option>
                ))}
              </select>
            </Field>
          ))}
          <button className="btn-primary self-end" type="button" onClick={handleSaveChatManualPodium}>
            Salvar pódio
          </button>
          <button className="secondary-button self-end" type="button" onClick={handleResetChatManualPodium}>
            Resetar
          </button>
        </div>

        {selectedTeamId === 'all' && (
          <p className="mt-3 text-sm text-slate-400">Para ajustar manualmente, selecione uma equipe específica no filtro do módulo chat.</p>
        )}
        {chatPodiumMessage && <p className="mt-4 rounded-md bg-slate-900/70 px-4 py-3 text-sm text-slate-200">{chatPodiumMessage}</p>}
      </section>

      <div className={chatActiveTab === 'podium' ? 'grid gap-6 xl:grid-cols-2' : 'hidden'}>
        <section className="panel xl:col-span-2">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="section-title">Ranking mensal do chat</h2>
              <p className="section-subtitle">
                Lista final do período, do primeiro ao último. Critérios: CSAT mínimo 90%, avaliações a partir de 25% e volume acima da média do período.
              </p>
            </div>
            <span className="rounded-md bg-cyan-400/10 px-3 py-2 text-sm font-semibold text-cyan-200">
              Média exigida: {formatChatCount(averageTickets)} atendimentos
            </span>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-4">
            <div className="rounded-lg bg-slate-900 p-4">
              <p className="text-sm text-slate-400">Elegíveis</p>
              <p className="mt-2 text-2xl font-bold text-emerald-300">{chatEligibleCount}</p>
            </div>
            <div className="rounded-lg bg-slate-900 p-4">
              <p className="text-sm text-slate-400">Fora por volume</p>
              <p className="mt-2 text-2xl font-bold text-amber-200">
                {chatRanking.filter((item) => item.reasons.some((reason) => reason.includes('volume abaixo'))).length}
              </p>
            </div>
            <div className="rounded-lg bg-slate-900 p-4">
              <p className="text-sm text-slate-400">Fora por CSAT</p>
              <p className="mt-2 text-2xl font-bold text-amber-200">
                {chatRanking.filter((item) => item.reasons.some((reason) => reason.includes('CSAT abaixo'))).length}
              </p>
            </div>
            <div className="rounded-lg bg-slate-900 p-4">
              <p className="text-sm text-slate-400">Fora por avaliações</p>
              <p className="mt-2 text-2xl font-bold text-amber-200">
                {chatRanking.filter((item) => item.reasons.some((reason) => reason.includes('avaliações abaixo'))).length}
              </p>
            </div>
          </div>

          <div className="mt-5 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-slate-400">
                <tr>
                  <th className="pb-3 pr-4 font-medium">Posição</th>
                  <th className="pb-3 pr-4 font-medium">Analista</th>
                  <th className="pb-3 pr-4 font-medium">CSAT</th>
                  <th className="pb-3 pr-4 font-medium">Avaliações</th>
                  <th className="pb-3 pr-4 font-medium">Atendimentos</th>
                  <th className="pb-3 pr-4 font-medium">Volume vs média</th>
                  <th className="pb-3 pr-4 font-medium">Status</th>
                  <th className="pb-3 pr-4 font-medium">Motivo</th>
                  <th className="pb-3 font-medium">Podio</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {chatRanking.map((item, index) => {
                  const volumeGap = Number(item.metric.total_tickets) - averageTickets
                  const excluded = Boolean(getChatPodiumExclusion(item.metric))

                  return (
                    <tr key={item.metric.id}>
                      <td className="py-3 pr-4 font-bold text-cyan-300">{index + 1}o</td>
                      <td className="py-3 pr-4 font-semibold">{getChatAnalystName(item.metric)}</td>
                      <td className="whitespace-nowrap py-3 pr-4 tabular-nums">{formatChatPercent(item.metric.csat)}</td>
                      <td className="whitespace-nowrap py-3 pr-4 tabular-nums">{formatChatPercent(item.metric.review_percentage)}</td>
                      <td className="whitespace-nowrap py-3 pr-4 tabular-nums">{formatChatCount(item.metric.total_tickets)}</td>
                      <td className={`whitespace-nowrap py-3 pr-4 font-semibold tabular-nums ${volumeGap >= 0 ? 'text-emerald-300' : 'text-amber-200'}`}>
                        {volumeGap >= 0 ? '+' : ''}{formatChatCount(volumeGap)}
                      </td>
                      <td className="py-3 pr-4">
                        {item.eligible ? (
                          <span className="text-emerald-300">Elegível</span>
                        ) : excluded ? (
                          <span className="text-amber-200">Exceção manual</span>
                        ) : (
                          <span className="text-slate-400">Não elegível</span>
                        )}
                      </td>
                      <td className="py-3 pr-4 text-slate-300">
                        {item.eligible ? 'Cumpriu todos os critérios.' : item.reasons.join(', ')}
                      </td>
                      <td className="py-3">
                        <button className="small-button" type="button" onClick={() => handleToggleChatPodiumExclusion(item.metric)}>
                          {excluded ? 'Permitir' : 'Tirar'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            {!chatRanking.length && <EmptyState text="Nenhum dado de chat encontrado neste período." />}
          </div>
        </section>

        <section className="panel">
          <h2 className="section-title">Analistas em atenção</h2>
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
              <EmptyState text="Nenhum ponto crítico encontrado neste filtro." />
            )}
          </div>
        </section>
      </div>


      <section className={chatActiveTab === 'analysis' ? 'panel' : 'hidden'}>
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-cyan-300">Análise detalhada</p>
          <h2 className="section-title">Leitura por critérios do painel antigo</h2>
          <p className="section-subtitle">
            Mostra delta de CSAT contra a meta individual, delta de avaliações contra 25%, % sem avaliação contra 80% e volume contra a média do período.
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
                      Avaliações {item.metric.review_percentage}%, atendimento {item.metric.total_tickets} e meta CSAT {item.metric.csat_goal}%.
                    </p>
                  </div>
                ))
              ) : (
                <EmptyState text="Ainda não há destaque no filtro selecionado." />
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
                      CSAT {formatDelta(item.csatDelta, ' p.p.')}, avaliações {formatDelta(item.reviewDelta, ' p.p.')} e envio {formatDelta(item.sendingDelta, ' p.p.')}.
                    </p>
                  </div>
                ))
              ) : (
                <EmptyState text="Nenhuma oportunidade crítica encontrada neste período." />
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
                <th className="pb-3 pr-4 font-medium">Avaliações</th>
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
                  <td className="whitespace-nowrap py-3 pr-4 tabular-nums">{formatChatPercent(item.metric.csat)}</td>
                  <td className="py-3 pr-4">{formatDelta(round(Number(item.metric.csat) - Number(item.metric.csat_goal)), ' p.p.')}</td>
                  <td className="whitespace-nowrap py-3 pr-4 tabular-nums">{formatChatPercent(item.metric.review_percentage)}</td>
                  <td className="py-3 pr-4">{formatDelta(round(Number(item.metric.review_percentage) - Number(item.metric.general_review_goal)), ' p.p.')}</td>
                  <td className="whitespace-nowrap py-3 pr-4 tabular-nums">{formatChatPercent(item.metric.sending_percentage)}</td>
                  <td className="whitespace-nowrap py-3 pr-4 tabular-nums">{formatChatCount(item.metric.total_tickets)} / média {formatChatCount(averageTickets)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!chatRanking.length && <EmptyState text="Nenhum dado para análise neste filtro." />}
        </div>
      </section>
      <section className={chatActiveTab === 'reports' ? 'panel' : 'hidden'}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-cyan-300">Relatório individual</p>
            <h2 className="section-title">Fechamento mensal por analista</h2>
            <p className="section-subtitle">
              Fluxo guiado: confira os dados, gere o feedback, revise o texto final e exporte o documento individual.
            </p>
          </div>

          <div className="grid flex-1 gap-3 md:grid-cols-2">
            <Field label="1. Analista">
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
            <Field label="2. Modelo do feedback">
              <select
                className="form-input"
                value={chatFeedbackStyle}
                onChange={(event) => {
                  setChatFeedbackStyle(event.target.value as ChatFeedbackStyle)
                  setChatFeedbackDraft('')
                }}
              >
                <option value="coach">Coach</option>
                <option value="mimo">MIMO</option>
                <option value="sare">SARE</option>
              </select>
            </Field>
            <Field label="Objetivo">
              <select className="form-input" value={chatFeedbackGoal} onChange={(event) => setChatFeedbackGoal(event.target.value as FeedbackGoal)}>
                <option value="recognition">Reconhecer e manter</option>
                <option value="courseCorrection">Corrigir rota</option>
                <option value="development">Desenvolver comportamento</option>
                <option value="maintenance">Proteger padrão</option>
              </select>
            </Field>
            <Field label="Tom">
              <select className="form-input" value={chatFeedbackTone} onChange={(event) => setChatFeedbackTone(event.target.value as FeedbackTone)}>
                <option value="human">Humano e prático</option>
                <option value="direct">Direto e assertivo</option>
                <option value="executive">Executivo</option>
              </select>
            </Field>
          </div>
        </div>

        {selectedChatReportMetric ? (
          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <MetricCard label="CSAT" value={`${selectedChatReportMetric.csat}%`} />
            <MetricCard label="Avaliações" value={`${selectedChatReportMetric.review_percentage}%`} />
            <MetricCard label="Atendimentos" value={selectedChatReportMetric.total_tickets} />
            <MetricCard label="Volume vs média" value={`${Number(selectedChatReportMetric.total_tickets) - averageTickets >= 0 ? '+' : ''}${Number(selectedChatReportMetric.total_tickets) - averageTickets}`} />
            <MetricCard label="Podio" value={selectedChatPodiumPosition > 0 ? `${selectedChatPodiumPosition}o lugar` : 'Fora'} />
          </div>
        ) : (
          <EmptyState text="Selecione um analista com dados para gerar o relatório." />
        )}

        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          <div className="rounded-lg bg-slate-900 p-4 text-sm text-slate-300">
            <p className="font-semibold text-slate-100">1. Conferir</p>
            <p className="mt-2">Verifique período, analista, CSAT, avaliações, volume e posição no pódio.</p>
          </div>
          <div className="rounded-lg bg-slate-900 p-4 text-sm text-slate-300">
            <p className="font-semibold text-slate-100">2. Revisar feedback</p>
            <p className="mt-2">Use suas observações como contexto e ajuste o texto final antes de exportar.</p>
          </div>
          <div className="rounded-lg bg-slate-900 p-4 text-sm text-slate-300">
            <p className="font-semibold text-slate-100">3. Exportar</p>
            <p className="mt-2">O arquivo individual sera gerado para envio ao colaborador no fechamento mensal.</p>
          </div>
        </div>

        <div className="mt-5 grid gap-4">
          <Field label="3. Observações do gestor">
            <textarea
              className="form-input min-h-24"
              value={chatManagerNotes}
              onChange={(event) => setChatManagerNotes(event.target.value)}
              placeholder="Inclua contexto do mes, combinados, pontos de atenção ou reconhecimento para orientar o feedback."
            />
          </Field>


          <div className="grid gap-3 lg:grid-cols-[auto_auto_auto_1fr] lg:items-start">
            <button
              className="btn-secondary disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!selectedChatReportMetric}
              type="button"
              onClick={handleGenerateChatFeedbackDraft}
            >
              4. Gerar sugestão
            </button>
            <button
              className="btn-primary disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!selectedChatReportMetric || chatAiSaving}
              type="button"
              onClick={handleGenerateChatFeedbackWithAi}
            >
              {chatAiSaving ? 'Gerando...' : 'Gerar texto assistido'}
            </button>
            <button
              className="btn-secondary disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!selectedChatReportMetric || chatAiSaving || !chatFeedbackDraft.trim()}
              type="button"
              onClick={handleImproveChatFeedbackWithAi}
            >
              Melhorar texto atual
            </button>
            <p className="text-sm text-slate-300">
              A IA considera objetivo, tom, números do Zendesk e suas observações para explicar o que aconteceu, por que importa e como agir no próximo fechamento.
            </p>
          </div>

          <Field label="5. Texto final do feedback">
            <textarea
              className="form-input min-h-56"
              value={chatFeedbackDraft}
              onChange={(event) => setChatFeedbackDraft(event.target.value)}
              placeholder="Gere uma sugestão ou escreva aqui o feedback final que irá para o relatório."
            />
          </Field>

          <button
            className="btn-primary w-fit disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!selectedChatReportMetric}
            type="button"
            onClick={handleExportChatIndividualReport}
          >
            6. Exportar relatório Word
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
              Cadastre analistas por equipe e mantenha a meta individual de CSAT usada nas importações e relatórios do chat.
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

              <Field label={editingChatAnalystId ? 'Substituir foto' : 'Foto do analista'}>
                <input
                  accept="image/png,image/jpeg,image/webp"
                  className="form-input"
                  type="file"
                  onChange={(event) => setChatAnalystForm({ ...chatAnalystForm, photoFile: event.target.files?.[0] ?? null })}
                />
                <p className="mt-2 text-xs text-slate-400">PNG, JPG ou WEBP, com até 5 MB.</p>
              </Field>

              <div className="flex flex-wrap gap-3">
                <button className="btn-primary" disabled={chatAnalystSaving} type="submit">
                  {chatAnalystSaving ? 'Salvando...' : editingChatAnalystId ? 'Salvar alterações' : 'Incluir analista'}
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
              Inative para preservar histórico. Exclua apenas cadastros criados por engano.
            </p>
            <table className="mt-5 min-w-full text-left text-sm">
              <thead className="text-slate-400">
                <tr>
                  <th className="pb-3 pr-4 font-medium">Analista</th>
                  <th className="pb-3 pr-4 font-medium">Equipe</th>
                  <th className="pb-3 pr-4 font-medium">Meta CSAT</th>
                  <th className="pb-3 pr-4 font-medium">Status</th>
                  <th className="pb-3 font-medium">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {[...analysts]
                  .sort((a, b) => `${getChatTeamNameById(teams, a.team_id)} ${a.name}`.localeCompare(`${getChatTeamNameById(teams, b.team_id)} ${b.name}`))
                  .map((analyst) => (
                    <tr key={analyst.id}>
                      <td className="py-3 pr-4 font-semibold">
                        <div className="flex items-center gap-3">
                          <AnalystAvatar name={analyst.name} photoUrl={analyst.photo_url} size="sm" />
                          <span>{analyst.name}</span>
                        </div>
                      </td>
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
                          {analyst.photo_url && (
                            <button className="small-button" type="button" onClick={() => handleRemoveChatAnalystPhoto(analyst)}>
                              Remover foto
                            </button>
                          )}
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
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="section-title">Base importada</h2>
            <p className="section-subtitle">
              {metrics.length} registros carregados entre histórico e importações mensais do Zendesk. Esta aba serve para conferir se a importação mensal bate com o fechamento antes de olhar ranking e relatórios.
            </p>
          </div>
          <span className="rounded-md bg-cyan-400/10 px-3 py-2 text-sm font-semibold text-cyan-200">
            {selectedPeriod?.label ?? 'Periodo'} - {selectedTeamName}
          </span>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-6">
          <MetricCard label="Atendidos" value={formatChatCount(totals.tickets)} />
          <MetricCard label="Inativos" value={`${formatChatCount(totals.inactive)} (${formatChatPercent(chatInactiveRate)})`} />
          <MetricCard label="Válidos" value={formatChatCount(totals.validTickets)} />
          <MetricCard label="Avaliações" value={`${formatChatCount(totals.reviews)} (${formatChatPercent(chatReviewRate)})`} />
          <MetricCard label="Sem avaliação" value={`${formatChatCount(Math.max(totals.validTickets - totals.reviews, 0))} (${formatChatPercent(chatSendingRate)})`} />
          <MetricCard label="CSAT consolidado" value={formatChatPercent(averageCsat)} />
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          <div className="rounded-lg bg-slate-900 p-4 text-sm text-slate-300">
            <p className="font-semibold text-slate-100">Fórmula de avaliações</p>
            <p className="mt-2">Avaliações recebidas / atendimentos válidos x 100.</p>
          </div>
          <div className="rounded-lg bg-slate-900 p-4 text-sm text-slate-300">
            <p className="font-semibold text-slate-100">Fórmula de % sem avaliação</p>
            <p className="mt-2">Válidos sem avaliação / atendimentos válidos x 100.</p>
          </div>
          <div className="rounded-lg bg-slate-900 p-4 text-sm text-slate-300">
            <p className="font-semibold text-slate-100">Fórmula de inatividade</p>
            <p className="mt-2">Inativos / atendimentos totais x 100. Este número é apoio operacional; o indicador principal do fechamento continua sendo o % sem avaliação.</p>
          </div>
        </div>

        <div className="mt-5 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-slate-400">
              <tr>
                <th className="px-3 py-2">Analista</th>
                <th className="px-3 py-2">Equipe</th>
                <th className="px-3 py-2">CSAT</th>
                <th className="px-3 py-2">Avaliações</th>
                <th className="px-3 py-2">Atendidos</th>
                <th className="px-3 py-2">Válidos</th>
                <th className="px-3 py-2">Inativos</th>
                <th className="px-3 py-2">% inatividade</th>
                <th className="px-3 py-2">% envio avaliação</th>
              </tr>
            </thead>
            <tbody>
              {visibleMetrics.map((metric) => (
                <tr key={metric.id} className="border-t border-slate-800">
                  <td className="px-3 py-3 font-semibold">{getChatAnalystName(metric)}</td>
                  <td className="px-3 py-3 text-slate-300">{getChatTeamName(metric)}</td>
                  <td className="whitespace-nowrap px-3 py-3 tabular-nums">{formatChatPercent(metric.csat)}</td>
                  <td className="whitespace-nowrap px-3 py-3 tabular-nums">{formatChatPercent(metric.review_percentage)}</td>
                  <td className="whitespace-nowrap px-3 py-3 tabular-nums">{formatChatCount(metric.total_tickets)}</td>
                  <td className="whitespace-nowrap px-3 py-3 tabular-nums">{formatChatCount(metric.valid_tickets)}</td>
                  <td className="whitespace-nowrap px-3 py-3 tabular-nums">{formatChatCount(metric.inactive_tickets)}</td>
                  <td className="whitespace-nowrap px-3 py-3 tabular-nums">{formatChatPercent(metric.total_tickets ? (Number(metric.inactive_tickets) / Number(metric.total_tickets)) * 100 : 0)}</td>
                  <td className="whitespace-nowrap px-3 py-3 tabular-nums">{formatChatPercent(metric.sending_percentage)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-cyan-400/30 font-semibold text-cyan-100">
              <tr>
                <td className="px-3 py-3" colSpan={2}>Total do filtro</td>
                <td className="whitespace-nowrap px-3 py-3 tabular-nums">{formatChatPercent(averageCsat)}</td>
                <td className="whitespace-nowrap px-3 py-3 tabular-nums">{formatChatPercent(chatReviewRate)}</td>
                <td className="whitespace-nowrap px-3 py-3 tabular-nums">{formatChatCount(totals.tickets)}</td>
                <td className="whitespace-nowrap px-3 py-3 tabular-nums">{formatChatCount(totals.validTickets)}</td>
                <td className="whitespace-nowrap px-3 py-3 tabular-nums">{formatChatCount(totals.inactive)}</td>
                <td className="whitespace-nowrap px-3 py-3 tabular-nums">{formatChatPercent(chatInactiveRate)}</td>
                <td className="whitespace-nowrap px-3 py-3 tabular-nums">{formatChatPercent(chatSendingRate)}</td>
              </tr>
            </tfoot>
          </table>
          {!visibleMetrics.length && <EmptyState text="Nenhum dado importado para o filtro selecionado." />}
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
  const [managementAiAnalysis, setManagementAiAnalysis] = useState('')
  const [managementAiMessage, setManagementAiMessage] = useState('')
  const [managementAiLoading, setManagementAiLoading] = useState(false)
  const isPhoneDailyUnsupported = isPhonePeriodShorterThanWeeklyLaunch(periodFilter)
  const phoneWeeklyLaunchMessage =
    'Os dados do telefone são lançados por semana. Para leitura diária, seria necessário lançar os atendimentos por dia.'
  const filteredIndividualMetrics = useMemo(
    () => filterIndividualMetricsByPeriod(individualMetrics, periodFilter),
    [individualMetrics, periodFilter],
  )
  const filteredTeamMetrics = useMemo(
    () => filterTeamMetricsByPeriod(teamMetrics, periodFilter),
    [teamMetrics, periodFilter],
  )
  const weeklyIndividualTrend = aggregateIndividualByWeek(filteredIndividualMetrics).slice(-8)
  const weeklyReviewCoverageTrend = weeklyIndividualTrend.map((item) => ({
    label: item.label,
    value: item.totalTickets ? round((item.totalReviews / item.totalTickets) * 100) : 0,
  }))
  const teamPerformanceTrend = [...filteredTeamMetrics]
    .sort((a, b) => a.week_start.localeCompare(b.week_start))
    .slice(-8)
    .map((metric) => ({
      label: formatShortDate(metric.week_start),
      value: calculateTeamPerformance([metric]),
    }))
  const overallCsatTrend = [...filteredTeamMetrics]
    .filter((metric) => metric.overall_csat !== null)
    .sort((a, b) => a.week_start.localeCompare(b.week_start))
    .slice(-8)
    .map((metric) => ({
      label: formatShortDate(metric.week_start),
      value: Number(metric.overall_csat),
    }))
  const podiumCsatGoal = getGoalValue(goals, 'podium_csat_minimum', 90)
  const reviewGoal = getGoalValue(goals, 'review_percentage', 25)
  const teamPerformanceGoal = getTeamPerformanceGoal(goals)
  const weeklyEligibilityTrend = [...new Set(filteredIndividualMetrics.map((metric) => metric.week_start))]
    .sort()
    .map((weekStart) => {
      const weekMetrics = filteredIndividualMetrics.filter((metric) => metric.week_start === weekStart)
      const weekPodium = buildPeriodPodium(weekMetrics, analysts, podiumCsatGoal, reviewGoal)
      return {
        label: formatShortDate(weekStart),
        eligible: weekPodium.filter((item) => item.eligible).length,
        total: weekPodium.length,
      }
    })
  const previousPeriodFilter = getPreviousPeriod(periodFilter)
  const previousIndividualMetrics = filterIndividualMetricsByPeriod(individualMetrics, previousPeriodFilter)
  const previousTeamMetrics = filterTeamMetricsByPeriod(teamMetrics, previousPeriodFilter)
  useEffect(() => {
    let active = true

    async function loadPhonePodiumRanking() {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session?.access_token) {
        if (active) setPhonePodiumRanking([])
        return
      }

      const response = await fetch(
        `/api/phone-podium?start=${periodFilter.start}&end=${periodFilter.end}`,
        {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        },
      )

      if (!active) return
      if (!response.ok) {
        setPhonePodiumRanking([])
        return
      }

      const data = (await response.json()) as PhonePodiumRankingRow[]
      setPhonePodiumRanking(data ?? [])
    }

    loadPhonePodiumRanking()

    return () => {
      active = false
    }
  }, [periodFilter.start, periodFilter.end])
  useEffect(() => {
    setManagementAiAnalysis('')
    setManagementAiMessage('')
  }, [periodFilter.start, periodFilter.end])
  const periodPodium = buildPeriodPodium(filteredIndividualMetrics, analysts, podiumCsatGoal, reviewGoal)
  const podiumWinners = periodPodium.filter((item) => item.eligible).slice(0, 3)
  const attentionList = periodPodium.filter((item) => !item.eligible)
  const eligibleCount = periodPodium.filter((item) => item.eligible).length
  const periodLabel = formatPeriodLabel(periodFilter)
  const periodAverageCsat = calculateAverageCsat(filteredIndividualMetrics)
  const previousAverageCsat = calculateAverageCsat(previousIndividualMetrics)
  const periodTeamPerformance = calculateTeamPerformance(filteredTeamMetrics)
  const previousTeamPerformance = calculateTeamPerformance(previousTeamMetrics)
  const hasPreviousIndividualData = previousIndividualMetrics.length > 0
  const hasPreviousTeamData = previousTeamMetrics.length > 0
  const csatDelta = hasPreviousIndividualData ? round(periodAverageCsat - previousAverageCsat) : 0
  const teamPerformanceDelta = hasPreviousTeamData ? round(periodTeamPerformance - previousTeamPerformance) : 0
  const hasWeeklyPaceComparison = weeklyIndividualTrend.length > 1
  const firstWeeklyResult = weeklyIndividualTrend[0] ?? null
  const lastWeeklyResult = weeklyIndividualTrend.at(-1) ?? null
  const firstWeeklyPerformance = teamPerformanceTrend[0] ?? null
  const lastWeeklyPerformance = teamPerformanceTrend.at(-1) ?? null
  const firstWeeklyOverallCsat = overallCsatTrend[0] ?? null
  const lastWeeklyOverallCsat = overallCsatTrend.at(-1) ?? null
  const firstWeeklyEligibility = weeklyEligibilityTrend[0] ?? null
  const lastWeeklyEligibility = weeklyEligibilityTrend.at(-1) ?? null
  const weeklyCsatPace = firstWeeklyResult && lastWeeklyResult
    ? round(lastWeeklyResult.csat - firstWeeklyResult.csat)
    : 0
  const weeklyPerformancePace = firstWeeklyPerformance && lastWeeklyPerformance
    ? round(lastWeeklyPerformance.value - firstWeeklyPerformance.value)
    : 0
  const weeklyOverallCsatPace = firstWeeklyOverallCsat && lastWeeklyOverallCsat
    ? round(lastWeeklyOverallCsat.value - firstWeeklyOverallCsat.value)
    : 0
  const weeklyEligibilityPace = firstWeeklyEligibility && lastWeeklyEligibility
    ? lastWeeklyEligibility.eligible - firstWeeklyEligibility.eligible
    : 0
  const totalReviews = filteredIndividualMetrics.reduce((sum, metric) => sum + Number(metric.total_reviews), 0)
  const totalTickets = filteredIndividualMetrics.reduce((sum, metric) => sum + Number(metric.total_tickets), 0)
  const periodAverageTickets = periodPodium.length ? round(totalTickets / periodPodium.length) : 0
  const n1PositiveReviews = filteredIndividualMetrics.reduce((sum, metric) => sum + Number(metric.positive_reviews), 0)
  const reviewCoverage = totalTickets ? round((totalReviews / totalTickets) * 100) : 0
  const teamAnsweredCalls = filteredTeamMetrics.reduce((sum, metric) => sum + Number(metric.answered_calls), 0)
  const teamTotalCalls = filteredTeamMetrics.reduce((sum, metric) => sum + Number(metric.total_calls), 0)
  const metricsWithOverallCsat = filteredTeamMetrics.filter(
    (metric) => metric.overall_csat !== null,
  )
  const n1MetricsInOverallCoverage = filteredIndividualMetrics.filter((metric) =>
    metricsWithOverallCsat.some(
      (teamMetric) => teamMetric.week_start === metric.week_start && teamMetric.week_end === metric.week_end,
    ),
  )
  const n1ComparisonCsat = calculateAverageCsat(n1MetricsInOverallCoverage)
  const overallPhoneCsat = metricsWithOverallCsat.length
    ? round(
        metricsWithOverallCsat.reduce((sum, metric) => sum + Number(metric.overall_csat), 0) /
          metricsWithOverallCsat.length,
      )
    : null
  const overallCsatGap = overallPhoneCsat === null ? null : round(overallPhoneCsat - n1ComparisonCsat)
  const hasCompleteOverallCoverage = filteredTeamMetrics.length > 0 && metricsWithOverallCsat.length === filteredTeamMetrics.length
  const isManagementView = role === 'master' || role === 'coordinator'
  const n1ImpactRanking = periodPodium
    .map((result) => {
      const analystMetrics = filteredIndividualMetrics.filter((metric) => metric.analyst_id === result.analystId)
      const positive = analystMetrics.reduce((sum, metric) => sum + Number(metric.positive_reviews), 0)
      const negative = analystMetrics.reduce((sum, metric) => sum + Number(metric.negative_reviews), 0)
      const reviewsWithoutAnalyst = totalReviews - positive - negative
      const csatWithoutAnalyst = reviewsWithoutAnalyst > 0
        ? round(((n1PositiveReviews - positive) / reviewsWithoutAnalyst) * 100)
        : periodAverageCsat

      return {
        analystName: result.analystName,
        averageCsat: result.averageCsat,
        reviews: positive + negative,
        negativeReviews: negative,
        downwardImpact: round(csatWithoutAnalyst - periodAverageCsat),
      }
    })
    .filter((item) => item.reviews > 0)
    .sort((a, b) => b.downwardImpact - a.downwardImpact)
  const attentionCount = attentionList.length
  const attentionDetails = attentionList.map((item) => {
    const criteria: string[] = []

    if (item.averageCsat < item.individualGoal || item.averageCsat < podiumCsatGoal) {
      const csatReferences = [
        item.averageCsat < item.individualGoal ? `meta individual ${item.individualGoal}%` : null,
        item.averageCsat < podiumCsatGoal ? `pódio ${podiumCsatGoal}%` : null,
      ].filter(Boolean).join(' e ')
      criteria.push(`CSAT ${item.averageCsat}% (referência: ${csatReferences})`)
    }
    if (item.reviewPercentage < reviewGoal) {
      criteria.push(`avaliações ${item.reviewPercentage}% (meta ${reviewGoal}%)`)
    }
    if (item.totalTickets < periodAverageTickets) {
      criteria.push(`volume ${item.totalTickets} (média do time ${periodAverageTickets})`)
    }

    return `${item.analystName}: ${criteria.join('; ')}`
  })
  const attentionSummary = attentionDetails.join(' | ')
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
  const weeklyPaceFacts = [
    firstWeeklyResult && lastWeeklyResult
      ? `CSAT N1: ${firstWeeklyResult.csat}% para ${lastWeeklyResult.csat}% (${formatDelta(weeklyCsatPace, ' p.p.')})`
      : null,
    teamPerformanceTrend.length > 1 && firstWeeklyPerformance && lastWeeklyPerformance
      ? `performance: ${firstWeeklyPerformance.value}% para ${lastWeeklyPerformance.value}% (${formatDelta(weeklyPerformancePace, ' p.p.')})`
      : null,
    overallCsatTrend.length > 1 && firstWeeklyOverallCsat && lastWeeklyOverallCsat
      ? `CSAT geral N1 + N2: ${firstWeeklyOverallCsat.value}% para ${lastWeeklyOverallCsat.value}% (${formatDelta(weeklyOverallCsatPace, ' p.p.')})`
      : null,
    weeklyEligibilityTrend.length > 1 && firstWeeklyEligibility && lastWeeklyEligibility
      ? `elegíveis: ${firstWeeklyEligibility.eligible} de ${firstWeeklyEligibility.total} para ${lastWeeklyEligibility.eligible} de ${lastWeeklyEligibility.total}`
      : null,
  ].filter((fact): fact is string => Boolean(fact))
  const weeklyPaceRisks = [
    weeklyIndividualTrend.length > 1 && lastWeeklyResult && lastWeeklyResult.csat < podiumCsatGoal && weeklyCsatPace <= 0
      ? `o CSAT N1 tende a permanecer abaixo de ${podiumCsatGoal}%`
      : null,
    teamPerformanceTrend.length > 1 && lastWeeklyPerformance && lastWeeklyPerformance.value < teamPerformanceGoal && weeklyPerformancePace <= 0
      ? `a performance tende a permanecer abaixo de ${teamPerformanceGoal}%`
      : null,
    overallCsatTrend.length > 1 && lastWeeklyOverallCsat && lastWeeklyOverallCsat.value < podiumCsatGoal && weeklyOverallCsatPace <= 0
      ? `o CSAT geral N1 + N2 tende a permanecer abaixo de ${podiumCsatGoal}%`
      : null,
    weeklyEligibilityTrend.length > 1 && lastWeeklyEligibility && lastWeeklyEligibility.total > 0 &&
      lastWeeklyEligibility.eligible / lastWeeklyEligibility.total < 0.5 && weeklyEligibilityPace <= 0
      ? 'o período tende a fechar com poucos analistas elegíveis ao pódio'
      : null,
  ].filter((risk): risk is string => Boolean(risk))
  const weeklyPaceRead = !hasWeeklyPaceComparison
    ? 'Ainda há somente uma semana lançada neste recorte. A tendência será liberada após o próximo lançamento semanal.'
    : `Da primeira para a última semana, ${weeklyPaceFacts.join('; ')}. ${
        weeklyPaceRisks.length
          ? `Se esse ritmo continuar, ${weeklyPaceRisks.join(' e ')}.`
          : 'Mantido esse ritmo, os indicadores acompanhados permanecem em trajetória compatível com as metas.'
      }`
  const weeklyPaceAction = !hasWeeklyPaceComparison
    ? 'Fazer o próximo lançamento semanal para comparar velocidade, direção e consistência da evolução.'
    : weeklyPaceRisks.length
      ? 'Atuar nos critérios indicados abaixo e conferir, no próximo lançamento semanal, se a distância para a meta diminuiu.'
      : 'Preservar as práticas atuais e confirmar no próximo lançamento se a evolução se mantém.'
  const predictiveRiskDrivers = !hasPeriodData
    ? []
    : [
        predictiveGoalProbability < 75
          ? {
              label: 'Chance geral de fechamento',
              reading: `${predictiveGoalProbability}% (faixa de atenção: abaixo de 75%)`,
              action: 'Revisar os critérios ainda não cumpridos antes do próximo lançamento.',
              severity: predictiveGoalProbability < 45 ? 'Alto' : 'Médio',
            }
          : null,
        hasPreviousIndividualData && csatDelta < 0
          ? {
              label: 'CSAT em queda',
              reading: `${formatDelta(csatDelta, ' p.p.')} em relação ao período anterior`,
              action: 'Identificar os analistas com maior impacto negativo e combinar uma ação prática de qualidade.',
              severity: csatDelta < -2 ? 'Alto' : 'Médio',
            }
          : null,
        hasPreviousTeamData && teamPerformanceDelta < 0
          ? {
              label: 'Performance operacional em queda',
              reading: `${formatDelta(teamPerformanceDelta, ' p.p.')} em relação ao período anterior`,
              action: 'Conferir abandonos, escala, cobertura e possíveis gargalos do atendimento.',
              severity: teamPerformanceDelta < -1.5 ? 'Alto' : 'Médio',
            }
          : null,
        attentionCount > 0
          ? {
              label: 'Analistas que pedem acompanhamento',
              reading: `${attentionCount} analista(s) em atenção. ${attentionSummary}`,
              action: isManagementView
                ? 'Abrir a análise individual dos nomes indicados, validar a causa e registrar um feedback MIMO com uma ação mensurável para o próximo lançamento.'
                : 'Observe em sua elegibilidade qual critério precisa de recuperação.',
              severity: attentionCount >= 3 ? 'Alto' : 'Médio',
            }
          : null,
      ].filter((driver): driver is NonNullable<typeof driver> => driver !== null)
  const predictiveAction =
    !hasPeriodData
      ? 'Aguardar novos lançamentos para liberar previsao.'
      : predictiveRiskDrivers.length > 0
        ? `Alerta acionado por: ${predictiveRiskDrivers.map((driver) => driver.label.toLowerCase()).join(', ')}. Veja o diagnóstico e as ações logo abaixo.`
        : 'Nenhum alerta acionado. Manter a rotina atual e preservar a consistência até o fechamento.'
  const executiveNextAction =
    !hasPeriodData
      ? 'Conferir se os lançamentos da semana/mes ja foram feitos.'
      : attentionCount
        ? 'Abrir feedback MIMO dos analistas em atenção, combinar uma ação objetiva por critério e conferir o resultado no próximo lançamento.'
        : periodTeamPerformance < teamPerformanceGoal
          ? 'Revisar abandonos, escala e gargalos antes do fechamento.'
          : 'Comparar evolução semanal e preservar a rotina atual.'
  const executiveClosingRead =
    !hasPeriodData
      ? 'Fechamento ainda nao liberado para leitura.'
      : periodTeamPerformance < teamPerformanceGoal
        ? `Meta operacional em risco: performance atual de ${periodTeamPerformance}% para uma meta de ${teamPerformanceGoal}%. Revisar abandonos, escala e cobertura.`
        : periodAverageCsat < podiumCsatGoal
          ? `Qualidade em atenção: CSAT N1 de ${periodAverageCsat}% para a referência de ${podiumCsatGoal}%. Revisar os casos com impacto negativo.`
          : attentionCount
            ? `Pódio em atenção: ${attentionCount} analista(s) podem fechar fora dos critérios. A operação está em ${periodTeamPerformance}%, mas os casos individuais precisam de ação.`
            : 'Fechamento favorável: manter o acompanhamento até concluir o período.'

  function handlePeriodModeChange(mode: PeriodMode) {
    setPeriodFilter(createPeriodFilter(mode))
  }

  async function handleManagementAiAnalysis() {
    if (!hasPeriodData || !isManagementView) return

    setManagementAiLoading(true)
    setManagementAiMessage('Analisando os indicadores com IA...')

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('Sua sessão expirou. Entre novamente no sistema.')

      const response = await fetch('/api/management-analysis', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          periodLabel,
          riskLevel: predictiveRiskLevel,
          goalProbability: predictiveGoalProbability,
          team: {
            csat: periodAverageCsat,
            csatGoal: podiumCsatGoal,
            csatDelta,
            performance: periodTeamPerformance,
            performanceGoal: teamPerformanceGoal,
            performanceDelta: teamPerformanceDelta,
            reviewCoverage,
            reviewGoal,
            answeredCalls: teamAnsweredCalls,
            totalCalls: teamTotalCalls,
            eligibleCount,
            totalAnalysts: periodPodium.length,
          },
          analysts: attentionList.map((item) => ({
            name: item.analystName,
            csat: item.averageCsat,
            csatGoal: Math.max(item.individualGoal, podiumCsatGoal),
            reviewPercentage: item.reviewPercentage,
            reviewGoal,
            tickets: item.totalTickets,
            teamAverageTickets: periodAverageTickets,
            reasons: item.reasons,
          })),
          localDiagnosis: executiveClosingRead,
          localAction: executiveNextAction,
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data?.error || 'Não foi possível aprofundar a análise com IA.')

      setManagementAiAnalysis(data.analysis ?? '')
      setManagementAiMessage('Análise gerada pela IA com base nos cálculos deste período. Revise antes de agir.')
    } catch (error) {
      setManagementAiMessage(error instanceof Error ? error.message : 'Não foi possível consultar a IA agora.')
    } finally {
      setManagementAiLoading(false)
    }
  }
  const isAnalystDashboard = role === 'analyst'
  const analystProfile = isAnalystDashboard ? analysts[0] ?? null : null
  const localAnalystResult = isAnalystDashboard ? periodPodium[0] ?? null : null
  const secureAnalystRanking = isAnalystDashboard ? phonePodiumRanking[0] ?? null : null
  const n1TeamAverageCsat = isAnalystDashboard && secureAnalystRanking?.team_average_csat !== undefined
    ? Number(secureAnalystRanking.team_average_csat)
    : periodAverageCsat
  const analystResult = secureAnalystRanking
    ? {
        analystId: secureAnalystRanking.analyst_id,
        analystName: secureAnalystRanking.analyst_name,
        averageCsat: Number(secureAnalystRanking.average_csat),
        totalReviews: Number(secureAnalystRanking.total_reviews),
        totalTickets: Number(secureAnalystRanking.total_tickets),
        reviewPercentage: Number(secureAnalystRanking.review_percentage),
        individualGoal: Number(secureAnalystRanking.individual_goal),
        eligible: Boolean(secureAnalystRanking.eligible),
        reasons: secureAnalystRanking.reasons ?? [],
      }
    : localAnalystResult
  const analystRankingPosition = secureAnalystRanking?.position ?? (localAnalystResult ? periodPodium.findIndex((item) => item.analystId === localAnalystResult.analystId) + 1 : 0)
  const analystDataLoading = isAnalystDashboard && loading
  const launchedPeriodLabel = formatLaunchedPeriodLabel(filteredIndividualMetrics, periodFilter)
  const analystRankingRead =
    periodFilter.mode === 'month'
      ? `Ranking parcial do mês, calculado com os lançamentos já feitos em ${launchedPeriodLabel}.`
      : periodFilter.mode === 'week'
        ? `Ranking semanal calculado com os lançamentos de ${launchedPeriodLabel}.`
        : `Ranking calculado com os lançamentos de ${launchedPeriodLabel}.`
  const analystStatusText = analystResult
    ? analystResult.eligible
      ? 'Elegível para o pódio'
      : 'Fora do pódio neste período'
    : 'Sem lançamento no período'
  const analystFocusText = analystResult
    ? analystResult.eligible
      ? 'Manter CSAT, volume e percentual de avaliações ate o fechamento.'
      : analystResult.reasons.join(', ')
    : 'Selecione outro período ou aguarde o lançamento semanal.'
  const analystActionText = analystResult
    ? buildDevelopmentFocus(analystResult, csatDelta)
    : 'Aguardar lançamento do período para liberar recomendação individual.'
  const analystPulseText = analystResult
    ? analystResult.eligible
      ? analystRankingPosition > 0 && analystRankingPosition <= 3
        ? 'Você esta no pódio neste recorte. O foco e sustentar os critérios ate o fechamento.'
        : 'Você cumpre os critérios, mas ainda esta fora do top 3 neste recorte.'
      : 'Sua posição aparece no ranking, mas ainda existe critério pendente para entrar no pódio.'
    : 'Ainda nao ha dados individuais para este filtro.'
  const analystPodiumPositionStatus = analystResult
    ? !analystResult.eligible
      ? 'Fora do pódio por critério pendente'
      : analystRankingPosition > 0 && analystRankingPosition <= 3
        ? 'No pódio agora'
        : 'Elegivel, fora do top 3 agora'
    : 'Sem posição calculada'
  const analystPodiumProjectionText = analystResult
    ? !analystResult.eligible
      ? `Para projetar entrada no pódio, primeiro regularize: ${analystResult.reasons.join(', ') || 'critérios pendentes'}.`
      : periodFilter.mode === 'month'
        ? `Se mantiver este ritmo ate o fechamento, a tendencia atual e terminar em ${analystRankingPosition ? `${analystRankingPosition}o lugar` : 'posição calculada'}; a posição muda conforme os novos lançamentos do time.`
        : `Neste recorte, a posição atual e ${analystRankingPosition ? `${analystRankingPosition}o lugar` : 'calculada pelo ranking'}; no mensal, ela sera recalculada com todos os lançamentos.`
    : 'Aguardando lançamento para calcular posição e tendencia.'
  const podiumAverageFromSecureRanking = phonePodiumRanking.find((item) => Number(item.team_average_tickets) > 0)?.team_average_tickets
  const podiumAverageSource = phonePodiumRanking.length
    ? phonePodiumRanking.map((item) => Number(item.total_tickets))
    : periodPodium.map((item) => item.totalTickets)
  const podiumAverageTickets = podiumAverageFromSecureRanking
    ? Number(podiumAverageFromSecureRanking)
    : podiumAverageSource.length
      ? round(podiumAverageSource.reduce((sum, totalTickets) => sum + totalTickets, 0) / podiumAverageSource.length)
      : 0
  const analystCsatGap = analystResult ? round(Math.max(podiumCsatGoal - analystResult.averageCsat, 0)) : 0
  const analystReviewGap = analystResult ? round(Math.max(reviewGoal - analystResult.reviewPercentage, 0)) : 0
  const analystVolumeGap = analystResult ? Math.ceil(Math.max(podiumAverageTickets - analystResult.totalTickets, 0)) : 0
  const analystPodiumChecklist = [
    {
      label: 'CSAT mínimo',
      value: analystResult
        ? analystCsatGap > 0
          ? `faltam ${analystCsatGap} p.p. para ${podiumCsatGoal}%`
          : `cumprido: ${analystResult.averageCsat}%`
        : 'sem dados',
      ok: Boolean(analystResult && analystCsatGap === 0),
    },
    {
      label: 'Avaliações',
      value: analystResult
        ? analystReviewGap > 0
          ? `faltam ${analystReviewGap} p.p. para ${reviewGoal}%`
          : `cumprido: ${analystResult.reviewPercentage}%`
        : 'sem dados',
      ok: Boolean(analystResult && analystReviewGap === 0),
    },
    {
      label: 'Volume',
      value: analystResult
        ? analystVolumeGap > 0
          ? `${analystResult.totalTickets} atendimentos; faltam ${analystVolumeGap} para a média do time (${podiumAverageTickets})`
          : `${analystResult.totalTickets} atendimentos; média do time: ${podiumAverageTickets}`
        : 'sem dados',
      ok: Boolean(analystResult && podiumAverageTickets > 0 && analystVolumeGap === 0),
    },
  ]
  const analystPodiumGapText = analystResult
    ? analystResult.eligible
      ? 'Você ja cumpre os critérios objetivos. Agora o foco e preservar qualidade, avaliações e volume ate o fechamento.'
      : 'Para entrar no pódio, priorize os critérios abaixo que ainda estao pendentes neste recorte.'
    : 'Sem lançamento no período para calcular distancia ate o pódio.'
  const analystActionPlan = analystResult
    ? [
        {
          label: '1. Qualidade percebida',
          title: analystCsatGap > 0 ? `Recuperar ${analystCsatGap} p.p. de CSAT` : 'Proteger o CSAT atual',
          text:
            analystCsatGap > 0
              ? 'Nos próximos atendimentos, confirme o problema antes de orientar, valide se a solucao ficou clara e encerre perguntando se ainda ficou alguma duvida. A meta e reduzir motivos de avaliação negativa antes do próximo fechamento.'
              : 'Seu CSAT esta acima da referência. Mantenha o mesmo padrao de abertura, diagnostico e fechamento para evitar queda de qualidade no restante do período.',
        },
        {
          label: '2. Avaliações respondidas',
          title: analystReviewGap > 0 ? `Buscar mais ${analystReviewGap} p.p. em avaliações` : 'Manter boa amostra de avaliações',
          text:
            analystReviewGap > 0
              ? 'Ao perceber que o cliente teve o problema resolvido, faca um fechamento simples e objetivo pedindo a avaliação. O foco nao e forcar resposta, e aumentar a amostra para o resultado representar melhor sua entrega.'
              : 'A amostra de avaliações esta saudavel. Continue encerrando os contatos com clareza, porque um bom volume de respostas protege a leitura do seu CSAT.',
        },
        {
          label: '3. Volume de atendimento',
          title: analystVolumeGap > 0 ? `Faltam ${analystVolumeGap} atendimentos para a média` : 'Volume dentro da média do time',
          text:
            analystVolumeGap > 0
              ? `A média do time no recorte e ${podiumAverageTickets}. Combine com a gestão se houve fila, pausa, ausencia ou apoio a outro setor. Se a distribuicao estiver normal, o alvo e recuperar volume mantendo qualidade.`
              : `Você esta com ${analystResult.totalTickets} atendimentos contra média de ${podiumAverageTickets}. O cuidado agora e nao ganhar volume sacrificando CSAT ou avaliação.`,
        },
      ]
    : []
  const analystNextTargetText = analystResult
    ? analystResult.eligible
      ? analystRankingPosition > 0 && analystRankingPosition <= 3
        ? 'Meta imédiata: preservar os tres critérios e evitar queda ate o próximo lançamento.'
        : 'Meta imédiata: manter elegibilidade e buscar ganho em CSAT, avaliações ou volume para apróximar do top 3.'
      : 'Meta imédiata: resolver primeiro os critérios pendentes antes de pensar em posição no pódio.'
    : 'Meta imédiata: aguardar o lançamento do período para liberar o plano.'
  const phoneFunnelItems = [
    {
      label: 'Analistas lançados',
      value: periodPodium.length,
      detail: 'Base usada no ranking do recorte selecionado.',
    },
    {
      label: 'CSAT mínimo',
      value: periodPodium.filter((item) => item.averageCsat >= podiumCsatGoal).length,
      detail: `Bateram a referência de ${podiumCsatGoal}%.`,
    },
    {
      label: 'Avaliações',
      value: periodPodium.filter((item) => item.reviewPercentage >= reviewGoal).length,
      detail: `Mantêm amostra acima de ${reviewGoal}%.`,
    },
    {
      label: 'Volume',
      value: periodPodium.filter((item) => item.totalTickets >= podiumAverageTickets).length,
      detail: `Atendimentos iguais ou acima da média de ${podiumAverageTickets}.`,
    },
    {
      label: 'Elegíveis',
      value: eligibleCount,
      detail: 'Cumpriram todos os critérios ao mesmo tempo.',
      tone: 'success' as const,
    },
  ]
  const phoneVisualRows = periodPodium.slice(0, 10).map((item) => ({
    label: item.analystName,
    primary: item.averageCsat,
    secondary: item.reviewPercentage,
    volume: item.totalTickets,
    status: item.eligible ? 'Elegivel' : item.reasons.join(', '),
  }))
  const phoneVisualPoints = periodPodium.map((item) => ({
    label: item.analystName,
    x: item.totalTickets,
    y: item.averageCsat,
    tone: item.eligible ? 'success' : item.averageCsat < podiumCsatGoal ? 'danger' : 'warning',
    detail: `${item.reviewPercentage}% avaliações`,
  }))

  return (
    <div className="mt-8 space-y-7">
      <section className="panel">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="section-title">Periodo de análise</h2>
            <p className="section-subtitle">
              {isAnalystDashboard
                ? 'Sua performance, graficos e elegibilidade seguem este filtro.'
                : 'Os cards, graficos, pódio e insights abaixo seguem este filtro.'}
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

        {isPhoneDailyUnsupported && (
          <div className="mt-5 rounded-lg border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm leading-6 text-amber-100">
            {phoneWeeklyLaunchMessage}
          </div>
        )}

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

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {isAnalystDashboard ? (
          <>
            <AnalystIdentityCard analyst={analystProfile} />
            <MetricCard label="Atendimentos no período" value={totalTickets} tone={podiumAverageTickets && totalTickets >= podiumAverageTickets ? 'success' : podiumAverageTickets ? 'warning' : undefined} />
            <MetricCard label="Meu CSAT" value={`${analystResult?.averageCsat ?? 0}%`} tone={analystResult && analystResult.averageCsat >= analystResult.individualGoal ? 'success' : analystResult ? 'warning' : undefined} />
            <MetricCard label="CSAT equipe N1" value={`${n1TeamAverageCsat || 0}%`} tone={n1TeamAverageCsat >= podiumCsatGoal ? 'success' : n1TeamAverageCsat >= podiumCsatGoal - 5 ? 'warning' : 'danger'} />
            <MetricCard label="CSAT geral N1 + N2 · média do período" value={overallPhoneCsat === null ? 'Não informado' : `${overallPhoneCsat}%`} tone={overallPhoneCsat === null ? undefined : overallPhoneCsat >= podiumCsatGoal ? 'success' : overallPhoneCsat >= podiumCsatGoal - 5 ? 'warning' : 'danger'} />
            <MetricCard label="Avaliações" value={`${totalReviews} (${reviewCoverage}%)`} tone={reviewCoverage >= reviewGoal ? 'success' : reviewCoverage >= 20 ? 'warning' : 'danger'} />
          </>
        ) : (
          <>
            <MetricCard label="Status" value="Supabase conectado" tone="success" />
            <MetricCard label="Analistas ativos" value={loading ? '...' : analystsCount} />
            <MetricCard label="CSAT equipe N1" value={`${n1TeamAverageCsat || 0}%`} tone={n1TeamAverageCsat >= podiumCsatGoal ? 'success' : n1TeamAverageCsat >= podiumCsatGoal - 5 ? 'warning' : 'danger'} />
            <MetricCard label="CSAT geral N1 + N2 · média do período" value={overallPhoneCsat === null ? 'Não informado' : `${overallPhoneCsat}%`} tone={overallPhoneCsat === null ? undefined : overallPhoneCsat >= podiumCsatGoal ? 'success' : overallPhoneCsat >= podiumCsatGoal - 5 ? 'warning' : 'danger'} />
            <MetricCard label="Performance equipe" value={`${periodTeamPerformance || 0}%`} tone={periodTeamPerformance >= teamPerformanceGoal ? 'success' : periodTeamPerformance >= teamPerformanceGoal - 3 ? 'warning' : 'danger'} />
          </>
        )}
      </div>

      {isAnalystDashboard && (
        <div className="rounded-lg border border-slate-700 bg-slate-900/70 px-4 py-3 text-sm leading-6 text-slate-300">
          O CSAT da equipe N1 reúne os oito analistas do telefone. O CSAT geral inclui também os atendimentos de transbordo do N2 e serve como contexto da operação; ele não altera seu pódio individual.
        </div>
      )}

      {isManagementView && (
        <section className="panel border border-cyan-400/20">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.16em] text-cyan-300">Diagnóstico reservado</p>
              <h2 className="section-title mt-2">Impacto no CSAT do telefone</h2>
              <p className="section-subtitle">Visível apenas para master e coordenadora. O pódio continua considerando somente os analistas do N1.</p>
            </div>
            <span className="rounded-md bg-cyan-400/10 px-3 py-2 text-sm font-semibold text-cyan-200">Gestão</span>
          </div>

          {overallPhoneCsat === null ? (
            <div className="mt-5 rounded-lg bg-slate-900 p-4 text-sm text-slate-300">
              Informe o CSAT geral do 55PBX no fechamento semanal para liberar a comparação N1 versus N2.
            </div>
          ) : (
            <>
              <div className="mt-5 grid gap-4 md:grid-cols-3">
                <MetricCard label="CSAT N1 comparável" value={`${n1ComparisonCsat}%`} />
                <MetricCard label="CSAT geral" value={`${overallPhoneCsat}%`} />
                <MetricCard label="Diferença geral x N1" value={`${overallCsatGap && overallCsatGap > 0 ? '+' : ''}${overallCsatGap ?? 0} p.p.`} tone={overallCsatGap !== null && overallCsatGap < 0 ? 'danger' : 'success'} />
              </div>

              <div className="mt-5 grid gap-4 lg:grid-cols-2">
                <div className="rounded-lg bg-slate-900 p-4">
                  <h3 className="font-semibold text-slate-100">Onde está a diferença?</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-300">
                    {overallCsatGap !== null && overallCsatGap < -0.01
                      ? `O resultado geral está ${Math.abs(overallCsatGap)} p.p. abaixo do N1. Como o geral inclui o N2, esta diferença indica que o conjunto externo ao N1 reduziu o consolidado. Sem as avaliações individuais do N2, não é possível atribuir o efeito a uma pessoa específica.`
                      : overallCsatGap !== null && overallCsatGap > 0.01
                        ? `O resultado geral está ${overallCsatGap} p.p. acima do N1. Neste recorte, o conjunto externo ao N1 melhora o consolidado da operação.`
                        : 'N1 e resultado geral estão praticamente alinhados neste período.'}
                  </p>
                  {!hasCompleteOverallCoverage && (
                    <p className="mt-3 text-xs leading-5 text-amber-200">Atenção: parte das semanas do filtro ainda não possui o CSAT geral informado; a comparação cobre somente as semanas preenchidas.</p>
                  )}
                  <p className="mt-3 text-xs leading-5 text-slate-400">Em filtros com várias semanas, o CSAT geral representa a média dos fechamentos semanais informados.</p>
                </div>

                <div className="rounded-lg bg-slate-900 p-4">
                  <h3 className="font-semibold text-slate-100">Impacto matemático dentro do N1</h3>
                  <p className="mt-2 text-xs leading-5 text-slate-400">A leitura considera CSAT e quantidade de avaliações. Ela indica impacto no número consolidado, não culpa ou causa operacional.</p>
                  <div className="mt-3 space-y-2">
                    {n1ImpactRanking.filter((item) => item.downwardImpact > 0).slice(0, 3).map((item) => (
                      <div key={item.analystName} className="flex flex-col gap-1 rounded-md bg-slate-950 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                        <span className="font-semibold">{item.analystName}</span>
                        <span className="text-slate-300">{item.averageCsat}% CSAT · {item.reviews} avaliações · impacto de {item.downwardImpact} p.p.</span>
                      </div>
                    ))}
                    {!n1ImpactRanking.some((item) => item.downwardImpact > 0) && (
                      <p className="text-sm text-slate-300">Nenhum impacto negativo individual relevante foi identificado no N1 neste recorte.</p>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </section>
      )}

      <CriteriaLegend
        title={isAnalystDashboard ? 'Critérios para disputar o pódio' : 'Critérios do pódio do telefone'}
        items={[
          `CSAT mínimo de ${podiumCsatGoal}%`,
          `Avaliações a partir de ${reviewGoal}%`,
          `Volume igual ou acima da média do time (${podiumAverageTickets || 0} atendimentos)`,
        ]}
      />

      <section className="panel">
        <h2 className="section-title">Projeção do fechamento</h2>
        <p className="section-subtitle">
          Mostra para onde os indicadores apontam se a tendência atual continuar. A projeção não altera os resultados já apurados.
        </p>

        <div className="mt-6 grid gap-4 lg:grid-cols-4">
          <PredictiveCard
            label="Chance geral de fechamento"
            value={`${predictiveGoalProbability}%`}
            detail={
              hasPeriodData
                ? `Leitura combinada de CSAT, performance, avaliações e pódio. ${eligibleCount} de ${periodPodium.length} elegíveis.`
                : 'Sem base de dados no período.'
            }
            tone={predictiveGoalProbability >= 75 ? 'success' : predictiveGoalProbability >= 45 ? 'warning' : 'danger'}
          />
          <PredictiveCard
            label="CSAT projetado"
            value={`${projectedCsat}%`}
            detail={hasPreviousIndividualData
              ? `Resultado esperado se a tendência continuar. ${formatDelta(csatDelta, ' p.p.')} vs período anterior.`
              : 'Resultado esperado com a base atual. Ainda não há período anterior equivalente para comparação.'}
            tone={projectedCsat >= podiumCsatGoal ? 'success' : 'warning'}
          />
          <PredictiveCard
            label="Performance projetada"
            value={`${projectedTeamPerformance}%`}
            detail={hasPreviousTeamData
              ? `Valor esperado da operação se a tendência continuar. Meta: ${teamPerformanceGoal}%.`
              : `Valor esperado com a base atual. Meta: ${teamPerformanceGoal}%; ainda sem período anterior equivalente.`}
            tone={projectedTeamPerformance >= teamPerformanceGoal ? 'success' : 'danger'}
          />
          <PredictiveCard
            label="Risco do período"
            value={predictiveRiskLevel}
            detail={predictiveAction}
            tone={predictiveRiskLevel === 'Baixo' ? 'success' : predictiveRiskLevel === 'Medio' ? 'warning' : 'danger'}
          />
        </div>

        <div className="mt-5 rounded-lg bg-slate-900 p-5">
          <p className="text-sm font-semibold text-slate-200">Como ler esta projeção</p>
          <div className="mt-3 grid gap-3 text-sm leading-6 text-slate-400 md:grid-cols-2">
            <p>
              A chance geral combina CSAT, performance, avaliações e quantidade de analistas elegíveis. Ela não é o
              mesmo número da performance operacional.
            </p>
            <p>
              CSAT e performance projetados são valores esperados, não probabilidades. O diagnóstico abaixo explica
              por que o risco foi acionado e qual ação deve ser tomada.
            </p>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-stretch">
          <div className="xl:w-2/5">
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-cyan-300">
              {isAnalystDashboard ? 'Resumo individual' : 'Diagnóstico e plano de ação'}
            </p>
            <h2 className={`mt-3 text-3xl font-bold ${isAnalystDashboard ? 'text-cyan-300' : attentionCount ? 'text-amber-300' : 'text-emerald-300'}`}>
              {isAnalystDashboard
                ? analystStatusText
                : `${eligibleCount} de ${periodPodium.length} analistas elegíveis`}
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              {isAnalystDashboard
                ? analystFocusText
                : `${periodLabel}. O detalhamento abaixo mostra quem precisa de atenção, qual critério não foi cumprido e a próxima ação recomendada.`}
            </p>
          </div>

          <div className="grid flex-1 gap-4 md:grid-cols-3">
            <div className="executive-card">
              <p>{isAnalystDashboard ? 'Atendimentos no período' : hasPreviousIndividualData ? 'CSAT vs período anterior' : 'CSAT do período'}</p>
              <strong>
                {isAnalystDashboard
                  ? totalTickets
                  : hasPreviousIndividualData
                    ? formatDelta(csatDelta, ' p.p.')
                    : `${periodAverageCsat || 0}%`}
              </strong>
              <span>
                {isAnalystDashboard
                  ? `${totalReviews} avaliações registradas em ${launchedPeriodLabel}`
                  : hasPreviousIndividualData
                    ? `Atual: ${periodAverageCsat || 0}%`
                    : 'Sem período anterior equivalente para comparação'}
              </span>
            </div>
            <div className="executive-card">
              <p>Performance equipe</p>
              <strong>{periodTeamPerformance || 0}%</strong>
              <span>
                {hasPreviousTeamData
                  ? `${formatDelta(teamPerformanceDelta, ' p.p.')} vs anterior`
                  : 'Sem período anterior equivalente para comparação'}
              </span>
            </div>
            <div className="executive-card">
              <p>{isAnalystDashboard ? 'Minhas avaliações' : 'Cobertura de avaliações'}</p>
              <strong>{reviewCoverage}%</strong>
              <span>{totalReviews} avaliações respondidas de {totalTickets} atendimentos</span>
            </div>
          </div>
        </div>

        <div className="mt-5 rounded-lg bg-slate-900 p-5">
          <div className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-200">Onde está o risco?</p>
              <p className="mt-1 text-sm text-slate-400">
                Veja o que elevou o alerta, quem precisa de atenção e a ação recomendada para cada caso.
              </p>
            </div>
            <span className="text-sm font-semibold text-slate-300">
              Risco do período: {predictiveRiskLevel}
            </span>
          </div>

          {hasPeriodData && (
            <div className="mt-4 rounded-lg border border-cyan-400/20 bg-slate-950/60 p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="font-semibold text-white">Ritmo entre a primeira e a última semana</p>
                <span className={weeklyPaceRisks.length ? 'text-amber-200' : 'text-emerald-300'}>
                  {hasWeeklyPaceComparison
                    ? weeklyPaceRisks.length ? 'Tendência exige atenção' : 'Tendência favorável'
                    : 'Aguardando comparação'}
                </span>
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-300">{weeklyPaceRead}</p>
              <p className="mt-2 text-sm leading-6 text-slate-400">Próxima ação: {weeklyPaceAction}</p>
            </div>
          )}

          {!hasPeriodData ? (
            <p className="mt-4 text-sm text-slate-400">Ainda não há dados suficientes para localizar riscos.</p>
          ) : predictiveRiskDrivers.length ? (
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {predictiveRiskDrivers.map((driver) => (
                <div key={driver.label} className="rounded-lg border border-white/10 bg-slate-950/60 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold text-white">{driver.label}</p>
                    <span className={driver.severity === 'Alto' ? 'text-rose-300' : 'text-amber-300'}>
                      {driver.severity}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-slate-300">Leitura: {driver.reading}.</p>
                  <p className="mt-2 text-sm leading-6 text-slate-400">Próxima ação: {driver.action}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-4 rounded-lg border border-emerald-400/20 bg-emerald-400/5 p-4">
              <p className="font-semibold text-emerald-300">Cenário estável neste período.</p>
              <p className="mt-2 text-sm text-slate-300">
                O risco de queda está baixo porque nenhum indicador acionou alerta. CSAT, performance,
                chance de fechamento e critérios do pódio estão estáveis neste recorte.
              </p>
            </div>
          )}
        </div>

        {!isAnalystDashboard && (
          <div className="mt-5">
            <div className="rounded-lg border border-cyan-400/20 bg-slate-900 p-5">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="font-semibold text-white">Aprofundamento com IA</p>
                  <p className="mt-1 text-sm leading-6 text-slate-400">
                    A IA interpreta os cálculos acima, prioriza ações e explica como acompanhar o próximo resultado.
                    Ela não altera números, critérios ou posições do pódio.
                  </p>
                </div>
                <button
                  className="primary-button shrink-0 disabled:cursor-not-allowed disabled:opacity-60"
                  type="button"
                  disabled={!hasPeriodData || managementAiLoading}
                  onClick={handleManagementAiAnalysis}
                >
                  {managementAiLoading ? 'Analisando...' : 'Aprofundar análise com IA'}
                </button>
              </div>
              {managementAiMessage && (
                <p className="mt-4 text-sm text-cyan-100">{managementAiMessage}</p>
              )}
              {managementAiAnalysis && (
                <div className="mt-4 whitespace-pre-line rounded-lg border border-white/10 bg-slate-950/70 p-5 text-sm leading-7 text-slate-200">
                  {managementAiAnalysis}
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      {!isAnalystDashboard && (
        <section className="panel">
          <h2 className="section-title">Análise visual do período</h2>
          <p className="section-subtitle">
            Compare elegibilidade, qualidade e volume para localizar rapidamente onde a equipe ganha ou perde força.
          </p>

          <div className="mt-6 grid gap-6 xl:grid-cols-[0.85fr_1.15fr]">
            <EligibilityFunnel
              title="Funil de elegibilidade do telefone"
              subtitle="Mostra em qual critério o time perde força antes do fechamento do pódio."
              items={phoneFunnelItems}
            />
            <ComparisonBars
              title="Comparativo visual dos analistas"
              subtitle="Mostra rapidamente quem combina CSAT, avaliações e volume de atendimentos no período."
              rows={phoneVisualRows}
              primaryGoal={podiumCsatGoal}
              secondaryGoal={reviewGoal}
              volumeReference={podiumAverageTickets}
            />
            <div className="xl:col-span-2">
              <VolumeQualityMap
                title="Mapa volume x CSAT"
                subtitle="Quanto mais para a direita, maior o volume. Quanto mais para cima, melhor o CSAT."
                points={phoneVisualPoints}
                xReference={podiumAverageTickets}
                yReference={podiumCsatGoal}
              />
            </div>
          </div>
        </section>
      )}

      <section className="panel">
        <h2 className="section-title">
          {isAnalystDashboard ? 'Minha evolução recente' : 'Variações recentes'}
        </h2>
        <p className="section-subtitle">
          {isAnalystDashboard
            ? `Seu comportamento dentro de ${periodLabel}.`
            : `Evolucao calculada dentro de ${periodLabel}.`}
        </p>

        <div className="mt-6 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          <TrendLineChart
            label={isAnalystDashboard ? 'Meu CSAT semanal' : 'CSAT médio semanal'}
            points={weeklyIndividualTrend.map((item) => ({
              label: item.label,
              value: item.csat,
            }))}
            suffix="%"
          />
          <BarTrend
            label={isAnalystDashboard ? 'Minhas avaliações por semana' : 'Avaliações por semana'}
            points={weeklyIndividualTrend.map((item) => ({
              label: item.label,
              value: item.totalReviews,
            }))}
          />
          <BarTrend
            label={isAnalystDashboard ? 'Meus atendimentos por semana' : 'Atendimentos por semana'}
            points={weeklyIndividualTrend.map((item) => ({
              label: item.label,
              value: item.totalTickets,
            }))}
          />
          <TrendLineChart
            label="Performance da equipe"
            points={teamPerformanceTrend}
            suffix="%"
          />
          <TrendLineChart
            label="CSAT geral N1 + N2 por semana"
            points={overallCsatTrend}
            suffix="%"
          />
          <TrendLineChart
            label={isAnalystDashboard ? 'Meu percentual de avaliações por semana' : 'Cobertura de avaliações por semana'}
            points={weeklyReviewCoverageTrend}
            suffix="%"
            goal={reviewGoal}
            goalLabel="Meta do pódio"
          />
        </div>
      </section>

      <section className="panel">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="section-title">
              {isAnalystDashboard ? 'Minha elegibilidade' : 'Ranking completo do período'}
            </h2>
            <p className="section-subtitle">
              {isAnalystDashboard
                ? `Sua leitura em ${launchedPeriodLabel}: CSAT mínimo ${podiumCsatGoal}%, avaliações ${reviewGoal}% e volume comparado com a média dos analistas lançados.`
                : `Ranking de ${periodLabel}: CSAT mínimo ${podiumCsatGoal}%, avaliações ${reviewGoal}% e atendimentos dentro da média da equipe.`}
            </p>
            {!isAnalystDashboard && (
              <p className="mt-2 text-sm text-slate-400">
                Média de atendimentos do time neste recorte: <span className="font-semibold text-slate-200">{podiumAverageTickets || 0}</span>.
              </p>
            )}
          </div>
        </div>

        {isAnalystDashboard ? (
          <div className="mt-6 grid gap-4 lg:grid-cols-3">
            <div className="rounded-lg bg-slate-900 p-5">
              <p className="text-sm text-slate-400">Status do período</p>
              <h3 className={`mt-2 text-2xl font-bold ${analystDataLoading ? 'text-cyan-300' : analystResult?.eligible ? 'text-emerald-300' : 'text-cyan-300'}`}>
                {analystDataLoading ? 'Atualizando leitura...' : analystStatusText}
              </h3>
              <p className="mt-3 text-sm text-slate-400">
                {analystDataLoading ? 'Buscando lançamentos e recalculando sua posição com os dados do período.' : analystPulseText}
              </p>
            </div>

            <div className="rounded-lg bg-slate-900 p-5">
              <p className="text-sm text-slate-400">CSAT e avaliações</p>
              <p className="mt-2 text-3xl font-bold text-cyan-300">
                {analystResult?.averageCsat ?? 0}%
              </p>
              <p className="mt-2 text-sm text-slate-400">
                {analystResult?.reviewPercentage ?? 0}% avaliações | meta {reviewGoal}%
              </p>
            </div>

            <div className="rounded-lg bg-slate-900 p-5">
              <p className="text-sm text-slate-400">Posição e previsão</p>
              <p className="mt-2 text-3xl font-bold">{analystDataLoading ? '...' : analystRankingPosition ? `${analystRankingPosition}o` : '-'}</p>
              <p className={`mt-2 text-sm font-semibold ${analystDataLoading ? 'text-cyan-300' : analystResult?.eligible && analystRankingPosition <= 3 ? 'text-emerald-300' : analystResult?.eligible ? 'text-cyan-300' : 'text-amber-200'}`}>
                {analystDataLoading ? 'Calculando com os dados do período' : analystPodiumPositionStatus}
              </p>
              <p className="mt-2 text-sm text-slate-400">
                {analystDataLoading ? 'Aguarde a leitura final do banco antes de considerar a posição.' : `${analystRankingRead} ${analystPodiumProjectionText}`}
              </p>
            </div>

            <div className="rounded-lg bg-slate-900 p-5 lg:col-span-3">
              <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                <div>
                  <p className="text-sm text-slate-400">O que falta para o pódio?</p>
                  <h3 className="mt-2 text-2xl font-bold text-cyan-300">
                    {analystDataLoading ? 'Calculando critérios' : analystResult?.eligible ? 'Você esta dentro dos critérios' : 'Distancia ate o pódio'}
                  </h3>
                </div>
                <p className="max-w-2xl text-sm leading-6 text-slate-400">
                  {analystDataLoading ? 'Aguarde enquanto o sistema cruza CSAT, avaliações, volume e ranking do período.' : analystPodiumGapText}
                </p>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                {analystPodiumChecklist.map((item) => (
                  <div key={item.label} className="rounded-md bg-slate-950/60 p-4">
                    <p className="text-sm text-slate-400">{item.label}</p>
                    <p className={`mt-2 font-semibold ${item.ok ? 'text-emerald-300' : 'text-amber-200'}`}>{item.value}</p>
                  </div>
                ))}
              </div>

              {analystResult && (
                <div className="mt-4 rounded-md bg-slate-950/60 p-4">
                  <p className="text-sm font-semibold text-slate-200">Meu mapa visual dos critérios</p>
                  <p className="mt-1 text-xs leading-5 text-slate-400">
                    Compare seu resultado com a referência do pódio e veja rapidamente onde proteger ou recuperar desempenho.
                  </p>
                  <div className="mt-4 grid gap-3 lg:grid-cols-3">
                    <ProgressMetric label="CSAT" value={analystResult.averageCsat} goal={podiumCsatGoal} suffix="%" tone="cyan" />
                    <ProgressMetric label="Avaliações" value={analystResult.reviewPercentage} goal={reviewGoal} suffix="%" tone="emerald" />
                    <ProgressMetric
                      label="Volume"
                      value={analystResult.totalTickets}
                      goal={podiumAverageTickets}
                      max={Math.max(analystResult.totalTickets, podiumAverageTickets, 1)}
                      tone="amber"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="mt-6 grid gap-4 md:grid-cols-3">
              {[0, 1, 2].map((index) => {
                const winner = podiumWinners[index]
                const winnerAnalyst = winner
                  ? analysts.find((analyst) => analyst.id === winner.analystId)
                  : null

                return (
                  <div key={index} className="rounded-lg bg-slate-900 p-5">
                    <p className="text-sm text-slate-400">{index + 1}o lugar</p>
                    {winner ? (
                      <>
                        <div className="mt-3 flex items-center gap-3">
                          <AnalystAvatar
                            name={winner.analystName}
                            photoUrl={winnerAnalyst?.photo_url}
                            size="md"
                          />
                          <h3 className="text-xl font-bold">{winner.analystName}</h3>
                        </div>
                        <p className="mt-3 text-3xl font-bold text-cyan-300">{winner.averageCsat}%</p>
                        <p className="mt-2 text-sm text-slate-400">
                          {winner.reviewPercentage}% avaliações | {winner.totalTickets} atendimentos
                        </p>
                      </>
                    ) : (
                      <p className="mt-5 text-sm text-slate-500">Aguardando elegível</p>
                    )}
                  </div>
                )
              })}
            </div>

            <div className="mt-6 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="text-slate-400">
                  <tr>
                    <th className="pb-3 pr-4 font-medium">Posição</th>
                    <th className="pb-3 pr-4 font-medium">Analista</th>
                    <th className="pb-3 pr-4 font-medium">CSAT período</th>
                    <th className="pb-3 pr-4 font-medium">Avaliações</th>
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
                          <span className="text-emerald-300">Elegível</span>
                        ) : (
                          <span className="text-slate-400">{item.reasons.join(', ')}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {!periodPodium.length && (
                <EmptyState text="Ainda nao ha lançamentos individuais no período selecionado." />
              )}
            </div>
          </>
          )}
      </section>

      {isAnalystDashboard && (
        <section className="panel">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="eyebrow">Plano de ação individual</p>
              <h2 className="section-title">Minha próxima jogada</h2>
              <p className="section-subtitle">
                Orientação pratica para transformar a leitura do pódio em comportamento no próximo ciclo.
              </p>
            </div>
            <div className="rounded-lg bg-slate-900 p-4 text-sm font-semibold text-cyan-200 md:max-w-md">
              {analystNextTargetText}
            </div>
          </div>

          {analystActionPlan.length ? (
            <div className="mt-6 grid gap-4 lg:grid-cols-3">
              {analystActionPlan.map((item) => (
                <div key={item.label} className="rounded-lg bg-slate-900 p-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">{item.label}</p>
                  <h3 className="mt-3 text-xl font-bold">{item.title}</h3>
                  <p className="mt-3 text-sm leading-6 text-slate-300">{item.text}</p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState text="Assim que houver lançamento no período, o plano de ação individual aparece aqui." />
          )}
        </section>
      )}

      {isAnalystDashboard && (
      <section className="panel">
        <h2 className="section-title">Meus insights do período</h2>
        <p className="section-subtitle">
          Leitura rápida para acompanhar seu desempenho sem abrir histórico de lançamentos.
        </p>

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
              <p className="text-sm text-slate-400">Ponto de atenção</p>
              <p className="mt-2 text-xl font-bold">
                {analystResult ? analystActionText : 'Sem dados no período'}
              </p>
              <p className="mt-2 text-sm text-slate-400">
                Esta recomendação muda conforme o período selecionado no filtro.
              </p>
            </div>

            <div className="rounded-lg bg-slate-900 p-5">
              <p className="text-sm text-slate-400">Equipe no período</p>
              <p className="mt-2 text-3xl font-bold text-emerald-300">
                {periodTeamPerformance || 0}%
              </p>
              <p className="mt-2 text-sm text-slate-400">
                Referencia geral da operação: {teamPerformanceGoal}%.
              </p>
            </div>
        </div>
      </section>
      )}
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
  const [phoneManagerNotes, setPhoneManagerNotes] = useState('')
  const [phoneFeedbackDraft, setPhoneFeedbackDraft] = useState('')
  const [phoneFeedbackStyle, setPhoneFeedbackStyle] = useState<ChatFeedbackStyle>('mimo')
  const [phoneFeedbackGoal, setPhoneFeedbackGoal] = useState<FeedbackGoal>('development')
  const [phoneFeedbackTone, setPhoneFeedbackTone] = useState<FeedbackTone>('human')
  const [phoneAiSaving, setPhoneAiSaving] = useState(false)
  const isPhoneDailyUnsupported = isPhonePeriodShorterThanWeeklyLaunch(periodFilter)
  const phoneWeeklyLaunchMessage =
    'Os dados do telefone são lançados por semana. Para leitura diária, seria necessário lançar os atendimentos por dia.'
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

  useEffect(() => {
    setPhoneFeedbackDraft('')
    setExportMessage('')
  }, [periodFilter.start, periodFilter.end, selectedAnalystId, phoneFeedbackStyle])


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
      ? 'Operação dentro da referência.'
      : 'Operação abaixo da referência definida.'
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
  const supervisorAverageTickets = podium.length
    ? Math.ceil(podium.reduce((sum, item) => sum + item.totalTickets, 0) / podium.length)
    : 0
  const supervisorVolumeGap = analystResult ? analystResult.totalTickets - supervisorAverageTickets : 0
  const supervisorReviewGap = analystResult ? round(analystResult.reviewPercentage - reviewGoal) : 0
  const supervisorCsatGap = analystResult ? round(analystResult.averageCsat - podiumCsatGoal) : 0
  const supervisorCaseStatus = analystResult
    ? analystResult.eligible
      ? selectedRankingPosition > 0 && selectedRankingPosition <= 3
        ? 'Caso de reconhecimento e preservação'
        : 'Caso elegivel para desenvolvimento competitivo'
      : 'Caso de acompanhamento ativo'
    : 'Sem leitura disponível'
  const supervisorDecisionText = analystResult
    ? analystResult.eligible
      ? selectedRankingPosition > 0 && selectedRankingPosition <= 3
        ? 'Reconhecer o resultado, registrar as praticas que sustentaram o desempenho e combinar como proteger o padrao ate o fechamento.'
        : 'Manter elegibilidade, comparar com o top 3 e escolher um ganho objetivo em CSAT, avaliações ou volume para disputar posição.'
      : `Tratar os critérios pendentes antes de falar em pódio: ${analystResult.reasons.join(', ') || 'revisar indicadores'}.`
    : 'Selecione um analista com lançamento no período para liberar recomendação.'
  const supervisorOneToOneText = analystResult
    ? analystResult.eligible
      ? 'Use a conversa 1:1 para perguntar quais comportamentos ajudaram o resultado, quais atendimentos devem virar referência e qual rotina precisa ser repetida.'
      : 'Use a conversa 1:1 para identificar causa raiz: qualidade do atendimento, encerramento sem pedido de avaliação, volume abaixo da média ou contexto operacional.'
    : 'Aguardando dados para sugerir roteiro de conversa.'
  const supervisorFollowUpText = analystResult
    ? `No próximo ciclo, acompanhar CSAT ${analystResult.averageCsat}% (${formatDelta(supervisorCsatGap, ' p.p.')} vs pódio), avaliações ${analystResult.reviewPercentage}% (${formatDelta(supervisorReviewGap, ' p.p.')} vs meta) e volume ${analystResult.totalTickets} (${formatDelta(supervisorVolumeGap, '')} vs média ${supervisorAverageTickets}).`
    : 'Sem acompanhamento definido.'
  const supervisorPeriodTypeText =
    periodFilter.mode === 'week'
      ? 'Leitura semanal'
      : periodFilter.mode === 'month'
        ? 'Leitura mensal acumulada'
        : periodFilter.mode === 'year'
          ? 'Leitura anual acumulada'
          : 'Leitura personalizada'
  const supervisorPeriodStatusText =
    periodFilter.mode === 'month'
      ? 'O mes e recalculado conforme novas semanas forem lancadas.'
      : periodFilter.mode === 'year'
        ? 'O ano e recalculado conforme novos meses e semanas forem lancados.'
        : periodFilter.mode === 'week'
          ? 'A semana representa o recorte selecionado para acompanhamento.'
          : 'O resultado segue exatamente o intervalo escolhido.'
  const supervisorComparisonText = `Comparativo contra período anterior equivalente: ${formatPeriodLabel(previousPeriod)}.`
  const supervisorContextCards = [
    { label: 'Recorte analisado', value: periodLabel, detail: supervisorPeriodTypeText },
    { label: 'Base da leitura', value: selectedAnalyst?.name ?? 'Sem analista', detail: supervisorPeriodStatusText },
    { label: 'Comparativo usado', value: formatPeriodLabel(previousPeriod), detail: supervisorComparisonText },
  ]
  const supervisorActionCards = [
    {
      label: 'Diagnóstico',
      title: supervisorCaseStatus,
      text: analystResult
        ? `Ranking atual: ${selectedRankingPosition || '-'}o. CSAT ${analystResult.averageCsat}%, avaliações ${analystResult.reviewPercentage}% e ${analystResult.totalTickets} atendimentos contra média ${supervisorAverageTickets}.`
        : 'Selecione um analista e período com dados para calcular a leitura.',
    },
    {
      label: 'Acao recomendada',
      title: analystResult?.eligible ? 'Preservar ou competir' : 'Corrigir impeditivos',
      text: supervisorDecisionText,
    },
    {
      label: 'Conversa 1:1',
      title: 'Pergunta que destrava ação',
      text: supervisorOneToOneText,
    },
    {
      label: 'Proximo acompanhamento',
      title: 'Indicadores para revisar',
      text: supervisorFollowUpText,
    },
  ]
  const situationText = selectedAnalyst && analystResult
    ? `${selectedAnalyst.name} fechou ${periodLabel} com CSAT de ${analystResult.averageCsat}%, ${analystResult.totalReviews} avaliações e ${analystResult.totalTickets} atendimentos registrados. A meta individual e ${analystResult.individualGoal}% e a referência para pódio e ${podiumCsatGoal}%. A variação contra o período anterior foi de ${formatDelta(csatDelta, ' p.p.')}.`
    : ''
  const actionText = analystResult
    ? analystResult.eligible
      ? 'Foram alinhadas a manutencao das praticas atuais, a preservação do volume de avaliações e o acompanhamento semanal de qualquer oscilação antes do fechamento do ciclo.'
      : `Foram alinhadas a priorização dos pontos: ${analystResult.reasons.join(', ')}. A recomendação inicial e revisar atendimentos de menor satisfação, reforcar o convite para avaliação e acompanhar o indicador semanalmente.`
    : ''
  const resultText = analystResult
    ? analystResult.eligible
      ? `Resultado esperado: manter CSAT acima de ${podiumCsatGoal}%, preservar elegibilidade ao pódio e sustentar volume de avaliações igual ou superior a ${reviewGoal}% dos atendimentos.`
      : `Resultado esperado: recuperar os pontos impeditivos para apróximar o desempenho da referência de pódio (${podiumCsatGoal}%) e elevar a consistencia do indicador no próximo ciclo.`
    : ''
  const evolutionText = analystResult
    ? `Expectativa e plano de desenvolvimento: ${buildDevelopmentFocus(analystResult, csatDelta)} Perguntas sugeridas para 1:1: o que ajudou ou atrapalhou o CSAT no período? quais atendimentos merecem revisao? qual ação simples pode aumentar avaliações na próxima semana?`
    : ''
  const feedbackSummary = analystResult
    ? analystResult.eligible
      ? `${selectedAnalyst?.name ?? 'Analista'} esta elegivel ao pódio no período. O foco recomendado e preservar consistencia, volume de avaliações e acompanhamento semanal.`
      : `${selectedAnalyst?.name ?? 'Analista'} ainda nao sustenta elegibilidade ao pódio neste período. O foco recomendado e atuar sobre: ${analystResult.reasons.join(', ')}.`
    : ''
  const phoneFeedbackSuggestion = selectedAnalyst && analystResult
    ? buildPhoneFeedbackText({
        analystName: selectedAnalyst.name,
        periodLabel,
        analystResult,
        podiumCsatGoal,
        reviewGoal,
        csatDelta,
        teamPerformance,
        teamPerformanceGoal,
        teamAnsweredCalls,
        teamTotalCalls,
        rankingPosition: selectedRankingPosition,
        managerNotes: phoneManagerNotes,
        style: phoneFeedbackStyle,
      })
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
      label: 'Lancamento individual no período',
      done: hasAnalystLaunch,
      detail: hasAnalystLaunch ? 'Dados individuais encontrados.' : 'Não ha lançamento individual para este filtro.',
    },
    {
      label: 'Desempenho da equipe',
      done: hasTeamLaunch,
      detail: hasTeamLaunch
        ? `${teamPerformance}% de performance no período.`
        : 'Sem lançamento de equipe; o relatório sai, mas a leitura operacional fica incompleta.',
    },
  ]
  function handlePeriodModeChange(mode: PeriodMode) {
    setPeriodFilter(createPeriodFilter(mode))
  }

  function handleGeneratePhoneFeedbackDraft() {
    if (!selectedAnalyst || !analystResult) {
      setExportMessage('Selecione um analista e um período com lançamento antes de gerar o feedback.')
      return
    }

    setPhoneFeedbackDraft(phoneFeedbackSuggestion)
    setExportMessage('Sugestão local gerada. Revise o texto antes de exportar.')
  }

  async function handleGeneratePhoneFeedbackWithAi() {
    if (!selectedAnalyst || !analystResult) {
      setExportMessage('Selecione um analista e um período com lançamento antes de acionar a IA.')
      return
    }

    setPhoneAiSaving(true)
    setExportMessage('')

    try {
      const averageTickets =
        podium.length > 0
          ? round(podium.reduce((sum, item) => sum + item.totalTickets, 0) / podium.length)
          : 0
      const response = await fetch('/api/chat-feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          serviceModule: 'phone',
          feedbackStyle: phoneFeedbackStyle,
          feedbackGoal: phoneFeedbackGoal,
          feedbackTone: phoneFeedbackTone,
          generationMode: 'generate',
          periodLabel,
          managerNotes: phoneManagerNotes,
          fallbackText: phoneFeedbackSuggestion,
          averageTickets,
          podiumPosition: selectedRankingPosition,
          metric: {
            analystName: selectedAnalyst.name,
            teamName: 'Telefone',
            csat: analystResult.averageCsat,
            reviewPercentage: analystResult.reviewPercentage,
            totalTickets: analystResult.totalTickets,
            reviews: analystResult.totalReviews,
            csatGoal: analystResult.individualGoal,
            reviewGoal,
            status: analystResult.eligible ? 'Elegivel ao pódio' : 'Em acompanhamento',
            teamPerformance,
            teamAnsweredCalls,
            teamTotalCalls,
          },
          monthlyHistory: weeklyEvolution.map((item) => ({
            monthLabel: item.label,
            csat: item.csat,
            reviewPercentage: item.totalTickets ? round((item.totalReviews / item.totalTickets) * 100) : 0,
            sendingPercentage: 0,
            totalTickets: item.totalTickets,
          })),
        }),
      })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Não foi possível gerar texto com IA.')
      }

      setPhoneFeedbackDraft(normalizePhoneReportFeedback(data.feedback ?? '', phoneFeedbackSuggestion, phoneFeedbackStyle))
      setExportMessage(data.warning || 'Feedback do telefone gerado com IA. Revise o texto antes de exportar.')
    } catch (error) {
      setPhoneFeedbackDraft(phoneFeedbackSuggestion)
      setExportMessage(`A IA externa nao gerou um texto valido agora. Usei a sugestão local do telefone. Motivo: ${getErrorMessage(error)}`)
    } finally {
      setPhoneAiSaving(false)
    }
  }

  async function handleImprovePhoneFeedbackWithAi() {
    if (!selectedAnalyst || !analystResult) {
      setExportMessage('Selecione um analista e um período com lançamento antes de acionar a IA.')
      return
    }

    const baseFeedback = phoneFeedbackDraft.trim() || phoneFeedbackSuggestion

    if (!baseFeedback.trim()) {
      setExportMessage('Gere uma sugestão ou escreva um texto antes de pedir melhoria com IA.')
      return
    }

    setPhoneAiSaving(true)
    setExportMessage('Melhorando texto com IA...')

    try {
      const averageTickets =
        podium.length > 0
          ? round(podium.reduce((sum, item) => sum + item.totalTickets, 0) / podium.length)
          : 0
      const response = await fetch('/api/chat-feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          serviceModule: 'phone',
          feedbackStyle: phoneFeedbackStyle,
          feedbackGoal: phoneFeedbackGoal,
          feedbackTone: phoneFeedbackTone,
          generationMode: 'improve',
          periodLabel,
          managerNotes: phoneManagerNotes,
          fallbackText: baseFeedback,
          averageTickets,
          podiumPosition: selectedRankingPosition,
          metric: {
            analystName: selectedAnalyst.name,
            teamName: 'Telefone',
            csat: analystResult.averageCsat,
            reviewPercentage: analystResult.reviewPercentage,
            totalTickets: analystResult.totalTickets,
            reviews: analystResult.totalReviews,
            csatGoal: analystResult.individualGoal,
            reviewGoal,
            status: analystResult.eligible ? 'Elegível ao pódio' : 'Em acompanhamento',
            teamPerformance,
            teamAnsweredCalls,
            teamTotalCalls,
          },
          monthlyHistory: weeklyEvolution.map((item) => ({
            monthLabel: item.label,
            csat: item.csat,
            reviewPercentage: item.totalTickets ? round((item.totalReviews / item.totalTickets) * 100) : 0,
            sendingPercentage: 0,
            totalTickets: item.totalTickets,
          })),
        }),
      })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Não foi possível melhorar texto com IA.')
      }

      setPhoneFeedbackDraft(normalizePhoneReportFeedback(data.feedback ?? '', baseFeedback, phoneFeedbackStyle))
      setExportMessage(data.warning || 'Texto do telefone melhorado com IA. Revise antes de exportar.')
    } catch (error) {
      setExportMessage('A IA externa não melhorou o texto agora. Mantive o texto atual. Motivo: ' + getErrorMessage(error))
    } finally {
      setPhoneAiSaving(false)
    }
  }

  function handleExportWordReport() {
    if (!selectedAnalyst || !analystResult) {
      setExportMessage('Selecione um analista e um período com lançamento antes de exportar.')
      return
    }

    try {
      const finalPhoneFeedback = normalizePhoneReportFeedback(phoneFeedbackDraft, phoneFeedbackSuggestion, phoneFeedbackStyle)
      const fileName = exportWordReport({
        analystName: selectedAnalyst.name,
        photoUrl: getAnalystPhoto(selectedAnalyst.name, selectedAnalyst.photo_url),
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
        weeklyEvolution,
        feedbackStyle: phoneFeedbackStyle,
        assistedFeedback: finalPhoneFeedback,
      })

      setExportMessage(`Relatorio gerado: ${fileName}. Verifique a pasta Downloads.`)
    } catch {
      setExportMessage('Não foi possível gerar o arquivo. Tente novamente ou use outro navegador.')
    }
  }

  return (
    <div className="mt-8 space-y-7">
      <section className="panel">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="section-title">Relatórios e IA analitica</h2>
            <p className="section-subtitle">
              Gere feedback MIMO ou SARE com base nos lançamentos do período, dados do pódio e observações da gestão.
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

        {isPhoneDailyUnsupported && (
          <div className="mt-5 rounded-lg border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm leading-6 text-amber-100">
            {phoneWeeklyLaunchMessage}
          </div>
        )}

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
        <MetricCard label="CSAT do período" value={`${analystResult?.averageCsat ?? 0}%`} />
        <MetricCard label="Variação vs período anterior" value={formatDelta(csatDelta, '%')} />
        <MetricCard label="Performance equipe" value={`${teamPerformance}%`} />
      </div>

      <section className="panel no-print">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="eyebrow">Inteligência de gestão</p>
            <h2 className="section-title">Leitura do supervisor para o analista</h2>
            <p className="section-subtitle">
              Diagnóstico e ações sugeridas para apoiar acompanhamento individual antes do fechamento.
            </p>
          </div>
          <span className={`rounded-full px-4 py-2 text-sm font-semibold ${analystResult?.eligible ? 'bg-emerald-400/10 text-emerald-300' : 'bg-amber-400/10 text-amber-200'}`}>
            {supervisorCaseStatus}
          </span>
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-3">
          {supervisorContextCards.map((item) => (
            <div key={item.label} className="rounded-lg border border-cyan-400/20 bg-cyan-400/5 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">{item.label}</p>
              <p className="mt-2 text-lg font-bold">{item.value}</p>
              <p className="mt-2 text-sm leading-5 text-slate-300">{item.detail}</p>
            </div>
          ))}
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-4">
          {supervisorActionCards.map((item) => (
            <div key={item.label} className="rounded-lg bg-slate-900 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">{item.label}</p>
              <h3 className="mt-3 text-lg font-bold">{item.title}</h3>
              <p className="mt-3 text-sm leading-6 text-slate-300">{item.text}</p>
            </div>
          ))}
        </div>
      </section>



      <section className="panel no-print">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="section-title">Prontidão do relatório</h2>
            <p className="section-subtitle">
              Confira se o relatório deste período já tem base suficiente antes de exportar.
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
            <h2 className="section-title">Relatório mensal {getChatFeedbackStyleLabel(phoneFeedbackStyle)}</h2>
            <p className="section-subtitle">
              {phoneFeedbackStyle === 'mimo'
                ? 'Estrutura MIMO: Momento observado, Impacto, Melhoria ou manutenção e Orientação.'
                : 'Estrutura SARE: Situação, Alinhamentos Realizados, Resultado Esperado e Expectativa.'}
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

        <div className="no-print mt-5 grid gap-4">
          <Field label="Observações do gestor">
            <textarea
              className="form-input min-h-24"
              value={phoneManagerNotes}
              onChange={(event) => setPhoneManagerNotes(event.target.value)}
              placeholder="Inclua contexto do período, combinados, reconhecimento ou pontos de atenção para orientar a IA."
            />
          </Field>

          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Modelo do feedback">
              <select
                className="form-input"
                value={phoneFeedbackStyle}
                onChange={(event) => {
                  setPhoneFeedbackStyle(event.target.value as ChatFeedbackStyle)
                  setPhoneFeedbackDraft('')
                }}
              >
                <option value="mimo">MIMO</option>
                <option value="sare">SARE</option>
              </select>
            </Field>
            <Field label="Objetivo">
              <select className="form-input" value={phoneFeedbackGoal} onChange={(event) => setPhoneFeedbackGoal(event.target.value as FeedbackGoal)}>
                <option value="development">Desenvolver comportamento</option>
                <option value="courseCorrection">Corrigir rota</option>
                <option value="recognition">Reconhecer e manter</option>
                <option value="maintenance">Proteger padrão</option>
              </select>
            </Field>
            <Field label="Tom">
              <select className="form-input" value={phoneFeedbackTone} onChange={(event) => setPhoneFeedbackTone(event.target.value as FeedbackTone)}>
                <option value="human">Humano e prático</option>
                <option value="direct">Direto e assertivo</option>
                <option value="executive">Executivo</option>
              </select>
            </Field>
          </div>

          <div className="grid gap-3 lg:grid-cols-[auto_auto_auto_1fr] lg:items-start">
            <button
              className="btn-secondary disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!selectedAnalyst || !analystResult}
              type="button"
              onClick={handleGeneratePhoneFeedbackDraft}
            >
              Gerar sugestão local
            </button>
            <button
              className="btn-primary disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!selectedAnalyst || !analystResult || phoneAiSaving}
              type="button"
              onClick={handleGeneratePhoneFeedbackWithAi}
            >
              {phoneAiSaving ? 'Gerando...' : 'Gerar texto assistido'}
            </button>
            <button
              className="btn-secondary disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!selectedAnalyst || !analystResult || phoneAiSaving || !phoneFeedbackDraft.trim()}
              type="button"
              onClick={handleImprovePhoneFeedbackWithAi}
            >
              Melhorar texto atual
            </button>
            <p className="text-sm text-slate-300">
              A IA usa CSAT, avaliações, atendimentos, performance da equipe, pódio, objetivo e tom para explicar o que melhorar e como fazer isso na prática.
            </p>
          </div>

          <Field label="Texto final assistido">
            <textarea
              className="form-input min-h-48"
              value={phoneFeedbackDraft}
              onChange={(event) => setPhoneFeedbackDraft(event.target.value)}
              placeholder="Gere uma sugestão, use a IA ou escreva aqui o texto final que irá para o relatório."
            />
          </Field>
        </div>

        <div className="no-print mt-4">
          <button
            className="primary-button disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!selectedAnalyst || !analystResult}
            type="button"
            onClick={handleExportWordReport}
          >
            Exportar relatório Word
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
                <p>Variação</p>
                <strong className={csatDelta >= 0 ? 'text-emerald-300' : 'text-rose-300'}>
                  {formatDelta(csatDelta, ' p.p.')}
                </strong>
              </div>
              <div className="report-summary-card">
                <p>Avaliações</p>
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
                  Leitura rapida de melhora, queda ou estabilidade no período.
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
                title="S - Situação"
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
          <EmptyState text="Selecione um analista e um período com lançamento individual para liberar a exportação." />
        )}
      </section>

      <section className="panel">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="section-title">Camadas de IA e plano de ação</h2>
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
                    ? 'desempenho sustentando elegibilidade ao pódio no período.'
                    : `desempenho pede ajuste em ${analystResult.reasons.join(', ')}.`
                  : 'aguardando lançamentos no período.'}
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
                  {strongestResult ? `${strongestResult.analystName}, com ${strongestResult.averageCsat}% de CSAT.` : 'aguardar dados do período.'}
                </p>
                <p>
                  <span className="text-slate-500">Acompanhar: </span>
                  {attentionResults.length ? attentionResults.map((item) => item.analystName).join(', ') : 'sem alertas críticos entre os lançamentos atuais.'}
                </p>
                <p>
                  <span className="text-slate-500">Evolucao: </span>
                  {bestGrowth ? `${bestGrowth.analystName} apresenta o melhor movimento comparativo (${formatDelta(bestGrowth.delta, ' p.p.')}).` : 'sem base comparativa suficiente.'}
                </p>
              </div>
            ) : (
              <p className="mt-4 text-sm text-slate-300">
                A visao completa de equipe e exclusiva da gestão. Você visualiza sua leitura individual e a performance geral compartilhada.
              </p>
            )}
          </div>

          <div className="rounded-lg bg-slate-900 p-5">
            <p className="text-sm text-slate-400">IA Executiva operação</p>
            <div className="mt-4 space-y-3 text-sm text-slate-300">
              <p>
                <span className="text-slate-500">Performance: </span>
                {teamPerformance}% no período, meta {teamPerformanceGoal}%.
              </p>
              <p>
                <span className="text-slate-500">Previsao: </span>
                {teamPerformance >= teamPerformanceGoal
                  ? 'fechamento tende a permanecer dentro da referência se o volume atual se mantiver.'
                  : 'ha risco de fechamento abaixo da referência se nao houver recuperação.'}
              </p>
              <p>
                <span className="text-slate-500">Risco: </span>
                {riskResults.length ? `${riskResults.length} analista(s) pedem acompanhamento no ciclo.` : 'nenhum risco individual evidente no período.'}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg bg-slate-900 p-5">
            <p className="text-sm text-slate-400">Roteiro sugerido para 1:1</p>
            <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-slate-300">
              <li>Comecar pela situação do período e confirmar se os numeros refletem a realidade operacional.</li>
              <li>Discutir o principal ponto de variação: CSAT, avaliações ou volume de atendimentos.</li>
              <li>Definir uma ação objetiva para a próxima semana, com comportamento observavel.</li>
              <li>Registrar a expectativa do próximo ciclo e revisar no fechamento seguinte.</li>
            </ol>
          </div>

          <div className="rounded-lg bg-slate-900 p-5">
            <p className="text-sm text-slate-400">{isManagementUser ? 'Fila de acompanhamento' : 'Meu próximo ciclo'}</p>
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
                  Nenhum analista entrou em fila de acompanhamento neste período.
                </p>
              )
            ) : (
              <p className="mt-4 text-sm text-slate-300">
                Acompanhar sua evolução semanal, proteger o volume de avaliações e revisar atendimentos que possam impactar o CSAT.
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
  onUpdateTeamOverallCsat,
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
  onUpdateTeamOverallCsat: (metric: TeamMetric, overallCsat: number) => void
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
  const overallCsat = toNumber(teamForm.overallCsat)
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
              Use este resumo para conferir se todos os lançamentos da semana foram feitos antes de fechar o período.
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
            <p className="text-sm text-slate-400">Proxima ação</p>
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
              <p className="mt-3 text-sm text-emerald-300">Todos os analistas ativos ja possuem lançamento neste período.</p>
            )}
          </div>
        )}
      </section>


      <div className="grid gap-6 xl:grid-cols-2">
        <section className="panel">
        <h2 className="section-title">Lancamento individual</h2>
        <p className="section-subtitle">
          Registre resultado real, avaliações e atendimentos da semana anterior.
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
            Minimo para pódio: <strong>{podiumCsatGoal}%</strong>
          </div>

          {(individualDateInvalid || individualDuplicate || individualReviewsInvalid) && (
            <div className="rounded-md border border-amber-300/30 bg-amber-300/10 p-3 text-sm text-amber-100">
              {individualDateInvalid && <p>A data final nao pode ser menor que a data inicial.</p>}
              {individualDuplicate && <p>Já existe lançamento para este analista neste período.</p>}
              {individualReviewsInvalid && (
                <p>O total de avaliações nao pode ser maior que o total de atendimentos.</p>
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
            <Field label="Avaliações positivas">
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
            <Field label="Avaliações negativas">
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

          <Field label="Observações">
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
            <p>Total de avaliações: <strong>{totalReviews}</strong></p>
            <p>Percentual de avaliações: <strong>{reviewPercentage}%</strong></p>
            <p>
              CSAT informado: <strong>{toNumber(individualForm.csat)}%</strong>
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <button className="primary-button" disabled={saving} type="submit">
              {saving ? 'Salvando...' : 'Salvar lançamento individual'}
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
          Formula atual: ligações atendidas / total processado x 100.
        </p>

        <form className="mt-5 grid gap-4" onSubmit={onTeamSubmit}>
          {(teamDateInvalid || teamDuplicate || teamAnsweredInvalid || teamTotalMismatch) && (
            <div className="rounded-md border border-amber-300/30 bg-amber-300/10 p-3 text-sm text-amber-100">
              {teamDateInvalid && <p>A data final nao pode ser menor que a data inicial.</p>}
              {teamDuplicate && <p>Já existe performance da equipe neste período.</p>}
              {teamAnsweredInvalid && (
                <p>Ligações atendidas nao pode ser maior que o total processado.</p>
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

          <Field label="Ligações atendidas">
            <input
              className="form-input"
              min="0"
              type="number"
              value={teamForm.answeredCalls}
              onChange={(event) => onTeamChange({ ...teamForm, answeredCalls: event.target.value })}
              required
            />
          </Field>
          <Field label="Ligações abandonadas">
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

          <div className="rounded-lg border border-cyan-400/20 bg-cyan-400/5 p-4">
            <h3 className="font-semibold text-cyan-200">CSAT geral do telefone (N1 + N2)</h3>
            <p className="mt-1 text-sm leading-6 text-slate-300">
              Informe o percentual pronto exibido no 55PBX. Ele será usado apenas para comparar o N1 com o resultado geral; não altera o pódio dos analistas do N1.
            </p>
            <div className="mt-4 max-w-sm">
              <Field label="CSAT geral informado (%)">
                <input
                  className="form-input"
                  min="0"
                  max="100"
                  step="0.01"
                  type="number"
                  value={teamForm.overallCsat}
                  onChange={(event) => onTeamChange({ ...teamForm, overallCsat: event.target.value })}
                  required
                />
              </Field>
            </div>
            <p className="mt-3 text-sm text-slate-300">Valor informado: <strong className="text-cyan-200">{overallCsat}%</strong></p>
          </div>

          <Field label="Observações">
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
        onUpdateTeamOverallCsat={onUpdateTeamOverallCsat}
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
  onUpdateTeamOverallCsat,
}: {
  individualMetrics: IndividualMetric[]
  teamMetrics: TeamMetric[]
  saving: boolean
  onDeleteIndividualMetric: (metric: IndividualMetric) => void
  onDeleteTeamMetric: (metric: TeamMetric) => void
  onUpdateTeamOverallCsat: (metric: TeamMetric, overallCsat: number) => void
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
          <h2 className="section-title">Historico de lançamentos</h2>
          <p className="section-subtitle">
            Filtre registros por tipo, período e analista para revisar dados acumulados ou excluir lançamentos de teste.
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
          <p className="text-sm text-slate-400">CSAT médio filtrado</p>
          <p className="mt-2 text-2xl font-bold">{averageHistoryCsat}%</p>
        </div>
        <div className="rounded-lg bg-slate-900 p-4">
          <p className="text-sm text-slate-400">Avaliações / atendimentos</p>
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
                    <th className="pb-3 pr-4 font-medium">Avaliações</th>
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
                <EmptyState text="Nenhum lançamento individual encontrado com estes filtros." />
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
                    <th className="pb-3 pr-4 font-medium">CSAT geral N1 + N2</th>
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
                      <td className="min-w-52 py-3 pr-4">
                        <TeamOverallCsatEditor
                          metric={metric}
                          saving={saving}
                          onSave={onUpdateTeamOverallCsat}
                        />
                      </td>
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

function TeamOverallCsatEditor({
  metric,
  saving,
  onSave,
}: {
  metric: TeamMetric
  saving: boolean
  onSave: (metric: TeamMetric, overallCsat: number) => void
}) {
  const [value, setValue] = useState(metric.overall_csat == null ? '' : String(metric.overall_csat))

  useEffect(() => {
    setValue(metric.overall_csat == null ? '' : String(metric.overall_csat))
  }, [metric.overall_csat])

  return (
    <div className="flex items-center gap-2">
      <input
        aria-label={`CSAT geral da semana ${formatWeek(metric.week_start, metric.week_end)}`}
        className="form-input min-w-24 py-2"
        type="number"
        min="0"
        max="100"
        step="0.01"
        placeholder="0 a 100"
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <button
        className="secondary-button whitespace-nowrap"
        disabled={saving || value === ''}
        type="button"
        onClick={() => onSave(metric, Number(value))}
      >
        Salvar
      </button>
    </div>
  )
}
function getHistoryAnalystOptions(metrics: IndividualMetric[]) {
  const names = new Set<string>()
  metrics.forEach((metric) => names.add(getAnalystName(metric.analysts)))
  return [...names].sort((a, b) => a.localeCompare(b))
}

const DEFAULT_ANALYST_PHOTOS: Record<string, string> = {
  'bruno silva': '/team-photos/phone/bruno-silva.png',
  'gabriel vaz': '/team-photos/phone/gabriel-vaz.png',
  'henrique sergio': '/team-photos/phone/henrique-sergio.png',
  jesse: '/team-photos/phone/jesse.png',
  'karine cunha': '/team-photos/phone/karine-cunha.png',
  'mario diniz': '/team-photos/phone/mario-diniz.png',
  'sergio junior': '/team-photos/phone/sergio-junior.png',
  'thales silva': '/team-photos/phone/thales-silva.png',
  'ana claudia correa': '/team-photos/chat/ana-claudia-correa.png',
  'carlos lemos': '/team-photos/chat/carlos-lemos.png',
  'lorena almeida': '/team-photos/chat/lorena-almeida.png',
  'paulo victor': '/team-photos/chat/paulo-victor.png',
  'paulo victor leite': '/team-photos/chat/paulo-victor.png',
  'joao pedro vianey': '/team-photos/chat/joao-pedro-vianey.png',
  'joao vitor almeida': '/team-photos/chat/joao-vitor-almeida.png',
  'thiago reis': '/team-photos/chat/thiago-reis.png',
  'vanessa kateline': '/team-photos/chat/vanessa-kateline.png',
  'vanessa silva': '/team-photos/chat/vanessa-kateline.png',
}

function getAnalystPhoto(name: string, photoUrl?: string | null) {
  return photoUrl || DEFAULT_ANALYST_PHOTOS[normalizeText(name)] || null
}

function AnalystAvatar({ name, photoUrl, size = 'md' }: { name: string; photoUrl?: string | null; size?: 'sm' | 'md' | 'lg' }) {
  const resolvedPhoto = getAnalystPhoto(name, photoUrl)
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
  return (
    <span className={`analyst-avatar analyst-avatar-${size}`} title={name}>
      {resolvedPhoto ? <img alt={`Foto de ${name}`} src={resolvedPhoto} /> : <span>{initials || '?'}</span>}
    </span>
  )
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
  onRemoveAnalystPhoto,
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
  onRemoveAnalystPhoto: (analyst: Analyst) => void
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

          <Field label={editingAnalystId ? 'Substituir foto' : 'Foto do analista'}>
            <input
              accept="image/png,image/jpeg,image/webp"
              className="form-input"
              type="file"
              onChange={(event) => onAnalystChange({ ...analystForm, photoFile: event.target.files?.[0] ?? null })}
            />
            <p className="mt-2 text-xs text-slate-400">PNG, JPG ou WEBP, com até 5 MB. A imagem será exibida em formato quadrado.</p>
          </Field>

          <div className="flex flex-wrap gap-3">
            <button className="primary-button" disabled={saving} type="submit">
              {saving ? 'Salvando...' : editingAnalystId ? 'Salvar alterações' : 'Incluir analista'}
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
          Inative para preservar histórico. Exclua apenas cadastros criados por engano.
        </p>

        <div className="mt-5 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-slate-400">
              <tr>
                <th className="pb-3 pr-4 font-medium">Analista</th>
                <th className="pb-3 pr-4 font-medium">Meta CSAT</th>
                <th className="pb-3 pr-4 font-medium">Status</th>
                <th className="pb-3 font-medium">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {analysts.map((analyst) => (
                <tr key={analyst.id}>
                  <td className="py-3 pr-4">
                    <div className="flex items-center gap-3">
                      <AnalystAvatar name={analyst.name} photoUrl={analyst.photo_url} size="sm" />
                      <span>{analyst.name}</span>
                    </div>
                  </td>
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
                      {analyst.photo_url && (
                        <button className="small-button" type="button" onClick={() => onRemoveAnalystPhoto(analyst)}>
                          Remover foto
                        </button>
                      )}
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

function UsersView({
  profiles,
  analysts,
  form,
  editingProfileNameId,
  profileNameForm,
  saving,
  onChange,
  onProfileNameChange,
  onSubmit,
  onEditProfileName,
  onCancelProfileNameEdit,
  onSaveProfileName,
}: {
  profiles: UserProfile[]
  analysts: Analyst[]
  form: typeof initialAccessUserForm
  editingProfileNameId: string | null
  profileNameForm: string
  saving: boolean
  onChange: (form: typeof initialAccessUserForm) => void
  onProfileNameChange: (value: string) => void
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void
  onEditProfileName: (profile: UserProfile) => void
  onCancelProfileNameEdit: () => void
  onSaveProfileName: (profileId: string) => void
}) {
  const activeAnalysts = analysts.filter((analyst) => analyst.active)

  return (
    <div className="mt-8 grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
      <section className="panel">
        <h2 className="section-title">Criar acesso ao sistema</h2>
        <p className="section-subtitle">
          Crie o login, defina o perfil e vincule o usuario ao analista quando for acesso individual.
        </p>

        <form className="mt-5 grid gap-4" onSubmit={onSubmit}>
          <Field label="Nome completo">
            <input
              className="form-input"
              value={form.fullName}
              onChange={(event) => onChange({ ...form, fullName: event.target.value })}
              required
            />
          </Field>

          <Field label="E-mail de acesso">
            <input
              className="form-input"
              type="email"
              value={form.email}
              onChange={(event) => onChange({ ...form, email: event.target.value })}
              required
            />
          </Field>

          <Field label="Senha temporaria">
            <input
              className="form-input"
              minLength={6}
              type="password"
              value={form.password}
              onChange={(event) => onChange({ ...form, password: event.target.value })}
              required
            />
          </Field>

          <Field label="Perfil">
            <select
              className="form-input"
              value={form.role}
              onChange={(event) =>
                onChange({
                  ...form,
                  role: event.target.value,
                  analystId: event.target.value === 'analista' ? form.analystId : '',
                })
              }
            >
              <option value="analista">Analista</option>
              <option value="coordenadora">Coordenadora / Supervisao</option>
              <option value="master">Master</option>
            </select>
          </Field>

          {form.role === 'analista' && (
            <Field label="Vincular ao analista">
              <select
                className="form-input"
                value={form.analystId}
                onChange={(event) => onChange({ ...form, analystId: event.target.value })}
                required
              >
                <option value="">Selecione</option>
                {activeAnalysts.map((analyst) => (
                  <option key={analyst.id} value={analyst.id}>
                    {analyst.name}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <button className="primary-button" disabled={saving} type="submit">
            {saving ? 'Criando...' : 'Criar usuario'}
          </button>
        </form>
      </section>

      <section className="panel">
        <h2 className="section-title">Usuarios vinculados</h2>
        <p className="section-subtitle">
          Estes registros controlam o que cada pessoa pode visualizar apos entrar no sistema.
        </p>

        <div className="mt-5 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-slate-400">
              <tr>
                <th className="pb-3 pr-4 font-medium">Nome</th>
                <th className="pb-3 pr-4 font-medium">Perfil</th>
                <th className="pb-3 pr-4 font-medium">Analista vinculado</th>
                <th className="pb-3 font-medium">Acoes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {profiles.map((profile) => {
                const analyst = analysts.find((item) => item.id === profile.analyst_id)
                return (
                  <tr key={profile.id}>
                    <td className="py-3 pr-4">
                      {editingProfileNameId === profile.id ? (
                        <input
                          className="form-input min-w-52 py-2"
                          value={profileNameForm}
                          onChange={(event) => onProfileNameChange(event.target.value)}
                        />
                      ) : (
                        profile.full_name || profile.name || profile.id
                      )}
                    </td>
                    <td className="py-3 pr-4">{profile.role ?? '-'}</td>
                    <td className="py-3 pr-4">{analyst?.name ?? '-'}</td>
                    <td className="py-3">
                      {editingProfileNameId === profile.id ? (
                        <div className="flex flex-wrap gap-2">
                          <button
                            className="small-button"
                            disabled={saving}
                            type="button"
                            onClick={() => onSaveProfileName(profile.id)}
                          >
                            Salvar
                          </button>
                          <button className="secondary-button" type="button" onClick={onCancelProfileNameEdit}>
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <button className="small-button" type="button" onClick={() => onEditProfileName(profile)}>
                          Editar nome
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {!profiles.length && <EmptyState text="Nenhum usuario vinculado encontrado." />}
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
          Estes parametros alimentam dashboard, pódio, relatórios SARE e leituras preditivas. O CSAT individual continua no cadastro de cada analista.
        </p>

        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          <GoalImpactCard
            title="Podio mensal"
            text="Usa CSAT mínimo para pódio, percentual mínimo de avaliações e volume de atendimentos dentro da média da equipe."
          />
          <GoalImpactCard
            title="Performance da equipe"
            text="Define a referência operacional compartilhada por todos e usada nos alertas executivos."
          />
          <GoalImpactCard
            title="Relatórios e IA"
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
            Ajuste metas gerais da operação sem alterar codigo ou rodar query.
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
            O CSAT individual fica no cadastro de cada analista; aqui ficam metas da operação.
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

  if (key.includes('podium') || label.includes('pódio') || label.includes('pódio')) {
    return 'Define elegibilidade para o pódio e relatórios SARE.'
  }

  if (key.includes('review') || label.includes('avalia')) {
    return 'Define o mínimo de avaliações esperado por atendimento.'
  }

  if (key.includes('performance') || key.includes('team') || label.includes('performance') || label.includes('desempenho')) {
    return 'Define a referência da performance operacional da equipe.'
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
  tone?: 'success' | 'warning' | 'danger'
}) {
  const toneClass =
    tone === 'success'
      ? 'border-emerald-400/30 bg-emerald-400/10'
      : tone === 'warning'
        ? 'border-amber-400/30 bg-amber-400/10'
        : tone === 'danger'
          ? 'border-rose-400/30 bg-rose-400/10'
          : 'border-white/10 bg-white/5'
  const valueClass =
    tone === 'success'
      ? 'text-emerald-300'
      : tone === 'warning'
        ? 'text-amber-200'
        : tone === 'danger'
          ? 'text-rose-200'
          : ''

  return (
    <div className={`rounded-lg border p-5 ${toneClass}`}>
      <p className="text-sm text-slate-400">{label}</p>
      <p className={`mt-2 text-xl font-semibold leading-tight tabular-nums sm:text-2xl ${valueClass}`}>
        {value}
      </p>
    </div>
  )
}

function AnalystIdentityCard({ analyst }: { analyst: Pick<Analyst, 'name' | 'photo_url'> | null }) {
  return (
    <div className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 p-5">
      <p className="text-sm text-slate-400">Analista</p>
      <div className="mt-3 flex items-center gap-3">
        <AnalystAvatar name={analyst?.name ?? 'Analista'} photoUrl={analyst?.photo_url} size="md" />
        <p className="text-xl font-semibold leading-tight text-emerald-300 sm:text-2xl">{analyst?.name ?? 'Não vinculado'}</p>
      </div>
    </div>
  )
}

function CriteriaLegend({
  title,
  items,
  hidden = false,
}: {
  title: string
  items: string[]
  hidden?: boolean
}) {
  return (
    <div className={hidden ? 'hidden' : 'rounded-lg border border-cyan-400/20 bg-cyan-400/5 p-4'}>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">{title}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {items.map((item) => (
          <span key={item} className="rounded-md border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-slate-200">
            {item}
          </span>
        ))}
      </div>
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

function EligibilityFunnel({
  title,
  subtitle,
  items,
}: {
  title: string
  subtitle: string
  items: Array<{ label: string; value: number; detail: string; tone?: 'success' | 'warning' | 'danger' }>
}) {
  const base = Math.max(items[0]?.value ?? 0, 1)

  return (
    <div className="rounded-lg bg-slate-900 p-5">
      <h3 className="text-xl font-bold">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-slate-400">{subtitle}</p>
      <div className="mt-5 space-y-3">
        {items.map((item, index) => {
          const width = Math.max(6, Math.min(100, (item.value / base) * 100))
          const color =
            item.tone === 'success'
              ? 'bg-emerald-300'
              : item.tone === 'danger'
                ? 'bg-rose-300'
                : index === 0
                  ? 'bg-cyan-300'
                  : 'bg-amber-300'

          return (
            <div key={item.label} className="rounded-md bg-slate-950/60 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{item.label}</p>
                  <p className="mt-1 text-xs leading-5 text-slate-400">{item.detail}</p>
                </div>
                <strong className="text-lg">{item.value}</strong>
              </div>
              <div className="mt-3 h-3 overflow-hidden rounded-full bg-slate-800">
                <div className={`h-3 rounded-full ${color}`} style={{ width: `${width}%` }} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TrendLineChart({
  label,
  points,
  suffix = '',
  goal,
  goalLabel = 'Meta',
}: {
  label: string
  points: ChartPoint[]
  suffix?: string
  goal?: number
  goalLabel?: string
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const comparisonValues = goal === undefined ? [] : [goal]
  const path = buildLinePath(points, comparisonValues)
  const first = points.at(0)?.value ?? 0
  const latest = points.at(-1)?.value ?? 0
  const delta = round(latest - first)
  const hasComparison = points.length > 1
  const highlightedPoint = activeIndex === null ? points.at(-1) : points[activeIndex]

  return (
    <div className="rounded-lg bg-slate-900 p-5 transition-colors hover:bg-slate-900/90">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-slate-400">{label}</p>
          <p className="mt-1 text-2xl font-semibold">
            {latest}
            {suffix}
          </p>
          <p className="mt-2 text-xs leading-5 text-slate-400">
            {hasComparison
              ? `De ${first}${suffix} para ${latest}${suffix} · ${delta > 0 ? '+' : ''}${delta}${suffix === '%' ? ' p.p.' : ''}`
              : 'Apenas um fechamento disponível neste período.'}
          </p>
        </div>
        {highlightedPoint && (
          <div className="rounded-md border border-cyan-300/20 bg-cyan-300/5 px-3 py-2 text-right">
            <p className="text-xs text-slate-400">{activeIndex === null ? 'Última semana' : 'Semana destacada'}</p>
            <p className="mt-1 text-sm font-semibold text-cyan-200">
              {highlightedPoint.label}: {highlightedPoint.value}{suffix}
            </p>
          </div>
        )}
        {goal !== undefined && (
          <div className="rounded-md border border-amber-300/20 bg-amber-300/5 px-3 py-2 text-right">
            <p className="text-xs text-slate-400">{goalLabel}</p>
            <p className="mt-1 text-sm font-semibold text-amber-200">{goal}{suffix}</p>
          </div>
        )}
      </div>

      {points.length ? (
        <svg
          className="mt-4 h-44 w-full"
          role="img"
          viewBox="0 0 320 130"
          onMouseLeave={() => setActiveIndex(null)}
        >
          <title>{label}</title>
          <path d="M20 110 H310" stroke="rgb(51 65 85)" strokeWidth="1" />
          <path d="M20 15 V110" stroke="rgb(51 65 85)" strokeWidth="1" />
          {goal !== undefined && (
            <>
              <path
                d={`M20 ${getPointPosition(goal, 0, points, comparisonValues).y} H310`}
                stroke="rgb(252 211 77)"
                strokeDasharray="6 5"
                strokeWidth="1.5"
              />
              <text
                fill="rgb(253 230 138)"
                fontSize="9"
                textAnchor="end"
                x="308"
                y={Math.max(getPointPosition(goal, 0, points, comparisonValues).y - 5, 10)}
              >
                Meta {goal}{suffix}
              </text>
            </>
          )}
          <path d={path} fill="none" stroke="rgb(103 232 249)" strokeWidth="3" />
          {points.map((point, index) => {
            const { x, y } = getPointPosition(point.value, index, points, comparisonValues)
            return (
              <g
                key={`${point.label}-${index}`}
                className="cursor-pointer"
                onMouseEnter={() => setActiveIndex(index)}
              >
                <title>{`${point.label}: ${point.value}${suffix}`}</title>
                <circle cx={x} cy={y} fill="transparent" r="14" />
                <circle
                  cx={x}
                  cy={y}
                  fill="rgb(103 232 249)"
                  r={activeIndex === index ? 7 : 4}
                  stroke={activeIndex === index ? 'rgb(255 255 255)' : 'transparent'}
                  strokeWidth="2"
                />
                <text fill="rgb(226 232 240)" fontSize="10" fontWeight="600" textAnchor="middle" x={x} y={Math.max(y - 9, 10)}>
                  {point.value}{suffix}
                </text>
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
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const maxValue = Math.max(...points.map((point) => point.value), 1)

  return (
    <div className="rounded-lg bg-slate-900 p-5 transition-colors hover:bg-slate-900/90">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-slate-400">{label}</p>
        {points.length > 0 && (
          <p className="text-xs text-cyan-200">
            {activeIndex === null ? 'Passe o mouse para destacar' : `${points[activeIndex].label}: ${points[activeIndex].value}`}
          </p>
        )}
      </div>
      <div className="mt-4 space-y-3">
        {points.map((point, index) => (
          <div
            key={point.label}
            className={`grid grid-cols-[72px_1fr_42px] items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors ${activeIndex === index ? 'bg-cyan-300/10' : ''}`}
            title={`${point.label}: ${point.value}`}
            onMouseEnter={() => setActiveIndex(index)}
            onMouseLeave={() => setActiveIndex(null)}
          >
            <span className="text-slate-400">{point.label}</span>
            <div className="h-3 rounded-full bg-slate-800">
              <div
                className={`h-3 rounded-full transition-all ${activeIndex === index ? 'bg-white' : 'bg-cyan-300'}`}
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

function ComparisonBars({
  title,
  subtitle,
  rows,
  primaryGoal,
  secondaryGoal,
  volumeReference,
}: {
  title: string
  subtitle: string
  rows: Array<{ label: string; primary: number; secondary: number; volume: number; status?: string }>
  primaryGoal: number
  secondaryGoal: number
  volumeReference?: number
}) {
  const maxVolume = Math.max(...rows.map((row) => row.volume), volumeReference ?? 0, 1)

  return (
    <div className="rounded-lg bg-slate-900 p-5">
      <h3 className="text-xl font-bold">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-slate-400">{subtitle}</p>
      <div className="mt-5 space-y-4">
        {rows.map((row) => (
          <div key={row.label} className="rounded-md bg-slate-950/60 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold">{row.label}</p>
              <span className="text-xs text-slate-400">{row.status}</span>
            </div>
            <div className="mt-3 grid gap-2">
              <ProgressMetric label="CSAT" value={row.primary} goal={primaryGoal} suffix="%" tone="cyan" />
              <ProgressMetric label="Avaliações" value={row.secondary} goal={secondaryGoal} suffix="%" tone="emerald" />
              <ProgressMetric label="Volume" value={row.volume} goal={volumeReference} max={maxVolume} tone="amber" />
            </div>
          </div>
        ))}
        {!rows.length && <EmptyState text="Sem dados suficientes para o grafico." />}
      </div>
    </div>
  )
}

function ProgressMetric({
  label,
  value,
  goal,
  max = 100,
  suffix = '',
  tone,
}: {
  label: string
  value: number
  goal?: number
  max?: number
  suffix?: string
  tone: 'cyan' | 'emerald' | 'amber'
}) {
  const color = tone === 'cyan' ? 'bg-cyan-300' : tone === 'emerald' ? 'bg-emerald-300' : 'bg-amber-300'
  const percent = Math.min((value / Math.max(max, 1)) * 100, 100)

  return (
    <div className="grid grid-cols-[88px_1fr_84px] items-center gap-3 text-xs">
      <span className="text-slate-400">{label}</span>
      <div className="relative h-3 rounded-full bg-slate-800">
        <div className={`h-3 rounded-full ${color}`} style={{ width: `${Math.max(percent, value > 0 ? 4 : 0)}%` }} />
        {goal !== undefined && max === 100 && (
          <span className="absolute top-[-3px] h-5 w-px bg-white/60" style={{ left: `${Math.min(goal, 100)}%` }} />
        )}
      </div>
      <strong className="text-right">
        {value}
        {suffix}
      </strong>
    </div>
  )
}

function VolumeQualityMap({
  title,
  subtitle,
  points,
  xReference,
  yReference,
}: {
  title: string
  subtitle: string
  points: Array<{ label: string; x: number; y: number; tone: string; detail?: string }>
  xReference?: number
  yReference: number
}) {
  const maxX = Math.max(...points.map((point) => point.x), xReference ?? 0, 1)
  const minY = Math.min(...points.map((point) => point.y), yReference, 80)
  const maxY = Math.max(...points.map((point) => point.y), yReference, 100)
  const yRange = Math.max(maxY - minY, 1)

  return (
    <div className="rounded-lg bg-slate-900 p-5">
      <h3 className="text-xl font-bold">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-slate-400">{subtitle}</p>
      <div className="relative mt-5 h-80 overflow-hidden rounded-lg border border-white/10 bg-slate-950/60 p-4">
        <div className="absolute inset-x-4 bottom-10 border-t border-white/10" />
        <div className="absolute bottom-4 left-4 top-4 border-l border-white/10" />
        {xReference !== undefined && (
          <div className="absolute bottom-10 top-4 border-l border-cyan-300/30" style={{ left: `${Math.max(12, Math.min(92, (xReference / maxX) * 86 + 4))}%` }} />
        )}
        <div className="absolute left-4 right-4 border-t border-emerald-300/30" style={{ bottom: `${Math.max(12, Math.min(88, ((yReference - minY) / yRange) * 76 + 10))}%` }} />
        {points.map((point) => {
          const left = Math.max(8, Math.min(92, (point.x / maxX) * 86 + 6))
          const bottom = Math.max(12, Math.min(88, ((point.y - minY) / yRange) * 76 + 10))
          const color = point.tone === 'success' ? 'bg-emerald-300' : point.tone === 'danger' ? 'bg-rose-300' : 'bg-amber-300'

          return (
            <div key={point.label} className="group absolute -translate-x-1/2 translate-y-1/2" style={{ left: `${left}%`, bottom: `${bottom}%` }}>
              <span className={`block h-3.5 w-3.5 rounded-full shadow-lg ring-4 ring-slate-900 ${color}`} />
              <div className="pointer-events-none absolute left-4 top-[-14px] z-10 hidden min-w-44 rounded-md bg-slate-800 px-3 py-2 text-xs text-slate-100 shadow-xl group-hover:block">
                <strong>{point.label}</strong>
                <p>CSAT {point.y}% | Volume {point.x}</p>
                {point.detail && <p>{point.detail}</p>}
              </div>
            </div>
          )
        })}
        <span className="absolute bottom-3 right-4 text-xs text-slate-500">Volume</span>
        <span className="absolute left-5 top-3 text-xs text-slate-500">CSAT</span>
        {!points.length && <EmptyState text="Sem dados suficientes para o mapa." />}
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
  return (
    <div className="mt-4 rounded-lg border border-amber-400/20 bg-amber-400/10 p-4">
      <p className="text-sm font-semibold text-amber-100">Sem dados para este recorte</p>
      <p className="mt-1 text-sm leading-6 text-slate-300">{text}</p>
    </div>
  )
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
  photoUrl,
}: {
  metric: ChatMonthlyMetric
  periodLabel: string
  averageTickets: number
  podiumPosition: number
  monthlyHistory: ChatMonthlyMetric[]
  feedbackStyle: ChatFeedbackStyle
  managerNotes: string
  feedbackText: string
  photoUrl?: string | null
}) {
  const analystName = getChatAnalystName(metric)
  const safeName = escapeHtml(analystName)
  const resolvedPhotoUrl = photoUrl ? new URL(photoUrl, window.location.origin).href : ''
  const photoHtml = resolvedPhotoUrl
    ? `<img class="profile-photo" src="${escapeHtml(resolvedPhotoUrl)}" alt="Foto de ${safeName}" width="76" height="76" style="width:76px;height:76px;max-width:76px;max-height:76px;border-radius:50%;object-fit:cover;border:2px solid #0891b2;display:block;" />`
    : ''
  const csatGoal = Number(metric.csat_goal) || 90
  const reviewGoal = 25
  const csatGap = round(Number(metric.csat) - csatGoal)
  const reviewGap = round(Number(metric.review_percentage) - reviewGoal)
  const productivityGap = averageTickets ? round(((Number(metric.total_tickets) - averageTickets) / averageTickets) * 100) : 0
  const podiumText = podiumPosition > 0
    ? `${podiumPosition}o Lugar - CSAT: ${metric.csat}% | ${metric.total_tickets} atendimentos | ${metric.review_percentage}% avaliações`
    : 'Não elegível ao pódio neste período'
  const status = metric.status || (Number(metric.csat) >= csatGoal && Number(metric.review_percentage) >= reviewGoal ? 'Meta Superada' : 'Em acompanhamento')
  const statusColor = status === 'Meta Superada' ? '#059669' : status === 'Critico' ? '#dc2626' : '#d97706'
  const csatText = csatGap >= 0
    ? `O resultado superou a referência de ${csatGoal}% em ${formatDelta(csatGap, ' p.p.')}.`
    : `O resultado ficou ${formatDelta(csatGap, ' p.p.')} abaixo da referência de ${csatGoal}%.`
  const reviewText = reviewGap >= 0
    ? `O resultado superou a meta de avaliações em ${formatDelta(reviewGap, ' p.p.')}.`
    : `O resultado ficou ${formatDelta(reviewGap, ' p.p.')} abaixo da meta minima de avaliações.`
  const productivityText = productivityGap >= 0
    ? `${analystName} absorveu uma demanda ${formatDelta(productivityGap, '%')} superior a média da operação.`
    : `${analystName} ficou ${formatDelta(productivityGap, '%')} abaixo da média de atendimentos da operação.`
  const finalFeedback = feedbackText.trim() || buildChatFeedbackText({ metric, averageTickets, podiumPosition, style: feedbackStyle, managerNotes })
  const feedbackTitle = getChatFeedbackStyleLabel(feedbackStyle)
  const managerNotesHtml = managerNotes.trim() ? `<h2>Observações do gestor</h2><div class="note-box">${formatChatFeedbackForReport(managerNotes)}</div>` : ''
  const evolutionRows = buildChatReportEvolutionRows(monthlyHistory)

  const documentHtml = `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Análise individual - ${safeName}</title>
        <style>
          body { font-family: Arial, sans-serif; color: #111827; margin: 34px; }
          h1 { font-size: 26px; margin: 0 0 6px; color: #0f172a; }
          h2 { color: #0f766e; font-size: 18px; margin: 24px 0 8px; }
          h3 { font-size: 14px; margin: 16px 0 6px; color: #0f172a; }
          p { font-size: 12px; line-height: 1.55; margin: 0 0 8px; }
          ul { margin-top: 6px; }
          li { font-size: 12px; line-height: 1.55; margin-bottom: 5px; }
          .header { border-bottom: 3px solid #06b6d4; padding-bottom: 12px; margin-bottom: 18px; }
          .header-content { display: flex; align-items: center; gap: 16px; }
          .profile-photo { width: 76px !important; height: 76px !important; max-width: 76px !important; max-height: 76px !important; border-radius: 50%; object-fit: cover; border: 2px solid #0891b2; display: block; }
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
          .strategy-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin: 12px 0 14px; }
          .strategy-card { border: 1px solid #cbd5e1; background: #ffffff; padding: 10px; page-break-inside: avoid; }
          .strategy-card span { display: block; color: #475569; font-size: 10px; margin-bottom: 5px; }
          .strategy-card strong { display: block; color: #0f172a; font-size: 13px; line-height: 1.35; }
          .strategy-card em { display: block; color: #475569; font-size: 10px; font-style: normal; margin-top: 5px; }
          .coach h3 { margin-top: 0; color: #0f172a; }
          @page { margin: 18mm; }
          @media print {
            body { margin: 0; }
            .box, .kpi-card, .strategy-card, .month-card, .coach { page-break-inside: avoid; }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="header-content">
            ${photoHtml}
            <div><h1>Relatório de Performance - ${safeName}</h1><p class="subtitle">Período: ${escapeHtml(periodLabel)} | Fonte: Zendesk</p></div>
          </div>
        </div>

        <div class="box">
          <h2>Resumo do fechamento</h2>
          <p>Status geral: <span class="metric">${escapeHtml(status)}</span></p>
          <p>Posição no pódio: ${escapeHtml(podiumText)}</p>
          <p class="muted">A leitura abaixo separa resultado, comparação com meta e orientação de desenvolvimento para evitar repetição de dados.</p>
        </div>

        <div class="kpi-grid">
          <div class="kpi-card">
            <span>Qualidade percebida</span>
            <strong>${metric.csat}%</strong>
            <em>Meta individual: ${csatGoal}% (${formatDelta(csatGap, ' p.p.')})</em>
          </div>
          <div class="kpi-card">
            <span>Participação em avaliações</span>
            <strong>${metric.review_percentage}%</strong>
            <em>${metric.reviews} respostas sobre ${metric.valid_tickets} válidos</em>
          </div>
          <div class="kpi-card">
            <span>Volume mensal</span>
            <strong>${metric.total_tickets}</strong>
            <em>Média da operação: ${averageTickets} (${formatDelta(productivityGap, '%')})</em>
          </div>
        </div>

        <h2>Análise técnica de desempenho</h2>
        <h3>Qualidade e Satisfação do Cliente (CSAT)</h3>
        <p>O(A) colaborador(a) registrou um indice de <strong>Satisfação (CSAT) de ${metric.csat}%</strong>.</p>
        <ul>
          <li><strong>Comparativo com a meta:</strong> ${escapeHtml(csatText)}</li>
          <li><strong>Análise detalhada:</strong> Do volume total de feedbacks recebidos (${metric.reviews}), <strong>${metric.positive_reviews} foram positivos</strong>. Houve ${metric.negative_reviews} registros negativos.</li>
        </ul>

        <h3>Engajamento e Coleta de Feedback</h3>
        <p>O(A) colaborador(a) alcancou uma <strong>taxa de avaliações de ${metric.review_percentage}%</strong>.</p>
        <ul>
          <li><strong>Comparativo com a meta:</strong> ${escapeHtml(reviewText)}</li>
          <li><strong>Calculo:</strong> A taxa foi calculada sobre ${metric.reviews} avaliações divididas por ${metric.valid_tickets} atendimentos válidos.</li>
        </ul>

        <h3>Produtividade e Volumetria</h3>
        <p>O volume total de atendimentos realizados pelo(a) colaborador(a) foi de <strong>${metric.total_tickets} chamados</strong>.</p>
        <ul>
          <li><strong>Comparativo com a operação:</strong> A média de atendimentos por agente foi de ${averageTickets}. ${escapeHtml(productivityText)}</li>
          <li><strong>Destaque:</strong> ${escapeHtml(podiumText)}.</li>
        </ul>

        <h2>Evolução mensal</h2>
        <p class="muted">Leitura comparativa dos meses importados. O objetivo e enxergar rapidamente melhora, queda ou estabilidade em CSAT, avaliações e volume.</p>
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
  const fileName = `análise-${slugifyFileName(analystName)}-${slugifyFileName(periodLabel)}.doc`

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
  if (!history.length) return '<p class="muted">Sem historico mensal suficiente para exibir evolução.</p>'

  const first = history[0]
  const last = history.at(-1) ?? first
  const csatDelta = round(Number(last.csat) - Number(first.csat))
  const reviewDelta = round(Number(last.review_percentage) - Number(first.review_percentage))
  const sendingDelta = round(Number(last.sending_percentage) - Number(first.sending_percentage))
  const ticketDelta = Number(last.total_tickets) - Number(first.total_tickets)
  const maxTickets = Math.max(...history.map((metric) => Number(metric.total_tickets)), 1)
  const bestCsat = [...history].sort((a, b) => Number(b.csat) - Number(a.csat))[0]
  const lowestCsat = [...history].sort((a, b) => Number(a.csat) - Number(b.csat))[0]
  const bestReview = [...history].sort((a, b) => Number(b.review_percentage) - Number(a.review_percentage))[0]
  const deltaText = (value: number, suffix = '') => (value > 0 ? `+${value}${suffix}` : `${value}${suffix}`)
  const barWidth = (value: number, max = 100) => `${Math.max(3, Math.min(100, (value / max) * 100))}%`
  const trendSignal =
    history.length <= 1
      ? 'Fotografia inicial'
      : csatDelta >= 0 && reviewDelta >= 0
        ? 'Evolucao favoravel'
        : csatDelta < 0 && reviewDelta < 0
          ? 'Queda combinada'
          : 'Evolucao mista'
  const focusText =
    Number(last.csat) < 90
      ? 'priorizar qualidade percebida e revisar causas de avaliações negativas.'
      : Number(last.review_percentage) < 25
        ? 'aumentar a amostra de avaliações para tornar a leitura mais sustentavel.'
        : csatDelta < 0
          ? 'entender o que mudou no ultimo ciclo para recuperar o patamar anterior.'
          : reviewDelta < 0
            ? 'preservar o CSAT e recuperar participação dos clientes nas avaliações.'
            : 'manter consistencia e compartilhar as praticas que sustentaram o resultado.'
  const readText =
    history.length > 1
      ? `Entre ${first.month_label} e ${last.month_label}, o CSAT variou ${deltaText(csatDelta, ' p.p.')}, as avaliações variaram ${deltaText(reviewDelta, ' p.p.')}, o envio/sem avaliação variou ${deltaText(sendingDelta, ' p.p.')} e o volume mudou ${deltaText(ticketDelta)} atendimentos.`
      : 'Há apenas um mes importado para este analista; a leitura funciona como fotografia do período.'
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
            <span class="indicator-label">Avaliações</span>
            <span class="indicator-track"><span class="indicator-fill review" style="display:block;width:${barWidth(Number(metric.review_percentage))};"></span></span>
            <span class="indicator-value">${metric.review_percentage}%</span>
          </div>
          <div class="indicator-row">
            <span class="indicator-label">Sem avaliação</span>
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

  return `
    <div class="trend">
      <div class="trend-read"><p>${escapeHtml(readText)}</p></div>
      <div class="strategy-grid">
        <div class="strategy-card">
          <span>Leitura do historico</span>
          <strong>${escapeHtml(trendSignal)}</strong>
          <em>Melhor CSAT: ${escapeHtml(bestCsat.month_label.replace(' 2026', ''))} (${bestCsat.csat}%).</em>
        </div>
        <div class="strategy-card">
          <span>Ponto de atenção</span>
          <strong>${escapeHtml(lowestCsat.month_label.replace(' 2026', ''))} teve o menor CSAT</strong>
          <em>Maior amostra de avaliações: ${escapeHtml(bestReview.month_label.replace(' 2026', ''))} (${bestReview.review_percentage}%).</em>
        </div>
        <div class="strategy-card">
          <span>Foco recomendado</span>
          <strong>${escapeHtml(focusText)}</strong>
          <em>Use esta leitura para orientar o próximo ciclo mensal.</em>
        </div>
      </div>
      <p class="chart-title">Evolução mensal em barras</p>
      <p class="chart-legend">CSAT e avaliações usam escala percentual. Atendimentos usa escala relativa ao maior volume exibido.</p>
      ${monthCards}
    </div>
  `
}

function cleanChatReportFeedbackText(text: string) {
  return text
    .replace(/\*\*/g, '')
    .replace(/^#+\s*/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function isChatReportFeedbackComplete(text: string, style: ChatFeedbackStyle) {
  const cleanText = cleanChatReportFeedbackText(text)
  const normalizedText = cleanText.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const requiredSections =
    style === 'sare'
      ? ['situação', 'alinhamentos', 'resultado', 'expectativa']
      : style === 'mimo'
        ? ['momento', 'impacto', 'melhoria', 'orientação']
        : ['leitura', 'forcas', 'plano', 'expectativa']

  return cleanText.length >= 650 && requiredSections.every((section) => normalizedText.includes(section))
}

function normalizeChatReportFeedback(text: string, fallbackText: string, style: ChatFeedbackStyle) {
  const cleanText = cleanChatReportFeedbackText(text)
  return isChatReportFeedbackComplete(cleanText, style) ? cleanText : cleanChatReportFeedbackText(fallbackText)
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
  const podiumText = podiumPosition > 0 ? `${podiumPosition}o lugar no pódio` : 'fora do pódio neste fechamento'
  const notesLine = managerNotes.trim()
    ? 'As observações do gestor devem calibrar o reconhecimento, os combinados e o tom da devolutiva.'
    : ''
  const qualityReading =
    csatGap >= 0
      ? `A satisfação ficou ${formatDelta(csatGap, ' p.p.')} em relação a meta individual de ${csatGoal}%, sinal de boa percepcao do cliente sobre a entrega.`
      : `A satisfação ficou ${formatDelta(csatGap, ' p.p.')} em relação a meta individual de ${csatGoal}%, ponto que pede revisao qualitativa dos atendimentos com avaliação negativa.`
  const reviewReading =
    reviewGap >= 0
      ? `A amostra de avaliações ficou ${formatDelta(reviewGap, ' p.p.')} acima da referência de ${reviewGoal}%, aumentando a confiabilidade da leitura do mes.`
      : `A amostra de avaliações ficou ${formatDelta(reviewGap, ' p.p.')} abaixo da referência de ${reviewGoal}%, entao o próximo ciclo precisa ampliar a participação dos clientes.`
  const volumeReading =
    productivityGap >= 0
      ? `O volume ficou ${formatDelta(productivityGap, '%')} acima da média da operação, demonstrando capacidade de sustentar entrega mesmo com demanda elevada.`
      : `O volume ficou ${formatDelta(productivityGap, '%')} abaixo da média da operação; vale validar se houve distribuicao de fila, ausencia, emprestimo para outro setor ou oportunidade de produtividade.`
  const recognition =
    status === 'Meta Superada'
      ? `${analystName} encerrou o ciclo em patamar de reconhecimento. O resultado combina qualidade percebida, amostra suficiente de avaliações e volume competitivo dentro da operação.`
      : status === 'Critico'
        ? `${analystName} encerrou o ciclo com sinais que pedem acompanhamento mais próximo. A prioridade e escolher poucos combinados praticos, acompanhar execucao e reduzir dispersao no próximo fechamento.`
        : `${analystName} apresentou bons sinais no ciclo, mas ainda ha critérios que precisam ganhar consistencia para sustentar elegibilidade e reconhecimento no fechamento mensal.`
  const development =
    status === 'Meta Superada'
      ? 'O combinado recomendado e proteger o padrao que funcionou, compartilhar boas praticas com o time e evitar acomodação apos um ciclo positivo.'
      : csatGap < 0
        ? 'O combinado recomendado e revisar exemplos concretos de interações com menor satisfação, identificar causa raiz e escolher uma ação simples de melhoria para o próximo mes.'
        : reviewGap < 0
          ? 'O combinado recomendado e fortalecer o fechamento dos atendimentos, explicando ao cliente a importancia da avaliação sem transformar isso em fala mecanica.'
          : 'O combinado recomendado e investigar o fator de volume, separar o que e contexto operacional do que e oportunidade individual e definir um alvo realista para o próximo ciclo.'
  const practicalSteps =
    status === 'Meta Superada'
      ? 'Como colocar em pratica: escolha dois atendimentos bem avaliados do mes e registre o que se repetiu neles; transforme esse padrao em uma rotina curta de atendimento; compartilhe uma pratica com a equipe; no próximo fechamento, compare se CSAT, avaliações e volume continuaram consistentes.'
      : csatGap < 0
        ? 'Como colocar em pratica: separe de dois a tres atendimentos com avaliação negativa ou neutra; identifique se a causa foi clareza, prazo, empatia, solucao ou encerramento; escolha uma mudanca de abordagem para testar no próximo ciclo; leve ao gestor um exemplo antes e depois para validar a evolução.'
        : reviewGap < 0
          ? 'Como colocar em pratica: revise o encerramento dos atendimentos e crie uma frase natural para convidar o cliente a avaliar; use essa frase nos casos resolvidos com boa percepcao; acompanhe se a quantidade de avaliações aumenta no fechamento seguinte; ajuste a abordagem se a fala parecer mecanica.'
          : 'Como colocar em pratica: confirme com o gestor se o volume menor veio de fila, ausencia, emprestimo ou distribuicao operacional; quando for oportunidade individual, defina um alvo de produtividade realista; acompanhe a quantidade de atendimentos válidos ao longo do mes; preserve qualidade para nao trocar volume por perda de CSAT.'

  if (style === 'sare') {
    return [
      `Situação: ${recognition} No período, o resultado foi CSAT ${metric.csat}%, avaliações ${metric.review_percentage}%, envio/sem avaliação ${metric.sending_percentage}% e ${metric.total_tickets} atendimentos. A posição atual e ${podiumText}.`,
      `Alinhamentos Realizados: ${qualityReading} ${reviewReading} ${volumeReading} ${notesLine}`.trim(),
      'Resultado Esperado: manter o que ja gera boa experiencia para o cliente e transformar os pontos de atenção em comportamento observavel no próximo fechamento mensal.',
      `Expectativa e Plano de Desenvolvimento: ${development} ${practicalSteps}`,
    ]
      .filter(Boolean)
      .join('\n\n')
  }

  if (style === 'mimo') {
    return [
      `Momento observado: ${analystName} fechou o ciclo com status ${status}, CSAT ${metric.csat}%, avaliações ${metric.review_percentage}% e ${metric.total_tickets} atendimentos.`,
      `Impacto: ${recognition} ${qualityReading}`,
      `Melhoria ou manutencao: ${reviewReading} ${volumeReading} ${notesLine}`.trim(),
      `Orientação: ${development} ${practicalSteps} Posição atual: ${podiumText}.`,
    ]
      .filter(Boolean)
      .join('\n\n')
  }

  return [
    `Leitura do ciclo: ${recognition} No fechamento, os indicadores mostram CSAT de ${metric.csat}%, avaliações de ${metric.review_percentage}%, envio/sem avaliação de ${metric.sending_percentage}% e ${metric.total_tickets} atendimentos. A posição atual e ${podiumText}.`,
    `Evidencias observadas: ${qualityReading} ${reviewReading} ${volumeReading}`,
    notesLine ? `Contexto do gestor: ${notesLine}` : '',
    `Plano de desenvolvimento: ${development}`,
    `Como fazer no próximo ciclo: ${practicalSteps}`,
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
function buildPhoneFeedbackText({
  analystName,
  periodLabel,
  analystResult,
  podiumCsatGoal,
  reviewGoal,
  csatDelta,
  teamPerformance,
  teamPerformanceGoal,
  teamAnsweredCalls,
  teamTotalCalls,
  rankingPosition,
  managerNotes,
  style,
}: {
  analystName: string
  periodLabel: string
  analystResult: ReturnType<typeof buildPeriodPodium>[number]
  podiumCsatGoal: number
  reviewGoal: number
  csatDelta: number
  teamPerformance: number
  teamPerformanceGoal: number
  teamAnsweredCalls: number
  teamTotalCalls: number
  rankingPosition: number
  managerNotes: string
  style: ChatFeedbackStyle
}) {
  const statusText = analystResult.eligible ? 'elegível ao pódio' : 'em acompanhamento'
  const reasonsText = analystResult.reasons.length ? analystResult.reasons.join(', ') : 'sem impeditivos principais'
  const managerContext = managerNotes.trim()
    ? ` Contexto do gestor: ${managerNotes.trim()}`
    : ''
  const podiumText = rankingPosition ? `${rankingPosition}º lugar no pódio` : 'fora do pódio'

  if (style === 'mimo') {
    return [
      `Momento observado: ${analystName} fechou ${periodLabel} com CSAT de ${analystResult.averageCsat}%, ${analystResult.totalReviews} avaliações e ${analystResult.totalTickets} atendimentos. A posição atual é ${podiumText}, com status ${statusText}. A variação contra o período anterior foi de ${formatDelta(csatDelta, ' p.p.')}.`,
      `Impacto: esse resultado influencia diretamente a elegibilidade ao pódio, a leitura de qualidade do atendimento e a confiança da gestão no fechamento do período. No contexto da equipe, a performance foi de ${teamPerformance}% para ${teamAnsweredCalls} ligações atendidas em ${teamTotalCalls} processadas, contra meta de ${teamPerformanceGoal}%.`,
      `Melhoria ou manutenção: ${analystResult.eligible ? 'manter as práticas que sustentaram CSAT, avaliações e volume, evitando queda até o fechamento.' : `atuar sobre os pontos pendentes: ${reasonsText}.`} A referência de pódio é ${podiumCsatGoal}% de CSAT e a meta mínima de avaliações é ${reviewGoal}%.${managerContext}`,
      `Orientação: transformar a leitura em ação prática. Revise exemplos de atendimentos que influenciaram o CSAT, combine um comportamento observável para a próxima semana e acompanhe se avaliações e volume continuam sustentando a elegibilidade.`,
    ].join('\n\n')
  }

  return [
    `Situação: ${analystName} fechou ${periodLabel} com CSAT de ${analystResult.averageCsat}%, ${analystResult.totalReviews} avaliações e ${analystResult.totalTickets} atendimentos. A posição atual é ${podiumText}, com status ${statusText}. A variação contra o período anterior foi de ${formatDelta(csatDelta, ' p.p.')}.`,
    `Alinhamentos Realizados: a leitura deve considerar a meta individual de ${analystResult.individualGoal}%, a referência de pódio de ${podiumCsatGoal}% e a meta mínima de avaliações de ${reviewGoal}%. O ponto observado para conversa é: ${reasonsText}.${managerContext}`,
    `Resultado Esperado: sustentar CSAT acima da referência, preservar ou recuperar volume de avaliações e manter comportamento de atendimento que gere boa experiência para o cliente. No contexto da equipe, a performance foi de ${teamPerformance}% para ${teamAnsweredCalls} ligações atendidas em ${teamTotalCalls} processadas, contra meta de ${teamPerformanceGoal}%.`,
    `Expectativa e Plano de Desenvolvimento: transforme a leitura em ação semanal. Revise exemplos de atendimentos que influenciaram o CSAT, combine um comportamento observável para a próxima semana e acompanhe se avaliações e volume continuam sustentando a elegibilidade no fechamento mensal.`,
  ].join('\n\n')
}

function normalizePhoneReportFeedback(text: string, fallbackText: string, style: ChatFeedbackStyle) {
  return normalizeChatReportFeedback(text, fallbackText, style)
}

function exportWordReport({
  analystName,
  photoUrl,
  periodLabel,
  expected,
  achieved,
  weeklyEvolution,
  feedbackStyle,
  assistedFeedback,
}: {
  analystName: string
  photoUrl?: string | null
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
  weeklyEvolution: WeeklyIndividualTrend[]
  feedbackStyle: ChatFeedbackStyle
  assistedFeedback: string
}) {
  const safeName = escapeHtml(analystName)
  const resolvedPhotoUrl = photoUrl ? new URL(photoUrl, window.location.origin).href : ''
  const photoHtml = resolvedPhotoUrl
    ? `<img class="profile-photo" src="${escapeHtml(resolvedPhotoUrl)}" alt="Foto de ${safeName}" width="76" height="76" style="width:76px;height:76px;max-width:76px;max-height:76px;border-radius:50%;object-fit:cover;border:2px solid #0891b2;display:block;" />`
    : ''
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
    ? `${formatDelta(goalGap, ' p.p.')} acima da referência`
    : `${formatDelta(goalGap, ' p.p.')} abaixo da referência`
  const reviewGap = round(achieved.reviewPercentage - expected.review)
  const reviewGapText = reviewGap >= 0
    ? `${formatDelta(reviewGap, ' p.p.')} acima da meta`
    : `${formatDelta(reviewGap, ' p.p.')} abaixo da meta`
  const feedbackTitle = getChatFeedbackStyleLabel(feedbackStyle)
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
    : '<p class="muted">Sem dados de evolução no período.</p>'
  const volumeRows = weeklyEvolution.length
    ? weeklyEvolution
        .map(
          (item) => `
            <tr>
              <td>${escapeHtml(item.label)}</td>
              <td>${item.totalReviews}</td>
              <td>${item.totalTickets}</td>
            </tr>
          `,
        )
        .join('')
    : '<tr><td colspan="3">Sem dados de volume no período.</td></tr>'

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
          .header-content { display: flex; align-items: center; gap: 16px; }
          .profile-photo { width: 76px !important; height: 76px !important; max-width: 76px !important; max-height: 76px !important; border-radius: 50%; object-fit: cover; border: 2px solid #0891b2; display: block; }
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
          .goal-badge { display: inline-block; background: #0f766e; color: #ffffff; font-size: 11px; font-weight: bold; padding: 6px 9px; margin: 0 0 10px; }
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
          <div class="header-content">
            ${photoHtml}
            <div><h1>${safeName}</h1><p class="subtitle">Relatorio mensal de performance - ${escapeHtml(periodLabel)}</p></div>
          </div>
        </div>

        <div class="grid">
          <div class="box">
            <h2>Esperado</h2>
            <p>CSAT maior ou igual a ${expected.csat}%</p>
            <p>${expected.review}% de avaliações dos atendimentos</p>
          </div>
          <div class="box">
            <h2>Atingido</h2>
            <p>CSAT: ${achieved.csat}% (${goalGapText})</p>
            <p>Avaliações: ${achieved.reviewPercentage}% (${achieved.reviewCount} respondidas, ${reviewGapText})</p>
            <p>Atendimentos: ${achieved.answeredTickets}</p>
            <p>Media por colaborador: ${achieved.averageTickets}</p>
            <p>Posição pódio: ${achieved.rankingPosition || '-'}</p>
          </div>
        </div>

        <h2>Sintese do feedback</h2>
        <div class="callout"><p>${escapeHtml(achieved.summary)}</p></div>

        <h2>Graficos e evolução</h2>
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
            <div class="insight-note">ponto mais alto do período</div>
          </div>
          <div class="insight">
            <div class="insight-label">Avaliações respondidas</div>
            <div class="insight-value">${achieved.reviewCount}</div>
            <div class="insight-note">${achieved.reviewPercentage}% dos atendimentos</div>
          </div>
        </div>
        <div class="trend-panel">
          <div class="trend-title">Evolução semanal do CSAT</div>
          <div class="goal-badge">Referência para o pódio: ${expected.csat}%</div>
          ${evolutionBars}
        </div>
        <p class="muted">Menor ponto do período: ${worstEvolution ? `${worstEvolution.label} - ${worstEvolution.csat}%` : '-'}.</p>
        <h3>Volume semanal</h3>
        <p class="muted">Complemento da evolução: avaliações respondidas e atendimentos registrados em cada semana.</p>
        <table>
          <thead>
            <tr>
              <th>Semana</th>
              <th>Avaliações</th>
              <th>Atendimentos</th>
            </tr>
          </thead>
          <tbody>${volumeRows}</tbody>
        </table>
        <h2>Contexto operacional da equipe</h2>
        <p>Performance da equipe no período: ${achieved.teamPerformance}%.</p>
        <p>Ligações atendidas pela equipe: ${achieved.teamAnsweredCalls}. Total processado: ${achieved.teamTotalCalls}.</p>

        <h2>Feedback ${escapeHtml(feedbackTitle)}</h2>
        <div class="callout">${formatChatFeedbackForReport(assistedFeedback)}</div>
      </body>
    </html>
  `
  const blob = new Blob(['\ufeff', documentHtml], {
    type: 'application/msword;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  const fileName = `${slugifyFileName(analystName)}-relatório-${slugifyFileName(periodLabel)}.doc`

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
      if (averageCsat < podiumCsatGoal) reasons.push('abaixo do pódio')
      if (reviewPercentage < reviewGoal) reasons.push('avaliações abaixo da meta')
      if (metric.totalTickets < averageTickets) reasons.push('atendimentos abaixo da média')

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

  const labelSearch = normalizedKey.includes('review') ? 'avalia' : 'pódio'
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

function isPhonePeriodShorterThanWeeklyLaunch(period: PeriodFilter) {
  if (!period.start || !period.end) return false
  if (period.mode !== 'custom') return false

  const start = new Date(period.start + 'T00:00:00')
  const end = new Date(period.end + 'T00:00:00')
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1)

  return days < 5
}

function isMetricInPeriod(weekStart: string, weekEnd: string, period: PeriodFilter) {
  if (!period.start || !period.end) return true
  if (isPhonePeriodShorterThanWeeklyLaunch(period)) return false

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

function getChatAnalystPhoto(metric: ChatMonthlyMetric) {
  const analyst = Array.isArray(metric.chat_analysts) ? metric.chat_analysts[0] : metric.chat_analysts
  return analyst?.photo_url ?? null
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
    'Indice de satisfação do ticket Boa Ruim vazio',
    'Indice de satisfação do ticket',
    'Satisfação',
    'CSAT',
    'Rating',
    'Avaliação',
  ])
  const inactiveAnalystColumn = findChatColumn(inactiveRows, [
    'Nome do atribuido',
    'Atribuido',
    'Assignee',
    'Responsavel',
    'Nome do agente',
    'Analista',
  ])

  if (!satisfactionAnalystColumn) throw new Error('Não encontrei a coluna do analista na planilha de satisfação.')
  if (!satisfactionRatingColumn) throw new Error('Não encontrei a coluna de satisfação/avaliação na planilha de satisfação.')
  if (!inactiveAnalystColumn) throw new Error('Não encontrei a coluna do analista na planilha de inatividade.')

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
      if (excludedAnalystIds.has(metric.analyst_id)) reasons.push('fora do pódio por excecao operacional')

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
  if (Number(metric.review_percentage) < 25) reasons.push('avaliações abaixo de 25%')
  if (Number(metric.total_tickets) < averageTickets) reasons.push('volume abaixo da média (' + averageTickets + ' atend.)')
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

function formatLaunchedPeriodLabel(metrics: IndividualMetric[], period: PeriodFilter) {
  if (!metrics.length) return formatPeriodLabel(period)

  const starts = metrics.map((metric) => metric.week_start).sort()
  const ends = metrics.map((metric) => metric.week_end).sort()
  const firstLaunch = starts[0]
  const lastLaunch = ends[ends.length - 1]

  if (!firstLaunch || !lastLaunch) return formatPeriodLabel(period)
  return `${formatDate(firstLaunch)} a ${formatDate(lastLaunch)}`
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
  if (delta > 1) return 'crescimento frente ao período anterior'
  if (delta < -1) return 'queda frente ao período anterior'
  return 'estabilidade frente ao período anterior'
}

function buildDevelopmentFocus(result: MonthlyPodiumResult, delta: number) {
  if (result.eligible && delta >= 0) {
    return 'manter consistencia, proteger volume de avaliações e preparar boas praticas para compartilhar com a equipe.'
  }

  if (result.reviewPercentage < 25) {
    return 'aumentar o percentual de avaliações, reforcando o convite ao final dos atendimentos e acompanhando o volume semanal.'
  }

  if (result.averageCsat < result.individualGoal) {
    return 'revisar atendimentos com menor satisfação e escolher uma ação objetiva de melhoria para a próxima semana.'
  }

  if (delta < 0) {
    return 'investigar a queda recente e comparar os casos do período atual com o ciclo anterior.'
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

function getPointPosition(value: number, index: number, points: ChartPoint[], comparisonValues: number[] = []) {
  const values = [...points.map((point) => point.value), ...comparisonValues]
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const x = points.length === 1 ? 165 : 20 + (index / (points.length - 1)) * 290
  const y = 110 - ((value - min) / range) * 88

  return { x, y }
}

function buildLinePath(points: ChartPoint[], comparisonValues: number[] = []) {
  if (!points.length) return ''

  return points
    .map((point, index) => {
      const { x, y } = getPointPosition(point.value, index, points, comparisonValues)
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

const chatCountFormatter = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

const chatPercentFormatter = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

function formatChatCount(value: number | string) {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? chatCountFormatter.format(numericValue) : '0'
}

function formatChatPercent(value: number | string) {
  const numericValue = Number(value)
  return `${Number.isFinite(numericValue) ? chatPercentFormatter.format(numericValue) : '0'}%`
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

  return 'Não foi possível concluir a ação. Tente novamente.'
}

function getSupabaseMessage(message: string) {
  if (message.toLowerCase().includes('jwt issued at future')) return ''
  return message
}
