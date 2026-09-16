import { createHash, timingSafeEqual } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message) }
}
export function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new ApiError(503, 'Serviço não configurado.')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}
export function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...(status === 429 ? { 'Retry-After': '60' } : {}) } })
}
export async function handle(action: () => Promise<Response>) {
  try { return await action() } catch (error) {
    if (error instanceof ApiError) return json({ erro: error.message }, error.status)
    return json({ erro: 'Não foi possível consultar os dados. Tente novamente.' }, 503)
  }
}
export function bearer(request: Request) {
  const match = /^Bearer ([^\s]{20,512})$/i.exec(request.headers.get('authorization') ?? '')
  if (!match) throw new ApiError(401, 'Credencial ausente ou inválida.')
  return match[1]
}
type Consumer = { id: string; sha256: string; expires_at: string; channels: ('telefone' | 'chat')[] }
export function findConsumer(token: string, configuration: string | undefined): Consumer {
  if (!configuration) throw new ApiError(503, 'Integrações ainda não habilitadas.')
  let consumers: Consumer[]
  try {
    consumers = JSON.parse(configuration)
    if (!Array.isArray(consumers) || consumers.some(c => !c || !/^[a-zA-Z0-9_-]{1,64}$/.test(c.id) || !/^[a-f0-9]{64}$/.test(c.sha256) || !Number.isFinite(Date.parse(c.expires_at)) || !Array.isArray(c.channels) || !c.channels.length || c.channels.some(channel => !['telefone', 'chat'].includes(channel)))) throw new Error()
  } catch { throw new ApiError(503, 'Configuração das integrações inválida.') }
  const digest = createHash('sha256').update(token).digest()
  const consumer = consumers.find(c => timingSafeEqual(digest, Buffer.from(c.sha256, 'hex')))
  if (!consumer || Date.parse(consumer.expires_at) <= Date.now()) throw new ApiError(401, 'Credencial ausente, expirada ou inválida.')
  return consumer
}
export async function authorizeConsumer(request: Request, channel: string) {
  const consumer = findConsumer(bearer(request), process.env.INTEGRATION_CLIENTS_JSON)
  if (!consumer.channels.includes(channel as 'telefone' | 'chat')) throw new ApiError(403, 'Canal não autorizado.')
  const admin = adminClient()
  const { data, error } = await admin.rpc('consume_integration_request', { consumer_id: consumer.id })
  if (error) throw new ApiError(503, 'Controle de acesso indisponível.')
  if (!data) throw new ApiError(429, 'Limite de consultas atingido. Aguarde um minuto.')
  return admin
}
export async function authorizeManager(request: Request) {
  const admin = adminClient()
  const { data, error } = await admin.auth.getUser(bearer(request))
  if (error || !data.user) throw new ApiError(401, 'Sessão inválida.')
  const profile = await admin.from('profiles').select('role').eq('id', data.user.id).maybeSingle()
  if (profile.error || !['master', 'coordenadora', 'coordinator'].includes(String(profile.data?.role).toLowerCase())) throw new ApiError(403, 'Acesso exclusivo da gestão.')
  return { admin, userId: data.user.id }
}
export function parseQuery(request: Request, weekly = false) {
  const params = new URL(request.url).searchParams
  const allowed = weekly ? ['inicio', 'fim'] : ['mes', 'canal', 'equipe', 'fonte']
  for (const key of params.keys()) if (!allowed.includes(key) || params.getAll(key).length !== 1) throw new ApiError(400, 'Parâmetro desconhecido ou repetido.')
  const channel = weekly ? 'telefone' : params.get('canal')
  if (channel !== 'telefone' && channel !== 'chat') throw new ApiError(400, 'Informe canal=telefone ou canal=chat.')
  const month = params.get('mes') ?? ''
  if (!weekly && !/^(20\d{2})-(0[1-9]|1[0-2])$/.test(month)) throw new ApiError(400, 'Informe mes no formato AAAA-MM (2000–2099).')
  const start = weekly ? params.get('inicio') ?? '' : `${month}-01`
  const end = weekly ? params.get('fim') ?? '' : new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).toISOString().slice(0, 10)
  const validDate = (value: string) => /^20\d{2}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
  if (!validDate(start) || !validDate(end) || start > end || (weekly && (Date.parse(end) - Date.parse(start)) / 86400000 > 92)) throw new ApiError(400, 'Período inválido; consultas semanais aceitam até 93 dias.')
  const team = params.get('equipe') ?? 'all'
  if (team !== 'all' && (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(team) || channel !== 'chat')) throw new ApiError(400, 'Equipe deve ser um UUID do chat; telefone aceita apenas all.')
  const source = params.get('fonte') ?? 'atual'
  if (!['atual', 'oficial'].includes(source)) throw new ApiError(400, 'Fonte deve ser atual ou oficial.')
  return { channel, month, start, end, team, source }
}
