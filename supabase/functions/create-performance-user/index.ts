import { createClient } from 'npm:@supabase/supabase-js@2'

type ProfileRole = 'master' | 'coordenadora' | 'analista'

function normalizeRole(value: unknown): ProfileRole | null {
  const role = String(value ?? '').toLowerCase()
  if (role === 'master') return 'master'
  if (role === 'coordenadora' || role === 'coordinator') return 'coordenadora'
  if (role === 'analista' || role === 'analyst') return 'analista'
  return null
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405)

  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim()
  if (!token) return json({ error: 'Sessão não encontrada.' }, 401)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const secretKeysRaw = Deno.env.get('SUPABASE_SECRET_KEYS')
  const legacyServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const serviceKey = secretKeysRaw
    ? JSON.parse(secretKeysRaw)['default']
    : legacyServiceKey

  if (!supabaseUrl || !serviceKey) {
    return json({ error: 'Configuração administrativa indisponível.' }, 500)
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const {
    data: { user },
    error: userError,
  } = await admin.auth.getUser(token)

  if (userError || !user) return json({ error: 'Sessão inválida.' }, 401)

  const requester = await admin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()

  const requesterRole = normalizeRole(requester.data?.role)
  if (
    requester.error ||
    (requesterRole !== 'master' && requesterRole !== 'coordenadora')
  ) {
    return json({ error: 'Apenas a gestão pode criar acessos.' }, 403)
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Corpo JSON inválido.' }, 400)
  }

  const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : ''
  const email =
    typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  const role = normalizeRole(body.role)
  const analystId =
    typeof body.analystId === 'string' && body.analystId ? body.analystId : null
  const chatAnalystId =
    typeof body.chatAnalystId === 'string' && body.chatAnalystId
      ? body.chatAnalystId
      : null

  if (!fullName || !email || !password || !role) {
    return json({ error: 'Preencha nome, e-mail, senha e perfil.' }, 400)
  }
  if (password.length < 6) {
    return json({ error: 'A senha temporária precisa ter pelo menos 6 caracteres.' }, 400)
  }
  if (role === 'analista' && !analystId && !chatAnalystId) {
    return json(
      { error: 'Vincule o analista ao Telefone, ao Chat ou aos dois módulos.' },
      400,
    )
  }

  if (role === 'analista' && analystId) {
    const phone = await admin
      .from('analysts')
      .select('id')
      .eq('id', analystId)
      .maybeSingle()
    if (phone.error || !phone.data) {
      return json({ error: 'O vínculo do Telefone não é válido.' }, 400)
    }
  }

  if (role === 'analista' && chatAnalystId) {
    const chat = await admin
      .from('chat_analysts')
      .select('id')
      .eq('id', chatAnalystId)
      .maybeSingle()
    if (chat.error || !chat.data) {
      return json({ error: 'O vínculo do Chat não é válido.' }, 400)
    }
  }

  const previousAllowlist = await admin
    .from('homologation_access_allowlist')
    .select('email,full_name,role,analyst_id,chat_analyst_id')
    .eq('email', email)
    .maybeSingle()

  if (previousAllowlist.error) {
    return json({ error: 'Não foi possível preparar a autorização do acesso.' }, 500)
  }

  const allowlistRow = {
    email,
    full_name: fullName,
    role,
    analyst_id: role === 'analista' ? analystId : null,
    chat_analyst_id: role === 'analista' ? chatAnalystId : null,
  }

  const allowlistResult = await admin
    .from('homologation_access_allowlist')
    .upsert(allowlistRow, { onConflict: 'email' })

  if (allowlistResult.error) {
    return json({ error: 'Não foi possível autorizar o novo acesso.' }, 500)
  }

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  })

  if (createError || !created.user) {
    if (previousAllowlist.data) {
      await admin
        .from('homologation_access_allowlist')
        .upsert(previousAllowlist.data, { onConflict: 'email' })
    } else {
      await admin
        .from('homologation_access_allowlist')
        .delete()
        .eq('email', email)
    }

    return json(
      {
        error:
          createError?.message ??
          'Não foi possível criar o usuário. Verifique se o e-mail já possui acesso.',
      },
      400,
    )
  }

  const profileResult = await admin.from('profiles').upsert(
    {
      id: created.user.id,
      full_name: fullName,
      role,
      analyst_id: role === 'analista' ? analystId : null,
      chat_analyst_id: role === 'analista' ? chatAnalystId : null,
    },
    { onConflict: 'id' },
  )

  if (profileResult.error) {
    await admin.auth.admin.deleteUser(created.user.id)
    if (previousAllowlist.data) {
      await admin
        .from('homologation_access_allowlist')
        .upsert(previousAllowlist.data, { onConflict: 'email' })
    } else {
      await admin
        .from('homologation_access_allowlist')
        .delete()
        .eq('email', email)
    }

    return json(
      { error: 'O login foi criado, mas o vínculo do perfil falhou; a criação foi revertida.' },
      500,
    )
  }

  return json(
    {
      id: created.user.id,
      message: 'Usuário criado e vinculado com sucesso.',
    },
    201,
  )
})
