import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SCHEDULE_SUPABASE_URL ??
    'https://vvtorcvchnqhcredhorv.supabase.co'
  const publishableKey =
    process.env.NEXT_PUBLIC_SCHEDULE_SUPABASE_PUBLISHABLE_KEY ??
    'sb_publishable_mqTX2u1bJ69dNKWD0lO-iw_p2Wa9B2t'

  const admin = createClient(supabaseUrl, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: link, error: linkError } = await admin
    .from('schedule_public_links')
    .select('id,team_id,year,month,active,expires_at,schedule_teams(id,name)')
    .eq('token', token)
    .maybeSingle()

  if (linkError || !link || !link.active) {
    return NextResponse.json({ error: 'Link inválido ou desativado.' }, { status: 404 })
  }
  if (link.expires_at && new Date(link.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: 'Link expirado.' }, { status: 410 })
  }
  if (!link.team_id || !link.year || !link.month) {
    return NextResponse.json({ error: 'Link sem escopo de publicação.' }, { status: 400 })
  }

  const { data: publication } = await admin
    .from('schedule_publications')
    .select('released')
    .eq('team_id', link.team_id)
    .eq('year', link.year)
    .eq('month', link.month)
    .maybeSingle()

  if (!publication?.released) {
    return NextResponse.json({ error: 'Este mês ainda não foi liberado.' }, { status: 403 })
  }

  const prefix = `${link.year}-${String(link.month).padStart(2, '0')}`
  const monthStart = `${prefix}-01`
  const monthEnd = new Date(Date.UTC(link.year, link.month, 0, 12)).toISOString().slice(0, 10)

  const [{ data: entries, error: entriesError }, { data: memberships }, { data: people }, { data: changes }] = await Promise.all([
    admin
      .from('schedule_entries')
      .select('person_id,team_id,date,entry_type,value,source,locked,metadata')
      .eq('team_id', link.team_id)
      .gte('date', monthStart)
      .lte('date', monthEnd)
      .order('date'),
    admin
      .from('schedule_memberships')
      .select('person_id,team_id,start_date,end_date,participates_in_schedule,participates_hybrid,participates_lunch,participates_snack,participates_extended')
      .eq('team_id', link.team_id)
      .lte('start_date', monthEnd),
    admin.from('schedule_people').select('id,name,active').order('name'),
    admin
      .from('schedule_change_events')
      .select('id,target_date,affected_dates,summary,created_at')
      .eq('team_id', link.team_id)
      .eq('visible_to_team', true)
      .gte('target_date', monthStart)
      .lte('target_date', monthEnd)
      .order('created_at', { ascending: false })
      .limit(20),
  ])

  if (entriesError) return NextResponse.json({ error: entriesError.message }, { status: 500 })

  return NextResponse.json({
    team: Array.isArray(link.schedule_teams) ? link.schedule_teams[0] : link.schedule_teams,
    year: link.year,
    month: link.month,
    people: people ?? [],
    memberships: (memberships ?? []).filter((item) => !item.end_date || item.end_date >= monthStart),
    entries: entries ?? [],
    changes: changes ?? [],
  }, {
    headers: {
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  })
}
