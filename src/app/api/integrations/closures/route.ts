import { createHash } from 'node:crypto'
import { ApiError, authorizeManager, handle, json, parseQuery } from '@/lib/integration-server'
import { currentIndicators, officialIndicators } from '@/lib/integration-data'
export const runtime = 'nodejs'
function fingerprint(value: object) {
  const { consultado_em: _timestamp, ...stable } = value as Record<string, unknown>
  void _timestamp
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex')
}
export async function GET(request: Request) {
  return handle(async () => {
    const { admin } = await authorizeManager(request)
    const period = parseQuery(request)
    if (period.source === 'oficial') return json(await officialIndicators(admin, period))
    const payload = await currentIndicators(admin, period)
    return json({ ...payload, conferencia: fingerprint(payload) })
  })
}
export async function POST(request: Request) {
  return handle(async () => {
    const { admin, userId } = await authorizeManager(request)
    const period = parseQuery(request)
    if (period.source !== 'atual') throw new ApiError(400, 'Use fonte=atual para fechar.')
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
    if (period.end >= today) throw new ApiError(409, 'Aguarde o encerramento do mês para aprovar o fechamento.')
    let body: { conferencia?: string }
    try { body = await request.json() } catch { throw new ApiError(400, 'Corpo JSON inválido.') }
    if (!body || typeof body.conferencia !== 'string') throw new ApiError(400, 'Confira os indicadores antes de fechar.')
    const payload = await currentIndicators(admin, period)
    if (!payload.tem_dados) throw new ApiError(409, 'Não há dados para fechar este período.')
    if (body.conferencia !== fingerprint(payload)) throw new ApiError(409, 'Os dados mudaram. Consulte e confira novamente.')
    const { data, error } = await admin.from('integration_closures').insert({ month: period.month, channel: period.channel, team: period.team, payload, created_by: userId }).select('id,created_at').single()
    if (error?.code === '23505') throw new ApiError(409, 'Este fechamento já foi aprovado e está preservado.')
    if (error) throw new ApiError(503, 'Não foi possível preservar o fechamento.')
    return json({ ...payload, status: 'fechado', fechamento_id: data.id, fechado_em: data.created_at }, 201)
  })
}
