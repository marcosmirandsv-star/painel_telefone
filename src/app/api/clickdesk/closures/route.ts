import { createHash } from 'node:crypto'
import {
  ApiError,
  authorizeManagerSessionClient,
  handle,
  json,
  parseQuery,
} from '@/lib/integration-server'
import {
  buildClickDeskClosureSnapshot,
  type ClickDeskClosurePeriod,
} from '@/lib/clickdesk-closure'
import { getServerSupabaseConfig } from '@/lib/runtime-environment'

export const runtime = 'nodejs'

function fingerprint(snapshot: Record<string, unknown>) {
  const {
    consultado_em: _consultedAt,
    sincronizacao: _sync,
    ...stable
  } = snapshot
  void _consultedAt
  void _sync
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex')
}

export async function GET(request: Request) {
  return handle(async () => {
    const { environment } = getServerSupabaseConfig()
    if (environment !== 'homologacao') {
      throw new ApiError(404, 'Fechamento ClickDesk disponível somente na homologação.')
    }

    const { admin } = await authorizeManagerSessionClient(request)
    const period = parseQuery(request)

    if (period.channel !== 'chat') {
      throw new ApiError(400, 'Esta rota aceita somente canal=chat.')
    }

    if (period.source === 'oficial') {
      const { data, error } = await admin
        .from('integration_closures')
        .select('id,created_at,payload')
        .eq('month', period.month)
        .eq('channel', 'chat')
        .eq('team', period.team)
        .maybeSingle()

      if (error) throw new ApiError(503, 'Fechamento oficial indisponível.')
      if (!data) {
        throw new ApiError(404, 'Ainda não existe fechamento oficial ClickDesk para este filtro.')
      }

      return json({
        ...(data.payload as Record<string, unknown>),
        status: 'fechado',
        fechamento_id: data.id,
        fechado_em: data.created_at,
      })
    }

    const snapshot = await buildClickDeskClosureSnapshot(
      admin,
      period as ClickDeskClosurePeriod,
    )

    return json({
      ...snapshot,
      conferencia: fingerprint(snapshot as unknown as Record<string, unknown>),
    })
  })
}

export async function POST(request: Request) {
  return handle(async () => {
    const { environment } = getServerSupabaseConfig()
    if (environment !== 'homologacao') {
      throw new ApiError(404, 'Fechamento ClickDesk disponível somente na homologação.')
    }

    const { admin, userId } = await authorizeManagerSessionClient(request)
    const period = parseQuery(request)

    if (period.channel !== 'chat') {
      throw new ApiError(400, 'Esta rota aceita somente canal=chat.')
    }
    if (period.source !== 'atual') {
      throw new ApiError(400, 'Use fonte=atual para aprovar o fechamento.')
    }

    let body: { conferencia?: string }
    try {
      body = await request.json()
    } catch {
      throw new ApiError(400, 'Corpo JSON inválido.')
    }

    if (!body || typeof body.conferencia !== 'string') {
      throw new ApiError(400, 'Confira a prévia antes de fechar a competência.')
    }

    const snapshot = await buildClickDeskClosureSnapshot(
      admin,
      period as ClickDeskClosurePeriod,
    )

    if (!snapshot.tem_dados) {
      throw new ApiError(409, 'Não há dados ClickDesk para fechar esta competência.')
    }

    if (!snapshot.fechamento.pronto) {
      throw new ApiError(
        409,
        snapshot.fechamento.pendencias.join(' ') ||
          'A competência ainda não está pronta para fechamento.',
      )
    }

    const currentFingerprint = fingerprint(
      snapshot as unknown as Record<string, unknown>,
    )
    if (body.conferencia !== currentFingerprint) {
      throw new ApiError(
        409,
        'Os dados mudaram desde a conferência. Atualize a prévia antes de fechar.',
      )
    }

    const payload = {
      ...snapshot,
      status: 'fechado',
      fechado_com_regras: 'clickdesk-human-v1',
    }

    const { data, error } = await admin
      .from('integration_closures')
      .insert({
        month: period.month,
        channel: 'chat',
        team: period.team,
        payload,
        created_by: userId,
      })
      .select('id,created_at')
      .single()

    if (error?.code === '23505') {
      throw new ApiError(409, 'Esta competência já possui fechamento oficial preservado.')
    }
    if (error) {
      throw new ApiError(503, 'Não foi possível preservar o fechamento oficial ClickDesk.')
    }

    return json(
      {
        ...payload,
        fechamento_id: data.id,
        fechado_em: data.created_at,
      },
      201,
    )
  })
}
