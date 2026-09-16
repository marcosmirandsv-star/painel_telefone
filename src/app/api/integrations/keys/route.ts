import { ApiError, authorizeKeyAdmin, handle, json } from '@/lib/integration-server'
import { createIntegrationKey, listIntegrationKeys, revokeIntegrationKey } from '@/lib/integration-key-management'

export const runtime = 'nodejs'
async function readBody(request: Request) {
  const text = await request.text()
  if (text.length > 4096) throw new ApiError(400, 'Requisição muito extensa.')
  try { return JSON.parse(text) } catch { throw new ApiError(400, 'Dados inválidos.') }
}
export async function GET(request: Request) {
  return handle(async () => {
    const { admin } = await authorizeKeyAdmin(request)
    const query = new URL(request.url).searchParams
    if ([...query.keys()].some(k => k !== 'pagina') || query.getAll('pagina').length > 1) throw new ApiError(400, 'Parâmetro inválido.')
    const value = query.get('pagina') ?? '1'
    if (!/^[1-9]\d{0,4}$/.test(value)) throw new ApiError(400, 'Página inválida.')
    return json(await listIntegrationKeys(admin, Number(value)))
  })
}
export async function POST(request: Request) {
  return handle(async () => {
    const { admin, userId } = await authorizeKeyAdmin(request)
    return json(await createIntegrationKey(admin, userId, await readBody(request)), 201)
  })
}
export async function PATCH(request: Request) {
  return handle(async () => {
    const { admin, userId } = await authorizeKeyAdmin(request)
    const body = await readBody(request)
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => k !== 'id')) throw new ApiError(400, 'Informe a chave a revogar.')
    return json(await revokeIntegrationKey(admin, userId, body.id))
  })
}
