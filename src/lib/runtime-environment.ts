const HOMOLOGATION_SUPABASE_URL =
  process.env.NEXT_PUBLIC_HOMOLOGATION_SUPABASE_URL ??
  'https://vvtorcvchnqhcredhorv.supabase.co'

const HOMOLOGATION_SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_HOMOLOGATION_SUPABASE_PUBLISHABLE_KEY ??
  'sb_publishable_mqTX2u1bJ69dNKWD0lO-iw_p2Wa9B2t'

export function isHomologationRuntime() {
  return (
    process.env.VERCEL_ENV === 'preview' ||
    process.env.NEXT_PUBLIC_VERCEL_ENV === 'preview'
  )
}

export function isHomologationBrowserRuntime() {
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname.toLowerCase()
    if (hostname === 'painel-telefone.vercel.app') return false
    if (hostname.endsWith('.vercel.app')) return true
  }

  return process.env.NEXT_PUBLIC_VERCEL_ENV === 'preview'
}

export function getBrowserSupabaseConfig() {
  if (isHomologationBrowserRuntime()) {
    return {
      url: HOMOLOGATION_SUPABASE_URL,
      publishableKey: HOMOLOGATION_SUPABASE_PUBLISHABLE_KEY,
      environment: 'homologacao' as const,
    }
  }

  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '',
    environment: 'producao' as const,
  }
}

export function getServerSupabaseConfig() {
  const homologation = isHomologationRuntime()

  return {
    url: homologation
      ? HOMOLOGATION_SUPABASE_URL
      : process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    publishableKey: homologation
      ? HOMOLOGATION_SUPABASE_PUBLISHABLE_KEY
      : process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '',
    serviceRoleKey: homologation
      ? process.env.HOMOLOGATION_SUPABASE_SERVICE_ROLE_KEY ?? ''
      : process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
    environment: homologation ? ('homologacao' as const) : ('producao' as const),
  }
}
