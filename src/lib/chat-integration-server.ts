import {createClient} from '@supabase/supabase-js'
import {ApiError,bearer} from './integration-server'
import {getServerSupabaseConfig} from './runtime-environment'
export * from './integration-server'
export async function authorizeManagerSessionClient(request: Request) {
  const token = bearer(request, 'session')
  const { url, publishableKey, environment } = getServerSupabaseConfig()
  const homologation = environment === 'homologacao'

  if (!url || !publishableKey) {
    throw new ApiError(
      503,
      homologation
        ? 'Configuração pública da homologação indisponível.'
        : 'Configuração pública do serviço indisponível.',
    )
  }

  const client = createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })

  const { data, error } = await client.auth.getUser(token)
  if (error || !data.user) throw new ApiError(401, 'Sessão inválida.')

  const profile = await client.from('profiles').select('role').eq('id', data.user.id).maybeSingle()
  const role = String(profile.data?.role).toLowerCase()
  if (profile.error || !['master', 'coordenadora', 'coordinator'].includes(role)) {
    throw new ApiError(403, 'Acesso exclusivo da gestão.')
  }

  return { admin: client, userId: data.user.id, role }
}

export async function authorizeClickDeskAutomation(request: Request) {
  const token = bearer(request)
  return { token }
}

export async function callClickDeskAutomationDb(
  token: string,
  payload: Record<string, unknown>,
) {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    'https://qmetbydkepfdgfqkdkai.supabase.co'

  const response = await fetch(`${url}/functions/v1/clickdesk-360-db`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    cache: 'no-store',
  })

  const text = await response.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = { error: text.slice(0, 300) }
  }

  if (!response.ok) {
    const source =
      data && typeof data === 'object'
        ? (data as { error?: unknown; detail?: unknown })
        : {}
    const message =
      typeof source.error === 'string'
        ? source.error
        : response.status === 401
          ? 'Automação do ClickDesk não autorizada.'
          : 'Serviço interno da automação do ClickDesk indisponível.'
    throw new ApiError(
      response.status === 401 ? 401 : response.status >= 500 ? 503 : response.status,
      message,
    )
  }

  return data
}

export async function authorizeClickDeskSessionClient(request: Request) {
  const token = bearer(request, 'session')
  const { url, publishableKey, environment } = getServerSupabaseConfig()
  const homologation = environment === 'homologacao'

  if (!url || !publishableKey) {
    throw new ApiError(
      503,
      homologation
        ? 'Configuração pública da homologação indisponível.'
        : 'Configuração pública do serviço indisponível.',
    )
  }

  const client = createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })

  const { data, error } = await client.auth.getUser(token)
  if (error || !data.user) throw new ApiError(401, 'Sessão inválida.')

  const profile = await client
    .from('profiles')
    .select('role,chat_analyst_id')
    .eq('id', data.user.id)
    .maybeSingle()

  if (profile.error || !profile.data) {
    throw new ApiError(403, 'Perfil de acesso não encontrado.')
  }

  const role = String(profile.data.role ?? '').toLowerCase()
  const isManagement = ['master', 'coordenadora', 'coordinator'].includes(role)
  const isAnalyst = ['analista', 'analyst'].includes(role)
  const chatAnalystId =
    typeof profile.data.chat_analyst_id === 'string'
      ? profile.data.chat_analyst_id
      : null

  if (isManagement) {
    return {
      admin: client,
      userId: data.user.id,
      role,
      isManagement: true,
      chatAnalystId: null as string | null,
    }
  }

  if (isAnalyst && chatAnalystId) {
    const membership = await client.from('chat_analysts').select('id,active').eq('id',chatAnalystId).maybeSingle()
    if(membership.error || !membership.data?.active)throw new ApiError(403,'Acesso ao Chat indisponível: vínculo de equipe inativo. Procure a gestão.')
    return {
      admin: client,
      userId: data.user.id,
      role: 'analista',
      isManagement: false,
      chatAnalystId,
    }
  }

  throw new ApiError(
    403,
    'Perfil de analista sem vínculo com o cadastro do Chat.',
  )
}