import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function scheduleClient() {
  const url =
    process.env.NEXT_PUBLIC_SCHEDULE_SUPABASE_URL ??
    'https://vvtorcvchnqhcredhorv.supabase.co'
  const key =
    process.env.NEXT_PUBLIC_SCHEDULE_SUPABASE_PUBLISHABLE_KEY ??
    'sb_publishable_mqTX2u1bJ69dNKWD0lO-iw_p2Wa9B2t'
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params
  const body = await request.json().catch(() => null)
  const requesterPersonId = typeof body?.requesterPersonId === 'string' ? body.requesterPersonId.trim() : ''
  const requesterName = typeof body?.requesterName === 'string' ? body.requesterName.trim() : ''
  const requesterEmail = typeof body?.requesterEmail === 'string' ? body.requesterEmail.trim().toLowerCase() : ''
  const targetDate = typeof body?.targetDate === 'string' ? body.targetDate : ''
  const requestType = typeof body?.requestType === 'string' ? body.requestType.trim() : ''
  const requestedValue = typeof body?.requestedValue === 'string' ? body.requestedValue.trim() : ''
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : ''

  if ((!requesterPersonId && !requesterName) || !targetDate || !requestType) {
    return NextResponse.json(
      { error: 'Informe a pessoa, a data e o tipo da solicitação.' },
      { status: 400 },
    )
  }

  const supabase = scheduleClient()
  const { data: link, error: linkError } = await supabase
    .from('schedule_public_links')
    .select('id,team_id,year,month,active,expires_at')
    .eq('token', token)
    .maybeSingle()

  if (linkError || !link || !link.active || !link.team_id || !link.year || !link.month) {
    return NextResponse.json({ error: 'Link inválido ou desativado.' }, { status: 404 })
  }

  if (link.expires_at && new Date(link.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: 'Link expirado.' }, { status: 410 })
  }

  const monthPrefix = `${link.year}-${String(link.month).padStart(2, '0')}`
  if (!targetDate.startsWith(monthPrefix)) {
    return NextResponse.json(
      { error: 'A data precisa pertencer ao mês publicado neste link.' },
      { status: 400 },
    )
  }

  const { data: publication } = await supabase
    .from('schedule_publications')
    .select('released')
    .eq('team_id', link.team_id)
    .eq('year', link.year)
    .eq('month', link.month)
    .maybeSingle()

  if (!publication?.released) {
    return NextResponse.json({ error: 'Este mês ainda não foi liberado.' }, { status: 403 })
  }

  let resolvedPersonId: string | null = null
  let resolvedPersonName = requesterName

  if (requesterPersonId) {
    const { data: person } = await supabase
      .from('schedule_people')
      .select('id,name,active')
      .eq('id', requesterPersonId)
      .maybeSingle()

    const { data: membership } = await supabase
      .from('schedule_memberships')
      .select('id')
      .eq('person_id', requesterPersonId)
      .eq('team_id', link.team_id)
      .eq('participates_in_schedule', true)
      .lte('start_date', targetDate)
      .or(`end_date.is.null,end_date.gte.${targetDate}`)
      .maybeSingle()

    if (!person?.active || !membership) {
      return NextResponse.json(
        { error: 'A pessoa selecionada não pertence a este time na data informada.' },
        { status: 400 },
      )
    }

    resolvedPersonId = person.id
    resolvedPersonName = person.name
  }

  const { data, error } = await supabase
    .from('schedule_requests')
    .insert({
      requester_person_id: resolvedPersonId,
      requester_name: resolvedPersonName,
      requester_email: requesterEmail || null,
      team_id: link.team_id,
      target_date: targetDate,
      request_type: requestType,
      requested_value: requestedValue || null,
      reason: reason || null,
    })
    .select('id,status,created_at')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    id: data.id,
    status: data.status,
    createdAt: data.created_at,
    message: 'Solicitação enviada. A gestão foi notificada.',
  })
}
