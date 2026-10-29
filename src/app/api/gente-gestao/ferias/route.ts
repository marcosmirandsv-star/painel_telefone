import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

const GENTE_GESTAO_BASE_URL = 'https://gengestaoclick.vercel.app/api/v1'

function isManagementRole(role: unknown) {
  const normalized = typeof role === 'string' ? role.toLowerCase() : ''
  return normalized === 'master' || normalized === 'coordenadora' || normalized === 'coordinator'
}

async function readEndpoint(path: 'colaboradores' | 'ferias', token: string) {
  const url = `${GENTE_GESTAO_BASE_URL}/${path}`
  const bearer = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' })
  const response = bearer.status === 401 || bearer.status === 403
    ? await fetch(url, { headers: { 'x-api-key': token, Accept: 'application/json' }, cache: 'no-store' })
    : bearer
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(`Consulta do Gente Gestão indisponível (${response.status}).`)
  return payload
}

export async function GET(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    const genteGestaoToken = process.env.GENTE_GESTAO_API_TOKEN
    if (!supabaseUrl || !serviceRoleKey || !genteGestaoToken) {
      return NextResponse.json({ error: 'A consulta ao Gente Gestão ainda não está configurada.' }, { status: 503 })
    }

    const sessionToken = request.headers.get('authorization')?.replace('Bearer ', '').trim()
    if (!sessionToken) return NextResponse.json({ error: 'Sessão não encontrada.' }, { status: 401 })

    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })
    const { data: { user }, error: userError } = await admin.auth.getUser(sessionToken)
    if (userError || !user) return NextResponse.json({ error: 'Sessão inválida.' }, { status: 401 })

    const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle()
    if (!isManagementRole(profile?.role)) return NextResponse.json({ error: 'Recurso disponível apenas para a gestão.' }, { status: 403 })

    const [colaboradores, ferias] = await Promise.all([
      readEndpoint('colaboradores', genteGestaoToken),
      readEndpoint('ferias', genteGestaoToken),
    ])
    return NextResponse.json({ colaboradores, ferias, source: 'gente-gestao' })
  } catch (error) {
    console.warn('Gente Gestão consultation unavailable:', error instanceof Error ? error.message : 'erro desconhecido')
    return NextResponse.json({ error: 'Não foi possível consultar o Gente Gestão agora. A gestão de férias do painel continua disponível.' }, { status: 502 })
  }
}
