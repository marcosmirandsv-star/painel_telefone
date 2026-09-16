import { authorizeConsumer, handle, json, parseQuery } from '@/lib/integration-server'
import { currentIndicators } from '@/lib/integration-data'
export const runtime = 'nodejs'
export async function GET(request: Request) {
  return handle(async () => {
    const period = parseQuery(request, true)
    const admin = await authorizeConsumer(request, 'telefone')
    return json(await currentIndicators(admin, period, true))
  })
}
