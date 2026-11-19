import { adminClient, json } from '@/lib/integration-server'
import { isCxCron } from '@/lib/cx360-diagnostics-server'

export const runtime = 'nodejs'

/** One-time release step. Values stay between the production server and its Vault. */
export async function POST(request: Request) {
  if (process.env.CHAT_PRODUCTION_BOOTSTRAP_ENABLED !== 'true'
    || process.env.VERCEL_ENV !== 'production'
    || process.env.NEXT_PUBLIC_SUPABASE_URL !== 'https://qmetbydkepfdgfqkdkai.supabase.co') {
    return json({ erro: 'Operação indisponível.' }, 404)
  }
  if (!isCxCron(request)) return json({ erro: 'Não autorizado.' }, 401)
  const apiKey = process.env.CLICKDESK_API_KEY
  const accountId = process.env.CLICKDESK_ACCOUNT_ID
  if (!apiKey || !accountId) return json({ erro: 'Configuração de produção indisponível.' }, 503)
  try {
    const result = await adminClient().rpc('initialize_clickdesk_production_credentials', {
      p_api_key: apiKey, p_account_id: accountId,
    })
    if (result.error || result.data !== true) return json({ erro: 'Inicialização não concluída; configuração existente preservada.' }, 503)
    return json({ initialized: true })
  } catch {
    return json({ erro: 'Inicialização indisponível.' }, 503)
  }
}
