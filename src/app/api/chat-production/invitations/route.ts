import { NextRequest } from 'next/server'
import { ApiError, authorizeManager, handle, json } from '@/lib/integration-server'
import { isChatProductionEnabled } from '@/lib/chat-production-gate'

export const runtime = 'nodejs'
export const maxDuration = 60

type InvitationRow = {
  analyst_id: string
  email: string
  status: 'pending' | 'sending' | 'invited' | 'failed' | 'link_failed'
  auth_user_id: string | null
  invited_at: string | null
  last_error: string | null
}
type AnalystRow = { id: string; name: string; team_id: string; active: boolean }

function requireChatProduction() {
  if (!isChatProductionEnabled()) throw new ApiError(404, 'Convites do Chat indisponíveis neste ambiente.')
}

async function getRecords(admin: Awaited<ReturnType<typeof authorizeManager>>['admin']) {
  const [queue, people] = await Promise.all([
    admin.from('chat_access_invitations')
      .select('analyst_id,email,status,auth_user_id,invited_at,last_error')
      .order('email'),
    admin.from('chat_analysts').select('id,name,team_id,active'),
  ])
  if (queue.error || people.error) throw new ApiError(503, 'Cadastro de convites indisponível.')
  const analysts = new Map(((people.data ?? []) as AnalystRow[]).map(a => [a.id, a]))
  return ((queue.data ?? []) as InvitationRow[]).map(item => ({
    analyst_id: item.analyst_id,
    name: analysts.get(item.analyst_id)?.name ?? 'Analista não encontrado',
    active: analysts.get(item.analyst_id)?.active === true,
    email: item.email,
    status: item.status,
    invited_at: item.invited_at,
    last_error: item.last_error,
  }))
}

export async function GET(request: NextRequest) {
  return handle(async () => {
    requireChatProduction()
    const { admin } = await authorizeManager(request)
    return json({ items: await getRecords(admin) })
  })
}

export async function POST(request: NextRequest) {
  return handle(async () => {
    requireChatProduction()
    const { admin } = await authorizeManager(request)
    const body = await request.json().catch(() => null)
    const analystId = typeof body?.analystId === 'string' ? body.analystId.trim() : ''
    if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(analystId)) {
      throw new ApiError(400, 'Selecione um analista válido.')
    }

    const [record, analyst, profile] = await Promise.all([
      admin.from('chat_access_invitations').select('*').eq('analyst_id', analystId).maybeSingle(),
      admin.from('chat_analysts').select('id,name,active').eq('id', analystId).maybeSingle(),
      admin.from('profiles').select('id').eq('chat_analyst_id', analystId).limit(1),
    ])
    if (record.error || analyst.error || profile.error) throw new ApiError(503, 'Conferência dos acessos indisponível.')
    const item = record.data as InvitationRow | null
    if (!item || !analyst.data?.active) throw new ApiError(409, 'Convite indisponível: analista não está ativo ou não foi conferido.')
    if (profile.data?.length) throw new ApiError(409, 'Este analista já possui acesso vinculado.')
    if (item.status === 'invited' || item.status === 'sending') {
      throw new ApiError(409, 'Convite já enviado ou em processamento. Não será duplicado.')
    }

    const key = String(analyst.data.name).normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
    const registry = await admin.from('clickdesk_official_owner_registry')
      .select('clickdesk_owner_id').eq('source_owner_key', key)
      .eq('source_scope', 'suporte_erp_fiscal').eq('active', true).maybeSingle()
    if (registry.error || !registry.data) throw new ApiError(409, 'O analista não consta no quadro oficial elegível do Chat.')

    async function linkProfile(userId: string) {
      const { data: existing, error: existingError } = await admin.from('profiles')
        .select('role,chat_analyst_id,analyst_id').eq('id', userId).maybeSingle()
      if (existingError) throw new Error('Não foi possível conferir o perfil de acesso.')
      if (existing && (existing.role !== 'analista' ||
        (existing.chat_analyst_id && existing.chat_analyst_id !== analystId) ||
        existing.analyst_id)) {
        throw new Error('Há um perfil existente incompatível. O acesso precisa de revisão manual.')
      }
      const { error } = await admin.from('profiles').upsert({
        id: userId, full_name: analyst.data.name, role: 'analista',
        analyst_id: null, chat_analyst_id: analystId,
      }, { onConflict: 'id' })
      if (error) throw new Error('Não foi possível vincular o perfil do analista.')
    }

    if (item.status === 'link_failed' && item.auth_user_id) {
      try {
        await linkProfile(item.auth_user_id)
        const { error } = await admin.from('chat_access_invitations')
          .update({ status: 'invited', last_error: null })
          .eq('analyst_id', analystId).eq('status', 'link_failed')
        if (error) throw error
        return json({ status: 'invited', message: 'Vínculo do convite concluído. Não foi enviado outro e-mail.' })
      } catch (error) {
        throw new ApiError(503, error instanceof Error ? error.message : 'Vínculo pendente.')
      }
    }
    if (item.auth_user_id) throw new ApiError(409, 'Já existe usuário convidado; não será enviado um segundo e-mail.')
    if (item.status !== 'pending' && item.status !== 'failed') {
      throw new ApiError(409, 'Convite aguardando conferência.')
    }

    // Exclusive, idempotent claim: a second click cannot send a duplicate email.
    const claimed = await admin.from('chat_access_invitations')
      .update({ status: 'sending', last_error: null })
      .eq('analyst_id', analystId).eq('status', item.status).is('auth_user_id', null)
      .select('analyst_id').maybeSingle()
    if (claimed.error) throw new ApiError(503, 'Não foi possível reservar o convite.')
    if (!claimed.data) throw new ApiError(409, 'Convite já em processamento.')

    const redirectTo = 'https://painel-telefone.vercel.app/?convite=1'
    const { data, error: invitationError } = await admin.auth.admin.inviteUserByEmail(item.email, {
      redirectTo, data: { full_name: analyst.data.name },
    })
    if (invitationError || !data.user?.id) {
      const message = invitationError?.message ?? 'O Supabase não confirmou a criação do convite.'
      await admin.from('chat_access_invitations').update({
        status: 'failed', last_error: message,
      }).eq('analyst_id', analystId).eq('status', 'sending')
      throw new ApiError(503, 'Falha ao enviar convite: ' + message)
    }

    try {
      await linkProfile(data.user.id)
    } catch (error) {
      await admin.from('chat_access_invitations').update({
        status: 'link_failed', auth_user_id: data.user.id,
        invited_at: new Date().toISOString(),
        last_error: error instanceof Error ? error.message : 'Falha ao vincular perfil.',
      }).eq('analyst_id', analystId)
      throw new ApiError(503, 'Convite criado, mas o vínculo do perfil ainda precisa ser concluído. Não reenvie.')
    }

    const { error: updateError } = await admin.from('chat_access_invitations').update({
      status: 'invited', auth_user_id: data.user.id,
      invited_at: new Date().toISOString(), last_error: null,
    }).eq('analyst_id', analystId)
    if (updateError) throw new ApiError(503, 'Convite criado e perfil vinculado; falha ao registrar status. Não reenvie.')
    return json({ status: 'invited', message: 'Convite criado e perfil individual vinculado. Entrega do e-mail depende do provedor.' })
  })
}
