import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

type ProfileRole = 'master' | 'coordenadora' | 'analista'

type IndividualMetricRow = {
  analyst_id: string
  csat: number
  total_reviews: number
  total_tickets: number
}

type AnalystRow = {
  id: string
  name: string
  active: boolean
  csat_goal: number
}

function normalizeRole(role: unknown): ProfileRole | null {
  if (typeof role !== 'string') return null
  const normalized = role.toLowerCase()
  if (normalized === 'master') return 'master'
  if (normalized === 'coordenadora' || normalized === 'coordinator') return 'coordenadora'
  if (normalized === 'analista' || normalized === 'analyst') return 'analista'
  return null
}

function round(value: number, decimals = 2) {
  return Number(value.toFixed(decimals))
}

export async function GET(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: 'Ranking seguro não configurado.' }, { status: 500 })
  }

  const token = request.headers.get('authorization')?.replace('Bearer ', '').trim()
  if (!token) return NextResponse.json({ error: 'Sessão não encontrada.' }, { status: 401 })

  const start = request.nextUrl.searchParams.get('start')
  const end = request.nextUrl.searchParams.get('end')
  if (!start || !end) return NextResponse.json({ error: 'Periodo obrigatorio.' }, { status: 400 })

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })

  const {
    data: { user },
    error: userError,
  } = await admin.auth.getUser(token)

  if (userError || !user) {
    return NextResponse.json({ error: 'Sessão invalida.' }, { status: 401 })
  }

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('role, analyst_id')
    .eq('id', user.id)
    .maybeSingle()

  const role = normalizeRole(profile?.role)
  if (profileError || !role) {
    return NextResponse.json({ error: 'Perfil não encontrado.' }, { status: 403 })
  }

  const [analystsResult, metricsResult, goalsResult] = await Promise.all([
    admin.from('analysts').select('id, name, active, csat_goal').eq('active', true).order('name'),
    admin
      .from('weekly_individual_metrics')
      .select('analyst_id, csat, total_reviews, total_tickets')
      .lte('week_start', end)
      .gte('week_end', start),
    admin.from('goals').select('key, label, value, active'),
  ])

  if (analystsResult.error || metricsResult.error || goalsResult.error) {
    return NextResponse.json({ error: 'Não foi possível calcular o ranking.' }, { status: 500 })
  }

  const analysts = (analystsResult.data ?? []) as AnalystRow[]
  const metrics = (metricsResult.data ?? []) as IndividualMetricRow[]
  const goals = (goalsResult.data ?? []) as { key: string; label: string; value: number; active: boolean }[]

  const podiumGoal =
    Number(goals.find((goal) => goal.active && goal.key === 'podium_csat_minimum')?.value) || 90
  const reviewGoal =
    Number(goals.find((goal) => goal.active && goal.key === 'review_percentage')?.value) || 25

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

  metrics.forEach((metric) => {
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

  const teamAverageTickets = grouped.size
    ? round([...grouped.values()].reduce((sum, item) => sum + item.totalTickets, 0) / grouped.size)
    : 0

  const rows = analysts
    .map((analyst) => {
      const metric = grouped.get(analyst.id)
      if (!metric) return null

      const averageCsat =
        metric.totalReviews > 0
          ? metric.csatWeightedTotal / metric.totalReviews
          : metric.csatSimpleTotal / metric.csatSimpleCount
      const reviewPercentage = metric.totalTickets > 0 ? (metric.totalReviews / metric.totalTickets) * 100 : 0
      const individualGoal = Number(analyst.csat_goal)
      const reasons: string[] = []

      if (averageCsat < individualGoal) reasons.push('abaixo da meta individual')
      if (averageCsat < podiumGoal) reasons.push('abaixo do pódio')
      if (reviewPercentage < reviewGoal) reasons.push('avaliações abaixo da meta')
      if (metric.totalTickets < teamAverageTickets) reasons.push('atendimentos abaixo da média')

      return {
        analyst_id: analyst.id,
        analyst_name: analyst.name,
        average_csat: round(averageCsat),
        total_reviews: metric.totalReviews,
        total_tickets: metric.totalTickets,
        review_percentage: round(reviewPercentage),
        individual_goal: individualGoal,
        eligible: reasons.length === 0,
        reasons,
        team_average_tickets: teamAverageTickets,
      }
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((a, b) => {
      if (a.eligible !== b.eligible) return a.eligible ? -1 : 1
      if (b.average_csat !== a.average_csat) return b.average_csat - a.average_csat
      if (b.review_percentage !== a.review_percentage) return b.review_percentage - a.review_percentage
      if (b.total_tickets !== a.total_tickets) return b.total_tickets - a.total_tickets
      return a.analyst_name.localeCompare(b.analyst_name)
    })
    .map((item, index) => ({ position: index + 1, ...item }))

  if (role === 'analista') {
    const analystId = typeof profile?.analyst_id === 'string' ? profile.analyst_id : ''
    return NextResponse.json(rows.filter((row) => row.analyst_id === analystId))
  }

  return NextResponse.json(rows)
}
