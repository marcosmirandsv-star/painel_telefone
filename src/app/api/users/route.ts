import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { isChatProductionEnabled } from '@/lib/chat-production-gate'

type ProfileRole = 'master' | 'coordenadora' | 'analista'

const allowedRoles: ProfileRole[] = ['master', 'coordenadora', 'analista']

function normalizeRole(role: unknown): ProfileRole | null {
  if (typeof role !== 'string') return null
  const normalized = role.toLowerCase()
  if (normalized === 'master') return 'master'
  if (normalized === 'coordenadora' || normalized === 'coordinator') return 'coordenadora'
  if (normalized === 'analista' || normalized === 'analyst') return 'analista'
  return null
}

function isManagementRole(role: unknown) {
  const normalized = normalizeRole(role)
  return normalized === 'master' || normalized === 'coordenadora'
}

export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      {
        error:
          'Criacao de usuários ainda não configurada. Adicione SUPABASE_SERVICE_ROLE_KEY nas variaveis de ambiente da Vercel.',
      },
      { status: 500 },
    )
  }

  const token = request.headers.get('authorization')?.replace('Bearer ', '').trim()

  if (!token) {
    return NextResponse.json({ error: 'Sessão não encontrada. Entre novamente.' }, { status: 401 })
  }

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
    return NextResponse.json({ error: 'Sessão invalida. Entre novamente.' }, { status: 401 })
  }

  const { data: requesterProfile, error: profileError } = await admin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()

  if (profileError || !isManagementRole(requesterProfile?.role)) {
    return NextResponse.json(
      { error: 'Apenas usuários de gestão podem criar novos acessos.' },
      { status: 403 },
    )
  }

  const body = await request.json().catch(() => null)

  const fullName = typeof body?.fullName === 'string' ? body.fullName.trim() : ''
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body?.password === 'string' ? body.password : ''
  const role = normalizeRole(body?.role)
  const analystId = typeof body?.analystId === 'string' && body.analystId ? body.analystId : null
  const chatAnalystId = typeof body?.chatAnalystId === 'string' && body.chatAnalystId ? body.chatAnalystId : null

  if (!fullName || !email || !password || !role || !allowedRoles.includes(role)) {
    return NextResponse.json({ error: 'Preencha nome, e-mail, senha e perfil.' }, { status: 400 })
  }

  if (password.length < 6) {
    return NextResponse.json(
      { error: 'A senha temporaria precisa ter pelo menos 6 caracteres.' },
      { status: 400 },
    )
  }

  if (chatAnalystId) {
    if (!isChatProductionEnabled()) return NextResponse.json({ error: 'O acesso do Chat ainda não foi liberado neste ambiente.' }, { status: 404 })
    if (role !== 'analista' || analystId || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(chatAnalystId)) {
      return NextResponse.json({ error: 'Selecione um vínculo individual válido do Chat.' }, { status: 400 })
    }
    const analyst = await admin.from('chat_analysts').select('id,name,active').eq('id', chatAnalystId).maybeSingle()
    if (analyst.error || !analyst.data?.active) return NextResponse.json({ error: 'Analista do Chat indisponível ou inativo.' }, { status: 400 })
    const nameKey = String(analyst.data.name).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
    const registry = await admin.from('clickdesk_official_owner_registry').select('clickdesk_owner_id').eq('source_owner_key', nameKey).eq('source_scope', 'suporte_erp_fiscal').eq('active', true).maybeSingle()
    if (registry.error || !registry.data) return NextResponse.json({ error: 'O analista ainda não pertence ao quadro oficial do Chat.' }, { status: 400 })
  }

  if (role === 'analista' && !analystId && !chatAnalystId) {
    return NextResponse.json(
      { error: 'Usuários analistas precisam ser vinculados a um cadastro de analista.' },
      { status: 400 },
    )
  }

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: fullName,
    },
  })

  if (createError || !created.user) {
    return NextResponse.json(
      {
        error:
          createError?.message ??
          'Não foi possível criar o usuario. Verifique se este e-mail já existe no Supabase.',
      },
      { status: 400 },
    )
  }

  const { error: upsertError } = await admin.from('profiles').upsert(
    {
      id: created.user.id,
      role,
      full_name: fullName,
      analyst_id: role === 'analista' ? analystId : null,
      ...(chatAnalystId ? { chat_analyst_id: chatAnalystId } : {}),
    },
    { onConflict: 'id' },
  )

  if (upsertError) {
    return NextResponse.json(
      {
        error:
          'O login foi criado, mas não consegui vincular o perfil. Revise a tabela profiles no Supabase.',
      },
      { status: 500 },
    )
  }

  return NextResponse.json({
    id: created.user.id,
    message: 'Usuario criado e vinculado com sucesso.',
  })
}
