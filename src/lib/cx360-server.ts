import { createClient } from '@supabase/supabase-js'
import { ApiError, bearer } from './integration-server'

/** Validates existing login and uses the caller's JWT so database RLS also applies. */
export async function authorizeCx(request: Request) {
  const token = bearer(request, 'session')
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if (url !== 'https://qmetbydkepfdgfqkdkai.supabase.co' || !key || process.env.VERCEL_ENV === 'preview') throw new ApiError(503, 'Módulo ainda não configurado neste ambiente.')
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } })
  const { data: { user }, error } = await client.auth.getUser(token)
  if (error || !user) throw new ApiError(401, 'Sessão inválida. Entre novamente no painel.')
  const profile = await client.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (profile.error || !['master', 'coordenadora'].includes(String(profile.data?.role).toLowerCase())) throw new ApiError(403, 'Acesso exclusivo da gestão.')
  return { client, userId: user.id }
}
export async function cxBody(request: Request) {
  const raw = await request.text()
  if (raw.length > 20000) throw new ApiError(413, 'Registro muito extenso.')
  try {
    const body: unknown = JSON.parse(raw)
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error()
    return body as Record<string, unknown>
  } catch { throw new ApiError(400, 'Registro inválido.') }
}
