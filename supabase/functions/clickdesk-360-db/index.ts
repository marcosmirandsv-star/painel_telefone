import { createClient } from 'npm:@supabase/supabase-js@2'

const QUALITATIVE_ANALYSIS_VERSION = 2

type RequestBody = {
  action?: unknown
  start?: unknown
  end?: unknown
  limit?: unknown
  ticket_id?: unknown
  analysis?: unknown
  model?: unknown
  transcript_hash?: unknown
  transcript_characters?: unknown
}

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

function validDate(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^20\d{2}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value))
  )
}

function validTicketId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(value)
}

function readLimit(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 6
  return Math.max(1, Math.min(Math.trunc(value), 8))
}

function analysisVersion(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 0
  const raw = (value as Record<string, unknown>)._analysis_version
  return typeof raw === 'number' && Number.isFinite(raw) ? Math.trunc(raw) : 0
}

function sanitize(message: string) {
  return message
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer ***')
    .replace(/[A-Za-z0-9_-]{32,}/g, '***')
    .replace(/\s+/g, ' ')
    .trim()
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

  const verification = await admin.rpc('get_clickdesk_cron_credentials', {
    p_token: token,
  })
  if (verification.error || !verification.data) {
    return json({ error: 'Unauthorized' }, 401)
  }

  let body: RequestBody = {}
  try {
    body = await request.json()
  } catch {
    body = {}
  }

  const action = typeof body.action === 'string' ? body.action : ''

  try {
    if (action === 'queue') {
      if (!validDate(body.start) || !validDate(body.end) || body.start > body.end) {
        return json({ error: 'Invalid period' }, 400)
      }
      const limit = readLimit(body.limit)

      const attendanceResult = await admin
        .from('clickdesk_chat_attendances')
        .select(
          'clickdesk_ticket_id,analyst_id,area,satisfaction_label,occurred_date,occurred_at',
        )
        .eq('identity_role', 'analyst')
        .in('satisfaction_label', ['negative', 'positive'])
        .gte('occurred_date', body.start)
        .lte('occurred_date', body.end)
        .order('occurred_at', { ascending: true })
        .limit(2000)

      if (attendanceResult.error) {
        return json({ error: 'Unable to load attendance queue' }, 503)
      }

      const attendances = attendanceResult.data ?? []
      const attendanceIds = new Set(
        attendances.map((row) => String(row.clickdesk_ticket_id)),
      )

      const analysisResult = await admin
        .from('clickdesk_qualitative_analyses')
        .select('clickdesk_ticket_id,validation_status,analysis')
        .gte('occurred_date', body.start)
        .lte('occurred_date', body.end)
        .limit(2000)

      if (analysisResult.error) {
        return json({ error: 'Unable to load qualitative cache' }, 503)
      }

      const currentIds = new Set(
        (analysisResult.data ?? [])
          .filter(
            (row) =>
              attendanceIds.has(String(row.clickdesk_ticket_id)) &&
              row.validation_status !== 'rejected' &&
              analysisVersion(row.analysis) >= QUALITATIVE_ANALYSIS_VERSION,
          )
          .map((row) => String(row.clickdesk_ticket_id)),
      )

      const negative = attendances.filter(
        (row) =>
          row.satisfaction_label === 'negative' &&
          !currentIds.has(String(row.clickdesk_ticket_id)),
      )
      const positive = attendances.filter(
        (row) =>
          row.satisfaction_label === 'positive' &&
          !currentIds.has(String(row.clickdesk_ticket_id)),
      )

      const selected: typeof attendances = []
      let ni = 0
      let pi = 0
      while (
        selected.length < limit &&
        (ni < negative.length || pi < positive.length)
      ) {
        if (ni < negative.length) selected.push(negative[ni++])
        if (selected.length < limit && pi < positive.length) {
          selected.push(positive[pi++])
        }
      }

      return json({
        ok: true,
        items: selected,
        remaining: {
          negative: negative.length,
          positive: positive.length,
          total: negative.length + positive.length,
        },
      })
    }

    if (action === 'ticket') {
      if (!validTicketId(body.ticket_id)) {
        return json({ error: 'Invalid ticket_id' }, 400)
      }

      const result = await admin
        .from('clickdesk_chat_attendances')
        .select(
          'clickdesk_ticket_id,analyst_id,area,satisfaction_label,occurred_date,identity_role',
        )
        .eq('clickdesk_ticket_id', body.ticket_id)
        .eq('identity_role', 'analyst')
        .maybeSingle()

      if (result.error) {
        return json({ error: 'Unable to validate attendance' }, 503)
      }
      if (!result.data) return json({ error: 'Attendance not found' }, 404)

      return json({ ok: true, ticket: result.data })
    }

    if (action === 'save') {
      if (
        !validTicketId(body.ticket_id) ||
        !body.analysis ||
        typeof body.analysis !== 'object' ||
        Array.isArray(body.analysis) ||
        typeof body.model !== 'string' ||
        !body.model.trim() ||
        typeof body.transcript_hash !== 'string' ||
        !/^[a-f0-9]{64}$/i.test(body.transcript_hash) ||
        typeof body.transcript_characters !== 'number' ||
        !Number.isInteger(body.transcript_characters) ||
        body.transcript_characters < 1
      ) {
        return json({ error: 'Invalid analysis payload' }, 400)
      }

      const attendance = await admin
        .from('clickdesk_chat_attendances')
        .select(
          'clickdesk_ticket_id,analyst_id,area,satisfaction_label,occurred_date,identity_role',
        )
        .eq('clickdesk_ticket_id', body.ticket_id)
        .eq('identity_role', 'analyst')
        .maybeSingle()

      if (attendance.error) {
        return json({ error: 'Unable to validate attendance' }, 503)
      }
      if (!attendance.data?.analyst_id) {
        return json({ error: 'Attendance not eligible for analysis' }, 422)
      }

      const stored = await admin
        .from('clickdesk_qualitative_analyses')
        .upsert(
          {
            clickdesk_ticket_id: body.ticket_id,
            analyst_id: attendance.data.analyst_id,
            occurred_date: attendance.data.occurred_date,
            area: attendance.data.area,
            satisfaction_label: attendance.data.satisfaction_label,
            analysis: body.analysis,
            model: body.model.trim().slice(0, 160),
            transcript_hash: body.transcript_hash,
            transcript_characters: body.transcript_characters,
            created_by: null,
            validation_status: 'pending',
            validated_by: null,
            validated_at: null,
            validation_notes: null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'clickdesk_ticket_id' },
        )

      if (stored.error) {
        return json(
          {
            error: 'Unable to persist qualitative analysis',
            detail: sanitize(stored.error.message).slice(0, 220),
          },
          503,
        )
      }

      return json({ ok: true })
    }

    return json({ error: 'Unknown action' }, 400)
  } catch (error) {
    return json(
      {
        error: 'Automation database operation failed',
        detail: sanitize(
          error instanceof Error ? error.message : String(error),
        ).slice(0, 260),
      },
      503,
    )
  }
})
