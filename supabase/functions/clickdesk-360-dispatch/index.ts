import { createClient } from 'npm:@supabase/supabase-js@2'

const BRANCH_URL =
  'https://central-performance-git-homologacao-project-gestao.vercel.app'

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

function bearer(request: Request) {
  const match = /^Bearer ([^\s]+)$/i.exec(
    request.headers.get('authorization') ?? '',
  )
  const token = match?.[1]?.trim() ?? ''
  return token.length >= 20 && token.length <= 512 ? token : ''
}

function readLimit(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 6
  return Math.max(1, Math.min(Math.trunc(value), 8))
}

function sanitize(message: string) {
  return message
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer ***')
    .replace(/[A-Za-z0-9_-]{32,}/g, '***')
    .replace(/\s+/g, ' ')
    .trim()
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number,
) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
}

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  const token = bearer(request)
  if (!token) return json({ error: 'Unauthorized' }, 401)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const secretKeysRaw = Deno.env.get('SUPABASE_SECRET_KEYS')
  const legacyServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const secretKey = secretKeysRaw
    ? JSON.parse(secretKeysRaw)['default']
    : legacyServiceKey

  if (!supabaseUrl || !secretKey) {
    return json({ error: 'Supabase admin config unavailable' }, 500)
  }

  const admin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const configResult = await admin.rpc('get_homologation_360_dispatch_config', {
    p_token: token,
  })

  if (configResult.error || !configResult.data) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const shareToken = String(configResult.data.share_token ?? '')
  if (!shareToken) {
    return json({ error: 'Share token unavailable' }, 503)
  }

  let body: { limit?: unknown } = {}
  try {
    body = await request.json()
  } catch {
    body = {}
  }
  const limit = readLimit(body.limit)

  try {
    // A Vercel exige uma credencial específica para automação. Links
    // _vercel_share expiram e não constituem autenticação servidor-servidor.
    // O segredo fica exclusivamente no Supabase Vault e é enviado no header.
    const processResponse = await fetchWithTimeout(
      `${BRANCH_URL}/api/clickdesk/operation-360/auto-process`,
      {
        method: 'POST',
        redirect: 'manual',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Central-Automation': 'clickdesk-sync',
          'x-vercel-protection-bypass': shareToken,
        },
        body: JSON.stringify({ limit }),
      },
      95000,
    )

    // A resposta 302 (SSO) ou 401 significa que a credencial de automação
    // ainda não foi configurada/reconhecida. Nunca tratar isso como sucesso.
    if ([301, 302, 303, 307, 308, 401, 403].includes(processResponse.status)) {
      return json({
        error: 'Vercel automation protection bypass not authorized',
        processor_status: processResponse.status,
      }, 503)
    }
    const text = await processResponse.text()
    let payload: unknown = null
    try {
      payload = text ? JSON.parse(text) : null
    } catch {
      payload = { message: text.slice(0, 500) }
    }

    return json(
      {
        ok: processResponse.ok,
        processor_status: processResponse.status,
        processor: payload,
      },
      processResponse.ok ? 200 : processResponse.status,
    )
  } catch (error) {
    return json(
      {
        error: '360 dispatcher failed',
        detail: sanitize(
          error instanceof Error ? error.message : String(error),
        ).slice(0, 300),
      },
      503,
    )
  }
})
